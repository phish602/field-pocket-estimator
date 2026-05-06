/** @jest-environment node */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

jest.setTimeout(30000);

function requestJson(port, method, routePath, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: routePath,
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode || 0,
              json: raw ? JSON.parse(raw) : {},
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function requestText(port, method, routePath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: routePath,
        method,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            text: raw,
            contentType: String(res.headers["content-type"] || ""),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(port) {
  for (let index = 0; index < 80; index += 1) {
    try {
      const result = await requestJson(port, "GET", "/api/dev-ai-identity");
      if (result.status === 200 && result.json?.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`dev-ai server did not start on port ${port}`);
}

function startServer(envOverrides = {}) {
  const port = String(envOverrides.DEV_AI_PORT);
  const child = spawn(process.execPath, ["server/dev-ai.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      DEV_AI_PORT: port,
      ...envOverrides,
    },
    stdio: "ignore",
  });
  return child;
}

function createStripeMockHook(sessionPayload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "estipaid-stripe-mock-"));
  const file = path.join(dir, "mock-stripe.js");
  fs.writeFileSync(file, `
const Module = require("module");
const originalLoad = Module._load;
const sessionPayload = ${JSON.stringify(sessionPayload)};

class MockStripe {
  constructor() {
    this.accounts = {
      retrieve: async () => ({ charges_enabled: true }),
    };
    this.checkout = {
      sessions: {
        retrieve: async () => sessionPayload,
        create: async () => ({
          id: "cs_test_created",
          url: "https://checkout.stripe.com/pay/mock",
          expires_at: 1714694400,
        }),
      },
    };
  }
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "stripe") return MockStripe;
  return originalLoad.call(this, request, parent, isMain);
};
`, "utf8");
  return dir;
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 1000);
  });
}

describe("dev-ai Stripe Connect checkout guards", () => {
  let child;
  let port;
  let tempDir = "";

  afterEach(async () => {
    await stopServer(child);
    child = null;
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  test("rejects missing stripeAccountId with safe 400", async () => {
    port = 5961;
    child = startServer({
      DEV_AI_PORT: String(port),
      STRIPE_SECRET_KEY: "sk_test_connect_phase2",
    });
    await waitForServer(port);

    const response = await requestJson(port, "POST", "/api/stripe/create-checkout-session", {
      invoiceId: "inv_1",
      invoiceNumber: "INV-1",
      balanceRemaining: 125,
    });

    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: "Connect Stripe before accepting online payments." });
  });

  test("rejects invalid stripeAccountId with safe 400", async () => {
    port = 5962;
    child = startServer({
      DEV_AI_PORT: String(port),
      STRIPE_SECRET_KEY: "sk_test_connect_phase2",
    });
    await waitForServer(port);

    const response = await requestJson(port, "POST", "/api/stripe/create-checkout-session", {
      invoiceId: "inv_2",
      invoiceNumber: "INV-2",
      stripeAccountId: "bad_account",
      balanceRemaining: 225,
    });

    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: "Invalid stripeAccountId." });
  });

  test("returns safe 500 when Stripe is not configured", async () => {
    port = 5963;
    child = startServer({
      DEV_AI_PORT: String(port),
      STRIPE_SECRET_KEY: "",
    });
    await waitForServer(port);

    const response = await requestJson(port, "POST", "/api/stripe/create-checkout-session", {
      invoiceId: "inv_3",
      invoiceNumber: "INV-3",
      stripeAccountId: "acct_test_missing_secret",
      balanceRemaining: 325,
    });

    expect(response.status).toBe(500);
    expect(response.json).toEqual({ error: "Stripe is not configured." });
  });

  test("retrieve-checkout-session returns safe enriched Stripe payment details", async () => {
    port = 5966;
    tempDir = createStripeMockHook({
      id: "cs_test_paid_123",
      payment_status: "paid",
      status: "complete",
      amount_total: 20000,
      amount_subtotal: 20000,
      currency: "usd",
      customer_details: { email: "payer@example.com" },
      created: 1714993200,
      payment_method_types: ["card"],
      payment_intent: {
        id: "pi_test_paid_123",
        created: 1714993200,
        amount_received: 20000,
        payment_method: {
          id: "pm_test_123",
          type: "card",
          card: {
            brand: "visa",
            last4: "4242",
          },
        },
        latest_charge: {
          id: "ch_test_123",
          created: 1714993260,
          amount: 20000,
          amount_captured: 20000,
          receipt_email: "payer@example.com",
          receipt_url: "https://pay.stripe.com/receipts/acct_123/ch_123",
          payment_method_details: {
            type: "card",
            card: {
              brand: "visa",
              last4: "4242",
            },
          },
        },
      },
    });
    child = startServer({
      DEV_AI_PORT: String(port),
      STRIPE_SECRET_KEY: "sk_test_mocked",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ""}--require=${path.join(tempDir, "mock-stripe.js")}`,
    });
    await waitForServer(port);

    const response = await requestJson(port, "POST", "/api/stripe/retrieve-checkout-session", {
      sessionId: "cs_test_paid_123",
      stripeAccountId: "acct_test_connected_123",
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual(expect.objectContaining({
      ok: true,
      sessionId: "cs_test_paid_123",
      stripeAccountId: "acct_test_connected_123",
      paymentStatus: "paid",
      status: "complete",
      amountTotal: 20000,
      amountSubtotal: 20000,
      amountReceived: 20000,
      currency: "usd",
      customerEmail: "payer@example.com",
      receiptEmail: "payer@example.com",
      receiptUrl: "https://pay.stripe.com/receipts/acct_123/ch_123",
      paymentIntentId: "pi_test_paid_123",
      paymentMethodType: "card",
      cardBrand: "visa",
      cardLast4: "4242",
      paidAt: "2024-05-06T11:01:00.000Z",
    }));
    expect(Object.keys(response.json)).not.toContain("payment_intent");
    expect(Object.keys(response.json)).not.toContain("latest_charge");
  });

  test("retrieve-checkout-session rejects invalid sessionId with safe 400", async () => {
    port = 5964;
    child = startServer({
      DEV_AI_PORT: String(port),
      STRIPE_SECRET_KEY: "sk_test_connect_phase3a",
    });
    await waitForServer(port);

    const response = await requestJson(port, "POST", "/api/stripe/retrieve-checkout-session", {
      sessionId: "bad_session",
      stripeAccountId: "acct_test_123",
    });

    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: "Invalid sessionId." });
  });

  test("retrieve-checkout-session rejects invalid stripeAccountId with safe 400", async () => {
    port = 5965;
    child = startServer({
      DEV_AI_PORT: String(port),
      STRIPE_SECRET_KEY: "sk_test_connect_phase3a",
    });
    await waitForServer(port);

    const response = await requestJson(port, "POST", "/api/stripe/retrieve-checkout-session", {
      sessionId: "cs_test_123",
      stripeAccountId: "bad_account",
    });

    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: "Invalid stripeAccountId." });
  });

  test("retrieve-checkout-session returns safe 500 when Stripe is not configured", async () => {
    port = 5966;
    child = startServer({
      DEV_AI_PORT: String(port),
      STRIPE_SECRET_KEY: "",
    });
    await waitForServer(port);

    const response = await requestJson(port, "POST", "/api/stripe/retrieve-checkout-session", {
      sessionId: "cs_test_456",
      stripeAccountId: "acct_test_missing_secret",
    });

    expect(response.status).toBe(500);
    expect(response.json).toEqual({ error: "Stripe is not configured." });
  });

  test("stripe checkout success page uses close-tab action and safe frontend fallback instead of backend OK", async () => {
    port = 5967;
    child = startServer({
      DEV_AI_PORT: String(port),
      STRIPE_SECRET_KEY: "",
      STRIPE_APP_RETURN_URL: "http://127.0.0.1:3000",
    });
    await waitForServer(port);

    const response = await requestText(
      port,
      "GET",
      "/api/stripe/checkout/success?invoiceId=inv_7&invoiceNumber=INV-7&returnTo=http%3A%2F%2Flocalhost%3A5055&session_id=cs_test_789"
    );

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/html");
    expect(response.text).toContain("Stripe payment received");
    expect(response.text).toContain("Check / Sync Stripe Payment");
    expect(response.text).toContain("Payment status");
    expect(response.text).toContain("Received by Stripe");
    expect(response.text).toContain("EstiPaid status");
    expect(response.text).toContain("Awaiting manual Check / Sync");
    expect(response.text).toContain("INV-7");
    expect(response.text).toContain("cs_test_789...");
    expect(response.text).toContain("Close this tab");
    expect(response.text).toContain("Open EstiPaid");
    expect(response.text).toContain('href="http://127.0.0.1:3000/?stripe=success&amp;invoiceId=inv_7&amp;session_id=cs_test_789"');
    expect(response.text).not.toContain('href="http://localhost:5055');
    expect(response.text).not.toContain("invoice ledger updates.");
    expect(response.text).not.toBe("OK");
  });

  test("stripe checkout cancel page uses close-tab action and safe frontend fallback instead of backend OK", async () => {
    port = 5968;
    child = startServer({
      DEV_AI_PORT: String(port),
      STRIPE_SECRET_KEY: "",
      CLIENT_URL: "http://localhost:3000",
    });
    await waitForServer(port);

    const response = await requestText(
      port,
      "GET",
      "/api/stripe/checkout/cancel?invoiceId=inv_8&invoiceNumber=INV-8&returnTo=http%3A%2F%2Flocalhost%3A5055"
    );

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/html");
    expect(response.text).toContain("Stripe checkout canceled");
    expect(response.text).toContain("No payment was completed in Stripe");
    expect(response.text).toContain("Canceled / not completed");
    expect(response.text).toContain("No invoice update yet");
    expect(response.text).toContain("INV-8");
    expect(response.text).toContain("Close this tab");
    expect(response.text).toContain("Open EstiPaid");
    expect(response.text).toContain('href="http://localhost:3000/?stripe=cancel&amp;invoiceId=inv_8"');
    expect(response.text).not.toContain('href="http://localhost:5055');
    expect(response.text).not.toBe("OK");
  });
});
