import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";

const COMPLETE_COMPANY_PROFILE = {
  companyName: "Acme Field Services",
  phone: "5551234567",
  addressLine1: "123 Main St",
  city: "Springfield",
  state: "IL",
  zip: "62704",
};

const CUSTOMER_SEARCH_PLACEHOLDER = "Search or select a customer…";

function seedCompanyProfile() {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(COMPLETE_COMPANY_PROFILE));
}

function seedTemplates(records) {
  localStorage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, JSON.stringify(records));
}

function buildEstimatorDraft(overrides = {}) {
  return {
    ui: {
      docType: "estimate",
      materialsMode: "itemized",
      ...(overrides.ui || {}),
    },
    customer: {
      id: "",
      name: "",
      projectName: "",
      projectAddress: "",
      ...(overrides.customer || {}),
    },
    job: {
      docNumber: "",
      location: "",
      ...(overrides.job || {}),
    },
    scopeNotes: overrides.scopeNotes !== undefined ? overrides.scopeNotes : "",
    scopeImages: Array.isArray(overrides.scopeImages) ? overrides.scopeImages : [],
    labor: {
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
      lines: [{ id: "l1", role: "", label: "", hours: "", rate: "", trueRateInternal: "", internalRate: "", qty: 1 }],
      ...(overrides.labor || {}),
    },
    materials: {
      blanketCost: "",
      blanketInternalCost: "",
      materialsBlanketDescription: "",
      markupPct: 0,
      items: [{ id: "m1", desc: "", note: "", qty: 1, cost: "", unitCostInternal: "", costInternal: "", charge: "", priceEach: "", markupPct: 0 }],
      ...(overrides.materials || {}),
    },
    additionalCharges: {
      items: [],
      ...(overrides.additionalCharges || {}),
    },
    additionalNotes: "",
    ...(overrides.additionalNotes !== undefined ? { additionalNotes: overrides.additionalNotes } : {}),
  };
}

function seedEstimatorDraft(overrides = {}) {
  localStorage.setItem(
    STORAGE_KEYS.ESTIMATOR_STATE,
    JSON.stringify(buildEstimatorDraft(overrides))
  );
}

function readStoredTemplates() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.SCOPE_TEMPLATES) || "[]");
}

function readEstimatorDraft() {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE) || "null");
}

function buildScopeImages(count = 1, startIndex = 1) {
  return Array.from({ length: count }, (_, index) => ({
    id: `scope-image-${startIndex + index}`,
    name: `Template Photo ${startIndex + index}.jpg`,
    mimeType: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,templatephoto${startIndex + index}`,
    storedWidth: 1024,
    storedHeight: 768,
    storedSizeBytes: 140000 + index,
    layout: {
      size: index % 2 === 0 ? "medium" : "large",
      align: index % 2 === 0 ? "center" : "left",
      caption: index % 2 === 0,
    },
  }));
}

function buildFullWorkTemplate(overrides = {}) {
  return {
    id: "tmpl_full_package",
    name: "Roof Repair Package",
    scopeText: "Repair the leaking roof curb and reseal all flashing.",
    laborItems: [
      {
        id: "labor_template_1",
        role: "technician",
        label: "Technician",
        hours: "4",
        rate: "125",
        trueRateInternal: "70",
        internalRate: "70",
        qty: 1,
      },
    ],
    materialItems: [
      {
        id: "material_template_1",
        desc: "Sealant kit",
        note: "Include primer",
        qty: 2,
        cost: "25",
        unitCostInternal: "25",
        costInternal: "25",
        charge: "45",
        priceEach: "45",
        markupPct: "40",
      },
    ],
    additionalChargeItems: [
      {
        id: "charge_template_1",
        desc: "Lift rental",
        qty: "1",
        priceEach: "150",
      },
    ],
    additionalNotes: "Dispose of debris and clean the work area.",
    schemaVersion: 2,
    createdAt: 1710000000000,
    updatedAt: 1710000000000,
    ...overrides,
  };
}

function openTemplatesFromMenu() {
  fireEvent.click(screen.getByLabelText("Open Menu"));
  const menu = screen.getByRole("dialog", { name: "Menu" });
  fireEvent.click(within(menu).getByRole("button", { name: "Templates" }));
}

async function openEstimateBuilderViaCreate() {
  seedCompanyProfile();
  fireEvent.click(screen.getByLabelText("Create"));
  const launcher = await screen.findByRole("dialog", { name: /Start New/i });
  fireEvent.click(within(launcher).getByRole("button", { name: /^Estimate$|^New Estimate$|^Resume Estimate Draft$/i }));
  await screen.findByText(/Estimate Builder/i);
  await screen.findByText(/Your saved templates/i);
}

function getSavedTemplateSelect() {
  const label = screen.getByText(/Your saved templates/i);
  const select = label.parentElement?.parentElement?.querySelector("select");
  if (!select) throw new Error("Saved template select not found");
  return select;
}

function setScopeText(text) {
  const editor = document.querySelector(".pe-scope-textarea");
  if (!editor) throw new Error("Scope editor not found");
  editor.textContent = text;
  fireEvent.input(editor);
}

function getScopeEditor() {
  const editor = document.querySelector(".pe-scope-textarea");
  if (!editor) throw new Error("Scope editor not found");
  return editor;
}

beforeEach(() => {
  localStorage.clear();
  seedCompanyProfile();
  jest.restoreAllMocks();
});

test("1. Hamburger Templates opens a real Templates screen with a useful empty state", async () => {
  render(<App />);

  openTemplatesFromMenu();

  expect(await screen.findByRole("heading", { name: "Templates" })).toBeInTheDocument();
  expect(screen.getByText(/No saved templates yet/i)).toBeInTheDocument();
  expect(screen.getByText(/does not replace customer or job details/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Open Estimate Builder/i })).not.toBeInTheDocument();
});

test("2. Saving a template from builder stays in place, shows success, and stores the existing template shape", async () => {
  jest.spyOn(window, "prompt").mockReturnValue("Roof Repair Package");
  const scopeImages = buildScopeImages(2);
  seedEstimatorDraft({
    customer: {
      id: "cust_123",
      name: "Customer A",
      projectName: "Hangar Roof",
      projectAddress: "123 Jobsite Ave",
    },
    job: {
      docNumber: "EST-101",
      location: "Roof Section A",
    },
    scopeNotes: "Repair the leaking roof curb and reseal all flashing.\n[scope-image:scope-image-1]\n[scope-image:scope-image-2]",
    scopeImages,
    labor: {
      lines: [
        {
          id: "labor_1",
          role: "technician",
          label: "Technician",
          hours: "4",
          rate: "125",
          trueRateInternal: "70",
          internalRate: "70",
          qty: 1,
        },
      ],
    },
    materials: {
      items: [
        {
          id: "material_1",
          desc: "Sealant kit",
          note: "Include primer",
          qty: 2,
          cost: "25",
          unitCostInternal: "25",
          costInternal: "25",
          charge: "45",
          priceEach: "45",
          markupPct: "40",
        },
      ],
    },
    additionalCharges: {
      items: [{ id: "charge_1", desc: "Lift rental", qty: "1", priceEach: "150" }],
    },
    additionalNotes: "Dispose of debris and clean the work area.",
  });

  render(<App />);

  await openEstimateBuilderViaCreate();
  setScopeText("Repair the leaking roof curb and reseal all flashing.\n[scope-image:scope-image-1]\n[scope-image:scope-image-2]");
  fireEvent.click(screen.getByRole("button", { name: /Save as Template/i }));

  expect(await screen.findByText("Template saved")).toBeInTheDocument();
  expect(screen.getByText(/Estimate Builder/i)).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Leave edit session" })).not.toBeInTheDocument();

  const storedTemplates = readStoredTemplates();
  expect(storedTemplates).toHaveLength(1);
  expect(storedTemplates[0]).toMatchObject({
    name: "Roof Repair Package",
    scopeText: "Repair the leaking roof curb and reseal all flashing.\n[scope-image:scope-image-1]\n[scope-image:scope-image-2]",
    laborItems: [
      expect.objectContaining({
        label: "Technician",
        hours: "4",
        rate: "125",
      }),
    ],
    materialItems: [
      expect.objectContaining({
        desc: "Sealant kit",
        priceEach: "45",
      }),
    ],
    additionalChargeItems: [
      expect.objectContaining({
        desc: "Lift rental",
        priceEach: "150",
      }),
    ],
    additionalNotes: "Dispose of debris and clean the work area.",
    sourceEstimateNumber: "EST-101",
    scopeImages,
  });
  expect(storedTemplates[0].customer).toBeUndefined();
  expect(storedTemplates[0].customerId).toBeUndefined();
  expect(storedTemplates[0].customerName).toBeUndefined();
  expect(storedTemplates[0].projectId).toBeUndefined();
  expect(storedTemplates[0].projectName).toBeUndefined();
  expect(storedTemplates[0].job).toBeUndefined();
  expect(storedTemplates[0].paymentStatus).toBeUndefined();
  expect(storedTemplates[0].savedDocId).toBeUndefined();

  expect(getScopeEditor().textContent).toContain("Repair the leaking roof curb and reseal all flashing.");
  expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("Customer A");

  openTemplatesFromMenu();
  expect(await screen.findByRole("heading", { name: "Templates" })).toBeInTheDocument();
  expect(screen.getByText("Roof Repair Package")).toBeInTheDocument();
}, 10000);

test("3. Templates screen lists saved template and shows work-package counts", async () => {
  seedTemplates([buildFullWorkTemplate()]);

  render(<App />);

  openTemplatesFromMenu();

  expect(await screen.findByText("Roof Repair Package")).toBeInTheDocument();
  expect(screen.getByText(/Repair the leaking roof curb and reseal all flashing/i)).toBeInTheDocument();
  expect(screen.getByText(/1 scope line • 1 labor line • 1 material • 1 additional charge • notes included/i)).toBeInTheDocument();
});

test("4. Builder dropdown applies a full work-package template to a different customer without changing the customer", async () => {
  const scopeImages = buildScopeImages(2, 7);
  seedTemplates([buildFullWorkTemplate({
    scopeText: "Repair the leaking roof curb and reseal all flashing.\n[scope-image:scope-image-7]\n[scope-image:scope-image-8]",
    scopeImages,
  })]);
  seedEstimatorDraft({
    customer: {
      id: "cust_other",
      name: "Different Customer",
    },
  });

  render(<App />);

  await openEstimateBuilderViaCreate();
  fireEvent.change(getSavedTemplateSelect(), { target: { value: "tmpl_full_package" } });

  await waitFor(() => {
    const draft = readEstimatorDraft();
    expect(draft.customer.name).toBe("Different Customer");
    expect(draft.scopeNotes).toContain("Repair the leaking roof curb and reseal all flashing.");
    expect(draft.scopeNotes).toContain("[scope-image:scope-image-1]");
    expect(draft.scopeNotes).toContain("[scope-image:scope-image-2]");
    expect(draft.scopeImages).toEqual([
      expect.objectContaining({ id: "scope-image-1", name: "Template Photo 7.jpg" }),
      expect.objectContaining({ id: "scope-image-2", name: "Template Photo 8.jpg" }),
    ]);
    expect(draft.labor.lines[0]).toEqual(expect.objectContaining({ label: "Technician", hours: "4" }));
    expect(draft.materials.items[0]).toEqual(expect.objectContaining({ desc: "Sealant kit", priceEach: "45" }));
    expect(draft.additionalCharges.items[0]).toEqual(expect.objectContaining({ desc: "Lift rental", priceEach: "150" }));
    expect(draft.additionalNotes).toBe("Dispose of debris and clean the work area.");
  });
  expect(screen.getByAltText("Template Photo 7.jpg")).toBeInTheDocument();
  expect(screen.getByAltText("Template Photo 8.jpg")).toBeInTheDocument();
});

test("5. Applying a full template asks for confirmation before replacing existing work content and only replaces work fields", async () => {
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  const scopeImages = buildScopeImages(2, 7);
  seedTemplates([buildFullWorkTemplate({
    scopeText: "Repair the leaking roof curb and reseal all flashing.\n[scope-image:scope-image-7]\n[scope-image:scope-image-8]",
    scopeImages,
  })]);
  seedEstimatorDraft({
    customer: {
      id: "cust_current",
      name: "Current Customer",
      projectName: "Existing Project",
    },
    scopeNotes: "Old scope text",
    labor: {
      lines: [{ id: "old_labor", label: "Old Tech", role: "old", hours: "2", rate: "90", trueRateInternal: "40", qty: 1 }],
    },
    materials: {
      items: [{ id: "old_material", desc: "Old Material", qty: 1, priceEach: "30", cost: "20", unitCostInternal: "20", costInternal: "20" }],
    },
    additionalCharges: {
      items: [{ id: "old_charge", desc: "Old Charge", qty: "1", priceEach: "25" }],
    },
    additionalNotes: "Old terms",
    scopeImages: buildScopeImages(1),
  });

  render(<App />);

  await openEstimateBuilderViaCreate();
  fireEvent.change(getSavedTemplateSelect(), { target: { value: "tmpl_full_package" } });

  expect(confirmSpy).toHaveBeenCalledWith(
    "Apply this template and replace the current scope, labor, materials, additional charges, and notes? Customer, project, and job details will stay as-is."
  );

  await waitFor(() => {
    const draft = readEstimatorDraft();
    expect(draft.customer.name).toBe("Current Customer");
    expect(draft.customer.projectName).toBe("Existing Project");
    expect(draft.scopeNotes).toContain("Repair the leaking roof curb and reseal all flashing.");
    expect(draft.scopeNotes).toContain("[scope-image:scope-image-1]");
    expect(draft.scopeNotes).toContain("[scope-image:scope-image-2]");
    expect(draft.scopeImages).toEqual([
      expect.objectContaining({ id: "scope-image-1", name: "Template Photo 7.jpg" }),
      expect.objectContaining({ id: "scope-image-2", name: "Template Photo 8.jpg" }),
    ]);
    expect(draft.labor.lines[0]).toEqual(expect.objectContaining({ label: "Technician" }));
    expect(draft.materials.items[0]).toEqual(expect.objectContaining({ desc: "Sealant kit" }));
    expect(draft.additionalCharges.items[0]).toEqual(expect.objectContaining({ desc: "Lift rental" }));
    expect(draft.additionalNotes).toBe("Dispose of debris and clean the work area.");
  });
});

test("9. Applying a template with more than 8 scope photos shows a friendly message and leaves the estimate unchanged", async () => {
  const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
  jest.spyOn(window, "confirm").mockReturnValue(true);
  seedTemplates([buildFullWorkTemplate({
    id: "tmpl_too_many_scope_photos",
    name: "Too Many Scope Photos",
    scopeText: "Too many photos template",
    scopeImages: buildScopeImages(9),
  })]);
  seedEstimatorDraft({
    customer: {
      id: "cust_limit",
      name: "Limit Customer",
    },
    scopeNotes: "Keep this scope as-is.",
  });

  render(<App />);

  await openEstimateBuilderViaCreate();
  fireEvent.change(getSavedTemplateSelect(), { target: { value: "tmpl_too_many_scope_photos" } });

  expect(alertSpy).toHaveBeenCalledWith("This template has too many photos for this document. Remove some photos and try again.");

  await waitFor(() => {
    const draft = readEstimatorDraft();
    expect(draft.scopeNotes).toBe("Keep this scope as-is.");
    expect(Array.isArray(draft.scopeImages) ? draft.scopeImages : []).toHaveLength(0);
  });
});

test("10. Save as Template shows a friendly storage-full message when template storage hits quota", async () => {
  jest.spyOn(window, "prompt").mockReturnValue("Quota Template");
  seedEstimatorDraft({
    customer: {
      id: "cust_quota_template",
      name: "Quota Template Customer",
      projectName: "Quota Template Project",
      projectAddress: "123 Jobsite Ave",
    },
    job: {
      docNumber: "EST-QT-1",
      location: "Roof Section B",
    },
    scopeNotes: "Quota template scope.\n[scope-image:scope-image-1]",
    scopeImages: buildScopeImages(1),
  });

  render(<App />);

  await openEstimateBuilderViaCreate();

  const actualSetItem = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(function setItemWithQuota(key, value) {
    if (key === STORAGE_KEYS.SCOPE_TEMPLATES) {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    }
    return actualSetItem.call(this, key, value);
  });

  fireEvent.click(screen.getByRole("button", { name: /Save as Template/i }));

  expect(await screen.findByText("Storage is full. Remove some photos or templates and try again.")).toBeInTheDocument();
  expect(readStoredTemplates()).toEqual([]);
});

test("6. Existing scope-only legacy template still appears and applies scope safely", async () => {
  seedTemplates([
    {
      id: "tmpl_legacy_scope",
      name: "Legacy Scope Template",
      scopeText: "Legacy scope text only.",
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
    },
  ]);
  seedEstimatorDraft({
    customer: {
      id: "cust_legacy",
      name: "Legacy Customer",
    },
    labor: {
      lines: [{ id: "labor_keep", label: "Keep Labor", role: "keep", hours: "3", rate: "80", trueRateInternal: "35", qty: 1 }],
    },
    materials: {
      items: [{ id: "material_keep", desc: "Keep Material", qty: 1, priceEach: "20", cost: "10", unitCostInternal: "10", costInternal: "10" }],
    },
    additionalCharges: {
      items: [{ id: "charge_keep", desc: "Keep Charge", qty: "1", priceEach: "15" }],
    },
    additionalNotes: "Keep notes",
  });

  render(<App />);

  openTemplatesFromMenu();
  expect(await screen.findByText("Legacy Scope Template")).toBeInTheDocument();
  expect(screen.getByText(/Scope-only legacy/i)).toBeInTheDocument();

  await openEstimateBuilderViaCreate();

  fireEvent.change(getSavedTemplateSelect(), { target: { value: "tmpl_legacy_scope" } });

  await waitFor(() => {
    const draft = readEstimatorDraft();
    expect(draft.customer.name).toBe("Legacy Customer");
    expect(draft.scopeNotes).toBe("Legacy scope text only.");
    expect(draft.labor.lines[0]).toEqual(expect.objectContaining({ label: "Keep Labor" }));
    expect(draft.materials.items[0]).toEqual(expect.objectContaining({ desc: "Keep Material" }));
    expect(draft.additionalCharges.items[0]).toEqual(expect.objectContaining({ desc: "Keep Charge" }));
    expect(draft.additionalNotes).toBe("Keep notes");
  });
});

test("7. Deleting a template removes it from Templates screen and builder dropdown", async () => {
  jest.spyOn(window, "confirm").mockReturnValue(true);
  const keptTemplate = buildFullWorkTemplate({
    id: "tmpl_full_package_similar_name",
    name: "Roof Repair Package - Alternate",
  });
  seedTemplates([buildFullWorkTemplate(), keptTemplate]);

  const view = render(<App />);

  openTemplatesFromMenu();
  expect(await screen.findByText("Roof Repair Package")).toBeInTheDocument();

  const deletedTemplateCard = screen.getByText("Roof Repair Package").closest("article");
  if (!deletedTemplateCard) throw new Error("Deleted template card not found");
  fireEvent.click(within(deletedTemplateCard).getByRole("button", { name: "Delete" }));

  await waitFor(() => {
    expect(screen.queryByText("Roof Repair Package")).toBeNull();
  });
  expect(screen.getByText("Roof Repair Package - Alternate")).toBeInTheDocument();
  expect(readStoredTemplates()).toEqual([
    expect.objectContaining({ id: "tmpl_full_package_similar_name", name: "Roof Repair Package - Alternate" }),
  ]);

  view.unmount();
  render(<App />);

  openTemplatesFromMenu();
  expect(await screen.findByText("Roof Repair Package - Alternate")).toBeInTheDocument();
  expect(screen.queryByText("Roof Repair Package")).toBeNull();

  await openEstimateBuilderViaCreate();
  expect(within(getSavedTemplateSelect()).getByRole("option", { name: "Roof Repair Package - Alternate" })).toBeInTheDocument();
  expect(within(getSavedTemplateSelect()).queryByRole("option", { name: "Roof Repair Package" })).toBeNull();
});

test("11. Canceling template deletion preserves the rendered and persisted template", async () => {
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
  seedTemplates([buildFullWorkTemplate()]);

  render(<App />);

  openTemplatesFromMenu();
  expect(await screen.findByText("Roof Repair Package")).toBeInTheDocument();

  const templateCard = screen.getByText("Roof Repair Package").closest("article");
  if (!templateCard) throw new Error("Template card not found");
  fireEvent.click(within(templateCard).getByRole("button", { name: "Delete" }));

  expect(confirmSpy).toHaveBeenCalledWith('Delete template "Roof Repair Package"?');
  expect(screen.getByText("Roof Repair Package")).toBeInTheDocument();
  expect(readStoredTemplates()).toEqual([
    expect.objectContaining({ id: "tmpl_full_package", name: "Roof Repair Package" }),
  ]);
});

test("12. Renaming a template updates the shared template source", async () => {
  jest.spyOn(window, "prompt").mockReturnValue("Renamed Roof Repair Package");
  seedTemplates([buildFullWorkTemplate()]);

  render(<App />);

  openTemplatesFromMenu();
  expect(await screen.findByText("Roof Repair Package")).toBeInTheDocument();

  const templateCard = screen.getByText("Roof Repair Package").closest("article");
  if (!templateCard) throw new Error("Template card not found");
  fireEvent.click(within(templateCard).getByRole("button", { name: "Rename" }));

  await waitFor(() => {
    expect(screen.getByText("Renamed Roof Repair Package")).toBeInTheDocument();
  });
  expect(readStoredTemplates()).toEqual([
    expect.objectContaining({ id: "tmpl_full_package", name: "Renamed Roof Repair Package" }),
  ]);
});

test("8. Templates screen and builder dropdown share the same template source", async () => {
  seedTemplates([buildFullWorkTemplate()]);

  render(<App />);

  openTemplatesFromMenu();
  expect(await screen.findByText("Roof Repair Package")).toBeInTheDocument();

  await openEstimateBuilderViaCreate();
  expect(within(getSavedTemplateSelect()).getByRole("option", { name: "Roof Repair Package" })).toBeInTheDocument();
});
