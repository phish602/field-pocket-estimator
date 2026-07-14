import { STORAGE_KEYS } from "../constants/storageKeys";
import { buildLocalSnapshotFromStorage } from "./localDataIntegrity";
import { buildCloudConvergencePlan, classifyCloudConvergenceEntity, mergeNonOverlappingCloudMetadata, normalizeCustomerContract, normalizeProjectContract, normalizeEstimateContract, normalizeInvoiceContract, runSupabaseCloudConvergence } from "./supabaseCloudConvergence";

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
