import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./supabaseEnv";
import { evaluateSupabaseRuntimePolicy } from "./supabaseRuntimePolicy";

export const supabaseEnv = getSupabaseEnv();

// Emergency Gate P1: the single choke point for browser Supabase-client
// construction. Even when a valid URL + anon key are present in the build -- a
// Vercel Preview that inherited Production env vars, local dev, a test, or an
// unknown deployment -- the client is built ONLY when the fail-closed runtime
// policy allows it. Exactly two lanes qualify:
//
//   - runtimeMode "production": a Vercel Production deployment carrying the
//     explicit REACT_APP_ESTIPAID_CLOUD_ENABLED=true opt-in (hosted Supabase).
//   - runtimeMode "local": an intentional developer machine with no Vercel
//     signal at all, carrying REACT_APP_ESTIPAID_LOCAL_SUPABASE_ENABLED=true
//     and an exact loopback Supabase origin (http://127.0.0.1:54321 or
//     http://localhost:54321) -- never hosted Supabase.
//
// Preview / Vercel development / unset-with-hosted-URL / unknown / conflicting
// opt-ins can never construct a client, so automated Chrome cannot generate
// hosted PostgREST/Auth egress no matter what credentials leak in.
export const supabaseRuntimePolicy = evaluateSupabaseRuntimePolicy();

// Configured requires ALL of: valid URL, valid anon key, AND policy.allowed.
export const isSupabaseConfigured = supabaseEnv.isConfigured && supabaseRuntimePolicy.allowed;

// When not configured, `createClient` is never called and no client is retained
// (no lazy fallback, no network probe, no runtime switch) -- a denied policy
// yields a hard null. The auth options below are identical in both permitted
// lanes (Vercel Production hosted Supabase and loopback-only local Supabase).
export const supabase = isSupabaseConfigured
  ? createClient(supabaseEnv.url, supabaseEnv.anonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null;

export function getSupabaseClient() {
  return supabase;
}
