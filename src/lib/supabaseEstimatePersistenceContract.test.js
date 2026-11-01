import { mapLocalEstimateToBackendEstimate } from "../utils/backendDataMapper";
import { buildPersistedEstimateContract, persistedEstimateTotalAmount, PERSISTED_ESTIMATE_CONTRACT_FIELDS } from "./supabaseEstimatePersistenceContract";

const backendDraft = (local) => mapLocalEstimateToBackendEstimate(local, {});
const localEstimate = (overrides = {}) => ({
  id: "est-1", customerId: "cust-1", projectId: "proj-1", estimateNumber: "EST-1",
  status: "draft", notes: "", terms: "", labor: { lines: [] }, materials: { items: [] }, ...overrides,
});

describe("persisted estimate total rule", () => {
  test.each([
    ["approved_total wins over grand_total and total", { approvedTotal: 4500, grandTotal: 4400, total: 4300 }, 4500],
    ["grand_total wins when there is no approved total", { grandTotal: 3200, total: 3100 }, 3200],
    ["total is the last resort", { total: 900 }, 900],
    ["no total of any kind persists null", {}, null],
    // ?? not ||: a genuinely approved zero total must not fall through.
    ["an approved total of zero is kept", { approvedTotal: 0, grandTotal: 1300, total: 1200 }, 0],
    ["a grand total of zero is kept", { grandTotal: 0, total: 1200 }, 0],
    ["decimals survive", { approvedTotal: 15250.75 }, 15250.75],
  ])("%s", (_label, totals, expected) => {
    expect(persistedEstimateTotalAmount(backendDraft(localEstimate(totals)))).toBe(expected);
    expect(buildPersistedEstimateContract(backendDraft(localEstimate(totals))).total_amount).toBe(expected);
  });
});

describe("persisted estimate contract shape", () => {
  test("carries exactly the writer-owned columns and nothing else", () => {
    const contract = buildPersistedEstimateContract(backendDraft(localEstimate({ total: 100 })));
    expect(Object.keys(contract).sort()).toEqual([...PERSISTED_ESTIMATE_CONTRACT_FIELDS].sort());
  });

  test("excludes fields the writer does not persist, including approved_total", () => {
    // The backend draft is rich; the estimates table is not. approved_total,
    // grand_total, total and the margin/timeline fields exist on the draft but
    // are never written, so the contract must not claim them.
    const draft = backendDraft(localEstimate({ approvedTotal: 4500, grandTotal: 4400, total: 4300, totalCost: 1000, grossProfit: 3500 }));
    expect(draft.approved_total).toBe(4500);
    const contract = buildPersistedEstimateContract(draft);
    expect(contract).not.toHaveProperty("approved_total");
    expect(contract).not.toHaveProperty("grand_total");
    expect(contract).not.toHaveProperty("total");
    expect(contract).not.toHaveProperty("total_cost");
    expect(contract).not.toHaveProperty("gross_profit");
    expect(contract).not.toHaveProperty("line_items");
    // The draft carries no total_amount at all -- the whole reason evidence
    // comparison against the draft was wrong.
    expect(draft.total_amount).toBeUndefined();
    expect(contract.total_amount).toBe(4500);
  });

  test("normalizes identity, relationship and empty text fields the way the writer does", () => {
    const contract = buildPersistedEstimateContract(backendDraft(localEstimate({ total: 100, notes: "", terms: "" })));
    expect(contract).toEqual({
      legacy_local_id: "est-1", customer_legacy_local_id: "cust-1", project_legacy_local_id: "proj-1",
      estimate_number: "EST-1", estimate_date: null, status: "draft", total_amount: 100,
      notes: null, terms: null, converted_invoice_legacy_local_id: null,
    });
  });

  test("carries a converted invoice identity when the draft has one", () => {
    const contract = buildPersistedEstimateContract(backendDraft(localEstimate({ total: 100, invoiceId: "inv-4" })));
    expect(contract.converted_invoice_legacy_local_id).toBe("inv-4");
  });

  test("preserves a valid date-only estimate date and never fabricates a missing or invalid one", () => {
    expect(buildPersistedEstimateContract(backendDraft(localEstimate({ date: "2026-11-01" }))).estimate_date).toBe("2026-11-01");
    expect(buildPersistedEstimateContract(backendDraft(localEstimate({ job: { date: "2024-02-29" } }))).estimate_date).toBe("2024-02-29");
    expect(buildPersistedEstimateContract(backendDraft(localEstimate())).estimate_date).toBeNull();
    expect(buildPersistedEstimateContract({ estimate_date: "2026-11-01T23:30:00-07:00" }).estimate_date).toBeNull();
    expect(buildPersistedEstimateContract({ estimate_date: "2026-02-29" }).estimate_date).toBeNull();
  });

  test("persists notes/terms already carried by the backend draft", () => {
    // This is existing mapper behavior. The date extension must not erase or
    // otherwise change these restoration-compatible fields.
    const draft = backendDraft(localEstimate({ total: 100, notes: "Scope A", terms: "Net 30" }));
    expect(draft.notes).toBe("Scope A");
    expect(draft.terms).toBe("Net 30");
    const contract = buildPersistedEstimateContract(draft);
    expect(contract.notes).toBe("Scope A");
    expect(contract.terms).toBe("Net 30");
  });

  test("passes through notes/terms that a draft does carry", () => {
    // Guards the projection itself: if the draft ever gains these fields, the
    // contract must forward them rather than silently null them out.
    const contract = buildPersistedEstimateContract({ legacy_local_id: "est-1", notes: "Scope A", terms: "Net 30", total: 100 });
    expect(contract).toEqual(expect.objectContaining({ notes: "Scope A", terms: "Net 30", total_amount: 100 }));
  });

  test("defaults status to pending, matching the writer", () => {
    expect(buildPersistedEstimateContract({}).status).toBe("pending");
  });

  test("is total on junk input rather than throwing", () => {
    expect(buildPersistedEstimateContract(null)).toEqual({
      legacy_local_id: "", customer_legacy_local_id: "", project_legacy_local_id: "",
      estimate_number: null, estimate_date: null, status: "pending", total_amount: null,
      notes: null, terms: null, converted_invoice_legacy_local_id: null,
    });
  });

  test("is pure: it does not mutate the backend draft", () => {
    const draft = backendDraft(localEstimate({ approvedTotal: 4500 }));
    const before = JSON.stringify(draft);
    buildPersistedEstimateContract(draft);
    expect(JSON.stringify(draft)).toBe(before);
  });
});
