import React from "react";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";

const mockPreviewGuidedBuildTurn = jest.fn();
const mockRequestGuidedBuildTurn = jest.fn();
const mockApplyGuidedWrites = jest.fn();
const mockApplyGuidedOperations = jest.fn();
const mockBuildConfirmationMeta = jest.fn();
const mockSummarizeBlockedWrites = jest.fn();

jest.mock("./service", () => ({
  previewGuidedBuildTurn: (...args) => mockPreviewGuidedBuildTurn(...args),
  requestGuidedBuildTurn: (...args) => mockRequestGuidedBuildTurn(...args),
}));

jest.mock("./writeback", () => ({
  applyGuidedWrites: (...args) => mockApplyGuidedWrites(...args),
  applyGuidedOperations: (...args) => mockApplyGuidedOperations(...args),
  buildConfirmationMeta: (...args) => mockBuildConfirmationMeta(...args),
  summarizeBlockedWrites: (...args) => mockSummarizeBlockedWrites(...args),
}));

jest.mock("./registry", () => {
  const GUIDED_PLANNER_META_KEY = "__guidedPlanner";
  const GUIDED_AUDIT_STATUS = {
    COMPLETE: "complete",
    INFERRED: "inferred",
    NEEDS_CONFIRMATION: "needs_confirmation",
    MISSING: "missing",
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const MATERIALS_MODE_OPTIONS = [
    { value: "blanket", label: "Carry materials allowance", description: "Use one materials allowance line." },
    { value: "itemized", label: "Itemize materials", description: "List materials line by line." },
    { value: "labor_only", label: "Labor only for now", description: "Carry labor first and keep materials separate." },
  ];

  const TRADE_INSERT_OPTIONS = [
    { value: "painting", label: "Painting", description: "Carry a painting estimate path." },
    { value: "drywall", label: "Drywall repair", description: "Carry drywall repair work." },
    { value: "flooring", label: "Flooring / LVP", description: "Carry flooring installation." },
    { value: "demo", label: "Demolition Crew", description: "Carry demolition scope." },
  ];

  function getField(fieldKey) {
    if (!fieldKey) return null;
    const map = {
      "customer.id": { key: "customer.id", label: "Customer", section: "customer" },
      "customer.projectSameAsCustomer": { key: "customer.projectSameAsCustomer", label: "Project Same As Customer", section: "customer" },
      "customer.projectAddress": { key: "customer.projectAddress", label: "Project Address", section: "customer" },
      "customer.state": { key: "customer.state", label: "State", section: "customer" },
      scopeNotes: { key: "scopeNotes", label: "Scope", section: "scope" },
      "tradeInsert.key": { key: "tradeInsert.key", label: "Trade", section: "scope" },
      "labor.lines": { key: "labor.lines", label: "Labor", section: "scope" },
      additionalNotes: { key: "additionalNotes", label: "Notes", section: "notes" },
      "ui.materialsMode": { key: "ui.materialsMode", label: "Materials Mode", section: "materials" },
      "materials.blanketCost": { key: "materials.blanketCost", label: "Materials Allowance", section: "materials" },
      "materials.items": { key: "materials.items", label: "Materials Items", section: "materials" },
      "job.docNumber": { key: "job.docNumber", label: "Estimate Number", section: "review" },
    };
    return map[fieldKey] || { key: fieldKey, label: fieldKey, section: "scope" };
  }

  function buildSectionPayload({ sectionKey = "scope", questionKey = "", state } = {}) {
    const resolvedSection = sectionKey || getField(questionKey)?.section || "scope";
    const fieldsBySection = {
      customer: ["customer.id", "customer.projectSameAsCustomer", "customer.projectAddress", "customer.state"],
      scope: ["tradeInsert.key", "scopeNotes", "labor.lines"],
      materials: ["ui.materialsMode", "materials.blanketCost", "materials.items"],
      notes: ["additionalNotes"],
      review: ["job.docNumber"],
    };
    const activeFields = (fieldsBySection[resolvedSection] || [questionKey || "scopeNotes"])
      .map((key) => ({ ...getField(key), status: state?.[key] ? GUIDED_AUDIT_STATUS.COMPLETE : GUIDED_AUDIT_STATUS.MISSING }));
    return {
      section: { key: resolvedSection, title: resolvedSection, label: resolvedSection },
      activeFields,
    };
  }

  function describeFieldValue(fieldKey, state = {}) {
    switch (fieldKey) {
      case "customer.id":
        return state?.customer?.id || "";
      case "tradeInsert.key":
        return state?.tradeInsert?.key || "";
      case "scopeNotes":
        return state?.scopeNotes || "";
      case "ui.materialsMode":
        return state?.ui?.materialsMode || "";
      case "additionalNotes":
        return state?.additionalNotes || "";
      default:
        return "";
    }
  }

  function getLiveOptionsForField(fieldKey, context = {}) {
    if (fieldKey === "customer.id") {
      return context?.customers || [
        { value: "cust-1", label: "Acme Construction", description: "Saved customer", fieldKey },
        { value: "cust-2", label: "Beta Builders", description: "Saved customer", fieldKey },
      ];
    }
    if (fieldKey === "tradeInsert.key") {
      return TRADE_INSERT_OPTIONS;
    }
    if (fieldKey === "ui.materialsMode") {
      return MATERIALS_MODE_OPTIONS;
    }
    if (fieldKey === "customer.state") {
      return [
        { value: "CA", label: "CA", description: "California", fieldKey },
        { value: "NV", label: "NV", description: "Nevada", fieldKey },
      ];
    }
    return [];
  }

  function buildAudit(state, guidedMeta = {}) {
    const audit = clone(state?.__audit || {
      counts: { complete: 0, inferred: 0, needs_confirmation: 0, missing: 1 },
      fields: [
        { key: "scopeNotes", label: "Scope", section: "scope", status: GUIDED_AUDIT_STATUS.MISSING },
      ],
      sections: [
        { key: "scope", label: "Scope", status: GUIDED_AUDIT_STATUS.MISSING, fields: [] },
        { key: "materials", label: "Materials", status: GUIDED_AUDIT_STATUS.MISSING, fields: [] },
        { key: "review", label: "Review", status: GUIDED_AUDIT_STATUS.MISSING, fields: [] },
      ],
      unresolvedFields: ["scopeNotes"],
      reviewReadiness: { ready: false, score: 50, blockers: ["scope basis"], pendingConfirmations: [] },
    });

    if (guidedMeta?.["ui.materialsMode"]?.pendingConfirmation) {
      audit.counts.needs_confirmation = 1;
      audit.reviewReadiness = {
        ...(audit.reviewReadiness || {}),
        ready: false,
        pendingConfirmations: ["ui.materialsMode"],
      };
    }

    return audit;
  }

  function chooseTarget(state, guidedMeta = {}, preferredSection = "") {
    if (preferredSection === "review") {
      return state?.__reviewTarget || { sectionKey: "review", questionKey: "job.docNumber" };
    }
    if (guidedMeta?.["ui.materialsMode"] && !guidedMeta["ui.materialsMode"].pendingConfirmation) {
      return state?.__afterConfirmationTarget || state?.__defaultTarget || { sectionKey: "scope", questionKey: "scopeNotes" };
    }
    if (preferredSection && state?.__targets?.[preferredSection]) {
      return state.__targets[preferredSection];
    }
    return state?.__defaultTarget || { sectionKey: "scope", questionKey: "scopeNotes" };
  }

  function chooseLiteralFormOrderTarget(state, guidedMeta = {}) {
    const planner = guidedMeta?.[GUIDED_PLANNER_META_KEY] || {};
    const hasLaborContent = Array.isArray(state?.labor?.lines)
      && state.labor.lines.some((line) => Boolean(line?.label || line?.role || line?.hours || line?.rate || line?.trueRateInternal || line?.internalRate));
    const hasMaterialContent = Boolean(state?.materials?.blanketCost)
      || (Array.isArray(state?.materials?.items)
        && state.materials.items.some((item) => Boolean(item?.desc || item?.qty || item?.priceEach || item?.charge || item?.unitCostInternal || item?.costInternal)));
    const hasScopeContent = Boolean(state?.tradeInsert?.key || state?.scopeNotes);

    if (hasScopeContent || hasLaborContent || hasMaterialContent) return null;
    if (!state?.customer?.id) {
      return {
        sectionKey: "customer",
        questionKey: "customer.id",
        audit: buildAudit(state, guidedMeta),
        planner,
      };
    }
    if (typeof state?.customer?.projectSameAsCustomer !== "boolean") {
      return {
        sectionKey: "customer",
        questionKey: "customer.projectSameAsCustomer",
        audit: buildAudit(state, guidedMeta),
        planner,
      };
    }
    return null;
  }

  return {
    GUIDED_PLANNER_META_KEY,
    GUIDED_AUDIT_STATUS,
    MATERIALS_MODE_OPTIONS,
    TRADE_INSERT_OPTIONS,
    buildSectionPayload,
    buildGuidedAudit: ({ state, guidedMeta = {} }) => buildAudit(state, guidedMeta),
    chooseLiteralFormOrderGuidedTarget: ({ state, guidedMeta = {} }) => chooseLiteralFormOrderTarget(state, guidedMeta),
    chooseNextGuidedTarget: ({ state, guidedMeta = {}, preferredSection = "" }) => ({
      ...chooseTarget(state, guidedMeta, preferredSection),
      audit: buildAudit(state, guidedMeta),
    }),
    describeFieldValue,
    getGuidedField: getField,
    getGuidedPlannerState: (guidedMeta = {}) => guidedMeta?.[GUIDED_PLANNER_META_KEY] || {},
    getLiveOptionsForField,
    getGuidedSections: () => ([
      { key: "customer", label: "Customer" },
      { key: "scope", label: "Scope" },
      { key: "materials", label: "Materials" },
      { key: "notes", label: "Notes" },
      { key: "review", label: "Review" },
    ]),
  };
});

import GuidedBuildOverlay from "./GuidedBuildOverlay";
import { useGuidedBuild } from "./useGuidedBuild";

function createAudit({ ready = false, pendingConfirmation = false } = {}) {
  const materialsStatus = pendingConfirmation ? "needs_confirmation" : (ready ? "complete" : "missing");
  return {
    counts: {
      complete: ready ? 3 : 1,
      inferred: 0,
      needs_confirmation: pendingConfirmation ? 1 : 0,
      missing: ready ? 0 : 2,
    },
    fields: [
      { key: "scopeNotes", label: "Scope", section: "scope", status: ready ? "complete" : "missing" },
      { key: "ui.materialsMode", label: "Materials Mode", section: "materials", status: materialsStatus },
      { key: "materials.blanketCost", label: "Materials Allowance", section: "materials", status: ready ? "complete" : "missing" },
    ],
    sections: [
      { key: "scope", label: "Scope", status: ready ? "complete" : "missing", fields: [] },
      { key: "materials", label: "Materials", status: materialsStatus, fields: [] },
      { key: "review", label: "Review", status: ready ? "complete" : "missing", fields: [] },
    ],
    unresolvedFields: ready ? [] : ["scopeNotes", "materials.blanketCost"],
    reviewReadiness: {
      ready,
      score: ready ? 100 : 50,
      blockers: ready ? [] : ["scope basis"],
      pendingConfirmations: pendingConfirmation ? ["ui.materialsMode"] : [],
    },
  };
}

function getAuditProgressPercent(audit = {}) {
  const counts = audit?.counts || {};
  const reviewFields = Array.isArray(audit?.fields) ? audit.fields : [];
  const covered = Number(counts?.complete || 0)
    + Number(counts?.inferred || 0)
    + Number(counts?.needs_confirmation || 0);
  const total = reviewFields.length
    ? reviewFields.length
    : Number(counts?.complete || 0)
      + Number(counts?.inferred || 0)
      + Number(counts?.needs_confirmation || 0)
      + Number(counts?.missing || 0);
  return total > 0 ? Math.round((covered / total) * 100) : 0;
}

function getHeaderProgressPercent(guided = {}) {
  const explicitPercent = Number(guided?.headerProgressPercent);
  if (Number.isFinite(explicitPercent)) return Math.round(explicitPercent);
  return getAuditProgressPercent(guided?.headerProgressAudit || guided?.completionAudit || {});
}

function getVisibleDebugHeaderProgressSource(guided = {}) {
  if (guided?.isCanonicalBlankDisplay === true && Number.isFinite(Number(guided?.headerProgressPercent))) {
    return guided?.headerProgressSource || "headerProgressPercent";
  }
  if (guided?.headerProgressAudit) return guided?.headerProgressSource || "headerProgressAudit";
  return "completionAudit";
}

function getHeaderProgressMode(guided = {}) {
  return String(guided?.headerProgressMode || "normal").trim() || "normal";
}

function createOptionalInflatedAudit() {
  return {
    counts: {
      complete: 6,
      inferred: 0,
      needs_confirmation: 0,
      missing: 1,
    },
    fields: [
      { key: "customer.id", label: "Customer", section: "customer", status: "missing" },
      { key: "customer.state", label: "State", section: "customer", status: "complete" },
      { key: "ui.materialsMode", label: "Materials Mode", section: "materials", status: "complete" },
      { key: "materials.markupPct", label: "Markup", section: "materials", status: "complete" },
      { key: "labor.hazardPct", label: "Hazard", section: "scope", status: "complete" },
      { key: "additionalNotes", label: "Notes", section: "notes", status: "complete" },
      { key: "job.docNumber", label: "Estimate Number", section: "review", status: "complete" },
    ],
    sections: [
      { key: "customer", label: "Customer", status: "complete", fields: [] },
      { key: "scope", label: "Scope", status: "complete", fields: [] },
      { key: "materials", label: "Materials", status: "complete", fields: [] },
      { key: "notes", label: "Notes", status: "complete", fields: [] },
      { key: "review", label: "Review", status: "complete", fields: [] },
    ],
    unresolvedFields: ["customer.id", "materials.blanketCost"],
    reviewReadiness: {
      ready: true,
      score: 86,
      blockers: [],
      pendingConfirmations: [],
    },
  };
}

function createLiveClearedEstimatorState(overrides = {}) {
  return createState({
    customer: {
      id: "",
      name: "",
      attn: "",
      phone: "",
      email: "",
      netTermsType: "",
      netTermsDays: "",
      address: "",
      billingDiff: false,
      billingAddress: "",
      projectName: "",
      projectNumber: "",
      projectAddress: "",
      projectSameAsCustomer: true,
    },
    job: {
      date: "2026-03-16",
      location: "",
      poNumber: "",
      due: "",
      docNumber: "",
    },
    scopeNotes: "",
    tradeInsert: { key: "", text: "" },
    labor: {
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
      lines: [{ id: "l1", role: "", hours: "", rate: "", trueRateInternal: "" }],
    },
    materials: {
      blanketCost: "",
      blanketInternalCost: "",
      materialsBlanketDescription: "",
      markupPct: 0,
      items: [{ id: "m1", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" }],
    },
    additionalNotes: "",
    __defaultTarget: { sectionKey: "scope", questionKey: "scopeNotes" },
    __audit: createOptionalInflatedAudit(),
    ...overrides,
  });
}

function createState(overrides = {}) {
  return {
    ui: { materialsMode: "itemized" },
    __defaultTarget: { sectionKey: "scope", questionKey: "scopeNotes" },
    __afterConfirmationTarget: { sectionKey: "materials", questionKey: "materials.blanketCost" },
    __reviewTarget: { sectionKey: "review", questionKey: "job.docNumber" },
    __targets: {
      scope: { sectionKey: "scope", questionKey: "scopeNotes" },
      materials: { sectionKey: "materials", questionKey: "materials.blanketCost" },
      review: { sectionKey: "review", questionKey: "job.docNumber" },
    },
    __audit: createAudit(),
    ...overrides,
  };
}

function createChoice(fieldKey = "ui.materialsMode", value = "blanket", label = "Carry blanket materials") {
  return {
    id: `${fieldKey}:${value}`,
    fieldKey,
    value,
    label,
    description: "",
  };
}

function createGuidedSummary() {
  return {
    value: "$5,000",
    title: "Estimate Total",
    detail: "Gross profit $2,000",
    items: [
      { label: "Customer", value: "Acme" },
    ],
    highlights: [],
  };
}

const PAINT_SURFACES_PROMPT = "Which surfaces are included: walls, ceilings, trim, doors, or closets?";
const PAINT_SURFACES_CLARIFY_PROMPT = "For this step, tell me which surfaces are included: walls, ceilings, trim, doors, or closets.";
const PAINT_SURFACES_PARTIAL_PROMPT = "Any ceilings, trim, doors, or closets included, or is it walls only?";
const PAINT_SURFACES_MIXED_PROMPT = "Any trim, doors, or closets included, or is it just walls and ceilings?";
const WEAK_GUIDED_FALLBACK_PROMPT = "What should I price next?";
const OCCUPANCY_PROMPT = "Will the work be done in an occupied space, a furnished space, or a vacant one?";
const OCCUPANCY_CLARIFY_PROMPT = "For this step, tell me whether the space is occupied, occupied with furniture, or vacant.";
const PAINT_PREP_PROMPT = "Do you want standard prep only, minor patching, or heavier repairs in the price?";

function createPaintingSurfaceState(overrides = {}) {
  return createState({
    __guidedScenario: "painting_surfaces",
    ...overrides,
  });
}

function createPaintingSurfaceLoopSwapState(overrides = {}) {
  return createState({
    __guidedScenario: "painting_surfaces_loop_swap",
    ...overrides,
  });
}

function createOccupancyState(overrides = {}) {
  return createState({
    __guidedScenario: "painting_occupancy",
    ...overrides,
  });
}

function createPaintingSurfaceChoices() {
  return [
    {
      id: "scopeNotes:walls-only",
      label: "Walls only",
      description: "Carry wall surfaces only.",
      value: "walls-only",
      fieldKey: "scopeNotes",
    },
    {
      id: "scopeNotes:walls-ceilings",
      label: "Walls + ceilings",
      description: "Carry walls and ceilings.",
      value: "walls-ceilings",
      fieldKey: "scopeNotes",
    },
    {
      id: "scopeNotes:walls-ceilings-trim",
      label: "Walls + ceilings + trim",
      description: "Carry walls, ceilings, and trim.",
      value: "walls-ceilings-trim",
      fieldKey: "scopeNotes",
    },
  ];
}

function createOccupancyChoices() {
  return [
    {
      id: "scopeNotes:occupied",
      label: "Occupied",
      description: "Carry protection and daily cleanup.",
      value: "occupied",
      fieldKey: "scopeNotes",
    },
    {
      id: "scopeNotes:vacant",
      label: "Vacant",
      description: "Carry open access in an empty space.",
      value: "vacant",
      fieldKey: "scopeNotes",
    },
    {
      id: "scopeNotes:occupied-with-furniture",
      label: "Occupied with furniture",
      description: "Carry furniture moving and protection.",
      value: "occupied with furniture",
      fieldKey: "scopeNotes",
    },
  ];
}

function buildGuidedStepResponse({
  sectionKey = "scope",
  questionKey = "scopeNotes",
  prompt = `Prompt for ${questionKey}`,
  suggestedChoices = [],
  turnDiagnosis = "",
  stepStatus = "",
  promptIntent = "",
  expectedAnswerMode = "",
  expectedComponents = [],
  resolvedComponents = [],
  missingComponents = [],
  resolutionSource = "local",
} = {}) {
  return {
    assistantMessage: prompt,
    suggestedChoices,
    extractedFieldValues: [],
    fieldsNeedingConfirmation: [],
    unresolvedFields: [questionKey],
    recommendedNextSection: sectionKey,
    recommendedNextQuestion: questionKey,
    warnings: [],
    stepResolution: stepStatus ? {
      status: stepStatus,
      answeredComponents: resolvedComponents,
      missingComponents,
    } : undefined,
    stepRunnerState: {
      activeStepId: `${sectionKey}:${questionKey}`,
      activeSectionKey: sectionKey,
      activeFieldKey: questionKey,
      activePrompt: prompt,
      promptIntent,
      expectedAnswerMode,
      expectedComponents,
      answeredComponents: resolvedComponents,
      missingComponents,
      turnDiagnosis,
      nextQuestionReason: `reason:${questionKey}`,
      resolutionSource,
      plannerState: {},
    },
  };
}

function buildPreviewFixture(payload, deterministicResponse, requiresAI = false) {
  const sectionKey = String(payload.sectionKey || "scope").trim();
  const questionKey = String(payload.questionKey || "scopeNotes").trim();
  return {
    requestBody: {
      sectionKey,
      questionKey,
      currentPrompt: payload.currentPrompt || "",
      userAnswer: payload.userAnswer || "",
      priorGuidedAnswers: payload.answeredPrompts || [],
      plannerState: payload.plannerState || {},
      activeStep: payload.activeStep || {},
      turnState: payload.turnState || {},
      estimateContext: {
        trade: payload.state?.tradeInsert?.key || "",
        scope: payload.state?.scopeNotes || "",
        materialsPath: payload.state?.ui?.materialsMode || "",
      },
    },
    localPayload: { ...payload, sectionKey, questionKey },
    localTurn: {
      target: { sectionKey, questionKey },
      questionKey,
    },
    deterministicResponse,
    fallback: deterministicResponse,
    requiresAI,
    requestKey: `${sectionKey}::${questionKey}::${String(payload.userAnswer || "").trim().toLowerCase()}`,
  };
}

function createGuidedOption({ fieldKey = "scopeNotes", label, value = label, description = "" }) {
  return {
    id: `${fieldKey}:${String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    fieldKey,
    label,
    value,
    description,
  };
}

function createActualServicePayload(overrides = {}) {
  const state = createState({
    customer: { id: "cust-1" },
    tradeInsert: { key: "painting" },
    ui: { materialsMode: "itemized" },
    ...overrides.state,
  });
  return {
    mode: "estimate",
    state,
    sectionKey: overrides.sectionKey || "scope",
    questionKey: overrides.questionKey || "scopeNotes",
    currentPrompt: overrides.currentPrompt || "",
    userAnswer: overrides.userAnswer || "",
    answeredPrompts: overrides.answeredPrompts || [],
    guidedMeta: overrides.guidedMeta || {},
    plannerState: overrides.plannerState || {},
    activeStep: overrides.activeStep,
    currentSuggestedChoices: overrides.currentSuggestedChoices || [],
    turnState: overrides.turnState || { repeatedUnresolvedCount: 0, turnDiagnosis: "" },
    context: {
      customers: [
        { value: "cust-1", label: "Acme Construction", description: "Saved customer", fieldKey: "customer.id" },
        { value: "cust-2", label: "Beta Builders", description: "Saved customer", fieldKey: "customer.id" },
      ],
      ...(overrides.context || {}),
    },
  };
}

function createAiResponse({
  sectionKey = "scope",
  questionKey = "scopeNotes",
  prompt = "Prompt",
  promptIntent = "",
  suggestedChoices = [],
  recommendedNextSection = sectionKey,
  recommendedNextQuestion = questionKey,
  stepRunnerState = {},
} = {}) {
  return {
    assistantMessage: prompt,
    suggestedChoices,
    extractedFieldValues: [],
    proposedFieldWrites: [],
    fieldsNeedingConfirmation: [],
    unresolvedFields: [questionKey],
    recommendedNextSection,
    recommendedNextQuestion,
    nextBestQuestion: {
      fieldKey: questionKey,
      sectionKey,
      question: prompt,
    },
    warnings: [],
    stepRunnerState: {
      activeStepId: `${sectionKey}:${questionKey}`,
      activeSectionKey: sectionKey,
      activeFieldKey: questionKey,
      activePrompt: prompt,
      promptIntent,
      expectedAnswerMode: "single_select",
      expectedComponents: [],
      answeredComponents: [],
      missingComponents: [],
      nextQuestionReason: `reason:${questionKey}`,
      resolutionSource: "ai",
      plannerState: {},
      ...stepRunnerState,
    },
  };
}

function createAdaptivePromptResponse({
  promptText = "",
  promptVariant = "clarify",
  answerClassification = "unresolved_clarify",
  clarificationText = "",
  missingComponents = [],
  normalizedAnswer = "",
  interpretedSelections = [],
  reasoningSummary = "",
  confidence = 0.9,
} = {}) {
  return {
    adaptivePrompt: {
      promptText,
      promptVariant,
      answerClassification,
      clarificationText,
      missingComponents,
      normalizedAnswer,
      interpretedSelections,
      reasoningSummary,
      confidence,
    },
  };
}

async function requestActualServiceTurn(payload, rawResponse) {
  const actualService = jest.requireActual("./service");
  const preview = actualService.previewGuidedBuildTurn(payload);
  const originalFetch = global.fetch;
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => rawResponse,
    text: async () => JSON.stringify(rawResponse),
  });
  global.fetch = fetchMock;
  try {
    const result = await actualService.requestGuidedBuildTurn(payload, { ...preview, requiresAI: true });
    return { result, preview, fetchMock };
  } finally {
    global.fetch = originalFetch;
  }
}

function buildPaintingSurfacePreview(payload = {}) {
  const answer = String(payload.userAnswer || "").trim().toLowerCase();
  const repeatedUnresolvedCount = Number(payload.turnState?.repeatedUnresolvedCount || 0) || 0;
  const suggestedChoices = createPaintingSurfaceChoices();
  const stepConfig = {
    sectionKey: "scope",
    questionKey: "scopeNotes",
    suggestedChoices,
    promptIntent: "painting_surfaces",
    expectedAnswerMode: "mixed_multi_part",
    expectedComponents: ["coverageKnown", "surfaceExclusionsKnown"],
  };

  if (!answer) {
    return buildPreviewFixture(payload, buildGuidedStepResponse({
      ...stepConfig,
      prompt: PAINT_SURFACES_PROMPT,
      turnDiagnosis: "unresolved_clarify",
      stepStatus: "unresolved_clarified",
      missingComponents: stepConfig.expectedComponents,
    }));
  }

  if (["walls", "doors", "trim only"].includes(answer)) {
    return buildPreviewFixture(payload, buildGuidedStepResponse({
      ...stepConfig,
      prompt: PAINT_SURFACES_PARTIAL_PROMPT,
      turnDiagnosis: "partial",
      stepStatus: "partially_resolved",
      resolvedComponents: ["coverageKnown"],
      missingComponents: ["surfaceExclusionsKnown"],
    }));
  }

  if (answer === "walls and ceilings") {
    return buildPreviewFixture(payload, buildGuidedStepResponse({
      ...stepConfig,
      prompt: PAINT_SURFACES_MIXED_PROMPT,
      turnDiagnosis: "partial",
      stepStatus: "partially_resolved",
      resolvedComponents: ["coverageKnown"],
      missingComponents: ["surfaceExclusionsKnown"],
    }));
  }

  if (answer === "none") {
    return buildPreviewFixture(payload, buildGuidedStepResponse({
      ...stepConfig,
      prompt: PAINT_SURFACES_CLARIFY_PROMPT,
      turnDiagnosis: "unresolved_clarify",
      stepStatus: "unresolved_clarified",
      missingComponents: stepConfig.expectedComponents,
    }));
  }

  if (["asdfasdf", "qwerqwer", "zzzzzz"].includes(answer)) {
    const prompt = payload.state?.__guidedScenario === "painting_surfaces_loop_swap" && repeatedUnresolvedCount === 0
      ? WEAK_GUIDED_FALLBACK_PROMPT
      : PAINT_SURFACES_CLARIFY_PROMPT;
    const turnDiagnosis = repeatedUnresolvedCount > 0 ? "repeated_unresolved" : "invalid_for_step";
    const stepStatus = repeatedUnresolvedCount > 0 ? "needs_interpretive_retry" : "invalid_for_prompt";
    return buildPreviewFixture(payload, buildGuidedStepResponse({
      ...stepConfig,
      prompt,
      turnDiagnosis,
      stepStatus,
      missingComponents: stepConfig.expectedComponents,
    }), repeatedUnresolvedCount > 0);
  }

  return buildPreviewFixture(payload, buildGuidedStepResponse({
    ...stepConfig,
    prompt: PAINT_SURFACES_CLARIFY_PROMPT,
    turnDiagnosis: "invalid_for_step",
    stepStatus: "invalid_for_prompt",
    missingComponents: stepConfig.expectedComponents,
  }));
}

function buildOccupancyPreview(payload = {}) {
  const answer = String(payload.userAnswer || "").trim().toLowerCase();
  const repeatedUnresolvedCount = Number(payload.turnState?.repeatedUnresolvedCount || 0) || 0;
  const suggestedChoices = createOccupancyChoices();
  const currentStepConfig = {
    sectionKey: "scope",
    questionKey: "scopeNotes",
    suggestedChoices,
    promptIntent: "painting_occupancy",
    expectedAnswerMode: "single_select",
    expectedComponents: ["occupancyKnown"],
  };

  if (!answer) {
    return buildPreviewFixture(payload, buildGuidedStepResponse({
      ...currentStepConfig,
      prompt: OCCUPANCY_PROMPT,
      turnDiagnosis: "unresolved_clarify",
      stepStatus: "unresolved_clarified",
      missingComponents: currentStepConfig.expectedComponents,
    }));
  }

  if (["occupied", "vacant", "occupied with furniture"].includes(answer)) {
    return buildPreviewFixture(payload, buildGuidedStepResponse({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      prompt: PAINT_PREP_PROMPT,
      suggestedChoices: [
        {
          id: "scopeNotes:standard-prep",
          label: "Standard prep only",
          description: "No repair scope beyond normal prep.",
          fieldKey: "scopeNotes",
        },
      ],
      turnDiagnosis: "resolved",
      stepStatus: "fully_resolved",
      promptIntent: "painting_prep",
      expectedAnswerMode: "single_select",
      expectedComponents: ["prepKnown"],
      resolvedComponents: [],
      missingComponents: ["prepKnown"],
    }));
  }

  if (["asdfasdf", "qwerqwer", "zzzzzz"].includes(answer)) {
    return buildPreviewFixture(payload, buildGuidedStepResponse({
      ...currentStepConfig,
      prompt: OCCUPANCY_CLARIFY_PROMPT,
      turnDiagnosis: repeatedUnresolvedCount > 0 ? "repeated_unresolved" : "invalid_for_step",
      stepStatus: repeatedUnresolvedCount > 0 ? "needs_interpretive_retry" : "invalid_for_prompt",
      missingComponents: currentStepConfig.expectedComponents,
    }), repeatedUnresolvedCount > 0);
  }

  return buildPreviewFixture(payload, buildGuidedStepResponse({
    ...currentStepConfig,
    prompt: OCCUPANCY_CLARIFY_PROMPT,
    turnDiagnosis: "invalid_for_step",
    stepStatus: "invalid_for_prompt",
    missingComponents: currentStepConfig.expectedComponents,
  }));
}

beforeEach(() => {
  mockPreviewGuidedBuildTurn.mockReset();
  mockRequestGuidedBuildTurn.mockReset();
  mockApplyGuidedWrites.mockReset();
  mockApplyGuidedOperations.mockReset();
  mockBuildConfirmationMeta.mockReset();
  mockSummarizeBlockedWrites.mockReset();

  mockPreviewGuidedBuildTurn.mockImplementation((payload = {}) => {
    if (
      payload?.state?.__guidedScenario === "painting_surfaces"
      || payload?.state?.__guidedScenario === "painting_surfaces_loop_swap"
    ) {
      return buildPaintingSurfacePreview(payload);
    }
    if (payload?.state?.__guidedScenario === "painting_occupancy") {
      return buildOccupancyPreview(payload);
    }

    const sectionKey = String(payload.sectionKey || "scope").trim();
    const questionKey = String(payload.questionKey || "scopeNotes").trim();
    const prompt = `Prompt for ${questionKey}`;
    const plannerState = String(payload.userAnswer || "").trim()
      ? { scopeCaptured: true }
      : (payload.plannerState || {});
    const deterministicResponse = {
      assistantMessage: prompt,
      suggestedChoices: [
        {
          id: `${questionKey}:choice`,
          label: `Choice for ${questionKey}`,
          description: `Option for ${questionKey}`,
          value: `${questionKey}:value`,
          fieldKey: questionKey,
        },
      ],
      extractedFieldValues: [],
      fieldsNeedingConfirmation: [],
      unresolvedFields: [questionKey],
      recommendedNextSection: sectionKey,
      recommendedNextQuestion: questionKey,
      warnings: [],
      stepRunnerState: {
        activeStepId: `${sectionKey}:${questionKey}`,
        activeSectionKey: sectionKey,
        activeFieldKey: questionKey,
        activePrompt: prompt,
        nextQuestionReason: `reason:${questionKey}`,
        resolutionSource: String(payload.userAnswer || "").trim() ? "local" : "preview",
        plannerState,
      },
    };

    return {
      requestBody: {
        sectionKey,
        questionKey,
        currentPrompt: payload.currentPrompt || "",
        userAnswer: payload.userAnswer || "",
        priorGuidedAnswers: payload.answeredPrompts || [],
        plannerState: payload.plannerState || {},
        activeStep: payload.activeStep || {},
        turnState: payload.turnState || {},
        estimateContext: {
          trade: payload.state?.tradeInsert?.key || "",
          scope: payload.state?.scopeNotes || "",
          materialsPath: payload.state?.ui?.materialsMode || "",
        },
      },
      localPayload: { ...payload, sectionKey, questionKey },
      localTurn: {
        target: { sectionKey, questionKey },
        questionKey,
      },
      deterministicResponse,
      fallback: deterministicResponse,
      requiresAI: false,
      requestKey: `${sectionKey}::${questionKey}::${String(payload.userAnswer || "").trim().toLowerCase()}`,
    };
  });

  mockRequestGuidedBuildTurn.mockImplementation(async (payload, preview) => {
    if (
      payload?.state?.__guidedScenario === "painting_surfaces"
      || payload?.state?.__guidedScenario === "painting_surfaces_loop_swap"
    ) {
      return buildGuidedStepResponse({
        sectionKey: "scope",
        questionKey: "scopeNotes",
        prompt: PAINT_SURFACES_CLARIFY_PROMPT,
        suggestedChoices: createPaintingSurfaceChoices(),
        turnDiagnosis: "escalated_to_groq",
        stepStatus: "invalid_for_prompt",
        promptIntent: "painting_surfaces",
        expectedAnswerMode: "mixed_multi_part",
        expectedComponents: ["coverageKnown", "surfaceExclusionsKnown"],
        missingComponents: ["coverageKnown", "surfaceExclusionsKnown"],
        resolutionSource: "ai",
      });
    }
    if (payload?.state?.__guidedScenario === "painting_occupancy") {
      return buildGuidedStepResponse({
        sectionKey: "scope",
        questionKey: "scopeNotes",
        prompt: OCCUPANCY_CLARIFY_PROMPT,
        suggestedChoices: createOccupancyChoices(),
        turnDiagnosis: "escalated_to_groq",
        stepStatus: "invalid_for_prompt",
        promptIntent: "painting_occupancy",
        expectedAnswerMode: "single_select",
        expectedComponents: ["occupancyKnown"],
        missingComponents: ["occupancyKnown"],
        resolutionSource: "ai",
      });
    }

    if (preview?.deterministicResponse) return preview.deterministicResponse;
    return mockPreviewGuidedBuildTurn(payload).deterministicResponse;
  });

  mockApplyGuidedWrites.mockImplementation(({ writes }) => {
    const extracted = Array.isArray(writes?.extractedFieldValues) ? writes.extractedFieldValues : [];
    const targetWrite = extracted[0];
    if (targetWrite?.key === "ui.materialsMode") {
      return {
        applied: [],
        blocked: [],
        confirmations: [
          {
            id: "confirm-materials-mode",
            fieldKey: "ui.materialsMode",
            label: "Materials Mode",
            value: targetWrite.value,
            existingValue: "itemized",
            source: "ai",
            confidence: 0.95,
            reason: "Confirm the materials branch before switching it.",
            operation: {
              kind: "patch",
              path: "ui.materialsMode",
              value: targetWrite.value,
              fieldKey: "ui.materialsMode",
            },
          },
        ],
        fieldMeta: {},
      };
    }

    return {
      applied: extracted.map((entry) => ({
        kind: "patch",
        path: entry.key,
        value: entry.value,
        fieldKey: entry.key,
      })),
      blocked: [],
      confirmations: [],
      fieldMeta: {},
    };
  });

  mockApplyGuidedOperations.mockImplementation(({ operations = [], patch }) => {
    const applied = [];
    operations.forEach((operation) => {
      if (!operation) return;
      if (operation.kind === "patch" && typeof patch === "function") {
        patch(operation.path, operation.value);
      }
      applied.push({
        fieldKey: operation.fieldKey || operation.path,
        description: `${operation.path}:${operation.value}`,
      });
    });
    return applied;
  });

  mockBuildConfirmationMeta.mockImplementation((confirmations = []) => {
    return confirmations.reduce((acc, item) => {
      acc[item.fieldKey] = {
        source: item.source || "ai",
        confidence: Number(item.confidence || 0),
        pendingConfirmation: true,
        confirmed: false,
      };
      return acc;
    }, {});
  });

  mockSummarizeBlockedWrites.mockImplementation((blocked = []) => blocked);
});

function renderGuidedHook(state = createState(), extraOptions = {}) {
  const patch = jest.fn();
  const onSelectCustomer = jest.fn();
  const result = renderHook(
    ({ liveState, options }) => useGuidedBuild({
      state: liveState,
      patch,
      mode: "estimate",
      context: {},
      onSelectCustomer,
      ...options,
    }),
    {
      initialProps: {
        liveState: state,
        options: extraOptions,
      },
    }
  );

  return {
    ...result,
    patch,
    onSelectCustomer,
  };
}

describe("guided service family invariant", () => {
  test("customer prompt cannot surface with trade or labor chips", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "" },
        tradeInsert: { key: "" },
      },
      sectionKey: "customer",
      questionKey: "customer.id",
    });
    const rawResponse = createAiResponse({
      sectionKey: "customer",
      questionKey: "customer.id",
      prompt: "Who is the customer for this estimate?",
      promptIntent: "customer_selection",
      suggestedChoices: [
        createGuidedOption({ fieldKey: "labor.lines", label: "Generic Labor" }),
        createGuidedOption({ fieldKey: "tradeInsert.key", label: "Painting", value: "painting" }),
        createGuidedOption({ fieldKey: "labor.lines", label: "Demolition Crew" }),
      ],
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

    expect(result.recommendedNextQuestion).toBe("customer.id");
    expect(result.recommendedNextSection).toBe("customer");
    expect(result.assistantMessage).toMatch(/customer/i);
    expect(result.suggestedChoices.length).toBeGreaterThan(0);
    expect(result.suggestedChoices.every((choice) => choice.fieldKey === "customer.id")).toBe(true);
    expect(result.stepRunnerState.activeSectionKey).toBe("customer");
    expect(result.stepRunnerState.activeFieldKey).toBe("customer.id");
  });

  test("customer repair happens only when customer is truly the current blocker", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "" },
        tradeInsert: { key: "" },
      },
      sectionKey: "customer",
      questionKey: "customer.id",
    });
    const rawResponse = createAiResponse({
      sectionKey: "scope",
      questionKey: "customer.id",
      prompt: "Who is the customer for this estimate?",
      promptIntent: "customer_selection",
      suggestedChoices: [
        createGuidedOption({ fieldKey: "tradeInsert.key", label: "Painting", value: "painting" }),
        createGuidedOption({ fieldKey: "tradeInsert.key", label: "Drywall repair", value: "drywall" }),
      ],
      recommendedNextSection: "scope",
      recommendedNextQuestion: "customer.id",
      stepRunnerState: {
        activeSectionKey: "scope",
        activeFieldKey: "customer.id",
      },
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

    expect(result.recommendedNextQuestion).toBe("customer.id");
    expect(result.recommendedNextSection).toBe("customer");
    expect(result.assistantMessage).toMatch(/customer/i);
    expect(result.stepRunnerState.activeSectionKey).toBe("customer");
    expect(result.stepRunnerState.activeFieldKey).toBe("customer.id");
  });

  test("valid canonical non-customer blocker is preserved when customer background fields are incomplete", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "cust-1", projectAddress: "", state: "" },
        tradeInsert: { key: "painting" },
      },
      sectionKey: "scope",
      questionKey: "scopeNotes",
      plannerState: { painting: true, tradeKey: "painting" },
    });
    const rawResponse = createAiResponse({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      prompt: "Which surfaces are included: walls, ceilings, trim, doors, or closets?",
      promptIntent: "painting_surfaces",
      suggestedChoices: [
        createGuidedOption({ fieldKey: "scopeNotes", label: "Walls only" }),
        createGuidedOption({ fieldKey: "scopeNotes", label: "Walls + ceilings" }),
        createGuidedOption({ fieldKey: "scopeNotes", label: "Walls + ceilings + trim" }),
      ],
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

    expect(result.recommendedNextQuestion).toBe("scopeNotes");
    expect(result.recommendedNextSection).toBe("scope");
    expect(result.assistantMessage).toMatch(/surfaces/i);
    expect(result.suggestedChoices.every((choice) => choice.fieldKey === "scopeNotes")).toBe(true);
    expect(result.stepRunnerState.activeSectionKey).toBe("scope");
    expect(result.stepRunnerState.activeFieldKey).toBe("scopeNotes");
  });

  test("trade prompt cannot surface area footprint chips", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "cust-1" },
        tradeInsert: { key: "" },
      },
      sectionKey: "scope",
      questionKey: "tradeInsert.key",
    });
    const rawResponse = createAiResponse({
      sectionKey: "scope",
      questionKey: "tradeInsert.key",
      prompt: "What kind of work is this?",
      promptIntent: "trade_definition",
      suggestedChoices: [
        createGuidedOption({ fieldKey: "scopeNotes", label: "A few connected rooms" }),
        createGuidedOption({ fieldKey: "scopeNotes", label: "Most of downstairs" }),
        createGuidedOption({ fieldKey: "scopeNotes", label: "Whole level / full area" }),
      ],
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

    expect(result.recommendedNextQuestion).toBe("tradeInsert.key");
    expect(result.assistantMessage).toMatch(/kind of (work|job)/i);
    expect(result.suggestedChoices.every((choice) => choice.fieldKey === "tradeInsert.key")).toBe(true);
  });

  test("drywall repair prompt cannot surface itemized materials chip", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "cust-1" },
        tradeInsert: { key: "drywall" },
      },
      sectionKey: "scope",
      questionKey: "scopeNotes",
      plannerState: { drywallRepair: true, tradeKey: "drywall" },
    });
    const rawResponse = createAiResponse({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      prompt: "Are these small patches, or larger drywall sections that need replacement?",
      promptIntent: "drywall_repair_shape",
      suggestedChoices: [
        createGuidedOption({ fieldKey: "ui.materialsMode", label: "Itemize materials", value: "itemized" }),
      ],
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

    expect(result.assistantMessage).toMatch(/repair areas|small patches|larger drywall sections/i);
    expect(result.suggestedChoices.every((choice) => choice.fieldKey === "scopeNotes")).toBe(true);
    expect(result.suggestedChoices.some((choice) => /itemize/i.test(choice.label))).toBe(false);
  });

  test("same surfaces blocker wording maps to one canonical step id", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "cust-1" },
        tradeInsert: { key: "painting" },
      },
      sectionKey: "scope",
      questionKey: "scopeNotes",
      plannerState: { painting: true, tradeKey: "painting" },
    });
    const suggestedChoices = [
      createGuidedOption({ fieldKey: "scopeNotes", label: "Walls only" }),
      createGuidedOption({ fieldKey: "scopeNotes", label: "Walls + ceilings" }),
      createGuidedOption({ fieldKey: "scopeNotes", label: "Walls + ceilings + trim" }),
    ];
    const rawGeneric = createAiResponse({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      prompt: "Which surfaces are included in the price?",
      promptIntent: "scope_surfaces",
      suggestedChoices,
    });
    const rawSpecific = createAiResponse({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      prompt: "Which surfaces are included: walls, ceilings, trim, doors, or closets?",
      promptIntent: "painting_surfaces",
      suggestedChoices,
    });

    const genericResult = await requestActualServiceTurn(payload, rawGeneric);
    const specificResult = await requestActualServiceTurn(payload, rawSpecific);

    expect(genericResult.result.stepRunnerState.activeStepId).toBe(specificResult.result.stepRunnerState.activeStepId);
    expect(genericResult.result.stepRunnerState.activeStepId).toMatch(/:surfaces$/);
  });

  test("surfaces blocker remains surfaced when it is the actual canonical blocker even if customer is still missing", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "" },
        tradeInsert: { key: "painting" },
      },
      sectionKey: "scope",
      questionKey: "scopeNotes",
      plannerState: { painting: true, tradeKey: "painting" },
    });
    const rawResponse = createAiResponse({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      prompt: "Which surfaces are included in the price?",
      promptIntent: "scope_surfaces",
      suggestedChoices: [
        createGuidedOption({ fieldKey: "scopeNotes", label: "Walls only" }),
        createGuidedOption({ fieldKey: "scopeNotes", label: "Walls + ceilings" }),
      ],
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

    expect(result.recommendedNextQuestion).toBe("scopeNotes");
    expect(result.recommendedNextSection).toBe("scope");
    expect(result.assistantMessage).toMatch(/surfaces/i);
    expect(result.suggestedChoices.every((choice) => choice.fieldKey === "scopeNotes")).toBe(true);
    expect(result.stepRunnerState.activeStepId).toMatch(/:surfaces$/);
  });

  test("trade blocker repairs to trade, not customer, when trade is the real missing prerequisite", async () => {
    const missingCustomerPayload = createActualServicePayload({
      state: {
        customer: { id: "" },
        tradeInsert: { key: "" },
      },
      sectionKey: "scope",
      questionKey: "scopeNotes",
    });
    const downstreamRaw = createAiResponse({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      prompt: "About how much floor area are we covering?",
      promptIntent: "flooring_quantity",
      suggestedChoices: [
        createGuidedOption({ fieldKey: "scopeNotes", label: "A few connected rooms" }),
      ],
    });

    const missingCustomer = await requestActualServiceTurn(missingCustomerPayload, downstreamRaw);
    expect(missingCustomer.result.recommendedNextQuestion).toBe("tradeInsert.key");
    expect(missingCustomer.result.recommendedNextSection).toBe("scope");

    const missingTradePayload = createActualServicePayload({
      state: {
        customer: { id: "cust-1" },
        tradeInsert: { key: "" },
      },
      sectionKey: "scope",
      questionKey: "scopeNotes",
    });
    const missingTrade = await requestActualServiceTurn(missingTradePayload, downstreamRaw);
    expect(missingTrade.result.recommendedNextQuestion).toBe("tradeInsert.key");
    expect(missingTrade.result.recommendedNextSection).toBe("scope");
  });

  test("invalid mixed family contract is rebuilt before surfacing", async () => {
    const payload = createActualServicePayload({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      plannerState: { painting: true, tradeKey: "painting" },
    });
    const rawResponse = createAiResponse({
      sectionKey: "customer",
      questionKey: "scopeNotes",
      prompt: "Which surfaces are included: walls, ceilings, trim, doors, or closets?",
      promptIntent: "painting_surfaces",
      suggestedChoices: [
        createGuidedOption({ fieldKey: "tradeInsert.key", label: "Painting", value: "painting" }),
      ],
      recommendedNextSection: "customer",
      recommendedNextQuestion: "scopeNotes",
      stepRunnerState: {
        activeSectionKey: "customer",
        activeFieldKey: "tradeInsert.key",
        activePrompt: "Which surfaces are included: walls, ceilings, trim, doors, or closets?",
        promptIntent: "painting_surfaces",
      },
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

    expect(result.recommendedNextSection).toBe("scope");
    expect(result.recommendedNextQuestion).toBe("scopeNotes");
    expect(result.nextBestQuestion.sectionKey).toBe("scope");
    expect(result.nextBestQuestion.fieldKey).toBe("scopeNotes");
    expect(result.stepRunnerState.activeSectionKey).toBe("scope");
    expect(result.stepRunnerState.activeFieldKey).toBe("scopeNotes");
    expect(result.suggestedChoices.every((choice) => choice.fieldKey === "scopeNotes")).toBe(true);
  });

  test("adaptive prompt wording changes without changing canonical blocker identity", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "cust-1", projectAddress: "", state: "" },
        tradeInsert: { key: "painting" },
      },
      sectionKey: "scope",
      questionKey: "scopeNotes",
      plannerState: { painting: true, tradeKey: "painting" },
      activeStep: {
        fieldKey: "scopeNotes",
        sectionKey: "scope",
        promptIntent: "painting_surfaces",
        promptText: "Which surfaces are included: walls, ceilings, trim, doors, or closets?",
        suggestedChoices: [
          createGuidedOption({ fieldKey: "scopeNotes", label: "Walls only" }),
          createGuidedOption({ fieldKey: "scopeNotes", label: "Walls + ceilings" }),
          createGuidedOption({ fieldKey: "scopeNotes", label: "Walls + ceilings + trim" }),
        ],
      },
      turnState: { repeatedUnresolvedCount: 1, turnDiagnosis: "invalid_for_step" },
    });
    const rawResponse = createAdaptivePromptResponse({
      promptText: "For surfaces, I already have the walls. Are ceilings included too, or is it walls only?",
      promptVariant: "narrow_clarify",
      answerClassification: "unresolved_clarify",
      clarificationText: "For surfaces, I already have the walls. Are ceilings included too, or is it walls only?",
      missingComponents: ["coverageKnown", "surfaceExclusionsKnown"],
      reasoningSummary: "The blocker still needs a tighter surfaces read.",
      confidence: 0.92,
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

  expect(result.assistantMessage).toBe("For surfaces, I already have the walls. Are ceilings included too, or is it walls only?");
    expect(result.recommendedNextQuestion).toBe("scopeNotes");
    expect(result.recommendedNextSection).toBe("scope");
    expect(result.stepRunnerState.activeFieldKey).toBe("scopeNotes");
    expect(result.stepRunnerState.activeSectionKey).toBe("scope");
    expect(result.stepRunnerState.activeStepId).toMatch(/:surfaces$/);
    expect(result.stepRunnerState.turnDiagnosis).toBe("unresolved_clarify");
    expect(result.suggestedChoices.every((choice) => choice.fieldKey === "scopeNotes")).toBe(true);
  });

  test("same-blocker rewording does not count as progression", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "cust-1" },
        tradeInsert: { key: "painting" },
      },
      sectionKey: "scope",
      questionKey: "scopeNotes",
      plannerState: { painting: true, tradeKey: "painting" },
      activeStep: {
        fieldKey: "scopeNotes",
        sectionKey: "scope",
        promptIntent: "painting_surfaces",
        promptText: "Which surfaces are included: walls, ceilings, trim, doors, or closets?",
        suggestedChoices: [
          createGuidedOption({ fieldKey: "scopeNotes", label: "Walls only" }),
          createGuidedOption({ fieldKey: "scopeNotes", label: "Walls + ceilings" }),
        ],
      },
      turnState: { repeatedUnresolvedCount: 0, turnDiagnosis: "unresolved_clarify" },
    });
    const rawResponse = createAdaptivePromptResponse({
      promptText: "Which surfaces should I carry here: just walls, walls and ceilings, or trim too?",
      promptVariant: "clarify",
      answerClassification: "unresolved_clarify",
      clarificationText: "Which surfaces should I carry here: just walls, walls and ceilings, or trim too?",
      missingComponents: ["coverageKnown", "surfaceExclusionsKnown"],
      reasoningSummary: "The answer still needs surfaces detail.",
      confidence: 0.84,
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

    expect(result.recommendedNextQuestion).toBe("scopeNotes");
    expect(result.recommendedNextSection).toBe("scope");
    expect(result.stepRunnerState.activeFieldKey).toBe("scopeNotes");
    expect(result.stepRunnerState.activeStepId).toMatch(/:surfaces$/);
    expect(result.stepRunnerState.turnDiagnosis).toBe("unresolved_clarify");
  });

  test("family-drifting adaptive Groq output is rejected and repaired locally", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "cust-1" },
        tradeInsert: { key: "painting" },
      },
      sectionKey: "scope",
      questionKey: "scopeNotes",
      plannerState: { painting: true, tradeKey: "painting" },
      activeStep: {
        fieldKey: "scopeNotes",
        sectionKey: "scope",
        promptIntent: "painting_surfaces",
        promptText: "Which surfaces are included: walls, ceilings, trim, doors, or closets?",
        suggestedChoices: [
          createGuidedOption({ fieldKey: "scopeNotes", label: "Walls only" }),
          createGuidedOption({ fieldKey: "scopeNotes", label: "Walls + ceilings" }),
        ],
      },
      turnState: { repeatedUnresolvedCount: 1, turnDiagnosis: "invalid_for_step" },
    });
    const rawResponse = createAdaptivePromptResponse({
      promptText: "What kind of work is this?",
      promptVariant: "repair",
      answerClassification: "invalid_for_step",
      clarificationText: "What kind of work is this?",
      missingComponents: ["tradeRecognized"],
      reasoningSummary: "Drifted into trade.",
      confidence: 0.45,
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

    expect(result.assistantMessage).not.toBe("What kind of work is this?");
    expect(result.assistantMessage).toMatch(/surfaces/i);
    expect(result.recommendedNextQuestion).toBe("scopeNotes");
    expect(result.recommendedNextSection).toBe("scope");
    expect(result.stepRunnerState.activeStepId).toMatch(/:surfaces$/);
    expect(result.suggestedChoices.every((choice) => choice.fieldKey === "scopeNotes")).toBe(true);
  });

  test("generic adaptive Groq wording falls back to local blocker-scoped clarification", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "cust-1" },
        tradeInsert: { key: "painting" },
      },
      sectionKey: "scope",
      questionKey: "scopeNotes",
      plannerState: { painting: true, tradeKey: "painting" },
      activeStep: {
        fieldKey: "scopeNotes",
        sectionKey: "scope",
        promptIntent: "painting_surfaces",
        promptText: "Which surfaces are included: walls, ceilings, trim, doors, or closets?",
        suggestedChoices: [
          createGuidedOption({ fieldKey: "scopeNotes", label: "Walls only" }),
          createGuidedOption({ fieldKey: "scopeNotes", label: "Walls + ceilings" }),
        ],
      },
      turnState: { repeatedUnresolvedCount: 1, turnDiagnosis: "invalid_for_step" },
    });
    const rawResponse = createAdaptivePromptResponse({
      promptText: "What should I price next?",
      promptVariant: "repair",
      answerClassification: "invalid_for_step",
      clarificationText: "What should I price next?",
      missingComponents: ["coverageKnown", "surfaceExclusionsKnown"],
      reasoningSummary: "Generic fallback.",
      confidence: 0.31,
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

    expect(result.assistantMessage).not.toBe("What should I price next?");
    expect(result.assistantMessage).toMatch(/surfaces/i);
    expect(result.recommendedNextQuestion).toBe("scopeNotes");
    expect(result.stepRunnerState.activeStepId).toMatch(/:surfaces$/);
  });

  test("repeated unresolved turns produce narrower adaptive clarifications on the same blocker", async () => {
    const payload = createActualServicePayload({
      state: {
        customer: { id: "cust-1" },
        tradeInsert: { key: "painting" },
      },
      sectionKey: "scope",
      questionKey: "scopeNotes",
      plannerState: { painting: true, tradeKey: "painting" },
      activeStep: {
        fieldKey: "scopeNotes",
        sectionKey: "scope",
        promptIntent: "painting_occupancy",
        promptText: "Will the work be done in an occupied space, a furnished space, or a vacant one?",
        suggestedChoices: createOccupancyChoices(),
      },
      turnState: { repeatedUnresolvedCount: 2, turnDiagnosis: "repeated_unresolved" },
    });
    const rawResponse = createAdaptivePromptResponse({
      promptText: "I still need one of these for this step: occupied, occupied with furniture, or vacant.",
      promptVariant: "repair",
      answerClassification: "repeated_unresolved",
      clarificationText: "I still need one of these for this step: occupied, occupied with furniture, or vacant.",
      missingComponents: ["occupancyKnown"],
      reasoningSummary: "The blocker still needs occupancy classification.",
      confidence: 0.89,
    });

    const { result } = await requestActualServiceTurn(payload, rawResponse);

    expect(result.assistantMessage).toBe("I still need one of these for this step: occupied, occupied with furniture, or vacant.");
    expect(result.recommendedNextQuestion).toBe("scopeNotes");
    expect(result.recommendedNextSection).toBe("scope");
    expect(result.stepRunnerState.activeFieldKey).toBe("scopeNotes");
    expect(result.stepRunnerState.promptIntent).toBe("painting_occupancy");
    expect(result.stepRunnerState.turnDiagnosis).toBe("escalated_to_groq");
    expect(result.suggestedChoices.every((choice) => choice.fieldKey === "scopeNotes")).toBe(true);
  });
});

describe("useGuidedBuild regression coverage", () => {
  test("confirmPending refreshes the active prompt and options to the recalculated next step", async () => {
    const { result } = renderGuidedHook();

    await act(async () => {
      await result.current.openGuided();
    });

    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).toBe("Prompt for scopeNotes");

    await act(async () => {
      await result.current.selectChoice(createChoice());
    });

    expect(result.current.guided.pendingConfirmations).toHaveLength(1);

    act(() => {
      result.current.confirmPending("confirm-materials-mode");
    });

    expect(result.current.guided.pendingConfirmations).toHaveLength(0);
    expect(result.current.guided.currentQuestion).toBe("materials.blanketCost");
    expect(result.current.guided.assistantMessage).toBe("Prompt for materials.blanketCost");
    expect(result.current.guided.suggestedChoices).toEqual([
      expect.objectContaining({ label: "Choice for materials.blanketCost", fieldKey: "materials.blanketCost" }),
    ]);
  });

  test("rejectPending refreshes the active prompt and options to the recalculated next step", async () => {
    const { result } = renderGuidedHook();

    await act(async () => {
      await result.current.openGuided();
    });

    await act(async () => {
      await result.current.selectChoice(createChoice());
    });

    expect(result.current.guided.pendingConfirmations).toHaveLength(1);

    act(() => {
      result.current.rejectPending("confirm-materials-mode");
    });

    expect(result.current.guided.pendingConfirmations).toHaveLength(0);
    expect(result.current.guided.currentQuestion).toBe("materials.blanketCost");
    expect(result.current.guided.assistantMessage).toBe("Prompt for materials.blanketCost");
    expect(result.current.guided.suggestedChoices).toEqual([
      expect.objectContaining({ label: "Choice for materials.blanketCost", fieldKey: "materials.blanketCost" }),
    ]);
  });

  test("openReview is blocked while pending confirmations still need action", async () => {
    const { result } = renderGuidedHook();

    await act(async () => {
      await result.current.openGuided();
    });

    await act(async () => {
      await result.current.selectChoice(createChoice());
    });

    expect(result.current.guided.pendingConfirmations).toHaveLength(1);

    act(() => {
      result.current.openReview();
    });

    expect(result.current.guided.reviewOpen).toBe(false);
    expect(result.current.guided.pendingConfirmations).toHaveLength(1);
    expect(result.current.guided.warnings).toContain("Finish the item above first, then review the estimate.");
  });

  test("repeated gibberish stays on the painting surfaces step and escalates without falling back generically", async () => {
    const { result } = renderGuidedHook(createPaintingSurfaceState());

    await act(async () => {
      await result.current.openGuided();
    });

    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).toBe(PAINT_SURFACES_PROMPT);

    await act(async () => {
      await result.current.submitAnswer("asdfasdf");
    });

    expect(mockRequestGuidedBuildTurn).not.toHaveBeenCalled();
    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).toBe(PAINT_SURFACES_CLARIFY_PROMPT);
    expect(result.current.guided.assistantMessage).not.toBe(WEAK_GUIDED_FALLBACK_PROMPT);
    expect(result.current.guided.turnDiagnosis).toBe("invalid_for_step");
    expect(result.current.guided.repeatedUnresolvedCount).toBe(1);

    await act(async () => {
      await result.current.submitAnswer("qwerqwer");
    });

    expect(mockRequestGuidedBuildTurn).toHaveBeenCalledTimes(1);
    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).toBe(PAINT_SURFACES_CLARIFY_PROMPT);
    expect(result.current.guided.assistantMessage).not.toBe(WEAK_GUIDED_FALLBACK_PROMPT);
    expect(result.current.guided.turnDiagnosis).toBe("escalated_to_groq");
  });

  test("same-step weak fallback wording still counts as repeated unresolved and escalates with step-scoped payload", async () => {
    const { result } = renderGuidedHook(createPaintingSurfaceLoopSwapState());

    await act(async () => {
      await result.current.openGuided();
    });

    expect(result.current.guided.assistantMessage).toBe(PAINT_SURFACES_PROMPT);

    await act(async () => {
      await result.current.submitAnswer("asdfasdf");
    });

    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).toBe(WEAK_GUIDED_FALLBACK_PROMPT);
    expect(result.current.guided.turnDiagnosis).toBe("invalid_for_step");
    expect(result.current.guided.repeatedUnresolvedCount).toBe(1);

    await act(async () => {
      await result.current.submitAnswer("zzzzzz");
    });

    expect(mockRequestGuidedBuildTurn).toHaveBeenCalledTimes(1);
    const [payload, preview] = mockRequestGuidedBuildTurn.mock.calls[0];

    expect(payload).toEqual(expect.objectContaining({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      userAnswer: "zzzzzz",
      activeStep: expect.objectContaining({
        fieldKey: "scopeNotes",
        sectionKey: "scope",
        promptText: WEAK_GUIDED_FALLBACK_PROMPT,
        promptIntent: "painting_surfaces",
        expectedAnswerMode: "mixed_multi_part",
        expectedComponents: expect.arrayContaining(["coverageKnown", "surfaceExclusionsKnown"]),
      }),
      turnState: expect.objectContaining({
        repeatedUnresolvedCount: 1,
        turnDiagnosis: "invalid_for_step",
      }),
    }));
    expect(payload.currentSuggestedChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Walls only", fieldKey: "scopeNotes" }),
      expect.objectContaining({ label: "Walls + ceilings", fieldKey: "scopeNotes" }),
    ]));
    expect(preview.requestBody).toEqual(expect.objectContaining({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      currentPrompt: WEAK_GUIDED_FALLBACK_PROMPT,
      userAnswer: "zzzzzz",
      activeStep: expect.objectContaining({
        fieldKey: "scopeNotes",
        promptText: WEAK_GUIDED_FALLBACK_PROMPT,
        promptIntent: "painting_surfaces",
        expectedAnswerMode: "mixed_multi_part",
      }),
      turnState: expect.objectContaining({
        repeatedUnresolvedCount: 1,
        turnDiagnosis: "invalid_for_step",
      }),
      estimateContext: expect.objectContaining({
        materialsPath: "itemized",
      }),
    }));
    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).toBe(PAINT_SURFACES_CLARIFY_PROMPT);
    expect(result.current.guided.turnDiagnosis).toBe("escalated_to_groq");
  });

  test.each([
    ["walls", "partial"],
    ["doors", "partial"],
    ["trim only", "partial"],
    ["none", "unresolved_clarify"],
  ])("short answer %s is not treated as gibberish on the painting surfaces step", async (answer, diagnosis) => {
    const { result } = renderGuidedHook(createPaintingSurfaceState());

    await act(async () => {
      await result.current.openGuided();
    });

    await act(async () => {
      await result.current.submitAnswer(answer);
    });

    expect(mockRequestGuidedBuildTurn).not.toHaveBeenCalled();
    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).not.toBe(WEAK_GUIDED_FALLBACK_PROMPT);
    expect(result.current.guided.turnDiagnosis).toBe(diagnosis);
    expect(result.current.guided.turnDiagnosis).not.toBe("invalid_for_step");
  });

  test("partial valid surface answers stay scoped to the same step instead of resetting intake", async () => {
    const { result } = renderGuidedHook(createPaintingSurfaceState());

    await act(async () => {
      await result.current.openGuided();
    });

    await act(async () => {
      await result.current.submitAnswer("walls and ceilings");
    });

    expect(mockRequestGuidedBuildTurn).not.toHaveBeenCalled();
    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).toBe(PAINT_SURFACES_MIXED_PROMPT);
    expect(result.current.guided.assistantMessage).not.toBe(WEAK_GUIDED_FALLBACK_PROMPT);
    expect(result.current.guided.turnDiagnosis).toBe("partial");
  });

  test("clicking Occupied on the occupancy step progresses instead of dead-ending in direct writeback", async () => {
    const { result } = renderGuidedHook(createOccupancyState());

    await act(async () => {
      await result.current.openGuided();
    });

    expect(result.current.guided.assistantMessage).toBe(OCCUPANCY_PROMPT);

    await act(async () => {
      await result.current.selectChoice(createOccupancyChoices()[0]);
    });

    expect(mockApplyGuidedWrites).not.toHaveBeenCalled();
    expect(mockRequestGuidedBuildTurn).not.toHaveBeenCalled();
    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).toBe(PAINT_PREP_PROMPT);
    expect(result.current.guided.turnDiagnosis).toBe("resolved");
  });

  test("typing occupied on the occupancy step progresses to the next blocker", async () => {
    const { result } = renderGuidedHook(createOccupancyState());

    await act(async () => {
      await result.current.openGuided();
    });

    await act(async () => {
      await result.current.submitAnswer("occupied");
    });

    expect(mockRequestGuidedBuildTurn).not.toHaveBeenCalled();
    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).toBe(PAINT_PREP_PROMPT);
    expect(result.current.guided.turnDiagnosis).toBe("resolved");
  });

  test("invalid occupancy input stays on the same step with step-scoped clarification and no generic fallback", async () => {
    const { result } = renderGuidedHook(createOccupancyState());

    await act(async () => {
      await result.current.openGuided();
    });

    await act(async () => {
      await result.current.submitAnswer("asdfasdf");
    });

    expect(mockRequestGuidedBuildTurn).not.toHaveBeenCalled();
    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).toBe(OCCUPANCY_CLARIFY_PROMPT);
    expect(result.current.guided.assistantMessage).not.toBe(WEAK_GUIDED_FALLBACK_PROMPT);
    expect(result.current.guided.turnDiagnosis).toBe("invalid_for_step");
  });

  test("repeated unresolved occupancy input forces Groq escalation locked to the same active step", async () => {
    const { result } = renderGuidedHook(createOccupancyState());

    await act(async () => {
      await result.current.openGuided();
    });

    await act(async () => {
      await result.current.submitAnswer("asdfasdf");
    });

    expect(result.current.guided.repeatedUnresolvedCount).toBe(1);

    await act(async () => {
      await result.current.submitAnswer("qwerqwer");
    });

    expect(mockRequestGuidedBuildTurn).toHaveBeenCalledTimes(1);
    const [payload, preview] = mockRequestGuidedBuildTurn.mock.calls[0];
    expect(payload).toEqual(expect.objectContaining({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      currentPrompt: OCCUPANCY_CLARIFY_PROMPT,
      userAnswer: "qwerqwer",
      activeStep: expect.objectContaining({
        fieldKey: "scopeNotes",
        sectionKey: "scope",
        promptText: OCCUPANCY_CLARIFY_PROMPT,
        promptIntent: "painting_occupancy",
        expectedAnswerMode: "single_select",
        expectedComponents: expect.arrayContaining(["occupancyKnown"]),
      }),
      turnState: expect.objectContaining({
        repeatedUnresolvedCount: 1,
        turnDiagnosis: "invalid_for_step",
      }),
    }));
    expect(payload.currentSuggestedChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Occupied", fieldKey: "scopeNotes" }),
      expect.objectContaining({ label: "Vacant", fieldKey: "scopeNotes" }),
    ]));
    expect(preview.requestBody).toEqual(expect.objectContaining({
      sectionKey: "scope",
      questionKey: "scopeNotes",
      currentPrompt: OCCUPANCY_CLARIFY_PROMPT,
      userAnswer: "qwerqwer",
      activeStep: expect.objectContaining({
        promptIntent: "painting_occupancy",
        expectedAnswerMode: "single_select",
      }),
      turnState: expect.objectContaining({
        repeatedUnresolvedCount: 1,
        turnDiagnosis: "invalid_for_step",
      }),
    }));
    expect(result.current.guided.currentQuestion).toBe("scopeNotes");
    expect(result.current.guided.assistantMessage).toBe(OCCUPANCY_CLARIFY_PROMPT);
    expect(result.current.guided.assistantMessage).not.toBe(WEAK_GUIDED_FALLBACK_PROMPT);
    expect(result.current.guided.turnDiagnosis).toBe("escalated_to_groq");
  });

  test("close and reopen starts a fresh guided session from current builder state instead of stale session residue", async () => {
    const initialState = createState();
    const { result, rerender, patch } = renderGuidedHook(initialState);

    await act(async () => {
      await result.current.openGuided();
    });

    await act(async () => {
      await result.current.submitAnswer("Interior repaint with one color");
    });

    expect(result.current.guided.answeredPrompts).toHaveLength(1);
    expect(result.current.guided.plannerState).toEqual(expect.objectContaining({ scopeCaptured: true }));

    act(() => {
      result.current.closeGuided();
    });

    expect(result.current.guided.enabled).toBe(false);
    expect(result.current.guided.answeredPrompts).toEqual([]);
    expect(result.current.guided.pendingConfirmations).toEqual([]);
    expect(result.current.guided.plannerState).toEqual({});

    const updatedState = createState({
      __defaultTarget: { sectionKey: "materials", questionKey: "materials.blanketCost" },
      __audit: createAudit({ ready: true }),
    });

    rerender({
      liveState: updatedState,
      options: {},
    });

    await act(async () => {
      await result.current.openGuided();
    });

    expect(result.current.guided.currentQuestion).toBe("materials.blanketCost");
    expect(result.current.guided.assistantMessage).toBe("Prompt for materials.blanketCost");
    expect(mockPreviewGuidedBuildTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      questionKey: "materials.blanketCost",
      answeredPrompts: [],
      plannerState: {},
    }));
    expect(patch).not.toHaveBeenCalled();
  });

  test("cleared blank builder state resets guided progress and drops stale guided meta on reopen", async () => {
    const staleInitialFieldMeta = {
      ui: { touched: true },
      "ui.materialsMode": { pendingConfirmation: true, source: "ai", confidence: 0.82 },
      __guidedPlanner: { scopeCaptured: true, lastAnsweredFieldKey: "scopeNotes" },
    };
    const draftState = createState({
      customer: { id: "cust-1", name: "Acme" },
      scopeNotes: "Interior repaint",
      tradeInsert: { key: "painting" },
      __defaultTarget: { sectionKey: "materials", questionKey: "materials.blanketCost" },
      __audit: createAudit({ ready: true, pendingConfirmation: true }),
    });
    const { result, rerender } = renderGuidedHook(draftState, { initialFieldMeta: staleInitialFieldMeta });

    await act(async () => {
      await result.current.openGuided();
    });

    await act(async () => {
      await result.current.submitAnswer("Interior repaint with one color");
    });

    expect(result.current.guided.answeredPrompts).toHaveLength(1);
    expect(result.current.guided.plannerState).toEqual(expect.objectContaining({ scopeCaptured: true }));

    const clearedState = createLiveClearedEstimatorState({
      __defaultTarget: { sectionKey: "scope", questionKey: "scopeNotes" },
      __audit: createOptionalInflatedAudit(),
    });

    rerender({
      liveState: clearedState,
      options: { initialFieldMeta: staleInitialFieldMeta },
    });

    const reloaded = renderGuidedHook(clearedState, { initialFieldMeta: staleInitialFieldMeta });

    expect(reloaded.result.current.guided.fieldMeta).toEqual({ __guidedPlanner: {} });
    expect(reloaded.result.current.guided.plannerState).toEqual({});
    expect(reloaded.result.current.guided.reviewReadiness).toEqual(expect.objectContaining({ ready: false, score: 0 }));
    expect(reloaded.result.current.guided.completionAudit).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ complete: 0, missing: 3, needs_confirmation: 0 }),
      unresolvedFields: ["customer.id", "scopeNotes", "materials.items"],
    }));

    await act(async () => {
      await reloaded.result.current.openGuided();
    });

    expect(reloaded.result.current.guided.currentSection).toBe("customer");
    expect(reloaded.result.current.guided.currentQuestion).toBe("customer.id");
    expect(reloaded.result.current.guided.answeredPrompts).toEqual([]);
    expect(reloaded.result.current.guided.pendingConfirmations).toEqual([]);
    expect(reloaded.result.current.guided.plannerState).toEqual({});
    expect(reloaded.result.current.guided.reviewReadiness).toEqual(expect.objectContaining({ ready: false, score: 0 }));
    expect(mockPreviewGuidedBuildTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      state: clearedState,
      questionKey: "customer.id",
      answeredPrompts: [],
      guidedMeta: {},
      plannerState: {},
    }));
  });

  test("blank first-open bootstrap ignores stale prior section and progress runtime state", async () => {
    const staleInitialFieldMeta = {
      __guidedPlanner: { scopeCaptured: true, tradeKey: "painting", lastAnsweredFieldKey: "scopeNotes" },
      "tradeInsert.key": { source: "manual", confidence: 1 },
      "ui.materialsMode": { pendingConfirmation: true, source: "ai", confidence: 0.82 },
    };
    const seededState = createState({
      customer: { id: "cust-1", name: "Acme" },
      scopeNotes: "Interior repaint",
      tradeInsert: { key: "painting" },
      __defaultTarget: { sectionKey: "materials", questionKey: "materials.blanketCost" },
      __audit: createAudit({ ready: true, pendingConfirmation: true }),
    });
    const { result, rerender } = renderGuidedHook(seededState, { initialFieldMeta: staleInitialFieldMeta });

    await act(async () => {
      await result.current.openGuided();
    });

    await act(async () => {
      await result.current.submitAnswer("Interior repaint with one color");
    });

    act(() => {
      result.current.closeGuided();
    });

    const blankState = createLiveClearedEstimatorState({
      additionalNotes: "Auto-saved note should not make this resumable.",
      job: { date: "2026-03-16", location: "", poNumber: "", due: "", docNumber: "EST-1042" },
      __defaultTarget: { sectionKey: "scope", questionKey: "scopeNotes" },
      __audit: createOptionalInflatedAudit(),
    });

    rerender({
      liveState: blankState,
      options: { initialFieldMeta: staleInitialFieldMeta },
    });

    expect(result.current.guided.currentSection).toBe("customer");
    expect(result.current.guided.currentQuestion).toBe("customer.id");
    expect(result.current.guided.activeStepId).toBe("customer:customer.id");
    expect(result.current.guided.assistantMessage).toBe("Prompt for customer.id");
    expect(result.current.guided.answeredPrompts).toEqual([]);
    expect(result.current.guided.pendingConfirmations).toEqual([]);
    expect(result.current.guided.plannerState).toEqual({});
    expect(result.current.guided.fieldMeta).toEqual({ __guidedPlanner: {} });
    expect(result.current.guided.reviewReadiness).toEqual(expect.objectContaining({ ready: false, score: 0 }));
    expect(getAuditProgressPercent(result.current.guided.completionAudit)).toBe(0);
    expect(getHeaderProgressPercent(result.current.guided)).toBe(0);
    expect(getHeaderProgressMode(result.current.guided)).toBe("canonicalBlank");
    expect(getVisibleDebugHeaderProgressSource(result.current.guided)).toBe("headerProgressPercent");
    expect(result.current.guided.completionAudit).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ complete: 0, missing: 3, needs_confirmation: 0 }),
      unresolvedFields: ["customer.id", "scopeNotes", "materials.items"],
    }));

    await act(async () => {
      await result.current.openGuided();
    });

    expect(result.current.guided.currentSection).toBe("customer");
    expect(result.current.guided.currentQuestion).toBe("customer.id");
    expect(result.current.guided.activeStepId).toBe("customer:customer.id");
    expect(result.current.guided.assistantMessage).toBe("Prompt for customer.id");
    expect(result.current.guided.answeredPrompts).toEqual([]);
    expect(result.current.guided.pendingConfirmations).toEqual([]);
    expect(result.current.guided.plannerState).toEqual({});
    expect(result.current.guided.fieldMeta).toEqual({ __guidedPlanner: {} });
    expect(result.current.guided.reviewReadiness).toEqual(expect.objectContaining({ ready: false, score: 0 }));
    expect(getAuditProgressPercent(result.current.guided.completionAudit)).toBe(0);
    expect(getHeaderProgressPercent(result.current.guided)).toBe(0);
    expect(getHeaderProgressMode(result.current.guided)).toBe("canonicalBlank");
    expect(getVisibleDebugHeaderProgressSource(result.current.guided)).toBe("headerProgressPercent");
    expect(result.current.guided.completionAudit).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ complete: 0, missing: 3, needs_confirmation: 0 }),
      unresolvedFields: ["customer.id", "scopeNotes", "materials.items"],
    }));
    expect(mockPreviewGuidedBuildTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      state: blankState,
      sectionKey: "customer",
      questionKey: "customer.id",
      answeredPrompts: [],
      guidedMeta: {},
      plannerState: {},
    }));
  });

  test("canonical blank bootstrap ignores preview-supplied inflated audit and keeps true blank progress", async () => {
    const originalPreviewImpl = mockPreviewGuidedBuildTurn.getMockImplementation();
    mockPreviewGuidedBuildTurn.mockImplementation((payload = {}) => {
      if (
        String(payload?.questionKey || "").trim() === "customer.id"
        && !String(payload?.userAnswer || "").trim()
      ) {
        const preview = buildPreviewFixture(payload, buildGuidedStepResponse({
          sectionKey: "customer",
          questionKey: "customer.id",
          prompt: "Prompt for customer.id",
          suggestedChoices: [],
        }));
        return {
          ...preview,
          localTurn: {
            ...preview.localTurn,
            target: {
              ...preview.localTurn.target,
              audit: createOptionalInflatedAudit(),
            },
          },
        };
      }
      return originalPreviewImpl(payload);
    });

    try {
      const blankState = createLiveClearedEstimatorState({
        __defaultTarget: { sectionKey: "scope", questionKey: "scopeNotes" },
        __audit: createOptionalInflatedAudit(),
      });
      const { result } = renderGuidedHook(blankState, {
        initialFieldMeta: {
          __guidedPlanner: { scopeCaptured: true, tradeRecognized: true, tradeKey: "painting" },
          "tradeInsert.key": { source: "manual", confidence: 1 },
        },
      });

      await act(async () => {
        await result.current.openGuided();
      });

      expect(result.current.guided.currentSection).toBe("customer");
      expect(result.current.guided.currentQuestion).toBe("customer.id");
      expect(result.current.guided.activeStepId).toBe("customer:customer.id");
      expect(result.current.guided.reviewReadiness).toEqual(expect.objectContaining({ ready: false, score: 0 }));
      expect(getAuditProgressPercent(result.current.guided.completionAudit)).toBe(0);
      expect(getHeaderProgressPercent(result.current.guided)).toBe(0);
      expect(getHeaderProgressMode(result.current.guided)).toBe("canonicalBlank");
      expect(getVisibleDebugHeaderProgressSource(result.current.guided)).toBe("headerProgressPercent");
      expect(result.current.guided.completionAudit).toEqual(expect.objectContaining({
        counts: expect.objectContaining({ complete: 0, inferred: 0, needs_confirmation: 0, missing: 3 }),
        unresolvedFields: ["customer.id", "scopeNotes", "materials.items"],
      }));
    } finally {
      mockPreviewGuidedBuildTurn.mockImplementation(originalPreviewImpl);
    }
  });

  test("enabled canonical blank session keeps canonical blank progress after blank rerender recompute", async () => {
    const blankState = createLiveClearedEstimatorState({
      __defaultTarget: { sectionKey: "scope", questionKey: "scopeNotes" },
      __audit: createOptionalInflatedAudit(),
    });
    const { result, rerender } = renderGuidedHook(blankState, {
      initialFieldMeta: {
        __guidedPlanner: { scopeCaptured: true, tradeRecognized: true, tradeKey: "painting" },
      },
    });

    await act(async () => {
      await result.current.openGuided();
    });

    expect(result.current.guided.enabled).toBe(true);
    expect(result.current.guided.isCanonicalBlankDisplay).toBe(true);
    expect(result.current.guided.currentSection).toBe("customer");
    expect(result.current.guided.currentQuestion).toBe("customer.id");
    expect(result.current.guided.reviewReadiness).toEqual(expect.objectContaining({ ready: false, score: 0 }));
    expect(getAuditProgressPercent(result.current.guided.completionAudit)).toBe(0);
    expect(getHeaderProgressPercent(result.current.guided)).toBe(0);
    expect(getHeaderProgressMode(result.current.guided)).toBe("canonicalBlank");
    expect(getVisibleDebugHeaderProgressSource(result.current.guided)).toBe("headerProgressPercent");

    rerender({
      liveState: createLiveClearedEstimatorState({
        additionalNotes: "optional leftover only",
        job: { date: "2026-03-16", location: "", poNumber: "", due: "", docNumber: "EST-1042" },
        __defaultTarget: { sectionKey: "scope", questionKey: "scopeNotes" },
        __audit: createOptionalInflatedAudit(),
      }),
      options: {
        initialFieldMeta: {
          __guidedPlanner: { scopeCaptured: true, tradeRecognized: true, tradeKey: "painting" },
        },
      },
    });

    expect(result.current.guided.enabled).toBe(true);
    expect(result.current.guided.isCanonicalBlankDisplay).toBe(true);
    expect(result.current.guided.currentSection).toBe("customer");
    expect(result.current.guided.currentQuestion).toBe("customer.id");
    expect(result.current.guided.reviewReadiness).toEqual(expect.objectContaining({ ready: false, score: 0 }));
    expect(getAuditProgressPercent(result.current.guided.completionAudit)).toBe(0);
    expect(getHeaderProgressPercent(result.current.guided)).toBe(0);
    expect(getHeaderProgressMode(result.current.guided)).toBe("canonicalBlank");
    expect(getVisibleDebugHeaderProgressSource(result.current.guided)).toBe("headerProgressPercent");
    expect(result.current.guided.completionAudit).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ complete: 0, inferred: 0, needs_confirmation: 0, missing: 3 }),
      unresolvedFields: ["customer.id", "scopeNotes", "materials.items"],
    }));
  });

  test("actual registry keeps blank first-open on the customer blocker despite stale scope-oriented planner residue", () => {
    const actualRegistry = jest.requireActual("./registry");
    const target = actualRegistry.chooseNextGuidedTarget({
      mode: "estimate",
      state: createLiveClearedEstimatorState(),
      guidedMeta: {
        __guidedPlanner: {
          scopeCaptured: true,
          tradeRecognized: true,
          tradeKey: "painting",
          lastAnsweredFieldKey: "scopeNotes",
        },
      },
      context: {},
    });

    expect(target.sectionKey).toBe("customer");
    expect(target.questionKey).toBe("customer.id");
  });

  test("already-open valid sessions preserve runtime state even after the builder becomes blank", async () => {
    const draftState = createState({
      customer: { id: "cust-1", name: "Acme" },
      scopeNotes: "Interior repaint",
      tradeInsert: { key: "painting" },
      __defaultTarget: { sectionKey: "materials", questionKey: "materials.blanketCost" },
      __audit: createAudit({ ready: false }),
    });
    const { result, rerender } = renderGuidedHook(draftState);

    await act(async () => {
      await result.current.openGuided();
    });

    expect(result.current.guided.enabled).toBe(true);
    expect(result.current.guided.currentSection).toBe("materials");
    expect(result.current.guided.currentQuestion).toBe("materials.blanketCost");

    rerender({
      liveState: createLiveClearedEstimatorState({
        additionalNotes: "Auto-saved note should not replace the active runtime step.",
        job: { date: "2026-03-16", location: "", poNumber: "", due: "", docNumber: "EST-1042" },
        __defaultTarget: { sectionKey: "scope", questionKey: "scopeNotes" },
        __audit: createOptionalInflatedAudit(),
      }),
    });

    expect(result.current.guided.enabled).toBe(true);
    expect(result.current.guided.currentSection).toBe("materials");
    expect(result.current.guided.currentQuestion).toBe("materials.blanketCost");
    expect(result.current.guided.assistantMessage).toBe("Prompt for materials.blanketCost");
  });

  test("blank estimate with many optional fields still reports very low progress", async () => {
    const blankState = createLiveClearedEstimatorState({
      additionalNotes: "Customer-supplied paint and limited access.",
      job: { date: "2026-03-16", location: "", poNumber: "", due: "", docNumber: "EST-1042" },
      __defaultTarget: { sectionKey: "customer", questionKey: "customer.id" },
      __audit: createOptionalInflatedAudit(),
    });
    const { result } = renderGuidedHook(blankState);

    await act(async () => {
      await result.current.openGuided();
    });

    expect(result.current.guided.currentSection).toBe("customer");
    expect(result.current.guided.currentQuestion).toBe("customer.id");
    expect(result.current.guided.reviewReadiness).toEqual(expect.objectContaining({ ready: false, score: 0 }));
    expect(getAuditProgressPercent(result.current.guided.completionAudit)).toBe(0);
    expect(getHeaderProgressPercent(result.current.guided)).toBe(0);
    expect(getHeaderProgressMode(result.current.guided)).toBe("canonicalBlank");
    expect(getVisibleDebugHeaderProgressSource(result.current.guided)).toBe("headerProgressPercent");
    expect(result.current.guided.completionAudit.counts).toEqual(expect.objectContaining({
      complete: 0,
      missing: 3,
    }));
  });

  test("overlay shows GBHDR-V3 and hard-locks canonical blank percent over inflated raw completion audit", () => {
    window.__ESTIPAID_GUIDED_DEBUG__ = true;

    try {
      render(
        <GuidedBuildOverlay
          guided={{
            enabled: true,
            reviewOpen: false,
            isCanonicalBlankDisplay: true,
            headerProgressMode: "canonicalBlank",
            headerProgressSource: "headerProgressPercent",
            headerProgressPercent: 0,
            headerProgressAudit: {
              counts: { complete: 0, inferred: 0, needs_confirmation: 0, missing: 3 },
              fields: [
                { key: "customer.id", label: "Customer", section: "customer", status: "missing" },
                { key: "scopeNotes", label: "Scope", section: "scope", status: "missing" },
                { key: "materials.items", label: "Materials Items", section: "materials", status: "missing" },
              ],
              sections: [
                { key: "customer", label: "Customer", status: "missing" },
                { key: "scope", label: "Scope", status: "missing" },
                { key: "materials", label: "Materials", status: "missing" },
              ],
            },
            completionAudit: createOptionalInflatedAudit(),
            reviewReadiness: { ready: false, score: 86, blockers: [], pendingConfirmations: [] },
            pendingConfirmations: [],
            currentSection: "customer",
            currentQuestion: "customer.id",
            activeStepId: "customer:customer.id",
            assistantMessage: "Prompt for customer.id",
            currentField: { key: "customer.id", label: "Customer" },
            isLoading: false,
          }}
          summary={createGuidedSummary()}
          isThinking={false}
          onClose={jest.fn()}
          onSubmitAnswer={jest.fn()}
          onSelectChoice={jest.fn()}
          onSkip={jest.fn()}
          onOpenReview={jest.fn()}
          onJumpToSection={jest.fn()}
          onConfirmPending={jest.fn()}
          onRejectPending={jest.fn()}
        />
      );

      expect(screen.getByText("0% built")).toBeInTheDocument();
      expect(screen.getByText(/GBHDR-V3 mode=canonicalBlank blank=1 shown=0 hdr=0 audit=0 raw=86 cbd=1 fcb=0/)).toBeInTheDocument();
    } finally {
      delete window.__ESTIPAID_GUIDED_DEBUG__;
    }
  });

  test("overlay hard-locks to 0% when isCanonicalBlankDisplay is true but headerProgressMode is missing (EstimateForm fail-closed path)", () => {
    window.__ESTIPAID_GUIDED_DEBUG__ = true;

    try {
      render(
        <GuidedBuildOverlay
          guided={{
            enabled: true,
            reviewOpen: false,
            isCanonicalBlankDisplay: true,
            failClosedBlankDisplayGuard: true,
            completionAudit: createOptionalInflatedAudit(),
            reviewReadiness: { ready: false, score: 86, blockers: [], pendingConfirmations: [] },
            pendingConfirmations: [],
            currentSection: "customer",
            currentQuestion: "customer.id",
            activeStepId: "customer:customer.id",
            assistantMessage: "Prompt for customer.id",
            currentField: { key: "customer.id", label: "Customer" },
            isLoading: false,
          }}
          summary={createGuidedSummary()}
          isThinking={false}
          onClose={jest.fn()}
          onSubmitAnswer={jest.fn()}
          onSelectChoice={jest.fn()}
          onSkip={jest.fn()}
          onOpenReview={jest.fn()}
          onJumpToSection={jest.fn()}
          onConfirmPending={jest.fn()}
          onRejectPending={jest.fn()}
        />
      );

      expect(screen.getByText("0% built")).toBeInTheDocument();
      expect(screen.getByText(/GBHDR-V3 mode=normal blank=1 shown=0 hdr=na audit=na raw=86 cbd=1 fcb=1/)).toBeInTheDocument();
    } finally {
      delete window.__ESTIPAID_GUIDED_DEBUG__;
    }
  });

  test("unresolved required blockers prevent inflated section completion from optional fields", () => {
    const partialState = createState({
      customer: { id: "cust-1", name: "Acme" },
      tradeInsert: { key: "painting" },
      scopeNotes: "Interior repaint",
      __defaultTarget: { sectionKey: "materials", questionKey: "materials.blanketCost" },
      __audit: {
        counts: { complete: 5, inferred: 0, needs_confirmation: 0, missing: 0 },
        fields: [
          { key: "customer.id", label: "Customer", section: "customer", status: "complete" },
          { key: "tradeInsert.key", label: "Trade", section: "scope", status: "complete" },
          { key: "scopeNotes", label: "Scope", section: "scope", status: "complete" },
          { key: "ui.materialsMode", label: "Materials Mode", section: "materials", status: "complete" },
          { key: "materials.markupPct", label: "Markup", section: "materials", status: "complete" },
        ],
        sections: [
          { key: "customer", label: "Customer", status: "complete", fields: [] },
          { key: "scope", label: "Scope", status: "complete", fields: [] },
          { key: "materials", label: "Materials", status: "complete", fields: [] },
        ],
        unresolvedFields: ["materials.blanketCost"],
        reviewReadiness: { ready: true, score: 100, blockers: [], pendingConfirmations: [] },
      },
    });
    const { result } = renderGuidedHook(partialState);

    expect(result.current.guided.completionAudit.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "materials", status: "missing" }),
    ]));
    expect(result.current.guided.reviewReadiness).toEqual(expect.objectContaining({ ready: false }));
    expect(result.current.guided.unresolvedRequiredFields).toContain("materials.blanketCost");
  });

  test("optional fields do not materially increase overall percent while required blockers remain unresolved", () => {
    const optionalHeavyState = createState({
      customer: { id: "cust-1", name: "Acme" },
      tradeInsert: { key: "painting" },
      __defaultTarget: { sectionKey: "scope", questionKey: "scopeNotes" },
      __audit: {
        counts: { complete: 7, inferred: 0, needs_confirmation: 0, missing: 0 },
        fields: [
          { key: "customer.id", label: "Customer", section: "customer", status: "complete" },
          { key: "customer.state", label: "State", section: "customer", status: "complete" },
          { key: "tradeInsert.key", label: "Trade", section: "scope", status: "complete" },
          { key: "ui.materialsMode", label: "Materials Mode", section: "materials", status: "complete" },
          { key: "materials.markupPct", label: "Markup", section: "materials", status: "complete" },
          { key: "additionalNotes", label: "Notes", section: "notes", status: "complete" },
          { key: "job.docNumber", label: "Estimate Number", section: "review", status: "complete" },
        ],
        sections: [
          { key: "customer", label: "Customer", status: "complete", fields: [] },
          { key: "scope", label: "Scope", status: "complete", fields: [] },
          { key: "materials", label: "Materials", status: "complete", fields: [] },
          { key: "notes", label: "Notes", status: "complete", fields: [] },
          { key: "review", label: "Review", status: "complete", fields: [] },
        ],
        unresolvedFields: ["scopeNotes"],
        reviewReadiness: { ready: true, score: 88, blockers: [], pendingConfirmations: [] },
      },
    });
    const { result } = renderGuidedHook(optionalHeavyState);
    const requiredOnlyState = createState({
      customer: { id: "cust-1", name: "Acme" },
      tradeInsert: { key: "painting" },
      __defaultTarget: { sectionKey: "scope", questionKey: "scopeNotes" },
      __audit: {
        counts: { complete: 2, inferred: 0, needs_confirmation: 0, missing: 0 },
        fields: [
          { key: "customer.id", label: "Customer", section: "customer", status: "complete" },
          { key: "tradeInsert.key", label: "Trade", section: "scope", status: "complete" },
        ],
        sections: [
          { key: "customer", label: "Customer", status: "complete", fields: [] },
          { key: "scope", label: "Scope", status: "complete", fields: [] },
          { key: "materials", label: "Materials", status: "complete", fields: [] },
          { key: "notes", label: "Notes", status: "complete", fields: [] },
          { key: "review", label: "Review", status: "complete", fields: [] },
        ],
        unresolvedFields: ["scopeNotes"],
        reviewReadiness: { ready: true, score: 88, blockers: [], pendingConfirmations: [] },
      },
    });
    const requiredOnly = renderGuidedHook(requiredOnlyState);

    expect(getAuditProgressPercent(result.current.guided.completionAudit)).toBe(getAuditProgressPercent(requiredOnly.result.current.guided.completionAudit));
    expect(result.current.guided.reviewReadiness).toEqual(expect.objectContaining({ ready: false, score: 67 }));
  });

  test("real required progress increases percent appropriately", () => {
    const progressState = createState({
      customer: { id: "cust-1", name: "Acme" },
      tradeInsert: { key: "painting" },
      scopeNotes: "Interior repaint",
      __defaultTarget: { sectionKey: "materials", questionKey: "materials.blanketCost" },
      __audit: {
        counts: { complete: 5, inferred: 0, needs_confirmation: 0, missing: 0 },
        fields: [
          { key: "customer.id", label: "Customer", section: "customer", status: "complete" },
          { key: "tradeInsert.key", label: "Trade", section: "scope", status: "complete" },
          { key: "scopeNotes", label: "Scope", section: "scope", status: "complete" },
          { key: "ui.materialsMode", label: "Materials Mode", section: "materials", status: "complete" },
          { key: "additionalNotes", label: "Notes", section: "notes", status: "complete" },
        ],
        sections: [
          { key: "customer", label: "Customer", status: "complete", fields: [] },
          { key: "scope", label: "Scope", status: "complete", fields: [] },
          { key: "materials", label: "Materials", status: "complete", fields: [] },
        ],
        unresolvedFields: ["materials.blanketCost"],
        reviewReadiness: { ready: false, score: 70, blockers: ["materials basis"], pendingConfirmations: [] },
      },
    });
    const { result } = renderGuidedHook(progressState);

    expect(getAuditProgressPercent(result.current.guided.completionAudit)).toBe(75);
    expect(result.current.guided.currentQuestion).toBe("materials.blanketCost");
    expect(result.current.guided.unresolvedRequiredFields).toContain("materials.blanketCost");
  });

  test("existing non-blank draft still resumes instead of resetting", async () => {
    const resumableFieldMeta = {
      __guidedPlanner: { scopeCaptured: true, lastAnsweredFieldKey: "scopeNotes" },
      "ui.materialsMode": { source: "manual", confidence: 1, pendingConfirmation: false },
    };
    const draftState = createState({
      customer: { id: "cust-1", name: "Acme" },
      scopeNotes: "Interior repaint",
      tradeInsert: { key: "painting" },
      __defaultTarget: { sectionKey: "materials", questionKey: "materials.blanketCost" },
      __afterConfirmationTarget: { sectionKey: "materials", questionKey: "materials.blanketCost" },
      __audit: createAudit({ ready: false }),
    });
    const { result } = renderGuidedHook(draftState, { initialFieldMeta: resumableFieldMeta });

    expect(result.current.guided.plannerState).toEqual(expect.objectContaining({ scopeCaptured: true }));

    await act(async () => {
      await result.current.openGuided();
    });

    expect(result.current.guided.currentQuestion).toBe("materials.blanketCost");
    expect(result.current.guided.plannerState).toEqual(expect.objectContaining({ scopeCaptured: true }));
    expect(mockPreviewGuidedBuildTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      state: draftState,
      questionKey: "materials.blanketCost",
      plannerState: expect.objectContaining({ scopeCaptured: true }),
      guidedMeta: expect.objectContaining({
        __guidedPlanner: expect.objectContaining({ scopeCaptured: true }),
      }),
    }));
  });

  test("hook does not overwrite a canonical service contract with stale recommended target fields", async () => {
    mockPreviewGuidedBuildTurn.mockImplementationOnce((payload = {}) => buildPreviewFixture(payload, {
      assistantMessage: "Who is the customer for this estimate?",
      suggestedChoices: [
        createGuidedOption({ fieldKey: "customer.id", label: "Acme Construction", value: "cust-1" }),
        createGuidedOption({ fieldKey: "customer.id", label: "Beta Builders", value: "cust-2" }),
      ],
      extractedFieldValues: [],
      fieldsNeedingConfirmation: [],
      unresolvedFields: ["customer.id"],
      recommendedNextSection: "scope",
      recommendedNextQuestion: "scopeNotes",
      nextBestQuestion: {
        fieldKey: "scopeNotes",
        sectionKey: "scope",
        question: "Stale scope target",
      },
      warnings: [],
      stepRunnerState: {
        canonicalStepId: "customer:customer.id:customer",
        activeStepId: "customer:customer.id:customer",
        activeSectionKey: "customer",
        activeFieldKey: "customer.id",
        activePrompt: "Who is the customer for this estimate?",
        promptIntent: "customer_selection",
        expectedAnswerMode: "single_select",
        expectedComponents: [],
        answeredComponents: [],
        missingComponents: [],
        nextQuestionReason: "customer_selection",
        resolutionSource: "preview",
        plannerState: {},
      },
    }));

    const { result } = renderGuidedHook(createState({
      customer: { id: "" },
      tradeInsert: { key: "" },
      __defaultTarget: { sectionKey: "scope", questionKey: "scopeNotes" },
    }));

    await act(async () => {
      await result.current.openGuided();
    });

    expect(result.current.guided.currentSection).toBe("customer");
    expect(result.current.guided.currentQuestion).toBe("customer.id");
    expect(result.current.guided.activeStepId).toBe("customer:customer.id:customer");
    expect(result.current.guided.assistantMessage).toBe("Who is the customer for this estimate?");
    expect(result.current.guided.suggestedChoices.every((choice) => choice.fieldKey === "customer.id")).toBe(true);
  });
});

describe("GuidedBuildOverlay regression coverage", () => {
  test("ready review hands off back to the builder instead of looping into guided sections", () => {
    const onClose = jest.fn();
    const onJumpToSection = jest.fn();

    render(
      <GuidedBuildOverlay
        guided={{
          enabled: true,
          reviewOpen: true,
          reviewReadiness: { ready: true, score: 100, blockers: [], pendingConfirmations: [] },
          pendingConfirmations: [],
          completionAudit: {
            counts: { complete: 3, inferred: 0, needs_confirmation: 0, missing: 0 },
            sections: [
              { key: "scope", label: "Scope", status: "complete" },
              { key: "materials", label: "Materials", status: "complete" },
              { key: "review", label: "Review", status: "complete" },
            ],
            fields: [],
          },
          currentSection: "review",
          currentQuestion: "job.docNumber",
          currentField: { key: "job.docNumber", label: "Estimate Number" },
          isLoading: false,
        }}
        summary={createGuidedSummary()}
        isThinking={false}
        onClose={onClose}
        onSubmitAnswer={jest.fn()}
        onSelectChoice={jest.fn()}
        onSkip={jest.fn()}
        onOpenReview={jest.fn()}
        onJumpToSection={onJumpToSection}
        onConfirmPending={jest.fn()}
        onRejectPending={jest.fn()}
      />
    );

    const handoffButton = screen.getByRole("button", { name: "Continue in Builder" });
    expect(handoffButton).toBeEnabled();

    fireEvent.click(handoffButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onJumpToSection).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Continue Guided Steps" })).not.toBeInTheDocument();
  });
});
