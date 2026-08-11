import {
  evaluateSupabaseRuntimePolicy,
  isSupportedLocalSupabaseUrl,
  AUTHORIZED_LOCAL_SUPABASE_URLS,
  SUPABASE_RUNTIME_POLICY_REASON,
  SUPABASE_RUNTIME_MODE,
  CLOUD_ENABLED_ENV,
  LOCAL_SUPABASE_ENABLED_ENV,
  MOBILE_TEST_ENABLED_ENV,
  MOBILE_TEST_SUPABASE_URL_ENV,
  resolveSupabaseRuntimeUrl,
  isSupportedMobileTestSupabaseUrl,
  VERCEL_ENV,
  VERCEL_TARGET_ENV,
} from "./supabaseRuntimePolicy";

const SUPABASE_URL_ENV = "REACT_APP_SUPABASE_URL";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_URL_LOCALHOST = "http://localhost:54321";
const HOSTED_URL = "https://example.supabase.co";
const APP_TUNNEL_ORIGIN = "https://phone-app.trycloudflare.com";
const SUPABASE_TUNNEL_URL = "https://local-supabase.trycloudflare.com";

// Build an env object explicitly (never inherit process.env), so each case
// proves exactly which variables drive the decision.
function env({ enabled, localEnabled, mobileEnabled, mobileUrl, nodeEnv, vercelEnv, targetEnv, url } = {}) {
  const out = {};
  if (enabled !== undefined) out[CLOUD_ENABLED_ENV] = enabled;
  if (localEnabled !== undefined) out[LOCAL_SUPABASE_ENABLED_ENV] = localEnabled;
  if (mobileEnabled !== undefined) out[MOBILE_TEST_ENABLED_ENV] = mobileEnabled;
  if (mobileUrl !== undefined) out[MOBILE_TEST_SUPABASE_URL_ENV] = mobileUrl;
  if (nodeEnv !== undefined) out.NODE_ENV = nodeEnv;
  if (vercelEnv !== undefined) out[VERCEL_ENV] = vercelEnv;
  if (targetEnv !== undefined) out[VERCEL_TARGET_ENV] = targetEnv;
  if (url !== undefined) out[SUPABASE_URL_ENV] = url;
  return out;
}

describe("evaluateSupabaseRuntimePolicy (Gate P1 fail-closed matrix)", () => {
  test("1. enabled=true + Vercel production -> allowed", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ enabled: "true", vercelEnv: "production" }));
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.ALLOWED);
    expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.PRODUCTION);
    expect(r.deploymentEnvironment).toBe("production");
    expect(r.explicitlyEnabled).toBe(true);
  });

  test("2. enabled MISSING + Vercel production -> denied (cloud_opt_in_missing)", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ vercelEnv: "production" }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.CLOUD_OPT_IN_MISSING);
    expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.DENIED);
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
    expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.DENIED);
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
    expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.PRODUCTION);
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
    // Only the declared REACT_APP_* vars matter; NODE_ENV is irrelevant here.
    const r = evaluateSupabaseRuntimePolicy({ NODE_ENV: "production", [CLOUD_ENABLED_ENV]: "true" });
    expect(r.allowed).toBe(false); // no REACT_APP_VERCEL_ENV=production -> denied
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.NON_PRODUCTION_DEPLOYMENT);
  });

  test("NODE_ENV=development never unlocks the local lane on its own", () => {
    const r = evaluateSupabaseRuntimePolicy({ NODE_ENV: "development", [SUPABASE_URL_ENV]: LOCAL_URL });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.LOCAL_OPT_IN_MISSING);
    expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.DENIED);
  });

  test("is pure -- the same env yields the same result and mutates nothing", () => {
    const input = env({ enabled: "true", vercelEnv: "production" });
    const snapshot = JSON.stringify(input);
    const a = evaluateSupabaseRuntimePolicy(input);
    const b = evaluateSupabaseRuntimePolicy(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(snapshot); // input unchanged
  });

  test("is pure in the local lane too -- deterministic and non-mutating", () => {
    const input = env({ localEnabled: "true", url: LOCAL_URL });
    const snapshot = JSON.stringify(input);
    const a = evaluateSupabaseRuntimePolicy(input);
    const b = evaluateSupabaseRuntimePolicy(input);
    expect(a).toEqual(b);
    expect(a.allowed).toBe(true);
    expect(Object.keys(input)).toEqual([LOCAL_SUPABASE_ENABLED_ENV, SUPABASE_URL_ENV]);
    expect(JSON.stringify(input)).toBe(snapshot); // input unchanged
  });

  test("never returns Supabase credentials -- only a safe boolean about the URL", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ localEnabled: "true", url: LOCAL_URL }));
    expect(r.isLocalSupabaseUrl).toBe(true);
    expect(JSON.stringify(r)).not.toContain("54321");
    expect(Object.values(r)).not.toContain(LOCAL_URL);
  });
});

describe("temporary mobile-test Supabase URL resolution", () => {
  const resolve = (overrides = {}) => resolveSupabaseRuntimeUrl({
    localUrl: LOCAL_URL,
    mobileTunnelUrl: SUPABASE_TUNNEL_URL,
    mobileTestEnabled: "true",
    nodeEnv: "development",
    currentOrigin: APP_TUNNEL_ORIGIN,
    ...overrides,
  });

  test("development trycloudflare page with explicit flag selects the exact configured trycloudflare Supabase URL", () => {
    expect(resolve()).toEqual({
      allowed: true,
      url: SUPABASE_TUNNEL_URL,
      usesMobileTunnel: true,
      reason: "mobile_tunnel_selected",
    });

    const result = evaluateSupabaseRuntimePolicy(env({
      localEnabled: "true",
      mobileEnabled: "true",
      mobileUrl: SUPABASE_TUNNEL_URL,
      nodeEnv: "development",
      url: LOCAL_URL,
    }), { currentOrigin: APP_TUNNEL_ORIGIN });
    expect(result.allowed).toBe(true);
    expect(result.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.MOBILE_TEST);
    expect(result.usesMobileTunnel).toBe(true);
  });

  test("localhost page keeps the exact local Supabase URL while mobile mode is enabled", () => {
    const result = resolve({ currentOrigin: "http://127.0.0.1:4001" });
    expect(result.allowed).toBe(true);
    expect(result.url).toBe(LOCAL_URL);
    expect(result.usesMobileTunnel).toBe(false);
    expect(result.reason).toBe("mobile_page_not_eligible");
  });

  test("production rejects valid-looking mobile tunnel configuration", () => {
    const resolved = resolve({ nodeEnv: "production" });
    expect(resolved.allowed).toBe(false);
    expect(resolved.url).toBe("");
    expect(resolved.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.MOBILE_TEST_NON_DEVELOPMENT);

    const result = evaluateSupabaseRuntimePolicy(env({
      localEnabled: "true",
      mobileEnabled: "true",
      mobileUrl: SUPABASE_TUNNEL_URL,
      nodeEnv: "production",
      url: LOCAL_URL,
    }), { currentOrigin: APP_TUNNEL_ORIGIN });
    expect(result.allowed).toBe(false);
    expect(result.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.DENIED);
    expect(result.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.MOBILE_TEST_NON_DEVELOPMENT);
  });

  test.each([
    ["arbitrary HTTPS domain", "https://evil.example.com"],
    ["hosted Supabase domain", "https://project.supabase.co"],
    ["HTTP trycloudflare URL", "http://local-supabase.trycloudflare.com"],
    ["embedded credentials", "https://user:pass@local-supabase.trycloudflare.com"],
    ["query string", "https://local-supabase.trycloudflare.com?token=x"],
    ["bare query marker", "https://local-supabase.trycloudflare.com?"],
    ["fragment", "https://local-supabase.trycloudflare.com#token"],
    ["bare fragment marker", "https://local-supabase.trycloudflare.com#"],
    ["non-root path", "https://local-supabase.trycloudflare.com/auth/v1"],
    ["trycloudflare apex", "https://trycloudflare.com"],
  ])("rejects %s", (_label, mobileTunnelUrl) => {
    expect(isSupportedMobileTestSupabaseUrl(mobileTunnelUrl)).toBe(false);
    const result = resolve({ mobileTunnelUrl });
    expect(result.allowed).toBe(false);
    expect(result.url).toBe("");
    expect(result.usesMobileTunnel).toBe(false);
    expect(result.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.INVALID_MOBILE_TEST_SUPABASE_URL);
  });

  test.each([undefined, "", "false", "yes", "1"])(
    "flag value %p leaves the normal local URL selected",
    (mobileTestEnabled) => {
      const result = resolve({ mobileTestEnabled });
      expect(result.allowed).toBe(true);
      expect(result.url).toBe(LOCAL_URL);
      expect(result.usesMobileTunnel).toBe(false);
      expect(result.reason).toBe("default_url_selected");
    }
  );
});

describe("evaluateSupabaseRuntimePolicy -- local Supabase lane", () => {
  test("local flag=true + http://127.0.0.1:54321 -> allowed in local mode", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ localEnabled: "true", url: LOCAL_URL }));
    expect(r.allowed).toBe(true);
    expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.LOCAL);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.ALLOWED);
    expect(r.localExplicitlyEnabled).toBe(true);
    expect(r.explicitlyEnabled).toBe(false);
    expect(r.isLocalSupabaseUrl).toBe(true);
  });

  test("local flag=true + http://localhost:54321 -> allowed in local mode", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ localEnabled: "true", url: LOCAL_URL_LOCALHOST }));
    expect(r.allowed).toBe(true);
    expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.LOCAL);
  });

  test.each([`${LOCAL_URL}/`, `${LOCAL_URL_LOCALHOST}/`])(
    "trailing slash is allowed: %s",
    (url) => {
      const r = evaluateSupabaseRuntimePolicy(env({ localEnabled: "true", url }));
      expect(r.allowed).toBe(true);
      expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.LOCAL);
    }
  );

  test.each(["  true  ", "TRUE", " True "])(
    "local flag accepts trimmed/case-insensitive %p",
    (localEnabled) => {
      const r = evaluateSupabaseRuntimePolicy(env({ localEnabled, url: LOCAL_URL }));
      expect(r.allowed).toBe(true);
      expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.LOCAL);
    }
  );

  test.each(["1", "yes", "on", "enabled", "TRUE!"])(
    "local flag value %p is NOT an opt-in",
    (localEnabled) => {
      const r = evaluateSupabaseRuntimePolicy(env({ localEnabled, url: LOCAL_URL }));
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.LOCAL_OPT_IN_MISSING);
    }
  );

  test("local URL without the local flag -> local_opt_in_missing", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ url: LOCAL_URL }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.LOCAL_OPT_IN_MISSING);
    expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.DENIED);
  });

  test("local flag=false + local URL -> local_opt_in_missing", () => {
    const r = evaluateSupabaseRuntimePolicy(env({ localEnabled: "false", url: LOCAL_URL }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.LOCAL_OPT_IN_MISSING);
  });

  describe("local flag=true with a URL that is not an exact loopback origin", () => {
    test.each([
      ["hosted Supabase URL", HOSTED_URL],
      ["hosted Supabase URL over http", "http://example.supabase.co"],
      ["HTTPS loopback", "https://127.0.0.1:54321"],
      ["HTTPS localhost", "https://localhost:54321"],
      ["wrong port", "http://127.0.0.1:54322"],
      ["no explicit port", "http://127.0.0.1"],
      ["0.0.0.0", "http://0.0.0.0:54321"],
      ["non-loopback host", "http://192.168.1.10:54321"],
      ["non-loopback hostname", "http://db.internal:54321"],
      ["IPv6 loopback literal", "http://[::1]:54321"],
      ["non-root pathname", "http://127.0.0.1:54321/rest/v1"],
      ["non-root pathname on localhost", "http://localhost:54321/auth"],
      ["query string", "http://127.0.0.1:54321/?apikey=x"],
      ["bare query marker", "http://127.0.0.1:54321?"],
      ["fragment", "http://127.0.0.1:54321/#token"],
      ["bare fragment marker", "http://127.0.0.1:54321#"],
      ["URL credentials", "http://user:pass@127.0.0.1:54321"],
      ["URL username only", "http://user@localhost:54321"],
      ["not a URL", "127.0.0.1:54321"],
      ["empty string", ""],
      ["placeholder", "replace_with_supabase_project_url"],
      // ISO-10A: the URL parser canonicalizes each of these into an approved
      // loopback form, so only an exact-string allow-list keeps them out.
      ["leading whitespace", " http://127.0.0.1:54321"],
      ["trailing whitespace", "http://127.0.0.1:54321 "],
      ["uppercase hostname", "http://LOCALHOST:54321"],
      ["mixed-case hostname", "http://LocalHost:54321"],
      ["shorthand octets", "http://127.1:54321"],
      ["decimal integer host", "http://2130706433:54321"],
      ["octal octets", "http://0177.0.0.1:54321"],
      ["hex integer host", "http://0x7f000001:54321"],
      ["dot path segment", "http://127.0.0.1:54321/."],
      ["percent-encoded dot path", "http://127.0.0.1:54321/%2e"],
      ["percent-encoded dot-dot path", "http://127.0.0.1:54321/%2e%2e"],
      ["trailing dot hostname", "http://localhost.:54321"],
      ["double slash path", "http://127.0.0.1:54321//"],
      ["backslash path", "http://127.0.0.1:54321\\"],
      ["tab-padded", "\thttp://127.0.0.1:54321"],
      ["newline-padded", "http://127.0.0.1:54321\n"],
      ["uppercase scheme", "HTTP://127.0.0.1:54321"],
    ])("%s -> invalid_local_supabase_url", (_label, url) => {
      const r = evaluateSupabaseRuntimePolicy(env({ localEnabled: "true", url }));
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.INVALID_LOCAL_SUPABASE_URL);
      expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.DENIED);
      expect(r.isLocalSupabaseUrl).toBe(false);
    });

    test("URL entirely absent -> invalid_local_supabase_url", () => {
      const r = evaluateSupabaseRuntimePolicy(env({ localEnabled: "true" }));
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.INVALID_LOCAL_SUPABASE_URL);
    });
  });

  describe("a Vercel deployment signal always beats the local lane", () => {
    test.each(["preview", "development", "production", "staging", "unknown"])(
      "local flag=true + local URL + REACT_APP_VERCEL_ENV=%s -> denied",
      (vercelEnv) => {
        const r = evaluateSupabaseRuntimePolicy(env({ localEnabled: "true", url: LOCAL_URL, vercelEnv }));
        expect(r.allowed).toBe(false);
        expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.DENIED);
        expect(r.reason).toBe(
          vercelEnv === "production"
            ? SUPABASE_RUNTIME_POLICY_REASON.CLOUD_OPT_IN_MISSING
            : SUPABASE_RUNTIME_POLICY_REASON.NON_PRODUCTION_DEPLOYMENT
        );
      }
    );

    test.each(["production", "preview", "development", "staging"])(
      "local flag=true + local URL + REACT_APP_VERCEL_TARGET_ENV=%s -> denied",
      (targetEnv) => {
        const r = evaluateSupabaseRuntimePolicy(env({ localEnabled: "true", url: LOCAL_URL, targetEnv }));
        expect(r.allowed).toBe(false);
        expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.DENIED);
        expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.NON_PRODUCTION_DEPLOYMENT);
      }
    );

    test("a Vercel Production build never enters the local lane", () => {
      const r = evaluateSupabaseRuntimePolicy(
        env({ localEnabled: "true", url: LOCAL_URL, vercelEnv: "production", targetEnv: "production" })
      );
      expect(r.allowed).toBe(false);
      expect(r.runtimeMode).not.toBe(SUPABASE_RUNTIME_MODE.LOCAL);
      expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.CLOUD_OPT_IN_MISSING);
    });
  });

  describe("conflicting opt-ins", () => {
    test("cloud=true + local=true -> conflicting_opt_ins", () => {
      const r = evaluateSupabaseRuntimePolicy(env({ enabled: "true", localEnabled: "true", url: LOCAL_URL }));
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.CONFLICTING_OPT_INS);
      expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.DENIED);
    });

    test.each([
      ["Vercel production + hosted URL", { vercelEnv: "production", url: HOSTED_URL }],
      ["Vercel production + production target", { vercelEnv: "production", targetEnv: "production", url: HOSTED_URL }],
      ["Vercel preview", { vercelEnv: "preview", url: HOSTED_URL }],
      ["no deployment signal + local URL", { url: LOCAL_URL }],
      ["no URL at all", {}],
    ])("conflicting opt-ins deny regardless of environment: %s", (_label, extra) => {
      const r = evaluateSupabaseRuntimePolicy(env({ enabled: "true", localEnabled: "true", ...extra }));
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.CONFLICTING_OPT_INS);
    });
  });
});

describe("isSupportedLocalSupabaseUrl", () => {
  // Exactly the four authorized strings -- no other textual representation.
  test.each([
    "http://127.0.0.1:54321",
    "http://127.0.0.1:54321/",
    "http://localhost:54321",
    "http://localhost:54321/",
  ])("accepts %p", (url) => {
    expect(isSupportedLocalSupabaseUrl(url)).toBe(true);
  });

  test("the authorized allow-list is exactly those four strings and is frozen", () => {
    expect(AUTHORIZED_LOCAL_SUPABASE_URLS).toEqual([
      "http://127.0.0.1:54321",
      "http://127.0.0.1:54321/",
      "http://localhost:54321",
      "http://localhost:54321/",
    ]);
    expect(Object.isFrozen(AUTHORIZED_LOCAL_SUPABASE_URLS)).toBe(true);
    expect(() => {
      "use strict";
      AUTHORIZED_LOCAL_SUPABASE_URLS.push("http://evil.example:54321");
    }).toThrow();
    expect(AUTHORIZED_LOCAL_SUPABASE_URLS).toHaveLength(4);
  });

  test.each([
    HOSTED_URL,
    "https://127.0.0.1:54321",
    "http://127.0.0.1:5432",
    "http://0.0.0.0:54321",
    "http://127.0.0.1:54321/rest",
    "http://127.0.0.1:54321/?x=1",
    "http://127.0.0.1:54321/#f",
    "http://a:b@127.0.0.1:54321",
    "ws://127.0.0.1:54321",
    "",
    "   ",
    undefined,
    null,
    54321,
    {},
  ])("rejects %p", (url) => {
    expect(isSupportedLocalSupabaseUrl(url)).toBe(false);
  });

  // ISO-10A regression: every one of these canonicalizes through `new URL(...)`
  // into a form that passes the component checks, so the exact-string allow-list
  // is the only thing rejecting them.
  describe("rejects loopback spellings the URL parser would canonicalize", () => {
    const CANONICALIZING_INPUTS = [
      " http://127.0.0.1:54321",
      "http://127.0.0.1:54321 ",
      "\thttp://127.0.0.1:54321",
      "http://127.0.0.1:54321\n",
      "http://LOCALHOST:54321",
      "http://LocalHost:54321",
      "http://127.1:54321",
      "http://2130706433:54321",
      "http://0177.0.0.1:54321",
      "http://0x7f000001:54321",
      "http://127.0.0.1:54321/.",
      "http://127.0.0.1:54321/%2e",
      "http://127.0.0.1:54321/%2e%2e",
      "http://localhost.:54321",
      "http://127.0.0.1:54321//",
      "http://127.0.0.1:54321\\",
      "HTTP://127.0.0.1:54321",
    ];

    test.each(CANONICALIZING_INPUTS)("isSupportedLocalSupabaseUrl(%p) === false", (url) => {
      expect(isSupportedLocalSupabaseUrl(url)).toBe(false);
    });

    test.each(CANONICALIZING_INPUTS)(
      "policy denies %p with invalid_local_supabase_url when the local opt-in is true",
      (url) => {
        const r = evaluateSupabaseRuntimePolicy(env({ localEnabled: "true", url }));
        expect(r.allowed).toBe(false);
        expect(r.runtimeMode).toBe(SUPABASE_RUNTIME_MODE.DENIED);
        expect(r.reason).toBe(SUPABASE_RUNTIME_POLICY_REASON.INVALID_LOCAL_SUPABASE_URL);
        expect(r.isLocalSupabaseUrl).toBe(false);
      }
    );

    test("documents that these DO canonicalize to an approved-looking origin", () => {
      // Proves the defect was real: the parsed components alone cannot tell
      // these apart from the authorized strings.
      const canonicalized = ["http://127.1:54321", "http://2130706433:54321", "http://LOCALHOST:54321"].map(
        (url) => new URL(url).origin
      );
      expect(canonicalized).toEqual([
        "http://127.0.0.1:54321",
        "http://127.0.0.1:54321",
        "http://localhost:54321",
      ]);
    });
  });
});
