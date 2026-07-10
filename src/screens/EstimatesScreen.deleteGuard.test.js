import { getEstimateDeleteMode } from "./EstimatesScreen";

function createEstimate(overrides = {}) {
  return {
    id: "est_test",
    docType: "estimate",
    status: "draft",
    ...overrides,
  };
}

function createLinkedInvoice(estimateId, overrides = {}) {
  return {
    id: "inv_linked",
    docType: "invoice",
    sourceEstimateId: estimateId,
    ...overrides,
  };
}

describe("estimate delete safety classification", () => {
  test("only a standalone raw draft can be permanently deleted", () => {
    expect(getEstimateDeleteMode(createEstimate())).toMatchObject({
      mode: "delete",
      isDraftSafe: true,
    });
  });

  test("pending estimates are archived, including the Awaiting Response pipeline state", () => {
    expect(getEstimateDeleteMode(createEstimate({ status: "pending" }))).toMatchObject({
      mode: "archive",
      isPendingLike: true,
    });
  });

  test("sent and approved estimates are archived", () => {
    expect(getEstimateDeleteMode(createEstimate({ status: "sent" }))).toMatchObject({ mode: "archive" });
    expect(getEstimateDeleteMode(createEstimate({ status: "approved" }))).toMatchObject({
      mode: "archive",
      isApprovedLike: true,
    });
  });

  test("converted estimates and estimates with linked invoices are archived even when the invoice is void", () => {
    const linkedInvoice = createLinkedInvoice("est_test", { status: "void", paymentStatus: "void" });
    expect(getEstimateDeleteMode(createEstimate(), [linkedInvoice])).toMatchObject({
      mode: "archive",
      isConverted: true,
      hasLinkedInvoices: true,
    });
  });

  test("project or customer history requires archiving", () => {
    expect(getEstimateDeleteMode(createEstimate({ customerId: "cust_1" }))).toMatchObject({
      mode: "archive",
      hasProjectOrCustomerHistory: true,
    });
    expect(getEstimateDeleteMode(createEstimate({ projectId: "proj_1" }), [], [{ id: "proj_1" }])).toMatchObject({
      mode: "archive",
      hasProjectOrCustomerHistory: true,
    });
  });
});
