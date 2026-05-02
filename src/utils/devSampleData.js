// @ts-nocheck
/* eslint-disable */

import { computeTotals } from "../estimator/engine";
import { DEFAULT_STATE } from "../estimator/defaultState";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  INVOICE_STATUSES,
  INVOICE_TYPES,
  createInvoiceDraftFromEstimate,
  createManualInvoiceDraft,
  normalizeInvoiceRecord,
  roundCurrency,
} from "./invoices";
import { createProjectRecord } from "./projects";

const CUSTOMERS_KEY = STORAGE_KEYS.CUSTOMERS;
const PROJECTS_KEY = STORAGE_KEYS.PROJECTS;
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const CUSTOMER_EDIT_TARGET_KEY = STORAGE_KEYS.CUSTOMER_EDIT_TARGET;
const PENDING_CUSTOMER_USE_KEY = STORAGE_KEYS.PENDING_CUSTOMER_USE;
const PENDING_CUSTOMER_CREATE_KEY = STORAGE_KEYS.PENDING_CUSTOMER_CREATE;
const PENDING_CUSTOMER_EDIT_KEY = STORAGE_KEYS.PENDING_CUSTOMER_EDIT;
const SELECTED_CUSTOMER_ID_KEY = STORAGE_KEYS.SELECTED_CUSTOMER_ID;
const SELECTED_CUSTOMER_SNAP_KEY = STORAGE_KEYS.SELECTED_CUSTOMER_SNAP;
const PROJECT_DETAIL_TARGET_KEY = "estipaid-project-detail-target-v1";
const PROJECT_CREATE_SEED_KEY = "estipaid-project-create-seed-v1";
const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const ACTIVE_EDIT_CONTEXT_KEY = "estipaid-active-edit-context-v1";
const DEV_SAMPLE_REGISTRY_KEY = "estipaid-dev-sample-registry-v1";
const SAMPLE_ID_PREFIX = "sample_";

const SAMPLE_IDS = {
  customers: [
    "sample_customer_desert_ridge_hospitality_group",
    "sample_customer_marisol_vega",
    "sample_customer_copper_state_property_management",
    "sample_customer_titan_mechanical_pipe",
    "sample_customer_sonoran_retail_plaza",
    "sample_customer_north_valley_fitness_center",
  ],
  projects: [
    "sample_project_hilton_guest_bath_refresh",
    "sample_project_vega_water_heater_replacement",
    "sample_project_copper_state_unit_turn_package",
    "sample_project_titan_shop_safety_rail_welding",
    "sample_project_sonoran_parking_lot_striping",
    "sample_project_north_valley_locker_room_repairs",
  ],
  estimates: [
    "sample_estimate_hilton_guest_bath_refresh_main",
    "sample_estimate_hilton_guest_bath_refresh_corridor_alt",
    "sample_estimate_vega_water_heater_replacement",
    "sample_estimate_copper_state_unit_turn_package_phase_a",
    "sample_estimate_copper_state_unit_turn_add_alt",
    "sample_estimate_titan_shop_safety_rail_welding",
    "sample_estimate_sonoran_parking_lot_striping",
    "sample_estimate_north_valley_locker_room_repairs",
  ],
  invoices: [
    "sample_invoice_hilton_mobilization_deposit",
    "sample_invoice_hilton_progress_draw",
    "sample_invoice_hilton_final_punch_draft",
    "sample_invoice_vega_final_payment",
    "sample_invoice_copper_state_turn_cycle_one",
    "sample_invoice_sonoran_mobilization",
    "sample_invoice_sonoran_signage_add",
    "sample_invoice_copper_state_after_hours_punch",
  ],
};

function deepClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) return value.map((entry) => deepClone(entry));
    if (value && typeof value === "object") {
      const next = {};
      Object.keys(value).forEach((key) => {
        next[key] = deepClone(value[key]);
      });
      return next;
    }
    return value;
  }
}

function readArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeArray(key, records) {
  localStorage.setItem(key, JSON.stringify(Array.isArray(records) ? records : []));
}

function readRegistry() {
  try {
    const raw = localStorage.getItem(DEV_SAMPLE_REGISTRY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeRegistry(value) {
  try {
    localStorage.setItem(DEV_SAMPLE_REGISTRY_KEY, JSON.stringify(value));
  } catch {}
}

function clearRegistry() {
  try {
    localStorage.removeItem(DEV_SAMPLE_REGISTRY_KEY);
  } catch {}
}

function atLocalTimestamp(dateString, hour = 12, minute = 0) {
  const iso = String(dateString || "").trim();
  if (!iso) return Date.now();
  const parsed = new Date(`${iso}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
  const ts = parsed.getTime();
  return Number.isFinite(ts) ? ts : Date.now();
}

function joinAddress(address) {
  const street = String(address?.street || "").trim();
  const city = String(address?.city || "").trim();
  const state = String(address?.state || "").trim();
  const zip = String(address?.zip || "").trim();
  const lineTwo = [city, state].filter(Boolean).join(", ");
  return [street, [lineTwo, zip].filter(Boolean).join(" ")].filter(Boolean).join("\n");
}

function toEstimatorFlat(customer) {
  const source = customer && typeof customer === "object" ? customer : {};
  const type = String(source?.type || "residential").toLowerCase();
  if (type === "commercial") {
    const jobsite = source?.jobsite || {};
    const billing = source?.billSameAsJob ? (source?.jobsite || {}) : (source?.billing || {});
    return {
      name: String(source?.companyName || "").trim(),
      phone: String(source?.comPhone || "").trim(),
      email: String(source?.comEmail || "").trim(),
      attn: String(source?.contactName || "").trim(),
      address: joinAddress(jobsite),
      billingAddress: joinAddress(billing),
      city: String(jobsite?.city || "").trim(),
      state: String(jobsite?.state || "").trim(),
      zip: String(jobsite?.zip || "").trim(),
    };
  }

  const service = source?.resService || {};
  const billing = source?.resBillingSame ? (source?.resService || {}) : (source?.resBilling || {});
  return {
    name: String(source?.fullName || "").trim(),
    phone: String(source?.resPhone || "").trim(),
    email: String(source?.resEmail || "").trim(),
    attn: "",
    address: joinAddress(service),
    billingAddress: joinAddress(billing),
    city: String(service?.city || "").trim(),
    state: String(service?.state || "").trim(),
    zip: String(service?.zip || "").trim(),
  };
}

function createResidentialCustomer(config) {
  const updatedAt = atLocalTimestamp(config.updatedOn || "2026-03-01", 14);
  const service = {
    street: String(config?.service?.street || ""),
    city: String(config?.service?.city || ""),
    state: String(config?.service?.state || ""),
    zip: String(config?.service?.zip || ""),
  };
  const billing = config?.billingSame === false
    ? {
        street: String(config?.billing?.street || ""),
        city: String(config?.billing?.city || ""),
        state: String(config?.billing?.state || ""),
        zip: String(config?.billing?.zip || ""),
      }
    : { ...service };

  const customer = {
    id: config.id,
    type: "residential",
    fullName: String(config.fullName || ""),
    resPhone: String(config.phone || ""),
    resEmail: String(config.email || ""),
    resService: service,
    resBillingSame: config?.billingSame !== false,
    resBilling: billing,
    updatedAt,
    lastUsed: updatedAt,
  };
  return {
    ...customer,
    ...toEstimatorFlat(customer),
  };
}

function createCommercialCustomer(config) {
  const updatedAt = atLocalTimestamp(config.updatedOn || "2026-03-01", 14);
  const jobsite = {
    street: String(config?.jobsite?.street || ""),
    city: String(config?.jobsite?.city || ""),
    state: String(config?.jobsite?.state || ""),
    zip: String(config?.jobsite?.zip || ""),
  };
  const billing = config?.billSameAsJob === false
    ? {
        street: String(config?.billing?.street || ""),
        city: String(config?.billing?.city || ""),
        state: String(config?.billing?.state || ""),
        zip: String(config?.billing?.zip || ""),
      }
    : { ...jobsite };

  const customer = {
    id: config.id,
    type: "commercial",
    companyName: String(config.companyName || ""),
    contactName: String(config.contactName || ""),
    contactTitle: String(config.contactTitle || ""),
    comPhone: String(config.phone || ""),
    comEmail: String(config.email || ""),
    apEmail: String(config.apEmail || ""),
    netTermsType: String(config.netTermsType || "DUE_UPON_RECEIPT"),
    netTermsDays: config?.netTermsType === "NET_CUSTOM" ? Number(config.netTermsDays || 0) : config?.netTermsDays ?? null,
    poRequired: !!config.poRequired,
    jobsite,
    billSameAsJob: config?.billSameAsJob !== false,
    billing,
    updatedAt,
    lastUsed: updatedAt,
  };
  return {
    ...customer,
    ...toEstimatorFlat(customer),
  };
}

function createBlankLine(idPrefix, suffix, defaults = {}) {
  return {
    id: `${idPrefix}_${suffix}`,
    ...defaults,
  };
}

function buildFinancialSummary({
  approvedTotal = null,
  totalRevenue = 0,
  totalCost = 0,
  laborRevenue = 0,
  laborCost = 0,
  materialsRevenue = 0,
  materialsCost = 0,
}) {
  const revenue = roundCurrency(totalRevenue);
  const cost = roundCurrency(totalCost);
  const grossProfit = roundCurrency(revenue - cost);
  const marginRatio = revenue > 0 ? roundCurrency(grossProfit / revenue) : 0;
  const marginPercent = roundCurrency(marginRatio * 100);
  const approved = approvedTotal === null || approvedTotal === undefined || approvedTotal === ""
    ? revenue
    : roundCurrency(approvedTotal);
  const normalizedLaborRevenue = roundCurrency(laborRevenue);
  const normalizedLaborCost = roundCurrency(laborCost);
  const normalizedMaterialsRevenue = roundCurrency(materialsRevenue);
  const normalizedMaterialsCost = roundCurrency(materialsCost);

  return {
    approvedTotal: approved,
    totalRevenue: revenue,
    grandTotal: revenue,
    total: revenue,
    totalCost: cost,
    internalCost: cost,
    grossProfit,
    grossMargin: marginRatio,
    grossMarginPct: marginRatio,
    grossProfitMargin: marginRatio,
    margin: marginRatio,
    marginPct: marginPercent,
    marginPercent,
    laborRevenue: normalizedLaborRevenue,
    laborCost: normalizedLaborCost,
    materialsRevenue: normalizedMaterialsRevenue,
    materialsCost: normalizedMaterialsCost,
    financials: {
      approvedTotal: approved,
      totalRevenue: revenue,
      grandTotal: revenue,
      totalCost: cost,
      internalCost: cost,
      grossProfit,
      grossMargin: marginRatio,
      grossMarginPct: marginRatio,
      grossProfitMargin: marginRatio,
      margin: marginRatio,
      marginPct: marginPercent,
      marginPercent,
      laborRevenue: normalizedLaborRevenue,
      laborCost: normalizedLaborCost,
      materialsRevenue: normalizedMaterialsRevenue,
      materialsCost: normalizedMaterialsCost,
    },
    totals: {
      approvedTotal: approved,
      totalRevenue: revenue,
      grandTotal: revenue,
      totalCost: cost,
      internalCost: cost,
      grossProfit,
      grossMargin: marginRatio,
      grossMarginPct: marginRatio,
      grossProfitMargin: marginRatio,
      margin: marginRatio,
      marginPct: marginPercent,
      marginPercent,
      laborRevenue: normalizedLaborRevenue,
      laborCost: normalizedLaborCost,
      materialsRevenue: normalizedMaterialsRevenue,
      materialsCost: normalizedMaterialsCost,
    },
  };
}

function buildFinancialSummaryFromComputed(computed, approvedTotal = null) {
  const laborRevenue = roundCurrency(
    computed?.labor?.totalRevenue
    ?? computed?.laborAfterAdjustments
    ?? computed?.laborAfterMultiplier
    ?? computed?.labor?.subtotal
    ?? 0
  );
  const laborCost = roundCurrency(
    computed?.labor?.totalCost
    ?? computed?.labor?.internalCost
    ?? computed?.labor?.cost
    ?? 0
  );
  const materialsRevenue = roundCurrency(
    computed?.materials?.totalRevenue
    ?? computed?.materials?.totalCharge
    ?? 0
  );
  const materialsCost = roundCurrency(computed?.materials?.totalCost ?? 0);
  const totalRevenue = roundCurrency(
    computed?.totalRevenue
    ?? computed?.grandTotal
    ?? (laborRevenue + materialsRevenue)
  );
  const totalCost = roundCurrency(
    computed?.totalCost
    ?? (laborCost + materialsCost)
  );

  return buildFinancialSummary({
    approvedTotal: approvedTotal === null || approvedTotal === undefined ? totalRevenue : approvedTotal,
    totalRevenue,
    totalCost,
    laborRevenue,
    laborCost,
    materialsRevenue,
    materialsCost,
  });
}

function buildEstimateSnapshotWithFinancials(estimate) {
  const source = estimate && typeof estimate === "object" ? estimate : {};
  const approvedTotal = roundCurrency(
    source?.approvedTotal
    ?? source?.financials?.approvedTotal
    ?? source?.totalRevenue
    ?? source?.grandTotal
    ?? source?.total
    ?? 0
  );
  const totalRevenue = roundCurrency(
    source?.financials?.totalRevenue
    ?? source?.totals?.totalRevenue
    ?? source?.totalRevenue
    ?? source?.grandTotal
    ?? source?.total
    ?? approvedTotal
  );
  const totalCost = roundCurrency(
    source?.financials?.totalCost
    ?? source?.totals?.totalCost
    ?? source?.totalCost
    ?? source?.internalCost
    ?? 0
  );
  const laborRevenue = roundCurrency(
    source?.financials?.laborRevenue
    ?? source?.totals?.laborRevenue
    ?? source?.laborRevenue
    ?? 0
  );
  const laborCost = roundCurrency(
    source?.financials?.laborCost
    ?? source?.totals?.laborCost
    ?? source?.laborCost
    ?? 0
  );
  const materialsRevenue = roundCurrency(
    source?.financials?.materialsRevenue
    ?? source?.totals?.materialsRevenue
    ?? source?.materialsRevenue
    ?? 0
  );
  const materialsCost = roundCurrency(
    source?.financials?.materialsCost
    ?? source?.totals?.materialsCost
    ?? source?.materialsCost
    ?? 0
  );
  const financialSummary = buildFinancialSummary({
    approvedTotal,
    totalRevenue,
    totalCost,
    laborRevenue,
    laborCost,
    materialsRevenue,
    materialsCost,
  });

  return {
    estimateId: String(source?.id || "").trim(),
    estimateNumber: String(source?.estimateNumber || source?.job?.docNumber || "").trim(),
    estimateStatus: String(source?.status || "approved").trim(),
    status: String(source?.status || "approved").trim(),
    projectId: String(source?.projectId || source?.customer?.projectId || "").trim(),
    customerId: String(source?.customerId || source?.customer?.id || "").trim(),
    customerName: String(source?.customerName || source?.customer?.name || "").trim(),
    projectName: String(source?.projectName || source?.customer?.projectName || "").trim(),
    projectNumber: String(source?.projectNumber || source?.customer?.projectNumber || "").trim(),
    siteAddress: String(
      source?.siteAddress
      || source?.projectAddress
      || source?.customer?.projectAddress
      || source?.customer?.address
      || source?.job?.location
      || ""
    ).trim(),
    poNumber: String(source?.poNumber || source?.job?.poNumber || "").trim(),
    estimateDate: String(source?.date || source?.job?.date || "").trim(),
    dueDate: String(source?.dueDate || source?.job?.due || "").trim(),
    customer: deepClone(source?.customer || {}),
    job: deepClone(source?.job || {}),
    ...financialSummary,
    summary: {
      total: financialSummary.totalRevenue,
      totalRevenue: financialSummary.totalRevenue,
      totalCost: financialSummary.totalCost,
      grossProfit: financialSummary.grossProfit,
      marginPct: financialSummary.marginPct,
      savedAt: Number(source?.savedAt || 0) || 0,
      updatedAt: Number(source?.updatedAt || 0) || 0,
    },
  };
}

function buildEstimateRecord(config) {
  const customer = config.customer;
  const flat = toEstimatorFlat(customer);
  const createdAt = atLocalTimestamp(config.date, 9, 30);
  const savedAt = atLocalTimestamp(config.date, 16, 15);
  const projectId = String(config.projectId || "").trim();
  const projectAddress = String(config.siteAddress || config.projectAddress || flat.address || "").trim();
  const state = deepClone(DEFAULT_STATE);
  const materialsMode = config?.materialsMode === "blanket" ? "blanket" : "itemized";
  const laborLines = Array.isArray(config?.laborLines) ? config.laborLines.map((line, index) => ({
    ...createBlankLine(config.id, `labor_${index + 1}`),
    role: "",
    label: "",
    qty: 1,
    hours: "",
    rate: "",
    trueRateInternal: "",
    ...line,
  })) : [];

  state.ui = {
    ...(state.ui || {}),
    docType: "estimate",
    materialsMode,
  };
  state.customer = {
    ...(state.customer || {}),
    id: String(customer?.id || ""),
    name: flat.name,
    attn: flat.attn,
    phone: flat.phone,
    email: flat.email,
    netTermsType: String(customer?.netTermsType || ""),
    netTermsDays: customer?.netTermsDays ?? "",
    address: flat.address,
    billingDiff: flat.billingAddress && flat.billingAddress !== flat.address,
    billingAddress: flat.billingAddress,
    projectId,
    projectName: String(config.projectName || ""),
    projectNumber: String(config.projectNumber || ""),
    projectAddress,
    projectSameAsCustomer: true,
  };
  state.job = {
    ...(state.job || {}),
    date: String(config.date || ""),
    due: String(config.dueDate || ""),
    poNumber: String(config.poNumber || ""),
    location: projectAddress,
    docNumber: String(config.estimateNumber || ""),
  };
  state.scopeNotes = String(config.scopeNotes || "");
  state.additionalNotes = String(config.additionalNotes || "");
  state.labor = {
    ...(state.labor || {}),
    hazardPct: Number(config.hazardPct || 0),
    riskPct: Number(config.riskPct || 0),
    multiplier: Number(config.multiplier || 1),
    lines: laborLines,
  };

  if (materialsMode === "blanket") {
    state.materials = {
      ...(state.materials || {}),
      blanketCost: String(config.blanketCost ?? ""),
      blanketInternalCost: String(config.blanketInternalCost ?? ""),
      materialsBlanketDescription: String(config.materialsBlanketDescription || ""),
      markupPct: Number(config.materialsMarkupPct || 0),
      items: [createBlankLine(config.id, "material_blank", { desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" })],
    };
  } else {
    state.materials = {
      ...(state.materials || {}),
      blanketCost: "",
      blanketInternalCost: "",
      materialsBlanketDescription: "",
      markupPct: Number(config.materialsMarkupPct || 0),
      items: (Array.isArray(config?.materialItems) ? config.materialItems : []).map((item, index) => ({
        ...createBlankLine(config.id, `material_${index + 1}`),
        desc: "",
        qty: "",
        unitCostInternal: "",
        costInternal: "",
        priceEach: "",
        ...item,
      })),
    };
  }

  const computed = computeTotals(state);
  const total = roundCurrency(computed?.totalRevenue || 0);
  const financialSummary = buildFinancialSummaryFromComputed(computed, total);

  return {
    ...state,
    id: config.id,
    name: String(config.projectName || ""),
    docType: "estimate",
    status: String(config.status || "pending"),
    projectId,
    customerId: String(customer?.id || ""),
    customerName: flat.name,
    projectName: String(config.projectName || ""),
    projectNumber: String(config.projectNumber || ""),
    siteAddress: projectAddress,
    projectAddress,
    estimateNumber: String(config.estimateNumber || ""),
    invoiceNumber: "",
    date: String(config.date || ""),
    dueDate: String(config.dueDate || ""),
    poNumber: String(config.poNumber || ""),
    total,
    ...financialSummary,
    createdAt,
    updatedAt: savedAt,
    savedAt,
    ts: savedAt,
    customer: deepClone(state.customer),
    job: deepClone(state.job),
    meta: {
      ...(state.meta || {}),
      savedDocId: config.id,
      savedDocCreatedAt: createdAt,
      lastSavedAt: savedAt,
    },
  };
}

function createLinkedInvoice(config, estimate, existingInvoices) {
  const createdAt = atLocalTimestamp(config.date, 10, 10);
  const savedAt = atLocalTimestamp(config.date, 15, 20);
  const projectId = String(config.projectId || estimate?.projectId || "").trim();
  const projectName = String(config.projectName || estimate?.projectName || "").trim();
  const projectNumber = String(config.projectNumber || estimate?.projectNumber || "").trim();
  const projectAddress = String(
    config.siteAddress
    || estimate?.siteAddress
    || estimate?.projectAddress
    || estimate?.customer?.projectAddress
    || estimate?.customer?.address
    || estimate?.job?.location
    || ""
  ).trim();
  const draftResult = createInvoiceDraftFromEstimate(estimate, existingInvoices, {
    invoiceType: config.invoiceType,
    requestedValue: config.requestedValue,
    invoiceDate: config.date,
    dueDate: config.dueDate,
    note: config.note,
    nowTs: createdAt,
  });

  if (!draftResult?.ok || !draftResult?.draft) {
    throw new Error(draftResult?.message || `Unable to create sample invoice for ${config.id}.`);
  }

  const parentTotals = computeTotals(estimate || {});
  const parentRevenue = roundCurrency(parentTotals?.totalRevenue || estimate?.total || 0);
  const parentInternalCost = roundCurrency(parentTotals?.totalCost || 0);
  const parentInternalRatio = parentRevenue > 0
    ? Math.min(Math.max(parentInternalCost / parentRevenue, 0.4), 0.82)
    : 0.62;
  const invoiceTotal = roundCurrency(draftResult?.draft?.invoiceTotal || draftResult?.draft?.total || 0);
  const invoiceInternalCost = roundCurrency(invoiceTotal * parentInternalRatio);
  const invoiceFinancialSummary = buildFinancialSummary({
    approvedTotal: invoiceTotal,
    totalRevenue: invoiceTotal,
    totalCost: invoiceInternalCost,
    laborRevenue: 0,
    laborCost: 0,
    materialsRevenue: invoiceTotal,
    materialsCost: invoiceInternalCost,
  });

  const payments = Array.isArray(config?.payments) ? config.payments.map((payment, index) => ({
    id: String(payment?.id || `${config.id}_payment_${index + 1}`),
    amount: roundCurrency(payment?.amount || 0),
    paidAt: String(payment?.paidAt || config.date || ""),
    note: String(payment?.note || ""),
    method: String(payment?.method || "manual"),
    order: Number.isFinite(Number(payment?.order)) ? Number(payment.order) : index,
  })) : [];

  return normalizeInvoiceRecord({
    ...draftResult.draft,
    id: config.id,
    invoiceNumber: String(config.invoiceNumber || draftResult.draft.invoiceNumber || ""),
    status: String(config.status || INVOICE_STATUSES.DRAFT),
    projectId,
    projectName,
    projectNumber,
    siteAddress: projectAddress,
    projectAddress,
    date: String(config.date || ""),
    dueDate: String(config.dueDate || ""),
    additionalNotes: String(config.note || draftResult.draft.additionalNotes || ""),
    amountPaid: payments.reduce((sum, payment) => sum + roundCurrency(payment?.amount), 0),
    payments,
    ...invoiceFinancialSummary,
    sourceEstimateSnapshot: buildEstimateSnapshotWithFinancials(estimate),
    customer: {
      ...(draftResult.draft.customer || {}),
      projectId,
      projectName,
      projectNumber,
      projectAddress,
    },
    materials: {
      ...(draftResult.draft.materials || {}),
      blanketCost: String(invoiceTotal),
      blanketInternalCost: String(invoiceInternalCost),
      materialsBlanketDescription: String(
        draftResult.draft?.materials?.materialsBlanketDescription
        || config.note
        || `Invoice snapshot for ${String(estimate?.estimateNumber || "").trim()}`
      ),
    },
    job: {
      ...(draftResult.draft.job || {}),
      date: String(config.date || ""),
      due: String(config.dueDate || ""),
      docNumber: String(config.invoiceNumber || draftResult.draft.invoiceNumber || ""),
    },
    createdAt,
    updatedAt: savedAt,
    savedAt,
    ts: savedAt,
    meta: {
      ...(draftResult.draft.meta || {}),
      savedDocId: config.id,
      savedDocCreatedAt: createdAt,
      lastSavedAt: savedAt,
      ephemeralDraft: false,
    },
  });
}

function createManualInvoice(config) {
  const customer = config.customer;
  const flat = toEstimatorFlat(customer);
  const createdAt = atLocalTimestamp(config.date, 11, 0);
  const savedAt = atLocalTimestamp(config.date, 16, 0);
  const projectId = String(config.projectId || "").trim();
  const projectAddress = String(config.siteAddress || config.projectAddress || flat.address || "").trim();
  const draft = createManualInvoiceDraft([], { invoiceDate: config.date, dueDate: config.dueDate, nowTs: createdAt });
  const paymentStatus = Array.isArray(config?.payments) && config.payments.length > 0 ? "partial" : "unpaid";
  const amountPaid = roundCurrency(
    (Array.isArray(config?.payments) ? config.payments : []).reduce(
      (sum, payment) => sum + roundCurrency(payment?.amount),
      0
    )
  );
  const invoiceTotal = roundCurrency(config.invoiceTotal);
  const invoiceInternalCost = roundCurrency(config?.internalCost ?? (invoiceTotal * 0.66));
  const invoiceFinancialSummary = buildFinancialSummary({
    approvedTotal: invoiceTotal,
    totalRevenue: invoiceTotal,
    totalCost: invoiceInternalCost,
    laborRevenue: 0,
    laborCost: 0,
    materialsRevenue: invoiceTotal,
    materialsCost: invoiceInternalCost,
  });

  return normalizeInvoiceRecord({
    ...draft,
    id: config.id,
    invoiceType: INVOICE_TYPES.MANUAL,
    invoiceNumber: String(config.invoiceNumber || ""),
    status: String(config.status || INVOICE_STATUSES.DRAFT),
    projectId,
    customerId: String(customer?.id || ""),
    customerName: flat.name,
    projectName: String(config.projectName || ""),
    projectNumber: String(config.projectNumber || ""),
    siteAddress: projectAddress,
    projectAddress,
    invoiceTotal,
    total: invoiceTotal,
    amountPaid,
    paymentStatus,
    ...invoiceFinancialSummary,
    payments: (Array.isArray(config?.payments) ? config.payments : []).map((payment, index) => ({
      id: String(payment?.id || `${config.id}_payment_${index + 1}`),
      amount: roundCurrency(payment?.amount || 0),
      paidAt: String(payment?.paidAt || config.date || ""),
      note: String(payment?.note || ""),
      method: String(payment?.method || "manual"),
      order: Number.isFinite(Number(payment?.order)) ? Number(payment.order) : index,
    })),
    additionalNotes: String(config.note || ""),
    date: String(config.date || ""),
    dueDate: String(config.dueDate || ""),
    job: {
      ...(draft.job || {}),
      date: String(config.date || ""),
      due: String(config.dueDate || ""),
      location: projectAddress,
      docNumber: String(config.invoiceNumber || ""),
    },
    customer: {
      ...(draft.customer || {}),
      id: String(customer?.id || ""),
      name: flat.name,
      attn: flat.attn,
      phone: flat.phone,
      email: flat.email,
      netTermsType: String(customer?.netTermsType || ""),
      netTermsDays: customer?.netTermsDays ?? "",
      address: flat.address,
      billingAddress: flat.billingAddress,
      projectId,
      projectName: String(config.projectName || ""),
      projectNumber: String(config.projectNumber || ""),
      projectAddress,
    },
    ui: {
      ...(draft.ui || {}),
      docType: "invoice",
      materialsMode: "blanket",
    },
    labor: {
      ...(draft.labor || {}),
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
      lines: [createBlankLine(config.id, "labor_blank", { role: "", hours: "", rate: "", trueRateInternal: "" })],
    },
    materials: {
      ...(draft.materials || {}),
      blanketCost: String(invoiceTotal),
      blanketInternalCost: String(invoiceInternalCost),
      materialsBlanketDescription: String(config.materialsDescription || config.note || ""),
      markupPct: 0,
      items: [createBlankLine(config.id, "material_blank", { desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" })],
    },
    createdAt,
    updatedAt: savedAt,
    savedAt,
    ts: savedAt,
    meta: {
      ...(draft.meta || {}),
      savedDocId: config.id,
      savedDocCreatedAt: createdAt,
      lastSavedAt: savedAt,
      ephemeralDraft: false,
    },
  });
}

function createSampleProject(config) {
  const customer = config.customer;
  const flat = toEstimatorFlat(customer);
  return createProjectRecord({
    id: String(config.id || "").trim(),
    customerId: String(customer?.id || "").trim(),
    customerName: flat.name,
    projectNumber: String(config.projectNumber || "").trim(),
    projectName: String(config.projectName || "").trim(),
    siteAddress: String(config.siteAddress || flat.address || "").trim(),
    status: String(config.status || "active").trim(),
    notes: String(config.notes || "").trim(),
    scopeSummary: String(config.scopeSummary || config.notes || "").trim(),
    createdAt: atLocalTimestamp(config.createdOn || config.updatedOn || "2026-02-01", 8, 30),
    updatedAt: atLocalTimestamp(config.updatedOn || config.createdOn || "2026-02-01", 15, 45),
  });
}

function buildSampleCustomers() {
  return [
    createCommercialCustomer({
      id: "sample_customer_desert_ridge_hospitality_group",
      companyName: "Desert Ridge Hospitality Group",
      contactName: "Lena Ortiz",
      contactTitle: "Regional Facilities Director",
      phone: "(602) 555-4101",
      email: "lortiz@desertridgehospitality.com",
      apEmail: "ap@desertridgehospitality.com",
      netTermsType: "NET_30",
      poRequired: true,
      jobsite: {
        street: "7677 N 16th St",
        city: "Phoenix",
        state: "AZ",
        zip: "85020",
      },
      billing: {
        street: "2400 E Missouri Ave, Suite 210",
        city: "Phoenix",
        state: "AZ",
        zip: "85016",
      },
      billSameAsJob: false,
      updatedOn: "2026-04-18",
    }),
    createResidentialCustomer({
      id: "sample_customer_marisol_vega",
      fullName: "Marisol Vega",
      phone: "(602) 555-2284",
      email: "marisol.vega@example.com",
      service: {
        street: "4139 W Julie Dr",
        city: "Glendale",
        state: "AZ",
        zip: "85308",
      },
      updatedOn: "2026-04-02",
    }),
    createCommercialCustomer({
      id: "sample_customer_copper_state_property_management",
      companyName: "Copper State Property Management",
      contactName: "Trevor Hale",
      contactTitle: "Turn Coordinator",
      phone: "(480) 555-6672",
      email: "thale@copperstatepm.com",
      apEmail: "payables@copperstatepm.com",
      netTermsType: "NET_15",
      poRequired: true,
      jobsite: {
        street: "2250 W Northern Ave",
        city: "Phoenix",
        state: "AZ",
        zip: "85021",
      },
      billing: {
        street: "4510 E Cotton Center Blvd, Suite 180",
        city: "Phoenix",
        state: "AZ",
        zip: "85040",
      },
      billSameAsJob: false,
      updatedOn: "2026-04-24",
    }),
    createCommercialCustomer({
      id: "sample_customer_titan_mechanical_pipe",
      companyName: "Titan Mechanical & Pipe",
      contactName: "Derek Salas",
      contactTitle: "Operations Superintendent",
      phone: "(623) 555-9430",
      email: "dsalas@titanmechanicalpipe.com",
      apEmail: "ap@titanmechanicalpipe.com",
      netTermsType: "NET_CUSTOM",
      netTermsDays: 21,
      poRequired: true,
      jobsite: {
        street: "601 S 54th Ave",
        city: "Phoenix",
        state: "AZ",
        zip: "85043",
      },
      billing: {
        street: "PO Box 43218",
        city: "Phoenix",
        state: "AZ",
        zip: "85080",
      },
      billSameAsJob: false,
      updatedOn: "2026-03-29",
    }),
    createCommercialCustomer({
      id: "sample_customer_sonoran_retail_plaza",
      companyName: "Sonoran Retail Plaza LLC",
      contactName: "Avery Kim",
      contactTitle: "Asset Manager",
      phone: "(480) 555-7841",
      email: "akim@sonoranretailplaza.com",
      apEmail: "billing@sonoranretailplaza.com",
      netTermsType: "NET_30",
      poRequired: true,
      jobsite: {
        street: "13240 N 7th St",
        city: "Phoenix",
        state: "AZ",
        zip: "85022",
      },
      billing: {
        street: "2555 E Camelback Rd, Suite 410",
        city: "Phoenix",
        state: "AZ",
        zip: "85016",
      },
      billSameAsJob: false,
      updatedOn: "2026-04-21",
    }),
    createCommercialCustomer({
      id: "sample_customer_north_valley_fitness_center",
      companyName: "North Valley Fitness Center",
      contactName: "Priya Shah",
      contactTitle: "General Manager",
      phone: "(623) 555-1908",
      email: "priya@northvalleyfitness.com",
      apEmail: "accounts@northvalleyfitness.com",
      netTermsType: "DUE_UPON_RECEIPT",
      poRequired: false,
      jobsite: {
        street: "18815 N 35th Ave",
        city: "Phoenix",
        state: "AZ",
        zip: "85027",
      },
      updatedOn: "2026-04-12",
    }),
  ];
}

function buildSampleProjects(customersById) {
  return [
    createSampleProject({
      id: "sample_project_hilton_guest_bath_refresh",
      customer: customersById["sample_customer_desert_ridge_hospitality_group"],
      projectNumber: "DRHG-HILTON-2401",
      projectName: "Hilton Guest Bath Refresh",
      siteAddress: "7677 N 16th St, Phoenix, AZ 85020",
      status: "active",
      scopeSummary: "Wallpaper removal, moisture-tolerant paint, fixture swap coordination, and guest bath finish refresh across two room banks.",
      notes: "Phased hotel turnover work on floors 4 and 5. Coordinate 9 AM room release list with housekeeping and keep one elevator padded for material traffic.",
      createdOn: "2026-02-06",
      updatedOn: "2026-04-25",
    }),
    createSampleProject({
      id: "sample_project_vega_water_heater_replacement",
      customer: customersById["sample_customer_marisol_vega"],
      projectNumber: "VEGA-WH-2402",
      projectName: "Vega Water Heater Replacement",
      siteAddress: "4139 W Julie Dr, Glendale, AZ 85308",
      status: "completed",
      scopeSummary: "Residential gas water heater replacement with pan, vent correction, and garage wall patch/paint at removed stand.",
      notes: "Final inspection passed. Homeowner requested shutoff labeling and photos of upgraded seismic strapping.",
      createdOn: "2026-01-28",
      updatedOn: "2026-03-18",
    }),
    createSampleProject({
      id: "sample_project_copper_state_unit_turn_package",
      customer: customersById["sample_customer_copper_state_property_management"],
      projectNumber: "CSPM-TURN-2403",
      projectName: "Copper State Unit Turn Package",
      siteAddress: "2250 W Northern Ave, Phoenix, AZ 85021",
      status: "active",
      scopeSummary: "Drywall repair, texture blend, paint, base reset, punch carpentry, and lock change coordination for recurring turnover units.",
      notes: "Rolling scope across Buildings B and D. Property team issues weekly vacancy list every Monday morning.",
      createdOn: "2026-02-10",
      updatedOn: "2026-04-27",
    }),
    createSampleProject({
      id: "sample_project_titan_shop_safety_rail_welding",
      customer: customersById["sample_customer_titan_mechanical_pipe"],
      projectNumber: "TMP-RAIL-2404",
      projectName: "Titan Shop Safety Rail Welding",
      siteAddress: "601 S 54th Ave, Phoenix, AZ 85043",
      status: "estimating",
      scopeSummary: "Shop-fabricated safety rail, anchor layout verification, field weld install, primer, and industrial enamel topcoat.",
      notes: "Waiting on revised mezzanine dimensions and forklift clearance confirmation before release.",
      createdOn: "2026-03-12",
      updatedOn: "2026-04-10",
    }),
    createSampleProject({
      id: "sample_project_sonoran_parking_lot_striping",
      customer: customersById["sample_customer_sonoran_retail_plaza"],
      projectNumber: "SRP-STRIPE-2405",
      projectName: "Sonoran Retail Parking Lot Striping",
      siteAddress: "13240 N 7th St, Phoenix, AZ 85022",
      status: "active",
      scopeSummary: "Parking lot restripe, ADA stall refresh, fire lane curb stencil touchups, and directional signage resets.",
      notes: "Night shift sequencing required to preserve Friday lunch traffic. Tenant notice window is 48 hours.",
      createdOn: "2026-03-01",
      updatedOn: "2026-04-23",
    }),
    createSampleProject({
      id: "sample_project_north_valley_locker_room_repairs",
      customer: customersById["sample_customer_north_valley_fitness_center"],
      projectNumber: "NVFC-LR-2406",
      projectName: "North Valley Locker Room Repairs",
      siteAddress: "18815 N 35th Ave, Phoenix, AZ 85027",
      status: "draft",
      scopeSummary: "Locker room tile reset, moisture board patch, epoxy grout touchup, paint, and isolated plumbing trim repairs.",
      notes: "Budget review pending membership season. Manager wants an alternate for overnight-only work.",
      createdOn: "2026-04-04",
      updatedOn: "2026-04-16",
    }),
  ];
}

function buildSampleEstimates(customersById, projectsById) {
  return [
    buildEstimateRecord({
      id: "sample_estimate_hilton_guest_bath_refresh_main",
      customer: customersById["sample_customer_desert_ridge_hospitality_group"],
      projectId: projectsById["sample_project_hilton_guest_bath_refresh"]?.id,
      status: "approved",
      estimateNumber: "EST-2601",
      projectName: "Hilton Guest Bath Refresh",
      projectNumber: "DRHG-HILTON-2401",
      siteAddress: "7677 N 16th St, Phoenix, AZ 85020",
      date: "2026-02-08",
      dueDate: "2026-02-20",
      poNumber: "DRHG-7824",
      scopeNotes: "Refresh twenty guest baths with wallpaper removal, moisture patching, satin wall repaint, vanity light swap coordination, and final silicone reset at tubs and splashes.",
      additionalNotes: "Hotel requests room release in ten-room blocks and daily debris haul before 3 PM guest arrival window.",
      multiplier: 1.08,
      hazardPct: 1,
      riskPct: 1,
      laborLines: [
        { role: "Foreman", label: "Hotel phase lead", qty: 1, hours: 30, rate: 98, trueRateInternal: 68 },
        { role: "Painter", label: "Finish crew", qty: 2, hours: 52, rate: 78, trueRateInternal: 49 },
        { role: "Punch tech", label: "Fixture and silicone tech", qty: 1, hours: 24, rate: 74, trueRateInternal: 45 },
      ],
      materialItems: [
        { desc: "Bath-rated satin wall paint", qty: 24, priceEach: 68, unitCostInternal: 49 },
        { desc: "Wallpaper removal gel and scrapers", qty: 12, priceEach: 34, unitCostInternal: 21 },
        { desc: "Mildew-resistant primer", qty: 10, priceEach: 56, unitCostInternal: 38 },
        { desc: "Caulk, silicone, and patch sundries", qty: 1, priceEach: 420, unitCostInternal: 270 },
      ],
      materialsMarkupPct: 0,
    }),
    buildEstimateRecord({
      id: "sample_estimate_hilton_guest_bath_refresh_corridor_alt",
      customer: customersById["sample_customer_desert_ridge_hospitality_group"],
      projectId: projectsById["sample_project_hilton_guest_bath_refresh"]?.id,
      status: "pending",
      estimateNumber: "EST-2602",
      projectName: "Hilton Guest Bath Refresh Corridor Alt",
      projectNumber: "DRHG-HILTON-2401A",
      siteAddress: "7677 N 16th St, Phoenix, AZ 85020",
      date: "2026-02-12",
      dueDate: "2026-02-24",
      poNumber: "DRHG-7824-ALT",
      scopeNotes: "Alternate to continue work into elevator lobby returns and guest corridor touch-up walls on the same floors as the bath refresh package.",
      additionalNotes: "Hold as management option pending brand standards sign-off on color sheen.",
      multiplier: 1.06,
      laborLines: [
        { role: "Painter", label: "Night corridor crew", qty: 2, hours: 22, rate: 76, trueRateInternal: 47 },
        { role: "Lead", label: "Access and logistics lead", qty: 1, hours: 10, rate: 90, trueRateInternal: 61 },
      ],
      materialItems: [
        { desc: "Low-odor corridor eggshell", qty: 10, priceEach: 64, unitCostInternal: 46 },
        { desc: "Masking and floor protection", qty: 1, priceEach: 240, unitCostInternal: 146 },
      ],
      materialsMarkupPct: 0,
    }),
    buildEstimateRecord({
      id: "sample_estimate_vega_water_heater_replacement",
      customer: customersById["sample_customer_marisol_vega"],
      projectId: projectsById["sample_project_vega_water_heater_replacement"]?.id,
      status: "approved",
      estimateNumber: "EST-2603",
      projectName: "Vega Water Heater Replacement",
      projectNumber: "VEGA-WH-2402",
      siteAddress: "4139 W Julie Dr, Glendale, AZ 85308",
      date: "2026-02-01",
      dueDate: "2026-02-05",
      scopeNotes: "Remove failed 50-gallon gas heater, furnish/install Bradford White replacement, replace pan and flex lines, correct vent connector, and patch/paint wall board at removed shelf.",
      additionalNotes: "Homeowner requested same-day hot water restoration and updated shutoff tags at garage manifold.",
      multiplier: 1.04,
      laborLines: [
        { role: "Licensed plumber", label: "Install lead", qty: 1, hours: 8, rate: 132, trueRateInternal: 88 },
        { role: "Helper", label: "Removal and haul-off", qty: 1, hours: 5, rate: 58, trueRateInternal: 34 },
      ],
      materialItems: [
        { desc: "50-gallon gas water heater", qty: 1, priceEach: 1980, unitCostInternal: 1495 },
        { desc: "Pan, flexes, vent, and fittings", qty: 1, priceEach: 420, unitCostInternal: 278 },
        { desc: "Patch and paint materials", qty: 1, priceEach: 110, unitCostInternal: 58 },
      ],
      materialsMarkupPct: 0,
    }),
    buildEstimateRecord({
      id: "sample_estimate_copper_state_unit_turn_package_phase_a",
      customer: customersById["sample_customer_copper_state_property_management"],
      projectId: projectsById["sample_project_copper_state_unit_turn_package"]?.id,
      status: "pending",
      estimateNumber: "EST-2604",
      projectName: "Copper State Unit Turn Package",
      projectNumber: "CSPM-TURN-2403",
      siteAddress: "2250 W Northern Ave, Phoenix, AZ 85021",
      date: "2026-03-09",
      dueDate: "2026-03-18",
      poNumber: "CSPM-4417",
      scopeNotes: "Bundle pricing for four apartment turns including drywall patches, texture blend, full wall paint, base reset, hardware swap, and final punch list completion.",
      additionalNotes: "Pricing assumes one mobilization per building and vacancy-ready access before 8 AM each day.",
      multiplier: 1.07,
      laborLines: [
        { role: "Superintendent", label: "Turn coordinator", qty: 1, hours: 12, rate: 88, trueRateInternal: 57 },
        { role: "Painter", label: "Turn painters", qty: 2, hours: 34, rate: 68, trueRateInternal: 42 },
        { role: "Punch tech", label: "Punch carpenter", qty: 1, hours: 18, rate: 72, trueRateInternal: 44 },
      ],
      materialItems: [
        { desc: "Unit-turn wall paint", qty: 14, priceEach: 54, unitCostInternal: 38 },
        { desc: "Texture and patch materials", qty: 1, priceEach: 310, unitCostInternal: 190 },
        { desc: "Base and hardware allowance", qty: 1, priceEach: 520, unitCostInternal: 348 },
      ],
      materialsMarkupPct: 0,
    }),
    buildEstimateRecord({
      id: "sample_estimate_copper_state_unit_turn_add_alt",
      customer: customersById["sample_customer_copper_state_property_management"],
      projectId: projectsById["sample_project_copper_state_unit_turn_package"]?.id,
      status: "draft",
      estimateNumber: "EST-2605",
      projectName: "Copper State Unit Turn Flooring and Appliance Alt",
      projectNumber: "CSPM-TURN-2403-ALT",
      siteAddress: "2250 W Northern Ave, Phoenix, AZ 85021",
      date: "2026-03-12",
      dueDate: "2026-03-24",
      scopeNotes: "Draft alternate for LVP transitions, appliance reconnect coordination, and additional cabinet hinge replacements across the same turnover pool.",
      additionalNotes: "Internal working draft only. Hold until vacancy count is confirmed for next board packet.",
      materialsMode: "blanket",
      multiplier: 1.05,
      laborLines: [
        { role: "Installer", label: "Flooring and punch installer", qty: 1, hours: 16, rate: 76, trueRateInternal: 49 },
        { role: "Helper", label: "Appliance and debris helper", qty: 1, hours: 12, rate: 52, trueRateInternal: 31 },
      ],
      blanketCost: 3560,
      blanketInternalCost: 2480,
      materialsBlanketDescription: "Allowance for transitions, misc flooring materials, appliance reconnection parts, and finish hardware.",
      materialsMarkupPct: 0,
    }),
    buildEstimateRecord({
      id: "sample_estimate_titan_shop_safety_rail_welding",
      customer: customersById["sample_customer_titan_mechanical_pipe"],
      projectId: projectsById["sample_project_titan_shop_safety_rail_welding"]?.id,
      status: "draft",
      estimateNumber: "EST-2606",
      projectName: "Titan Shop Safety Rail Welding",
      projectNumber: "TMP-RAIL-2404",
      siteAddress: "601 S 54th Ave, Phoenix, AZ 85043",
      date: "2026-04-03",
      dueDate: "2026-04-17",
      poNumber: "TMP-RFI-17",
      scopeNotes: "Fabricate and install forty-two linear feet of shop safety rail with field verification, base plate anchors, prime coat, and industrial safety yellow finish.",
      additionalNotes: "Draft pricing pending confirmed mezzanine edge measurements and final anchor detail from engineer.",
      multiplier: 1.08,
      hazardPct: 2,
      riskPct: 2,
      laborLines: [
        { role: "Welder", label: "Certified welder", qty: 1, hours: 22, rate: 118, trueRateInternal: 84 },
        { role: "Ironworker", label: "Install hand", qty: 1, hours: 18, rate: 96, trueRateInternal: 68 },
        { role: "Painter", label: "Industrial finish coat", qty: 1, hours: 10, rate: 74, trueRateInternal: 46 },
      ],
      materialItems: [
        { desc: "Tube steel and plates", qty: 1, priceEach: 2680, unitCostInternal: 2015 },
        { desc: "Anchors and drill consumables", qty: 1, priceEach: 360, unitCostInternal: 240 },
        { desc: "Primer and safety yellow enamel", qty: 1, priceEach: 290, unitCostInternal: 176 },
      ],
      materialsMarkupPct: 0,
    }),
    buildEstimateRecord({
      id: "sample_estimate_sonoran_parking_lot_striping",
      customer: customersById["sample_customer_sonoran_retail_plaza"],
      projectId: projectsById["sample_project_sonoran_parking_lot_striping"]?.id,
      status: "approved",
      estimateNumber: "EST-2607",
      projectName: "Sonoran Retail Parking Lot Striping",
      projectNumber: "SRP-STRIPE-2405",
      siteAddress: "13240 N 7th St, Phoenix, AZ 85022",
      date: "2026-03-15",
      dueDate: "2026-03-28",
      poNumber: "SRP-6214",
      scopeNotes: "Restripe eighty-seven stalls, rework two ADA stalls, repaint fire lane curbs, replace directional arrows, and furnish/install updated stop and ADA signs.",
      additionalNotes: "Retail center wants work split over two overnight closures with opening-ready layout by 7 AM.",
      multiplier: 1.06,
      laborLines: [
        { role: "Striping foreman", label: "Layout and compliance lead", qty: 1, hours: 18, rate: 94, trueRateInternal: 66 },
        { role: "Crew", label: "Striping crew", qty: 2, hours: 26, rate: 68, trueRateInternal: 41 },
      ],
      materialItems: [
        { desc: "Traffic paint and beads", qty: 1, priceEach: 2640, unitCostInternal: 1930 },
        { desc: "ADA signs and hardware", qty: 6, priceEach: 118, unitCostInternal: 84 },
        { desc: "Stencils and masking materials", qty: 1, priceEach: 320, unitCostInternal: 186 },
      ],
      materialsMarkupPct: 0,
    }),
    buildEstimateRecord({
      id: "sample_estimate_north_valley_locker_room_repairs",
      customer: customersById["sample_customer_north_valley_fitness_center"],
      projectId: projectsById["sample_project_north_valley_locker_room_repairs"]?.id,
      status: "lost",
      estimateNumber: "EST-2608",
      projectName: "North Valley Locker Room Repairs",
      projectNumber: "NVFC-LR-2406",
      siteAddress: "18815 N 35th Ave, Phoenix, AZ 85027",
      date: "2026-04-05",
      dueDate: "2026-04-19",
      scopeNotes: "Repair damaged locker room tile, patch wet wall framing access, repaint ceiling and upper walls, reset plumbing trim, and reseal benches after drying.",
      additionalNotes: "Budget lost to in-house handyman package. Keep estimate for future reopening if tenant improvement allowance is restored.",
      multiplier: 1.05,
      laborLines: [
        { role: "Tile setter", label: "Tile and grout reset", qty: 1, hours: 14, rate: 88, trueRateInternal: 58 },
        { role: "Painter", label: "Moisture repair painter", qty: 1, hours: 12, rate: 72, trueRateInternal: 43 },
        { role: "Plumber", label: "Trim reset allowance", qty: 1, hours: 5, rate: 126, trueRateInternal: 88 },
      ],
      materialItems: [
        { desc: "Tile, grout, and setting materials", qty: 1, priceEach: 820, unitCostInternal: 545 },
        { desc: "Moisture board and paint materials", qty: 1, priceEach: 360, unitCostInternal: 212 },
      ],
      materialsMarkupPct: 0,
    }),
  ];
}

function buildSampleInvoices(estimatesById, customersById, projectsById) {
  const invoices = [];

  const hiltonDeposit = createLinkedInvoice(
    {
      id: "sample_invoice_hilton_mobilization_deposit",
      invoiceNumber: "INV-2601",
      projectId: projectsById["sample_project_hilton_guest_bath_refresh"]?.id,
      projectName: projectsById["sample_project_hilton_guest_bath_refresh"]?.projectName,
      projectNumber: projectsById["sample_project_hilton_guest_bath_refresh"]?.projectNumber,
      siteAddress: projectsById["sample_project_hilton_guest_bath_refresh"]?.siteAddress,
      invoiceType: INVOICE_TYPES.DEPOSIT,
      requestedValue: "20%",
      date: "2026-02-22",
      dueDate: "2026-03-01",
      status: INVOICE_STATUSES.PAID,
      note: "Mobilization billing for room-block setup, containment, and initial materials release.",
    },
    estimatesById["sample_estimate_hilton_guest_bath_refresh_main"],
    invoices
  );
  invoices.push(normalizeInvoiceRecord({
    ...hiltonDeposit,
    payments: [
      {
        id: "sample_payment_hilton_mobilization_deposit",
        amount: hiltonDeposit.invoiceTotal,
        paidAt: "2026-02-28",
        note: "ACH received from Desert Ridge Hospitality Group.",
        method: "ach",
        order: 0,
      },
    ],
  }));

  invoices.push(createLinkedInvoice(
    {
      id: "sample_invoice_hilton_progress_draw",
      invoiceNumber: "INV-2602",
      projectId: projectsById["sample_project_hilton_guest_bath_refresh"]?.id,
      projectName: projectsById["sample_project_hilton_guest_bath_refresh"]?.projectName,
      projectNumber: projectsById["sample_project_hilton_guest_bath_refresh"]?.projectNumber,
      siteAddress: projectsById["sample_project_hilton_guest_bath_refresh"]?.siteAddress,
      invoiceType: INVOICE_TYPES.PROGRESS,
      requestedValue: "35%",
      date: "2026-05-02",
      dueDate: "2026-06-10",
      status: INVOICE_STATUSES.SENT,
      note: "Progress draw after floors four and five were turned over to housekeeping.",
    },
    estimatesById["sample_estimate_hilton_guest_bath_refresh_main"],
    invoices
  ));

  invoices.push(createLinkedInvoice(
    {
      id: "sample_invoice_hilton_final_punch_draft",
      invoiceNumber: "INV-2603",
      projectId: projectsById["sample_project_hilton_guest_bath_refresh"]?.id,
      projectName: projectsById["sample_project_hilton_guest_bath_refresh"]?.projectName,
      projectNumber: projectsById["sample_project_hilton_guest_bath_refresh"]?.projectNumber,
      siteAddress: projectsById["sample_project_hilton_guest_bath_refresh"]?.siteAddress,
      invoiceType: INVOICE_TYPES.FINAL,
      requestedValue: "25%",
      date: "2026-05-06",
      dueDate: "2026-06-20",
      status: INVOICE_STATUSES.DRAFT,
      note: "Draft final punch invoice pending owner walk and reserve release.",
    },
    estimatesById["sample_estimate_hilton_guest_bath_refresh_main"],
    invoices
  ));

  const vegaFinal = createLinkedInvoice(
    {
      id: "sample_invoice_vega_final_payment",
      invoiceNumber: "INV-2604",
      projectId: projectsById["sample_project_vega_water_heater_replacement"]?.id,
      projectName: projectsById["sample_project_vega_water_heater_replacement"]?.projectName,
      projectNumber: projectsById["sample_project_vega_water_heater_replacement"]?.projectNumber,
      siteAddress: projectsById["sample_project_vega_water_heater_replacement"]?.siteAddress,
      invoiceType: INVOICE_TYPES.FINAL,
      requestedValue: "100%",
      date: "2026-02-06",
      dueDate: "2026-02-06",
      status: INVOICE_STATUSES.PAID,
      note: "Final homeowner billing after same-day install, vent correction, and haul-off.",
    },
    estimatesById["sample_estimate_vega_water_heater_replacement"],
    invoices
  );
  invoices.push(normalizeInvoiceRecord({
    ...vegaFinal,
    payments: [
      {
        id: "sample_payment_vega_final_payment",
        amount: vegaFinal.invoiceTotal,
        paidAt: "2026-02-06",
        note: "Card payment captured at completion.",
        method: "card",
        order: 0,
      },
    ],
  }));

  invoices.push(createManualInvoice({
    id: "sample_invoice_copper_state_turn_cycle_one",
    invoiceNumber: "INV-2605",
    customer: customersById["sample_customer_copper_state_property_management"],
    projectId: projectsById["sample_project_copper_state_unit_turn_package"]?.id,
    projectName: projectsById["sample_project_copper_state_unit_turn_package"]?.projectName,
    projectNumber: projectsById["sample_project_copper_state_unit_turn_package"]?.projectNumber,
    siteAddress: projectsById["sample_project_copper_state_unit_turn_package"]?.siteAddress,
    invoiceTotal: 4280,
    internalCost: 2910,
    date: "2026-03-26",
    dueDate: "2026-04-08",
    status: INVOICE_STATUSES.SENT,
    note: "Manual billing for first completed turn cycle covering Units B-14 and D-07 while scope is still under rolling approval.",
    materialsDescription: "Cycle one unit-turn labor, patch materials, paint, and lock/hardware allowance.",
  }));

  invoices.push(createLinkedInvoice(
    {
      id: "sample_invoice_sonoran_mobilization",
      invoiceNumber: "INV-2606",
      projectId: projectsById["sample_project_sonoran_parking_lot_striping"]?.id,
      projectName: projectsById["sample_project_sonoran_parking_lot_striping"]?.projectName,
      projectNumber: projectsById["sample_project_sonoran_parking_lot_striping"]?.projectNumber,
      siteAddress: projectsById["sample_project_sonoran_parking_lot_striping"]?.siteAddress,
      invoiceType: INVOICE_TYPES.DEPOSIT,
      requestedValue: "30%",
      date: "2026-03-29",
      dueDate: "2026-04-09",
      status: INVOICE_STATUSES.SENT,
      note: "Mobilization and layout billing for overnight restripe setup and ADA sign procurement.",
    },
    estimatesById["sample_estimate_sonoran_parking_lot_striping"],
    invoices
  ));

  invoices.push(createLinkedInvoice(
    {
      id: "sample_invoice_sonoran_signage_add",
      invoiceNumber: "INV-2607",
      projectId: projectsById["sample_project_sonoran_parking_lot_striping"]?.id,
      projectName: projectsById["sample_project_sonoran_parking_lot_striping"]?.projectName,
      projectNumber: projectsById["sample_project_sonoran_parking_lot_striping"]?.projectNumber,
      siteAddress: projectsById["sample_project_sonoran_parking_lot_striping"]?.siteAddress,
      invoiceType: INVOICE_TYPES.PROGRESS,
      requestedValue: "40%",
      date: "2026-05-04",
      dueDate: "2026-06-18",
      status: INVOICE_STATUSES.SENT,
      note: "Second billing for signage install, ADA stall resets, and fire-lane curb repaint completion.",
      payments: [
        {
          id: "sample_payment_sonoran_signage_add",
          amount: 2600,
          paidAt: "2026-05-09",
          note: "Partial ACH received after signage delivery approval.",
          method: "ach",
          order: 0,
        },
      ],
    },
    estimatesById["sample_estimate_sonoran_parking_lot_striping"],
    invoices
  ));

  invoices.push(createManualInvoice({
    id: "sample_invoice_copper_state_after_hours_punch",
    invoiceNumber: "INV-2608",
    customer: customersById["sample_customer_copper_state_property_management"],
    projectId: projectsById["sample_project_copper_state_unit_turn_package"]?.id,
    projectName: "Copper State After-Hours Punch Work",
    projectNumber: projectsById["sample_project_copper_state_unit_turn_package"]?.projectNumber,
    siteAddress: projectsById["sample_project_copper_state_unit_turn_package"]?.siteAddress,
    invoiceTotal: 1965,
    internalCost: 1280,
    date: "2026-05-07",
    dueDate: "2026-06-24",
    status: INVOICE_STATUSES.SENT,
    note: "After-hours punch billing for odor sealer, stairwell touch-up, and emergency board-up cleanup between tenant move-outs.",
    materialsDescription: "After-hours punch and emergency turnover support.",
  }));

  return invoices.map((invoice) => normalizeInvoiceRecord(invoice));
}

function collectSampleIds(records, explicitIds = []) {
  const collected = new Set(Array.isArray(explicitIds) ? explicitIds : []);
  (Array.isArray(records) ? records : []).forEach((record) => {
    const id = String(record?.id || "").trim();
    if (id && id.startsWith(SAMPLE_ID_PREFIX)) {
      collected.add(id);
    }
  });
  return collected;
}

function filterByIds(records, ids) {
  const set = new Set(ids);
  return (Array.isArray(records) ? records : []).filter((record) => !set.has(String(record?.id || "").trim()));
}

function maybeRemoveDirectKey(key, ids) {
  try {
    const value = String(localStorage.getItem(key) || "").trim();
    if (value && ids.has(value)) localStorage.removeItem(key);
  } catch {}
}

function maybeRemoveJsonKey(key, ids) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const targetId = String(
      parsed?.id
      || parsed?.projectId
      || parsed?.editContext?.id
      || parsed?.editContext?.projectId
      || ""
    ).trim();
    if (targetId && ids.has(targetId)) {
      localStorage.removeItem(key);
    }
  } catch {}
}

function emitSeedEvents() {
  try {
    window.dispatchEvent(new Event("estipaid:invoices-changed"));
  } catch {}
  try {
    window.dispatchEvent(new Event("estipaid:navigate-estimates"));
  } catch {}
}

export function clearDevSampleData() {
  const existingCustomers = readArray(CUSTOMERS_KEY);
  const existingProjects = readArray(PROJECTS_KEY);
  const existingEstimates = readArray(ESTIMATES_KEY);
  const existingInvoices = readArray(INVOICES_KEY);
  const registry = readRegistry();

  const customerIds = collectSampleIds(existingCustomers, [
    ...SAMPLE_IDS.customers,
    ...(Array.isArray(registry?.customers) ? registry.customers : []),
  ]);
  const projectIds = collectSampleIds(existingProjects, [
    ...(Array.isArray(SAMPLE_IDS.projects) ? SAMPLE_IDS.projects : []),
    ...(Array.isArray(registry?.projects) ? registry.projects : []),
  ]);
  const estimateIds = collectSampleIds(existingEstimates, [
    ...SAMPLE_IDS.estimates,
    ...(Array.isArray(registry?.estimates) ? registry.estimates : []),
  ]);
  const invoiceIds = collectSampleIds(existingInvoices, [
    ...SAMPLE_IDS.invoices,
    ...(Array.isArray(registry?.invoices) ? registry.invoices : []),
  ]);
  const anyIds = new Set([...customerIds, ...projectIds, ...estimateIds, ...invoiceIds]);

  const nextCustomers = filterByIds(existingCustomers, customerIds);
  const nextProjects = filterByIds(existingProjects, projectIds);
  const nextEstimates = filterByIds(existingEstimates, estimateIds);
  const nextInvoices = filterByIds(existingInvoices, invoiceIds);

  writeArray(CUSTOMERS_KEY, nextCustomers);
  writeArray(PROJECTS_KEY, nextProjects);
  writeArray(ESTIMATES_KEY, nextEstimates);
  writeArray(INVOICES_KEY, nextInvoices);
  clearRegistry();

  maybeRemoveDirectKey(PROJECT_DETAIL_TARGET_KEY, projectIds);
  maybeRemoveDirectKey(EDIT_ESTIMATE_TARGET_KEY, estimateIds);
  maybeRemoveDirectKey(EDIT_INVOICE_TARGET_KEY, invoiceIds);
  maybeRemoveDirectKey(SELECTED_CUSTOMER_ID_KEY, customerIds);
  maybeRemoveJsonKey(PROJECT_CREATE_SEED_KEY, projectIds);
  maybeRemoveJsonKey(CUSTOMER_EDIT_TARGET_KEY, customerIds);
  maybeRemoveJsonKey(PENDING_CUSTOMER_USE_KEY, customerIds);
  maybeRemoveJsonKey(PENDING_CUSTOMER_EDIT_KEY, customerIds);
  maybeRemoveJsonKey(PENDING_CUSTOMER_CREATE_KEY, customerIds);
  maybeRemoveJsonKey(ACTIVE_EDIT_CONTEXT_KEY, anyIds);

  try {
    const selectedCustomerId = String(localStorage.getItem(SELECTED_CUSTOMER_ID_KEY) || "").trim();
    if (!selectedCustomerId || customerIds.has(selectedCustomerId)) {
      localStorage.removeItem(SELECTED_CUSTOMER_SNAP_KEY);
    }
  } catch {}

  emitSeedEvents();

  return {
    clearedCustomers: Math.max(existingCustomers.length - nextCustomers.length, 0),
    clearedProjects: Math.max(existingProjects.length - nextProjects.length, 0),
    clearedEstimates: Math.max(existingEstimates.length - nextEstimates.length, 0),
    clearedInvoices: Math.max(existingInvoices.length - nextInvoices.length, 0),
  };
}

export function buildDevSampleDataset() {
  const customers = buildSampleCustomers();
  const customersById = customers.reduce((acc, customer) => {
    acc[String(customer.id)] = customer;
    return acc;
  }, {});

  const projects = buildSampleProjects(customersById);
  const projectsById = projects.reduce((acc, project) => {
    acc[String(project.id)] = project;
    return acc;
  }, {});

  const estimates = buildSampleEstimates(customersById, projectsById);
  const estimatesById = estimates.reduce((acc, estimate) => {
    acc[String(estimate.id)] = estimate;
    return acc;
  }, {});

  const invoices = buildSampleInvoices(estimatesById, customersById, projectsById);

  return {
    customers,
    projects,
    estimates,
    invoices,
  };
}

export function seedDevSampleData() {
  clearDevSampleData();

  const { customers, projects, estimates, invoices } = buildDevSampleDataset();

  const mergedCustomers = [...customers, ...readArray(CUSTOMERS_KEY)];
  const mergedProjects = [...projects, ...readArray(PROJECTS_KEY)];
  const mergedEstimates = [...estimates, ...readArray(ESTIMATES_KEY)];
  const mergedInvoices = [...invoices, ...readArray(INVOICES_KEY)];

  writeArray(CUSTOMERS_KEY, mergedCustomers);
  writeArray(PROJECTS_KEY, mergedProjects);
  writeArray(ESTIMATES_KEY, mergedEstimates);
  writeArray(INVOICES_KEY, mergedInvoices);
  writeRegistry({
    seededAt: Date.now(),
    customers: customers.map((record) => String(record?.id || "").trim()).filter(Boolean),
    projects: projects.map((record) => String(record?.id || "").trim()).filter(Boolean),
    estimates: estimates.map((record) => String(record?.id || "").trim()).filter(Boolean),
    invoices: invoices.map((record) => String(record?.id || "").trim()).filter(Boolean),
  });

  emitSeedEvents();

  return {
    customers: customers.length,
    projects: projects.length,
    estimates: estimates.length,
    invoices: invoices.length,
  };
}
