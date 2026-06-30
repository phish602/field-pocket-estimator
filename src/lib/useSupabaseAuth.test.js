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
  signOutError = null,
  getSessionError = null,
  exchangeSession = null,
  exchangeError = null,
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
});
