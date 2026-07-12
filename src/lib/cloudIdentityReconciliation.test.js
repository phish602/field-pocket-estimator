import {
  buildCloudIdentityReconciliationPlan,
  hasPermanentCloudIdentityConflict,
  buildPaymentIdentityFingerprint,
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

  // Payments hang off an invoice that legacy-exact-matches, so only the payment
  // identity varies between these cases.
  const PAID_AT = "2026-07-03T18:30:00.000Z";
  function paymentPlan({ local, cloud }) {
    return buildCloudIdentityReconciliationPlan({
      draft: baseDraft({
        customers: [], projects: [], estimates: [],
        invoices: [{ legacy_local_id: "inv_1", invoice_number: "INV-1" }],
        invoicePayments: (Array.isArray(local) ? local : [local]),
      }),
      cloudRowsByTable: matchingCloud({
        customers: [], projects: [], estimates: [],
        invoices: [{ id: "db_inv", legacy_local_id: "inv_1", invoice_number: "INV-1" }],
        invoice_payments: (Array.isArray(cloud) ? cloud : [cloud]),
      }),
    });
  }
  const localPay = (overrides = {}) => ({ legacy_local_id: "pay_new", invoice_legacy_local_id: "inv_1", amount: 150, method: "card", status: "paid", paid_at: PAID_AT, ...overrides });
  const cloudPay = (overrides = {}) => ({ id: "db_pay", legacy_local_id: "pay_old", invoice_id: "db_inv", amount: 150, method: "card", status: "paid", paid_at: PAID_AT, ...overrides });
  const paymentReconciliations = (plan) => plan.reconciliations.filter((entry) => entry.entityType === "invoice_payment");

  test("same invoice + same amount alone (no method/status/paid_at) does not reconcile", () => {
    const plan = paymentPlan({
      local: { legacy_local_id: "pay_new", invoice_legacy_local_id: "inv_1", amount: 150 },
      cloud: { id: "db_pay", legacy_local_id: "pay_old", invoice_id: "db_inv", amount: 150 },
    });
    expect(paymentReconciliations(plan)).toEqual([]);
    expect(plan.protectedConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "invoice_payment", currentLocalLegacyId: "pay_new", reason: "payment_identity_fields_missing" }),
    ]));
    expect(hasPermanentCloudIdentityConflict(plan)).toBe(true);
  });

  test("same amount + different method does not reconcile", () => {
    const plan = paymentPlan({ local: localPay({ method: "cash" }), cloud: cloudPay({ method: "card" }) });
    expect(paymentReconciliations(plan)).toEqual([]);
    expect(plan.protectedConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "invoice_payment", reason: "payment_identity_mismatch" }),
    ]));
    expect(hasPermanentCloudIdentityConflict(plan)).toBe(true);
  });

  test("same amount + different status does not reconcile", () => {
    const plan = paymentPlan({ local: localPay({ status: "partial" }), cloud: cloudPay({ status: "paid" }) });
    expect(paymentReconciliations(plan)).toEqual([]);
    expect(plan.protectedConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "invoice_payment", reason: "payment_identity_mismatch" }),
    ]));
  });

  test("same amount + different paid timestamp does not reconcile", () => {
    const plan = paymentPlan({ local: localPay({ paid_at: "2026-07-03T18:30:00.000Z" }), cloud: cloudPay({ paid_at: "2026-07-04T18:30:00.000Z" }) });
    expect(paymentReconciliations(plan)).toEqual([]);
    expect(plan.protectedConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "invoice_payment", reason: "payment_identity_mismatch" }),
    ]));
  });

  test("a missing method blocks reconciliation", () => {
    const plan = paymentPlan({ local: localPay({ method: "" }), cloud: cloudPay() });
    expect(paymentReconciliations(plan)).toEqual([]);
    expect(plan.protectedConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "invoice_payment", reason: "payment_identity_fields_missing", missingFields: expect.arrayContaining(["method"]) }),
    ]));
  });

  test("a missing paid timestamp blocks reconciliation", () => {
    const plan = paymentPlan({ local: localPay({ paid_at: "" }), cloud: cloudPay() });
    expect(paymentReconciliations(plan)).toEqual([]);
    expect(plan.protectedConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "invoice_payment", reason: "payment_identity_fields_missing", missingFields: expect.arrayContaining(["paid_at"]) }),
    ]));
  });

  test("two identical payment fingerprints on the same invoice are ambiguous and blocked", () => {
    const plan = paymentPlan({
      local: [
        localPay({ legacy_local_id: "pay_a" }),
        localPay({ legacy_local_id: "pay_b" }),
      ],
      cloud: [
        cloudPay({ id: "db_pay_1", legacy_local_id: "pay_old_1" }),
        cloudPay({ id: "db_pay_2", legacy_local_id: "pay_old_2" }),
      ],
    });
    expect(paymentReconciliations(plan)).toEqual([]);
    expect(plan.protectedConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "invoice_payment", reason: "payment_identity_ambiguous" }),
    ]));
    expect(hasPermanentCloudIdentityConflict(plan)).toBe(true);
  });

  test("an exact unique composite fingerprint safely re-keys ONLY legacy_local_id and preserves the cloud UUID and financial values", () => {
    const plan = paymentPlan({ local: localPay(), cloud: cloudPay() });
    const reconciled = paymentReconciliations(plan);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toEqual(expect.objectContaining({
      entityType: "invoice_payment",
      cloudUuid: "db_pay",
      oldCloudLegacyId: "pay_old",
      currentLocalLegacyId: "pay_new",
      stableIdentifier: "payment_identity_fingerprint",
    }));
    // The reconciliation carries only identity -- never new financial values to write.
    expect(reconciled[0]).not.toHaveProperty("amount");
    expect(reconciled[0]).not.toHaveProperty("method");
    expect(reconciled[0]).not.toHaveProperty("status");
    expect(reconciled[0]).not.toHaveProperty("paid_at");
    expect(plan.protectedConflicts).toEqual([]);
    expect(hasPermanentCloudIdentityConflict(plan)).toBe(false);
  });

  test("live-shaped INV-2609 with a payment lacking proven identity fields reconciles the invoice but keeps the payment protected", () => {
    // The real cloud payment carried an amount but the contemporaneous local
    // fields were never available, so the payment stays protected and the
    // overall write must remain blocked even though the invoice itself matches.
    const plan = buildCloudIdentityReconciliationPlan({
      draft: {
        customers: [{ legacy_local_id: "cust_live", email: "acct@example.com", phone: "555-000-1111", display_name: "Acme Property Group" }],
        projects: [{ legacy_local_id: "proj_live", customer_legacy_local_id: "cust_live", project_number: "PRJ-42" }],
        estimates: [{ legacy_local_id: "est_live", customer_legacy_local_id: "cust_live", project_legacy_local_id: "proj_live", estimate_number: "EST-77" }],
        invoices: [{ legacy_local_id: "inv_local_drifted", customer_legacy_local_id: "cust_live", project_legacy_local_id: "proj_live", source_estimate_legacy_local_id: "est_live", invoice_number: "INV-2609" }],
        invoicePayments: [{ legacy_local_id: "pay_local_drifted", invoice_legacy_local_id: "inv_local_drifted", amount: 150 }],
      },
      cloudRowsByTable: {
        customers: [{ id: "uuid_cust", legacy_local_id: "cust_live", email: "acct@example.com", phone: "5550001111", display_name: "Acme Property Group" }],
        projects: [{ id: "uuid_proj", legacy_local_id: "proj_live", customer_id: "uuid_cust", project_number: "PRJ-42" }],
        estimates: [{ id: "uuid_est", legacy_local_id: "est_live", customer_id: "uuid_cust", project_id: "uuid_proj", estimate_number: "EST-77" }],
        invoices: [{ id: "uuid_inv", legacy_local_id: "inv_cloud_original", customer_id: "uuid_cust", project_id: "uuid_proj", estimate_id: "uuid_est", invoice_number: "INV-2609" }],
        invoice_payments: [{ id: "uuid_pay", legacy_local_id: "pay_cloud_original", invoice_id: "uuid_inv", amount: 150 }],
      },
    });

    // The invoice reconciles onto the preserved cloud UUID and is not left as
    // both local-only and cloud-only.
    expect(plan.reconciliations).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "invoice", cloudUuid: "uuid_inv", currentLocalLegacyId: "inv_local_drifted" }),
    ]));
    expect(plan.localOnly.some((entry) => entry.entityType === "invoice")).toBe(false);
    expect(plan.cloudOnly.some((entry) => entry.entityType === "invoice")).toBe(false);
    // The payment is NOT auto-reconciled (identity fields missing) and keeps the
    // overall write protected until a fresh export supplies the fields.
    expect(paymentReconciliations(plan)).toEqual([]);
    expect(plan.protectedConflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "invoice_payment", reason: "payment_identity_fields_missing" }),
    ]));
    expect(hasPermanentCloudIdentityConflict(plan)).toBe(true);
  });

  test("buildPaymentIdentityFingerprint returns the missing fields when identity is incomplete and a stable key when complete", () => {
    expect(buildPaymentIdentityFingerprint({ amount: 150 }, "uuid_inv")).toEqual({
      ok: false,
      missing: expect.arrayContaining(["method", "status", "paid_at"]),
    });
    expect(buildPaymentIdentityFingerprint({ amount: 150, method: "Card", status: "Paid", paid_at: PAID_AT }, "")).toEqual({
      ok: false,
      missing: ["parent_invoice"],
    });
    const fp = buildPaymentIdentityFingerprint({ amount: 150, method: "Card", status: "Paid", paid_at: PAID_AT }, "uuid_inv");
    expect(fp.ok).toBe(true);
    // Normalized: method/status lowercased, amount in integer cents.
    expect(fp.key).toBe(`uuid_inv|15000|card|paid|${Date.parse(PAID_AT)}`);
  });
});
