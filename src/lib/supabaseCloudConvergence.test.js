jest.mock("./supabaseClient", () => ({ getSupabaseClient: jest.fn(() => null) }));

import { STORAGE_KEYS } from "../constants/storageKeys";
import { buildLocalSnapshotFromStorage } from "./localDataIntegrity";
import { buildCleanReplicaBootstrapProof, buildCloudConvergencePlan, classifyCloudConvergenceEntity, mergeNonOverlappingCloudMetadata, normalizeCustomerContract, normalizeProjectContract, normalizeEstimateContract, normalizeInvoiceContract, runSupabaseCloudConvergence } from "./supabaseCloudConvergence";
import { getSupabaseClient } from "./supabaseClient";
import { readSupabaseCloudConvergenceSnapshot } from "./supabaseCloudRestore";
import { runSupabaseCloudVerification } from "./supabaseCloudVerification";

const invoice = (id) => ({ id, customerId: "customer-1", projectId: "project-1", sourceEstimateId: "estimate-1", invoiceNumber: id, invoiceTotal: 10, amountPaid: 0, balanceRemaining: 10, status: "sent", paymentStatus: "unpaid", lineItems: [{ id: `${id}-line`, description: "Labor", quantity: 1, price: 10, total: 10 }], payments: [] });
const baseLocal = () => ({ customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1" }], estimates: [{ id: "estimate-1", customerId: "customer-1", projectId: "project-1" }], invoices: [invoice("invoice-1")], companyProfile: null, settings: null, scopeTemplates: [] });
const uuid = (suffix) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const emptySnapshot = () => ({ customers: [], projects: [], estimates: [], invoices: [], companyProfile: null, settings: null, scopeTemplates: [] });
function setLocalSnapshot(snapshot) {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(snapshot.customers || []));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(snapshot.projects || []));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(snapshot.estimates || []));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(snapshot.invoices || []));
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(snapshot.companyProfile || {}));
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(snapshot.settings || {}));
  localStorage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, JSON.stringify(snapshot.scopeTemplates || []));
}
function setBindings(bindings) {
  localStorage.setItem(STORAGE_KEYS.CLOUD_ASSET_BINDINGS, JSON.stringify({ version: 1, companyId: "company-1", bindings: { customer: {}, project: {}, estimate: {}, invoice: {}, invoice_payment: {}, ...bindings } }));
}
function setBaseline(snapshot) {
  localStorage.setItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE, JSON.stringify({ version: 1, companyId: "company-1", snapshots: { ...emptySnapshot(), ...snapshot } }));
}
function setVerifiedCleanQueue(companyId = "company-1", revision = 0) {
  localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({
    schemaVersion: "2.0.0", pending: false, status: "clean", companyId,
    lastSuccessfulBackupAt: Date.now() - 1000, lastVerifiedAt: Date.now() - 500,
    localMutationRevision: revision, syncingRevision: null, retryCount: 0,
    nextRetryAt: null, lastError: "", lastErrorCode: "", reasons: [], domains: [],
  }));
}
const estimate = (id = "estimate-1", overrides = {}) => ({ id, customerId: "customer-1", projectId: "project-1", estimateNumber: id, status: "draft", total: 100, notes: "", terms: "", labor: { lines: [] }, materials: { items: [] }, ...overrides });
function estimateEvidence(row, overrides = {}) {
  return { restorePayload: { schema: "estipaid.estimate.restore_payload", version: 1, legacyLocalId: row.id, estimate: row }, persisted: { legacy_local_id: row.id, customer_legacy_local_id: row.customerId, project_legacy_local_id: row.projectId }, lineItems: [], ...overrides };
}

beforeEach(() => localStorage.clear());

test("no-baseline cloud-only invoice graph appends without changing existing local invoices", () => {
  const local = baseLocal(); const cloud = { ...baseLocal(), invoices: [invoice("invoice-1"), invoice("invoice-2")] };
  const plan = buildCloudConvergencePlan({ local, cloud, cloudSnapshot: { supplemental: { status: "missing" } } });
  expect(plan.safe).toBe(true); expect(plan.additions.invoices).toEqual([invoice("invoice-2")]); expect(plan.replacements.invoices).toEqual([]);
});

test("different shared financial document without baseline is a conflict", () => {
  const local = baseLocal(); const cloud = { ...baseLocal(), invoices: [{ ...invoice("invoice-1"), invoiceTotal: 11 }] };
  const plan = buildCloudConvergencePlan({ local, cloud });
  expect(plan.safe).toBe(false); expect(plan.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "invoices" })]));
});

describe("verified clean-replica bootstrap", () => {
  const cleanRaw = () => ({ estimates: [], invoices: [], invoice_line_items: [], invoice_payments: [] });
  const bootstrapSnapshot = (mapped) => ({
    ok: true, mapped, raw: cleanRaw(), supplemental: { status: "missing" },
    uuidMaps: { customers: { "customer-1": uuid(91) }, projects: { "project-1": uuid(92) }, estimates: {}, invoices: {}, invoicePayments: {} },
    estimateEvidence: {},
  });

  test("requires a persisted clean queue and supplied storage, never a synthesized default", () => {
    const local = { ...emptySnapshot(), customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1", notes: "stale" }] };
    const cloud = { ...local, projects: [{ ...local.projects[0], notes: "cloud" }] };
    const snapshot = bootstrapSnapshot(cloud);
    expect(buildCleanReplicaBootstrapProof({ storage: localStorage, companyId: "company-1", local, cloud, cloudSnapshot: snapshot })).toEqual(expect.objectContaining({ ok: false, code: "baseline_bootstrap_queue_missing" }));
    setVerifiedCleanQueue();
    expect(buildCleanReplicaBootstrapProof({ storage: localStorage, companyId: "company-1", local, cloud, cloudSnapshot: snapshot })).toEqual(expect.objectContaining({ ok: true, bootstrap: true, bootstrapReason: "verified_clean_replica" }));
  });

  test("replaces only proven stale shared records, preserves order, and appends cloud additions", () => {
    const local = { ...emptySnapshot(), customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1", notes: "stale" }] };
    const cloud = { ...local, projects: [{ ...local.projects[0], notes: "canonical" }, { id: "project-2", customerId: "customer-1", notes: "added" }] };
    setVerifiedCleanQueue();
    const plan = buildCloudConvergencePlan({ local, cloud, companyId: "company-1", storage: localStorage, cloudSnapshot: bootstrapSnapshot(cloud) });
    expect(plan).toEqual(expect.objectContaining({ safe: true, bootstrap: true, bootstrapReason: "verified_clean_replica" }));
    expect(plan.replacements.projects).toEqual([cloud.projects[0]]);
    expect(plan.additions.projects).toEqual([cloud.projects[1]]);
  });

  test("returns safe conflict diagnostics while preserving data_mismatch compatibility when bootstrap proof fails", async () => {
    const local = { ...emptySnapshot(), customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1", notes: "stale" }] };
    const cloud = { ...local, projects: [{ ...local.projects[0], notes: "cloud" }] };
    setLocalSnapshot(local);
    const result = await runSupabaseCloudConvergence({ storage: localStorage, configured: true, user: { id: "u" }, company: { id: "company-1" }, cloudSnapshot: bootstrapSnapshot(cloud) });
    expect(result).toEqual(expect.objectContaining({ status: "conflict", code: "data_mismatch", bootstrapCode: "baseline_bootstrap_queue_missing" }));
    expect(result.conflictSummary).toEqual([{ family: "projects", code: "both_added_different", count: 1 }]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS))).toEqual(local.projects);
  });

  test("applies a verified bootstrap locally, captures baseline and creates bindings without cloud writes", async () => {
    const local = { ...emptySnapshot(), customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1", notes: "stale" }] };
    const cloud = { ...local, projects: [{ ...local.projects[0], notes: "canonical" }] };
    setLocalSnapshot(local); setVerifiedCleanQueue("company-1", 0);
    const verifyCloud = jest.fn(async () => ({ ok: true, allMatched: true, notices: [], blockers: [], repairs: [] }));
    const result = await runSupabaseCloudConvergence({ storage: localStorage, configured: true, user: { id: "u" }, company: { id: "company-1" }, deviceAccess: { ok: true }, completionDeviceAccess: { ok: true }, cloudSnapshot: bootstrapSnapshot(cloud), verifyCloud });
    expect(result).toEqual(expect.objectContaining({ ok: true, status: "converged", bootstrap: true, bootstrapReason: "verified_clean_replica", noCloudWritesPerformed: true }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS))).toEqual(cloud.projects);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).snapshots.projects).toEqual(cloud.projects);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_ASSET_BINDINGS)).bindings.project["project-1"].cloudUuid).toBe(uuid(92));
    expect(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();
    expect(verifyCloud).toHaveBeenCalled();
  });

  test.each([
    ["pending queue", () => { setVerifiedCleanQueue(); const state = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)); state.pending = true; state.status = "pending"; localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify(state)); }, "baseline_bootstrap_local_pending"],
    ["company mismatch", () => setVerifiedCleanQueue("other-company"), "baseline_bootstrap_queue_unverified"],
    ["local-only record", () => setVerifiedCleanQueue(), "baseline_bootstrap_local_only_records"],
  ])("fails closed for %s", (_label, setup, expectedCode) => {
    const local = { ...emptySnapshot(), customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1" }] };
    const cloud = expectedCode === "baseline_bootstrap_local_only_records" ? { ...emptySnapshot() } : local;
    setup();
    expect(buildCleanReplicaBootstrapProof({ storage: localStorage, companyId: "company-1", local, cloud, cloudSnapshot: bootstrapSnapshot(cloud) })).toEqual(expect.objectContaining({ ok: false, code: expectedCode }));
  });
});

test("baseline permits non-overlapping customer metadata changes but never relationship changes", () => {
  expect(mergeNonOverlappingCloudMetadata({ family: "customers", baseline: { id: "c", phone: "1", email: "a" }, local: { id: "c", phone: "2", email: "a" }, cloud: { id: "c", phone: "1", email: "b" } })).toEqual({ id: "c", phone: "2", email: "b" });
  expect(mergeNonOverlappingCloudMetadata({ family: "projects", baseline: { id: "p", customerId: "c1" }, local: { id: "p", customerId: "c2" }, cloud: { id: "p", customerId: "c1", notes: "x" } })).toBeNull();
});


test("baseline deletion ambiguity and project relationship mismatch fail closed", () => {
  expect(classifyCloudConvergenceEntity({ local: null, cloud: { id: "c" }, baseline: { id: "c" } })).toBe("local_missing_since_baseline");
  const plan = buildCloudConvergencePlan({ local: { customers: [{ id: "c1" }], projects: [] }, cloud: { customers: [{ id: "c1" }], projects: [{ id: "p", customerId: "missing" }] } });
  expect(plan.safe).toBe(false); expect(plan.conflicts[0].family).toBe("relationships");
  expect(normalizeProjectContract({ id: "p", customerId: "c", projectName: "Name" }).customerId).toBe("c");
});

test("local missing since baseline is ineligible and does not import the cloud customer", () => {
  const customer = { id: "customer-baseline", fullName: "Preserved" };
  const plan = buildCloudConvergencePlan({ local: { customers: [], projects: [] }, cloud: { customers: [customer], projects: [] }, baseline: { customers: [customer], projects: [] } });
  expect(plan.safe).toBe(false);
  expect(plan.classifications).toEqual(expect.arrayContaining([expect.objectContaining({ family: "customers", id: "customer-baseline", classification: "local_missing_since_baseline" })]));
  expect(plan.additions.customers).toEqual([]);
});

test("cloud missing since baseline is ineligible and preserves the local customer", () => {
  const customer = { id: "customer-cloud-missing", fullName: "Preserved locally" };
  const plan = buildCloudConvergencePlan({ local: { customers: [customer], projects: [] }, cloud: { customers: [], projects: [] }, baseline: { customers: [customer], projects: [] } });
  expect(plan.safe).toBe(false);
  expect(plan.classifications).toEqual(expect.arrayContaining([expect.objectContaining({ family: "customers", id: "customer-cloud-missing", classification: "cloud_missing_since_baseline" })]));
  expect(plan.additions.customers).toEqual([]);
});

test("project local missing since baseline is ineligible and does not import the cloud project", () => {
  const customer = { id: "customer-shared" };
  const project = { id: "project-baseline", customerId: "customer-shared", projectName: "Preserved" };
  const plan = buildCloudConvergencePlan({ local: { customers: [customer], projects: [] }, cloud: { customers: [customer], projects: [project] }, baseline: { customers: [customer], projects: [project] } });
  expect(plan.safe).toBe(false);
  expect(plan.classifications).toEqual(expect.arrayContaining([expect.objectContaining({ family: "projects", id: "project-baseline", classification: "local_missing_since_baseline" })]));
  expect(plan.additions.projects).toEqual([]);
});

test("no-baseline disjoint customer and project graphs union without changing local prefixes", () => {
  const localCustomer = { id: "local-customer", fullName: "Local" };
  const localProject = { id: "local-project", customerId: "local-customer", projectName: "Local project" };
  const cloudCustomer = { id: "cloud-customer", fullName: "Cloud" };
  const cloudProject = { id: "cloud-project", customerId: "cloud-customer", projectName: "Cloud project" };
  const plan = buildCloudConvergencePlan({ local: { customers: [localCustomer], projects: [localProject] }, cloud: { customers: [cloudCustomer], projects: [cloudProject] } });
  expect(plan.safe).toBe(true);
  expect(plan.localOnly).toBe(true);
  expect(plan.additions.customers).toEqual([cloudCustomer]);
  expect(plan.additions.projects).toEqual([cloudProject]);
});

test("relationship: cloud-only customer is planned before its dependent project", () => {
  const customer = { id: "customer-cloud", fullName: "Cloud" };
  const project = { id: "project-cloud", customerId: "customer-cloud", projectName: "Cloud project" };
  const plan = buildCloudConvergencePlan({ local: { customers: [], projects: [] }, cloud: { customers: [customer], projects: [project] } });
  expect(plan.safe).toBe(true); expect(plan.additions.customers).toEqual([customer]); expect(plan.additions.projects).toEqual([project]);
});

test("relationship: missing or re-parented project customer blocks without additions", () => {
  const missing = buildCloudConvergencePlan({ local: { customers: [], projects: [] }, cloud: { customers: [], projects: [{ id: "project-bad", customerId: "missing", projectName: "Bad" }] } });
  expect(missing.safe).toBe(false); expect(missing.additions.customers).toEqual([]); expect(missing.additions.projects).toEqual([]);
  const reparented = buildCloudConvergencePlan({ local: { customers: [{ id: "customer-a" }], projects: [{ id: "project", customerId: "customer-a", projectName: "P" }] }, cloud: { customers: [{ id: "customer-a" }, { id: "customer-b" }], projects: [{ id: "project", customerId: "customer-b", projectName: "P" }] } });
  expect(reparented.safe).toBe(false);
});

test.each([
  ["residential aliases", { id: "r", customerType: "residential", name: "R", resPhone: "1", resEmail: "r@example.test" }, { id: "r", type: "residential", displayName: "R", phone: "1", email: "r@example.test" }],
  ["commercial aliases", { id: "c", customerType: "commercial", companyName: "Co", attn: "Pat", comPhone: "2", comEmail: "c@example.test" }, { id: "c", type: "commercial", displayName: "Co", contactName: "Pat", phone: "2", email: "c@example.test" }],
])("customer %s normalize to the persisted comparison contract", (_label, input, expected) => {
  expect(normalizeCustomerContract(input)).toEqual(expect.objectContaining(expected));
});

test("customer and project no-baseline additions retain local rows and queue local-only work", () => {
  const local = { ...emptySnapshot(), customers: [{ id: "local-c", fullName: "Local" }], projects: [{ id: "local-p", customerId: "local-c", projectName: "Local" }] };
  const cloud = { ...emptySnapshot(), customers: [{ id: "cloud-c", fullName: "Cloud" }], projects: [{ id: "cloud-p", customerId: "cloud-c", projectName: "Cloud" }] };
  const plan = buildCloudConvergencePlan({ local, cloud });
  expect(plan.safe).toBe(true); expect(plan.localOnly).toBe(true);
  expect(plan.additions.customers).toEqual(cloud.customers); expect(plan.additions.projects).toEqual(cloud.projects);
  expect(plan.replacements.customers).toEqual([]); expect(plan.replacements.projects).toEqual([]);
});

test("baseline customer and project changes classify remote, local, same, merge, and conflict paths", () => {
  const customer = { id: "c", fullName: "Name", phone: "1", email: "a@example.test" };
  const project = { id: "p", customerId: "c", projectNumber: "P-1", projectName: "Name", notes: "a", scopeNotes: "s" };
  const baseline = { ...emptySnapshot(), customers: [customer], projects: [project] };
  const remote = buildCloudConvergencePlan({ local: baseline, cloud: { ...baseline, customers: [{ ...customer, phone: "2" }], projects: [{ ...project, notes: "cloud" }] }, baseline });
  expect(remote.replacements.customers).toHaveLength(1); expect(remote.replacements.projects).toHaveLength(1);
  const localOnly = buildCloudConvergencePlan({ local: { ...baseline, customers: [{ ...customer, phone: "2" }], projects: [{ ...project, notes: "local" }] }, cloud: baseline, baseline });
  expect(localOnly.safe).toBe(true); expect(localOnly.localOnly).toBe(true);
  const same = buildCloudConvergencePlan({ local: { ...baseline, customers: [{ ...customer, phone: "2" }], projects: [project] }, cloud: { ...baseline, customers: [{ ...customer, phone: "2" }], projects: [project] }, baseline });
  expect(same.classifications).toEqual(expect.arrayContaining([expect.objectContaining({ family: "customers", classification: "both_changed_same" })]));
  const merged = buildCloudConvergencePlan({ local: { ...baseline, customers: [{ ...customer, phone: "2" }], projects: [{ ...project, notes: "local" }] }, cloud: { ...baseline, customers: [{ ...customer, email: "b@example.test" }], projects: [{ ...project, scopeNotes: "cloud" }] }, baseline });
  expect(merged.safe).toBe(true); expect(merged.classifications).toEqual(expect.arrayContaining([expect.objectContaining({ classification: "both_changed_non_overlapping" })]));
  const conflict = buildCloudConvergencePlan({ local: { ...baseline, customers: [{ ...customer, phone: "2" }] }, cloud: { ...baseline, customers: [{ ...customer, phone: "3" }] }, baseline });
  expect(conflict.safe).toBe(false); expect(conflict.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "customers", code: "both_changed_conflict" })]));
});

test("project cloud-only addition with a shared customer is safe and customer writes precede projects", () => {
  const customer = { id: "c", fullName: "Shared" }; const project = { id: "p", customerId: "c", projectName: "Added" };
  const plan = buildCloudConvergencePlan({ local: { ...emptySnapshot(), customers: [customer] }, cloud: { ...emptySnapshot(), customers: [customer], projects: [project] } });
  expect(plan.safe).toBe(true); expect(plan.additions.projects).toEqual([project]);
});

test("customer/project duplicate identities and ambiguous parents block the full graph", () => {
  const duplicate = buildCloudConvergencePlan({ local: { ...emptySnapshot(), customers: [{ id: "c" }, { id: "c" }] }, cloud: emptySnapshot() });
  const ambiguous = buildCloudConvergencePlan({ local: emptySnapshot(), cloud: { ...emptySnapshot(), customers: [{ id: "c" }, { id: "c" }], projects: [{ id: "p", customerId: "c" }] } });
  expect(duplicate.safe).toBe(false); expect(ambiguous.safe).toBe(false);
});

test("customer and project bindings prove re-keyed exact identities and create missing bindings only after proof", () => {
  const local = { ...emptySnapshot(), customers: [{ id: "local-c", fullName: "Same" }], projects: [{ id: "local-p", customerId: "local-c", projectName: "Same" }] };
  const cloud = { ...emptySnapshot(), customers: [{ id: "cloud-c", fullName: "Same" }], projects: [{ id: "cloud-p", customerId: "cloud-c", projectName: "Same" }] };
  const snapshot = { uuidMaps: { customers: { "cloud-c": uuid(1) }, projects: { "cloud-p": uuid(2) } } };
  const missing = buildCloudConvergencePlan({ local, cloud, cloudSnapshot: snapshot, companyId: "company-1" });
  expect(missing.safe).toBe(true); expect(missing.bindingEntries).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: "customer", localLegacyId: "local-c", cloudUuid: uuid(1) }), expect.objectContaining({ entityType: "project", localLegacyId: "local-p", cloudUuid: uuid(2) })]));
  setBindings({ customer: { "local-c": { cloudUuid: uuid(1), companyId: "company-1" } }, project: { "local-p": { cloudUuid: uuid(2), companyId: "company-1" } } });
  const proven = buildCloudConvergencePlan({ local, cloud, cloudSnapshot: snapshot, companyId: "company-1" });
  expect(proven.safe).toBe(true); expect(proven.additions.customers).toEqual([]); expect(proven.additions.projects).toEqual([]);
});

test("stale customer binding repairs only one exact candidate and binding contradictions block", () => {
  const local = { ...emptySnapshot(), customers: [{ id: "local-c", fullName: "Same" }] };
  const cloud = { ...emptySnapshot(), customers: [{ id: "cloud-c", fullName: "Same" }] };
  const snapshot = { uuidMaps: { customers: { "cloud-c": uuid(3) }, projects: {} } };
  setBindings({ customer: { "local-c": { cloudUuid: uuid(4), companyId: "company-1" } } });
  const repaired = buildCloudConvergencePlan({ local, cloud, cloudSnapshot: snapshot, companyId: "company-1" });
  expect(repaired.safe).toBe(true); expect(repaired.bindingEntries).toEqual(expect.arrayContaining([expect.objectContaining({ reconciliation: true, cloudUuid: uuid(3) })]));
  setBindings({ customer: { "local-a": { cloudUuid: uuid(3), companyId: "company-1" }, "local-b": { cloudUuid: uuid(3), companyId: "company-1" } } });
  const collision = buildCloudConvergencePlan({ local: { ...emptySnapshot(), customers: [{ id: "local-a", fullName: "Same" }, { id: "local-b", fullName: "Same" }] }, cloud, cloudSnapshot: snapshot, companyId: "company-1" });
  expect(collision.safe).toBe(false); expect(collision.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "customers:binding_uuid_reused" })]));
});

test("a customer deletion ambiguity records a deduplicated, normalized vault entry without changing active arrays", async () => {
  const customer = { id: "c", fullName: "Private Name", resEmail: "private@example.test" };
  setLocalSnapshot({ ...emptySnapshot() }); setBaseline({ customers: [customer] });
  const snapshot = { ok: true, mapped: { ...emptySnapshot(), customers: [customer] }, uuidMaps: { customers: { c: uuid(5) } }, supplemental: { status: "missing" } };
  const run = () => runSupabaseCloudConvergence({ storage: localStorage, configured: true, user: { id: "u" }, company: { id: "company-1" }, cloudSnapshot: snapshot });
  expect((await run()).status).toBe("conflict"); const first = localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT);
  expect(JSON.parse(first).entries).toEqual([expect.objectContaining({ entityFamily: "customers", stableIdentity: "c", classificationCode: "local_missing_since_baseline", cloudUuid: uuid(5), localSnapshot: null })]);
  expect((await run()).status).toBe("conflict"); expect(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT)).toBe(first);
  expect(localStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toBe("[]");
});

test("project cloud missing since baseline is an ineligible deletion ambiguity without a cloud write", () => {
  const customer = { id: "c", fullName: "Customer" }; const project = { id: "p", customerId: "c", projectName: "Preserved" };
  const plan = buildCloudConvergencePlan({ local: { ...emptySnapshot(), customers: [customer], projects: [project] }, cloud: { ...emptySnapshot(), customers: [customer] }, baseline: { ...emptySnapshot(), customers: [customer], projects: [project] } });
  expect(plan.safe).toBe(false); expect(plan.additions.projects).toEqual([]);
  expect(plan.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "projects", id: "p", code: "cloud_missing_since_baseline" })]));
});

test("a no-baseline mixed customer/project union skips immediate verification and keeps backup pending", async () => {
  const local = { ...emptySnapshot(), customers: [{ id: "local-c", fullName: "Local" }], projects: [{ id: "local-p", customerId: "local-c", projectName: "Local" }] };
  const cloud = { ...emptySnapshot(), customers: [{ id: "cloud-c", fullName: "Cloud" }], projects: [{ id: "cloud-p", customerId: "cloud-c", projectName: "Cloud" }] };
  setLocalSnapshot(local); const verifyCloud = jest.fn();
  const result = await runSupabaseCloudConvergence({ storage: localStorage, configured: true, user: { id: "u" }, company: { id: "company-1" }, deviceAccess: { ok: true }, cloudSnapshot: { ok: true, mapped: cloud, uuidMaps: { customers: { "cloud-c": uuid(6) }, projects: { "cloud-p": uuid(7) } }, supplemental: { status: "missing" } }, verifyCloud });
  expect(result).toEqual(expect.objectContaining({ ok: true, status: "converged", localOnly: true, noCloudWritesPerformed: true }));
  expect(verifyCloud).not.toHaveBeenCalled(); expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)).pending).toBe(true);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toEqual([...local.customers, ...cloud.customers]);
});

test("binding to a different existing customer row blocks and leaves active arrays untouched", () => {
  const local = { ...emptySnapshot(), customers: [{ id: "c", fullName: "Same" }] };
  const cloud = { ...emptySnapshot(), customers: [{ id: "c", fullName: "Same" }] };
  setBindings({ customer: { c: { cloudUuid: uuid(8), companyId: "company-1" } } });
  const plan = buildCloudConvergencePlan({ local, cloud, cloudSnapshot: { uuidMaps: { customers: { c: uuid(9) }, projects: {} } }, companyId: "company-1" });
  expect(plan.safe).toBe(false); expect(plan.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "customers:binding_conflict" })]));
});

test("vault write failure restores the exact prior vault string and preserves customer/project arrays", async () => {
  const customer = { id: "c", fullName: "Private" }; setLocalSnapshot(emptySnapshot()); setBaseline({ customers: [customer] });
  const priorVault = JSON.stringify({ version: 1, companyId: "company-1", entries: [{ key: "prior" }] }); localStorage.setItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT, priorVault);
  let failOnce = true;
  const storage = {
    getItem: (key) => localStorage.getItem(key), removeItem: (key) => localStorage.removeItem(key),
    setItem: (key, value) => { if (key === STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT && failOnce) { failOnce = false; throw new Error("vault unavailable"); } localStorage.setItem(key, value); },
  };
  const result = await runSupabaseCloudConvergence({ storage, configured: true, user: { id: "u" }, company: { id: "company-1" }, cloudSnapshot: { ok: true, mapped: { ...emptySnapshot(), customers: [customer] }, uuidMaps: { customers: { c: uuid(10) } }, supplemental: { status: "missing" } } });
  expect(result).toEqual(expect.objectContaining({ ok: false, status: "rolled_back", code: "conflict_vault_write_failed" }));
  expect(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT)).toBe(priorVault);
  expect(localStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toBe("[]"); expect(localStorage.getItem(STORAGE_KEYS.PROJECTS)).toBe("[]");
});

test("estimate comparison treats the complete persisted document as money-critical", () => {
  const base = estimate("e", { labor: { lines: [{ id: "l", hours: 1, rate: 5 }] } });
  expect(normalizeEstimateContract(base)).toEqual(expect.objectContaining({ id: "e", customerId: "customer-1", projectId: "project-1" }));
  const parents = { customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1" }] };
  const changed = buildCloudConvergencePlan({ local: { ...emptySnapshot(), ...parents, estimates: [base] }, cloud: { ...emptySnapshot(), ...parents, estimates: [{ ...base, labor: { lines: [{ id: "l", hours: 2, rate: 5 }] } }] } });
  expect(changed.safe).toBe(false); expect(changed.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "estimates", code: "both_added_different" })]));
});

test("valid cloud-only estimate imports only with parents and exact restore-payload evidence", () => {
  const row = estimate("cloud-estimate"); const parents = { customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1" }] };
  const plan = buildCloudConvergencePlan({ local: { ...emptySnapshot(), ...parents }, cloud: { ...emptySnapshot(), ...parents, estimates: [row] }, cloudSnapshot: { uuidMaps: { estimates: { "cloud-estimate": uuid(11) } }, estimateEvidence: { "cloud-estimate": estimateEvidence(row) } }, companyId: "company-1" });
  expect(plan.safe).toBe(true); expect(plan.additions.estimates).toEqual([row]);
});

test.each([
  ["missing payload", null, "estimate_restore_payload_missing"],
  ["invalid payload", { restorePayload: { schema: "bad", version: 1, legacyLocalId: "cloud-estimate", estimate: estimate("cloud-estimate") } }, "estimate_restore_payload_invalid"],
  ["child mismatch", { lineItems: [{ legacy_local_id: "unexpected" }] }, "estimate_line_item_mismatch"],
])("estimate %s blocks with no partial import", (_label, evidenceOverride, code) => {
  const row = estimate("cloud-estimate"); const parents = { customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1" }] };
  const evidence = evidenceOverride === null ? null : { ...estimateEvidence(row), ...evidenceOverride };
  const plan = buildCloudConvergencePlan({ local: { ...emptySnapshot(), ...parents }, cloud: { ...emptySnapshot(), ...parents, estimates: [row] }, cloudSnapshot: { uuidMaps: { estimates: { "cloud-estimate": uuid(12) } }, estimateEvidence: { "cloud-estimate": evidence } }, companyId: "company-1" });
  expect(plan.safe).toBe(false); expect(plan.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "estimates", id: "cloud-estimate", code })]));
});

test("baseline estimate supports remote replacement, local-only queueing, same final state, and blocks concurrent differences", () => {
  const base = estimate("e"); const parents = { customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1" }] }; const baseline = { ...emptySnapshot(), ...parents, estimates: [base] };
  const remoteRow = estimate("e", { notes: "cloud" }); const snapshot = { uuidMaps: { estimates: { e: uuid(13) } }, estimateEvidence: { e: estimateEvidence(remoteRow) } };
  const remote = buildCloudConvergencePlan({ local: baseline, cloud: { ...baseline, estimates: [remoteRow] }, baseline, cloudSnapshot: snapshot, companyId: "company-1" });
  expect(remote.safe).toBe(true); expect(remote.replacements.estimates).toEqual([remoteRow]);
  const localOnly = buildCloudConvergencePlan({ local: { ...baseline, estimates: [estimate("e", { notes: "local" })] }, cloud: baseline, baseline });
  expect(localOnly.safe).toBe(true); expect(localOnly.localOnly).toBe(true);
  const same = buildCloudConvergencePlan({ local: { ...baseline, estimates: [remoteRow] }, cloud: { ...baseline, estimates: [remoteRow] }, baseline });
  expect(same.classifications).toEqual(expect.arrayContaining([expect.objectContaining({ family: "estimates", classification: "both_changed_same" })]));
  const conflict = buildCloudConvergencePlan({ local: { ...baseline, estimates: [estimate("e", { notes: "local" })] }, cloud: { ...baseline, estimates: [remoteRow] }, baseline, cloudSnapshot: snapshot, companyId: "company-1" });
  expect(conflict.safe).toBe(false); expect(conflict.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "estimates", code: "both_changed_conflict" })]));
});

test("estimate conversion links require an already-safe matching invoice and deletion ambiguity remains ineligible", () => {
  const row = estimate("e", { convertedInvoiceId: "invoice-1" }); const parents = { customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1" }] };
  const missing = buildCloudConvergencePlan({ local: { ...emptySnapshot(), ...parents }, cloud: { ...emptySnapshot(), ...parents, estimates: [row] }, cloudSnapshot: { estimateEvidence: { e: estimateEvidence(row) } } });
  expect(missing.safe).toBe(false); expect(missing.conflicts[0].code).toBe("estimate_converted_invoice_relationship");
  const linked = buildCloudConvergencePlan({ local: { ...emptySnapshot(), ...parents, invoices: [{ id: "invoice-1", sourceEstimateId: "e" }] }, cloud: { ...emptySnapshot(), ...parents, invoices: [{ id: "invoice-1", sourceEstimateId: "e" }], estimates: [row] }, cloudSnapshot: { uuidMaps: { estimates: { e: uuid(14) } }, estimateEvidence: { e: estimateEvidence(row) } }, companyId: "company-1" });
  expect(linked.safe).toBe(true);
  const gone = buildCloudConvergencePlan({ local: { ...emptySnapshot(), ...parents }, cloud: { ...emptySnapshot(), ...parents, estimates: [estimate("gone")] }, baseline: { ...emptySnapshot(), ...parents, estimates: [estimate("gone")] } });
  expect(gone.safe).toBe(false); expect(gone.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "estimates", code: "local_missing_since_baseline" })]));
});

test("invoice comparison treats the header, line items, and payments as one financial document", () => {
  const base = invoice("i"); const changed = { ...base, lineItems: [{ ...base.lineItems[0], quantity: 2 }], payments: [{ id: "pay-1", amount: 5, method: "card", status: "paid", paidAt: "2026-01-01" }] };
  expect(normalizeInvoiceContract(base)).toEqual(expect.objectContaining({ id: "i", customerId: "customer-1", sourceEstimateId: "estimate-1" }));
  const plan = buildCloudConvergencePlan({ local: { ...baseLocal(), invoices: [base] }, cloud: { ...baseLocal(), invoices: [changed] } });
  expect(plan.safe).toBe(false); expect(plan.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "invoices", code: "both_added_different" })]));
});

test("valid cloud-only invoice imports atomically with its line items and payments while local-only invoices remain queued", () => {
  const local = baseLocal(); const cloudOnly = { ...invoice("cloud-invoice"), lineItems: [{ id: "cloud-line", description: "Labor", quantity: 1, price: 10, total: 10 }], payments: [{ id: "cloud-payment", amount: 10, method: "cash", status: "paid", paidAt: "2026-01-01" }] };
  const cloud = { ...baseLocal(), invoices: [invoice("invoice-1"), cloudOnly] };
  const plan = buildCloudConvergencePlan({ local, cloud });
  expect(plan.safe).toBe(true); expect(plan.additions.invoices).toEqual([cloudOnly]);
  const disjoint = buildCloudConvergencePlan({ local: { ...local, invoices: [invoice("local-invoice")] }, cloud: { ...cloud, invoices: [cloudOnly] } });
  expect(disjoint.safe).toBe(true); expect(disjoint.localOnly).toBe(true); expect(disjoint.additions.invoices).toEqual([cloudOnly]);
});

test.each([
  ["duplicate invoice number", { invoices: [invoice("a"), { ...invoice("b"), invoiceNumber: "a" }] }, "invoice_duplicate_number"],
  ["duplicate child identity", { invoices: [{ ...invoice("a"), lineItems: [{ id: "line" }, { id: "line" }] }] }, "invoice_line_item_duplicate_identity"],
  ["duplicate payment identity", { invoices: [{ ...invoice("a"), payments: [{ id: "pay" }, { id: "pay" }] }] }, "invoice_payment_duplicate_identity"],
])("invoice %s blocks the whole graph", (_label, partial, code) => {
  const cloud = { ...emptySnapshot(), customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1" }], estimates: [{ id: "estimate-1", customerId: "customer-1", projectId: "project-1" }], ...partial };
  const plan = buildCloudConvergencePlan({ local: emptySnapshot(), cloud });
  expect(plan.safe).toBe(false); expect(plan.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
});

test("baseline invoice replaces only a proven remote complete document, preserves local-only changes, and blocks concurrent finances", () => {
  const base = invoice("invoice-1"); const local = { ...baseLocal(), invoices: [base] }; const remote = { ...base, notes: "cloud", payments: [{ id: "p", amount: 2, method: "cash", status: "paid", paidAt: "2026-01-01" }] };
  const replaced = buildCloudConvergencePlan({ local, cloud: { ...local, invoices: [remote] }, baseline: local });
  expect(replaced.safe).toBe(true); expect(replaced.replacements.invoices).toEqual([remote]);
  const localOnly = buildCloudConvergencePlan({ local: { ...local, invoices: [{ ...base, notes: "local" }] }, cloud: local, baseline: local });
  expect(localOnly.safe).toBe(true); expect(localOnly.localOnly).toBe(true);
  const conflict = buildCloudConvergencePlan({ local: { ...local, invoices: [{ ...base, amountPaid: 1 }] }, cloud: { ...local, invoices: [remote] }, baseline: local });
  expect(conflict.safe).toBe(false); expect(conflict.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "invoices", code: "both_changed_conflict" })]));
});

test("invoice parent, source-estimate, and payment binding contradictions fail closed", () => {
  const badParent = buildCloudConvergencePlan({ local: emptySnapshot(), cloud: { ...emptySnapshot(), customers: [{ id: "c" }], projects: [{ id: "p", customerId: "c" }], estimates: [{ id: "e", customerId: "c", projectId: "p" }], invoices: [{ ...invoice("i"), customerId: "other", projectId: "p", sourceEstimateId: "e" }] } });
  expect(badParent.safe).toBe(false); expect(badParent.conflicts[0].code).toBe("invoice_customer_relationship");
  const local = { ...baseLocal(), invoices: [{ ...invoice("invoice-1"), payments: [{ id: "pay", amount: 1 }] }] }; const cloud = local;
  setBindings({ invoice_payment: { pay: { cloudUuid: uuid(15), companyId: "company-1" } } });
  const binding = buildCloudConvergencePlan({ local, cloud, cloudSnapshot: { uuidMaps: { invoices: { "invoice-1": uuid(16) }, invoicePayments: { pay: uuid(17) } } }, companyId: "company-1" });
  expect(binding.safe).toBe(false); expect(binding.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invoice_payments:binding_conflict" })]));
});

test("invoice baseline disappearance is ineligible and records only a safe conflict result", () => {
  const row = invoice("gone"); const base = { ...baseLocal(), invoices: [row] };
  const localMissing = buildCloudConvergencePlan({ local: { ...base, invoices: [] }, cloud: base, baseline: base });
  const cloudMissing = buildCloudConvergencePlan({ local: base, cloud: { ...base, invoices: [] }, baseline: base });
  expect(localMissing.safe).toBe(false); expect(cloudMissing.safe).toBe(false);
  expect(localMissing.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "invoices", code: "local_missing_since_baseline" })]));
  expect(cloudMissing.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "invoices", code: "cloud_missing_since_baseline" })]));
});

test("company profile converges as one protected record without field merges", () => {
  const base = { companyName: "A", address: "One" };
  const cloudOnly = buildCloudConvergencePlan({ local: emptySnapshot(), cloud: { ...emptySnapshot(), companyProfile: base } });
  expect(cloudOnly.safe).toBe(true); expect(cloudOnly.supplemental.companyProfile).toEqual(base);
  const localOnly = buildCloudConvergencePlan({ local: { ...emptySnapshot(), companyProfile: base }, cloud: emptySnapshot() });
  expect(localOnly.safe).toBe(true); expect(localOnly.localOnly).toBe(true);
  const remote = buildCloudConvergencePlan({ local: { ...emptySnapshot(), companyProfile: base }, cloud: { ...emptySnapshot(), companyProfile: { ...base, address: "Cloud" } }, baseline: { ...emptySnapshot(), companyProfile: base } });
  expect(remote.safe).toBe(true); expect(remote.supplemental.companyProfile).toEqual({ ...base, address: "Cloud" });
  const conflict = buildCloudConvergencePlan({ local: { ...emptySnapshot(), companyProfile: { ...base, address: "Local" } }, cloud: { ...emptySnapshot(), companyProfile: { ...base, address: "Cloud" } }, baseline: { ...emptySnapshot(), companyProfile: base } });
  expect(conflict.safe).toBe(false); expect(conflict.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "companyProfile", code: "both_changed_conflict" })]));
});

test("settings use only the existing bundle record and block malformed or baseline disappearance", () => {
  const base = { currency: "USD", taxRate: 5 };
  const remote = buildCloudConvergencePlan({ local: { ...emptySnapshot(), settings: base }, cloud: { ...emptySnapshot(), settings: { currency: "CAD", taxRate: 5 } }, baseline: { ...emptySnapshot(), settings: base } });
  expect(remote.safe).toBe(true); expect(remote.supplemental.settings).toEqual({ currency: "CAD", taxRate: 5 });
  const malformed = buildCloudConvergencePlan({ local: emptySnapshot(), cloud: { ...emptySnapshot(), settings: [] } });
  expect(malformed.safe).toBe(false); expect(malformed.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "settings", code: "malformed_supplemental_record" })]));
  const missing = buildCloudConvergencePlan({ local: { ...emptySnapshot(), settings: base }, cloud: emptySnapshot(), baseline: { ...emptySnapshot(), settings: base } });
  expect(missing.safe).toBe(false); expect(missing.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "settings", code: "cloud_missing_since_baseline" })]));
});

test("scope templates form a safe disjoint union but never field-merge or accept duplicates", () => {
  const localTemplate = { id: "local", name: "Local", scopeText: "L" }; const cloudTemplate = { id: "cloud", name: "Cloud", scopeText: "C" };
  const union = buildCloudConvergencePlan({ local: { ...emptySnapshot(), scopeTemplates: [localTemplate] }, cloud: { ...emptySnapshot(), scopeTemplates: [cloudTemplate] } });
  expect(union.safe).toBe(true); expect(union.localOnly).toBe(true); expect(union.additions.scopeTemplates).toEqual([cloudTemplate]);
  const base = { ...emptySnapshot(), scopeTemplates: [localTemplate] };
  const concurrent = buildCloudConvergencePlan({ local: { ...base, scopeTemplates: [{ ...localTemplate, name: "Local 2" }] }, cloud: { ...base, scopeTemplates: [{ ...localTemplate, name: "Cloud 2" }] }, baseline: base });
  expect(concurrent.safe).toBe(false); expect(concurrent.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "scopeTemplates", code: "both_changed_conflict" })]));
  const duplicate = buildCloudConvergencePlan({ local: { ...emptySnapshot(), scopeTemplates: [localTemplate, localTemplate] }, cloud: emptySnapshot() });
  expect(duplicate.safe).toBe(false); expect(duplicate.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ family: "scopeTemplates", code: "duplicate_identity" })]));
});

test("supplemental conflicts write a deduplicated vault entry without exposing data in ordinary results", async () => {
  const profile = { companyName: "Private", address: "Hidden" }; setLocalSnapshot({ ...emptySnapshot(), companyProfile: { ...profile, address: "Local" } }); setBaseline({ companyProfile: profile });
  expect(buildLocalSnapshotFromStorage(localStorage).snapshot.companyProfile).toEqual({ ...profile, address: "Local" });
  const snapshot = { ok: true, mapped: { ...emptySnapshot(), companyProfile: { ...profile, address: "Cloud" } }, uuidMaps: {}, supplemental: { status: "available" } };
  const result = await runSupabaseCloudConvergence({ storage: localStorage, configured: true, user: { id: "u" }, company: { id: "company-1" }, cloudSnapshot: snapshot });
  expect(result).toEqual(expect.objectContaining({ ok: false, status: "conflict", conflictCount: 1 })); expect(JSON.stringify(result)).not.toContain("Private");
  const vault = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT)); expect(vault.entries).toEqual([expect.objectContaining({ entityFamily: "companyProfile", classificationCode: "both_changed_conflict" })]);
});

test("safe convergence writes only additive local storage and never calls cloud mutation", async () => {
  const local = baseLocal();
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(local.customers));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(local.projects));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(local.estimates));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(local.invoices));
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({}));
  localStorage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({}));
  const cloud = { ...baseLocal(), invoices: [invoice("invoice-1"), invoice("invoice-2")] };
  const result = await runSupabaseCloudConvergence({
    storage: localStorage, configured: true, user: { id: "user-1" }, company: { id: "company-1" }, deviceAccess: { ok: true },
    completionDeviceAccess: { ok: true },
    cloudSnapshot: { ok: true, mapped: cloud, uuidMaps: { invoices: { "invoice-2": "10000000-0000-4000-8000-000000000002" } }, supplemental: { status: "missing" } },
    verifyCloud: jest.fn(async () => ({ ok: true, allMatched: true, notices: [] })),
  });
  expect(result).toEqual(expect.objectContaining({ ok: true, status: "converged", imported: 1, noCloudWritesPerformed: true }));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(2);
  expect(localStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toBe(JSON.stringify(local.customers));
});

test("failed strict cloud verification rolls back the exact prior invoice string", async () => {
  const local = baseLocal();
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(local.customers));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(local.projects));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(local.estimates));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(local.invoices));
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({}));
  localStorage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({}));
  const before = localStorage.getItem(STORAGE_KEYS.INVOICES);
  const result = await runSupabaseCloudConvergence({ storage: localStorage, configured: true, user: { id: "user-1" }, company: { id: "company-1" }, deviceAccess: { ok: true }, cloudSnapshot: { ok: true, mapped: { ...baseLocal(), invoices: [invoice("invoice-1"), invoice("invoice-2")] }, uuidMaps: {}, supplemental: { status: "missing" } }, verifyCloud: jest.fn(async () => ({ ok: false, allMatched: false, notices: [] })) });
  expect(result).toEqual(expect.objectContaining({ ok: false, status: "rolled_back", code: "cloud_verification_failed" }));
  expect(localStorage.getItem(STORAGE_KEYS.INVOICES)).toBe(before);
});

// ---------------------------------------------------------------------------
// Gate 16A: no-write matched verdicts require strict verification, and the exact
// live stale-device fixture (7 customers / 11 projects / 12 estimates /
// 9 invoices / 4 payments / 1 template, cloud +1 invoice with 6 children).
// ---------------------------------------------------------------------------
const { mapLocalEstimateToBackendEstimate } = require("../utils/backendDataMapper");
const { buildParentLineItemContract } = require("./cloudLineItemContract");

test("a no-write, non-local-only result requires strict verification before reporting matched", async () => {
  const local = baseLocal();
  setLocalSnapshot(local);
  setBaseline(local); // local == cloud == baseline -> nothing to write
  const snapshot = { ok: true, mapped: local, estimateEvidence: { "estimate-1": estimateEvidence(local.estimates[0]) }, supplemental: { status: "missing" } };

  // The verifier disagrees with the planner (cloud holds extra flattened rows).
  const verifyCloud = jest.fn(async () => ({ ok: true, allMatched: false, notices: [], blockers: [], availableRepairs: [] }));
  const before = localStorage.getItem(STORAGE_KEYS.INVOICES);
  const result = await runSupabaseCloudConvergence({ storage: localStorage, configured: true, user: { id: "u" }, company: { id: "company-1" }, cloudSnapshot: snapshot, verifyCloud });

  expect(verifyCloud).toHaveBeenCalledTimes(1);
  expect(result).toEqual(expect.objectContaining({ ok: false, status: "mismatch", code: "verification_mismatch", noWritesPerformed: true }));
  expect(result.mismatch).toEqual(expect.objectContaining({ allMatched: false }));
  expect(localStorage.getItem(STORAGE_KEYS.INVOICES)).toBe(before); // no local business write
});

test("a no-write result reports matched only when strict verification passes", async () => {
  const local = baseLocal();
  setLocalSnapshot(local);
  setBaseline(local);
  const snapshot = { ok: true, mapped: local, estimateEvidence: { "estimate-1": estimateEvidence(local.estimates[0]) }, supplemental: { status: "missing" } };
  const verifyCloud = jest.fn(async () => ({ ok: true, allMatched: true, notices: [], blockers: [], availableRepairs: [] }));
  const result = await runSupabaseCloudConvergence({ storage: localStorage, configured: true, user: { id: "u" }, company: { id: "company-1" }, cloudSnapshot: snapshot, verifyCloud });
  expect(verifyCloud).toHaveBeenCalledTimes(1);
  expect(result).toEqual(expect.objectContaining({ ok: true, status: "matched", noWritesPerformed: true, localOnly: false }));
});

function liveLocal() {
  const customers = Array.from({ length: 7 }, (_, i) => ({ id: `cust-${i + 1}`, fullName: `Customer ${i + 1}` }));
  const projects = Array.from({ length: 11 }, (_, i) => ({ id: `proj-${i + 1}`, customerId: `cust-${(i % 7) + 1}`, projectName: `Project ${i + 1}` }));
  const specs = [4, 3, 2, 2, 2, 2, 2, 2, 1, 2, 0, 0]; // total 22 line items
  const estimates = specs.map((count, i) => {
    const id = `est-${i + 1}`;
    const laborCount = Math.ceil(count / 2);
    const materialCount = count - laborCount;
    return estimate(id, {
      customerId: `cust-${(i % 7) + 1}`, projectId: `proj-${(i % 11) + 1}`, estimateNumber: `EST-${i + 1}`,
      labor: { lines: Array.from({ length: laborCount }, (_, j) => ({ id: `${id}-lab-${j}`, description: `Labor ${j}`, quantity: 1, rate: 100 + j, cost: 60 + j })) },
      materials: { items: Array.from({ length: materialCount }, (_, j) => ({ id: `${id}-mat-${j}`, description: `Material ${j}`, quantity: 1, price: 50 + j, cost: 30 + j })) },
    });
  });
  const invoices = Array.from({ length: 9 }, (_, i) => ({
    ...invoice(`inv-${i + 1}`), customerId: `cust-${(i % 7) + 1}`, projectId: `proj-${(i % 11) + 1}`, sourceEstimateId: `est-${i + 1}`, invoiceNumber: `INV-${i + 1}`,
    payments: i < 4 ? [{ id: `pay-${i + 1}`, amount: 25, method: "cash", status: "paid", paidAt: "2026-07-01" }] : [],
  }));
  return { ...emptySnapshot(), customers, projects, estimates, invoices, scopeTemplates: [{ id: "tmpl-1", name: "Template 1", scopeText: "Scope" }] };
}

function liveEstimateEvidence(estimates) {
  return Object.fromEntries(estimates.map((est) => {
    const mapped = mapLocalEstimateToBackendEstimate(est, {});
    const lineItems = buildParentLineItemContract({ entityType: "estimate", parentLegacyId: est.id, parentColumn: "estimate_id", items: mapped.line_items }).rows;
    return [est.id, { restorePayload: { schema: "estipaid.estimate.restore_payload", version: 1, legacyLocalId: est.id, estimate: est }, persisted: { legacy_local_id: est.id, customer_legacy_local_id: est.customerId, project_legacy_local_id: est.projectId }, lineItems }];
  }));
}

test("live stale-device fixture: the tenth cloud invoice imports atomically, existing data stays intact, and a second run is idempotent", async () => {
  const local = liveLocal();
  setLocalSnapshot(local);
  setBaseline(local); // verified baseline matching the stale local state
  // Clean local backup queue (a remote-only change must not need a pending entry).
  expect(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)).toBeNull();

  const cloudInvoice10 = {
    ...invoice("inv-10"), customerId: "cust-1", projectId: "proj-1", sourceEstimateId: "", invoiceNumber: "INV-10",
    lineItems: Array.from({ length: 6 }, (_, j) => ({ id: `inv-10-line-${j}`, description: `Line ${j}`, quantity: 1, price: 10 + j, total: 10 + j })),
    payments: [],
  };
  const snapshot = {
    ok: true,
    mapped: { ...local, invoices: [...local.invoices, cloudInvoice10] },
    estimateEvidence: liveEstimateEvidence(local.estimates),
    supplemental: { status: "missing" },
  };
  const verifyCloud = jest.fn(async () => ({ ok: true, allMatched: true, notices: [], blockers: [], availableRepairs: [] }));
  const ctx = { storage: localStorage, configured: true, user: { id: "u" }, company: { id: "company-1" }, deviceAccess: { ok: true }, completionDeviceAccess: { ok: true }, verifyCloud };

  const firstInvoicesBefore = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES));
  const result = await runSupabaseCloudConvergence({ ...ctx, cloudSnapshot: snapshot });

  // 4. The tenth invoice imports with all six children; strict verification ran.
  expect(result).toEqual(expect.objectContaining({ ok: true, status: "converged", imported: 1, noCloudWritesPerformed: true }));
  expect(verifyCloud).toHaveBeenCalledTimes(1);
  const invoicesAfter = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES));
  expect(invoicesAfter).toHaveLength(10);
  const imported = invoicesAfter.find((inv) => inv.id === "inv-10");
  expect(imported.lineItems).toHaveLength(6);
  // 5. Existing local invoices and their ordering remain intact.
  expect(invoicesAfter.slice(0, 9)).toEqual(firstInvoicesBefore);
  // Customers/projects/estimates arrays are untouched (additive only).
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toEqual(local.customers);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS))).toEqual(local.projects);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toEqual(local.estimates);
  // 9. The journal is removed only after success.
  expect(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();
  // 8. The baseline refreshes to the verified converged state.
  const baseline = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE));
  expect(baseline.snapshots.invoices).toHaveLength(10);

  // 11. A second run is idempotent: nothing left to import, matched after strict verify.
  const second = await runSupabaseCloudConvergence({ ...ctx, cloudSnapshot: snapshot });
  expect(second).toEqual(expect.objectContaining({ ok: true, status: "matched", noWritesPerformed: true }));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(10);
});

// ---------------------------------------------------------------------------
// Gate 16B: the real invoice cloud-pull round trip. Raw Supabase rows are read
// through readSupabaseCloudConvergenceSnapshot, converged, and checked by the
// REAL runSupabaseCloudVerification (no stubbed allMatched). The tenth invoice
// carries production-shaped children: labor/material/generic kinds, overlapping
// per-category sort orders, metadata.kind + metadata.unit_cost, and a unit.
// ---------------------------------------------------------------------------
const { ESTIMATE_RESTORE_PAYLOAD_SCHEMA, ESTIMATE_RESTORE_PAYLOAD_VERSION } = require("./supabaseEstimateRestorePayload");

// A thenable query chain: from(t).select(...).eq(...).eq(...)... resolves to the
// table's rows. app_settings resolves empty (no restore bundle).
function rawCloudClient(rowsByTable) {
  const from = jest.fn((table) => {
    const result = { data: table === "app_settings" ? [] : (rowsByTable[table] || []), error: null };
    const chain = { select: jest.fn(() => chain), eq: jest.fn(() => chain), then: (resolve) => resolve(result) };
    return chain;
  });
  return { from };
}

function inv10BackendLines() {
  // 6 children: overlapping per-category sort orders, kinds, unit_cost, unit,
  // decimals and a null-unit generic line.
  return [
    { kind: "labor", sort_order: 0, description: "Framing labor", quantity: 2, unit: "hr", unit_price: 75, total: 150, unit_cost: 45 },
    { kind: "labor", sort_order: 1, description: "Finish labor", quantity: 1, unit: "hr", unit_price: 80, total: 80, unit_cost: 50 },
    { kind: "material", sort_order: 0, description: "Lumber", quantity: 10, unit: "ea", unit_price: 12.5, total: 125, unit_cost: 8 },
    { kind: "material", sort_order: 1, description: "Fasteners", quantity: 1, unit: "box", unit_price: 20, total: 20, unit_cost: 11 },
    { kind: "invoice", sort_order: 2, description: "Permit fee", quantity: 1, unit: null, unit_price: 60, total: 60 },
    { kind: "material", sort_order: 2, description: "Paint", quantity: 1.5, unit: "gal", unit_price: 40, total: 60, unit_cost: 22 },
  ];
}

// A raw cloud `estimates` row exactly as the PRODUCTION writer persists it.
// mapEstimatePayloads collapses approved_total/grand_total/total into the single
// total_amount column and never writes an approved_total column at all. The
// expected total is passed in literally (never derived from the contract under
// test) so this fixture stays an independent statement of the table shape.
function writerEstimateRow({ local, id, customerUuid, projectUuid, totalAmount, convertedInvoiceLegacyId = null }) {
  const mapped = mapLocalEstimateToBackendEstimate(local, {});
  return {
    id, legacy_local_id: local.id, customer_id: customerUuid, project_id: projectUuid,
    estimate_number: mapped.estimate_number || null, status: mapped.status || "pending", document_type: "estimate",
    total_amount: totalAmount,
    notes: mapped.notes || null, terms: mapped.terms || null,
    converted_invoice_legacy_id: convertedInvoiceLegacyId,
    restore_payload: { schema: ESTIMATE_RESTORE_PAYLOAD_SCHEMA, version: Number(ESTIMATE_RESTORE_PAYLOAD_VERSION), legacyLocalId: local.id, estimate: local },
    restore_payload_version: ESTIMATE_RESTORE_PAYLOAD_VERSION,
  };
}

// The pre-Gate-16F fixture shape: built from the pre-writer BACKEND DRAFT rather
// than the writer's table projection. mapLocalEstimateToBackendEstimate produces
// no total_amount (so the column lands null) and does produce approved_total (a
// column the writer never writes). For an estimate carrying no totals at all the
// two shapes coincide, which is why exactly one of the twelve live estimates
// passed the old check.
function mapperShapedEstimateRow({ local, id, customerUuid, projectUuid }) {
  const mapped = mapLocalEstimateToBackendEstimate(local, {});
  return {
    id, legacy_local_id: local.id, customer_id: customerUuid, project_id: projectUuid,
    estimate_number: mapped.estimate_number, status: mapped.status, total_amount: mapped.total_amount,
    approved_total: mapped.approved_total ?? null, notes: mapped.notes, terms: mapped.terms,
    converted_invoice_legacy_id: mapped.converted_invoice_legacy_local_id ?? null,
    restore_payload: { schema: ESTIMATE_RESTORE_PAYLOAD_SCHEMA, version: Number(ESTIMATE_RESTORE_PAYLOAD_VERSION), legacyLocalId: local.id, estimate: local },
    restore_payload_version: ESTIMATE_RESTORE_PAYLOAD_VERSION,
  };
}

// Raw cloud invoice_line_item rows produced through the shared writer contract.
function writerInvoiceChildRows(parentLegacyId, parentCloudId, backendLines, idPrefix) {
  return buildParentLineItemContract({ entityType: "invoice", parentLegacyId, parentCloudId, parentColumn: "invoice_id", items: backendLines })
    .rows.map((row, idx) => ({ id: `${idPrefix}-${idx}`, ...row }));
}

// Real Supabase-shaped UUIDs so asset-binding writes succeed exactly as they do
// in production (fake ids would fail isValidCloudUuid and mask the real defect).
const U = { cust1: uuid(101), cust2: uuid(102), proj1: uuid(201), proj2: uuid(202), projCl: uuid(203), est1: uuid(301), inv: (i) => uuid(400 + i) };

function buildRawCloudTables() {
  const customers = [
    { id: U.cust1, legacy_local_id: "cust-1", display_name: "Cust 1", customer_type: "residential" },
    { id: U.cust2, legacy_local_id: "cust-2", display_name: "Cust 2", customer_type: "residential" },
  ];
  const projects = [
    { id: U.proj1, legacy_local_id: "proj-1", customer_id: U.cust1, project_number: "P-1", project_name: "Proj 1" },
    { id: U.proj2, legacy_local_id: "proj-2", customer_id: U.cust2, project_number: "P-2", project_name: "Proj 2" },
    // Gate 16D: a legitimately unassigned (customerless) project -- customer_id
    // is null in the cloud and restores as customerId "".
    { id: U.projCl, legacy_local_id: "proj-cl", customer_id: null, project_number: "P-CL", project_name: "Unassigned" },
  ];
  const est1Local = estimate("est-1", { customerId: "cust-1", projectId: "proj-1", estimateNumber: "EST-1" });
  // est-1 carries total 100 and no approved/grand total, so the writer persists
  // total_amount 100 (see writerEstimateRow).
  const estimates = [writerEstimateRow({ local: est1Local, id: U.est1, customerUuid: U.cust1, projectUuid: U.proj1, totalAmount: 100 })];
  // 9 existing invoices, one simple line each (no explicit kind/unit_cost).
  const invoiceRows = [];
  const invoiceLineRows = [];
  for (let i = 1; i <= 9; i++) {
    const legacy = `inv-${i}`;
    const cloudId = U.inv(i);
    invoiceRows.push({ id: cloudId, legacy_local_id: legacy, customer_id: U.cust1, project_id: U.proj1, source_estimate_legacy_id: "", invoice_number: `INV-${i}`, status: "sent", payment_status: "unpaid", total_amount: 100, amount_paid: 0, balance_remaining: 100, invoice_date: "2026-07-01", due_date: "2026-08-01", notes: "" });
    writerInvoiceChildRows(legacy, cloudId, [{ kind: "invoice", sort_order: 0, description: "Service", quantity: 1, unit_price: 100, total: 100 }], `db-il-${i}`).forEach((r) => invoiceLineRows.push(r));
  }
  // The tenth, cloud-only invoice with a valid source estimate and 6 children.
  invoiceRows.push({ id: U.inv(10), legacy_local_id: "inv-10", customer_id: U.cust1, project_id: U.proj1, source_estimate_legacy_id: "est-1", invoice_number: "INV-10", status: "sent", payment_status: "unpaid", total_amount: 495, amount_paid: 0, balance_remaining: 495, invoice_date: "2026-07-02", due_date: "2026-08-02", notes: "Framing job" });
  writerInvoiceChildRows("inv-10", U.inv(10), inv10BackendLines(), "db-il-10").forEach((r) => invoiceLineRows.push(r));

  return { customers, projects, estimates, invoices: invoiceRows, invoice_payments: [], estimate_line_items: [], invoice_line_items: invoiceLineRows, est1Local };
}

// The stale device's local data came from the cloud originally, so its nine
// invoices already carry the canonical restored shape. Derive them through the
// same real mapping (a cloud read of the first nine invoices) rather than
// hand-building an unrealistic shape.
function rawTablesWithoutTenth(raw) {
  return {
    ...raw,
    invoices: raw.invoices.filter((v) => v.legacy_local_id !== "inv-10"),
    invoice_line_items: raw.invoice_line_items.filter((r) => r.invoice_id !== U.inv(10)),
  };
}

test("Gate 16B raw-cloud round trip: the tenth invoice survives snapshot mapping and REAL strict verification", async () => {
  const ctx = { configured: true, user: { id: "u" }, company: { id: "company-1" } };
  const raw = buildRawCloudTables();

  // Seed local storage from a real cloud read of the first nine invoices.
  getSupabaseClient.mockReturnValue(rawCloudClient(rawTablesWithoutTenth(raw)));
  const nineSnapshot = await readSupabaseCloudConvergenceSnapshot(ctx);
  expect(nineSnapshot.ok).toBe(true);
  setLocalSnapshot(nineSnapshot.mapped);
  setBaseline(nineSnapshot.mapped);

  // Now the cloud has all ten invoices.
  const client = rawCloudClient(raw);
  getSupabaseClient.mockReturnValue(client);
  const snapshot = await readSupabaseCloudConvergenceSnapshot(ctx);
  expect(snapshot.ok).toBe(true);
  // 3/4. The tenth invoice mapped with all six children.
  const mappedInv10 = snapshot.mapped.invoices.find((inv) => inv.id === "inv-10");
  expect(mappedInv10.lineItems).toHaveLength(6);

  const before = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES));
  expect(before).toHaveLength(9);

  const result = await runSupabaseCloudConvergence({ storage: localStorage, ...ctx, deviceAccess: { ok: true }, completionDeviceAccess: { ok: true }, cloudSnapshot: snapshot, verifyCloud: runSupabaseCloudVerification });

  // 7/8/9: strict (real) verification passed, no rollback, ten invoices remain.
  expect(result).toEqual(expect.objectContaining({ ok: true, status: "converged", imported: 1, noCloudWritesPerformed: true }));
  const after = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES));
  expect(after).toHaveLength(10);
  const imported = after.find((inv) => inv.id === "inv-10");
  expect(imported.lineItems).toHaveLength(6);
  // 11: existing nine invoices unchanged and in the same order.
  expect(after.slice(0, 9)).toEqual(before);
  // 13: journal removed; 12: baseline has ten invoices.
  expect(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).snapshots.invoices).toHaveLength(10);
  // 14: no cloud mutation.
  const mutated = client.from.mock.results.some((r) => r.value && (r.value.insert || r.value.update || r.value.delete || r.value.upsert || r.value.rpc));
  expect(mutated).toBe(false);

  // 15: a second run is idempotent.
  const second = await runSupabaseCloudConvergence({ storage: localStorage, ...ctx, deviceAccess: { ok: true }, completionDeviceAccess: { ok: true }, cloudSnapshot: snapshot, verifyCloud: runSupabaseCloudVerification });
  expect(second).toEqual(expect.objectContaining({ ok: true, status: "matched" }));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(10);
});

test("Gate 16E verified clean replica: real raw snapshot replaces stale shared records and reaches strict Cloud OK", async () => {
  const ctx = { configured: true, user: { id: "u" }, company: { id: "company-1" } };
  const raw = buildRawCloudTables();
  getSupabaseClient.mockReturnValue(rawCloudClient(rawTablesWithoutTenth(raw)));
  const nine = await readSupabaseCloudConvergenceSnapshot(ctx);
  const staleLocal = {
    ...nine.mapped,
    projects: nine.mapped.projects.map((project) => project.id === "proj-1" ? { ...project, notes: "legacy local note" } : project),
    estimates: nine.mapped.estimates.map((estimateRow) => ({ ...estimateRow, notes: "legacy local estimate note" })),
    invoices: nine.mapped.invoices.map((invoiceRow) => ({ ...invoiceRow, lineItems: invoiceRow.lineItems.map((line) => ({ ...line, legacyChildMarker: true })) })),
  };
  setLocalSnapshot(staleLocal);
  setVerifiedCleanQueue("company-1", 0);
  getSupabaseClient.mockReturnValue(rawCloudClient(raw));
  const snapshot = await readSupabaseCloudConvergenceSnapshot(ctx);
  const beforeIds = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES)).map((row) => row.id);

  const result = await runSupabaseCloudConvergence({ storage: localStorage, ...ctx, deviceAccess: { ok: true }, completionDeviceAccess: { ok: true }, cloudSnapshot: snapshot, verifyCloud: runSupabaseCloudVerification });

  expect(result).toEqual(expect.objectContaining({ ok: true, status: "converged", bootstrap: true, bootstrapReason: "verified_clean_replica", noCloudWritesPerformed: true }));
  const invoices = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES));
  expect(invoices).toHaveLength(10);
  expect(invoices.slice(0, 9).map((row) => row.id)).toEqual(beforeIds);
  expect(invoices.find((row) => row.id === "inv-10").lineItems).toHaveLength(6);
  expect(invoices.every((row) => row.lineItems.every((line) => !line.legacyChildMarker))).toBe(true);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).snapshots.invoices).toHaveLength(10);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_ASSET_BINDINGS)).bindings.invoice["inv-10"].cloudUuid).toBe(U.inv(10));
  expect(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();
});

test("Gate 16B raw-cloud round trip: a real semantic child mismatch rolls back to nine invoices", async () => {
  const ctx = { configured: true, user: { id: "u" }, company: { id: "company-1" } };
  const raw = buildRawCloudTables();
  getSupabaseClient.mockReturnValue(rawCloudClient(rawTablesWithoutTenth(raw)));
  const nineSnapshot = await readSupabaseCloudConvergenceSnapshot(ctx);
  setLocalSnapshot(nineSnapshot.mapped);
  setBaseline(nineSnapshot.mapped);
  const before = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES));
  expect(before).toHaveLength(9);

  // Build the import snapshot from the clean cloud, but let the REAL verifier read
  // a cloud where one tenth-invoice child was semantically corrupted after import.
  getSupabaseClient.mockReturnValue(rawCloudClient(raw));
  const snapshot = await readSupabaseCloudConvergenceSnapshot(ctx);
  const corrupted = { ...raw, invoice_line_items: raw.invoice_line_items.map((r) => (r.id === "db-il-10-0" ? { ...r, description: "TAMPERED" } : r)) };
  getSupabaseClient.mockReturnValue(rawCloudClient(corrupted));

  const result = await runSupabaseCloudConvergence({ storage: localStorage, ...ctx, deviceAccess: { ok: true }, completionDeviceAccess: { ok: true }, cloudSnapshot: snapshot, verifyCloud: runSupabaseCloudVerification });
  expect(result).toEqual(expect.objectContaining({ ok: false, status: "rolled_back", code: "cloud_verification_failed" }));
  // Exact rollback: nine invoices restored byte-for-byte.
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toEqual(before);
  expect(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();
});

// ---------------------------------------------------------------------------
// Gate 16C: real hook-to-convergence path. Starts at useCloudAutoConvergence
// (not runSupabaseCloudConvergence directly), and does NOT inject deviceAccess.
// The device-lock cloud reads are mocked so the REAL ensureCurrentDeviceCanApply
// LocalRestore path proves this browser is active at both ownership checks.
// ---------------------------------------------------------------------------
describe("Gate 16C real hook-to-convergence (no injected device access)", () => {
  const { default: useCloudAutoConvergence } = require("./useCloudAutoConvergence");
  const { getOrCreateLocalDeviceId } = require("./supabaseDeviceLock");
  const { releaseCloudBackupRunLock } = require("./cloudBackupRunLock");
  const { CLOUD_CONVERGENCE_RESULT_EVENT } = require("./supabaseCloudConvergence");
  const { renderHook, waitFor } = require("@testing-library/react");

  afterEach(() => releaseCloudBackupRunLock());

  // A thenable client that also serves the device-lock app_settings row so the
  // real ownership checks see THIS device as active. The restore-bundle read
  // gets the same row (it fails bundle validation -> supplemental skipped).
  function clientWithActiveDevice(rowsByTable, activeDeviceId) {
    const from = jest.fn((table) => {
      const resolveData = () => {
        if (table === "app_settings") return { data: [{ id: "dl-row", setting_value: { activeDeviceId, activeDeviceName: "Test Device", userId: "u" } }], error: null };
        return { data: rowsByTable[table] || [], error: null };
      };
      const chain = { select: jest.fn(() => chain), eq: jest.fn(() => chain), then: (resolve) => resolve(resolveData()) };
      return chain;
    });
    return { from };
  }

  test("device lock loads then becomes active; the hook imports the tenth invoice through the real ownership path", async () => {
    const ctx = { configured: true, user: { id: "u" }, company: { id: "company-1" } };
    const raw = buildRawCloudTables();
    const localId = getOrCreateLocalDeviceId(localStorage);

    // Seed local storage from a real cloud read of the first nine invoices.
    getSupabaseClient.mockReturnValue(clientWithActiveDevice(rawTablesWithoutTenth(raw), localId));
    const nine = await readSupabaseCloudConvergenceSnapshot(ctx);
    setLocalSnapshot(nine.mapped);
    setBaseline(nine.mapped);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(9);
    // 1/2: the raw cloud snapshot accepts customer_id null and restores the
    // unassigned project as customerId "".
    const seededProjects = JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS));
    const seededCustomerless = seededProjects.find((p) => p.id === "proj-cl");
    expect(seededCustomerless.customerId).toBe("");

    // Cloud now has all ten invoices; the same client serves the active-device row.
    getSupabaseClient.mockReturnValue(clientWithActiveDevice(raw, localId));

    const results = [];
    const onResult = (e) => results.push(e.detail);
    const invoicesChanged = jest.fn();
    window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onResult);
    window.addEventListener("estipaid:invoices-changed", invoicesChanged);
    try {
      // 1/2: device lock begins loading, then becomes ready + active.
      const { rerender } = renderHook((lock) => useCloudAutoConvergence({ ...ctx, deviceLock: lock }), {
        initialProps: { ready: false, loading: true, isActive: false, isLocked: false },
      });
      rerender({ ready: true, loading: false, isActive: true, isLocked: false });

      // 3/4/5/6: the hook runs convergence, imports exactly one cloud-only invoice
      // (with all six children surviving real strict verification), leaving ten.
      await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(10), { timeout: 5000 });
      const invoices = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES));
      expect(invoices.find((v) => v.id === "inv-10").lineItems).toHaveLength(6);

      // 3/9/10/11: no project relationship conflict blocked the run; the
      // customerless project is unchanged (still customerless) and none deleted.
      const projectsAfter = JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS));
      expect(projectsAfter).toEqual(seededProjects);
      expect(projectsAfter.find((p) => p.id === "proj-cl").customerId).toBe("");

      // 7/8/12: baseline contains ten invoices and the customerless project;
      // journal removed after success.
      await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).snapshots.invoices).toHaveLength(10));
      const baselineSnapshots = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).snapshots;
      const baselineProjCl = baselineSnapshots.projects.find((p) => p.id === "proj-cl");
      expect(baselineProjCl).toBeTruthy(); // still present, still no customer
      expect(baselineProjCl.customerId || "").toBe("");
      expect(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();

      // 9: queue clean after verified completion.
      const queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE) || "{}");
      expect(Boolean(queue.pending)).toBe(false);

      // 10: a converged result event is published (13: with no cloud writes).
      await waitFor(() => expect(results.some((r) => r.ok && r.status === "converged" && r.noCloudWritesPerformed)).toBe(true));

      // 11: the invoice-family change event is published exactly once.
      await waitFor(() => expect(invoicesChanged).toHaveBeenCalledTimes(1));

      // 12: a second explicit request is idempotent (still ten, matched).
      const before = localStorage.getItem(STORAGE_KEYS.INVOICES);
      window.dispatchEvent(new CustomEvent("estipaid:cloud-convergence-request"));
      await waitFor(() => expect(results.some((r) => r.ok && r.status === "matched")).toBe(true), { timeout: 5000 });
      expect(localStorage.getItem(STORAGE_KEYS.INVOICES)).toBe(before);
      expect(invoicesChanged).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onResult);
      window.removeEventListener("estipaid:invoices-changed", invoicesChanged);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate 16D: an unassigned (customerless) project is valid. A blank project
// customer relationship makes no claim; only a NONEMPTY dangling customer
// reference is a genuine orphan.
// ---------------------------------------------------------------------------
describe("Gate 16D customerless project relationship", () => {
  const ctx = { configured: true, user: { id: "u" }, company: { id: "company-1" } };

  test("Case A convergence: a customerless project (customerId '') produces no relationship conflict", () => {
    const plan = buildCloudConvergencePlan({
      local: { ...emptySnapshot(), customers: [{ id: "c1" }], projects: [{ id: "p1", customerId: "" }] },
      cloud: { ...emptySnapshot(), customers: [{ id: "c1" }], projects: [{ id: "p1", customerId: "" }] },
    });
    expect(plan.conflicts.find((c) => c.code === "project_customer_relationship")).toBeUndefined();
  });

  test("Case B convergence: a nonempty dangling project customer still blocks", () => {
    const plan = buildCloudConvergencePlan({
      local: { ...emptySnapshot(), customers: [{ id: "c1" }], projects: [{ id: "p1", customerId: "missing-c" }] },
      cloud: { ...emptySnapshot(), customers: [{ id: "c1" }] },
    });
    expect(plan.safe).toBe(false);
    expect(plan.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "project_customer_relationship" })]));
  });

  test("Case C convergence: a blank project customer does not conflict with a dependent document customer", () => {
    const plan = buildCloudConvergencePlan({
      local: {
        ...emptySnapshot(),
        customers: [{ id: "c1" }],
        projects: [{ id: "p1", customerId: "" }],
        invoices: [{ ...invoice("i1"), customerId: "c1", projectId: "p1", sourceEstimateId: "", lineItems: [], payments: [] }],
      },
      cloud: {
        ...emptySnapshot(),
        customers: [{ id: "c1" }],
        projects: [{ id: "p1", customerId: "" }],
        invoices: [{ ...invoice("i1"), customerId: "c1", projectId: "p1", sourceEstimateId: "", lineItems: [], payments: [] }],
      },
    });
    expect(plan.conflicts.find((c) => c.code === "invoice_project_customer_relationship")).toBeUndefined();
  });

  test("Case C negative: two nonempty different project/document customer IDs still conflict", () => {
    const plan = buildCloudConvergencePlan({
      local: {
        ...emptySnapshot(),
        customers: [{ id: "c1" }, { id: "c2" }],
        projects: [{ id: "p1", customerId: "c2" }],
        invoices: [{ ...invoice("i1"), customerId: "c1", projectId: "p1", sourceEstimateId: "", lineItems: [], payments: [] }],
      },
      cloud: { ...emptySnapshot(), customers: [{ id: "c1" }, { id: "c2" }], projects: [{ id: "p1", customerId: "c2" }] },
    });
    expect(plan.safe).toBe(false);
    expect(plan.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invoice_project_customer_relationship" })]));
  });

  test("Case A raw cloud: project customer_id null is accepted and restores as customerId ''", async () => {
    getSupabaseClient.mockReturnValue(rawCloudClient({
      customers: [{ id: uuid(1), legacy_local_id: "c1", display_name: "C1", customer_type: "residential" }],
      projects: [{ id: uuid(2), legacy_local_id: "p1", customer_id: null, project_number: "P-1", project_name: "Unassigned" }],
      estimates: [], invoices: [], invoice_payments: [], estimate_line_items: [], invoice_line_items: [],
    }));
    const snapshot = await readSupabaseCloudConvergenceSnapshot(ctx);
    expect(snapshot.ok).toBe(true);
    expect(snapshot.mapped.projects.find((p) => p.id === "p1").customerId).toBe("");
  });

  test("Case B raw cloud: a nonempty dangling project customer_id stays blocked", async () => {
    getSupabaseClient.mockReturnValue(rawCloudClient({
      customers: [{ id: uuid(1), legacy_local_id: "c1", display_name: "C1", customer_type: "residential" }],
      projects: [{ id: uuid(2), legacy_local_id: "p1", customer_id: uuid(99), project_number: "P-1", project_name: "Dangling" }],
      estimates: [], invoices: [], invoice_payments: [], estimate_line_items: [], invoice_line_items: [],
    }));
    const snapshot = await readSupabaseCloudConvergenceSnapshot(ctx);
    expect(snapshot.ok).toBe(false);
    expect(snapshot.code).toBe("projects:orphan_customer");
  });

  test("Case B negative: a genuine dangling project blocks convergence with zero local writes and no import", async () => {
    const raw = buildRawCloudTables();
    // Seed a valid local snapshot of nine invoices.
    getSupabaseClient.mockReturnValue(rawCloudClient(rawTablesWithoutTenth(raw)));
    const nine = await readSupabaseCloudConvergenceSnapshot(ctx);
    setLocalSnapshot(nine.mapped);
    setBaseline(nine.mapped);
    const invoicesBefore = localStorage.getItem(STORAGE_KEYS.INVOICES);
    const projectsBefore = localStorage.getItem(STORAGE_KEYS.PROJECTS);

    // Cloud now carries a genuinely dangling project (nonempty missing customer)
    // alongside the tenth invoice.
    const dangling = { ...raw, projects: [...raw.projects, { id: uuid(77), legacy_local_id: "proj-bad", customer_id: uuid(88), project_number: "P-BAD", project_name: "Dangling" }] };
    getSupabaseClient.mockReturnValue(rawCloudClient(dangling));

    const result = await runSupabaseCloudConvergence({ storage: localStorage, ...ctx, deviceAccess: { ok: true }, completionDeviceAccess: { ok: true }, verifyCloud: runSupabaseCloudVerification });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("projects:orphan_customer");
    // No invoice imported; no local business-data write; no relationship guessed.
    expect(localStorage.getItem(STORAGE_KEYS.INVOICES)).toBe(invoicesBefore);
    expect(localStorage.getItem(STORAGE_KEYS.PROJECTS)).toBe(projectsBefore);
  });
});

// ---------------------------------------------------------------------------
// Gate 16F: the estimate evidence verifier and the cloud writer must agree on
// exactly which columns the `estimates` table holds. The verifier used to
// compare raw persisted rows against the PRE-WRITER backend draft, which
// asserted a total_amount the draft never carries and demanded an approved_total
// the writer never persists -- so every estimate written with a real total was
// reported as estimate_restore_payload_persisted_mismatch.
// ---------------------------------------------------------------------------
describe("Gate 16F/16G live-shaped device replay", () => {
  const ctx = { configured: true, user: { id: "u" }, company: { id: "company-1" } };
  const L = { cust: (i) => uuid(1100 + i), proj: (i) => uuid(1200 + i), est: (i) => uuid(1300 + i), inv: (i) => uuid(1400 + i), pay: (i) => uuid(1500 + i) };
  // The live device's last successful backup / verification. Deliberately old:
  // clean-replica proof requires VALID timestamps, never recent ones.
  const JULY_10 = Date.parse("2026-07-10T22:05:23.000Z");

  const { DEVICE_LOCK_ROW_KEY } = require("./supabaseDeviceLock");
  const { SUPABASE_APP_RESTORE_BUNDLE_SCHEMA, SUPABASE_APP_RESTORE_BUNDLE_VERSION, SUPABASE_APP_RESTORE_BUNDLE_ROW_KEY } = require("./supabaseAppRestoreBundle");

  const SCOPE_TEMPLATE = { id: "tpl-1", name: "Standard Scope", body: "Scope of work" };
  const liveBundle = () => ({
    schema: SUPABASE_APP_RESTORE_BUNDLE_SCHEMA, version: SUPABASE_APP_RESTORE_BUNDLE_VERSION, capturedFrom: "localStorage",
    companyProfile: { companyName: "Test Co" }, settings: { taxRate: 0 }, scopeTemplates: [SCOPE_TEMPLATE],
  });

  // Serves the business tables plus BOTH app_settings rows, keyed by the same
  // setting_key filter production uses: the device-lock row and the restore
  // bundle row. Lets the real device-lock path and the real supplemental path
  // both run against one client.
  function liveCloudClient(rowsByTable, { activeDeviceId = "", bundle = null } = {}) {
    const from = jest.fn((table) => {
      const filters = {};
      const resolveData = () => {
        if (table !== "app_settings") return { data: rowsByTable[table] || [], error: null };
        if (filters.setting_key === DEVICE_LOCK_ROW_KEY) {
          return { data: activeDeviceId ? [{ id: "dl-row", setting_value: { activeDeviceId, activeDeviceName: "Live Device", userId: "u" } }] : [], error: null };
        }
        if (filters.setting_key === SUPABASE_APP_RESTORE_BUNDLE_ROW_KEY) {
          return { data: bundle ? [{ id: "bundle-row", setting_value: bundle }] : [], error: null };
        }
        return { data: [], error: null };
      };
      const chain = { select: jest.fn(() => chain), eq: jest.fn((column, value) => { filters[column] = value; return chain; }), then: (resolve) => resolve(resolveData()) };
      return chain;
    });
    return { from };
  }

  // The exact live Mac metadata. The released schema-v1 queue (commit 1190910)
  // wrote schemaVersion/pending/status/reasons/domains/severity/priority/
  // createdAt/updatedAt/attempts/lastAttemptAt/lastError/lastSuccessfulBackupAt/
  // source/documentId/localFingerprint -- and NOTHING else. It had no
  // companyId, no lastVerifiedAt, no localMutationRevision, no syncingRevision,
  // no retryCount/nextRetryAt/lastErrorCode, no activeDeviceId.
  function setLegacyV1CurrentQueue(overrides = {}) {
    localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({
      schemaVersion: "1.0.0",
      pending: false,
      status: "current",
      reasons: [],
      domains: [],
      severity: "low",
      priority: "deferred",
      createdAt: JULY_10 - 60000,
      updatedAt: JULY_10,
      attempts: 0,
      lastAttemptAt: JULY_10,
      lastError: "",
      // v1 wrote this ONLY from clearCloudBackupDirty, which ran only after
      // runSupabaseCloudVerification returned ok && allMatched.
      lastSuccessfulBackupAt: JULY_10,
      source: "manual_backup_success",
      documentId: "",
      localFingerprint: null,
      ...overrides,
    }));
  }

  const STALE_TAKEOVER_PAUSED_AT = 1784172727618;
  function setStaleTakeoverPause(overrides = {}) {
    localStorage.setItem(STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE, JSON.stringify({
      paused: true, reason: "device_takeover", pausedAt: STALE_TAKEOVER_PAUSED_AT, ...overrides,
    }));
  }

  // The live conflict vault: 22 safe diagnostic entries. It must never block
  // eligibility, and must never be cleared before verified success.
  function setConflictVault(entryCount = 22, companyId = "company-1") {
    const entries = Array.from({ length: entryCount }, (_, i) => ({
      family: "invoices", id: `vault-${i + 1}`, code: "both_added_different", at: JULY_10,
    }));
    localStorage.setItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT, JSON.stringify({ version: 1, companyId, entries }));
  }

  const readQueueRaw = () => localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
  const readPauseRaw = () => localStorage.getItem(STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE);

  function setJuly10CleanQueue(companyId = "company-1", revision = 0) {
    localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({
      schemaVersion: "2.0.0", pending: false, status: "clean", companyId,
      lastSuccessfulBackupAt: JULY_10, lastVerifiedAt: JULY_10,
      localMutationRevision: revision, syncingRevision: null, retryCount: 0,
      nextRetryAt: null, lastError: "", lastErrorCode: "", reasons: [], domains: [],
    }));
  }

  // Twelve estimates written through the real production writer: each carries a
  // real total, so each row holds a total_amount and NO approved_total column.
  // est-1 is the document that differs from the stale device, which is why the
  // live Mac reported estimates/both_added_different: 1 alongside eleven
  // estimate_restore_payload_persisted_mismatch results across twelve estimates
  // -- a conflicted estimate is never double-reported by the evidence loop.
  const LIVE_ESTIMATE_SPECS = [
    { n: 1, spec: { approvedTotal: 4500, grandTotal: 4400, total: 4300 }, totalAmount: 4500, differs: true },
    { n: 2, spec: { grandTotal: 3200, total: 3100 }, totalAmount: 3200 },
    { n: 3, spec: { total: 900 }, totalAmount: 900 },
    // approvedTotal 0 is a real approved total: the writer uses ?? (not ||).
    { n: 4, spec: { approvedTotal: 0, grandTotal: 1300, total: 1200 }, totalAmount: 0 },
    { n: 5, spec: { approvedTotal: 15250.75, status: "approved" }, totalAmount: 15250.75 },
    { n: 6, spec: { grandTotal: 780.5, total: null }, totalAmount: 780.5 },
    { n: 7, spec: { total: 2400, status: "approved" }, totalAmount: 2400 },
    { n: 8, spec: { approvedTotal: 6100, status: "sent", terms: "Net 30" }, totalAmount: 6100 },
    { n: 9, spec: { total: 310, status: "lost" }, totalAmount: 310 },
    { n: 10, spec: { approvedTotal: 8800, notes: "Scope A", terms: "Net 15" }, totalAmount: 8800 },
    { n: 11, spec: { grandTotal: 1990, total: 1980, status: "sent" }, totalAmount: 1990 },
    { n: 12, spec: { approvedTotal: 2750, total: 2700 }, totalAmount: 2750 },
  ];

  const liveEstimateLocal = (n, spec) => estimate(`est-${n}`, {
    customerId: `cust-${((n - 1) % 7) + 1}`, projectId: `proj-${((n - 1) % 11) + 1}`,
    estimateNumber: `EST-${1000 + n}`, ...spec,
  });

  // Estimate children flattened through the SHARED line-item contract, exactly
  // as the writer persists them.
  function writerEstimateChildRows(local, parentCloudId, idPrefix) {
    const mapped = mapLocalEstimateToBackendEstimate(local, {});
    return buildParentLineItemContract({ entityType: "estimate", parentLegacyId: local.id, parentCloudId, parentColumn: "estimate_id", items: mapped.line_items })
      .rows.map((row, idx) => ({ id: `${idPrefix}-${idx}`, ...row }));
  }

  const estimateChildSource = {
    labor: { lines: [{ id: "lab-a", description: "Framing", quantity: 8, rate: 65, total: 520, internalCost: 40 }] },
    materials: { items: [{ id: "mat-a", description: "Lumber", quantity: 20, price: 12.5, total: 250, cost: 8 }] },
  };

  function buildLiveRawCloudTables() {
    const customers = Array.from({ length: 7 }, (_, i) => ({ id: L.cust(i + 1), legacy_local_id: `cust-${i + 1}`, display_name: `Customer ${i + 1}`, customer_type: "residential" }));
    const projects = Array.from({ length: 11 }, (_, i) => ({ id: L.proj(i + 1), legacy_local_id: `proj-${i + 1}`, customer_id: L.cust(((i) % 7) + 1), project_number: `P-${i + 1}`, project_name: `Project ${i + 1}` }));

    const estimateRows = []; const estimateLineRows = [];
    LIVE_ESTIMATE_SPECS.forEach(({ n, spec, totalAmount }) => {
      // Two estimates carry real children; the rest are header-only.
      const local = liveEstimateLocal(n, (n === 1 || n === 5) ? { ...spec, ...estimateChildSource } : spec);
      const args = { local, id: L.est(n), customerUuid: L.cust(((n - 1) % 7) + 1), projectUuid: L.proj(((n - 1) % 11) + 1) };
      estimateRows.push(writerEstimateRow({ ...args, totalAmount }));
      writerEstimateChildRows(local, L.est(n), `db-el-${n}`).forEach((row) => estimateLineRows.push(row));
    });

    const invoiceRows = []; const invoiceLineRows = []; const paymentRows = [];
    for (let i = 1; i <= 9; i++) {
      const cloudId = L.inv(i);
      invoiceRows.push({ id: cloudId, legacy_local_id: `inv-${i}`, customer_id: L.cust(((i - 1) % 7) + 1), project_id: L.proj(((i - 1) % 11) + 1), source_estimate_legacy_id: "", invoice_number: `INV-${2000 + i}`, status: "sent", payment_status: "unpaid", total_amount: 100 * i, amount_paid: 0, balance_remaining: 100 * i, invoice_date: "2026-07-01", due_date: "2026-08-01", notes: "" });
      writerInvoiceChildRows(`inv-${i}`, cloudId, [{ kind: "invoice", sort_order: 0, description: "Service", quantity: 1, unit_price: 100 * i, total: 100 * i }], `db-live-il-${i}`).forEach((row) => invoiceLineRows.push(row));
    }
    // Four payments, all on shared invoices, so local and cloud both hold four.
    for (let i = 1; i <= 4; i++) {
      paymentRows.push({ id: L.pay(i), legacy_local_id: `pay-${i}`, invoice_id: L.inv(i), amount: 25 * i, method: "check", status: "paid", paid_at: "2026-07-05T00:00:00.000Z" });
    }
    // The tenth, cloud-only invoice: six children, sourced from est-1.
    invoiceRows.push({ id: L.inv(10), legacy_local_id: "inv-10", customer_id: L.cust(1), project_id: L.proj(1), source_estimate_legacy_id: "est-1", invoice_number: "INV-2010", status: "sent", payment_status: "unpaid", total_amount: 495, amount_paid: 0, balance_remaining: 495, invoice_date: "2026-07-02", due_date: "2026-08-02", notes: "Framing job" });
    writerInvoiceChildRows("inv-10", L.inv(10), inv10BackendLines(), "db-live-il-10").forEach((row) => invoiceLineRows.push(row));

    return { customers, projects, estimates: estimateRows, invoices: invoiceRows, invoice_payments: paymentRows, estimate_line_items: estimateLineRows, invoice_line_items: invoiceLineRows };
  }

  const liveWithoutTenth = (raw) => ({
    ...raw,
    invoices: raw.invoices.filter((row) => row.legacy_local_id !== "inv-10"),
    invoice_line_items: raw.invoice_line_items.filter((row) => row.invoice_id !== L.inv(10)),
  });

  const persistedMismatches = (plan) => plan.conflicts.filter((conflict) => conflict.code === "estimate_restore_payload_persisted_mismatch");

  async function liveSnapshot(raw, deviceId = "") {
    getSupabaseClient.mockReturnValue(liveCloudClient(raw, { activeDeviceId: deviceId, bundle: liveBundle() }));
    return readSupabaseCloudConvergenceSnapshot(ctx);
  }

  // Seeds localStorage from a real cloud read of the nine-invoice cloud, then
  // applies the live stale-device differences.
  async function seedStaleLive(raw) {
    const nine = await liveSnapshot(liveWithoutTenth(raw));
    expect(nine.ok).toBe(true);
    const staleLocal = {
      ...nine.mapped,
      // One project differs in ordinary cloud business fields.
      projects: nine.mapped.projects.map((project) => project.id === "proj-1" ? { ...project, notes: "legacy local note" } : project),
      // One estimate differs as a complete cloud document.
      estimates: nine.mapped.estimates.map((row) => row.id === "est-1" ? { ...row, notes: "legacy local estimate note" } : row),
      // Nine shared invoices carry the legacy local child representation.
      invoices: nine.mapped.invoices.map((row) => ({ ...row, lineItems: row.lineItems.map((line) => ({ ...line, legacyChildMarker: true })) })),
    };
    setLocalSnapshot(staleLocal);
    return { nine, staleLocal };
  }

  // The historical twelve-estimate regression. Against the pre-Gate-16F verifier
  // this exact fixture reproduced the live Mac's estimate conflict signature --
  // estimates/both_added_different: 1 plus eleven
  // estimate_restore_payload_persisted_mismatch results, because every writer row
  // carrying a real total_amount was compared against a backend draft that has
  // no such column. With the writer and the verifier sharing one persistence
  // contract, none of the twelve is a contradiction and the differing document
  // becomes an ordinary safe cloud replacement.
  test("twelve production writer rows produce zero persisted mismatches and the differing document becomes a safe replacement", async () => {
    const raw = buildLiveRawCloudTables();
    const { staleLocal } = await seedStaleLive(raw);
    setJuly10CleanQueue("company-1", 0);
    const snapshot = await liveSnapshot(raw);
    expect(snapshot.ok).toBe(true);
    expect(snapshot.mapped.estimates).toHaveLength(12);

    const plan = buildCloudConvergencePlan({ local: staleLocal, cloud: snapshot.mapped, companyId: "company-1", storage: localStorage, cloudSnapshot: snapshot });
    expect(persistedMismatches(plan)).toHaveLength(0);
    expect(plan.conflicts).toEqual([]);
    expect(plan).toEqual(expect.objectContaining({ safe: true, bootstrap: true, bootstrapReason: "verified_clean_replica" }));
    // The one differing estimate document is replaced wholesale from the cloud.
    expect(plan.replacements.estimates.map((row) => row.id)).toEqual(["est-1"]);
  });

  test("the formerly synthetic mapper-shaped fixture row is not what the writer persists and is now rejected", async () => {
    const raw = buildLiveRawCloudTables();
    const { staleLocal } = await seedStaleLive(raw);
    setJuly10CleanQueue("company-1", 0);
    // Rebuild est-12 (approvedTotal 2750) the way the old fixture did: from the
    // pre-writer backend draft. That leaves total_amount unset and invents an
    // approved_total column -- a row the real writer would never produce.
    const local12 = liveEstimateLocal(12, LIVE_ESTIMATE_SPECS[11].spec);
    const synthetic = mapperShapedEstimateRow({ local: local12, id: L.est(12), customerUuid: L.cust(5), projectUuid: L.proj(1) });
    expect(synthetic.total_amount).toBeUndefined();
    expect(synthetic.approved_total).toBe(2750);
    const rawWithSynthetic = { ...raw, estimates: raw.estimates.map((row) => row.legacy_local_id === "est-12" ? synthetic : row) };
    const snapshot = await liveSnapshot(rawWithSynthetic);
    const plan = buildCloudConvergencePlan({ local: staleLocal, cloud: snapshot.mapped, companyId: "company-1", storage: localStorage, cloudSnapshot: snapshot });
    expect(persistedMismatches(plan).map((conflict) => conflict.id)).toContain("est-12");
  });

  test("the July 10 backup timestamp is valid proof: clean-replica bootstrap passes on age alone", async () => {
    const raw = buildLiveRawCloudTables();
    const { staleLocal } = await seedStaleLive(raw);
    setJuly10CleanQueue("company-1", 0);
    const snapshot = await liveSnapshot(raw);
    const proof = buildCleanReplicaBootstrapProof({ storage: localStorage, companyId: "company-1", local: staleLocal, cloud: snapshot.mapped, cloudSnapshot: snapshot });
    expect(proof).toEqual(expect.objectContaining({ ok: true, bootstrap: true, bootstrapReason: "verified_clean_replica" }));
    // The proof accepted a five-day-old timestamp; it is validity, not recency.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)).lastSuccessfulBackupAt).toBe(JULY_10);
  });

  test("complete live-shaped replay: 7/11/12 and 9->10 invoices reach strict Cloud OK through the real hook", async () => {
    const { default: useCloudAutoConvergence } = require("./useCloudAutoConvergence");
    const { getOrCreateLocalDeviceId } = require("./supabaseDeviceLock");
    const { releaseCloudBackupRunLock } = require("./cloudBackupRunLock");
    const { CLOUD_CONVERGENCE_RESULT_EVENT } = require("./supabaseCloudConvergence");
    const { renderHook, waitFor } = require("@testing-library/react");

    const raw = buildLiveRawCloudTables();
    const deviceId = getOrCreateLocalDeviceId(localStorage);
    await seedStaleLive(raw);
    localStorage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, JSON.stringify([SCOPE_TEMPLATE]));
    setJuly10CleanQueue("company-1", 0);

    // Local starts at the live shape: 7 / 11 / 12 / 9, 4 payments, 1 template.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toHaveLength(7);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS))).toHaveLength(11);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toHaveLength(12);
    const invoicesBefore = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES));
    expect(invoicesBefore).toHaveLength(9);
    expect(invoicesBefore.flatMap((row) => row.payments || [])).toHaveLength(4);
    // No baseline, no bindings.
    expect(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.CLOUD_ASSET_BINDINGS)).toBeNull();

    const client = liveCloudClient(raw, { activeDeviceId: deviceId, bundle: liveBundle() });
    getSupabaseClient.mockReturnValue(client);

    const results = [];
    const onResult = (event) => results.push(event.detail);
    window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onResult);
    try {
      const { rerender } = renderHook((lock) => useCloudAutoConvergence({ ...ctx, deviceLock: lock }), {
        initialProps: { ready: false, loading: true, isActive: false, isLocked: false },
      });
      rerender({ ready: true, loading: false, isActive: true, isLocked: false });

      // The tenth invoice imports through the real ownership + planner + strict
      // verification path.
      await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(10), { timeout: 10000 });
      const converged = await waitFor(() => {
        const hit = results.find((result) => result.ok && result.status === "converged");
        expect(hit).toBeTruthy();
        return hit;
      }, { timeout: 10000 });

      // The published result: converged with no conflict and no bootstrap
      // blocker, and every family the cloud actually owned marked changed.
      expect(converged).toEqual(expect.objectContaining({
        ok: true, status: "converged", stage: "completed", code: "", bootstrapCode: "",
        conflictCount: 0, retryable: false, noCloudWritesPerformed: true,
      }));
      expect(converged.conflictSummary).toEqual([]);
      expect(converged.changedFamilies).toEqual(expect.objectContaining({ estimates: true, invoices: true, projects: true, customers: false }));

      // Final counts: 7 / 11 / 12 / 10 / 4 payments / 1 template.
      const invoicesAfter = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES));
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toHaveLength(7);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS))).toHaveLength(11);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toHaveLength(12);
      expect(invoicesAfter).toHaveLength(10);
      expect(invoicesAfter.flatMap((row) => row.payments || [])).toHaveLength(4);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SCOPE_TEMPLATES))).toHaveLength(1);

      // The tenth invoice arrived with all six children.
      expect(invoicesAfter.find((row) => row.id === "inv-10").lineItems).toHaveLength(6);
      // Existing identity order preserved; no local identity deleted.
      expect(invoicesAfter.slice(0, 9).map((row) => row.id)).toEqual(invoicesBefore.map((row) => row.id));
      // The stale shared records became complete cloud replacements.
      expect(invoicesAfter.every((row) => row.lineItems.every((line) => !line.legacyChildMarker))).toBe(true);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS)).find((row) => row.id === "proj-1").notes || "").not.toBe("legacy local note");
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES)).find((row) => row.id === "est-1").notes || "").not.toBe("legacy local estimate note");

      // Baseline captured and readable back; bindings created from exact identities.
      await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).snapshots.invoices).toHaveLength(10));
      const bindings = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_ASSET_BINDINGS)).bindings;
      expect(bindings.invoice["inv-10"].cloudUuid).toBe(L.inv(10));
      expect(bindings.estimate["est-1"].cloudUuid).toBe(L.est(1));
      // Journal cleared only after verified success; queue still clean.
      expect(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();
      const queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE));
      expect(queue.status).toBe("clean");
      expect(queue.pending).toBe(false);
      expect(queue.localMutationRevision).toBe(0);

      // Strict verification -- the same REAL verifier the hook ran (the hook
      // injects no verifyCloud, and convergence refuses to report "converged"
      // unless ok && allMatched) -- confirms the header can reach Cloud OK.
      const verification = await runSupabaseCloudVerification({ storageSnapshot: localStorage, ...ctx });
      expect(verification).toEqual(expect.objectContaining({ ok: true, allMatched: true }));
      expect(verification.blockers || []).toEqual([]);

      // No cloud mutation anywhere in the run.
      expect(client.from.mock.results.some((r) => r.value && (r.value.insert || r.value.update || r.value.delete || r.value.upsert || r.value.rpc))).toBe(false);

      // A second run is idempotent under ordinary baseline behavior.
      const before = localStorage.getItem(STORAGE_KEYS.INVOICES);
      window.dispatchEvent(new CustomEvent("estipaid:cloud-convergence-request"));
      await waitFor(() => expect(results.some((result) => result.ok && result.status === "matched")).toBe(true), { timeout: 10000 });
      expect(localStorage.getItem(STORAGE_KEYS.INVOICES)).toBe(before);
    } finally {
      window.removeEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onResult);
      releaseCloudBackupRunLock();
    }
  }, 30000);

  // -------------------------------------------------------------------------
  // Fail-closed: every writer-owned field must still block on a real difference.
  // -------------------------------------------------------------------------
  describe("true persisted contradictions still block", () => {
    async function planWithCorruptedEstimate(mutate) {
      const raw = buildLiveRawCloudTables();
      const { staleLocal } = await seedStaleLive(raw);
      setJuly10CleanQueue("company-1", 0);
      const corrupted = { ...raw, estimates: raw.estimates.map((row) => row.legacy_local_id === "est-3" ? mutate({ ...row }) : row) };
      const snapshot = await liveSnapshot(corrupted);
      expect(snapshot.ok).toBe(true);
      return buildCloudConvergencePlan({ local: staleLocal, cloud: snapshot.mapped, companyId: "company-1", storage: localStorage, cloudSnapshot: snapshot });
    }

    test.each([
      ["total_amount differs from the writer projection", (row) => ({ ...row, total_amount: 901 })],
      ["status differs", (row) => ({ ...row, status: "approved" })],
      ["estimate_number differs", (row) => ({ ...row, estimate_number: "EST-9999" })],
      ["notes differ", (row) => ({ ...row, notes: "cloud-side tamper" })],
      ["terms differ", (row) => ({ ...row, terms: "Net 90" })],
      ["converted invoice relationship differs", (row) => ({ ...row, converted_invoice_legacy_id: "inv-9" })],
    ])("%s", async (_label, mutate) => {
      const plan = await planWithCorruptedEstimate(mutate);
      expect(plan.safe).toBe(false);
      expect(persistedMismatches(plan).map((conflict) => conflict.id)).toContain("est-3");
    });

    test("customer relationship differs", async () => {
      const plan = await planWithCorruptedEstimate((row) => ({ ...row, customer_id: L.cust(6) }));
      expect(plan.safe).toBe(false);
      expect(persistedMismatches(plan).map((conflict) => conflict.id)).toContain("est-3");
    });

    test("project relationship differs", async () => {
      const plan = await planWithCorruptedEstimate((row) => ({ ...row, project_id: L.proj(9) }));
      expect(plan.safe).toBe(false);
      expect(persistedMismatches(plan).map((conflict) => conflict.id)).toContain("est-3");
    });

    test("a historical approved_total column is ignored and never overrides total_amount", async () => {
      const raw = buildLiveRawCloudTables();
      const { staleLocal } = await seedStaleLive(raw);
      setJuly10CleanQueue("company-1", 0);
      // A legacy row that still carries a stale, non-owned approved_total column.
      // The writer does not own it, so it must neither block nor replace the
      // total_amount comparison.
      const legacy = { ...raw, estimates: raw.estimates.map((row) => row.legacy_local_id === "est-3" ? { ...row, approved_total: 777 } : row) };
      const snapshot = await liveSnapshot(legacy);
      const plan = buildCloudConvergencePlan({ local: staleLocal, cloud: snapshot.mapped, companyId: "company-1", storage: localStorage, cloudSnapshot: snapshot });
      expect(persistedMismatches(plan)).toHaveLength(0);

      // ...but the owned total_amount on that same row still blocks when wrong.
      const legacyAndWrong = { ...raw, estimates: raw.estimates.map((row) => row.legacy_local_id === "est-3" ? { ...row, approved_total: 900, total_amount: 42 } : row) };
      const wrongSnapshot = await liveSnapshot(legacyAndWrong);
      const wrongPlan = buildCloudConvergencePlan({ local: staleLocal, cloud: wrongSnapshot.mapped, companyId: "company-1", storage: localStorage, cloudSnapshot: wrongSnapshot });
      expect(persistedMismatches(wrongPlan).map((conflict) => conflict.id)).toContain("est-3");
    });

    test("restore payload estimate differing from the mapped estimate still blocks", async () => {
      const raw = buildLiveRawCloudTables();
      const { staleLocal } = await seedStaleLive(raw);
      setJuly10CleanQueue("company-1", 0);
      const snapshot = await liveSnapshot(raw);
      // Tamper the evidence payload only, leaving the mapped estimate intact.
      const evidence = snapshot.estimateEvidence["est-3"];
      const tampered = {
        ...snapshot,
        estimateEvidence: { ...snapshot.estimateEvidence, "est-3": { ...evidence, restorePayload: { ...evidence.restorePayload, estimate: { ...evidence.restorePayload.estimate, estimateNumber: "EST-OTHER" } } } },
      };
      const plan = buildCloudConvergencePlan({ local: staleLocal, cloud: snapshot.mapped, companyId: "company-1", storage: localStorage, cloudSnapshot: tampered });
      expect(plan.safe).toBe(false);
      expect(plan.conflicts.map((conflict) => conflict.code)).toContain("estimate_restore_payload_identity_mismatch");
    });

    test("estimate child evidence differing still blocks", async () => {
      const raw = buildLiveRawCloudTables();
      const { staleLocal } = await seedStaleLive(raw);
      setJuly10CleanQueue("company-1", 0);
      // est-5 carries children and is NOT the differing document, so the child
      // contradiction is reported on its own terms.
      const corrupted = { ...raw, estimate_line_items: raw.estimate_line_items.map((row) => row.id === "db-el-5-0" ? { ...row, quantity: 99 } : row) };
      const snapshot = await liveSnapshot(corrupted);
      const plan = buildCloudConvergencePlan({ local: staleLocal, cloud: snapshot.mapped, companyId: "company-1", storage: localStorage, cloudSnapshot: snapshot });
      expect(plan.safe).toBe(false);
      expect(plan.conflicts.map((conflict) => conflict.code)).toContain("estimate_line_item_mismatch");
    });

    test.each([
      ["queue missing", () => localStorage.removeItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE), "baseline_bootstrap_queue_missing"],
      ["queue pending", () => {
        const state = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE));
        localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({ ...state, pending: true, status: "pending" }));
      }, "baseline_bootstrap_local_pending"],
      ["queue unverified", () => {
        const state = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE));
        localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({ ...state, lastVerifiedAt: null }));
      }, "baseline_bootstrap_queue_unverified"],
    ])("%s still blocks bootstrap", async (_label, corruptQueue, expectedCode) => {
      const raw = buildLiveRawCloudTables();
      const { staleLocal } = await seedStaleLive(raw);
      setJuly10CleanQueue("company-1", 0);
      corruptQueue();
      const snapshot = await liveSnapshot(raw);
      expect(buildCleanReplicaBootstrapProof({ storage: localStorage, companyId: "company-1", local: staleLocal, cloud: snapshot.mapped, cloudSnapshot: snapshot }))
        .toEqual(expect.objectContaining({ ok: false, code: expectedCode }));
    });

    test("a local-only record still blocks bootstrap", async () => {
      const raw = buildLiveRawCloudTables();
      const { staleLocal } = await seedStaleLive(raw);
      setJuly10CleanQueue("company-1", 0);
      const snapshot = await liveSnapshot(raw);
      const withLocalOnly = { ...staleLocal, customers: [...staleLocal.customers, { id: "cust-local-only" }] };
      expect(buildCleanReplicaBootstrapProof({ storage: localStorage, companyId: "company-1", local: withLocalOnly, cloud: snapshot.mapped, cloudSnapshot: snapshot }))
        .toEqual(expect.objectContaining({ ok: false, code: "baseline_bootstrap_local_only_records" }));
    });

    test("an existing verified baseline keeps ordinary three-way behavior", async () => {
      const raw = buildLiveRawCloudTables();
      const { staleLocal } = await seedStaleLive(raw);
      setJuly10CleanQueue("company-1", 0);
      const snapshot = await liveSnapshot(raw);
      expect(buildCleanReplicaBootstrapProof({ storage: localStorage, companyId: "company-1", local: staleLocal, cloud: snapshot.mapped, cloudSnapshot: snapshot, baseline: { customers: [] } }))
        .toEqual(expect.objectContaining({ ok: false, code: "baseline_bootstrap_baseline_present" }));
    });
  });

  // -------------------------------------------------------------------------
  // Gate 16G: the live Mac's metadata, not its business data, is the blocker.
  // A released schema-v1 queue ("current"/pending:false) is rejected by
  // readPersistedCloudBackupQueueState before normalizeQueueState can convert
  // it, and a stale device_takeover pause -- written onto the WINNING browser
  // by its own successful forced claim -- can never clear without a new local
  // edit or a successful backup, which the pause itself prevents.
  // -------------------------------------------------------------------------
  describe("Gate 16G legacy queue migration and stale takeover pause recovery", () => {
    const {
      readPersistedCloudBackupQueueState,
      migrateLegacyPersistedCloudBackupQueue,
      recoverVerifiedActiveDeviceTakeoverPause,
    } = require("./cloudBackupQueue");
    const ACTIVE_DEVICE_ID = "device-live-mac";
    const { getOrCreateLocalDeviceId } = require("./supabaseDeviceLock");

    // The exact shape ensureCurrentDeviceCanApplyLocalRestore returns for a
    // resolved, unlocked, active device. Recovery must never accept a bare
    // { ok: true } assertion.
    const verifiedAccess = (overrides = {}) => ({
      ok: true,
      code: "",
      deviceLockLost: false,
      access: {
        ready: true, status: "active", isLocked: false, isActive: true,
        localDeviceId: ACTIVE_DEVICE_ID,
        activeDeviceState: { activeDeviceId: ACTIVE_DEVICE_ID, activeDeviceName: "Live Device", userId: "u" },
        ...(overrides.access || {}),
      },
      ...(() => { const { access, ...rest } = overrides; return rest; })(),
    });

    // The exact live metadata state, business data included.
    async function seedLiveMetadataState(raw) {
      const seeded = await seedStaleLive(raw);
      localStorage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, JSON.stringify([SCOPE_TEMPLATE]));
      setLegacyV1CurrentQueue();
      setStaleTakeoverPause();
      setConflictVault(22);
      localStorage.removeItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE);
      localStorage.removeItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL);
      localStorage.removeItem(STORAGE_KEYS.CLOUD_ASSET_BINDINGS);
      return seeded;
    }

    test("PRE-FIX live metadata: the v1 queue is unverified and clean-replica bootstrap is blocked", async () => {
      const raw = buildLiveRawCloudTables();
      const { staleLocal } = await seedLiveMetadataState(raw);
      const snapshot = await liveSnapshot(raw);
      expect(snapshot.ok).toBe(true);

      // 1. The persisted reader rejects the released v1 shape outright.
      const queueRead = readPersistedCloudBackupQueueState(localStorage);
      expect(queueRead).toEqual(expect.objectContaining({ ok: false, exists: true, code: "queue_unverified", state: null }));

      // 2. That surfaces as the live bootstrap code.
      const proof = buildCleanReplicaBootstrapProof({ storage: localStorage, companyId: "company-1", local: staleLocal, cloud: snapshot.mapped, cloudSnapshot: snapshot });
      expect(proof).toEqual(expect.objectContaining({ ok: false, code: "baseline_bootstrap_queue_unverified" }));

      // 3. The live metadata is exactly what the browser reported.
      const queue = JSON.parse(readQueueRaw());
      expect(queue).toEqual(expect.objectContaining({ schemaVersion: "1.0.0", pending: false, status: "current" }));
      expect(JSON.parse(readPauseRaw())).toEqual(expect.objectContaining({ paused: true, reason: "device_takeover", pausedAt: STALE_TAKEOVER_PAUSED_AT }));
      expect(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT)).entries).toHaveLength(22);

      // 4. Zero business-data movement: still nine invoices.
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(9);
    });

    test("the migration upgrades the released v1 queue without inventing a backup or a verification", () => {
      setLegacyV1CurrentQueue();
      const deviceAccess = verifiedAccess();
      const before = readQueueRaw();

      const result = migrateLegacyPersistedCloudBackupQueue({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess });

      expect(result).toEqual(expect.objectContaining({ ok: true, migrated: true, schemaBefore: "1.0.0", schemaAfter: "2.0.0" }));
      expect(result.previousRaw).toBe(before);

      // 3/4: a real, readable schema-v2 clean queue.
      const read = readPersistedCloudBackupQueueState(localStorage);
      expect(read.ok).toBe(true);
      expect(read.state).toEqual(expect.objectContaining({
        schemaVersion: "2.0.0", status: "clean", pending: false,
        syncingRevision: null, retryCount: 0, nextRetryAt: null,
        lastError: "", lastErrorCode: "", localMutationRevision: 0,
        companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID,
      }));
      expect(Array.isArray(read.state.reasons)).toBe(true);
      expect(Array.isArray(read.state.domains)).toBe(true);

      // 5/6: the historical proof is preserved verbatim -- the migration never
      // claims a NEW backup happened, and never back-dates a fresh one.
      expect(read.state.lastSuccessfulBackupAt).toBe(JULY_10);
      // v1 had no lastVerifiedAt. It is derived from the successful-backup
      // timestamp because v1 only ever wrote that field after
      // runSupabaseCloudVerification returned ok && allMatched.
      expect(read.state.lastVerifiedAt).toBe(JULY_10);
      expect(read.state.lastSuccessfulBackupAt).toBeLessThan(Date.now());
    });

    test("complete live-state replay: v1 queue + stale takeover pause recover, then 9->10 invoices reach strict Cloud OK", async () => {
      const { default: useCloudAutoConvergence } = require("./useCloudAutoConvergence");
      const { getOrCreateLocalDeviceId } = require("./supabaseDeviceLock");
      const { releaseCloudBackupRunLock } = require("./cloudBackupRunLock");
      const { CLOUD_CONVERGENCE_RESULT_EVENT } = require("./supabaseCloudConvergence");
      const { renderHook, waitFor } = require("@testing-library/react");

      const raw = buildLiveRawCloudTables();
      const deviceId = getOrCreateLocalDeviceId(localStorage);
      await seedLiveMetadataState(raw);

      // 1. The starting state is exactly the live Mac's, metadata included.
      expect(JSON.parse(readQueueRaw())).toEqual(expect.objectContaining({ schemaVersion: "1.0.0", status: "current", pending: false }));
      expect(JSON.parse(readPauseRaw())).toEqual(expect.objectContaining({ paused: true, reason: "device_takeover" }));
      expect(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.CLOUD_ASSET_BINDINGS)).toBeNull();
      const vaultBefore = localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT);
      expect(JSON.parse(vaultBefore).entries).toHaveLength(22);
      const invoicesBefore = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES));
      expect(invoicesBefore).toHaveLength(9);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toHaveLength(7);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS))).toHaveLength(11);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toHaveLength(12);
      expect(invoicesBefore.flatMap((row) => row.payments || [])).toHaveLength(4);

      const client = liveCloudClient(raw, { activeDeviceId: deviceId, bundle: liveBundle() });
      getSupabaseClient.mockReturnValue(client);

      const results = [];
      const onResult = (event) => results.push(event.detail);
      window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onResult);
      try {
        const { rerender } = renderHook((lock) => useCloudAutoConvergence({ ...ctx, deviceLock: lock }), {
          initialProps: { ready: false, loading: true, isActive: false, isLocked: false },
        });
        rerender({ ready: true, loading: false, isActive: true, isLocked: false });

        await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(10), { timeout: 10000 });
        const converged = await waitFor(() => {
          const hit = results.find((result) => result.ok && result.status === "converged");
          expect(hit).toBeTruthy();
          return hit;
        }, { timeout: 10000 });

        // 2/7/10/11: the metadata recovered, then bootstrap carried the run.
        expect(converged).toEqual(expect.objectContaining({
          ok: true, status: "converged", stage: "completed", code: "", bootstrapCode: "", conflictCount: 0,
          metadataRecoveryStage: "completed", queueSchemaBefore: "1.0.0", queueSchemaAfter: "2.0.0",
          pauseReason: "device_takeover", pauseRecovered: true, noCloudWritesPerformed: true,
        }));
        expect(converged.conflictSummary).toEqual([]);

        // 3/4/20: schema-v2 clean queue at the expected revision.
        const queueAfter = readPersistedCloudBackupQueueState(localStorage);
        expect(queueAfter.ok).toBe(true);
        expect(queueAfter.state).toEqual(expect.objectContaining({
          schemaVersion: "2.0.0", status: "clean", pending: false, syncingRevision: null,
          retryCount: 0, localMutationRevision: 0, companyId: "company-1",
        }));

        // 21. The stale takeover pause is gone.
        expect(readPauseRaw()).toBeNull();

        // 15. Final counts 7 / 11 / 12 / 10 / 4 / 1.
        const invoicesAfter = JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES));
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toHaveLength(7);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS))).toHaveLength(11);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toHaveLength(12);
        expect(invoicesAfter).toHaveLength(10);
        expect(invoicesAfter.flatMap((row) => row.payments || [])).toHaveLength(4);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SCOPE_TEMPLATES))).toHaveLength(1);

        // 13/14: invoice 10 imported with all six children.
        expect(invoicesAfter.find((row) => row.id === "inv-10").lineItems).toHaveLength(6);
        // 16. No local identity deleted; existing order preserved.
        expect(invoicesAfter.slice(0, 9).map((row) => row.id)).toEqual(invoicesBefore.map((row) => row.id));
        // 12. Stale shared records became complete cloud replacements.
        expect(invoicesAfter.every((row) => row.lineItems.every((line) => !line.legacyChildMarker))).toBe(true);

        // 17/18: bindings captured and baseline captured + read back.
        const bindings = JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_ASSET_BINDINGS)).bindings;
        expect(bindings.invoice["inv-10"].cloudUuid).toBe(L.inv(10));
        await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).snapshots.invoices).toHaveLength(10));

        // 22. Journal cleared only after success.
        expect(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();
        // 8/9: the 22-entry conflict vault never blocked eligibility and was
        // never cleared to get there.
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT)).entries).toHaveLength(22);

        // 19/23: strict verification (the REAL verifier the hook used) reaches Cloud OK.
        const verification = await runSupabaseCloudVerification({ storageSnapshot: localStorage, ...ctx });
        expect(verification).toEqual(expect.objectContaining({ ok: true, allMatched: true }));

        // 25. No cloud mutation anywhere in the run.
        expect(client.from.mock.results.some((r) => r.value && (r.value.insert || r.value.update || r.value.delete || r.value.upsert || r.value.rpc))).toBe(false);

        // 24. A second run is idempotent.
        const before = localStorage.getItem(STORAGE_KEYS.INVOICES);
        window.dispatchEvent(new CustomEvent("estipaid:cloud-convergence-request"));
        await waitFor(() => expect(results.some((result) => result.ok && result.status === "matched")).toBe(true), { timeout: 10000 });
        expect(localStorage.getItem(STORAGE_KEYS.INVOICES)).toBe(before);
        expect(readPauseRaw()).toBeNull();
      } finally {
        window.removeEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onResult);
        releaseCloudBackupRunLock();
      }
    }, 30000);

    // -----------------------------------------------------------------------
    // Fail-closed: an ineligible legacy queue, or any pause that is not a
    // self-inflicted takeover, must leave the device exactly as found.
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // Metadata recovery participates in the convergence attempt's rollback:
    // anything short of verified success leaves the device exactly as found.
    // -----------------------------------------------------------------------
    describe("a failed convergence restores the exact prior metadata", () => {
      async function runLiveConvergence(raw, overrides = {}) {
        getSupabaseClient.mockReturnValue(liveCloudClient(raw, { activeDeviceId: getOrCreateLocalDeviceId(localStorage), bundle: liveBundle() }));
        return runSupabaseCloudConvergence({ storage: localStorage, ...ctx, verifyCloud: runSupabaseCloudVerification, ...overrides });
      }

      test("strict verification failing after local application rolls back business data AND metadata", async () => {
        const raw = buildLiveRawCloudTables();
        await seedLiveMetadataState(raw);
        const queueBefore = readQueueRaw();
        const pauseBefore = readPauseRaw();
        const invoicesBefore = localStorage.getItem(STORAGE_KEYS.INVOICES);
        const vaultBefore = localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT);

        const result = await runLiveConvergence(raw, { verifyCloud: async () => ({ ok: true, allMatched: false, notices: [], blockers: [], repairs: [] }) });

        expect(result).toEqual(expect.objectContaining({ ok: false, status: "rolled_back", code: "cloud_verification_failed" }));
        // 19. Zero business-data writes and byte-exact metadata preservation.
        expect(localStorage.getItem(STORAGE_KEYS.INVOICES)).toBe(invoicesBefore);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(9);
        expect(readQueueRaw()).toBe(queueBefore);
        expect(readPauseRaw()).toBe(pauseBefore);
        expect(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT)).toBe(vaultBefore);
        expect(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).toBeNull();
        expect(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();
        // The queue is still the untouched legacy record -- not half-migrated.
        expect(JSON.parse(readQueueRaw())).toEqual(expect.objectContaining({ schemaVersion: "1.0.0", status: "current" }));
        expect(JSON.parse(readPauseRaw())).toEqual(expect.objectContaining({ paused: true, reason: "device_takeover" }));
      });

      test("device ownership lost before completion rolls back metadata too", async () => {
        const raw = buildLiveRawCloudTables();
        await seedLiveMetadataState(raw);
        const queueBefore = readQueueRaw();
        const pauseBefore = readPauseRaw();

        const result = await runLiveConvergence(raw, { completionDeviceAccess: { ok: false, code: "device_lock_lost" } });

        expect(result.ok).toBe(false);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(9);
        expect(readQueueRaw()).toBe(queueBefore);
        expect(readPauseRaw()).toBe(pauseBefore);
      });

      test("a local-only business identity blocks bootstrap and preserves the legacy metadata", async () => {
        const raw = buildLiveRawCloudTables();
        await seedLiveMetadataState(raw);
        // A customer that exists only on this device.
        const customers = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS));
        localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([...customers, { id: "cust-local-only" }]));
        const queueBefore = readQueueRaw();
        const pauseBefore = readPauseRaw();

        const result = await runLiveConvergence(raw);

        expect(result).toEqual(expect.objectContaining({ ok: false, status: "conflict", code: "data_mismatch" }));
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(9);
        expect(readQueueRaw()).toBe(queueBefore);
        expect(readPauseRaw()).toBe(pauseBefore);
      });

      test("cloud missing a local identity blocks bootstrap and preserves the legacy metadata", async () => {
        const raw = buildLiveRawCloudTables();
        await seedLiveMetadataState(raw);
        const queueBefore = readQueueRaw();
        const pauseBefore = readPauseRaw();
        // The cloud no longer carries one of this device's invoices.
        const missing = { ...raw, invoices: raw.invoices.filter((row) => row.legacy_local_id !== "inv-4"), invoice_line_items: raw.invoice_line_items.filter((row) => row.invoice_id !== L.inv(4)), invoice_payments: raw.invoice_payments.filter((row) => row.invoice_id !== L.inv(4)) };

        const result = await runLiveConvergence(missing);

        expect(result.ok).toBe(false);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toHaveLength(9);
        expect(readQueueRaw()).toBe(queueBefore);
        expect(readPauseRaw()).toBe(pauseBefore);
      });
    });

    describe("unsafe legacy queues are never upgraded", () => {
      test.each([
        ["pending local work", { pending: true }, "queue_legacy_pending"],
        ["status is not the v1 clean status", { status: "pending" }, "queue_legacy_not_clean"],
        ["failed status", { status: "failed" }, "queue_legacy_not_clean"],
        ["unresolved error", { lastError: "upload failed" }, "queue_legacy_error"],
        ["retry scheduled", { nextRetryAt: JULY_10 + 5000 }, "queue_legacy_retry_scheduled"],
        ["retry count", { retryCount: 2 }, "queue_legacy_retry_scheduled"],
        ["active syncing revision", { syncingRevision: 4 }, "queue_legacy_syncing"],
        ["invalid historical timestamp", { lastSuccessfulBackupAt: 0 }, "queue_legacy_invalid"],
        ["missing historical timestamp", { lastSuccessfulBackupAt: null }, "queue_legacy_invalid"],
        ["contradicting workspace identity", { companyId: "other-company" }, "queue_legacy_company_mismatch"],
        ["unsupported schema", { schemaVersion: "0.9.0" }, "queue_legacy_unsupported"],
      ])("%s", (_label, overrides, expectedCode) => {
        setLegacyV1CurrentQueue(overrides);
        const before = readQueueRaw();
        const result = migrateLegacyPersistedCloudBackupQueue({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() });
        expect(result).toEqual(expect.objectContaining({ ok: false, migrated: false, code: expectedCode }));
        expect(readQueueRaw()).toBe(before);
      });

      // A settled clean queue carrying a revision means that work was already
      // backed up, not that it is unprotected -- so the revision is preserved,
      // never reset (which would silently re-arm the change counter).
      test("a valid mutation revision is preserved, not reset", () => {
        setLegacyV1CurrentQueue({ localMutationRevision: 3 });
        const result = migrateLegacyPersistedCloudBackupQueue({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() });
        expect(result).toEqual(expect.objectContaining({ ok: true, migrated: true }));
        expect(readPersistedCloudBackupQueueState(localStorage).state.localMutationRevision).toBe(3);
      });

      test("a revision the writer never wrote is rejected rather than guessed", () => {
        setLegacyV1CurrentQueue({ localMutationRevision: "not-a-number" });
        const before = readQueueRaw();
        expect(migrateLegacyPersistedCloudBackupQueue({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() }))
          .toEqual(expect.objectContaining({ ok: false, code: "queue_legacy_invalid" }));
        expect(readQueueRaw()).toBe(before);
      });

      test("invalid legacy JSON is never upgraded", () => {
        localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, "{not json");
        expect(migrateLegacyPersistedCloudBackupQueue({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() }))
          .toEqual(expect.objectContaining({ ok: false, code: "queue_legacy_invalid" }));
        expect(readQueueRaw()).toBe("{not json");
      });

      test("a convergence journal blocks migration", () => {
        setLegacyV1CurrentQueue();
        localStorage.setItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL, JSON.stringify({ version: 1 }));
        const before = readQueueRaw();
        expect(migrateLegacyPersistedCloudBackupQueue({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() }))
          .toEqual(expect.objectContaining({ ok: false, code: "queue_legacy_journal_present" }));
        expect(readQueueRaw()).toBe(before);
      });

      test.each([
        ["device access is unresolved", null],
        ["a bare ok assertion without a real device check", { ok: true }],
        ["device access failed", { ok: false, access: { ready: true, isActive: false, isLocked: true } }],
        ["the lock is still loading", { access: { ready: false } }],
        ["the device is locked", { access: { isLocked: true } }],
        ["this browser is not the active device", { access: { localDeviceId: "some-other-device" } }],
        ["device lock was lost", { deviceLockLost: true }],
      ])("%s blocks migration", (_label, access) => {
        setLegacyV1CurrentQueue();
        const before = readQueueRaw();
        const deviceAccess = access === null ? null : (access.ok === false || access.access || access.deviceLockLost ? verifiedAccess(access) : access);
        expect(migrateLegacyPersistedCloudBackupQueue({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess }))
          .toEqual(expect.objectContaining({ ok: false, code: "queue_legacy_device_unverified" }));
        expect(readQueueRaw()).toBe(before);
      });
    });

    describe("only a self-inflicted takeover pause is ever recovered", () => {
      beforeEach(() => setJuly10CleanQueue("company-1", 0));

      test.each([
        ["manual_pause", "manual_pause", "pause_active_safety_lock"],
        ["device_lock_lost_during_mutation", "device_lock_lost_during_mutation", "pause_active_safety_lock"],
        ["device_lock_lost_during_restore", "device_lock_lost_during_restore", "pause_active_safety_lock"],
        ["device_lock_lost_during_backup", "device_lock_lost_during_backup", "pause_active_safety_lock"],
        ["an unknown reason", "something_new", "pause_active_safety_lock"],
        ["an empty reason", "", "pause_unknown"],
      ])("%s is never auto-cleared", (_label, reason, expectedCode) => {
        setStaleTakeoverPause({ reason });
        const before = readPauseRaw();
        expect(recoverVerifiedActiveDeviceTakeoverPause({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() }))
          .toEqual(expect.objectContaining({ ok: false, recovered: false, code: expectedCode }));
        expect(readPauseRaw()).toBe(before);
      });

      test("invalid pause JSON is never cleared", () => {
        localStorage.setItem(STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE, "{not json");
        expect(recoverVerifiedActiveDeviceTakeoverPause({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() }))
          .toEqual(expect.objectContaining({ ok: false, recovered: false, code: "pause_invalid" }));
        expect(readPauseRaw()).toBe("{not json");
      });

      test.each([
        ["device access is unresolved", null, "pause_device_unverified"],
        ["a bare ok assertion", { ok: true }, "pause_device_unverified"],
        ["this browser is not the active device", "not-active", "pause_device_unverified"],
      ])("%s blocks pause recovery", (_label, access, expectedCode) => {
        setStaleTakeoverPause();
        const before = readPauseRaw();
        const deviceAccess = access === null ? null : access === "not-active" ? verifiedAccess({ access: { localDeviceId: "another-device" } }) : access;
        expect(recoverVerifiedActiveDeviceTakeoverPause({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess }))
          .toEqual(expect.objectContaining({ ok: false, recovered: false, code: expectedCode }));
        expect(readPauseRaw()).toBe(before);
      });

      test("a pending queue blocks pause recovery", () => {
        setStaleTakeoverPause();
        const queue = JSON.parse(readQueueRaw());
        localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({ ...queue, pending: true, status: "pending" }));
        const before = readPauseRaw();
        expect(recoverVerifiedActiveDeviceTakeoverPause({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() }))
          .toEqual(expect.objectContaining({ ok: false, recovered: false, code: "pause_queue_pending" }));
        expect(readPauseRaw()).toBe(before);
      });

      test("an unmigrated legacy queue blocks pause recovery", () => {
        setLegacyV1CurrentQueue();
        setStaleTakeoverPause();
        const before = readPauseRaw();
        expect(recoverVerifiedActiveDeviceTakeoverPause({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() }))
          .toEqual(expect.objectContaining({ ok: false, recovered: false, code: "pause_queue_unverified" }));
        expect(readPauseRaw()).toBe(before);
      });

      test("a convergence journal blocks pause recovery", () => {
        setStaleTakeoverPause();
        localStorage.setItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL, JSON.stringify({ version: 1 }));
        const before = readPauseRaw();
        expect(recoverVerifiedActiveDeviceTakeoverPause({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() }))
          .toEqual(expect.objectContaining({ ok: false, recovered: false, code: "pause_journal_present" }));
        expect(readPauseRaw()).toBe(before);
      });

      test("a contradicting workspace blocks pause recovery", () => {
        setStaleTakeoverPause();
        const before = readPauseRaw();
        expect(recoverVerifiedActiveDeviceTakeoverPause({ storage: localStorage, companyId: "other-company", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() }))
          .toEqual(expect.objectContaining({ ok: false, recovered: false }));
        expect(readPauseRaw()).toBe(before);
      });

      test("a verified active device with a clean queue recovers the stale takeover pause", () => {
        setStaleTakeoverPause();
        const result = recoverVerifiedActiveDeviceTakeoverPause({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() });
        expect(result).toEqual(expect.objectContaining({ ok: true, recovered: true, pauseReason: "device_takeover" }));
        expect(readPauseRaw()).toBeNull();
        // The exact prior pause string is preserved for rollback.
        expect(JSON.parse(result.previousRaw)).toEqual(expect.objectContaining({ paused: true, reason: "device_takeover", pausedAt: STALE_TAKEOVER_PAUSED_AT }));
      });
    });

    test("the migration is idempotent: an already-valid schema-v2 queue is byte-for-byte unchanged", () => {
      setJuly10CleanQueue("company-1", 3);
      const before = readQueueRaw();

      const first = migrateLegacyPersistedCloudBackupQueue({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() });
      expect(first).toEqual(expect.objectContaining({ ok: true, migrated: false, code: "queue_already_current" }));
      expect(readQueueRaw()).toBe(before);

      // And migrating the freshly migrated legacy queue twice is a no-op too.
      setLegacyV1CurrentQueue();
      migrateLegacyPersistedCloudBackupQueue({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() });
      const migratedRaw = readQueueRaw();
      const second = migrateLegacyPersistedCloudBackupQueue({ storage: localStorage, companyId: "company-1", activeDeviceId: ACTIVE_DEVICE_ID, deviceAccess: verifiedAccess() });
      expect(second).toEqual(expect.objectContaining({ ok: true, migrated: false, code: "queue_already_current" }));
      expect(readQueueRaw()).toBe(migratedRaw);
    });
  });

});
