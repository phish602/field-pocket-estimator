// Emergency Gate P1 -- fail-closed Supabase browser-runtime policy.
//
// The July 16 egress spike happened because automated Chrome repeatedly
// reloaded a Vercel-deployed build that was wired to the real hosted Supabase
// project. Gate E2 reduced redundant reads, but only this policy can make
// Preview / local / test / unknown deployments TECHNICALLY INCAPABLE of
// constructing the production Supabase browser client.
//
// This module is pure and side-effect-free: it only reads environment values
// and returns a structured decision. It never touches localStorage, cookies,
// query params, the URL/hostname, NODE_ENV, or the network, and there is no
// runtime switch an automated browser can flip to enable cloud access.

export const CLOUD_ENABLED_ENV = "REACT_APP_ESTIPAID_CLOUD_ENABLED";
export const VERCEL_ENV = "REACT_APP_VERCEL_ENV";
export const VERCEL_TARGET_ENV = "REACT_APP_VERCEL_TARGET_ENV";

// The single value that counts as an explicit opt-in, AFTER trim + lowercase.
export const CLOUD_ENABLED_VALUE = "true";
// The single deployment/target environment allowed to reach hosted Supabase.
export const PRODUCTION_ENV = "production";

// Stable reason codes (never reorder/rename casually -- tests and diagnostics
// depend on them).
export const SUPABASE_RUNTIME_POLICY_REASON = {
  ALLOWED: "allowed",
  CLOUD_OPT_IN_MISSING: "cloud_opt_in_missing",
  NON_PRODUCTION_DEPLOYMENT: "non_production_deployment",
  NON_PRODUCTION_TARGET: "non_production_target",
};

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

// Evaluate whether a browser Supabase client may be constructed for this build.
//
// Fail-closed rules:
//   - Only a Vercel "production" deployment is eligible (preview / development /
//     unset / unknown are ALWAYS denied).
//   - If a target environment is present it must also be exactly "production".
//   - Production still requires the explicit REACT_APP_ESTIPAID_CLOUD_ENABLED
//     opt-in, whose value must equal the exact normalized "true".
//   - The opt-in flag is checked LAST, so it can never rescue a non-production,
//     unset, or unknown deployment.
export function evaluateSupabaseRuntimePolicy(env = process.env) {
  const source = env || {};
  const deploymentEnvironment = normalize(source[VERCEL_ENV]);
  const targetEnvironment = normalize(source[VERCEL_TARGET_ENV]);
  const explicitlyEnabled = normalize(source[CLOUD_ENABLED_ENV]) === CLOUD_ENABLED_VALUE;

  const deny = (reason) => ({
    allowed: false,
    deploymentEnvironment,
    targetEnvironment,
    explicitlyEnabled,
    reason,
  });

  // Deployment gate first: preview, development, "" (local/unset), and any
  // unknown value are denied here, and the opt-in flag below can never override
  // this decision.
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
    allowed: true,
    deploymentEnvironment,
    targetEnvironment,
    explicitlyEnabled: true,
    reason: SUPABASE_RUNTIME_POLICY_REASON.ALLOWED,
  };
}
