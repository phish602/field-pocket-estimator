import {
  evaluateSupabaseRuntimePolicy,
  SUPABASE_RUNTIME_POLICY_REASON,
  CLOUD_ENABLED_ENV,
  VERCEL_ENV,
  VERCEL_TARGET_ENV,
} from "./supabaseRuntimePolicy";

// Build an env object explicitly (never inherit process.env), so each case
// proves exactly which variables drive the decision.
function env({ enabled, vercelEnv, targetEnv } = {}) {
  const out = {};
  if (enabled !== undefined) out[CLOUD_ENABLED_ENV] = enabled;
  if (vercelEnv !== undefined) out[VERCEL_ENV] = vercelEnv;
  if (targetEnv !== undefined) out[VERCEL_TARGET_ENV] = targetEnv;
  return out;
}

describe("evaluateSupabaseRuntimePolicy (Gate P1 fail-closed matrix)", () => {
  test("1. enabled=true + Vercel production -> allowed", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ enabled: "true", vercelEnv: "production" }));
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.ALLOWED);
    expect(r.deploymentEnvironment).toBe("production");
    expect(r.explicitlyEnabled).toBe(true);
  });

  test("2. enabled MISSING + Vercel production -> denied (cloud_opt_in_missing)", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ vercelEnv: "production" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.CLOUD_OPT_IN_MISSING);
    expect(r.explicitlyEnabled).toBe(false);
  });

  test("3. enabled=false + Vercel production -> denied (cloud_opt_in_missing)", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ enabled: "false", vercelEnv: "production" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.CLOUD_OPT_IN_MISSING);
  });

  test("4. enabled=true + Vercel PREVIEW -> denied (flag never overrides preview)", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ enabled: "true", vercelEnv: "preview" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.NON_PRODUCTION_DEPLOYMENT);
    expect(r.explicitlyEnabled).toBe(true); // opt-in present but powerless
  });

  test("5. enabled=true + Vercel development -> denied", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ enabled: "true", vercelEnv: "development" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.NON_PRODUCTION_DEPLOYMENT);
  });

  test("6. enabled=true + Vercel env UNSET -> denied", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ enabled: "true" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.NON_PRODUCTION_DEPLOYMENT);
    expect(r.deploymentEnvironment).toBe("");
  });

  test("7. enabled=true + UNKNOWN Vercel env -> denied", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ enabled: "true", vercelEnv: "staging" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.NON_PRODUCTION_DEPLOYMENT);
  });

  test("8. enabled=true + production + target=preview -> denied (non_production_target)", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ enabled: "true", vercelEnv: "production", targetEnv: "preview" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.NON_PRODUCTION_TARGET);
  });

  test("9. enabled=true + production + target=production -> allowed", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ enabled: "true", vercelEnv: "production", targetEnv: "production" }));
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.ALLOWED);
    expect(r.targetEnvironment).toBe("production");
  });

  describe("10. the opt-in flag must equal the exact normalized \"true\"", () => {
    test.each(["1", "yes", "enabled", "on", "TRUE!", "true ", " truthy"])(
      "rejects opt-in value %p in a production deployment",
      (value) => {
        const r = evaluateSupabaseRuntimePolicy(env({ enabled: value, vercelEnv: "production" }));
        // Non-exact opt-in values are treated as NOT enabled.
        if (value === "true ") {
          // Surrounding whitespace is trimmed, so this one IS a valid opt-in.
          expect(r.allowed).toBe(true);
        } else {
          expect(r.allowed).toBe(false);
          expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.CLOUD_OPT_IN_MISSING);
        }
      }
    );

    test("accepts case-insensitive/whitespace-trimmed \"TRUE\" in production", () => {
      const r = evaluateSupabaseRuntimePolicy(env({ enabled: "  TRUE  ", vercelEnv: "production" }));
      expect(r.allowed).toBe(true);
    });
  });

  test("does not consult NODE_ENV, hostname, query params, localStorage, or cookies", () => {
    // Only the three declared env vars matter; NODE_ENV is irrelevant here.
    const r = evaluateSupabaseRuntimePolicy({ NODE_ENV: "production", [CLOUD_ENABLED_ENV]: "true" });
    expect(r.allowed).toBe(false); // no REACT_APP_VERCEL_ENV=production -> denied
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.NON_PRODUCTION_DEPLOYMENT);
  });

  test("is pure -- the same env yields the same result and mutates nothing", () => {
    const input = env({ enabled: "true", vercelEnv: "production" });
    const snapshot = JSON.stringify(input);
    const a = evaluateSupabaseRuntimePolicy(input);
    const b = evaluateSupabaseRuntimePolicy(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(snapshot); // input unchanged
  });
});
