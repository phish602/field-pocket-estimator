import { STORAGE_KEYS } from "../constants/storageKeys";
import { readStoredAuditEvents } from "./auditStore";
import { buildNormalizedProjectView, updateProjectStoredStatus, writeStoredProjects } from "./projects";

function createProject(overrides = {}) {
  return {
    id: "proj_1",
    customerId: "cust_1",
    customerName: "Acme Construction",
    projectName: "Tenant Buildout",
    projectNumber: "P-100",
    siteAddress: "123 Main St",
    status: "active",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function createCustomer(overrides = {}) {
  return {
    id: "cust_1",
    name: "Acme Construction",
    companyName: "Acme Construction",
    fullName: "Acme Construction",
    ...overrides,
  };
}

function createInvoice(overrides = {}) {
  return {
    id: "inv_1",
    projectId: "proj_1",
    customerId: "cust_1",
    customerName: "Acme Construction",
    projectName: "Tenant Buildout",
    invoiceTotal: 500,
    total: 500,
    amountPaid: 0,
    balanceRemaining: 500,
    status: "sent",
    paymentStatus: "unpaid",
    updatedAt: 10,
    createdAt: 9,
    ...overrides,
  };
}

function buildView({ invoices = [] } = {}) {
  return buildNormalizedProjectView({
    project: createProject(),
    projects: [createProject()],
    customers: [createCustomer()],
    estimates: [],
    invoices,
  });
}

describe("buildNormalizedProjectView invoice money rollups", () => {
  test("excludes a void invoice from project money totals while preserving invoice count", () => {
    const view = buildView({
      invoices: [
        createInvoice({
          status: "void",
          paymentStatus: "void",
          invoiceTotal: 500,
          amountPaid: 125,
          balanceRemaining: 375,
        }),
      ],
    });

    expect(view.totals.invoiceCount).toBe(1);
    expect(view.totals.invoiceTotal).toBe(0);
    expect(view.totals.amountPaid).toBe(0);
    expect(view.totals.balanceRemaining).toBe(0);
  });

  test("keeps a non-void invoice contributing to project money totals", () => {
    const view = buildView({
      invoices: [
        createInvoice({
          status: "paid",
          paymentStatus: "paid",
          invoiceTotal: 320,
          amountPaid: 320,
          balanceRemaining: 0,
        }),
      ],
    });

    expect(view.totals.invoiceCount).toBe(1);
    expect(view.totals.invoiceTotal).toBe(320);
    expect(view.totals.amountPaid).toBe(320);
    expect(view.totals.balanceRemaining).toBe(0);
  });

  test("rolls up only non-void invoice money when void and active invoices are mixed", () => {
    const view = buildView({
      invoices: [
        createInvoice({
          id: "inv_void",
          status: "void",
          paymentStatus: "void",
          invoiceTotal: 500,
          amountPaid: 125,
          balanceRemaining: 375,
        }),
        createInvoice({
          id: "inv_sent",
          status: "sent",
          paymentStatus: "unpaid",
          invoiceTotal: 200,
          amountPaid: 0,
          balanceRemaining: 200,
        }),
        createInvoice({
          id: "inv_paid",
          status: "paid",
          paymentStatus: "paid",
          invoiceTotal: 300,
          amountPaid: 300,
          balanceRemaining: 0,
        }),
      ],
    });

    expect(view.totals.invoiceCount).toBe(3);
    expect(view.totals.invoiceTotal).toBe(500);
    expect(view.totals.amountPaid).toBe(300);
    expect(view.totals.balanceRemaining).toBe(200);
  });
});

describe("project audit events", () => {
  beforeEach(() => {
    localStorage.clear();
    writeStoredProjects([createProject()]);
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("emits archive and restore events only at the status transition boundary", () => {
    const archived = updateProjectStoredStatus("proj_1", "archived");
    expect(archived.status).toBe("archived");

    let auditEvents = readStoredAuditEvents();
    expect(auditEvents).toEqual([
      expect.objectContaining({
        type: "project.archived",
        targetType: "project",
        targetId: "proj_1",
        metadata: {
          projectId: "proj_1",
          previousStatus: "active",
          nextStatus: "archived",
        },
      }),
    ]);

    const restored = updateProjectStoredStatus("proj_1", "active");
    expect(restored.status).toBe("active");

    auditEvents = readStoredAuditEvents();
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents[1]).toEqual(expect.objectContaining({
      type: "project.restored",
      targetType: "project",
      targetId: "proj_1",
      metadata: {
        projectId: "proj_1",
        previousStatus: "archived",
        nextStatus: "active",
      },
    }));
    expect(localStorage.getItem(STORAGE_KEYS.AUDIT_EVENTS)).toContain("\"project.restored\"");
  });
});
