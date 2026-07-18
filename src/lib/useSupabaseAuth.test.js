import { act, renderHook, waitFor } from "@testing-library/react";

const mockGetSupabaseClient = jest.fn();
let mockIsSupabaseConfigured = true;
let mockSupabaseEnv = {
  url: "https://example.supabase.co",
  anonKey: "sb_publishable_fake_test_key",
  isConfigured: true,
  missingKeys: [],
};

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
  get isSupabaseConfigured() {
    return mockIsSupabaseConfigured;
  },
  get supabaseEnv() {
    return mockSupabaseEnv;
  },
}));

const useSupabaseAuth = require("./useSupabaseAuth").default;

function createMockClient({
  session = null,
  signInError = null,
  passwordSignInError = null,
  passwordSignInSession = null,
  passwordSignInUser = null,
  signOutError = null,
  getSessionError = null,
  exchangeSession = null,
  exchangeError = null,
  signUpError = null,
  signUpSession = null,
  signUpUser = null,
  resetPasswordError = null,
  updateUserError = null,
} = {}) {
  let authListener = null;
  const subscription = { unsubscribe: jest.fn() };

  const client = {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session },
        error: getSessionError,
      })),
      onAuthStateChange: jest.fn((callback) => {
        authListener = callback;
        return { data: { subscription } };
      }),
      signInWithOtp: jest.fn(async () => ({
        data: {},
        error: signInError,
      })),
      signInWithPassword: jest.fn(async () => ({
        data: {
          session: passwordSignInSession,
          user: passwordSignInUser || passwordSignInSession?.user || null,
        },
        error: passwordSignInError,
      })),
      signUp: jest.fn(async () => ({
        data: {
          session: signUpSession,
          user: signUpUser || signUpSession?.user || null,
        },
        error: signUpError,
      })),
      resetPasswordForEmail: jest.fn(async () => ({
        data: {},
        error: resetPasswordError,
      })),
      exchangeCodeForSession: jest.fn(async () => ({
        data: { session: exchangeSession },
        error: exchangeError,
      })),
      signOut: jest.fn(async () => ({
        error: signOutError,
      })),
      updateUser: jest.fn(async () => ({
        data: { user: { id: "user_1" } },
        error: updateUserError,
      })),
    },
  };

  return {
    client,
    subscription,
    emitAuthStateChange(event, nextSession) {
      authListener?.(event, nextSession);
    },
  };
}

describe("useSupabaseAuth", () => {
  beforeEach(() => {
    mockIsSupabaseConfigured = true;
    mockSupabaseEnv = {
      url: "https://example.supabase.co",
      anonKey: "sb_publishable_fake_test_key",
      isConfigured: true,
      missingKeys: [],
    };
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(null);
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  test("fails safely when the Supabase client is unavailable", async () => {
    const { result } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.configured).toBe(true);
    expect(result.current.session).toBeNull();
    expect(result.current.userEmail).toBe("");

    await act(async () => {
      await result.current.signInWithEmailOtp("owner@example.com");
    });

    expect(result.current.errorMessage).toBe("Supabase not configured.");
  });

  test("loads the current session and listens for auth state changes", async () => {
    const initialSession = { user: { email: "owner@example.com" } };
    const nextSession = { user: { email: "crew@example.com" } };
    const mock = createMockClient({ session: initialSession });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result, unmount } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mock.client.auth.getSession).toHaveBeenCalledTimes(1);
    expect(result.current.userEmail).toBe("owner@example.com");

    act(() => {
      mock.emitAuthStateChange("SIGNED_IN", nextSession);
    });

    expect(result.current.userEmail).toBe("crew@example.com");

    unmount();
    expect(mock.subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("exchanges callback code for session and clears the callback URL", async () => {
    const exchangedSession = { user: { id: "user_1", email: "owner@example.com" } };
    const mock = createMockClient({
      session: exchangedSession,
      exchangeSession: exchangedSession,
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    window.history.pushState({}, "", "/?code=callback-code&type=magiclink");
    const replaceStateSpy = jest.spyOn(window.history, "replaceState");

    const { result } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.userEmail).toBe("owner@example.com");
    });

    expect(mock.client.auth.exchangeCodeForSession).toHaveBeenCalledWith("callback-code");
    expect(mock.client.auth.getSession).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  test("reports callback exchange failure safely and keeps sign-in available", async () => {
    const mock = createMockClient({
      session: null,
      exchangeError: { message: "invalid or expired code" },
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    window.history.pushState({}, "", "/?code=bad-code&type=magiclink");

    const { result } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.errorMessage).toBe("invalid or expired code");
    });

    expect(mock.client.auth.exchangeCodeForSession).toHaveBeenCalledWith("bad-code");
    expect(result.current.session).toBeNull();
    // A rejected callback must not leave the spent code in the visible URL.
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain("bad-code");
  });

  test("signs in with password without storing the password locally", async () => {
    const signedInSession = { user: { id: "user_2", email: "owner@example.com" } };
    const mock = createMockClient({
      session: null,
      passwordSignInSession: signedInSession,
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

    const { result } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.signInWithPassword("owner@example.com", "super-secret-password");
    });

    expect(mock.client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "super-secret-password",
    });
    expect(result.current.userEmail).toBe("owner@example.com");
    expect(result.current.infoMessage).toBe("Signed in as owner@example.com.");
    expect(result.current.rememberedEmail).toBe("owner@example.com");
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  test("shows a clear password sign-in error and keeps the session empty on failure", async () => {
    const mock = createMockClient({
      session: null,
      passwordSignInError: { message: "Invalid login credentials" },
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.signInWithPassword("owner@example.com", "wrong-password");
    });

    expect(result.current.session).toBeNull();
    expect(result.current.errorMessage).toBe("Invalid login credentials");
  });

  test("sends magic-link sign-in requests and signs out through Supabase auth only", async () => {
    const initialSession = { user: { email: "owner@example.com" } };
    const mock = createMockClient({ session: initialSession });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.signInWithEmailOtp("signin@example.com");
    });

    expect(mock.client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "signin@example.com",
      options: { emailRedirectTo: window.location.origin },
    });
    expect(result.current.infoMessage).toContain("signin@example.com");

    await act(async () => {
      await result.current.signOut();
    });

    expect(mock.client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(result.current.session).toBeNull();
    expect(result.current.infoMessage).toBe("");
    expect(result.current.rememberedEmail).toBe("owner@example.com");
  });

  test("clears stale signed-in copy after auth state changes to signed out", async () => {
    const initialSession = { user: { email: "owner@example.com" } };
    const mock = createMockClient({ session: initialSession });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.userEmail).toBe("owner@example.com");
    });

    await act(async () => {
      await result.current.signInWithPassword("owner@example.com", "correct-password");
    });

    expect(result.current.infoMessage).toBe("Signed in as owner@example.com.");

    act(() => {
      mock.emitAuthStateChange("SIGNED_OUT", null);
    });

    expect(result.current.session).toBeNull();
    expect(result.current.userEmail).toBe("");
    expect(result.current.infoMessage).toBe("");
    expect(result.current.rememberedEmail).toBe("owner@example.com");
  });

  test("creates an account with password and signs in immediately when a session is returned", async () => {
    const newSession = { user: { id: "user_3", email: "new@example.com" } };
    const mock = createMockClient({ session: null, signUpSession: newSession });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.signUpWithPassword("new@example.com", "new-password");
    });

    expect(mock.client.auth.signUp).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "new-password",
      options: { emailRedirectTo: window.location.origin },
    });
    expect(result.current.userEmail).toBe("new@example.com");
    expect(result.current.errorMessage).toBe("");
  });

  test("shows a clear error when account creation fails", async () => {
    const mock = createMockClient({
      session: null,
      signUpError: { message: "User already registered" },
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.signUpWithPassword("owner@example.com", "some-password");
    });

    expect(result.current.session).toBeNull();
    expect(result.current.errorMessage).toBe("User already registered");
  });

  test("sends a password reset email and reports a readable confirmation", async () => {
    const mock = createMockClient({ session: null });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.resetPasswordForEmail("owner@example.com");
    });

    expect(mock.client.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "owner@example.com",
      { redirectTo: window.location.origin }
    );
    expect(result.current.infoMessage).toContain("owner@example.com");
  });

  test("shows a clear error when the password reset email fails to send", async () => {
    const mock = createMockClient({
      session: null,
      resetPasswordError: { message: "Email rate limit exceeded" },
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAuth());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.resetPasswordForEmail("owner@example.com");
    });

    expect(result.current.errorMessage).toBe("Email rate limit exceeded");
  });
});

// Phase 2.1 -- password-recovery completion.
describe("useSupabaseAuth password recovery", () => {
  beforeEach(() => {
    mockIsSupabaseConfigured = true;
    mockSupabaseEnv = {
      url: "https://example.supabase.co",
      anonKey: "sb_publishable_fake_test_key",
      isConfigured: true,
      missingKeys: [],
    };
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(null);
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  const RECOVERY_SESSION = { user: { id: "user_1", email: "owner@example.com" } };

  // Mounts with recovery intent and then verifies it with a real event.
  async function mountVerifiedRecovery(clientOverrides = {}) {
    const mock = createMockClient({ session: RECOVERY_SESSION, ...clientOverrides });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    window.history.pushState({}, "", "/?type=recovery");

    const { result } = renderHook(() => useSupabaseAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      mock.emitAuthStateChange("PASSWORD_RECOVERY", RECOVERY_SESSION);
    });

    return { mock, result };
  }

  test("PASSWORD_RECOVERY with a session sets both pending and ready", async () => {
    const mock = createMockClient({ session: null });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.passwordRecoveryPending).toBe(false);
    expect(result.current.passwordRecoveryReady).toBe(false);

    act(() => {
      mock.emitAuthStateChange("PASSWORD_RECOVERY", RECOVERY_SESSION);
    });

    expect(result.current.passwordRecoveryPending).toBe(true);
    expect(result.current.passwordRecoveryReady).toBe(true);
    expect(result.current.passwordRecoveryComplete).toBe(false);
  });

  test("PASSWORD_RECOVERY WITHOUT a session never becomes ready", async () => {
    const mock = createMockClient({ session: null });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      mock.emitAuthStateChange("PASSWORD_RECOVERY", null);
    });

    expect(result.current.passwordRecoveryPending).toBe(true);
    expect(result.current.passwordRecoveryReady).toBe(false);

    await act(async () => {
      await result.current.updatePassword("brand-new-password");
    });
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
  });

  test("a type=recovery marker alone sets intent but cannot authorize updateUser", async () => {
    const mock = createMockClient({ session: null });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    window.history.pushState({}, "", "/?type=recovery");

    const { result } = renderHook(() => useSupabaseAuth());
    expect(result.current.passwordRecoveryPending).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Intent only -- never verified.
    expect(result.current.passwordRecoveryReady).toBe(false);

    await act(async () => {
      await result.current.updatePassword("brand-new-password");
    });

    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toMatch(/no longer valid/i);
  });

  test("a pre-existing unrelated session plus a forged recovery marker cannot authorize updateUser", async () => {
    // Someone is already signed in, then opens a forged/expired recovery URL.
    const mock = createMockClient({ session: { user: { id: "user_9", email: "someone@example.com" } } });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    window.history.pushState({}, "", "/?type=recovery");

    const { result } = renderHook(() => useSupabaseAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // A session exists, but no PASSWORD_RECOVERY event ever arrived.
    expect(result.current.session).not.toBeNull();
    expect(result.current.passwordRecoveryPending).toBe(true);
    expect(result.current.passwordRecoveryReady).toBe(false);

    await act(async () => {
      await result.current.updatePassword("brand-new-password");
    });

    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
  });

  // Recovery INTENT plus a pre-existing session, never verified.
  async function mountUnverifiedRecoveryWithSession(clientOverrides = {}) {
    const mock = createMockClient({
      session: { user: { id: "user_9", email: "someone@example.com" } },
      ...clientOverrides,
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    window.history.pushState({}, "", "/?type=recovery");

    const { result } = renderHook(() => useSupabaseAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    return { mock, result };
  }

  test("a deferred sign-out keeps the recovery gate active until it resolves", async () => {
    const { mock, result } = await mountUnverifiedRecoveryWithSession();

    let resolveSignOut;
    mock.client.auth.signOut = jest.fn(
      () => new Promise((resolve) => {
        resolveSignOut = () => resolve({ error: null });
      })
    );

    let abandonPromise;
    await act(async () => {
      abandonPromise = result.current.abandonPasswordRecovery();
      await Promise.resolve();
    });

    // Mid-flight: the session still exists, so the gate MUST still be closed --
    // otherwise the dashboard and every cloud worker would come back to life.
    expect(mock.client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(result.current.passwordRecoveryPending).toBe(true);
    expect(result.current.session).not.toBeNull();

    await act(async () => {
      resolveSignOut();
      await abandonPromise;
    });

    // Only after a successful sign-out: session gone AND gate released.
    expect(result.current.session).toBeNull();
    expect(result.current.passwordRecoveryPending).toBe(false);
    expect(result.current.passwordRecoveryReady).toBe(false);
    expect(result.current.passwordRecoveryComplete).toBe(false);
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
  });

  test("a returned sign-out { error } keeps recovery gated and allows a retry", async () => {
    const { mock, result } = await mountUnverifiedRecoveryWithSession({
      signOutError: { message: "Network request failed" },
    });

    let outcome;
    await act(async () => {
      outcome = await result.current.abandonPasswordRecovery();
    });

    expect(outcome).toEqual({ ok: false, error: "Network request failed" });
    expect(result.current.errorMessage).toBe("Network request failed");
    // Gate stays closed with the session intact -- no dashboard, no workers.
    expect(result.current.passwordRecoveryPending).toBe(true);
    expect(result.current.session).not.toBeNull();
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();

    // Retry is possible and succeeds.
    mock.client.auth.signOut = jest.fn(async () => ({ error: null }));
    await act(async () => {
      outcome = await result.current.abandonPasswordRecovery();
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.passwordRecoveryPending).toBe(false);
    expect(result.current.session).toBeNull();
  });

  test("a THROWN sign-out error keeps recovery gated the same way", async () => {
    const { mock, result } = await mountUnverifiedRecoveryWithSession();
    mock.client.auth.signOut = jest.fn(async () => {
      throw new Error("boom");
    });

    let outcome;
    await act(async () => {
      outcome = await result.current.abandonPasswordRecovery();
    });

    expect(outcome).toEqual({ ok: false, error: "boom" });
    expect(result.current.errorMessage).toBe("boom");
    expect(result.current.passwordRecoveryPending).toBe(true);
    expect(result.current.session).not.toBeNull();
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
  });

  test("abandoning with NO session clears recovery without calling signOut", async () => {
    const mock = createMockClient({ session: null });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    window.history.pushState({}, "", "/?type=recovery");

    const { result } = renderHook(() => useSupabaseAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();

    let outcome;
    await act(async () => {
      outcome = await result.current.abandonPasswordRecovery();
    });

    expect(outcome).toEqual({ ok: true });
    expect(mock.client.auth.signOut).not.toHaveBeenCalled();
    expect(result.current.passwordRecoveryPending).toBe(false);
    expect(result.current.passwordRecoveryReady).toBe(false);
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
  });

  test("a SIGNED_OUT event revokes a verified recovery and blocks updateUser", async () => {
    const { mock, result } = await mountVerifiedRecovery();
    expect(result.current.passwordRecoveryReady).toBe(true);

    act(() => {
      mock.emitAuthStateChange("SIGNED_OUT", null);
    });

    // No longer actionable, but still gated so the invalid/expired screen shows.
    expect(result.current.passwordRecoveryReady).toBe(false);
    expect(result.current.passwordRecoveryComplete).toBe(false);
    expect(result.current.passwordRecoveryPending).toBe(true);
    expect(result.current.session).toBeNull();

    await act(async () => {
      await result.current.updatePassword("brand-new-password");
    });
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
  });

  test("an explicit type=recovery query marker is captured before the callback URL is cleaned", async () => {
    const recoverySession = { user: { id: "user_1", email: "owner@example.com" } };
    const mock = createMockClient({ session: recoverySession, exchangeSession: recoverySession });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    window.history.pushState({}, "", "/?code=recovery-code&type=recovery");

    const { result } = renderHook(() => useSupabaseAuth());

    // Captured synchronously on the first render, before any cleanup.
    expect(result.current.passwordRecoveryPending).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Requirement 10: no code or token may remain in the visible URL.
    expect(window.location.search).toBe("");
    expect(result.current.passwordRecoveryPending).toBe(true);
  });

  test("hash tokens survive until Supabase has processed them, then are cleared", async () => {
    let hashDuringProcessing = null;
    const mock = createMockClient({ session: { user: { email: "owner@example.com" } } });
    // Capture the URL at the moment Supabase reads the session -- the implicit
    // tokens must still be present for it to consume them.
    mock.client.auth.getSession = jest.fn(async () => {
      hashDuringProcessing = window.location.hash;
      return { data: { session: { user: { email: "owner@example.com" } } }, error: null };
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    window.history.pushState({}, "", "/#access_token=tok123&type=recovery&expires_in=3600");

    const { result } = renderHook(() => useSupabaseAuth());
    expect(result.current.passwordRecoveryPending).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(hashDuringProcessing).toContain("access_token=tok123");
    expect(hashDuringProcessing).toContain("type=recovery");
    // Cleared only afterwards.
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("access_token");
  });

  test("ordinary non-auth hash navigation is left untouched", async () => {
    const mock = createMockClient({ session: null });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    window.history.pushState({}, "", "/?code=callback-code#section-two");

    const { result } = renderHook(() => useSupabaseAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#section-two");
  });

  test("a PASSWORD_RECOVERY event clears any remaining callback parameters", async () => {
    const mock = createMockClient({ session: null });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Params arrive after the initial load (e.g. a later in-page callback).
    window.history.pushState({}, "", "/?type=recovery&access_token=tok999");

    act(() => {
      mock.emitAuthStateChange("PASSWORD_RECOVERY", RECOVERY_SESSION);
    });

    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain("tok999");
    expect(result.current.passwordRecoveryReady).toBe(true);
  });

  test("an ordinary code callback does NOT activate recovery mode", async () => {
    const exchangedSession = { user: { id: "user_1", email: "owner@example.com" } };
    const mock = createMockClient({ session: exchangedSession, exchangeSession: exchangedSession });
    mockGetSupabaseClient.mockReturnValue(mock.client);
    window.history.pushState({}, "", "/?code=callback-code&type=magiclink");

    const { result } = renderHook(() => useSupabaseAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.passwordRecoveryPending).toBe(false);
    expect(mock.client.auth.exchangeCodeForSession).toHaveBeenCalledWith("callback-code");
  });

  test("updateUser is called exactly once and marks recovery complete without leaving recovery mode", async () => {
    const { mock, result } = await mountVerifiedRecovery();

    await act(async () => {
      await result.current.updatePassword("brand-new-password");
    });

    expect(mock.client.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(mock.client.auth.updateUser).toHaveBeenCalledWith({ password: "brand-new-password" });
    expect(result.current.passwordRecoveryComplete).toBe(true);
    // Still in recovery mode until the user explicitly continues.
    expect(result.current.passwordRecoveryPending).toBe(true);
    expect(result.current.infoMessage).toBe("Password updated.");
  });

  test("a failed update keeps the VERIFIED recovery session active and never signs the user out", async () => {
    const { mock, result } = await mountVerifiedRecovery({
      updateUserError: { message: "New password should be different from the old password." },
    });

    await act(async () => {
      await result.current.updatePassword("brand-new-password");
    });

    expect(result.current.errorMessage).toBe("New password should be different from the old password.");
    expect(result.current.passwordRecoveryComplete).toBe(false);
    // Still pending AND still verified -- a failed attempt must not downgrade
    // a valid recovery session or sign the user out.
    expect(result.current.passwordRecoveryPending).toBe(true);
    expect(result.current.passwordRecoveryReady).toBe(true);
    expect(mock.client.auth.signOut).not.toHaveBeenCalled();

    // The user can retry immediately.
    await act(async () => {
      await result.current.updatePassword("another-new-password");
    });
    expect(mock.client.auth.updateUser).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["an empty password", ""],
    ["a too-short password", "abc12"],
  ])("%s makes zero updateUser calls even with a verified recovery session", async (_label, value) => {
    const { mock, result } = await mountVerifiedRecovery();

    await act(async () => {
      await result.current.updatePassword(value);
    });

    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBeTruthy();
    expect(result.current.passwordRecoveryComplete).toBe(false);
  });

  test("explicit continuation is the only thing that leaves a successful recovery", async () => {
    const { result } = await mountVerifiedRecovery();

    await act(async () => {
      await result.current.updatePassword("brand-new-password");
    });
    expect(result.current.passwordRecoveryPending).toBe(true);

    act(() => {
      result.current.completePasswordRecovery();
    });

    expect(result.current.passwordRecoveryPending).toBe(false);
    expect(result.current.passwordRecoveryReady).toBe(false);
    expect(result.current.passwordRecoveryComplete).toBe(false);
  });
});
