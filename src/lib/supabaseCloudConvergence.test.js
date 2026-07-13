import { STORAGE_KEYS } from "../constants/storageKeys";
import { buildCloudConvergencePlan, classifyCloudConvergenceEntity, mergeNonOverlappingCloudMetadata, normalizeCustomerContract, normalizeProjectContract, runSupabaseCloudConvergence } from "./supabaseCloudConvergence";

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
