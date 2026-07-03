import { render, screen } from "@testing-library/react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import ProjectDetailScreen from "./ProjectDetailScreen";

const PROJECTS_KEY = STORAGE_KEYS.PROJECTS;
const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const PROJECT_DETAIL_TARGET_KEY = "estipaid-project-detail-target-v1";

function setViewportWidth(width) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

function seedProject(project) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify([project]));
}

function seedProjectDetailTarget(projectId) {
  localStorage.setItem(PROJECT_DETAIL_TARGET_KEY, projectId);
}

function createProject(overrides = {}) {
  return {
    id: "proj_test",
    projectName: "Test Project",
    customerName: "Test Customer",
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// The project totals appear twice: once in the "Hero" card grid at the top
// (the one that used to overflow on mobile) and again in the "Overview"
// section further down (which already used a safe auto-fit grid). These
// helpers find the Hero instance specifically by excluding the Overview
// grid's distinct auto-fit column template.
function heroFinancialGrid(labelText) {
  const candidates = screen.getAllByText(labelText).map((node) => node.parentElement.parentElement);
  const hero = candidates.find((grid) => !String(grid.style.gridTemplateColumns || "").includes("auto-fit"));
  if (!hero) throw new Error(`Could not find hero financial grid for "${labelText}"`);
  return hero;
}

function heroValueFor(labelText) {
  const grid = heroFinancialGrid(labelText);
  const label = Array.from(grid.querySelectorAll("div")).find((node) => node.textContent === labelText);
  return label.parentElement.children[1];
}

describe("ProjectDetailScreen mobile financial card layout", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewportWidth(1024);
  });

  afterEach(() => {
    localStorage.clear();
    setViewportWidth(1024);
  });

  test("uses a single-column financial grid on narrow phone widths, preventing card overlap", () => {
    setViewportWidth(375);
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    expect(heroFinancialGrid("Estimated").style.gridTemplateColumns).toBe("1fr");
  });

  test("keeps the 4-column financial grid on tablet/desktop widths", () => {
    setViewportWidth(1024);
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    expect(heroFinancialGrid("Estimated").style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  });

  test("financial values use safe overflow wrapping instead of truncating on narrow phone widths", () => {
    setViewportWidth(375);
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");
    localStorage.setItem(INVOICES_KEY, JSON.stringify([
      {
        id: "inv_1",
        docType: "invoice",
        projectId: "proj_1",
        invoiceNumber: "INV-1",
        invoiceTotal: 9209.68,
        total: 9209.68,
        status: "sent",
        paymentStatus: "partial",
        amountPaid: 2600,
        balanceRemaining: 3846.77,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      },
    ]));

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    const invoicedValue = heroValueFor("Invoiced");
    expect(invoicedValue.style.overflowWrap).toBe("anywhere");
    expect(invoicedValue.style.maxWidth).toBe("100%");
    // No truncation: the full, exact currency string is present.
    expect(invoicedValue.textContent).toBe("$9,209.68");
  });

  test("large currency totals still render accurately (Invoiced, Paid, Balance Due)", () => {
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");
    localStorage.setItem(INVOICES_KEY, JSON.stringify([
      {
        id: "inv_1",
        docType: "invoice",
        projectId: "proj_1",
        invoiceNumber: "INV-1",
        invoiceTotal: 6446.77,
        total: 6446.77,
        status: "sent",
        paymentStatus: "partial",
        amountPaid: 2600,
        balanceRemaining: 3846.77,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      },
    ]));

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    expect(heroValueFor("Invoiced").textContent).toBe("$6,446.77");
    expect(heroValueFor("Paid").textContent).toBe("$2,600.00");
    expect(heroValueFor("Balance Due").textContent).toBe("$3,846.77");
  });
});
