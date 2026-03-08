// @ts-nocheck
/* eslint-disable */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./EstimateForm.css";

import { BUILD_TAG, STORAGE_KEY } from "./estimator/defaultState";
import { computeTotals } from "./estimator/engine";
import useEstimatorState, { useEstimatorState as useEstimatorStateNamed } from "./estimator/useEstimatorState";
import { computeDueDateFromCustomer, getNetTermsDays, getNetTermsLabel } from "./estimator/netTerms";
import PdfPromptModal from "./components/estimator/PdfPromptModal";
import SectionMaterials from "./components/estimator/SectionMaterials";
import { exportPdf } from "./pdf";
import {
  createMoneyFormatter,
  formatDateMMDDYYYY,
  normalizeHoursInput,
  normalizeMoneyInput,
  normalizeMultiplierInput,
  normalizePercentInput,
} from "./utils/format";
import { formatPhoneForDisplay, sanitizePdfToken } from "./utils/sanitize";
import { requireCompanyProfile } from "./utils/guards";
import { loadCompanyProfile } from "./utils/storage";
import { DEFAULT_SETTINGS, loadSettings } from "./utils/settings";
import { STORAGE_KEYS } from "./constants/storageKeys";
import { BUILDER_INTENTS, ROUTES } from "./constants/routes";

const money = createMoneyFormatter("en-US", "USD");
const LANG_KEY = STORAGE_KEYS.LANG;
const I18N = {
  en: {
    standard: "Standard (1.00×)",
    difficultAccess: "Difficult access (1.10×)",
    highRisk: "High-risk / PPE (1.20×)",
    offHours: "Off-hours / Night (1.25×)",
    customEllipsis: "Custom…",
    estimateTotal: "Estimate Total",
    laborLines: "labor line(s)",
    laborers: "laborer(s)",
    complexity: "× complexity",
    risk: "% risk",
    materialsMeta: "% materials",
    materials: "Materials",
    materialsMode: "Materials mode",
    materialsModeBlanket: "Blanket",
    materialsModeItemized: "Itemized",
    materialsCost: "Materials cost",
    markupPct: "Markup %",
    materialsBlanketDescriptionLabel: "Materials Description (prints on PDF)",
    materialsBlanketDescriptionPlaceholder: "Example: Include primer, caulk, fasteners, sundries, and disposal.",
    addMaterialItem: "+ Add Item",
    materialsItemizedHelp: "Itemized mode: qty × price (each) rolls into estimate total. Internal cost is for margin tracking only.",
    materialDesc: "Description",
    materialNote: "Line note (optional)",
    materialNotePlaceholder: "Prints under this item in the PDF",
    materialQty: "Qty",
    materialCostInternal: "Cost (internal)",
    materialCharge: "Price (each)",
    materialsItemizedTotal: "Itemized materials total",
  },
  es: {
    standard: "Estándar (1.00×)",
    difficultAccess: "Acceso difícil (1.10×)",
    highRisk: "Alto riesgo / PPE (1.20×)",
    offHours: "Fuera de horario / Noche (1.25×)",
    customEllipsis: "Personalizado…",
    estimateTotal: "Total estimado",
    laborLines: "línea(s) de mano de obra",
    laborers: "trabajador(es)",
    complexity: "× complejidad",
    risk: "% riesgo",
    materialsMeta: "% materiales",
    materials: "Materiales",
    materialsMode: "Modo de materiales",
    materialsModeBlanket: "Global",
    materialsModeItemized: "Detallado",
    materialsCost: "Costo de materiales",
    markupPct: "Margen %",
    materialsBlanketDescriptionLabel: "Descripción de materiales (se imprime en PDF)",
    materialsBlanketDescriptionPlaceholder: "Ejemplo: Incluye primer, sellador, fijaciones, insumos y disposición.",
    addMaterialItem: "+ Agregar Partida",
    materialsItemizedHelp: "Modo por partida: cant. × precio (c/u) se suma al total. El costo interno solo es para margen.",
    materialDesc: "Descripción",
    materialNote: "Nota de línea (opcional)",
    materialNotePlaceholder: "Se imprime debajo de esta partida en el PDF",
    materialQty: "Cant.",
    materialCostInternal: "Costo (interno)",
    materialCharge: "Precio (c/u)",
    materialsItemizedTotal: "Total de materiales por partida",
  },
};

// Customer-use handoff key (written by CustomersScreen when a customer is selected)
const PENDING_CUSTOMER_USE_KEY = STORAGE_KEYS.PENDING_CUSTOMER_USE;
const PENDING_CUSTOMER_CREATE_KEY = STORAGE_KEYS.PENDING_CUSTOMER_CREATE;
const CUSTOMER_EDIT_TARGET_KEY = STORAGE_KEYS.CUSTOMER_EDIT_TARGET;
const CUSTOMERS_KEY = STORAGE_KEYS.CUSTOMERS;
const CUSTOMER_RECENTS_KEY = STORAGE_KEYS.CUSTOMER_RECENTS;
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const ACTIVE_EDIT_CONTEXT_KEY = "estipaid-active-edit-context-v1";
const PROFILE_RETURN_TARGET_KEY = "estipaid-profile-return-target-v1";
const CREATE_NEW_CUSTOMER_VALUE = "__CREATE_NEW__";
const SAVE_PROMPT_TIMEOUT_MS = 2200;
function readSavedCustomers() {
  try { return JSON.parse(localStorage.getItem(CUSTOMERS_KEY) || "[]") || []; } catch { return []; }
}
function customerDisplayName(c) {
  if (!c) return "";
  return String(c.type === "commercial" ? (c.companyName || c.name || "") : (c.fullName || c.name || "")).trim();
}
function readCustomerRecents() {
  try { return JSON.parse(localStorage.getItem(CUSTOMER_RECENTS_KEY) || "[]") || []; } catch { return []; }
}
function addToCustomerRecents(id) {
  try {
    const prev = readCustomerRecents();
    const next = [id, ...prev.filter((r) => r !== id)].slice(0, 8);
    localStorage.setItem(CUSTOMER_RECENTS_KEY, JSON.stringify(next));
  } catch {}
}
function flattenCustomerForEstimator(c) {
  if (!c) return {};
  const joinAddr = (a) => {
    const street = String(a?.street || "").trim();
    const line2 = [String(a?.city || "").trim(), String(a?.state || "").trim()].filter(Boolean).join(", ");
    const line2Full = [line2, String(a?.zip || "").trim()].filter(Boolean).join(" ");
    return [street, line2Full].filter(Boolean).join("\n");
  };
  if (String(c.type || "") === "commercial") {
    const job = c.jobsite || {};
    const bill = c.billSameAsJob ? (c.jobsite || {}) : (c.billing || {});
    return { name: String(c.companyName || "").trim(), phone: String(c.comPhone || "").trim(), email: String(c.comEmail || "").trim(), attn: String(c.contactName || "").trim(), address: joinAddr(job), billingAddress: joinAddr(bill) };
  }
  const svc = c.resService || {};
  const bill = c.resBillingSame ? (c.resService || {}) : (c.resBilling || {});
  return { name: String(c.fullName || "").trim(), phone: String(c.resPhone || "").trim(), email: String(c.resEmail || "").trim(), attn: "", address: joinAddr(svc), billingAddress: joinAddr(bill) };
}

function buildSelectedCustomerProfileFromDraft(customerState, customerId = "", customerList = []) {
  const sid = String(customerId || customerState?.id || "").trim();
  if (!sid) return null;

  const matchedCustomer = Array.isArray(customerList)
    ? customerList.find((item) => String(item?.id || "").trim() === sid)
    : null;

  if (matchedCustomer) {
    return {
      ...matchedCustomer,
      ...flattenCustomerForEstimator(matchedCustomer),
      id: sid,
    };
  }

  const name = String(customerState?.name || "").trim();
  return {
    id: sid,
    name,
    fullName: name,
    attn: String(customerState?.attn || "").trim(),
    phone: String(customerState?.phone || "").trim(),
    email: String(customerState?.email || "").trim(),
    netTermsType: String(customerState?.netTermsType || "").trim(),
    netTermsDays: customerState?.netTermsDays === null || customerState?.netTermsDays === undefined
      ? ""
      : String(customerState?.netTermsDays),
    address: String(customerState?.address || "").trim(),
    billingAddress: String(customerState?.billingAddress || "").trim(),
  };
}

function formatAddressObject(a) {
  const street = String(a?.street || "").trim();
  const city = String(a?.city || "").trim();
  const state = String(a?.state || "").trim();
  const zip = String(a?.zip || "").trim();
  const line2 = [city, state].filter(Boolean).join(", ");
  const line2Full = [line2, zip].filter(Boolean).join(" ");
  return [street, line2Full].filter(Boolean).join(", ");
}

function normalizeAddressText(s) {
  return String(s || "").replace(/\s*\n+\s*/g, ", ").replace(/\s{2,}/g, " ").trim();
}

function triggerHaptic() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(10);
    }
  } catch {}
}

function readSavedDocList(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function toDocTimestamp(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMostRecentSavedTimestamp(doc) {
  const savedAt = toDocTimestamp(doc?.savedAt ?? doc?.meta?.savedAt ?? doc?.meta?.lastSavedAt);
  if (savedAt > 0) return savedAt;
  const updatedAt = toDocTimestamp(doc?.updatedAt);
  if (updatedAt > 0) return updatedAt;
  const dateVal = toDocTimestamp(doc?.date);
  if (dateVal > 0) return dateVal;
  return 0;
}

function formatSavedTimestamp(ts) {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${mm}/${dd}/${yyyy} ${hh}:${min}`;
  } catch {
    return "";
  }
}

function createSavedDocId() {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function writeProfileReturnTarget(value) {
  try {
    const route = String(value?.route || "").trim();
    if (!route) {
      localStorage.removeItem(PROFILE_RETURN_TARGET_KEY);
      return null;
    }
    const next = { route };
    if (route === ROUTES.CREATE) {
      next.intent = value?.intent === BUILDER_INTENTS.INVOICE ? BUILDER_INTENTS.INVOICE : BUILDER_INTENTS.ESTIMATE;
      const editType = value?.editContext?.type === "invoice" ? "invoice" : (value?.editContext?.type === "estimate" ? "estimate" : "");
      const editId = String(value?.editContext?.id || "").trim();
      if (editType && editId) {
        next.editContext = { type: editType, id: editId };
      }
    }
    localStorage.setItem(PROFILE_RETURN_TARGET_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

function readPendingEditTarget() {
  try {
    const invoiceId = String(localStorage.getItem(EDIT_INVOICE_TARGET_KEY) || "").trim();
    if (invoiceId) {
      localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
      localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
      return { type: "invoice", id: invoiceId };
    }
    const estimateId = String(localStorage.getItem(EDIT_ESTIMATE_TARGET_KEY) || "").trim();
    if (estimateId) {
      localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
      return { type: "estimate", id: estimateId };
    }
    return null;
  } catch {
    return null;
  }
}

function clearPendingEditTarget(type) {
  try {
    if (!type || type === "estimate") localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
    if (!type || type === "invoice") localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
  } catch {}
}

function upsertSavedDoc(list, nextRecord, fallbackNumberKey = "") {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  const record = nextRecord && typeof nextRecord === "object" ? nextRecord : {};
  const recordId = String(record?.id || "").trim();
  const fallbackValue = fallbackNumberKey ? String(record?.[fallbackNumberKey] || "").trim() : "";

  const matchIndex = arr.findIndex((item) => {
    const sameId = recordId && String(item?.id || "").trim() === recordId;
    if (sameId) return true;
    if (!fallbackNumberKey || !fallbackValue) return false;
    return String(item?.[fallbackNumberKey] || "").trim() === fallbackValue;
  });

  if (matchIndex < 0) return [record, ...arr];
  const existing = arr[matchIndex] && typeof arr[matchIndex] === "object" ? arr[matchIndex] : {};
  const merged = { ...existing, ...record };
  const next = arr.filter((_, idx) => idx !== matchIndex);
  return [merged, ...next];
}

// Labor role presets (value = key, display = label)
const LABOR_PRESETS = [
  { key: "foreman", label: "Foreman" },
  { key: "journeyman", label: "Journeyman" },
  { key: "apprentice", label: "Apprentice" },
  { key: "laborer", label: "General Laborer" },
  { key: "supervisor", label: "Supervisor" },
  { key: "helper", label: "Helper" },
  { key: "technician", label: "Technician" },
  { key: "operator", label: "Equipment Operator" },
];

// Scope / Notes master templates (append-on-select)
const SCOPE_MASTER_TEMPLATES = [
  { key: "furnish_install", label: "Furnish & Install", text: "Furnish all materials, labor, and equipment required to complete the scope of work per specifications." },
  { key: "demo_dispose",    label: "Demo & Dispose",    text: "Demolish and dispose of existing materials. Remove all debris from site in a safe and timely manner." },
  { key: "inspect_repair",  label: "Inspect & Repair",  text: "Inspect existing conditions and perform repairs as needed per site assessment. Document all findings." },
  { key: "supply_install",  label: "Supply & Install",  text: "Supply and install per approved submittal. Coordinate with general contractor for scheduling and inspections." },
  { key: "rough_finish",    label: "Rough & Finish",    text: "Complete rough-in phase followed by finish work per drawings and specifications." },
];
// TEMPLATE ADD-ONS (TRADE INSERTS)
const SCOPE_TRADE_INSERTS = [
  {
    key: "genericLabor",
    label: "Generic Labor (Insert)",
    text: `Trade Insert: Generic Labor
- Provide general labor to support the described scope (handling, staging, cleanup, assistance).
- Perform basic tasks as directed under supervision (non-licensed/non-specialty unless specified).
- Productivity dependent on site access, congestion, and coordination.`,
  },
  {
    key: "painting",
    label: "Painting (Insert)",
    text: `Trade Insert: Painting
- Surface prep as required (masking, patch/spot prep, sanding as needed).
- Apply primer/finish coats per specified system.
- Cut-in/roll/spray methods as appropriate for area and conditions.
- Touch-up and cleanup upon completion.`,
  },
  {
    key: "demoCrew",
    label: "Demolition Crew (Insert)",
    text: `Trade Insert: Demolition Crew
- Provide labor for selective demolition/removal of specified items/areas.
- Protect adjacent finishes and active areas as reasonable.
- Debris staged in designated area; haul-off/dump fees by others unless included.
- Unknown/hidden conditions (behind walls/ceilings/slabs) excluded unless authorized.`,
  },
  {
    key: "drywall",
    label: "Drywall (Insert)",
    text: `Trade Insert: Drywall
- Install drywall per scope (hang, fasten, and finish as specified).
- Tape/finish level per project requirements.
- Cutouts for penetrations as required.
- Final texture/paint by others unless included.`,
  },
  {
    key: "framing",
    label: "Framing (Insert)",
    text: `Trade Insert: Framing
- Layout and install framing per scope (metal/wood as specified).
- Anchor/fasten to existing structure as required.
- Field verification of dimensions and conditions prior to build.
- Engineering/structural design by others unless included.`,
  },
  {
    key: "insulation",
    label: "Insulation (Insert)",
    text: `Trade Insert: Insulation
- Furnish/install insulation per scope (batt/blown/spray as specified).
- Seal/fit around penetrations as required for typical installation.
- Vapor barrier/air sealing by others unless included.
- Specialty testing excluded unless included.`,
  },
  {
    key: "finishCarpentry",
    label: "Finish Carpentry (Insert)",
    text: `Trade Insert: Finish Carpentry
- Install finish carpentry items per scope (trim, base, casing, doors/hardware if specified).
- Scribe and fit to existing conditions as needed.
- Caulk/fill as required for finish readiness.
- Final paint/stain by others unless included.`,
  },
  {
    key: "flooring",
    label: "Flooring (Insert)",
    text: `Trade Insert: Flooring
- Install flooring per scope (LVP/tile/carpet/epoxy as specified).
- Subfloor assumed suitable; leveling/moisture mitigation excluded unless included.
- Transitions and edge details installed as specified.`,
  },
  {
    key: "hvac",
    label: "HVAC (Insert)",
    text: `Trade Insert: HVAC
- Install/modify HVAC components per scope (duct, units, diffusers, thermostats as specified).
- Start-up/commissioning/TAB by others unless included.
- Permits/engineering excluded unless included.`,
  },
  {
    key: "plumbing",
    label: "Plumbing (Insert)",
    text: `Trade Insert: Plumbing
- Install/modify plumbing per scope (water, waste/vent, fixtures as specified).
- Tie-ins coordinated with site contact; shutdown windows coordinated with site contact.
- Permits/engineering excluded unless included.`,
  },
  {
    key: "controls",
    label: "Controls / BAS / Instrumentation (Insert)",
    text: `Trade Insert: Controls / BAS / Instrumentation
- Install/terminate controls wiring and devices per scope (sensors, actuators, controllers as specified).
- Point-to-point checkout and basic functional verification as specified.
- Programming/graphics/commissioning by others unless included.`,
  },
  {
    key: "welding",
    label: "Welding (General Insert)",
    text: `Trade Insert: Welding
- Fit-up and weld per project requirements (process as required).
- Grind/clean as needed for fit and finish.
- Welds performed by qualified personnel; consumables as typical.
- Field conditions may affect production rate.

Optional Add-Ons (if needed):
- Welding procedure/QC documentation
- Specialty consumables or exotic alloys`,
  },
  {
    key: "pipefitting",
    label: "Pipefitting (General Insert)",
    text: `Trade Insert: Pipefitting
- Field measure, fit, and install piping/spools as required.
- Support/hanger coordination as required.
- Tie-ins/shutdown windows coordinated with site contact.
- Final alignment and leak checks per project requirements (testing if specified).`,
  },
  {
    key: "orbital",
    label: "Orbital Welding (Insert)",
    text: `Trade Insert: Orbital Welding
- Provide setup and operation for orbital welding as required.
- Prep, purge, and fit-up to achieve acceptable weld conditions.
- Weld parameters and acceptance per project requirements.
- Production rate dependent on access, prep quality, and purge conditions.`,
  },
  {
    key: "ironwork",
    label: "Ironwork / Structural (Insert)",
    text: `Trade Insert: Ironwork / Structural
- Layout, fit, and install steel/structural members as required.
- Bolt-up and/or weld connections per project requirements.
- Field modifications as needed within reason.
- Final plumb/level verification as required.`,
  },
  {
    key: "electrical",
    label: "Electrician (Insert)",
    text: `Trade Insert: Electrical
- Install/terminate electrical components as required (circuits, devices, panels, controls as specified).
- Verify power, labeling, and basic functionality per project requirements.
- Work coordinated around lockout/tagout and site safety requirements.
- Materials/fixtures by owner/GC unless included.`,
  },
  {
    key: "rigging",
    label: "Rigging / Crane (Insert)",
    text: `Trade Insert: Rigging / Crane
- Provide rigging labor to support lifts/moves as required.
- Lift planning and execution coordinated with site contact.
- Standard rigging gear as typical (specialty gear if specified).
- Work dependent on access, pick points, and site constraints.`,
  },
  {
    key: "heavyEquipment",
    label: "Heavy Machinery / Equipment Ops (Insert)",
    text: `Trade Insert: Heavy Machinery / Equipment Ops
- Provide operator(s) for equipment as required (lift/grade/haul/support).
- Production dependent on site access, weather, and staging/logistics.
- Fuel/transport/permits excluded unless included.`,
  },
  {
    key: "concrete",
    label: "Concrete (Insert)",
    text: `Trade Insert: Concrete
- Form, place, finish, and cure concrete work as specified.
- Subgrade and reinforcement by others unless included.
- Finish level and cure method per project requirements.
- Production dependent on access, weather, and site readiness.`,
  },
  {
    key: "demo",
    label: "Demolition (Insert)",
    text: `Trade Insert: Demolition
- Selective demo/removal of specified items/areas.
- Protect adjacent areas as reasonable.
- Debris staging and haul-off as specified (or excluded).
- Unknown/hidden conditions behind walls/ceilings excluded.`,
  },
];

function extractTradeInsertBlocksForPdf(scopeText, explicitTradeText) {
  const fromScope = String(scopeText || "");
  const unique = new Set();
  const out = [];
  const push = (text) => {
    const val = String(text || "").trim();
    if (!val || unique.has(val)) return;
    unique.add(val);
    out.push(val);
  };

  // Known curated trade inserts
  for (const item of SCOPE_TRADE_INSERTS) {
    const txt = String(item?.text || "").trim();
    if (txt && fromScope.includes(txt)) push(txt);
  }

  // Manual "Trade Insert:" blocks
  const tradeBlockPattern = /(Trade Insert:[\s\S]*?)(?=\n{2,}Trade Insert:|\s*$)/gi;
  const manualBlocks = fromScope.match(tradeBlockPattern) || [];
  manualBlocks.forEach((block) => push(block));

  // Explicit tracked insert
  push(explicitTradeText);
  return out;
}

function stripTradeInsertBlocksFromScope(scopeText, tradeBlocks) {
  let next = String(scopeText || "");
  for (const block of tradeBlocks || []) {
    const txt = String(block || "").trim();
    if (!txt) continue;
    next = next.replace(txt, "\n\n");
  }
  return next.replace(/\n{3,}/g, "\n\n").trim();
}

// Additional notes quick-insert snippets
const ADDITIONAL_NOTES_SNIPPETS = [
  {
    key: "schedule",
    label: "+ Schedule",
    text: `Schedule:
- Work to be performed during normal business hours unless otherwise agreed.
- Start date subject to material lead times, permit approvals, and site availability.
- Schedule subject to change due to weather, site access, or owner-directed changes.`,
  },
  {
    key: "exclusions",
    label: "+ Exclusions",
    text: `Exclusions:
- All work not explicitly listed in this estimate is excluded.
- Permit fees, engineering, and inspection fees excluded unless noted.
- Unforeseen or concealed conditions not included in this scope.
- Hazardous material abatement excluded unless specified.`,
  },
  {
    key: "payment",
    label: "+ Payment",
    text: `Payment Terms:
- 50% deposit required prior to commencement of work.
- Balance due upon substantial completion.
- Invoices past due 30 days subject to 1.5% monthly finance charge.
- Work may be suspended for non-payment without penalty to contractor.`,
  },
  {
    key: "changeOrders",
    label: "+ Change Orders",
    text: `Change Orders:
- Any work outside the original scope requires a written change order prior to proceeding.
- Changes may affect project schedule and total contract value.
- Verbal authorizations will be documented and confirmed in writing.`,
  },
  {
    key: "safety",
    label: "+ Safety",
    text: `Safety:
- All work to be performed in compliance with applicable OSHA standards.
- Contractor will maintain a safe and orderly work area at all times.
- Owner/GC to ensure site access is free of hazards not identified in scope.`,
  },
  {
    key: "access",
    label: "+ Access",
    text: `Site Access:
- Owner/GC to provide unobstructed access to work areas during scheduled hours.
- Parking and staging area to be provided at no charge to contractor.
- Delays caused by restricted or denied access will be addressed via change order.`,
  },
];

const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"];

function IconCustomer() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <rect x="4.2" y="4.8" width="15.6" height="14.4" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="9" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M6.8 14.3c.7-1.3 1.5-2 2.2-2s1.5.7 2.2 2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M13.6 9.2h4.2M13.6 12.2h3.4M13.6 15.2h2.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function IconJobInfo() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <rect x="6" y="5" width="12" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M9 5.2h6v2H9z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M9 11h6M9 14h6M9 17h4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function IconLabor() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <path d="M5.2 7.5 9 11.2M6.6 6.1l3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="m10.3 9.9 3.8-3.8a2.3 2.3 0 1 1 3.3 3.3l-3.8 3.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m7.7 12.5 3.8 3.8a2.3 2.3 0 0 1-3.3 3.3l-3.8-3.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSpecialConditions() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="9" cy="7" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="15" cy="12" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="11" cy="17" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

function IconTotals() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <rect x="5" y="4.5" width="14" height="15" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8.5 8.4h7M8.5 11.6h7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M9.2 15.6h2.4M12.5 15.6h2.4M9.2 18.1h5.7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path d="M4.8 7.2h14.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M9.2 7.2V5.8h5.6v1.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M7.3 7.2v10.2a1.8 1.8 0 0 0 1.8 1.8h5.8a1.8 1.8 0 0 0 1.8-1.8V7.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.2 10.3v6.1M13.8 10.3v6.1" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function SectionTitleWithIcon({ icon, title, styles, stackStyle }) {
  return (
    <div style={styles.sectionTitleWithIcon}>
      <span style={styles.sectionTitleIcon} aria-hidden="true">{icon}</span>
      <div style={{ ...styles.sectionTitleStack, ...(stackStyle || {}) }}>
        <div className="pe-section-title" style={styles.sectionTitleText}>{title}</div>
        <div style={styles.sectionAccentLine} />
      </div>
    </div>
  );
}

const MAX_SEARCH_RESULTS = 10;
const DROPDOWN_BLUR_DELAY = 150;
const SHELL_DOCK_HEIGHT = 78;
const ACTION_BAR_MIN_HEIGHT = 72;
const ACTION_BAR_GAP = 16;
const SCOPE_NOTES_MIN_HEIGHT = 170;
const COLLAPSE_MS = 200;
const ROW_ENTER_MS = 220;
const TOTAL_PULSE_MS = 140;

function toDirtySnapshot(s) {
  if (!s || typeof s !== "object") return "";
  const meta = {
    ...(s.meta || {}),
    lastSavedAt: 0,
  };
  return JSON.stringify({ ...s, meta });
}

function resolveDefaultMarkupPct(value) {
  const normalized = normalizePercentInput(value);
  return normalized === "" ? "0" : normalized;
}

function normalizeLaborQtyValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.round(parsed));
}

function createBlankMaterialItem(idOverride, markupPct) {
  return {
    id: idOverride || `mat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    desc: "",
    note: "",
    qty: 1,
    cost: "",
    unitCostInternal: "",
    costInternal: "",
    charge: "",
    priceEach: "",
    markupPct: resolveDefaultMarkupPct(markupPct),
  };
}

export default function EstimateForm(props) {
  const { embeddedInShell = false } = props || {};
  const [editTarget, setEditTarget] = useState(() => readPendingEditTarget());
  const editingRecordId = String(editTarget?.id || "").trim();
  const editingTargetType = editTarget?.type === "invoice" ? "invoice" : (editTarget?.type === "estimate" ? "estimate" : "");
  const isEditMode = Boolean(editingRecordId);
  const isInvoiceEditMode = isEditMode && editingTargetType === "invoice";
  const isEditModeRef = useRef(isEditMode);
  const openedEditIdRef = useRef(editingRecordId);
  const openedDocNumberRef = useRef("");
  const lang = useMemo(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      return saved === "es" ? "es" : "en";
    } catch {
      return "en";
    }
  }, []);
  const t = useMemo(
    () => (key) => I18N[lang]?.[key] || I18N.en?.[key] || key,
    [lang]
  );
  const customerTopRef = useRef(null);
  const customerNameRef = useRef(null);
  const scopeNotesRef = useRef(null);
  const additionalNotesRef = useRef(null);
  const actionBarRef = useRef(null);
  const didNormalizeLaborRef = useRef(false);
  const rowEnterTimerRef = useRef([]);
  const totalPulseTimerRef = useRef({ labor: null, materials: null, estimate: null });
  const previousTotalsRef = useRef(null);

  const hook = typeof useEstimatorStateNamed === "function" ? useEstimatorStateNamed : useEstimatorState;

  const {
    state,
    patch,
    dupLaborLine,
    removeLaborLine,
    updateLaborLine,
    clearAll,
    saveNow,
    replaceState,
  } = hook({ persistDraft: !isEditMode });
  const scopeNotes = String(state?.scopeNotes || "");
  const additionalNotes = String(state?.additionalNotes || "");
  const [settingsSnapshot, setSettingsSnapshot] = useState(() => loadSettings());
  const pricingSettings = settingsSnapshot?.pricing || DEFAULT_SETTINGS.pricing;
  const globalDefaultMarkupPct = resolveDefaultMarkupPct(pricingSettings?.defaultMarkupPct);
  const globalDefaultMarkupPctNumber = Number(globalDefaultMarkupPct) || 0;
  const lockMarkupToGlobal = !!pricingSettings?.lockMarkupToGlobal;
  const internalSettings = settingsSnapshot?.internal || DEFAULT_SETTINGS.internal;
  const showInternalCostFields = internalSettings?.showInternalCostFields !== false;
  const lockInternalCostFields = !!internalSettings?.lockInternalCostFields;

  useEffect(() => {
    isEditModeRef.current = isEditMode;
  }, [isEditMode]);

  useEffect(() => {
    if (!isEditMode) {
      openedEditIdRef.current = "";
      openedDocNumberRef.current = "";
      return;
    }
    if (!openedEditIdRef.current) {
      openedEditIdRef.current = editingRecordId;
    }
  }, [editingRecordId, isEditMode]);

  useEffect(() => {
    try {
      if (!isEditMode || !editingRecordId || !editingTargetType) {
        localStorage.removeItem(ACTIVE_EDIT_CONTEXT_KEY);
        return undefined;
      }

      localStorage.setItem(
        ACTIVE_EDIT_CONTEXT_KEY,
        JSON.stringify({ type: editingTargetType, id: editingRecordId })
      );
    } catch {}

    return () => {
      try {
        const raw = localStorage.getItem(ACTIVE_EDIT_CONTEXT_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (
          String(parsed?.id || "").trim() === editingRecordId
          && String(parsed?.type || "").trim() === editingTargetType
        ) {
          localStorage.removeItem(ACTIVE_EDIT_CONTEXT_KEY);
        }
      } catch {}
    };
  }, [editingRecordId, editingTargetType, isEditMode]);

  useEffect(() => {
    return () => {
      if (!isEditModeRef.current) return;
      clearPendingEditTarget();
    };
  }, []);

  useEffect(() => {
    const refresh = (e) => {
      if (e?.key && e.key !== STORAGE_KEYS.SETTINGS) return;
      setSettingsSnapshot(loadSettings());
    };
    window.addEventListener("estipaid:settings-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("estipaid:settings-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const [searchCustomerText, setSearchCustomerText] = useState(() => String(state?.customer?.name || "").trim());
  const [selectedCustomerId, setSelectedCustomerId] = useState(() => String(state?.customer?.id || "").trim());
  const [selectedCustomerProfile, setSelectedCustomerProfile] = useState(() => (
    buildSelectedCustomerProfileFromDraft(
      state?.customer,
      state?.customer?.id,
      readSavedCustomers()
    )
  ));
  const [dropdownHoverKey, setDropdownHoverKey] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState({ top: 0, left: 0, width: 0 });
  const [actionBarHeight, setActionBarHeight] = useState(ACTION_BAR_MIN_HEIGHT);
  const [allCustomers, setAllCustomers] = useState(() => readSavedCustomers());
  const [newLaborLineIds, setNewLaborLineIds] = useState({});
  const [newMaterialItemIds, setNewMaterialItemIds] = useState({});
  const [animateLaborBaseTotal, setAnimateLaborBaseTotal] = useState(false);
  const [animateMaterialsTotal, setAnimateMaterialsTotal] = useState(false);
  const [animateEstimateTotal, setAnimateEstimateTotal] = useState(false);
  const [laborOpen, setLaborOpen] = useState(true);
  const [materialsOpen, setMaterialsOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [pdfPromptOpen, setPdfPromptOpen] = useState(false);
  const [savePrompt, setSavePrompt] = useState(null);
  const [saveNeedsAttention, setSaveNeedsAttention] = useState(false);
  const [savePulse, setSavePulse] = useState(false);
  const saveBaselineRef = useRef("");
  const hasSaveBaselineRef = useRef(false);
  const lastSavedAtSeenRef = useRef(0);
  const wasDirtyRef = useRef(false);
  const savePulseTimerRef = useRef(null);
  const [multiplierMode, setMultiplierMode] = useState(() => {
    const m = Number(state?.labor?.multiplier);
    if (m === 1 || m === 1.1 || m === 1.2 || m === 1.25) return "preset";
    return "custom";
  });

  // Always load Estimator at absolute top
  useEffect(() => {
    try {
      const scrollHost = customerTopRef.current?.closest?.(".pe-content");
      if (scrollHost?.scrollTo) {
        scrollHost.scrollTo({ top: 0, behavior: "auto" });
      } else if (scrollHost) {
        scrollHost.scrollTop = 0;
      }
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "auto" });
    } catch {}
  }, []);

  useEffect(() => {
    if (!savePrompt) return undefined;
    const timer = setTimeout(() => setSavePrompt(null), SAVE_PROMPT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [savePrompt]);

  useEffect(() => {
    const snapshot = toDirtySnapshot(state);
    if (!hasSaveBaselineRef.current) {
      saveBaselineRef.current = snapshot;
      hasSaveBaselineRef.current = true;
      lastSavedAtSeenRef.current = Number(state?.meta?.lastSavedAt || 0);
      setSaveNeedsAttention(false);
      return;
    }

    const currentSavedAt = Number(state?.meta?.lastSavedAt || 0);
    if (currentSavedAt > 0 && currentSavedAt !== lastSavedAtSeenRef.current) {
      saveBaselineRef.current = snapshot;
      lastSavedAtSeenRef.current = currentSavedAt;
      setSaveNeedsAttention(false);
      wasDirtyRef.current = false;
      return;
    }

    const dirty = snapshot !== saveBaselineRef.current;
    setSaveNeedsAttention(dirty);

    if (dirty && !wasDirtyRef.current) {
      setSavePulse(true);
      if (savePulseTimerRef.current) clearTimeout(savePulseTimerRef.current);
      savePulseTimerRef.current = setTimeout(() => {
        setSavePulse(false);
        savePulseTimerRef.current = null;
      }, 240);
    }

    if (!dirty) {
      setSavePulse(false);
      if (savePulseTimerRef.current) {
        clearTimeout(savePulseTimerRef.current);
        savePulseTimerRef.current = null;
      }
    }

    wasDirtyRef.current = dirty;
  }, [state]);

  useEffect(() => () => {
    if (savePulseTimerRef.current) {
      clearTimeout(savePulseTimerRef.current);
      savePulseTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isEditMode || !editingRecordId) return;
    const sourceKey = isInvoiceEditMode ? INVOICES_KEY : ESTIMATES_KEY;
    const list = readSavedDocList(sourceKey);
    const match = list.find((x) => String(x?.id || "").trim() === String(editingRecordId || "").trim());
    if (!match || typeof replaceState !== "function") {
      setSavePrompt({
        tone: "error",
        message: `${isInvoiceEditMode ? "Invoice" : "Estimate"} not found. Switched to new mode.`,
      });
      openedEditIdRef.current = "";
      openedDocNumberRef.current = "";
      setEditTarget(null);
      return;
    }
    openedEditIdRef.current = String(editingRecordId || match?.id || "").trim();
    openedDocNumberRef.current = String(
      match?.estimateNumber
      || match?.invoiceNumber
      || match?.job?.docNumber
      || match?.customer?.projectNumber
      || ""
    ).trim();
    const createdAt = Number(match?.createdAt || Date.now()) || Date.now();
    const hydrated = {
      ...match,
      ui: {
        ...(match?.ui || {}),
        docType: isInvoiceEditMode ? "invoice" : "estimate",
      },
      meta: {
        ...(match?.meta || {}),
        savedDocId: String(match?.id || editingRecordId),
        savedDocCreatedAt: createdAt,
      },
    };
    replaceState(hydrated, { persistNow: false, persistDraft: false });

    const loadedCustomerId = String(match?.customerId || match?.customer?.id || "").trim();
    setSelectedCustomerId(loadedCustomerId);
    setSelectedCustomerProfile(match?.customer && typeof match.customer === "object" ? match.customer : null);

    const loadedMultiplier = Number(match?.labor?.multiplier);
    if (loadedMultiplier === 1 || loadedMultiplier === 1.1 || loadedMultiplier === 1.2 || loadedMultiplier === 1.25) {
      setMultiplierMode("preset");
    } else {
      setMultiplierMode("custom");
    }

    const displayName = String(
      match?.customerName
      || match?.customer?.displayName
      || match?.customer?.name
      || match?.customer?.company
      || ""
    ).trim();
    if (displayName) setSearchCustomerText(displayName);
  }, [editingRecordId, isEditMode, isInvoiceEditMode, replaceState]);

  useEffect(() => {
    if (isEditMode) return;
    const draftCustomerId = String(state?.customer?.id || "").trim();

    if (!draftCustomerId) {
      if (selectedCustomerId) setSelectedCustomerId("");
      if (selectedCustomerProfile) setSelectedCustomerProfile(null);
      return;
    }

    if (String(selectedCustomerId || "") === draftCustomerId && selectedCustomerProfile) {
      return;
    }

    const nextProfile = buildSelectedCustomerProfileFromDraft(state?.customer, draftCustomerId, allCustomers);
    if (!nextProfile) return;

    setSelectedCustomerId(draftCustomerId);
    setSelectedCustomerProfile(nextProfile);

    if (!String(searchCustomerText || "").trim()) {
      const displayName = customerDisplayName(nextProfile) || String(nextProfile?.name || "").trim();
      if (displayName) setSearchCustomerText(displayName);
    }
  }, [
    allCustomers,
    isEditMode,
    searchCustomerText,
    selectedCustomerId,
    selectedCustomerProfile,
    state?.customer,
  ]);

  useEffect(() => {
    return () => {
      const rowTimers = Array.isArray(rowEnterTimerRef.current) ? rowEnterTimerRef.current : [];
      rowTimers.forEach((t) => t && clearTimeout(t));
      rowEnterTimerRef.current = [];
      const pulseTimers = totalPulseTimerRef.current || {};
      Object.keys(pulseTimers).forEach((k) => {
        if (pulseTimers[k]) clearTimeout(pulseTimers[k]);
      });
      totalPulseTimerRef.current = { labor: null, materials: null, estimate: null };
    };
  }, []);

  // Customer-use hydration: populate fields when a customer is selected from CustomersScreen
  useEffect(() => {
    const apply = () => {
      try {
        const raw = localStorage.getItem(PENDING_CUSTOMER_USE_KEY);
        if (!raw) return;
        const payload = JSON.parse(raw);
        localStorage.removeItem(PENDING_CUSTOMER_USE_KEY);
        const c = payload?.customer;
        if (!c || typeof c !== "object") return;
        const sid = String(payload?.id || c?.id || "");
        if (sid) setSelectedCustomerId(sid);
        setSelectedCustomerProfile(c);
        const display = customerDisplayName(c) || String(c.name || "").trim();
        if (display) setSearchCustomerText(display);
        patch("customer.id", sid);
        if (String(c.name || "").trim()) patch("customer.name", String(c.name || "").trim());
        if (String(c.attn || "").trim()) patch("customer.attn", String(c.attn || "").trim());
        if (String(c.phone || "").trim()) patch("customer.phone", String(c.phone || "").trim());
        if (String(c.email || "").trim()) patch("customer.email", String(c.email || "").trim());
        patch("customer.netTermsType", String(c.netTermsType || "").trim());
        patch("customer.netTermsDays", c.netTermsDays === null || c.netTermsDays === undefined ? "" : String(c.netTermsDays));
        if (String(c.address || "").trim()) patch("customer.address", String(c.address || "").trim());
        const billingAddr = String(c.billingAddress || "").trim();
        if (billingAddr) {
          patch("customer.billingAddress", billingAddr);
          if (billingAddr !== String(c.address || "").trim()) {
            patch("customer.billingDiff", true);
          }
        }
      } catch {}
    };
    apply();
    window.addEventListener("estipaid:customer-use", apply);
    return () => window.removeEventListener("estipaid:customer-use", apply);
  // patch is stable (setState-based), safe to omit from deps per React docs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync customer list when storage changes (other tabs)
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === CUSTOMERS_KEY) setAllCustomers(readSavedCustomers());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Allow shell-level navigation to force a draft save before tab switches.
  useEffect(() => {
    const onDraftSaveNow = () => {
      try { saveNow?.(); } catch {}
    };
    window.addEventListener("estipaid:draft-save-now", onDraftSaveNow);
    return () => window.removeEventListener("estipaid:draft-save-now", onDraftSaveNow);
  }, [saveNow]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const updateDropdownPosition = () => {
      const rect = customerNameRef.current?.getBoundingClientRect?.();
      if (!rect) return;
      setDropdownRect({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    updateDropdownPosition();
    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);
    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [dropdownOpen]);

  useEffect(() => {
    if (dropdownOpen) return;
    setDropdownHoverKey("");
  }, [dropdownOpen]);

  useEffect(() => {
    const updateActionBarHeight = () => {
      const h = actionBarRef.current?.getBoundingClientRect?.().height;
      if (!h) return;
      const next = Math.max(ACTION_BAR_MIN_HEIGHT, Math.ceil(h));
      setActionBarHeight((prev) => (prev === next ? prev : next));
    };
    updateActionBarHeight();
    window.addEventListener("resize", updateActionBarHeight);
    return () => window.removeEventListener("resize", updateActionBarHeight);
  }, []);

  function autoResizeScopeNotes(el) {
    if (!el) return;
    el.style.boxSizing = "border-box";
    el.style.resize = "none";
    el.style.height = "0px";
    const raw = Number(el.scrollHeight) || SCOPE_NOTES_MIN_HEIGHT;
    const next = Math.max(SCOPE_NOTES_MIN_HEIGHT, raw);
    el.style.height = `${next}px`;
    el.style.overflowY = "hidden";
  }

  useLayoutEffect(() => {
    if (!notesOpen) return;
    const raf = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(() => autoResizeScopeNotes(scopeNotesRef.current))
      : null;
    if (raf === null) autoResizeScopeNotes(scopeNotesRef.current);
    return () => {
      if (raf !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [notesOpen, scopeNotes]);

  useLayoutEffect(() => {
    const raf = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(() => autoResizeScopeNotes(additionalNotesRef.current))
      : null;
    if (raf === null) autoResizeScopeNotes(additionalNotesRef.current);
    return () => {
      if (raf !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [additionalNotes]);

  function handleClearScopeNotes() {
    if (!scopeNotes.trim()) return;
    const ok = window.confirm("Unsaved notes will be lost. Clear notes?");
    if (!ok) return;
    patch("scopeNotes", "");
  }

  const recentCustomerIds = useMemo(() => readCustomerRecents(), [selectedCustomerId]);
  const recentCustomers = useMemo(
    () => recentCustomerIds.map((id) => allCustomers.find((c) => String(c.id) === id)).filter(Boolean),
    [allCustomers, recentCustomerIds]
  );
  const filteredCustomers = useMemo(() => {
    const q = searchCustomerText.trim().toLowerCase();
    if (!q) return [];
    return allCustomers.filter((c) => {
      const name = customerDisplayName(c).toLowerCase();
      const company = String(c.companyName || "").toLowerCase();
      const email = String(c.comEmail || c.resEmail || c.email || "").toLowerCase();
      const phone = String(c.comPhone || c.resPhone || c.phone || "").toLowerCase();
      return name.includes(q) || company.includes(q) || email.includes(q) || phone.includes(q);
    }).slice(0, MAX_SEARCH_RESULTS);
  }, [allCustomers, searchCustomerText]);
  const dropdownCustomers = searchCustomerText.trim() ? filteredCustomers : recentCustomers;
  const selectedProfile = useMemo(() => {
    if (!selectedCustomerId || !selectedCustomerProfile) return null;
    const c = selectedCustomerProfile;
    const type = String(c?.type || (c?.companyName ? "commercial" : "residential")).toLowerCase() === "commercial" ? "commercial" : "residential";
    const displayName = customerDisplayName(c) || String(c?.name || "").trim();
    const fullName = String(c?.fullName || c?.contactName || c?.name || "").trim();
    const companyName = String(c?.companyName || "").trim();
    const phone = String(c?.comPhone || c?.resPhone || c?.phone || "").trim();
    const email = String(c?.comEmail || c?.resEmail || c?.email || "").trim();
    const billingFromObj = type === "commercial"
      ? formatAddressObject(c?.billSameAsJob ? (c?.jobsite || {}) : (c?.billing || {}))
      : formatAddressObject(c?.resBillingSame ? (c?.resService || {}) : (c?.resBilling || {}));
    const projectFromObj = type === "commercial" ? formatAddressObject(c?.jobsite || {}) : formatAddressObject(c?.resService || {});
    const billingAddress = billingFromObj || normalizeAddressText(c?.billingAddress || "");
    const projectAddress = projectFromObj || normalizeAddressText(c?.address || "");
    const notes = String(c?.notes || c?.note || c?.customerNotes || "").trim();
    const showProjectAddress = !!projectAddress && projectAddress !== billingAddress;
    const netTermsLabel = getNetTermsLabel(c);
    const netTermsDays = getNetTermsDays(c);
    const poRequired = !!c?.poRequired;
    return { displayName, fullName, companyName, phone, email, billingAddress, projectAddress, showProjectAddress, notes, netTermsLabel, netTermsDays, customerType: type, poRequired };
  }, [selectedCustomerId, selectedCustomerProfile]);
  const hasSelectedNetTerms = useMemo(() => getNetTermsDays(selectedCustomerProfile) !== null, [selectedCustomerProfile]);
  const isCommercialJob = selectedProfile?.customerType === "commercial";
  const effectivePoRequired = !!selectedProfile?.poRequired;
  const jobInfoTopGridClassName = isCommercialJob && effectivePoRequired
    ? "pe-jobinfo-top-grid pe-jobinfo-top-grid-com-po"
    : (!isCommercialJob && !effectivePoRequired)
      ? "pe-jobinfo-top-grid pe-jobinfo-top-grid-res-no-po"
      : "pe-jobinfo-top-grid";
  const projectLocationSame = state?.customer?.projectSameAsCustomer !== false;
  const manualProjectStreet = String(state?.customer?.projectAddress || "").trim();
  const manualProjectLine2 = String(state?.job?.location || "").trim();
  const manualProjectCity = String(state?.customer?.city || "").trim();
  const manualProjectState = String(state?.customer?.state || "").trim();
  const manualProjectZip = String(state?.customer?.zip || "").trim();
  const manualProjectAddress = useMemo(() => {
    const cityState = [manualProjectCity, manualProjectState].filter(Boolean).join(", ");
    const cityStateZip = [cityState, manualProjectZip].filter(Boolean).join(" ");
    return [manualProjectStreet, manualProjectLine2, cityStateZip].filter(Boolean).join("\n");
  }, [manualProjectCity, manualProjectLine2, manualProjectState, manualProjectStreet, manualProjectZip]);
  const resolvedProjectAddress = projectLocationSame
    ? String(state?.customer?.address || "").trim()
    : manualProjectAddress;

  useEffect(() => {
    if (!hasSelectedNetTerms) return;
    const nextDue = computeDueDateFromCustomer(state?.job?.date, selectedCustomerProfile, "");
    if (!nextDue) return;
    if (String(state?.job?.due || "") === nextDue) return;
    patch("job.due", nextDue);
  }, [hasSelectedNetTerms, patch, selectedCustomerProfile, state?.job?.date, state?.job?.due]);

  useEffect(() => {
    if (typeof state?.customer?.projectSameAsCustomer === "boolean") return;
    patch("customer.projectSameAsCustomer", true);
  }, [patch, state?.customer?.projectSameAsCustomer]);

  useEffect(() => {
    const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
    if (!lines.length) return;
    let changed = false;
    const normalized = lines.map((ln) => {
      const nextQty = normalizeLaborQtyValue(ln?.qty);
      if (String(ln?.qty ?? "") !== String(nextQty)) {
        changed = true;
        return { ...ln, qty: String(nextQty) };
      }
      return ln;
    });
    if (changed) {
      patch("labor.lines", normalized);
    }
  }, [patch, state?.labor?.lines]);

  // One-time labor normalization:
  // - ensure a single default line when empty
  // - collapse legacy duplicate blank defaults (2 -> 1)
  useEffect(() => {
    if (didNormalizeLaborRef.current) return;
    const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
    const isBlank = (ln) => {
      if (!ln || typeof ln !== "object") return false;
      return !String(ln.role || ln.label || "").trim()
        && !String(ln.hours || "").trim()
        && !String(ln.rate || "").trim()
        && !String(ln.trueRateInternal || ln.internalRate || "").trim();
    };
    if (lines.length === 0) {
      patch("labor.lines", [{
        id: `labor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: "",
        label: "",
        hours: "",
        rate: "",
        trueRateInternal: "",
        internalRate: "",
        qty: 1,
      }]);
      didNormalizeLaborRef.current = true;
      return;
    }
    if (lines.length === 2 && isBlank(lines[0]) && isBlank(lines[1])) {
      patch("labor.lines", [lines[0]]);
    }
    didNormalizeLaborRef.current = true;
  }, [patch, state?.labor?.lines]);

  function handleSelectCustomer(id) {
    if (id === CREATE_NEW_CUSTOMER_VALUE) {
      setSelectedCustomerId("");
      setSearchCustomerText("");
      setSelectedCustomerProfile(null);
      setDropdownOpen(false);
      patch("customer.id", "");
      patch("customer.name", "");
      patch("customer.attn", "");
      patch("customer.phone", "");
      patch("customer.email", "");
      patch("customer.netTermsType", "");
      patch("customer.netTermsDays", "");
      patch("customer.address", "");
      patch("customer.billingAddress", "");
      patch("customer.billingDiff", false);
      try { localStorage.removeItem(PENDING_CUSTOMER_USE_KEY); } catch {}
      try {
        localStorage.setItem(PENDING_CUSTOMER_CREATE_KEY, JSON.stringify({ ts: Date.now(), source: "estimator" }));
      } catch {}
      try { window.dispatchEvent(new Event("estipaid:navigate-customers")); } catch {}
      return;
    }
    if (!id) {
      setSelectedCustomerId("");
      setSearchCustomerText("");
      setSelectedCustomerProfile(null);
      setDropdownOpen(false);
      patch("customer.id", "");
      patch("customer.netTermsType", "");
      patch("customer.netTermsDays", "");
      try { localStorage.removeItem(PENDING_CUSTOMER_USE_KEY); } catch {}
      return;
    }
    const c = allCustomers.find((x) => String(x.id) === id);
    if (!c) return;
    setSelectedCustomerId(id);
    setSearchCustomerText(customerDisplayName(c));
    const flat = flattenCustomerForEstimator(c);
    const payloadCustomer = { ...c, ...flat };
    setSelectedCustomerProfile(payloadCustomer);
    setDropdownOpen(false);
    patch("customer.id", id);
    try {
      const payload = { id, customer: payloadCustomer, ts: Date.now() };
      localStorage.setItem(PENDING_CUSTOMER_USE_KEY, JSON.stringify(payload));
      window.dispatchEvent(new Event("estipaid:customer-use"));
      addToCustomerRecents(id);
    } catch {}
  }

  function handleMultiplierSelect(value) {
    if (value === "custom") {
      setMultiplierMode("custom");
      return;
    }
    setMultiplierMode("preset");
    patch("labor.multiplier", value);
  }

  function decrementLaborQty(id) {
    const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
    const ln = lines.find((x) => String(x?.id) === String(id));
    const current = normalizeLaborQtyValue(ln?.qty);
    const next = Math.max(1, current - 1);
    updateLaborLine(id, { qty: String(next) });
  }

  function handleAddLaborLine(e) {
    e?.preventDefault?.();
    const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines.slice() : [];
    const newId = `labor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    lines.push({
      id: newId,
      role: "",
      label: "",
      hours: "",
      rate: "",
      trueRateInternal: "",
      internalRate: "",
      qty: 1,
      markupPct: globalDefaultMarkupPct,
    });
    patch("labor.lines", lines);
    markRowEnter("labor", newId);
    setLaborOpen(true);
  }

  function handleLaborPrimary(e) {
    e?.preventDefault?.();
    if (!laborOpen) {
      setLaborOpen(true);
      return;
    }
    handleAddLaborLine();
  }

  function applyLaborPresetByLabel(i, label) {
    const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
    const ln = lines[i];
    if (!ln) return;
    const preset = LABOR_PRESETS.find((p) => p.label === label);
    patchLineByIndex(i, {
      label: label || "",
      role: preset?.key || "",
    });
  }

  function patchLineByIndex(i, patchObj) {
    const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
    const ln = lines[i];
    if (!ln) return;
    updateLaborLine(ln.id, patchObj);
  }

  function updateLaborLineAt(i, key, value) {
    if (key === "hours") {
      patchLineByIndex(i, { hours: value });
      return;
    }
    if (key === "rate") {
      patchLineByIndex(i, { rate: value });
      return;
    }
    if (key === "internalRate") {
      patchLineByIndex(i, { trueRateInternal: value, internalRate: value });
      return;
    }
    if (key === "qty") {
      patchLineByIndex(i, { qty: String(normalizeLaborQtyValue(value)) });
      return;
    }
    patchLineByIndex(i, { [key]: value });
  }

  function decrementLaborQtyAt(i) {
    const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
    const ln = lines[i];
    if (!ln) return;
    decrementLaborQty(ln.id);
  }

  function duplicateLaborLine(i) {
    const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
    const ln = lines[i];
    if (!ln) return;
    const current = Number(ln?.qty);
    const next = Number.isFinite(current) && current > 0 ? current + 1 : 2;
    updateLaborLine(ln.id, { qty: String(next) });
  }

  function removeLaborLineAt(i) {
    if (isStaticLaborRow(i)) {
      clearLaborLineAt(i);
      return;
    }
    const lines = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
    const ln = lines[i];
    if (!ln) return;
    removeLaborLine(ln.id);
  }

  function isStaticLaborRow(i) {
    return i === 0;
  }

  function clearLaborLineAt(i) {
    if (!laborLines?.[i]) return;
    patchLineByIndex(i, {
      role: "",
      label: "",
      hours: "",
      rate: "",
      trueRateInternal: "",
      internalRate: "",
      qty: "1",
      markupPct: globalDefaultMarkupPct,
    });
  }

  function handleLaborMinus(i) {
    if (!laborLines?.[i]) {
      return;
    }
    const currentQty = normalizeLaborQtyValue(laborLines?.[i]?.qty);

    if (isStaticLaborRow(i)) {
      if (currentQty <= 1) return;
      patchLineByIndex(i, { qty: String(currentQty - 1) });
      return;
    }

    if (currentQty > 1) {
      patchLineByIndex(i, { qty: String(currentQty - 1) });
      return;
    }
    removeLaborLineAt(i);
  }

  function handleLaborTrash(i) {
    if (!laborLines?.[i]) return;
    if (isStaticLaborRow(i)) {
      clearLaborLineAt(i);
      return;
    }
    removeLaborLineAt(i);
  }

  function markRowEnter(type, id) {
    const sid = String(id || "");
    if (!sid) return;
    if (type === "labor") {
      setNewLaborLineIds((prev) => ({ ...prev, [sid]: true }));
    } else {
      setNewMaterialItemIds((prev) => ({ ...prev, [sid]: true }));
    }
    const timer = setTimeout(() => {
      if (type === "labor") {
        setNewLaborLineIds((prev) => {
          if (!prev?.[sid]) return prev;
          const next = { ...prev };
          delete next[sid];
          return next;
        });
      } else {
        setNewMaterialItemIds((prev) => {
          if (!prev?.[sid]) return prev;
          const next = { ...prev };
          delete next[sid];
          return next;
        });
      }
    }, ROW_ENTER_MS + 40);
    rowEnterTimerRef.current.push(timer);
  }

  function triggerTotalPulse(kind) {
    const timers = totalPulseTimerRef.current || {};
    if (timers[kind]) clearTimeout(timers[kind]);
    const setFlag = kind === "labor"
      ? setAnimateLaborBaseTotal
      : kind === "materials"
        ? setAnimateMaterialsTotal
        : setAnimateEstimateTotal;
    setFlag(false);
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => setFlag(true));
    } else {
      setFlag(true);
    }
    timers[kind] = setTimeout(() => {
      setFlag(false);
      totalPulseTimerRef.current = { ...totalPulseTimerRef.current, [kind]: null };
    }, TOTAL_PULSE_MS + 20);
    totalPulseTimerRef.current = { ...timers };
  }

  function addMaterialItem() {
    const items = Array.isArray(state?.materials?.items) ? state.materials.items.slice() : [];
    const newItem = createBlankMaterialItem(undefined, globalDefaultMarkupPct);
    items.push(newItem);
    patch("materials.items", items);
    markRowEnter("materials", newItem.id);
  }

  function updateMaterialItem(i, key, value) {
    const items = Array.isArray(state?.materials?.items) ? state.materials.items.slice() : [];
    if (i < 0 || i >= items.length) return;
    const curr = { ...(items[i] || {}) };
    if (key === "qty") {
      curr.qty = Math.max(1, Number(value) || 1);
    } else if (key === "note") {
      curr.note = String(value ?? "");
    } else if (key === "cost") {
      curr.cost = value;
      curr.unitCostInternal = value;
      curr.costInternal = value;
    } else if (key === "charge") {
      curr.charge = value;
      curr.priceEach = value;
    } else if (key === "markupPct") {
      if (lockMarkupToGlobal) return;
      curr.markupPct = value;
    } else {
      curr[key] = value;
    }
    items[i] = curr;
    patch("materials.items", items);
  }

  function removeMaterialItem(i) {
    const items = Array.isArray(state?.materials?.items) ? state.materials.items.slice() : [];
    if (i < 0 || i >= items.length) return;
    if (i === 0) {
      items[0] = createBlankMaterialItem(items[0]?.id, globalDefaultMarkupPct);
      patch("materials.items", items);
      return;
    }
    patch("materials.items", items.filter((_, idx) => idx !== i));
  }

  const computed = useMemo(() => computeTotals(state, { settings: settingsSnapshot }), [settingsSnapshot, state]);

  const laborTotalsById = useMemo(() => {
    const map = new Map();
    try {
      const arr = computed?.labor?.normalized || [];
      for (const ln of arr) map.set(String(ln?.id), Number(ln?.total || 0));
    } catch {}
    return map;
  }, [computed]);

  const materialLineTotalsById = useMemo(() => {
    const map = new Map();
    try {
      const arr = computed?.materials?.normalized || [];
      for (const it of arr) map.set(String(it?.id), Number(it?.charge || 0));
    } catch {}
    return map;
  }, [computed]);

  const itemizedInternalCost = useMemo(() => {
    const arr = Array.isArray(state?.materials?.items) ? state.materials.items : [];
    return arr.reduce((sum, it) => sum + ((Number(it?.qty) || 0) * (Number(it?.unitCostInternal ?? it?.costInternal) || 0)), 0);
  }, [state?.materials?.items]);

  const lastSavedLabel = useMemo(() => {
    const ts = Number(state?.meta?.lastSavedAt || 0);
    if (!ts) return "Not saved yet";
    try {
      return `Saved ${new Date(ts).toLocaleString()}`;
    } catch {
      return "Saved";
    }
  }, [state?.meta?.lastSavedAt]);

  const onClearAll = () => {
    if (!window.confirm("Clear everything and start fresh?")) return;
    clearAll();
    setMultiplierMode("preset");
  };

  const onCancelEdit = () => {
    if (!isEditMode) return;
    const ok = window.confirm(`Discard changes to this ${isInvoiceEditMode ? "invoice" : "estimate"}?`);
    if (!ok) return;
    clearPendingEditTarget(editingTargetType);
    openedEditIdRef.current = "";
    openedDocNumberRef.current = "";
    setEditTarget(null);
    try {
      window.dispatchEvent(new Event(isInvoiceEditMode ? "estipaid:navigate-invoices" : "estipaid:navigate-estimates"));
    } catch {}
  };

  const onSaveNow = () => {
    try {
      triggerHaptic();
      const customerName = String(state?.customer?.name || selectedProfile?.displayName || "").trim();
      const missing = [];
      if (!customerName) missing.push("customer");
      if (!String(state?.job?.date || "").trim()) missing.push("date");

      if (missing.length > 0) {
        const missingLabel = missing.map((it) => (it === "customer" ? "Customer" : "Date")).join(", ");
        setSavePrompt({
          tone: "warn",
          message: `Cannot save yet. Missing: ${missingLabel}.`,
        });
        return;
      }

      const now = Date.now();
      const docNumber = String(state?.job?.docNumber || state?.customer?.projectNumber || "").trim();
      const forcedEditId = isEditMode ? String(editingRecordId || "").trim() : "";
      const savedDocId = forcedEditId || String(state?.meta?.savedDocId || "").trim();
      const openedEditId = String(openedEditIdRef.current || "").trim();
      const currentMetaSavedDocId = String(state?.meta?.savedDocId || "").trim();
      if (
        isEditMode
        && openedEditId
        && (
          (forcedEditId && forcedEditId !== openedEditId)
          || (currentMetaSavedDocId && currentMetaSavedDocId !== openedEditId)
        )
      ) {
        setSavePrompt({ tone: "error", message: "Edit session mismatch. Please reopen the estimate." });
        return;
      }
      const savedDocCreatedAt = Number(state?.meta?.savedDocCreatedAt || 0);
      const existingEstimates = readSavedDocList(ESTIMATES_KEY);
      const existingInvoices = readSavedDocList(INVOICES_KEY);

      const findById = (arr) => arr.find((x) => String(x?.id || "").trim() === savedDocId);
      const existingById = savedDocId
        ? (
          isInvoiceEditMode
            ? findById(existingInvoices)
            : (findById(existingEstimates) || findById(existingInvoices))
        )
        : null;

      const matchedByNumber = !savedDocId && docNumber
        ? (
          uiDocType === "invoice"
            ? (
              existingInvoices.find((x) => String(x?.invoiceNumber || "").trim() === docNumber)
              || existingEstimates.find((x) => String(x?.invoiceNumber || "").trim() === docNumber)
            )
            : existingEstimates.find((x) => String(x?.estimateNumber || "").trim() === docNumber)
        )
        : null;

      if (isEditMode && !existingById) {
        setSavePrompt({ tone: "error", message: `${isInvoiceEditMode ? "Invoice" : "Estimate"} not found. Unable to update.` });
        return;
      }

      const existingMatch = existingById || matchedByNumber;
      const recordId = savedDocId || String(existingMatch?.id || "").trim() || createSavedDocId();
      if (isEditMode && openedEditId && recordId !== openedEditId) {
        setSavePrompt({ tone: "error", message: "Edit session mismatch. Please reopen the estimate." });
        return;
      }
      const createdAt = savedDocCreatedAt > 0
        ? savedDocCreatedAt
        : Number(existingMatch?.createdAt || now) || now;

      const persistedDraft = saveNow?.(
        { savedDocId: recordId, savedDocCreatedAt: createdAt },
        { persistDraft: !isEditMode }
      ) || null;
      let persistedState = persistedDraft;
      if ((!persistedState || typeof persistedState !== "object") && !isEditMode) {
        const raw = localStorage.getItem(STORAGE_KEY);
        persistedState = raw ? JSON.parse(raw) : null;
      }
      if (!persistedState || typeof persistedState !== "object") {
        setSavePrompt({ tone: "error", message: "Save failed. Please try again." });
        return;
      }

      const saveDocType = isInvoiceEditMode ? "invoice" : uiDocType;
      const updatedAt = Date.now();
      const estimateNumber = saveDocType === "estimate"
        ? docNumber
        : String(existingMatch?.estimateNumber || "").trim();
      const invoiceNumber = saveDocType === "invoice" ? docNumber : "";
      const projectName = String(state?.customer?.projectName || "").trim();
      const projectNumber = String(state?.customer?.projectNumber || "").trim();
      const savedRecord = {
        ...persistedState,
        id: recordId,
        docType: saveDocType,
        customerId: String(selectedCustomerId || state?.customer?.id || "").trim(),
        customerName,
        projectName,
        projectNumber,
        estimateNumber,
        invoiceNumber,
        date: String(state?.job?.date || "").trim(),
        dueDate: String(state?.job?.due || "").trim(),
        poNumber: String(state?.job?.poNumber || "").trim(),
        total: Number(totalRevenue || 0),
        savedAt: updatedAt,
        ts: updatedAt,
        createdAt,
        updatedAt,
      };

      const nextEstimates = upsertSavedDoc(
        existingEstimates,
        savedRecord,
        saveDocType === "invoice" ? "invoiceNumber" : "estimateNumber"
      );
      localStorage.setItem(ESTIMATES_KEY, JSON.stringify(nextEstimates));

      if (saveDocType === "invoice") {
        const nextInvoices = upsertSavedDoc(existingInvoices, savedRecord, "invoiceNumber");
        localStorage.setItem(INVOICES_KEY, JSON.stringify(nextInvoices));
      } else {
        const filteredInvoices = existingInvoices.filter((x) => String(x?.id || "").trim() !== recordId);
        if (filteredInvoices.length !== existingInvoices.length) {
          localStorage.setItem(INVOICES_KEY, JSON.stringify(filteredInvoices));
        }
      }

      const savedLabel = docNumber
        ? `${saveDocType === "invoice" ? "Invoice" : "Estimate"} #${docNumber}`
        : (projectName || customerName);
      setSavePrompt({ tone: "success", message: `${isEditMode ? "Updated" : "Saved"}${savedLabel ? `: ${savedLabel}` : ""}` });

      if (isEditMode) {
        clearPendingEditTarget(editingTargetType);
        openedEditIdRef.current = "";
        openedDocNumberRef.current = "";
        setEditTarget(null);
      }

      setTimeout(() => {
        try {
          const navEvent = isEditMode
            ? (isInvoiceEditMode ? "estipaid:navigate-invoices" : "estipaid:navigate-estimates")
            : (saveDocType === "invoice" ? "estipaid:navigate-invoices" : "estipaid:navigate-estimates");
          window.dispatchEvent(new Event(navEvent));
        } catch {}
      }, 180);
    } catch {
      setSavePrompt({ tone: "error", message: "Save failed. Please try again." });
    }
  };

  const exportPDF = async (mode = "download") => {
    triggerHaptic();

    const companyGate = requireCompanyProfile({
      profile: loadCompanyProfile(),
      message: "User Profile required. Open User Profile?",
      onRequireProfile: () => {
        writeProfileReturnTarget({
          route: ROUTES.CREATE,
          intent: uiDocType === "invoice" ? BUILDER_INTENTS.INVOICE : BUILDER_INTENTS.ESTIMATE,
          editContext: isEditMode && editingRecordId && editingTargetType
            ? { type: editingTargetType, id: editingRecordId }
            : null,
        });
        try {
          window.dispatchEvent(new Event("estipaid:navigate-user-profile"));
        } catch {}
        try {
          window.dispatchEvent(new Event("estipaid:navigate-company-profile"));
        } catch {}
        try {
          window.dispatchEvent(new CustomEvent("pe-shell-action", { detail: { action: "openUserProfile" } }));
        } catch {}
        try {
          window.dispatchEvent(new CustomEvent("pe-shell-action", { detail: { action: "openCompanyProfile" } }));
        } catch {}
      },
    });
    if (!companyGate?.allowed) {
      return;
    }
    const companyProfile = companyGate.profile || loadCompanyProfile();

    try {
      const docNoRaw = String(state?.job?.docNumber || state?.customer?.projectNumber || "").trim();
      const documentNumber = sanitizePdfToken(docNoRaw, "Draft");
      const filename = `${uiDocType === "invoice" ? "Invoice" : "Estimate"}-${documentNumber}.pdf`;

      const customerName = String(state?.customer?.name || "").trim() || "-";
      const customerAttn = String(state?.customer?.attn || "").trim();
      const customerAddress = String(state?.customer?.address || "").trim();
      const billingAddress = state?.customer?.billingDiff
        ? String(state?.customer?.billingAddress || "").trim()
        : customerAddress;
      const resolvedProject = String(resolvedProjectAddress || "").trim();
      const projectName = String(state?.customer?.projectName || "").trim();
      const projectNumber = String(state?.customer?.projectNumber || "").trim();
      const poNumber = String(state?.job?.poNumber || "").trim();
      const docDate = String(state?.job?.date || "").trim();
      const includeNotes = uiDocType === "estimate";
      const additionalNotesText = String(state?.additionalNotes || "").trim();
      const materialsBlanketDescription = String(state?.materials?.materialsBlanketDescription || "").trim();
      const tradeBlocks = extractTradeInsertBlocksForPdf(state?.scopeNotes, state?.tradeInsert?.text);
      const tradeRawForPdf = includeNotes ? tradeBlocks.join("\n\n") : "";
      const scopeWithoutTrade = includeNotes ? stripTradeInsertBlocksFromScope(state?.scopeNotes, tradeBlocks) : "";
      const companyAddressLine1 = String(companyProfile?.addressLine1 || "").trim();
      const companyAddressLine2 = String(companyProfile?.addressLine2 || "").trim();
      const companyCity = String(companyProfile?.city || "").trim();
      const companyState = String(companyProfile?.state || "").trim();
      const companyZip = String(companyProfile?.zip || "").trim();
      const companyCityState = [companyCity, companyState].filter(Boolean).join(", ");
      const companyCityStateZip = [companyCityState, companyZip].filter(Boolean).join(" ");
      const companyAddressLines = [companyAddressLine1, companyAddressLine2, companyCityStateZip].filter(Boolean);
      const companyAddressText = companyAddressLines.length
        ? companyAddressLines.join("\n")
        : String(companyProfile?.address || "").trim();

      const laborRows = (computed?.labor?.normalized || []).map((ln) => {
        const roleLabel = LABOR_PRESETS.find((p) => p.key === ln?.role)?.label || "";
        const label = String(ln?.label || roleLabel || "").trim() || "-";
        const qty = Math.max(1, Number(ln?.qty) || 1);
        const hours = Number(ln?.hours) || 0;
        const effectiveRate = Number(ln?.effectiveRate ?? ln?.rate) || 0;
        const lineTotal = Number(ln?.total || qty * hours * effectiveRate);
        return [label, String(qty), String(hours || 0), money.format(effectiveRate), money.format(lineTotal)];
      });

      const materialsRows = (() => {
        if (materialsMode === "itemized") {
          const materialNotesById = new Map(
            (Array.isArray(state?.materials?.items) ? state.materials.items : []).map((item, index) => [
              String(item?.id || `idx_${index}`),
              String(item?.note || "").trim(),
            ])
          );
          const rows = (computed?.materials?.normalized || [])
            .filter((it) => String(it?.desc || "").trim())
            .map((it) => {
              const desc = String(it?.desc || "").trim();
              const note = materialNotesById.get(String(it?.id || "")) || "";
              const qty = Math.max(1, Number(it?.qty) || 1);
              const each = Number(it?.effectivePriceEach ?? it?.priceEach ?? 0);
              const lineTotal = Number(it?.charge || qty * each);
              return {
                desc,
                note,
                qty: String(qty),
                each: money.format(each),
                total: money.format(lineTotal),
              };
            });
          return rows;
        }
        return [[
          "Blanket Materials",
          "1",
          money.format(Number(materialsBilled) || 0),
          money.format(Number(materialsBilled) || 0),
        ]];
      })();

      const summarySubtotal = Number(totalRevenue) - Number(hazardFee || 0) - Number(riskFee || 0);
      const summaryRows = [
        ["Labor", money.format(Number(adjustedLabor) || 0)],
        ["Materials", money.format(Number(materialsBilled) || 0)],
        ["Subtotal", money.format(Number.isFinite(summarySubtotal) ? summarySubtotal : 0)],
        [`Hazard (${Number(hazardPctNormalized) || 0}%)`, money.format(Number(hazardFee) || 0)],
        [`Risk (${Number(riskPctNormalized) || 0}%)`, money.format(Number(riskFee) || 0)],
        ["Grand Total", money.format(Number(totalRevenue) || 0)],
      ];
      await exportPdf({
        docType: uiDocType,
        filename,
        documentNumber,
        company: {
          ...companyProfile,
          phone: formatPhoneForDisplay(companyProfile?.phone),
          address: companyAddressText,
          addressLines: companyAddressLines,
        },
        customer: {
          name: customerName,
          attn: customerAttn,
          address: customerAddress,
          billingAddress,
          netTermsType: String(state?.customer?.netTermsType || "").trim(),
          netTermsDays:
            state?.customer?.netTermsDays === null || state?.customer?.netTermsDays === undefined
              ? ""
              : String(state?.customer?.netTermsDays),
          netTermsLabel: String(selectedProfile?.netTermsLabel || "").trim(),
        },
        job: {
          date: docDate,
          dateDisplay: formatDateMMDDYYYY(docDate) || "-",
          projectName,
          projectNumber,
          projectAddress: resolvedProject || customerAddress || "-",
          poNumber,
        },
        jobInfoRows: [
          ["Document #", documentNumber],
          ["Date", formatDateMMDDYYYY(docDate) || "-"],
          ["Project", projectName || "-"],
          ["Project #", projectNumber || "-"],
          ["Project Address", resolvedProject || customerAddress || "-"],
          ["PO #", poNumber || "-"],
        ],
        tradeInsertText: tradeRawForPdf,
        laborRows,
        materialRows: materialsRows,
        materialsMode,
        materialsBlanketDescription: materialsMode === "blanket" ? materialsBlanketDescription : "",
        summaryRows,
        scopeNotes: includeNotes ? scopeWithoutTrade : "",
        additionalNotes: additionalNotesText,
      }, mode);
    } catch (err) {
      try { console.error(err); } catch {}
      window.alert("PDF export failed.");
    }
  };

  const onPdf = () => {
    triggerHaptic();
    setPdfPromptOpen(true);
  };

  const uiDocType = state?.ui?.docType === "invoice" ? "invoice" : "estimate";
  const builderTitle = uiDocType === "invoice" ? "Invoice Builder" : "Estimator Builder";
  const editPrimaryTitle = isInvoiceEditMode ? "EDIT INVOICE" : "EDIT ESTIMATE";
  const editDocNumberRaw = String(
    state?.estimateNumber
    || state?.invoiceNumber
    || state?.docNumber
    || state?.documentNumber
    || state?.number
    || state?.job?.docNumber
    || state?.document?.number
    || state?.doc?.number
    || ""
  ).trim();
  const editSecondaryTitle = `#${editDocNumberRaw || "(no number)"}`;
  const editUpdatedTs = getMostRecentSavedTimestamp(state);
  const editUpdatedLabel = editUpdatedTs > 0 ? `Last updated ${formatSavedTimestamp(editUpdatedTs)}` : "";
  const totalLabel = uiDocType === "invoice" ? "Invoice Total" : "Estimate Total";
  const setDocType = (nextDocType) => {
    const next = nextDocType === "invoice" ? "invoice" : "estimate";
    patch("ui.docType", next);
  };
  const materialsMode = state?.ui?.materialsMode === "itemized" ? "itemized" : "blanket";
  const setMaterialsMode = (mode) => {
    const nextMode = mode === "itemized" ? "itemized" : "blanket";
    patch("ui.materialsMode", nextMode);
    if (nextMode === "itemized") {
      const items = Array.isArray(state?.materials?.items) ? state.materials.items : [];
      if (items.length === 0) {
        patch("materials.items", [createBlankMaterialItem(undefined, globalDefaultMarkupPct)]);
      }
    }
  };
  const materialsCost = String(state?.materials?.blanketCost ?? "");
  const setMaterialsCost = (v) => patch("materials.blanketCost", v);
  const materialsMarkupPct = String(state?.materials?.markupPct ?? "");
  const setMaterialsMarkupPct = (v) => patch("materials.markupPct", v);
  const materialsBlanketDescription = String(state?.materials?.materialsBlanketDescription || "");
  const setMaterialsBlanketDescription = (v) => patch("materials.materialsBlanketDescription", v);
  const materialItems = useMemo(() => {
    const arr = Array.isArray(state?.materials?.items) ? state.materials.items : [];
    return arr.map((it) => ({
      ...it,
      note: String(it?.note || ""),
      qty: Math.max(1, Number(it?.qty) || 1),
      cost: it?.cost ?? it?.unitCostInternal ?? it?.costInternal ?? "",
      charge: it?.charge ?? it?.priceEach ?? "",
      markupPct: it?.markupPct ?? "",
    }));
  }, [state?.materials?.items]);
  useEffect(() => {
    if (materialsMode !== "itemized") return;
    const items = Array.isArray(state?.materials?.items) ? state.materials.items : [];
    if (items.length > 0) return;
    patch("materials.items", [createBlankMaterialItem(undefined, globalDefaultMarkupPct)]);
  }, [globalDefaultMarkupPct, materialsMode, patch, state?.materials?.items]);
  const laborLines = useMemo(() => {
    const arr = Array.isArray(state?.labor?.lines) ? state.labor.lines : [];
    return arr.map((ln) => {
      const roleLabel = LABOR_PRESETS.find((p) => p.key === ln?.role)?.label || "";
      return {
        ...ln,
        label: String(ln?.label || roleLabel || ""),
      };
    });
  }, [state?.labor?.lines]);
  const laborLineCount = laborLines.length;
  const totalLaborers = Array.isArray(state?.labor?.lines)
    ? state.labor.lines.reduce((sum, ln) => {
        const n = Number(ln?.laborers);
        return sum + (Number.isFinite(n) && n > 0 ? n : 1);
      }, 0)
    : 0;
  const itemizedMaterialsTotal = Number(computed?.materials?.totalCharge || 0);
  const itemizedMaterialsCount = useMemo(() => (materialItems || []).length, [materialItems]);
  const normalizedMarkupPct = Number(normalizePercentInput(materialsMarkupPct));
  const materialsBilled = materialsMode === "itemized"
    ? itemizedMaterialsTotal
    : Number(computed?.materials?.totalCharge || 0);
  const displayedMaterialsTotal = materialsMode === "itemized" ? itemizedMaterialsTotal : materialsBilled;
  const fallbackMaterialRevenue = materialsMode === "itemized"
    ? itemizedMaterialsTotal
    : materialsBilled;
  const fallbackMaterialCost = materialsMode === "itemized"
    ? itemizedInternalCost
    : (Number(state?.materials?.blanketInternalCost) || 0);
  const fallbackLaborRevenue = Number(computed?.laborAfterAdjustments ?? computed?.labor?.subtotal ?? 0);
  const fallbackLaborCost = Number(computed?.labor?.internalCost || computed?.labor?.cost || 0);
  const totalRevenue = Number((computed?.totalRevenue ?? (fallbackLaborRevenue + fallbackMaterialRevenue)) || 0);
  const totalCost = Number((computed?.totalCost ?? (fallbackLaborCost + fallbackMaterialCost)) || 0);
  const totalGrossProfit = Number(computed?.grossProfit || 0);
  const grossMarginPct = Number(computed?.grossMarginPct || 0);
  const grossMarginLabel = totalRevenue > 0 ? `${(grossMarginPct * 100).toFixed(1)}%` : "—";
  const laborBase = Number(computed?.labor?.subtotal || 0);
  const currentMultiplier = Number(computed?.multiplier ?? state?.labor?.multiplier);
  const laborMultiplier = Number.isFinite(currentMultiplier) && currentMultiplier > 0 ? currentMultiplier : 1;
  const hazardPctNormalized = Number(normalizePercentInput(computed?.hazardPct ?? state?.labor?.hazardPct));
  const riskPctNormalized = Number(normalizePercentInput(computed?.riskPct ?? state?.labor?.riskPct));
  const hazardEnabled = Number.isFinite(hazardPctNormalized) && hazardPctNormalized > 0;
  const riskEnabled = Number.isFinite(riskPctNormalized) && riskPctNormalized > 0;
  const laborAdjusted = Number(computed?.laborAfterMultiplier ?? (laborBase * laborMultiplier));
  const adjustedLabor = laborAdjusted;
  const hazardFee = Number(computed?.hazardAmount ?? (hazardEnabled ? (adjustedLabor * (hazardPctNormalized / 100)) : 0));
  const riskFee = Number(computed?.riskAmount ?? (riskEnabled ? (adjustedLabor * (riskPctNormalized / 100)) : 0));
  const laborLineLabel = laborLineCount === 1 ? "line" : "lines";
  const laborCollapsedMeta = `${laborLineCount} ${laborLineLabel} • ${money.format(laborBase)}`;
  const itemizedCollapsedSummary = `${
    itemizedMaterialsCount === 1 ? "1 item" : `${itemizedMaterialsCount} items`
  } • Total ${money.format(itemizedMaterialsTotal)}`;
  const multiplierSelectValue = multiplierMode === "custom"
    ? "custom"
    : (laborMultiplier === 1.1
      ? "1.1"
      : laborMultiplier === 1.2
        ? "1.2"
        : laborMultiplier === 1.25
          ? "1.25"
          : "1");
  const totalTallyLine = `${laborLineCount} ${t("laborLines")}`
    + (totalLaborers !== laborLineCount ? ` • ${totalLaborers} ${t("laborers")}` : "")
    + (laborMultiplier !== 1 ? ` • ${laborMultiplier}${t("complexity")}` : "")
    + (hazardEnabled ? ` • ${lang === "es" ? "Peligro" : "Hazard"} ${hazardPctNormalized}%` : "")
    + (riskEnabled ? ` • ${lang === "es" ? "Riesgo" : "Risk"} ${riskPctNormalized}%` : "")
    + (materialsMode === "blanket" && Number.isFinite(normalizedMarkupPct) ? ` • ${normalizedMarkupPct}${t("materialsMeta")}` : "")
    + (materialsMode === "itemized"
      ? ` • ${itemizedMaterialsCount}x ${lang === "es" ? "materiales" : "materials"} • ${money.format(itemizedMaterialsTotal)}`
      : " • Blanket materials");

  useEffect(() => {
    const prev = previousTotalsRef.current;
    if (!prev) {
      previousTotalsRef.current = {
        laborBase,
        materials: displayedMaterialsTotal,
        estimate: totalRevenue,
      };
      return;
    }
    if (prev.laborBase !== laborBase) triggerTotalPulse("labor");
    if (prev.materials !== displayedMaterialsTotal) triggerTotalPulse("materials");
    if (prev.estimate !== totalRevenue) triggerTotalPulse("estimate");
    previousTotalsRef.current = {
      laborBase,
      materials: displayedMaterialsTotal,
      estimate: totalRevenue,
    };
  }, [displayedMaterialsTotal, laborBase, totalRevenue]);

  const dockHeight = embeddedInShell ? SHELL_DOCK_HEIGHT : 0;
  const actionBarBottom = `calc(${dockHeight}px + env(safe-area-inset-bottom, 0px))`;
  const scrollPaddingBottom = `calc(${dockHeight}px + env(safe-area-inset-bottom, 0px) + ${actionBarHeight}px + ${ACTION_BAR_GAP}px)`;
  const saveToastBottom = `calc(${dockHeight}px + env(safe-area-inset-bottom, 0px) + ${actionBarHeight}px + ${ACTION_BAR_GAP + 10}px)`;
  const saveToastToneStyle = savePrompt?.tone === "error"
    ? styles.saveToastError
    : (savePrompt?.tone === "warn" ? styles.saveToastWarn : styles.saveToastSuccess);
  const actionButtonsStyle = isEditMode ? styles.estimatorActionButtonsEdit : styles.estimatorActionButtons;

  return (
    <div className="pe-wrap ep-estimator" style={{ paddingTop: embeddedInShell ? 8 : undefined, paddingBottom: scrollPaddingBottom }}>
      {/* Builder bar */}
      <div className="estimatorPageContainer">
        <div className="tileWidthWrapper">
          <div className="pe-builder-bar estimatorHeaderRow">
            {isEditMode ? (
              <>
                <div style={styles.editHeaderStack}>
                  <h1 className="pe-title pe-builder-title screenTitle" style={styles.editHeaderPrimary}>
                    {editPrimaryTitle}
                  </h1>
                  <div style={styles.editHeaderSecondary}>{editSecondaryTitle}</div>
                  {editUpdatedLabel ? <div style={styles.editHeaderMeta}>{editUpdatedLabel}</div> : null}
                </div>
                <div style={styles.editModeBadge}>EDIT MODE</div>
              </>
            ) : (
              <>
                <h1 className="pe-title pe-builder-title screenTitle">
                  <span className="titleShineText" data-title={builderTitle}>{builderTitle}</span>
                </h1>
                <div className="pe-builder-mode" style={styles.builderModeSegmented}>
                  <button
                    type="button"
                    className={uiDocType === "estimate" ? "pe-btn" : "pe-btn pe-btn-ghost"}
                    onClick={() => setDocType("estimate")}
                    style={uiDocType === "estimate" ? styles.builderModeSegmentActive : styles.builderModeSegment}
                  >
                    Estimate
                  </button>
                  <button
                    type="button"
                    className={uiDocType === "invoice" ? "pe-btn" : "pe-btn pe-btn-ghost"}
                    onClick={() => setDocType("invoice")}
                    style={uiDocType === "invoice" ? styles.builderModeSegmentActive : styles.builderModeSegment}
                  >
                    Invoice
                  </button>
                </div>
              </>
            )}
          </div>

          <div ref={customerTopRef} className="pe-card pe-estimator-shell">
        {/* Customer */}
        <section className="pe-card" style={styles.sectionBlock}>
        <SectionTitleWithIcon icon={<IconCustomer />} title="Customer" styles={styles} />

        {/* Combo search/dropdown + Edit button */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              className="pe-input"
              ref={customerNameRef}
              placeholder="Search or select a customer…"
              value={searchCustomerText}
              autoComplete="off"
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), DROPDOWN_BLUR_DELAY)}
              onChange={(e) => { setSearchCustomerText(e.target.value); setDropdownOpen(true); }}
            />
            {dropdownOpen && dropdownRect.width > 0 && typeof document !== "undefined" && createPortal(
              <div style={{ ...styles.dropdownPortal, top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width }}>
                <div
                  key={CREATE_NEW_CUSTOMER_VALUE}
                  style={{
                    ...styles.dropdownOption,
                    ...styles.dropdownCreateOption,
                    ...(dropdownHoverKey === CREATE_NEW_CUSTOMER_VALUE ? styles.dropdownOptionHover : null),
                  }}
                  onMouseDown={(e) => { e.preventDefault(); handleSelectCustomer(CREATE_NEW_CUSTOMER_VALUE); }}
                  onMouseEnter={() => setDropdownHoverKey(CREATE_NEW_CUSTOMER_VALUE)}
                  onMouseLeave={() => setDropdownHoverKey("")}
                >
                  + Create New Customer
                </div>
                {dropdownCustomers.map((c) => (
                  <div
                    key={String(c.id)}
                    style={{
                      ...styles.dropdownOption,
                      ...(String(selectedCustomerId || "") === String(c.id) ? styles.dropdownOptionSelected : null),
                      ...(dropdownHoverKey === String(c.id) ? styles.dropdownOptionHover : null),
                    }}
                    onMouseDown={(e) => { e.preventDefault(); handleSelectCustomer(String(c.id)); }}
                    onMouseEnter={() => setDropdownHoverKey(String(c.id))}
                    onMouseLeave={() => setDropdownHoverKey("")}
                  >
                    {customerDisplayName(c)}
                  </div>
                ))}
                {dropdownCustomers.length === 0 && (
                  <div style={styles.dropdownEmpty}>No customers found.</div>
                )}
              </div>,
              document.body
            )}
          </div>
          <button
            className="pe-btn pe-btn-ghost"
            type="button"
            disabled={!selectedCustomerId}
            onClick={() => {
              try {
                localStorage.setItem(CUSTOMER_EDIT_TARGET_KEY, JSON.stringify({ id: selectedCustomerId, returnTo: "estimator" }));
                window.dispatchEvent(new Event("estipaid:navigate-customers"));
              } catch {}
            }}
          >
            Edit
          </button>
        </div>
        <div style={styles.selectedCustomerText}>
          Selected: {selectedProfile?.displayName ? (
            <>
              <span style={{ fontWeight: 800 }}>{selectedProfile.displayName}</span>
              {selectedProfile.companyName && selectedProfile.companyName !== selectedProfile.displayName ? ` • ${selectedProfile.companyName}` : ""}
            </>
          ) : "None"}
        </div>
        {selectedCustomerId && selectedProfile && (
          <div style={styles.customerProfilePanel}>
            <div style={styles.customerProfileTitle}>Customer Profile</div>
            <div style={styles.customerProfileGrid}>
              {selectedProfile.fullName ? (
                <div style={styles.customerProfileItem}>
                  <div style={styles.customerProfileLabel}>Full name</div>
                  <div style={styles.customerProfileValue}>{selectedProfile.fullName}</div>
                </div>
              ) : null}
              {selectedProfile.companyName ? (
                <div style={styles.customerProfileItem}>
                  <div style={styles.customerProfileLabel}>Company</div>
                  <div style={styles.customerProfileValue}>{selectedProfile.companyName}</div>
                </div>
              ) : null}
              {selectedProfile.phone ? (
                <div style={styles.customerProfileItem}>
                  <div style={styles.customerProfileLabel}>Phone</div>
                  <div style={styles.customerProfileValue}>{selectedProfile.phone}</div>
                </div>
              ) : null}
              {selectedProfile.email ? (
                <div style={styles.customerProfileItem}>
                  <div style={styles.customerProfileLabel}>Email</div>
                  <div style={styles.customerProfileValue}>{selectedProfile.email}</div>
                </div>
              ) : null}
              <div style={styles.customerProfileItem}>
                <div style={styles.customerProfileLabel}>Customer type</div>
                <div style={styles.customerProfileValue}>{selectedProfile.customerType === "commercial" ? "Commercial" : "Residential"}</div>
              </div>
              <div style={styles.customerProfileItem}>
                <div style={styles.customerProfileLabel}>Net terms</div>
                <div style={styles.customerProfileValue}>{selectedProfile.netTermsLabel || "—"}</div>
              </div>
              {selectedProfile.billingAddress ? (
                <div style={{ ...styles.customerProfileItem, ...styles.customerProfileItemFull }}>
                  <div style={styles.customerProfileLabel}>Billing address</div>
                  <div style={styles.customerProfileValue}>{selectedProfile.billingAddress}</div>
                </div>
              ) : null}
              {selectedProfile.showProjectAddress ? (
                <div style={{ ...styles.customerProfileItem, ...styles.customerProfileItemFull }}>
                  <div style={styles.customerProfileLabel}>Project address</div>
                  <div style={styles.customerProfileValue}>{selectedProfile.projectAddress}</div>
                </div>
              ) : null}
              {selectedProfile.notes ? (
                <div style={{ ...styles.customerProfileItem, ...styles.customerProfileItemFull }}>
                  <div style={styles.customerProfileLabel}>Notes</div>
                  <div style={styles.customerProfileValue}>{selectedProfile.notes}</div>
                </div>
              ) : null}
            </div>
          </div>
        )}
        </section>

        <section className="pe-card" style={styles.sectionBlock}>
        <div className="pe-divider" style={styles.sectionHeaderDivider} />
        <SectionTitleWithIcon icon={<IconJobInfo />} title="Job Info" styles={styles} />

        <div style={{ ...styles.cardShell, marginTop: 6 }}>
          <div style={styles.jobInfoContentWrap}>
            <div className={jobInfoTopGridClassName}>
              <div>
                <label style={styles.label}>Project name</label>
                <input className="pe-input" value={state.customer.projectName || ""} onChange={(e) => patch("customer.projectName", e.target.value)} placeholder="Project name (optional)" />
              </div>
              {isCommercialJob ? (
                <div>
                  <label style={styles.label}>Project #</label>
                  <input className="pe-input" value={state.customer.projectNumber || ""} onChange={(e) => patch("customer.projectNumber", e.target.value)} placeholder="Project # (optional)" />
                </div>
              ) : null}
              {effectivePoRequired ? (
                <div>
                  <label style={styles.label}>PO number</label>
                  <input className="pe-input" value={state.job.poNumber} onChange={(e) => patch("job.poNumber", e.target.value)} placeholder="PO # (optional)" />
                </div>
              ) : null}
              <div>
                <label style={styles.label}>Date</label>
                <input className="pe-input" type="date" value={state.job.date} onChange={(e) => patch("job.date", e.target.value)} />
              </div>
            </div>

            <div style={{ ...styles.projectLocationToggleRow, marginTop: 10 }}>
              <label style={styles.projectLocationToggleLabel}>
                <input
                  type="checkbox"
                  checked={projectLocationSame}
                  onChange={(e) => patch("customer.projectSameAsCustomer", !!e.target.checked)}
                />
                <span>Project location (use customer address)</span>
              </label>
            </div>

            {!projectLocationSame ? (
              <div style={styles.jobInfoAddressWrap}>
                <div className="pe-jobinfo-address-row-a">
                  <div>
                    <label style={styles.label}>Address</label>
                    <input
                      className="pe-input"
                      autoComplete="street-address"
                      value={state.customer.projectAddress || ""}
                      onChange={(e) => patch("customer.projectAddress", e.target.value)}
                      placeholder="Street address"
                    />
                  </div>
                  <div>
                    <label style={styles.label}>Address line 2</label>
                    <input
                      className="pe-input"
                      autoComplete="address-line2"
                      value={state.job.location || ""}
                      onChange={(e) => patch("job.location", e.target.value)}
                      placeholder="Suite, unit, etc. (optional)"
                    />
                  </div>
                </div>

                <div className="pe-jobinfo-address-row-b">
                  <div>
                    <label style={styles.label}>City</label>
                    <input
                      className="pe-input"
                      autoComplete="address-level2"
                      value={state.customer.city || ""}
                      onChange={(e) => patch("customer.city", e.target.value)}
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <label style={styles.label}>State</label>
                    <select
                      className="pe-input"
                      value={state.customer.state || ""}
                      onChange={(e) => patch("customer.state", e.target.value)}
                      autoComplete="address-level1"
                    >
                      <option value="">State</option>
                      {US_STATES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={styles.label}>ZIP</label>
                    <input
                      className="pe-input"
                      autoComplete="postal-code"
                      value={state.customer.zip || ""}
                      onChange={(e) => patch("customer.zip", e.target.value)}
                      placeholder="ZIP"
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        </section>

        {uiDocType === "estimate" ? (
        <section className="pe-card" style={styles.sectionBlock}>
        <div className="pe-divider" style={styles.sectionHeaderDivider} />
        <div style={styles.scopeHeaderRow}>
          <SectionTitleWithIcon icon={<IconSpecialConditions />} title="Scope / Notes" styles={styles} stackStyle={{ marginBottom: 0 }} />
        </div>
        <div
          className={`pe-collapse ${notesOpen ? "pe-open" : ""}`}
          style={{ ...styles.notesCollapseWrap, transitionDuration: `${COLLAPSE_MS}ms` }}
        >
          <div className="pe-scope-insert-grid">
            <select
              className="pe-input"
              defaultValue=""
              style={{ width: "100%" }}
              onChange={(e) => {
                const key = e.target.value;
                if (!key) return;
                const tmpl = SCOPE_MASTER_TEMPLATES.find((t) => t.key === key);
                if (!tmpl) return;
                const existing = scopeNotes;
                const sep = existing.trim().length > 0 ? "\n\n" : "";
                patch("scopeNotes", existing + sep + tmpl.text);
                e.target.value = "";
              }}
            >
              <option value="">Insert template…</option>
              {SCOPE_MASTER_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            <select
              className="pe-input"
              defaultValue=""
              style={{ width: "100%" }}
              onChange={(e) => {
                const key = e.target.value;
                if (!key) return;
                const insert = SCOPE_TRADE_INSERTS.find((t) => t.key === key);
                if (!insert) return;
                const existing = scopeNotes;
                const sep = existing.trim().length > 0 ? "\n\n" : "";
                patch("scopeNotes", existing + sep + insert.text);
                patch("tradeInsert.key", insert.key);
                patch("tradeInsert.text", insert.text);
                e.target.value = "";
              }}
            >
              <option value="">Insert trade…</option>
              {SCOPE_TRADE_INSERTS.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <textarea
            ref={scopeNotesRef}
            className="pe-input pe-textarea"
            value={scopeNotes}
            onChange={(e) => {
              patch("scopeNotes", e.target.value);
              autoResizeScopeNotes(e.target);
            }}
            placeholder="Scope / notes…"
            style={{ minHeight: SCOPE_NOTES_MIN_HEIGHT, resize: "none" }}
          />
        </div>
        <div
          className={`pe-collapse ${notesOpen ? "" : "pe-open"}`}
          style={{ ...styles.notesCollapsedPreviewWrap, transitionDuration: `${COLLAPSE_MS}ms` }}
        >
          <div className="pe-muted" style={styles.scopeCollapsedPreview}>
            {scopeNotes.trim()
              ? `${scopeNotes.replace(/\s+/g, " ").trim().slice(0, 120)}${scopeNotes.replace(/\s+/g, " ").trim().length > 120 ? "…" : ""}`
              : "No notes"}
          </div>
        </div>
        <div style={styles.scopeCollapseRow}>
          {notesOpen ? (
            <>
              <button
                className="pe-btn pe-btn-ghost"
                type="button"
                style={styles.scopeCollapseBtn}
                onClick={() => setNotesOpen(false)}
                title="Collapse notes"
              >
                Collapse ▴
              </button>
              <button
                className="pe-btn pe-btn-ghost"
                type="button"
                style={styles.scopeClearBtn}
                onClick={handleClearScopeNotes}
              >
                Clear Notes
              </button>
            </>
          ) : (
            <button
              className="pe-btn pe-btn-ghost"
              type="button"
              style={styles.scopeCollapseBtn}
              onClick={() => setNotesOpen(true)}
              title="Expand notes"
            >
              Expand ▾
            </button>
          )}
        </div>
        </section>
        ) : null}

      {/* LABOR */}
      <section className="pe-section">
        <div className="pe-divider" style={styles.sectionHeaderDivider} />
        <div style={styles.sectionHeaderRow}>
          <SectionTitleWithIcon icon={<IconLabor />} title={t("labor")} styles={styles} stackStyle={{ marginBottom: 0 }} />

          {!laborOpen && (
            <div className="pe-muted" style={styles.laborCollapsedMeta}>
              {(laborLines?.length || 0) === 1
                ? (lang === "es" ? "1 línea" : "1 line")
                : `${laborLines?.length || 0} ${lang === "es" ? "líneas" : "lines"}`}
              {" • "}
              {money.format(Number(laborAdjusted) || 0)}
            </div>
          )}
          {!laborOpen && (
            <button
              type="button"
              className="pe-btn pe-btn-ghost"
              onClick={() => setLaborOpen(true)}
              title={lang === "es" ? "Expandir" : "Expand"}
              style={{ ...styles.scopeCollapseBtn, marginLeft: "auto" }}
            >
              {lang === "es" ? "Expandir ▾" : "Expand ▾"}
            </button>
          )}
        </div>

        <div
          className={`pe-collapse ${laborOpen ? "pe-open" : ""}`}
          style={{ ...styles.laborCollapseWrap, transitionDuration: `${COLLAPSE_MS}ms` }}
        >
          {laborLines.map((l, i) => {
            const presetLabels = LABOR_PRESETS.map((p) => p.label);
            const hasLegacyLabel = l.label && !presetLabels.includes(l.label);

              return (
                <div
                  key={l.id || i}
                  className={newLaborLineIds?.[String(l.id)] ? "pe-anim-enter" : ""}
                  style={{ ...styles.cardShell, marginTop: 6 }}
                >
                  <div className="pe-grid pe-labor-grid" style={styles.laborLineGrid}>
                  <div style={styles.fieldStack}>
                    <div style={styles.label}>{lang === "es" ? "Rol" : "Role"}</div>
                    <select
                      className="pe-input"
                      value={l.label || ""}
                      onChange={(e) => applyLaborPresetByLabel(i, e.target.value)}
                      title={lang === "es" ? "Rol" : "Role"}
                      style={{ width: "100%" }}
                    >
                      <option value="">{t("selectRole")}</option>
                      {hasLegacyLabel && <option value={l.label}>{l.label}</option>}
                      {LABOR_PRESETS.map((p) => (
                        <option key={p.key} value={p.label}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={styles.fieldStack}>
                    <div style={styles.label}>{t("hours")}</div>
                    <input
                      className="pe-input"
                      placeholder={t("hours")}
                      value={l.hours || ""}
                      onChange={(e) => updateLaborLineAt(i, "hours", e.target.value)}
                      onBlur={(e) => updateLaborLineAt(i, "hours", normalizeHoursInput(e.target.value))}
                      inputMode="decimal"
                      style={{ width: "100%" }}
                    />
                  </div>

                  <div style={styles.fieldStack}>
                    <div style={styles.label}>{t("rate")}</div>

                    <input
                      className="pe-input"
                      placeholder={t("rate")}
                      value={l.rate || ""}
                      onChange={(e) => updateLaborLineAt(i, "rate", e.target.value)}
                      onBlur={(e) => updateLaborLineAt(i, "rate", normalizeMoneyInput(e.target.value))}
                      inputMode="decimal"
                      style={{ width: "100%" }}
                    />

                  </div>

                  <div style={styles.fieldStack}>
                    <div style={styles.label}>{t("markupPct")}</div>
                    <input
                      className="pe-input"
                      placeholder={t("markupPct")}
                      value={lockMarkupToGlobal ? String(globalDefaultMarkupPctNumber) : String(l.markupPct ?? "")}
                      onChange={(e) => updateLaborLineAt(i, "markupPct", e.target.value)}
                      onBlur={(e) => updateLaborLineAt(i, "markupPct", normalizePercentInput(e.target.value))}
                      inputMode="decimal"
                      disabled={lockMarkupToGlobal}
                      title={lockMarkupToGlobal ? "Locked to global default markup" : "Line markup"}
                      style={{ width: "100%", opacity: lockMarkupToGlobal ? 0.72 : 1 }}
                    />
                  </div>

                  {showInternalCostFields ? (
                    <div style={styles.fieldStack}>
                      <div style={styles.label}>
                        {lang === "es" ? "Tarifa real (interna)" : "True rate (internal)"}
                        <span
                          className="pe-muted"
                          style={styles.laborLineOptional}
                          title={lang === "es" ? "Opcional: si está vacío, usa Tarifa" : "Optional: if blank, uses Rate"}
                        >
                          {lang === "es" ? "(opcional)" : "(optional)"}
                        </span>
                      </div>
                      <input
                        className="pe-input"
                        placeholder={lang === "es" ? "Tarifa interna" : "Internal rate"}
                        value={l.internalRate || l.trueRateInternal || ""}
                        onChange={(e) => updateLaborLineAt(i, "internalRate", e.target.value)}
                        onBlur={(e) => updateLaborLineAt(i, "internalRate", normalizeMoneyInput(e.target.value))}
                        inputMode="decimal"
                        title={lang === "es" ? "Solo interno (no se imprime)" : "Internal only (not printed)"}
                        disabled={lockInternalCostFields}
                        style={{ width: "100%", opacity: lockInternalCostFields ? 0.72 : 1 }}
                      />
                    </div>
                  ) : null}
                </div>

                  <div style={styles.laborLineActions}>
                  <div
                    className="pe-muted"
                    title={lang === "es" ? "Cantidad en esta línea" : "Headcount on this line"}
                    style={styles.laborQtyLabel}
                  >
                    x{normalizeLaborQtyValue(l?.qty)}
                  </div>

                  <div style={styles.laborLineTotalWrap}>
                    <span style={styles.laborLineTotalLabel}>Line total</span>
                    <span style={styles.laborLineTotalValue}>{money.format(laborTotalsById.get(String(l.id)) || 0)}</span>
                  </div>

                  <div style={styles.laborLineActionButtons}>
                    <button
                      className="pe-btn pe-btn-ghost"
                      type="button"
                      onClick={() => handleLaborMinus(i)}
                      title={lang === "es" ? "Disminuir cantidad" : "Decrease quantity"}
                      style={styles.lineDeleteBtn}
                    >
                      −
                    </button>
                    <button
                      className="pe-btn pe-btn-ghost pe-labor-add-circle"
                      type="button"
                      onClick={() => duplicateLaborLine(i)}
                      title={lang === "es" ? "Duplicar trabajador en esta línea" : "Duplicate laborer on this line"}
                      style={styles.lineAddBtn}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="pe-btn pe-btn-ghost pe-labor-trash-btn"
                    type="button"
                    onClick={() => handleLaborTrash(i)}
                    title={lang === "es" ? "Eliminar línea" : "Delete line"}
                    style={styles.lineTrashBtn}
                  >
                    <IconTrash />
                  </button>
                  </div>
                </div>
              );
          })}

          <div className="pe-row pe-row-slim" style={styles.laborBaseRow}>
            <div className="pe-muted">{lang === "es" ? "Mano de obra base" : "Base labor"}</div>
            <div className={`pe-value ${animateLaborBaseTotal ? "value-pulse" : ""}`}>{money.format(laborBase)}</div>
          </div>
        </div>

        {laborOpen && (
          <div style={styles.laborBottomActions}>
            <button
              type="button"
              className="pe-btn pe-btn-ghost"
              onClick={() => setLaborOpen(false)}
              title={lang === "es" ? "Colapsar" : "Collapse"}
              style={{ padding: "6px 10px" }}
            >
              {lang === "es" ? "Colapsar" : "Collapse"} ▴
            </button>
            <button className="pe-btn pe-btn-micro pe-shortcut-tip" data-shortcut="+" onClick={handleLaborPrimary} type="button">
              {lang === "es" ? "+ Mano de obra" : "+ Labor"}
            </button>
          </div>
        )}
      </section>

      <div
        className={`pe-collapse ${laborOpen ? "pe-open" : ""}`}
        style={{ ...styles.specialConditionsCollapseWrap, transitionDuration: `${COLLAPSE_MS}ms` }}
      >
        <section className="pe-card" style={styles.sectionBlock}>
              <div className="pe-divider" style={styles.sectionHeaderDivider} />
              <div style={styles.sectionHeaderRow}>
                <SectionTitleWithIcon icon={<IconSpecialConditions />} title="Special Conditions" styles={styles} stackStyle={{ marginBottom: 0 }} />
              </div>

              <div style={styles.specialConditionsCardShell}>
                <div className="pe-special-conditions-grid">
                  <div style={styles.fieldStack}>
                    <div style={styles.label}>Hazard / Site Conditions</div>
                    <div className="pe-muted" style={styles.specialConditionsHelper}>
                      Physical/site constraints & safety burden.
                    </div>
                    <div style={styles.specialConditionsPercentWrap}>
                      <input
                        className="pe-input"
                        value={String(state?.labor?.hazardPct ?? 0)}
                        onChange={(e) => patch("labor.hazardPct", e.target.value)}
                        onBlur={(e) => patch("labor.hazardPct", normalizePercentInput(e.target.value))}
                        inputMode="decimal"
                        pattern="[0-9]*"
                        title="Percent of adjusted labor only"
                        style={styles.specialConditionsCompactInput}
                      />
                      <span style={styles.specialConditionsPercentSuffix}>%</span>
                    </div>
                  </div>

                  <div style={styles.fieldStack}>
                    <div style={styles.label}>Risk / Uncertainty Buffer</div>
                    <div className="pe-muted" style={styles.specialConditionsHelper}>
                      Unknowns & contingency for scope/schedule.
                    </div>
                    <div style={styles.specialConditionsPercentWrap}>
                      <input
                        className="pe-input"
                        value={String(state?.labor?.riskPct ?? 0)}
                        onChange={(e) => patch("labor.riskPct", e.target.value)}
                        onBlur={(e) => patch("labor.riskPct", normalizePercentInput(e.target.value))}
                        inputMode="decimal"
                        pattern="[0-9]*"
                        style={styles.specialConditionsCompactInput}
                      />
                      <span style={styles.specialConditionsPercentSuffix}>%</span>
                    </div>
                  </div>

                  <div style={styles.fieldStack} className="pe-special-conditions-main-field">
                    <div style={styles.label}>Condition</div>
                    <select
                      className="pe-input"
                      value={multiplierSelectValue}
                      onChange={(e) => handleMultiplierSelect(e.target.value)}
                      style={{ width: "100%" }}
                    >
                      <option value="1">{t("standard")}</option>
                      <option value="1.1">{t("difficultAccess")}</option>
                      <option value="1.2">{t("highRisk")}</option>
                      <option value="1.25">{t("offHours")}</option>
                      <option value="custom">{t("customEllipsis")}</option>
                    </select>
                  </div>
                </div>

                {multiplierMode === "custom" && (
                  <div className="pe-special-conditions-grid" style={{ marginTop: 8 }}>
                    <div style={styles.fieldStack} className="pe-special-conditions-main-field">
                      <div style={styles.label}>Custom multiplier</div>
                      <input
                        className="pe-input"
                        value={String(state?.labor?.multiplier ?? "")}
                        onChange={(e) => patch("labor.multiplier", e.target.value)}
                        onBlur={(e) => patch("labor.multiplier", normalizeMultiplierInput(e.target.value))}
                        placeholder="Custom labor multiplier (ex: 1.18)"
                        inputMode="decimal"
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>
                )}

                <div className="pe-row pe-row-slim">
                  <div className="pe-muted">Adjusted labor</div>
                  <div className="pe-value">{money.format(adjustedLabor)}</div>
                </div>

                {hazardEnabled && (
                  <div className="pe-row pe-row-slim">
                    <div className="pe-muted">{`Hazard fee (${hazardPctNormalized}% of labor)`}</div>
                    <div className="pe-value">{money.format(hazardFee)}</div>
                  </div>
                )}

                {riskEnabled && (
                  <div className="pe-row pe-row-slim">
                    <div className="pe-muted">{`Risk fee (${riskPctNormalized}% of labor)`}</div>
                    <div className="pe-value">{money.format(riskFee)}</div>
                  </div>
                )}
              </div>
        </section>
      </div>

      {/* MATERIALS */}
      <SectionMaterials
        t={t}
        lang={lang}
        styles={styles}
        headerIcon={<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M12 4.8 5.8 8.1 12 11.4l6.2-3.3L12 4.8Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" /><path d="M5.8 12 12 15.3l6.2-3.3M5.8 15.9 12 19.2l6.2-3.3" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" /></svg>}
        money={money}
        collapseMs={COLLAPSE_MS}
        triggerHaptic={triggerHaptic}
        materialsMode={materialsMode}
        setMaterialsMode={setMaterialsMode}
        materialsOpen={materialsOpen}
        setMaterialsOpen={setMaterialsOpen}
        itemizedCollapsedSummary={itemizedCollapsedSummary}
        materialsCost={materialsCost}
        setMaterialsCost={setMaterialsCost}
        normalizeMoneyInput={normalizeMoneyInput}
        materialsMarkupPct={materialsMarkupPct}
        setMaterialsMarkupPct={setMaterialsMarkupPct}
        materialsBlanketDescription={materialsBlanketDescription}
        setMaterialsBlanketDescription={setMaterialsBlanketDescription}
        normalizePercentInput={normalizePercentInput}
        normalizedMarkupPct={normalizedMarkupPct}
        lockMarkupToGlobal={lockMarkupToGlobal}
        globalMarkupPct={globalDefaultMarkupPctNumber}
        animateMaterialsTotal={animateMaterialsTotal}
        materialsBilled={materialsBilled}
        materialItems={materialItems}
        materialLineTotalsById={materialLineTotalsById}
        updateMaterialItem={updateMaterialItem}
        removeMaterialItem={removeMaterialItem}
        showInternalCostFields={showInternalCostFields}
        lockInternalCostFields={lockInternalCostFields}
        newMaterialItemIds={newMaterialItemIds}
        itemizedMaterialsTotal={itemizedMaterialsTotal}
        addMaterialItem={addMaterialItem}
        trashIcon={<IconTrash />}
      />

      {/* TOTAL */}
      <section className="pe-section">
        <div className="pe-divider" style={styles.sectionHeaderDivider} />
        <div className="pe-total">
          <div>
            <div className="pe-total-label" style={styles.totalLabelWithIcon}>
              <span style={styles.sectionTitleIcon} aria-hidden="true"><IconTotals /></span>
              <span>{totalLabel}</span>
            </div>
            <div className="pe-total-meta">
              {lastSavedLabel ? `${totalTallyLine} • ${lastSavedLabel}` : totalTallyLine}
            </div>
          </div>
          <div className={`pe-total-right ${animateEstimateTotal ? "value-pulse" : ""}`}>
            {money.format(totalRevenue)}
          </div>
        </div>
      </section>

      {/* Additional Notes */}
      <section className="pe-card" style={styles.sectionBlock}>
        <div className="pe-divider" style={styles.sectionHeaderDivider} />
        <SectionTitleWithIcon icon={<IconSpecialConditions />} title="Additional Notes" styles={styles} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {ADDITIONAL_NOTES_SNIPPETS.map((s) => (
            <button
              key={s.key}
              className="pe-btn pe-btn-ghost"
              type="button"
              onClick={() => {
                const existing = state.additionalNotes || "";
                const sep = existing.trim().length > 0 ? "\n\n" : "";
                patch("additionalNotes", existing + sep + s.text);
              }}
            >
              {s.label}
            </button>
          ))}
          <button
            className="pe-btn pe-btn-ghost"
            type="button"
            onClick={() => patch("additionalNotes", "")}
          >
            Clear Notes
          </button>
        </div>
        <textarea
          ref={additionalNotesRef}
          className="pe-input pe-textarea"
          value={additionalNotes}
          onChange={(e) => {
            patch("additionalNotes", e.target.value);
            autoResizeScopeNotes(e.target);
          }}
          placeholder="Additional notes, terms, exclusions…"
          style={{ minHeight: SCOPE_NOTES_MIN_HEIGHT, resize: "none" }}
        />
      </section>

      </div>
        </div>
      </div>

      {savePrompt ? (
        <div style={{ ...styles.saveToastWrap, bottom: saveToastBottom }}>
          <div role="status" aria-live="polite" style={{ ...styles.saveToast, ...saveToastToneStyle }}>
            {String(savePrompt?.message || "Saved")}
          </div>
        </div>
      ) : null}

      <div style={{ ...styles.estimatorActionBar, bottom: actionBarBottom }}>
        <div ref={actionBarRef} style={styles.estimatorActionBarInner}>
          <div style={actionButtonsStyle} className="pe-estimator-sticky-actions">
            <button
              className="pe-btn pe-shortcut-tip"
              data-shortcut="Ctrl + S"
              type="button"
              onClick={onSaveNow}
              style={{
                ...styles.estimatorActionButton,
                transition: "box-shadow 180ms ease-out, border-color 180ms ease-out, transform 220ms ease-out",
                ...(saveNeedsAttention
                  ? {
                      borderColor: "rgba(74,222,128,0.5)",
                      boxShadow: "0 0 0 1px rgba(34,197,94,0.22), 0 0 16px rgba(34,197,94,0.22)",
                    }
                  : null),
                ...(savePulse ? { transform: "scale(1.02)" } : null),
              }}
            >
              {isEditMode ? (isInvoiceEditMode ? "Update Invoice" : "Update Estimate") : "Save Estimate"}
            </button>
            {isEditMode ? (
              <button className="pe-btn pe-btn-ghost" type="button" onClick={onCancelEdit} style={{ ...styles.estimatorActionButton, ...styles.estimatorActionButtonCompact }}>
                Cancel Edit
              </button>
            ) : null}
            {!isEditMode ? (
              <button className="pe-btn pe-btn-ghost pe-estimator-action-clear" type="button" onClick={onClearAll} style={styles.estimatorActionButton}>
                Clear
              </button>
            ) : null}
            <button className="pe-btn pe-estimator-action-export" type="button" onClick={onPdf} style={styles.estimatorActionButton}>
              Export PDF
            </button>
          </div>
        </div>
      </div>

      <PdfPromptModal
        open={pdfPromptOpen}
        docType={uiDocType}
        onClose={() => {
          triggerHaptic();
          setPdfPromptOpen(false);
        }}
        onView={() => {
          triggerHaptic();
          setPdfPromptOpen(false);
          exportPDF("view");
        }}
        onDownload={() => {
          triggerHaptic();
          setPdfPromptOpen(false);
          exportPDF("download");
        }}
        onShare={() => {
          triggerHaptic();
          setPdfPromptOpen(false);
          exportPDF("share");
        }}
      />

      <div className="pe-footer">Build: {BUILD_TAG}</div>
    </div>
  );
}

const styles = {
  builderModeSegmented: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: 3,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
    flexShrink: 0,
  },
  builderModeSegment: {
    minWidth: 118,
    borderRadius: 999,
    transition: "background 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease",
  },
  builderModeSegmentActive: {
    minWidth: 118,
    borderRadius: 999,
    background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.05))",
    borderColor: "rgba(34,197,94,0.34)",
    boxShadow: "0 0 0 1px rgba(34,197,94,0.16), 0 6px 16px rgba(0,0,0,0.25)",
    transform: "translateZ(0)",
    transition: "background 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease",
  },
  editHeaderStack: {
    minWidth: 0,
    flex: "1 1 auto",
    display: "grid",
    gap: 2,
  },
  editHeaderPrimary: {
    margin: 0,
    fontSize: "clamp(18px, 3.5vw, 27px)",
    letterSpacing: "0.09em",
    textTransform: "uppercase",
    lineHeight: 1.04,
  },
  editHeaderSecondary: {
    fontSize: 16,
    fontWeight: 900,
    letterSpacing: "0.03em",
    color: "rgba(226,236,244,0.94)",
  },
  editHeaderMeta: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.02em",
    color: "rgba(196,212,224,0.78)",
  },
  editModeBadge: {
    flexShrink: 0,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
    padding: "6px 10px",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.92)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
  },
  sectionBlock: {},
  totalsBlockWrap: { maxWidth: 720, margin: "14px auto 0" },
  jobInfoStack: { display: "grid", gap: 10, marginTop: 10 },
  jobInfoContentWrap: { maxWidth: 980, width: "100%", margin: "0 auto" },
  jobInfoAddressWrap: { display: "grid", gap: 10, marginTop: 10 },
  sectionHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 },
  sectionHeaderControls: { display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto" },
  sectionDividerWrap: { maxWidth: 720, margin: "0 auto" },
  fieldStack: { display: "grid", gap: 4 },
  cardShell: {
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.12)",
  },
  specialConditionsCardShell: {
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.12)",
    marginTop: 6,
  },
  specialConditionsField: { display: "grid", gap: 4 },
  specialConditionsCompactInput: {
    width: "100%",
    textAlign: "center",
    paddingRight: 26,
  },
  specialConditionsPercentWrap: {
    position: "relative",
    width: "100%",
  },
  specialConditionsPercentSuffix: {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: 12,
    fontWeight: 900,
    color: "rgba(229,238,245,0.86)",
    lineHeight: 1,
    pointerEvents: "none",
  },
  specialConditionsHelper: {
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.2,
    marginBottom: 2,
  },
  laborCollapsedRow: { maxWidth: 720, margin: "0 auto", padding: "2px 4px 0" },
  laborCollapsedHeader: { display: "grid", gridTemplateColumns: "auto auto 1fr auto", alignItems: "center", gap: 12, marginBottom: 10 },
  laborCollapsedTitleStack: { display: "inline-grid", gap: 6, marginBottom: 0 },
  laborPlayToggle: {
    width: 26,
    height: 26,
    minWidth: 26,
    minHeight: 26,
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 8,
    background: "transparent",
    color: "rgba(229,238,245,0.9)",
    padding: 0,
    lineHeight: 1,
    fontSize: 12,
    cursor: "pointer",
  },
  laborCollapsedMeta: {
    fontSize: 14,
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  laborCollapsedBaseRow: { marginTop: 10 },
  laborCollapsedBaseValue: { fontSize: 20, fontWeight: 900, color: "rgba(241,245,249,0.96)" },
  laborCollapseWrap: {
    "--collapse-max": "5200px",
    willChange: "max-height, opacity, transform",
  },
  specialConditionsCollapseWrap: {
    "--collapse-max": "1800px",
    willChange: "max-height, opacity, transform",
  },
  materialsItemizedCollapseWrap: {
    "--collapse-max": "5200px",
    willChange: "max-height, opacity, transform",
  },
  notesCollapseWrap: {
    "--collapse-max": "2200px",
    willChange: "max-height, opacity, transform",
  },
  notesCollapsedPreviewWrap: {
    "--collapse-max": "180px",
    willChange: "max-height, opacity, transform",
  },
  laborLineFieldStack: { display: "grid", gap: 4 },
  laborLineGrid: { gap: 10 },
  laborLineOptional: { marginLeft: 6, fontSize: "inherit", fontWeight: "inherit", lineHeight: "inherit", letterSpacing: "normal", textTransform: "none", opacity: 0.74 },
  laborLineActions: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 },
  laborQtyLabel: { minWidth: 54 },
  laborLineTotalWrap: { marginLeft: "auto", display: "inline-flex", gap: 8, alignItems: "center" },
  laborLineTotalLabel: { color: "var(--muted)", fontSize: 13, fontWeight: 800 },
  laborLineTotalValue: { color: "var(--text)", fontSize: 14, fontWeight: 900 },
  laborLineActionButtons: { display: "inline-flex", gap: 8, alignItems: "center" },
  lineDeleteBtn: {
    width: 36,
    height: 36,
    minWidth: 36,
    minHeight: 36,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    padding: 0,
    fontSize: 22,
    lineHeight: 1,
    alignSelf: "end",
  },
  lineAddBtn: {
    width: 36,
    height: 36,
    minWidth: 36,
    minHeight: 36,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    padding: 0,
    fontSize: 24,
    lineHeight: 1,
    alignSelf: "end",
  },
  lineTrashBtn: {
    width: 36,
    height: 36,
    minWidth: 36,
    minHeight: 36,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    padding: 0,
    fontSize: 14,
    lineHeight: 1,
    alignSelf: "end",
  },
  laborBaseRow: { marginTop: 10 },
  laborBottomActions: {
    position: "sticky",
    bottom: 0,
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    background: "linear-gradient(180deg, rgba(11,15,20,0) 0%, rgba(11,15,20,0.46) 45%, rgba(11,15,20,0.72) 100%)",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
  },
  laborHeaderToggleBtn: { width: 36, minWidth: 36, height: 36, padding: 0, display: "grid", placeItems: "center", lineHeight: 1, fontSize: 14 },
  laborCornerWrap: { display: "flex", justifyContent: "flex-end", marginTop: 8 },
  laborCornerToggle: {
    width: 26,
    height: 26,
    minWidth: 26,
    minHeight: 26,
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 8,
    background: "transparent",
    color: "rgba(229,238,245,0.9)",
    padding: 0,
    lineHeight: 1,
    fontSize: 14,
    cursor: "pointer",
  },
  sectionTitleStack: {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
    width: "fit-content",
    marginBottom: 8,
  },
  sectionTitleWithIcon: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  sectionTitleIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.68,
    transform: "translateY(1px)",
  },
  sectionHeaderDivider: {
    margin: "0 0 8px",
  },
  sectionTitleText: {
    marginBottom: 0,
    fontSize: 17,
    fontWeight: 950,
    letterSpacing: "0.15em",
    lineHeight: 1.04,
    textTransform: "uppercase",
    color: "rgba(236,242,250,0.96)",
    textShadow: "0 1px 4px rgba(0,0,0,0.32), 0 6px 14px rgba(0,0,0,0.2)",
  },
  sectionAccentLine: {
    width: "100%",
    height: 3,
    background: "linear-gradient(90deg, rgba(34,197,94,0.78) 0%, rgba(59,130,246,0.74) 100%)",
    clipPath: "polygon(2% 0, 100% 0, 98% 100%, 0 100%)",
    filter: "drop-shadow(0 0 2px rgba(34,197,94,0.16))",
  },
  totalAccentLine: {
    width: 74,
    height: 2,
    borderRadius: 999,
    marginTop: 4,
    marginBottom: 4,
    background: "linear-gradient(90deg, rgba(34,197,94,0.75) 0%, rgba(59,130,246,0.72) 100%)",
  },
  grid2: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 10 },
  grid3: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 10 },
  label: { display: "block", fontSize: 12.5, fontWeight: 800, letterSpacing: "0.2px", textTransform: "none", opacity: 0.82, marginBottom: 6 },
  small: { fontSize: 12, fontWeight: 800, letterSpacing: "0.6px", opacity: 0.78, textTransform: "uppercase" },
  scopeHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 },
  scopeClearBtn: { padding: "8px 12px", minHeight: 36 },
  scopeCollapseRow: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  scopeCollapseBtn: { padding: "6px 10px", minHeight: 32 },
  scopeCollapsedPreview: { marginTop: 2, marginBottom: 4, fontSize: 13, lineHeight: 1.35, opacity: 0.9 },
  projectLocationToggleRow: { marginTop: 2 },
  projectLocationToggleLabel: { display: "inline-flex", gap: 10, alignItems: "center", fontSize: 13.5, color: "rgba(229,238,245,0.90)", cursor: "pointer" },
  totalCardHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  totalLabelWithIcon: { display: "inline-flex", alignItems: "center", gap: 8 },
  totalCardTally: { fontSize: 13.5, fontWeight: 800, color: "rgba(203,213,225,0.92)" },
  totalBreakdown: { display: "grid", gap: 8 },
  totalBreakdownRow: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" },
  totalBreakdownLabel: { fontSize: 13, fontWeight: 800, color: "rgba(203,213,225,0.92)" },
  totalBreakdownValue: { fontSize: 13, fontWeight: 900, color: "rgba(241,245,249,0.96)" },
  totalFinalRow: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.10)" },
  totalFinalLabel: { fontSize: 14, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(229,231,235,0.95)" },
  totalFinalValue: { fontSize: 28, fontWeight: 950, lineHeight: 1.05, color: "rgba(220,252,231,0.96)" },
  row: { display: "grid", gap: 10, padding: 10 },
  rowCols: { display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 },
  rowColsMat: {
    display: "grid",
    gap: 10,
    alignItems: "end",
    gridTemplateColumns: "2.2fr 0.7fr 0.9fr 1fr 1fr",
  },
  rowActions: {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 10,
  },
  field: {
    display: "grid",
    gap: 6,
    minWidth: 0,
  },
  dropdownPortal: {
    position: "fixed",
    zIndex: 1000,
    maxHeight: 280,
    overflowY: "auto",
    margin: 0,
    maxWidth: "none",
    padding: 0,
    borderRadius: 14,
    background: "rgba(15, 23, 42, 0.55)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
    fontFamily: "inherit",
    fontSize: 16,
    lineHeight: 1.2,
  },
  dropdownOption: {
    padding: "12px 12px",
    cursor: "pointer",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    color: "var(--text)",
    background: "transparent",
    fontFamily: "inherit",
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: "normal",
    lineHeight: 1.2,
  },
  dropdownCreateOption: {},
  dropdownOptionHover: { background: "rgba(255,255,255,0.10)" },
  dropdownOptionSelected: { background: "rgba(255,255,255,0.14)", borderBottom: "1px solid rgba(255,255,255,0.12)" },
  dropdownEmpty: {
    padding: "12px 12px",
    color: "rgba(156,163,175,0.90)",
    fontFamily: "inherit",
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 1.2,
  },
  saveToastWrap: {
    position: "fixed",
    left: 0,
    right: 0,
    zIndex: 1000,
    pointerEvents: "none",
    display: "flex",
    justifyContent: "center",
    padding: "0 14px",
  },
  saveToast: {
    width: "100%",
    maxWidth: 980,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(16, 24, 40, 0.88)",
    color: "rgba(241,245,249,0.98)",
    boxShadow: "0 14px 30px rgba(0,0,0,0.32)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    padding: "10px 12px",
    textAlign: "center",
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  saveToastSuccess: {
    borderColor: "rgba(34,197,94,0.42)",
    background: "linear-gradient(180deg, rgba(22,101,52,0.5), rgba(16,24,40,0.9))",
  },
  saveToastWarn: {
    borderColor: "rgba(245,158,11,0.5)",
    background: "linear-gradient(180deg, rgba(133,77,14,0.54), rgba(16,24,40,0.9))",
  },
  saveToastError: {
    borderColor: "rgba(239,68,68,0.54)",
    background: "linear-gradient(180deg, rgba(127,29,29,0.6), rgba(16,24,40,0.92))",
  },
  estimatorActionBar: {
    position: "fixed",
    left: 0,
    right: 0,
    zIndex: 999,
    pointerEvents: "none",
    background: "transparent",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxShadow: "none",
    border: "none",
    padding: "0 14px",
  },
  estimatorActionBarInner: {
    width: "100%",
    maxWidth: "none",
    margin: "0 auto",
    pointerEvents: "auto",
    background: "var(--pe-shell-surface, rgba(0,0,0,0.18))",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    border: "1px solid var(--pe-shell-border, rgba(255,255,255,0.10))",
    boxShadow: "0 10px 22px var(--pe-shell-shadow, rgba(0,0,0,0.22))",
    borderRadius: 18,
    padding: 10,
  },
  estimatorActionButtons: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 },
  estimatorActionButtonsEdit: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 },
  estimatorActionButton: { width: "100%" },
  estimatorActionButtonCompact: {
    fontSize: 13,
    paddingLeft: 10,
    paddingRight: 10,
    whiteSpace: "nowrap",
  },
  dueHint: { marginTop: 6, fontSize: 12, color: "rgba(156,163,175,0.9)" },
  selectedCustomerText: { marginTop: 8, fontSize: 13, color: "rgba(233,241,248,0.86)" },
  customerProfilePanel: {
    marginTop: 10,
    borderRadius: 18,
    border: "1px solid var(--line)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
    padding: 14,
    boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
    fontFamily: "inherit",
  },
  customerProfileTitle: { fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.84, marginBottom: 10 },
  customerProfileGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 },
  customerProfileItem: { display: "grid", gap: 3 },
  customerProfileItemFull: { gridColumn: "1 / -1" },
  customerProfileLabel: { fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.66 },
  customerProfileValue: { fontSize: 13.5, lineHeight: 1.35, color: "rgba(245,250,255,0.94)", whiteSpace: "pre-line" },
};
