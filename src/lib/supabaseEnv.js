export const SUPABASE_URL_ENV = "REACT_APP_SUPABASE_URL";
export const SUPABASE_ANON_KEY_ENV = "REACT_APP_SUPABASE_ANON_KEY";

const PLACEHOLDER_VALUES = new Set([
  "replace_with_supabase_project_url",
  "replace_with_supabase_anon_public_key",
]);

function normalizeEnvValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isConfiguredValue(value) {
  const normalized = normalizeEnvValue(value);
  return Boolean(normalized) && !PLACEHOLDER_VALUES.has(normalized);
}

export function getSupabaseEnv(env = process.env) {
  const urlValue = normalizeEnvValue(env?.[SUPABASE_URL_ENV]);
  const anonKeyValue = normalizeEnvValue(env?.[SUPABASE_ANON_KEY_ENV]);

  const missingKeys = [];

  if (!isConfiguredValue(urlValue)) {
    missingKeys.push(SUPABASE_URL_ENV);
  }

  if (!isConfiguredValue(anonKeyValue)) {
    missingKeys.push(SUPABASE_ANON_KEY_ENV);
  }

  return {
    url: isConfiguredValue(urlValue) ? urlValue : "",
    anonKey: isConfiguredValue(anonKeyValue) ? anonKeyValue : "",
    isConfigured: missingKeys.length === 0,
    missingKeys,
  };
}
