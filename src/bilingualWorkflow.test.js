// Lane 5: the migrated contractor workflow renders through one shared bilingual
// owner, and switching language is presentation-only -- it must never create or
// mutate a business record.
import React from "react";
import { act, render, screen, within } from "@testing-library/react";

import { STORAGE_KEYS } from "./constants/storageKeys";
import { getLanguage, setLanguage, translate } from "./lib/i18n";
import EstimatesScreen from "./screens/EstimatesScreen";
import InvoicesScreen from "./screens/InvoicesScreen";
import CustomersScreen from "./screens/CustomersScreen";
import ProjectsScreen from "./screens/ProjectsScreen";
import TemplatesScreen from "./screens/TemplatesScreen";
import NewProjectScreen from "./screens/NewProjectScreen";
import CompanyProfileScreen from "./screens/CompanyProfileScreen";
import AdvancedSettingsScreen from "./screens/AdvancedSettingsScreen";

const ESTIMATE = {
  id: "est_lane5",
  docType: "estimate",
  estimateNumber: "EST-5001",
  projectName: "Sonoran Retail Striping",
  customerName: "Sonoran Retail Plaza LLC",
  status: "approved",
  total: 13056,
  updatedAt: 1714694400000,
  createdAt: 1714694300000,
  savedAt: 1714694400000,
  ts: 1714694400000,
};

const INVOICE = {
  id: "inv_lane5",
  docType: "invoice",
  invoiceNumber: "INV-7001",
  projectName: "Sonoran Retail Striping",
  customerName: "Sonoran Retail Plaza LLC",
  status: "sent",
  invoiceTotal: 13056,
  total: 13056,
  amountPaid: 0,
  balanceRemaining: 13056,
  updatedAt: 1714694400000,
  createdAt: 1714694300000,
  savedAt: 1714694400000,
  ts: 1714694400000,
};

const CUSTOMER = {
  id: "cus_lane5",
  customerType: "commercial",
  companyName: "Sonoran Retail Plaza LLC",
  contactName: "Marisol Vega",
  phone: "555-0100",
  email: "ap@sonoran.example",
};

function seedWorkspace() {
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([ESTIMATE]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([INVOICE]));
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([CUSTOMER]));
}

// A byte-for-byte fingerprint of every business record the workflow can see.
function businessFingerprint() {
  return JSON.stringify({
    estimates: localStorage.getItem(STORAGE_KEYS.ESTIMATES),
    invoices: localStorage.getItem(STORAGE_KEYS.INVOICES),
    customers: localStorage.getItem(STORAGE_KEYS.CUSTOMERS),
    projects: localStorage.getItem(STORAGE_KEYS.PROJECTS),
  });
}

// "Saved Estimates (3)" -- heading copy plus a live count.
function headingMatcher(language) {
  const heading = translate(language, "estimates.savedEstimates");
  return (content) => String(content).startsWith(heading);
}

function settle() {
  act(() => {
    jest.advanceTimersByTime(400);
  });
}

function switchTo(language) {
  act(() => {
    setLanguage(language);
    jest.advanceTimersByTime(50);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  setLanguage("en");
  localStorage.clear();
  seedWorkspace();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("migrated screens render both languages from the shared owner", () => {
  it("Estimates switches its heading and actions in place", () => {
    render(<EstimatesScreen history={[ESTIMATE]} />);
    settle();
    expect(screen.getAllByText(headingMatcher("en")).length).toBeGreaterThan(0);

    switchTo("es");
    expect(screen.getAllByText(headingMatcher("es")).length).toBeGreaterThan(0);
    expect(screen.queryByText(headingMatcher("en"))).toBeNull();

    switchTo("en");
    expect(screen.getAllByText(headingMatcher("en")).length).toBeGreaterThan(0);
  });

  it("Invoices switches its heading in place", () => {
    render(<InvoicesScreen />);
    settle();
    const englishTitle = translate("en", "invoices.invoices");
    const spanishTitle = translate("es", "invoices.invoices");
    expect(englishTitle).not.toBe(spanishTitle);
    expect(screen.getAllByText(englishTitle).length).toBeGreaterThan(0);

    switchTo("es");
    expect(screen.getAllByText(spanishTitle).length).toBeGreaterThan(0);
    expect(screen.queryByText(englishTitle)).toBeNull();
  });

  it("Customers switches its heading in place", () => {
    render(<CustomersScreen customers={[CUSTOMER]} />);
    settle();
    expect(screen.getAllByText("Customers").length).toBeGreaterThan(0);

    switchTo("es");
    expect(screen.getAllByText("Clientes").length).toBeGreaterThan(0);
    expect(screen.queryByText("Customers")).toBeNull();
  });

  it("Projects switches its heading and empty-state copy in place", () => {
    render(<ProjectsScreen />);
    settle();
    const enEmpty = translate("en", "projects.noProjectsYet");
    const esEmpty = translate("es", "projects.noProjectsYet");
    const showsEmpty = screen.queryByText(enEmpty) !== null;

    switchTo("es");
    if (showsEmpty) {
      expect(screen.getByText(esEmpty)).toBeInTheDocument();
      expect(screen.queryByText(enEmpty)).toBeNull();
    } else {
      expect(screen.getAllByText(translate("es", "projects.title")).length).toBeGreaterThan(0);
    }
  });
});

describe("language switching is presentation-only", () => {
  it("leaves every business record byte-identical across en -> es -> en", () => {
    render(<EstimatesScreen history={[ESTIMATE]} />);
    settle();
    const before = businessFingerprint();

    switchTo("es");
    settle();
    expect(businessFingerprint()).toBe(before);

    switchTo("en");
    settle();
    expect(businessFingerprint()).toBe(before);
  });

  it("never translates customer-entered or project-entered content", () => {
    render(<EstimatesScreen history={[ESTIMATE]} />);
    settle();
    switchTo("es");

    // Names the contractor typed stay exactly as typed in both languages.
    expect(screen.getAllByText(/Sonoran Retail Plaza LLC/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/EST-5001/).length).toBeGreaterThan(0);
  });

  it("writes only the language key, never a business key", () => {
    render(<InvoicesScreen />);
    settle();
    const before = businessFingerprint();

    // Spy without replacing behaviour: the write still lands, we just record it.
    const writes = [];
    const original = Storage.prototype.setItem;
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(
      function record(key, value) {
        writes.push(String(key));
        return original.call(this, key, value);
      }
    );
    try {
      setLanguage("es");
    } finally {
      setItem.mockRestore();
    }

    expect(writes).toEqual([STORAGE_KEYS.LANG]);
    expect(businessFingerprint()).toBe(before);
  });

  it("keeps the stored preference and the live value in agreement", () => {
    render(<EstimatesScreen history={[ESTIMATE]} />);
    settle();

    switchTo("es");
    expect(localStorage.getItem(STORAGE_KEYS.LANG)).toBe("es");
    expect(getLanguage()).toBe("es");

    switchTo("en");
    expect(localStorage.getItem(STORAGE_KEYS.LANG)).toBe("en");
    expect(getLanguage()).toBe("en");
  });
});

describe("late-migrated screens also follow the shared owner", () => {
  it("Templates switches its heading and empty state", () => {
    render(<TemplatesScreen onOpenBuilder={jest.fn()} />);
    settle();
    expect(screen.getAllByText(translate("en", "templates.templates")).length).toBeGreaterThan(0);

    switchTo("es");
    expect(screen.getAllByText(translate("es", "templates.templates")).length).toBeGreaterThan(0);
    expect(screen.queryByText(translate("en", "templates.noSavedTemplatesYet"))).toBeNull();
  });

  it("New Project switches its heading and field labels", () => {
    render(<NewProjectScreen onBack={jest.fn()} onSave={jest.fn()} />);
    settle();
    expect(screen.getAllByText(translate("en", "newproject.newProject")).length).toBeGreaterThan(0);

    switchTo("es");
    expect(screen.getAllByText(translate("es", "newproject.newProject")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(translate("es", "newproject.projectName")).length).toBeGreaterThan(0);
  });

  it("Company Profile switches its heading", () => {
    render(<CompanyProfileScreen />);
    settle();
    expect(screen.getAllByText(translate("en", "profile.companyProfile")).length).toBeGreaterThan(0);

    switchTo("es");
    expect(screen.getAllByText(translate("es", "profile.companyProfile")).length).toBeGreaterThan(0);
    expect(screen.queryByText(translate("en", "profile.companyProfile"))).toBeNull();
  });

  it("Settings switches both its own copy and its cloud-backup section", () => {
    render(<AdvancedSettingsScreen />);
    settle();
    expect(screen.getAllByText(translate("en", "settings.title")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(translate("en", "settings.sectionCloudBackup")).length).toBeGreaterThan(0);

    switchTo("es");
    expect(screen.getAllByText(translate("es", "settings.title")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(translate("es", "settings.sectionCloudBackup")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(translate("es", "settings.sectionLanguage")).length).toBeGreaterThan(0);
  });

  it("the Settings language control writes through the shared owner", () => {
    render(<AdvancedSettingsScreen />);
    settle();
    const spanishButton = document.querySelector('[data-language-option="es"]');
    expect(spanishButton).not.toBeNull();

    act(() => {
      spanishButton.click();
    });

    expect(getLanguage()).toBe("es");
    expect(localStorage.getItem(STORAGE_KEYS.LANG)).toBe("es");
    expect(screen.getAllByText(translate("es", "settings.title")).length).toBeGreaterThan(0);
  });
});

describe("no duplicate language state survives in migrated surfaces", () => {
  it("ignores a stale lang prop and follows the shared owner instead", () => {
    // The shell used to thread `lang` down as a prop. A screen that still
    // honoured such a prop would be a second source of truth.
    render(<EstimatesScreen lang="en" t={(key) => key} history={[ESTIMATE]} />);
    settle();

    switchTo("es");
    expect(screen.getAllByText(headingMatcher("es")).length).toBeGreaterThan(0);
  });

  it("mounts two migrated screens on the same value", () => {
    const { container: a } = render(<EstimatesScreen history={[ESTIMATE]} />);
    const { container: b } = render(<InvoicesScreen />);
    settle();
    switchTo("es");

    expect(within(a).getAllByText(headingMatcher("es")).length).toBeGreaterThan(0);
    expect(within(b).getAllByText(translate("es", "invoices.invoices")).length).toBeGreaterThan(0);
  });
});
