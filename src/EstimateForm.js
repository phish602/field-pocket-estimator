// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { calculateEstimateWithLaborLines } from "./estimate";
import "./EstimateForm.css";



const POP_CSS = `
/* ===== Field Pocket Estimator – “A + C” polish pack (DARK-SAFE) =====
   Goal: add depth + pop WITHOUT changing your app's base theme colors.
   This file should NOT force a white background.
*/



/* iOS light/dark form controls hint */
:root[data-pe-theme="light"]{ color-scheme: light; }
:root[data-pe-theme="dark"]{ color-scheme: dark; }

/* Header: glassy dark panel + subtle blueprint grid */
.pe-header{
  position: sticky;
  top: 0;
  z-index: 10;
  border-radius: 16px;
  padding: 14px 14px 12px;
  background:
    linear-gradient(180deg, rgba(10,12,16,0.72), rgba(10,12,16,0.55)),
    linear-gradient(rgba(110, 200, 255, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(110, 200, 255, 0.06) 1px, transparent 1px);
  background-size: auto, 22px 22px, 22px 22px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.10);
  box-shadow:
    0 10px 26px rgba(0,0,0,0.40),
    0 2px 6px rgba(0,0,0,0.25);
  overflow: hidden;
}

/* Blueprint corner brackets */
.pe-header::before,
.pe-header::after{
  content:"";
  position:absolute;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(110, 200, 255, 0.22);
  border-radius: 6px;
  pointer-events:none;
}
.pe-header::before{ left: 10px; top: 10px; border-right:none; border-bottom:none; }
.pe-header::after{ right: 10px; top: 10px; border-left:none; border-bottom:none; }

/* Title: weight + underline sweep (one-time) */
.pe-header .pe-title{
  letter-spacing: 0.25px;
  position: relative;
  display: inline-block;
}


/* Subtitle “Fast numbers. No fluff.” */
.pe-subtitle{
  text-transform: uppercase;
  letter-spacing: 0.9px;
  font-weight: 800;
  opacity: 0.82;
}

/* Cards / sections: add depth without changing existing background color */
.pe-card{
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.10);
  box-shadow: 0 10px 28px rgba(0,0,0,0.35);
  transition: transform 160ms ease, box-shadow 160ms ease;
}
@media (hover:hover){
  .pe-card:hover{
    transform: translateY(-1px);
    box-shadow: 0 14px 34px rgba(0,0,0,0.42);
  }
}

/* Inputs: slight inset highlight (no background override) */
.pe-input{
  border-radius: 12px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.10);
}

/* Buttons: press recoil + clearer separation */
.pe-btn{
  border-radius: 12px;
  transition: transform 80ms ease, filter 120ms ease, box-shadow 120ms ease;
  box-shadow: 0 6px 14px rgba(0,0,0,0.35);
}
.pe-btn-ghost{
  box-shadow: 0 4px 10px rgba(0,0,0,0.28);
}
.pe-btn:active{
  transform: scale(0.97);
  filter: brightness(0.98);
}
@media (hover:hover){
  .pe-btn:hover{ filter: brightness(1.02); }
}



/* Section titles: crisp underline + spacing */
.pe-section-title{
  font-weight: 900;
  letter-spacing: 0.2px;
  position: relative;
  padding-bottom: 6px;
}
.pe-section-title::after{
  content:"";
  position:absolute;
  left:0;
  bottom:0;
  width: 56px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(34,197,94,0.55), rgba(59,130,246,0.45));
  opacity: 0.65;
}

/* Dividers: softer, more premium */
.pe-divider{
  height: 1px;
  border: none;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent);
  margin: 14px 0;
  opacity: 0.8;
}

/* Tiny polish */
.pe-muted{ opacity: 0.78; }
.pe-card{ backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }

/* Saved Estimates collapsible content */
.pe-collapsible-summary{
  font-size: 12px;
  opacity: 0.78;
  margin-top: 2px;
}

/* ================================
   Page Perimeter Snake (Single-Line, Ultra-Stealth)
================================ */
.pe-page-snake{
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}

/* Single moving segment: flat “hospital” line */
.pe-page-snake .pe-snake-line{
  fill: none;
  stroke-width: 2.3;
  stroke-linejoin: miter;
  stroke-linecap: butt;
  stroke: url(#peSnakeGradient);
  opacity: 0.14;              /* ultra stealth */
  stroke-dasharray: 88 912;   /* visible segment + remainder (pathLength=1000) */
  stroke-dashoffset: 0;
  animation: peSnakeMove 9s linear infinite;
}

@keyframes peSnakeMove{
  to{ stroke-dashoffset: -1000; }
}
`;
function PopStyles(){ return <style>{POP_CSS}</style>; }

function PagePerimeterSnake(){
  return (
    <svg
      className="pe-page-snake"
      width="100%"
      height="100%"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="peSnakeGradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1000" y2="0">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="1" />
          <stop offset="50%" stopColor="#3b82f6" stopOpacity="1" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Perimeter path (square corners = “hospital line” feel) */}
      <path id="peSnakePath" d="M12 12 H988 V988 H12 Z" fill="none" />

      {/* Moving segment */}
      <path
        className="pe-snake-line"
        d="M12 12 H988 V988 H12 Z"
        pathLength="1000"
      />
</svg>
  );
}


const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/* =========================
   LANGUAGE / I18N (MANUAL TOGGLE)
   ========================= */
const LANG_KEY = "field-pocket-lang";
/* =========================
   UI COLLAPSE STATE (PERSISTED)
   Default: collapsed (false)
   ========================= */
const UI_STATE_KEY = "fpe-ui";
function uiLoadBool(key, fallback = false) {
  try {
    const v = localStorage.getItem(`${UI_STATE_KEY}:${key}`);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    // ignore
  }
  return fallback;
}
function uiSaveBool(key, value) {
  try {
    localStorage.setItem(`${UI_STATE_KEY}:${key}`, value ? "1" : "0");
  } catch {
    // ignore
  }
}

function uiLoadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(`${UI_STATE_KEY}:${key}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    // ignore
  }
  return fallback;
}
function uiSaveJson(key, value) {
  try {
    localStorage.setItem(`${UI_STATE_KEY}:${key}`, JSON.stringify(value ?? null));
  } catch {
    // ignore
  }
}


function detectDefaultLang() {
  try {
    const nav = String(navigator?.language || "").toLowerCase();
    if (nav.startsWith("es")) return "es";
  } catch (e) {
    // ignore
  }
  return "en";
}

function loadSavedLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "en" || v === "es") return v;
  } catch (e) {
    // ignore
  }
  return "";
}


function detectDefaultTheme() {
  try {
    const mq =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    if (mq && mq.matches) return "dark";
  } catch (e) {
    // ignore
  }
  return "light";
}

function loadSavedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "auto" || v === "light" || v === "dark") return v;
  } catch (e) {
    // ignore
  }
  return "auto";
}


function loadBool(key, fallback = false) {
  try {
    const v = localStorage.getItem(key);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch (e) {
    // ignore
  }
  return fallback;
}

function saveBool(key, value) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch (e) {
    // ignore
  }
}

function applyThemeToRoot(theme) {
  try {
    const root = document.documentElement;
    if (!root) return;
    const effective = theme === "auto" ? detectDefaultTheme() : theme;
    root.setAttribute("data-pe-theme", effective);
  } catch (e) {
    // ignore
  }
}



/* =========================
   COMPANY PROFILE (PERSISTENT)
   ========================= */
const PROFILE_KEY = "field-pocket-profile-v1";

const DEFAULT_PROFILE = {
  companyName: "",
  phone: "",
  email: "",
  address: "",
  logoDataUrl: "",
  roc: "",
  attn: "",
  website: "",
  ein: "",
  terms: "",
};

function loadSavedProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
        const rawLegacy = raw ? "" : localStorage.getItem(PROFILE_KEY_LEGACY);
    const rawUse = raw || rawLegacy;
if (!rawUse) return null;
    const parsed = JSON.parse(rawUse);
    if (!parsed || typeof parsed !== "object") return null;
    // Merge with defaults to survive schema changes
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch (e) {
    return null;
  }
}

function safeSaveProfile(nextProfile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
    return true;
  } catch (e) {
    // If storage is full (common when logo is too large), save text fields only.
    try {
      const { logoDataUrl, ...rest } = nextProfile || {};
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...rest, logoDataUrl: "" }));
      return false;
    } catch {
      return false;
    }
  }
}

const I18N = {
  en: {
    // header / general
    subtitleProfile: "Fast numbers. No fluff.",
    subtitleEstimator: "Create estimates + export PDF",
    language: "Language",
    english: "English",
    spanish: "Español",

    // ✅ NEW: language required gate
    chooseLanguageTitle: "Choose language to start",
    chooseLanguageBody: "Select English or Español to begin. This is saved for next time.",

    // ✅ NEW: warning when exporting English PDF from Spanish UI
    pdfEnglishFromSpanishWarn:
      "Heads up: Only selected templates/trade inserts are converted to English. Your custom Scope/Notes text stays as-is unless translation is configured (/api/translate or an OpenAI key).",


    // ✅ NEW: PDF export language + translation
    pdfExportLang: "PDF language",
    pdfExportLangAuto: "Auto (match UI)",
    pdfExportLangEnglish: "English PDF",
    pdfExportLangSpanish: "Spanish PDF",
    pdfTranslateCustom: "Translate my custom text (beta)",
    pdfTranslateCustomHelp:
      "Uses /api/translate to translate ONLY your custom text. Templates/trade inserts stay protected.",
    pdfTranslateUnavailable: "Translation unavailable. Configure /api/translate or set localStorage field-pocket-openai-key. Exporting without translating your custom text.",
    pdfTranslateFailedConfirm: "Couldn’t translate your custom text. Export anyway without translating it?",

    // ✅ NEW: doc type toggle
    docTypeLabel: "Document",
    // ✅ NEW: numbering hint
    numberIncrementHint: "Custom numbers must end with a digit so Generate can increment from the last digit.",


    // ✅ NEW: PDF labor detail
    pdfLaborItemizedToggle: "Itemize labor lines on PDF (advanced)",
    pdfLaborItemizedToggleHelp:
      "When off, the PDF shows labor as a single total line (recommended).",
    resetToOriginal: "Reset",

    estimate: "Estimate",
    invoice: "Invoice",
    estimateToInvoice: "Estimate / Invoice",
    invoiceTotal: "Invoice Total",

    // status pill
    companyComplete: "Company complete",
    companyIncomplete: "Company incomplete",
    requiredCompleteTitle: "Required company fields complete",
    requiredIncompleteTitle: "Fill all required company fields to enable PDF export",

    // buttons
    continueArrow: "Continue →",
    editCompany: "Edit Company",
    newClear: "New / Clear",
    save: "Save",
    pdf: "PDF",
    removeLogo: "Remove logo",
    clearScopeBox: "Clear Scope Box",
    addLabor: "+ Add labor",
    duplicate: "Duplicate",
    remove: "Remove",
    delete: "Delete",
    clearAll: "Clear All",
    clearNotes: "Clear Notes",

    // section titles
    companyProfileTitle: "Company Profile (for PDF)",
    requiredLabel: "Required (must be filled to export PDF)",
    optionalLabel: "Optional",
    jobInfo: "Job Info",
    labor: "Labor",
    specialConditions: "Special Conditions",
    materials: "Materials",
    additionalNotes: "Additional Notes",
    savedEstimates: "Saved Estimates",

    // placeholders
    companyNameReq: "Company name (required)",
    phoneReq: "Phone (required) 555-555-5555",
    emailReq: "Email (required)",
    addressReq: "Address (required)",
    rocOpt: "ROC # (optional)",
    attnOpt: "Attn / Contact (optional)",
    websiteOpt: "Website (optional)",
    einOpt: "EIN / Tax ID (optional)",
    termsOpt: "Default terms (optional) ex: Net 15",

    client: "Client",

    customerName: "Customer",
    customerAttn: "Attn (optional)",
    customerPhone: "Customer phone (optional)",
    customerEmail: "Customer email (optional)",
    customerAddress: "Customer address",
    billingDiff: "Billing address differs",
    billingAddress: "Billing address",
    projectName: "Project name",
    projectNumber: "Project #",
    projectAddress: "Project address",
    projectSameAsCustomer: "Same as customer address",
    recentCustomers: "Recent customers",
    recentEstimates: "Recent estimates",
    customerOrganizer: "Customer organizer",
    noCustomers: "No saved customers yet. Export a PDF to auto-save one.",
    scopePlaceholder: "Scope / notes (templates insert here)",
    selectRole: "Select role…",
    hours: "Hours",
    rate: "Rate",
    materialsCost: "Total material cost",
    markupPct: "Markup % (ex: 20)",
    hazardPct: "Hazard / risk % of LABOR (ex: 30)",
    customMultiplier: "Custom labor multiplier (ex: 1.18)",
    notesPlaceholder: "Type any additional notes here… (the + buttons will append too)",

    // ✅ NEW: materials mode + itemized UI
    materialsMode: "Materials mode",
    materialsModeBlanket: "Blanket materials",
    materialsModeItemized: "Itemized materials",
    materialsItemizedHelp:
      "Use itemized materials when you need to line-item critical material. Qty × price totals into the estimate.",
    addMaterialItem: "+ Add material item",
    materialDesc: "Description",
    materialQty: "Qty",
    materialCostInternal: "Cost (internal)",
    materialCharge: "Price (each)",
    materialsItemizedTotal: "Itemized materials total",

    // misc UI text
    savedAuto: "Saved automatically. PDF export requires all required fields complete.",
    pdfRequiresAll: "PDF export requires all required fields complete.",
    printsSmall: "These print on the PDF as small text (not a table).",
    noSaved: "No saved estimates.",

    // multiplier options
    standard: "Standard (1.00×)",
    difficultAccess: "Difficult access (1.10×)",
    highRisk: "High-risk / PPE (1.20×)",
    offHours: "Off-hours / Night (1.25×)",
    customEllipsis: "Custom…",

    // totals meta
    estimateTotal: "Estimate Total",
    laborLines: "labor line(s)",
    laborers: "laborer(s)",
    complexity: "× complexity",
    risk: "% risk",
    materialsMeta: "% materials",

    // confirmations / alerts
    companyProfileIncompleteTitle: "Company Profile Incomplete",
    companyProfileIncompleteBody:
      "To proceed to the estimator, please complete ALL required fields:\n" +
      "• Company name\n" +
      "• Phone\n" +
      "• Email\n" +
      "• Address",

    pdfCompanyIncompleteConfirm:
      "Company info incomplete.\n\nPDF export requires ALL required fields:\n- Company name\n- Phone\n- Email\n- Address\n\nGo to Company Profile now?",

    deleteSavedConfirm: "Delete this saved estimate?",
    deleteAllSavedConfirm: "Delete ALL saved estimates?",

    templateAlreadyAdded:
      "That master template text already appears in your scope box.\n\nAdd it again anyway?",
    tradeAlreadyAdded:
      "That trade insert already appears in your scope box.\n\nAdd it again anyway?",

    warnMultipleTemplates: (kind, countAlready) =>
      `${kind} already added.\n\n` +
      `You currently have ${countAlready} ${kind.toLowerCase()} block(s) in your scope box.\n` +
      `Adding more can make the scope messy and harder to read.\n\n` +
      `Add anyway?`,

    noteAlreadyAdded: "That note already appears in Additional Notes.\n\nAdd it again anyway?",

    // ✅ NEW: export language prompt (used when UI is Spanish)
    pdfExportLanguageConfirm:
      "Export PDF language:\n\nOK = Spanish (Español)\nCancel = English (for English customers)",

    // PDF translations
    pdfJobInfoHead: "Job Info",
    pdfTotalsHead: "Totals",
    pdfDate: "Date",
    pdfAttn: "Attn",
    pdfClientAttn: "Attn (Client)",
    pdfClient: "Client",
    pdfLocation: "Location",
    pdfProjectName: "Project",
    pdfProjectNumber: "Project #",
    pdfProjectAddress: "Project address",
    pdfPO: "PO#",
    pdfDue: "Due",
    pdfScope: "Scope / Notes",
    pdfTradeInserts: "Trade Insert(s)",
    pdfLabor: "Labor",
    pdfMaterials: "Materials",
    pdfMaterialsItemized: "Materials (Itemized)",
    pdfTotal: "TOTAL",
    pdfHazard: (pct) => `Hazard / risk (${pct}%)`,
    pdfAdditionalNotes: "Additional Notes:",
    pdfAdditionalNotesCont: "Additional Notes (continued):",
    pdfFooter: "Notes: Pricing subject to site conditions. Materials and labor based on inputs above.",

    // ✅ NEW: doc titles in PDF header
    pdfDocEstimate: "ESTIMATE",
    pdfDocInvoice: "INVOICE",
  },

  es: {
    // header / general
    subtitleProfile: "Números rápidos. Sin relleno.",
    subtitleEstimator: "Crea estimados + exporta PDF",
    language: "Idioma",
    english: "English",
    spanish: "Español",

    // ✅ NEW: idioma requerido
    chooseLanguageTitle: "Elige idioma para comenzar",
    chooseLanguageBody: "Selecciona English o Español para iniciar. Se guarda para la próxima vez.",

    // ✅ NEW: aviso al exportar PDF en inglés desde interfaz en español
    pdfEnglishFromSpanishWarn:
      "Aviso: Solo las plantillas/insertos seleccionados se convierten al inglés. Tu texto personalizado de Alcance/Notas se queda como está a menos que configures traducción (/api/translate o una key de OpenAI).",


    // ✅ NEW: PDF export language + translation
    pdfExportLang: "Idioma del PDF",
    pdfExportLangAuto: "Auto (igual que la app)",
    pdfExportLangEnglish: "PDF en inglés",
    pdfExportLangSpanish: "PDF en español",
    pdfTranslateCustom: "Traducir mi texto (beta)",
    pdfTranslateCustomHelp:
      "Usa /api/translate para traducir SOLO tu texto. Plantillas/insertos se protegen.",
    pdfTranslateUnavailable: "Traducción no disponible. Configura /api/translate o guarda en localStorage field-pocket-openai-key. Se exporta sin traducir tu texto.",
    pdfTranslateFailedConfirm: "No se pudo traducir tu texto. ¿Exportar de todos modos sin traducirlo?",

    // ✅ NEW: doc type toggle
    docTypeLabel: "Documento",
    // ✅ NEW: aviso de numeración
    numberIncrementHint: "Los números personalizados deben terminar en un dígito para que Generar incremente desde el último dígito.",
    pdfLaborItemizedToggle: "Desglosar mano de obra en PDF (avanzado)",
    pdfLaborItemizedToggleHelp: "Cuando está apagado, el PDF muestra mano de obra como una sola línea total (recomendado).",
    resetToOriginal: "Restablecer",

    estimate: "Estimación",
    invoice: "Factura",
    estimateToInvoice: "Estimación / Factura",
    invoiceTotal: "Total de factura",

    // status pill
    companyComplete: "Empresa completa",
    companyIncomplete: "Empresa incompleta",
    requiredCompleteTitle: "Campos requeridos completos",
    requiredIncompleteTitle: "Complete todos los campos requeridos para habilitar el PDF",

    // buttons
    continueArrow: "Continuar →",
    editCompany: "Editar empresa",
    newClear: "Nuevo / Limpiar",
    save: "Guardar",
    pdf: "PDF",
    removeLogo: "Quitar logo",
    clearScopeBox: "Limpiar alcance",
    addLabor: "+ Agregar mano de obra",
    duplicate: "Duplicar",
    remove: "Quitar",
    delete: "Eliminar",
    clearAll: "Borrar todo",
    clearNotes: "Borrar notas",

    // section titles
    companyProfileTitle: "Perfil de empresa (para PDF)",
    requiredLabel: "Requerido (debe llenarse para exportar PDF)",
    optionalLabel: "Opcional",
    jobInfo: "Información del trabajo",
    labor: "Mano de obra",
    specialConditions: "Condiciones especiales",
    materials: "Materiales",
    additionalNotes: "Notas adicionales",
    savedEstimates: "Estimaciones guardadas",

    // placeholders
    companyNameReq: "Nombre de empresa (requerido)",
    phoneReq: "Teléfono (requerido) 555-555-5555",
    emailReq: "Correo (requerido)",
    addressReq: "Dirección (requerido)",
    rocOpt: "ROC # (opcional)",
    attnOpt: "Atn. / Contacto (opcional)",
    websiteOpt: "Sitio web (opcional)",
    einOpt: "EIN / ID fiscal (opcional)",
    termsOpt: "Términos (opcional) ej: Net 15",

    client: "Cliente",

    customerName: "Cliente",
    customerAttn: "Atn. (opcional)",
    customerPhone: "Teléfono (opcional)",
    customerEmail: "Correo (opcional)",
    customerAddress: "Dirección del cliente",
    billingDiff: "La dirección de facturación es diferente",
    billingAddress: "Dirección de facturación",
    projectName: "Nombre del proyecto",
    projectNumber: "Proyecto #",
    projectAddress: "Dirección del proyecto",
    projectSameAsCustomer: "Igual que la dirección del cliente",
    recentCustomers: "Clientes recientes",
    recentEstimates: "Estimaciones recientes",
    customerOrganizer: "Organizador de clientes",
    noCustomers: "Aún no hay clientes guardados. Exporta un PDF para guardarlo automáticamente.",
    scopePlaceholder: "Alcance / notas (las plantillas se insertan aquí)",
    selectRole: "Seleccionar rol…",
    hours: "Horas",
    rate: "Tarifa",
    materialsCost: "Costo total de materiales",
    markupPct: "Margen % (ej: 20)",
    hazardPct: "Riesgo % de MANO DE OBRA (ej: 30)",
    customMultiplier: "Multiplicador personalizado (ej: 1.18)",
    notesPlaceholder: "Escribe notas adicionales aquí… (los + se agregan abajo)",

    // ✅ NEW: materials mode + itemized UI
    materialsMode: "Modo de materiales",
    materialsModeBlanket: "Materiales globales",
    materialsModeItemized: "Materiales por partida",
    materialsItemizedHelp:
      "Usa materiales por partida cuando necesites detallar material crítico. Cant. × cargo suma al total.",
    addMaterialItem: "+ Agregar material",
    materialDesc: "Descripción",
    materialQty: "Cant.",
    materialCostInternal: "Costo (interno)",
    materialCharge: "Precio (c/u)",
    materialsItemizedTotal: "Total de materiales por partida",

    // misc UI text
    savedAuto: "Se guarda automáticamente. Para PDF se requieren todos los campos obligatorios.",
    pdfRequiresAll: "Para PDF se requieren todos los campos obligatorios.",
    printsSmall: "Estas se imprimen en el PDF como texto pequeño (no tabla).",
    noSaved: "No hay estimaciones guardadas.",

    // multiplier options
    standard: "Estándar (1.00×)",
    difficultAccess: "Acceso difícil (1.10×)",
    highRisk: "Alto riesgo / PPE (1.20×)",
    offHours: "Fuera de horario / Noche (1.25×)",
    customEllipsis: "Personalizado…",

    // totals meta
    estimateTotal: "Total estimado",
    laborLines: "línea(s) de mano de obra",
    laborers: "trabajador(es)",
    complexity: "× complejidad",
    risk: "% riesgo",
    materialsMeta: "% materiales",

    // confirmations / alerts
    companyProfileIncompleteTitle: "Perfil de empresa incompleto",
    companyProfileIncompleteBody:
      "Para continuar al estimador, complete TODOS los campos requeridos:\n" +
      "• Nombre de empresa\n" +
      "• Teléfono\n" +
      "• Correo\n" +
      "• Dirección",

    pdfCompanyIncompleteConfirm:
      "Información de empresa incompleta.\n\nPara exportar PDF se requieren TODOS los campos:\n- Nombre de empresa\n- Teléfono\n- Correo\n- Dirección\n\n¿Ir al Perfil de empresa ahora?",

    deleteSavedConfirm: "¿Eliminar esta estimación guardada?",
    deleteAllSavedConfirm: "¿Eliminar TODAS las estimaciones guardadas?",

    templateAlreadyAdded:
      "Ese texto de plantilla maestra ya aparece en el cuadro de alcance.\n\n¿Agregarla otra vez?",
    tradeAlreadyAdded:
      "Ese inserto de oficio ya aparece en el cuadro de alcance.\n\n¿Agregarlo otra vez?",

    warnMultipleTemplates: (kind, countAlready) =>
      `${kind} ya agregado.\n\n` +
      `Actualmente tienes ${countAlready} bloque(s) de ${kind.toLowerCase()} en el cuadro de alcance.\n` +
      `Agregar más puede hacerlo confuso y difícil de leer.\n\n` +
      `¿Agregar de todos modos?`,

    noteAlreadyAdded: "Esa nota ya aparece en Notas adicionales.\n\n¿Agregarla otra vez?",

    // ✅ NEW: export language prompt (shown to Spanish UI users)
    pdfExportLanguageConfirm:
      "Idioma de exportación del PDF:\n\nOK = Español\nCancelar = English (para clientes en inglés)",

    // PDF translations
    pdfJobInfoHead: "Información del Trabajo",
    pdfTotalsHead: "Totales",
    pdfDate: "Fecha",
    pdfAttn: "Atn.",
    pdfClientAttn: "Atn. (Cliente)",
    pdfClient: "Cliente",
    pdfLocation: "Ubicación",
    pdfProjectName: "Proyecto",
    pdfProjectNumber: "Proyecto #",
    pdfProjectAddress: "Dirección del proyecto",
    pdfPO: "PO#",
    pdfDue: "Vence",
    pdfScope: "Alcance / Notas",
    pdfTradeInserts: "Insertos",
    pdfLabor: "Mano de Obra",
    pdfMaterials: "Materiales",
    pdfMaterialsItemized: "Materiales (Partidas)",
    pdfTotal: "TOTAL",
    pdfHazard: (pct) => `Riesgo (${pct}%)`,
    pdfAdditionalNotes: "Notas Adicionales:",
    pdfAdditionalNotesCont: "Notas Adicionales (continuación):",
    pdfFooter:
      "Notas: Precios sujetos a condiciones del sitio. Materiales y mano de obra basados en los datos ingresados.",

    // ✅ NEW: doc titles in PDF header
    pdfDocEstimate: "ESTIMACIÓN",
    pdfDocInvoice: "FACTURA",
  },
};

function triggerHaptic() {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(10);
    }
  } catch (e) {
    // ignore
  }
}


/* =========================
   ✅ RESIZABLE TEXTAREA (TOUCH + DRAG HANDLE)
   ========================= */
function ResizableTextarea({
  value,
  onChange,
  placeholder,
  minHeight = 160,
  height,
  setHeight,
  className = "pe-input pe-textarea",
  style = {},
}) {
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHRef = useRef(0);

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;

      const clientY =
        (e.touches && e.touches[0] && e.touches[0].clientY) ||
        (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientY) ||
        e.clientY ||
        0;

      const dy = clientY - startYRef.current;
      const next = Math.max(minHeight, Math.min(1200, startHRef.current + dy));
      setHeight(next);

      if (e.cancelable) e.preventDefault();
    };

    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
    };

    window.addEventListener("mousemove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp, { passive: true });
    window.addEventListener("touchcancel", onUp, { passive: true });

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
  }, [minHeight, setHeight]);

  const startDrag = (e) => {
    triggerHaptic();

    const clientY =
      (e.touches && e.touches[0] && e.touches[0].clientY) ||
      (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientY) ||
      e.clientY ||
      0;

    draggingRef.current = true;
    startYRef.current = clientY;
    startHRef.current = Number(height) || minHeight;

    if (e.cancelable) e.preventDefault();
    e.stopPropagation?.();
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <textarea
        className={className}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{
          ...style,
          height: Math.max(minHeight, Number(height) || minHeight),
          minHeight,
          resize: "none",
        }}
      />

      <div
        role="button"
        tabIndex={0}
        aria-label="Resize"
        onMouseDown={startDrag}
        onTouchStart={startDrag}
        style={{
          position: "absolute",
          right: 10,
          bottom: 10,
          width: 22,
          height: 22,
          borderRadius: 6,
          border: "1px solid rgba(0,0,0,0.18)",
          background: "rgba(255,255,255,0.85)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "ns-resize",
          userSelect: "none",
          touchAction: "none",
        }}
        title="Drag to resize"
      >
        <span
          aria-hidden="true"
          style={{
            fontSize: 14,
            lineHeight: 1,
            opacity: 0.6,
            transform: "rotate(90deg)",
          }}
        >
          ⋮
        </span>
      </div>
    </div>
  );
}


/* =========================
   FIELD CALCULATOR (CM ↔ IN, FRACTIONS, BASIC OPS, VOICE)
   ========================= */

function _gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

function _toMixedFraction(value, denomMax = 64) {
  if (!Number.isFinite(value)) return { whole: 0, num: 0, den: 1 };
  const sign = value < 0 ? -1 : 1;
  const v = Math.abs(value);

  const whole = Math.floor(v);
  const frac = v - whole;

  if (frac < 1e-8) return { whole: whole * sign, num: 0, den: 1 };

  // find best rational approx with limited denominator
  let bestNum = 0, bestDen = 1, bestErr = Infinity;
  for (let den = 2; den <= denomMax; den++) {
    const num = Math.round(frac * den);
    const err = Math.abs(frac - num / den);
    if (err < bestErr) {
      bestErr = err;
      bestNum = num;
      bestDen = den;
    }
    if (bestErr < 1e-6) break;
  }

  // simplify
  const g = _gcd(bestNum, bestDen);
  bestNum = Math.floor(bestNum / g);
  bestDen = Math.floor(bestDen / g);

  // handle carry
  if (bestNum >= bestDen) {
    return { whole: (whole + 1) * sign, num: 0, den: 1 };
  }

  return { whole: whole * sign, num: bestNum, den: bestDen };
}

function _formatMixed({ whole, num, den }) {
  const sign = whole < 0 ? "-" : "";
  const w = Math.abs(whole);
  if (!num) return sign + String(w);
  if (!w) return sign + `${num}/${den}`;
  return sign + `${w} ${num}/${den}`;
}

function _parseMixedFraction(str) {
  const s = String(str || "").trim()
    .replace(/”|″/g, '"')
    .replace(/’|′/g, "'")
    .replace(/−/g, "-")
    .toLowerCase();

  // feet/inches like:
  //  - 5' 6"
  //  - 5'6 1/2"
  //  - 5 ft 6 in
  // Returns TOTAL INCHES
  if (s.includes("'") || /\bft\b/.test(s) || s.includes("feet")) {
    const m = s.match(/(-?\d+(?:\.\d+)?)\s*(?:'|\bft\b|feet)\s*([^]*)$/);
    if (m) {
      const feet = parseFloat(m[1] || "0");
      const restRaw = String(m[2] || "")
        .replace(/inches|inch|\bin\b/g, "")
        .replace(/"/g, " ")
        .trim();

      let inches = 0;

      // mixed inches: 6 1/2
      const mix = restRaw.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)/);
      if (mix) {
        const w = parseInt(mix[1], 10);
        const n = parseInt(mix[2], 10);
        const d = parseInt(mix[3], 10) || 1;
        inches = w + (w < 0 ? -1 : 1) * (n / d);
      } else {
        // fraction inches: 1/2
        const frac = restRaw.match(/^(-?\d+)\s*\/\s*(\d+)/);
        if (frac) {
          const n = parseInt(frac[1], 10);
          const d = parseInt(frac[2], 10) || 1;
          inches = n / d;
        } else {
          // decimal/integer inches: 6 or 6.25
          const tok = restRaw.match(/-?\d+(?:\.\d+)?/);
          inches = tok ? Number(tok[0]) : 0;
        }
      }

      if (Number.isFinite(feet) && Number.isFinite(inches)) {
        return feet * 12 + inches;
      }
    }
  }


  // mixed fraction: 2 3/8 or 2-3/8
  const mf = s.match(/^\s*(-?\d+)\s*(?:-|\s)\s*(\d+)\s*\/\s*(\d+)\s*$/);
  if (mf) {
    const w = parseInt(mf[1], 10);
    const n = parseInt(mf[2], 10);
    const d = parseInt(mf[3], 10) || 1;
    const sign = w < 0 ? -1 : 1;
    return w + sign * (n / d);
  }

  // pure fraction: 3/8
  const f = s.match(/^\s*(-?\d+)\s*\/\s*(\d+)\s*$/);
  if (f) {
    const n = parseInt(f[1], 10);
    const d = parseInt(f[2], 10) || 1;
    return n / d;
  }

  // decimal / integer
  const n = Number(s);
  if (Number.isFinite(n)) return n;

  // fall back: extract first number token
  const tok = s.match(/-?\d+(?:\.\d+)?/);
  if (tok) return Number(tok[0]);

  return NaN;
}

function solveFieldCalc(query) {
  const q0 = String(query || "").trim();
  if (!q0) return "";

  const q = q0
    .toLowerCase()
    .replace(/”|″/g, '"')
    .replace(/’|′/g, "'")
    .replace(/−/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const hasFt = q.includes("'") || /\bft\b/.test(q) || q.includes("feet");
  const hasIn = q.includes('"') || /\bin\b/.test(q) || q.includes("inch");
  const hasMm = /\bmm\b/.test(q) || q.includes("millimeter");
  const hasCm = /\bcm\b/.test(q) || q.includes("centimeter");
  const hasM = /\bm\b/.test(q) || q.includes(" meter");

  const wantsIn = q.includes("to in") || q.includes("to inch") || q.includes("to inches");
  const wantsFt = q.includes("to ft") || q.includes("to feet") || q.includes("to foot");
  const wantsMm = q.includes("to mm") || q.includes("to millimeter") || q.includes("to millimeters");
  const wantsCm = q.includes("to cm") || q.includes("to centimeter") || q.includes("to centimeters");
  const wantsM = q.includes("to m") || q.includes("to meter") || q.includes("to meters");

  const fmtIn = (inches) => {
    const mix = _toMixedFraction(inches, 64);
    return `${inches.toFixed(4)} in (≈ ${_formatMixed(mix)}")`;
  };
  const fmtFtIn = (inches) => {
    const sign = inches < 0 ? "-" : "";
    const abs = Math.abs(inches);
    const ft = Math.floor(abs / 12);
    const rem = abs - ft * 12;
    const mix = _toMixedFraction(rem, 16);
    return `${sign}${ft}' ${_formatMixed(mix)}"`;
  };

  // Parse a metric quantity from the string (mm/cm/m). Returns inches if convertToInches=true.
  const parseMetricToInches = () => {
    const v = _parseMixedFraction(q);
    if (!Number.isFinite(v)) return NaN;
    if (hasMm) return (v / 25.4);
    if (hasCm) return (v / 2.54);
    if (hasM) return (v * 39.37007874015748); // meters to inches
    return NaN;
  };

  // Parse an imperial quantity (feet/inches, fractions, decimals) -> inches
  const parseImperialToInches = () => {
    const v = _parseMixedFraction(q);
    return Number.isFinite(v) ? v : NaN;
  };

  // =========================
  // Conversions (metric <-> imperial)
  // =========================

  // metric -> imperial
  if ((hasMm || hasCm || hasM) && (wantsIn || wantsFt)) {
    const inches = parseMetricToInches();
    if (!Number.isFinite(inches)) return "Couldn’t read the number.";
    if (wantsFt) {
      return `${q0} = ${fmtFtIn(inches)}  (${fmtIn(inches)})`;
    }
    return `${q0} = ${fmtIn(inches)}`;
  }

  // imperial -> metric
  if ((hasFt || hasIn) && (wantsMm || wantsCm || wantsM)) {
    const inches = parseImperialToInches();
    if (!Number.isFinite(inches)) return "Couldn’t read the number.";
    const mm = inches * 25.4;
    const cm = inches * 2.54;
    const m = inches * 0.0254;
    if (wantsMm) return `${q0} = ${mm.toFixed(2)} mm`;
    if (wantsCm) return `${q0} = ${cm.toFixed(2)} cm`;
    return `${q0} = ${m.toFixed(4)} m`;
  }

  // feet/inches helper outputs
  if (hasFt && (wantsIn || q.includes("to inches"))) {
    const inches = parseImperialToInches();
    if (!Number.isFinite(inches)) return "Couldn’t read the number.";
    return `${q0} = ${fmtIn(inches)}  (${fmtFtIn(inches)})`;
  }
  if ((hasIn || (!hasFt && !hasMm && !hasCm && !hasM)) && wantsFt) {
    const inches = parseImperialToInches();
    if (!Number.isFinite(inches)) return "Couldn’t read the number.";
    return `${q0} = ${fmtFtIn(inches)}  (${fmtIn(inches)})`;
  }

  // =========================
  // Arithmetic (fractions + measurements)
  // =========================
  const opMap = [
    { re: /\s\+\s| plus /, op: "+" },
    { re: /\s-\s| minus /, op: "-" },
    { re: /\s\*\s| times | x /, op: "*" },
    { re: /\s\/\s| divided by /, op: "/" },
  ];

  for (const o of opMap) {
    if (o.re.test(q)) {
      const parts = q.split(o.re).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const a = _parseMixedFraction(parts[0]);
        const b = _parseMixedFraction(parts[1]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return "Couldn’t read the numbers.";
        let r = NaN;
        if (o.op === "+") r = a + b;
        if (o.op === "-") r = a - b;
        if (o.op === "*") r = a * b;
        if (o.op === "/") r = b === 0 ? NaN : a / b;
        if (!Number.isFinite(r)) return "Math error.";

        // If either side looks like length, present length-friendly outputs
        const looksLikeLength = /'|ft|feet|in\b|inch|mm|cm|\bm\b|meter/.test(q);
        if (looksLikeLength) {
          return `${q0} = ${fmtFtIn(r)}  (${fmtIn(r)})`;
        }

        const mix = _toMixedFraction(r, 64);
        return `= ${r.toFixed(5)}  (≈ ${_formatMixed(mix)})`;
      }
    }
  }

  // =========================
  // Plain value
  // =========================
  const v = _parseMixedFraction(q);
  if (Number.isFinite(v)) {
    // If the query smells like feet/inches, show both formats
    if (hasFt || hasIn) {
      return `${q0} = ${fmtFtIn(v)}  (${fmtIn(v)})`;
    }
    const mix = _toMixedFraction(v, 64);
    return `= ${v.toFixed(5)}  (≈ ${_formatMixed(mix)})`;
  }

  return 'Try: “12 3/8 + 5/16”, “30 cm to inches”, “2.4 m to ft”, “5\\\' 6 1/2\\\" to cm”.';
}


/* =========================
   LABOR PRESETS (LABEL ONLY)
   ========================= */
const LABOR_PRESETS = [
  { key: "superintendent", label: "Superintendent" },
  { key: "projectManager", label: "Project Manager" },
  { key: "superForeman", label: "Super Foreman / Gen Foreman" },
  { key: "foreman", label: "Foreman" },

  { key: "journeyman", label: "Journeyman" },
  { key: "leadTech", label: "Mechanic / Lead Tech" },

  { key: "painter", label: "Painter" },
  { key: "skilledLabor", label: "Skilled Laborer" },
  { key: "helper", label: "Helper" },
  { key: "apprentice", label: "Apprentice / Hand" },

  { key: "driver", label: "Driver / Runner" },
  { key: "cleanup", label: "Cleanup / Punch" },
];

/* =========================
   SCOPE / NOTES (NO TOKENS, NO BLANKS)
   ========================= */
const SCOPE_MASTER_TEMPLATES = [
  {
    key: "industrial",
    label: "Industrial (Master)",
    text: `Scope / Notes (Starter):
- Provide labor, tools, supervision, and coordination to complete the described work.
- Includes field verification of conditions, basic layout, and standard daily cleanup.
- Work performed in active/industrial environments where access, congestion, and safety requirements may affect production.

Included (General):
- Mobilization, staging, and reasonable protection of adjacent areas
- Standard hand tools and typical consumables
- Coordination with site contact for sequencing and access
- QA/cleanup at completion

Assumptions:
- Work performed during normal working hours unless otherwise noted
- Clear access and staging area provided by GC/Owner
- Existing conditions consistent with what is visible/accessible at time of estimate

Exclusions:
- Hidden/unforeseen conditions
- Rework due to scope changes or direction changes
- Permits/engineering/testing/inspections unless specifically included
- Specialty trades unless listed in scope

Job specifics (edit/add):
- Location/area:
- Quantities:
- Constraints/access:
- Schedule expectations:`,
  },
  {
    key: "commercial",
    label: "Commercial (Master)",
    text: `Scope / Notes (Starter):
- Provide labor and supervision to complete the described work in a commercial setting.
- Includes reasonable protection, standard tools, and cleanup.

Included:
- Field verification of conditions prior to work
- Standard tools/consumables and daily cleanup
- Coordination with on-site contact

Assumptions:
- Normal working hours unless otherwise noted
- Access and staging available as needed

Exclusions:
- Permits/engineering
- Hidden damage/unforeseen conditions
- Specialty trades unless listed

Job specifics (edit/add):
- Areas/rooms:
- Quantities:
- Constraints/access:
- Schedule expectations:`,
  },
  {
    key: "service",
    label: "Service / T&M Style (Master)",
    text: `Scope / Notes (Starter):
- Dispatch labor to perform requested service/repair work and basic troubleshooting as needed.
- Work is performed under typical time-and-material assumptions unless otherwise stated.

Included:
- Assessment/troubleshooting within reasonable limits
- Repairs/adjustments consistent with the described request
- Cleanup

Assumptions:
- Parts/materials billed separately unless included
- Access provided at time of service

Exclusions:
- Hidden damage
- Major replacement work unless authorized in writing

Job specifics (edit/add):
- Location/area:
- Problem statement:
- Desired outcome:
- Constraints/access:`,
  },
];

const SCOPE_MASTER_TEMPLATES_ES = [
  {
    key: "industrial",
    label: "Industrial (Maestro)",
    text: `Alcance / Notas (Inicio):
- Proveer mano de obra, herramientas, supervisión y coordinación para completar el trabajo descrito.
- Incluye verificación en campo de condiciones, trazos básicos y limpieza diaria estándar.
- Trabajo en ambientes activos/industriales donde el acceso, la congestión y los requisitos de seguridad pueden afectar la producción.

Incluye (General):
- Movilización, montaje y protección razonable de áreas adyacentes
- Herramienta manual estándar y consumibles típicos
- Coordinación con el contacto del sitio para secuencia y acceso
- Control de calidad / limpieza al finalizar

Suposiciones:
- Trabajo en horario normal a menos que se indique lo contrario
- Acceso y área de acopio provistos por GC/Propietario
- Condiciones existentes consistentes con lo visible/accesible al momento de estimar

Exclusiones:
- Condiciones ocultas/no previstas
- Retrabajos por cambios de alcance o dirección
- Permisos/ingeniería/pruebas/inspecciones salvo que se incluyan
- Oficios especializados salvo que se listan en el alcance

Detalles del trabajo (editar/agregar):
- Ubicación/área:
- Cantidades:
- Restricciones/acceso:
- Expectativas de calendario:`,
  },
  {
    key: "commercial",
    label: "Comercial (Maestro)",
    text: `Alcance / Notas (Inicio):
- Mano de obra, herramientas, supervisión y coordinación para completar el trabajo descrito.
- Incluye verificación en campo, trazos básicos y limpieza diaria estándar.

Incluye (General):
- Movilización y protección razonable de áreas adyacentes
- Herramientas estándar y consumibles típicos
- Coordinación con GC/Propietario para secuencia y acceso
- Limpieza final

Suposiciones:
- Horario normal, salvo que se indique
- Acceso despejado y área de acopio provista por GC/Propietario
- Condiciones consistentes con lo observado

Exclusiones:
- Condiciones ocultas/no previstas
- Cambios de alcance posteriores
- Permisos/ingeniería/pruebas/inspecciones salvo que se incluyan

Detalles del trabajo (editar/agregar):
- Ubicación/área:
- Cantidades:
- Restricciones/acceso:
- Expectativas de calendario:`,
  },
  {
    key: "service",
    label: "Servicio (Maestro)",
    text: `Alcance / Notas (Inicio):
- Mano de obra y herramientas para completar el trabajo de servicio descrito.
- Incluye diagnóstico básico en campo, coordinación de acceso y limpieza estándar.

Incluye (General):
- Visita al sitio / movilización
- Protección razonable de áreas adyacentes
- Herramientas estándar y consumibles típicos
- Limpieza final

Suposiciones:
- Trabajo durante horario normal a menos que se indique
- Acceso provisto por el cliente
- Condiciones existentes consistentes con lo observado

Exclusiones:
- Condiciones ocultas/no previstas
- Trabajo fuera de alcance
- Permisos/ingeniería/pruebas/inspecciones salvo que se incluyan

Detalles del trabajo (editar/agregar):
- Ubicación:
- Cantidades:
- Restricciones/acceso:
- Expectativas de calendario:`,
  },
];

const MASTER_BY_KEY_ES = Object.fromEntries(SCOPE_MASTER_TEMPLATES_ES.map((x) => [x.key, x]));


/* =========================
   TEMPLATE ADD-ONS (TRADE INSERTS)
   ========================= */
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

  // Original industrial inserts
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

const SCOPE_TRADE_INSERTS_ES = [
  {
    key: "genericLabor",
    label: "Mano de obra (Genérico)",
    text: `Trade Insert: Mano de obra (Genérico)
- Alcance: Mano de obra general y apoyo según sea necesario.
- Incluye: Herramientas manuales típicas y consumibles básicos.
- Exclusiones: Permisos/ingeniería/pruebas salvo que se indique.`,
  },
  {
    key: "painting",
    label: "Pintura",
    text: `Trade Insert: Pintura
- Alcance: Preparación, pintura y retoques según el alcance descrito.
- Incluye: Enmascarado/protección razonable y limpieza.
- Exclusiones: Reparación extensa de sustrato, pruebas especiales, permisos.`,
  },
  {
    key: "demoCrew",
    label: "Demolición / Retiro",
    text: `Trade Insert: Demolición / Retiro
- Alcance: Retiro/demolición controlada de materiales indicados.
- Incluye: Contención razonable, acarreo interno y limpieza básica.
- Exclusiones: Abatimiento ambiental, materiales peligrosos, permisos.`,
  },
  {
    key: "drywall",
    label: "Tablaroca (Drywall)",
    text: `Trade Insert: Tablaroca (Drywall)
- Alcance: Instalación, cinta, pasta y lijado al nivel indicado.
- Incluye: Materiales/consumibles típicos y limpieza básica.
- Exclusiones: Pintura final, molduras, pruebas especiales, permisos.`,
  },
  {
    key: "framing",
    label: "Estructura (Framing)",
    text: `Trade Insert: Estructura (Framing)
- Alcance: Estructura de muros/elementos según planos o alcance descrito.
- Incluye: Anclajes típicos y herramientas estándar.
- Exclusiones: Ingeniería, inspecciones/permits salvo que se incluyan.`,
  },
  {
    key: "insulation",
    label: "Aislamiento",
    text: `Trade Insert: Aislamiento
- Alcance: Suministro/instalación de aislamiento según especificación.
- Incluye: Sellos y consumibles típicos.
- Exclusiones: Abatimiento ambiental, pruebas especiales, permisos.`,
  },
  {
    key: "finishCarpentry",
    label: "Carpintería de acabado",
    text: `Trade Insert: Carpintería de acabado
- Alcance: Instalación de molduras, zoclos, marcos y acabados según alcance.
- Incluye: Fijación típica y limpieza.
- Exclusiones: Pintura/teñido final salvo que se indique, permisos.`,
  },
  {
    key: "flooring",
    label: "Pisos",
    text: `Trade Insert: Pisos
- Alcance: Instalación de pisos según especificación (LVP, alfombra, etc.).
- Incluye: Transiciones típicas y limpieza.
- Exclusiones: Preparación extensa de sustrato, pruebas especiales, permisos.`,
  },
  {
    key: "hvac",
    label: "HVAC",
    text: `Trade Insert: HVAC
- Alcance: Instalación/modificación de ductos/equipos según alcance.
- Incluye: Pruebas básicas de funcionamiento.
- Exclusiones: TAB/balanceo, ingeniería, permisos/inspecciones salvo que se incluyan.`,
  },
  {
    key: "plumbing",
    label: "Plomería",
    text: `Trade Insert: Plomería
- Alcance: Instalación/modificación de tubería, válvulas y accesorios según alcance.
- Incluye: Pruebas básicas.
- Exclusiones: Permisos/inspecciones, ingeniería, pruebas especiales salvo que se incluyan.`,
  },
  {
    key: "controls",
    label: "Controles / Automatización",
    text: `Trade Insert: Controles / Automatización
- Alcance: Cableado/terminación y programación básica según alcance.
- Incluye: Puesta en marcha básica.
- Exclusiones: Integración avanzada, ingeniería, permisos.`,
  },
  {
    key: "welding",
    label: "Soldadura",
    text: `Trade Insert: Soldadura
- Alcance: Soldadura en campo/taller según alcance descrito.
- Incluye: Consumibles típicos y limpieza.
- Exclusiones: Pruebas NDE, ingeniería, permisos/inspecciones salvo que se incluyan.`,
  },
  {
    key: "pipefitting",
    label: "Pipería (Pipefitting)",
    text: `Trade Insert: Pipería (Pipefitting)
- Alcance: Fabricación/instalación de tubería según alcance.
- Incluye: Soportería típica y limpieza básica.
- Exclusiones: Pruebas/flush especiales, ingeniería, permisos.`,
  },
  {
    key: "orbital",
    label: "Soldadura orbital",
    text: `Trade Insert: Soldadura orbital
- Alcance: Soldadura orbital en tubería según especificación.
- Incluye: Consumibles típicos y documentación básica.
- Exclusiones: QA/QC avanzado, pruebas NDE, ingeniería, permisos.`,
  },
  {
    key: "ironwork",
    label: "Herrería / Metal",
    text: `Trade Insert: Herrería / Metal
- Alcance: Fabricación/instalación de acero/metal según alcance.
- Incluye: Herrajes típicos y limpieza.
- Exclusiones: Ingeniería, pintura final, permisos/inspecciones salvo que se incluyan.`,
  },
  {
    key: "electrical",
    label: "Eléctrico",
    text: `Trade Insert: Eléctrico
- Alcance: Canalización/cableado/terminación según alcance.
- Incluye: Pruebas básicas y etiquetado estándar.
- Exclusiones: Permisos/inspecciones, ingeniería, puesta en marcha avanzada.`,
  },
  {
    key: "rigging",
    label: "Rigging / Izaje",
    text: `Trade Insert: Rigging / Izaje
- Alcance: Izaje/movimiento de equipos según plan y condiciones del sitio.
- Incluye: Señalización básica y coordinación.
- Exclusiones: Ingeniería de izaje, permisos especiales, cierres de vía.`,
  },
  {
    key: "heavyEquipment",
    label: "Equipo pesado",
    text: `Trade Insert: Equipo pesado
- Alcance: Operación de equipo pesado según alcance (excavación, carga, etc.).
- Incluye: Combustible/consumibles según se indique.
- Exclusiones: Permisos, cierres, ingeniería, pruebas.`,
  },
  {
    key: "concrete",
    label: "Concreto",
    text: `Trade Insert: Concreto
- Alcance: Colado/reparación según alcance descrito.
- Incluye: Acabado básico y curado estándar.
- Exclusiones: Ingeniería, pruebas de laboratorio, permisos/inspecciones.`,
  },
  {
    key: "demo",
    label: "Demolición (General)",
    text: `Trade Insert: Demolición (General)
- Alcance: Demolición controlada y retiro según alcance.
- Incluye: Limpieza básica y disposición según se indique.
- Exclusiones: Materiales peligrosos, abatimiento, permisos.`,
  },
];

const TRADE_BY_KEY_ES = Object.fromEntries(SCOPE_TRADE_INSERTS_ES.map((x) => [x.key, x]));


/* =========================
   QUICK NOTES (BOTTOM ONLY, NO BLANKS)
   ========================= */
const QUICK_NOTES = [
  {
    key: "schedule",
    label: "+ Schedule",
    line: "Schedule: Target start ASAP; duration dependent on access, approvals, and material lead times.",
  },
  {
    key: "exclusions",
    label: "+ Exclusions",
    line: "Exclusions: Hidden/unforeseen conditions not included unless authorized by written change order.",
  },
  {
    key: "payment",
    label: "+ Payment",
    line: "Payment: 30% deposit / balance due upon completion (Net terms by approval).",
  },
  {
    key: "change",
    label: "+ Change Orders",
    line: "Change Orders: Additional work requires written approval; pricing and schedule may change.",
  },
  {
    key: "safety",
    label: "+ Safety",
    line: "Safety: Work performed per site safety requirements (PPE, LOTO, hot work, confined space if applicable).",
  },
  {
    key: "access",
    label: "+ Access",
    line: "Access: Pricing assumes reasonable access and staging; delays due to access constraints may affect cost.",
  },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}


function formatDateMMDDYYYY(iso) {
  const s = String(iso || "").trim();
  if (!s) return "";
  const m = s.match(/^\s*(\d{4})-(\d{2})-(\d{2})\s*$/);
  if (m) return `${m[2]}-${m[3]}-${m[1]}`;
  // fallback for unexpected formats
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${mm}-${dd}-${yyyy}`;
  }
  return s;
}


function newLaborLine() {
  return { label: "", hours: "", rate: "", internalRate: "", qty: 1 };
}

// ✅ NEW: itemized materials rows
function newMaterialItem() {
  return { desc: "", qty: 1, cost: "", charge: "" }; // cost = internal per-unit, charge = billed per-unitunt
}


function getStoredSeqWidth(widthKey, fallback = 4) {
  try {
    const n = parseInt(localStorage.getItem(widthKey) || "", 10);
    if (Number.isFinite(n) && n >= 1 && n <= 12) return n;
  } catch (e) {
    // ignore
  }
  return fallback;
}

function setStoredSeqWidth(widthKey, width) {
  try {
    const w = parseInt(String(width || ""), 10);
    if (Number.isFinite(w) && w >= 1 && w <= 12) {
      localStorage.setItem(widthKey, String(w));
    }
  } catch (e) {
    // ignore
  }
}

function safeFilename(s) {
  const base = String(s || "").trim() || "Client";
  return base.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
}


function nextInvoiceNumber() {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  let seq = 1;
  try {
    const prev = Number(localStorage.getItem(INVOICE_SEQ_KEY) || 0);
    seq = Number.isFinite(prev) ? prev + 1 : 1;
    localStorage.setItem(INVOICE_SEQ_KEY, String(seq));
  } catch (e) {
    seq = 1;
  }

    const width = Math.max(4, getStoredSeqWidth(INVOICE_SEQ_WIDTH_KEY, 4));
  const seqStr = String(seq).padStart(width, "0");
  return `INV-${yyyy}${mm}${dd}-${seqStr}`;
}

function nextEstimateNumber() {
  // Per-device, simple auto sequence like: EST-YYYYMMDD-0001
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const ymd = `${y}${mo}${da}`;

  let seq = 0;
  try {
    const last = parseInt(localStorage.getItem(ESTIMATE_SEQ_KEY) || "0", 10);
    seq = Number.isFinite(last) ? last + 1 : 1;
    localStorage.setItem(ESTIMATE_SEQ_KEY, String(seq));
  } catch {
    seq = 1;
  }
    const width = Math.max(4, getStoredSeqWidth(ESTIMATE_SEQ_WIDTH_KEY, 4));
  const tail = String(seq).padStart(width, "0");
  return `EST-${ymd}-${tail}`;
}



function parseTrailingDigits(s) {
  const m = String(s || "").match(/(\d+)\s*$/);
  return m ? m[1] : "";
}

function replaceTrailingDigits(original, newDigits) {
  const str = String(original || "");
  if (!str) return str;
  return str.replace(/(\d+)\s*$/, String(newDigits));
}

function incrementFromTrailingDigits(current, { seqKey, widthKey }) {
  const cur = String(current || "");
  const tail = parseTrailingDigits(cur);
  if (!tail) return { ok: false, next: cur };

  const width = tail.length;
  const n = parseInt(tail, 10);
  if (Number.isNaN(n)) return { ok: false, next: cur };

  const nextN = n + 1;
  const nextTail = String(nextN).padStart(width, "0");
  const nextVal = replaceTrailingDigits(cur, nextTail);

  try {
    localStorage.setItem(seqKey, String(nextN));
  } catch {
    // ignore
  }
  setStoredSeqWidth(widthKey, width);

  return { ok: true, next: nextVal };
}

// ✅ STRICT: green only when ALL 4 required fields are filled
function isCompanyComplete(p) {
  const nameOk = Boolean(p?.companyName && String(p.companyName).trim());
  const phoneOk = Boolean(p?.phone && String(p?.phone).trim());
  const emailOk = Boolean(p?.email && String(p?.email).trim());
  const addrOk = Boolean(p?.address && String(p?.address).trim());
  return nameOk && phoneOk && emailOk && addrOk;
}

function clampPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, x));
}

// ✅ Phone auto-hyphens: 555-555-5555
function formatPhoneUS(input) {
  const digits = String(input || "").replace(/\D/g, "").slice(0, 10);
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 10);

  if (digits.length <= 3) return a;
  if (digits.length <= 6) return `${a}-${b}`;
  return `${a}-${b}-${c}`;
}

function containsExact(text, needle) {
  const tt = String(text || "");
  const n = String(needle || "");
  if (!n.trim()) return false;
  return tt.includes(n);
}

/**
 * ✅ PDF extraction
 * We want ALL Trade Insert blocks (every occurrence) so we can show them on PDF (only if present).
 */
function extractAllTradeInserts(fullText) {
  const tt = String(fullText || "");
  const marker = "Trade Insert:";
  const pieces = [];

  let pos = 0;
  while (true) {
    const idx = tt.indexOf(marker, pos);
    if (idx < 0) break;

    const after = tt.slice(idx);

    const end = after.indexOf("\n\n");
    const block = (end > 0 ? after.slice(0, end) : after).trim();

    if (block) pieces.push(block);
    pos = idx + marker.length;
  }

  const uniq = [];
  for (const b of pieces) {
    if (!uniq.includes(b)) uniq.push(b);
  }

  return uniq;
}

function extractScopeNotesForPdf(fullText) {
  let tt = String(fullText || "").trim();
  if (!tt) return "";

  const inserts = extractAllTradeInserts(tt);
  for (const ins of inserts) {
    tt = tt.replace(ins, "");
  }

  tt = tt.replace(/\n{3,}/g, "\n\n").trim();
  return tt;
}

function _replaceAll(haystack, needle, replacement) {
  const h = String(haystack || "");
  const n = String(needle || "");
  if (!n) return h;
  return h.split(n).join(String(replacement ?? ""));
}

/**
 * Swap known master templates + trade inserts to a target language by key.
 * This lets us export an English PDF even when the UI is Spanish (and vice versa),
 * without sending those protected blocks to a translator.
 */
function swapTemplatesAndInsertsToLang(fullText, targetLang) {
  let out = String(fullText || "");

  const isEs = targetLang === "es";

  // Master templates
  for (const en of SCOPE_MASTER_TEMPLATES) {
    const es = MASTER_BY_KEY_ES[en.key];
    const targetText = isEs ? (es?.text || en.text) : en.text;

    if (en?.text) out = _replaceAll(out, en.text, targetText);
    if (es?.text) out = _replaceAll(out, es.text, targetText);
  }

  // Trade inserts
  for (const en of SCOPE_TRADE_INSERTS) {
    const es = TRADE_BY_KEY_ES[en.key];
    const targetText = isEs ? (es?.text || en.text) : en.text;

    if (en?.text) out = _replaceAll(out, en.text, targetText);
    if (es?.text) out = _replaceAll(out, es.text, targetText);
  }

  return out;
}

function buildProtectedBlocks() {
  const blocks = [];
  for (const m of SCOPE_MASTER_TEMPLATES) if (m?.text) blocks.push(m.text);
  for (const m of SCOPE_MASTER_TEMPLATES_ES) if (m?.text) blocks.push(m.text);
  for (const x of SCOPE_TRADE_INSERTS) if (x?.text) blocks.push(x.text);
  for (const x of SCOPE_TRADE_INSERTS_ES) if (x?.text) blocks.push(x.text);

  // unique, longest-first to avoid partial collisions
  const uniq = [];
  for (const b of blocks) if (b && !uniq.includes(b)) uniq.push(b);
  uniq.sort((a, b) => b.length - a.length);
  return uniq;
}

function maskProtectedText(input, protectedBlocks) {
  let masked = String(input || "");
  const tokens = [];

  protectedBlocks.forEach((blk, idx) => {
    if (!blk) return;
    if (!masked.includes(blk)) return;
    const token = `[[PROTECTED_${idx}]]`;
    masked = _replaceAll(masked, blk, token);
    tokens.push([token, blk]);
  });

  return { masked, tokens };
}

function unmaskProtectedText(input, tokens) {
  let out = String(input || "");
  for (const [token, blk] of tokens) {
    out = _replaceAll(out, token, blk);
  }
  return out;
}



function resizeLogoFile(file, opts = {}) {
  const { maxWidth = 1600, maxHeight = 500, jpegQuality = 0.95, forcePng = false } = opts;

  return new Promise((resolve) => {
    if (!file) return resolve("");

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const iw = Number(img.width) || 1;
        const ih = Number(img.height) || 1;

        const scale = Math.min(maxWidth / iw, maxHeight / ih, 1);
        const outW = Math.max(1, Math.round(iw * scale));
        const outH = Math.max(1, Math.round(ih * scale));

        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;

        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve("");

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.clearRect(0, 0, outW, outH);
        ctx.drawImage(img, 0, 0, outW, outH);

        const originalType = String(file.type || "").toLowerCase();
        const keepPng = forcePng || originalType.includes("png");
        const mime = keepPng ? "image/png" : "image/jpeg";

        const dataUrl = mime === "image/jpeg" ? canvas.toDataURL(mime, jpegQuality) : canvas.toDataURL(mime);

        resolve(dataUrl);
      };

      img.onerror = () => resolve("");
      img.src = reader.result;
    };

    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

function detectDataUrlType(dataUrl) {
  const s = String(dataUrl || "");
  if (s.startsWith("data:image/png")) return "PNG";
  if (s.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

const STORAGE_KEY = "field-pocket-estimates";
const PROFILE_KEY_LEGACY = "field-pocket-profile";
const THEME_KEY = "field-pocket-theme"; // "auto" | "light" | "dark"
const SHOW_COSTS_KEY = "field-pocket-show-costs"; // "1" | "0"
const PDF_LABOR_ITEMIZED_KEY = "field-pocket-pdf-labor-itemized"; // "1" | "0"
const INVOICE_SEQ_KEY = "field-pocket-invoice-seq";
const LAST_INVOICE_NUM_KEY = "field-pocket-last-invoice-number";
const ESTIMATE_SEQ_KEY = "field-pocket-estimate-seq";
const LAST_ESTIMATE_NUM_KEY = "field-pocket-last-estimate-number";
const INVOICE_SEQ_WIDTH_KEY = "field-pocket-invoice-seq-width";
const ESTIMATE_SEQ_WIDTH_KEY = "field-pocket-estimate-seq-width";
const ORIGINAL_INVOICE_NUM_KEY = "field-pocket-original-invoice-number";

// =========================
// CUSTOMERS (AUTO-SAVED ON PDF EXPORT)
// =========================
const CUSTOMERS_KEY = "field-pocket-customers-v1";

function _nowTs() {
  return Date.now();
}

function _normKey(s) {
  return String(s || "").trim().toLowerCase();
}

function loadSavedCustomers() {
  try {
    const raw = localStorage.getItem(CUSTOMERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch (e) {
    return [];
  }
}

function saveCustomers(list) {
  try {
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  } catch (e) {
    // ignore
  }
}

function upsertCustomer(list, data) {
  const next = Array.isArray(list) ? [...list] : [];
  const name = String(data?.name || "").trim();
  if (!name) return next;

  const key = _normKey(name);
  const dataId = String(data?.id || "").trim();
  const idxById = dataId ? next.findIndex((c) => String(c?.id) === dataId) : -1;
  const idxByName = next.findIndex((c) => _normKey(c?.name) === key);
  const idx = idxById >= 0 ? idxById : idxByName;

  const payload = {
    id: idx >= 0 ? (next[idx]?.id || (dataId || `c_${_nowTs()}`)) : (dataId || `c_${_nowTs()}`),
    name,
    attn: String(data?.attn || "").trim(),
    phone: String(data?.phone || "").trim(),
    email: String(data?.email || "").trim(),
    address: String(data?.address || "").trim(),
    billingDiff: Boolean(data?.billingDiff),
    billingAddress: String(data?.billingAddress || "").trim(),
    termsDays: Number.isFinite(Number(data?.termsDays)) ? Number(data?.termsDays) : 0,
    projectName: String(data?.projectName || "").trim(),
    projectNumber: String(data?.projectNumber || "").trim(),
    projectSameAsCustomer: Boolean(data?.projectSameAsCustomer),
    projectAddress: String(data?.projectAddress || "").trim(),
    lastUsed: _nowTs(),
  };

  if (idx >= 0) next[idx] = { ...next[idx], ...payload };
  else next.unshift(payload);

  // keep most-recent first, cap list for performance on mobile
  next.sort((a, b) => (Number(b?.lastUsed) || 0) - (Number(a?.lastUsed) || 0));
  return next.slice(0, 250);
}

function deleteCustomer(list, id) {
  const next = Array.isArray(list) ? list.filter((c) => String(c?.id) !== String(id)) : [];
  return next;
}




function LanguageGate({ t, setLanguage }) {
  return (
    <div className="pe-wrap">
      <PopStyles />
      <PagePerimeterSnake />
      

      <header className="pe-header pe-sweep">
        <div style={{ marginTop: -10 }}>
          <div className="pe-title">Field Pocket Estimator</div>
          <div className="pe-subtitle">{t("subtitle")}</div>
        </div>
      </header>

      <main className="pe-main">
        <div className="pe-card">
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>
            {t("chooseLanguageTitle") || "Choose Language"}
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="pe-btn pe-btn-primary"
              style={{ minWidth: 180, flex: "1 1 180px", maxWidth: 220, padding: "12px 14px" }}
              onClick={() => setLanguage("en")}
            >
              English
            </button>
            <button
              type="button"
              className="pe-btn"
              style={{ minWidth: 180, flex: "1 1 180px", maxWidth: 220, padding: "12px 14px" }}
              onClick={() => setLanguage("es")}
            >
              Español
            </button>
                  
                </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75, lineHeight: 1.35 }}>
            {t("languageRequiredHint") ||
              "Language selection is required before using the estimator."}
          </div>
        </div>
      </main>
    </div>
  );
}

function EstimateFormInner({ lang, setLang, setLanguage, t, forceProfileOnMount = false, embeddedInShell = false }) {



  const protectedBlocks = useMemo(() => buildProtectedBlocks(), []);


  // ✅ Keep last-known English custom text so we can revert without needing a translator
  const lastEnglishDescriptionRef = useRef("");
  const lastEnglishAdditionalNotesRef = useRef("");

  // ✅ Optional: OpenAI key stored in localStorage for client-side translation (dev/prototype)
  const [openaiKey, setOpenaiKey] = useState(() => {
    try {
      return String(localStorage.getItem("field-pocket-openai-key") || "");
    } catch (e) {
      return "";
    }
  });

  useEffect(() => {
    try {
      const v = String(openaiKey || "").trim();
      if (v) localStorage.setItem("field-pocket-openai-key", v);
      else localStorage.removeItem("field-pocket-openai-key");
    } catch (e) {
      // ignore
    }
  }, [openaiKey]);



  const FIELD_STACK = { display: "grid", gap: 4 };
  const FIELD_LABEL = { fontSize: 12, opacity: 0.75, paddingLeft: 2 };
  const MONEY_PH = "0.00";

  function normalizeMoneyInput(v) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
    if (!Number.isFinite(n)) return "";
    return n.toFixed(2);
  }

  function normalizeIntInput(v, min = 0) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    const n = Math.floor(Number(String(s).replace(/[^0-9\-]/g, "")));
    if (!Number.isFinite(n)) return "";
    return String(Math.max(min, n));
  }

  function normalizeHoursInput(v) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    // keep digits and one dot
    const cleaned = s.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const normalized = parts.length <= 1 ? parts[0] : `${parts[0]}.${parts.slice(1).join("")}`;
    const n = Number(normalized);
    if (!Number.isFinite(n)) return "";
    const clamped = Math.max(0, n);
    // keep up to 2 decimals, but don't force trailing zeros
    const fixed = clamped.toFixed(2);
    return fixed.replace(/\.00$/, "").replace(/(\.[0-9])0$/, "$1");
  }

  function normalizePercentInput(v) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    const cleaned = s.replace(/[^0-9.\-]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return "";
    const clamped = Math.max(0, Math.min(100, n));
    // keep up to 2 decimals, but don't force trailing zeros
    const fixed = clamped.toFixed(2);
    return fixed.replace(/\.00$/, "").replace(/(\.[0-9])0$/, "$1");
  }

  function normalizeMultiplierInput(v) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    const cleaned = s.replace(/[^0-9.\-]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return "";
    const clamped = Math.max(0, Math.min(10, n)); // sane guardrail
    const fixed = clamped.toFixed(3);
    // trim trailing zeros
    return fixed.replace(/0+$/, "").replace(/\.$/, "");
  }

  useEffect(() => {
    try {
      if (lang === "en" || lang === "es") localStorage.setItem(LANG_KEY, lang);
      else localStorage.removeItem(LANG_KEY);
    } catch (e) {
      // ignore
    }
  }, [lang]);

  const [profile, setProfile] = useState(() => {
    const saved = loadSavedProfile();
    return saved || { ...DEFAULT_PROFILE };
  });

  // Persist company profile (and logo) across refreshes
  useEffect(() => {
    safeSaveProfile(profile);
  }, [profile]);
  const [step, setStep] = useState(() => (forceProfileOnMount ? "profile" : "estimate")); // "profile" | "estimate"

  // ✅ NEW: keep “Advanced” settings on their own screen (avoid cluttering estimator)
  const [view, setView] = useState("estimate");

  // Shell actions (hamburger/menu) can navigate EstimateForm without EstimateForm rendering its own header buttons.
  useEffect(() => {
    const onShell = (e) => {
      const d = e?.detail || {};
      const action = d.action;
      if (action === "openAdvanced") setView("advanced");
      if (action === "openEstimate") setView("estimate");
      if (action === "openProfile") setStep("profile");
      if (action === "newClear") resetForm();
      if (action === "save") handleSaveClick();
      if (action === "pdf") setPdfPromptOpen(true);
    };
    window.addEventListener("pe-shell-action", onShell);
    return () => window.removeEventListener("pe-shell-action", onShell);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
 // "estimate" | "advanced"

  // ✅ AI Draft Mode (Beta) — full-screen guided workflow (remembers last session until cleared)
  const [showAIDraft, setShowAIDraft] = useState(false);
  const [aiTrade, setAiTrade] = useState("painting"); // future: drywall, flooring, etc.
  const [aiInput, setAiInput] = useState("");
  const [aiMessages, setAiMessages] = useState(() => uiLoadJson("aiDraftMessages", []));
  const [aiDraftState, setAiDraftState] = useState(() =>
    uiLoadJson("aiDraftState", {
      trade: "painting",
      scopeType: "", // "interior" | "exterior"
      rooms: "",
      sqft: "",
      ceilingHeight: "",
      coats: "2",
      prep: "light", // "light" | "medium" | "heavy"
      includeCeilings: null,
      includeTrimDoors: null,
      stance: "mid", // "low" | "mid" | "high"
      complexity: "normal", // "simple" | "normal" | "cutup"
      needForeman: "", // "yes" | "no"
      extStories: "", // for exterior: "1" | "2" or height
    })
  );
  const aiLastPushRef = useRef({ key: "", t: 0 });
  const aiChatScrollRef = useRef(null);
  // Persist AI Draft Mode session (remember last conversation until user clears)
  useEffect(() => {
    uiSaveJson("aiDraftMessages", aiMessages);
  }, [aiMessages]);
  useEffect(() => {
    uiSaveJson("aiDraftState", aiDraftState);
  }, [aiDraftState]);

  // Auto-scroll chat to bottom when new messages arrive (only while modal is open)
  const aiChatRef = useRef(null);
  useEffect(() => {
    if (!showAIDraft) return;
    const el = aiChatRef.current;
    if (!el) return;
    try {
      el.scrollTop = el.scrollHeight;
    } catch {
      // ignore
    }
  }, [aiMessages, showAIDraft]);




  useEffect(() => {
    if (step !== "estimate" && view !== "estimate") setView("estimate");
  }, [step, view]);

  // ✅ NEW: estimate vs invoice mode (UI + PDF)
  const [docType, setDocType] = useState("estimate"); // "estimate" | "invoice"

  // ✅ NEW: invoice number (auto generated for invoices)
  const [invoiceNumber, setInvoiceNumber] = useState(() => {
    try {
      return String(localStorage.getItem(LAST_INVOICE_NUM_KEY) || "");
    } catch {
      return "";
    }
  });

  // ✅ NEW: "original" auto-generated invoice number so user can revert after customizing
  const [invoiceOriginal, setInvoiceOriginal] = useState(() => {
    try {
      return String(localStorage.getItem(ORIGINAL_INVOICE_NUM_KEY) || "");
    } catch {
      return "";
    }
  });
  const hasAutoInvoiceRef = useRef(false);

  const [estimateNumber, setEstimateNumber] = useState(() => {
    try {
      return String(localStorage.getItem(LAST_ESTIMATE_NUM_KEY) || "");
    } catch {
      return "";
    }
  });
  const hasAutoEstimateRef = useRef(false);

  // ✅ NEW: theme (saved)
  const [theme, setTheme] = useState(() => loadSavedTheme());

// ✅ helper so ESLint doesn't complain in inline handlers
  const setThemeSafe = (next) => {
    if (next !== "auto" && next !== "light" && next !== "dark") return;
    setTheme(next);
  };

  // ✅ NEW: PDF labor itemized toggle (Advanced)
  const [pdfLaborItemized, setPdfLaborItemized] = useState(() => {
    try {
      return localStorage.getItem(PDF_LABOR_ITEMIZED_KEY) === "1";
    } catch {
      return false;
    }
  });

  // ✅ TRUE COSTS are always available in Advanced (internal-only; never printed on PDF)
  const showCosts = true;
  // ✅ Theme persistence
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      // ignore
    }
    applyThemeToRoot(theme);
  }, [theme]);

  // ✅ Persist PDF labor itemized toggle
  useEffect(() => {
    try {
      localStorage.setItem(PDF_LABOR_ITEMIZED_KEY, pdfLaborItemized ? "1" : "0");
    } catch {
      // ignore
    }
  }, [pdfLaborItemized]);


  useEffect(() => {
    try {
      const v = String(invoiceNumber || "").trim();
      if (v) localStorage.setItem(LAST_INVOICE_NUM_KEY, v);
      else localStorage.removeItem(LAST_INVOICE_NUM_KEY);
    } catch (e) {
      // ignore
    }
  }, [invoiceNumber]);

  useEffect(() => {
    try {
      const v = String(invoiceOriginal || "").trim();
      if (v) localStorage.setItem(ORIGINAL_INVOICE_NUM_KEY, v);
      else localStorage.removeItem(ORIGINAL_INVOICE_NUM_KEY);
    } catch {
      // ignore
    }
  }, [invoiceOriginal]);

  // ✅ Auto-generate an invoice # when switching to Invoice mode (only if blank)
  useEffect(() => {
    if (docType !== "invoice") return;
    if (String(invoiceNumber || "").trim()) return;
    if (hasAutoInvoiceRef.current) return;

    const next = nextInvoiceNumber();
    setInvoiceNumber(next);
    if (!String(invoiceOriginal || "").trim()) setInvoiceOriginal(next);
    hasAutoInvoiceRef.current = true;
  }, [docType, invoiceNumber, invoiceOriginal]);



  useEffect(() => {
    try {
      const v = String(estimateNumber || "").trim();
      if (v) localStorage.setItem(LAST_ESTIMATE_NUM_KEY, v);
      else localStorage.removeItem(LAST_ESTIMATE_NUM_KEY);
    } catch (e) {
      // ignore
    }
  }, [estimateNumber]);

  useEffect(() => {
    if (docType !== "estimate") return;
    if (String(estimateNumber || "").trim()) return;
    if (hasAutoEstimateRef.current) return;

    const next = nextEstimateNumber();
    setEstimateNumber(next);
    hasAutoEstimateRef.current = true;
  }, [docType, estimateNumber]);


  const [date, setDate] = useState(todayISO());
  const [client, setClient] = useState("");
  const [location, setLocation] = useState("");
  // ✅ Customer extras (saved on export)
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAttn, setCustomerAttn] = useState("");
  const [billingDiff, setBillingDiff] = useState(false);
  const [billingAddress, setBillingAddress] = useState("");
  const [customerTermsDays, setCustomerTermsDays] = useState(0);


  // ✅ Project fields (per estimate/invoice)
  const [projectName, setProjectName] = useState("");
  const [projectNumber, setProjectNumber] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [lastManualProjectAddress, setLastManualProjectAddress] = useState("");
  const [projectAddressSameAsCustomer, setProjectAddressSameAsCustomer] = useState(true);


  function applyCustomerToForm(c) {
    if (!c) return;
    setClient(String(c.name || ""));
    setCustomerPhone(String(c.phone || ""));
    setCustomerEmail(String(c.email || ""));
    setCustomerAttn(String(c.attn || ""));
    setLocation(String(c.address || "")); // job location default
    setBillingDiff(Boolean(c.billingDiff));
    setBillingAddress(String(c.billingAddress || ""));
    setProjectName(String(c.projectName || ""));
    setProjectNumber(String(c.projectNumber || ""));
    const _custProjAddr = String(c.projectAddress || "");
    const _custSameAs = typeof c.projectSameAsCustomer === "boolean"
      ? Boolean(c.projectSameAsCustomer)
      : _custProjAddr.trim() === "";
    setProjectAddress(_custSameAs ? "" : _custProjAddr);
    setLastManualProjectAddress(_custSameAs ? "" : _custProjAddr);
    setProjectAddressSameAsCustomer(_custSameAs);
  }

  function buildCustomerFromForm(idOverride) {
    const name = String(client || "").trim();
    return {
      id: idOverride ? String(idOverride) : undefined,
      name,
      attn: String(customerAttn || "").trim(),
      phone: String(customerPhone || "").trim(),
      email: String(customerEmail || "").trim(),
      address: String(location || "").trim(),
      billingDiff: Boolean(billingDiff),
      billingAddress: String(billingAddress || "").trim(),
      termsDays: Number(customerTermsDays || 0) || 0,
      projectName: String(projectName || "").trim(),
      projectNumber: String(projectNumber || "").trim(),
      projectSameAsCustomer: Boolean(projectAddressSameAsCustomer),
      projectAddress: projectAddressSameAsCustomer ? "" : String(projectAddress || "").trim(),
    };
  }

  function saveCustomerFromEstimator() {
    const isNew = Boolean(customerCreating) || !selectedCustomerId;
    const payload = buildCustomerFromForm(isNew ? undefined : selectedCustomerId);

    if (!payload.name) {
      alert(lang === "es" ? "El nombre del cliente es obligatorio." : "Customer name is required.");
      return;
    }

    const next = upsertCustomer(customers, payload);
    setCustomers(next);

    const saved =
      payload.id
        ? next.find((c) => String(c?.id) === String(payload.id))
        : next.find((c) => _normKey(c?.name) === _normKey(payload.name));

    const savedId = String(saved?.id || "");
    if (savedId) {
      setSelectedCustomerId(savedId);
    }

    setCustomerCreating(false);
    setCustomerEditing(false);
    setCustomerPanelOpen(false);

    // Ensure form fields reflect saved customer (in case name normalization created a new record)
    if (saved) applyCustomerToForm(saved);
  }

  function cancelCustomerEstimatorEdit() {
    if (selectedCustomerId && !customerCreating) {
      const found = customers.find((c) => String(c?.id) === String(selectedCustomerId));
      if (found) applyCustomerToForm(found);
      setCustomerPanelOpen(false);
      return;
    }

    // Cancel new customer
    setCustomerCreating(false);
    setCustomerPanelOpen(false);
    setSelectedCustomerId("");
    setClient("");
    setCustomerPhone("");
    setCustomerEmail("");
    setLocation("");
    setCustomerAttn("");
    setBillingDiff(false);
    setBillingAddress("");
    setCustomerTermsDays(0);
  }

  // ✅ Saved customers (managed in Advanced, auto-saved on PDF export)
  const [customers, setCustomers] = useState(() => loadSavedCustomers());
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSelectQuery, setCustomerSelectQuery] = useState("");
  const [recentEstimateId, setRecentEstimateId] = useState("");
  const [customerPanelOpen, setCustomerPanelOpen] = useState(() => uiLoadBool("customerPanelOpen", false));
  const [customerCreating, setCustomerCreating] = useState(false);
  const [customerEditing, setCustomerEditing] = useState(false);
  const [customerDraft, setCustomerDraft] = useState(null);

  // ✅ Derived payment terms (days) from current customer draft (used for saving + PDF due calc)
  const termsDays = Number(customerDraft?.termsDays ?? 0) || 0;

  
  // ✅ Advanced: Customer organizer UI state (collapsible + search/sort)
  const [customersOrganizerOpen, setCustomersOrganizerOpen] = useState(() => uiLoadBool("customersOrganizerOpen", false));
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSort, setCustomerSort] = useState("recent"); // "recent" | "az"

  const customersSorted = useMemo(() => {
    const list = Array.isArray(customers) ? [...customers] : [];
    if (customerSort === "az") {
      list.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
      return list;
    }
    // default: recent (lastUsed desc)
    list.sort((a, b) => (Number(b?.lastUsed || 0) || 0) - (Number(a?.lastUsed || 0) || 0));
    return list;
  }, [customers, customerSort]);

  const customersFiltered = useMemo(() => {
    const q = String(customerSearch || "").trim().toLowerCase();
    if (!q) return customersSorted;
    return customersSorted.filter((c) => String(c?.name || "").toLowerCase().includes(q));
  }, [customersSorted, customerSearch]);

  const recentCustomersTop = useMemo(() => {
    return Array.isArray(customersSorted) ? customersSorted.slice(0, 8) : [];
  }, [customersSorted]);

  const recentCustomerIds = useMemo(() => {
    const ids = new Set();
    (Array.isArray(recentCustomersTop) ? recentCustomersTop : []).forEach((c) => ids.add(String(c?.id)));
    return ids;
  }, [recentCustomersTop]);

  const customersNonRecent = useMemo(() => {
    if (!recentCustomerIds.size) return customersSorted;
    return customersSorted.filter((c) => !recentCustomerIds.has(String(c?.id)));
  }, [customersSorted, recentCustomerIds]);

  const customersSelectFiltered = useMemo(() => {
    const q = String(customerSelectQuery || "").trim().toLowerCase();
    if (!q) return customersSorted;
    return customersSorted.filter((c) => {
      const name = String(c?.name || "").toLowerCase();
      const email = String(c?.email || "").toLowerCase();
      const phone = String(c?.phone || "").toLowerCase();
      return name.includes(q) || email.includes(q) || phone.includes(q);
    });
  }, [customersSorted, customerSelectQuery]);


// Persist customers list (must come AFTER customers is initialized)
  useEffect(() => {
    saveCustomers(customers);
  }, [customers]);

  useEffect(() => {
    if (!selectedCustomerId) return setCustomerDraft(null);
    const found = customers.find((c) => String(c?.id) === String(selectedCustomerId));
    setCustomerDraft(found ? { ...found } : null);
  }, [selectedCustomerId, customers]);
  const [poNumber, setPoNumber] = useState("");
  const [description, setDescription] = useState("");

  const [masterScopeKey, setMasterScopeKey] = useState("");
  const [tradeInsertKey, setTradeInsertKey] = useState("");

  const [additionalNotesText, setAdditionalNotesText] = useState("");

  const [laborLines, setLaborLines] = useState([newLaborLine()]);

  
  const [laborOpen, setLaborOpen] = useState(() => uiLoadBool("laborOpen", false));
  const [historyOpen, setHistoryOpen] = useState(() => uiLoadBool("historyOpen", false));

  // ✅ Field Calculator (construction quick-math + conversions)
  const [calcOpen, setCalcOpen] = useState(() => uiLoadBool("calcOpen", false));

  // Persist collapsible UI state (default collapsed)
  useEffect(() => uiSaveBool("customerPanelOpen", customerPanelOpen), [customerPanelOpen]);
  useEffect(() => uiSaveBool("customersOrganizerOpen", customersOrganizerOpen), [customersOrganizerOpen]);
  useEffect(() => uiSaveBool("laborOpen", laborOpen), [laborOpen]);
  useEffect(() => uiSaveBool("historyOpen", historyOpen), [historyOpen]);
  useEffect(() => uiSaveBool("calcOpen", calcOpen), [calcOpen]);

  const [calcInput, setCalcInput] = useState("");
  const [calcResult, setCalcResult] = useState("");
  const [calcListening, setCalcListening] = useState(false);
  const calcRecRef = useRef(null);

  const canUseSpeech =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const startCalcVoice = () => {
    if (!canUseSpeech) return;
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onresult = (ev) => {
        const t = String(ev?.results?.[0]?.[0]?.transcript || "").trim();
        if (t) {
          setCalcInput(t);
          const ans = solveFieldCalc(t);
          setCalcResult(ans);
        }
      };
      rec.onerror = () => {
        setCalcListening(false);
      };
      rec.onend = () => {
        setCalcListening(false);
      };

      calcRecRef.current = rec;
      setCalcListening(true);
      rec.start();
    } catch {
      setCalcListening(false);
    }
  };

  const stopCalcVoice = () => {
    try {
      calcRecRef.current?.stop?.();
    } catch {
      // ignore
    }
    setCalcListening(false);
  };
const [laborMultiplier, setLaborMultiplier] = useState(1);
  const [multiplierMode, setMultiplierMode] = useState("preset");
  const [customMultiplier, setCustomMultiplier] = useState("1");

  // ✅ NEW: materials mode toggle + itemized rows
  const [materialsMode, setMaterialsMode] = useState("itemized"); // "blanket" | "itemized"
  const [materialItems, setMaterialItems] = useState([newMaterialItem()]);

  const [materialsCost, setMaterialsCost] = useState("");
  const [hazardPct, setHazardPct] = useState("");

  const [materialsMarkupPct, setMaterialsMarkupPct] = useState("20");

  const [history, setHistory] = useState([]);

  // ✅ Track which saved estimate is currently loaded (so Save can overwrite vs create new)
  const [currentEstimateId, setCurrentEstimateId] = useState(null);
  const [savePromptOpen, setSavePromptOpen] = useState(false);

  const [pdfPromptOpen, setPdfPromptOpen] = useState(false);

  // ✅ NEW: per-textarea heights (touch + drag to resize)
  const [scopeBoxHeight, setScopeBoxHeight] = useState(320);
  const [notesBoxHeight, setNotesBoxHeight] = useState(160);

  function warnCompanyIncomplete() {
    alert(`${t("companyProfileIncompleteTitle")}\n\n${t("companyProfileIncompleteBody")}`);
  }

  useEffect(() => {
    const savedProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    if (savedProfile && typeof savedProfile === "object") {
      const nextProfile = {
        companyName: savedProfile.companyName || "",
        phone: savedProfile.phone || "",
        email: savedProfile.email || "",
        address: savedProfile.address || "",

        logoDataUrl: savedProfile.logoDataUrl || "",

        roc: savedProfile.roc || "",
        attn: savedProfile.attn || "",
        website: savedProfile.website || "",
        ein: savedProfile.ein || "",
        terms: savedProfile.terms || "",
      };
      setProfile(nextProfile);
      setStep(isCompanyComplete(nextProfile) ? "estimate" : "profile");
    } else {
      setStep("profile");
    }

    const savedHistory = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    setHistory(savedHistory);
  }, []);

  useEffect(() => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    if (step === "estimate" && !isCompanyComplete(profile)) {
      setStep("profile");
    }
  }, [step, profile]);

  const effectiveMultiplier =
    multiplierMode === "custom" ? Number(customMultiplier) || 1 : Number(laborMultiplier) || 1;

  // ✅ NEW: compute itemized materials billed total (qty × chargeEach)
  const itemizedMaterialsTotal = useMemo(() => {
    if (materialsMode !== "itemized") return 0;
    return (materialItems || []).reduce((sum, it) => {
      const qty = Math.max(1, Number(it?.qty) || 1);
      const chargeEach = Number(it?.charge) || 0;
      return sum + qty * chargeEach;
    }, 0);
  }, [materialsMode, materialItems]);

  // ✅ NEW: count itemized material lines (used for the green total summary)
  const itemizedMaterialsCount = useMemo(() => {
    if (materialsMode !== "itemized") return 0;
    return (materialItems || []).length;
  }, [materialsMode, materialItems]);


  // ✅ NEW: for calculations, use either blanket materialsCost or itemized total
  const effectiveMaterialsCost = materialsMode === "itemized" ? String(itemizedMaterialsTotal || 0) : materialsCost;

  // ✅ NEW: in itemized mode, we treat inputs as "already billed" and DO NOT apply markup
  const effectiveMaterialsMarkupPct = materialsMode === "itemized" ? "0" : materialsMarkupPct;

  const {
    laborBase,
    laborAdjusted,
    materialsBilled,
    hazardFeeDollar,
    total,
    materialsMarkupPct: normalizedMarkupPct,
    hazardPctNormalized,
    hazardEnabled,
  } = useMemo(() => {
    const base = calculateEstimateWithLaborLines(
      laborLines,
      effectiveMaterialsCost,
      effectiveMultiplier,
      0,
      effectiveMaterialsMarkupPct
    );

    const pct = clampPct(hazardPct);
    const enabled = pct > 0;
    const hazardBase = Number(base.laborAdjusted) || 0;
    const hazardDollars = enabled ? hazardBase * (pct / 100) : 0;

    const withHazard = calculateEstimateWithLaborLines(
      laborLines,
      effectiveMaterialsCost,
      effectiveMultiplier,
      hazardDollars,
      effectiveMaterialsMarkupPct
    );

    return {
      laborBase: withHazard.laborBase,
      laborAdjusted: withHazard.laborAdjusted,
      materialsBilled: withHazard.materialsBilled,
      hazardFeeDollar: hazardDollars,
      total: withHazard.total,
      materialsMarkupPct: withHazard.materialsMarkupPct,
      hazardPctNormalized: pct,
      hazardEnabled: enabled,
    };
  }, [
    laborLines,
    effectiveMaterialsCost,
    effectiveMultiplier,
    hazardPct,
    effectiveMaterialsMarkupPct,
  ]);

  const addLaborLine = () => {
    triggerHaptic();
    // If labor section is collapsed, expand it when the user adds a line.
    try { setLaborOpen(true); } catch {}
    if (laborLines.length >= 10) return;
    setLaborLines([...laborLines, newLaborLine()]);
  };

  const removeLaborLine = (i) => {
    triggerHaptic();
    if (laborLines.length <= 1) return;
    setLaborLines(laborLines.filter((_, idx) => idx !== i));
  };

  const updateLaborLine = (i, key, value) => {
    setLaborLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)));
  };

  const applyLaborPresetByLabel = (i, selectedLabel) => {
    if (!selectedLabel) return;
    setLaborLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, label: selectedLabel } : l)));
  };

  const duplicateLaborLine = (i) => {
    triggerHaptic();
    setLaborLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, qty: (Number(l.qty) || 1) + 1 } : l))
    );
  };

  const decrementLaborQty = (i) => {
    triggerHaptic();
    setLaborLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, qty: Math.max(1, (Number(l.qty) || 1) - 1) } : l))
    );
  };

  const totalLaborers = useMemo(() => {
    return laborLines.reduce((sum, l) => sum + (Number(l.qty) || 1), 0);
  }, [laborLines]);


  // ✅ NEW: true-cost capture + gross margin
  // True labor cost is computed from labor lines: (internal rate × hours × qty)
  const internalLaborCostFromLines = useMemo(() => {
    return laborLines.reduce((sum, l) => {
      const internalRaw = String(l?.internalRate ?? "").trim();
      const rateRaw = String(l?.rate ?? "").trim();

      // If internal rate is left blank, fall back to the billed rate for margin calculations.
      const r = internalRaw !== "" ? Number(internalRaw) : Number(rateRaw);

      const h = Number(l?.hours);
      const q = Number(l?.qty) || 1;

      const rr = Number.isFinite(r) ? r : 0;
      const hh = Number.isFinite(h) ? h : 0;

      return sum + rr * hh * q;
    }, 0);
  }, [laborLines]);


  const laborTrueCost = useMemo(() => {
    const n = Number(internalLaborCostFromLines);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [internalLaborCostFromLines]);
// ✅ NEW: sum of internal material costs from itemized lines (qty × internal cost)
  const internalMaterialsItemsCost = useMemo(() => {
    try {
      return (materialItems || []).reduce((sum, it) => {
        const qty = Math.max(1, Number(it?.qty) || 1);
        const c = Number(it?.cost);
        const costEach = Number.isFinite(c) ? c : 0;
        return sum + qty * costEach;
      }, 0);
    } catch (e) {
      return 0;
    }
  }, [materialItems]);

  // ✅ Derived blanket materials true cost (from Materials cost input)
  const derivedBlanketMaterialsCost = useMemo(() => {
    const n = Number(materialsCost);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [materialsCost]);
const materialsTrueCost = useMemo(() => {
    // Itemized: sum of per-line internal costs (qty × internal cost)
    if (materialsMode === "itemized") {
      const n = Number(internalMaterialsItemsCost);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    }
    // Blanket: use the Materials cost field as the true cost (markup affects revenue, not cost)
    const n = Number(derivedBlanketMaterialsCost);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [materialsMode, internalMaterialsItemsCost, derivedBlanketMaterialsCost]);

const totalTrueCost = useMemo(() => {
    return (Number(laborTrueCost) || 0) + (Number(materialsTrueCost) || 0);
  }, [laborTrueCost, materialsTrueCost]);

  const grossMarginPct = useMemo(() => {
    const billed = Number(total) || 0;
    if (!(billed > 0)) return "0";
    const gm = ((billed - (Number(totalTrueCost) || 0)) / billed) * 100;
    if (!Number.isFinite(gm)) return "0";
    return String(gm.toFixed(1)).replace(/\.0$/, "");
  }, [total, totalTrueCost]);

  const countMasterTemplatesInText = (text) => {
    const tt = String(text || "");
    let count = 0;

    const all = [...SCOPE_MASTER_TEMPLATES, ...SCOPE_MASTER_TEMPLATES_ES];
    for (const m of all) {
      if (m?.text && tt.includes(m.text)) count += 1;
    }
    return count;
  };

  const countTradeInsertsInText = (text) => {
    return extractAllTradeInserts(text).length;
  };

  const warnMultipleTemplates = (kind, countAlready) => {
    return window.confirm(t("warnMultipleTemplates", kind, countAlready));
  };

  const insertBlock = (blockText) => {
    if (!blockText) return;
    setDescription((prev) => {
      const p = String(prev || "").trim();
      return p ? `${p}\n\n${blockText}` : blockText;
    });
  };

  const applyMasterTemplate = (key) => {
    const base = SCOPE_MASTER_TEMPLATES.find((x) => x.key === key);
    const es = MASTER_BY_KEY_ES[key];
    const tpl = lang === "es" ? (es || base) : base;
    if (!tpl) return;

    const existingMasters = countMasterTemplatesInText(description);
    const baseText = base?.text || "";
    const esText = es?.text || "";

    const isDuplicate =
      (tpl.text && containsExact(description, tpl.text)) ||
      (baseText && containsExact(description, baseText)) ||
      (esText && containsExact(description, esText));

    if (isDuplicate) {
      const ok = window.confirm(t("templateAlreadyAdded"));
      if (!ok) return;
      insertBlock(tpl.text);
      return;
    }

    if (existingMasters >= 1) {
      const ok = warnMultipleTemplates(lang === "es" ? "Plantilla maestra" : "Master template", existingMasters);
      if (!ok) return;
    }

    insertBlock(tpl.text);
  };

  const applyTradeInsert = (key) => {
    const base = SCOPE_TRADE_INSERTS.find((x) => x.key === key);
    const es = TRADE_BY_KEY_ES[key];
    const tpl = lang === "es" ? (es || base) : base;
    if (!tpl) return;

    const existingInserts = countTradeInsertsInText(description);
    const baseText = base?.text || "";
    const esText = es?.text || "";

    const isDuplicate =
      (tpl.text && containsExact(description, tpl.text)) ||
      (baseText && containsExact(description, baseText)) ||
      (esText && containsExact(description, esText));

    if (isDuplicate) {
      const ok = window.confirm(t("tradeAlreadyAdded"));
      if (!ok) return;
      insertBlock(tpl.text);
      return;
    }

    if (existingInserts >= 1) {
      const ok = warnMultipleTemplates(lang === "es" ? "Inserto" : "Trade insert", existingInserts);
      if (!ok) return;
    }

    insertBlock(tpl.text);
  };

  const addAdditionalNoteLine = (line) => {
    const current = String(additionalNotesText || "");
    const already = current.includes(line);

    if (already) {
      const ok = window.confirm(t("noteAlreadyAdded"));
      if (!ok) return;
    }

    setAdditionalNotesText((prev) => {
      const p = String(prev || "").trimEnd();
      return p ? `${p}\n\n${line}` : line;
    });
  };

  const clearAdditionalNotes = () => {
    triggerHaptic();
    setAdditionalNotesText("");
  };

  // ✅ NEW: material line helpers
  const addMaterialItem = () => {
    triggerHaptic();
    if (materialItems.length >= 40) return;
    setMaterialItems((prev) => [...prev, newMaterialItem()]);
  };

  const removeMaterialItem = (i) => {
    triggerHaptic();
    if (materialItems.length <= 1) {
      setMaterialItems([newMaterialItem()]);
      return;
    }
    setMaterialItems((prev) => prev.filter((_, idx) => idx !== i));
  };

  const updateMaterialItem = (i, key, value) => {
    setMaterialItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [key]: value } : it)));
  };

  const resetForm = () => {
    triggerHaptic();

    setCurrentEstimateId(null);

    // Keep whichever doc type the user is on.
    // New / Clear should reload the last-saved number for that doc type.
    // docType already in scope
    setDate(todayISO());
    setClient("");
    setLocation("");
    setPoNumber("");
setProjectName("");
    setProjectNumber("");
    setProjectAddress("");
    setLastManualProjectAddress("");
    setProjectAddressSameAsCustomer(true);
    setDescription("");
    setMasterScopeKey("");
    setTradeInsertKey("");
    setAdditionalNotesText("");
    setLaborLines([newLaborLine()]);
    setLaborMultiplier(1);
    setMultiplierMode("preset");
    setCustomMultiplier("1");

    // ✅ NEW: materials reset
    setMaterialsMode("itemized");
    setMaterialItems([newMaterialItem()]);
    setMaterialsCost("");
    setMaterialsMarkupPct("20");

    setHazardPct("");

    setScopeBoxHeight(320);
    setNotesBoxHeight(160);

    // ✅ Restore last-saved doc number after a reset (do NOT advance sequence here)
    if (docType === "invoice") {
      let lastInv = "";
      try {
        lastInv = String(localStorage.getItem(LAST_INVOICE_NUM_KEY) || "").trim();
      } catch (e) {
        lastInv = "";
      }

      if (lastInv) {
        setInvoiceNumber(lastInv);
        hasAutoInvoiceRef.current = true;
      } else {
        const next = nextInvoiceNumber();
        setInvoiceNumber(next);
        setInvoiceOriginal(next);
        hasAutoInvoiceRef.current = true;
      }
    } else {
      let lastEst = "";
      try {
        lastEst = String(localStorage.getItem(LAST_ESTIMATE_NUM_KEY) || "").trim();
      } catch (e) {
        lastEst = "";
      }

      if (lastEst) {
        setEstimateNumber(lastEst);
        hasAutoEstimateRef.current = true;
      } else {
        const next = nextEstimateNumber();
        setEstimateNumber(next);
        hasAutoEstimateRef.current = true;
      }
    }
  };

  const buildEstimateEntry = (idOverride) => {
    const entry = {
      id: typeof idOverride === "number" ? idOverride : Date.now(),
      customerId: selectedCustomerId || "",
      customerSnapshot: customerDraft
        ? {
            name: String(customerDraft.name || ""),
            phone: String(customerDraft.phone || ""),
            email: String(customerDraft.email || ""),
            address: String(customerDraft.address || ""),
            billingDiff: Boolean(customerDraft.billingDiff),
            billingAddress: String(customerDraft.billingAddress || ""),
            termsDays: Number.isFinite(Number(customerDraft.termsDays))
              ? Number(customerDraft.termsDays)
              : 0,
            projectName: String(customerDraft.projectName || ""),
            projectNumber: String(customerDraft.projectNumber || ""),
            projectAddress: String(customerDraft.projectAddress || ""),
            projectSameAsCustomer:
              typeof customerDraft.projectSameAsCustomer === "boolean"
                ? Boolean(customerDraft.projectSameAsCustomer)
                : String(customerDraft.projectAddress || "").trim() === "",
            // ✅ Customer ATTN (persisted snapshot for this estimate)
            attn: String(customerDraft.attn || ""),
          }
        : null,

      date,
      client,
      location,
      poNumber,
      dueDate: "",
      termsDays,
      projectName,
      projectNumber,
      projectAddress,
      projectAddressSameAsCustomer,
      description,
      additionalNotesText,

      docType,

      laborLines,
      multiplierMode,
      laborMultiplier,
      customMultiplier,

      // ✅ materials mode + itemized rows
      materialsMode,
      materialItems,

      materialsCost,
      materialsMarkupPct,
      hazardPct,

      total,
    };

    return entry;
  };

  const commitEstimateSave = (mode) => {
    triggerHaptic();

    const isOverwrite = mode === "overwrite" && typeof currentEstimateId === "number";
    const entry = buildEstimateEntry(isOverwrite ? currentEstimateId : undefined);

    // Overwrite: replace existing entry (and move it to top). New: prepend.
    let updated;
    if (isOverwrite) {
      const without = history.filter((h) => Number(h.id) !== Number(currentEstimateId));
      updated = [entry, ...without].slice(0, 25);
    } else {
      updated = [entry, ...history].slice(0, 25);
    }

    setHistory(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

    // After saving, treat this estimate as the current one (so subsequent saves can overwrite cleanly)
    setCurrentEstimateId(Number(entry.id));
  };

  const handleSaveClick = () => {
    // If we loaded an existing estimate, make it explicit whether Save will overwrite or create a new entry.
    if (typeof currentEstimateId === "number") {
      setSavePromptOpen(true);
      return;
    }
    // Otherwise, Save creates a new estimate.
    commitEstimateSave("new");
  };

  const saveEstimate = () => {
    // Backwards-compat (in case any older handler still calls saveEstimate)
    handleSaveClick();
  };

  const loadEstimate = (e) => {
    triggerHaptic();
    setCurrentEstimateId(e && typeof e.id === "number" ? Number(e.id) : null);
    setDate(e.date);
    setClient(e.client);
    setLocation(e.location || "");
    setPoNumber(e.poNumber || "");
    setCustomerTermsDays(Number.isFinite(Number(e.termsDays)) ? Number(e.termsDays) : 0);

    // ✅ Re-attach the saved customer (so loading an estimate restores the customer it was created with)
    if (e && e.customerId) {
      const cid = String(e.customerId);
      setSelectedCustomerId(cid);
      const found = customers.find((c) => String(c.id) === cid);
      const snap = e.customerSnapshot || null;
      const useCustomer = found || snap;
      if (useCustomer) {
        setCustomerDraft(useCustomer);
        applyCustomerToForm(useCustomer);
        // keep terms in sync with that customer
        const td = Number.isFinite(Number(useCustomer.termsDays)) ? Number(useCustomer.termsDays) : 0;
        setCustomerTermsDays(td);
      }
    }
setProjectName(e.projectName || "");
    setProjectNumber(e.projectNumber || "");
    const _eProjAddr = String(e.projectAddress || "");
    const _eSameAs = typeof e.projectAddressSameAsCustomer === "boolean"
      ? Boolean(e.projectAddressSameAsCustomer)
      : _eProjAddr.trim() === "";
    setProjectAddress(_eSameAs ? "" : _eProjAddr);
    setLastManualProjectAddress(_eSameAs ? "" : _eProjAddr);
    setProjectAddressSameAsCustomer(_eSameAs);
    setDescription(e.description);

    setMasterScopeKey("");
    setTradeInsertKey("");

    setAdditionalNotesText(e.additionalNotesText ?? "");

    setDocType(e.docType === "invoice" ? "invoice" : "estimate");

    const normalizedLaborLines = Array.isArray(e.laborLines)
      ? e.laborLines.map((l) => ({
          label: l?.label ?? "",
          hours: l?.hours ?? "",
          rate: l?.rate ?? "",
          internalRate: l?.internalRate ?? "",
          qty: l?.qty ?? 1,
        }))
      : [newLaborLine()];

    setLaborLines(normalizedLaborLines.length ? normalizedLaborLines : [newLaborLine()]);

    setMultiplierMode(e.multiplierMode || "preset");
    setLaborMultiplier(Number(e.laborMultiplier) || 1);
    setCustomMultiplier(
      e.customMultiplier !== undefined && e.customMultiplier !== null ? String(e.customMultiplier) : "1"
    );

    // ✅ NEW: restore materials mode + itemized rows
    const mm = e.materialsMode === "itemized" ? "itemized" : "blanket";
    setMaterialsMode(mm);

    const normalizedMaterialItems = Array.isArray(e.materialItems)
      ? e.materialItems.map((it) => ({
          desc: it?.desc ?? "",
          qty: Math.max(1, Number(it?.qty) || 1),
          charge: it?.charge ?? "",
        }))
      : [newMaterialItem()];

    setMaterialItems(normalizedMaterialItems.length ? normalizedMaterialItems : [newMaterialItem()]);

    setMaterialsCost(e.materialsCost ?? "");
    setMaterialsMarkupPct(
      e.materialsMarkupPct !== undefined && e.materialsMarkupPct !== null ? String(e.materialsMarkupPct) : "20"
    );

    setHazardPct(e.hazardPct !== undefined && e.hazardPct !== null ? String(e.hazardPct) : "");
  };

  const deleteEstimate = (id) => {
    triggerHaptic();
    const ok = window.confirm(t("deleteSavedConfirm"));
    if (!ok) return;

    const updated = history.filter((x) => x.id !== id);
    setHistory(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const duplicateEstimate = (e) => {
    triggerHaptic();
    if (!e || typeof e !== "object") return;

    // Create a brand-new numeric id (your app uses numeric ids)
    const newId = Date.now() + Math.floor(Math.random() * 1000);

    const copy = {
      ...e,
      id: newId,
      // stamp as "now" so it sorts to the top and feels new
      date: todayISO(),
    };

    // (Optional) make it obvious in the saved list without changing customer name:
    // Append "(Copy)" to project name if present, otherwise leave as-is.
    if (copy.projectName && typeof copy.projectName === "string" && !copy.projectName.includes("(Copy)")) {
      copy.projectName = copy.projectName.trim() ? `${copy.projectName.trim()} (Copy)` : copy.projectName;
    }

    const updated = [copy, ...history].slice(0, 25);
    setHistory(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

    // Load the duplicated estimate immediately
    loadEstimate(copy);
  };

  const clearAllEstimates = () => {
    triggerHaptic();
    const ok = window.confirm(t("deleteAllSavedConfirm"));
    if (!ok) return;

    setHistory([]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
  };

  const handleMultiplierSelect = (value) => {
    if (value === "custom") {
      setMultiplierMode("custom");
      return;
    }
    setMultiplierMode("preset");
    setLaborMultiplier(Number(value) || 1);
  };

  const multiplierSelectValue = multiplierMode === "custom" ? "custom" : String(laborMultiplier);

  const companyGreen = isCompanyComplete(profile);

  // PDF frame inset (keeps border away from the page edge)
  const FRAME_INSET = 14;


  // Keep all tables inside the same inset so grid borders never protrude past the frame
  const TABLE_INSET = FRAME_INSET + 6;
  const drawFrame = (doc) => {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const INNER_W = pageWidth - TABLE_INSET * 2;

    // NOTE: TABLE_INSET is defined once above (shared by all tables) so we don’t accidentally
    // reference an out-of-scope INNER_W later in exportPDF.

    const BORDER = [210, 210, 210];
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.5);
    doc.rect(FRAME_INSET, FRAME_INSET, pageWidth - FRAME_INSET * 2, pageHeight - FRAME_INSET * 2);
  };


  


  const exportCSV = () => {
    triggerHaptic();

    const rows = [];
    const csvCell = (x) => {
      const s = String(x ?? "");
      const needs = /[",\n]/.test(s);
      const escaped = s.replace(/"/g, '""');
      return needs ? `"${escaped}"` : escaped;
    };
    const push = (arr) => rows.push(arr.map(csvCell).join(","));

    push(["Field Pocket Estimator Export"]);
    push(["Document", docType === "invoice" ? "Invoice" : "Estimate"]);
    if (docType === "invoice" && invoiceNumber) push(["Invoice #", invoiceNumber]);
    push(["Date", date]);
    push(["Client", client]);

    push([]);
    push(["Totals"]);
    push(["Labor (billed)", laborAdjusted]);
    push(["Materials (billed)", materialsBilled]);
    push(["Hazard fee", hazardFeeDollar]);
    push(["Total (billed)", total]);
    push([]);
    push(["Labor Lines"]);
    push(["Role", "Qty", "Hours", "Rate"]);
    (laborLines || []).forEach((l) => {
      push([l.label, l.qty, l.hours, l.rate]);
    });

    push([]);
    push(["Materials"]);
    if (materialsMode === "itemized") {
      push(["Description", "Qty", "Price (each)"]);
      (materialItems || []).forEach((it) => {
        push([it.desc, it.qty, it.charge]);
      });
    } else {
      push(["Materials cost", effectiveMaterialsCost]);
      push(["Markup %", effectiveMaterialsMarkupPct]);
    }

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const filePrefix = docType === "invoice" ? "Invoice" : "Estimate";
    const invPart = docType === "invoice" && invoiceNumber ? `-${invoiceNumber}` : "";
    a.href = url;
    a.download = `${filePrefix}${invPart}-${safeFilename(client)}-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportPDF = async (mode = "download") => {
    triggerHaptic();


    // ✅ Invoice number (only for invoices)
    let invNum = "";
    if (docType === "invoice") {
      invNum = String(invoiceNumber || "").trim();
      if (!invNum) {
        invNum = nextInvoiceNumber();
        setInvoiceNumber(invNum);
      }
    }

    // ✅ Estimate number (always printed on Estimate PDFs; optional on Invoice PDFs)
    let estNum = String(estimateNumber || "").trim();
    if (docType === "estimate" && !estNum) {
      estNum = nextEstimateNumber();
      setEstimateNumber(estNum);
    }

    if (!companyGreen) {
      const go = window.confirm(t("pdfCompanyIncompleteConfirm"));
      if (go) setStep("profile");
      return;
    }

    // ✅ Export language chooser (only when UI is Spanish)
    // OK = export Spanish
    // Cancel = export English (and revert the app back to English)
    let pdfLang = lang;
    let okSpanish = true;

    if (lang === "es") {
      okSpanish = window.confirm(t("pdfExportLanguageConfirm"));
      pdfLang = okSpanish ? "es" : "en";

      // ✅ Warn: English export from Spanish UI only converts templates/inserts, not custom text
      if (pdfLang === "en") {
        alert(t("pdfEnglishFromSpanishWarn"));
      }
    }
    // we treat that as "revert this estimate back to English" so the
    // scope box + notes don't stay stuck in Spanish afterward.
// PDF i18n helper (can differ from UI language)
    const tPdf = (key, ...args) => {
      const pack = I18N[pdfLang] || I18N.en;
      const v = pack[key];
      if (typeof v === "function") return v(...args);
      return v !== undefined ? v : I18N.en[key] ?? key;
    };

    // ---------------------------
    // PDF document setup
    // ---------------------------
    const doc = new jsPDF({ orientation: "p", unit: "pt", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const INNER_W = pageWidth - TABLE_INSET * 2;

    const BORDER = [210, 210, 210];
    const SHADE = [245, 245, 245];
    const TEXT_MUTED = [90, 90, 90];

    // Header bits (used by drawHeader on each page)
    const companyName = String(profile.companyName || "").trim() || "Company";
    const phone = String(profile.phone || "").trim();
    const email = String(profile.email || "").trim();
    const website = String(profile.website || "").trim();
    const contactBits = [phone, email, website].filter(Boolean).join(" • ");

    const addressLine = String(profile.address || "").trim();

    const optionalBits = [
      profile.roc ? `ROC ${String(profile.roc).trim()}` : "",
      profile.ein ? `EIN ${String(profile.ein).trim()}` : "",
    ].filter(Boolean);
    const optionalLine = optionalBits.join(" • ");

    const jobInfoCenterX = () => pageWidth / 2;
    const drawFitCenteredText = (doc, text, cx, y, maxW, maxSize = 9) => {
      const raw = String(text ?? "");
      if (!raw) return;

      const prevSize = doc.getFontSize ? doc.getFontSize() : maxSize;
      doc.setFontSize(maxSize);

      // Prefer truncation (readable) over shrinking (illegible)
      let s = raw;
      if (Number.isFinite(maxW) && maxW > 0 && doc.getTextWidth(s) > maxW) {
        const ell = "…";
        let lo = 0;
        let hi = s.length;
        // Binary search the largest substring that fits with ellipsis
        while (lo < hi) {
          const mid = Math.floor((lo + hi + 1) / 2);
          const candidate = s.slice(0, mid) + ell;
          if (doc.getTextWidth(candidate) <= maxW) lo = mid;
          else hi = mid - 1;
        }
        s = s.slice(0, lo) + ell;
      }

      doc.text(s, cx, y, { align: "center" });
      doc.setFontSize(prevSize);
    };


    function drawHeader() {
      drawFrame(doc);

      // ---------------------------
      // HEADER (logo + meta table only)
      // ---------------------------
      // Hard header boundary (nothing should print below this line)
      const HEADER_BOTTOM_Y = 108;

      // Header background
      doc.setFillColor(...SHADE);
      const headerTop = FRAME_INSET + 2;
      const headerH = (HEADER_BOTTOM_Y - 6) - headerTop;
      doc.rect(FRAME_INSET, headerTop, pageWidth - FRAME_INSET * 2, headerH, "F");

      const pad = 12;

      // Bigger / more prominent logo box (left)
      const logoBoxX = FRAME_INSET + pad;
      const logoBoxY = headerTop + 6;
      const logoBoxW = 205;
      const logoBoxH = 82;

      // Elongated meta table (top-right)
      const metaRight = pageWidth - FRAME_INSET - pad;
      const metaW = 276; // elongated like pro invoices
      const metaLeft = metaRight - metaW;
      const metaTop = headerTop + 10;
      const metaH = 34; // two rows
      const metaMidY = metaTop + metaH / 2;

      // Draw logo (if present)
      if (profile.logoDataUrl) {
        try {
          const imgType = detectDataUrlType(profile.logoDataUrl);
          const props = doc.getImageProperties(profile.logoDataUrl);
          const iw = Number(props?.width) || 1;
          const ih = Number(props?.height) || 1;
          const scale = Math.min(logoBoxW / iw, logoBoxH / ih, 2.6); // allow larger logo (still guarded)
          const drawW = iw * scale;
          const drawH = ih * scale;
          const x = logoBoxX + (logoBoxW - drawW) / 2;
          const y = logoBoxY + (logoBoxH - drawH) / 2;
          doc.addImage(profile.logoDataUrl, imgType, x, y, drawW, drawH);
        } catch {
          // ignore logo issues
        }
      }

      // Meta section (top-right)
      // - Invoice: boxed 3-col table with Due
      // - Estimate: NO boxes, NO Due (per request)
      if (docType === "invoice") {
        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.7);
        doc.rect(metaLeft, metaTop, metaW, metaH);

        // 3 equal columns
        const colW = metaW / 3;
        doc.line(metaLeft + colW, metaTop, metaLeft + colW, metaTop + metaH);
        doc.line(metaLeft + colW * 2, metaTop, metaLeft + colW * 2, metaTop + metaH);

        // 2 rows
        doc.line(metaLeft, metaMidY, metaLeft + metaW, metaMidY);

        const labelY = metaTop + 12;
        const valueY = metaTop + metaH - 8;

        const numLabel = "INVOICE #";
        const numValue = String(invoiceNumber || "").trim();
        const dateValue = String(date || "").trim();

        const termsDaysForPdf = Number(customerTermsDays) || 0;

        // Due is derived from Terms (Net 15/30) + Invoice Date
        const dueValue = (() => {
          const base = String(date || "").trim() || todayISO();
          const days = Number(termsDaysForPdf) || 0;
          if (!Number.isFinite(days) || days < 0) return "";
          if (days === 0) return base;
          try {
            const d = new Date(base + "T00:00:00");
            if (Number.isNaN(d.getTime())) return "";
            d.setDate(d.getDate() + days);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            return `${yyyy}-${mm}-${dd}`;
          } catch {
            return "";
          }
        })();

        // Labels
        doc.setTextColor(25, 25, 25);
        doc.setFontSize(10);
        doc.setFont(undefined, "bold");
        doc.text(numLabel, metaLeft + colW * 0.5, labelY, { align: "center" });
        doc.text("DATE", metaLeft + colW * 1.5, labelY, { align: "center" });
        doc.text("DUE", metaLeft + colW * 2.5, labelY, { align: "center" });

        // Values
        doc.setFont(undefined, "normal");
        doc.setFontSize(10);
        doc.text(numValue || "-", metaLeft + colW * 0.5, valueY, { align: "center" });
        doc.text(dateValue ? formatDateMMDDYYYY(dateValue) : "-", metaLeft + colW * 1.5, valueY, { align: "center" });
        doc.text(dueValue ? formatDateMMDDYYYY(dueValue) : "-", metaLeft + colW * 2.5, valueY, { align: "center" });
      } 
else {
  // Estimate: match Invoice-style boxed meta table (3 columns)
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.7);
  doc.rect(metaLeft, metaTop, metaW, metaH);

  // 3 equal columns
  const colW = metaW / 3;
  doc.line(metaLeft + colW, metaTop, metaLeft + colW, metaTop + metaH);
  doc.line(metaLeft + colW * 2, metaTop, metaLeft + colW * 2, metaTop + metaH);

  // 2 rows
  doc.line(metaLeft, metaMidY, metaLeft + metaW, metaMidY);

  const labelY = metaTop + 12;
  const valueY = metaTop + metaH - 8;

  const numLabel = pdfLang === "es" ? "ESTIMACIÓN #" : "ESTIMATE #";
  const dateLabel = pdfLang === "es" ? "FECHA" : "DATE";
  const poLabel = pdfLang === "es" ? "OC" : "PO";

  const numValue = String(estimateNumber || "").trim() || "-";
  const dateValue = String(date || "").trim();
  const poValue = String(poNumber || "").trim();

  // Labels
  doc.setTextColor(25, 25, 25);
  doc.setFontSize(10);
  doc.setFont(undefined, "bold");
  doc.text(numLabel, metaLeft + colW * 0.5, labelY, { align: "center" });
  doc.text(dateLabel, metaLeft + colW * 1.5, labelY, { align: "center" });
  doc.text(poLabel, metaLeft + colW * 2.5, labelY, { align: "center" });

  // Values
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.text(numValue || "-", metaLeft + colW * 0.5, valueY, { align: "center" });
  doc.text(dateValue ? formatDateMMDDYYYY(dateValue) : "-", metaLeft + colW * 1.5, valueY, { align: "center" });
  doc.text(poValue || "-", metaLeft + colW * 2.5, valueY, { align: "center" });
}

// Divider line under header area
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.6);
      doc.line(FRAME_INSET, HEADER_BOTTOM_Y, pageWidth - FRAME_INSET, HEADER_BOTTOM_Y);

      // ---------------------------
      // FOOTER (company info at bottom like the example)
      // ---------------------------
      const footerLeft = FRAME_INSET + 18;
      const footerRight = pageWidth - FRAME_INSET - 18;
      const footerMaxW = footerRight - footerLeft;

      // Divider line above footer
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.6);
      const footerDividerY = pageHeight - FRAME_INSET - 66;
      doc.line(footerLeft, footerDividerY, footerRight, footerDividerY);

      const footerX = pageWidth / 2;
      const footerBaseY = pageHeight - FRAME_INSET - 46;

      // Build footer lines (readable + bounded)
      const line1 = [companyName, contactBits].filter(Boolean).join(" • ");
      const line2 = addressLine || "";
      const line3 = optionalLine || "";

      doc.setTextColor(...TEXT_MUTED);

      // Font sizes: legible, but still compact
      doc.setFontSize(11);
      if (line1) drawFitCenteredText(doc, line1, footerX, footerBaseY, footerMaxW, 11);

      doc.setFontSize(10);
      if (line2) {
        const addrLines = doc.splitTextToSize(String(line2), footerMaxW);
        const a1 = addrLines?.[0] || "";
        const a2 = addrLines?.[1] || "";
        if (a1) doc.text(a1, footerX, footerBaseY + 12, { align: "center" });
        if (a2) doc.text(a2, footerX, footerBaseY + 22, { align: "center" });
      }

      if (line3) {
        doc.setFontSize(10);
        const optLines = doc.splitTextToSize(String(line3), footerMaxW);
        const o1 = optLines?.[0] || "";
        const o2 = optLines?.[1] || "";
        if (o1) doc.text(o1, footerX, footerBaseY + 34, { align: "center" });
        if (o2) doc.text(o2, footerX, footerBaseY + 44, { align: "center" });
      }

      // Reset
      doc.setTextColor(20, 20, 20);
}
    // Swap protected blocks (templates/inserts) to the chosen PDF language
    const descriptionSwapped = pdfLang === lang ? description : swapTemplatesAndInsertsToLang(description, pdfLang);

    // Translate ONLY user-entered custom text (scope + additional notes), while protecting templates/inserts
    // Translation is only needed when exporting a PDF in a DIFFERENT language than the UI (where the user typed).
    let translateFailedConfirmShown = false;

    const translateTextViaApi = async (text, targetLang, sourceLangHint) => {
      const s = String(text || "").trim();
      if (!s) return "";

      // 1) Preferred: your own backend (/api/translate) — where OpenAI key should live.
      const getBackendUrl = () => {
        try {
          const base = String(localStorage.getItem("field-pocket-translate-base") || "")
            .trim()
            .replace(/\/+$/, "");
          return base ? `${base}/api/translate` : "/api/translate";
        } catch (e) {
          return "/api/translate";
        }
      };

      const callBackend = async () => {
        const url = getBackendUrl();
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: s,
            targetLang,
            sourceLang: sourceLangHint || undefined,
            domain: "construction_estimate_pdf",
          }),
        });

        // Treat common "missing" cases explicitly so we can fall back.
        if (resp.status === 404 || resp.status === 405 || resp.status === 501) return { missing: true };
        if (!resp.ok) throw new Error(`translate backend ${resp.status}`);

        const data = await resp.json().catch(() => ({}));
        const out = String(data?.translatedText || "").trim();
        if (!out) throw new Error("empty backend translation");
        return { text: out, missing: false };
      };

      // 2) Fallback: LibreTranslate public instance (no key).
      // Useful for local Cloudflare tunnels when /api/translate isn't implemented yet.
      const callLibreTranslate = async () => {
        const endpoint = "https://libretranslate.com/translate";
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q: s,
            source: sourceLangHint || "auto",
            target: targetLang,
            format: "text",
          }),
        });
        if (!resp.ok) throw new Error(`libretranslate ${resp.status}`);
        const data = await resp.json().catch(() => ({}));
        const out = String(data?.translatedText || "").trim();
        if (!out) throw new Error("empty libretranslate translation");
        return out;
      };

      // 3) Fallback: OpenAI directly from the browser (dev/prototype only).
      // NOTE: This exposes the key to anyone who can view your app. Prefer the backend (/api/translate) for production.
      const callOpenAI = async () => {
        let apiKey = String(openaiKey || "").trim();
        if (!apiKey) {
          try {
            apiKey = String(localStorage.getItem("OPENAI_API_KEY") || "").trim();
          } catch (e) {
            apiKey = "";
          }
        }
        if (!apiKey) return "__NO_KEY__";

        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0,
            messages: [
              {
                role: "system",
                content:
                  "You are a translation engine. Translate the user's text faithfully. Return ONLY the translated text, no quotes, no explanations.",
              },
              {
                role: "user",
                content: `Translate to ${targetLang.toUpperCase()}:\n\n${s}`,
              },
            ],
          }),
        });

        if (!resp.ok) throw new Error(`openai ${resp.status}`);
        const data = await resp.json().catch(() => ({}));
        const out = String(data?.choices?.[0]?.message?.content || "").trim();
        if (!out) throw new Error("empty openai translation");
        return out;
      };

      try {
        const backendRes = await callBackend();
        if (!backendRes.missing) return backendRes.text;

        // Backend missing → try no-key fallback first (LibreTranslate)
        try {
          return await callLibreTranslate();
        } catch (e) {
          // ignore and try OpenAI (if key exists)
        }

        const openaiOut = await callOpenAI();
        if (openaiOut !== "__NO_KEY__") return openaiOut;

        return "__MISSING_API__";
      } catch (err) {
        // Backend exists but failed, or other error — try OpenAI, then LibreTranslate.
        try {
          const openaiOut = await callOpenAI();
          if (openaiOut !== "__NO_KEY__") return openaiOut;
        } catch (e) {
          // ignore
        }

        try {
          return await callLibreTranslate();
        } catch (e) {
          return "__MISSING_API__";
        }
      }
    };

    // Prepare scope + notes for PDF (and optional revert-to-English behavior)
    let descriptionForPdf = String(description || "");
    let additionalNotesForPdf = String(additionalNotesText || "");

    // Translate ONLY user-entered custom text when exporting to a different PDF language.
    // Templates/labels are already rendered via the PDF language dictionary (tPdf), so we do not translate those here.
    if (pdfLang !== lang) {
      // 1) Swap known templates deterministically so templates always match the PDF language
      //    (do NOT rely on the translator for these).
      const swappedDesc = swapTemplatesAndInsertsToLang(descriptionForPdf, pdfLang);

      // 2) Mask templates + trade inserts so ONLY the user's free-form text is translated.
      //    We include blocks from BOTH languages to be safe.
      const protectedBlocks = [
        ...SCOPE_MASTER_TEMPLATES.map((x) => x.text),
        ...SCOPE_MASTER_TEMPLATES_ES.map((x) => x.text),
        ...SCOPE_TRADE_INSERTS.map((x) => x.text),
      ].filter(Boolean);

      const masked = maskProtectedText(swappedDesc, protectedBlocks);
      const translatedMasked = await translateTextViaApi(masked.masked, pdfLang, lang);

      if (translatedMasked === "__MISSING_API__") {
        // No translation backend configured; export using the original (untranslated) text.
        descriptionForPdf = swappedDesc;
      } else if (translatedMasked && translatedMasked !== "__ERROR__") {
        const unmasked = unmaskProtectedText(translatedMasked, masked.tokens);
        // If the translator mangled our tokens, fall back to the swapped template-only version.
        descriptionForPdf = unmasked.includes("[[PROTECTED_") ? swappedDesc : unmasked;
      } else {
        descriptionForPdf = swappedDesc;
      }

      const translatedNotes = await translateTextViaApi(additionalNotesForPdf, pdfLang, lang);
      if (translatedNotes && translatedNotes !== "__MISSING_API__" && translatedNotes !== "__ERROR__") {
        additionalNotesForPdf = translatedNotes;
      }
    }

    const scopeNotesForPdf = extractScopeNotesForPdf(descriptionForPdf);
    const scopeNotes = String(scopeNotesForPdf || "").trim() || "-";

    const tradeInserts = extractAllTradeInserts(descriptionForPdf);
    const tradeInsertText = tradeInserts.length ? tradeInserts.join("\n\n") : "";
    const attn = String(profile.attn || "").trim();
    const clientAttn = String(customerAttn || "").trim();

    const hasTradeInserts = tradeInserts.length > 0;


const jobRows = [
      [tPdf("pdfDate"), formatDateMMDDYYYY(date) || "-"],
      ...(attn ? [[tPdf("pdfAttn"), attn]] : []),
      [tPdf("pdfClient"), client || "-"],
      ...(clientAttn ? [[tPdf("pdfClientAttn"), clientAttn]] : []),
      ...(docType === "invoice" && location ? [[tPdf("pdfLocation"), location]] : []),
      // ✅ Project (shown on PDF)
      ...(String(projectName || "").trim() ? [[tPdf("pdfProjectName"), String(projectName || "").trim()]] : []),
      ...(String(projectNumber || "").trim() ? [[tPdf("pdfProjectNumber"), String(projectNumber || "").trim()]] : []),
      ...((() => {
        const useCust = Boolean(projectAddressSameAsCustomer);
        const addr = useCust ? String(location || "").trim() : String(projectAddress || "").trim();
        return addr ? [[tPdf("pdfProjectAddress"), addr]] : [];
      })()),
      ...(String(poNumber || "").trim() ? [[tPdf("pdfPO"), String(poNumber || "").trim()]] : []),

      // Estimates: Scope/Notes + Trade Inserts are rendered as their own sections (below Job Info)
    ];

    // =========================
// JOB HEADER BLOCK (Invoice-style layout)
// =========================
if (docType === "invoice" || docType === "estimate") {
  const billToLabel = pdfLang === "es" ? "FACTURAR A" : "BILL TO";
  const customerLabel = pdfLang === "es" ? "CLIENTE" : "CUSTOMER";
  const projectLabel = pdfLang === "es" ? "PROYECTO" : "PROJECT";

  const custName = String(client || "").trim();
  const custAddr = String(location || "").trim();
  const billAddr = billingDiff ? String(billingAddress || "").trim() : custAddr;

  const attnLine = String(customerAttn || "").trim();

  const billToText = [custName, attnLine ? `ATTN: ${attnLine}` : "", billAddr]
    .filter(Boolean)
    .join("\n") || "-";
  const customerText = [custName, attnLine ? `ATTN: ${attnLine}` : "", custAddr].filter(Boolean).join("\n") || "-";

  const projectBits = [];
  const pName = String(projectName || "").trim();
  const pNum = String(projectNumber || "").trim();
  const pAddr = (() => {
    const useCust = Boolean(projectAddressSameAsCustomer);
    const addr = useCust ? String(location || "").trim() : String(projectAddress || "").trim();
    return addr;
  })();

  if (pName) projectBits.push(pName);
  if (pNum) projectBits.push(pNum);
  if (pAddr) projectBits.push(pAddr);

  const projectText = projectBits.join("\n") || "-";

  autoTable(doc, {
    startY: 114,
    head: [[billToLabel, customerLabel, projectLabel]],
    body: [[billToText, customerText, projectText]],
    theme: "plain",
    tableLineWidth: 0,
    tableLineColor: [255, 255, 255],
    styles: {
      fontSize: 10.5,
      cellPadding: 4,
      lineWidth: 0,
      lineColor: [255, 255, 255],
      fillColor: [255, 255, 255],
      textColor: [20, 20, 20],
      valign: "top",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [20, 20, 20],
      fontStyle: "bold",
      lineWidth: 0,
    },
    bodyStyles: { lineWidth: 0, fillColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    margin: { top: 114, left: TABLE_INSET, right: TABLE_INSET, bottom: TABLE_INSET },
    willDrawPage: () => {
      drawHeader();
    },
  });
} else {
  // Fallback: single-column job info table (shouldn't normally be hit)
  autoTable(doc, {
    startY: 114,
    head: [[tPdf("pdfJobInfoHead"), ""]],
    body: jobRows,
    theme: "plain",
    tableLineWidth: 0,
    tableLineColor: [255, 255, 255],
    styles: {
      fontSize: 10.5,
      cellPadding: 5,
      valign: "top",
      lineColor: [255, 255, 255],
      lineWidth: 0,
      fillColor: [255, 255, 255],
      textColor: [20, 20, 20],
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [20, 20, 20],
      fontStyle: "bold",
      lineWidth: 0,
    },
    bodyStyles: { lineWidth: 0, fillColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 70, fontStyle: "bold", fillColor: [255, 255, 255] },
      1: { cellWidth: INNER_W - 70 },
    },
    margin: { top: 114, left: TABLE_INSET, right: TABLE_INSET, bottom: TABLE_INSET },
    willDrawPage: () => {
      drawHeader();
    },
  });
}

    // =========================
    // ESTIMATE: TRADE INSERTS (separate section)
    // =========================
    const tradeRawForPdf = String(tradeInsertText || "").trim();
    if (docType === "estimate" && hasTradeInserts && tradeRawForPdf) {
      let tradeStartY = (doc.lastAutoTable?.finalY || 114) + 10;
      const minTradeBlock = 60;
      const remainingForTrade = pageHeight - TABLE_INSET - tradeStartY;
      if (remainingForTrade < minTradeBlock) {
        doc.addPage();
        drawHeader();
        tradeStartY = 114;
      }

      autoTable(doc, {
        startY: tradeStartY,
        head: [[pdfLang === "es" ? "INSERCIONES DE OFICIO" : "TRADE INSERTS"]],
        body: [[tradeRawForPdf]],
        theme: "plain",
        styles: {
          fontSize: 10.5,
          cellPadding: 6,
          valign: "top",
          lineColor: [255, 255, 255],
          lineWidth: 0,
          fillColor: [255, 255, 255],
          textColor: [20, 20, 20],
        },
        headStyles: {
          fillColor: [242, 244, 247],
          textColor: [20, 20, 20],
          fontStyle: "bold",
          lineWidth: 0,
        },
        bodyStyles: { lineWidth: 0, fillColor: [255, 255, 255] },
        margin: { top: 114, left: TABLE_INSET, right: TABLE_INSET, bottom: TABLE_INSET },
        willDrawPage: () => {
          drawHeader();
        },
      });
    }

    
    // =========================
    // ITEMIZED LINE ITEMS (Estimate + Invoice)
    // Columns: Description | Qty | Price (each) | Total
    // =========================
    const hdrDesc = "";
    const hdrQty = pdfLang === "es" ? "Cant." : "Qty";
    const hdrEach = pdfLang === "es" ? "Precio (c/u)" : "Price (each)";
    const hdrLineTotal = pdfLang === "es" ? "Total" : "Total";

    let itemY = doc.lastAutoTable.finalY + 10;

    if (pdfLaborItemized) {

    const laborItemRows = (laborLines || []).map((l) => {
      const q = Math.max(1, Number(l?.qty) || 1);
      const hrs = Number(l?.hours) || 0;
      const rate = Number(l?.rate) || 0;
      const each = (Number.isFinite(hrs) ? hrs : 0) * (Number.isFinite(rate) ? rate : 0);
      const lineTotal = q * each;
      const label = String(l?.label || "").trim() || "-";
      return [label, String(q), money.format(each), money.format(lineTotal)];
    });

    if (!laborItemRows.length) {
      laborItemRows.push([
        pdfLang === "es" ? "Mano de obra" : "Labor",
        "1",
        money.format(laborAdjusted),
        money.format(laborAdjusted),
      ]);
    }

    itemY = doc.lastAutoTable.finalY + 10;

    // Section header bar
    doc.setFillColor(242, 244, 247);
    doc.rect(TABLE_INSET, itemY + 2, INNER_W, 16, "F");
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.text(pdfLang === "es" ? "Partidas de mano de obra" : "Labor line items", TABLE_INSET + 6, itemY + 13);
    doc.setFont(undefined, "normal");

    autoTable(doc, {
      startY: itemY + 22,
      head: [[hdrDesc, hdrQty, hdrEach, hdrLineTotal]],
      body: laborItemRows,
      theme: "plain",
      styles: {
        fontSize: 10.5,
        cellPadding: 5,
        valign: "top",
        lineColor: BORDER,
        lineWidth: 0,
        textColor: [20, 20, 20],
      },
      headStyles: {
        fillColor: [242, 244, 247],
        textColor: [20, 20, 20],
        fontStyle: "bold",
      },
      didDrawCell: (data) => {
        // High-end bid look: subtle horizontal rules, no boxy grid
        if (data.column.index !== 0) return;
        const y = Number(data.cell.y) + Number(data.cell.height);
        if (!Number.isFinite(y)) return;
        doc.setDrawColor(215, 218, 224);
        doc.setLineWidth(0.35);
        doc.line(TABLE_INSET, y, TABLE_INSET + INNER_W, y);
      },
      columnStyles: {
        0: { cellWidth: INNER_W - (40 + 80 + 80) },
        1: { cellWidth: 40, halign: "right" },
        2: { cellWidth: 80, halign: "right" },
        3: { cellWidth: 80, halign: "right" },
      },
      margin: { top: 114, left: TABLE_INSET, right: TABLE_INSET, bottom: TABLE_INSET },
      willDrawPage: () => {
        drawHeader();
      },
    });

    itemY = doc.lastAutoTable.finalY + 10;
  }

    const shouldShowMaterialsSection = (() => {
      if (materialsMode === "itemized") {
        const items = materialItems || [];
        return items.some((it) => {
          const desc = String(it?.desc ?? it?.description ?? it?.name ?? "").trim();
          const q = Number(it?.qty) || 0;
          const each = Number(it?.charge) || 0;
          return desc.length > 0 || q > 0 || each > 0;
        });
      }
      return (Number(materialsBilled) || 0) > 0;
    })();

    const materialsItemRows = (() => {
      if (!shouldShowMaterialsSection) return [];
      // If user is in itemized materials mode, show each item as a line.
      if (materialsMode === "itemized" && (materialItems || []).length) {
        return (materialItems || []).map((it) => {
          const desc = String(it?.desc ?? it?.description ?? it?.name ?? "").trim() || "-";
          const q = Math.max(1, Number(it?.qty) || 1);
          const each = Number(it?.charge) || 0;
          const lineTotal = q * each;
          return [desc, String(q), money.format(each), money.format(lineTotal)];
        });
      }
      // Otherwise show a single materials line item.
      return [
        [
          pdfLang === "es" ? "Materiales" : "Materials",
          "1",
          money.format(materialsBilled),
          money.format(materialsBilled),
        ],
      ];
    })();;

    if (shouldShowMaterialsSection) {

    itemY = doc.lastAutoTable.finalY + 10;

    // Section header bar
    doc.setFillColor(242, 244, 247);
    doc.rect(TABLE_INSET, itemY + 2, INNER_W, 16, "F");
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.text(pdfLang === "es" ? "Programa de materiales" : "Material Schedule", TABLE_INSET + 6, itemY + 13);
    doc.setFont(undefined, "normal");

    autoTable(doc, {
      startY: itemY + 22,
      head: [[hdrDesc, hdrQty, hdrEach, hdrLineTotal]],
      body: materialsItemRows,
      theme: "plain",
      styles: {
        fontSize: 10.5,
        cellPadding: 5,
        valign: "top",
        lineColor: BORDER,
        lineWidth: 0,
        textColor: [20, 20, 20],
        fillColor: [255, 255, 255],
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [20, 20, 20],
        fontStyle: "bold",
        lineWidth: 0,
      },
      didDrawCell: (data) => {
        // High-end bid look: subtle horizontal rules, no boxy grid
        if (data.column.index !== 0) return;
        const y = Number(data.cell.y) + Number(data.cell.height);
        if (!Number.isFinite(y)) return;
        doc.setDrawColor(215, 218, 224);
        doc.setLineWidth(0.35);
        doc.line(TABLE_INSET, y, TABLE_INSET + INNER_W, y);
      },
      columnStyles: {
        0: { cellWidth: INNER_W - (40 + 80 + 80) },
        1: { cellWidth: 40, halign: "right" },
        2: { cellWidth: 80, halign: "right" },
        3: { cellWidth: 80, halign: "right" },
      },
      margin: { top: 114, left: TABLE_INSET, right: TABLE_INSET, bottom: TABLE_INSET },
      willDrawPage: () => {
        drawHeader();
      },
    });

    // Divider between sections (prevents wonky seam)
    try {
      const yDiv = Number(doc.lastAutoTable?.finalY);
      if (Number.isFinite(yDiv)) {
        doc.setDrawColor(215, 218, 224);
        doc.setLineWidth(0.45);
        doc.line(TABLE_INSET, yDiv, TABLE_INSET + INNER_W, yDiv);
      }
    } catch {}


  }

const summaryRows = [
      [tPdf("pdfLabor"), money.format(laborAdjusted)],
    ];
    if ((Number(materialsBilled) || 0) > 0) {
      summaryRows.push([tPdf("pdfMaterials"), money.format(materialsBilled)]);
    }
    if (hazardEnabled) {
      summaryRows.push([tPdf("pdfHazard", hazardPctNormalized), money.format(hazardFeeDollar)]);
    }
    // Estimates: label the final line clearly
    const totalLabelForPdf =
      docType === "estimate"
        ? (pdfLang === "es" ? "Total estimado" : "Estimated total")
        : tPdf("pdfTotal");
    summaryRows.push([totalLabelForPdf, money.format(total)]);


    // Prevent "Totals" header orphaning at bottom of page (head-only on prior page)
    let totalsStartY = (doc.lastAutoTable?.finalY || 114) + 6;
    const minTotalsBlock = 54; // head + at least 1 body row
    const remainingForTotals = pageHeight - TABLE_INSET - totalsStartY;
    if (remainingForTotals < minTotalsBlock) {
      doc.addPage();
      drawHeader();
      totalsStartY = 114;
    }

    autoTable(doc, {
      startY: totalsStartY,
      head: [[tPdf("pdfTotalsHead"), ""]],
      body: summaryRows,
      theme: "plain",
      styles: {
        fontSize: 12,
        cellPadding: 5,
        lineColor: BORDER,
        lineWidth: 0,
        textColor: [20, 20, 20],
      },
      headStyles: {
        fillColor: [242, 244, 247],
        textColor: [20, 20, 20],
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: INNER_W - 90 },
        1: { cellWidth: 90, halign: "right", overflow: "visible" },
      },
      margin: { top: 114, left: TABLE_INSET, right: TABLE_INSET, bottom: TABLE_INSET },
      didParseCell: (data) => {
        if (data.section === "body" && data.row.index === summaryRows.length - 1) {
          data.cell.styles.fillColor = SHADE;
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fontSize = 12;
        }
      },
      willDrawPage: () => {
        drawHeader();
      },
    });

    const marginLeft = 14;
    const marginRight = 14;
    const usableWidth = pageWidth - marginLeft - marginRight;

    const notesRaw = String(additionalNotesForPdf || "").trim();
    const notesHas = Boolean(notesRaw);

    // ✅ Terms & Conditions (based on selected payment terms)
    const termsDaysForPdf = Number(customerTermsDays || 0) || 0;
    const termsLabel =
      termsDaysForPdf === 30 ? (pdfLang === "es" ? "Neto 30" : "Net 30") :
      termsDaysForPdf === 15 ? (pdfLang === "es" ? "Neto 15" : "Net 15") :
      (pdfLang === "es" ? "Al recibir" : "Due upon receipt");

    const termsNotice =
      termsDaysForPdf === 0
        ? (pdfLang === "es" ? "Pago vence al recibir la factura." : "Payment due upon receipt.")
        : (pdfLang === "es"
            ? `Pago vence dentro de ${termsDaysForPdf} días de la fecha de factura.`
            : `Payment due within ${termsDaysForPdf} days of invoice date.`);

    let y = doc.lastAutoTable.finalY + 10;

    const newPage = () => {
      doc.addPage();
      drawHeader();
      y = 114;
    };

    const ensureSpace = (neededHeightPt = 0) => {
      const bottom = pageHeight - 14;
      if (y + neededHeightPt > bottom) newPage();
    };

    // Helpers to avoid "jumbled" small text:
    // jsPDF uses points, so line height must be based on font size (NOT a tiny constant).
    const lineHeight = (fontSizePt) => Math.max(11, Math.round(fontSizePt * 1.25));

    const writeWrapped = (textValue, fontSizePt, colorTuple, prefix = "") => {
      const raw = String(textValue || "").trim();
      if (!raw) return;

      doc.setFontSize(fontSizePt);
      if (Array.isArray(colorTuple)) doc.setTextColor(...colorTuple);

      const full = prefix ? `${prefix}${raw}` : raw;
      const lines = doc.splitTextToSize(full, usableWidth);

      const lh = lineHeight(fontSizePt);
      ensureSpace(lines.length * lh);

      for (const line of lines) {
        doc.text(String(line), marginLeft, y);
        y += lh;
      }
    };

    // Terms + Additional Notes (small text area under totals)
    const termsFont = 9;
    const notesHeadFont = 10;
    const notesBodyFont = 9;
    if (notesHas) {
      doc.setFontSize(notesHeadFont);
      doc.setTextColor(20, 20, 20);
      ensureSpace(lineHeight(notesHeadFont));
      doc.text(tPdf("pdfAdditionalNotes"), marginLeft, y);
      y += lineHeight(notesHeadFont) - 1;

      doc.setTextColor(...TEXT_MUTED);

      const paragraphs = notesRaw
        .split(/\n\s*\n/g)
        .map((p) => p.trim())
        .filter(Boolean);

      for (const p of paragraphs) {
        const bullet = `• ${p}`;
        const wrapped = doc.splitTextToSize(bullet, usableWidth);
        const lh = lineHeight(notesBodyFont);

        // page break before a paragraph if it won't fit
        const needed = wrapped.length * lh + 4;
        const bottom = pageHeight - 14;
        if (y + needed > bottom) {
          newPage();
          doc.setFontSize(notesHeadFont);
          doc.setTextColor(20, 20, 20);
          doc.text(tPdf("pdfAdditionalNotesCont"), marginLeft, y);
          y += lineHeight(notesHeadFont) - 1;
          doc.setTextColor(...TEXT_MUTED);
        }

        doc.setFontSize(notesBodyFont);
        ensureSpace(wrapped.length * lh);

        for (const line of wrapped) {
          doc.text(String(line), marginLeft, y);
          y += lh;
        }

        y += 3;
      }
    }
    // Terms & Conditions (below Additional Notes)
    if (docType === "invoice") {
      const boxTitle = pdfLang === "es" ? "Términos y condiciones" : "Terms & Conditions";
      const boxText = `${termsLabel}. ${termsNotice}`;

      const boxFont = 9;
      const boxPad = 7;
      doc.setFontSize(boxFont);
      const lines = doc.splitTextToSize(boxText, usableWidth - boxPad * 2);
      const lh = lineHeight(boxFont);
      const titleH = lh;
      const boxH = titleH + 10 + lines.length * lh + boxPad * 2;

      ensureSpace(boxH + 6);

      // Border box spanning width inside the frame
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.7);
      doc.roundedRect(marginLeft, y, usableWidth, boxH, 4, 4);

      // Title
      doc.setFont(undefined, "bold");
      doc.setTextColor(25, 25, 25);
      doc.text(boxTitle, marginLeft + boxPad, y + boxPad + boxFont);

      // Body
      const bodyY0 = y + boxPad + titleH + 10;
      doc.setFont(undefined, "normal");
      doc.setTextColor(...TEXT_MUTED);

      let ty = bodyY0;
      for (const line of lines) {
        doc.text(String(line), marginLeft + boxPad, ty);
        ty += lh;
      }

      y += boxH + 10;
      doc.setTextColor(20, 20, 20);
    }


    // Footer note
    const footer = tPdf("pdfFooter");
    writeWrapped(footer, 9, TEXT_MUTED);

    const filePrefix = docType === "invoice" ? "Invoice" : "Estimate";
    const invPart = docType === "invoice" && invNum ? `-${invNum}` : "";
    const filename = `${filePrefix}${invPart}-${safeFilename(client)}-${pdfLang}-${Date.now()}.pdf`;


    // ✅ Auto-save customer + project on successful PDF export (no extra buttons)
    try {
      if (String(client || "").trim()) {
        setCustomers((prev) =>
          upsertCustomer(prev, {
            name: client,
            phone: customerPhone,
            email: customerEmail,
            address: location,
            billingDiff,
            billingAddress,
            projectName,
            projectNumber,
            termsDays: customerTermsDays,
            projectSameAsCustomer: projectAddressSameAsCustomer,
            projectAddress: projectAddressSameAsCustomer ? String(location || "").trim() : String(projectAddress || "").trim(),
          })
        );
      }
    } catch (e) {
      // ignore
    }


if (mode === "view") {
  try {
    const ab = doc.output("arraybuffer");
    const blob = new Blob([ab], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    // Open PDF in a new tab/window for preview
    window.open(url, "_blank", "noopener,noreferrer");
    // Revoke later to avoid breaking the open tab immediately
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 60000);
  } catch (e) {
    // If preview fails, fall back to download
    try { doc.save(filename); } catch (e2) {}
  }
  return;
}

    if (mode === "share") {
      // IMPORTANT (iOS home screen / standalone):
      // Opening a blob URL often lands in the PDF viewer with disabled controls.
      // Prefer Web Share with a File attachment; otherwise fall back to download.
      try {
        // More compatible than doc.output("blob") on iOS:
        const ab = doc.output("arraybuffer");
        const blob = new Blob([ab], { type: "application/pdf" });

        // iOS share sheets prefer a File when possible
        let file = null;
        try {
          file = new File([blob], filename, { type: "application/pdf" });
        } catch (e) {
          file = null;
        }

        const hasShare = typeof navigator !== "undefined" && !!navigator.share;

        if (hasShare && file) {
          // Some browsers don't expose navigator.canShare; still try share() first.
          try {
            const sharePromise = navigator.share({
              files: [file],
              title: filename,
              text: docType === "invoice" ? "Invoice PDF" : "Estimate PDF",
            });

            // If share() returns a Promise, stop here and fallback to download only if it rejects.
            if (sharePromise && typeof sharePromise.then === "function") {
              sharePromise.catch(() => {
                try {
                  doc.save(filename);
                } catch (e2) {
                  window.alert("Could not share or download the PDF on this device.");
                }
              });
              return;
            }
            // If share() doesn't return a Promise for some reason, just proceed to download fallback.
          } catch (e) {
            // fall through to download
          }
        }

        // Fallback: download (user can then share/print from Files)
        doc.save(filename);
      } catch (e) {
        try {
          doc.save(filename);
        } catch (e) {
          window.alert("Could not share or download the PDF on this device.");
        }
      }
      return;
    }

    doc.save(filename);
  };

  const LanguageToggle = () => {
    const setLangUi = (next) => {
      triggerHaptic();
      if (next !== "en" && next !== "es") return;
      setLanguage(next);
    };

    const wrapStyle = {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: 3,
      borderRadius: 999,
      border: "1px solid rgba(0,0,0,0.12)",
      background: "rgba(255,255,255,0.55)",
      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
    };

    const btnStyle = (active) => ({
      padding: "8px 14px",
      borderRadius: 999,
      border: active ? "1px solid rgba(0,0,0,0.22)" : "1px solid transparent",
      cursor: "pointer",
      fontWeight: active ? 800 : 700,
      background: active ? "rgba(0,0,0,0.18)" : "transparent",
      boxShadow: active ? "0 1px 2px rgba(0,0,0,0.18)" : "none",
      color: active ? "rgba(0,0,0,0.92)" : "rgba(0,0,0,0.70)",
    });

return (
      <div style={wrapStyle} title={t("language")}>
        <button
          type="button"
          onClick={() => setLangUi("en")}
          style={btnStyle(lang === "en")}
          aria-pressed={lang === "en"}
        >
          EN
        </button>
        <button
          type="button"
          onClick={() => setLangUi("es")}
          style={btnStyle(lang === "es")}
          aria-pressed={lang === "es"}
        >
          ES
        </button>
      </div>
    );
  };


  const ThemeToggle = () => {
    const wrapStyle = {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: 3,
      borderRadius: 999,
      border: "1px solid rgba(0,0,0,0.12)",
      background: "rgba(255,255,255,0.55)",
      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
    };

    const btnStyle = (active) => ({
      padding: "8px 12px",
      borderRadius: 999,
      border: active ? "1px solid rgba(0,0,0,0.22)" : "1px solid transparent",
      cursor: "pointer",
      fontWeight: active ? 800 : 700,
      background: active ? "rgba(0,0,0,0.18)" : "transparent",
      boxShadow: active ? "0 1px 2px rgba(0,0,0,0.18)" : "none",
      color: active ? "rgba(0,0,0,0.92)" : "rgba(0,0,0,0.70)",
      minWidth: 40,
    });

return (
      <div style={wrapStyle} title={lang === "es" ? "Tema" : "Theme"}>
        <button
          type="button"
          onClick={() => setThemeSafe("auto")}
          style={btnStyle(theme === "auto")}
          aria-pressed={theme === "auto"}
        >
          A
        </button>
        <button
          type="button"
          onClick={() => setThemeSafe("light")}
          style={btnStyle(theme === "light")}
          aria-pressed={theme === "light"}
        >
          ☀
        </button>
        <button
          type="button"
          onClick={() => setThemeSafe("dark")}
          style={btnStyle(theme === "dark")}
          aria-pressed={theme === "dark"}
        >
          🌙
        </button>
      </div>
    );
  };

  const DocTypeToggle = () => {
    const setDocSafe = (next) => {
      triggerHaptic();
      if (next !== "estimate" && next !== "invoice") return;
      setDocType(next);
    };

    return (
      <div
        style={{
          marginTop: 8,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: 3,
            borderRadius: 999,
            border: "1px solid rgba(0,0,0,0.12)",
            background: "rgba(255,255,255,0.55)",
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
          }}
          title={t("estimateToInvoice")}
        >
          <button
            type="button"
            className="pe-btn pe-btn-ghost"
            onClick={() => setDocSafe("estimate")}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              fontWeight: docType === "estimate" ? 800 : 700,
              border: docType === "estimate" ? "1px solid rgba(0,0,0,0.22)" : "1px solid transparent",
              background: docType === "estimate" ? "rgba(0,0,0,0.18)" : "transparent",
              boxShadow: docType === "estimate" ? "0 1px 2px rgba(0,0,0,0.18)" : "none",
              color: docType === "estimate" ? "rgba(0,0,0,0.92)" : "rgba(0,0,0,0.70)",
              minWidth: 92,
            }}
          >
            {t("estimate")}
          </button>
          <button
            type="button"
            className="pe-btn pe-btn-ghost"
            onClick={() => setDocSafe("invoice")}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              fontWeight: docType === "invoice" ? 800 : 700,
              border: docType === "invoice" ? "1px solid rgba(0,0,0,0.22)" : "1px solid transparent",
              background: docType === "invoice" ? "rgba(0,0,0,0.18)" : "transparent",
              boxShadow: docType === "invoice" ? "0 1px 2px rgba(0,0,0,0.18)" : "none",
              color: docType === "invoice" ? "rgba(0,0,0,0.92)" : "rgba(0,0,0,0.70)",
              minWidth: 92,
            }}
          >
            {t("invoice")}
          </button>
        </div>
      </div>
    );
  };

  const grossNumbers = useMemo(() => {
const laborCost = Number(laborTrueCost) || 0;
    const materialsCostTrue = Number(materialsTrueCost) || 0;

    const revenue = Number(total) || 0;
    const totalCost = laborCost + materialsCostTrue;
    const grossProfit = revenue - totalCost;
    const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    return { laborCost, materialsCostTrue, totalCost, revenue, grossProfit, grossMarginPct };
  }, [laborLines, materialsMode, materialItems, materialsCost, total]);

  
  /* =========================
     AI DRAFT MODE (BETA) — LOCAL RULES ENGINE (NO API YET)
     Guided conversation that collects key variables, then generates draft lines.
     ========================= */

  const AI_DRAFT_DEFAULTS = useMemo(
    () => ({
      trade: aiTrade || "painting",
      scopeType: "",
      rooms: "",
      sqft: "",
      ceilingHeight: "",
      coats: "2",
      prep: "light",
      includeCeilings: null,
      includeTrimDoors: null,
      stance: "mid",
      complexity: "normal",
      needForeman: "",
    }),
    [aiTrade]
  );
const aiReady = useMemo(() => {
    const s = aiDraftState || AI_DRAFT_DEFAULTS;
    const hasScope = s.scopeType === "interior" || s.scopeType === "exterior";
    const hasSize = Boolean(String(s.sqft || "").trim()) || Boolean(String(s.rooms || "").trim());
    const hasCeil = Boolean(String(s.ceilingHeight || "").trim());
    const hasCoats = Boolean(String(s.coats || "").trim());
    const hasPrep = Boolean(String(s.prep || "").trim());
    const needsCeil = s.scopeType === "interior";
    const needsExtStories = s.scopeType === "exterior";
    const hasCeilFinal = needsCeil ? hasCeil : true;
    const hasExt = needsExtStories ? (Boolean(String(s.extStories || "").trim()) || Boolean(String(s.sqft || "").trim())) : true;
    return hasScope && hasSize && hasCeilFinal && hasCoats && hasPrep && hasExt;
  }, [aiDraftState, AI_DRAFT_DEFAULTS]);

  function aiPush(role, text) {
    const clean = String(text || "");
    const key = `${role}|${clean}`;
    const now = Date.now();
// Strong de-dupe: if the last assistant message is identical, don't spam the chat.
if (role === "assistant") {
  try {
    const last = Array.isArray(aiMessages) && aiMessages.length ? aiMessages[aiMessages.length - 1] : null;
    if (last && last.role === "assistant" && String(last.text || "") === clean) return;
  } catch {
    // ignore
  }
}
    // De-dupe identical consecutive messages (React StrictMode / double-invoke protection)
    if (aiLastPushRef.current && aiLastPushRef.current.key === key && now - aiLastPushRef.current.t < 800) {
      return;
    }
    aiLastPushRef.current = { key, t: now };
    const msg = { id: `${now}-${Math.random().toString(16).slice(2)}`, role, text: clean };
    setAiMessages((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      // also guard against same last item
      const last = list[list.length - 1];
      if (last && last.role === role && String(last.text || "") === clean) return list;
      return [...list, msg];
    });
  }

  function aiClearSession() {
    triggerHaptic();
    setAiInput("");
    setAiMessages([]);
    setAiDraftState({ ...AI_DRAFT_DEFAULTS });
  }

  function aiOpen() {
    triggerHaptic();
    setShowAIDraft(true);
    // Start a fresh guided prompt only if empty
    setAiMessages((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.length > 0) return list;
      // seed
      const hello =
        lang === "es"
          ? "Modo Borrador IA (Beta). Dime del trabajo y te guío con preguntas cortas."
          : "AI Draft Mode (Beta). Tell me about the job and I’ll guide you with quick questions.";
      return [{ id: `seed-${Date.now()}`, role: "assistant", text: hello }];
    });
    setAiDraftState((prev) => ({ ...AI_DRAFT_DEFAULTS, ...(prev || {}) }));
  }

  function aiClose() {
    triggerHaptic();
    setShowAIDraft(false);
  }

  function _aiNorm(s) {
    return String(s || "").toLowerCase();
  }

  function _aiParseNumberFromWords(s) {
    // minimal english number words (one..twelve) for "two coats"
    const map = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
    };
    const w = _aiNorm(s).trim();
    return map[w] || null;
  }

  function aiApplyTextToStatePure(prev0, text) {
    const raw = String(text || "");
    const s = _aiNorm(raw);

    const prev = prev0 || { ...AI_DRAFT_DEFAULTS };
    const next = { ...prev };

      // trade detection (future)
      if (/\b(paint|painting|repaint|pintar|pintura)\b/.test(s)) next.trade = "painting";

      // scope type
      if (/\b(interior|inside|indoors|int)\b/.test(s) || /\b(interior|adentro|interiores)\b/.test(s)) next.scopeType = "interior";
      if (/\b(exterior|outside|outdoors|ext)\b/.test(s) || /\b(exterior|afuera|exteriores)\b/.test(s)) next.scopeType = "exterior";

      // include toggles
      if (/\b(ceiling|ceilings|techo|techos)\b/.test(s)) next.includeCeilings = true;
      if (/\b(walls only|solo paredes|sólo paredes)\b/.test(s)) next.includeCeilings = false;
      if (/\b(trim|baseboard|baseboards|doors|door|molding|moulding|marcos|puertas|zoclo|zócalo)\b/.test(s)) next.includeTrimDoors = true;

      // prep
      if (/\b(light prep|light repair|minor prep|touch up|touch-up|ligera|leve)\b/.test(s)) next.prep = "light";
      if (/\b(medium prep|moderate|med)\b/.test(s) || /\b(media)\b/.test(s)) next.prep = "medium";
      if (/\b(heavy prep|heavy repair|a lot of patch|lots of patch|heavy)\b/.test(s) || /\b(pesada|fuerte)\b/.test(s)) next.prep = "heavy";

      // stance
      if (/\b(lowball|low)\b/.test(s) || /\b(barato|competitivo)\b/.test(s)) next.stance = "low";
      if (/\b(mid|middle|standard|typical)\b/.test(s) || /\b(normal|estandar|estándar)\b/.test(s)) next.stance = "mid";
      if (/\b(high|safe|padded)\b/.test(s) || /\b(seguro|con margen)\b/.test(s)) next.stance = "high";

      // complexity
      if (/\b(simple|open|easy)\b/.test(s) || /\b(sencillo|fácil)\b/.test(s)) next.complexity = "simple";
      if (/\b(cut[-\s]?up|lots of corners|detailed)\b/.test(s) || /\b(recortado|muchos cortes)\b/.test(s)) next.complexity = "cutup";
      if (/\b(normal|standard)\b/.test(s) || /\b(normal)\b/.test(s)) next.complexity = "normal";

      // bedrooms / rooms
      const bedMatch = s.match(/(\d+)\s*(bed|bedroom|br)\b/);
      const roomMatchEs = s.match(/(\d+)\s*(recamara|recámaras|recamara(s)?|habitacion|habitaciones)\b/);
      if (bedMatch && bedMatch[1]) next.rooms = String(parseInt(bedMatch[1], 10) || "");
      if (roomMatchEs && roomMatchEs[1]) next.rooms = String(parseInt(roomMatchEs[1], 10) || "");

      // sqft
      const sqftMatch = s.match(/(\d{3,5})\s*(sq\s*ft|sqft|sf)\b/);
      if (sqftMatch && sqftMatch[1]) next.sqft = String(parseInt(sqftMatch[1], 10) || "");

      // exterior stories / levels (accept "1 story", "2 stories", "one story", "dos pisos", etc.)
      const storiesMatch = s.match(/\b(\d)\s*(story|stories|level|levels|floor|floors|pisos?|planta|plantas)\b/);
      if (storiesMatch && storiesMatch[1]) next.extStories = String(parseInt(storiesMatch[1], 10) || "");
      else {
        const wStory = s.match(/\b(one|two|three)\s*(story|stories|level|levels|floor|floors)\b/);
        if (wStory && wStory[1]) {
          const n = _aiParseNumberFromWords(wStory[1]);
          if (n) next.extStories = String(n);
        }
        const wPisos = s.match(/\b(uno|dos|tres)\s*(piso|pisos|planta|plantas)\b/);
        if (wPisos && wPisos[1]) {
          const mapEs = { uno: 1, dos: 2, tres: 3 };
          const n = mapEs[wPisos[1]];
          if (n) next.extStories = String(n);
        }
      }


      // ceiling height
      const ceilMatch = s.match(/(\d{1,2})\s*(ft|feet)\s*(ceil|ceiling|ceilings)\b/);
      const ceilMatch2 = s.match(/(\d{1,2})\s*(ft|feet)\b/); // fallback if they just say "8ft"
      if (ceilMatch && ceilMatch[1]) next.ceilingHeight = String(parseInt(ceilMatch[1], 10) || "");
      else if (!next.ceilingHeight && ceilMatch2 && ceilMatch2[1]) next.ceilingHeight = String(parseInt(ceilMatch2[1], 10) || "");

      // coats
      const coatsMatch = s.match(/(\d+)\s*(coat|coats|manos)\b/);
      if (coatsMatch && coatsMatch[1]) next.coats = String(parseInt(coatsMatch[1], 10) || "");
      else {
        // "two coats"
        const word = s.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(coat|coats)\b/);
        if (word && word[1]) {
          const n = _aiParseNumberFromWords(word[1]);
          if (n) next.coats = String(n);
        }
      }


      // context-aware: if user replies with just a number or yes/no, map it to the next missing field
      const justNum = raw.trim().match(/^\s*(\d{1,5})\s*$/);
      const looseNum = justNum ? null : raw.match(/(\d{1,5})/); // e.g. "1 story", "8ft", "1800 sqft"
      const picked = justNum?.[1] || looseNum?.[1];
      if (picked) {
        const n = parseInt(picked, 10);
        if (!String(prev.scopeType || "").trim()) {
          // wait for interior/exterior (number doesn't help)
        } else if (!String(prev.sqft || "").trim() && !String(prev.rooms || "").trim()) {
          // size: interior -> bedrooms or sqft; exterior -> sqft (or stories handled separately)
          if (prev.scopeType === "exterior") {
            if (n >= 500) next.sqft = String(n);
            else if (n >= 1 && n <= 3) next.extStories = String(n); // allow 1–3 as stories/levels
          } else {
            if (n >= 500) next.sqft = String(n);
            else next.rooms = String(Math.max(1, n));
          }
        } else if (prev.scopeType === "interior" && !String(prev.ceilingHeight || "").trim()) {
          // ceiling height in feet
          if (n >= 7 && n <= 20) next.ceilingHeight = String(n);
        } else if (prev.scopeType === "exterior" && !String(prev.extStories || "").trim()) {
          // exterior: 1/2 stories or height
          if (n === 1 || n === 2) next.extStories = String(n);
          else if (n >= 7 && n <= 35) next.extStories = String(n);
        } else if (!String(prev.coats || "").trim()) {
          if (n >= 1 && n <= 6) next.coats = String(n);
        }
      }

      // context-aware yes/no for ceilings / trim
      if (prev.scopeType === "interior" && prev.includeCeilings === null) {
        if (/\b(yes|yep|yeah|y|si|sí|s|include)\b/.test(s)) next.includeCeilings = true;
        if (/\b(no|nah|n|walls only)\b/.test(s)) next.includeCeilings = false;
        if (/\bwalls\s*(and|&)\s*ceilings\b/.test(s)) next.includeCeilings = true;
      }
      if (prev.includeTrimDoors === null) {
        if (/\b(yes|yep|yeah|y|si|sí|s|include)\b/.test(s)) next.includeTrimDoors = true;
        if (/\b(no|nah|n)\b/.test(s)) next.includeTrimDoors = false;
        if (/\b(trim|baseboard|doors?)\b/.test(s)) next.includeTrimDoors = true;
      }

      // context-aware yes/no for foreman
      if (!String(prev.needForeman || "").trim()) {
        if (/\b(yes|yep|yeah|y|si|sí|s)\b/.test(s)) next.needForeman = "yes";
        if (/\b(no|nah|n)\b/.test(s)) next.needForeman = "no";
      }

    return next;
  }

  function aiApplyTextToState(text) {
    setAiDraftState((prev0) => aiApplyTextToStatePure(prev0, text));
  }

  function aiNextQuestion(state) {
    const s = state || AI_DRAFT_DEFAULTS;
    if (!(s.scopeType === "interior" || s.scopeType === "exterior")) {
      return lang === "es" ? "¿Interior o exterior?" : "Interior or exterior?";
    }
    if (!String(s.sqft || "").trim() && !String(s.rooms || "").trim()) {
      if (s.scopeType === "exterior") {
        return lang === "es" ? "¿Cuántos pies² (aprox)? (si no sabes, dime 1 o 2 pisos)" : "Approx total square feet? (if unsure, tell me 1 or 2 stories)";
      }
      return lang === "es" ? "¿Cuántas recámaras (o cuántos pies²)?" : "How many bedrooms (or total square feet)?";
    }
    if (s.scopeType === "interior" && !String(s.ceilingHeight || "").trim()) {
      return lang === "es" ? "¿Altura de techo? (por ejemplo: 8)" : "Ceiling height? (for example: 8)";
    }
    if (s.scopeType === "exterior" && !String(s.extStories || "").trim() && !String(s.sqft || "").trim()) {
      return lang === "es" ? "¿Es 1 o 2 pisos? (o dime altura en pies)" : "Is it 1 or 2 stories? (or tell me height in feet)";
    }
    if (!String(s.coats || "").trim()) {
      return lang === "es" ? "¿Cuántas manos/capas?" : "How many coats?";
    }
    if (!String(s.prep || "").trim()) {
      return lang === "es" ? "¿Preparación: ligera, media o pesada?" : "Prep level: light, medium, or heavy?";
    }

    // Optional detail questions (one at a time)
    if (s.scopeType === "interior" && typeof s.includeCeilings !== "boolean") {
      return lang === "es" ? "¿Incluye techos? (sí/no)" : "Include ceilings? (yes/no)";
    }
    if (typeof s.includeTrimDoors !== "boolean") {
      return lang === "es" ? "¿Incluye molduras/puertas? (sí/no)" : "Include trim/doors? (yes/no)";
    }
    if (!String(s.needForeman || "").trim()) {
      return lang === "es" ? "¿Necesitas capataz/foreman? (sí/no)" : "Do you need a foreman? (yes/no)";
    }
    return "";
  }

  function aiSuggestedChips() { return []; }

  function aiSubmit(text) {
    const v = String(text || "").trim();
    if (!v) return;
    triggerHaptic();

    // user message
    aiPush("user", v);
    setAiInput("");

    const uiState = aiDraftState || AI_DRAFT_DEFAULTS;

    const toNum = (x) => {
      const s = String(x ?? "").trim();
      if (!s) return null;
      const n = Number(s.replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    };

    const toBool = (x) => {
      if (typeof x === "boolean") return x;
      const s = String(x ?? "").trim().toLowerCase();
      if (!s) return null;
      if (["true", "yes", "y", "yep", "yeah", "si"].includes(s)) return true;
      if (["false", "no", "n", "nope", "nah"].includes(s)) return false;
      return null;
    };

    const serverState = {
      trade: uiState.trade || "painting",
      scopeType: uiState.scopeType || null,
      scopeBasis: uiState.scopeBasis || null,
      rooms: toNum(uiState.rooms),
      sqft: toNum(uiState.sqft),
      stories: toNum(uiState.extStories ?? uiState.stories),
      ceilingHeightFt: toNum(uiState.ceilingHeight),
      coats: toNum(uiState.coats),
      prep: uiState.prep || null,
      includeCeilings: toBool(uiState.includeCeilings),
      includeTrimDoors: toBool(uiState.includeTrimDoors),
      needForeman: toBool(uiState.needForeman),
    };

    fetch("/api/ai-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: v,
        state: serverState,
        lang: lang || "en",
      }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok || !data) {
          const err = (data && (data.error || data.detail)) || `HTTP ${r.status}`;
          throw new Error(err);
        }
        return data;
      })
      .then((data) => {
        const patch = (data && data.patch) || {};
        const nextQ = String(data?.nextQuestion || "").trim();
        const status = String(data?.status || "").trim();

        // Merge patch into UI draft state (keep stance/complexity fields etc.)
        setAiDraftState((prevUI) => {
          const p = prevUI || AI_DRAFT_DEFAULTS;
          const merged = {
            ...p,
            trade: patch.trade || p.trade,
            scopeType: patch.scopeType ?? p.scopeType,
            scopeBasis: patch.scopeBasis ?? p.scopeBasis,
            rooms: patch.rooms === null || patch.rooms === undefined ? p.rooms : String(patch.rooms),
            sqft: patch.sqft === null || patch.sqft === undefined ? p.sqft : String(patch.sqft),
            extStories: patch.stories === null || patch.stories === undefined ? p.extStories : String(patch.stories),
            ceilingHeight: patch.ceilingHeightFt === null || patch.ceilingHeightFt === undefined ? p.ceilingHeight : String(patch.ceilingHeightFt),
            coats: patch.coats === null || patch.coats === undefined ? p.coats : String(patch.coats),
            prep: patch.prep ?? p.prep,
            includeCeilings: patch.includeCeilings === null || patch.includeCeilings === undefined ? p.includeCeilings : patch.includeCeilings,
            includeTrimDoors: patch.includeTrimDoors === null || patch.includeTrimDoors === undefined ? p.includeTrimDoors : patch.includeTrimDoors,
            needForeman: patch.needForeman === null || patch.needForeman === undefined ? p.needForeman : patch.needForeman,
          };
          return merged;
        });

        // Optional one-liner context
        if (status) {
          aiPush("assistant", status);
        }

        if (nextQ) {
          aiPush("assistant", nextQ);
        } else {
          aiPush(
            "assistant",
            lang === "es"
              ? "Perfecto. Cuando quieras, presiona “Generar borrador”."
              : "Perfect. When you’re ready, press “Generate draft”."
          );
        }
      })
      .catch((e) => {
        aiPush(
          "assistant",
          lang === "es"
            ? `No pude conectar con el servidor IA. (${String(e?.message || e)})`
            : `I couldn’t reach the AI server. (${String(e?.message || e)})`
        );
      });
  }

  function generatePaintingDraft(state) {
    const s = state || AI_DRAFT_DEFAULTS;

    const stance = s.stance || "mid";
    const complexity = s.complexity || "normal";
    const prep = s.prep || "light";

    const coats = Math.max(1, parseInt(String(s.coats || "2"), 10) || 2);
    const ceilingH = Math.max(7, Math.min(20, parseInt(String(s.ceilingHeight || "8"), 10) || 8));

    // determine base sqft (floor area) if missing
    let floorSqft = parseInt(String(s.sqft || ""), 10);
    if (!Number.isFinite(floorSqft) || floorSqft <= 0) {
      const rooms = Math.max(1, parseInt(String(s.rooms || "3"), 10) || 3);
      // very rough default: 3br ~= 1600-2200 depending; start mid ~ 1900 and scale
      floorSqft = 900 + rooms * 350; // 2br 1600, 3br 1950, 4br 2300
    }

    // wall surface factor; scales with ceiling height
    const wallFactorBase = 2.6 * (ceilingH / 8);
    let wallArea = floorSqft * wallFactorBase;

    // include ceilings (approx ceiling area = floor area)
    let ceilingArea = s.includeCeilings ? floorSqft : 0;

    // complexity productivity
    const baseSqftPerHour =
      complexity === "simple" ? 200 : complexity === "cutup" ? 120 : 160;

    const prepMult = prep === "heavy" ? 1.6 : prep === "medium" ? 1.25 : 1.0;

    // coats multiplier: first coat 1.0, each additional coat ~0.75
    const coatsMult = 1 + Math.max(0, coats - 1) * 0.75;

    // stance affects padding
    const stanceMult = stance === "low" ? 0.92 : stance === "high" ? 1.10 : 1.0;

    const paintableArea = wallArea + ceilingArea;

    const laborHours = (paintableArea / baseSqftPerHour) * coatsMult * prepMult * stanceMult;

    // gallons (coverage ~350 sqft/gal per coat) + waste
    const waste = stance === "low" ? 1.05 : stance === "high" ? 1.15 : 1.10;
    const gallons = Math.max(1, Math.ceil((paintableArea / 350) * coats * waste));

    // materials estimate (customer-facing charge) — simple placeholder totals
    const matChargeBase = gallons * 45 + 40; // paint + sundries
    const matCostBase = gallons * 22 + 20; // internal
    const matCharge = matChargeBase * stanceMult;
    const matCost = matCostBase * stanceMult;

    const scopeBits = [];
    scopeBits.push(s.scopeType === "exterior" ? "Exterior" : "Interior");
    scopeBits.push(s.includeCeilings ? (lang === "es" ? "paredes + techos" : "walls + ceilings") : (lang === "es" ? "solo paredes" : "walls only"));
    if (s.includeTrimDoors) scopeBits.push(lang === "es" ? "incluye trim/puertas" : "includes trim/doors");
    scopeBits.push(`${coats} ${lang === "es" ? "manos" : "coats"}`);
    scopeBits.push(`${prep} ${lang === "es" ? "prep" : "prep"}`);
    scopeBits.push(`${ceilingH}ft`);

    const assumptionsLine =
      lang === "es"
        ? `Borrador IA (Beta) — Supuestos: ${scopeBits.join(" • ")} • ${floorSqft} pies² (aprox) • ${gallons} gal (aprox)`
        : `AI Draft (Beta) — Assumptions: ${scopeBits.join(" • ")} • ~${floorSqft} sqft • ~${gallons} gal`;

    const laborLinesToAdd = [];

    // Labor roles: always "Painter", optionally "Foreman"
    const painterLabel = lang === "es" ? "Pintor" : "Painter";
    const foremanLabel = lang === "es" ? "Capataz / Foreman" : "Foreman";

    const needForeman = String(s.needForeman || "").toLowerCase() === "yes";
    const foremanHours = needForeman ? Math.max(2, laborHours * 0.15) : 0;

    if (needForeman) {
      laborLinesToAdd.push({
        label: foremanLabel,
        hours: normalizeHoursInput(foremanHours),
        rate: "",
        internalRate: "",
        qty: 1,
      });
    }

    laborLinesToAdd.push({
      label: painterLabel,
      hours: normalizeHoursInput(laborHours),
      rate: "",
      internalRate: "",
      qty: 1,
    });


    return {
      laborLinesToAdd,
      materials: {
        charge: normalizeMoneyInput(matCharge),
        cost: normalizeMoneyInput(matCost),
        gallons,
      },
      assumptionsLine,
    };
  }

  function aiGenerateDraft() {
    triggerHaptic();
    const s = aiDraftState || AI_DRAFT_DEFAULTS;
    if (String(s.trade || "painting") !== "painting") {
      alert(lang === "es" ? "Por ahora, el borrador IA solo soporta Pintura (Beta)." : "For now, AI Draft supports Painting only (Beta).");
      return;
    }
    if (!aiReady) {
      const q = aiNextQuestion(s);
      aiPush("assistant", q || (lang === "es" ? "Faltan datos. Intenta otra vez." : "Missing info. Try again."));
      return;
    }

    const draft = generatePaintingDraft(s);

    // apply to labor lines (replace if it's just the default empty line)
    setLaborLines((prev) => {
      const list = Array.isArray(prev) ? [...prev] : [];
      const isSingleEmpty =
        list.length === 1 &&
        !String(list[0]?.label || "").trim() &&
        !String(list[0]?.hours || "").trim() &&
        !String(list[0]?.rate || "").trim();
      return isSingleEmpty ? draft.laborLinesToAdd : [...list, ...draft.laborLinesToAdd];
    });

    // materials (respect current mode)
    if (materialsMode === "itemized") {
      setMaterialItems((prev) => {
        const list = Array.isArray(prev) ? [...prev] : [];
        const isSingleEmpty = list.length === 1 && !String(list[0]?.desc || "").trim() && !String(list[0]?.charge || "").trim();
        const row = {
          desc: lang === "es" ? `Pintura y suministros (aprox) — ${draft.materials.gallons} gal` : `Paint & sundries (approx) — ${draft.materials.gallons} gal`,
          qty: 1,
          cost: draft.materials.cost,
          charge: draft.materials.charge,
        };
        return isSingleEmpty ? [row] : [...list, row];
      });
    } else {
      // blanket materials cost = add charge (customer facing)
      setMaterialsCost((prev) => {
        const existing = Number(String(prev || "").replace(/[^0-9.\-]/g, "")) || 0;
        const add = Number(String(draft.materials.charge || "").replace(/[^0-9.\-]/g, "")) || 0;
        return normalizeMoneyInput(existing + add);
      });
    }

    // append assumptions into scope/notes (job description) if empty or not already added
    setDescription((prev) => {
      const base = String(prev || "");
      if (!base.trim()) return draft.assumptionsLine;
      if (base.includes("AI Draft") || base.includes("Borrador IA")) return base;
      return `${base}\n\n${draft.assumptionsLine}`;
    });

    setLaborOpen(true); // expand labor on draft generate
    aiPush("assistant", lang === "es" ? "Dime del trabajo y te guío con preguntas cortas." : "Tell me about the job and I’ll guide you with quick questions.");
    setShowAIDraft(false);
  }

const advancedScreen = (
      <div>
        <div className="pe-section" style={{ paddingTop: 0 }}>
          <div className="pe-section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span>{lang === "es" ? "Avanzado" : "Advanced"}</span>
            <button
              className="pe-btn pe-btn-ghost"
              type="button"
              onClick={() => {
                triggerHaptic();
                setView("estimate");
              }}
            >
              {lang === "es" ? "Volver al estimador" : "Back to estimator"}
            </button>
          </div>

          <div className="pe-muted" style={{ marginTop: 6 }}>
            {lang === "es"
              ? "Ajustes y opciones avanzadas (se guardan en este dispositivo)."
              : "Settings and advanced options (saved on this device)."}
          </div>
        </div>

        {/* ✅ AI Draft Mode (Beta) */}
        <section className="pe-section">
          <div className="pe-row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div className="pe-section-title" style={{ marginBottom: 4 }}>
                {lang === "es" ? "Modo Borrador IA (Beta)" : "AI Draft Mode (Beta)"}
              </div>
              <div className="pe-muted">
                {lang === "es"
                  ? "Conversación guiada para crear un borrador rápido (Pintura primero)."
                  : "Guided conversation to generate a fast draft (Painting first)."}
              </div>
            </div>
            <button
              className="pe-btn"
              type="button"
              onClick={() => {
                aiOpen();
              }}
              title={lang === "es" ? "Abrir Modo IA" : "Open AI Draft Mode"}
            >
              {lang === "es" ? "Abrir" : "Open"}
            </button>
          </div>
        </section>



        
        {/* ✅ Customer organizer (Advanced) */}
        <section className="pe-section">
          <button
            type="button"
            className="pe-btn pe-btn-ghost"
            onClick={() => {
              triggerHaptic();
              setCustomersOrganizerOpen((v) => !v);
            }}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 12px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
              <div className="pe-section-title" style={{ margin: 0 }}>
                {t("customerOrganizer")} {customers.length ? `(${customers.length})` : ""}
              </div>
              <div className="pe-muted" style={{ fontSize: 12 }}>
                {customers.length
                  ? (lang === "es"
                      ? `Último usado: ${String(customersSorted?.[0]?.name || "")}`
                      : `Last used: ${String(customersSorted?.[0]?.name || "")}`)
                  : t("noCustomers")}
              </div>
            </div>
            <div style={{ fontSize: 18, opacity: 0.75, lineHeight: 1 }}>
              {customersOrganizerOpen ? "▾" : "▸"}
            </div>
          </button>

          {!customersOrganizerOpen ? null : (
            <>
              {!customers.length ? (
                <div className="pe-muted" style={{ marginTop: 10 }}>{t("noCustomers")}</div>
              ) : (
                <>
                  <div className="pe-grid" style={{ marginTop: 10 }}>
                    <div style={{ gridColumn: "1 / -1", ...FIELD_STACK }}>
                      <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Buscar cliente" : "Search customer"}</div>
                      <input
                        className="pe-input"
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder={lang === "es" ? "Escribe para filtrar…" : "Type to filter…"}
                      />
                    </div>

                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Ordenar" : "Sort"}</div>
                      <select className="pe-input" value={customerSort} onChange={(e) => setCustomerSort(e.target.value)}>
                        <option value="recent">{lang === "es" ? "Más recientes" : "Most recent"}</option>
                        <option value="az">A–Z</option>
                      </select>
                    </div>

                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("recentCustomers")}</div>
                      <select
                        className="pe-input"
                        value={selectedCustomerId}
                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                      >
                        <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
                        {String(customerSearch || "").trim()
                          ? customersFiltered.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))
                          : [
                              ...recentCustomersTop.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {`${c.name}${lang === "es" ? " (reciente)" : " (recent)"}`}
                                </option>
                              )),
                              ...customersFiltered
                                .filter((c) => !recentCustomersTop.some((r) => String(r.id) === String(c.id)))
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                )),
                            ]}
                      </select>
                    </div>
                  </div>

                  {customerDraft ? (
                    <>
                      <div className="pe-grid" style={{ marginTop: 10 }}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("customerName")}</div>
                          <input
                            className="pe-input"
                            value={customerDraft.name || ""}
                            onChange={(e) => setCustomerDraft((d) => ({ ...(d || {}), name: e.target.value }))}
                          />
                        </div>

                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("customerPhone")}</div>
                          <input
                            className="pe-input"
                            value={customerDraft.phone || ""}
                            onChange={(e) => setCustomerDraft((d) => ({ ...(d || {}), phone: formatPhoneUS(e.target.value) }))}
                          />
                        </div>

                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("customerEmail")}</div>
                          <input
                            className="pe-input"
                            value={customerDraft.email || ""}
                            onChange={(e) => setCustomerDraft((d) => ({ ...(d || {}), email: e.target.value }))}
                          />
                        </div>

                        <div style={{ gridColumn: "1 / -1", ...FIELD_STACK }}>
                          <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("customerAddress")}</div>
                          <textarea
                            className="pe-input"
                            rows={2}
                            value={customerDraft.serviceAddress || ""}
                            onChange={(e) => setCustomerDraft((d) => ({ ...(d || {}), serviceAddress: e.target.value }))}
                          />
                        </div>


                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Términos de pago" : "Payment terms"}</div>
                          <select
                            className="pe-input"
                            value={String(customerDraft.termsDays ?? 0)}
                            onChange={(e) =>
                              setCustomerDraft((d) => ({
                                ...(d || {}),
                                termsDays: parseInt(String(e.target.value || "0"), 10) || 0,
                              }))
                            }
                          >
                            <option value="0">{lang === "es" ? "Al recibir" : "Due upon receipt"}</option>
                            <option value="15">{lang === "es" ? "Neto 15" : "Net 15"}</option>
                            <option value="30">{lang === "es" ? "Neto 30" : "Net 30"}</option>
                          </select>
                        </div>

                        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(customerDraft.billingDiff)}
                            onChange={(e) => setCustomerDraft((d) => ({ ...(d || {}), billingDiff: e.target.checked }))}
                          />
                          <div className="pe-muted" style={{ fontSize: 13 }}>
                            {lang === "es" ? "Dirección de facturación diferente" : "Billing address differs"}
                          </div>
                        </div>

                        {customerDraft.billingDiff ? (
                          <div style={{ gridColumn: "1 / -1", ...FIELD_STACK }}>
                            <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Dirección de facturación" : "Billing address"}</div>
                            <textarea
                              className="pe-input"
                              rows={2}
                              value={customerDraft.billingAddress || ""}
                              onChange={(e) => setCustomerDraft((d) => ({ ...(d || {}), billingAddress: e.target.value }))}
                            />
                          </div>
                        ) : null}
</div>

                      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="pe-btn"
                          onClick={() => {
                            triggerHaptic();
                            if (!customerDraft?.id) return;
                            setCustomers((prev) => {
                              const list = Array.isArray(prev) ? [...prev] : [];
                              const idx = list.findIndex((x) => x?.id === customerDraft.id);
                              const next = { ...customerDraft };
                              // keep projectSameAsCustomer consistent with projectAddress
                              const _pa = String(next.projectAddress || "").trim();
                              next.projectSameAsCustomer = _pa ? false : true;
                              if (idx >= 0) list[idx] = next;
                              return list;
                            });
                          }}
                        >
                          {t("save")}
                        </button>

                        <button
                          type="button"
                          className="pe-btn pe-btn-ghost"
                          onClick={() => {
                            triggerHaptic();
                            if (!customerDraft?.id) return;
                            if (!window.confirm(lang === "es" ? "¿Eliminar este cliente?" : "Delete this customer?")) return;
                            setCustomers((prev) => (Array.isArray(prev) ? prev.filter((x) => x?.id !== customerDraft.id) : []));
                            setSelectedCustomerId("");
                            setCustomerDraft(null);
                          }}
                        >
                          {t("delete")}
                        </button>
                      </div>

                      <div className="pe-muted" style={{ marginTop: 8, fontSize: 12 }}>
                        {lang === "es"
                          ? "Los clientes se guardan automáticamente al exportar PDF. Aquí puedes editar o eliminar."
                          : "Customers auto-save on PDF export. Edit or remove them here."}
                      </div>
                    </>
                  ) : (
                    <div className="pe-muted" style={{ marginTop: 10, fontSize: 12 }}>
                      {lang === "es" ? "Selecciona un cliente para editar." : "Select a customer to edit."}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>


<section className="pe-section">
          <div className="pe-section-title">{lang === "es" ? "Costos reales / Margen" : "True costs / Margin"}</div>

          <div className="pe-muted" style={{ marginTop: 6 }}>
            {lang === "es"
              ? "Cálculos internos (auto‑calculados desde el estimador)."
              : "Internal calculations (auto-computed from estimator inputs)."}
          </div>

          {(
            <div className="pe-card" style={{ marginTop: 12, padding: 14 }}>

              <hr style={{ margin: "12px 0", border: 0, borderTop: "1px solid rgba(255,255,255,0.10)" }} />

              <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{lang === "es" ? "Ingresos (Total)" : "Revenue (Total)"}</span>
                  <strong>{money.format(grossNumbers.revenue || 0)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{lang === "es" ? "Costo de mano de obra" : "Labor cost"}</span>
                  <span>{money.format(grossNumbers.laborCost || 0)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{lang === "es" ? "Costo de materiales" : "Materials cost"}</span>
                  <span>{money.format(grossNumbers.materialsCostTrue || 0)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{lang === "es" ? "Costo total" : "Total cost"}</span>
                  <span>{money.format(grossNumbers.totalCost || 0)}</span>
                </div>
                <hr style={{ opacity: 0.25 }} />
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{lang === "es" ? "Utilidad bruta" : "Gross profit"}</span>
                  <strong>{money.format(grossNumbers.grossProfit || 0)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span>{lang === "es" ? "Margen bruto" : "Gross margin"}</span>
                  <strong>{(grossNumbers.grossMarginPct || 0).toFixed(1)}%</strong>
                </div>
              </div>
            </div>
          )}
        </section>

        

        <section className="pe-section">
          <div className="pe-section-title">{lang === "es" ? "Documento" : "Document"}</div>

          <div className="pe-row" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("docTypeLabel")}</div>
              {!embeddedInShell && <DocTypeToggle />}
            </div>

            {docType === "invoice" && (
              <div className="pe-grid">
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Número de factura" : "Invoice number"}</div>
                  <input
                    className="pe-input"
                    value={invoiceNumber}
                    onChange={(e) => {
                      const v = String(e.target.value || "");
                      setInvoiceNumber(v);
                      const m = v.match(/-(\d+)$/);
                      if (m && m[1]) {
                        setStoredSeqWidth(INVOICE_SEQ_WIDTH_KEY, String(m[1]).length);
                      }
                      if (m) {
                        const n = parseInt(m[1], 10);
                        if (!Number.isNaN(n)) {
                          try {
                            localStorage.setItem(INVOICE_SEQ_KEY, String(n));
                          } catch {
                            // ignore
                          }
                        }
                      }
                    }}
                    placeholder="INV-YYYYMMDD-0001"
                  />
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                  <button
                    className="pe-btn pe-btn-ghost"
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      const cur = String(invoiceNumber || "").trim();
                      if (cur && !parseTrailingDigits(cur)) {
                        alert(t("numberIncrementHint"));
                        return;
                      }
                      if (cur && parseTrailingDigits(cur)) {
                        const r = incrementFromTrailingDigits(cur, {
                          seqKey: INVOICE_SEQ_KEY,
                          widthKey: INVOICE_SEQ_WIDTH_KEY,
                        });
                        if (r.ok) {
                          setInvoiceNumber(r.next);
                          return;
                        }
                      }
                      const next = nextInvoiceNumber();
                      setInvoiceNumber(next);
                      if (!String(invoiceOriginal || "").trim()) setInvoiceOriginal(next);
                    }}
                  >
                    {lang === "es" ? "Generar" : "Generate"}
                  </button>

                  <button
                    className="pe-btn pe-btn-ghost"
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      const og = String(invoiceOriginal || "").trim();
                      if (og) {
                        setInvoiceNumber(og);
                        return;
                      }
                      const next = nextInvoiceNumber();
                      setInvoiceNumber(next);
                      setInvoiceOriginal(next);
                    }}
                    title={t("resetToOriginal")}
                  >
                    {t("resetToOriginal")}
                  </button>
                  <div style={{ fontSize: 12, opacity: 0.7, lineHeight: 1.25 }}>
                    <div>{lang === "es" ? "Se usa en PDF/CSV." : "Used on PDF/CSV."}</div>
                    <div style={{ marginTop: 4 }}>{t("numberIncrementHint")}</div>
                  </div>
                </div>
              </div>
            )}

            {docType === "estimate" && (
              <div className="pe-card" style={{ marginTop: 12 }}>
                <div className="pe-row" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontWeight: 700, letterSpacing: 0.3 }}>
                    {lang === "es" ? "Nº de estimación" : "Estimate #"}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      className="pe-input"
                      value={estimateNumber}
                      onChange={(e) => {
                        const v = String(e.target.value || "");
                        setEstimateNumber(v);
                        const m = v.match(/-(\d+)$/);
                        if (m && m[1]) {
                          setStoredSeqWidth(ESTIMATE_SEQ_WIDTH_KEY, String(m[1]).length);
                        }
                        if (m) {
                          const n = parseInt(m[1], 10);
                          if (!Number.isNaN(n)) {
                            try {
                              localStorage.setItem(ESTIMATE_SEQ_KEY, String(n));
                            } catch {
                              // ignore
                            }
                          }
                        }
                      }}
                      placeholder="EST-YYYYMMDD-0001"
                      style={{ minWidth: 220, flex: 1 }}
                    />

                    <button
                      className="pe-btn"
                      type="button"
                      onClick={() => {
                        triggerHaptic();
                        const cur = String(estimateNumber || "").trim();
                        if (cur && !parseTrailingDigits(cur)) {
                          alert(t("numberIncrementHint"));
                          return;
                        }
                        if (cur && parseTrailingDigits(cur)) {
                          const r = incrementFromTrailingDigits(cur, {
                            seqKey: ESTIMATE_SEQ_KEY,
                            widthKey: ESTIMATE_SEQ_WIDTH_KEY,
                          });
                          if (r.ok) {
                            setEstimateNumber(r.next);
                            return;
                          }
                        }
                        const next = nextEstimateNumber();
                        setEstimateNumber(next);
                      }}
                    >
                      {lang === "es" ? "Auto" : "Auto-generate"}
                    </button>

                    <button
                      className="pe-btn"
                      type="button"
                      onClick={() => {
                        setEstimateNumber("");
                        hasAutoEstimateRef.current = false;
                        try {
                          localStorage.removeItem(LAST_ESTIMATE_NUM_KEY);
                          localStorage.removeItem(ESTIMATE_SEQ_KEY);
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      {lang === "es" ? "Borrar" : "Clear"}
                    </button>
                  </div>

                  <div className="pe-muted" style={{ fontSize: 12, lineHeight: 1.25 }}>
                    <div>{lang === "es" ? "Se guarda en este dispositivo." : "Saved on this device."}</div>
                    <div style={{ marginTop: 4 }}>{t("numberIncrementHint")}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="pe-section">
          <div className="pe-section-title">{lang === "es" ? "Opciones de PDF" : "PDF Options"}</div>

          <div className="pe-card" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800 }}>
                  {t("pdfLaborItemizedToggle")}
                </div>
                <div className="pe-muted" style={{ marginTop: 4 }}>
                  {t("pdfLaborItemizedToggleHelp")}
                </div>
              </div>

              <button
                type="button"
                className={pdfLaborItemized ? "pe-btn" : "pe-btn pe-btn-ghost"}
                onClick={() => {
                  triggerHaptic();
                  setPdfLaborItemized((v) => !v);
                }}
                style={{ minWidth: 140 }}
              >
                {pdfLaborItemized ? (lang === "es" ? "Encendido" : "On") : (lang === "es" ? "Apagado" : "Off")}
              </button>
            </div>
          </div>
        </section>

        <section className="pe-section">
          <div className="pe-section-title">{lang === "es" ? "Idioma" : "Language"}</div>
          <div className="pe-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div className="pe-muted" style={{ fontSize: 13 }}>
              {lang === "es" ? "Cambia el idioma de la app." : "Change the app language."}
            </div>
            <LanguageToggle />
          </div>
        </section>


        <section className="pe-section">
          <div className="pe-section-title">{lang === "es" ? "Datos" : "Data"}</div>

          <div className="pe-row" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="pe-btn pe-btn-ghost" onClick={exportCSV} type="button">
              {lang === "es" ? "Exportar CSV" : "Export CSV"}
            </button>
          </div>

          <div className="pe-muted" style={{ marginTop: 6 }}>
            {lang === "es"
              ? "CSV incluye desglose (los costos internos son solo para tu referencia)."
              : "CSV includes a breakdown (internal costs are for your reference only)."}
          </div>
        </section>
      <section className="pe-section">
          <div className="pe-section-title">{lang === "es" ? "Apariencia" : "Appearance"}</div>
          <div className="pe-row" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, opacity: 0.75 }}>{lang === "es" ? "Tema" : "Theme"}</div>
            <ThemeToggle />
          </div>
        </section>


        {/* Field Calculator (Beta) — kept in Advanced, bottom */}
                <section className="pe-section">
          <div className="pe-row" style={{ marginTop: 0, alignItems: "flex-start" }}>
            <button
              className="pe-btn pe-btn-ghost"
              type="button"
              onClick={() => setCalcOpen((v) => !v)}
              aria-expanded={calcOpen}
              style={{ flex: 1, textAlign: "left", paddingLeft: 0 }}
              title={calcOpen ? (lang === "es" ? "Ocultar" : "Collapse") : (lang === "es" ? "Mostrar" : "Expand")}
            >
              <div className="pe-section-title" style={{ marginBottom: 0 }}>
                {calcOpen ? "▾ " : "▸ "}
                {lang === "es" ? "Calculadora de obra (Beta)" : "Field Calculator (Beta)"}
              </div>
              {!calcOpen && (
                <div className="pe-collapsible-summary">
                  {lang === "es"
                    ? "Fracciones • cm↔in • ft/in"
                    : "Fractions • cm↔in • ft/in"}
                </div>
              )}
            </button>
          </div>

          {calcOpen && (
            <div style={{ marginTop: 10 }}>
              <div className="pe-row" style={{ gap: 10, alignItems: "center" }}>
                <input
                  className="pe-input"
                  value={calcInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCalcInput(v);
                    setCalcResult(v ? solveFieldCalc(v) : "");
                  }}
                  placeholder={
                    lang === "es"
                      ? 'Ej: "30 cm a pulgadas"  •  "12 3/8 + 5/16"'
                      : 'Ex: "30 cm to inches"  •  "12 3/8 + 5/16"'
                  }
                  style={{ flex: 1 }}
                />

                {canUseSpeech && (
                  <button
                    type="button"
                    className={"pe-btn " + (calcListening ? "pe-btn-danger" : "pe-btn-secondary")}
                    onClick={calcListening ? stopCalcVoice : startCalcVoice}
                    title={calcListening ? (lang === "es" ? "Detener" : "Stop") : (lang === "es" ? "Hablar" : "Speak")}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {calcListening ? (lang === "es" ? "■" : "■") : (lang === "es" ? "🎙" : "🎙")}
                  </button>
                )}
              </div>

              {!!calcResult && (
                <div
                  className="pe-card"
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 12,
                    fontSize: 14,
                    opacity: 0.92,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {lang === "es" ? "Resultado" : "Result"}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.35 }}>{calcResult}</div>
                </div>
              )}

              <div className="pe-help" style={{ marginTop: 10 }}>
                {lang === "es"
                  ? 'Tips: 5\' 6"  •  12 3/8 + 5/16  •  30 cm a pulgadas'
                  : 'Tips: 5\' 6"  •  12 3/8 + 5/16  •  30 cm to inches'}
              </div>
            </div>
          )}
        </section>

        </div>
    );



  
  // ✅ AI Draft Mode (Beta) — show as a full-screen workflow from ANY step (profile or estimator)
  if (showAIDraft) {
    useEffect(() => {
    if (!embeddedInShell) return;
    try {
      window.__FPE_EMBED_API = {
        __owner: "EstimateForm",
        goProfile: () => setStep("profile"),
        toggleAdvanced: () => setView((v) => (v === "advanced" ? "estimate" : "advanced")),
        openPdf: () => setPdfPromptOpen(true),
        save: () => handleSaveClick(),
        newClear: () => resetForm(),
        toggleDocType: () => setDocType((d) => (d === "invoice" ? "estimate" : "invoice")),
        setDocType: (next) => setDocType(next === "invoice" ? "invoice" : "estimate"),
      };
    } catch {
      // ignore
    }
    return () => {
      try {
        if (window.__FPE_EMBED_API && window.__FPE_EMBED_API.__owner === "EstimateForm") {
          delete window.__FPE_EMBED_API;
        }
      } catch {
        // ignore
      }
    };
  }, [embeddedInShell]);

  return (
      <div className="pe-wrap">
        <PopStyles />
        <PagePerimeterSnake />
              <div
                role="dialog"
                aria-modal="true"
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 9999,
                  background: "rgba(10,12,16,0.92)",
                  backdropFilter: "blur(14px)",
                  WebkitBackdropFilter: "blur(14px)",
                  color: "#e5e7eb",
                  overflow: "auto",
                  padding: 14,
                }}
              >
                <div className="pe-card" style={{ maxWidth: 980, margin: "0 auto", background: "rgba(15,18,25,0.75)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 20px 50px rgba(0,0,0,0.45)", color: "#e5e7eb" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "10px 12px",
                      borderBottom: "1px solid rgba(255,255,255,0.10)",
                      position: "sticky",
                      top: 0,
                      background: "rgba(10,12,16,0.92)",
                  backdropFilter: "blur(14px)",
                  WebkitBackdropFilter: "blur(14px)",
                  color: "#e5e7eb",
                      zIndex: 2,
                    }}
                  >
                    <button className="pe-btn pe-btn-ghost" type="button" onClick={aiClose}>
                      {lang === "es" ? "Volver" : "Back"}
                    </button>

                    <div style={{ textAlign: "center", lineHeight: 1.15 }}>
                      <div style={{ fontWeight: 800 }}>{lang === "es" ? "Modo Borrador IA (Beta)" : "AI Draft Mode (Beta)"}</div>
                      <div className="pe-muted" style={{ fontSize: 12 }}>
                        {lang === "es" ? "Conversación guiada → borrador" : "Guided conversation → draft"}
                      </div>
                    </div>

                    <button className="pe-btn pe-btn-ghost" type="button" onClick={aiClearSession}>
                      {lang === "es" ? "Nuevo / Limpiar" : "New / Clear"}
                    </button>
                  </div>

                  <div style={{ padding: 12, display: "grid", gap: 10 }}>
                    {/* Controls */}
                    <div style={{ display: "grid", gap: 10 }}>
                      <div className="pe-grid" style={{ gap: 10 }}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Trade" : "Trade"}</div>
                          <select
                            className="pe-input"
                            value={aiTrade}
                            onChange={(e) => {
                              triggerHaptic();
                              const v = String(e.target.value || "painting");
                              setAiTrade(v);
                              setAiDraftState((prev) => ({ ...(prev || {}), trade: v }));
                            }}
                          >
                            <option value="painting">{lang === "es" ? "Pintura (Beta)" : "Painting (Beta)"}</option>
                            <option value="drywall" disabled>
                              {lang === "es" ? "Drywall (próximamente)" : "Drywall (coming soon)"}
                            </option>
                            <option value="flooring" disabled>
                              {lang === "es" ? "Pisos (próximamente)" : "Flooring (coming soon)"}
                            </option>
                          </select>
                        </div>

                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Estilo" : "Stance"}</div>
                          <select
                            className="pe-input"
                            value={aiDraftState?.stance || "mid"}
                            onChange={(e) => {
                              triggerHaptic();
                              const v = String(e.target.value || "mid");
                              setAiDraftState((p) => ({ ...(p || {}), stance: v }));
                            }}
                          >
                            <option value="low">{lang === "es" ? "Bajo (competitivo)" : "Low (aggressive)"}</option>
                            <option value="mid">{lang === "es" ? "Medio (típico)" : "Mid (typical)"}</option>
                            <option value="high">{lang === "es" ? "Alto (seguro)" : "High (safe)"}</option>
                          </select>
                        </div>

                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Complejidad" : "Complexity"}</div>
                          <select
                            className="pe-input"
                            value={aiDraftState?.complexity || "normal"}
                            onChange={(e) => {
                              triggerHaptic();
                              const v = String(e.target.value || "normal");
                              setAiDraftState((p) => ({ ...(p || {}), complexity: v }));
                            }}
                          >
                            <option value="simple">{lang === "es" ? "Sencillo" : "Simple"}</option>
                            <option value="normal">{lang === "es" ? "Normal" : "Normal"}</option>
                            <option value="cutup">{lang === "es" ? "Recortado" : "Cut-up"}</option>
                          </select>
                        </div>
                      </div>

                      <div className="pe-grid" style={{ gap: 10 }}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Preparación" : "Prep"}</div>
                          <select
                            className="pe-input"
                            value={aiDraftState?.prep || "light"}
                            onChange={(e) => {
                              triggerHaptic();
                              const v = String(e.target.value || "light");
                              setAiDraftState((p) => ({ ...(p || {}), prep: v }));
                            }}
                          >
                            <option value="light">{lang === "es" ? "Ligera" : "Light"}</option>
                            <option value="medium">{lang === "es" ? "Media" : "Medium"}</option>
                            <option value="heavy">{lang === "es" ? "Pesada" : "Heavy"}</option>
                          </select>
                        </div>

                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Incluir" : "Include"}</div>
                          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <label className="pe-check" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <input
                                type="checkbox"
                                checked={Boolean(aiDraftState?.includeCeilings)}
                                onChange={(e) => {
                                  triggerHaptic();
                                  setAiDraftState((p) => ({ ...(p || {}), includeCeilings: Boolean(e.target.checked) }));
                                }}
                              />
                              <span>{lang === "es" ? "Techos" : "Ceilings"}</span>
                            </label>

                            <label className="pe-check" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <input
                                type="checkbox"
                                checked={Boolean(aiDraftState?.includeTrimDoors)}
                                onChange={(e) => {
                                  triggerHaptic();
                                  setAiDraftState((p) => ({ ...(p || {}), includeTrimDoors: Boolean(e.target.checked) }));
                                }}
                              />
                              <span>{lang === "es" ? "Trim/Puertas" : "Trim/Doors"}</span>
                            </label>
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Tip" : "Tip"}</div>
                          <div className="pe-muted" style={{ fontSize: 12 }}>
                            {lang === "es"
                              ? "Mejor si dices: trade + tamaño + techo + manos + preparación."
                              : "Best results: trade + size + ceiling height + coats + prep."}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Chat */}
                    <div ref={aiChatRef}
                      style={{
                        border: "1px solid rgba(0,0,0,0.10)",
                        borderRadius: 12,
                        padding: 10,
                        minHeight: 220,
                        maxHeight: 340,
                        overflow: "auto",
                        background: "rgba(0,0,0,0.02)",
                      }}
                    >
                      {(aiMessages || []).map((m) => (
                        <div
                          key={m.id}
                          style={{
                            display: "flex",
                            justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                            marginBottom: 8,
                          }}
                        >
                          <div
                            style={{
                              maxWidth: "92%",
                              padding: "8px 10px",
                              borderRadius: 12,
                              background: m.role === "user" ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.06)",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {m.text}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Input */}
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <textarea
                        className="pe-input"
                        value={aiInput}
                        onChange={(e) => setAiInput(e.target.value)}
                        onKeyDown={(e) => {
                          // Enter submits; Shift+Enter inserts newline
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            aiSubmit(aiInput);
                          }
                        }}
                        placeholder={
                          lang === "es"
                            ? "Describe el trabajo… (ej: “Pintar 3 recámaras, 8ft, 2 manos, prep ligera”)"
                            : "Describe the job… (ex: “Paint 3 bedrooms, 8ft, 2 coats, light prep”)"
                        }
                        rows={2}
                        style={{ flex: 1, resize: "vertical" }}
                      />
                      <button className="pe-btn" type="button" onClick={() => aiSubmit(aiInput)}>
                        {lang === "es" ? "Enviar" : "Send"}
                      </button>
                    </div>

                    {/* Generate */}
                    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
                      <div className="pe-muted" style={{ fontSize: 12 }}>
                        {aiReady
                          ? lang === "es"
                            ? "Listo para generar borrador."
                            : "Ready to generate draft."
                          : aiNextQuestion(aiDraftState)}
                      </div>
                      <button className="pe-btn" type="button" onClick={aiGenerateDraft} disabled={!aiReady}>
                        {lang === "es" ? "Generar borrador" : "Generate draft"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
      </div>
    );
  }

// STEP 1: COMPANY PROFILE
  if (step === "profile") {
    const requiredComplete = isCompanyComplete(profile);

    return (
      <div className="pe-wrap">
      <PopStyles />
      <PagePerimeterSnake />
      <header className="pe-header pe-sweep">
          <div style={{ marginTop: -10 }}>
            <div className="pe-title">Field Pocket Estimator</div>
            <div className="pe-subtitle">{t("subtitleProfile")}</div>

            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                display: "flex",
                gap: 8,
                alignItems: "center",
                opacity: 0.95,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid rgba(0,0,0,0.12)",
                }}
                title={requiredComplete ? t("requiredCompleteTitle") : t("requiredIncompleteTitle")}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: requiredComplete ? "#16a34a" : "#dc2626",
                    display: "inline-block",
                  }}
                />
                <span>{requiredComplete ? t("companyComplete") : t("companyIncomplete")}</span>
              </span>
            </div>
          </div>

  {!embeddedInShell && (
                <div className="pe-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <LanguageToggle />
            <button
              className="pe-btn"
              type="button"
              onClick={() => {
                triggerHaptic();
                if (!requiredComplete) {
                  warnCompanyIncomplete();
                  return;
                }
                setStep("estimate");
              }}
            >
              {t("continueArrow")}
            </button>
          </div>
      )}
        </header>

        <main className="pe-card">
          <section className="pe-section">
            <div className="pe-section-title">{t("companyProfileTitle")}</div>

            <div className="pe-muted" style={{ marginBottom: 8 }}>
              {t("requiredLabel")}
            </div>

            <form autoComplete="on" onSubmit={(e) => e.preventDefault()}>
<div className="pe-grid">
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("companyNameReq")}</div>
                <input
                  className="pe-input"
                  id="companyName"
                  name="organization"
                  autoComplete="organization"
                  value={profile.companyName}
                  onChange={(e) => setProfile((p) => ({ ...p, companyName: e.target.value }))}
                  placeholder={lang === "es" ? "Nombre de la empresa" : "Company name"}
                />
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("phoneReq")}</div>
                <input
                  className="pe-input"
                  type="tel"
                  id="phone"
                  name="tel"
                  autoComplete="tel"
                  value={profile.phone}
                  onChange={(e) => setProfile((p) => ({ ...p, phone: formatPhoneUS(e.target.value) }))}
                  onInput={(e) => setProfile((p) => ({ ...p, phone: formatPhoneUS(e.target.value) }))}
                  onBlur={(e) => setProfile((p) => ({ ...p, phone: formatPhoneUS(e.target.value) }))}
                  placeholder={lang === "es" ? "Teléfono" : "Phone"}
                  inputMode="tel"
                />
              </div>
            </div>

            <div className="pe-grid" style={{ marginTop: 8 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("emailReq")}</div>
                <input
                  className="pe-input"
                  type="email"
                  id="email"
                  name="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={profile.email}
                  onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                  onInput={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                  placeholder={lang === "es" ? "Correo electrónico" : "Email"}
                />
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("addressReq")}</div>
                <input
                  className="pe-input"
                  id="address"
                  name="street-address"
                  autoComplete="street-address"
                  value={profile.address}
                  onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
                  onInput={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
                  placeholder={lang === "es" ? "Dirección" : "Address"}
                />
              </div>
            </div>

                        </form>

            <div className="pe-divider" style={{ margin: "14px 0" }} />

            <div className="pe-muted" style={{ marginBottom: 8 }}>
              {t("optionalLabel")}
            </div>

            <div className="pe-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div className="pe-muted" style={{ minWidth: 140 }}>
                {lang === "es" ? "Logo de empresa (opcional)" : "Company logo (optional)"}
              </div>

              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  const resized = await resizeLogoFile(file, {
                    maxWidth: 600,
                    maxHeight: 220,
                    jpegQuality: 0.85,
                    forcePng: false,
                  });

                  setProfile((p) => ({ ...p, logoDataUrl: resized }));
                  e.target.value = "";
                }}
              />

              {profile.logoDataUrl && (
                <>
                  <button
                    className="pe-btn pe-btn-ghost"
                    type="button"
                    onClick={() => {
                      triggerHaptic();
                      setProfile((p) => ({ ...p, logoDataUrl: "" }));
                    }}
                    title={lang === "es" ? "Eliminar logo guardado" : "Remove saved logo"}
                  >
                    {t("removeLogo")}
                  </button>

                  <img
                    src={profile.logoDataUrl}
                    alt="Company logo preview"
                    style={{ maxHeight: 54, maxWidth: 260, objectFit: "contain" }}
                  />
                </>
              )}
            </div>

            <div className="pe-grid" style={{ marginTop: 10 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("rocOpt")}</div>
                <input
                  className="pe-input"
                  value={profile.roc}
                  onChange={(e) => setProfile((p) => ({ ...p, roc: e.target.value }))}
                  placeholder={lang === "es" ? "ROC #" : "ROC #"}
                />
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("attnOpt")}</div>
                <input
                  className="pe-input"
                  value={profile.attn}
                  onChange={(e) => setProfile((p) => ({ ...p, attn: e.target.value }))}
                  placeholder={lang === "es" ? "Attn / Contact" : "Attn / Contact"}
                />
              </div>
            </div>

            <div className="pe-grid" style={{ marginTop: 8 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("websiteOpt")}</div>
                <input
                  className="pe-input"
                  value={profile.website}
                  onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))}
                  placeholder={lang === "es" ? "Sitio web" : "Website"}
                />
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("einOpt")}</div>
                <input
                  className="pe-input"
                  value={profile.ein}
                  onChange={(e) => setProfile((p) => ({ ...p, ein: e.target.value }))}
                  placeholder={lang === "es" ? "EIN" : "EIN"}
                />
              </div>
            </div>
            <div className="pe-row pe-row-slim" style={{ marginTop: 12 }}>
              <div className="pe-muted">{t("savedAuto")}</div>
              <button
                className="pe-btn pe-btn-ghost"
                type="button"
                onClick={() => {
                  triggerHaptic();
                  try { localStorage.removeItem(PROFILE_KEY); } catch (e) {}
                  setProfile({ ...DEFAULT_PROFILE });
                }}
                title={lang === "es" ? "Borrar perfil guardado" : "Clear saved profile"}
              >
                {lang === "es" ? "Restablecer perfil" : "Reset profile"}
              </button>
              <button
                className="pe-btn pe-btn-ghost"
                type="button"
                onClick={() => {
                  triggerHaptic();
                  if (!requiredComplete) {
                    warnCompanyIncomplete();
                    return;
                  }
                  setStep("estimate");
                }}
              >
                {t("continueArrow")}
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // STEP 2: ESTIMATOR
  return (
    <div className="pe-wrap">
      <PopStyles />
      <PagePerimeterSnake />
      
      {savePromptOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 12,
          }}
          onClick={() => {
            triggerHaptic();
            setSavePromptOpen(false);
          }}
        >
          <div
            style={{
              background: "#0b1220",
              color: "#ffffff",
              borderRadius: 18,
              maxWidth: 560,
              width: "100%",
              padding: 16,
              boxShadow: "0 18px 48px rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>
              {lang === "es" ? "Guardar" : "Save"}
            </div>

            <div style={{ lineHeight: 1.35, marginBottom: 14, fontSize: 14, opacity: 0.92 }}>
              {lang === "es"
                ? "Ya cargaste una estimación guardada. Elige: Sobrescribir para actualizarla, o Guardar como nueva para crear una copia separada."
                : "You have a saved estimate loaded. Choose: Overwrite to update it, or Save as New to create a separate copy."}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="pe-btn pe-btn-primary"
                style={{ minWidth: 160, flex: "1 1 160px", padding: "12px 14px" }}
                onClick={() => {
                  triggerHaptic();
                  setSavePromptOpen(false);
                  commitEstimateSave("overwrite");
                }}
              >
                {lang === "es" ? "Sobrescribir" : "Overwrite"}
              </button>

              <button
                type="button"
                className="pe-btn"
                style={{ minWidth: 160, flex: "1 1 160px", padding: "12px 14px" }}
                style={{ minWidth: 160, flex: "1 1 160px", padding: "12px 14px" }}
                onClick={() => {
                  triggerHaptic();
                  setSavePromptOpen(false);
                  commitEstimateSave("new");
                }}
              >
                {lang === "es" ? "Guardar como nueva" : "Save as New"}
              </button>

              <button
                type="button"
                className="pe-btn"
                onClick={() => {
                  triggerHaptic();
                  setSavePromptOpen(false);
                }}
              >
                {lang === "es" ? "Cancelar" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

{pdfPromptOpen && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.72)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10000,
      padding: 12,
    }}
    onClick={() => {
      triggerHaptic();
      setPdfPromptOpen(false);
    }}
  >
    <div
      style={{
        width: "min(520px, 96vw)",
        background: "#0b1220",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 16,
        padding: 16,
        boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
        color: "#fff",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
        {lang === "es" ? "Exportar PDF" : "Export PDF"}
      </div>
      <div style={{ opacity: 0.9, lineHeight: 1.35, marginBottom: 14 }}>
        {lang === "es"
          ? "Elige una opción: cancelar, ver el PDF, o compartir/descargar."
          : "Choose an option: cancel, preview the PDF, or share/download."}
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          className="pe-btn pe-btn-ghost"
          style={{
            background: "transparent",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.22)",
          }}
          onClick={() => {
            triggerHaptic();
            setPdfPromptOpen(false);
          }}
        >
          {lang === "es" ? "Cancelar" : "Cancel"}
        </button>

        <button
          type="button"
          className="pe-btn pe-btn-ghost"
          style={{
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.22)",
          }}
          onClick={() => {
            triggerHaptic();
            setPdfPromptOpen(false);
            exportPDF("view");
          }}
        >
          {lang === "es" ? "Ver PDF" : "View PDF"}
        </button>

        <button
          type="button"
          className="pe-btn"
          style={{
            background: "linear-gradient(180deg, rgba(59,130,246,0.95), rgba(37,99,235,0.95))",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.18)",
          }}
          onClick={() => {
            triggerHaptic();
            const hasShare = typeof navigator !== "undefined" && !!navigator.share;
            setPdfPromptOpen(false);
            exportPDF(hasShare ? "share" : "download");
          }}
        >
          {(() => {
            const hasShare = typeof navigator !== "undefined" && !!navigator.share;
            if (lang === "es") return hasShare ? "Compartir PDF" : "Descargar PDF";
            return hasShare ? "Share PDF" : "Download PDF";
          })()}
        </button>
      </div>
    </div>
  </div>
)}


      

      <main className="pe-card">
        {view === "advanced" ? advancedScreen : (
          <>

        {/* JOB INFO */}
        <section className="pe-section">
          <div className="pe-section-title">{t("jobInfo")}</div>

          {/* ✅ Recent customers (tap-to-fill) */}
          <div className="pe-grid">
            <div style={{ gridColumn: "1 / -1", ...FIELD_STACK }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("recentEstimates")}</div>
              <select
                className="pe-input"
                value={recentEstimateId}
                onChange={(e) => {
                  const id = e.target.value;
                  setRecentEstimateId(id);
                  const found = history.find((h) => String(h?.id) === String(id));
                  if (!found) return;
                  loadEstimate(found);
                  // act like an action menu (reset back to placeholder)
                  setTimeout(() => setRecentEstimateId(""), 50);
                }}
              >
                <option value="">{lang === "es" ? "Seleccionar…" : "Select…"}</option>
                {history.slice(0, 10).map((h) => (
                  <option key={h.id} value={h.id}>
                    {(h.client || (h.customerSnapshot && h.customerSnapshot.name) || (lang === "es" ? "Estimación" : "Estimate")) +
                      (h.date ? ` — ${h.date}` : "")}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                {history.length
                  ? (lang === "es" ? "Carga una estimación reciente." : "Load a recent estimate.")
                  : (lang === "es" ? "No hay estimaciones guardadas aún." : "No saved estimates yet.")}
              </div>
            </div>

            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Fecha" : "Date"}</div>
              <input className="pe-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>


            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>PO#</div>
              <input className="pe-input" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder={lang === "es" ? "PO# (opcional)" : "PO# (optional)"} />
            </div>

            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Proyecto" : "Project name"}</div>
              <input
                className="pe-input"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={lang === "es" ? "Nombre del proyecto (opcional)" : "Project name (optional)"}
              />
            </div>

            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Proyecto #" : "Project #"}</div>
              <input
                className="pe-input"
                value={projectNumber}
                onChange={(e) => setProjectNumber(e.target.value)}
                placeholder={lang === "es" ? "Proyecto # (opcional)" : "Project # (optional)"}
              />
            </div>

                        {/* Project location/address */}
            <div style={{ gridColumn: "1 / -1", ...FIELD_STACK }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Ubicación/Dirección del proyecto" : "Project location/address"}</div>

              {!projectAddressSameAsCustomer && (
                <textarea
                  className="pe-input"
                  rows={2}
                  value={projectAddress}
                  onChange={(e) => {
                    const v = e.target.value;
                    setProjectAddress(v);
                    setLastManualProjectAddress(v);
                  }}
                  placeholder={lang === "es" ? "Dirección del proyecto (opcional)" : "Project address (optional)"}
                />
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: -2 }}>
                <input
                  type="checkbox"
                  checked={projectAddressSameAsCustomer}
                  onChange={(e) => {
                    const checked = Boolean(e.target.checked);
                    if (checked) {
                      // switching to "same as customer": stash manual address and hide field
                      if (!projectAddressSameAsCustomer) {
                        setLastManualProjectAddress(String(projectAddress || ""));
                      }
                      setProjectAddressSameAsCustomer(true);
                      setProjectAddress("");
                    } else {
                      // switching to manual: restore last manual value
                      setProjectAddressSameAsCustomer(false);
                      setProjectAddress(String(lastManualProjectAddress || ""));
                    }
                  }}
                />
                <div style={{ fontSize: 12, opacity: 0.9 }}>
                  {lang === "es" ? "Igual que la dirección del cliente" : "Same as customer address"}
                </div>
              </div>
            </div>
          </div>

{/* ✅ Customer */}
          <div className="pe-grid" style={{ marginTop: 10 }}>
            {/* section break */}
            <div style={{ gridColumn: "1 / -1", paddingTop: 8, marginTop: 2, borderTop: "1px solid rgba(255,255,255,0.10)" }}>
              <div style={{ ...FIELD_LABEL, fontWeight: 800, letterSpacing: 0.6 }}>
                {lang === "es" ? "Cliente" : "Customer"}
              </div>
            </div>

                        <div style={{ gridColumn: "1 / -1", ...FIELD_STACK }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Seleccionar cliente" : "Select customer"}</div>
              <input
                className="pe-input"
                value={customerSelectQuery}
                onChange={(e) => setCustomerSelectQuery(e.target.value)}
                placeholder={lang === "es" ? "Buscar cliente..." : "Search customer..."}
                style={{ marginBottom: 6 }}
              />
              <select
                className="pe-input"
                value={customerCreating ? "__new__" : (selectedCustomerId || "")}
                onChange={(e) => {
                  const id = e.target.value;

                  if (id === "__new__") {
                    // Create new customer
                    setSelectedCustomerId("");
                    setCustomerCreating(true);
                    setCustomerPanelOpen(true);

                    // Clear customer fields for a clean start
                    setClient("");
                    setCustomerPhone("");
                    setCustomerEmail("");
                    setLocation("");
                    setCustomerAttn("");
                    setBillingDiff(false);
                    setBillingAddress("");
                    return;
                  }

                  if (!id) {
                    // Nothing selected
                    setSelectedCustomerId("");
                    setCustomerCreating(false);
                    setCustomerPanelOpen(false);
                    return;
                  }

                  // Load saved customer
                  setCustomerCreating(false);
                  setCustomerPanelOpen(false);
                  setSelectedCustomerId(id);
                  const found = customersSorted.find((c) => String(c?.id) === String(id));
                  if (found) applyCustomerToForm(found);
                }}
              >
                <option value="">{lang === "es" ? "— Seleccionar —" : "— Select —"}</option>

                {String(customerSelectQuery || "").trim() ? (
                  <optgroup label={lang === "es" ? "Resultados" : "Results"}>
                    {customersSelectFiltered.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                    ) : null}

                    {customersSorted.length ? (
                      <optgroup label={lang === "es" ? "Guardados" : "Saved"}>
                        {customersNonRecent.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}

                <option value="__new__">{lang === "es" ? "➕ Crear nuevo" : "➕ Create new"}</option>
              </select>
            </div>
                <div className="pe-muted" style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    {selectedCustomerId ? (
                      <>
                        <div style={{ fontWeight: 800, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {client || ""}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2, whiteSpace: "pre-wrap" }}>{location || ""}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, opacity: 0.9 }}>
                        {lang === "es" ? "Sin cliente seleccionado." : "No customer selected."}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="pe-btn pe-btn-lite"
                    onClick={() => {
                      setCustomerCreating(false);
                      setCustomerEditing(false);
                      setCustomerPanelOpen(true);
                    }}
                  >
                    {selectedCustomerId ? (lang === "es" ? "Cambiar" : "Change") : (lang === "es" ? "Seleccionar" : "Select")}
                  </button>
                </div>

            {(customerCreating || customerEditing) ? (
              <>
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("customerName")}</div>
              <input className="pe-input" value={client} onChange={(e) => setClient(e.target.value)} placeholder={lang === "es" ? "Cliente" : "Customer"} />
            </div>

            
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("customerAttn")}</div>
              <input className="pe-input" value={customerAttn} onChange={(e) => setCustomerAttn(e.target.value)} placeholder={lang === "es" ? "Atn." : "Attn"} />
            </div>

<div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("customerPhone")}</div>
              <input className="pe-input" value={customerPhone} onChange={(e) => setCustomerPhone(formatPhoneUS(e.target.value))} placeholder={lang === "es" ? "Teléfono" : "Phone"} />
            </div>

            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("customerEmail")}</div>
              <input className="pe-input" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder={lang === "es" ? "Correo" : "Email"} />
            </div>

            <div style={{ gridColumn: "1 / -1", ...FIELD_STACK }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("customerAddress")}</div>
              <input className="pe-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={lang === "es" ? "Dirección" : "Address"} />
            </div>


            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Términos de pago" : "Payment terms"}</div>
              <select className="pe-input" value={String(customerTermsDays)} onChange={(e) => setCustomerTermsDays(parseInt(String(e.target.value || "0"), 10) || 0)}>
                <option value="0">{lang === "es" ? "Al recibir" : "Due upon receipt"}</option>
                <option value="15">{lang === "es" ? "Neto 15" : "Net 15"}</option>
                <option value="30">{lang === "es" ? "Neto 30" : "Net 30"}</option>
              </select>
            </div>

            <div style={{ gridColumn: "1 / -1", ...FIELD_STACK }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={billingDiff}
                  onChange={(e) => setBillingDiff(e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <span style={{ fontSize: 13, fontWeight: 800, opacity: 0.85 }}>{t("billingDiff")}</span>
              </label>
            </div>

            {billingDiff ? (
              <div style={{ gridColumn: "1 / -1", ...FIELD_STACK }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("billingAddress")}</div>
                <input className="pe-input" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} placeholder={lang === "es" ? "Dirección de facturación" : "Billing address"} />
              </div>
            ) : null}
                {(customerCreating || customerEditing) ? (
                  <div style={{ gridColumn: "1 / -1", marginTop: 8, display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                    <button type="button" className="pe-btn pe-btn-ghost" onClick={cancelCustomerEstimatorEdit}>
                      {lang === "es" ? "Cancelar" : "Cancel"}
                    </button>

                    <button
                      type="button"
                      className="pe-btn pe-btn-lite"
                      onClick={saveCustomerFromEstimator}
                      disabled={!String(client || "").trim()}
                      title={!String(client || "").trim() ? (lang === "es" ? "Requiere nombre" : "Name required") : ""}
                      style={!String(client || "").trim() ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
                    >
                      {customerCreating || !selectedCustomerId
                        ? (lang === "es" ? "Guardar cliente" : "Save customer")
                        : (lang === "es" ? "Guardar cambios" : "Save changes")}
                    </button>
                  </div>
                ) : null}

              </>
            ) : null}
          </div>

          </section>

        <div className="pe-divider" />

        {docType !== "invoice" && (
          <section className="pe-section">
            <div className="pe-section-title">{lang === "es" ? "Alcance / notas" : "Scope / notes"}</div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              <div style={{ ...FIELD_STACK, flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Plantilla" : "Template"}</div>
                <select
                  className="pe-input"
                  style={{ width: "100%" }}
                  value={masterScopeKey}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMasterScopeKey(v);
                    if (v) {
                      applyMasterTemplate(v);
                      setMasterScopeKey("");
                    }
                  }}
                >
                  <option value="">{lang === "es" ? "Insertar plantilla…" : "Insert template…"}</option>
                  {SCOPE_MASTER_TEMPLATES.map((x) => (
                    <option key={x.key} value={x.key}>
                      {lang === "es" ? x.labelEs : x.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ ...FIELD_STACK, flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Insertar oficio" : "Trade insert"}</div>
                <select
                  className="pe-input"
                  style={{ width: "100%" }}
                  value={tradeInsertKey}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTradeInsertKey(v);
                    if (v) {
                      applyTradeInsert(v);
                      setTradeInsertKey("");
                    }
                  }}
                >
                  <option value="">{lang === "es" ? "Insertar…" : "Insert…"}</option>
                  {(lang === "es" ? SCOPE_TRADE_INSERTS_ES : SCOPE_TRADE_INSERTS).map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="pe-btn"
                type="button"
                onClick={() => setDescription("")}
                title={lang === "es" ? "Borrar alcance/notas" : "Clear scope/notes"}
                style={{ flex: "0 0 auto" }}
              >
                {t("clearScopeBox")}
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Alcance / notas" : "Scope / notes"}</div>
                <ResizableTextarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("scopePlaceholder")}
                  minHeight={240}
                  height={scopeBoxHeight}
                  setHeight={setScopeBoxHeight}
                />
              </div>
            </div>
          </section>
        )}



        {/* LABOR */}
        <section className="pe-section">
          <div className="pe-row" style={{ alignItems: "center", gap: 10 }}>
            <div className="pe-section-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {t("labor")}
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => setLaborOpen((v) => !v)}
                aria-expanded={laborOpen}
                title={
                  laborOpen
                    ? (lang === "es" ? "Colapsar" : "Collapse")
                    : (lang === "es" ? "Expandir" : "Expand")
                }
                style={{ padding: "6px 10px", minWidth: 44 }}
              >
                {laborOpen ? "▾" : "▸"}
              </button>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              {!laborOpen && (
                <div className="pe-muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {(laborLines?.length || 0) === 1
                    ? (lang === "es" ? "1 línea" : "1 line")
                    : `${laborLines?.length || 0} ${lang === "es" ? "líneas" : "lines"}`}
                  {" • "}
                  {money.format(Number(laborAdjusted) || 0)}
                </div>
              )}
              <button className="pe-btn" onClick={addLaborLine} type="button">
                {t("addLabor")}
              </button>
            </div>
          </div>

          {laborOpen && laborLines.map((l, i) => {
            const presetLabels = LABOR_PRESETS.map((p) => p.label);
            const hasLegacyLabel = l.label && !presetLabels.includes(l.label);

            return (
              <div key={i} style={{ marginTop: 8 }}>
                <div className="pe-grid">
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Rol" : "Role"}</div>
                  <select
                    className="pe-input"
                    value={l.label || ""}
                    onChange={(e) => applyLaborPresetByLabel(i, e.target.value)}
                    title={lang === "es" ? "Rol" : "Role"}
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

                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("hours")}</div>
                  <input
                    className="pe-input"
                    placeholder={t("hours")}
                    value={l.hours}
                    onChange={(e) => updateLaborLine(i, "hours", e.target.value)}
                    onBlur={(e) => updateLaborLine(i, "hours", normalizeHoursInput(e.target.value))}
                    inputMode="decimal"
                  />
                </div>

                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("rate")}</div>

                    <input
                      className="pe-input"
                      placeholder={t("rate")}
                      value={l.rate}
                      onChange={(e) => updateLaborLine(i, "rate", e.target.value)}
                      onBlur={(e) => updateLaborLine(i, "rate", normalizeMoneyInput(e.target.value))}
                      inputMode="decimal"
                    />

                </div>

                {(
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>
                      {lang === "es" ? "Tarifa real (interna)" : "True rate (internal)"}
                      <span
                        className="pe-muted"
                        style={{ marginLeft: 8, fontSize: 12, fontWeight: 500 }}
                        title={lang === "es" ? "Opcional: si está vacío, usa Tarifa" : "Optional: if blank, uses Rate"}
                      >
                        {lang === "es" ? "(opcional)" : "(optional)"}
                      </span>
                    </div>
                    <input
                      className="pe-input"
                      placeholder={lang === "es" ? "Tarifa interna" : "Internal rate"}
                      value={l.internalRate || ""}
                      onChange={(e) => updateLaborLine(i, "internalRate", e.target.value)}
                      onBlur={(e) => updateLaborLine(i, "internalRate", normalizeMoneyInput(e.target.value))}
                      inputMode="decimal"
                      title={lang === "es" ? "Solo interno (no se imprime)" : "Internal only (not printed)"}
                    />
                  </div>
                )}
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div
                    className="pe-muted"
                    title={lang === "es" ? "Cantidad en esta línea" : "Headcount on this line"}
                    style={{ minWidth: 54 }}
                  >
                    x{Number(l.qty) || 1}
                  </div>

                  <button
                    className="pe-btn pe-btn-ghost"
                    type="button"
                    onClick={() => decrementLaborQty(i)}
                    title={lang === "es" ? "Disminuir (mín 1)" : "Decrease headcount (min 1)"}
                  >
                    -
                  </button>

                  <button
                    className="pe-btn pe-btn-ghost"
                    type="button"
                    onClick={() => duplicateLaborLine(i)}
                    title={
                      lang === "es"
                        ? "Duplicar trabajador en esta línea (no agrega fila)"
                        : "Duplicate laborer on this SAME line (does not add a new row)"
                    }
                  >
                    {t("duplicate")}
                  </button>

                  <button className="pe-btn pe-btn-ghost" type="button" onClick={() => removeLaborLine(i)}>
                    {t("remove")}
                  </button>
                </div>
              </div>
            );
          })}

          

          <div className="pe-row pe-row-slim">
            <div className="pe-muted">{lang === "es" ? "Mano de obra base" : "Base labor"}</div>
            <div className="pe-value">{money.format(laborBase)}</div>
          </div>
        
          {/* Bottom collapse control (Labor section) */}
          {laborOpen && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => setLaborOpen(false)}
                title={lang === "es" ? "Colapsar" : "Collapse"}
                style={{ padding: "6px 10px" }}
              >
                {lang === "es" ? "Colapsar" : "Collapse"} ▴
              </button>
            </div>
          )}
</section>

        <div className="pe-divider" />

        {/* SPECIAL CONDITIONS */}
        <section className="pe-section">
          <div className="pe-section-title">{t("specialConditions")}</div>

          <div className="pe-grid">
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Condición" : "Condition"}</div>
              <select
                className="pe-input"
                value={multiplierSelectValue}
                onChange={(e) => handleMultiplierSelect(e.target.value)}
              >
                <option value="1">{t("standard")}</option>
                <option value="1.1">{t("difficultAccess")}</option>
                <option value="1.2">{t("highRisk")}</option>
                <option value="1.25">{t("offHours")}</option>
                <option value="custom">{t("customEllipsis")}</option>
              </select>
            </div>

            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("hazardPct")}</div>
              <input
                className="pe-input"
                value={hazardPct}
                onChange={(e) => setHazardPct(e.target.value)}
                onBlur={(e) => setHazardPct(normalizePercentInput(e.target.value))}
                placeholder={t("hazardPct")}
                inputMode="decimal"
                title={lang === "es" ? "Porcentaje de mano de obra ajustada" : "Percent of adjusted labor only"}
              />
            </div>
          </div>

          {multiplierMode === "custom" && (
            <div className="pe-grid" style={{ marginTop: 8 }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("customMultiplier")}</div>
                <input
                  className="pe-input"
                  value={customMultiplier}
                  onChange={(e) => setCustomMultiplier(e.target.value)}
                  onBlur={(e) => setCustomMultiplier(normalizeMultiplierInput(e.target.value))}
                  placeholder={t("customMultiplier")}
                  inputMode="decimal"
                />
              </div>
              <div />
            </div>
          )}

          <div className="pe-row pe-row-slim">
            <div className="pe-muted">{lang === "es" ? "Mano de obra ajustada" : "Adjusted labor"}</div>
            <div className="pe-value">{money.format(laborAdjusted)}</div>
          </div>

          {hazardEnabled && (
            <div className="pe-row pe-row-slim">
              <div className="pe-muted">
                {lang === "es"
                  ? `Riesgo (${hazardPctNormalized}% de mano de obra)`
                  : `Hazard / risk (${hazardPctNormalized}% of labor)`}
              </div>
              <div className="pe-value">{money.format(hazardFeeDollar)}</div>
            </div>
          )}

        </section>

        <div className="pe-divider" />

        {/* MATERIALS */}
        <section className="pe-section">
          <div className="pe-section-title">{t("materials")}</div>

          {/* ✅ NEW: materials mode toggle */}
          <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div className="pe-muted" style={{ minWidth: 140 }}>
              {t("materialsMode")}
            </div>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: 2,
                borderRadius: 999,
                border: "1px solid rgba(0,0,0,0.12)",
                background: "rgba(255,255,255,0.55)",
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
              }}
            >
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => {
                  triggerHaptic();
                  setMaterialsMode("blanket");
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontWeight: materialsMode === "blanket" ? 700 : 500,
                  background: materialsMode === "blanket" ? "rgba(0,0,0,0.18)" : "transparent",
                  border: materialsMode === "blanket" ? "1px solid rgba(0,0,0,0.22)" : "1px solid transparent",
                  boxShadow: materialsMode === "blanket" ? "0 1px 2px rgba(0,0,0,0.18)" : "none",
                }}
              >
                {t("materialsModeBlanket")}
              </button>

              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => {
                  triggerHaptic();
                  setMaterialsMode("itemized");
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontWeight: materialsMode === "itemized" ? 700 : 500,
                  background: materialsMode === "itemized" ? "rgba(0,0,0,0.18)" : "transparent",
                  border: materialsMode === "itemized" ? "1px solid rgba(0,0,0,0.22)" : "1px solid transparent",
                  boxShadow: materialsMode === "itemized" ? "0 1px 2px rgba(0,0,0,0.18)" : "none",
                }}
              >
                {t("materialsModeItemized")}
              </button>
            </div>
          </div>

          {/* Blanket mode (existing behavior: cost + markup %) */}
          {materialsMode === "blanket" && (
            <>
              <div className="pe-grid" style={{ marginTop: 10 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("materialsCost")}</div>
                  <input
                    className="pe-input"
                    value={materialsCost}
                    onChange={(e) => setMaterialsCost(e.target.value)}
                    onBlur={(e) => setMaterialsCost(normalizeMoneyInput(e.target.value))}
                    placeholder={t("materialsCost")}
                    inputMode="decimal"
                  />
                </div>

                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("markupPct")}</div>
                  <input
                    className="pe-input"
                    value={materialsMarkupPct}
                    onChange={(e) => setMaterialsMarkupPct(e.target.value)}
                    onBlur={(e) => setMaterialsMarkupPct(normalizePercentInput(e.target.value))}
                    placeholder={t("markupPct")}
                    inputMode="decimal"
                  />
                </div>
              </div>

              <div className="pe-row pe-row-slim">
                <div className="pe-muted">
                  {lang === "es"
                    ? `Materiales facturados (${normalizedMarkupPct}%)`
                    : `Materials billed (${normalizedMarkupPct}%)`}
                </div>
                <div className="pe-value">{money.format(materialsBilled)}</div>
              </div>
            </>
          )}

          {/* Itemized mode (qty × charge totals into estimate; NO markup applied) */}
          {materialsMode === "itemized" && (
            <>
              <div className="pe-muted" style={{ marginTop: 8 }}>
                {t("materialsItemizedHelp")}
              </div>

              <div className="pe-row" style={{ marginTop: 10 }}>
                <button className="pe-btn" type="button" onClick={addMaterialItem}>
                  {t("addMaterialItem")}
                </button>
              </div>

              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {materialItems.map((it, i) => {
                  const qtyVal = Math.max(1, Number(it.qty) || 1);
                  const eachVal = Number(it.charge) || 0;
                  const lineTotal = qtyVal * eachVal;

                  return (
                    <div
                      key={i}
                      style={{
                        marginTop: 0,
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(0,0,0,0.12)",
                      }}
                    >
                      <div style={{ display: "grid", gap: 4 }}>
                        <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{t("materialDesc")}</div>
                        <input
                          className="pe-input"
                          value={it.desc}
                          onChange={(e) => updateMaterialItem(i, "desc", e.target.value)}
                          placeholder={lang === "es" ? "Descripción" : "Description"}
                          style={{ width: "100%" }}
                        />
                      </div>

                      {/* Bottom row: qty + price(each) */}

                      <div
                        style={{
                          marginTop: 8,
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr 40px",
                          gap: 8,
                          alignItems: "end",
                        }}
                      >
                        <div style={{ ...FIELD_STACK }}>
                          <div style={{ ...FIELD_LABEL }}>{t("materialQty")}</div>
                          <select
                            className="pe-input"
                            value={qtyVal}
                            onChange={(e) => updateMaterialItem(i, "qty", e.target.value)}
                            title={t("materialQty")}
                            style={{ width: "100%" }}
                          >
                            {Array.from({ length: 50 }, (_, n) => n + 1).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>

                        

                        <div style={{ ...FIELD_STACK }}>
                          <div style={{ ...FIELD_LABEL }}>{t("materialCostInternal")}</div>
                          <input
                            className="pe-input"
                            value={it.cost ?? ""}
                            onChange={(e) => updateMaterialItem(i, "cost", e.target.value)}
                            onBlur={(e) => updateMaterialItem(i, "cost", normalizeMoneyInput(e.target.value))}
                            placeholder={MONEY_PH}
                            inputMode="decimal"
                            title={lang === "es" ? "Solo interno (no se imprime)" : "Internal only (not printed)"}
                            style={{ width: "100%" }}
                          />
                        </div>

                        <div style={{ ...FIELD_STACK }}>
                          <div style={{ ...FIELD_LABEL }}>{t("materialCharge")}</div>
                          <input
                            className="pe-input"
                            value={it.charge}
                            onChange={(e) => updateMaterialItem(i, "charge", e.target.value)}
                            onBlur={(e) => updateMaterialItem(i, "charge", normalizeMoneyInput(e.target.value))}
                            placeholder={MONEY_PH}
                            inputMode="decimal"
                            style={{ width: "100%" }}
                          />
                        </div>

                        <button
                          className="pe-btn pe-btn-ghost"
                          type="button"
                          onClick={() => removeMaterialItem(i)}
                          title={lang === "es" ? "Quitar material" : "Remove item"}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 999,
                            display: "grid",
                            placeItems: "center",
                            padding: 0,
                            fontSize: 22,
                            lineHeight: 1,
                            alignSelf: "end",
                          }}
                        >
                          −
                        </button>
                      </div>

                      <div className="pe-row pe-row-slim" style={{ marginTop: 6 }}>
                        <div className="pe-muted">
                          {lang === "es" ? "Total de línea" : "Line total"}
                        </div>
                        <div className="pe-value">{money.format(lineTotal)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pe-row pe-row-slim" style={{ marginTop: 10 }}>
                <div className="pe-muted">{t("materialsItemizedTotal")}</div>
                <div className="pe-value">{money.format(itemizedMaterialsTotal)}</div>
              </div>
            </>
          )}
        </section>

        <div className="pe-divider" />

        {/* TOTAL */}
        <section className="pe-section">
          <div className="pe-total">
            <div>
              <div className="pe-total-label">{docType === "invoice" ? t("invoiceTotal") : t("estimateTotal")}</div>
              <div className="pe-total-meta">
                {laborLines.length} {t("laborLines")}{Number(laborAdjusted) > 0 ? ` (${money.format(laborAdjusted)})` : ""}
                {totalLaborers !== laborLines.length ? ` • ${totalLaborers} ${t("laborers")}` : ""}
                {effectiveMultiplier !== 1 ? ` • ${effectiveMultiplier}${t("complexity")}` : ""}
                {hazardEnabled ? ` • ${hazardPctNormalized}${t("risk")}` : ""}
                {/* Materials meta */}
                {materialsMode === "blanket" && Number.isFinite(Number(normalizedMarkupPct))
                  ? ` • ${normalizedMarkupPct}${t("materialsMeta")}`
                  : ""}

                {materialsMode === "itemized" && (materialItems || []).length > 0
                  ? ` • ${itemizedMaterialsCount}x ${lang === "es" ? "materiales" : "materials"} • ${money.format(itemizedMaterialsTotal)}`
                  : ""}

                {Number(total) > 0 ? ` • GM ${grossMarginPct}% • ${lang === "es" ? "Costo total" : "Total cost"} ${money.format(totalTrueCost)}` : ""}
              </div>
            </div>
            <div className="pe-total-right">{money.format(total)}</div>
          </div>
        </section>

        <div className="pe-divider" />

        {/* ADDITIONAL NOTES (BOTTOM ONLY) */}
        {docType !== "invoice" && (
        <section className="pe-section">
          <div className="pe-row">
            <div className="pe-section-title">{t("additionalNotes")}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                className="pe-btn pe-btn-ghost"
                type="button"
                onClick={clearAdditionalNotes}
                disabled={!String(additionalNotesText || "").trim()}
                title={
                  !String(additionalNotesText || "").trim()
                    ? lang === "es"
                      ? "No hay notas"
                      : "No notes to clear"
                    : lang === "es"
                    ? "Borrar todas las notas"
                    : "Clear all notes"
                }
              >
                {t("clearNotes")}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            {QUICK_NOTES.map((b) => (
              <button
                key={b.key}
                className="pe-btn pe-btn-ghost"
                type="button"
                onClick={() => {
                  triggerHaptic();
                  addAdditionalNoteLine(b.line);
                }}
                title={lang === "es" ? "Agrega a Notas adicionales" : "Adds to Additional Notes (warns if already present)"}
              >
                {b.label}
              </button>
            ))}
            {/* ✅ Terms buttons (drive Due date for invoices) */}
            

            
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, opacity: 0.75, paddingLeft: 2 }}>{lang === "es" ? "Notas adicionales" : "Additional notes"}</div>
              <ResizableTextarea
                value={additionalNotesText}
                onChange={(e) => setAdditionalNotesText(e.target.value)}
                placeholder={t("notesPlaceholder")}
                minHeight={120}
                height={notesBoxHeight}
                setHeight={setNotesBoxHeight}
              />
            </div>
          </div>

          <div className="pe-muted" style={{ marginTop: 6 }}>
            {t("printsSmall")}
          </div>
        </section>
        )}

        {/* Field Calculator moved to Advanced (bottom) */}
          </>
        )}
      </main>
    </div>
  );

}
export default function EstimateForm(props) {
  const { embeddedInShell = true } = props || {};

  // language init: localStorage first; otherwise Spanish-first based on device language
  const [lang, setLang] = useState(() => {
    const saved = loadSavedLang();
    return saved || "";
  });

  const [langConfirmed, setLangConfirmed] = useState(() => {
    // Auto-confirm if a language was previously saved (language selection lives on Home)
    try {
      const saved = loadSavedLang();
      return saved === "en" || saved === "es";
    } catch {
      return false;
    }
  });

  const [justChoseLanguage, setJustChoseLanguage] = useState(false);

  const setLanguage = (next) => {
    const v = next === "es" ? "es" : "en";
    const wasReady = (lang === "en" || lang === "es") && langConfirmed;
    setLang(v);
    setLangConfirmed(true);
    if (!wasReady) setJustChoseLanguage(true);
  };


  const t = useMemo(() => {
    const pack = I18N[lang] || I18N.en;
    return (key, ...args) => {
      const v = pack[key];
      if (typeof v === "function") return v(...args);
      return v !== undefined ? v : I18N.en[key] ?? key;
    };
  }, [lang]);

  const langChosen = lang === "en" || lang === "es";
  const langReady = langChosen && langConfirmed;


  
  if (!langReady) {
    return <LanguageGate t={t} setLanguage={setLanguage} />;
  }

  return (
    <EstimateFormInner lang={lang} setLang={setLang} setLanguage={setLanguage} t={t} forceProfileOnMount={justChoseLanguage} embeddedInShell={embeddedInShell} />
  );
}