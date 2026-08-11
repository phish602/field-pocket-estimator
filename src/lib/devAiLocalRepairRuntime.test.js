// Local-only guarantees for the dev-ai repair runtime.
//
// The dev bridge injects LOCAL Supabase admin credentials so the repair endpoint
// can actually run. That capability must never be able to point a destructive
// repair route at a hosted project, and the service-role key must never be
// printed, persisted, or placed anywhere it could leak.

const {
  APPROVED_LOCAL_SUPABASE_URLS,
  FAILURE_MESSAGES,
  isApprovedLocalSupabaseUrl,
  parseSupabaseStatusEnv,
  resolveLocalSupabaseRuntime,
} = require("../../scripts/start-dev-ai-local");

const {
  isApprovedLocalSupabaseUrl: serverIsApprovedLocalSupabaseUrl,
  resolveServiceClient,
  repairStaleInvoiceLineItemDuplicates,
  createExpressStaleInvoiceLineItemRepairHandler,
} = require("../../server/staleInvoiceLineItemRepair");

const FAKE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake-local-service-role.signature";

// Mirrors the real CLI output: quoted values, plus non-assignment noise lines.
function statusOutput({ apiUrl = "http://127.0.0.1:54321", serviceRole = FAKE_SERVICE_ROLE_KEY } = {}) {
  return [
    "Stopped services: [supabase_imgproxy_x supabase_analytics_x]",
    'ANON_KEY="anon-key-value"',
    apiUrl === null ? "" : `API_URL="${apiUrl}"`,
    'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
    serviceRole === null ? "" : `SERVICE_ROLE_KEY="${serviceRole}"`,
    "A new version of Supabase CLI is available: v2.113.0",
  ].filter(Boolean).join("\n");
}

describe("local Supabase URL allowlist", () => {
  test("A - http://127.0.0.1:54321 is accepted", () => {
    expect(isApprovedLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(serverIsApprovedLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(resolveLocalSupabaseRuntime(statusOutput({ apiUrl: "http://127.0.0.1:54321" })).ok).toBe(true);
  });

  test("B - http://localhost:54321 is accepted", () => {
    expect(isApprovedLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(serverIsApprovedLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(resolveLocalSupabaseRuntime(statusOutput({ apiUrl: "http://localhost:54321" })).ok).toBe(true);
  });

  test("trailing-slash variants are accepted", () => {
    expect(isApprovedLocalSupabaseUrl("http://127.0.0.1:54321/")).toBe(true);
    expect(isApprovedLocalSupabaseUrl("http://localhost:54321/")).toBe(true);
    expect(APPROVED_LOCAL_SUPABASE_URLS).toHaveLength(4);
  });

  test.each([
    ["C - a hosted project URL", "https://example.supabase.co"],
    ["C - the real hosted project shape", "https://aioxfciaflmqiizbzsde.supabase.co"],
    ["D - a lookalike host", "http://localhost.attacker.example:54321"],
    ["D - a subdomain lookalike", "http://127.0.0.1.attacker.example:54321"],
    ["a hosted URL containing the literal word localhost", "https://localhost.supabase.co"],
    ["https on the local port", "https://127.0.0.1:54321"],
    ["a different local port", "http://127.0.0.1:54322"],
    ["a path suffix", "http://127.0.0.1:54321/rest/v1"],
    ["an empty value", ""],
  ])("%s is rejected", (_label, url) => {
    expect(isApprovedLocalSupabaseUrl(url)).toBe(false);
    expect(serverIsApprovedLocalSupabaseUrl(url)).toBe(false);
  });

  test("C/D - a rejected URL fails closed and never reaches the launch step", () => {
    const rejected = resolveLocalSupabaseRuntime(statusOutput({ apiUrl: "https://example.supabase.co" }));
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe("local_supabase_url_not_approved");
    // The rejected URL is never carried in the failure or the message.
    expect(JSON.stringify(rejected)).not.toContain("example.supabase.co");
    expect(FAILURE_MESSAGES.local_supabase_url_not_approved).not.toContain("example.supabase.co");
  });
});

describe("E - missing credentials fail closed", () => {
  test("a missing service-role key refuses to launch dev-ai", () => {
    const result = resolveLocalSupabaseRuntime(statusOutput({ serviceRole: null }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("local_service_role_key_missing");
    expect(result.serviceRoleKey).toBeUndefined();
  });

  test("an empty service-role key refuses to launch dev-ai", () => {
    const result = resolveLocalSupabaseRuntime(statusOutput({ serviceRole: "" }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("local_service_role_key_missing");
  });

  test("a missing API URL refuses to launch dev-ai", () => {
    const result = resolveLocalSupabaseRuntime(statusOutput({ apiUrl: null }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("local_supabase_url_missing");
  });

  test("unparsable CLI output refuses to launch dev-ai", () => {
    expect(resolveLocalSupabaseRuntime("").ok).toBe(false);
    expect(resolveLocalSupabaseRuntime("not an env dump at all").ok).toBe(false);
  });
});

describe("F - the service-role key never leaks", () => {
  test("no failure path carries the key in its result or message", () => {
    const failures = [
      resolveLocalSupabaseRuntime(statusOutput({ apiUrl: "https://example.supabase.co" })),
      resolveLocalSupabaseRuntime(statusOutput({ apiUrl: null })),
      resolveLocalSupabaseRuntime(statusOutput({ serviceRole: null })),
    ];
    failures.forEach((failure) => {
      expect(JSON.stringify(failure)).not.toContain(FAKE_SERVICE_ROLE_KEY);
    });
    Object.values(FAILURE_MESSAGES).forEach((message) => {
      expect(message).not.toContain(FAKE_SERVICE_ROLE_KEY);
    });
  });

  test("the parser keeps the key in memory only and never writes to stdout/stderr", () => {
    const out = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const resolved = resolveLocalSupabaseRuntime(statusOutput());
      expect(resolved.ok).toBe(true);
      expect(resolved.serviceRoleKey).toBe(FAKE_SERVICE_ROLE_KEY);
      expect(out).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  test("the status parser tolerates CLI noise and strips quotes", () => {
    const entries = parseSupabaseStatusEnv(statusOutput());
    expect(entries.get("API_URL")).toBe("http://127.0.0.1:54321");
    expect(entries.get("SERVICE_ROLE_KEY")).toBe(FAKE_SERVICE_ROLE_KEY);
    expect(entries.has("Stopped services")).toBe(false);
  });
});

describe("dev-ai runtime enforces local-only, production is unaffected", () => {
  const hostedEnv = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_ROLE_KEY };
  const localEnv = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_ROLE_KEY };

  test("requireLocalSupabase refuses a hosted target", () => {
    const result = resolveServiceClient({ env: hostedEnv, requireLocalSupabase: true });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("local_supabase_required");
  });

  test("requireLocalSupabase accepts the approved local target", () => {
    const result = resolveServiceClient({ env: localEnv, requireLocalSupabase: true });
    expect(result.ok).toBe(true);
    expect(result.client).toBeTruthy();
  });

  test("G - production (requireLocalSupabase off) still accepts its hosted environment", () => {
    const result = resolveServiceClient({ env: hostedEnv });
    expect(result.ok).toBe(true);
    expect(result.client).toBeTruthy();
  });

  test("an unconfigured server reports runtime_not_configured, not a bad request", () => {
    const result = resolveServiceClient({ env: {} });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("runtime_not_configured");
  });
});

describe("Lane 3 - runtime failure is no longer disguised as an invalid request", () => {
  const validRequest = {
    companyId: "11111111-1111-4111-8111-111111111111",
    deviceId: "device-proof",
    staleRowIds: ["22222222-2222-4222-8222-222222222222"],
    accessToken: "some-token",
  };

  test("a well-formed request against an unconfigured server returns 503, not 400", async () => {
    const result = await repairStaleInvoiceLineItemDuplicates({ ...validRequest, env: {} });
    expect(result.status).toBe(503);
    expect(result.reason).toBe("runtime_not_configured");
    expect(result.error).toBe("Repair unavailable.");
  });

  test("a well-formed request against a hosted target in local-only mode returns 503", async () => {
    const result = await repairStaleInvoiceLineItemDuplicates({
      ...validRequest,
      env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_ROLE_KEY },
      requireLocalSupabase: true,
    });
    expect(result.status).toBe(503);
    expect(result.reason).toBe("local_supabase_required");
    expect(JSON.stringify(result)).not.toContain("example.supabase.co");
    expect(JSON.stringify(result)).not.toContain(FAKE_SERVICE_ROLE_KEY);
  });

  test("a genuinely malformed request still returns 400", async () => {
    const result = await repairStaleInvoiceLineItemDuplicates({
      ...validRequest,
      staleRowIds: ["not-a-uuid"],
      env: {},
    });
    expect(result.status).toBe(400);
  });

  test("the express handler maps 503 to repair_unavailable and forwards requireLocalSupabase", async () => {
    const calls = [];
    const handler = createExpressStaleInvoiceLineItemRepairHandler({
      requireLocalSupabase: true,
      repairOperation: async (args) => { calls.push(args); return { ok: false, status: 503, error: "Repair unavailable.", reason: "local_supabase_required" }; },
    });
    let status = 0; let body = null;
    await handler(
      { method: "POST", body: { companyId: "c", deviceId: "d", staleRowIds: ["x"] }, headers: { authorization: "Bearer t" } },
      { status(code) { status = code; return this; }, json(payload) { body = payload; return this; } }
    );
    expect(calls[0].requireLocalSupabase).toBe(true);
    expect(status).toBe(503);
    expect(body).toEqual({ code: "repair_unavailable", message: "Repair unavailable." });
    // The internal reason token is never sent to the browser.
    expect(JSON.stringify(body)).not.toContain("local_supabase_required");
  });
});
