import { getSupabaseEnv, SUPABASE_ANON_KEY_ENV, SUPABASE_URL_ENV } from "./supabaseEnv";

describe("supabaseEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env[SUPABASE_URL_ENV];
    delete process.env[SUPABASE_ANON_KEY_ENV];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("missing values are treated as not configured", () => {
    const env = getSupabaseEnv();

    expect(env).toEqual({
      url: "",
      anonKey: "",
      isConfigured: false,
      missingKeys: [SUPABASE_URL_ENV, SUPABASE_ANON_KEY_ENV],
    });
  });

  test("placeholder values are treated as not configured", () => {
    process.env[SUPABASE_URL_ENV] = "replace_with_supabase_project_url";
    process.env[SUPABASE_ANON_KEY_ENV] = "replace_with_supabase_anon_public_key";

    const env = getSupabaseEnv();

    expect(env).toEqual({
      url: "",
      anonKey: "",
      isConfigured: false,
      missingKeys: [SUPABASE_URL_ENV, SUPABASE_ANON_KEY_ENV],
    });
  });

  test("fake public-looking values are treated as configured", () => {
    process.env[SUPABASE_URL_ENV] = "https://example.supabase.co";
    process.env[SUPABASE_ANON_KEY_ENV] = "sb_publishable_fake_test_key";

    const env = getSupabaseEnv();

    expect(env).toEqual({
      url: "https://example.supabase.co",
      anonKey: "sb_publishable_fake_test_key",
      isConfigured: true,
      missingKeys: [],
    });
  });
});
