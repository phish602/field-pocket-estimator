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
      estimate_number: "EST-1", status: "draft", total_amount: 100,
      notes: null, terms: null, converted_invoice_legacy_local_id: null,
    });
  });

  test("carries a converted invoice identity when the draft has one", () => {
    const contract = buildPersistedEstimateContract(backendDraft(localEstimate({ total: 100, invoiceId: "inv-4" })));
    expect(contract.converted_invoice_legacy_local_id).toBe("inv-4");
  });

  test("persists notes/terms as null because the backend draft never carries them", () => {
    // mapLocalEstimateToBackendEstimate maps no notes/terms field, so a local
    // estimate's notes never reach the estimates table -- the writer has always
    // stored null. The contract mirrors the writer exactly rather than inventing
    // a value the writer would not have written; a cloud row holding anything
    // else in those columns is therefore still a real contradiction.
    const draft = backendDraft(localEstimate({ total: 100, notes: "Scope A", terms: "Net 30" }));
    expect(draft.notes).toBeUndefined();
    expect(draft.terms).toBeUndefined();
    const contract = buildPersistedEstimateContract(draft);
    expect(contract.notes).toBeNull();
    expect(contract.terms).toBeNull();
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
      estimate_number: null, status: "pending", total_amount: null,
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
