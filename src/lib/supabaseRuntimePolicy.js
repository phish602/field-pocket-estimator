// Emergency Gate P1 -- fail-closed Supabase browser-runtime policy.
//
// The July 16 egress spike happened because automated Chrome repeatedly
// reloaded a Vercel-deployed build that was wired to the real hosted Supabase
// project. Gate E2 reduced redundant reads, but only this policy can make
// Preview / local / test / unknown deployments TECHNICALLY INCAPABLE of
// constructing the production Supabase browser client.
//
// There are exactly two lanes that may construct a browser client:
//
//   1. "production" -- a Vercel Production deployment carrying the explicit
//      REACT_APP_ESTIPAID_CLOUD_ENABLED=true opt-in (hosted Supabase).
//   2. "local"      -- an intentional developer machine carrying the explicit
//      REACT_APP_ESTIPAID_LOCAL_SUPABASE_ENABLED=true opt-in AND pointing at an
//      exact loopback Supabase origin (http://127.0.0.1:54321 /
//      http://localhost:54321). This lane requires that NO Vercel deployment
//      signal is present, so it can never activate in a deployed build.
//
// Everything else -- Preview, Vercel Development, unknown deployment values,
// accidental local execution, tests -- is denied.
//
// This module is pure and side-effect-free: it only reads build-time
// environment values and returns a structured decision. It never touches
// window.location, document, the browser hostname, localStorage, cookies,
// sessionStorage, query params, NODE_ENV, or the network, and there is no
// runtime switch an automated browser can flip to enable cloud access.

import { SUPABASE_URL_ENV } from "./supabaseEnv";

export const CLOUD_ENABLED_ENV = "REACT_APP_ESTIPAID_CLOUD_ENABLED";
export const LOCAL_SUPABASE_ENABLED_ENV = "REACT_APP_ESTIPAID_LOCAL_SUPABASE_ENABLED";
export const VERCEL_ENV = "REACT_APP_VERCEL_ENV";
export const VERCEL_TARGET_ENV = "REACT_APP_VERCEL_TARGET_ENV";

// The single value that counts as an explicit opt-in, AFTER trim + lowercase.
// Both the cloud and the local opt-in use this exact normalized comparison.
export const CLOUD_ENABLED_VALUE = "true";
// The single deployment/target environment allowed to reach hosted Supabase.
export const PRODUCTION_ENV = "production";

// The ONLY four textual values the local lane accepts. This is an exact-string
// allow-list, checked before any parsing: the URL parser canonicalizes many
// non-approved spellings into an approved loopback form (http://127.1:54321,
// http://2130706433:54321, http://0177.0.0.1:54321, http://0x7f000001:54321,
// http://LOCALHOST:54321, path forms like /. or /%2e, and whitespace-padded
// values), so component checks alone would silently widen the allow-list.
// A frozen array (not a Set) is used deliberately: Object.freeze genuinely
// prevents mutation of an array, while a frozen Set can still be add()-ed to.
export const AUTHORIZED_LOCAL_SUPABASE_URLS = Object.freeze([
  "http://127.0.0.1:54321",
  "http://127.0.0.1:54321/",
  "http://localhost:54321",
  "http://localhost:54321/",
]);

// Loopback only, plain http, and the standard Supabase CLI API port -- nothing
// else may be reached from a browser build, so a stray hosted URL can never
// ride in on the local opt-in.
export const LOCAL_SUPABASE_HOSTNAMES = Object.freeze(["127.0.0.1", "localhost"]);
export const LOCAL_SUPABASE_PORT = "54321";
export const LOCAL_SUPABASE_PROTOCOL = "http:";

// Stable decision lanes returned as `runtimeMode`.
export const SUPABASE_RUNTIME_MODE = {
  PRODUCTION: "production",
  LOCAL: "local",
  DENIED: "denied",
};

// Stable reason codes (never reorder/rename casually -- tests and diagnostics
// depend on them).
export const SUPABASE_RUNTIME_POLICY_REASON = {
  ALLOWED: "allowed",
  CLOUD_OPT_IN_MISSING: "cloud_opt_in_missing",
  NON_PRODUCTION_DEPLOYMENT: "non_production_deployment",
  NON_PRODUCTION_TARGET: "non_production_target",
  CONFLICTING_OPT_INS: "conflicting_opt_ins",
  LOCAL_OPT_IN_MISSING: "local_opt_in_missing",
  INVALID_LOCAL_SUPABASE_URL: "invalid_local_supabase_url",
};

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isOptedIn(value) {
  return normalize(value) === CLOUD_ENABLED_VALUE;
}

// True only for one of the four authorized local Supabase URL strings.
//
// Step 1 is an EXACT string match against the allow-list -- rawValue is not
// trimmed, lowercased, normalized, decoded, or rewritten first, because every
// such rewrite is exactly what lets an unapproved spelling canonicalize into an
// approved one.
//
// Step 2 re-validates the parsed components as defense in depth:
//   http: + (127.0.0.1 | localhost) + explicit :54321 + root path
//   + no credentials + no query + no fragment.
export function isSupportedLocalSupabaseUrl(rawValue) {
  if (typeof rawValue !== "string") return false;
  if (!AUTHORIZED_LOCAL_SUPABASE_URLS.includes(rawValue)) return false;

  const value = rawValue;

  // Reject query/fragment markers: an empty "?"/"#" tail parses away to ""
  // under the URL API, and we want it denied rather than silently ignored.
  if (value.includes("?") || value.includes("#")) return false;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== LOCAL_SUPABASE_PROTOCOL) return false;
  if (!LOCAL_SUPABASE_HOSTNAMES.includes(parsed.hostname)) return false;
  // Explicit port required -- a missing port normalizes to "" and is denied.
  if (parsed.port !== LOCAL_SUPABASE_PORT) return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;
  if (parsed.pathname !== "" && parsed.pathname !== "/") return false;

  return true;
}

// Evaluate whether a browser Supabase client may be constructed for this build.
//
// Fail-closed rules, in evaluation order:
//   - Both opt-ins set at once is a configuration error and is always denied
//     (conflicting_opt_ins), regardless of URL or deployment environment.
//   - The local lane is considered ONLY when there is no Vercel deployment
//     signal at all (both REACT_APP_VERCEL_ENV and REACT_APP_VERCEL_TARGET_ENV
//     unset). Preview, Development, Production, and any target value therefore
//     fall through to the production lane, which denies them unless they are a
//     genuine Production deployment with the cloud opt-in.
//   - Local mode additionally requires the explicit local opt-in AND an exact
//     supported loopback Supabase origin.
//   - Only a Vercel "production" deployment is eligible for hosted Supabase
//     (preview / development / unset / unknown are ALWAYS denied).
//   - If a target environment is present it must also be exactly "production".
//   - Production still requires the explicit REACT_APP_ESTIPAID_CLOUD_ENABLED
//     opt-in, whose value must equal the exact normalized "true".
//   - The cloud opt-in flag is checked LAST, so it can never rescue a
//     non-production, unset, or unknown deployment.
export function evaluateSupabaseRuntimePolicy(env = process.env) {
  const source = env || {};
  const deploymentEnvironment = normalize(source[VERCEL_ENV]);
  const targetEnvironment = normalize(source[VERCEL_TARGET_ENV]);
  const explicitlyEnabled = isOptedIn(source[CLOUD_ENABLED_ENV]);
  const localExplicitlyEnabled = isOptedIn(source[LOCAL_SUPABASE_ENABLED_ENV]);
  // Safe boolean only -- the policy result never carries URLs, keys, or any
  // other credential material.
  const isLocalSupabaseUrl = isSupportedLocalSupabaseUrl(source[SUPABASE_URL_ENV]);

  // Any Vercel-injected signal means this is a deployed build, never local.
  const hasDeploymentSignal = Boolean(deploymentEnvironment) || Boolean(targetEnvironment);

  const base = {
    deploymentEnvironment,
    targetEnvironment,
    explicitlyEnabled,
    localExplicitlyEnabled,
    isLocalSupabaseUrl,
  };

  const deny = (reason) => ({
    ...base,
    allowed: false,
    runtimeMode: SUPABASE_RUNTIME_MODE.DENIED,
    reason,
  });

  // Mutually exclusive lanes: asking for both is always a denial.
  if (explicitlyEnabled && localExplicitlyEnabled) {
    return deny(SUPABASE_RUNTIME_POLICY_REASON.CONFLICTING_OPT_INS);
  }

  // Local lane -- only reachable on a machine with no Vercel signal at all.
  if (!hasDeploymentSignal) {
    if (localExplicitlyEnabled) {
      if (!isLocalSupabaseUrl) {
        return deny(SUPABASE_RUNTIME_POLICY_REASON.INVALID_LOCAL_SUPABASE_URL);
      }
      return {
        ...base,
        allowed: true,
        runtimeMode: SUPABASE_RUNTIME_MODE.LOCAL,
        reason: SUPABASE_RUNTIME_POLICY_REASON.ALLOWED,
      };
    }

    // A loopback Supabase URL is inert without the explicit local opt-in.
    if (isLocalSupabaseUrl) {
      return deny(SUPABASE_RUNTIME_POLICY_REASON.LOCAL_OPT_IN_MISSING);
    }
    // Otherwise fall through: the production lane denies the unset deployment.
  }

  // Deployment gate: preview, development, "" (local/unset), and any unknown
  // value are denied here, and the opt-in flag below can never override this
  // decision.
  if (deploymentEnvironment !== PRODUCTION_ENV) {
    return deny(SUPABASE_RUNTIME_POLICY_REASON.NON_PRODUCTION_DEPLOYMENT);
  }

  // If Vercel also reports a target environment, it must agree with production.
  if (targetEnvironment && targetEnvironment !== PRODUCTION_ENV) {
    return deny(SUPABASE_RUNTIME_POLICY_REASON.NON_PRODUCTION_TARGET);
  }

  // Explicit opt-in is mandatory even for a production deployment.
  if (!explicitlyEnabled) {
    return deny(SUPABASE_RUNTIME_POLICY_REASON.CLOUD_OPT_IN_MISSING);
  }

  return {
    ...base,
    allowed: true,
    runtimeMode: SUPABASE_RUNTIME_MODE.PRODUCTION,
    explicitlyEnabled: true,
    reason: SUPABASE_RUNTIME_POLICY_REASON.ALLOWED,
  };
}
