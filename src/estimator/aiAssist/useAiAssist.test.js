import { act, renderHook, waitFor } from "@testing-library/react";
import { useAiAssist } from "./useAiAssist";

const mockRequestSectionAssist = jest.fn();

jest.mock("./service", () => ({
  buildScopeAssistRequestKey: jest.fn(() => "scope-refine-key"),
  requestSectionAssist: (...args) => mockRequestSectionAssist(...args),
}));

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAiAssist close-request invalidation", () => {
  beforeEach(() => {
    mockRequestSectionAssist.mockReset();
  });

  test("ignores a late successful response after close and allows a fresh submit", async () => {
    const first = createDeferred();
    const second = createDeferred();
    mockRequestSectionAssist
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useAiAssist("materials", {}));

    await act(async () => {
      result.current.open();
    });

    act(() => {
      result.current.submit("first request");
    });

    await waitFor(() => {
      expect(result.current.assistState.phase).toBe("requesting");
      expect(result.current.assistState.input).toBe("first request");
    });

    act(() => {
      result.current.close();
    });

    expect(result.current.assistState).toEqual({ phase: "idle" });

    await act(async () => {
      first.resolve({
        writes: { mode: "blanket", blanketSuggestion: { suggestedAmount: "250" } },
        validation: { valid: true },
      });
      await first.promise;
    });

    expect(result.current.assistState).toEqual({ phase: "idle" });

    act(() => {
      result.current.submit("second request");
    });

    await waitFor(() => {
      expect(result.current.assistState.phase).toBe("requesting");
      expect(result.current.assistState.input).toBe("second request");
    });

    await act(async () => {
      second.resolve({
        writes: { mode: "blanket", blanketSuggestion: { suggestedAmount: "350" } },
        validation: { valid: true },
      });
      await second.promise;
    });

    await waitFor(() => {
      expect(result.current.assistState.phase).toBe("review");
      expect(result.current.assistState.input).toBe("second request");
      expect(result.current.assistState.result?.writes?.blanketSuggestion?.suggestedAmount).toBe("350");
    });
  });

  test("ignores a late failed response after close", async () => {
    const deferred = createDeferred();
    mockRequestSectionAssist.mockReturnValueOnce(deferred.promise);

    const { result } = renderHook(() => useAiAssist("labor", {}));

    await act(async () => {
      result.current.open();
    });

    act(() => {
      result.current.submit("generate labor");
    });

    await waitFor(() => {
      expect(result.current.assistState.phase).toBe("requesting");
    });

    act(() => {
      result.current.close();
    });

    expect(result.current.assistState).toEqual({ phase: "idle" });

    await act(async () => {
      deferred.reject(new Error("No labor lines were generated."));
      try {
        await deferred.promise;
      } catch (_) {
        // Expected rejection; hook handles it internally.
      }
    });

    expect(result.current.assistState).toEqual({ phase: "idle" });
  });
});

describe("useAiAssist shared scope validation", () => {
  beforeEach(() => {
    mockRequestSectionAssist.mockReset();
  });

  test("keeps invalid non-empty scaffold scope output out of review", async () => {
    mockRequestSectionAssist.mockResolvedValueOnce({
      writes: {
        scopeNotes: "Complete the described scope and clean up the work area.",
      },
      validation: { valid: false, error: "Generated scope is too generic." },
    });

    const { result } = renderHook(() => useAiAssist("scope", {}));

    await act(async () => {
      result.current.open();
    });

    await act(async () => {
      await result.current.submit("replace ceiling tiles");
    });

    await waitFor(() => {
      expect(result.current.assistState.phase).toBe("error");
      expect(result.current.assistState.input).toBe("replace ceiling tiles");
      expect(result.current.assistState.error).toBe("Generated scope is too generic.");
    });
  });

  test("still sends valid scope output into review", async () => {
    mockRequestSectionAssist.mockResolvedValueOnce({
      writes: {
        scopeNotes: "Remove damaged ceiling tiles, install matching replacement tiles, and dispose of debris.",
      },
      validation: { valid: true },
    });

    const { result } = renderHook(() => useAiAssist("scope", {}));

    await act(async () => {
      result.current.open();
    });

    await act(async () => {
      await result.current.submit("replace ceiling tiles");
    });

    await waitFor(() => {
      expect(result.current.assistState.phase).toBe("review");
      expect(result.current.assistState.input).toBe("replace ceiling tiles");
      expect(result.current.assistState.result?.writes?.scopeNotes).toContain("Remove damaged ceiling tiles");
    });
  });
});
