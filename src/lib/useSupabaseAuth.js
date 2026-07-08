import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured, supabaseEnv } from "./supabaseClient";

function asMessage(error, fallback) {
  const message = String(error?.message || "").trim();
  return message || fallback;
}

function getRedirectUrl() {
  if (typeof window === "undefined" || !window.location) return undefined;
  return window.location.origin || undefined;
}

function getAuthCallbackCode() {
  if (typeof window === "undefined" || !window.location) return "";
  const params = new URLSearchParams(window.location.search || "");
  return String(params.get("code") || "").trim();
}

function clearAuthCallbackUrl() {
  if (typeof window === "undefined" || !window.location || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("type");
  url.searchParams.delete("state");
  url.searchParams.delete("access_token");
  url.searchParams.delete("refresh_token");
  url.searchParams.delete("expires_at");
  url.searchParams.delete("expires_in");
  url.searchParams.delete("provider_token");
  url.searchParams.delete("provider_refresh_token");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, document.title, next || "/");
}

export default function useSupabaseAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [authBusy, setAuthBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [rememberedEmail, setRememberedEmail] = useState("");
  const sessionRef = useRef(null);
  const rememberedEmailRef = useRef("");

  const normalizeEmail = useCallback((value) => String(value || "").trim(), []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    rememberedEmailRef.current = rememberedEmail;
  }, [rememberedEmail]);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!isSupabaseConfigured || !client?.auth) {
      setLoading(false);
      return undefined;
    }

    let active = true;

    const loadSession = async () => {
      try {
        const authCode = getAuthCallbackCode();
        if (authCode && typeof client.auth.exchangeCodeForSession === "function") {
          const { data, error } = await client.auth.exchangeCodeForSession(authCode);
          if (!active) return;
          if (error) {
            setErrorMessage(asMessage(error, "Unable to complete Supabase sign-in."));
          } else {
            const nextSession = data?.session || null;
            const nextUserEmail = normalizeEmail(nextSession?.user?.email);
            setSession(nextSession);
            if (nextUserEmail) setRememberedEmail(nextUserEmail);
            clearAuthCallbackUrl();
          }
        }

        const { data, error } = await client.auth.getSession();
        if (!active) return;
        if (error) {
          setErrorMessage(asMessage(error, "Unable to read Supabase session."));
        } else {
          const nextSession = data?.session || null;
          const nextUserEmail = normalizeEmail(nextSession?.user?.email);
          setSession(nextSession);
          if (nextUserEmail) setRememberedEmail(nextUserEmail);
        }
      } catch (error) {
        if (!active) return;
        setErrorMessage(asMessage(error, "Unable to read Supabase session."));
      } finally {
        if (active) setLoading(false);
      }
    };

    loadSession();

    const authListener = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      const nextUserEmail = normalizeEmail(nextSession?.user?.email);
      const previousUserEmail = normalizeEmail(sessionRef.current?.user?.email) || rememberedEmailRef.current;
      setSession(nextSession || null);
      setLoading(false);
      if (nextSession) {
        if (nextUserEmail) setRememberedEmail(nextUserEmail);
        setErrorMessage("");
        return;
      }
      if (previousUserEmail) setRememberedEmail(previousUserEmail);
      setErrorMessage("");
      setInfoMessage("");
    });

    const subscription = authListener?.data?.subscription || authListener?.subscription || null;

    return () => {
      active = false;
      subscription?.unsubscribe?.();
    };
  }, [normalizeEmail]);

  const signInWithEmailOtp = async (email) => {
    const client = getSupabaseClient();
    const normalizedEmail = String(email || "").trim();

    if (!isSupabaseConfigured || !client?.auth) {
      const message = "Supabase not configured.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    if (!normalizedEmail) {
      const message = "Enter an email address to sign in.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    setAuthBusy(true);
    setErrorMessage("");
    setInfoMessage("");

    try {
      const redirectTo = getRedirectUrl();
      const { error } = await client.auth.signInWithOtp({
        email: normalizedEmail,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });

      if (error) {
        const message = asMessage(error, "Unable to send sign-in link.");
        setErrorMessage(message);
        return { ok: false, error: message };
      }

      const message = `Check ${normalizedEmail} for your sign-in link.`;
      setRememberedEmail(normalizedEmail);
      setInfoMessage(message);
      return { ok: true };
    } catch (error) {
      const message = asMessage(error, "Unable to send sign-in link.");
      setErrorMessage(message);
      return { ok: false, error: message };
    } finally {
      setAuthBusy(false);
    }
  };

  const signInWithPassword = async (email, password) => {
    const client = getSupabaseClient();
    const normalizedEmail = String(email || "").trim();
    const suppliedPassword = String(password ?? "");

    if (!isSupabaseConfigured || !client?.auth) {
      const message = "Supabase not configured.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    if (!normalizedEmail) {
      const message = "Enter an email address to sign in.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    if (!suppliedPassword) {
      const message = "Enter your password to sign in.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    setAuthBusy(true);
    setErrorMessage("");
    setInfoMessage("");

    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: normalizedEmail,
        password: suppliedPassword,
      });

      if (error) {
        const message = asMessage(error, "Unable to sign in with password.");
        setErrorMessage(message);
        return { ok: false, error: message };
      }

      const nextSession = data?.session || null;
      const nextUser = data?.user || nextSession?.user || null;
      const nextUserEmail = normalizeEmail(nextUser?.email || normalizedEmail);
      setSession(nextSession);
      if (nextUserEmail) setRememberedEmail(nextUserEmail);
      setInfoMessage(nextUserEmail ? `Signed in as ${nextUserEmail}.` : "Signed in.");
      return { ok: true, session: nextSession, user: nextUser };
    } catch (error) {
      const message = asMessage(error, "Unable to sign in with password.");
      setErrorMessage(message);
      return { ok: false, error: message };
    } finally {
      setAuthBusy(false);
    }
  };

  const signUpWithPassword = async (email, password) => {
    const client = getSupabaseClient();
    const normalizedEmail = String(email || "").trim();
    const suppliedPassword = String(password ?? "");

    if (!isSupabaseConfigured || !client?.auth) {
      const message = "Supabase not configured.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    if (!normalizedEmail) {
      const message = "Enter an email address to create an account.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    if (!suppliedPassword) {
      const message = "Enter a password to create an account.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    setAuthBusy(true);
    setErrorMessage("");
    setInfoMessage("");

    try {
      const redirectTo = getRedirectUrl();
      const { data, error } = await client.auth.signUp({
        email: normalizedEmail,
        password: suppliedPassword,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });

      if (error) {
        const message = asMessage(error, "Unable to create account.");
        setErrorMessage(message);
        return { ok: false, error: message };
      }

      const nextSession = data?.session || null;
      const nextUser = data?.user || nextSession?.user || null;
      if (normalizedEmail) setRememberedEmail(normalizedEmail);
      if (nextSession) {
        setSession(nextSession);
        setInfoMessage(normalizedEmail ? `Account created. Signed in as ${normalizedEmail}.` : "Account created.");
      } else {
        setInfoMessage(`Check ${normalizedEmail} to confirm your account.`);
      }
      return { ok: true, session: nextSession, user: nextUser };
    } catch (error) {
      const message = asMessage(error, "Unable to create account.");
      setErrorMessage(message);
      return { ok: false, error: message };
    } finally {
      setAuthBusy(false);
    }
  };

  const resetPasswordForEmail = async (email) => {
    const client = getSupabaseClient();
    const normalizedEmail = String(email || "").trim();

    if (!isSupabaseConfigured || !client?.auth) {
      const message = "Supabase not configured.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    if (!normalizedEmail) {
      const message = "Enter an email address to reset your password.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    setAuthBusy(true);
    setErrorMessage("");
    setInfoMessage("");

    try {
      const redirectTo = getRedirectUrl();
      const { error } = await client.auth.resetPasswordForEmail(
        normalizedEmail,
        redirectTo ? { redirectTo } : undefined
      );

      if (error) {
        const message = asMessage(error, "Unable to send password reset email.");
        setErrorMessage(message);
        return { ok: false, error: message };
      }

      const message = `Check ${normalizedEmail} for a password reset link.`;
      setInfoMessage(message);
      return { ok: true };
    } catch (error) {
      const message = asMessage(error, "Unable to send password reset email.");
      setErrorMessage(message);
      return { ok: false, error: message };
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    const client = getSupabaseClient();

    if (!isSupabaseConfigured || !client?.auth) {
      const message = "Supabase not configured.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    setAuthBusy(true);
    setErrorMessage("");
    setInfoMessage("");

    try {
      const { error } = await client.auth.signOut();
      if (error) {
        const message = asMessage(error, "Unable to sign out.");
        setErrorMessage(message);
        return { ok: false, error: message };
      }
      const nextRememberedEmail = normalizeEmail(sessionRef.current?.user?.email) || rememberedEmailRef.current;
      setSession(null);
      if (nextRememberedEmail) setRememberedEmail(nextRememberedEmail);
      setInfoMessage("");
      return { ok: true };
    } catch (error) {
      const message = asMessage(error, "Unable to sign out.");
      setErrorMessage(message);
      return { ok: false, error: message };
    } finally {
      setAuthBusy(false);
    }
  };

  const clearRememberedAccount = useCallback(() => {
    setRememberedEmail("");
    setErrorMessage("");
    setInfoMessage("");
  }, []);

  const user = session?.user || null;
  const userEmail = normalizeEmail(user?.email);

  return {
    configured: isSupabaseConfigured,
    missingEnvKeys: Array.isArray(supabaseEnv?.missingKeys) ? [...supabaseEnv.missingKeys] : [],
    loading,
    authBusy,
    session,
    user,
    userEmail,
    rememberedEmail,
    errorMessage,
    infoMessage,
    signInWithEmailOtp,
    signInWithPassword,
    signUpWithPassword,
    resetPasswordForEmail,
    signOut,
    clearRememberedAccount,
  };
}
