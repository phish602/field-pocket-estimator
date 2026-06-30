describe("supabaseClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.REACT_APP_SUPABASE_URL;
    delete process.env.REACT_APP_SUPABASE_ANON_KEY;
    jest.dontMock("@supabase/supabase-js");
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

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

  test("creates a client with fake public-looking values when configured", () => {
    jest.doMock("@supabase/supabase-js", () => ({
      createClient: jest.fn(() => ({ __mockSupabaseClient: true })),
    }));

    process.env.REACT_APP_SUPABASE_URL = "https://example.supabase.co";
    process.env.REACT_APP_SUPABASE_ANON_KEY = "sb_publishable_fake_test_key";

    const { createClient } = require("@supabase/supabase-js");
    const module = require("./supabaseClient");

    expect(module.isSupabaseConfigured).toBe(true);
    expect(module.supabaseEnv).toEqual({
      url: "https://example.supabase.co",
      anonKey: "sb_publishable_fake_test_key",
      isConfigured: true,
      missingKeys: [],
    });
    expect(createClient).toHaveBeenCalledWith(
        "https://example.supabase.co",
        "sb_publishable_fake_test_key",
        {
          auth: {
            autoRefreshToken: true,
            detectSessionInUrl: true,
            persistSession: true,
          },
        },
      );
    expect(module.supabase).toEqual({ __mockSupabaseClient: true });
  });
});
