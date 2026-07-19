/** @jest-environment node */

const { Readable } = require("stream");

const webhookApi = require("../../api/stripe/subscription-webhook");
const { createStripeSubscriptionWebhookApiHandler } = webhookApi;
const { MAX_WEBHOOK_RAW_BODY_BYTES } = require("../../server/stripeSubscriptionWebhook");

function response() {
  const res = { statusCode: 0, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

// A request whose stream yields the given chunks and counts how many bytes were
// actually pulled, so overflow tests can prove the read stops early.
function streamingRequest({ method = "POST", headers = {}, chunks = [] }) {
  let bytesRead = 0;
  const source = Readable.from((function* () {
    for (const chunk of chunks) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesRead += buffer.length;
      yield buffer;
    }
  })());
  const req = { method, headers };
  req[Symbol.asyncIterator] = () => source[Symbol.asyncIterator]();
  return { req, bytesRead: () => bytesRead };
}

describe("Stripe subscription webhook API entrypoint", () => {
  test("keeps the body parser disabled", () => {
    expect(webhookApi.config).toEqual({ api: { bodyParser: false } });
  });

  test("rejects a non-POST request with 405 and never reads or dispatches", async () => {
    const createProcessor = jest.fn();
    const handler = createStripeSubscriptionWebhookApiHandler({ createProcessor });
    let iterated = false;
    const req = { method: "GET", headers: {}, [Symbol.asyncIterator]: () => { iterated = true; return [][Symbol.asyncIterator](); } };
    const res = response();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(iterated).toBe(false);
    expect(createProcessor).not.toHaveBeenCalled();
  });

  test("passes an admitted body to the processor byte-for-byte with its signature", async () => {
    const seen = {};
    const processWebhook = jest.fn(async (args) => { Object.assign(seen, args); return { status: 200, body: { received: true } }; });
    const createProcessor = jest.fn(() => processWebhook);
    const handler = createStripeSubscriptionWebhookApiHandler({ createProcessor });

    const { req } = streamingRequest({
      headers: { "stripe-signature": "sig_123" },
      chunks: [Buffer.from("signed "), Buffer.from("payload")],
    });
    const res = response();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(Buffer.isBuffer(seen.rawBody)).toBe(true);
    expect(seen.rawBody.equals(Buffer.from("signed payload"))).toBe(true);
    expect(seen.signature).toBe("sig_123");
  });

  test("rejects an oversized declared Content-Length with 413 before reading the stream", async () => {
    const createProcessor = jest.fn();
    const handler = createStripeSubscriptionWebhookApiHandler({ createProcessor });
    const { req, bytesRead } = streamingRequest({
      headers: { "content-length": String(MAX_WEBHOOK_RAW_BODY_BYTES + 1) },
      chunks: [Buffer.alloc(1024)],
    });
    const res = response();
    await handler(req, res);

    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: "Request body is too large." });
    // Zero bytes pulled: the stream was never consumed.
    expect(bytesRead()).toBe(0);
    expect(createProcessor).not.toHaveBeenCalled();
  });

  test("rejects actual streamed overflow with 413 without unbounded accumulation", async () => {
    const createProcessor = jest.fn();
    // A small injected limit keeps the fixture tiny while proving the mechanism.
    const handler = createStripeSubscriptionWebhookApiHandler({ createProcessor, maxBytes: 4096 });
    // No Content-Length header: overflow can only be caught mid-stream. Far more
    // total data than the limit, delivered in bounded 1 KiB chunks.
    const chunks = Array.from({ length: 64 }, () => Buffer.alloc(1024, 0x61));
    const { req, bytesRead } = streamingRequest({ headers: {}, chunks });
    const res = response();
    await handler(req, res);

    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: "Request body is too large." });
    // Read stopped as soon as the limit was crossed -- it never drained all 64 KiB.
    expect(bytesRead()).toBeLessThanOrEqual(4096 + 1024);
    expect(createProcessor).not.toHaveBeenCalled();
  });

  test("admits a body exactly at the limit", async () => {
    const processWebhook = jest.fn(async () => ({ status: 200, body: { received: true } }));
    const createProcessor = jest.fn(() => processWebhook);
    const handler = createStripeSubscriptionWebhookApiHandler({ createProcessor, maxBytes: 2048 });
    const { req } = streamingRequest({ headers: {}, chunks: [Buffer.alloc(2048, 0x62)] });
    const res = response();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(createProcessor).toHaveBeenCalledTimes(1);
    expect(processWebhook.mock.calls[0][0].rawBody.length).toBe(2048);
  });

  test("returns 400 without dispatch when the stream errors", async () => {
    const createProcessor = jest.fn();
    const handler = createStripeSubscriptionWebhookApiHandler({ createProcessor });
    const req = {
      method: "POST",
      headers: {},
      [Symbol.asyncIterator]: () => (async function* () { throw new Error("stream boom"); })(),
    };
    const res = response();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Unable to read webhook body." });
    expect(createProcessor).not.toHaveBeenCalled();
  });

  test("the default export is a ready handler with a bounded centralized limit", () => {
    expect(typeof webhookApi).toBe("function");
    expect(MAX_WEBHOOK_RAW_BODY_BYTES).toBe(64 * 1024);
  });
});
