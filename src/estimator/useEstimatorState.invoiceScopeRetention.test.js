// INVOICE SCOPE LOSS DURING CONTINUE EDITING.
//
// Invoice scope and trade-insert text are deliberately kept OUT of the shared
// builder draft. saveNow() (and the draft autosave) used to apply that stripped
// persistence copy back onto the LIVE builder state as well. The first save was
// unaffected -- EstimateForm captures the scope before calling saveNow() -- but
// the open editor was left with an empty scope, so "Continue Editing", moving to
// another section and saving again persisted an empty Scope of Work.
//
// These assert the contract the editor relies on: stripping applies to what is
// persisted as a draft, never to the document still open in the builder.

import { act, renderHook } from "@testing-library/react";
import { STORAGE_KEY } from "./defaultState";
import { useEstimatorState } from "./useEstimatorState";

jest.mock("../lib/saveLoadSwitchingService", () => ({
  createSaveLoadSwitchingService: jest.fn(),
}));

const SCOPE = "Remove the existing 3-ton split system condenser and evaporator coil. "
  + "Install a new 3-ton condenser and matching evaporator coil on the existing pad. "
  + "Replace the refrigerant line set, pressure-test, evacuate, and charge the system. "
  + "Start up and verify cooling operation.";
const TRADE_INSERT = { key: "hvac", text: "EPA 608 certified technician." };

function openInvoiceInBuilder(options = { persistDraft: false }) {
  const view = renderHook(() => useEstimatorState(options));
  act(() => {
    view.result.current.replaceState({
      ui: { docType: "invoice", materialsMode: "itemized" },
      invoiceNumber: "INV-0001",
      scopeNotes: SCOPE,
      tradeInsert: TRADE_INSERT,
      labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [{ id: "l1", role: "technician", qty: "1", hours: "12", rate: "95", trueRateInternal: "45" }] },
      meta: { savedDocId: "inv_clean_lane" },
    }, { persistNow: false, persistDraft: false });
  });
  return view;
}

describe("invoice scope survives saving and continuing to edit", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  test("saveNow keeps the open invoice's scope and trade insert byte-for-byte", () => {
    const { result } = openInvoiceInBuilder();

    act(() => {
      result.current.saveNow({ savedDocId: "inv_clean_lane" }, { persistDraft: false });
    });

    expect(result.current.state.scopeNotes).toBe(SCOPE);
    expect(result.current.state.tradeInsert).toEqual(TRADE_INSERT);
    expect(result.current.state.labor.lines[0]).toEqual(expect.objectContaining({ hours: "12", rate: "95", trueRateInternal: "45" }));
    expect(result.current.state.meta.lastSavedAt).toBeGreaterThan(0);
  });

  test("a second save after continuing to edit still carries the original scope", () => {
    const { result } = openInvoiceInBuilder();

    act(() => {
      result.current.saveNow({ savedDocId: "inv_clean_lane" }, { persistDraft: false });
    });
    // Continue Editing, move to Terms & Notes, change nothing in Scope.
    act(() => {
      result.current.patch("additionalNotes", "");
    });
    let second;
    act(() => {
      second = result.current.saveNow({ savedDocId: "inv_clean_lane" }, { persistDraft: false });
    });

    expect(result.current.state.scopeNotes).toBe(SCOPE);
    // The value the save path reads its fallback scope from.
    expect(result.current.state.scopeNotes.length).toBe(SCOPE.length);
    // saveNow's return value is still the persistence copy.
    expect(second.scopeNotes).toBe("");
  });

  test("the persisted draft still never contains invoice scope or trade insert", () => {
    const { result } = openInvoiceInBuilder({ persistDraft: true });

    let persisted;
    act(() => {
      persisted = result.current.saveNow({ savedDocId: "inv_clean_lane" }, { persistDraft: true });
    });

    expect(persisted.scopeNotes).toBe("");
    expect(persisted.tradeInsert).toEqual({ key: "", text: "" });
    const draft = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(draft.scopeNotes).toBe("");
    expect(draft.tradeInsert).toEqual({ key: "", text: "" });
    expect(result.current.state.scopeNotes).toBe(SCOPE);
  });

  test("draft autosave keeps the live invoice scope while stripping the draft", () => {
    const { result } = openInvoiceInBuilder({ persistDraft: true });

    act(() => {
      result.current.patch("additionalNotes", "Net 30");
    });
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    const draft = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(draft.additionalNotes).toBe("Net 30");
    expect(draft.scopeNotes).toBe("");
    expect(result.current.state.scopeNotes).toBe(SCOPE);
    expect(result.current.state.tradeInsert).toEqual(TRADE_INSERT);
    expect(result.current.state.meta.lastSavedAt).toBe(draft.meta.lastSavedAt);
  });

  test("estimates are not stripped at all", () => {
    const { result } = renderHook(() => useEstimatorState({ persistDraft: false }));
    act(() => {
      result.current.replaceState({ ui: { docType: "estimate" }, scopeNotes: SCOPE }, { persistNow: false, persistDraft: false });
    });
    let saved;
    act(() => {
      saved = result.current.saveNow(null, { persistDraft: false });
    });
    expect(saved.scopeNotes).toBe(SCOPE);
    expect(result.current.state.scopeNotes).toBe(SCOPE);
  });
});
