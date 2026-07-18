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

// Minimum length enforced before any Supabase call is made.
export const MIN_PASSWORD_LENGTH = 6;

const AUTH_CALLBACK_PARAM_KEYS = [
  "code",
  "type",
  "state",
  "access_token",
  "refresh_token",
  "expires_at",
  "expires_in",
  "provider_token",
  "provider_refresh_token",
  "token_type",
];

// Supabase delivers a callback either as PKCE query params (?code=...&type=...)
// or as an implicit hash fragment (#access_token=...&type=recovery), so both
// have to be inspected.
function readAuthCallbackParams() {
  if (typeof window === "undefined" || !window.location) return null;
  const search = new URLSearchParams(window.location.search || "");
  const rawHash = String(window.location.hash || "").replace(/^#/, "");
  const hash = new URLSearchParams(rawHash.includes("=") ? rawHash : "");
  return { search, hash };
}

function getAuthCallbackCode() {
  const params = readAuthCallbackParams();
  if (!params) return "";
  return String(params.search.get("code") || "").trim();
}

// Password recovery is detected ONLY from an explicit `type=recovery` marker.
// A bare `code` callback (magic link, signup confirmation, OAuth) must never be
// mistaken for a password reset.
function hasPasswordRecoveryMarker() {
  const params = readAuthCallbackParams();
  if (!params) return false;
  const type = String(params.search.get("type") || params.hash.get("type") || "")
    .trim()
    .toLowerCase();
  return type === "recovery";
}

function clearAuthCallbackUrl() {
  if (typeof window === "undefined" || !window.location || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  AUTH_CALLBACK_PARAM_KEYS.forEach((key) => url.searchParams.delete(key));

  // Implicit/recovery callbacks carry their tokens in the hash fragment, so
  // strip those too -- no code or token may remain in the visible URL. Only
  // rewrite the fragment when it actually carries auth params, so ordinary
  // hash navigation is left untouched.
  const rawHash = String(url.hash || "").replace(/^#/, "");
  if (rawHash.includes("=")) {
    const hashParams = new URLSearchParams(rawHash);
    if (AUTH_CALLBACK_PARAM_KEYS.some((key) => hashParams.has(key))) {
      AUTH_CALLBACK_PARAM_KEYS.forEach((key) => hashParams.delete(key));
      const nextHash = hashParams.toString();
      url.hash = nextHash ? `#${nextHash}` : "";
    }
  }

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

  // Captured synchronously during the FIRST render -- before any effect runs and
  // before the callback params are stripped from the URL -- so the recovery
  // signal survives cleanup.
  const recoveryMarkerRef = useRef(null);
  if (recoveryMarkerRef.current === null) {
    recoveryMarkerRef.current = hasPasswordRecoveryMarker();
  }

  // `pending` = recovery INTENT (may come from a URL marker) and is enough to
  // block the dashboard while the callback is processed.
  // `ready`    = VERIFIED recovery session (only a real PASSWORD_RECOVERY event
  //              carrying a session sets this). Only `ready` authorizes an update.
  // `complete` = password updated; only explicit continuation leaves recovery.
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(recoveryMarkerRef.current);
  const [passwordRecoveryReady, setPasswordRecoveryReady] = useState(false);
  const [passwordRecoveryComplete, setPasswordRecoveryComplete] = useState(false);

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
      // Cleanup is deferred until AFTER processing has been attempted: an
      // implicit/hash callback carries its tokens in the fragment and Supabase
      // consumes them during getSession(), so stripping them earlier would
      // destroy the callback before it could be used.
      let callbackSeen = Boolean(recoveryMarkerRef.current);

      try {
        const authCode = getAuthCallbackCode();
        if (authCode && typeof client.auth.exchangeCodeForSession === "function") {
          callbackSeen = true;
          const { data, error } = await client.auth.exchangeCodeForSession(authCode);
          if (!active) return;
          if (error) {
            setErrorMessage(asMessage(error, "Unable to complete Supabase sign-in."));
          } else {
            const nextSession = data?.session || null;
            const nextUserEmail = normalizeEmail(nextSession?.user?.email);
            setSession(nextSession);
            if (nextUserEmail) setRememberedEmail(nextUserEmail);
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
        if (active) {
          setLoading(false);
          // Runs on success AND failure: a spent or rejected callback must not
          // leave a code, token, or recovery marker in the visible URL.
          if (callbackSeen) clearAuthCallbackUrl();
        }
      }
    };

    loadSession();

    const authListener = client.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      // The ONLY proof that Supabase established a real recovery session. A URL
      // marker alone expresses intent; it never authorizes a password update.
      // An event without a session leaves recovery pending-but-unverified.
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecoveryPending(true);
        if (nextSession) setPasswordRecoveryReady(true);
        // The callback has now been consumed -- strip anything still in the URL.
        clearAuthCallbackUrl();
      }
      const nextUserEmail = normalizeEmail(nextSession?.user?.email);
      const previousUserEmail = normalizeEmail(sessionRef.current?.user?.email) || rememberedEmailRef.current;
      setSession(nextSession || null);
      setLoading(false);
      if (nextSession) {
        if (nextUserEmail) setRememberedEmail(nextUserEmail);
        setErrorMessage("");
        return;
      }
      // The session is gone, so a recovery session can no longer be acted on.
      // Readiness and completion are revoked (updatePassword can no longer reach
      // updateUser), while `pending` is deliberately left alone so the gate
      // still shows the invalid/expired recovery screen rather than falling
      // through to the dashboard.
      setPasswordRecoveryReady(false);
      setPasswordRecoveryComplete(false);
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

  // Finishes password recovery. Every validation below runs BEFORE any Supabase
  // call, so an invalid submission performs zero client calls. A failure keeps
  // recovery mode active (form stays available, user is never signed out).
  const updatePassword = async (newPassword) => {
    const client = getSupabaseClient();
    const suppliedPassword = String(newPassword ?? "");

    if (!isSupabaseConfigured || !client?.auth) {
      const message = "Supabase not configured.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    // A URL marker alone never authorizes an update, and a pre-existing
    // unrelated session is not proof that the recovery callback succeeded.
    // All three must hold: recovery intent, a VERIFIED recovery session, and a
    // live session. Otherwise reject locally with zero updateUser calls.
    if (!passwordRecoveryPending || !passwordRecoveryReady || !session) {
      const message = "This password reset link is no longer valid. Request a new reset email.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    if (!suppliedPassword) {
      const message = "Enter a new password.";
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    if (suppliedPassword.length < MIN_PASSWORD_LENGTH) {
      const message = `Use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`;
      setErrorMessage(message);
      setInfoMessage("");
      return { ok: false, error: message };
    }

    setAuthBusy(true);
    setErrorMessage("");
    setInfoMessage("");

    try {
      const { error } = await client.auth.updateUser({ password: suppliedPassword });

      if (error) {
        const message = asMessage(error, "Unable to update your password.");
        setErrorMessage(message);
        return { ok: false, error: message };
      }

      setPasswordRecoveryComplete(true);
      setInfoMessage("Password updated.");
      return { ok: true };
    } catch (error) {
      const message = asMessage(error, "Unable to update your password.");
      setErrorMessage(message);
      return { ok: false, error: message };
    } finally {
      setAuthBusy(false);
    }
  };

  // The ONLY way out of a SUCCESSFUL recovery -- an explicit user continuation.
  const completePasswordRecovery = useCallback(() => {
    recoveryMarkerRef.current = false;
    setPasswordRecoveryPending(false);
    setPasswordRecoveryReady(false);
    setPasswordRecoveryComplete(false);
    setErrorMessage("");
    setInfoMessage("");
  }, []);

  // Releases the recovery gate as one transition, only once there is provably
  // no session left to protect.
  const releaseRecoveryGate = () => {
    recoveryMarkerRef.current = false;
    setPasswordRecoveryPending(false);
    setPasswordRecoveryReady(false);
    setPasswordRecoveryComplete(false);
    setErrorMessage("");
    setInfoMessage("");
  };

  // Escape hatch for an invalid/expired recovery so the user is never trapped.
  // The recovery gate stays ACTIVE for the entire sign-out attempt: clearing
  // `pending` before the session is gone would briefly expose the dashboard and
  // re-enable account lookup, device lock, convergence, and automatic backup.
  // It never calls updateUser.
  const abandonPasswordRecovery = async () => {
    const client = getSupabaseClient();

    // Nothing to sign out -- return straight to normal sign-in.
    if (!session || !isSupabaseConfigured || !client?.auth?.signOut) {
      setSession(null);
      releaseRecoveryGate();
      return { ok: true };
    }

    setAuthBusy(true);
    setErrorMessage("");
    setInfoMessage("");

    try {
      // Both failure forms must keep the gate closed: a resolved { error } and
      // a thrown exception.
      const { error } = (await client.auth.signOut()) || {};
      if (error) {
        const message = asMessage(error, "Unable to sign out.");
        setErrorMessage(message);
        return { ok: false, error: message };
      }
    } catch (error) {
      const message = asMessage(error, "Unable to sign out.");
      setErrorMessage(message);
      return { ok: false, error: message };
    } finally {
      setAuthBusy(false);
    }

    // Sign-out succeeded: drop the session and release the gate together, so no
    // render ever sees a live session with the gate already open.
    setSession(null);
    releaseRecoveryGate();
    return { ok: true };
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
    passwordRecoveryPending,
    passwordRecoveryReady,
    passwordRecoveryComplete,
    updatePassword,
    completePasswordRecovery,
    abandonPasswordRecovery,
  };
}
