describe("supabaseClient", () => {
  const originalEnv = process.env;

  const VALID_URL = "https://example.supabase.co";
  const VALID_KEY = "sb_publishable_fake_test_key";
  const LOCAL_URL = "http://127.0.0.1:54321";
  const LOCAL_KEY = "sb_publishable_fake_local_test_key";
  const APP_TUNNEL_ORIGIN = "https://phone-app.trycloudflare.com";
  const SUPABASE_TUNNEL_URL = "https://local-supabase.trycloudflare.com";
  const AUTH_OPTIONS = {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.REACT_APP_SUPABASE_URL;
    delete process.env.REACT_APP_SUPABASE_ANON_KEY;
    // Gate P1 runtime-policy inputs -- cleared so each case is explicit.
    delete process.env.REACT_APP_ESTIPAID_CLOUD_ENABLED;
    delete process.env.REACT_APP_ESTIPAID_LOCAL_SUPABASE_ENABLED;
    delete process.env.REACT_APP_ESTIPAID_MOBILE_TEST_MODE;
    delete process.env.REACT_APP_MOBILE_TEST_SUPABASE_URL;
    delete process.env.REACT_APP_VERCEL_ENV;
    delete process.env.REACT_APP_VERCEL_TARGET_ENV;
    jest.dontMock("@supabase/supabase-js");
    jest.dontMock("./supabaseRuntimePolicy");
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  function setEnv({
    url,
    key,
    enabled,
    localEnabled,
    mobileEnabled,
    mobileUrl,
    nodeEnv,
    vercelEnv,
    targetEnv,
  } = {}) {
    if (url !== undefined) process.env.REACT_APP_SUPABASE_URL = url;
    if (key !== undefined) process.env.REACT_APP_SUPABASE_ANON_KEY = key;
    if (enabled !== undefined) process.env.REACT_APP_ESTIPAID_CLOUD_ENABLED = enabled;
    if (localEnabled !== undefined) {
      process.env.REACT_APP_ESTIPAID_LOCAL_SUPABASE_ENABLED = localEnabled;
    }
    if (mobileEnabled !== undefined) process.env.REACT_APP_ESTIPAID_MOBILE_TEST_MODE = mobileEnabled;
    if (mobileUrl !== undefined) process.env.REACT_APP_MOBILE_TEST_SUPABASE_URL = mobileUrl;
    if (nodeEnv !== undefined) process.env.NODE_ENV = nodeEnv;
    if (vercelEnv !== undefined) process.env.REACT_APP_VERCEL_ENV = vercelEnv;
    if (targetEnv !== undefined) process.env.REACT_APP_VERCEL_TARGET_ENV = targetEnv;
  }

  // Loads the module with a mocked createClient so we can assert whether it was
  // ever called -- the core Gate P1 guarantee.
  function loadWithMockedCreateClient({ currentOrigin } = {}) {
    if (currentOrigin) {
      jest.doMock("./supabaseRuntimePolicy", () => {
        const actual = jest.requireActual("./supabaseRuntimePolicy");
        return {
          ...actual,
          resolveSupabaseRuntimeUrl: (options) => actual.resolveSupabaseRuntimeUrl({
            ...(options || {}),
            currentOrigin,
          }),
          evaluateSupabaseRuntimePolicy: (env) => actual.evaluateSupabaseRuntimePolicy(env, { currentOrigin }),
        };
      });
    }
    const createClient = jest.fn(() => ({ __mockSupabaseClient: true }));
    jest.doMock("@supabase/supabase-js", () => ({ createClient }));
    const module = require("./supabaseClient");
    return { module, createClient };
  }

  const PRODUCTION = { enabled: "true", vercelEnv: "production" };

  test("does not throw and exports a null client when env is missing", () => {
    const module = require("./supabaseClient");

    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabaseEnv).toEqual({
      url: "",
      anonKey: "",
      isConfigured: false,
      missingKeys: ["REACT_APP_SUPABASE_URL", "REACT_APP_SUPABASE_ANON_KEY"],
    });
    expect(module.supabase).toBeNull();
  });

  // 1. Missing URL/key -> null client, createClient not called.
  test("missing Supabase URL/key -> null client, createClient not called (even with the opt-in + production)", () => {
    setEnv({ ...PRODUCTION }); // valid policy, but no URL/key
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(module.getSupabaseClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 2. Valid URL/key alone (no policy opt-in / no Vercel env) -> null client.
  test("valid URL/key alone -> null client, createClient not called", () => {
    setEnv({ url: VALID_URL, key: VALID_KEY });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseEnv.isConfigured).toBe(true); // env is valid...
    expect(module.supabaseRuntimePolicy.allowed).toBe(false); // ...but policy denies
    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 3. CRITICAL REGRESSION: valid URL/key + enabled=true + Vercel PREVIEW.
  // Even if all production browser credentials AND the opt-in flag leak into a
  // Preview build, REACT_APP_VERCEL_ENV=preview must prevent client construction.
  test("valid URL/key + enabled=true + Vercel preview -> null client, createClient not called", () => {
    setEnv({ url: VALID_URL, key: VALID_KEY, enabled: "true", vercelEnv: "preview" });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseEnv.isConfigured).toBe(true);
    expect(module.supabaseRuntimePolicy.allowed).toBe(false);
    expect(module.supabaseRuntimePolicy.reason).toBe("non_production_deployment");
    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(module.getSupabaseClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 4. Valid URL/key + enabled=true + Vercel development -> null client.
  test("valid URL/key + enabled=true + Vercel development -> null client, createClient not called", () => {
    setEnv({ url: VALID_URL, key: VALID_KEY, enabled: "true", vercelEnv: "development" });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 5. Valid URL/key + enabled=true + Vercel env UNSET -> null client.
  test("valid URL/key + enabled=true + Vercel env unset -> null client, createClient not called", () => {
    setEnv({ url: VALID_URL, key: VALID_KEY, enabled: "true" });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 7. Production Vercel environment WITHOUT the explicit opt-in -> null client.
  test("Vercel production without the explicit opt-in -> null client, createClient not called", () => {
    setEnv({ url: VALID_URL, key: VALID_KEY, vercelEnv: "production" });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseRuntimePolicy.reason).toBe("cloud_opt_in_missing");
    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 6. The one legitimate case: valid URL/key + opt-in + Vercel production.
  test("valid URL/key + enabled=true + Vercel production -> exactly one createClient call with preserved auth options", () => {
    setEnv({ url: VALID_URL, key: VALID_KEY, ...PRODUCTION });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseRuntimePolicy.allowed).toBe(true);
    expect(module.isSupabaseConfigured).toBe(true);
    expect(module.supabaseEnv).toEqual({
      url: VALID_URL,
      anonKey: VALID_KEY,
      isConfigured: true,
      missingKeys: [],
    });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(VALID_URL, VALID_KEY, AUTH_OPTIONS);
    expect(module.supabase).toEqual({ __mockSupabaseClient: true });
    expect(module.getSupabaseClient()).toEqual({ __mockSupabaseClient: true });
    expect(module.supabaseRuntimePolicy.runtimeMode).toBe("production");
  });

  // ---- ISO-10 local Supabase lane -------------------------------------------

  // 8. Loopback URL/key WITHOUT the local opt-in -> null client.
  test("local URL/key without the local opt-in -> null client, createClient not called", () => {
    setEnv({ url: LOCAL_URL, key: LOCAL_KEY });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseEnv.isConfigured).toBe(true); // env is valid...
    expect(module.supabaseRuntimePolicy.allowed).toBe(false); // ...but policy denies
    expect(module.supabaseRuntimePolicy.reason).toBe("local_opt_in_missing");
    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(module.getSupabaseClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 9. The second legitimate case: loopback URL/key + the local opt-in only.
  test("local URL/key + local opt-in -> exactly one createClient call with the same preserved auth options", () => {
    setEnv({ url: LOCAL_URL, key: LOCAL_KEY, localEnabled: "true" });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseRuntimePolicy.allowed).toBe(true);
    expect(module.supabaseRuntimePolicy.runtimeMode).toBe("local");
    expect(module.isSupabaseConfigured).toBe(true);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(LOCAL_URL, LOCAL_KEY, AUTH_OPTIONS);
    expect(module.supabase).toEqual({ __mockSupabaseClient: true });
    expect(module.getSupabaseClient()).toEqual({ __mockSupabaseClient: true });
  });

  test("development mobile mode constructs the one existing client exactly once from the resolved tunnel URL", () => {
    setEnv({
      url: LOCAL_URL,
      key: LOCAL_KEY,
      localEnabled: "true",
      mobileEnabled: "true",
      mobileUrl: SUPABASE_TUNNEL_URL,
      nodeEnv: "development",
    });
    const { module, createClient } = loadWithMockedCreateClient({ currentOrigin: APP_TUNNEL_ORIGIN });

    expect(module.supabaseRuntimePolicy.allowed).toBe(true);
    expect(module.supabaseRuntimePolicy.runtimeMode).toBe("mobile_test");
    expect(module.supabaseRuntimePolicy.usesMobileTunnel).toBe(true);
    expect(module.isSupabaseConfigured).toBe(true);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(SUPABASE_TUNNEL_URL, LOCAL_KEY, AUTH_OPTIONS);
    expect(module.getSupabaseClient()).toEqual({ __mockSupabaseClient: true });
  });

  test("production rejects mobile mode and never constructs a tunnel client", () => {
    setEnv({
      url: LOCAL_URL,
      key: LOCAL_KEY,
      localEnabled: "true",
      mobileEnabled: "true",
      mobileUrl: SUPABASE_TUNNEL_URL,
      nodeEnv: "production",
    });
    const { module, createClient } = loadWithMockedCreateClient({ currentOrigin: APP_TUNNEL_ORIGIN });

    expect(module.supabaseRuntimePolicy.allowed).toBe(false);
    expect(module.supabaseRuntimePolicy.reason).toBe("mobile_test_non_development");
    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 10. The local opt-in must never unlock HOSTED Supabase.
  test("local opt-in + hosted URL/key -> null client, createClient not called", () => {
    setEnv({ url: VALID_URL, key: VALID_KEY, localEnabled: "true" });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseRuntimePolicy.allowed).toBe(false);
    expect(module.supabaseRuntimePolicy.reason).toBe("invalid_local_supabase_url");
    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 11. CRITICAL REGRESSION: the local lane must stay unreachable in Preview.
  test("local opt-in + local URL/key + Vercel preview -> null client, createClient not called", () => {
    setEnv({ url: LOCAL_URL, key: LOCAL_KEY, localEnabled: "true", vercelEnv: "preview" });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseRuntimePolicy.allowed).toBe(false);
    expect(module.supabaseRuntimePolicy.runtimeMode).toBe("denied");
    expect(module.supabaseRuntimePolicy.reason).toBe("non_production_deployment");
    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 12. Both opt-ins at once is a configuration error -> null client.
  test("conflicting cloud + local opt-ins -> null client, createClient not called", () => {
    setEnv({ url: LOCAL_URL, key: LOCAL_KEY, enabled: "true", localEnabled: "true" });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseRuntimePolicy.allowed).toBe(false);
    expect(module.supabaseRuntimePolicy.reason).toBe("conflicting_opt_ins");
    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 13. Conflicting opt-ins deny even a genuine Production hosted build.
  test("conflicting cloud + local opt-ins in Vercel production -> null client, createClient not called", () => {
    setEnv({ url: VALID_URL, key: VALID_KEY, enabled: "true", localEnabled: "true", vercelEnv: "production" });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseRuntimePolicy.reason).toBe("conflicting_opt_ins");
    expect(module.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 14. ISO-10A REGRESSION: a loopback URL spelling that `new URL(...)`
  // canonicalizes to http://127.0.0.1:54321 is NOT one of the four authorized
  // strings, so the client must still refuse to construct.
  test.each([
    "http://127.1:54321",
    "http://2130706433:54321",
    "http://0177.0.0.1:54321",
    "http://0x7f000001:54321",
    "http://LOCALHOST:54321",
    " http://127.0.0.1:54321",
    "http://127.0.0.1:54321 ",
    "http://127.0.0.1:54321/.",
    "http://127.0.0.1:54321/%2e",
    "http://127.0.0.1:54321/%2e%2e",
  ])("local opt-in + canonicalizing URL %p -> null client, createClient not called", (url) => {
    setEnv({ url, key: LOCAL_KEY, localEnabled: "true" });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseRuntimePolicy.allowed).toBe(false);
    expect(module.supabaseRuntimePolicy.reason).toBe("invalid_local_supabase_url");
    expect(module.supabaseRuntimePolicy.runtimeMode).toBe("denied");
    expect(module.isSupabaseConfigured).toBe(false);
    expect(module.supabase).toBeNull();
    expect(module.getSupabaseClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // 15. A local opt-in with no URL/key at all still constructs nothing.
  test("local opt-in with missing URL/key -> null client, createClient not called", () => {
    setEnv({ localEnabled: "true" });
    const { module, createClient } = loadWithMockedCreateClient();

    expect(module.supabaseEnv.isConfigured).toBe(false);
    expect(module.supabaseRuntimePolicy.allowed).toBe(false);
    expect(module.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});
