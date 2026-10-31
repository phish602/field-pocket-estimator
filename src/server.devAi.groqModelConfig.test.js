/** @jest-environment node */

// Groq shut down llama-3.1-8b-instant and llama-3.3-70b-versatile on
// 2026-08-16. These tests pin the GPT-OSS replacements, their reasoning
// parameters, and the reasoning token headroom at the provider boundary, and
// prove every active Assist section (labor, itemized and blanket materials,
// scope) still parses the same JSON contracts. The provider
// fetch is mocked: no live Groq request is made.

const http = require("http");

jest.mock("undici", () => ({ fetch: jest.fn() }));

const TEST_GROQ_KEY = "gsk_unit_test_not_a_real_credential_0000";
const LEAKED_REASONING = "INTERNAL-REASONING-MUST-NOT-REACH-THE-CLIENT";
const MODEL_ENV_KEYS = ["GROQ_API_KEY", "GROQ_MODEL", "GROQ_SCOPE_PRIMARY_MODEL", "GROQ_SCOPE_MODEL"];

let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(MODEL_ENV_KEYS.map((key) => [key, process.env[key]]));
  MODEL_ENV_KEYS.forEach((key) => { delete process.env[key]; });
  process.env.GROQ_API_KEY = TEST_GROQ_KEY;
});

afterEach(() => {
  MODEL_ENV_KEYS.forEach((key) => {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  });
});

function groqCompletion(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { role: "assistant", content, reasoning: LEAKED_REASONING } }],
    }),
    text: async () => "",
  };
}

// Loads dev-ai.js fresh so the module-level model constants re-read process.env.
function loadDevAi(env = {}) {
  Object.entries(env).forEach(([key, value]) => { process.env[key] = value; });
  let app;
  let fetch;
  jest.isolateModules(() => {
    ({ fetch } = require("undici"));
    app = require("../server/dev-ai");
  });
  fetch.mockReset();
  return { app, fetch };
}

function providerBodies(fetch) {
  return fetch.mock.calls
    .filter(([url]) => String(url).startsWith("https://api.groq.com/openai/v1/chat/completions"))
    .map(([, options]) => JSON.parse(options.body));
}

async function postJson(app, route, body) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request({
        hostname: "127.0.0.1",
        port: server.address().port,
        path: route,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      }, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, raw, body: JSON.parse(raw) }));
      });
      req.on("error", reject);
      req.end(payload);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const LABOR_REQUEST = {
  sectionKey: "labor",
  userInput: "Replace one 40 gallon gas water heater",
  context: {
    currentSection: "labor",
    tradeKey: "plumbing",
    scopeNotes: "Remove and replace one 40 gallon gas water heater, reconnect gas and water, haul away old unit.",
  },
};

function materialsRequest(materialsMode) {
  return {
    sectionKey: "materials",
    userInput: "Materials for the water heater swap",
    context: {
      currentSection: "materials",
      materialsMode,
      estimateContext: {
        scopeNotes: "Remove and replace one 40 gallon gas water heater, reconnect gas and water.",
        tradeClues: ["plumbing"],
      },
    },
  };
}

describe("default GPT-OSS section requests", () => {
  test("labor uses openai/gpt-oss-20b with low reasoning and keeps the labor JSON contract", async () => {
    const { app, fetch } = loadDevAi();
    fetch.mockResolvedValue(groqCompletion(JSON.stringify({
      lines: [{ role: "Plumber", hours: 6, rate: 125, qty: 1 }],
    })));

    const response = await postJson(app, "/api/ai-assist", LABOR_REQUEST);

    const bodies = providerBodies(fetch);
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    bodies.forEach((body) => {
      expect(body).toEqual(expect.objectContaining({
        model: "openai/gpt-oss-20b",
        reasoning_effort: "low",
        include_reasoning: false,
        stream: false,
      }));
      expect(body).not.toHaveProperty("reasoning_format");
    });
    expect(response.status).toBe(200);
    expect(response.body.lines).toEqual([expect.objectContaining({ role: "Plumber", hours: 6, rate: 125, qty: 1 })]);
    expect(response.raw).not.toContain(LEAKED_REASONING);
  });

  test("itemized materials uses openai/gpt-oss-20b and keeps the itemized JSON contract", async () => {
    const { app, fetch } = loadDevAi();
    fetch.mockResolvedValue(groqCompletion(JSON.stringify({
      responseType: "itemizedSuggestion",
      assumptionsSummary: "Standard residential swap.",
      proposedLines: [{ desc: "40 gal gas water heater", qty: 1, priceEach: 850, unitCostInternal: 0, note: "" }],
      duplicateWarnings: [],
    })));

    const response = await postJson(app, "/api/ai-assist", materialsRequest("itemized"));

    const bodies = providerBodies(fetch);
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    bodies.forEach((body) => {
      expect(body).toEqual(expect.objectContaining({ model: "openai/gpt-oss-20b", reasoning_effort: "low", include_reasoning: false }));
      expect(body.messages[0].content).toContain('"responseType":"itemizedSuggestion"');
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ responseType: "itemizedSuggestion" }));
    expect(response.body.proposedLines).toEqual([expect.objectContaining({ desc: "40 gal gas water heater", qty: 1, priceEach: 850 })]);
    expect(response.raw).not.toContain(LEAKED_REASONING);
  });

  test("blanket materials uses openai/gpt-oss-20b and keeps the blanket JSON contract", async () => {
    const { app, fetch } = loadDevAi();
    fetch.mockResolvedValue(groqCompletion(JSON.stringify({
      responseType: "blanketSuggestion",
      suggestedAmount: 1100,
      assumptionsSummary: "Heater, venting, and fittings.",
      includedCategories: ["Water heater", "Fittings"],
    })));

    const response = await postJson(app, "/api/ai-assist", materialsRequest("blanket"));

    const bodies = providerBodies(fetch);
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    bodies.forEach((body) => {
      expect(body).toEqual(expect.objectContaining({ model: "openai/gpt-oss-20b", reasoning_effort: "low", include_reasoning: false }));
      expect(body.messages[0].content).toContain('"responseType":"blanketSuggestion"');
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ responseType: "blanketSuggestion", suggestedAmount: 1100 }));
    expect(response.raw).not.toContain(LEAKED_REASONING);
  });

  test("uncapped labor and materials requests stay uncapped", async () => {
    const { app, fetch } = loadDevAi();
    fetch.mockResolvedValue(groqCompletion(JSON.stringify({ lines: [{ role: "Plumber", hours: 6, rate: 125, qty: 1 }] })));
    await postJson(app, "/api/ai-assist", LABOR_REQUEST);
    fetch.mockResolvedValue(groqCompletion(JSON.stringify({
      responseType: "blanketSuggestion", suggestedAmount: 1100, assumptionsSummary: "", includedCategories: [],
    })));
    await postJson(app, "/api/ai-assist", materialsRequest("blanket"));

    const bodies = providerBodies(fetch);
    expect(bodies).toHaveLength(2);
    bodies.forEach((body) => expect(body).not.toHaveProperty("max_tokens"));
  });
});

const SCOPE_TEXT = [
  "Remove existing 40 gallon gas water heater.",
  "Install new 40 gallon gas water heater with new flex connectors.",
  "Reconnect gas, water, and venting.",
  "Test for leaks and verify operation.",
  "Haul away the old unit and clean the work area.",
].join("\n");

const SCOPE_INITIAL_REQUEST = {
  sectionKey: "scope",
  mode: "initial",
  userInput: "replace 40 gallon gas water heater in garage, new flex lines, haul away old",
  context: { currentSection: "scope" },
};

const SCOPE_REFINE_REQUEST = {
  sectionKey: "scope",
  mode: "refine",
  userInput: "make it more detailed",
  refineInstruction: "make it more detailed",
  currentScope: SCOPE_TEXT,
  sourcePrompt: "replace water heater",
  context: { currentSection: "scope", scopeMode: "refine", currentScopeNotes: SCOPE_TEXT },
};

// The moderate-expansion scope cap is 640 completion tokens; GPT-OSS gets 512
// tokens of reasoning headroom on top of it.
const SCOPE_BASE_MAX_TOKENS = 640;
const GPT_OSS_HEADROOM = 512;

describe("default GPT-OSS scope requests", () => {
  test.each([
    ["initial generation", SCOPE_INITIAL_REQUEST],
    ["refinement", SCOPE_REFINE_REQUEST],
  ])("scope %s uses openai/gpt-oss-120b with reasoning headroom on its capped budget", async (_label, request) => {
    const { app, fetch } = loadDevAi();
    fetch.mockResolvedValue(groqCompletion(JSON.stringify({ scopeText: SCOPE_TEXT, scope: SCOPE_TEXT })));

    const response = await postJson(app, "/api/ai-assist", request);

    const bodies = providerBodies(fetch);
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    bodies.forEach((body) => {
      expect(body).toEqual(expect.objectContaining({
        model: "openai/gpt-oss-120b",
        reasoning_effort: "low",
        include_reasoning: false,
        max_tokens: SCOPE_BASE_MAX_TOKENS + GPT_OSS_HEADROOM,
      }));
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ outcome: "scope" }));
    expect(String(response.body.scopeNotes || "").trim()).not.toBe("");
    expect(response.raw).not.toContain(LEAKED_REASONING);
  });

  test("scope refinement returns the provider's scope text through the existing parser", async () => {
    const { app, fetch } = loadDevAi();
    fetch.mockResolvedValue(groqCompletion(JSON.stringify({ scopeText: SCOPE_TEXT, scope: SCOPE_TEXT })));

    const response = await postJson(app, "/api/ai-assist", SCOPE_REFINE_REQUEST);

    expect(response.body.scopeNotes).toBe(SCOPE_TEXT);
  });
});

describe("model environment overrides", () => {
  test("a GROQ_MODEL override is honored and a non-GPT-OSS model gets no GPT-OSS parameters", async () => {
    const { app, fetch } = loadDevAi({ GROQ_MODEL: "qwen/qwen3.8-27b" });
    fetch.mockResolvedValue(groqCompletion(JSON.stringify({ lines: [{ role: "Plumber", hours: 6, rate: 125, qty: 1 }] })));

    const response = await postJson(app, "/api/ai-assist", LABOR_REQUEST);

    const [body] = providerBodies(fetch);
    expect(body.model).toBe("qwen/qwen3.8-27b");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("include_reasoning");
    expect(response.body.lines).toEqual([expect.objectContaining({ role: "Plumber" })]);
  });

  test("a GPT-OSS GROQ_MODEL override still receives the GPT-OSS reasoning parameters", async () => {
    const { app, fetch } = loadDevAi({ GROQ_MODEL: "openai/gpt-oss-120b" });
    fetch.mockResolvedValue(groqCompletion(JSON.stringify({ lines: [{ role: "Plumber", hours: 6, rate: 125, qty: 1 }] })));

    await postJson(app, "/api/ai-assist", LABOR_REQUEST);

    const [body] = providerBodies(fetch);
    expect(body).toEqual(expect.objectContaining({ model: "openai/gpt-oss-120b", reasoning_effort: "low", include_reasoning: false }));
  });

  test.each([
    ["GROQ_SCOPE_PRIMARY_MODEL"],
    ["GROQ_SCOPE_MODEL"],
  ])("a non-GPT-OSS %s override keeps the original scope token budget", async (envKey) => {
    const { app, fetch } = loadDevAi({ [envKey]: "qwen/qwen3.8-27b" });
    fetch.mockResolvedValue(groqCompletion(JSON.stringify({ scopeText: SCOPE_TEXT, scope: SCOPE_TEXT })));

    await postJson(app, "/api/ai-assist", SCOPE_REFINE_REQUEST);

    const bodies = providerBodies(fetch);
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    bodies.forEach((body) => {
      expect(body.model).toBe("qwen/qwen3.8-27b");
      expect(body.max_tokens).toBe(SCOPE_BASE_MAX_TOKENS);
      expect(body).not.toHaveProperty("reasoning_effort");
      expect(body).not.toHaveProperty("include_reasoning");
    });
  });
});
