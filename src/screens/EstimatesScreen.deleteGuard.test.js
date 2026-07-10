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

  test("a draft with a customer and project is still deletable (association alone is not business history)", () => {
    expect(
      getEstimateDeleteMode(createEstimate({ customerId: "cust_1", customerName: "Acme", projectId: "proj_1", projectName: "Job" }), [], [{ id: "proj_1" }])
    ).toMatchObject({
      mode: "delete",
      isDraftSafe: true,
    });
    // Diagnostic field still reports the association, but it no longer blocks delete.
    expect(
      getEstimateDeleteMode(createEstimate({ customerId: "cust_1" })).hasProjectOrCustomerHistory
    ).toBe(true);
    expect(getEstimateDeleteMode(createEstimate({ customerId: "cust_1" }))).toMatchObject({ mode: "delete" });
  });

  test("lost estimates are archived, not deleted", () => {
    expect(getEstimateDeleteMode(createEstimate({ status: "lost" }))).toMatchObject({
      mode: "archive",
      isLostLike: true,
    });
  });

  test("a draft marked sent (sentAt) is archived, not deleted", () => {
    expect(getEstimateDeleteMode(createEstimate({ sentAt: 1714694400000 }))).toMatchObject({
      mode: "archive",
      isPendingLike: true,
    });
  });

  test("an archived draft is archive-only (cannot be hard deleted)", () => {
    const mode = getEstimateDeleteMode(createEstimate({ archived: true, archivedAt: "2026-01-01T00:00:00.000Z" }));
    expect(mode).toMatchObject({ mode: "archive", isArchived: true });
    expect(mode.reasons).toContain("archived");
  });

  test("a converted draft (invoiceId marker) is archived, not deleted", () => {
    expect(getEstimateDeleteMode(createEstimate({ invoiceId: "inv_1" }))).toMatchObject({
      mode: "archive",
      isConverted: true,
    });
  });

  test("an invoice-linked draft is archived even when the linked invoice is void", () => {
    const linkedInvoice = createLinkedInvoice("est_test", { status: "void", paymentStatus: "void" });
    expect(getEstimateDeleteMode(createEstimate({ customerId: "cust_1" }), [linkedInvoice])).toMatchObject({
      mode: "archive",
      hasLinkedInvoices: true,
    });
  });
});
