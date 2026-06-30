import { act, renderHook } from "@testing-library/react";
import { STORAGE_KEY } from "./defaultState";
import { useEstimatorState } from "./useEstimatorState";
import { createSaveLoadSwitchingService } from "../lib/saveLoadSwitchingService";
import { STORAGE_KEYS } from "../constants/storageKeys";

jest.mock("../lib/saveLoadSwitchingService", () => ({
  createSaveLoadSwitchingService: jest.fn(),
}));

describe("useEstimatorState save/load switching integration", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  test("keeps localStorage as default without switching options", () => {
    const { result } = renderHook(() => useEstimatorState());

    act(() => {
      result.current.patch("customer.name", "Local Draft");
    });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(createSaveLoadSwitchingService).not.toHaveBeenCalled();

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.customer.name).toBe("Local Draft");
  });

  test("persists and hydrates additional charges through localStorage defaults", () => {
    const { result, unmount } = renderHook(() => useEstimatorState());

    act(() => {
      result.current.patch("additionalCharges.items", [
        {
          id: "charge_1",
          desc: "Emergency Sunday Call",
          qty: "1",
          priceEach: "350",
        },
      ]);
    });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw)).toEqual(expect.objectContaining({
      additionalCharges: {
        items: [
          expect.objectContaining({
            id: "charge_1",
            desc: "Emergency Sunday Call",
            qty: "1",
            priceEach: "350",
          }),
        ],
      },
    }));

    unmount();

    const { result: hydrated } = renderHook(() => useEstimatorState());
    expect(hydrated.current.state.additionalCharges).toEqual({
      items: [
        expect.objectContaining({
          id: "charge_1",
          desc: "Emergency Sunday Call",
          qty: "1",
          priceEach: "350",
        }),
      ],
    });
  });

  test("does not seed hidden internal estimate notes into scope notes for new drafts", () => {
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        docDefaults: {
          defaultInternalNotesEstimate: "Private team-only note that should stay hidden.",
        },
      })
    );

    const { result } = renderHook(() => useEstimatorState());

    expect(result.current.state.ui.docType).toBe("estimate");
    expect(result.current.state.scopeNotes).toBe("");
  });

  test("uses switching service only when explicitly enabled and preserves local fallback", () => {
    const saveDraft = jest.fn(() => ({
      ok: true,
      mode: "localStorage",
      fallbackUsed: true,
      blocked: true,
      reason: "Backend write is blocked or unavailable.",
      autoMigrationPerformed: false,
    }));
    const loadDrafts = jest.fn(() => ({
      ok: true,
      mode: "localStorage",
      fallbackUsed: true,
      blocked: false,
      autoMigrationPerformed: false,
      data: { drafts: [] },
    }));

    createSaveLoadSwitchingService.mockReturnValue({
      saveDraft,
      loadDrafts,
    });

    const { result } = renderHook(() =>
      useEstimatorState({
        saveLoadSwitching: {
          enabled: true,
          mode: "backend",
          enableBackendMode: true,
        },
      })
    );

    act(() => {
      result.current.patch("customer.name", "Guarded Draft");
    });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(createSaveLoadSwitchingService).toHaveBeenCalledWith({
      mode: "backend",
      enableBackendMode: true,
      backendAdapter: undefined,
    });
    expect(saveDraft).toHaveBeenCalled();

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.customer.name).toBe("Guarded Draft");
  });

  test("does not hydrate from backend unless explicitly allowed", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ customer: { name: "Local Hydrated" } })
    );

    const loadDrafts = jest.fn(() => ({
      ok: true,
      mode: "backend",
      fallbackUsed: false,
      blocked: false,
      autoMigrationPerformed: false,
      data: { snapshot: { customer: { name: "Backend Hydrated" } } },
    }));

    createSaveLoadSwitchingService.mockReturnValue({
      saveDraft: jest.fn(),
      loadDrafts,
    });

    const { result } = renderHook(() =>
      useEstimatorState({
        saveLoadSwitching: {
          enabled: true,
          mode: "backend",
          enableBackendMode: true,
          allowBackendReadForInitialHydration: false,
        },
      })
    );

    expect(loadDrafts).not.toHaveBeenCalled();
    expect(result.current.state.customer.name).toBe("Local Hydrated");
  });

  test("hydrates from backend only when explicitly enabled", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ customer: { name: "Local Hydrated" } })
    );

    const loadDrafts = jest.fn(() => ({
      ok: true,
      mode: "backend",
      fallbackUsed: false,
      blocked: false,
      autoMigrationPerformed: false,
      data: { snapshot: { customer: { name: "Backend Hydrated" } } },
    }));

    createSaveLoadSwitchingService.mockReturnValue({
      saveDraft: jest.fn(),
      loadDrafts,
    });

    const { result } = renderHook(() =>
      useEstimatorState({
        saveLoadSwitching: {
          enabled: true,
          mode: "backend",
          enableBackendMode: true,
          allowBackendReadForInitialHydration: true,
        },
      })
    );

    expect(loadDrafts).toHaveBeenCalledWith(
      { storageKey: STORAGE_KEY, entityType: "estimator_state" },
      { source: "useEstimatorState.initial" }
    );
    expect(result.current.state.customer.name).toBe("Backend Hydrated");
  });
});
