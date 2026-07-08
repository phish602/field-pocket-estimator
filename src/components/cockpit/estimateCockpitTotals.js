import { DEFAULT_STATE } from "../../estimator/defaultState";
import { computeTotals } from "../../estimator/engine";
import { DEFAULT_SETTINGS } from "../../utils/settings";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeDefaults(base, patch) {
  if (Array.isArray(base)) {
    return Array.isArray(patch) ? patch : base;
  }

  if (!isObject(base)) {
    return patch !== undefined ? patch : base;
  }

  const next = { ...base };
  if (!isObject(patch)) {
    return next;
  }

  Object.keys(patch).forEach((key) => {
    next[key] = mergeDefaults(base[key], patch[key]);
  });

  return next;
}

function toText(value) {
  return String(value || "").trim();
}

function toNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function hasMeaningfulLaborLine(line) {
  return Boolean(
    toText(line?.role)
    || toNumber(line?.hours)
    || toNumber(line?.rate)
    || toNumber(line?.effectiveRate)
  );
}

function hasMeaningfulItemizedMaterial(item) {
  return Boolean(
    toText(item?.desc)
    || toNumber(item?.priceEach)
    || toNumber(item?.effectivePriceEach)
    || toNumber(item?.charge)
  );
}

function hasMeaningfulBlanketMaterials(materials) {
  return Boolean(
    toNumber(materials?.blanketCost)
    || toNumber(materials?.blanketInternalCost)
    || toText(materials?.materialsBlanketDescription)
  );
}

export function normalizeEstimateCockpitState(state) {
  return mergeDefaults(DEFAULT_STATE, isObject(state) ? state : {});
}

export function buildEstimateCockpitSnapshot({
  state,
  computed,
  source = "live",
  editTargetId = "",
  isEditMode = false,
} = {}) {
  const normalizedState = normalizeEstimateCockpitState(state);
  const materialsMode = normalizedState?.ui?.materialsMode === "itemized" ? "itemized" : "blanket";
  const liveComputed = computed && typeof computed === "object" ? computed : computeTotals(normalizedState, { settings: DEFAULT_SETTINGS });
  const laborLines = Array.isArray(liveComputed?.labor?.normalized) ? liveComputed.labor.normalized : [];
  const materialLines = Array.isArray(liveComputed?.materials?.normalized) ? liveComputed.materials.normalized : [];
  const meaningfulLaborLines = laborLines.filter(hasMeaningfulLaborLine);
  const meaningfulMaterialLines = materialLines.filter(hasMeaningfulItemizedMaterial);
  const blanketMaterialsActive = materialsMode === "blanket" && hasMeaningfulBlanketMaterials(normalizedState?.materials);

  return {
    source,
    isLive: source === "live",
    editTargetId: toText(editTargetId),
    isEditMode: Boolean(isEditMode),
    state: normalizedState,
    computed: liveComputed,
    docType: normalizedState?.ui?.docType === "invoice" ? "invoice" : "estimate",
    materialsMode,
    customerName: toText(normalizedState?.customer?.name),
    projectName: toText(normalizedState?.customer?.projectName),
    projectAddress: toText(normalizedState?.customer?.projectAddress),
    jobDate: toText(normalizedState?.job?.date),
    jobLocation: toText(normalizedState?.job?.location),
    docNumber: toText(normalizedState?.job?.docNumber),
    lastSavedAt: toNumber(normalizedState?.meta?.lastSavedAt),
    scopeNotes: toText(normalizedState?.scopeNotes),
    additionalNotes: toText(normalizedState?.additionalNotes),
    laborLineCount: meaningfulLaborLines.length,
    materialLineCount: meaningfulMaterialLines.length,
    hasMeaningfulLabor: meaningfulLaborLines.length > 0,
    hasMeaningfulMaterials: blanketMaterialsActive || meaningfulMaterialLines.length > 0,
    grandTotal: toNumber(liveComputed?.grandTotal),
    laborTotal: toNumber(liveComputed?.laborAfterAdjustments),
    materialsTotal: toNumber(liveComputed?.materials?.totalRevenue),
    grossProfit: toNumber(liveComputed?.grossProfit),
    grossMarginPct: toNumber(liveComputed?.grossMarginPct),
  };
}

export function buildEstimateCockpitTotals(state, settings = DEFAULT_SETTINGS) {
  const normalizedState = normalizeEstimateCockpitState(state);
  const computed = computeTotals(normalizedState, { settings });
  return buildEstimateCockpitSnapshot({
    state: normalizedState,
    computed,
    source: "derived",
  });
}

export function hasMeaningfulEstimateDraft(state, totals = buildEstimateCockpitTotals(state)) {
  return Boolean(
    toText(totals?.docNumber)
    || toText(totals?.customerName)
    || toText(totals?.projectName)
    || toText(totals?.jobLocation)
    || toText(totals?.scopeNotes)
    || toText(totals?.additionalNotes)
    || toNumber(totals?.grandTotal)
    || totals?.hasMeaningfulLabor
    || totals?.hasMeaningfulMaterials
  );
}
