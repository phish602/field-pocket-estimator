import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef, useId } from "react";
import EstimateForm from "./EstimateForm";
import CustomersScreen from "./screens/CustomersScreen";
import EstimatesScreen from "./screens/EstimatesScreen";
import InvoicesScreen from "./screens/InvoicesScreen";
import ProjectsScreen from "./screens/ProjectsScreen";
import NewProjectScreen from "./screens/NewProjectScreen";
import EditProjectScreen from "./screens/EditProjectScreen";
import ProjectDetailScreen from "./screens/ProjectDetailScreen";
import TemplatesScreen from "./screens/TemplatesScreen";
import { readProjectDetailTarget, writeProjectDetailTarget } from "./screens/ProjectDetailScreen";
import * as CompanyProfileScreenMod from "./screens/CompanyProfileScreen";
import * as AdvancedSettingsScreenMod from "./screens/AdvancedSettingsScreen";
import * as FinancialSnapshotScreenMod from "./screens/FinancialSnapshotScreen";
import * as JobLearningDiagnosticsScreenMod from "./screens/JobLearningDiagnosticsScreen";
import { STORAGE_KEYS } from "./constants/storageKeys";
import { ROUTES, BUILDER_INTENTS } from "./constants/routes";
import { DEFAULT_STATE } from "./estimator/defaultState";
import { requireCompanyProfile } from "./utils/guards";
import { migrateLegacyStorageNamespace } from "./utils/storage";
import { INVOICE_STATUSES, deriveInvoiceStatus, readStoredInvoices } from "./utils/invoices";
import { readStoredProjects, buildNormalizedProjectView, deriveProjectDisplayStatus } from "./utils/projects";
import { installDevJobLearningConsole } from "./utils/devJobLearningConsole";
import useSupabaseAuth from "./lib/useSupabaseAuth";
import AuthScreen from "./screens/AuthScreen";
import "./EstimateForm.css";
import "./FieldSystem.css";
import "./AppShell.css";
import "./App.css";
const DEFAULT_LOGO = "/logo/estipaid.svg";
const MOBILE_CHROME_MAX_WIDTH_PX = 640;




// __PE_RESOLVE_SCREEN__ (prevents default/named export mismatches for new screens)
const resolveScreen = (mod, fallbackName) => {
  if (!mod) return null;

  // Prefer default export, then named export
  let candidate = mod.default || (fallbackName && mod[fallbackName]) || null;

  const isReactTypeObject = (v) => v && typeof v === "object" && !!v.$$typeof;

  const pickFromObject = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "function" || isReactTypeObject(v)) return v;
    }
    return null;
  };

  if (candidate && typeof candidate === "object" && !isReactTypeObject(candidate)) {
    candidate = pickFromObject(candidate) || candidate;
  }

  if (!candidate) {
    candidate = pickFromObject(mod);
  }

  if (!candidate) return null;

  if (typeof candidate === "function" || isReactTypeObject(candidate)) return candidate;

  return null;
};

const CompanyProfileScreen = resolveScreen(CompanyProfileScreenMod, "CompanyProfileScreen");
const AdvancedSettingsScreen = resolveScreen(AdvancedSettingsScreenMod, "AdvancedSettingsScreen");
const FinancialSnapshotScreen = resolveScreen(FinancialSnapshotScreenMod, "FinancialSnapshotScreen");
const JobLearningDiagnosticsScreen = process.env.NODE_ENV !== "production"
  ? resolveScreen(JobLearningDiagnosticsScreenMod, "JobLearningDiagnosticsScreen")
  : null;
const DEV_JOB_LEARNING_DIAGNOSTICS_KEY = "job-learning-diagnostics";

function isLocalDevHost() {
  try {
    const hostname = String(window.location.hostname || "").trim().toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "";
  } catch {
    return false;
  }
}

function shouldOpenDevJobLearningDiagnostics() {
  try {
    if (process.env.NODE_ENV === "production") return false;
    if (!isLocalDevHost()) return false;

    const hash = String(window.location.hash || "").replace(/^#/, "").trim().toLowerCase();
    const search = new URLSearchParams(String(window.location.search || ""));
    const devParam = String(search.get("dev") || "").trim().toLowerCase();

    return hash === DEV_JOB_LEARNING_DIAGNOSTICS_KEY || devParam === DEV_JOB_LEARNING_DIAGNOSTICS_KEY;
  } catch {
    return false;
  }
}

function EstiPaidInlineLogo({ className, style, svgRef, draggable = false, title = "EstiPaid" }) {
  const baseId = useId().replace(/:/g, "");
  const grad0 = `${baseId}-linear-gradient`;
  const grad1 = `${baseId}-linear-gradient1`;

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 268.8 222.72"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={title}
      className={className}
      style={{
        ...style,
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        touchAction: "manipulation",
      }}
      draggable={draggable}
      onContextMenu={(e) => e.preventDefault()}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={grad0} x1="844.97" y1="819.67" x2="36.51" y2="1065.46" gradientTransform="translate(39.09 -127.78) scale(.24)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#b6d4a5" />
          <stop offset=".58" stopColor="#4d9ab3" />
          <stop offset=".9" stopColor="#3b78ba" />
          <stop offset="1" stopColor="#3f68a0" />
        </linearGradient>
        <linearGradient id={grad1} x1="507.94" y1="730.58" x2="102.96" y2="892.1" gradientTransform="translate(39.09 -127.78) scale(.24)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#78b1ad" />
          <stop offset="1" stopColor="#427eaf" />
        </linearGradient>
      </defs>
      <path fill={`url(#${grad0})`} d="M181.28,46.03c-4.88-.08-9.76-.16-14.63-.24-8.92.21-18.57.21-27.58,0-7.73.21-16.16.21-23.98,0-12.28.18-24.62.2-37.03.05l.11-.29c1.62-4.34,6.62-9.65,10.25-12.8,13.09-11.33,29.35-16.21,46.44-18.35h91.32s-1.42,10.63-1.42,10.63c-2.36,11.92-5.96,23.48-11.39,34.33l-2.1,4.21c-5.95,11.89-16.42,25.06-26.28,34.13-8.66,7.97-17.95,15.01-28.34,20.51l-4.58,2.42c-8.17,4.32-18.12,8.2-26.89,11.21-10.68,3.67-19.71,7.15-28.2,14.76-3.91,3.5-7.06,7.5-9.78,12.03-6.85,11.39-10.32,24.01-12.58,37.06l-2.29,13.27c-.93-1.8-1.17-3.43-1.55-5.25l-5.84-27.87-2.78-16.9-2.19-15.81-1.21-12.46-.17-3.85c-.29-6.49.22-13.09,4.76-18.14,1.68-1.87,3.44-3.31,5.69-4.45,3.91-1.98,8.09-3.39,12.48-4,.66-.09,1.3-.22,1.97-.22l34.62-.14c2.97-.01,9.92-1.8,12.89-2.74,4.57-1.44,8.75-3.32,13.09-5.34,6.41-2.98,18.52-11.27,23.65-15.92l2.55-2.31c7.32-6.64,13.44-14.27,18.79-22.61.9-1.4,1.33-2.82,2.47-4.06.15-.16.06-.66-.02-.88h-10.25Z" />
      <path fill={`url(#${grad1})`} d="M92.8,85.35c-6.77.08-13.64.08-20.62,0-2.92-.03-5.82-.08-8.71-.15-.32.11-.64.22-.97.33,2.13-9.76,4.84-18.49,9.03-27.28h96.15s-8.35,8.28-8.35,8.28c-7.3,7.23-25.14,18.65-35.38,18.69l-31.16.13Z" />
      <path fill="#4994b4" d="M115.1,45.79c.21.07.21.15,0,.24h-15.11c-7.23.21-14.82.21-22.06,0-.11-.24.18-.32.24-.48-.03.09.07.24.28.24h36.64Z" />
      <path fill="#70adae" d="M166.65,45.79c.21.07.21.15,0,.24h-27.58c-.21-.07-.21-.15,0-.24h27.58Z" />
      <rect fill="#58a0b1" x="115.1" y="45.79" width="23.98" height=".24" />
      <path fill="#4987af" d="M92.8,85.35h-20.62c6.68-.6,13.48,0,20.35-.29.17,0,.31.26.27.29Z" />
      <path fill="#87baab" d="M181.28,46.03h-14.63v-.24h14.36c.18,0,.29.15.26.24Z" />
    </svg>
  );
}

/* =========================================================
   APP SHELL + CREATE FLOW OWNER
   - Create tab owns the flow (Language/Profile/Job/Estimate/Review)
   - EstimateForm remains the engine (no feature loss)
   - Header/Footer are transparent overlays; content scrolls underneath
   ========================================================= */

const LANG_KEY = STORAGE_KEYS.LANG;
const CUSTOMERS_KEY = STORAGE_KEYS.CUSTOMERS;
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const PROJECTS_KEY = STORAGE_KEYS.PROJECTS;
const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const ACTIVE_EDIT_CONTEXT_KEY = "estipaid-active-edit-context-v1";
const PROFILE_RETURN_TARGET_KEY = "estipaid-profile-return-target-v1";
const PROJECT_DETAIL_RETURN_TARGET_KEY = "estipaid-project-detail-return-target-v1";
const PROJECT_CREATE_SEED_KEY = "estipaid-project-create-seed-v1";

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildCleanContinueCreateState(docType = "estimate") {
  const normalizedDocType = docType === "invoice" ? "invoice" : "estimate";
  let nextState = {};

  try {
    nextState = JSON.parse(JSON.stringify(DEFAULT_STATE)) || {};
  } catch {
    nextState = { ...(DEFAULT_STATE || {}) };
  }

  nextState.ui = {
    ...(nextState.ui || {}),
    docType: normalizedDocType,
    materialsMode: normalizedDocType === "invoice" ? "blanket" : "itemized",
  };
  nextState.scopeNotes = normalizedDocType === "invoice" ? "" : String(nextState.scopeNotes || "");
  nextState.tradeInsert = { key: "", text: "" };
  nextState.meta = { lastSavedAt: 0 };

  return nextState;
}

function hasMeaningfulEstimateDraftContent(state) {
  if (!state || typeof state !== "object") return false;
  if (String(state?.scopeNotes || "").trim()) return true;

  const customer = state?.customer || {};
  if (
    String(customer?.name || "").trim()
    || String(customer?.projectName || "").trim()
    || String(customer?.address || "").trim()
    || String(customer?.email || "").trim()
    || String(customer?.phone || "").trim()
  ) {
    return true;
  }

  const job = state?.job || {};
  if (
    String(job?.location || "").trim()
    || String(job?.poNumber || "").trim()
    || String(job?.docNumber || "").trim()
  ) {
    return true;
  }

  const laborLines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
  if (laborLines.some((line) => (
    String(line?.role || "").trim()
    || String(line?.hours || "").trim()
    || String(line?.rate || "").trim()
  ))) {
    return true;
  }

  const materials = state?.materials || {};
  if (
    String(materials?.blanketCost || "").trim()
    || String(materials?.materialsBlanketDescription || "").trim()
  ) {
    return true;
  }
  const materialItems = Array.isArray(materials?.items) ? materials.items : [];
  if (materialItems.some((item) => (
    String(item?.desc || "").trim()
    || String(item?.qty || "").trim()
    || String(item?.priceEach || "").trim()
  ))) {
    return true;
  }

  const additionalChargeItems = Array.isArray(state?.additionalCharges?.items) ? state.additionalCharges.items : [];
  if (additionalChargeItems.some((item) => (
    String(item?.desc || "").trim()
    || String(item?.qty || "").trim()
    || String(item?.priceEach || "").trim()
  ))) {
    return true;
  }

  return false;
}

function readLiveDraftResumeMeta(versionToken = 0) {
  void versionToken;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE);
    if (!raw) return null;

    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (!hasMeaningfulEstimateDraftContent(parsed)) return null;

    const docType = parsed?.ui?.docType === "invoice" ? "invoice" : "estimate";
    const docTypeLabel = docType === "invoice" ? "Invoice Draft" : "Estimate Draft";

    const projectName = String(
      parsed?.customer?.projectName
      || parsed?.customer?.name
      || parsed?.customer?.fullName
      || ""
    ).trim();
    const customerName = String(parsed?.customer?.name || "").trim();
    const docNumber = String(
      parsed?.job?.docNumber
      || parsed?.customer?.projectNumber
      || ""
    ).trim();

    const headline = projectName || customerName || docNumber || docTypeLabel;
    const resumeMetaItems = [
      { key: "draft-type", label: docTypeLabel, tone: "status" },
      customerName && projectName && customerName !== projectName
        ? { key: "customer", label: customerName, tone: "customer" }
        : null,
      docNumber
        ? { key: "number", label: `${docType === "invoice" ? "Invoice" : "Estimate"} #${docNumber}`, tone: "number" }
        : null,
    ].filter(Boolean);

    return { docType, headline, resumeMetaItems };
  } catch {
    return null;
  }
}

const DOC_TYPE_GUARD_MODAL_OVERLAY_STYLE = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};
const DOC_TYPE_GUARD_MODAL_CARD_STYLE = {
  width: "min(520px, 100%)",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(10,10,10,0.85)",
  boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
  padding: 16,
  display: "grid",
  gap: 12,
};
const DOC_TYPE_GUARD_MODAL_TEXT_STYLE = {
  fontSize: 13,
  opacity: 0.85,
  lineHeight: 1.35,
};
const DOC_TYPE_GUARD_MODAL_ACTIONS_STYLE = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
  flexWrap: "wrap",
  marginTop: 6,
};

function normalizeEditContext(value) {
  if (!value || typeof value !== "object") return null;
  const type = value?.type === "invoice" ? "invoice" : (value?.type === "estimate" ? "estimate" : "");
  const id = String(value?.id || "").trim();
  if (!type || !id) return null;
  return { type, id };
}

function normalizeProfileReturnTarget(value) {
  if (!value || typeof value !== "object") return null;

  // Compatibility path: accept older edit-context shapes and normalize them into the current route payload.
  const legacyEditContext = normalizeEditContext(value);
  if (legacyEditContext) {
    return {
      route: ROUTES.CREATE,
      intent: legacyEditContext.type === "invoice" ? BUILDER_INTENTS.INVOICE : BUILDER_INTENTS.ESTIMATE,
      editContext: legacyEditContext,
    };
  }

  const routeCandidate = String(value?.route || value?.tab || "").trim();
  const route = Object.values(ROUTES).includes(routeCandidate) ? routeCandidate : "";
  if (!route || route === ROUTES.COMPANY_PROFILE) return null;

  if (route === ROUTES.CREATE || route === ROUTES.ESTIMATE_BUILDER || route === ROUTES.INVOICE_BUILDER) {
    const next = {
      route: ROUTES.CREATE,
      intent: route === ROUTES.INVOICE_BUILDER
        ? BUILDER_INTENTS.INVOICE
        : (value?.intent === BUILDER_INTENTS.INVOICE ? BUILDER_INTENTS.INVOICE : BUILDER_INTENTS.ESTIMATE),
    };
    const editContext = normalizeEditContext(value?.editContext);
    if (editContext) next.editContext = editContext;
    return next;
  }

  return { route };
}

function readActiveEditContext() {
  try {
    const raw = localStorage.getItem(ACTIVE_EDIT_CONTEXT_KEY);
    if (!raw) return null;
    return normalizeEditContext(safeParseJson(raw));
  } catch {
    return null;
  }
}

function readProfileReturnTarget() {
  try {
    const raw = localStorage.getItem(PROFILE_RETURN_TARGET_KEY);
    if (!raw) return null;
    return normalizeProfileReturnTarget(safeParseJson(raw));
  } catch {
    return null;
  }
}

function writeProfileReturnTarget(value) {
  const normalized = normalizeProfileReturnTarget(value);
  try {
    if (!normalized) {
      localStorage.removeItem(PROFILE_RETURN_TARGET_KEY);
      return null;
    }
    localStorage.setItem(PROFILE_RETURN_TARGET_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return null;
  }
}

function clearProfileReturnTarget() {
  try {
    localStorage.removeItem(PROFILE_RETURN_TARGET_KEY);
  } catch {}
}

function normalizeProjectDetailReturnTarget(value) {
  if (!value || typeof value !== "object") return null;
  const route = String(value?.route || "").trim();
  if (route !== ROUTES.PROJECT_DETAIL) return null;
  const projectId = String(value?.projectId || "").trim();
  return {
    route,
    ...(projectId ? { projectId } : {}),
  };
}

function readProjectDetailReturnTarget() {
  try {
    const raw = localStorage.getItem(PROJECT_DETAIL_RETURN_TARGET_KEY);
    if (!raw) return null;
    return normalizeProjectDetailReturnTarget(safeParseJson(raw));
  } catch {
    return null;
  }
}

function writeProjectDetailReturnTarget(value) {
  const normalized = normalizeProjectDetailReturnTarget(value);
  try {
    if (!normalized) {
      localStorage.removeItem(PROJECT_DETAIL_RETURN_TARGET_KEY);
      return null;
    }
    localStorage.setItem(PROJECT_DETAIL_RETURN_TARGET_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return null;
  }
}

function clearProjectDetailReturnTarget() {
  try {
    localStorage.removeItem(PROJECT_DETAIL_RETURN_TARGET_KEY);
  } catch {}
}

function buildProfileReturnTarget(activeTab, createIntent, requestedTab = "") {
  if (!activeTab || activeTab === ROUTES.COMPANY_PROFILE) {
    return null;
  }

  const requestedBuilderTab = (
    requestedTab === ROUTES.CREATE
    || requestedTab === ROUTES.ESTIMATE_BUILDER
    || requestedTab === ROUTES.INVOICE_BUILDER
  ) ? requestedTab : "";

  if (activeTab === ROUTES.CREATE || requestedBuilderTab) {
    const { estimateEditTarget, invoiceEditTarget } = readValidatedCreateEditTargets();
    let editContext = null;
    const nextIntent = requestedBuilderTab === ROUTES.INVOICE_BUILDER
      ? BUILDER_INTENTS.INVOICE
      : (requestedBuilderTab === ROUTES.ESTIMATE_BUILDER
        ? BUILDER_INTENTS.ESTIMATE
        : (createIntent === BUILDER_INTENTS.INVOICE ? BUILDER_INTENTS.INVOICE : BUILDER_INTENTS.ESTIMATE));

    if (nextIntent === BUILDER_INTENTS.INVOICE && invoiceEditTarget) {
      editContext = { type: "invoice", id: invoiceEditTarget };
    } else if (nextIntent === BUILDER_INTENTS.ESTIMATE && estimateEditTarget) {
      editContext = { type: "estimate", id: estimateEditTarget };
    } else {
      editContext = readActiveEditContext();
    }

    const target = {
      route: ROUTES.CREATE,
      intent: nextIntent,
    };
    if (editContext) target.editContext = editContext;
    return target;
  }

  return { route: activeTab };
}

try {
  migrateLegacyStorageNamespace();
} catch {}

function loadSavedEstimates() {
  try {
    const raw = localStorage.getItem(ESTIMATES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((record) => record && String(record?.docType || "estimate").toLowerCase() !== "invoice")
      : [];
  } catch {
    return [];
  }
}

function readValidatedCreateEditTargets() {
  let estimateEditTarget = "";
  let invoiceEditTarget = "";

  try {
    estimateEditTarget = String(localStorage.getItem(EDIT_ESTIMATE_TARGET_KEY) || "").trim();
    invoiceEditTarget = String(localStorage.getItem(EDIT_INVOICE_TARGET_KEY) || "").trim();
  } catch {
    return { estimateEditTarget: "", invoiceEditTarget: "" };
  }

  if (estimateEditTarget) {
    const estimates = loadSavedEstimates();
    const hasEstimateTarget = estimates.some((entry) => {
      const docType = String(entry?.docType || "estimate").toLowerCase();
      return docType !== "invoice" && String(entry?.id || "").trim() === estimateEditTarget;
    });
    if (!hasEstimateTarget) {
      estimateEditTarget = "";
      try { localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY); } catch {}
    }
  }

  if (invoiceEditTarget) {
    const invoices = readStoredInvoices();
    const invoiceRecord = invoices.find((entry) => String(entry?.id || "").trim() === invoiceEditTarget);
    if (!invoiceRecord || deriveInvoiceStatus(invoiceRecord) === INVOICE_STATUSES.VOID) {
      invoiceEditTarget = "";
      try { localStorage.removeItem(EDIT_INVOICE_TARGET_KEY); } catch {}
    }
  }

  return { estimateEditTarget, invoiceEditTarget };
}

function loadSavedCustomers() {
  try {
    const raw = localStorage.getItem(CUSTOMERS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizePulseEstimateStatus(status) {
  const raw = String(status || "").trim().toLowerCase();
  if (raw === "approved") return "approved";
  if (raw === "lost") return "lost";
  return "pending";
}

function deriveBusinessPulseCounts(estimates, invoices) {
  const counts = {
    pendingEstimates: 0,
    approvedEstimates: 0,
    unpaidInvoices: 0,
    overdueInvoices: 0,
  };

  const estimateRecords = Array.isArray(estimates) ? estimates : [];
  for (const estimate of estimateRecords) {
    if (String(estimate?.docType || "estimate").toLowerCase() === "invoice") continue;
    const status = normalizePulseEstimateStatus(estimate?.status);
    if (status === "approved") counts.approvedEstimates += 1;
    else if (status !== "lost") counts.pendingEstimates += 1;
  }

  const invoiceRecords = Array.isArray(invoices) ? invoices : [];
  for (const invoice of invoiceRecords) {
    const status = deriveInvoiceStatus(invoice);
    if (status === INVOICE_STATUSES.PAID || status === INVOICE_STATUSES.VOID) continue;
    counts.unpaidInvoices += 1;
    if (status === INVOICE_STATUSES.OVERDUE) counts.overdueInvoices += 1;
  }

  return counts;
}

function deriveHomeDashboardSummary({
  invoices,
  projects,
  businessPulseCounts,
  companyProfile,
}) {
  const invoiceRecords = Array.isArray(invoices) ? invoices : [];
  const projectRecords = Array.isArray(projects) ? projects : [];
  const pulse = businessPulseCounts && typeof businessPulseCounts === "object" ? businessPulseCounts : {};
  let unpaidBalance = 0;
  let overdueBalance = 0;
  let paidAmount = 0;

  for (const invoice of invoiceRecords) {
    const status = deriveInvoiceStatus(invoice);
    const total = Number(invoice?.invoiceTotal ?? invoice?.total);
    const paid = Number(invoice?.amountPaid);
    const balance = Number(
      invoice?.balanceRemaining !== undefined && invoice?.balanceRemaining !== null
        ? invoice.balanceRemaining
        : Math.max(0, (Number.isFinite(total) ? total : 0) - (Number.isFinite(paid) ? paid : 0))
    );

    paidAmount += Number.isFinite(paid) ? paid : 0;
    if (status !== INVOICE_STATUSES.PAID && status !== INVOICE_STATUSES.VOID) {
      const safeBalance = Number.isFinite(balance) ? balance : 0;
      unpaidBalance += safeBalance;
      if (status === INVOICE_STATUSES.OVERDUE) overdueBalance += safeBalance;
    }
  }

  const activeProjectCount = projectRecords.filter((project) => {
    const key = String(project?._displayStatus?.key || "").toLowerCase();
    return key === "active" || key === "estimating";
  }).length;

  const stripeAccountId = String(companyProfile?.stripeAccountId || "").trim();
  const stripeConnected = /^acct_/i.test(stripeAccountId);
  const nextSteps = [];

  if (Number(pulse?.overdueInvoices || 0) > 0) {
    nextSteps.push({
      key: "overdue",
      tone: "danger",
      title: "Follow Up on Overdue Invoices",
      detail: `${Number(pulse.overdueInvoices)} ${Number(pulse.overdueInvoices) === 1 ? "invoice is" : "invoices are"} overdue for ${homeMoney(overdueBalance || unpaidBalance)}.`,
    });
  }
  if (unpaidBalance > 0) {
    nextSteps.push({
      key: "receivables",
      tone: "warning",
      title: "Follow up on open receivables",
      detail: `${homeMoney(unpaidBalance)} is still outstanding across ${Number(pulse?.unpaidInvoices || 0)} unpaid ${Number(pulse?.unpaidInvoices || 0) === 1 ? "invoice" : "invoices"}.`,
    });
  }
  if (Number(pulse?.approvedEstimates || 0) > 0) {
    nextSteps.push({
      key: "approved",
      tone: "good",
      title: "Ready to Invoice",
      detail: `${Number(pulse.approvedEstimates)} approved ${Number(pulse.approvedEstimates) === 1 ? "estimate is" : "estimates are"} ready to move into billing.`,
    });
  }
  if (!stripeConnected) {
    nextSteps.push({
      key: "stripe",
      tone: "info",
      title: "Connect Stripe",
      detail: "Enable online invoice payments from Company Profile when you are ready.",
    });
  }
  if (nextSteps.length === 0) {
    nextSteps.push({
      key: "steady",
      tone: "good",
      title: "Everything is caught up",
      detail: "No overdue invoices or unpaid balance need immediate attention.",
    });
  }

  return {
    unpaidBalance,
    overdueBalance,
    paidAmount,
    activeProjectCount,
    unpaidInvoices: Number(pulse?.unpaidInvoices || 0),
    overdueInvoices: Number(pulse?.overdueInvoices || 0),
    approvedEstimates: Number(pulse?.approvedEstimates || 0),
    pendingEstimates: Number(pulse?.pendingEstimates || 0),
    stripe: {
      connected: stripeConnected,
      accountId: stripeAccountId,
    },
    nextSteps: nextSteps.slice(0, 3),
  };
}

function getSavedLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "en" || v === "es") return v;
  } catch {
    // ignore
  }
  return "en";
}

/* =========================
   Icons (Motif 1: Blueprint corners)
   ========================= */
function BlueprintCorners({ size = 24, strokeWidth = 2 }) {
  return null;
}

function IconBase({ children, size = 24, viewBox = "0 0 24 24" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function IconCustomers({ size = 24 }) {
  return (
    <IconBase size={size}>
      <BlueprintCorners size={24} />
      <g
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 12.2c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3Z" />
        <path d="M4.8 18c.8-2.5 2.6-3.8 4.2-3.8s3.4 1.3 4.2 3.8" />
        <path d="M14.2 10.2h5" opacity="0.9" />
        <path d="M14.2 13.2h4.2" opacity="0.75" />
      </g>
    </IconBase>
  );
}

function IconEstimates({ size = 24 }) {
  return (
    <IconBase size={size}>
      <BlueprintCorners size={24} />
      <g
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 6.8h8" />
        <path d="M8 10.2h8" opacity="0.85" />
        <path d="M8 13.6h6.2" opacity="0.7" />
        <path
          d="M7 6.2h10c.6 0 1 .4 1 1V18c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V7.2c0-.6.4-1 1-1Z"
          opacity="0.95"
        />
        <path d="M17.7 8.2v1" opacity="0.7" />
        <path d="M17.7 11.6v1" opacity="0.55" />
      </g>
    </IconBase>
  );
}

function IconInvoices({ size = 24 }) {
  return (
    <IconBase size={size}>
      <BlueprintCorners size={24} />
      <g
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7.2 6.2h9.2l1.4 1.5v10.6l-1.5-.8-1.5.8-1.5-.8-1.5.8-1.5-.8-1.5.8-1.6-.8V7.2c0-.55.45-1 1-1Z" opacity="0.95" />
        <path d="M15.8 6.3v2.3h2.1" opacity="0.72" />
        <path d="M9 10h5.6" opacity="0.82" />
        <path d="M9 12.9h4.4" opacity="0.66" />
        <circle cx="15.9" cy="15.3" r="2.35" opacity="0.88" />
        <path d="M15.9 13.95v2.7" opacity="0.88" />
        <path d="M16.75 14.5c-.2-.34-.56-.55-.96-.55-.58 0-1.05.39-1.05.88 0 .48.36.72 1.05.88.68.16 1.04.4 1.04.88 0 .49-.46.88-1.04.88-.47 0-.85-.18-1.08-.57" opacity="0.88" />
      </g>
    </IconBase>
  );
}

function IconProjects({ size = 24 }) {
  return (
    <IconBase size={size}>
      <BlueprintCorners size={24} />
      <g
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="6" y="6.5" width="12" height="4" rx="1" opacity="0.95" />
        <rect x="6" y="13" width="5.5" height="5" rx="1" opacity="0.8" />
        <rect x="12.5" y="13" width="5.5" height="5" rx="1" opacity="0.65" />
      </g>
    </IconBase>
  );
}

function IconCreate({ size = 28 }) {
  return (
    <IconBase size={size} viewBox="0 0 28 28">
      <g
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 10V4h6" opacity="0.9" />
        <path d="M18 4h6v6" opacity="0.9" />
        <path d="M4 18v6h6" opacity="0.9" />
        <path d="M24 18v6h-6" opacity="0.9" />
        <path d="M14 9v10" />
        <path d="M9 14h10" />
      </g>
    </IconBase>
  );
}

/* =========================
   Overlay dimensions
   ========================= */
const HEADER_H = 56;
const FOOTER_H = 70;
const HEADER_SAFE_GAP = 6;
const FOOTER_FLOAT_GAP = 16;
const FOOTER_CONTENT_BREATHING = "clamp(36px, 5svh, 56px)";
const CHROME_TOP_REVEAL_THRESHOLD = 24;
const CHROME_DIRECTION_EPSILON = 1;
const CHROME_HIDE_DISTANCE = 28;
const CHROME_SHOW_DISTANCE = 14;
const ESTIMATE_OPEN_CUSTOMERS_GUARD_MS = 700;
const MENU_EDGE_SWIPE_ZONE_PX = 24;
const MENU_EDGE_SWIPE_OPEN_PX = 72;
const MENU_EDGE_SWIPE_VERTICAL_CANCEL_PX = 40;
const MENU_EDGE_SWIPE_HORIZONTAL_RATIO = 1.35;

function hasHorizontalScrollableAncestor(target) {
  if (!(target instanceof Element) || typeof window === "undefined") return false;
  let node = target;
  while (node && node !== document.body) {
    try {
      const style = window.getComputedStyle(node);
      const overflowX = String(style?.overflowX || "");
      if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth + 12) {
        return true;
      }
    } catch {
      return false;
    }
    node = node.parentElement;
  }
  return false;
}

function isMenuEdgeSwipeBlockedTarget(target) {
  if (!(target instanceof Element)) return false;
  if (hasHorizontalScrollableAncestor(target)) return true;
  return Boolean(
    target.closest(
      [
        "button",
        "input",
        "select",
        "textarea",
        "label",
        "a",
        "summary",
        "[contenteditable='true']",
        "[draggable='true']",
        "[role='button']",
        "[role='link']",
        "[role='switch']",
        "[role='slider']",
        "[role='tab']",
        "[role='menuitem']",
        "[role='dialog']",
        "[aria-modal='true']",
        "[data-estimate-details-panel='true']",
        "[data-no-menu-edge-swipe='true']",
      ].join(", ")
    )
  );
}

function getAppScrollHost() {
  if (typeof document === "undefined") return null;

  const shellHost = document.querySelector(".pe-content");
  if (shellHost instanceof Element) {
    try {
      const computedStyle = typeof window !== "undefined" ? window.getComputedStyle(shellHost) : null;
      const overflowY = String(computedStyle?.overflowY || "");
      const shellCanScroll = shellHost.scrollHeight > shellHost.clientHeight + 1;
      if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && shellCanScroll) {
        return shellHost;
      }
    } catch {
      // fall through to the document scroll root
    }
  }

  return document.scrollingElement || document.documentElement || document.body || null;
}

function readAppScrollTop() {
  const host = getAppScrollHost();
  if (host && typeof host.scrollTop === "number") {
    return Math.max(0, Number(host.scrollTop) || 0);
  }

  if (typeof window !== "undefined") {
    return Math.max(
      0,
      Number(window.scrollY || window.pageYOffset || document.documentElement?.scrollTop || document.body?.scrollTop || 0)
    );
  }

  return 0;
}

function resetAppScrollPosition() {
  const host = getAppScrollHost();
  try {
    if (host && typeof host.scrollTo === "function") {
      host.scrollTo({ top: 0, left: 0, behavior: "auto" });
    } else if (host) {
      host.scrollTop = 0;
      host.scrollLeft = 0;
    }
  } catch {}

  try {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  } catch {}
}

/* =========================
   Top bar + bottom nav + drawer
   ========================= */
function TopBar({
  onMenu,
  onProfile,
  topRightLogoSrc,
  showAddLogoCue,
  showHeaderSpin,
  onHeaderSpinTap,
  onHeaderSpinLongPress,
  isScrolled,
  glassOnScroll,
  chromeVisible,
  routeEnterKey,
}) {
  const src = topRightLogoSrc || DEFAULT_LOGO;
  const isHome = !showHeaderSpin;
  const estiLogoRef = useRef(null);

  const restartSpin = (el) => {
    if (!el) return;
    el.classList.remove("esti-spin");
    void el.offsetWidth;
    el.classList.add("esti-spin");
  };

  useEffect(() => {
    if (isHome) return;
    restartSpin(estiLogoRef.current);
  }, [routeEnterKey, isHome]);

  return (
    <div
      style={{
        ...styles.topbar,
        ...(glassOnScroll && isScrolled ? styles.topbarScrolled : null),
        ...(!chromeVisible ? styles.topbarHidden : null),
      }}
    >
      <button
        className="pe-btn pe-btn-ghost"
        type="button"
        style={{ ...styles.headerIconBtn, ...styles.headerMenuIcon }}
        onClick={onMenu}
        aria-label="Open Menu"
      >
        ☰
      </button>

      

      {!isHome ? (
        <button
          key={`header-brand-wrap-${routeEnterKey || "default"}`}
          type="button"
          style={styles.headerSpinBtn}
          aria-label="Home"
          title="Home"
          onClick={(e) => {
            if (e?.currentTarget?.__lpFired) return;
            onHeaderSpinTap && onHeaderSpinTap();
          }}
          onPointerDown={(e) => {
            if (!onHeaderSpinLongPress) return;
            try { e.currentTarget.__lpFired = false; } catch {}
            const t = setTimeout(() => {
              try { e.currentTarget.__lpFired = true; } catch {}
              onHeaderSpinLongPress();
            }, 520);
            e.currentTarget.__lpTimer = t;
          }}
          onPointerUp={(e) => {
            const t = e.currentTarget.__lpTimer;
            if (t) clearTimeout(t);
            e.currentTarget.__lpTimer = null;
          }}
          onPointerCancel={(e) => {
            const t = e.currentTarget.__lpTimer;
            if (t) clearTimeout(t);
            e.currentTarget.__lpTimer = null;
          }}
        >
          <EstiPaidInlineLogo
            svgRef={estiLogoRef}
            className="esti-spin"
            style={styles.profileLogo}
            draggable={false}
          />
        </button>
      ) : (
        <div
          aria-hidden="true"
          style={{ ...styles.headerSpinBtn, pointerEvents: "none", cursor: "default" }}
        />
      )}

<button
        key={`header-user-wrap-${routeEnterKey || "default"}`}
        className="pe-btn pe-btn-ghost"
        type="button"
        style={styles.headerIconBtn}
        onClick={onProfile}
  aria-label="Open Company Profile"
      >
        <div style={styles.profileLogoWrap}>
          {showAddLogoCue ? <span style={styles.profileLogoCueRing} aria-hidden="true" /> : null}
          <img
            src={src}
            alt="Company logo"
            style={styles.profileLogo}
            draggable={false}
          />
          {showAddLogoCue ? <span style={styles.profileLogoCueBadge} aria-hidden="true">+</span> : null}
          {showAddLogoCue ? <span style={styles.profileLogoCueText} aria-hidden="true">Add Logo</span> : null}
        </div>
      </button>
    </div>
  );
}

function BottomNav({
  active,
  setActive,
  disabled,
  onQuickOpen,
  chromeVisible,
  mobileCreateChromeMotion,
  className,
  ...rest
}) {
  const tabs = useMemo(
    () => [
      { key: ROUTES.PROJECTS, label: "Projects", Icon: IconProjects },
      { key: ROUTES.CUSTOMERS, label: "Customers", Icon: IconCustomers },
      { key: ROUTES.CREATE, label: "Create", Icon: IconCreate, center: true },
      { key: ROUTES.ESTIMATES, label: "Estimates", Icon: IconEstimates },
      { key: ROUTES.INVOICES, label: "Invoices", Icon: IconInvoices },
    ],
    []
  );

  const [createBump, setCreateBump] = useState(false);

  const onTab = (t) => {
    if (disabled && t.key !== ROUTES.CREATE) return;

    if (t.key === ROUTES.CREATE) {
      setCreateBump(true);
      setTimeout(() => setCreateBump(false), 260);
    }
    setActive(t.key);

    try {
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.vibrate === "function"
      ) {
        navigator.vibrate(10);
      }
    } catch {
      // ignore
    }
  };
  useEffect(() => {
    const onTap = () => setActive(ROUTES.HOME);
    const onLong = () => {
      try {
        onQuickOpen && onQuickOpen();
      } catch {
        // ignore
      }
    };
    window.addEventListener("estipaid:hero-logo-tap", onTap);
    window.addEventListener("estipaid:hero-logo-longpress", onLong);
    return () => {
      window.removeEventListener("estipaid:hero-logo-tap", onTap);
      window.removeEventListener("estipaid:hero-logo-longpress", onLong);
    };
  }, [setActive, onQuickOpen]);



  useEffect(() => {
    if (active !== ROUTES.CREATE && createBump) setCreateBump(false);
  }, [active, createBump]);

  return (
    <div
      className={className}
      {...rest}
      style={{
        ...styles.bottomnav,
        ...(mobileCreateChromeMotion ? styles.bottomnavCreateMotion : null),
        ...(!chromeVisible ? styles.bottomnavHidden : null),
      }}
      role="navigation"
      aria-label="Primary"
    >
      {tabs.map((t) => {
        const isActive = active === t.key;
        const isCenter = !!t.center;
        const Icon = t.Icon;
        const isDisabled = disabled && t.key !== ROUTES.CREATE;

        const btnStyle = {
          ...styles.navBtn,
          opacity: isDisabled ? 0.35 : isActive ? 1 : 0.75,
          marginTop: isCenter ? -11 : 0,
          pointerEvents: isDisabled ? "none" : "auto",
          ...(isActive ? styles.navBtnActive : null),
        };

        const iconWrapStyle = isCenter
          ? { ...styles.navIconWrap, ...styles.createIconWrap }
          : styles.navIconWrap;

        const createWrapClass = isCenter && createBump ? "pe-create-bump" : "";

        return (
          <button
            key={t.key}
            type="button"
            style={btnStyle}
            onClick={() => onTab(t)}
            aria-label={t.label}
            tabIndex={isDisabled ? -1 : 0}
          >
            <span style={iconWrapStyle} className={createWrapClass}>
              <Icon size={isCenter ? 30 : 25} />
            </span>
            <span style={styles.navLabel}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}


function QuickMenu({ open, onClose, onSelect }) {
  if (!open) return null;

  const items = [
    { key: ROUTES.HOME, label: "Home" },
    { key: ROUTES.CREATE, label: "Create" },
    { key: ROUTES.PROJECTS, label: "Projects" },
    { key: ROUTES.ESTIMATES, label: "Estimates" },
    { key: ROUTES.INVOICES, label: "Invoices" },
    { key: ROUTES.COMPANY_PROFILE, label: "Company Profile" },
  ];

  return (
    <>
      <div className="pe-quick-overlay" style={styles.quickOverlay} onClick={onClose} />
      <div className="pe-quick-menu" style={styles.quickMenu} role="dialog" aria-modal="true" aria-label="Shortcuts">
        <div className="pe-quick-title-row" style={styles.quickTitleRow}>
          <div className="pe-quick-title" style={styles.quickTitle}>Shortcuts</div>
          <button
            className="pe-btn pe-btn-ghost"
            style={styles.quickClose}
            onClick={onClose}
            aria-label="Close Shortcuts"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="pe-quick-grid" style={styles.quickGrid}>
          {items.map((it) => (
            <button
              key={it.key}
              className="pe-btn pe-quick-item"
              type="button"
              style={styles.quickItem}
              onClick={() => onSelect(it.key)}
            >
              {it.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}


function CreateLauncher({ open, onClose, onAction, estimateActionLabel }) {
  if (!open) return null;
  return (
    <>
      <div className="pe-quick-overlay" style={styles.quickOverlay} onClick={onClose} />
      <div style={styles.createLauncherPanel} role="dialog" aria-modal="true" aria-label="Start New">
        <div style={styles.quickTitleRow}>
          <div style={styles.quickTitle}>Start New</div>
          <button
            className="pe-btn pe-btn-ghost"
            style={styles.quickClose}
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            ✕
          </button>
        </div>
        <div style={styles.createLauncherStack}>
          <button
            className="pe-btn"
            type="button"
            style={styles.createLauncherHero}
            onClick={() => onAction("getStarted")}
          >
            <span style={styles.createLauncherHeroLabel}>✦ Get Started</span>
            <span style={styles.createLauncherHeroHint}>AI-assisted estimate</span>
          </button>
          <div style={styles.createLauncherRow}>
            <button
              className="pe-btn"
              type="button"
              style={styles.createLauncherAction}
              onClick={() => onAction("project")}
            >
              Project
            </button>
            <button
              className="pe-btn"
              type="button"
              style={styles.createLauncherAction}
              onClick={() => onAction("estimate")}
            >
              {estimateActionLabel || "Estimate"}
            </button>
            <button
              className="pe-btn"
              type="button"
              style={styles.createLauncherAction}
              onClick={() => onAction("invoice")}
            >
              Invoice
            </button>
          </div>
        </div>
      </div>
    </>
  );
}


function Drawer({ open, onClose, onSelect, disabled }) {
  return (
    <>
      {open && <div className="pe-drawer-overlay" style={styles.drawerOverlay} onClick={onClose} />}

      <div
        className="pe-app-drawer"
        style={{
          ...styles.drawer,
          transform: open ? "translateX(0)" : "translateX(-110%)",
          pointerEvents: open ? "auto" : "none",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={open ? undefined : "true"}
      >
        <div style={styles.drawerHeader}>
          <div style={styles.drawerTitle}>Menu</div>
          <button
            className="pe-btn pe-btn-ghost"
            type="button"
            style={styles.drawerClose}
            onClick={onClose}
            aria-label="Close Menu"
          >
            ✕
          </button>
        </div>

        <div style={styles.drawerList}>
          <button
            className="pe-btn pe-btn-ghost"
            type="button"
            style={styles.drawerItem}
            onClick={() => onSelect("company")}
            disabled={disabled}
          >
            Company Profile
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            type="button"
            style={styles.drawerItem}
            onClick={() => onSelect(ROUTES.SNAPSHOT)}
          >
            Snapshot
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            type="button"
            style={styles.drawerItem}
            onClick={() => onSelect("templates")}
            disabled={disabled}
          >
            Templates
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            type="button"
            style={styles.drawerItem}
            onClick={() => onSelect(ROUTES.ADVANCED)}
          >
            Settings
          </button>
        </div>
      </div>
    </>
  );
}

/* =========================
   Create Flow (App owns flow; NO stepper UI)
   ========================= */
function CreateFlow({
  gated,
  intent,
  spinTick,
  resetSeq,
  mobileBottomChromeVisible,
  shellBottomChromeVisible = true,
  shellOverlayOpen = false,
  onGuidedOverlayOpenChange,
  homeEstimateLaunch,
  onHomeEstimateLaunchConsumed,
  onResolveDocTypeGuard,
}) {
  const desiredDocType = intent === BUILDER_INTENTS.INVOICE ? "invoice" : "estimate";
  const [isSeedReady, setIsSeedReady] = useState(() => {
    try {
      const { estimateEditTarget, invoiceEditTarget } = readValidatedCreateEditTargets();
      if (estimateEditTarget || invoiceEditTarget) return true;
      const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE);
      const parsed = raw ? safeParseJson(raw) : null;
      const currentDocType = parsed?.ui?.docType === "invoice" ? "invoice" : "estimate";
      return currentDocType === desiredDocType;
    } catch {
      return desiredDocType === "estimate";
    }
  });
  const [typeSwitchGuardPending, setTypeSwitchGuardPending] = useState(false);

  useLayoutEffect(() => {
    try {
      const { estimateEditTarget, invoiceEditTarget } = readValidatedCreateEditTargets();
      if (estimateEditTarget || invoiceEditTarget) {
        setTypeSwitchGuardPending(false);
        setIsSeedReady(true);
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE);
      const parsed = raw ? safeParseJson(raw) : null;
      const currentDocType = parsed?.ui?.docType === "invoice" ? "invoice" : "estimate";
      if (currentDocType !== desiredDocType) {
        // An estimate draft with meaningful content must not be silently
        // relabeled into an invoice draft (scopeNotes would be wiped on the
        // next invoice autosave). Pause and let the user choose explicitly.
        if (currentDocType === "estimate" && desiredDocType === "invoice" && hasMeaningfulEstimateDraftContent(parsed)) {
          setTypeSwitchGuardPending(true);
          setIsSeedReady(true);
          return;
        }
        const nextState = parsed && typeof parsed === "object"
          ? { ...parsed, ui: { ...(parsed.ui || {}), docType: desiredDocType } }
          : { ui: { docType: desiredDocType } };
        localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify(nextState));
      }
    } catch {}
    setIsSeedReady(true);
  }, [desiredDocType]);

  if (!isSeedReady) return null;

  const resolveDocTypeGuard = (choice) => {
    if (choice === "invoice") {
      try {
        const cleanState = buildCleanContinueCreateState("invoice");
        localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify(cleanState));
      } catch {}
    }
    setTypeSwitchGuardPending(false);
    if (typeof onResolveDocTypeGuard === "function") {
      onResolveDocTypeGuard(choice === "invoice" ? "invoice" : "estimate", { forceRemount: choice === "invoice" });
    }
  };

  return (
    <>
      <EstimateForm
        key={`estimate:${resetSeq}`}
        forceProfileOnMount={false}
        spinTick={spinTick}
        mobileBottomChromeVisible={mobileBottomChromeVisible}
        shellBottomChromeVisible={shellBottomChromeVisible}
        shellOverlayOpen={shellOverlayOpen}
        onGuidedOverlayOpenChange={onGuidedOverlayOpenChange}
        homeEstimateLaunch={homeEstimateLaunch}
        onHomeEstimateLaunchConsumed={onHomeEstimateLaunchConsumed}
      />
      {typeSwitchGuardPending ? (
        <div style={DOC_TYPE_GUARD_MODAL_OVERLAY_STYLE} role="dialog" aria-modal="true" aria-label="Estimate draft in progress">
          <div style={DOC_TYPE_GUARD_MODAL_CARD_STYLE}>
            <div style={DOC_TYPE_GUARD_MODAL_TEXT_STYLE}>
              You have an estimate draft in progress. Continue editing the estimate or start a blank invoice?
            </div>
            <div style={DOC_TYPE_GUARD_MODAL_ACTIONS_STYLE}>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => resolveDocTypeGuard("estimate")}
              >
                Continue Estimate
              </button>
              <button
                type="button"
                className="pe-btn"
                onClick={() => resolveDocTypeGuard("invoice")}
              >
                Start Blank Invoice
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function homeRelDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return "Today";
  if (diff < 172800000) return "Yesterday";
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  try { return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; }
}

function homeMoney(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return "$0";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n); } catch { return `$${Math.round(n)}`; }
}

const HOME_PROJECT_STATUS_COLORS = {
  draft: { bg: "rgba(230,241,248,0.06)", border: "rgba(230,241,248,0.14)", color: "rgba(230,241,248,0.5)" },
  estimating: { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.22)", color: "rgba(245,158,11,0.84)" },
  active: { bg: "rgba(72,187,120,0.1)", border: "rgba(72,187,120,0.22)", color: "rgba(72,187,120,0.82)" },
  completed: { bg: "rgba(99,179,237,0.1)", border: "rgba(99,179,237,0.22)", color: "rgba(99,179,237,0.84)" },
  archived: { bg: "rgba(230,241,248,0.04)", border: "rgba(230,241,248,0.1)", color: "rgba(230,241,248,0.35)" },
};

/* =========================
   Placeholder screens (theme-safe)
   ========================= */

function HomeScreen({
  spinTick,
  onLogoTap,
  onLogoLongPress,
  liveDraftResume,
  businessPulseCounts,
  dashboardSummary,
  onResumeLastEstimate,
  recentProjects,
  onOpenProjectDetail,
}) {
  const pressTimerRef = useRef(null);
  const didLongPressRef = useRef(false);
  const LONG_PRESS_MS = 650;
  const hasLiveDraft = Boolean(liveDraftResume);
  const resumeHeadline = String(liveDraftResume?.headline || "").trim();
  const resumeMetaItems = Array.isArray(liveDraftResume?.resumeMetaItems) ? liveDraftResume.resumeMetaItems : [];
  const pulseItems = [
    {
      key: "pending-estimates",
      label: "Pending",
      sublabel: "estimates",
      value: Number(businessPulseCounts?.pendingEstimates || 0),
      tone: "estimate",
    },
    {
      key: "approved-estimates",
      label: "Approved",
      sublabel: "estimates",
      value: Number(businessPulseCounts?.approvedEstimates || 0),
      tone: "estimate",
    },
    {
      key: "unpaid-invoices",
      label: "Unpaid",
      sublabel: "invoices",
      value: Number(businessPulseCounts?.unpaidInvoices || 0),
      tone: "invoice",
    },
    {
      key: "overdue-invoices",
      label: "Overdue",
      sublabel: "invoices",
      value: Number(businessPulseCounts?.overdueInvoices || 0),
      tone: "invoice",
    },
  ];
  const dashboard = dashboardSummary && typeof dashboardSummary === "object" ? dashboardSummary : {};
  const spotlightItems = [
    {
      key: "balance-due",
      label: "Balance due",
      value: homeMoney(dashboard?.unpaidBalance || 0),
      detail: Number(dashboard?.unpaidInvoices || 0) > 0
        ? `${Number(dashboard.unpaidInvoices)} open ${Number(dashboard.unpaidInvoices) === 1 ? "invoice" : "invoices"}`
        : "No open invoices",
      tone: Number(dashboard?.unpaidBalance || 0) > 0 ? "warning" : "neutral",
    },
    {
      key: "overdue",
      label: "Overdue",
      value: Number(dashboard?.overdueInvoices || 0),
      detail: Number(dashboard?.overdueBalance || 0) > 0 ? homeMoney(dashboard.overdueBalance) : "Caught up",
      tone: Number(dashboard?.overdueInvoices || 0) > 0 ? "danger" : "neutral",
    },
    {
      key: "paid",
      label: "Paid",
      value: homeMoney(dashboard?.paidAmount || 0),
      detail: Number(dashboard?.paidAmount || 0) > 0 ? "Collected to date" : "No payments yet",
      tone: Number(dashboard?.paidAmount || 0) > 0 ? "good" : "neutral",
    },
    {
      key: "active-projects",
      label: "Active projects",
      value: Number(dashboard?.activeProjectCount || 0),
      detail: Number(dashboard?.approvedEstimates || 0) > 0
        ? `${Number(dashboard.approvedEstimates)} approved ${Number(dashboard.approvedEstimates) === 1 ? "estimate" : "estimates"}`
        : "Recent jobs in motion",
      tone: Number(dashboard?.activeProjectCount || 0) > 0 ? "info" : "neutral",
    },
  ];
  const nextSteps = Array.isArray(dashboard?.nextSteps) ? dashboard.nextSteps : [];
  const stripeCardTone = dashboard?.stripe?.connected ? "good" : "info";
  const commandAccent = Number(dashboard?.overdueInvoices || 0) > 0
    ? "linear-gradient(135deg, rgba(239,68,68,0.22), rgba(59,130,246,0.12) 52%, rgba(16,185,129,0.14))"
    : Number(dashboard?.unpaidBalance || 0) > 0
      ? "linear-gradient(135deg, rgba(245,158,11,0.2), rgba(59,130,246,0.12) 52%, rgba(16,185,129,0.14))"
      : "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(99,102,241,0.1) 52%, rgba(16,185,129,0.14))";

  const startPress = () => {
    try { if (pressTimerRef.current) clearTimeout(pressTimerRef.current); } catch {}
    didLongPressRef.current = false;
    pressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      try { onLogoLongPress && onLogoLongPress(); } catch {}
    }, LONG_PRESS_MS);
  };

  const endPress = () => {
    try { if (pressTimerRef.current) clearTimeout(pressTimerRef.current); } catch {}
    pressTimerRef.current = null;
  };

  const onTap = () => {
    if (didLongPressRef.current) return;
    try { onLogoTap && onLogoTap(); } catch {}
  };

  return (
    <div className="pe-main pe-home-screen" style={{ paddingTop: 0 }}>
      <div className="pe-home-shell">
      <div className="pe-card pe-home-hero" style={{ overflow: "hidden", background: `${commandAccent}, linear-gradient(180deg, rgba(9, 14, 21, 0.98), rgba(7, 10, 15, 0.98))`, borderColor: "rgba(168, 184, 196, 0.14)" }}>
        <div className="pe-home-hero-graphics" aria-hidden="true">
          <span className="pe-home-hero-rail pe-home-hero-rail-left" />
          <span className="pe-home-hero-rail pe-home-hero-rail-right" />
          <span className="pe-home-hero-band" />
        </div>
        <div className="pe-home-hero-stack">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(7, 11, 16, 0.32)", color: "rgba(226,234,241,0.72)", fontSize: 10.5, fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase" }}>
            Command Dashboard
          </div>
          <div
            className="pe-home-wordmark"
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "2px",
              textTransform: "uppercase",
              opacity: 0.75,
              lineHeight: 1.1,
              marginBottom: 2,
              textShadow: "0 2px 6px rgba(0,0,0,0.45), 0 6px 18px rgba(0,0,0,0.35)",
              display: "inline-flex",
              alignItems: "baseline",
              justifyContent: "center",
            }}
          >
            <span>ESTIPAID</span>
            <span
              style={{
                fontSize: 9,
                marginLeft: 2,
                position: "relative",
                top: -4,
                letterSpacing: "0px",
                opacity: 0.9,
              }}
            >
              ™
            </span>
          </div>

          <div
            className="pe-home-logo-tap"
            role="button"
            tabIndex={0}
            onMouseDown={startPress}
            onMouseUp={endPress}
            onMouseLeave={endPress}
            onTouchStart={startPress}
            onTouchEnd={endPress}
            onTouchCancel={endPress}
            onClick={onTap}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTap();
              }
            }}
            style={{ display: "flex", justifyContent: "center", margin: "0 auto 2px", cursor: "pointer", maxWidth: "100%" }}
          >
            <div className="pe-home-logo-offset" style={{ transform: "translateX(-15px)" }}>
              <EstiPaidInlineLogo
                key={spinTick}
                className="esti-spin"
                style={{
                  height: 72,
                  width: "auto",
                  display: "block",
                  objectFit: "contain",
                  filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.38))",
                }}
                draggable={false}
              />
            </div>
          </div>
          <div
            className="pe-home-tagline"
            style={{
              marginTop: 4,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "2.2px",
              textTransform: "uppercase",
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.96), rgba(200,210,255,0.86))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              textShadow:
                "0 1px 0 rgba(255,255,255,0.14), 0 10px 18px rgba(0,0,0,0.34)",
              opacity: 0.98,
            }}
          >
            Turn Scope into Revenue
          </div>
          <div
            className="pe-home-subline"
            style={{
              marginTop: 10,
              fontSize: 13,
              lineHeight: 1.5,
              color: "rgba(220,229,238,0.72)",
              maxWidth: 520,
              textAlign: "center",
            }}
          >
            See what needs attention, what has been paid, and the safest next move before you open anything else.
          </div>
          <div className="pe-home-spotlight-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, width: "100%", marginTop: 18 }}>
            {spotlightItems.map((item) => {
              const toneStyles = item.tone === "danger"
                ? { border: "rgba(239,68,68,0.28)", glow: "rgba(239,68,68,0.12)", value: "rgba(254,202,202,0.98)", tag: "rgba(248,113,113,0.84)" }
                : item.tone === "warning"
                  ? { border: "rgba(245,158,11,0.26)", glow: "rgba(245,158,11,0.1)", value: "rgba(254,240,138,0.98)", tag: "rgba(251,191,36,0.86)" }
                  : item.tone === "good"
                    ? { border: "rgba(34,197,94,0.24)", glow: "rgba(34,197,94,0.1)", value: "rgba(187,247,208,0.98)", tag: "rgba(74,222,128,0.82)" }
                    : item.tone === "info"
                      ? { border: "rgba(59,130,246,0.24)", glow: "rgba(59,130,246,0.1)", value: "rgba(191,219,254,0.98)", tag: "rgba(96,165,250,0.84)" }
                      : { border: "rgba(255,255,255,0.1)", glow: "rgba(255,255,255,0.04)", value: "rgba(236,243,248,0.96)", tag: "rgba(203,213,225,0.78)" };
              return (
                <div
                  key={item.key}
                  className="pe-home-spotlight-card"
                  style={{
                    minWidth: 0,
                    display: "grid",
                    gap: 6,
                    padding: "12px 12px 11px",
                    borderRadius: 16,
                    border: `1px solid ${toneStyles.border}`,
                    background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.008)), rgba(7, 11, 16, 0.24)",
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.035), 0 10px 22px ${toneStyles.glow}`,
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: toneStyles.tag }}>
                    {item.label}
                  </div>
                  <div className="pe-home-money-value" style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.04em", color: toneStyles.value, lineHeight: 1 }}>
                    {item.value}
                  </div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.4, color: "rgba(220,229,238,0.66)" }}>
                    {item.detail}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {hasLiveDraft ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8 }}>
          <div className="pe-card pe-home-momentum-panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="pe-home-momentum-primary">
              <div className="pe-home-momentum-label">Resume</div>
              <div className="pe-home-resume-card">
                {resumeHeadline ? <div className="pe-home-resume-title">{resumeHeadline}</div> : null}
                {resumeMetaItems.length > 0 ? (
                  <div className="pe-home-resume-meta">
                    {resumeMetaItems.map((item) => (
                      <div key={item.key} className={`pe-home-resume-meta-item pe-home-resume-meta-${item.tone}`}>
                        <span className="pe-home-resume-meta-value">{item.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                className="pe-btn pe-home-resume-btn"
                type="button"
                onClick={() => {
                  try {
                    onResumeLastEstimate && onResumeLastEstimate();
                  } catch {}
                }}
              >
                Resume Draft
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 8 }}>
        <div className="pe-card pe-home-pulse-panel" style={{ minWidth: 0 }}>
          <div className="pe-home-pulse-eyebrow">Business Pulse</div>
          <div className="pe-home-pulse-strip" role="list" aria-label="Business Pulse">
            {pulseItems.map((item) => (
              <div key={item.key} className={`pe-home-pulse-item pe-home-pulse-item--${item.tone}`} role="listitem" style={{ padding: "10px 10px 9px" }}>
                <div className="pe-home-pulse-value">{item.value}</div>
                <div className="pe-home-pulse-label">{item.label}</div>
                <div style={{ fontSize: 10.5, lineHeight: 1.3, color: "rgba(190,205,218,0.52)" }}>{item.sublabel}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="pe-card" style={{ display: "grid", gap: 10, padding: "12px 14px", minWidth: 0, borderColor: stripeCardTone === "good" ? "rgba(34,197,94,0.18)" : "rgba(59,130,246,0.16)" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(180,196,208,0.48)" }}>
              Next up
            </div>
            <div style={{ fontSize: 16, fontWeight: 850, color: "rgba(239,245,249,0.97)" }}>
              What needs attention next
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {nextSteps.map((step) => {
              const toneStyles = step.tone === "danger"
                ? { border: "rgba(239,68,68,0.2)", dot: "rgba(248,113,113,0.9)", bg: "rgba(239,68,68,0.06)" }
                : step.tone === "warning"
                  ? { border: "rgba(245,158,11,0.2)", dot: "rgba(251,191,36,0.9)", bg: "rgba(245,158,11,0.06)" }
                  : step.tone === "good"
                    ? { border: "rgba(34,197,94,0.18)", dot: "rgba(74,222,128,0.88)", bg: "rgba(34,197,94,0.05)" }
                    : { border: "rgba(59,130,246,0.18)", dot: "rgba(96,165,250,0.88)", bg: "rgba(59,130,246,0.05)" };
              return (
                <div key={step.key} style={{ display: "grid", gap: 4, padding: "10px 11px", borderRadius: 14, border: `1px solid ${toneStyles.border}`, background: toneStyles.bg }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: toneStyles.dot, flexShrink: 0 }} />
                    <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(235,243,248,0.96)" }}>{step.title}</div>
                  </div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "rgba(205,217,226,0.7)" }}>{step.detail}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "grid", gap: 6, paddingTop: 2, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(180,196,208,0.48)" }}>
                Stripe readiness
              </div>
              <span style={{
                padding: "4px 9px",
                borderRadius: 999,
                border: stripeCardTone === "good" ? "1px solid rgba(34,197,94,0.2)" : "1px solid rgba(59,130,246,0.18)",
                background: stripeCardTone === "good" ? "rgba(34,197,94,0.08)" : "rgba(59,130,246,0.08)",
                color: stripeCardTone === "good" ? "rgba(74,222,128,0.88)" : "rgba(147,197,253,0.86)",
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}>
                {dashboard?.stripe?.connected ? "Connected" : "Not connected"}
              </span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "rgba(217,227,235,0.76)" }}>
              {dashboard?.stripe?.connected
                ? "Stripe is connected, so online invoice payments can be enabled from your current account setup."
                : "Connect Stripe in Company Profile when you want customers to pay invoices online."}
            </div>
          </div>
        </div>
      </div>

      {recentProjects && recentProjects.length > 0 ? (
        <div className="pe-card pe-home-projects-panel" style={{ overflow: "hidden" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.5, padding: "14px 16px 10px" }}>
            Active Projects
          </div>
          <div style={{ display: "grid", gap: 0 }}>
            {recentProjects.map((p, idx) => {
              const pName = String(p?.projectName || "").trim() || "Untitled Project";
              const cName = String(p?._customerName || p?.customerName || "").trim();
              const dsKey = p?._displayStatus?.key || "draft";
              const dsLabel = p?._displayStatus?.label || "Draft";
              const SC = HOME_PROJECT_STATUS_COLORS[dsKey] || HOME_PROJECT_STATUS_COLORS.draft;
              const actDate = homeRelDate(p?._latestActivityAt || 0);
              const overdueCount = p?._overdueCount || 0;
              const balDue = p?._totals?.balanceRemaining || 0;
              const approvedEstCount = p?._approvedEstCount || 0;
              const hasSignals = overdueCount > 0 || balDue > 0 || approvedEstCount > 0;
              return (
                <button
                  key={String(p?.id || idx)}
                  type="button"
                  style={{
                    display: "grid",
                    gap: 6,
                    width: "100%",
                    padding: "11px 16px",
                    borderTop: "1px solid rgba(255,255,255,0.07)",
                    borderRight: "none",
                    borderBottom: "none",
                    borderLeft: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    color: "inherit",
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                  onClick={() => {
                    try { onOpenProjectDetail && onOpenProjectDetail(String(p?.id || "")); } catch {}
                  }}
                >
                  {/* Identity + status badge */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.3, letterSpacing: 0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {pName}
                      </div>
                      {cName ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                          <div style={{ fontSize: 12.5, color: "rgba(99,179,237,0.78)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                            {cName}
                          </div>
                          {actDate ? <div style={{ fontSize: 11, opacity: 0.35, fontWeight: 600, flexShrink: 0 }}>{actDate}</div> : null}
                        </div>
                      ) : (
                        actDate ? <div style={{ fontSize: 11, opacity: 0.35, fontWeight: 600, marginTop: 3 }}>{actDate}</div> : null
                      )}
                    </div>
                    <span style={{
                      flexShrink: 0,
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: SC.bg,
                      color: SC.color,
                      border: `1px solid ${SC.border}`,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                    }}>
                      {dsLabel}
                    </span>
                  </div>

                  {/* Attention signals */}
                  {hasSignals ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {overdueCount > 0 ? (
                        <span className="pe-home-project-signal" style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.22)", color: "rgba(239,68,68,0.88)", fontSize: 10.5, fontWeight: 700 }}>
                          {overdueCount === 1 ? "1 overdue" : `${overdueCount} overdue`}
                        </span>
                      ) : null}
                      {balDue > 0 ? (
                        <span className="pe-home-project-signal pe-home-money-chip" style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "rgba(245,158,11,0.84)", fontSize: 10.5, fontWeight: 700 }}>
                          {homeMoney(balDue)} due
                        </span>
                      ) : null}
                      {approvedEstCount > 0 ? (
                        <span className="pe-home-project-signal" style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(72,187,120,0.08)", border: "1px solid rgba(72,187,120,0.2)", color: "rgba(72,187,120,0.82)", fontSize: 10.5, fontWeight: 700 }}>
                          {approvedEstCount === 1 ? "1 estimate approved" : `${approvedEstCount} estimates approved`}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="pe-home-spacer" aria-hidden="true" />

      <footer className="pe-home-closer" aria-hidden="true">
        <span className="pe-home-closer-mark">EstiPaid</span>
        <span className="pe-home-closer-tm">™</span>
      </footer>
      </div>
    </div>
  );
}


/* =========================
   Styles (transparent overlays + legibility)
   ========================= */
const styles = {
  shell: {
    minHeight: "100%",
    height: "auto",
    width: "100%",
    position: "relative",
    overflow: "visible",
    background: "var(--pe-app-bg)",
    backgroundColor: "var(--pe-app-bg-solid)",
  },

  // overlay header
  topbar: {
    height: `calc(${HEADER_H}px + env(safe-area-inset-top, 0px) + ${HEADER_SAFE_GAP}px)`,
    position: "fixed",
    top: 0,
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(1100px, calc(100% - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 24px))",
    maxWidth: "100%",
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: `calc(env(safe-area-inset-top, 0px) + ${HEADER_SAFE_GAP}px)`,
    paddingRight: 12,
    paddingBottom: 0,
    paddingLeft: 12,
    boxSizing: "border-box",
    background: "transparent",
    minWidth: 0,
    opacity: 1,
    pointerEvents: "auto",
    transition: "transform 220ms ease, opacity 180ms ease",
    willChange: "transform, opacity",
  },
  

  topbarScrolled: {
    background: "transparent",
    borderBottom: "none",
  },
  topbarHidden: {
    transform: "translate(-50%, calc(-100% - env(safe-area-inset-top, 0px) - 10px))",
    opacity: 0,
    pointerEvents: "none",
  },

  headerSpinBtn: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    background: "transparent",
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    boxShadow: "none",
    padding: 0,
    margin: 0,
    width: 44,
    height: 44,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    pointerEvents: "auto",
    userSelect: "none",
    borderRadius: 999,
    appearance: "none",
    WebkitAppearance: "none",
    lineHeight: 0,
    fontSize: 0,
    zIndex: 5,
  },

  quickOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(3, 7, 12, 0.62)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    zIndex: 80,
  },
  quickMenu: {
    position: "fixed",
    top: `calc(env(safe-area-inset-top, 0px) + ${HEADER_H + HEADER_SAFE_GAP + 18}px)`,
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(520px, calc(100% - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 24px))",
    zIndex: 85,
    padding: 18,
    borderRadius: 24,
    background: "linear-gradient(180deg, rgba(16, 24, 34, 0.96), rgba(8, 13, 20, 0.94))",
    border: "1px solid rgba(164, 184, 197, 0.14)",
    backdropFilter: "blur(18px) saturate(118%)",
    WebkitBackdropFilter: "blur(18px) saturate(118%)",
    boxShadow: "0 34px 80px rgba(0,0,0,0.44), inset 0 1px 0 rgba(255,255,255,0.05)",
    overflow: "hidden",
  },
  quickTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  quickTitle: {
    fontWeight: 900,
    letterSpacing: "0.14em",
    fontSize: 11,
    textTransform: "uppercase",
    color: "rgba(192, 206, 216, 0.78)",
  },
  quickClose: { width: 44, height: 44, display: "grid", placeItems: "center" },
  quickGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
  },
  quickItem: {
    height: 54,
    borderRadius: 16,
    fontWeight: 900,
    letterSpacing: "0.06em",
  },

  createLauncherPanel: {
    position: "fixed",
    top: `calc(env(safe-area-inset-top, 0px) + ${HEADER_H + HEADER_SAFE_GAP + 18}px)`,
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(520px, calc(100% - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 24px))",
    zIndex: 85,
    padding: 18,
    borderRadius: 24,
    background: "linear-gradient(180deg, rgba(16, 24, 34, 0.96), rgba(8, 13, 20, 0.94))",
    border: "1px solid rgba(164, 184, 197, 0.14)",
    backdropFilter: "blur(18px) saturate(118%)",
    WebkitBackdropFilter: "blur(18px) saturate(118%)",
    boxShadow: "0 34px 80px rgba(0,0,0,0.44), inset 0 1px 0 rgba(255,255,255,0.05)",
    overflow: "hidden",
  },
  createLauncherStack: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  createLauncherHero: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    height: "auto",
    padding: "16px 14px 14px",
    borderRadius: 16,
    background: "rgba(99,179,237,0.08)",
    border: "1px solid rgba(99,179,237,0.22)",
    cursor: "pointer",
  },
  createLauncherHeroLabel: {
    fontSize: 14,
    fontWeight: 900,
    color: "rgba(99,179,237,0.95)",
    letterSpacing: "0.06em",
  },
  createLauncherHeroHint: {
    fontSize: 11,
    fontWeight: 600,
    color: "rgba(230,241,248,0.4)",
    letterSpacing: "0.03em",
  },
  createLauncherRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
  },
  createLauncherAction: {
    height: 54,
    borderRadius: 16,
    fontWeight: 900,
    letterSpacing: "0.06em",
  },

  headerIconBtn: {
    padding: 0,
    width: 44,
    height: 44,
    display: "grid",
    placeItems: "center",
    borderRadius: 14,
    border: "1px solid rgba(168, 184, 195, 0.14)",
    background: "linear-gradient(180deg, rgba(23, 33, 45, 0.94), rgba(10, 15, 23, 0.92))",
    boxShadow: "0 18px 28px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)",
    backdropFilter: "blur(14px) saturate(118%)",
    WebkitBackdropFilter: "blur(14px) saturate(118%)",
  },
  headerMenuIcon: {
    fontSize: 24,
    lineHeight: 1,
    fontWeight: 800,
  },
  title: {
    fontWeight: 900,
    letterSpacing: "0.2px",
    fontSize: 15,
    opacity: 0.98,
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },
  profileCircle: {
    width: 32,
    height: 32,
    borderRadius: 999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 900,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },

  profileLogo: {
    width: 40,
    height: 40,
    display: "block",
    margin: "0 auto",
    objectFit: "contain",
    filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.35))",
    position: "relative",
    zIndex: 2,
  },
  profileLogoWrap: {
    position: "relative",
    width: 40,
    height: 40,
    display: "grid",
    placeItems: "center",
  },
  profileLogoCueRing: {
    position: "absolute",
    inset: -2,
    borderRadius: 999,
    border: "1px dashed rgba(186, 230, 253, 0.32)",
    boxShadow: "0 0 10px rgba(147, 197, 253, 0.14)",
    opacity: 0.2,
    animation: "peLogoCuePulse 2.8s ease-in-out infinite",
    pointerEvents: "none",
    zIndex: 1,
  },
  profileLogoCueBadge: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 13,
    height: 13,
    borderRadius: 999,
    border: "1px solid rgba(191, 219, 254, 0.44)",
    background: "rgba(15, 23, 42, 0.74)",
    color: "rgba(239, 246, 255, 0.92)",
    display: "grid",
    placeItems: "center",
    fontSize: 10,
    fontWeight: 900,
    lineHeight: 1,
    pointerEvents: "none",
    zIndex: 3,
  },
  profileLogoCueText: {
    position: "absolute",
    left: "50%",
    bottom: -10,
    transform: "translateX(-50%)",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: "0.08em",
    color: "rgba(219, 234, 254, 0.68)",
    textTransform: "uppercase",
    textShadow: "0 1px 4px rgba(0,0,0,0.32)",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    zIndex: 3,
  },

  // full-height scroll under overlays
  content: {
    position: "relative",
    width: "100%",
    paddingTop: `calc(${HEADER_H}px + env(safe-area-inset-top, 0px) + ${HEADER_SAFE_GAP}px + clamp(10px, 2.2vh, 18px))`,
    paddingBottom: `calc(${FOOTER_H}px + env(safe-area-inset-bottom, 0px) + ${FOOTER_FLOAT_GAP}px + ${FOOTER_CONTENT_BREATHING})`,
    scrollPaddingTop: `calc(${HEADER_H}px + env(safe-area-inset-top, 0px) + ${HEADER_SAFE_GAP}px + 18px)`,
    scrollPaddingBottom: `calc(${FOOTER_H}px + env(safe-area-inset-bottom, 0px) + ${FOOTER_FLOAT_GAP}px + ${FOOTER_CONTENT_BREATHING})`,
    background: "var(--pe-app-bg)",
    backgroundColor: "var(--pe-app-bg-solid)",
    boxSizing: "border-box",
  },
  contentCreateMobile: {
    paddingBottom: `calc(${FOOTER_H + 88}px + env(safe-area-inset-bottom, 0px))`,
    scrollPaddingBottom: `calc(${FOOTER_H + 88}px + env(safe-area-inset-bottom, 0px))`,
  },
  contentMobile: {
    paddingBottom: `calc(${FOOTER_H}px + env(safe-area-inset-bottom, 0px) + ${FOOTER_CONTENT_BREATHING})`,
    scrollPaddingBottom: `calc(${FOOTER_H}px + env(safe-area-inset-bottom, 0px) + ${FOOTER_CONTENT_BREATHING})`,
  },
  contentLocked: {
    maxHeight: "100dvh",
    overflow: "hidden",
    pointerEvents: "none",
    touchAction: "none",
    overscrollBehavior: "none",
  },

  // overlay footer
  bottomnav: {
    minHeight: FOOTER_H,
    height: "auto",
    position: "fixed",
    left: 0,
    transform: "translateY(0)",
    width: "100%",
    maxWidth: "100%",
    bottom: 0,
    zIndex: 50,
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    gap: 6,
    boxSizing: "border-box",
    paddingTop: 0,
    paddingRight: 4,
    paddingBottom: 0,
    paddingLeft: 4,
    background: "transparent",
    opacity: 1,
    pointerEvents: "auto",
    transition: "transform 220ms ease, opacity 180ms ease",
    willChange: "transform, opacity",
  },
  bottomnavCreateMotion: {
    transition: "transform 320ms cubic-bezier(0.22, 0.86, 0.24, 1), opacity 260ms cubic-bezier(0.22, 0.76, 0.24, 1)",
  },
  bottomnavHidden: {
    transform: "translateY(calc(100% + env(safe-area-inset-bottom, 0px) + 24px))",
    opacity: 0,
    pointerEvents: "none",
  },
  navBtn: {
    flex: 1,
    background: "linear-gradient(180deg, rgba(18, 27, 38, 0.92), rgba(8, 12, 19, 0.9))",
    border: "1px solid rgba(154, 174, 188, 0.12)",
    color: "inherit",
    minHeight: 72,
    padding: "9px 6px 11px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 18,
    cursor: "pointer",
    transition: "opacity 140ms ease, transform 90ms ease",
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
    boxShadow: "0 16px 26px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.04)",
    backdropFilter: "blur(14px) saturate(118%)",
    WebkitBackdropFilter: "blur(14px) saturate(118%)",
  },
  navBtnActive: {
    background: "linear-gradient(180deg, rgba(36, 52, 67, 0.94), rgba(13, 21, 31, 0.92))",
    border: "1px solid rgba(190, 208, 219, 0.18)",
    boxShadow: "0 18px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.07)",
  },
  navIconWrap: { display: "flex", alignItems: "center", justifyContent: "center" },
  createIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 999,
    border: "1px solid rgba(196, 214, 224, 0.2)",
    background: "linear-gradient(180deg, rgba(44, 61, 75, 0.94), rgba(16, 24, 34, 0.94))",
    boxShadow: "0 16px 30px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)",
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },
  navLabel: { fontSize: 11.5, lineHeight: 1.05, letterSpacing: "0.2px", fontWeight: 700 },

  // drawer overlay
  drawerOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(3, 7, 12, 0.6)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    zIndex: 1100,
  },
  drawer: {
    position: "fixed",
    top: 0,
    left: 0,
    width: 260,
    height: "100dvh",
    minHeight: "100vh",
    zIndex: 1105,
    padding: "calc(env(safe-area-inset-top, 0px) + 14px) 14px calc(env(safe-area-inset-bottom, 0px) + 18px)",
    background: "linear-gradient(180deg, rgba(14, 22, 31, 0.96), rgba(7, 11, 18, 0.94))",
    borderRight: "1px solid rgba(168, 184, 195, 0.12)",
    boxShadow: "20px 0 44px rgba(0,0,0,0.34), inset -1px 0 0 rgba(255,255,255,0.04)",
    backdropFilter: "blur(18px) saturate(118%)",
    WebkitBackdropFilter: "blur(18px) saturate(118%)",
    transition: "transform 220ms ease",
  },
  drawerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 2px 12px",
  },
  drawerTitle: {
    fontWeight: 900,
    letterSpacing: "0.14em",
    fontSize: 11,
    textTransform: "uppercase",
    color: "rgba(192, 206, 216, 0.78)",
  },
  drawerClose: { width: 44, height: 44, display: "grid", placeItems: "center" },
  drawerList: { display: "flex", flexDirection: "column", gap: 10, marginTop: 10 },
  drawerItem: { textAlign: "left", width: "100%", minHeight: 48, borderRadius: 14 },

  // Stepper
  stepperWrap: { padding: "10px 14px 0" },
  stepperRow: {
    display: "flex",
    gap: 8,
    overflowX: "auto",
    paddingBottom: 6,
  },
  stepPill: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 999,
    padding: "8px 10px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    color: "inherit",
    whiteSpace: "nowrap",
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },
  stepIndex: {
    width: 22,
    height: 22,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    fontSize: 12,
    background: "rgba(0,0,0,0.18)",
    border: "1px solid rgba(255,255,255,0.14)",
  },
  stepLabel: { fontWeight: 800, fontSize: 12, letterSpacing: "0.2px" },
};

function EstiPaidAppShell() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return undefined;
    installDevJobLearningConsole();
    return undefined;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const historyObj = window.history;
    let hasScrollRestoration = false;
    let previousScrollRestoration;
    try {
      hasScrollRestoration = !!historyObj && "scrollRestoration" in historyObj;
      if (hasScrollRestoration) {
        previousScrollRestoration = historyObj.scrollRestoration;
      }
    } catch {
      hasScrollRestoration = false;
      previousScrollRestoration = undefined;
    }

    if (hasScrollRestoration) {
      try {
        historyObj.scrollRestoration = "manual";
      } catch {}
    }

    const onPageShow = (event) => {
      if (event?.persisted) {
        resetAppScrollPosition();
      }
    };

    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      if (hasScrollRestoration && previousScrollRestoration !== undefined) {
        try {
          historyObj.scrollRestoration = previousScrollRestoration;
        } catch {}
      }
    };
  }, []);

  useEffect(() => {
    if (!shouldOpenDevJobLearningDiagnostics()) return undefined;

    const syncDevDiagnosticsRoute = () => {
      if (shouldOpenDevJobLearningDiagnostics()) {
        setActiveTab(ROUTES.JOB_LEARNING_DIAGNOSTICS);
      }
    };

    syncDevDiagnosticsRoute();
    window.addEventListener("hashchange", syncDevDiagnosticsRoute);
    return () => {
      window.removeEventListener("hashchange", syncDevDiagnosticsRoute);
    };
  }, []);

  // Patch localStorage.setItem so we can detect language selection inside EstimateForm (same tab)
  useEffect(() => {
    try {
      const orig = localStorage.setItem.bind(localStorage);
      if (!localStorage.__pePatched) {
        localStorage.setItem = (k, v) => {
          orig(k, v);
          try {
            window.dispatchEvent(
              new CustomEvent("pe-localstorage", { detail: { key: k, value: v } })
            );
          } catch {
            // ignore
          }
        };
        localStorage.__pePatched = true;
      }
    } catch {
      // ignore
    }
  }, []);

  const [lang] = useState(() => getSavedLang());
  const [activeTab, setActiveTab] = useState(() => ROUTES.HOME);
  const [routeEnterSeq, setRouteEnterSeq] = useState(0);
  const [userProfileDirty, setUserProfileDirty] = useState(false);
  const [showUnsavedProfileModal, setShowUnsavedProfileModal] = useState(false);
  const [showLeaveEditModal, setShowLeaveEditModal] = useState(false);
  const [showCreateFromEditModal, setShowCreateFromEditModal] = useState(false);
  const [draftOverwriteGuard, setDraftOverwriteGuard] = useState(null);
  const [createEditSessionActive, setCreateEditSessionActive] = useState(false);
  const [createFromEditIntent, setCreateFromEditIntent] = useState(BUILDER_INTENTS.ESTIMATE);
  const [createResetSeq, setCreateResetSeq] = useState(0);
  const [createIntent, setCreateIntent] = useState(BUILDER_INTENTS.ESTIMATE);
  const [guidedOverlayOpen, setGuidedOverlayOpen] = useState(false);
  const [homeEstimateLaunch, setHomeEstimateLaunch] = useState(null);
  const [newProjectReturnRoute, setNewProjectReturnRoute] = useState(ROUTES.PROJECTS);
  const [projectDetailBackRoute, setProjectDetailBackRoute] = useState(ROUTES.PROJECTS);
  const pendingProfileLeaveTabRef = useRef(null);
  const pendingEditLeaveTabRef = useRef(null);
const [spinTick, setSpinTick] = useState(0);
  const [customerHistory, setCustomerHistory] = useState(() => loadSavedCustomers());
  const [estimateHistory, setEstimateHistory] = useState(() => loadSavedEstimates());
  const [invoiceHistory, setInvoiceHistory] = useState(() => readStoredInvoices());
  const [requestedInvoiceComposerEstimateId, setRequestedInvoiceComposerEstimateId] = useState("");
  const [projectHistory, setProjectHistory] = useState(() => readStoredProjects());
  const [draftStorageVersion, setDraftStorageVersion] = useState(0);
  const liveDraftResumeMeta = useMemo(() => readLiveDraftResumeMeta(draftStorageVersion), [draftStorageVersion]);
  const businessPulseCounts = useMemo(() => {
    const estimateRecords = Array.isArray(estimateHistory)
      ? estimateHistory.filter((entry) => String(entry?.docType || "estimate").toLowerCase() !== "invoice")
      : [];
    return deriveBusinessPulseCounts(estimateRecords, invoiceHistory);
  }, [estimateHistory, invoiceHistory]);

  const recentProjects = useMemo(() => {
    try {
      const allProjects = Array.isArray(projectHistory) ? projectHistory : [];
      const customerRecords = Array.isArray(customerHistory) ? customerHistory : [];
      const estRecords = Array.isArray(estimateHistory) ? estimateHistory : [];
      const invRecords = Array.isArray(invoiceHistory) ? invoiceHistory : [];
      const mapped = allProjects
        .map((p) => {
          const view = buildNormalizedProjectView({ project: p, projects: allProjects, customers: customerRecords, estimates: estRecords, invoices: invRecords });
          const ds = deriveProjectDisplayStatus(view);
          const projInvoices = view.invoices || [];
          const projEstimates = view.estimates || [];
          return {
            ...p,
            _displayStatus: ds,
            _customerName: view.customer?.name || view.customer?.companyName || view.customer?.fullName || p.customerName || "",
            _latestActivityAt: view.latestActivityAt || 0,
            _totals: view.totals || {},
            _overdueCount: projInvoices.filter((inv) => deriveInvoiceStatus(inv) === INVOICE_STATUSES.OVERDUE).length,
            _approvedEstCount: projEstimates.filter((est) => String(est?.status || "").toLowerCase() === "approved").length,
          };
        })
        .filter((p) => p._displayStatus.key !== "archived");
      mapped.sort((a, b) => {
        const pa = a._overdueCount > 0 ? 0 : (a._totals?.balanceRemaining > 0 ? 1 : (a._approvedEstCount > 0 ? 2 : 3));
        const pb = b._overdueCount > 0 ? 0 : (b._totals?.balanceRemaining > 0 ? 1 : (b._approvedEstCount > 0 ? 2 : 3));
        if (pa !== pb) return pa - pb;
        return (b._latestActivityAt || 0) - (a._latestActivityAt || 0);
      });
      return mapped.slice(0, 5);
    } catch { return []; }
  }, [customerHistory, projectHistory, estimateHistory, invoiceHistory]);
  const homeDashboardSummary = useMemo(() => {
    let companyProfile = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE);
      companyProfile = raw ? (safeParseJson(raw) || {}) : {};
    } catch {
      companyProfile = {};
    }
    return deriveHomeDashboardSummary({
      invoices: invoiceHistory,
      projects: recentProjects,
      businessPulseCounts,
      companyProfile,
    });
  }, [invoiceHistory, recentProjects, businessPulseCounts]);

  const shellT = useCallback((key) => {
    const en = {
      estimateNumLabel: "Estimate #",
      invoiceNumLabel: "Invoice #",
    };
    const es = {
      estimateNumLabel: "Estimación #",
      invoiceNumLabel: "Factura #",
    };
    const dict = lang === "es" ? es : en;
    return dict[key] || key;
  }, [lang]);


  // ===== In-progress estimate draft (survives tab switches) =====
  const ESTIMATE_DRAFT_KEY = STORAGE_KEYS.ESTIMATE_DRAFT;
  const hasEstimateDraft = useCallback(() => {
    try {
      const raw = localStorage.getItem(ESTIMATE_DRAFT_KEY);
      if (!raw) return false;
      // If it's just an empty object, treat as no draft
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return raw.length > 10;
      const keys = Object.keys(parsed).filter((k) => !String(k).startsWith("__") && k !== "savedAt");
      if (!keys.length) return false;
      // any meaningful value
      for (const k of keys) {
        const v = parsed[k];
        if (v === null || v === undefined) continue;
        if (typeof v === "string" && v.trim()) return true;
        if (typeof v === "number" && Number.isFinite(v) && v !== 0) return true;
        if (typeof v === "boolean" && v === true) return true;
        if (Array.isArray(v) && v.length) return true;
        if (typeof v === "object" && Object.keys(v).length) return true;
      }
      return false;
    } catch {
      try {
        return !!localStorage.getItem(ESTIMATE_DRAFT_KEY);
      } catch {
        return false;
      }
    }
  }, [ESTIMATE_DRAFT_KEY]);

  useEffect(() => {
    const onUserProfileDirty = (e) => {
      const dirty = Boolean(e?.detail?.dirty);
      setUserProfileDirty(dirty);
    };
    window.addEventListener("estipaid:user-profile-dirty", onUserProfileDirty);
    return () => window.removeEventListener("estipaid:user-profile-dirty", onUserProfileDirty);
  }, [hasEstimateDraft]);

  const enterTab = useCallback((nextTab, intent) => {
    if (intent) setCreateIntent(intent);
    setActiveTab(nextTab);
    if (nextTab !== ROUTES.HOME) setRouteEnterSeq((n) => n + 1);
  }, []);

  const prepareCompanyProfileReturnTarget = useCallback((requestedTab = "") => {
    writeProfileReturnTarget(buildProfileReturnTarget(activeTab, createIntent, requestedTab));
  }, [activeTab, createIntent]);

  const ensureBuilderAccess = useCallback((requestedTab = "") => {
    const gate = requireCompanyProfile({
      message: "Company Profile required. Open Company Profile?",
      onRequireProfile: () => {
        prepareCompanyProfileReturnTarget(requestedTab);
        enterTab(ROUTES.COMPANY_PROFILE);
      },
    });
    return !!gate?.allowed;
  }, [enterTab, prepareCompanyProfileReturnTarget]);

  const performNavigation = useCallback((tab, options = {}) => {
    const skipCreateDraftSave = Boolean(options?.skipCreateDraftSave);
    const isBuilderTarget =
      tab === ROUTES.CREATE
      || tab === ROUTES.ESTIMATE_BUILDER
      || tab === ROUTES.INVOICE_BUILDER;
    if (isBuilderTarget && !ensureBuilderAccess(tab)) return;

    let nextIntent = null;
    if (tab === ROUTES.ESTIMATE_BUILDER) nextIntent = BUILDER_INTENTS.ESTIMATE;
    else if (tab === ROUTES.INVOICE_BUILDER) nextIntent = BUILDER_INTENTS.INVOICE;

    const nextTab = isBuilderTarget ? ROUTES.CREATE : tab;
    if (isBuilderTarget) {
      const { estimateEditTarget, invoiceEditTarget } = readValidatedCreateEditTargets();
      setCreateEditSessionActive(Boolean(estimateEditTarget || invoiceEditTarget));
    } else {
      setCreateEditSessionActive(false);
      setShowCreateFromEditModal(false);
    }
    try {
      if (activeTab === ROUTES.CREATE && nextTab !== ROUTES.CREATE && !skipCreateDraftSave) {
        try { localStorage.setItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE, "1"); } catch {}
        window.dispatchEvent(new Event("estipaid:draft-save-now"));
      }
    } catch {}
    try { enterTab(nextTab, nextIntent); } catch {}
  }, [activeTab, ensureBuilderAccess, enterTab]);

  const navigateTo = useCallback((tab, options = {}) => {
    const bypassDirtyGuard = Boolean(options?.bypassDirtyGuard);
    const isLeavingUserProfile = activeTab === ROUTES.COMPANY_PROFILE && tab !== ROUTES.COMPANY_PROFILE;

    if (!bypassDirtyGuard && isLeavingUserProfile && userProfileDirty) {
      pendingProfileLeaveTabRef.current = tab;
      setShowUnsavedProfileModal(true);
      return;
    }

    const isBuilderDestination =
      tab === ROUTES.CREATE || tab === ROUTES.ESTIMATE_BUILDER || tab === ROUTES.INVOICE_BUILDER;
    if (!bypassDirtyGuard && activeTab === ROUTES.CREATE && createEditSessionActive && !isBuilderDestination) {
      pendingEditLeaveTabRef.current = tab;
      setShowLeaveEditModal(true);
      return;
    }

    performNavigation(tab, options);
  }, [activeTab, userProfileDirty, createEditSessionActive, performNavigation]);

  const navigateToCompanyProfile = useCallback((options = {}) => {
    prepareCompanyProfileReturnTarget();
    navigateTo(ROUTES.COMPANY_PROFILE, options);
  }, [navigateTo, prepareCompanyProfileReturnTarget]);

  const armProjectDetailReturnTarget = useCallback(() => {
    const projectId = String(readProjectDetailTarget() || "").trim();
    if (!projectId) {
      clearProjectDetailReturnTarget();
      return;
    }
    writeProjectDetailReturnTarget({ route: ROUTES.PROJECT_DETAIL, projectId });
  }, []);

  const resolveProjectDetailBackRoute = useCallback((route) => {
    const candidate = String(route || "").trim();
    if (
      candidate === ROUTES.HOME
      || candidate === ROUTES.PROJECTS
      || candidate === ROUTES.CUSTOMERS
      || candidate === ROUTES.ESTIMATES
      || candidate === ROUTES.INVOICES
    ) {
      return candidate;
    }
    return ROUTES.PROJECTS;
  }, []);

  const openProjectDetail = useCallback((projectId, originRoute = activeTab) => {
    clearProjectDetailReturnTarget();
    writeProjectDetailTarget(projectId);
    setProjectDetailBackRoute(resolveProjectDetailBackRoute(originRoute));
    navigateTo(ROUTES.PROJECT_DETAIL);
  }, [activeTab, navigateTo, resolveProjectDetailBackRoute]);

  // Centralized guard for any flow that would replace/prefill the single shared
  // live estimator draft slot (Project/Customer "Start Estimate", Home AI Assist,
  // etc.). If the slot currently holds meaningful, unsaved content, defer the
  // overwrite behind an explicit user choice instead of silently clearing it.
  const guardSharedDraftOverwrite = useCallback((proceed, copy = {}) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE);
      const parsed = raw ? safeParseJson(raw) : null;
      if (hasMeaningfulEstimateDraftContent(parsed)) {
        setDraftOverwriteGuard({
          proceed,
          title: copy.title || "You have a draft in progress",
          body: copy.body || "Starting a new estimate will replace the draft currently in the builder.",
          confirmLabel: copy.confirmLabel || "Discard and Start New Estimate",
        });
        return;
      }
    } catch {}
    proceed();
  }, []);

  const resetProjectDetailSeededBuilderSession = useCallback(() => {
    try {
      localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
      localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
      localStorage.removeItem(ACTIVE_EDIT_CONTEXT_KEY);
      localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE);
      localStorage.removeItem(STORAGE_KEYS.ESTIMATE_DRAFT);
      localStorage.removeItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE);
    } catch {}
    setCreateEditSessionActive(false);
    setShowCreateFromEditModal(false);
    setHomeEstimateLaunch(null);
    setCreateResetSeq((n) => n + 1);
  }, []);

  const launchNewProject = useCallback(() => {
    clearProjectDetailReturnTarget();
    setNewProjectReturnRoute(activeTab && activeTab !== ROUTES.NEW_PROJECT ? activeTab : ROUTES.PROJECTS);
    navigateTo(ROUTES.NEW_PROJECT);
  }, [activeTab, navigateTo]);

  const performLaunchEstimateFromHome = useCallback((roughPrompt = "", launchOptions = {}) => {
    const options = launchOptions && typeof launchOptions === "object" ? launchOptions : {};
    const prompt = String(roughPrompt || "").trim();
    const launchMode = String(options?.mode || "").trim() === "open_only" ? "open_only" : "";
    const cleanSession = options?.cleanSession !== false;
    const launchSource = String(options?.source || "home_ai_assist").trim() || "home_ai_assist";
    if (!ensureBuilderAccess()) return;
    if (cleanSession) {
      try {
        localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
        localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
        localStorage.removeItem(ACTIVE_EDIT_CONTEXT_KEY);
        localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE);
        localStorage.removeItem(STORAGE_KEYS.ESTIMATE_DRAFT);
        localStorage.removeItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE);
        localStorage.removeItem(STORAGE_KEYS.PENDING_CUSTOMER_USE);
        localStorage.removeItem(STORAGE_KEYS.PENDING_CUSTOMER_CREATE);
        localStorage.removeItem(PROJECT_CREATE_SEED_KEY);
      } catch {}
      setCreateEditSessionActive(false);
      setShowCreateFromEditModal(false);
      setCreateResetSeq((n) => n + 1);
    } else {
      try {
        localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
        localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
      } catch {}
    }
    clearProjectDetailReturnTarget();
    if (prompt || launchMode === "open_only") {
      setHomeEstimateLaunch({
        id: `home-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        prompt: launchMode === "open_only" ? "" : prompt,
        source: launchSource,
        cleanSession,
        ...(launchMode ? { mode: launchMode } : {}),
        ts: Date.now(),
      });
    } else {
      setHomeEstimateLaunch(null);
    }
    navigateTo(ROUTES.ESTIMATE_BUILDER);
  }, [ensureBuilderAccess, navigateTo]);

  const launchEstimateFromHome = useCallback((roughPrompt = "", launchOptions = {}) => {
    const options = launchOptions && typeof launchOptions === "object" ? launchOptions : {};
    const cleanSession = options?.cleanSession !== false;
    if (!cleanSession) {
      performLaunchEstimateFromHome(roughPrompt, launchOptions);
      return;
    }
    guardSharedDraftOverwrite(
      () => performLaunchEstimateFromHome(roughPrompt, launchOptions),
      { body: "Starting a new estimate will replace the draft currently in the builder." }
    );
  }, [performLaunchEstimateFromHome, guardSharedDraftOverwrite]);

  const consumeHomeEstimateLaunch = useCallback((launchId = "") => {
    setHomeEstimateLaunch((current) => {
      if (!current) return null;
      if (!launchId) return null;
      return String(current?.id || "") === String(launchId) ? null : current;
    });
  }, []);

  const continueCreateFromEdit = useCallback(() => {
    setShowCreateFromEditModal(false);
    setCreateEditSessionActive(false);
    try {
      localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
      localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
    } catch {}
    clearProjectDetailReturnTarget();

    let draftRaw = "";
    try {
      draftRaw = String(localStorage.getItem(ESTIMATE_DRAFT_KEY) || "");
    } catch {}

    const desiredDocType = createFromEditIntent === BUILDER_INTENTS.INVOICE ? "invoice" : "estimate";
    let nextEstimatorStateRaw = "";

    if (draftRaw) {
      const parsedDraft = safeParseJson(draftRaw);
      const hasObjectDraft = parsedDraft && typeof parsedDraft === "object" && !Array.isArray(parsedDraft);
      const draftDocType = parsedDraft?.ui?.docType === "invoice" ? "invoice" : "estimate";
      nextEstimatorStateRaw = hasObjectDraft && draftDocType === desiredDocType
        ? draftRaw
        : JSON.stringify(buildCleanContinueCreateState(desiredDocType));
    }

    if (nextEstimatorStateRaw) {
      try { localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, nextEstimatorStateRaw); } catch {}
    } else {
      try { localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE); } catch {}
    }

    setCreateResetSeq((n) => n + 1);
    navigateTo(createFromEditIntent === BUILDER_INTENTS.INVOICE ? ROUTES.INVOICE_BUILDER : ROUTES.ESTIMATE_BUILDER);
  }, [ESTIMATE_DRAFT_KEY, createFromEditIntent, navigateTo]);

  const onResolveDocTypeGuard = useCallback((resolvedDocType, opts) => {
    setCreateIntent(resolvedDocType === "invoice" ? BUILDER_INTENTS.INVOICE : BUILDER_INTENTS.ESTIMATE);
    if (opts && opts.forceRemount) {
      setCreateResetSeq((n) => n + 1);
    }
  }, []);

  const onCreateButtonRoute = useCallback((intent = BUILDER_INTENTS.ESTIMATE) => {
    const { estimateEditTarget, invoiceEditTarget } = readValidatedCreateEditTargets();

    const nextIntent = intent === BUILDER_INTENTS.INVOICE ? BUILDER_INTENTS.INVOICE : BUILDER_INTENTS.ESTIMATE;
    if (estimateEditTarget || invoiceEditTarget || createEditSessionActive) {
      setCreateFromEditIntent(nextIntent);
      setShowCreateFromEditModal(true);
      return;
    }

    const desiredDocType = nextIntent === BUILDER_INTENTS.INVOICE ? "invoice" : "estimate";

    // Symmetric docType-aware guard: New Estimate and New Invoice both check
    // the live ESTIMATOR_STATE draft. Only warn when the requested docType
    // actually differs from the chambered draft's docType — switching to the
    // same docType the draft already is should never prompt.
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE);
      const parsed = raw ? safeParseJson(raw) : null;
      const currentDocType = parsed?.ui?.docType === "invoice" ? "invoice" : "estimate";
      if (currentDocType !== desiredDocType && hasMeaningfulEstimateDraftContent(parsed)) {
        setDraftOverwriteGuard({
          proceed: () => {
            try {
              localStorage.setItem(
                STORAGE_KEYS.ESTIMATOR_STATE,
                JSON.stringify(buildCleanContinueCreateState(desiredDocType))
              );
            } catch {}
            setCreateResetSeq((n) => n + 1);
            setHomeEstimateLaunch(null);
            clearProjectDetailReturnTarget();
            navigateTo(nextIntent === BUILDER_INTENTS.INVOICE ? ROUTES.INVOICE_BUILDER : ROUTES.ESTIMATE_BUILDER);
          },
          title: "You have a draft in progress",
          body: desiredDocType === "invoice"
            ? "Starting a new invoice will replace the draft currently in the builder."
            : "Starting a new estimate will replace the draft currently in the builder.",
          confirmLabel: desiredDocType === "invoice" ? "Discard and Start New Invoice" : "Discard and Start New Estimate",
        });
        return;
      }
    } catch {}

    setHomeEstimateLaunch(null);
    clearProjectDetailReturnTarget();
    navigateTo(nextIntent === BUILDER_INTENTS.INVOICE ? ROUTES.INVOICE_BUILDER : ROUTES.ESTIMATE_BUILDER);
  }, [createEditSessionActive, navigateTo, setHomeEstimateLaunch]);

  const clearEstimateOpenCustomersGuard = useCallback(() => {
    estimateOpenCustomersGuardUntilRef.current = 0;
  }, []);

  // ✅ Navigate to Customers screen (used by EstimateForm "Create New" shortcut)
  useEffect(() => {
    const onNavCustomers = () => {
      clearEstimateOpenCustomersGuard();
      try { navigateTo(ROUTES.CUSTOMERS); } catch {}
    };
    window.addEventListener("estipaid:navigate-customers", onNavCustomers);
    return () => window.removeEventListener("estipaid:navigate-customers", onNavCustomers);
  }, [clearEstimateOpenCustomersGuard, navigateTo]);

  useEffect(() => {
    const onNavEstimates = (event) => {
      if (activeTab === ROUTES.CREATE) {
        const returnTarget = readProjectDetailReturnTarget();
        if (returnTarget?.route === ROUTES.PROJECT_DETAIL) {
          if (returnTarget.projectId) {
            writeProjectDetailTarget(returnTarget.projectId);
          }
          clearProjectDetailReturnTarget();
          try { navigateTo(ROUTES.PROJECT_DETAIL, { bypassDirtyGuard: true }); } catch {}
          return;
        }
      }
      try {
        navigateTo(ROUTES.ESTIMATES, {
          bypassDirtyGuard: true,
          skipCreateDraftSave: Boolean(event?.detail?.skipCreateDraftSave),
        });
      } catch {}
    };
    const onNavInvoices = (event) => {
      if (activeTab === ROUTES.CREATE) {
        const returnTarget = readProjectDetailReturnTarget();
        if (returnTarget?.route === ROUTES.PROJECT_DETAIL) {
          if (returnTarget.projectId) {
            writeProjectDetailTarget(returnTarget.projectId);
          }
          clearProjectDetailReturnTarget();
          try { navigateTo(ROUTES.PROJECT_DETAIL, { bypassDirtyGuard: true }); } catch {}
          return;
        }
      }
      try {
        navigateTo(ROUTES.INVOICES, {
          bypassDirtyGuard: true,
          skipCreateDraftSave: Boolean(event?.detail?.skipCreateDraftSave),
        });
      } catch {}
    };
    window.addEventListener("estipaid:navigate-estimates", onNavEstimates);
    window.addEventListener("estipaid:navigate-invoices", onNavInvoices);
    return () => {
      window.removeEventListener("estipaid:navigate-estimates", onNavEstimates);
      window.removeEventListener("estipaid:navigate-invoices", onNavInvoices);
    };
  }, [activeTab, navigateTo]);

  useEffect(() => {
    const onNavEstimator = (event) => {
      const hasLiveProjectDetailReturnTarget = (() => {
        const returnTarget = readProjectDetailReturnTarget();
        return returnTarget?.route === ROUTES.PROJECT_DETAIL
          && String(returnTarget?.projectId || "").trim();
      })();
      if (!hasLiveProjectDetailReturnTarget) {
        clearProjectDetailReturnTarget();
      }
      try {
        const builderIntent = event?.detail?.builderIntent === BUILDER_INTENTS.INVOICE
          ? BUILDER_INTENTS.INVOICE
          : BUILDER_INTENTS.ESTIMATE;
        navigateTo(builderIntent === BUILDER_INTENTS.INVOICE ? ROUTES.INVOICE_BUILDER : ROUTES.ESTIMATE_BUILDER);
      } catch {}
    };
    window.addEventListener("estipaid:navigate-estimator", onNavEstimator);
    return () => window.removeEventListener("estipaid:navigate-estimator", onNavEstimator);
  }, [navigateTo]);

  useEffect(() => {
    const onNavInvoiceBuilder = () => {
      clearProjectDetailReturnTarget();
      try { navigateTo(ROUTES.INVOICE_BUILDER); } catch {}
    };
    window.addEventListener("estipaid:navigate-invoice-builder", onNavInvoiceBuilder);
    return () => window.removeEventListener("estipaid:navigate-invoice-builder", onNavInvoiceBuilder);
  }, [navigateTo]);

  useEffect(() => {
    const onNavCompanyProfile = () => {
      try { navigateToCompanyProfile(); } catch {}
    };
    const onNavUserProfile = () => {
      try { navigateToCompanyProfile(); } catch {}
    };
    window.addEventListener("estipaid:navigate-company-profile", onNavCompanyProfile);
    window.addEventListener("estipaid:navigate-user-profile", onNavUserProfile);
    return () => {
      window.removeEventListener("estipaid:navigate-company-profile", onNavCompanyProfile);
      window.removeEventListener("estipaid:navigate-user-profile", onNavUserProfile);
    };
  }, [navigateToCompanyProfile]);

  useEffect(() => {
    const onProfileSaveReturn = () => {
      const target = readProfileReturnTarget();
      if (!target) return;

      let didNavigate = false;

      if (target.route === ROUTES.CREATE) {
        const editContext = normalizeEditContext(target?.editContext);

        try {
          if (editContext?.type === "invoice") {
            const invoices = readStoredInvoices();
            const invoiceRecord = invoices.find((inv) => String(inv?.id || "").trim() === editContext.id);
            if (invoiceRecord && deriveInvoiceStatus(invoiceRecord) !== INVOICE_STATUSES.VOID) {
              localStorage.setItem(EDIT_INVOICE_TARGET_KEY, editContext.id);
              localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
            } else {
              localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
              localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
            }
          } else if (editContext?.type === "estimate") {
            localStorage.setItem(EDIT_ESTIMATE_TARGET_KEY, editContext.id);
            localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
          } else {
            localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
            localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
          }
        } catch {}

        try {
          navigateTo(
            target.intent === BUILDER_INTENTS.INVOICE ? ROUTES.INVOICE_BUILDER : ROUTES.ESTIMATE_BUILDER,
            { bypassDirtyGuard: true }
          );
          didNavigate = true;
        } catch {}
      } else {
        try {
          navigateTo(target.route, { bypassDirtyGuard: true });
          didNavigate = true;
        } catch {}
      }

      if (didNavigate) {
        clearProfileReturnTarget();
      }
    };

    window.addEventListener("estipaid:profile-save-return", onProfileSaveReturn);
    return () => window.removeEventListener("estipaid:profile-save-return", onProfileSaveReturn);
  }, [navigateTo]);

  useEffect(() => {
    const refresh = () => setEstimateHistory(loadSavedEstimates());
    refresh();
    const onStorage = (e) => {
      if (!e?.key || e.key === ESTIMATES_KEY) refresh();
    };
    const onLocalStorage = (event) => {
      if (!event?.detail?.key || event.detail.key === ESTIMATES_KEY) refresh();
    };
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        refresh();
      }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("estipaid:estimates-changed", refresh);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("estipaid:estimates-changed", refresh);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);

  useEffect(() => {
    const refresh = () => setInvoiceHistory(readStoredInvoices());
    refresh();
    const onStorage = (e) => {
      if (!e?.key || e.key === INVOICES_KEY) refresh();
    };
    const onLocalStorage = (event) => {
      if (!event?.detail?.key || event.detail.key === INVOICES_KEY) refresh();
    };
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        refresh();
      }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("estipaid:invoices-changed", refresh);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("estipaid:invoices-changed", refresh);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);

  useEffect(() => {
    if (activeTab !== ROUTES.INVOICES) return undefined;

    // Some invoice-card "Open" interactions can reach the builder without preserving
    // the intended edit target. Seed it from the clicked card before navigation.
    const seedInvoiceEditTargetFromCard = (event) => {
      const eventTarget = event?.target;
      if (!(eventTarget instanceof Element)) return;

      const button = eventTarget.closest("button");
      if (!button) return;

      const label = String(button.textContent || "").trim().toLowerCase();
      if (label !== "open" && label !== "abrir") return;

      const cardText = String(button.closest(".pe-card")?.textContent || "").trim().toLowerCase();
      if (!cardText) return;

      const matchingInvoices = (Array.isArray(invoiceHistory) ? invoiceHistory : []).filter((invoice) => {
        if (deriveInvoiceStatus(invoice) === INVOICE_STATUSES.VOID) return false;

        const candidates = [
          invoice?.invoiceNumber,
          invoice?.job?.docNumber,
          invoice?.projectName,
          invoice?.customerName,
          invoice?.estimateNumber,
          invoice?.customer?.projectName,
          invoice?.customer?.name,
        ]
          .map((value) => String(value || "").trim().toLowerCase())
          .filter(Boolean);

        return candidates.some((value) => cardText.includes(value));
      });

      if (matchingInvoices.length !== 1) return;

      const matchedId = String(matchingInvoices[0]?.id || "").trim();
      if (!matchedId) return;

      try {
        localStorage.setItem(EDIT_INVOICE_TARGET_KEY, matchedId);
        localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
      } catch {}
    };

    document.addEventListener("pointerdown", seedInvoiceEditTargetFromCard, true);
    document.addEventListener("click", seedInvoiceEditTargetFromCard, true);
    return () => {
      document.removeEventListener("pointerdown", seedInvoiceEditTargetFromCard, true);
      document.removeEventListener("click", seedInvoiceEditTargetFromCard, true);
    };
  }, [activeTab, invoiceHistory]);

  useEffect(() => {
    const refresh = () => setProjectHistory(readStoredProjects());
    refresh();
    const onStorage = (e) => {
      if (!e?.key || e.key === PROJECTS_KEY) refresh();
    };
    const onLocalStorage = (event) => {
      if (!event?.detail?.key || event.detail.key === PROJECTS_KEY) refresh();
    };
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        refresh();
      }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);

  useEffect(() => {
    if (activeTab !== ROUTES.HOME) return;
    setProjectHistory(readStoredProjects());
  }, [activeTab]);

  useEffect(() => {
    const refresh = (event) => {
      if (event?.key && event.key !== STORAGE_KEYS.ESTIMATOR_STATE) return;
      setDraftStorageVersion((version) => version + 1);
    };
    const onLocalStorage = (event) => {
      if (!event?.detail?.key || event.detail.key === STORAGE_KEYS.ESTIMATOR_STATE) {
        refresh(event);
      }
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("pe-localstorage", onLocalStorage);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pe-localstorage", onLocalStorage);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setCustomerHistory(loadSavedCustomers());
    const onStorage = (event) => {
      if (!event?.key || event.key === CUSTOMERS_KEY) refresh();
    };
    const onLocalStorage = (event) => {
      if (!event?.detail?.key || event.detail.key === CUSTOMERS_KEY) refresh();
    };
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        refresh();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("estipaid:customer-use", refresh);
    window.addEventListener("focus", refresh);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("estipaid:customer-use", refresh);
      window.removeEventListener("focus", refresh);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);

  useEffect(() => {
    const onShellAction = (evt) => {
      const action = String(evt?.detail?.action || "");
      if (!action) return;

      if (action === "continueLast") {
        const draftResume = readLiveDraftResumeMeta();
        if (!draftResume) return;
        clearProjectDetailReturnTarget();
        try {
          localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
          localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
          localStorage.removeItem(ACTIVE_EDIT_CONTEXT_KEY);
        } catch {}
        setHomeEstimateLaunch(null);
        navigateTo(draftResume.docType === "invoice" ? ROUTES.INVOICE_BUILDER : ROUTES.ESTIMATE_BUILDER);
        return;
      }

      if (action === "openCreate") {
        clearProjectDetailReturnTarget();
        navigateTo(ROUTES.ESTIMATE_BUILDER);
        return;
      }

      if (action === "newClear") {
        clearProjectDetailReturnTarget();
        try { localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE); } catch {}
        try { localStorage.removeItem(STORAGE_KEYS.ESTIMATE_DRAFT); } catch {}
        return;
      }

      if (action === "goEstimatesTab") {
        navigateTo(ROUTES.ESTIMATES);
        return;
      }

      if (action === "openCompanyProfile" || action === "openUserProfile") {
        navigateToCompanyProfile();
      }
    };

    window.addEventListener("pe-shell-action", onShellAction);
    return () => window.removeEventListener("pe-shell-action", onShellAction);
  }, [navigateTo, navigateToCompanyProfile]);

  // Warn on refresh/close if a draft exists (draft is still saved, but prevents surprise)
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!hasEstimateDraft()) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasEstimateDraft]);


  
  const [isScrolled, setIsScrolled] = useState(false);
  const isScrolledRef = useRef(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isMobileChromeViewport, setIsMobileChromeViewport] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(`(max-width: ${MOBILE_CHROME_MAX_WIDTH_PX}px)`).matches;
  });
  const chromeVisibleRef = useRef(true);
  const chromeScrollStateRef = useRef({ lastTop: 0, anchorTop: 0, direction: "none" });
  const [quickOpen, setQuickOpen] = useState(false);
  const quickOpenRef = useRef(false);
  const [createLauncherOpen, setCreateLauncherOpen] = useState(false);
  const setShellScrolled = useCallback((nextScrolled) => {
    if (isScrolledRef.current === nextScrolled) return;
    isScrolledRef.current = nextScrolled;
    setIsScrolled(nextScrolled);
  }, []);
  const setChromeVisibility = useCallback((nextVisible) => {
    if (chromeVisibleRef.current === nextVisible) return;
    chromeVisibleRef.current = nextVisible;
    setChromeVisible(nextVisible);
  }, []);

  useLayoutEffect(() => {
    setSpinTick((v) => v + 1);
    resetAppScrollPosition();
    isScrolledRef.current = false;
    setIsScrolled(false);
    chromeScrollStateRef.current = { lastTop: 0, anchorTop: 0, direction: "none" };
    setChromeVisibility(true);
    setQuickOpen(false);
  }, [activeTab, createIntent, setChromeVisibility]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_CHROME_MAX_WIDTH_PX}px)`);
    const syncMobileViewport = () => setIsMobileChromeViewport(mobileQuery.matches);
    syncMobileViewport();
    mobileQuery.addEventListener("change", syncMobileViewport);
    return () => mobileQuery.removeEventListener("change", syncMobileViewport);
  }, []);

  useEffect(() => {
    if (activeTab === ROUTES.COMPANY_PROFILE) return;
    pendingProfileLeaveTabRef.current = null;
    setShowUnsavedProfileModal(false);
    setUserProfileDirty(false);
    clearProfileReturnTarget();
  }, [activeTab]);
const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenRef = useRef(false);
  const estimateOpenCustomersGuardUntilRef = useRef(0);
  const edgeSwipeRef = useRef({
    tracking: false,
    triggered: false,
    startX: 0,
    startY: 0,
    touchId: null,
  });

  useEffect(() => {
    drawerOpenRef.current = drawerOpen;
  }, [drawerOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const body = document.body;
    if (!root || !body) return undefined;

    const prevRootOverflow = root.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverscroll = body.style.overscrollBehavior;

    if (drawerOpen) {
      root.style.overflow = "hidden";
      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "none";
    }

    return () => {
      root.style.overflow = prevRootOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.overscrollBehavior = prevBodyOverscroll;
    };
  }, [drawerOpen]);

  useEffect(() => {
    quickOpenRef.current = quickOpen;
  }, [quickOpen]);

  useEffect(() => {
    if (activeTab === ROUTES.CREATE) return;
    setGuidedOverlayOpen(false);
  }, [activeTab]);

  useEffect(() => {
    const armEstimateOpenCustomersGuard = () => {
      estimateOpenCustomersGuardUntilRef.current = Date.now() + ESTIMATE_OPEN_CUSTOMERS_GUARD_MS;
    };
    window.addEventListener("estipaid:estimate-open", armEstimateOpenCustomersGuard);
    return () => window.removeEventListener("estipaid:estimate-open", armEstimateOpenCustomersGuard);
  }, []);

  useEffect(() => {
    const clearOnUserInteraction = () => {
      if (Date.now() < Number(estimateOpenCustomersGuardUntilRef.current || 0)) {
        clearEstimateOpenCustomersGuard();
      }
    };
    window.addEventListener("pointerdown", clearOnUserInteraction, true);
    window.addEventListener("touchstart", clearOnUserInteraction, true);
    return () => {
      window.removeEventListener("pointerdown", clearOnUserInteraction, true);
      window.removeEventListener("touchstart", clearOnUserInteraction, true);
    };
  }, [clearEstimateOpenCustomersGuard]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    const supportsTouch = typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : ("ontouchstart" in window);
    if (!supportsTouch) return undefined;

    const findTouchById = (touches, touchId) => {
      if (!touches || touchId === null || touchId === undefined) return null;
      for (let i = 0; i < touches.length; i += 1) {
        if (touches[i]?.identifier === touchId) return touches[i];
      }
      return null;
    };

    const resetGesture = () => {
      edgeSwipeRef.current = {
        tracking: false,
        triggered: false,
        startX: 0,
        startY: 0,
        touchId: null,
      };
    };

    const onTouchStart = (event) => {
      if (drawerOpenRef.current || quickOpenRef.current) {
        resetGesture();
        return;
      }
      if (event.defaultPrevented) {
        resetGesture();
        return;
      }
      if ((event.touches?.length || 0) !== 1) {
        resetGesture();
        return;
      }
      const touch = event.touches[0];
      if (!touch || touch.clientX > MENU_EDGE_SWIPE_ZONE_PX) {
        resetGesture();
        return;
      }
      if (isMenuEdgeSwipeBlockedTarget(event.target)) {
        resetGesture();
        return;
      }

      edgeSwipeRef.current = {
        tracking: true,
        triggered: false,
        startX: touch.clientX,
        startY: touch.clientY,
        touchId: touch.identifier,
      };
    };

    const onTouchMove = (event) => {
      const gesture = edgeSwipeRef.current;
      if (!gesture.tracking || gesture.triggered) return;

      const touch = findTouchById(event.touches, gesture.touchId);
      if (!touch) {
        resetGesture();
        return;
      }

      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDy >= MENU_EDGE_SWIPE_VERTICAL_CANCEL_PX && absDy > absDx) {
        resetGesture();
        return;
      }

      if (dx <= 0) return;
      if (dx < MENU_EDGE_SWIPE_OPEN_PX) return;
      if (absDx <= absDy * MENU_EDGE_SWIPE_HORIZONTAL_RATIO) return;
      if (drawerOpenRef.current || quickOpenRef.current) {
        resetGesture();
        return;
      }

      edgeSwipeRef.current = {
        ...gesture,
        tracking: false,
        triggered: true,
      };
      setDrawerOpen(true);
    };

    const onTouchEnd = () => {
      resetGesture();
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  // Keep a tiny global flag so nested screens can hard-lock into profile when requested
  useEffect(() => {
    try {
      window.__PE_FORCE_PROFILE__ = createIntent === BUILDER_INTENTS.PROFILE;
    } catch {
      // ignore
    }
  }, [createIntent]);
const gated = false;
  const topRightLogoMeta = useMemo(() => {
    const DEFAULT = DEFAULT_LOGO;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE);
      if (!raw) return { src: DEFAULT, hasCustomLogo: false };
      const obj = JSON.parse(raw);
      const candidates = [
        obj?.logoDataUrl,
        obj?.logo,
        obj?.logoUrl,
        obj?.logoData,
        obj?.companyLogo,
      ];
      const picked = candidates.find((s) => typeof s === "string" && s.trim().length > 0);
      return { src: picked || DEFAULT, hasCustomLogo: Boolean(picked) };
    } catch {
      return { src: DEFAULT, hasCustomLogo: false };
    }
  // Intentionally depend on activeTab so this effect re-reads localStorage on tab changes
  // (for example after saving a new company logo); the callback body does not use it directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  const topRightLogoSrc = topRightLogoMeta.src;
  const showAddLogoCue = !topRightLogoMeta.hasCustomLogo;


  const handleHomeLogoTap = () => {
    try { navigateTo(ROUTES.HOME); } catch {}
  };
  const handleHomeLogoLongPress = () => {
    try { setQuickOpen(true); } catch {}
  };

  const hideMobileBottomNav =
    isMobileChromeViewport
    && (activeTab === ROUTES.NEW_PROJECT || activeTab === ROUTES.EDIT_PROJECT);
  const showBottomNav = !hideMobileBottomNav;
  const mobileBottomNavActive = isMobileChromeViewport && showBottomNav;
  const mobileBuilderFooterActive = isMobileChromeViewport && activeTab === ROUTES.CREATE;
  const mobileFooterSwipeEnabled = mobileBottomNavActive || mobileBuilderFooterActive;
  const mobileFooterChromeVisible = mobileFooterSwipeEnabled ? chromeVisible : true;

  const renderScreen = () => {
    if (activeTab === ROUTES.HOME) return (
        <HomeScreen
        spinTick={spinTick}
        onLogoTap={handleHomeLogoTap}
        onLogoLongPress={handleHomeLogoLongPress}
        liveDraftResume={liveDraftResumeMeta}
        businessPulseCounts={businessPulseCounts}
        dashboardSummary={homeDashboardSummary}
        onResumeLastEstimate={() => {
          try {
            window.dispatchEvent(
              new CustomEvent("pe-shell-action", {
                detail: { action: "continueLast" },
              })
            );
          } catch {}
        }}
        recentProjects={recentProjects}
        onOpenProjectDetail={(projectId) => {
          openProjectDetail(projectId, ROUTES.HOME);
        }}
      />
    );
    if (activeTab === ROUTES.CUSTOMERS)
      return (
        <CustomersScreen
          lang={lang}
          onDone={(p) => {
            try {
              const id = String(p?.id || "");
              if (id) {
                try { window.dispatchEvent(new CustomEvent("estipaid:customer-use", { detail: { id, customer: p?.customer || null } })); } catch {}
              }
            } catch {}
            try {
              const builderIntent = p?.builderIntent === BUILDER_INTENTS.INVOICE
                ? BUILDER_INTENTS.INVOICE
                : BUILDER_INTENTS.ESTIMATE;
              navigateTo(builderIntent === BUILDER_INTENTS.INVOICE ? ROUTES.INVOICE_BUILDER : ROUTES.ESTIMATE_BUILDER);
            } catch {}
          }}
          onOpenProjectDetail={(projectId) => {
            openProjectDetail(projectId, ROUTES.CUSTOMERS);
          }}
        />
      );
    if (activeTab === ROUTES.ESTIMATES) {
      return (
        <EstimatesScreen
          lang={lang}
          t={shellT}
          spinTick={spinTick}
          history={estimateHistory}
          requestedInvoiceComposerEstimateId={requestedInvoiceComposerEstimateId}
          onInvoiceComposerRequestHandled={() => setRequestedInvoiceComposerEstimateId("")}
          onDone={() => navigateTo(ROUTES.HOME)}
          onOpenEstimate={() => {
            clearProjectDetailReturnTarget();
            navigateTo(ROUTES.ESTIMATE_BUILDER);
          }}
          onOpenProjectDetail={(projectId) => {
            openProjectDetail(projectId, ROUTES.ESTIMATES);
          }}
        />
      );
    }
    if (activeTab === ROUTES.EDIT_PROJECT) {
      return (
        <EditProjectScreen
          onBack={() => navigateTo(ROUTES.PROJECT_DETAIL)}
          onSave={() => navigateTo(ROUTES.PROJECT_DETAIL)}
        />
      );
    }
    if (activeTab === ROUTES.PROJECT_DETAIL) {
      return (
        <ProjectDetailScreen
          onBack={() => {
            clearProjectDetailReturnTarget();
            navigateTo(projectDetailBackRoute || ROUTES.PROJECTS);
          }}
          onEditProject={() => navigateTo(ROUTES.EDIT_PROJECT)}
          onOpenEstimate={(estimate) => {
            armProjectDetailReturnTarget();
            const id = String(estimate?.id || "").trim();
            try {
              if (id) localStorage.setItem(EDIT_ESTIMATE_TARGET_KEY, id);
              else localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
              localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
            } catch {}
            setCreateEditSessionActive(false);
            setHomeEstimateLaunch(null);
            try {
              window.dispatchEvent(new Event("estipaid:estimate-open"));
            } catch {}
            navigateTo(ROUTES.ESTIMATE_BUILDER);
          }}
          onOpenInvoice={(invoice) => {
            armProjectDetailReturnTarget();
            const id = String(invoice?.id || "").trim();
            try {
              if (id) localStorage.setItem(EDIT_INVOICE_TARGET_KEY, id);
              else localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
              localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
            } catch {}
            setCreateEditSessionActive(false);
            setHomeEstimateLaunch(null);
            navigateTo(ROUTES.INVOICE_BUILDER);
          }}
          onNewEstimate={() => {
            guardSharedDraftOverwrite(() => {
              armProjectDetailReturnTarget();
              resetProjectDetailSeededBuilderSession();
              navigateTo(ROUTES.ESTIMATE_BUILDER);
            }, { body: "Starting a new estimate will replace the draft currently in the builder." });
          }}
          onNewInvoice={() => {
            guardSharedDraftOverwrite(() => {
              armProjectDetailReturnTarget();
              resetProjectDetailSeededBuilderSession();
              navigateTo(ROUTES.INVOICE_BUILDER);
            }, { body: "Starting a new invoice will replace the draft currently in the builder." });
          }}
        />
      );
    }
    if (activeTab === ROUTES.INVOICES) {
      return (
        <InvoicesScreen
          lang={lang}
          t={shellT}
          spinTick={spinTick}
          onDone={() => navigateTo(ROUTES.HOME)}
          onOpenProjectDetail={(projectId) => {
            openProjectDetail(projectId, ROUTES.INVOICES);
          }}
        />
      );
    }
    if (activeTab === ROUTES.NEW_PROJECT) {
      return (
        <NewProjectScreen
          onBack={() => navigateTo(newProjectReturnRoute || ROUTES.PROJECTS)}
          onSave={(newProjectId) => {
            openProjectDetail(newProjectId, newProjectReturnRoute);
          }}
        />
      );
    }
    if (activeTab === ROUTES.PROJECTS) {
      return (
        <ProjectsScreen
          onOpenProjectDetail={(projectId) => {
            openProjectDetail(projectId, ROUTES.PROJECTS);
          }}
        />
      );
    }
    if (activeTab === ROUTES.TEMPLATES) {
      return (
        <TemplatesScreen
          onOpenBuilder={() => {
            onCreateButtonRoute(BUILDER_INTENTS.ESTIMATE);
          }}
        />
      );
    }
    if (activeTab === ROUTES.COMPANY_PROFILE) return CompanyProfileScreen ? <CompanyProfileScreen /> : <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} liveDraftResume={liveDraftResumeMeta} businessPulseCounts={businessPulseCounts} dashboardSummary={homeDashboardSummary} onResumeLastEstimate={() => { try { window.dispatchEvent(new CustomEvent("pe-shell-action", { detail: { action: "continueLast" } })); } catch {} }} recentProjects={recentProjects} onOpenProjectDetail={(projectId) => { openProjectDetail(projectId, ROUTES.HOME); }} />;
    if (activeTab === ROUTES.ADVANCED) return AdvancedSettingsScreen ? (
      <AdvancedSettingsScreen
        onOpenCompanyProfile={() => navigateToCompanyProfile()}
        onOpenTemplates={() => navigateTo(ROUTES.TEMPLATES)}
        onOpenSnapshot={() => navigateTo(ROUTES.SNAPSHOT)}
        snapshotAvailable={Boolean(FinancialSnapshotScreen)}
      />
    ) : <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} liveDraftResume={liveDraftResumeMeta} businessPulseCounts={businessPulseCounts} dashboardSummary={homeDashboardSummary} onResumeLastEstimate={() => { try { window.dispatchEvent(new CustomEvent("pe-shell-action", { detail: { action: "continueLast" } })); } catch {} }} recentProjects={recentProjects} onOpenProjectDetail={(projectId) => { openProjectDetail(projectId, ROUTES.HOME); }} />;
    if (activeTab === ROUTES.SNAPSHOT) return FinancialSnapshotScreen ? (
      <FinancialSnapshotScreen
        onCreateInvoiceFromEstimate={(estimate) => {
          const estimateId = String(estimate?.id || "").trim();
          if (!estimateId) return false;
          try {
            localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
            localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
          } catch {}
          setRequestedInvoiceComposerEstimateId(estimateId);
          navigateTo(ROUTES.ESTIMATES);
          return true;
        }}
      />
    ) : <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} liveDraftResume={liveDraftResumeMeta} businessPulseCounts={businessPulseCounts} dashboardSummary={homeDashboardSummary} onResumeLastEstimate={() => { try { window.dispatchEvent(new CustomEvent("pe-shell-action", { detail: { action: "continueLast" } })); } catch {} }} recentProjects={recentProjects} onOpenProjectDetail={(projectId) => { openProjectDetail(projectId, ROUTES.HOME); }} />;
    if (activeTab === ROUTES.JOB_LEARNING_DIAGNOSTICS) {
      if (process.env.NODE_ENV === "production") return null;
      return JobLearningDiagnosticsScreen ? <JobLearningDiagnosticsScreen /> : null;
    }
    if (activeTab === ROUTES.CREATE) {
      return (
        <CreateFlow
          key={`create:${createIntent || ""}:${createResetSeq}`}
          gated={gated}
          intent={createIntent}
          spinTick={spinTick}
          resetSeq={createResetSeq}
          mobileBottomChromeVisible={isMobileChromeViewport ? mobileFooterChromeVisible && !drawerOpen : true}
          shellBottomChromeVisible={(isMobileChromeViewport ? mobileFooterChromeVisible : chromeVisible) && !drawerOpen}
          shellOverlayOpen={drawerOpen}
          onGuidedOverlayOpenChange={setGuidedOverlayOpen}
          homeEstimateLaunch={homeEstimateLaunch}
          onHomeEstimateLaunchConsumed={consumeHomeEstimateLaunch}
          onResolveDocTypeGuard={onResolveDocTypeGuard}
        />
      );
    }
    return (
      <HomeScreen
        spinTick={spinTick}
        onLogoTap={handleHomeLogoTap}
        onLogoLongPress={handleHomeLogoLongPress}
        liveDraftResume={liveDraftResumeMeta}
        businessPulseCounts={businessPulseCounts}
        dashboardSummary={homeDashboardSummary}
        onResumeLastEstimate={() => {
          try {
            window.dispatchEvent(
              new CustomEvent("pe-shell-action", {
                detail: { action: "continueLast" },
              })
            );
          } catch {}
        }}
        recentProjects={recentProjects}
        onOpenProjectDetail={(projectId) => {
          openProjectDetail(projectId, ROUTES.HOME);
        }}
      />
    );
  };

  const onDrawerSelect = (key) => {
    setDrawerOpen(false);

    if (key === ROUTES.CREATE) {
      onCreateButtonRoute();
      return;
    }

    // Create navigation
    if (key === ROUTES.ADVANCED) {
      navigateTo(ROUTES.ADVANCED);
      return;
    }

        if (key === ROUTES.SNAPSHOT) {
          navigateTo(ROUTES.SNAPSHOT);
          return;
        }

// Company Profile / Templates
    if (key === "company") {
      navigateToCompanyProfile();
      return;
    }
    if (key === "templates") {
      clearProjectDetailReturnTarget();
      navigateTo(ROUTES.TEMPLATES);
      return;
    }

// Create actions
    if (key === "editCompany") {
      navigateToCompanyProfile();
      return;
    }

// Fallback: close only
  };
  const showHeaderSpin = activeTab !== ROUTES.HOME;
  const routeEnterKey = activeTab === ROUTES.HOME
    ? "home"
    : `${activeTab}:${createIntent || ""}:${routeEnterSeq}`;
  const glassOnScroll = activeTab !== ROUTES.HOME && activeTab !== ROUTES.CREATE;
  const handleWindowScroll = useCallback(() => {
    const st = readAppScrollTop();
    const nextScrolled = st > 6;
    setShellScrolled(nextScrolled);

    const nextState = chromeScrollStateRef.current;
    if (isMobileChromeViewport && !mobileFooterSwipeEnabled) {
      nextState.lastTop = st;
      nextState.anchorTop = st;
      nextState.direction = "none";
      setChromeVisibility(true);
      return;
    }

    if (st <= CHROME_TOP_REVEAL_THRESHOLD) {
      nextState.lastTop = st;
      nextState.anchorTop = st;
      nextState.direction = "up";
      setChromeVisibility(true);
      return;
    }

    const delta = st - nextState.lastTop;
    if (Math.abs(delta) < CHROME_DIRECTION_EPSILON) return;

    const direction = delta > 0 ? "down" : "up";
    if (direction !== nextState.direction) {
      nextState.direction = direction;
      nextState.anchorTop = nextState.lastTop;
    }

    const travel = Math.abs(st - nextState.anchorTop);

    if (direction === "down") {
      if (chromeVisibleRef.current && travel >= CHROME_HIDE_DISTANCE) {
        setChromeVisibility(false);
        nextState.anchorTop = st;
      }
    } else if (!chromeVisibleRef.current && travel >= CHROME_SHOW_DISTANCE) {
      setChromeVisibility(true);
      nextState.anchorTop = st;
    }

    nextState.lastTop = st;
  }, [isMobileChromeViewport, mobileFooterSwipeEnabled, setChromeVisibility, setShellScrolled]);
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    const scrollHost = getAppScrollHost();
    const useWindowListener =
      !scrollHost
      || scrollHost === document.scrollingElement
      || scrollHost === document.documentElement
      || scrollHost === document.body;
    const scrollTarget = useWindowListener ? window : scrollHost;
    scrollTarget.addEventListener("scroll", handleWindowScroll, { passive: true });
    return () => scrollTarget.removeEventListener("scroll", handleWindowScroll);
  }, [handleWindowScroll]);
  const unsavedModalOverlay = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };
  const unsavedModalCard = {
    width: "min(520px, 100%)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(10,10,10,0.85)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
    padding: 16,
    display: "grid",
    gap: 12,
  };
  const unsavedModalTitle = {
    fontSize: 14,
    fontWeight: 1000,
    letterSpacing: "0.7px",
  };
  const unsavedModalText = {
    fontSize: 13,
    opacity: 0.85,
    lineHeight: 1.35,
  };
  const unsavedModalActions = {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    flexWrap: "wrap",
    marginTop: 6,
  };

  return (
    <div className="pe-wrap pe-app pe-ledger-app" style={styles.shell}>
      
      {showHeaderSpin ? (
        <style>{`.pe-content img.esti-spin{ display:none !important; }`}</style>
      ) : null}
<style>{`
        @media (prefers-reduced-motion: no-preference){
          .pe-create-bump{ animation: peCreateBump 260ms ease-out; }
          @keyframes peCreateBump{
            0%{ transform: scale(0.96); }
            45%{ transform: scale(1.08); }
            100%{ transform: scale(1.00); }
          }
        }

@keyframes estiSpinPremium{
  0%{transform:rotate(0deg);}
  82%{transform:rotate(372deg);}
  100%{transform:rotate(360deg);}
}
@keyframes peLogoCuePulse{
  0%,100%{opacity:.17;transform:scale(1);}
  50%{opacity:.24;transform:scale(1.02);}
}
.esti-spin{
  animation:estiSpinPremium 0.6s cubic-bezier(.22,.9,.28,1);
  transform-origin:50% 50%;
  will-change:transform;
  animation-fill-mode: both;
}
      `}</style>

      <TopBar
        topRightLogoSrc={topRightLogoSrc}
        showAddLogoCue={showAddLogoCue}
        showHeaderSpin={showHeaderSpin}
        routeEnterKey={routeEnterKey}
        glassOnScroll={glassOnScroll}
        isScrolled={isScrolled}
        chromeVisible={chromeVisible}
        onHeaderSpinTap={() => {
          setQuickOpen(false);
          navigateTo(ROUTES.HOME);
        }}
        onHeaderSpinLongPress={() => {
          setQuickOpen(true);
        }}
        onMenu={() => setDrawerOpen(true)}
        onProfile={() => {
          setDrawerOpen(false);
          if (activeTab !== ROUTES.COMPANY_PROFILE) navigateToCompanyProfile();
        }}
      />
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSelect={onDrawerSelect}
        disabled={gated}
      />

      

      <QuickMenu
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onSelect={(key) => {
          setQuickOpen(false);
          if (key === ROUTES.HOME) {
            navigateTo(ROUTES.HOME);
            return;
          }
          if (key === ROUTES.CREATE) {
            setCreateLauncherOpen(true);
            return;
          }
          if (key === ROUTES.PROJECTS) {
            navigateTo(ROUTES.PROJECTS);
            return;
          }
          if (key === ROUTES.ESTIMATES) {
            navigateTo(ROUTES.ESTIMATES);
            return;
          }
          if (key === ROUTES.INVOICES) {
            navigateTo(ROUTES.INVOICES);
            return;
          }
          if (key === ROUTES.COMPANY_PROFILE) {
            navigateToCompanyProfile();
            return;
          }
        }}
      />

      <CreateLauncher
        open={createLauncherOpen}
        estimateActionLabel={(() => {
          try {
            const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE);
            const parsed = raw ? safeParseJson(raw) : null;
            const docType = parsed?.ui?.docType === "invoice" ? "invoice" : "estimate";
            return docType === "estimate" && hasMeaningfulEstimateDraftContent(parsed)
              ? "Resume Estimate Draft"
              : "Estimate";
          } catch {
            return "Estimate";
          }
        })()}
        onClose={() => setCreateLauncherOpen(false)}
        onAction={(action) => {
          setCreateLauncherOpen(false);
          if (action === "getStarted") {
            launchEstimateFromHome("", { mode: "open_only", source: "create_launcher_ai_assist" });
            return;
          }
          if (action === "estimate") {
            onCreateButtonRoute();
            return;
          }
          if (action === "project") {
            launchNewProject();
            return;
          }
          if (action === "invoice") {
            onCreateButtonRoute(BUILDER_INTENTS.INVOICE);
            return;
          }
        }}
      />

      {showCreateFromEditModal ? (
        <div style={unsavedModalOverlay} role="dialog" aria-modal="true" aria-label="Start new document">
          <div style={unsavedModalCard}>
            <div style={unsavedModalText}>
              You are currently editing a saved estimate or invoice.
              Starting a new one will discard any unsaved progress.
              Continue?
            </div>
            <div style={unsavedModalActions}>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => setShowCreateFromEditModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pe-btn"
                onClick={continueCreateFromEdit}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {draftOverwriteGuard ? (
        <div style={unsavedModalOverlay} role="dialog" aria-modal="true" aria-label={draftOverwriteGuard.title}>
          <div style={unsavedModalCard}>
            <div style={unsavedModalTitle}>{draftOverwriteGuard.title}</div>
            <div style={unsavedModalText}>{draftOverwriteGuard.body}</div>
            <div style={unsavedModalActions}>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => {
                  setDraftOverwriteGuard(null);
                  // Resume the existing live draft in its own docType builder —
                  // never an edit-session route, no edit-target keys are touched.
                  try {
                    const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE);
                    const parsed = raw ? safeParseJson(raw) : null;
                    const resumeDocType = parsed?.ui?.docType === "invoice" ? "invoice" : "estimate";
                    navigateTo(resumeDocType === "invoice" ? ROUTES.INVOICE_BUILDER : ROUTES.ESTIMATE_BUILDER);
                  } catch {}
                }}
              >
                Continue Current Draft
              </button>
              <button
                type="button"
                className="pe-btn"
                onClick={() => {
                  const proceed = draftOverwriteGuard?.proceed;
                  setDraftOverwriteGuard(null);
                  if (typeof proceed === "function") proceed();
                }}
              >
                {draftOverwriteGuard.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showLeaveEditModal ? (
        <div style={unsavedModalOverlay} role="dialog" aria-modal="true" aria-label="Leave edit session">
          <div style={unsavedModalCard}>
            <div style={unsavedModalText}>
              You are currently editing. Leaving will discard any unsaved changes.
              Continue?
            </div>
            <div style={unsavedModalActions}>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => setShowLeaveEditModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pe-btn"
                onClick={() => {
                  const target = pendingEditLeaveTabRef.current;
                  pendingEditLeaveTabRef.current = null;
                  setShowLeaveEditModal(false);
                  if (target) navigateTo(target, { bypassDirtyGuard: true });
                }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showUnsavedProfileModal ? (
        <div style={unsavedModalOverlay} role="dialog" aria-modal="true" aria-label="Unsaved changes">
          <div style={unsavedModalCard}>
            <div style={unsavedModalTitle}>Unsaved changes</div>
            <div style={unsavedModalText}>
              You have unsaved changes in your Company Profile. If you leave this page, they will be lost.
            </div>
            <div style={unsavedModalActions}>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => {
                  pendingProfileLeaveTabRef.current = null;
                  setShowUnsavedProfileModal(false);
                }}
              >
                Stay
              </button>
              <button
                type="button"
                className="pe-btn"
                onClick={() => {
                  const target = pendingProfileLeaveTabRef.current;
                  pendingProfileLeaveTabRef.current = null;
                  setShowUnsavedProfileModal(false);
                  if (target) navigateTo(target, { bypassDirtyGuard: true });
                }}
              >
                Leave without saving
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div
        className={`pe-content${activeTab === ROUTES.CREATE ? " pe-content-estimator" : ""}`}
        aria-hidden={drawerOpen ? "true" : undefined}
        style={isMobileChromeViewport
          ? {
              ...styles.content,
              ...(showBottomNav && activeTab !== ROUTES.CREATE
                ? styles.contentMobile
                : styles.contentCreateMobile),
              ...(drawerOpen ? styles.contentLocked : null),
            }
          : {
              ...styles.content,
              ...(isMobileChromeViewport ? styles.contentMobile : null),
              ...(drawerOpen ? styles.contentLocked : null),
            }}
      >
        {renderScreen()}
      </div>

      {showBottomNav ? (
        <BottomNav
          className="pe-mobile-footer"
          active={activeTab}
          chromeVisible={isMobileChromeViewport ? mobileFooterChromeVisible : chromeVisible}
          mobileCreateChromeMotion={activeTab === ROUTES.CREATE && isMobileChromeViewport}
          setActive={(key) => {
            if (key === ROUTES.CREATE) {
              setCreateLauncherOpen(true);
              return;
            }
            navigateTo(key);
          }}
          onQuickOpen={() => setQuickOpen(true)}
          disabled={gated || (activeTab === ROUTES.CREATE && guidedOverlayOpen)}
        />
      ) : null}
    </div>
  );
}

const authLoadingWrapStyle = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px 16px",
  boxSizing: "border-box",
};

function AuthLoadingScreen() {
  return (
    <div style={authLoadingWrapStyle}>
      <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
        <img
          src={DEFAULT_LOGO}
          alt="EstiPaid"
          style={{ height: 64, width: "auto", display: "block" }}
          draggable={false}
        />
        <div
          className="pe-field-helper"
          style={{ fontSize: 12.5, letterSpacing: "0.5px", opacity: 0.8 }}
        >
          Checking your session...
        </div>
      </div>
    </div>
  );
}

// Local/offline use is preserved when Supabase is not configured for this
// deployment (e.g. the current Jest test environment, or a build without
// REACT_APP_SUPABASE_* env vars): the app shell renders directly, exactly as
// it always has. Sign-in is only enforced when a real Supabase project is
// wired up for this build.
export default function App() {
  const auth = useSupabaseAuth();

  if (!auth.configured) {
    return <EstiPaidAppShell />;
  }

  if (auth.loading) {
    return <AuthLoadingScreen />;
  }

  if (!auth.session) {
    return <AuthScreen auth={auth} />;
  }

  return <EstiPaidAppShell />;
}
