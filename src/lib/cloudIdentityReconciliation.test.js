import {
  buildCloudIdentityReconciliationPlan,
  hasPermanentCloudIdentityConflict,
} from "./cloudIdentityReconciliation";

function baseDraft(overrides = {}) {
  return {
    customers: [{ legacy_local_id: "cust_new", email: "owner@example.com", phone: "555-111-2222", display_name: "Avery Owner" }],
    projects: [{ legacy_local_id: "proj_new", customer_legacy_local_id: "cust_new", project_number: "P-100" }],
    estimates: [{ legacy_local_id: "est_new", customer_legacy_local_id: "cust_new", project_legacy_local_id: "proj_new", estimate_number: "EST-100" }],
    invoices: [{ legacy_local_id: "inv_new", customer_legacy_local_id: "cust_new", project_legacy_local_id: "proj_new", source_estimate_legacy_local_id: "est_new", invoice_number: "INV-100" }],
    invoicePayments: [],
    ...overrides,
  };
}

function matchingCloud(overrides = {}) {
  return {
    customers: [{ id: "db_cust", legacy_local_id: "cust_old", email: "owner@example.com", phone: "5551112222", display_name: "Avery Owner" }],
    projects: [{ id: "db_proj", legacy_local_id: "proj_old", customer_id: "db_cust", project_number: "P-100" }],
    estimates: [{ id: "db_est", legacy_local_id: "est_old", customer_id: "db_cust", project_id: "db_proj", estimate_number: "EST-100" }],
    invoices: [{ id: "db_inv", legacy_local_id: "inv_old", customer_id: "db_cust", project_id: "db_proj", estimate_id: "db_est", invoice_number: "INV-100" }],
    invoice_payments: [],
    ...overrides,
  };
}

describe("buildCloudIdentityReconciliationPlan", () => {
  test("reconciles one-to-one customer/project/document identity drift while preserving cloud UUIDs", () => {
    const plan = buildCloudIdentityReconciliationPlan({ draft: baseDraft(), cloudRowsByTable: matchingCloud() });

    expect(plan.reconciliations).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "customer", cloudUuid: "db_cust", oldCloudLegacyId: "cust_old", currentLocalLegacyId: "cust_new" }),
      expect.objectContaining({ entityType: "project", cloudUuid: "db_proj", oldCloudLegacyId: "proj_old", currentLocalLegacyId: "proj_new" }),
      expect.objectContaining({ entityType: "estimate", cloudUuid: "db_est", oldCloudLegacyId: "est_old", currentLocalLegacyId: "est_new" }),
      expect.objectContaining({ entityType: "invoice", cloudUuid: "db_inv", oldCloudLegacyId: "inv_old", currentLocalLegacyId: "inv_new" }),
    ]));
    expect(plan.reconciliations.find((entry) => entry.entityType === "invoice").dependentChildOperations)
      .toEqual([expect.objectContaining({ table: "invoice_line_items", parentUuid: "db_inv" })]);
  });

  test("does not reconcile a customer by name alone", () => {
    const plan = buildCloudIdentityReconciliationPlan({
      draft: baseDraft({ customers: [{ legacy_local_id: "cust_new", display_name: "Avery Owner" }], projects: [], estimates: [], invoices: [] }),
      cloudRowsByTable: matchingCloud({ customers: [{ id: "db_cust", legacy_local_id: "cust_old", display_name: "Avery Owner" }], projects: [], estimates: [], invoices: [] }),
    });

    expect(plan.reconciliations).toEqual([]);
    expect(plan.localOnly).toEqual([expect.objectContaining({ entityType: "customer", currentLocalLegacyId: "cust_new" })]);
    expect(plan.cloudOnly).toEqual([expect.objectContaining({ entityType: "customer", oldCloudLegacyId: "cust_old" })]);
  });

  test("blocks an ambiguous business-number match instead of choosing a cloud row", () => {
    const plan = buildCloudIdentityReconciliationPlan({
      draft: baseDraft({ customers: [], projects: [{ legacy_local_id: "proj_new", project_number: "P-100" }], estimates: [], invoices: [] }),
      cloudRowsByTable: matchingCloud({ customers: [], projects: [
        { id: "db_proj_1", legacy_local_id: "proj_old_1", project_number: "P-100" },
        { id: "db_proj_2", legacy_local_id: "proj_old_2", project_number: "P-100" },
      ], estimates: [], invoices: [] }),
    });

    expect(plan.ambiguous).toEqual([expect.objectContaining({ entityType: "project", reason: "multiple_candidates" })]);
    expect(hasPermanentCloudIdentityConflict(plan)).toBe(true);
  });

  test("treats payment ID drift as protected conflict even when the amount matches", () => {
    const plan = buildCloudIdentityReconciliationPlan({
      draft: baseDraft({
        customers: [], projects: [], estimates: [],
        invoices: [{ legacy_local_id: "inv_1", invoice_number: "INV-1" }],
        invoicePayments: [{ legacy_local_id: "pay_new", invoice_legacy_local_id: "inv_1", amount: 25 }],
      }),
      cloudRowsByTable: matchingCloud({
        customers: [], projects: [], estimates: [],
        invoices: [{ id: "db_inv", legacy_local_id: "inv_1", invoice_number: "INV-1" }],
        invoice_payments: [{ id: "db_pay", legacy_local_id: "pay_old", invoice_id: "db_inv", amount: 25 }],
      }),
    });

    expect(plan.protectedConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "invoice_payment", currentLocalLegacyId: "pay_new" }),
      expect.objectContaining({ entityType: "invoice_payment", oldCloudLegacyId: "pay_old" }),
    ]));
  });
});
