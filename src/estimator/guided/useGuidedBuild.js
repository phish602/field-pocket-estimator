// @ts-nocheck
/* eslint-disable */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGuidedAudit,
  chooseLiteralFormOrderGuidedTarget,
  chooseNextGuidedTarget,
  GUIDED_PLANNER_META_KEY,
  getGuidedField,
  getGuidedPlannerState,
  getGuidedSections,
} from "./registry";
import { previewGuidedBuildTurn, requestGuidedBuildTurn } from "./service";
import {
  applyGuidedOperations,
  applyGuidedWrites,
  buildConfirmationMeta,
  summarizeBlockedWrites,
} from "./writeback";

function deepClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

const ESTIPAID_GUIDED_TRACE_KEY = "__ESTIPAID_GUIDED_TRACE__";

function shouldTraceEstiPaidGuidedRuntime() {
  if (typeof process !== "undefined") {
    const envEnabled = process?.env?.ESTIPAID_GUIDED_TRACE === "1"
      || process?.env?.REACT_APP_ESTIPAID_GUIDED_TRACE === "1";
    if (envEnabled) return true;
  }
  if (typeof window === "undefined") return false;
  try {
    return window[ESTIPAID_GUIDED_TRACE_KEY] === true
      || window.localStorage?.getItem(ESTIPAID_GUIDED_TRACE_KEY) === "1";
  } catch {
    return window[ESTIPAID_GUIDED_TRACE_KEY] === true;
  }
}

function traceEstiPaidGuidedRuntime(source, event, payload = {}) {
  if (!shouldTraceEstiPaidGuidedRuntime()) return;
  try {
    console.info(`[ESTIPAID_GUIDED_TRACE][${source}] ${event}`, payload);
  } catch {}
}

function setAtPath(source, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length) return source;
  const root = Array.isArray(source) ? source.slice() : { ...(source || {}) };
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    const key = parts[index];
    const isLast = index === parts.length - 1;
    if (isLast) {
      current[key] = value;
      continue;
    }
    const nextValue = current[key];
    current[key] = Array.isArray(nextValue)
      ? nextValue.slice()
      : (nextValue && typeof nextValue === "object" ? { ...nextValue } : {});
    current = current[key];
  }
  return root;
}

function normalizeCustomerDisplayName(customer) {
  if (!customer || typeof customer !== "object") return "";
  return String(
    customer?.type === "commercial"
      ? customer?.companyName || customer?.name || ""
      : customer?.fullName || customer?.name || ""
  ).trim();
}

function formatAddress(source = {}) {
  const street = String(source?.street || "").trim();
  const city = String(source?.city || "").trim();
  const state = String(source?.state || "").trim();
  const zip = String(source?.zip || "").trim();
  const line2 = [city, state].filter(Boolean).join(", ");
  const line2Full = [line2, zip].filter(Boolean).join(" ");
  return [street, line2Full].filter(Boolean).join("\n");
}

function flattenCustomer(customer) {
  if (!customer || typeof customer !== "object") return null;
  const isCommercial = String(customer?.type || "").trim().toLowerCase() === "commercial";
  if (isCommercial) {
    const jobsite = customer?.jobsite || {};
    const billing = customer?.billSameAsJob ? (customer?.jobsite || {}) : (customer?.billing || {});
    return {
      id: String(customer?.id || "").trim(),
      name: normalizeCustomerDisplayName(customer),
      attn: String(customer?.contactName || "").trim(),
      phone: String(customer?.comPhone || customer?.phone || "").trim(),
      email: String(customer?.comEmail || customer?.email || "").trim(),
      netTermsType: String(customer?.netTermsType || "").trim(),
      netTermsDays: customer?.netTermsDays === null || customer?.netTermsDays === undefined
        ? ""
        : String(customer?.netTermsDays),
      address: formatAddress(jobsite),
      billingAddress: formatAddress(billing),
      billingDiff: formatAddress(billing) !== formatAddress(jobsite),
    };
  }

  const service = customer?.resService || {};
  const billing = customer?.resBillingSame ? (customer?.resService || {}) : (customer?.resBilling || {});
  return {
    id: String(customer?.id || "").trim(),
    name: normalizeCustomerDisplayName(customer),
    attn: "",
    phone: String(customer?.resPhone || customer?.phone || "").trim(),
    email: String(customer?.resEmail || customer?.email || "").trim(),
    netTermsType: String(customer?.netTermsType || "").trim(),
    netTermsDays: customer?.netTermsDays === null || customer?.netTermsDays === undefined
      ? ""
      : String(customer?.netTermsDays),
    address: formatAddress(service),
    billingAddress: formatAddress(billing),
    billingDiff: formatAddress(billing) !== formatAddress(service),
  };
}

function simulateGuidedOperations(state, operations, context) {
  let next = deepClone(state || {});
  operations.forEach((operation) => {
    if (!operation) return;
    if (operation.kind === "patch") {
      next = setAtPath(next, operation.path, operation.value);
      return;
    }

    if (operation.kind === "selectCustomer") {
      const customers = Array.isArray(context?.customers) ? context.customers : [];
      const customer = customers.find((entry) => String(entry?.id || "").trim() === String(operation.customerId || "").trim());
      const flattened = flattenCustomer(customer);
      if (!flattened) return;
      next = setAtPath(next, "customer.id", flattened.id);
      next = setAtPath(next, "customer.name", flattened.name);
      next = setAtPath(next, "customer.attn", flattened.attn);
      next = setAtPath(next, "customer.phone", flattened.phone);
      next = setAtPath(next, "customer.email", flattened.email);
      next = setAtPath(next, "customer.netTermsType", flattened.netTermsType);
      next = setAtPath(next, "customer.netTermsDays", flattened.netTermsDays);
      next = setAtPath(next, "customer.address", flattened.address);
      next = setAtPath(next, "customer.billingAddress", flattened.billingAddress);
      next = setAtPath(next, "customer.billingDiff", !!flattened.billingDiff);
    }
  });
  return next;
}

function mergeFieldMeta(prev = {}, next = {}) {
  const merged = { ...(prev || {}) };
  Object.keys(next || {}).forEach((key) => {
    merged[key] = {
      ...(merged[key] || {}),
      ...(next[key] || {}),
    };
  });
  return merged;
}

function mergePlannerState(prev = {}, next = {}) {
  const base = prev && typeof prev === "object" ? prev : {};
  const incoming = next && typeof next === "object" ? next : {};
  return Object.entries(incoming).reduce((acc, [key, value]) => {
    if (value === null || value === undefined || value === "") return acc;
    if (typeof value === "boolean") {
      acc[key] = base[key] === true || value === true;
      return acc;
    }
    if (Array.isArray(value)) {
      acc[key] = value.slice();
      return acc;
    }
    if (typeof value === "object") {
      acc[key] = { ...(base[key] || {}), ...value };
      return acc;
    }
    acc[key] = value;
    return acc;
  }, { ...base });
}

function setPlannerState(fieldMeta = {}, plannerState = {}) {
  return {
    ...(fieldMeta || {}),
    [GUIDED_PLANNER_META_KEY]: mergePlannerState(
      getGuidedPlannerState(fieldMeta),
      plannerState
    ),
  };
}

function readStepRunnerState(response = {}, fallbackSection = "", fallbackQuestion = "") {
  const source = response?.stepRunnerState && typeof response.stepRunnerState === "object"
    ? response.stepRunnerState
    : {};
  const stepResolution = response?.stepResolution && typeof response.stepResolution === "object"
    ? response.stepResolution
    : {};
  const activeFieldKey = String(
    source?.activeFieldKey
    || response?.nextBestQuestion?.fieldKey
    || response?.recommendedNextQuestion
    || fallbackQuestion
    || ""
  ).trim();
  const activeSectionKey = String(
    source?.activeSectionKey
    || response?.nextBestQuestion?.sectionKey
    || response?.recommendedNextSection
    || fallbackSection
    || ""
  ).trim();
  const activePrompt = String(
    source?.activePrompt
    || response?.nextBestQuestion?.question
    || response?.assistantMessage
    || ""
  ).trim();
  return {
    activeStepId: String(source?.canonicalStepId || source?.activeStepId || (activeFieldKey ? `${activeSectionKey || "review"}:${activeFieldKey}` : "")).trim(),
    activeSectionKey,
    activeFieldKey,
    activePrompt,
    stepOptions: Array.isArray(response?.suggestedChoices) ? response.suggestedChoices : [],
    promptIntent: String(source?.promptIntent || "").trim(),
    expectedAnswerMode: String(source?.expectedAnswerMode || "").trim(),
    expectedComponents: Array.isArray(source?.expectedComponents) ? source.expectedComponents : [],
    resolvedComponents: Array.isArray(source?.answeredComponents) ? source.answeredComponents : (Array.isArray(stepResolution?.answeredComponents) ? stepResolution.answeredComponents : []),
    missingComponents: Array.isArray(source?.missingComponents) ? source.missingComponents : (Array.isArray(stepResolution?.missingComponents) ? stepResolution.missingComponents : []),
    turnDiagnosis: String(source?.turnDiagnosis || stepResolution?.status || "").trim(),
    nextQuestionReason: String(source?.nextQuestionReason || "").trim(),
    resolutionSource: String(source?.resolutionSource || response?.resolutionSource || "").trim(),
    plannerState: mergePlannerState(
      getGuidedPlannerState({ [GUIDED_PLANNER_META_KEY]: source?.plannerState || {} }),
      source?.plannerState || {}
    ),
  };
}

function normalizeGuidedTurnDiagnosis(value = "") {
  const diagnosis = String(value || "").trim().toLowerCase();
  if (!diagnosis) return "";
  if (diagnosis === "fully_resolved") return "resolved";
  if (diagnosis === "partially_resolved") return "partial";
  if (diagnosis === "unresolved_clarified") return "unresolved_clarify";
  if (diagnosis === "invalid_for_prompt") return "invalid_for_step";
  if (diagnosis === "needs_interpretive_retry") return "repeated_unresolved";
  return diagnosis;
}

function normalizeGuidedStepComponents(values = []) {
  return Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function looksLikeWeakGuidedLoopPrompt(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return true;
  return [
    /\bwhat should i price next\b/,
    /\bwhat should i carry next\b/,
    /\bwhat should i fill in next\b/,
    /\bgive me the part of the job detail\b/,
    /\bcurrent step\b/,
    /\bcoverage\b/,
    /\bmissing field\b/,
    /\bgetting the next question ready\b/,
  ].some((pattern) => pattern.test(text));
}

function hasGuidedStepProgress(previousGuided, nextStepState) {
  const previousResolved = normalizeGuidedStepComponents(previousGuided?.resolvedComponents);
  const nextResolved = normalizeGuidedStepComponents(nextStepState?.resolvedComponents);
  if (nextResolved.length > previousResolved.length) return true;

  const previousMissing = normalizeGuidedStepComponents(previousGuided?.missingComponents);
  const nextMissing = normalizeGuidedStepComponents(nextStepState?.missingComponents);
  if (previousMissing.length && nextMissing.length < previousMissing.length) return true;

  return false;
}

function deriveRepeatedUnresolvedCount(previousGuided, nextStepState, submittedAnswer = "") {
  const text = String(submittedAnswer || "").trim();
  if (!text) return 0;
  const diagnosis = normalizeGuidedTurnDiagnosis(nextStepState?.turnDiagnosis || "");
  if (!["partial", "unresolved_clarify", "invalid_for_step", "repeated_unresolved", "escalated_to_groq"].includes(diagnosis)) {
    return 0;
  }
  const previousStepId = String(previousGuided?.activeStepId || "").trim();
  const nextStepId = String(nextStepState?.activeStepId || "").trim();
  const previousPrompt = String(previousGuided?.activeStepPrompt || previousGuided?.assistantMessage || "").trim();
  const nextPrompt = String(nextStepState?.activePrompt || "").trim();
  if (!previousStepId || previousStepId !== nextStepId) return 0;
  if (hasGuidedStepProgress(previousGuided, nextStepState)) return 0;

  const previousPromptIntent = String(previousGuided?.promptIntent || "").trim();
  const nextPromptIntent = String(nextStepState?.promptIntent || "").trim();
  const previousReason = String(previousGuided?.nextQuestionReason || "").trim();
  const nextReason = String(nextStepState?.nextQuestionReason || "").trim();
  const previousMode = String(previousGuided?.expectedAnswerMode || "").trim();
  const nextMode = String(nextStepState?.expectedAnswerMode || "").trim();
  const samePromptIntent = previousPromptIntent && nextPromptIntent && previousPromptIntent === nextPromptIntent;
  const sameReason = previousReason && nextReason && previousReason === nextReason;
  const sameMode = previousMode && nextMode && previousMode === nextMode;
  const weakLoopPrompt = looksLikeWeakGuidedLoopPrompt(previousPrompt) || looksLikeWeakGuidedLoopPrompt(nextPrompt);

  if (!samePromptIntent && !sameReason && !sameMode && previousPrompt !== nextPrompt && !weakLoopPrompt) {
    return 0;
  }
  return Number(previousGuided?.repeatedUnresolvedCount || 0) + 1;
}

function getVisiblePrompt(state = {}) {
  return String(state?.activeStepPrompt || state?.assistantMessage || "").trim();
}

function isSameVisibleGuidedTurn(previousState = {}, nextState = {}) {
  const previousSection = String(previousState?.currentSection || "").trim();
  const nextSection = String(nextState?.currentSection || "").trim();
  const previousQuestion = String(previousState?.currentQuestion || "").trim();
  const nextQuestion = String(nextState?.currentQuestion || "").trim();
  const previousStepId = String(previousState?.activeStepId || "").trim();
  const nextStepId = String(nextState?.activeStepId || "").trim();
  const previousPrompt = getVisiblePrompt(previousState);
  const nextPrompt = getVisiblePrompt(nextState);

  return previousSection === nextSection
    && previousQuestion === nextQuestion
    && previousStepId === nextStepId
    && previousPrompt === nextPrompt;
}

function buildSameStepClarificationPrompt(state = {}, submittedAnswer = "") {
  const currentPrompt = getVisiblePrompt(state);
  const diagnosis = normalizeGuidedTurnDiagnosis(state?.turnDiagnosis || "");
  if (!["partial", "unresolved_clarify", "invalid_for_step", "repeated_unresolved"].includes(diagnosis)) {
    return currentPrompt;
  }

  const fieldKey = String(state?.currentQuestion || state?.activeFieldKey || "").trim();
  const field = fieldKey ? getGuidedField(fieldKey) : null;
  const fieldLabel = String(field?.label || "that detail").trim();
  const answer = String(submittedAnswer || "").trim();
  const alreadyClarified = /please answer|still need|to move forward/i.test(currentPrompt);
  if (alreadyClarified) return currentPrompt;

  const intro = currentPrompt || "I still need one detail to keep building this estimate.";
  const answerHint = answer ? ` Your last answer was "${answer}".` : "";
  return `${intro}\n\nI still need ${fieldLabel}. Please answer that directly so I can move to the next step.${answerHint}`.trim();
}

function withVisibleGuidedTransition(previousState, nextState, options = {}) {
  if (!isSameVisibleGuidedTurn(previousState, nextState)) return nextState;
  const clarificationPrompt = buildSameStepClarificationPrompt(nextState, options?.submittedAnswer || "");
  if (!clarificationPrompt || clarificationPrompt === getVisiblePrompt(nextState)) return nextState;
  return {
    ...nextState,
    assistantMessage: clarificationPrompt,
    activeStepPrompt: clarificationPrompt,
  };
}

function appendAnsweredPrompt(history, entry) {
  const answer = String(entry?.answer || "").trim();
  if (!answer) return Array.isArray(history) ? history : [];
  const nextEntry = {
    sectionKey: String(entry?.sectionKey || "").trim(),
    questionKey: String(entry?.questionKey || "").trim(),
    prompt: String(entry?.prompt || "").trim(),
    answer,
  };
  const prior = Array.isArray(history) ? history : [];
  const last = prior[prior.length - 1];
  if (
    last
    && String(last?.sectionKey || "").trim() === nextEntry.sectionKey
    && String(last?.questionKey || "").trim() === nextEntry.questionKey
    && String(last?.prompt || "").trim() === nextEntry.prompt
    && String(last?.answer || "").trim() === nextEntry.answer
  ) {
    return prior;
  }
  return [...prior, nextEntry].slice(-12);
}

function findNextReviewSection(mode, sectionKey) {
  const sections = getGuidedSections(mode);
  const index = sections.findIndex((section) => section.key === sectionKey);
  if (index < 0) return sections[0]?.key || "review";
  return sections[Math.min(index + 1, sections.length - 1)]?.key || "review";
}

function blankPendingState() {
  return {
    isLoading: false,
    isThinking: false,
    pendingRequestId: 0,
    pendingRequestKey: "",
    pendingStepKey: "",
    pendingSectionKey: "",
  };
}

const DIRECT_CHOICE_WRITE_FIELDS = new Set([
  "customer.id",
  "customer.projectSameAsCustomer",
  "customer.projectAddress",
  "customer.state",
  "job.date",
  "job.due",
  "tradeInsert.key",
  "ui.materialsMode",
  "materials.blanketCost",
  "materials.blanketInternalCost",
  "materials.markupPct",
  "materials.materialsBlanketDescription",
  "labor.hazardPct",
  "labor.riskPct",
  "labor.multiplier",
]);
const GUIDED_AUDIT_STATUS_COMPLETE = "complete";
const GUIDED_AUDIT_STATUS_INFERRED = "inferred";
const GUIDED_AUDIT_STATUS_NEEDS_CONFIRMATION = "needs_confirmation";
const GUIDED_AUDIT_STATUS_MISSING = "missing";
const GUIDED_PROGRESS_OPTIONAL_FIELD_KEYS = new Set([
  "customer.state",
  "ui.materialsMode",
  "materials.blanketInternalCost",
  "materials.markupPct",
  "materials.materialsBlanketDescription",
  "labor.hazardPct",
  "labor.riskPct",
  "labor.multiplier",
  "additionalNotes",
  "job.docNumber",
  "job.date",
  "job.due",
]);
const GUIDED_PROGRESS_OPTIONAL_SECTIONS = new Set(["notes", "review"]);

function isDirectChoiceWriteSafe(choice, guidedState = {}) {
  const fieldKey = String(choice?.fieldKey || "").trim();
  if (!fieldKey || choice?.value === undefined) return false;
  if (!DIRECT_CHOICE_WRITE_FIELDS.has(fieldKey)) return false;
  if (fieldKey === "tradeInsert.key") {
    return String(guidedState?.currentQuestion || "").trim() === "tradeInsert.key";
  }
  return true;
}

function buildActiveStepPayload(guidedState = {}) {
  const fieldKey = String(guidedState?.currentQuestion || guidedState?.activeFieldKey || "").trim();
  const sectionKey = String(guidedState?.currentSection || guidedState?.activeSectionKey || "").trim();
  return {
    fieldKey,
    sectionKey,
    promptText: String(guidedState?.activeStepPrompt || guidedState?.assistantMessage || "").trim(),
    promptIntent: String(guidedState?.promptIntent || "").trim(),
    expectedAnswerMode: String(guidedState?.expectedAnswerMode || "").trim(),
    expectedComponents: Array.isArray(guidedState?.expectedComponents) ? guidedState.expectedComponents : [],
    resolvedComponents: Array.isArray(guidedState?.resolvedComponents) ? guidedState.resolvedComponents : [],
    missingComponents: Array.isArray(guidedState?.missingComponents) ? guidedState.missingComponents : [],
    repeatedUnresolvedCount: Number(guidedState?.repeatedUnresolvedCount || 0) || 0,
    turnDiagnosis: String(guidedState?.turnDiagnosis || "").trim(),
    suggestedChoices: Array.isArray(guidedState?.suggestedChoices)
      ? guidedState.suggestedChoices
      : (Array.isArray(guidedState?.stepOptions) ? guidedState.stepOptions : []),
    plannerState: guidedState?.plannerState && typeof guidedState.plannerState === "object"
      ? guidedState.plannerState
      : {},
  };
}

function cloneGuidedFieldMeta(fieldMeta = {}) {
  return fieldMeta && typeof fieldMeta === "object"
    ? { ...fieldMeta }
    : {};
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isGuidedOptionalProgressField(fieldKey = "", sectionKey = "") {
  const normalizedFieldKey = String(fieldKey || "").trim();
  const normalizedSectionKey = String(sectionKey || "").trim();
  return GUIDED_PROGRESS_OPTIONAL_FIELD_KEYS.has(normalizedFieldKey)
    || GUIDED_PROGRESS_OPTIONAL_SECTIONS.has(normalizedSectionKey);
}

function buildGuidedAuditFieldEntry(field = {}, fallbackSection = "") {
  const key = String(field?.key || "").trim();
  const registryField = key ? getGuidedField(key) : null;
  const section = String(field?.section || registryField?.section || fallbackSection || "").trim();
  return {
    ...field,
    key,
    label: String(field?.label || registryField?.label || key).trim(),
    section,
    status: String(field?.status || GUIDED_AUDIT_STATUS_MISSING).trim() || GUIDED_AUDIT_STATUS_MISSING,
  };
}

function countGuidedAuditFieldsByStatus(fields = []) {
  return asArray(fields).reduce((acc, field) => {
    const status = String(field?.status || GUIDED_AUDIT_STATUS_MISSING).trim() || GUIDED_AUDIT_STATUS_MISSING;
    if (status === GUIDED_AUDIT_STATUS_COMPLETE) acc.complete += 1;
    else if (status === GUIDED_AUDIT_STATUS_INFERRED) acc.inferred += 1;
    else if (status === GUIDED_AUDIT_STATUS_NEEDS_CONFIRMATION) acc.needs_confirmation += 1;
    else acc.missing += 1;
    return acc;
  }, {
    complete: 0,
    inferred: 0,
    needs_confirmation: 0,
    missing: 0,
  });
}

function getGuidedAuditSectionStatus(fields = []) {
  const normalizedFields = asArray(fields);
  if (!normalizedFields.length) return GUIDED_AUDIT_STATUS_MISSING;
  if (normalizedFields.some((field) => field?.status === GUIDED_AUDIT_STATUS_MISSING)) return GUIDED_AUDIT_STATUS_MISSING;
  if (normalizedFields.some((field) => field?.status === GUIDED_AUDIT_STATUS_NEEDS_CONFIRMATION)) return GUIDED_AUDIT_STATUS_NEEDS_CONFIRMATION;
  if (normalizedFields.some((field) => field?.status === GUIDED_AUDIT_STATUS_INFERRED)) return GUIDED_AUDIT_STATUS_INFERRED;
  return GUIDED_AUDIT_STATUS_COMPLETE;
}

function buildGuidedReadinessBlockers(unresolvedFields = [], fallbackBlockers = []) {
  const derived = asArray(unresolvedFields)
    .map((fieldKey) => String(getGuidedField(fieldKey)?.label || fieldKey || "").trim())
    .filter(Boolean);
  return derived.length ? derived : asArray(fallbackBlockers);
}

function normalizeGuidedAuditForProgress(audit = {}, target = {}) {
  const sourceAudit = audit && typeof audit === "object" ? audit : {};
  const sourceFields = asArray(sourceAudit?.fields).map((field) => buildGuidedAuditFieldEntry(field));
  const unresolvedRequired = new Set(asArray(sourceAudit?.unresolvedFields).map((fieldKey) => String(fieldKey || "").trim()).filter(Boolean));
  const activeFieldKey = String(target?.questionKey || "").trim();
  const activeSectionKey = String(target?.sectionKey || getGuidedField(activeFieldKey)?.section || "").trim();

  let requiredFields = sourceFields.filter((field) => {
    if (!field?.key) return false;
    if (field.key === activeFieldKey) return true;
    if (unresolvedRequired.has(field.key)) return true;
    return !isGuidedOptionalProgressField(field.key, field.section);
  });

  Array.from(unresolvedRequired).forEach((fieldKey) => {
    if (!fieldKey || requiredFields.some((field) => field.key === fieldKey)) return;
    requiredFields = [
      ...requiredFields,
      buildGuidedAuditFieldEntry({
        key: fieldKey,
        status: GUIDED_AUDIT_STATUS_MISSING,
      }, String(getGuidedField(fieldKey)?.section || "").trim()),
    ];
  });

  if (activeFieldKey && !requiredFields.some((field) => field.key === activeFieldKey)) {
    requiredFields = [
      ...requiredFields,
      buildGuidedAuditFieldEntry({
        key: activeFieldKey,
        status: GUIDED_AUDIT_STATUS_MISSING,
      }, activeSectionKey),
    ];
  }

  const requiredFieldKeys = new Set(requiredFields.map((field) => field.key));
  if (activeFieldKey) requiredFieldKeys.add(activeFieldKey);
  const normalizedUnresolvedFields = Array.from(new Set([
    ...Array.from(unresolvedRequired).filter((fieldKey) => requiredFieldKeys.has(fieldKey)),
    ...(activeFieldKey ? [activeFieldKey] : []),
  ])).filter(Boolean);

  const counts = countGuidedAuditFieldsByStatus(requiredFields);
  const totalRequiredCount = requiredFields.length;
  const coveredRequiredCount = counts.complete + counts.inferred + counts.needs_confirmation;
  const pendingConfirmations = asArray(sourceAudit?.reviewReadiness?.pendingConfirmations)
    .map((fieldKey) => String(fieldKey || "").trim())
    .filter((fieldKey) => requiredFieldKeys.has(fieldKey));
  const ready = totalRequiredCount > 0
    ? counts.missing === 0 && counts.needs_confirmation === 0 && normalizedUnresolvedFields.length === 0 && pendingConfirmations.length === 0
    : false;
  const score = totalRequiredCount > 0
    ? Math.max(0, Math.min(100, Math.round((coveredRequiredCount / totalRequiredCount) * 100)))
    : 0;

  const sourceSections = asArray(sourceAudit?.sections);
  const sectionMap = new Map();
  sourceSections.forEach((section) => {
    const key = String(section?.key || "").trim();
    if (!key) return;
    sectionMap.set(key, { ...section, key, label: String(section?.label || key).trim() || key });
  });
  requiredFields.forEach((field) => {
    if (!field?.section) return;
    if (!sectionMap.has(field.section)) {
      sectionMap.set(field.section, {
        key: field.section,
        label: String(getGuidedField(field.key)?.section || field.section).trim() || field.section,
        status: GUIDED_AUDIT_STATUS_MISSING,
      });
    }
  });
  if (activeSectionKey && !sectionMap.has(activeSectionKey)) {
    sectionMap.set(activeSectionKey, {
      key: activeSectionKey,
      label: activeSectionKey,
      status: GUIDED_AUDIT_STATUS_MISSING,
    });
  }

  const requiredFieldsBySection = requiredFields.reduce((acc, field) => {
    const sectionKey = String(field?.section || "").trim();
    if (!sectionKey) return acc;
    acc[sectionKey] = [...(acc[sectionKey] || []), field];
    return acc;
  }, {});

  const sections = Array.from(sectionMap.values()).map((section) => {
    const sectionKey = String(section?.key || "").trim();
    const sectionFields = requiredFieldsBySection[sectionKey] || [];
    const hasActiveRequiredField = sectionKey === activeSectionKey && !!activeFieldKey;
    const optionalOnlySection = !sectionFields.length && GUIDED_PROGRESS_OPTIONAL_SECTIONS.has(sectionKey);
    return {
      ...section,
      status: sectionFields.length
        ? getGuidedAuditSectionStatus(sectionFields)
        : (hasActiveRequiredField || optionalOnlySection ? GUIDED_AUDIT_STATUS_MISSING : String(section?.status || GUIDED_AUDIT_STATUS_MISSING).trim() || GUIDED_AUDIT_STATUS_MISSING),
    };
  });

  return {
    ...sourceAudit,
    counts,
    fields: requiredFields,
    sections,
    unresolvedFields: normalizedUnresolvedFields,
    reviewReadiness: {
      ...(sourceAudit?.reviewReadiness || {}),
      ready,
      score,
      blockers: buildGuidedReadinessBlockers(normalizedUnresolvedFields, sourceAudit?.reviewReadiness?.blockers),
      pendingConfirmations,
    },
  };
}

function getGuidedProgressPercent(audit = {}) {
  const counts = audit?.counts || {};
  const coveredFieldCount = Number(counts?.complete || 0)
    + Number(counts?.inferred || 0)
    + Number(counts?.needs_confirmation || 0);
  const reviewFields = asArray(audit?.fields);
  const totalFieldCount = reviewFields.length
    ? reviewFields.length
    : coveredFieldCount + Number(counts?.missing || 0);
  return totalFieldCount > 0
    ? Math.max(0, Math.min(100, Math.round((coveredFieldCount / totalFieldCount) * 100)))
    : 0;
}

function hasDefinedGuidedProgressPercent(value) {
  return Number.isFinite(Number(value));
}

function resolveGuidedRecommendedTarget(response, fallbackSection, fallbackQuestion) {
  const responseFieldKey = String(
    response?.recommendedNextQuestion || response?.nextBestQuestion?.fieldKey || ""
  ).trim();
  const responseField = responseFieldKey ? getGuidedField(responseFieldKey) : null;
  if (!responseField) {
    return {
      sectionKey: fallbackSection,
      questionKey: fallbackQuestion,
    };
  }

  return {
    sectionKey: String(
      response?.recommendedNextSection || response?.nextBestQuestion?.sectionKey || responseField?.section || fallbackSection || ""
    ).trim() || fallbackSection,
    questionKey: responseField.key,
  };
}

function createFreshGuidedState({ mode, state, context, initialFieldMeta = {}, baseAudit = null, enabled = false }) {
  const seededFieldMeta = getCanonicalGuidedFieldMetaForState(state, initialFieldMeta);
  const target = chooseNextGuidedTarget({ mode, state, guidedMeta: seededFieldMeta, context });
  const normalizedAudit = normalizeGuidedAuditForProgress(target.audit || baseAudit, target);
  return {
    enabled,
    currentSection: target.sectionKey,
    currentQuestion: target.questionKey,
    assistantMessage: "",
    suggestedChoices: [],
    activeStepId: target.questionKey ? `${target.sectionKey}:${target.questionKey}` : "",
    activeStepPrompt: "",
    stepOptions: [],
    promptIntent: "",
    expectedAnswerMode: "",
    expectedComponents: [],
    resolvedComponents: [],
    missingComponents: [],
    turnDiagnosis: "",
    repeatedUnresolvedCount: 0,
    nextQuestionReason: "",
    resolutionSource: "",
    reviewReadiness: normalizedAudit?.reviewReadiness || baseAudit?.reviewReadiness || null,
    plannerState: getGuidedPlannerState(seededFieldMeta),
    answeredPrompts: [],
    extractedValues: [],
    pendingConfirmations: [],
    unresolvedRequiredFields: normalizedAudit?.unresolvedFields || baseAudit?.unresolvedFields || [],
    lowConfidenceFields: [],
    skippedFields: [],
    completionAudit: normalizedAudit || baseAudit,
    lastAppliedWrites: [],
    originFlow: mode,
    warnings: [],
    error: "",
    ...blankPendingState(),
    lastResolvedAt: 0,
    reviewOpen: false,
    fieldMeta: seededFieldMeta,
  };
}

export function buildCanonicalBlankGuidedTarget(mode = "estimate", state = {}, context = {}) {
  const orderedTarget = chooseLiteralFormOrderGuidedTarget({
    mode,
    state,
    guidedMeta: {},
    context,
  });
  if (orderedTarget?.questionKey) {
    return {
      sectionKey: orderedTarget.sectionKey,
      questionKey: orderedTarget.questionKey,
    };
  }

  const sections = asArray(getGuidedSections(mode));
  const customerSection = sections.find((section) => String(section?.key || "").trim() === "customer");
  const fallbackSection = String(customerSection?.key || getGuidedField("customer.id")?.section || "customer").trim() || "customer";
  return {
    sectionKey: fallbackSection,
    questionKey: "customer.id",
  };
}

export function buildCanonicalBlankGuidedAudit(mode = "estimate", state = {}, context = {}) {
  const target = buildCanonicalBlankGuidedTarget(mode, state, context);
  const primaryMaterialsField = state?.ui?.materialsMode === "itemized"
    ? "materials.items"
    : "materials.blanketCost";
  const unresolvedFields = Array.from(new Set([
    target.questionKey || "customer.id",
    "scopeNotes",
    primaryMaterialsField,
  ])).filter(Boolean);
  const sections = asArray(getGuidedSections(mode)).map((section) => ({
    ...section,
    key: String(section?.key || "").trim(),
    label: String(section?.label || section?.title || section?.key || "").trim() || String(section?.key || "").trim(),
    status: GUIDED_AUDIT_STATUS_MISSING,
  })).filter((section) => section.key);

  return {
    counts: {
      complete: 0,
      inferred: 0,
      needs_confirmation: 0,
      missing: unresolvedFields.length,
    },
    fields: unresolvedFields.map((fieldKey) => buildGuidedAuditFieldEntry({
      key: fieldKey,
      status: GUIDED_AUDIT_STATUS_MISSING,
    })),
    sections,
    unresolvedFields,
    reviewReadiness: {
      ready: false,
      score: 0,
      blockers: [],
      pendingConfirmations: [],
    },
  };
}

export function createCanonicalBlankGuidedState({ mode, state, context, enabled = false }) {
  const target = buildCanonicalBlankGuidedTarget(mode, state, context);
  const normalizedAudit = normalizeGuidedAuditForProgress(buildCanonicalBlankGuidedAudit(mode, state, context), target);
  return {
    enabled,
    isCanonicalBlankDisplay: true,
    currentSection: target.sectionKey,
    currentQuestion: target.questionKey,
    assistantMessage: "",
    suggestedChoices: [],
    activeStepId: target.questionKey ? `${target.sectionKey}:${target.questionKey}` : "",
    activeStepPrompt: "",
    stepOptions: [],
    promptIntent: "",
    expectedAnswerMode: "",
    expectedComponents: [],
    resolvedComponents: [],
    missingComponents: [],
    turnDiagnosis: "",
    repeatedUnresolvedCount: 0,
    nextQuestionReason: "",
    resolutionSource: "",
    reviewReadiness: normalizedAudit?.reviewReadiness || null,
    plannerState: {},
    answeredPrompts: [],
    extractedValues: [],
    pendingConfirmations: [],
    unresolvedRequiredFields: normalizedAudit?.unresolvedFields || [],
    lowConfidenceFields: [],
    skippedFields: [],
    completionAudit: normalizedAudit,
    lastAppliedWrites: [],
    originFlow: mode,
    warnings: [],
    error: "",
    ...blankPendingState(),
    lastResolvedAt: 0,
    reviewOpen: false,
    fieldMeta: {},
  };
}

export function buildCanonicalBlankDisplayState({ mode, state, context, enabled = false }) {
  const freshGuided = createCanonicalBlankGuidedState({ mode, state, context, enabled });
  const preview = previewGuidedBuildTurn({
    mode,
    state,
    sectionKey: freshGuided.currentSection,
    questionKey: freshGuided.currentQuestion,
    answeredPrompts: [],
    guidedMeta: {},
    plannerState: {},
    activeStep: buildActiveStepPayload(freshGuided),
    currentSuggestedChoices: [],
    turnState: {
      repeatedUnresolvedCount: 0,
      turnDiagnosis: "",
    },
    userAnswer: "",
    context,
  });
  return {
    ...buildBootstrapGuidedState(freshGuided, preview, {
      ignorePreviewTargetAudit: true,
    }),
    enabled,
    isCanonicalBlankDisplay: true,
  };
}

export function hasGuidedRuntimeResidue(guidedState = {}) {
  if (!guidedState || typeof guidedState !== "object") return false;
  return Boolean(
    Object.keys(guidedState?.fieldMeta || {}).length
    || Object.keys(guidedState?.plannerState || {}).length
    || asArray(guidedState?.answeredPrompts).length
    || asArray(guidedState?.pendingConfirmations).length
    || asArray(guidedState?.extractedValues).length
    || asArray(guidedState?.lowConfidenceFields).length
    || asArray(guidedState?.skippedFields).length
    || asArray(guidedState?.lastAppliedWrites).length
    || asArray(guidedState?.warnings).length
    || String(guidedState?.error || "").trim()
  );
}

function hasOnlyOptionalClearLeftovers(state = {}) {
  if (!state || typeof state !== "object") return false;
  const hasText = (value) => String(value || "").trim().length > 0;
  return Boolean(
    hasText(state?.additionalNotes)
    || hasText(state?.job?.date)
    || hasText(state?.job?.docNumber)
  );
}

function hasMeaningfulGuidedCollectionEntry(entry = {}, ignoredKeys = []) {
  if (!entry || typeof entry !== "object") return false;
  const ignored = new Set(asArray(ignoredKeys).map((key) => String(key || "").trim()).filter(Boolean));
  return Object.entries(entry).some(([key, value]) => {
    if (ignored.has(String(key || "").trim())) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    if (typeof value === "number") return Number.isFinite(value) && value !== 0;
    if (typeof value === "boolean") return value === true;
    return String(value || "").trim().length > 0;
  });
}

// Returns true if value is a finite number (including 0). Empty string / null / undefined → false.
// Mirrors the hasNumberLike helper in registry.js.
function hasNumberLike(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function hasMeaningfulLaborLines(lines = []) {
  // A labor line only counts as meaningful core draft state when it carries actual
  // pricing data (at least one of hours or rate is a valid number). This matches the
  // isFieldMissing("labor.lines") logic in registry.js and prevents writeback-normalized
  // scaffold rows (which carry label/qty but no pricing) from causing false positives.
  return asArray(lines).some(
    (line) => hasNumberLike(line?.hours) || hasNumberLike(line?.rate)
  );
}

function hasMeaningfulMaterialItems(items = []) {
  // A material item only counts as meaningful core draft state when it carries actual
  // pricing (priceEach or charge). Mirrors isFieldMissing("materials.items") in registry.js.
  return asArray(items).some(
    (item) => hasNumberLike(item?.priceEach || item?.charge)
  );
}

export function hasCoreGuidedDraftState(state = {}) {
  if (!state || typeof state !== "object") return false;
  const hasText = (value) => String(value || "").trim().length > 0;
  return Boolean(
    hasText(state?.customer?.id)
    || hasText(state?.customer?.name)
    || hasText(state?.customer?.projectAddress)
    || hasText(state?.customer?.projectName)
    || hasText(state?.scopeNotes)
    || hasText(state?.tradeInsert?.key)
    || hasMeaningfulLaborLines(state?.labor?.lines)
    || hasMeaningfulMaterialItems(state?.materials?.items)
    || hasText(state?.materials?.blanketCost)
  );
}

function shouldUseCanonicalBlankDisplayState(state = {}, initialFieldMeta = {}, guidedState = {}) {
  if (guidedState?.enabled) return false;
  if (hasCoreGuidedDraftState(state)) return false;
  return hasOnlyOptionalClearLeftovers(state)
    || hasGuidedRuntimeResidue(guidedState)
    || Object.keys(initialFieldMeta || {}).length > 0;
}

function hasMeaningfulDraftState(state = {}) {
  return hasCoreGuidedDraftState(state);
}

function isBlankGuidedBuilderState(state = {}) {
  return !hasMeaningfulDraftState(state);
}

function getCanonicalGuidedFieldMetaForState(state = {}, fieldMeta = {}) {
  if (isBlankGuidedBuilderState(state)) return {};
  return cloneGuidedFieldMeta(fieldMeta);
}

function buildGuidedSeedFieldMeta(state = {}, initialFieldMeta = {}, sessionFieldMeta = {}) {
  if (isBlankGuidedBuilderState(state)) return {};
  return mergeFieldMeta(
    cloneGuidedFieldMeta(initialFieldMeta),
    cloneGuidedFieldMeta(sessionFieldMeta)
  );
}

function buildBlankGuidedSessionState(guidedState = {}, audit = null, canonicalBootstrap = null) {
  if (canonicalBootstrap) {
    return {
      ...canonicalBootstrap,
      enabled: false,
      reviewOpen: false,
      lastAppliedWrites: [],
      warnings: [],
      error: "",
      ...blankPendingState(),
      lastResolvedAt: 0,
    };
  }
  return {
    ...guidedState,
    reviewOpen: false,
    reviewReadiness: audit?.reviewReadiness || null,
    plannerState: {},
    unresolvedRequiredFields: audit?.unresolvedFields || [],
    completionAudit: audit,
    lastAppliedWrites: [],
    warnings: [],
    fieldMeta: {},
    lastResolvedAt: 0,
  };
}

function shouldLockCanonicalBlankGuidedState(guidedState = {}, state = {}) {
  return guidedState?.isCanonicalBlankDisplay === true && isBlankGuidedBuilderState(state);
}

function applyCanonicalBlankGuidedState(surfacedGuided = {}, canonicalBlankGuided = null) {
  if (!canonicalBlankGuided) return surfacedGuided;
  return {
    ...surfacedGuided,
    ...canonicalBlankGuided,
    enabled: surfacedGuided?.enabled === true,
    isCanonicalBlankDisplay: true,
    reviewOpen: false,
  };
}

function resolveGuidedHeaderProgressAudit({
  finalGuided = {},
  liveAudit = null,
  state = {},
  canonicalBlankGuided = null,
  blankBootstrap = null,
  mode = "estimate",
  context = {},
}) {
  if (finalGuided?.enabled === true && isBlankGuidedBuilderState(state)) {
    return canonicalBlankGuided?.completionAudit
      || blankBootstrap?.completionAudit
      || createCanonicalBlankGuidedState({
        mode,
        state,
        context,
        enabled: true,
      }).completionAudit;
  }
  if (finalGuided?.reviewOpen) return finalGuided?.completionAudit || liveAudit;
  if (finalGuided?.isCanonicalBlankDisplay === true) return finalGuided?.completionAudit || liveAudit;
  return liveAudit || finalGuided?.completionAudit || null;
}

function resolveGuidedHeaderProgressSource({
  finalGuided = {},
  state = {},
  headerProgressAudit = null,
  headerProgressPercent = null,
}) {
  if (finalGuided?.isCanonicalBlankDisplay === true && isBlankGuidedBuilderState(state) && hasDefinedGuidedProgressPercent(headerProgressPercent)) {
    return "headerProgressPercent";
  }
  if (headerProgressAudit) return "headerProgressAudit";
  return "completionAudit";
}

function resolveGuidedHeaderProgressMode(finalGuided = {}) {
  return finalGuided?.isCanonicalBlankDisplay === true ? "canonicalBlank" : "normal";
}

function buildFreshGuidedPreviewState({ mode, state, context, initialFieldMeta = {}, baseAudit = null, enabled = false }) {
  const freshGuided = createFreshGuidedState({
    mode,
    state,
    context,
    initialFieldMeta,
    baseAudit,
    enabled,
  });
  const preview = previewGuidedBuildTurn({
    mode,
    state,
    sectionKey: freshGuided.currentSection,
    questionKey: freshGuided.currentQuestion,
    answeredPrompts: [],
    guidedMeta: freshGuided.fieldMeta,
    plannerState: freshGuided.plannerState,
    activeStep: buildActiveStepPayload(freshGuided),
    currentSuggestedChoices: [],
    turnState: {
      repeatedUnresolvedCount: 0,
      turnDiagnosis: "",
    },
    userAnswer: "",
    context,
  });
  return {
    freshGuided,
    preview,
    response: preview?.deterministicResponse,
  };
}

function buildBootstrapGuidedState(freshGuided, preview, options = {}) {
  const next = {
    ...freshGuided,
    ...buildGuidedStateFromPreview(freshGuided, preview, options?.response || preview?.deterministicResponse, {
      fieldMeta: freshGuided.fieldMeta,
      plannerState: freshGuided.plannerState,
      answeredPrompts: [],
      pendingConfirmations: [],
      extractedValues: [],
      lowConfidenceFields: [],
      skippedFields: [],
      lastAppliedWrites: [],
      warnings: [],
      error: "",
      reviewOpen: false,
      reviewReadiness: freshGuided.reviewReadiness,
      completionAudit: freshGuided.completionAudit,
      unresolvedRequiredFields: freshGuided.unresolvedRequiredFields,
      lastResolvedAt: 0,
      resolutionSource: "",
      nextQuestionReason: "",
      resetWarnings: true,
      ignorePreviewTargetAudit: options?.ignorePreviewTargetAudit === true,
    }),
  };
  if (preview?.deterministicResponse?.stepRunnerState?.canonicalStepId) {
    next.activeStepId = preview.deterministicResponse.stepRunnerState.canonicalStepId;
  }
  return next;
}

function buildGuidedStateFromPreview(baseGuided, preview, response, options = {}) {
  const nextTarget = preview?.localTurn?.target || {};
  const recommendedTarget = resolveGuidedRecommendedTarget(
    response,
    nextTarget.sectionKey || preview?.localPayload?.sectionKey || "",
    preview?.localTurn?.questionKey || preview?.localPayload?.questionKey || ""
  );
  const stepState = readStepRunnerState(
    response,
    recommendedTarget.sectionKey || nextTarget.sectionKey || preview?.localPayload?.sectionKey || "",
    recommendedTarget.questionKey || preview?.localTurn?.questionKey || preview?.localPayload?.questionKey || ""
  );
  const nextPlannerState = mergePlannerState(
    options?.plannerState !== undefined ? options.plannerState : baseGuided?.plannerState,
    stepState.plannerState
  );
  const nextFieldMeta = setPlannerState(
    options?.fieldMeta !== undefined ? options.fieldMeta : baseGuided?.fieldMeta,
    nextPlannerState
  );
  const previewTargetAudit = options?.ignorePreviewTargetAudit === true
    ? null
    : (nextTarget.audit || null);
  const repeatedUnresolvedCount = options?.submittedAnswer
    ? deriveRepeatedUnresolvedCount(baseGuided, stepState, options.submittedAnswer)
    : 0;
  return {
    assistantMessage: stepState.activePrompt || response?.assistantMessage || baseGuided?.assistantMessage || "",
    suggestedChoices: stepState.stepOptions,
    activeStepId: stepState.activeStepId,
    activeStepPrompt: stepState.activePrompt || response?.assistantMessage || baseGuided?.activeStepPrompt || "",
    stepOptions: stepState.stepOptions,
    promptIntent: stepState.promptIntent || baseGuided?.promptIntent || "",
    expectedAnswerMode: stepState.expectedAnswerMode || baseGuided?.expectedAnswerMode || "",
    expectedComponents: Array.isArray(stepState.expectedComponents) ? stepState.expectedComponents : (baseGuided?.expectedComponents || []),
    resolvedComponents: Array.isArray(stepState.resolvedComponents) ? stepState.resolvedComponents : (baseGuided?.resolvedComponents || []),
    missingComponents: Array.isArray(stepState.missingComponents) ? stepState.missingComponents : (baseGuided?.missingComponents || []),
    turnDiagnosis: stepState.turnDiagnosis || "",
    repeatedUnresolvedCount,
    nextQuestionReason: stepState.nextQuestionReason || options?.nextQuestionReason || baseGuided?.nextQuestionReason || "",
    resolutionSource: stepState.resolutionSource || options?.resolutionSource || baseGuided?.resolutionSource || "",
    reviewReadiness: previewTargetAudit?.reviewReadiness || options?.reviewReadiness || baseGuided?.reviewReadiness || null,
    plannerState: nextPlannerState,
    fieldMeta: nextFieldMeta,
    warnings: response?.warnings ?? (options?.resetWarnings ? [] : (options?.warnings ?? baseGuided?.warnings ?? [])),
    error: options?.error ?? "",
    reviewOpen: options?.reviewOpen ?? false,
    currentSection: stepState.activeSectionKey || recommendedTarget.sectionKey,
    currentQuestion: stepState.activeFieldKey || recommendedTarget.questionKey,
    completionAudit: previewTargetAudit || options?.completionAudit || baseGuided?.completionAudit,
    unresolvedRequiredFields: previewTargetAudit?.unresolvedFields || options?.unresolvedRequiredFields || baseGuided?.unresolvedRequiredFields || [],
    answeredPrompts: options?.answeredPrompts ?? baseGuided?.answeredPrompts ?? [],
    pendingConfirmations: options?.pendingConfirmations ?? baseGuided?.pendingConfirmations ?? [],
    extractedValues: options?.extractedValues ?? baseGuided?.extractedValues ?? [],
    lowConfidenceFields: options?.lowConfidenceFields ?? baseGuided?.lowConfidenceFields ?? [],
    skippedFields: options?.skippedFields ?? baseGuided?.skippedFields ?? [],
    lastAppliedWrites: options?.lastAppliedWrites ?? baseGuided?.lastAppliedWrites ?? [],
    lastResolvedAt: options?.lastResolvedAt ?? baseGuided?.lastResolvedAt ?? 0,
    ...blankPendingState(),
  };
}

export function useGuidedBuild(options = {}) {
  const {
    state,
    patch,
    mode = "estimate",
    context = {},
    onSelectCustomer,
  } = options;

  const requestSeqRef = useRef(0);
  const activeRequestRef = useRef({ id: 0, key: "" });
  const initialFieldMeta = options?.initialFieldMeta && typeof options.initialFieldMeta === "object"
    ? options.initialFieldMeta
    : {};
  const builderIsBlank = useMemo(() => isBlankGuidedBuilderState(state), [state]);
  const canonicalInitialFieldMeta = useMemo(
    () => getCanonicalGuidedFieldMetaForState(state, initialFieldMeta),
    [initialFieldMeta, state]
  );
  const baseAudit = useMemo(
    () => normalizeGuidedAuditForProgress(
      buildGuidedAudit({ mode, state, guidedMeta: canonicalInitialFieldMeta, context }),
      chooseNextGuidedTarget({ mode, state, guidedMeta: canonicalInitialFieldMeta, context })
    ),
    [canonicalInitialFieldMeta, context, mode, state]
  );

  const [guided, setGuided] = useState(() => createFreshGuidedState({
    mode,
    state,
    context,
    initialFieldMeta: canonicalInitialFieldMeta,
    baseAudit,
    enabled: false,
  }));

  const recalcFromState = useCallback((nextState, nextFieldMeta, preferredSection = "") => {
    const canonicalFieldMeta = getCanonicalGuidedFieldMetaForState(nextState, nextFieldMeta);
    const target = chooseNextGuidedTarget({
      mode,
      state: nextState,
      guidedMeta: canonicalFieldMeta,
      preferredSection,
      context,
    });
    const audit = normalizeGuidedAuditForProgress(
      target.audit || buildGuidedAudit({ mode, state: nextState, guidedMeta: canonicalFieldMeta, context }),
      target
    );
    return {
      currentSection: target.sectionKey,
      currentQuestion: target.questionKey,
      completionAudit: audit,
      unresolvedRequiredFields: audit.unresolvedFields || [],
    };
  }, [context, mode]);

  const invalidateActiveRequest = useCallback(() => {
    requestSeqRef.current += 1;
    activeRequestRef.current = { id: 0, key: "" };
  }, []);

  const applyPromptPreview = useCallback((preview, options = {}) => {
    const response = options?.response || preview?.deterministicResponse;
    setGuided((prev) => {
      const nextState = {
        ...prev,
        ...buildGuidedStateFromPreview(prev, preview, response, {
          answeredPrompts: options?.answeredPrompt
            ? appendAnsweredPrompt(prev.answeredPrompts, options.answeredPrompt)
            : prev.answeredPrompts,
          submittedAnswer: options?.answeredPrompt?.answer || "",
          resetWarnings: !!options?.resetWarnings,
          reviewOpen: false,
          error: "",
        }),
      };
      return withVisibleGuidedTransition(prev, nextState, {
        submittedAnswer: options?.answeredPrompt?.answer || "",
      });
    });
  }, []);

  const syncGuidedRunnerStep = useCallback((options = {}) => {
    const liveState = options?.liveState || state;
    const blankBuilderState = isBlankGuidedBuilderState(liveState);
    const shouldResetBlankSession = blankBuilderState && !guided.enabled;
    const nextFieldMeta = shouldResetBlankSession
      ? {}
      : cloneGuidedFieldMeta(
        options?.fieldMeta && typeof options.fieldMeta === "object"
          ? options.fieldMeta
          : {}
      );
    const nextPlannerState = shouldResetBlankSession
      ? {}
      : (options?.plannerState && typeof options.plannerState === "object"
        ? options.plannerState
        : getGuidedPlannerState(nextFieldMeta));
    if (shouldResetBlankSession) {
      const blankAudit = normalizeGuidedAuditForProgress(
        buildGuidedAudit({ mode, state: liveState, guidedMeta: nextFieldMeta, context }),
        chooseNextGuidedTarget({ mode, state: liveState, guidedMeta: nextFieldMeta, context })
      );
      const { freshGuided, preview, response } = buildFreshGuidedPreviewState({
        mode,
        state: liveState,
        context,
        initialFieldMeta: nextFieldMeta,
        baseAudit: blankAudit,
        enabled: options?.enabled ?? guided.enabled,
      });
      invalidateActiveRequest();
      setGuided((prev) => ({
        ...prev,
        ...freshGuided,
        ...buildGuidedStateFromPreview(freshGuided, preview, response, {
          fieldMeta: freshGuided.fieldMeta,
          plannerState: freshGuided.plannerState,
          answeredPrompts: [],
          pendingConfirmations: [],
          extractedValues: [],
          lowConfidenceFields: [],
          skippedFields: [],
          lastAppliedWrites: [],
          warnings: [],
          error: "",
          reviewOpen: false,
          reviewReadiness: freshGuided.reviewReadiness,
          completionAudit: freshGuided.completionAudit,
          unresolvedRequiredFields: freshGuided.unresolvedRequiredFields,
          lastResolvedAt: 0,
          resolutionSource: "",
          nextQuestionReason: "",
          resetWarnings: true,
        }),
      }));
      return;
    }
    const target = chooseNextGuidedTarget({
      mode,
      state: liveState,
      guidedMeta: nextFieldMeta,
      context,
    });
    const targetAudit = normalizeGuidedAuditForProgress(target.audit, target);
    const preview = previewGuidedBuildTurn({
      mode,
      state: liveState,
      sectionKey: target.sectionKey,
      questionKey: target.questionKey,
      answeredPrompts: Array.isArray(options?.answeredPrompts) ? options.answeredPrompts : [],
      guidedMeta: nextFieldMeta,
      plannerState: nextPlannerState,
      activeStep: buildActiveStepPayload({
        currentSection: target.sectionKey,
        currentQuestion: target.questionKey,
        plannerState: nextPlannerState,
      }),
      currentSuggestedChoices: [],
      turnState: {
        repeatedUnresolvedCount: 0,
        turnDiagnosis: "",
      },
      userAnswer: "",
      context,
    });
    const response = preview.deterministicResponse;
    invalidateActiveRequest();
    setGuided((prev) => {
      const baseGuided = {
        ...prev,
        fieldMeta: nextFieldMeta,
        plannerState: nextPlannerState,
        currentSection: target.sectionKey,
        currentQuestion: target.questionKey,
        completionAudit: targetAudit || prev.completionAudit,
        reviewReadiness: targetAudit?.reviewReadiness || prev.reviewReadiness,
        unresolvedRequiredFields: targetAudit?.unresolvedFields || prev.unresolvedRequiredFields,
        answeredPrompts: Array.isArray(options?.answeredPrompts) ? options.answeredPrompts : prev.answeredPrompts,
        pendingConfirmations: Array.isArray(options?.pendingConfirmations) ? options.pendingConfirmations : prev.pendingConfirmations,
        extractedValues: Array.isArray(options?.extractedValues) ? options.extractedValues : prev.extractedValues,
        lowConfidenceFields: Array.isArray(options?.lowConfidenceFields) ? options.lowConfidenceFields : prev.lowConfidenceFields,
        skippedFields: Array.isArray(options?.skippedFields) ? options.skippedFields : prev.skippedFields,
        lastAppliedWrites: Array.isArray(options?.lastAppliedWrites) ? options.lastAppliedWrites : prev.lastAppliedWrites,
        warnings: Array.isArray(options?.warnings) ? options.warnings : prev.warnings,
        error: options?.error ?? "",
        reviewOpen: options?.reviewOpen === true,
        resolutionSource: options?.resolutionSource || prev.resolutionSource,
        lastResolvedAt: options?.lastResolvedAt ?? prev.lastResolvedAt,
      };
      const builtState = {
        ...prev,
        ...buildGuidedStateFromPreview(baseGuided, preview, response, {
          fieldMeta: nextFieldMeta,
          plannerState: nextPlannerState,
          answeredPrompts: baseGuided.answeredPrompts,
          pendingConfirmations: baseGuided.pendingConfirmations,
          extractedValues: baseGuided.extractedValues,
          lowConfidenceFields: baseGuided.lowConfidenceFields,
          skippedFields: baseGuided.skippedFields,
          lastAppliedWrites: baseGuided.lastAppliedWrites,
          warnings: baseGuided.warnings,
          error: baseGuided.error,
          reviewOpen: baseGuided.reviewOpen,
          resolutionSource: baseGuided.resolutionSource,
          reviewReadiness: baseGuided.reviewReadiness,
          completionAudit: baseGuided.completionAudit,
          unresolvedRequiredFields: baseGuided.unresolvedRequiredFields,
          lastResolvedAt: baseGuided.lastResolvedAt,
          resetWarnings: options?.resetWarnings === true,
        }),
      };

      if (options?.resolvedTurn === true && isSameVisibleGuidedTurn(prev, builtState)) {
        const nextSection = findNextReviewSection(mode, prev.currentSection);
        const fallbackTarget = chooseNextGuidedTarget({
          mode,
          state: liveState,
          guidedMeta: nextFieldMeta,
          preferredSection: nextSection,
          context,
        });
        const fallbackAudit = normalizeGuidedAuditForProgress(fallbackTarget.audit, fallbackTarget);
        const fallbackPreview = previewGuidedBuildTurn({
          mode,
          state: liveState,
          sectionKey: fallbackTarget.sectionKey,
          questionKey: fallbackTarget.questionKey,
          answeredPrompts: baseGuided.answeredPrompts,
          guidedMeta: nextFieldMeta,
          plannerState: nextPlannerState,
          activeStep: buildActiveStepPayload({
            currentSection: fallbackTarget.sectionKey,
            currentQuestion: fallbackTarget.questionKey,
            plannerState: nextPlannerState,
          }),
          currentSuggestedChoices: [],
          turnState: {
            repeatedUnresolvedCount: 0,
            turnDiagnosis: "",
          },
          userAnswer: "",
          context,
        });
        const fallbackResponse = fallbackPreview.deterministicResponse;
        const recoveredState = {
          ...prev,
          ...buildGuidedStateFromPreview(baseGuided, fallbackPreview, fallbackResponse, {
            fieldMeta: nextFieldMeta,
            plannerState: nextPlannerState,
            answeredPrompts: baseGuided.answeredPrompts,
            pendingConfirmations: baseGuided.pendingConfirmations,
            extractedValues: baseGuided.extractedValues,
            lowConfidenceFields: baseGuided.lowConfidenceFields,
            skippedFields: baseGuided.skippedFields,
            lastAppliedWrites: baseGuided.lastAppliedWrites,
            warnings: baseGuided.warnings,
            error: baseGuided.error,
            reviewOpen: baseGuided.reviewOpen,
            resolutionSource: baseGuided.resolutionSource,
            reviewReadiness: fallbackAudit?.reviewReadiness || baseGuided.reviewReadiness,
            completionAudit: fallbackAudit || baseGuided.completionAudit,
            unresolvedRequiredFields: fallbackAudit?.unresolvedFields || baseGuided.unresolvedRequiredFields,
            lastResolvedAt: baseGuided.lastResolvedAt,
            resetWarnings: options?.resetWarnings === true,
          }),
        };
        return recoveredState;
      }

      return withVisibleGuidedTransition(prev, builtState, {
        submittedAnswer: options?.submittedAnswer || "",
      });
    });
  }, [context, guided.enabled, invalidateActiveRequest, mode, state]);

  const submitResolvedTurn = useCallback(async (response, meta = {}) => {
    const currentState = meta?.optimisticState || state;
    const writeResult = applyGuidedWrites({
      state: currentState,
      writes: response,
      context,
    });

    const appliedDescriptions = applyGuidedOperations({
      operations: writeResult.applied,
      patch,
      onSelectCustomer,
    });

    const optimisticState = simulateGuidedOperations(currentState, writeResult.applied, context);
    const stepState = readStepRunnerState(
      response,
      response.recommendedNextSection || meta?.sectionKey || guided.currentSection,
      response.recommendedNextQuestion || meta?.questionKey || guided.currentQuestion
    );
    const nextPlannerState = mergePlannerState(guided.plannerState, stepState.plannerState);
    const nextFieldMeta = mergeFieldMeta(
      guided.fieldMeta,
      mergeFieldMeta(writeResult.fieldMeta, buildConfirmationMeta(writeResult.confirmations))
    );
    const fieldMetaWithPlanner = setPlannerState(nextFieldMeta, nextPlannerState);
    const recalculated = recalcFromState(
      optimisticState,
      fieldMetaWithPlanner,
      response.recommendedNextSection || meta?.sectionKey || guided.currentSection
    );
    const recommendedTarget = resolveGuidedRecommendedTarget(
      response,
      recalculated.currentSection,
      recalculated.currentQuestion
    );
    const nextAnsweredPrompts = meta?.userAnswer
      ? appendAnsweredPrompt(guided.answeredPrompts, {
        sectionKey: meta.sectionKey,
        questionKey: meta.questionKey,
        prompt: meta.prompt,
        answer: meta.userAnswer,
      })
      : guided.answeredPrompts;
    const nextPendingConfirmations = [
      ...guided.pendingConfirmations.filter((item) => !(response.fieldsNeedingConfirmation || []).includes(item.fieldKey)),
      ...writeResult.confirmations,
    ];
    const nextLowConfidenceFields = (response.extractedFieldValues || [])
      .filter((item) => Number(item?.confidence || 0) < 0.7)
      .map((item) => item.key);
    const nextWarnings = [
      ...(response.warnings || []),
      ...summarizeBlockedWrites(writeResult.blocked).map((item) => `${item.label}: ${item.reason}`),
    ];

    if (!writeResult.confirmations.length) {
      syncGuidedRunnerStep({
        liveState: optimisticState,
        fieldMeta: fieldMetaWithPlanner,
        plannerState: nextPlannerState,
        answeredPrompts: nextAnsweredPrompts,
        pendingConfirmations: nextPendingConfirmations,
        extractedValues: response.extractedFieldValues || [],
        lowConfidenceFields: nextLowConfidenceFields,
        skippedFields: guided.skippedFields,
        lastAppliedWrites: appliedDescriptions,
        warnings: nextWarnings,
        resolutionSource: stepState.resolutionSource || "local",
        lastResolvedAt: Date.now(),
        submittedAnswer: meta?.userAnswer || "",
        resolvedTurn: true,
        reviewOpen: false,
      });
      return;
    }

    setGuided((prev) => ({
      ...prev,
      answeredPrompts: nextAnsweredPrompts,
      extractedValues: response.extractedFieldValues || [],
      pendingConfirmations: nextPendingConfirmations,
      lowConfidenceFields: nextLowConfidenceFields,
      fieldMeta: fieldMetaWithPlanner,
      plannerState: nextPlannerState,
      lastAppliedWrites: appliedDescriptions,
      currentSection: stepState.activeSectionKey || recommendedTarget.sectionKey,
      currentQuestion: stepState.activeFieldKey || recommendedTarget.questionKey,
      completionAudit: recalculated.completionAudit,
      unresolvedRequiredFields: recalculated.unresolvedRequiredFields,
      reviewReadiness: recalculated.completionAudit?.reviewReadiness || prev.reviewReadiness,
      warnings: nextWarnings,
      assistantMessage: "Review the sensitive builder changes below before I carry them forward.",
      activeStepId: stepState.activeStepId,
      activeStepPrompt: "Review the sensitive builder changes below before I carry them forward.",
      stepOptions: stepState.stepOptions,
      suggestedChoices: stepState.stepOptions,
      promptIntent: stepState.promptIntent || prev.promptIntent,
      expectedAnswerMode: stepState.expectedAnswerMode || prev.expectedAnswerMode,
      expectedComponents: Array.isArray(stepState.expectedComponents) ? stepState.expectedComponents : prev.expectedComponents,
      resolvedComponents: Array.isArray(stepState.resolvedComponents) ? stepState.resolvedComponents : prev.resolvedComponents,
      missingComponents: Array.isArray(stepState.missingComponents) ? stepState.missingComponents : prev.missingComponents,
      turnDiagnosis: "blocked_by_confirmation",
      repeatedUnresolvedCount: 0,
      nextQuestionReason: stepState.nextQuestionReason || prev.nextQuestionReason,
      resolutionSource: stepState.resolutionSource || prev.resolutionSource,
      lastResolvedAt: Date.now(),
      ...blankPendingState(),
    }));
  }, [context, guided.answeredPrompts, guided.currentQuestion, guided.currentSection, guided.fieldMeta, guided.pendingConfirmations, guided.plannerState, guided.skippedFields, onSelectCustomer, patch, recalcFromState, state, syncGuidedRunnerStep]);

  const refreshPrompt = useCallback(async (override = {}) => {
    const blankBuilderState = isBlankGuidedBuilderState(state);
    if (blankBuilderState && !guided.enabled) {
      const blankTarget = chooseNextGuidedTarget({ mode, state, guidedMeta: {}, context });
      const blankAudit = normalizeGuidedAuditForProgress(
        buildGuidedAudit({ mode, state, guidedMeta: {}, context }),
        blankTarget
      );
      const { freshGuided, preview, response } = buildFreshGuidedPreviewState({
        mode,
        state,
        context,
        initialFieldMeta: {},
        baseAudit: blankAudit,
        enabled: guided.enabled,
      });
      invalidateActiveRequest();
      setGuided((prev) => ({
        ...prev,
        ...freshGuided,
        ...buildGuidedStateFromPreview(freshGuided, preview, response, {
          fieldMeta: freshGuided.fieldMeta,
          plannerState: freshGuided.plannerState,
          answeredPrompts: [],
          pendingConfirmations: [],
          extractedValues: [],
          lowConfidenceFields: [],
          skippedFields: [],
          lastAppliedWrites: [],
          warnings: [],
          error: "",
          reviewOpen: false,
          reviewReadiness: freshGuided.reviewReadiness,
          completionAudit: freshGuided.completionAudit,
          unresolvedRequiredFields: freshGuided.unresolvedRequiredFields,
          lastResolvedAt: 0,
          resolutionSource: "",
          nextQuestionReason: "",
          resetWarnings: true,
        }),
      }));
      return;
    }
    const sectionKey = override?.sectionKey || guided.currentSection || "customer";
    const questionKey = override?.questionKey || guided.currentQuestion || "";
    const liveFieldMeta = builderIsBlank && !guided.enabled
      ? {}
      : cloneGuidedFieldMeta(guided.fieldMeta);
    const livePlannerState = getGuidedPlannerState(liveFieldMeta);
    invalidateActiveRequest();
    const preview = previewGuidedBuildTurn({
      mode,
      state,
      sectionKey,
      questionKey,
      answeredPrompts: guided.answeredPrompts,
      guidedMeta: liveFieldMeta,
      plannerState: livePlannerState,
      activeStep: buildActiveStepPayload({
        ...guided,
        currentSection: sectionKey,
        currentQuestion: questionKey,
        plannerState: livePlannerState,
      }),
      currentSuggestedChoices: questionKey === guided.currentQuestion ? guided.suggestedChoices : [],
      turnState: {
        repeatedUnresolvedCount: questionKey === guided.currentQuestion ? guided.repeatedUnresolvedCount : 0,
        turnDiagnosis: questionKey === guided.currentQuestion ? guided.turnDiagnosis : "",
      },
      userAnswer: "",
      context,
    });
    applyPromptPreview(preview, { resetWarnings: !!override?.resetWarnings });
  }, [applyPromptPreview, context, guided.answeredPrompts, guided.currentQuestion, guided.currentSection, guided.fieldMeta, guided.plannerState, invalidateActiveRequest, mode, state]);

  const closeGuided = useCallback(() => {
    const freshGuided = createFreshGuidedState({
      mode,
      state,
      context,
      initialFieldMeta: canonicalInitialFieldMeta,
      baseAudit,
      enabled: false,
    });
    invalidateActiveRequest();
    setGuided((prev) => ({
      ...prev,
      ...freshGuided,
    }));
  }, [baseAudit, canonicalInitialFieldMeta, context, invalidateActiveRequest, mode, state]);

  const submitAnswer = useCallback(async (answer) => {
    const text = String(answer || "").trim();
    if (!guided.enabled) return;
    if (!text && !guided.currentQuestion) return;
    const payload = {
      mode,
      state,
      sectionKey: guided.currentSection,
      questionKey: guided.currentQuestion,
      currentPrompt: guided.assistantMessage,
      userAnswer: text,
      answeredPrompts: guided.answeredPrompts,
      guidedMeta: guided.fieldMeta,
      plannerState: guided.plannerState,
      activeStep: buildActiveStepPayload(guided),
      currentSuggestedChoices: guided.suggestedChoices,
      turnState: {
        repeatedUnresolvedCount: guided.repeatedUnresolvedCount,
        turnDiagnosis: guided.turnDiagnosis,
      },
      context,
    };
    const preview = previewGuidedBuildTurn(payload);

    if (!preview.requiresAI) {
      if (preview.deterministicResponse.extractedFieldValues?.length) {
        await submitResolvedTurn(preview.deterministicResponse, {
          sectionKey: guided.currentSection,
          questionKey: guided.currentQuestion,
          prompt: guided.assistantMessage,
          userAnswer: text,
        });
        return;
      }

      applyPromptPreview(preview, {
        answeredPrompt: {
          sectionKey: guided.currentSection,
          questionKey: guided.currentQuestion,
          prompt: guided.assistantMessage,
          answer: text,
        },
      });
      return;
    }

    if (activeRequestRef.current.key && activeRequestRef.current.key === preview.requestKey) {
      return;
    }

    const requestId = ++requestSeqRef.current;
    activeRequestRef.current = { id: requestId, key: preview.requestKey };

    setGuided((prev) => ({
      ...prev,
      error: "",
      warnings: [],
      reviewOpen: false,
      isLoading: true,
      isThinking: true,
      pendingRequestId: requestId,
      pendingRequestKey: preview.requestKey,
      pendingStepKey: preview.localTurn?.questionKey || guided.currentQuestion,
      pendingSectionKey: preview.localTurn?.target?.sectionKey || guided.currentSection,
    }));

    const response = await requestGuidedBuildTurn(payload, preview);
    if (activeRequestRef.current.id !== requestId || activeRequestRef.current.key !== preview.requestKey) return;
    activeRequestRef.current = { id: 0, key: "" };

    if (response.extractedFieldValues?.length) {
      await submitResolvedTurn(response, {
        sectionKey: guided.currentSection,
        questionKey: guided.currentQuestion,
        prompt: guided.assistantMessage,
        userAnswer: text,
      });
      return;
    }

    const stepState = readStepRunnerState(
      response,
      response.recommendedNextSection || guided.currentSection,
      response.recommendedNextQuestion || guided.currentQuestion
    );
    const fieldMetaWithPlanner = setPlannerState(guided.fieldMeta, stepState.plannerState);
    const nextTarget = chooseNextGuidedTarget({
      mode,
      state,
      guidedMeta: fieldMetaWithPlanner,
      preferredSection: response.recommendedNextSection || guided.currentSection,
      context,
    });
    const nextAudit = normalizeGuidedAuditForProgress(nextTarget.audit, nextTarget);
    const recommendedTarget = resolveGuidedRecommendedTarget(
      response,
      nextTarget.sectionKey,
      nextTarget.questionKey
    );

    setGuided((prev) => {
      const nextState = {
        ...prev,
        assistantMessage: stepState.activePrompt || response.assistantMessage || prev.assistantMessage,
        suggestedChoices: stepState.stepOptions,
        activeStepId: stepState.activeStepId,
        activeStepPrompt: stepState.activePrompt || response.assistantMessage || prev.activeStepPrompt,
        stepOptions: stepState.stepOptions,
        promptIntent: stepState.promptIntent || prev.promptIntent,
        expectedAnswerMode: stepState.expectedAnswerMode || prev.expectedAnswerMode,
        expectedComponents: Array.isArray(stepState.expectedComponents) ? stepState.expectedComponents : prev.expectedComponents,
        resolvedComponents: Array.isArray(stepState.resolvedComponents) ? stepState.resolvedComponents : prev.resolvedComponents,
        missingComponents: Array.isArray(stepState.missingComponents) ? stepState.missingComponents : prev.missingComponents,
        turnDiagnosis: stepState.turnDiagnosis || "",
        repeatedUnresolvedCount: deriveRepeatedUnresolvedCount(prev, stepState, text),
        nextQuestionReason: stepState.nextQuestionReason || prev.nextQuestionReason,
        resolutionSource: stepState.resolutionSource || prev.resolutionSource,
        plannerState: mergePlannerState(prev.plannerState, stepState.plannerState),
        fieldMeta: fieldMetaWithPlanner,
        answeredPrompts: appendAnsweredPrompt(prev.answeredPrompts, {
          sectionKey: guided.currentSection,
          questionKey: guided.currentQuestion,
          prompt: guided.assistantMessage,
          answer: text,
        }),
        warnings: response.warnings || [],
        error: "",
        currentSection: stepState.activeSectionKey || recommendedTarget.sectionKey,
        currentQuestion: stepState.activeFieldKey || recommendedTarget.questionKey,
        completionAudit: nextAudit || prev.completionAudit,
        reviewReadiness: nextAudit?.reviewReadiness || prev.reviewReadiness,
        unresolvedRequiredFields: nextAudit?.unresolvedFields || prev.unresolvedRequiredFields,
        ...blankPendingState(),
      };
      return withVisibleGuidedTransition(prev, nextState, { submittedAnswer: text });
    });
  }, [applyPromptPreview, context, guided.answeredPrompts, guided.assistantMessage, guided.currentQuestion, guided.currentSection, guided.enabled, guided.fieldMeta, guided.plannerState, guided.repeatedUnresolvedCount, guided.suggestedChoices, guided.turnDiagnosis, mode, state, submitResolvedTurn]);

  const selectChoice = useCallback(async (choice) => {
    if (guided.isThinking) return;
    if (!choice) return;
    if (isDirectChoiceWriteSafe(choice, guided)) {
      const response = {
        assistantMessage: "",
        suggestedChoices: [],
        extractedFieldValues: [{
          key: choice.fieldKey,
          value: choice.value,
          confidence: 1,
          source: "user_choice",
          reason: "",
        }],
        confidenceByField: { [choice.fieldKey]: 1 },
        fieldsNeedingConfirmation: [],
        unresolvedFields: [],
        recommendedNextSection: guided.currentSection,
        recommendedNextQuestion: "",
        reasoningTags: ["choice"],
        warnings: [],
      };
      await submitResolvedTurn(response, {
        sectionKey: guided.currentSection,
        questionKey: guided.currentQuestion,
        prompt: guided.assistantMessage,
        userAnswer: String(choice.label || choice.value || ""),
      });
      return;
    }

    await submitAnswer(String(choice.label || choice.value || ""));
  }, [guided.assistantMessage, guided.currentQuestion, guided.currentSection, guided.isThinking, submitAnswer, submitResolvedTurn]);

  const openReview = useCallback(() => {
    if (guided.isThinking) return;
    if (guided.pendingConfirmations.length) {
      setGuided((prev) => ({
        ...prev,
        warnings: prev.warnings.includes("Finish the item above first, then review the estimate.")
          ? prev.warnings
          : ["Finish the item above first, then review the estimate.", ...prev.warnings],
      }));
      return;
    }
    const rawAudit = buildGuidedAudit({
      mode,
      state,
      guidedMeta: guided.fieldMeta,
      context,
    });
    const audit = normalizeGuidedAuditForProgress(rawAudit, {
      sectionKey: "review",
      questionKey: "job.docNumber",
    });
    setGuided((prev) => ({
      ...prev,
      reviewOpen: true,
      completionAudit: audit,
      reviewReadiness: audit?.reviewReadiness || prev.reviewReadiness,
      unresolvedRequiredFields: audit.unresolvedFields || [],
      currentSection: "review",
      currentQuestion: "job.docNumber",
      activeStepId: "review:job.docNumber",
      activeStepPrompt: "Check what is in place, then finish the estimate in the builder.",
      stepOptions: [],
      nextQuestionReason: "review_handoff",
      resolutionSource: prev.resolutionSource,
    }));
  }, [context, guided.fieldMeta, guided.isThinking, guided.pendingConfirmations.length, mode, state]);

  const jumpToSection = useCallback(async (sectionKey) => {
    if (guided.isThinking) return;
    const target = chooseNextGuidedTarget({
      mode,
      state,
      guidedMeta: guided.fieldMeta,
      preferredSection: sectionKey,
      context,
    });
    const targetAudit = normalizeGuidedAuditForProgress(target.audit, target);
    setGuided((prev) => ({
      ...prev,
      reviewOpen: false,
      currentSection: target.sectionKey,
      currentQuestion: target.questionKey,
      activeStepId: target.questionKey ? `${target.sectionKey}:${target.questionKey}` : prev.activeStepId,
      completionAudit: targetAudit,
      reviewReadiness: targetAudit?.reviewReadiness || prev.reviewReadiness,
      unresolvedRequiredFields: targetAudit?.unresolvedFields || [],
    }));
    await refreshPrompt({ sectionKey: target.sectionKey, questionKey: target.questionKey });
  }, [context, guided.fieldMeta, guided.isThinking, mode, refreshPrompt, state]);

  const skipCurrent = useCallback(async () => {
    if (guided.isThinking) return;
    const fieldKey = guided.currentQuestion;
    const nextSection = findNextReviewSection(mode, guided.currentSection);
    const nextTarget = chooseNextGuidedTarget({
      mode,
      state,
      guidedMeta: guided.fieldMeta,
      preferredSection: nextSection,
      context,
    });
    const nextTargetAudit = normalizeGuidedAuditForProgress(nextTarget.audit, nextTarget);
    setGuided((prev) => ({
      ...prev,
      skippedFields: fieldKey ? [...prev.skippedFields, fieldKey] : prev.skippedFields,
      currentSection: nextTarget.sectionKey,
      currentQuestion: nextTarget.questionKey,
      activeStepId: nextTarget.questionKey ? `${nextTarget.sectionKey}:${nextTarget.questionKey}` : prev.activeStepId,
      completionAudit: nextTargetAudit,
      reviewReadiness: nextTargetAudit?.reviewReadiness || prev.reviewReadiness,
      unresolvedRequiredFields: nextTargetAudit?.unresolvedFields || [],
      resolutionSource: "deferred",
      plannerState: mergePlannerState(prev.plannerState, {
        lastAnsweredFieldKey: fieldKey,
        lastResolutionSource: "deferred",
      }),
      fieldMeta: setPlannerState(prev.fieldMeta, {
        lastAnsweredFieldKey: fieldKey,
        lastResolutionSource: "deferred",
      }),
    }));
    await refreshPrompt({ sectionKey: nextTarget.sectionKey, questionKey: nextTarget.questionKey });
  }, [context, guided.currentQuestion, guided.currentSection, guided.fieldMeta, guided.isThinking, mode, refreshPrompt, state]);

  const confirmPending = useCallback((confirmationId) => {
    if (guided.isThinking) return;
    const target = guided.pendingConfirmations.find((item) => item.id === confirmationId);
    if (!target) return;
    const applied = applyGuidedOperations({
      operations: [target.operation],
      patch,
      onSelectCustomer,
    });
    const optimisticState = simulateGuidedOperations(state, [target.operation], context);
    const nextPlannerState = mergePlannerState(guided.plannerState, {
      lastAnsweredFieldKey: target.fieldKey,
      lastResolutionSource: "confirmation",
    });
    const nextFieldMeta = mergeFieldMeta(guided.fieldMeta, {
      [target.fieldKey]: {
        source: target.source || "ai",
        confidence: Number(target.confidence || 0),
        pendingConfirmation: false,
        confirmed: true,
      },
    });
    const fieldMetaWithPlanner = setPlannerState(nextFieldMeta, nextPlannerState);
    const pendingConfirmations = guided.pendingConfirmations.filter((item) => item.id !== confirmationId);
    const warnings = pendingConfirmations.length
      ? guided.warnings
      : guided.warnings.filter((entry) => entry !== "Finish the item above first, then review the estimate.");
    syncGuidedRunnerStep({
      liveState: optimisticState,
      fieldMeta: fieldMetaWithPlanner,
      plannerState: nextPlannerState,
      answeredPrompts: guided.answeredPrompts,
      pendingConfirmations,
      extractedValues: guided.extractedValues,
      lowConfidenceFields: guided.lowConfidenceFields,
      skippedFields: guided.skippedFields,
      lastAppliedWrites: applied,
      warnings,
      resolutionSource: "confirmation",
      lastResolvedAt: Date.now(),
      resolvedTurn: true,
      reviewOpen: false,
    });
  }, [context, guided.answeredPrompts, guided.extractedValues, guided.fieldMeta, guided.isThinking, guided.lowConfidenceFields, guided.pendingConfirmations, guided.plannerState, guided.skippedFields, guided.warnings, onSelectCustomer, patch, state, syncGuidedRunnerStep]);

  const rejectPending = useCallback((confirmationId) => {
    if (guided.isThinking) return;
    const target = guided.pendingConfirmations.find((item) => item.id === confirmationId);
    if (!target) return;
    const nextPlannerState = mergePlannerState(guided.plannerState, {
      lastAnsweredFieldKey: target.fieldKey,
      lastResolutionSource: "confirmation_rejected",
    });
    const nextFieldMeta = mergeFieldMeta(guided.fieldMeta, {
      [target.fieldKey]: {
        source: "manual",
        confidence: 1,
        pendingConfirmation: false,
        confirmed: true,
      },
    });
    const fieldMetaWithPlanner = setPlannerState(nextFieldMeta, nextPlannerState);
    const pendingConfirmations = guided.pendingConfirmations.filter((item) => item.id !== confirmationId);
    const warnings = pendingConfirmations.length
      ? guided.warnings
      : guided.warnings.filter((entry) => entry !== "Finish the item above first, then review the estimate.");
    syncGuidedRunnerStep({
      liveState: state,
      fieldMeta: fieldMetaWithPlanner,
      plannerState: nextPlannerState,
      answeredPrompts: guided.answeredPrompts,
      pendingConfirmations,
      extractedValues: guided.extractedValues,
      lowConfidenceFields: guided.lowConfidenceFields,
      skippedFields: guided.skippedFields,
      lastAppliedWrites: [],
      warnings,
      resolutionSource: "confirmation_rejected",
      lastResolvedAt: Date.now(),
      resolvedTurn: true,
      reviewOpen: false,
    });
  }, [guided.answeredPrompts, guided.extractedValues, guided.fieldMeta, guided.isThinking, guided.lowConfidenceFields, guided.pendingConfirmations, guided.plannerState, guided.skippedFields, guided.warnings, state, syncGuidedRunnerStep]);

  const liveGuidedFieldMeta = useMemo(
    () => (builderIsBlank && !guided.enabled ? {} : cloneGuidedFieldMeta(guided.fieldMeta)),
    [builderIsBlank, guided.enabled, guided.fieldMeta]
  );

  const hasCoreDraftContent = useMemo(() => hasCoreGuidedDraftState(state), [state]);
  const hasOptionalClearLeftovers = useMemo(() => hasOnlyOptionalClearLeftovers(state), [state]);
  const hasRuntimeResidue = useMemo(() => hasGuidedRuntimeResidue(guided), [guided]);
  const hasInitialGuidedFieldMeta = useMemo(() => Object.keys(initialFieldMeta || {}).length > 0, [initialFieldMeta]);
  const hasMeaningfulLaborTemplateContent = useMemo(() => hasMeaningfulLaborLines(state?.labor?.lines), [state]);
  const hasMeaningfulMaterialTemplateContent = useMemo(() => hasMeaningfulMaterialItems(state?.materials?.items), [state]);

  const shouldForceBlankDisplay = useMemo(
    () => shouldUseCanonicalBlankDisplayState(state, initialFieldMeta, guided),
    [guided, initialFieldMeta, state]
  );

  const audit = useMemo(() => {
    const target = chooseNextGuidedTarget({
      mode,
      state,
      guidedMeta: liveGuidedFieldMeta,
      context,
    });
    return normalizeGuidedAuditForProgress(buildGuidedAudit({
      mode,
      state,
      guidedMeta: liveGuidedFieldMeta,
      context,
    }), target);
  }, [context, liveGuidedFieldMeta, mode, state]);

  const blankPreOpenBootstrap = useMemo(() => {
    if (!shouldForceBlankDisplay) return null;
    return buildCanonicalBlankDisplayState({ mode, state, context, enabled: false });
  }, [context, mode, shouldForceBlankDisplay, state]);
  const lockedCanonicalBlankGuided = useMemo(() => {
    if (!shouldLockCanonicalBlankGuidedState(guided, state)) return null;
    return buildCanonicalBlankDisplayState({
      mode,
      state,
      context,
      enabled: guided?.enabled === true,
    });
  }, [context, guided, mode, state]);

  const traceSnapshotKeyRef = useRef("");

  useEffect(() => {
    const snapshot = {
      fileMarker: "src/estimator/guided/useGuidedBuild.js",
      branch: shouldForceBlankDisplay ? "canonical_blank_display" : "resume_or_builder_preview",
      builderIsBlank,
      hasCoreDraftContent,
      hasOptionalClearLeftovers,
      hasRuntimeResidue,
      hasInitialGuidedFieldMeta,
      hasMeaningfulLaborTemplateContent,
      hasMeaningfulMaterialTemplateContent,
      guidedEnabled: guided?.enabled === true,
      isCanonicalBlankDisplay: guided?.isCanonicalBlankDisplay === true,
      currentSection: guided?.currentSection || "",
      currentQuestion: guided?.currentQuestion || "",
      activeStepId: guided?.activeStepId || "",
      assistantMessage: guided?.assistantMessage || "",
      unresolvedRequiredFields: asArray(guided?.unresolvedRequiredFields),
      reviewReadiness: guided?.reviewReadiness || null,
      completionAuditCounts: guided?.completionAudit?.counts || null,
      stateSignals: {
        customerId: String(state?.customer?.id || "").trim(),
        customerName: String(state?.customer?.name || "").trim(),
        projectAddress: String(state?.customer?.projectAddress || "").trim(),
        scopeNotes: String(state?.scopeNotes || "").trim(),
        tradeKey: String(state?.tradeInsert?.key || "").trim(),
        blanketCost: String(state?.materials?.blanketCost || "").trim(),
        jobDate: String(state?.job?.date || "").trim(),
        jobDocNumber: String(state?.job?.docNumber || "").trim(),
        additionalNotes: String(state?.additionalNotes || "").trim(),
        laborLines: asArray(state?.labor?.lines),
        materialItems: asArray(state?.materials?.items),
      },
    };
    const snapshotKey = JSON.stringify(snapshot);
    if (snapshotKey === traceSnapshotKeyRef.current) return;
    traceSnapshotKeyRef.current = snapshotKey;
    traceEstiPaidGuidedRuntime("useGuidedBuild.js", "render-snapshot", snapshot);
  }, [
    builderIsBlank,
    guided,
    hasCoreDraftContent,
    hasInitialGuidedFieldMeta,
    hasMeaningfulLaborTemplateContent,
    hasMeaningfulMaterialTemplateContent,
    hasOptionalClearLeftovers,
    hasRuntimeResidue,
    shouldForceBlankDisplay,
    state,
  ]);

  const openGuided = useCallback(async () => {
    traceEstiPaidGuidedRuntime("useGuidedBuild.js", "openGuided-call", {
      fileMarker: "src/estimator/guided/useGuidedBuild.js",
      branch: shouldForceBlankDisplay ? "canonical_blank_display" : "resume_or_builder_preview",
      builderIsBlank,
      hasCoreDraftContent,
      hasOptionalClearLeftovers,
      hasRuntimeResidue,
      hasInitialGuidedFieldMeta,
      preservingPriorGuidedState: !shouldForceBlankDisplay && (
        Object.keys(guided?.fieldMeta || {}).length > 0
        || Object.keys(guided?.plannerState || {}).length > 0
        || asArray(guided?.answeredPrompts).length > 0
      ),
      guidedBeforeOpen: {
        enabled: guided?.enabled === true,
        isCanonicalBlankDisplay: guided?.isCanonicalBlankDisplay === true,
        currentSection: guided?.currentSection || "",
        currentQuestion: guided?.currentQuestion || "",
        activeStepId: guided?.activeStepId || "",
        assistantMessage: guided?.assistantMessage || "",
        completionAuditCounts: guided?.completionAudit?.counts || null,
        reviewReadiness: guided?.reviewReadiness || null,
        unresolvedRequiredFields: asArray(guided?.unresolvedRequiredFields),
      },
    });
    if (shouldForceBlankDisplay) {
      const blankBootstrap = blankPreOpenBootstrap || buildCanonicalBlankDisplayState({ mode, state, context, enabled: false });
      invalidateActiveRequest();
      setGuided({
        ...blankBootstrap,
        enabled: true,
      });
      return;
    }
    const seededFieldMeta = buildGuidedSeedFieldMeta(state, initialFieldMeta, guided.fieldMeta);
    const nextBaseAudit = normalizeGuidedAuditForProgress(
      buildGuidedAudit({ mode, state, guidedMeta: seededFieldMeta, context }),
      chooseNextGuidedTarget({ mode, state, guidedMeta: seededFieldMeta, context })
    );
    const { freshGuided, preview } = buildFreshGuidedPreviewState({
      mode,
      state,
      context,
      initialFieldMeta: seededFieldMeta,
      baseAudit: nextBaseAudit,
      enabled: true,
    });
    invalidateActiveRequest();
    setGuided(buildBootstrapGuidedState(freshGuided, preview));
  }, [
    blankPreOpenBootstrap,
    builderIsBlank,
    canonicalInitialFieldMeta,
    context,
    guided,
    hasCoreDraftContent,
    hasInitialGuidedFieldMeta,
    hasOptionalClearLeftovers,
    hasRuntimeResidue,
    initialFieldMeta,
    invalidateActiveRequest,
    mode,
    shouldForceBlankDisplay,
    state,
  ]);

  const surfacedGuided = useMemo(() => {
    if (!shouldForceBlankDisplay) return guided;
    return buildBlankGuidedSessionState(guided, audit, blankPreOpenBootstrap);
  }, [audit, blankPreOpenBootstrap, guided, shouldForceBlankDisplay]);
  const finalGuided = useMemo(
    () => applyCanonicalBlankGuidedState(surfacedGuided, lockedCanonicalBlankGuided),
    [lockedCanonicalBlankGuided, surfacedGuided]
  );
  const headerProgressAudit = useMemo(() => resolveGuidedHeaderProgressAudit({
    finalGuided,
    liveAudit: audit,
    state,
    canonicalBlankGuided: lockedCanonicalBlankGuided,
    blankBootstrap: blankPreOpenBootstrap,
    mode,
    context,
  }), [audit, blankPreOpenBootstrap, context, finalGuided, lockedCanonicalBlankGuided, mode, state]);
  const headerProgressMode = useMemo(
    () => resolveGuidedHeaderProgressMode(finalGuided),
    [finalGuided]
  );
  const headerProgressPercent = useMemo(
    () => (headerProgressMode === "canonicalBlank" ? 0 : getGuidedProgressPercent(headerProgressAudit)),
    [headerProgressAudit, headerProgressMode]
  );
  const headerProgressLocked = useMemo(
    () => headerProgressMode === "canonicalBlank",
    [headerProgressMode]
  );
  const headerProgressSource = useMemo(() => resolveGuidedHeaderProgressSource({
    finalGuided,
    state,
    headerProgressAudit,
    headerProgressPercent,
  }), [finalGuided, headerProgressAudit, headerProgressPercent, state]);

  const currentField = getGuidedField(finalGuided.currentQuestion);

  return {
    guided: {
      ...finalGuided,
      assistantMessage: finalGuided.activeStepPrompt || finalGuided.assistantMessage,
      suggestedChoices: finalGuided.stepOptions || finalGuided.suggestedChoices,
      completionAudit: finalGuided.isCanonicalBlankDisplay
        ? (finalGuided.completionAudit || audit)
        : (finalGuided.reviewOpen ? finalGuided.completionAudit : audit),
      unresolvedRequiredFields: finalGuided.isCanonicalBlankDisplay
        ? (finalGuided.unresolvedRequiredFields || audit.unresolvedFields)
        : (finalGuided.reviewOpen ? finalGuided.unresolvedRequiredFields : audit.unresolvedFields),
      reviewReadiness: finalGuided.isCanonicalBlankDisplay
        ? (finalGuided.reviewReadiness || finalGuided.completionAudit?.reviewReadiness || audit?.reviewReadiness || null)
        : (finalGuided.reviewOpen
        ? (finalGuided.reviewReadiness || finalGuided.completionAudit?.reviewReadiness || audit?.reviewReadiness || null)
        : (audit?.reviewReadiness || finalGuided.reviewReadiness || null)),
      headerProgressMode,
      headerProgressAudit,
      headerProgressPercent,
      headerProgressSource,
      headerProgressLocked,
      currentField,
      mode,
      context,
    },
    openGuided,
    closeGuided,
    refreshPrompt,
    submitAnswer,
    selectChoice,
    skipCurrent,
    openReview,
    jumpToSection,
    confirmPending,
    rejectPending,
  };
}

export default useGuidedBuild;
