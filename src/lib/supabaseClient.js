import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./supabaseEnv";

export const supabaseEnv = getSupabaseEnv();
export const isSupabaseConfigured = supabaseEnv.isConfigured;

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
