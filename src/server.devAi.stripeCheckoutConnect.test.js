/** @jest-environment node */

const http = require("http");
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

  afterEach(async () => {
    await stopServer(child);
    child = null;
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
});
