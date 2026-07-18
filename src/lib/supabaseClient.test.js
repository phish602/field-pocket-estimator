describe("supabaseClient", () => {
  const originalEnv = process.env;

  const VALID_URL = "https://example.supabase.co";
  const VALID_KEY = "sb_publishable_fake_test_key";
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
    delete process.env.REACT_APP_VERCEL_ENV;
    delete process.env.REACT_APP_VERCEL_TARGET_ENV;
    jest.dontMock("@supabase/supabase-js");
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  function setEnv({ url, key, enabled, vercelEnv, targetEnv } = {}) {
    if (url !== undefined) process.env.REACT_APP_SUPABASE_URL = url;
    if (key !== undefined) process.env.REACT_APP_SUPABASE_ANON_KEY = key;
    if (enabled !== undefined) process.env.REACT_APP_ESTIPAID_CLOUD_ENABLED = enabled;
    if (vercelEnv !== undefined) process.env.REACT_APP_VERCEL_ENV = vercelEnv;
    if (targetEnv !== undefined) process.env.REACT_APP_VERCEL_TARGET_ENV = targetEnv;
  }

  // Loads the module with a mocked createClient so we can assert whether it was
  // ever called -- the core Gate P1 guarantee.
  function loadWithMockedCreateClient() {
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
  });
});
