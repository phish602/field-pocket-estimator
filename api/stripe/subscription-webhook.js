const { createConfiguredWebhookProcessor } = require("../../server/stripeSubscriptionWebhook");

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

module.exports = async function stripeSubscriptionWebhookApi(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: "Unable to read webhook body." });
  }

  const processWebhook = createConfiguredWebhookProcessor();
  const result = await processWebhook({ rawBody, signature: req.headers?.["stripe-signature"] });
  return res.status(result.status).json(result.body);
};

// Stripe signature validation requires the unparsed request bytes.
module.exports.config = { api: { bodyParser: false } };
