/** @jest-environment node */

// Prompt contracts for the active AI Assist sections. Real Groq output showed
// reusable tools listed as job materials, a blanket allowance contradicting
// itself about labor, and a scope refinement inventing a rooftop location.
// These tests pin the instructions that address those failures, using
// contrasting HVAC jobs so no rule depends on one equipment configuration.
// They prove what the model is told, not what any future model will return.
// The provider fetch is mocked: no live Groq request is made.

const http = require("http");

jest.mock("undici", () => ({ fetch: jest.fn() }));

const TEST_GROQ_KEY = "gsk_unit_test_not_a_real_credential_0000";

const HVAC_SCOPES = {
  splitSystem: "Replace the existing 3-ton split-system condenser and the matching cased evaporator coil. Install a new line set, new pad, and new outdoor disconnect, then evacuate, charge, start up, and test.",
  miniSplit: "Install a new 12,000 BTU ductless mini-split: one wall-mounted indoor head in the main bedroom and one outdoor unit on a wall bracket, with a 25 ft line set kit and a condensate pump.",
  basementFurnace: "Replace the existing gas furnace in the basement utility closet with a new 80,000 BTU unit. Reconnect the existing ductwork, flue, and gas line, then test ignition, airflow, and safety controls.",
};

// Words specific to one of the three jobs. A system prompt that contains any of
// them would be steering every job toward that equipment or location.
const JOB_SPECIFIC_WORDS = /condenser|evaporator|mini-split|ductless|furnace|basement|rooftop|attic|wall bracket/i;

let savedKey;

beforeEach(() => {
  savedKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = TEST_GROQ_KEY;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = savedKey;
});

function completion(content) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: "assistant", content } }] }), text: async () => "" };
}

function loadDevAi() {
  let app;
  let fetch;
  jest.isolateModules(() => {
    ({ fetch } = require("undici"));
    app = require("../server/dev-ai");
  });
  fetch.mockReset();
  return { app, fetch };
}

async function postJson(app, body) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request({
        hostname: "127.0.0.1",
        port: server.address().port,
        path: "/api/ai-assist",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      }, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      });
      req.on("error", reject);
      req.end(payload);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Sends one request and returns the system and user prompts of every provider call.
async function capturePrompts(body, providerContent) {
  const { app, fetch } = loadDevAi();
  fetch.mockResolvedValue(completion(providerContent));
  const response = await postJson(app, body);
  const calls = fetch.mock.calls.map(([, options]) => {
    const parsed = JSON.parse(options.body);
    return { system: parsed.messages[0].content, user: parsed.messages[1].content, raw: options.body };
  });
  return { response, calls };
}

function materialsRequest(materialsMode, scopeNotes) {
  return {
    sectionKey: "materials",
    userInput: "",
    context: { currentSection: "materials", materialsMode, estimateContext: { scopeNotes, tradeClues: ["hvac"] } },
  };
}

const ITEMIZED_REPLY = JSON.stringify({
  responseType: "itemizedSuggestion",
  assumptionsSummary: "Major components first.",
  proposedLines: [{ desc: "Replacement unit", qty: 1, priceEach: 1000, unitCostInternal: 0, note: "" }],
  duplicateWarnings: [],
});

const BLANKET_REPLY = JSON.stringify({
  responseType: "blanketSuggestion",
  suggestedAmount: 2400,
  assumptionsSummary: "Equipment and installation supplies.",
  includedCategories: ["Equipment", "Fittings"],
});

describe("materials prompts", () => {
  test.each(Object.entries(HVAC_SCOPES))("itemized prompt for the %s job separates materials from tools and grounds components in the scope", async (_job, scope) => {
    const { response, calls } = await capturePrompts(materialsRequest("itemized", scope), ITEMIZED_REPLY);

    expect(calls).toHaveLength(1);
    const [{ system, user }] = calls;
    expect(system).toContain("Job materials are components permanently installed on this job and supplies consumed by it");
    expect(system).toContain("Do not list reusable contractor tools, testing instruments, test-gas cylinders, or rented equipment as materials unless the scope explicitly says to charge for them");
    expect(system).toContain("Include every major component the scope says will be installed or replaced");
    expect(system).toContain("List the major components the scope says will be installed or replaced before any minor supplies");
    expect(system).toContain("Do not add components, sizes, ratings, quantities, or installation conditions that the scope does not state or clearly require");
    expect(system).toContain('"responseType":"itemizedSuggestion"');
    expect(system).not.toMatch(JOB_SPECIFIC_WORDS);
    expect(user).toContain(`Scope: ${scope}`);
    expect(response.body).toEqual(expect.objectContaining({ responseType: "itemizedSuggestion" }));
    expect(response.body.proposedLines).toEqual([expect.objectContaining({ desc: "Replacement unit", qty: 1, priceEach: 1000 })]);
  });

  test.each(Object.entries(HVAC_SCOPES))("blanket prompt for the %s job keeps the allowance materials-only and internally consistent", async (_job, scope) => {
    const { response, calls } = await capturePrompts(materialsRequest("blanket", scope), BLANKET_REPLY);

    expect(calls).toHaveLength(1);
    const [{ system, user }] = calls;
    expect(system).toContain("This allowance covers materials only. Labor is never part of it");
    expect(system).toContain("assumptionsSummary should briefly explain which materials the allowance assumes, and must not contradict includedCategories");
    expect(system).toContain("includedCategories should be short material categories that the allowance carries, never services or work activities");
    expect(system).toContain("Do not list reusable contractor tools, testing instruments, test-gas cylinders, or rented equipment as materials");
    expect(system).toContain('"responseType":"blanketSuggestion"');
    expect(system).not.toMatch(JOB_SPECIFIC_WORDS);
    expect(user).toContain(`Scope: ${scope}`);
    expect(response.body).toEqual(expect.objectContaining({ responseType: "blanketSuggestion", suggestedAmount: 2400 }));
  });

  test("materials system prompts are identical across contrasting HVAC jobs", async () => {
    for (const mode of ["itemized", "blanket"]) {
      const systems = [];
      for (const scope of Object.values(HVAC_SCOPES)) {
        const { calls } = await capturePrompts(materialsRequest(mode, scope), mode === "itemized" ? ITEMIZED_REPLY : BLANKET_REPLY);
        systems.push(calls[0].system);
      }
      expect(new Set(systems).size).toBe(1);
    }
  });
});

describe("labor prompt", () => {
  test("labor keeps its own contract and receives none of the materials rules", async () => {
    const { response, calls } = await capturePrompts({
      sectionKey: "labor",
      userInput: "",
      laborRequestMode: "from_scope",
      context: { currentSection: "labor", laborRequestMode: "from_scope", scopeNotes: HVAC_SCOPES.basementFurnace },
    }, JSON.stringify({ lines: [{ role: "HVAC Technician", hours: 10, rate: 95, qty: 1 }] }));

    const [{ system, user }] = calls;
    expect(system).toContain('Return ONLY valid JSON matching this exact schema: {"lines":[{"role":"string","hours":number,"rate":number,"qty":number}]}');
    expect(system).not.toContain("Job materials are components permanently installed");
    expect(system).not.toContain("Labor is never part of it");
    expect(user).toContain(`Scope: ${HVAC_SCOPES.basementFurnace}`);
    expect(response.body.lines).toEqual([expect.objectContaining({ role: "HVAC Technician", hours: 10, rate: 95 })]);
  });
});

const SCOPE_REPLY = (text) => JSON.stringify({ outcome: "scope", scopeNotes: text, clarificationQuestion: "", missingFields: [] });

describe("scope prompts", () => {
  test.each(Object.entries(HVAC_SCOPES))("scope generation for the %s job forbids invented locations and configurations", async (_job, scope) => {
    const { calls } = await capturePrompts({
      sectionKey: "scope",
      mode: "initial",
      userInput: scope,
      sourcePrompt: scope,
      context: { currentSection: "scope", scopePromptBasis: scope, sourcePrompt: scope },
    }, SCOPE_REPLY(scope));

    expect(calls.length).toBeGreaterThanOrEqual(1);
    calls.forEach(({ system, raw }) => {
      expect(system).toContain("Use only job details supplied by the user or already present in the current scope. Do not invent the installation location, elevation, mounting position, equipment configuration, access conditions, or site conditions.");
      expect(system).not.toContain("infer the likely contractor workflow, access,");
      expect(system).not.toMatch(JOB_SPECIFIC_WORDS);
      expect(raw).not.toMatch(/rooftop/i);
    });
  });

  test("a scope revision treats the current scope as the source of truth and changes only what was asked", async () => {
    const current = HVAC_SCOPES.splitSystem;
    const { response, calls } = await capturePrompts({
      sectionKey: "scope",
      mode: "refine",
      userInput: "Add the refrigerant recovery details",
      refineInstruction: "Add the refrigerant recovery details",
      currentScope: current,
      context: { currentSection: "scope", scopeMode: "refine", currentScopeNotes: current, refineInstruction: "Add the refrigerant recovery details" },
    }, SCOPE_REPLY(`${current} Recover the existing refrigerant before removal.`));

    expect(calls).toHaveLength(1);
    const [{ user, raw }] = calls;
    expect(user).toContain(`Current scope to revise (source of truth for job details): ${current}`);
    expect(user).toContain("Apply the revision request to the current scope. Keep its existing job details and meaning, and change only what the request asks for.");
    expect(user).toContain("Do not introduce an installation location, elevation, mounting position, equipment configuration, or site condition that is not in the current scope or the revision request.");
    expect(user).not.toContain("for background only");
    expect(user).not.toContain("Make this a fuller first-pass scope note");
    expect(raw).not.toMatch(/rooftop/i);
    expect(response.body).toEqual(expect.objectContaining({ outcome: "scope" }));
  });

  test("a regenerate that ignores the current scope keeps the first-pass instructions", async () => {
    const current = HVAC_SCOPES.miniSplit;
    const { calls } = await capturePrompts({
      sectionKey: "scope",
      mode: "refine",
      userInput: "Start over for a two-zone system",
      refineInstruction: "Start over for a two-zone system",
      currentScope: current,
      ignoreCurrentScope: true,
      context: { currentSection: "scope", scopeMode: "refine", currentScopeNotes: current, refineInstruction: "Start over for a two-zone system" },
    }, SCOPE_REPLY("Install a two-zone ductless system."));

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const [{ user }] = calls;
    expect(user).not.toContain("Current scope to revise");
    expect(user).toContain("Make this a fuller first-pass scope note");
  });

  test("Shorter keeps every work step and its retry inherits the same rules", async () => {
    const current = HVAC_SCOPES.basementFurnace;
    const { calls } = await capturePrompts({
      sectionKey: "scope",
      mode: "refine",
      userInput: "Shorter",
      refineInstruction: "Shorter",
      currentScope: current,
      context: { currentSection: "scope", scopeMode: "refine", currentScopeNotes: current, refineInstruction: "Shorter" },
    }, SCOPE_REPLY(current));

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].user).toContain("Keep every distinct work step from the current draft. Compress the wording, not the work.");
    calls.forEach(({ system }) => {
      expect(system).toContain("Keep every distinct work step from the current draft. Compress the wording, not the work.");
      expect(system).toContain("Use only job details supplied by the user or already present in the current scope.");
    });
  });

  test("Dash + Brief prompts carry no example location and forbid invented locations", async () => {
    const current = HVAC_SCOPES.miniSplit;
    const { calls } = await capturePrompts({
      sectionKey: "scope",
      mode: "refine",
      userInput: "Dash + Brief",
      refineInstruction: "Dash + Brief",
      formatIntent: "dash_brief",
      currentScope: current,
      context: { currentSection: "scope", scopeMode: "refine", currentScopeNotes: current, refineInstruction: "Dash + Brief", originalAcceptedProseScope: current },
    }, "- Mount the indoor head\n- Set the outdoor unit\n- Run the line set\n\nMini-split installed and tested.");

    expect(calls.length).toBeGreaterThanOrEqual(1);
    calls.forEach(({ system, raw }) => {
      expect(raw).not.toMatch(/rooftop/i);
      expect(system).toMatch(/Do not invent work, locations, equipment configurations, site conditions|Use only job details supplied by the user/);
    });
  });
});
