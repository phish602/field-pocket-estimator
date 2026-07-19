const {
  createConfiguredWebhookProcessor,
  MAX_WEBHOOK_RAW_BODY_BYTES,
} = require("../../server/stripeSubscriptionWebhook");

// Sentinel thrown by readRawBody the instant the streamed body crosses the
// limit, so an oversized body is never fully accumulated.
const BODY_TOO_LARGE = Symbol("stripe-webhook-body-too-large");

function declaredContentLength(headers = {}) {
  const value = headers["content-length"] ?? headers["Content-Length"];
  if (Array.isArray(value)) return null;
  const raw = String(value == null ? "" : value).trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const length = Number(raw);
  return Number.isSafeInteger(length) ? length : null;
}

// Read the raw request bytes while counting them. The running total is checked
// before each chunk is retained, so accumulation never exceeds the limit: the
// chunk that would cross it aborts the read instead of being buffered.
async function readRawBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw BODY_TOO_LARGE;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function createStripeSubscriptionWebhookApiHandler({
  createProcessor = createConfiguredWebhookProcessor,
  maxBytes = MAX_WEBHOOK_RAW_BODY_BYTES,
} = {}) {
  return async function stripeSubscriptionWebhookApi(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

    // Reject an oversized declared length before touching the stream, so the
    // body is never read at all in the common oversized case.
    const declaredLength = declaredContentLength(req.headers || {});
    if (declaredLength != null && declaredLength > maxBytes) {
      return res.status(413).json({ error: "Request body is too large." });
    }

    let rawBody;
    try {
      rawBody = await readRawBody(req, maxBytes);
    } catch (error) {
      if (error === BODY_TOO_LARGE) return res.status(413).json({ error: "Request body is too large." });
      return res.status(400).json({ error: "Unable to read webhook body." });
    }

    const processWebhook = createProcessor();
    const result = await processWebhook({ rawBody, signature: req.headers?.["stripe-signature"] });
    return res.status(result.status).json(result.body);
  };
}

module.exports = createStripeSubscriptionWebhookApiHandler();
// Stripe signature validation requires the unparsed request bytes.
module.exports.config = { api: { bodyParser: false } };
module.exports.createStripeSubscriptionWebhookApiHandler = createStripeSubscriptionWebhookApiHandler;
