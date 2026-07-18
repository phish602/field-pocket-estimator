import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./supabaseEnv";
import { evaluateSupabaseRuntimePolicy } from "./supabaseRuntimePolicy";

export const supabaseEnv = getSupabaseEnv();

// Emergency Gate P1: the single choke point for browser Supabase-client
// construction. Even when a valid production URL + anon key are present in the
// build -- a Vercel Preview that inherited Production env vars, local dev, a
// test, or an unknown deployment -- the client is built ONLY when the
// fail-closed runtime policy allows it (a Production deployment carrying the
// explicit REACT_APP_ESTIPAID_CLOUD_ENABLED=true opt-in). Preview / development
// / unset / unknown can never construct a client, so automated Chrome cannot
// generate hosted PostgREST/Auth egress no matter what credentials leak in.
export const supabaseRuntimePolicy = evaluateSupabaseRuntimePolicy();

// Configured requires ALL of: valid URL, valid anon key, AND policy.allowed.
export const isSupabaseConfigured = supabaseEnv.isConfigured && supabaseRuntimePolicy.allowed;

// When not configured, `createClient` is never called and no client is retained
// (no lazy fallback, no network probe) -- a denied policy yields a hard null.
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
