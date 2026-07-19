jest.mock("../../lib/supabaseClient", () => ({ getSupabaseClient: jest.fn() }));

import { getSupabaseClient } from "../../lib/supabaseClient";
import { requestGuidedBuildTurn } from "./service";

describe("Guided-build Authorization transport", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    getSupabaseClient.mockReset();
  });

  async function requestGuidedBuild() {
    return requestGuidedBuildTurn({}, {
      requiresAI: true,
      requestBody: { userAnswer: "Customer sentinel request" },
      fallback: {},
      localPayload: {},
    });
  }

  test("attaches the session token only in the actual guided-build Authorization header", async () => {
    getSupabaseClient.mockReturnValue({
      auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: "session-token" } } })) },
    });
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}), text: async () => "" }));

    await requestGuidedBuild();

    expect(global.fetch).toHaveBeenCalledWith("/api/guided-build", expect.objectContaining({
      headers: { "Content-Type": "application/json", Authorization: "Bearer session-token" },
    }));
    expect(global.fetch.mock.calls[0][1].body).not.toContain("session-token");
  });

  test("preserves local request compatibility without a session and omits Authorization", async () => {
    getSupabaseClient.mockReturnValue(null);
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}), text: async () => "" }));

    await requestGuidedBuild();

    expect(global.fetch.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });
});
