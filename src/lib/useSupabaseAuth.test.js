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
    expect(window.location.search).toContain("code=bad-code");
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
    expect(result.current.infoMessage).toBe("Signed out.");
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
