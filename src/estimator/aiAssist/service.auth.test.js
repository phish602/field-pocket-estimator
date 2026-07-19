jest.mock("../../lib/supabaseClient", () => ({ getSupabaseClient: jest.fn() }));

import { getSupabaseClient } from "../../lib/supabaseClient";
import { requestSectionAssist } from "./service";

describe("AI-assist Authorization transport", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    getSupabaseClient.mockReset();
  });

  async function requestAssist() {
    return requestSectionAssist({
      sectionKey: "labor",
      userInput: "Install the customer sentinel item",
      state: {},
    });
  }

  test("attaches the session token only in the actual AI-assist Authorization header", async () => {
    getSupabaseClient.mockReturnValue({
      auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: "session-token" } } })) },
    });
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ lines: [] }), text: async () => "" }));

    await requestAssist();

    expect(global.fetch).toHaveBeenCalledWith("/api/ai-assist", expect.objectContaining({
      headers: { "Content-Type": "application/json", Authorization: "Bearer session-token" },
    }));
    expect(global.fetch.mock.calls[0][1].body).not.toContain("session-token");
  });

  test("preserves local request compatibility without a session and omits Authorization", async () => {
    getSupabaseClient.mockReturnValue(null);
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ lines: [] }), text: async () => "" }));

    await requestAssist();

    expect(global.fetch.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });
});
