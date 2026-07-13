import { STORAGE_KEYS } from "../constants/storageKeys";
import { buildCloudConvergencePlan, classifyCloudConvergenceEntity, mergeNonOverlappingCloudMetadata, normalizeCustomerContract, normalizeProjectContract, runSupabaseCloudConvergence } from "./supabaseCloudConvergence";

const invoice = (id) => ({ id, customerId: "customer-1", projectId: "project-1", sourceEstimateId: "estimate-1", invoiceNumber: id, invoiceTotal: 10, amountPaid: 0, balanceRemaining: 10, status: "sent", paymentStatus: "unpaid", lineItems: [{ id: `${id}-line`, description: "Labor", quantity: 1, price: 10, total: 10 }], payments: [] });
const baseLocal = () => ({ customers: [{ id: "customer-1" }], projects: [{ id: "project-1", customerId: "customer-1" }], estimates: [{ id: "estimate-1", customerId: "customer-1", projectId: "project-1" }], invoices: [invoice("invoice-1")], companyProfile: null, settings: null, scopeTemplates: [] });

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
