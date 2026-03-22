// @ts-nocheck
/* eslint-disable */

import { computeDueDateFromCustomer } from "../netTerms";
import {
  describeFieldValue,
  getFieldValue,
  getGuidedField,
  GUIDED_INTERACTIONS,
  LABOR_ROLE_OPTIONS,
  getLiveOptionsForField,
  isLaborLineMeaningful,
  isMaterialItemMeaningful,
} from "./registry";
import {
  normalizeHoursInput,
  normalizeMoneyInput,
  normalizeMultiplierInput,
  normalizePercentInput,
} from "../../utils/format";

const STATE_NAME_TO_CODE = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
  dc: "DC",
};

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return [];
}

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function hasMeaningfulValue(value) {
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return hasText(value) || (value !== null && value !== undefined && value !== "");
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  const raw = String(value || "").trim().toLowerCase();
  if (["yes", "y", "true", "same", "same as customer", "use customer", "customer", "1"].includes(raw)) return true;
  if (["no", "n", "false", "different", "custom", "separate", "manual", "0"].includes(raw)) return false;
  return null;
}

function toIsoDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const mmddyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (mmddyyyy) {
    const mm = String(mmddyyyy[1]).padStart(2, "0");
    const dd = String(mmddyyyy[2]).padStart(2, "0");
    return `${mmddyyyy[3]}-${mm}-${dd}`;
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return "";
  const next = new Date(parsed);
  if (Number.isNaN(next.getTime())) return "";
  const yyyy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fuzzyMatchOption(options, candidate) {
  const raw = String(candidate || "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const value = String(option?.value ?? "").trim();
    const label = String(option?.label ?? "").trim();
    if (!value && !label) continue;
    if (normalized === value.toLowerCase() || normalized === label.toLowerCase()) return option;
  }

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const value = String(option?.value ?? "").trim().toLowerCase();
    const label = String(option?.label ?? "").trim().toLowerCase();
    if (!value && !label) continue;
    if (value.includes(normalized) || normalized.includes(value) || label.includes(normalized) || normalized.includes(label)) {
      return option;
    }
  }

  return null;
}

function normalizeStateCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (upper.length === 2 && STATE_NAME_TO_CODE[String(raw || "").trim().toLowerCase()] !== undefined) {
    return upper;
  }
  if (upper.length === 2 && Object.values(STATE_NAME_TO_CODE).includes(upper)) {
    return upper;
  }
  return STATE_NAME_TO_CODE[raw.toLowerCase()] || "";
}

function normalizeCustomerId(rawValue, context) {
  const options = getLiveOptionsForField("customer.id", context);
  const match = fuzzyMatchOption(options, rawValue);
  return match ? String(match.value) : "";
}

function normalizeTradeInsert(rawValue, context) {
  const options = getLiveOptionsForField("tradeInsert.key", context);
  const match = fuzzyMatchOption(options, rawValue);
  if (!match) return { key: "", text: "" };
  const text = String(context?.tradeInsertTextByKey?.[match.value] || "").trim();
  return { key: String(match.value), text };
}

function normalizeMaterialsMode(rawValue, context) {
  const options = getLiveOptionsForField("ui.materialsMode", context);
  const match = fuzzyMatchOption(options, rawValue);
  return match ? String(match.value) : "";
}

function normalizePercentValue(rawValue, { max = 200 } = {}) {
  const normalized = normalizePercentInput(rawValue);
  if (!normalized && normalized !== "0") return "";
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return "";
  return String(Math.max(0, Math.min(max, numeric)));
}

function normalizeMoneyValue(rawValue) {
  return normalizeMoneyInput(rawValue);
}

function normalizeStringValue(rawValue) {
  return String(rawValue || "").trim();
}

function normalizeLaborRole(rawRole) {
  const match = fuzzyMatchOption(LABOR_ROLE_OPTIONS, rawRole);
  if (match) {
    return {
      role: String(match.value),
      label: String(match.label),
    };
  }
  const text = normalizeStringValue(rawRole);
  return {
    role: "",
    label: text,
  };
}

export function normalizeLaborLines(rawValue, context) {
  const items = Array.isArray(rawValue)
    ? rawValue
    : (Array.isArray(rawValue?.lines) ? rawValue.lines : []);

  const normalized = items
    .map((item) => {
      const roleMatch = normalizeLaborRole(item?.role || item?.label);
      return {
        id: normalizeStringValue(item?.id) || makeId("labor"),
        role: roleMatch.role,
        label: roleMatch.label,
        qty: String(Math.max(1, Math.round(Number(item?.qty) || 1))),
        hours: normalizeHoursInput(item?.hours),
        rate: normalizeMoneyInput(item?.rate),
        markupPct: normalizePercentValue(
          item?.markupPct === undefined || item?.markupPct === null || item?.markupPct === ""
            ? context?.globalDefaultMarkupPct
            : item?.markupPct
        ),
        trueRateInternal: normalizeMoneyInput(item?.trueRateInternal ?? item?.internalRate),
        internalRate: normalizeMoneyInput(item?.internalRate ?? item?.trueRateInternal),
      };
    })
    .filter((item) => isLaborLineMeaningful(item));

  return normalized.length ? normalized : [];
}

function normalizeMaterialLines(rawValue) {
  const items = Array.isArray(rawValue)
    ? rawValue
    : (Array.isArray(rawValue?.items) ? rawValue.items : []);

  const normalized = items
    .map((item) => ({
      id: normalizeStringValue(item?.id) || makeId("material"),
      desc: normalizeStringValue(item?.desc || item?.description),
      note: normalizeStringValue(item?.note),
      qty: String(Math.max(1, Math.round(Number(item?.qty) || 1))),
      unitCostInternal: normalizeMoneyInput(item?.unitCostInternal ?? item?.costInternal),
      costInternal: normalizeMoneyInput(item?.costInternal ?? item?.unitCostInternal),
      priceEach: normalizeMoneyInput(item?.priceEach ?? item?.charge),
      charge: normalizeMoneyInput(item?.charge ?? item?.priceEach),
      markupPct: normalizePercentValue(item?.markupPct),
    }))
    .filter((item) => isMaterialItemMeaningful(item));

  return normalized.length ? normalized : [];
}

function normalizeByField(fieldKey, rawValue, state, context) {
  switch (fieldKey) {
    case "customer.id":
      return normalizeCustomerId(rawValue, context);
    case "tradeInsert.key":
      return normalizeTradeInsert(rawValue, context);
    case "tradeInsert.text":
      return normalizeStringValue(rawValue);
    case "ui.materialsMode":
      return normalizeMaterialsMode(rawValue, context);
    case "customer.projectSameAsCustomer":
    case "customer.billingDiff":
      return normalizeBoolean(rawValue);
    case "customer.state":
      return normalizeStateCode(rawValue);
    case "job.date":
    case "job.due":
      return toIsoDate(rawValue);
    case "labor.hazardPct":
    case "labor.riskPct":
      return normalizePercentValue(rawValue, { max: 50 });
    case "materials.markupPct":
      return normalizePercentValue(rawValue, { max: 200 });
    case "labor.multiplier":
      return normalizeMultiplierInput(rawValue);
    case "materials.blanketCost":
    case "materials.blanketInternalCost":
      return normalizeMoneyValue(rawValue);
    case "labor.lines":
      return normalizeLaborLines(rawValue, context);
    case "materials.items":
      return normalizeMaterialLines(rawValue);
    default: {
      const field = getGuidedField(fieldKey);
      if (field?.valueType === "string") return normalizeStringValue(rawValue);
      if (field?.valueType === "moneyString") return normalizeMoneyValue(rawValue);
      if (field?.valueType === "percentString") return normalizePercentValue(rawValue);
      return rawValue;
    }
  }
}

function isSensitiveField(fieldKey) {
  return [
    "materials.blanketInternalCost",
    "materials.markupPct",
    "labor.hazardPct",
    "labor.riskPct",
    "labor.multiplier",
    "job.due",
    "ui.materialsMode",
  ].includes(fieldKey);
}

function isFieldWritable(fieldKey) {
  const field = getGuidedField(fieldKey);
  if (!field) return false;
  return field.guidedInteractionType !== GUIDED_INTERACTIONS.AUTO_RESOLVE || field.aiCanWriteDirectly;
}

function getNormalizedWriteSource(write) {
  const raw = String(write?.source || "").trim().toLowerCase();
  if (!raw) return "ai";
  if (raw === "user_choice" || raw === "user_input" || raw === "user_input_explicit") return raw;
  if (raw === "default" || raw === "system") return raw;
  return "ai";
}

function isExplicitUserSource(source) {
  return source === "user_choice" || source === "user_input" || source === "user_input_explicit";
}

function buildPatchOperation(path, value, fieldKey) {
  return { kind: "patch", path, value, fieldKey };
}

function buildSelectCustomerOperation(customerId, fieldKey = "customer.id") {
  return { kind: "selectCustomer", customerId, fieldKey };
}

function buildConfirmation(fieldKey, field, normalizedValue, existingValue, source, confidence, operation, reason = "") {
  return {
    id: `${fieldKey}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
    fieldKey,
    label: field?.label || fieldKey,
    value: normalizedValue,
    existingValue,
    source,
    confidence,
    reason: reason || `Confirm ${field?.label || fieldKey} before applying.`,
    operation,
  };
}

function shouldConfirmWrite({ fieldKey, field, state, normalizedValue, source, confidence }) {
  const currentValue = getFieldValue(state, fieldKey);
  const currentHasValue = hasMeaningfulValue(currentValue);
  const changingExistingValue = currentHasValue && JSON.stringify(currentValue) !== JSON.stringify(normalizedValue);
  if (isExplicitUserSource(source)) return false;
  if (field?.confirmationRequired) return true;
  if (isSensitiveField(fieldKey)) return true;
  if (Number(confidence || 0) < 0.65) return true;
  if (changingExistingValue && Number(confidence || 0) < 0.9) return true;
  return false;
}

function materialsBranchHasMeaningfulData(state, nextMode) {
  const currentMode = state?.ui?.materialsMode === "itemized" ? "itemized" : "blanket";
  if (currentMode === nextMode) return false;
  if (currentMode === "itemized") {
    const items = asArray(state?.materials?.items);
    return items.some((item) => isMaterialItemMeaningful(item));
  }
  return hasMeaningfulValue(state?.materials?.blanketCost)
    || hasMeaningfulValue(state?.materials?.materialsBlanketDescription)
    || hasMeaningfulValue(state?.materials?.blanketInternalCost);
}

function maybeBuildDerivedDueOperations(state, operations, context) {
  const currentCustomer = context?.selectedCustomer || null;
  if (!currentCustomer) return [];

  const nextState = {
    ...(state || {}),
    job: { ...(state?.job || {}) },
  };

  operations.forEach((operation) => {
    if (operation?.kind === "patch" && operation.path === "job.date") nextState.job.date = operation.value;
  });

  const nextDue = computeDueDateFromCustomer(nextState?.job?.date, currentCustomer, "");
  if (!nextDue) return [];

  const currentDue = String(state?.job?.due || "").trim();
  const currentDerivedDue = computeDueDateFromCustomer(state?.job?.date, currentCustomer, "");
  const dueBeingPatched = operations.some((operation) => operation?.kind === "patch" && operation.path === "job.due");
  if (dueBeingPatched) return [];

  if (!currentDue || (currentDerivedDue && currentDue === currentDerivedDue)) {
    return [buildPatchOperation("job.due", nextDue, "job.due")];
  }

  return [];
}

export function normalizeExtractedWrites(extractedFieldValues, confidenceByField = {}, sourceFallback = "ai") {
  if (Array.isArray(extractedFieldValues)) {
    return extractedFieldValues
      .filter(Boolean)
      .map((entry) => ({
        key: String(entry?.key || "").trim(),
        value: entry?.value,
        source: getNormalizedWriteSource({ source: entry?.source || sourceFallback }),
        confidence: Number(entry?.confidence ?? confidenceByField?.[entry?.key]) || 0,
        reason: String(entry?.reason || "").trim(),
      }))
      .filter((entry) => entry.key);
  }

  if (extractedFieldValues && typeof extractedFieldValues === "object") {
    return Object.keys(extractedFieldValues).map((key) => ({
      key,
      value: extractedFieldValues[key],
      source: getNormalizedWriteSource({ source: sourceFallback }),
      confidence: Number(confidenceByField?.[key]) || 0,
      reason: "",
    }));
  }

  return [];
}

export function applyGuidedWrites({ state, writes, context = {} }) {
  const applied = [];
  const blocked = [];
  const confirmations = [];
  const fieldMeta = {};

  const normalizedWrites = normalizeExtractedWrites(writes?.extractedFieldValues || writes, writes?.confidenceByField, writes?.source || "ai");

  for (let index = 0; index < normalizedWrites.length; index += 1) {
    const write = normalizedWrites[index];
    const field = getGuidedField(write.key);
    if (!field) {
      blocked.push({ ...write, reason: "Unknown field key." });
      continue;
    }

    if (!isFieldWritable(write.key)) {
      blocked.push({ ...write, reason: "Field is read-only in guided mode." });
      continue;
    }

    const normalizedValue = normalizeByField(write.key, write.value, state, context);
    if (
      normalizedValue === null
      || normalizedValue === undefined
      || normalizedValue === ""
      || (Array.isArray(normalizedValue) && normalizedValue.length === 0)
      || (typeof normalizedValue === "object" && !Array.isArray(normalizedValue) && !Object.keys(normalizedValue).length)
    ) {
      blocked.push({ ...write, reason: "Value failed validation or could not be mapped safely." });
      continue;
    }

    if (write.key === "tradeInsert.key" && !String(normalizedValue?.key || "").trim()) {
      blocked.push({ ...write, reason: "Trade insert did not match a saved option." });
      continue;
    }

    const source = getNormalizedWriteSource(write);
    const confidence = Number(write.confidence || 0);
    const existingValue = getFieldValue(state, write.key);

    if (write.key === "ui.materialsMode" && materialsBranchHasMeaningfulData(state, normalizedValue)) {
      const operation = buildPatchOperation("ui.materialsMode", normalizedValue, write.key);
      confirmations.push(buildConfirmation(
        write.key,
        field,
        normalizedValue,
        existingValue,
        source,
        confidence,
        operation,
        "Changing materials mode affects which material fields are active. Confirm before switching branches."
      ));
      fieldMeta[write.key] = { source, confidence, pendingConfirmation: true, confirmed: false };
      continue;
    }

    let operation = null;
    if (write.key === "customer.id") {
      operation = buildSelectCustomerOperation(normalizedValue, write.key);
    } else if (write.key === "tradeInsert.key") {
      operation = buildPatchOperation("tradeInsert.key", normalizedValue.key, write.key);
      if (normalizedValue.text) {
        applied.push(buildPatchOperation("tradeInsert.text", normalizedValue.text, "tradeInsert.text"));
        fieldMeta["tradeInsert.text"] = { source, confidence, pendingConfirmation: false, confirmed: isExplicitUserSource(source) };
      }
    } else {
      operation = buildPatchOperation(write.key, normalizedValue, write.key);
    }

    if (shouldConfirmWrite({
      fieldKey: write.key,
      field,
      state,
      normalizedValue: write.key === "tradeInsert.key" ? normalizedValue.key : normalizedValue,
      source,
      confidence,
    })) {
      confirmations.push(buildConfirmation(
        write.key,
        field,
        write.key === "tradeInsert.key" ? normalizedValue.key : normalizedValue,
        existingValue,
        source,
        confidence,
        operation,
        write.reason
      ));
      fieldMeta[write.key] = { source, confidence, pendingConfirmation: true, confirmed: false };
      continue;
    }

    applied.push(operation);
    fieldMeta[write.key] = { source, confidence, pendingConfirmation: false, confirmed: isExplicitUserSource(source) };
  }

  const derivedDueOps = maybeBuildDerivedDueOperations(state, applied, context);
  derivedDueOps.forEach((operation) => {
    applied.push(operation);
    fieldMeta[operation.fieldKey] = { source: "default", confidence: 1, pendingConfirmation: false, confirmed: true };
  });

  return {
    applied,
    blocked,
    confirmations,
    fieldMeta,
  };
}

export function applyGuidedOperations({ operations = [], patch, onSelectCustomer }) {
  const applied = [];
  operations.forEach((operation) => {
    if (!operation) return;
    if (operation.kind === "selectCustomer") {
      if (typeof onSelectCustomer === "function") {
        onSelectCustomer(String(operation.customerId || ""));
        applied.push({
          fieldKey: operation.fieldKey || "customer.id",
          description: describeOperation(operation),
        });
      }
      return;
    }

    if (operation.kind === "patch" && typeof patch === "function") {
      patch(operation.path, operation.value);
      applied.push({
        fieldKey: operation.fieldKey || operation.path,
        description: describeOperation(operation),
      });
    }
  });
  return applied;
}

export function describeOperation(operation) {
  if (!operation) return "";
  if (operation.kind === "selectCustomer") {
    return `Selected customer ${String(operation.customerId || "").trim()}`;
  }
  if (operation.kind === "patch") {
    return `${operation.path}: ${formatOperationValue(operation.value)}`;
  }
  return "";
}

export function formatOperationValue(value) {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

export function buildConfirmationMeta(confirmations = []) {
  const map = {};
  confirmations.forEach((item) => {
    map[item.fieldKey] = {
      source: item.source || "ai",
      confidence: Number(item.confidence || 0),
      pendingConfirmation: true,
      confirmed: false,
    };
  });
  return map;
}

export function buildAppliedMeta(operations = [], baseMeta = {}, source = "ai", confidence = 1) {
  const next = { ...(baseMeta || {}) };
  operations.forEach((operation) => {
    const key = operation?.fieldKey || operation?.path;
    if (!key) return;
    next[key] = {
      source,
      confidence,
      pendingConfirmation: false,
      confirmed: isExplicitUserSource(source),
    };
  });
  return next;
}

export function summarizeBlockedWrites(blocked = []) {
  return blocked.map((entry) => {
    const field = getGuidedField(entry?.key);
    return {
      key: entry?.key,
      label: field?.label || entry?.key,
      reason: entry?.reason || "Blocked",
    };
  });
}

export function buildWriteCoverageSnapshot(state, context = {}) {
  return {
    customer: describeFieldValue("customer.id", state, context),
    materialsMode: describeFieldValue("ui.materialsMode", state, context),
    labor: describeFieldValue("labor.lines", state, context),
    materials: describeFieldValue("materials.items", state, context),
    blanketCost: describeFieldValue("materials.blanketCost", state, context),
    due: describeFieldValue("job.due", state, context),
    scope: describeFieldValue("scopeNotes", state, context),
  };
}
