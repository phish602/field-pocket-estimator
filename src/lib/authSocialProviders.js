// Phase 2.2 -- provider registry for SOCIAL OAuth sign-in (Google, Apple).
//
// This is deliberately NOT enterprise SSO: no signInWithSSO, no SAML, no
// organization-domain discovery, no identity-provider configuration. Enterprise
// SSO is a separate later lane.
//
// SECURITY: this module never holds OAuth client secrets, service-role keys,
// tokens, or any provider credential. Supabase stores provider credentials
// server-side; the browser only needs a provider id and display metadata. The
// only build-time input is a list of provider ids.
//
// EXTENSIBILITY: adding a provider later requires ONE registry entry below --
// no new AuthScreen branch and no new auth method.

export const SOCIAL_PROVIDERS_ENV = "REACT_APP_AUTH_SOCIAL_PROVIDERS";

const SOCIAL_PROVIDER_REGISTRY = Object.freeze({
  google: Object.freeze({
    id: "google",
    name: "Google",
    label: "Continue with Google",
  }),
  apple: Object.freeze({
    id: "apple",
    name: "Apple",
    label: "Continue with Apple",
  }),
});

function normalizeProviderId(value) {
  return String(value ?? "").trim().toLowerCase();
}

// True only for ids present in the registry above.
export function isSupportedSocialProvider(providerId) {
  const normalized = normalizeProviderId(providerId);
  return Boolean(normalized) && Object.prototype.hasOwnProperty.call(SOCIAL_PROVIDER_REGISTRY, normalized);
}

// Display metadata for a supported provider, or null. Never returns secrets.
export function getSocialProvider(providerId) {
  const normalized = normalizeProviderId(providerId);
  return isSupportedSocialProvider(normalized) ? SOCIAL_PROVIDER_REGISTRY[normalized] : null;
}

// Parses REACT_APP_AUTH_SOCIAL_PROVIDERS into ordered display metadata.
//
// Missing/blank -> [] (no social buttons at all). Ids are trimmed and matched
// case-insensitively; unknown ids are ignored; duplicates are removed; the
// configured order is preserved.
export function getEnabledSocialProviders(env = process.env) {
  const raw = String(env?.[SOCIAL_PROVIDERS_ENV] ?? "").trim();
  if (!raw) return [];

  const seen = new Set();
  const enabled = [];

  raw.split(",").forEach((entry) => {
    const normalized = normalizeProviderId(entry);
    if (!normalized || seen.has(normalized)) return;
    const provider = getSocialProvider(normalized);
    if (!provider) return; // unknown id -- ignored, never surfaced
    seen.add(normalized);
    enabled.push(provider);
  });

  return enabled;
}
