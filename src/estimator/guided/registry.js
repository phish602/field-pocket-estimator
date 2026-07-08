// @ts-nocheck
/* eslint-disable */

import { computeDueDateFromCustomer, getNetTermsLabel } from "../netTerms";

export const GUIDED_INTERACTIONS = Object.freeze({
  AUTO_RESOLVE: "autoResolve",
  GUIDED_CHOICE: "guidedChoice",
  GUIDED_CUSTOM: "guidedCustom",
  CONFIRM_ONLY: "confirmOnly",
  MANUAL_FALLBACK: "manualFallback",
});

export const GUIDED_AUDIT_STATUS = Object.freeze({
  COMPLETE: "complete",
  INFERRED: "inferred",
  NEEDS_CONFIRMATION: "needs_confirmation",
  MISSING: "missing",
});

const STEPPED_PERCENT_OPTIONS = Array.from({ length: 51 }, (_, index) => index);
const MARKUP_OPTIONS = Array.from({ length: 101 }, (_, index) => index);
const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"];

export const LABOR_ROLE_OPTIONS = [
  { value: "foreman", label: "Foreman" },
  { value: "journeyman", label: "Journeyman" },
  { value: "apprentice", label: "Apprentice" },
  { value: "laborer", label: "General Laborer" },
  { value: "supervisor", label: "Supervisor" },
  { value: "helper", label: "Helper" },
  { value: "technician", label: "Technician" },
  { value: "operator", label: "Equipment Operator" },
];

export const TRADE_INSERT_OPTIONS = [
  { value: "genericLabor", label: "Generic Labor" },
  { value: "painting", label: "Painting" },
  { value: "demoCrew", label: "Demolition Crew" },
  { value: "drywall", label: "Drywall" },
  { value: "framing", label: "Framing" },
  { value: "insulation", label: "Insulation" },
  { value: "finishCarpentry", label: "Finish Carpentry" },
  { value: "flooring", label: "Flooring" },
  { value: "hvac", label: "HVAC" },
  { value: "plumbing", label: "Plumbing" },
  { value: "controls", label: "Controls / BAS / Instrumentation" },
  { value: "welding", label: "Welding" },
  { value: "pipefitting", label: "Pipefitting" },
  { value: "orbital", label: "Orbital Welding" },
  { value: "ironwork", label: "Ironwork / Structural" },
  { value: "electrical", label: "Electrical" },
  { value: "rigging", label: "Rigging / Crane" },
  { value: "heavyEquipment", label: "Heavy Machinery / Equipment Ops" },
  { value: "concrete", label: "Concrete" },
  { value: "demo", label: "Demolition" },
];

export const MATERIALS_MODE_OPTIONS = [
  { value: "blanket", label: "Blanket", description: "One materials allowance with optional markup and internal cost." },
  { value: "itemized", label: "Itemized", description: "Line-item materials with qty, sell price, and optional internal cost." },
];

export const YES_NO_OPTIONS = [
  { value: true, label: "Yes" },
  { value: false, label: "No" },
];

const FIELD_GROUPS = Object.freeze({
  CUSTOMER_PROFILE: "customer_profile",
  PROJECT_LOCATION: "project_location",
  LABOR_LINES: "labor_lines",
  MATERIALS_LINES: "materials_lines",
});

export const GUIDED_PLANNER_META_KEY = "__guidedPlanner";

const GUIDED_SECTION_TARGET_PRIORITY = Object.freeze({
  customer: 120,
  scope: 122,
  labor: 110,
  materials: 104,
  jobInfo: 80,
  specialConditions: 54,
  notes: 30,
  review: 8,
});

const GUIDED_FIELD_TARGET_PRIORITY = Object.freeze({
  "customer.id": 140,
  "customer.projectSameAsCustomer": 92,
  "customer.projectAddress": 88,
  "customer.city": 84,
  "customer.state": 83,
  "customer.zip": 82,
  "job.date": 76,
  "job.due": 52,
  "tradeInsert.key": 148,
  "scopeNotes": 144,
  "labor.lines": 136,
  "ui.materialsMode": 126,
  "materials.blanketCost": 122,
  "materials.items": 122,
  "materials.markupPct": 80,
  "materials.materialsBlanketDescription": 58,
  "labor.hazardPct": 46,
  "labor.riskPct": 46,
  "labor.multiplier": 44,
  "additionalNotes": 26,
  "job.docNumber": 6,
});

const LITERAL_FORM_ORDER_TARGET_FIELDS_BY_MODE = Object.freeze({
  estimate: Object.freeze([
    "customer.id",
    "customer.projectSameAsCustomer",
    "customer.projectAddress",
    "job.location",
    "customer.city",
    "customer.state",
    "customer.zip",
    "tradeInsert.key",
    "scopeNotes",
    "labor.lines",
    "ui.materialsMode",
    "materials.blanketCost",
    "materials.items",
  ]),
  invoice: Object.freeze([
    "customer.id",
    "customer.projectSameAsCustomer",
    "customer.projectAddress",
    "job.location",
    "customer.city",
    "customer.state",
    "customer.zip",
    "labor.lines",
    "ui.materialsMode",
    "materials.blanketCost",
    "materials.items",
  ]),
});

function getAtPath(source, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let current = source;
  for (let index = 0; index < parts.length; index += 1) {
    if (!current || typeof current !== "object") return undefined;
    current = current[parts[index]];
  }
  return current;
}

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function hasNumberLike(value) {
  if (value === null || value === undefined || value === "") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed);
}

export function isLaborLineMeaningful(line) {
  if (!line || typeof line !== "object") return false;
  return hasText(line?.label)
    || hasText(line?.role)
    || hasText(line?.hours)
    || hasText(line?.rate)
    || hasText(line?.trueRateInternal)
    || hasText(line?.internalRate);
}

export function isMaterialItemMeaningful(item) {
  if (!item || typeof item !== "object") return false;
  return hasText(item?.desc)
    || hasText(item?.qty)
    || hasText(item?.priceEach)
    || hasText(item?.charge)
    || hasText(item?.unitCostInternal)
    || hasText(item?.costInternal)
    || hasText(item?.note);
}

function getMaterialsMode(state) {
  return state?.ui?.materialsMode === "itemized" ? "itemized" : "blanket";
}

function hasMeaningfulScopeDraftState(state) {
  return hasText(state?.tradeInsert?.key) || hasText(state?.scopeNotes);
}

function hasMeaningfulLaborDraftState(state) {
  const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
  return lines.some((line) => isLaborLineMeaningful(line));
}

function hasMeaningfulMaterialsDraftState(state) {
  if (hasNumberLike(state?.materials?.blanketCost)) return true;
  const items = Array.isArray(state?.materials?.items) ? state.materials.items : [];
  return items.some((item) => isMaterialItemMeaningful(item));
}

function shouldPreferLiteralFormOrderTarget(mode, state = {}) {
  if ((mode === "invoice" ? false : hasMeaningfulScopeDraftState(state))) return false;
  if (hasMeaningfulLaborDraftState(state)) return false;
  if (hasMeaningfulMaterialsDraftState(state)) return false;
  return true;
}

function getLiteralFormOrderTargetFields(mode = "estimate", state = {}) {
  const normalizedMode = mode === "invoice" ? "invoice" : "estimate";
  const primaryMaterialsField = getMaterialsMode(state) === "itemized"
    ? "materials.items"
    : "materials.blanketCost";

  return (LITERAL_FORM_ORDER_TARGET_FIELDS_BY_MODE[normalizedMode] || LITERAL_FORM_ORDER_TARGET_FIELDS_BY_MODE.estimate)
    .filter((fieldKey) => (
      fieldKey !== "materials.blanketCost" && fieldKey !== "materials.items"
    ) || fieldKey === primaryMaterialsField);
}

function customerOptions(context) {
  const items = Array.isArray(context?.customers) ? context.customers : [];
  return items
    .filter(Boolean)
    .map((customer) => {
      const isCommercial = String(customer?.type || "").trim().toLowerCase() === "commercial";
      const label = String(
        isCommercial
          ? customer?.companyName || customer?.name || ""
          : customer?.fullName || customer?.name || ""
      ).trim();
      return {
        value: String(customer?.id || "").trim(),
        label: label || "Unnamed customer",
        description: isCommercial ? "Commercial customer" : "Residential customer",
      };
    })
    .filter((option) => option.value);
}

function stateOptions() {
  return US_STATES.map((value) => ({ value, label: value }));
}

function markupOptions() {
  return MARKUP_OPTIONS.map((value) => ({ value: String(value), label: `${value}%` }));
}

function percentOptions() {
  return STEPPED_PERCENT_OPTIONS.map((value) => ({ value: String(value), label: `${value}%` }));
}

function laborRoleOptions() {
  return LABOR_ROLE_OPTIONS.map((option) => ({ ...option }));
}

function tradeOptions() {
  return TRADE_INSERT_OPTIONS.map((option) => ({ ...option }));
}

function yesNoOptions() {
  return YES_NO_OPTIONS.map((option) => ({ ...option }));
}

function fieldOrderComparator(a, b) {
  return Number(a?.displayPriority || 999) - Number(b?.displayPriority || 999);
}

export const GUIDED_FIELD_REGISTRY = {
  "customer.id": {
    key: "customer.id",
    label: "Customer",
    section: "customer",
    inputType: "select",
    valueType: "customerId",
    required: true,
    defaultSource: "saved customers",
    dependencies: [],
    allowedOptionsSource: "customers",
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["must match a saved customer id"],
    displayPriority: 1,
    groupedQuestionBehavior: null,
    reviewClassification: "required",
    manualModeControlMapping: "Customer search / select dropdown",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CHOICE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.name": {
    key: "customer.name",
    label: "Customer Name",
    section: "customer",
    inputType: "text",
    valueType: "string",
    required: true,
    defaultSource: "selected customer",
    dependencies: ["customer.id"],
    allowedOptionsSource: null,
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: false,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["auto-resolved from selected customer"],
    displayPriority: 2,
    groupedQuestionBehavior: FIELD_GROUPS.CUSTOMER_PROFILE,
    reviewClassification: "auto",
    manualModeControlMapping: "Derived from selected customer",
    guidedInteractionType: GUIDED_INTERACTIONS.AUTO_RESOLVE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.attn": {
    key: "customer.attn",
    label: "Attention / Contact",
    section: "customer",
    inputType: "text",
    valueType: "string",
    required: false,
    defaultSource: "selected customer",
    dependencies: ["customer.id"],
    allowedOptionsSource: null,
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: false,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["auto-resolved from selected customer when available"],
    displayPriority: 3,
    groupedQuestionBehavior: FIELD_GROUPS.CUSTOMER_PROFILE,
    reviewClassification: "auto",
    manualModeControlMapping: "Derived from selected customer",
    guidedInteractionType: GUIDED_INTERACTIONS.AUTO_RESOLVE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.phone": {
    key: "customer.phone",
    label: "Customer Phone",
    section: "customer",
    inputType: "tel",
    valueType: "string",
    required: false,
    defaultSource: "selected customer",
    dependencies: ["customer.id"],
    allowedOptionsSource: null,
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: false,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["auto-resolved from selected customer when available"],
    displayPriority: 4,
    groupedQuestionBehavior: FIELD_GROUPS.CUSTOMER_PROFILE,
    reviewClassification: "auto",
    manualModeControlMapping: "Derived from selected customer",
    guidedInteractionType: GUIDED_INTERACTIONS.AUTO_RESOLVE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.email": {
    key: "customer.email",
    label: "Customer Email",
    section: "customer",
    inputType: "email",
    valueType: "string",
    required: false,
    defaultSource: "selected customer",
    dependencies: ["customer.id"],
    allowedOptionsSource: null,
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: false,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["auto-resolved from selected customer when available"],
    displayPriority: 5,
    groupedQuestionBehavior: FIELD_GROUPS.CUSTOMER_PROFILE,
    reviewClassification: "auto",
    manualModeControlMapping: "Derived from selected customer",
    guidedInteractionType: GUIDED_INTERACTIONS.AUTO_RESOLVE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.netTermsType": {
    key: "customer.netTermsType",
    label: "Customer Net Terms Type",
    section: "customer",
    inputType: "select",
    valueType: "string",
    required: false,
    defaultSource: "selected customer",
    dependencies: ["customer.id"],
    allowedOptionsSource: null,
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: false,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["auto-resolved from selected customer when available"],
    displayPriority: 6,
    groupedQuestionBehavior: FIELD_GROUPS.CUSTOMER_PROFILE,
    reviewClassification: "auto",
    manualModeControlMapping: "Derived from selected customer",
    guidedInteractionType: GUIDED_INTERACTIONS.AUTO_RESOLVE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.netTermsDays": {
    key: "customer.netTermsDays",
    label: "Customer Net Terms Days",
    section: "customer",
    inputType: "number",
    valueType: "numberString",
    required: false,
    defaultSource: "selected customer",
    dependencies: ["customer.id"],
    allowedOptionsSource: null,
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: false,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["auto-resolved from selected customer when available"],
    displayPriority: 7,
    groupedQuestionBehavior: FIELD_GROUPS.CUSTOMER_PROFILE,
    reviewClassification: "auto",
    manualModeControlMapping: "Derived from selected customer",
    guidedInteractionType: GUIDED_INTERACTIONS.AUTO_RESOLVE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.address": {
    key: "customer.address",
    label: "Customer Address",
    section: "customer",
    inputType: "textarea",
    valueType: "string",
    required: false,
    defaultSource: "selected customer",
    dependencies: ["customer.id"],
    allowedOptionsSource: null,
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: false,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["auto-resolved from selected customer when available"],
    displayPriority: 8,
    groupedQuestionBehavior: FIELD_GROUPS.CUSTOMER_PROFILE,
    reviewClassification: "auto",
    manualModeControlMapping: "Derived from selected customer",
    guidedInteractionType: GUIDED_INTERACTIONS.AUTO_RESOLVE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.billingDiff": {
    key: "customer.billingDiff",
    label: "Billing Differs From Customer Address",
    section: "customer",
    inputType: "toggle",
    valueType: "boolean",
    required: false,
    defaultSource: "selected customer",
    dependencies: ["customer.id"],
    allowedOptionsSource: null,
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: false,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["auto-resolved from selected customer"],
    displayPriority: 9,
    groupedQuestionBehavior: FIELD_GROUPS.CUSTOMER_PROFILE,
    reviewClassification: "auto",
    manualModeControlMapping: "Derived from selected customer",
    guidedInteractionType: GUIDED_INTERACTIONS.AUTO_RESOLVE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.billingAddress": {
    key: "customer.billingAddress",
    label: "Billing Address",
    section: "customer",
    inputType: "textarea",
    valueType: "string",
    required: false,
    defaultSource: "selected customer",
    dependencies: ["customer.id"],
    allowedOptionsSource: null,
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: false,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["auto-resolved from selected customer when available"],
    displayPriority: 10,
    groupedQuestionBehavior: FIELD_GROUPS.CUSTOMER_PROFILE,
    reviewClassification: "auto",
    manualModeControlMapping: "Derived from selected customer",
    guidedInteractionType: GUIDED_INTERACTIONS.AUTO_RESOLVE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.projectName": {
    key: "customer.projectName",
    label: "Project Name",
    section: "jobInfo",
    inputType: "text",
    valueType: "string",
    required: false,
    defaultSource: "user",
    dependencies: [],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["free text"],
    displayPriority: 1,
    groupedQuestionBehavior: "job_context",
    reviewClassification: "optional",
    manualModeControlMapping: "Project name input",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.projectNumber": {
    key: "customer.projectNumber",
    label: "Project Number",
    section: "jobInfo",
    inputType: "text",
    valueType: "string",
    required: false,
    defaultSource: "user",
    dependencies: [],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["free text"],
    displayPriority: 2,
    groupedQuestionBehavior: "job_context",
    reviewClassification: "optional",
    manualModeControlMapping: "Project # input",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "job.poNumber": {
    key: "job.poNumber",
    label: "PO Number",
    section: "jobInfo",
    inputType: "text",
    valueType: "string",
    required: false,
    defaultSource: "user",
    dependencies: [],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["free text"],
    displayPriority: 3,
    groupedQuestionBehavior: "job_context",
    reviewClassification: "optional",
    manualModeControlMapping: "PO number input",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "job.date": {
    key: "job.date",
    label: "Issue Date",
    section: "jobInfo",
    inputType: "date",
    valueType: "date",
    required: true,
    defaultSource: "today",
    dependencies: [],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["must be ISO date"],
    displayPriority: 4,
    groupedQuestionBehavior: "job_context",
    reviewClassification: "required",
    manualModeControlMapping: "Date input",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "job.due": {
    key: "job.due",
    label: "Due Date",
    section: "jobInfo",
    inputType: "date",
    valueType: "date",
    required: false,
    defaultSource: "customer net terms",
    dependencies: ["customer.id", "job.date"],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: true,
    validationRules: ["must be ISO date when set"],
    displayPriority: 5,
    groupedQuestionBehavior: "job_context",
    reviewClassification: "derived",
    manualModeControlMapping: "No dedicated manual control today",
    guidedInteractionType: GUIDED_INTERACTIONS.CONFIRM_ONLY,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.projectSameAsCustomer": {
    key: "customer.projectSameAsCustomer",
    label: "Project Location Same As Customer",
    section: "jobInfo",
    inputType: "toggle",
    valueType: "boolean",
    required: true,
    defaultSource: "customer",
    dependencies: ["customer.id"],
    allowedOptionsSource: "yesNo",
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["boolean"],
    displayPriority: 6,
    groupedQuestionBehavior: FIELD_GROUPS.PROJECT_LOCATION,
    reviewClassification: "required",
    manualModeControlMapping: "Project location checkbox",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CHOICE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.projectAddress": {
    key: "customer.projectAddress",
    label: "Project Street Address",
    section: "jobInfo",
    inputType: "text",
    valueType: "string",
    required: true,
    defaultSource: "user",
    dependencies: ["customer.projectSameAsCustomer"],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["required when project address differs from customer"],
    displayPriority: 7,
    groupedQuestionBehavior: FIELD_GROUPS.PROJECT_LOCATION,
    reviewClassification: "required",
    manualModeControlMapping: "Project street input",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "job.location": {
    key: "job.location",
    label: "Project Address Line 2",
    section: "jobInfo",
    inputType: "text",
    valueType: "string",
    required: false,
    defaultSource: "user",
    dependencies: ["customer.projectSameAsCustomer"],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["optional free text"],
    displayPriority: 8,
    groupedQuestionBehavior: FIELD_GROUPS.PROJECT_LOCATION,
    reviewClassification: "optional",
    manualModeControlMapping: "Project address line 2 input",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.city": {
    key: "customer.city",
    label: "Project City",
    section: "jobInfo",
    inputType: "text",
    valueType: "string",
    required: true,
    defaultSource: "user",
    dependencies: ["customer.projectSameAsCustomer"],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["required when project address differs from customer"],
    displayPriority: 9,
    groupedQuestionBehavior: FIELD_GROUPS.PROJECT_LOCATION,
    reviewClassification: "required",
    manualModeControlMapping: "Project city input",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.state": {
    key: "customer.state",
    label: "Project State",
    section: "jobInfo",
    inputType: "select",
    valueType: "string",
    required: true,
    defaultSource: "user",
    dependencies: ["customer.projectSameAsCustomer"],
    allowedOptionsSource: "states",
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["must be a US state / DC code when project address differs from customer"],
    displayPriority: 10,
    groupedQuestionBehavior: FIELD_GROUPS.PROJECT_LOCATION,
    reviewClassification: "required",
    manualModeControlMapping: "Project state dropdown",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CHOICE,
    supportsModes: ["estimate", "invoice"],
  },
  "customer.zip": {
    key: "customer.zip",
    label: "Project ZIP",
    section: "jobInfo",
    inputType: "text",
    valueType: "string",
    required: true,
    defaultSource: "user",
    dependencies: ["customer.projectSameAsCustomer"],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["required when project address differs from customer"],
    displayPriority: 11,
    groupedQuestionBehavior: FIELD_GROUPS.PROJECT_LOCATION,
    reviewClassification: "required",
    manualModeControlMapping: "Project ZIP input",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "scopeNotes": {
    key: "scopeNotes",
    label: "Scope / Notes",
    section: "scope",
    inputType: "textarea",
    valueType: "string",
    required: true,
    defaultSource: "user",
    dependencies: [],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["estimate mode only", "free text"],
    displayPriority: 1,
    groupedQuestionBehavior: "scope_context",
    reviewClassification: "required",
    manualModeControlMapping: "Scope / notes textarea",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate"],
  },
  "tradeInsert.key": {
    key: "tradeInsert.key",
    label: "Trade Insert",
    section: "scope",
    inputType: "select",
    valueType: "string",
    required: false,
    defaultSource: "trade templates",
    dependencies: ["scopeNotes"],
    allowedOptionsSource: "tradeInserts",
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["must match a known trade insert when set"],
    displayPriority: 2,
    groupedQuestionBehavior: "scope_context",
    reviewClassification: "optional",
    manualModeControlMapping: "Insert trade dropdown",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CHOICE,
    supportsModes: ["estimate"],
  },
  "tradeInsert.text": {
    key: "tradeInsert.text",
    label: "Trade Insert Text",
    section: "scope",
    inputType: "textarea",
    valueType: "string",
    required: false,
    defaultSource: "trade insert selection",
    dependencies: ["tradeInsert.key"],
    allowedOptionsSource: null,
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: false,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["auto-resolved from selected trade insert"],
    displayPriority: 3,
    groupedQuestionBehavior: "scope_context",
    reviewClassification: "auto",
    manualModeControlMapping: "Derived from selected trade insert",
    guidedInteractionType: GUIDED_INTERACTIONS.AUTO_RESOLVE,
    supportsModes: ["estimate"],
  },
  "labor.lines": {
    key: "labor.lines",
    label: "Labor Lines",
    section: "labor",
    inputType: "collection",
    valueType: "laborLines",
    required: true,
    defaultSource: "user",
    dependencies: [],
    allowedOptionsSource: "laborRoles",
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["at least one meaningful line with hours and rate"],
    displayPriority: 1,
    groupedQuestionBehavior: FIELD_GROUPS.LABOR_LINES,
    reviewClassification: "required",
    manualModeControlMapping: "Labor lines grid",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "labor.hazardPct": {
    key: "labor.hazardPct",
    label: "Hazard / Site Conditions %",
    section: "specialConditions",
    inputType: "percent",
    valueType: "percentString",
    required: false,
    defaultSource: "0%",
    dependencies: [],
    allowedOptionsSource: "steppedPercents",
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: true,
    validationRules: ["0-50"],
    displayPriority: 1,
    groupedQuestionBehavior: null,
    reviewClassification: "sensitive",
    manualModeControlMapping: "Hazard inline picker",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CHOICE,
    supportsModes: ["estimate", "invoice"],
  },
  "labor.riskPct": {
    key: "labor.riskPct",
    label: "Risk / Uncertainty Buffer %",
    section: "specialConditions",
    inputType: "percent",
    valueType: "percentString",
    required: false,
    defaultSource: "0%",
    dependencies: [],
    allowedOptionsSource: "steppedPercents",
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: true,
    validationRules: ["0-50"],
    displayPriority: 2,
    groupedQuestionBehavior: null,
    reviewClassification: "sensitive",
    manualModeControlMapping: "Risk inline picker",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CHOICE,
    supportsModes: ["estimate", "invoice"],
  },
  "ui.materialsMode": {
    key: "ui.materialsMode",
    label: "Materials Mode",
    section: "materials",
    inputType: "select",
    valueType: "string",
    required: true,
    defaultSource: "itemized",
    dependencies: [],
    allowedOptionsSource: "materialsMode",
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: true,
    validationRules: ["blanket or itemized"],
    displayPriority: 1,
    groupedQuestionBehavior: null,
    reviewClassification: "required",
    manualModeControlMapping: "Materials mode segmented control",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CHOICE,
    supportsModes: ["estimate", "invoice"],
  },
  "materials.blanketCost": {
    key: "materials.blanketCost",
    label: "Blanket Materials Cost",
    section: "materials",
    inputType: "currency",
    valueType: "moneyString",
    required: true,
    defaultSource: "user",
    dependencies: ["ui.materialsMode"],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["required in blanket mode"],
    displayPriority: 2,
    groupedQuestionBehavior: null,
    reviewClassification: "required",
    manualModeControlMapping: "Blanket materials cost input",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "materials.blanketInternalCost": {
    key: "materials.blanketInternalCost",
    label: "Blanket Internal Cost",
    section: "materials",
    inputType: "currency",
    valueType: "moneyString",
    required: false,
    defaultSource: "user",
    dependencies: ["ui.materialsMode"],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: true,
    validationRules: ["optional money value", "sensitive internal cost"],
    displayPriority: 3,
    groupedQuestionBehavior: null,
    reviewClassification: "sensitive",
    manualModeControlMapping: "Blanket internal cost input",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "materials.markupPct": {
    key: "materials.markupPct",
    label: "Materials Markup %",
    section: "materials",
    inputType: "percent",
    valueType: "percentString",
    required: false,
    defaultSource: "pricing settings",
    dependencies: ["ui.materialsMode"],
    allowedOptionsSource: "markupPercents",
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: true,
    validationRules: ["0-200"],
    displayPriority: 4,
    groupedQuestionBehavior: null,
    reviewClassification: "sensitive",
    manualModeControlMapping: "Blanket markup inline picker",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CHOICE,
    supportsModes: ["estimate", "invoice"],
  },
  "materials.materialsBlanketDescription": {
    key: "materials.materialsBlanketDescription",
    label: "Blanket Materials Description",
    section: "materials",
    inputType: "textarea",
    valueType: "string",
    required: false,
    defaultSource: "user",
    dependencies: ["ui.materialsMode"],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["free text"],
    displayPriority: 5,
    groupedQuestionBehavior: null,
    reviewClassification: "optional",
    manualModeControlMapping: "Blanket materials description textarea",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "materials.items": {
    key: "materials.items",
    label: "Itemized Materials",
    section: "materials",
    inputType: "collection",
    valueType: "materialLines",
    required: true,
    defaultSource: "user",
    dependencies: ["ui.materialsMode"],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["required in itemized mode"],
    displayPriority: 6,
    groupedQuestionBehavior: FIELD_GROUPS.MATERIALS_LINES,
    reviewClassification: "required",
    manualModeControlMapping: "Itemized materials grid",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "additionalNotes": {
    key: "additionalNotes",
    label: "Additional Notes",
    section: "notes",
    inputType: "textarea",
    valueType: "string",
    required: false,
    defaultSource: "user",
    dependencies: [],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: false,
    validationRules: ["free text"],
    displayPriority: 1,
    groupedQuestionBehavior: null,
    reviewClassification: "optional",
    manualModeControlMapping: "Additional notes textarea",
    guidedInteractionType: GUIDED_INTERACTIONS.GUIDED_CUSTOM,
    supportsModes: ["estimate", "invoice"],
  },
  "job.docNumber": {
    key: "job.docNumber",
    label: "Document Number",
    section: "review",
    inputType: "text",
    valueType: "string",
    required: false,
    defaultSource: "save flow",
    dependencies: [],
    allowedOptionsSource: null,
    allowCustom: false,
    aiCanInfer: true,
    aiCanSuggest: false,
    aiCanWriteDirectly: false,
    confirmationRequired: false,
    validationRules: ["system-generated during save when blank"],
    displayPriority: 1,
    groupedQuestionBehavior: null,
    reviewClassification: "auto",
    manualModeControlMapping: "No dedicated manual control today",
    guidedInteractionType: GUIDED_INTERACTIONS.AUTO_RESOLVE,
    supportsModes: ["estimate", "invoice"],
  },
  "labor.multiplier": {
    key: "labor.multiplier",
    label: "Labor Multiplier",
    section: "specialConditions",
    inputType: "number",
    valueType: "numberString",
    required: false,
    defaultSource: "1.0",
    dependencies: [],
    allowedOptionsSource: null,
    allowCustom: true,
    aiCanInfer: true,
    aiCanSuggest: true,
    aiCanWriteDirectly: true,
    confirmationRequired: true,
    validationRules: ["0.25-5.00", "not surfaced in manual mode today"],
    displayPriority: 3,
    groupedQuestionBehavior: null,
    reviewClassification: "sensitive",
    manualModeControlMapping: "No dedicated manual control today",
    guidedInteractionType: GUIDED_INTERACTIONS.MANUAL_FALLBACK,
    supportsModes: ["estimate", "invoice"],
  },
};

export const GUIDED_SECTION_REGISTRY = {
  customer: {
    key: "customer",
    label: "Customer",
    fields: [
      "customer.id",
      "customer.name",
      "customer.attn",
      "customer.phone",
      "customer.email",
      "customer.netTermsType",
      "customer.netTermsDays",
      "customer.address",
      "customer.billingDiff",
      "customer.billingAddress",
    ],
    prerequisiteFields: [],
    requiredFields: ["customer.id"],
    deferrableFields: ["customer.attn", "customer.phone", "customer.email", "customer.billingAddress"],
    aiPromptFraming: "Resolve the real saved customer first. Never invent customer records. Derive profile fields only from the selected customer.",
    extractionRules: ["map user phrasing to an existing saved customer id only", "leave customer unresolved when multiple matches remain"],
    writebackRules: ["use saved customer hydration", "do not allow custom customer ids"],
  },
  jobInfo: {
    key: "jobInfo",
    label: "Job Info",
    fields: [
      "customer.projectName",
      "customer.projectNumber",
      "job.poNumber",
      "job.date",
      "job.due",
      "customer.projectSameAsCustomer",
      "customer.projectAddress",
      "job.location",
      "customer.city",
      "customer.state",
      "customer.zip",
    ],
    prerequisiteFields: ["customer.id"],
    requiredFields: ["job.date", "customer.projectSameAsCustomer"],
    deferrableFields: ["customer.projectNumber", "job.poNumber", "job.location"],
    aiPromptFraming: "Capture job context in broad strokes, then narrow only when location or due behavior is unresolved.",
    extractionRules: ["allow one answer to populate project name, PO, issue date, and address fields", "when projectSameAsCustomer is true, suppress address follow-ups"],
    writebackRules: ["derive due date from customer defaults when possible", "confirm due date when AI changes a real value"],
  },
  scope: {
    key: "scope",
    label: "Scope / Trade",
    fields: ["scopeNotes", "tradeInsert.key", "tradeInsert.text"],
    prerequisiteFields: [],
    requiredFields: ["scopeNotes"],
    deferrableFields: ["tradeInsert.key", "tradeInsert.text"],
    aiPromptFraming: "Interpret rough job descriptions into work type, scope shape, and the next pricing driver. Keep wording clean and estimate-ready.",
    extractionRules: ["trade insert must come from live allowed options", "never fabricate a trade insert"],
    writebackRules: ["append trade insert text from the mapped template"],
    supportsModes: ["estimate"],
  },
  labor: {
    key: "labor",
    label: "Labor",
    fields: ["labor.lines"],
    prerequisiteFields: [],
    requiredFields: ["labor.lines"],
    deferrableFields: [],
    aiPromptFraming: "Turn rough crew language into a usable labor basis. Pull role, quantity, hours, rate, markup, and true rate when the answer gives them.",
    extractionRules: ["line roles should map to live labor role presets when possible", "freeform labels are allowed when no preset fits"],
    writebackRules: ["replace only the labor lines collection", "preserve at least one line item template when empty"],
  },
  materials: {
    key: "materials",
    label: "Materials",
    fields: [
      "ui.materialsMode",
      "materials.blanketCost",
      "materials.blanketInternalCost",
      "materials.markupPct",
      "materials.materialsBlanketDescription",
      "materials.items",
    ],
    prerequisiteFields: [],
    requiredFields: ["ui.materialsMode"],
    deferrableFields: ["materials.blanketInternalCost", "materials.materialsBlanketDescription"],
    aiPromptFraming: "Decide allowance vs itemized first, then collect only the material detail needed to price that path safely.",
    extractionRules: ["never switch materials branch silently when existing data would be discarded", "allow custom text when blanket description is appropriate"],
    writebackRules: ["branch changes require confirmation when material data exists", "validate all itemized values before patching"],
  },
  specialConditions: {
    key: "specialConditions",
    label: "Special Conditions",
    fields: ["labor.hazardPct", "labor.riskPct", "labor.multiplier"],
    prerequisiteFields: [],
    requiredFields: [],
    deferrableFields: ["labor.hazardPct", "labor.riskPct", "labor.multiplier"],
    aiPromptFraming: "Ask only if hazard, risk, or complexity meaningfully affects labor pricing. Default to zero / 1.0 when not mentioned.",
    extractionRules: ["percent choices must come from the stepped percent option set or validated custom values"],
    writebackRules: ["require confirmation for any non-default sensitive change"],
  },
  notes: {
    key: "notes",
    label: "Notes",
    fields: ["additionalNotes"],
    prerequisiteFields: [],
    requiredFields: [],
    deferrableFields: ["additionalNotes"],
    aiPromptFraming: "Ask for assumptions, exclusions, access limits, or customer responsibilities only when they help the estimate read professionally.",
    extractionRules: ["free text only"],
    writebackRules: ["safe direct write"],
  },
  review: {
    key: "review",
    label: "Review",
    fields: ["job.docNumber"],
    prerequisiteFields: [],
    requiredFields: [],
    deferrableFields: ["job.docNumber"],
    aiPromptFraming: "Audit coverage, confirmations, and unresolved gaps before save/export.",
    extractionRules: ["do not invent document numbers"],
    writebackRules: ["read-only / auto-resolve"],
  },
};

const SECTION_ORDER_BY_MODE = {
  estimate: ["customer", "jobInfo", "scope", "labor", "specialConditions", "materials", "notes", "review"],
  invoice: ["customer", "jobInfo", "labor", "materials", "specialConditions", "notes", "review"],
};

function isFieldSupportedInMode(field, mode) {
  return Array.isArray(field?.supportsModes) ? field.supportsModes.includes(mode) : true;
}

function isSectionSupportedInMode(section, mode) {
  return Array.isArray(section?.supportsModes) ? section.supportsModes.includes(mode) : true;
}

export function getGuidedField(key) {
  return GUIDED_FIELD_REGISTRY[key] || null;
}

export function getGuidedFieldsForMode(mode = "estimate") {
  return Object.values(GUIDED_FIELD_REGISTRY)
    .filter((field) => isFieldSupportedInMode(field, mode))
    .sort(fieldOrderComparator);
}

export function getGuidedSections(mode = "estimate") {
  const ordered = SECTION_ORDER_BY_MODE[mode === "invoice" ? "invoice" : "estimate"] || SECTION_ORDER_BY_MODE.estimate;
  return ordered
    .map((key) => GUIDED_SECTION_REGISTRY[key])
    .filter(Boolean)
    .filter((section) => isSectionSupportedInMode(section, mode));
}

export function getSectionByKey(sectionKey) {
  return GUIDED_SECTION_REGISTRY[sectionKey] || null;
}

export function getFieldValue(state, key) {
  return getAtPath(state, key);
}

export function getGuidedPlannerState(guidedMeta = {}) {
  const source = guidedMeta && typeof guidedMeta === "object"
    ? guidedMeta[GUIDED_PLANNER_META_KEY]
    : null;
  return source && typeof source === "object" ? source : {};
}

function hasPlannerFlag(planner, key) {
  return planner?.[key] === true;
}

function getPlannerTradeKey(planner) {
  return String(planner?.tradeKey || "").trim();
}

function countKnownScopeDrivers(planner = {}) {
  return [
    hasPlannerFlag(planner, "coverageKnown"),
    hasPlannerFlag(planner, "quantityBasisKnown"),
    hasPlannerFlag(planner, "occupancyKnown"),
    hasPlannerFlag(planner, "accessSetupKnown"),
    hasPlannerFlag(planner, "prepKnown"),
    hasPlannerFlag(planner, "demoKnown"),
    hasPlannerFlag(planner, "transitionsKnown"),
    hasPlannerFlag(planner, "repairCountKnown"),
    hasPlannerFlag(planner, "patchVsReplaceKnown"),
    hasPlannerFlag(planner, "textureKnown"),
    hasPlannerFlag(planner, "colorKnown"),
    hasPlannerFlag(planner, "coatsKnown"),
    hasPlannerFlag(planner, "finishKnown"),
  ].filter(Boolean).length;
}

function hasTradeOrScopeContext(state, planner = {}) {
  return hasText(state?.tradeInsert?.key)
    || hasPlannerFlag(planner, "tradeRecognized")
    || hasText(state?.scopeNotes)
    || (hasPlannerFlag(planner, "scopeCaptured") && countKnownScopeDrivers(planner) >= 1)
    || countKnownScopeDrivers(planner) >= 2;
}

function hasSoftCommercialScope(state, planner = {}) {
  if (!hasPlannerFlag(planner, "commercialContext")) return false;
  const scopeDriverCount = countKnownScopeDrivers(planner);
  const hasCoverage = hasPlannerFlag(planner, "coverageKnown");
  const hasQuantity = hasPlannerFlag(planner, "quantityBasisKnown");
  return (!hasCoverage || !hasQuantity) && scopeDriverCount < 4;
}

function getScopePromotionThreshold(state, planner = {}) {
  return hasSoftCommercialScope(state, planner) ? 4 : 3;
}

function shouldDeferNotesTarget(state, planner = {}) {
  if (hasPlannerFlag(planner, "notesResolved")) return true;
  if (hasPlannerFlag(planner, "scopeReadyForNotes")) return false;
  if (countKnownScopeDrivers(planner) >= getScopePromotionThreshold(state, planner)) return false;
  return !hasTradeOrScopeContext(state, planner);
}

function isFieldSemanticallyCovered(fieldKey, planner = {}, state) {
  switch (fieldKey) {
    case "tradeInsert.key":
      return hasText(state?.tradeInsert?.key) || !!getPlannerTradeKey(planner) || hasPlannerFlag(planner, "tradeRecognized");
    case "scopeNotes":
      return hasText(state?.scopeNotes)
        || (hasPlannerFlag(planner, "scopeCaptured") && countKnownScopeDrivers(planner) >= 1)
        || countKnownScopeDrivers(planner) >= 2;
    case "additionalNotes":
      return hasText(state?.additionalNotes) || hasPlannerFlag(planner, "notesResolved");
    case "customer.projectSameAsCustomer":
      return typeof state?.customer?.projectSameAsCustomer === "boolean";
    default:
      return false;
  }
}

function computeFieldTargetScore(fieldKey, state, auditMap, planner = {}) {
  const field = getGuidedField(fieldKey);
  const entry = auditMap.get(fieldKey);
  if (!field || !entry) return -Infinity;

  let score = Number(
    GUIDED_FIELD_TARGET_PRIORITY[fieldKey]
    || GUIDED_SECTION_TARGET_PRIORITY[field.section]
    || 0
  );

  if (entry.status === GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION) score += 18;
  if (entry.status === GUIDED_AUDIT_STATUS.MISSING) score += 10;
  if (field.reviewClassification === "required") score += 8;
  if (field.reviewClassification === "sensitive") score += 5;

  const scopeDriverCount = countKnownScopeDrivers(planner);
  const scopePromotionThreshold = getScopePromotionThreshold(state, planner);
  const softCommercialScope = hasSoftCommercialScope(state, planner);
  const tradeOrScopeKnown = hasTradeOrScopeContext(state, planner);
  const meaningfulScopeBasis = hasText(state?.scopeNotes) || scopeDriverCount >= Math.max(2, scopePromotionThreshold - 1);

  if (isFieldSemanticallyCovered(fieldKey, planner, state)) {
    score -= fieldKey === "scopeNotes" ? 24 : 42;
  }

  if (fieldKey === "tradeInsert.key" && tradeOrScopeKnown) score -= 36;
  if (fieldKey === "scopeNotes" && scopeDriverCount < 2) score += 16;
  if (fieldKey === "scopeNotes" && scopeDriverCount < 3) score += 28;
  if (fieldKey === "scopeNotes" && hasPlannerFlag(planner, "tradeRecognized") && scopeDriverCount === 0 && !hasText(state?.scopeNotes)) score += 18;
  if (fieldKey === "scopeNotes" && hasPlannerFlag(planner, "tradeRecognized")) score -= 8;
  if (fieldKey === "scopeNotes" && scopeDriverCount >= 2) score -= 20;
  if (fieldKey === "scopeNotes" && scopeDriverCount >= scopePromotionThreshold) score -= 32;
  if (fieldKey === "scopeNotes" && softCommercialScope) score += 18;
  if (fieldKey === "labor.lines" && scopeDriverCount < scopePromotionThreshold) score -= softCommercialScope ? 30 : 20;
  if (fieldKey === "labor.lines" && meaningfulScopeBasis && scopeDriverCount >= scopePromotionThreshold) score += 12;
  if ((fieldKey === "ui.materialsMode" || fieldKey === "materials.blanketCost" || fieldKey === "materials.items") && scopeDriverCount < scopePromotionThreshold) score -= softCommercialScope ? 22 : 16;
  if ((fieldKey === "ui.materialsMode" || fieldKey === "materials.blanketCost" || fieldKey === "materials.items") && meaningfulScopeBasis && scopeDriverCount >= scopePromotionThreshold) score += 8;
  if (fieldKey === "additionalNotes" && shouldDeferNotesTarget(state, planner)) score -= 32;
  if (fieldKey === "additionalNotes" && planner?.scopeReadyForNotes === true) score += 10;
  if (fieldKey === "job.docNumber") score -= 70;

  return score;
}

function entryCountsAsResolved(entry) {
  if (!entry) return false;
  return entry.status === GUIDED_AUDIT_STATUS.COMPLETE || entry.status === GUIDED_AUDIT_STATUS.INFERRED;
}

function buildGuidedReviewReadiness({ mode = "estimate", state, auditFields = [], planner = {} }) {
  const auditMap = new Map((auditFields || []).map((entry) => [entry.key, entry]));
  const drivers = mode === "invoice"
    ? [
      { key: "customer.id", label: "customer selection" },
      { key: "labor.lines", label: "labor basis" },
      { key: "ui.materialsMode", label: "materials path" },
      {
        key: getMaterialsMode(state) === "itemized" ? "materials.items" : "materials.blanketCost",
        label: getMaterialsMode(state) === "itemized" ? "material items" : "materials allowance",
      },
    ]
    : [
      { key: "customer.id", label: "customer selection" },
      { key: "tradeInsert.key", label: "trade or work type" },
      { key: "scopeNotes", label: "scope basis" },
      { key: "labor.lines", label: "labor basis" },
      { key: "ui.materialsMode", label: "materials path" },
      {
        key: getMaterialsMode(state) === "itemized" ? "materials.items" : "materials.blanketCost",
        label: getMaterialsMode(state) === "itemized" ? "material items" : "materials allowance",
      },
    ];

  const blockers = drivers.filter((driver) => !entryCountsAsResolved(auditMap.get(driver.key)));
  const confirmations = auditFields.filter((entry) => entry?.status === GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION);
  const score = Math.max(0, Math.min(100, Math.round(((drivers.length - blockers.length) / Math.max(drivers.length, 1)) * 100)));

  return {
    ready: blockers.length === 0 && confirmations.length === 0,
    score,
    blockers: blockers.map((driver) => driver.label),
    pendingConfirmations: confirmations.map((entry) => entry.key),
  };
}

function isFieldActive(fieldKey, state) {
  if (fieldKey === "customer.projectAddress"
    || fieldKey === "job.location"
    || fieldKey === "customer.city"
    || fieldKey === "customer.state"
    || fieldKey === "customer.zip") {
    return state?.customer?.projectSameAsCustomer === false;
  }

  if (fieldKey === "materials.blanketCost"
    || fieldKey === "materials.blanketInternalCost"
    || fieldKey === "materials.markupPct"
    || fieldKey === "materials.materialsBlanketDescription") {
    return getMaterialsMode(state) === "blanket";
  }

  if (fieldKey === "materials.items") {
    return getMaterialsMode(state) === "itemized";
  }

  if (fieldKey === "scopeNotes" || fieldKey === "tradeInsert.key" || fieldKey === "tradeInsert.text") {
    return state?.ui?.docType !== "invoice";
  }

  return true;
}

function isFieldMissing(fieldKey, state, context) {
  if (!isFieldActive(fieldKey, state)) return false;

  switch (fieldKey) {
    case "customer.id":
      return !hasText(state?.customer?.id);
    case "customer.name":
      return hasText(state?.customer?.id) && !hasText(state?.customer?.name);
    case "job.date":
      return !hasText(state?.job?.date);
    case "job.due": {
      const selectedCustomer = context?.selectedCustomer || null;
      const hasTerms = hasText(selectedCustomer?.netTermsType);
      if (!hasTerms) return false;
      return !hasText(state?.job?.due);
    }
    case "customer.projectSameAsCustomer":
      return typeof state?.customer?.projectSameAsCustomer !== "boolean";
    case "customer.projectAddress":
      return state?.customer?.projectSameAsCustomer === false && !hasText(state?.customer?.projectAddress);
    case "customer.city":
      return state?.customer?.projectSameAsCustomer === false && !hasText(state?.customer?.city);
    case "customer.state":
      return state?.customer?.projectSameAsCustomer === false && !hasText(state?.customer?.state);
    case "customer.zip":
      return state?.customer?.projectSameAsCustomer === false && !hasText(state?.customer?.zip);
    case "scopeNotes":
      return state?.ui?.docType !== "invoice" && !hasText(state?.scopeNotes);
    case "tradeInsert.text":
      return hasText(state?.tradeInsert?.key) && !hasText(state?.tradeInsert?.text);
    case "labor.lines": {
      const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
      return !lines.some((line) => isLaborLineMeaningful(line) && hasNumberLike(line?.hours) && hasNumberLike(line?.rate));
    }
    case "ui.materialsMode":
      return !hasText(state?.ui?.materialsMode);
    case "materials.blanketCost":
      return getMaterialsMode(state) === "blanket" && !hasNumberLike(state?.materials?.blanketCost);
    case "materials.items": {
      if (getMaterialsMode(state) !== "itemized") return false;
      const items = Array.isArray(state?.materials?.items) ? state.materials.items : [];
      return !items.some((item) => isMaterialItemMeaningful(item) && hasNumberLike(item?.priceEach || item?.charge));
    }
    default:
      return false;
  }
}

function classifyFieldStatus(fieldKey, state, guidedMeta, context) {
  const field = getGuidedField(fieldKey);
  if (!field || !isFieldActive(fieldKey, state)) return GUIDED_AUDIT_STATUS.COMPLETE;

  const meta = guidedMeta?.[fieldKey] || {};
  if (meta?.pendingConfirmation) return GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION;
  if (isFieldMissing(fieldKey, state, context)) return GUIDED_AUDIT_STATUS.MISSING;
  if (meta?.source === "ai" && !meta?.confirmed && Number(meta?.confidence || 0) >= 0.75) {
    return GUIDED_AUDIT_STATUS.INFERRED;
  }
  return GUIDED_AUDIT_STATUS.COMPLETE;
}

export function buildGuidedAudit({ mode = "estimate", state, guidedMeta = {}, context = {} }) {
  const planner = getGuidedPlannerState(guidedMeta);
  const sections = getGuidedSections(mode);
  const fieldEntries = getGuidedFieldsForMode(mode)
    .filter((field) => isFieldActive(field.key, state))
    .map((field) => {
      const status = classifyFieldStatus(field.key, state, guidedMeta, context);
      return {
        key: field.key,
        label: field.label,
        section: field.section,
        status,
        value: getFieldValue(state, field.key),
        reviewClassification: field.reviewClassification,
        guidedInteractionType: field.guidedInteractionType,
      };
    });

  const counts = {
    complete: 0,
    inferred: 0,
    needs_confirmation: 0,
    missing: 0,
  };

  fieldEntries.forEach((entry) => {
    if (entry.status === GUIDED_AUDIT_STATUS.COMPLETE) counts.complete += 1;
    if (entry.status === GUIDED_AUDIT_STATUS.INFERRED) counts.inferred += 1;
    if (entry.status === GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION) counts.needs_confirmation += 1;
    if (entry.status === GUIDED_AUDIT_STATUS.MISSING) counts.missing += 1;
  });

  const sectionEntries = sections.map((section) => {
    const fields = fieldEntries.filter((entry) => entry.section === section.key);
    let status = GUIDED_AUDIT_STATUS.COMPLETE;
    if (fields.some((entry) => entry.status === GUIDED_AUDIT_STATUS.MISSING)) status = GUIDED_AUDIT_STATUS.MISSING;
    else if (fields.some((entry) => entry.status === GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION)) status = GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION;
    else if (fields.some((entry) => entry.status === GUIDED_AUDIT_STATUS.INFERRED)) status = GUIDED_AUDIT_STATUS.INFERRED;
    return {
      key: section.key,
      label: section.label,
      status,
      fieldCount: fields.length,
      fields,
    };
  });

  const unresolvedFields = fieldEntries
    .filter((entry) => entry.status === GUIDED_AUDIT_STATUS.MISSING || entry.status === GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION)
    .map((entry) => entry.key);

  return {
    counts,
    fields: fieldEntries,
    sections: sectionEntries,
    unresolvedFields,
    reviewReadiness: buildGuidedReviewReadiness({ mode, state, auditFields: fieldEntries, planner }),
  };
}

function pickNextField(section, state, audit, planner = {}) {
  const sectionFields = section?.fields || [];
  const auditMap = new Map((audit?.fields || []).map((entry) => [entry.key, entry]));
  const candidates = sectionFields
    .filter((key) => isFieldActive(key, state))
    .map((key) => ({
      key,
      field: getGuidedField(key),
      entry: auditMap.get(key),
      score: computeFieldTargetScore(key, state, auditMap, planner),
    }))
    .filter((candidate) => candidate.entry)
    .filter((candidate) => (
      candidate.entry.status === GUIDED_AUDIT_STATUS.MISSING
      || candidate.entry.status === GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION
    ))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return fieldOrderComparator(left.field, right.field);
    });

  if (candidates.length) return candidates[0].key;
  return sectionFields.find((key) => isFieldActive(key, state)) || "";
}

function chooseLiteralFormOrderTargetFromAudit({ mode = "estimate", state, audit }) {
  if (!shouldPreferLiteralFormOrderTarget(mode, state)) return null;

  const auditMap = new Map((audit?.fields || []).map((entry) => [entry.key, entry]));
  const orderedFields = getLiteralFormOrderTargetFields(mode, state);

  for (let index = 0; index < orderedFields.length; index += 1) {
    const fieldKey = orderedFields[index];
    if (!isFieldActive(fieldKey, state)) continue;
    const entry = auditMap.get(fieldKey);
    if (!entry) continue;
    if (
      entry.status === GUIDED_AUDIT_STATUS.MISSING
      || entry.status === GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION
    ) {
      return {
        sectionKey: String(getGuidedField(fieldKey)?.section || entry.section || "customer").trim() || "customer",
        questionKey: fieldKey,
        audit,
      };
    }
  }

  return null;
}

export function chooseLiteralFormOrderGuidedTarget({ mode = "estimate", state, guidedMeta = {}, context = {} }) {
  const audit = buildGuidedAudit({ mode, state, guidedMeta, context });
  return chooseLiteralFormOrderTargetFromAudit({ mode, state, audit });
}

export function chooseNextGuidedTarget({ mode = "estimate", state, guidedMeta = {}, preferredSection = "", context = {} }) {
  const audit = buildGuidedAudit({ mode, state, guidedMeta, context });
  const planner = getGuidedPlannerState(guidedMeta);
  const sections = getGuidedSections(mode);
  const auditMap = new Map((audit?.fields || []).map((entry) => [entry.key, entry]));

  if (!preferredSection) {
    const literalFormOrderTarget = chooseLiteralFormOrderTargetFromAudit({ mode, state, audit });
    if (literalFormOrderTarget) return literalFormOrderTarget;
  }

  if (preferredSection && preferredSection !== "review") {
    const preferred = getSectionByKey(preferredSection);
    const preferredQuestion = pickNextField(preferred, state, audit, planner);
    if (preferredQuestion) {
      return {
        sectionKey: preferredSection,
        questionKey: preferredQuestion,
        audit,
      };
    }
  }

  const rankedCandidates = (audit?.fields || [])
    .filter((entry) => entry.status === GUIDED_AUDIT_STATUS.MISSING || entry.status === GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION)
    .map((entry) => ({
      sectionKey: entry.section,
      questionKey: entry.key,
      score: computeFieldTargetScore(entry.key, state, auditMap, planner)
        + (preferredSection && entry.section === preferredSection ? 12 : 0),
    }))
    .sort((left, right) => right.score - left.score);

  if (rankedCandidates.length) {
    if (Number(rankedCandidates[0].score || 0) < 0 && audit?.reviewReadiness?.ready) {
      return {
        sectionKey: "review",
        questionKey: "job.docNumber",
        audit,
      };
    }
    return {
      sectionKey: rankedCandidates[0].sectionKey,
      questionKey: rankedCandidates[0].questionKey,
      audit,
    };
  }

  const orderedSections = preferredSection
    ? [preferredSection, ...sections.map((section) => section.key).filter((key) => key !== preferredSection)]
    : sections.map((section) => section.key);

  for (let index = 0; index < orderedSections.length; index += 1) {
    const key = orderedSections[index];
    const section = getSectionByKey(key);
    const summary = audit.sections.find((entry) => entry.key === key);
    if (!section || !summary) continue;
    if (summary.status === GUIDED_AUDIT_STATUS.COMPLETE) continue;
    const questionKey = pickNextField(section, state, audit, planner);
    if (!questionKey) continue;
    return {
      sectionKey: key,
      questionKey,
      audit,
    };
  }

  return {
    sectionKey: "review",
    questionKey: "job.docNumber",
    audit,
  };
}

export function getLiveOptionsForField(fieldKey, context = {}) {
  switch (fieldKey) {
    case "customer.id":
      return customerOptions(context);
    case "customer.projectSameAsCustomer":
      return yesNoOptions();
    case "customer.state":
      return stateOptions();
    case "tradeInsert.key":
      return tradeOptions();
    case "ui.materialsMode":
      return MATERIALS_MODE_OPTIONS.map((option) => ({ ...option }));
    case "materials.markupPct":
      return markupOptions();
    case "labor.hazardPct":
    case "labor.riskPct":
      return percentOptions();
    case "labor.lines":
      return laborRoleOptions();
    default:
      return [];
  }
}

function summarizeCustomer(selectedCustomer) {
  if (!selectedCustomer) return null;
  return {
    id: String(selectedCustomer?.id || "").trim(),
    name: String(selectedCustomer?.displayName || selectedCustomer?.name || "").trim(),
    netTermsLabel: getNetTermsLabel(selectedCustomer),
    hasBillingAddress: hasText(selectedCustomer?.billingAddress),
    hasProjectAddress: hasText(selectedCustomer?.projectAddress),
  };
}

function summarizeLaborLines(state) {
  const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
  return lines.map((line) => ({
    id: String(line?.id || "").trim(),
    role: String(line?.role || "").trim(),
    label: String(line?.label || "").trim(),
    qty: String(line?.qty ?? "").trim(),
    hours: String(line?.hours ?? "").trim(),
    rate: String(line?.rate ?? "").trim(),
    markupPct: String(line?.markupPct ?? "").trim(),
    trueRateInternal: String(line?.trueRateInternal ?? line?.internalRate ?? "").trim(),
  }));
}

function summarizeMaterials(state) {
  const mode = getMaterialsMode(state);
  const items = Array.isArray(state?.materials?.items) ? state.materials.items : [];
  return {
    mode,
    blanketCost: String(state?.materials?.blanketCost ?? "").trim(),
    blanketInternalCost: String(state?.materials?.blanketInternalCost ?? "").trim(),
    markupPct: String(state?.materials?.markupPct ?? "").trim(),
    materialsBlanketDescription: String(state?.materials?.materialsBlanketDescription || "").trim(),
    items: items.map((item) => ({
      id: String(item?.id || "").trim(),
      desc: String(item?.desc || "").trim(),
      note: String(item?.note || "").trim(),
      qty: String(item?.qty ?? "").trim(),
      priceEach: String(item?.priceEach ?? item?.charge ?? "").trim(),
      unitCostInternal: String(item?.unitCostInternal ?? item?.costInternal ?? "").trim(),
      markupPct: String(item?.markupPct ?? "").trim(),
    })),
  };
}

export function buildStructuredFormSnapshot(state, context = {}) {
  const docType = state?.ui?.docType === "invoice" ? "invoice" : "estimate";
  const customer = summarizeCustomer(context?.selectedCustomer);
  const dueFromCustomer = context?.selectedCustomer
    ? computeDueDateFromCustomer(state?.job?.date, context.selectedCustomer, state?.job?.due)
    : "";

  return {
    docType,
    customer,
    customerState: {
      id: String(state?.customer?.id || "").trim(),
      name: String(state?.customer?.name || "").trim(),
      projectName: String(state?.customer?.projectName || "").trim(),
      projectNumber: String(state?.customer?.projectNumber || "").trim(),
      projectSameAsCustomer: state?.customer?.projectSameAsCustomer !== false,
      projectAddress: String(state?.customer?.projectAddress || "").trim(),
      city: String(state?.customer?.city || "").trim(),
      state: String(state?.customer?.state || "").trim(),
      zip: String(state?.customer?.zip || "").trim(),
    },
    job: {
      date: String(state?.job?.date || "").trim(),
      due: String(state?.job?.due || "").trim(),
      suggestedDue: String(dueFromCustomer || "").trim(),
      poNumber: String(state?.job?.poNumber || "").trim(),
      docNumber: String(state?.job?.docNumber || "").trim(),
      locationLine2: String(state?.job?.location || "").trim(),
    },
    scope: {
      scopeNotes: String(state?.scopeNotes || "").trim(),
      tradeInsertKey: String(state?.tradeInsert?.key || "").trim(),
      tradeInsertText: String(state?.tradeInsert?.text || "").trim(),
    },
    labor: {
      multiplier: String(state?.labor?.multiplier ?? "").trim(),
      hazardPct: String(state?.labor?.hazardPct ?? "").trim(),
      riskPct: String(state?.labor?.riskPct ?? "").trim(),
      lines: summarizeLaborLines(state),
    },
    materials: summarizeMaterials(state),
    additionalNotes: String(state?.additionalNotes || "").trim(),
  };
}

export function buildSectionPayload({ mode = "estimate", state, sectionKey, guidedMeta = {}, context = {} }) {
  const section = getSectionByKey(sectionKey) || getGuidedSections(mode)[0] || null;
  const audit = buildGuidedAudit({ mode, state, guidedMeta, context });
  const activeFields = (section?.fields || [])
    .filter((fieldKey) => isFieldActive(fieldKey, state))
    .map((fieldKey) => {
      const field = getGuidedField(fieldKey);
      return {
        ...(field || {}),
        options: getLiveOptionsForField(fieldKey, context),
        status: audit.fields.find((entry) => entry.key === fieldKey)?.status || GUIDED_AUDIT_STATUS.COMPLETE,
      };
    });

  return {
    section,
    activeFields,
    audit,
    snapshot: buildStructuredFormSnapshot(state, context),
  };
}

export function describeFieldValue(fieldKey, state, context = {}) {
  if (fieldKey === "customer.id") {
    const selected = context?.selectedCustomer;
    return String(selected?.displayName || state?.customer?.name || "").trim();
  }
  if (fieldKey === "ui.materialsMode") {
    return getMaterialsMode(state);
  }
  if (fieldKey === "labor.lines") {
    const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
    const count = lines.filter((line) => isLaborLineMeaningful(line)).length;
    return count ? `${count} labor line${count === 1 ? "" : "s"}` : "";
  }
  if (fieldKey === "materials.items") {
    const items = Array.isArray(state?.materials?.items) ? state.materials.items : [];
    const count = items.filter((item) => isMaterialItemMeaningful(item)).length;
    return count ? `${count} material item${count === 1 ? "" : "s"}` : "";
  }
  return String(getFieldValue(state, fieldKey) ?? "").trim();
}
