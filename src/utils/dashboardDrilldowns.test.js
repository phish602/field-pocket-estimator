import {
  CUSTOMER_DRILLDOWNS,
  DRILLDOWN_SCOPES,
  ESTIMATE_DRILLDOWNS,
  HIGH_VALUE_ESTIMATE_MIN,
  INVOICE_DRILLDOWNS,
  PROJECT_DRILLDOWNS,
  createDrilldownIntent,
  createDrilldownRecordIntent,
  customerMatchesDrilldown,
  estimateMatchesDrilldown,
  hasCollectedPayment,
  invoiceMatchesDrilldown,
  isOverdueInvoice,
  isPaidInvoice,
  isReceivableInvoice,
  projectMatchesDrilldown,
  readDrilldownIntent,
  readDrilldownRecordId,
} from "./dashboardDrilldowns";

const YESTERDAY = "2020-01-01";
const FAR_FUTURE = "2999-01-01";

const overdueInvoice = {
  id: "inv-overdue",
  status: "sent",
  invoiceTotal: 1000,
  amountPaid: 0,
  dueDate: YESTERDAY,
};

const openInvoice = {
  id: "inv-open",
  status: "sent",
  invoiceTotal: 500,
  amountPaid: 100,
  dueDate: FAR_FUTURE,
};

const paidInvoice = {
  id: "inv-paid",
  status: "paid",
  invoiceTotal: 800,
  amountPaid: 800,
};

const voidInvoice = {
  id: "inv-void",
  status: "void",
  invoiceTotal: 400,
  amountPaid: 0,
};

describe("invoice drill-down predicates", () => {
  test("receivables covers every invoice carrying a balance and excludes paid and void", () => {
    expect(isReceivableInvoice(overdueInvoice)).toBe(true);
    expect(isReceivableInvoice(openInvoice)).toBe(true);
    expect(isReceivableInvoice(paidInvoice)).toBe(false);
    expect(isReceivableInvoice(voidInvoice)).toBe(false);
  });

  test("overdue is a strict subset of receivables", () => {
    expect(isOverdueInvoice(overdueInvoice)).toBe(true);
    expect(isOverdueInvoice(openInvoice)).toBe(false);
    [overdueInvoice].forEach((invoice) => {
      expect(isReceivableInvoice(invoice)).toBe(true);
    });
  });

  test("collected counts partial payments that paid does not", () => {
    // The Home and Snapshot money figures sum every recorded payment, so a
    // partially paid invoice must be reachable from them even though it is not
    // a settled invoice.
    expect(hasCollectedPayment(openInvoice)).toBe(true);
    expect(isPaidInvoice(openInvoice)).toBe(false);
    expect(hasCollectedPayment(paidInvoice)).toBe(true);
    expect(hasCollectedPayment(voidInvoice)).toBe(false);
  });

  test("invoiceMatchesDrilldown routes each key to its predicate", () => {
    expect(invoiceMatchesDrilldown(overdueInvoice, INVOICE_DRILLDOWNS.OVERDUE)).toBe(true);
    expect(invoiceMatchesDrilldown(openInvoice, INVOICE_DRILLDOWNS.OVERDUE)).toBe(false);
    expect(invoiceMatchesDrilldown(openInvoice, INVOICE_DRILLDOWNS.RECEIVABLES)).toBe(true);
    expect(invoiceMatchesDrilldown(paidInvoice, INVOICE_DRILLDOWNS.PAID)).toBe(true);
    expect(invoiceMatchesDrilldown(openInvoice, INVOICE_DRILLDOWNS.COLLECTED)).toBe(true);
  });

  test("an empty drill-down matches everything so no filter means no narrowing", () => {
    [overdueInvoice, openInvoice, paidInvoice, voidInvoice].forEach((invoice) => {
      expect(invoiceMatchesDrilldown(invoice, "")).toBe(true);
    });
  });

  test("payment follow-up matches only actionable stripe session states", () => {
    const resolvePending = () => "pending";
    const resolveSynced = () => "synced";
    expect(invoiceMatchesDrilldown(openInvoice, INVOICE_DRILLDOWNS.PAYMENT_STATUS, { resolveSessionState: resolvePending })).toBe(true);
    expect(invoiceMatchesDrilldown(openInvoice, INVOICE_DRILLDOWNS.PAYMENT_STATUS, { resolveSessionState: resolveSynced })).toBe(false);
    // With no resolver there is no truthful answer, so nothing matches.
    expect(invoiceMatchesDrilldown(openInvoice, INVOICE_DRILLDOWNS.PAYMENT_STATUS)).toBe(false);
  });
});

describe("project drill-down predicates", () => {
  const activeProject = { id: "p1", status: "active", totals: { balanceRemaining: 250 }, overdueCount: 1, approvedEstCount: 0 };
  const estimatingProject = { id: "p2", status: "estimating", totals: { balanceRemaining: 0 }, overdueCount: 0, approvedEstCount: 2 };
  const completedProject = { id: "p3", status: "completed", totals: { balanceRemaining: 0 }, overdueCount: 0, approvedEstCount: 0 };

  test("active covers only active jobs while in-motion also covers estimating", () => {
    expect(projectMatchesDrilldown(activeProject, PROJECT_DRILLDOWNS.ACTIVE)).toBe(true);
    expect(projectMatchesDrilldown(estimatingProject, PROJECT_DRILLDOWNS.ACTIVE)).toBe(false);
    expect(projectMatchesDrilldown(estimatingProject, PROJECT_DRILLDOWNS.IN_MOTION)).toBe(true);
    expect(projectMatchesDrilldown(completedProject, PROJECT_DRILLDOWNS.IN_MOTION)).toBe(false);
  });

  test("status resolves from the derived display status Home attaches", () => {
    const homeShapedProject = { id: "p4", status: "draft", _displayStatus: { key: "active" } };
    expect(projectMatchesDrilldown(homeShapedProject, PROJECT_DRILLDOWNS.ACTIVE)).toBe(true);
  });

  test("balance and ready-to-invoice read the same fields the hero metrics sum", () => {
    expect(projectMatchesDrilldown(activeProject, PROJECT_DRILLDOWNS.BALANCE)).toBe(true);
    expect(projectMatchesDrilldown(estimatingProject, PROJECT_DRILLDOWNS.BALANCE)).toBe(false);
    expect(projectMatchesDrilldown(activeProject, PROJECT_DRILLDOWNS.OVERDUE)).toBe(true);
    expect(projectMatchesDrilldown(estimatingProject, PROJECT_DRILLDOWNS.READY_TO_INVOICE)).toBe(true);
  });
});

describe("estimate drill-down predicates", () => {
  const normalizeStatus = (value) => String(value || "").trim().toLowerCase();
  const pending = { id: "e1", status: "pending", total: 500 };
  const approvedReady = { id: "e2", status: "approved", total: 25000 };
  const approvedFullyInvoiced = { id: "e3", status: "approved", total: 12000 };

  const options = {
    normalizeStatus,
    remainingToInvoice: (estimate) => (estimate.id === "e2" ? 25000 : 0),
  };

  test("awaiting matches pending estimates only", () => {
    expect(estimateMatchesDrilldown(pending, ESTIMATE_DRILLDOWNS.AWAITING, options)).toBe(true);
    expect(estimateMatchesDrilldown(approvedReady, ESTIMATE_DRILLDOWNS.AWAITING, options)).toBe(false);
  });

  test("ready-to-invoice needs both approval and remaining invoiceable value", () => {
    expect(estimateMatchesDrilldown(approvedReady, ESTIMATE_DRILLDOWNS.READY_TO_INVOICE, options)).toBe(true);
    expect(estimateMatchesDrilldown(approvedFullyInvoiced, ESTIMATE_DRILLDOWNS.READY_TO_INVOICE, options)).toBe(false);
    expect(estimateMatchesDrilldown(pending, ESTIMATE_DRILLDOWNS.READY_TO_INVOICE, options)).toBe(false);
  });

  test("high value uses the one shared threshold, not a new one", () => {
    expect(HIGH_VALUE_ESTIMATE_MIN).toBe(10000);
    expect(estimateMatchesDrilldown({ total: HIGH_VALUE_ESTIMATE_MIN }, ESTIMATE_DRILLDOWNS.HIGH_VALUE)).toBe(true);
    expect(estimateMatchesDrilldown({ total: HIGH_VALUE_ESTIMATE_MIN - 1 }, ESTIMATE_DRILLDOWNS.HIGH_VALUE)).toBe(false);
  });
});

describe("customer drill-down predicates", () => {
  const customerKpis = {
    c1: { balanceDue: 400, estimateCount: 0, openInvoiceCount: 1, overdueInvoiceCount: 1 },
    c2: { balanceDue: 0, estimateCount: 0, openInvoiceCount: 0, overdueInvoiceCount: 0 },
  };
  const customerProjectMeta = { c1: { projectCount: 2 }, c2: { projectCount: 0 } };
  const options = { customerKpis, customerProjectMeta };

  test("each metric matches exactly the accounts that contribute to it", () => {
    expect(customerMatchesDrilldown({ id: "c1" }, CUSTOMER_DRILLDOWNS.BALANCE_DUE, options)).toBe(true);
    expect(customerMatchesDrilldown({ id: "c2" }, CUSTOMER_DRILLDOWNS.BALANCE_DUE, options)).toBe(false);
    expect(customerMatchesDrilldown({ id: "c1" }, CUSTOMER_DRILLDOWNS.LINKED_PROJECTS, options)).toBe(true);
    expect(customerMatchesDrilldown({ id: "c2" }, CUSTOMER_DRILLDOWNS.LINKED_PROJECTS, options)).toBe(false);
    expect(customerMatchesDrilldown({ id: "c1" }, CUSTOMER_DRILLDOWNS.OPEN_DOCUMENTS, options)).toBe(true);
    expect(customerMatchesDrilldown({ id: "c2" }, CUSTOMER_DRILLDOWNS.OPEN_DOCUMENTS, options)).toBe(false);
  });
});

describe("drill-down intents", () => {
  test("an intent carries scope, subset, and a sequence for one-time consumption", () => {
    const intent = createDrilldownIntent(DRILLDOWN_SCOPES.INVOICES, INVOICE_DRILLDOWNS.OVERDUE);
    expect(intent.scope).toBe(DRILLDOWN_SCOPES.INVOICES);
    expect(intent.drilldown).toBe(INVOICE_DRILLDOWNS.OVERDUE);
    expect(Number(intent.seq)).toBeGreaterThan(0);
  });

  test("a destination only reads intents addressed to its own scope", () => {
    const intent = createDrilldownIntent(DRILLDOWN_SCOPES.INVOICES, INVOICE_DRILLDOWNS.OVERDUE);
    expect(readDrilldownIntent(intent, DRILLDOWN_SCOPES.INVOICES)).toBe(INVOICE_DRILLDOWNS.OVERDUE);
    expect(readDrilldownIntent(intent, DRILLDOWN_SCOPES.PROJECTS)).toBe("");
    expect(readDrilldownIntent(null, DRILLDOWN_SCOPES.INVOICES)).toBe("");
  });

  test("record intents name an exact record instead of a subset", () => {
    const intent = createDrilldownRecordIntent(DRILLDOWN_SCOPES.INVOICES, "inv-77");
    expect(readDrilldownRecordId(intent, DRILLDOWN_SCOPES.INVOICES)).toBe("inv-77");
    expect(readDrilldownIntent(intent, DRILLDOWN_SCOPES.INVOICES)).toBe("");
    expect(readDrilldownRecordId(intent, DRILLDOWN_SCOPES.ESTIMATES)).toBe("");
  });

  test("incomplete intents are refused rather than half-created", () => {
    expect(createDrilldownIntent("", INVOICE_DRILLDOWNS.OVERDUE)).toBeNull();
    expect(createDrilldownIntent(DRILLDOWN_SCOPES.INVOICES, "")).toBeNull();
    expect(createDrilldownRecordIntent(DRILLDOWN_SCOPES.INVOICES, "")).toBeNull();
  });
});
