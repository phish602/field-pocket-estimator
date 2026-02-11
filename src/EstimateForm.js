import { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { calculateEstimateWithLaborLines } from "./estimate";
import "./EstimateForm.css";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/* =========================
   LANGUAGE / I18N (MANUAL TOGGLE)
   ========================= */
const LANG_KEY = "field-pocket-lang";

function detectDefaultLang() {
  try {
    const nav = String(navigator?.language || "").toLowerCase();
    if (nav.startsWith("es")) return "es";
  } catch {
    // ignore
  }
  return "en";
}

function loadSavedLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "en" || v === "es") return v;
  } catch {
    // ignore
  }
  return "";
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
    scopePlaceholder: "Scope / notes (templates insert here)",
    selectRole: "Select role…",
    hours: "Hours",
    rate: "Rate",
    materialsCost: "Materials cost",
    markupPct: "Markup % (ex: 20)",
    hazardPct: "Hazard / risk % of LABOR (ex: 30)",
    customMultiplier: "Custom labor multiplier (ex: 1.18)",
    notesPlaceholder: "Type any additional notes here… (the + buttons will append too)",

    // ✅ NEW: materials mode + itemized UI
    materialsMode: "Materials mode",
    materialsModeBlanket: "Blanket materials",
    materialsModeItemized: "Itemized materials",
    materialsItemizedHelp:
      "Use itemized materials when you need to line-item critical material. Qty × charge totals into the estimate.",
    addMaterialItem: "+ Add material item",
    materialDesc: "Description",
    materialQty: "Qty",
    materialCostInternal: "Cost (internal)",
    materialCharge: "Charge (each)",
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
    pdfClient: "Client",
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
    scopePlaceholder: "Alcance / notas (las plantillas se insertan aquí)",
    selectRole: "Seleccionar rol…",
    hours: "Horas",
    rate: "Tarifa",
    materialsCost: "Costo de materiales",
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
    materialCharge: "Cargo (c/u)",
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
    pdfClient: "Cliente",
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
  } catch {
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
  return { label: "", hours: "", rate: "", qty: 1 };
}

// ✅ NEW: itemized materials rows
function newMaterialItem() {
  return { desc: "", qty: 1, cost: "", charge: "" }; // cost = internal (not on PDF); charge = per-unit billed amount
}

function safeFilename(s) {
  const base = String(s || "").trim() || "Client";
  return base.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
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
const PROFILE_KEY = "field-pocket-profile";

function LanguageGate({ t, setLanguage }) {
  return (
        <div className="pe-wrap">
          <header className="pe-header">
            <div>
              <h1 className="pe-title">Field Pocket Estimator</h1>
              <div className="pe-subtitle">{t("chooseLanguageTitle")}</div>
            </div>
  
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: 2,
                  borderRadius: 999,
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "rgba(255,255,255,0.45)",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic();
                    setLanguage("en");
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 700,
                    background: "rgba(0,0,0,0.10)",
                  }}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic();
                    setLanguage("es");
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 700,
                    background: "rgba(0,0,0,0.10)",
                  }}
                >
                  ES
                </button>
              </div>
            </div>
          </header>
  
          <div className="pe-card" style={{ marginTop: 18 }}>
            <div style={{ fontSize: 14, opacity: 0.85, lineHeight: 1.35 }}>{t("chooseLanguageBody")}</div>
          </div>
        </div>
      );
}

function EstimateFormInner({ lang, setLang, setLanguage, t, forceProfileOnMount = false }) {



  const protectedBlocks = useMemo(() => buildProtectedBlocks(), []);


  // ✅ Keep last-known English custom text so we can revert without needing a translator
  const lastEnglishDescriptionRef = useRef("");
  const lastEnglishAdditionalNotesRef = useRef("");

  // ✅ Optional: OpenAI key stored in localStorage for client-side translation (dev/prototype)
  const [openaiKey, setOpenaiKey] = useState(() => {
    try {
      return String(localStorage.getItem("field-pocket-openai-key") || "");
    } catch {
      return "";
    }
  });

  useEffect(() => {
    try {
      const v = String(openaiKey || "").trim();
      if (v) localStorage.setItem("field-pocket-openai-key", v);
      else localStorage.removeItem("field-pocket-openai-key");
    } catch {
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
    } catch {
      // ignore
    }
  }, [lang]);

  const [profile, setProfile] = useState({
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
  });

  const [step, setStep] = useState(() => (forceProfileOnMount ? "profile" : "estimate")); // "profile" | "estimate"

  // ✅ NEW: estimate vs invoice mode (UI + PDF)
  const [docType, setDocType] = useState("estimate"); // "estimate" | "invoice"

  const [date, setDate] = useState(todayISO());
  const [client, setClient] = useState("");
  const [description, setDescription] = useState("");

  const [masterScopeKey, setMasterScopeKey] = useState("");
  const [tradeInsertKey, setTradeInsertKey] = useState("");

  const [additionalNotesText, setAdditionalNotesText] = useState("");

  const [laborLines, setLaborLines] = useState([newLaborLine()]);

  const [laborMultiplier, setLaborMultiplier] = useState(1);
  const [multiplierMode, setMultiplierMode] = useState("preset");
  const [customMultiplier, setCustomMultiplier] = useState("1");

  // ✅ NEW: materials mode toggle + itemized rows
  const [materialsMode, setMaterialsMode] = useState("blanket"); // "blanket" | "itemized"
  const [materialItems, setMaterialItems] = useState([newMaterialItem()]);

  const [materialsCost, setMaterialsCost] = useState("");
  const [hazardPct, setHazardPct] = useState("");

  const [materialsMarkupPct, setMaterialsMarkupPct] = useState("20");

  const [history, setHistory] = useState([]);

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
    setDocType("estimate");
    setDate(todayISO());
    setClient("");
    setDescription("");
    setMasterScopeKey("");
    setTradeInsertKey("");
    setAdditionalNotesText("");
    setLaborLines([newLaborLine()]);
    setLaborMultiplier(1);
    setMultiplierMode("preset");
    setCustomMultiplier("1");

    // ✅ NEW: materials reset
    setMaterialsMode("blanket");
    setMaterialItems([newMaterialItem()]);
    setMaterialsCost("");
    setMaterialsMarkupPct("20");

    setHazardPct("");

    setScopeBoxHeight(320);
    setNotesBoxHeight(160);
  };

  const saveEstimate = () => {
    triggerHaptic();
    const entry = {
      id: Date.now(),
      date,
      client,
      description,
      additionalNotesText,

      docType,

      laborLines,
      multiplierMode,
      laborMultiplier,
      customMultiplier,

      // ✅ NEW: materials mode + itemized rows
      materialsMode,
      materialItems,

      materialsCost,
      materialsMarkupPct,
      hazardPct,

      total,
    };

    const updated = [entry, ...history].slice(0, 25);
    setHistory(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const loadEstimate = (e) => {
    triggerHaptic();
    setDate(e.date);
    setClient(e.client);
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
          cost: it?.cost ?? "",
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

  // ✅ NEW: build itemized materials lines for PDF (between Scope and Trade Inserts)
  const itemizedMaterialsPdfText = useMemo(() => {
    if (materialsMode !== "itemized") return "";
    const rows = (materialItems || [])
      .map((it) => {
        const desc = String(it?.desc || "").trim();
        const qty = Math.max(1, Number(it?.qty) || 1);
        const each = Number(it?.charge) || 0;
        const lineTotal = qty * each;
        if (!desc && !each) return "";
        const left = `${qty}× ${desc || "-"}`;
        const right = money.format(lineTotal);
        return `${left} — ${right}`;
      })
      .filter(Boolean);
    return rows.join("\n");
  }, [materialsMode, materialItems]);


  

  const exportPDF = async (mode = "download") => {
    triggerHaptic();

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

    function drawHeader() {
      drawFrame(doc);

      doc.setFillColor(...SHADE);
      doc.rect(FRAME_INSET, FRAME_INSET + 2, pageWidth - FRAME_INSET * 2, 70, "F");

      if (profile.logoDataUrl) {
        try {
          const imgType = detectDataUrlType(profile.logoDataUrl);

          // Logo box (match the "classic" layout: bigger, square-ish, left of the centered header)
          const boxX = 106;
          const boxY = FRAME_INSET + 2;
          const boxW = 86;
          const boxH = 70;

          const props = doc.getImageProperties(profile.logoDataUrl);
          const iw = Number(props?.width) || 1;
          const ih = Number(props?.height) || 1;

          const scale = Math.min(boxW / iw, boxH / ih);
          const drawW = iw * scale;
          const drawH = ih * scale;

          const x = boxX + (boxW - drawW) / 2;
          const y = boxY + (boxH - drawH) / 2;

          doc.addImage(profile.logoDataUrl, imgType, x, y, drawW, drawH);
        } catch {
          // ignore logo issues
        }
      }

      doc.setTextColor(20, 20, 20);
      doc.setFontSize(18);
      doc.text(companyName, pageWidth / 2, 34, { align: "center" });

      doc.setFontSize(10);
      doc.setTextColor(...TEXT_MUTED);
      if (contactBits) doc.text(contactBits, pageWidth / 2, 50, { align: "center" });
      if (addressLine) doc.text(addressLine, pageWidth / 2, 62, { align: "center" });
      if (optionalLine) doc.text(optionalLine, pageWidth / 2, 74, { align: "center" });

      doc.setTextColor(20, 20, 20);

      const pageNum = doc.getCurrentPageInfo?.().pageNumber || 1;

      if (pageNum === 1) {
        doc.setFontSize(14);
        const titleKey = docType === "invoice" ? "pdfDocInvoice" : "pdfDocEstimate";
        doc.text(tPdf(titleKey), jobInfoCenterX(), 102, { align: "center" });
      }

      doc.setDrawColor(...BORDER);
      doc.line(FRAME_INSET + 6, 108, pageWidth - (FRAME_INSET + 6), 108);

      // Debug (safe to keep; comment out if you don't want it)
      // doc.setFontSize(8);
      // doc.setTextColor(120, 120, 120);
      // doc.text(`UI_LANG=${lang} PDF_LANG=${pdfLang}`, pageWidth - 14, 52, { align: "right" });
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
        } catch {
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
          } catch {
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
        } catch {
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
        } catch {
          // ignore
        }

        try {
          return await callLibreTranslate();
        } catch {
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

    const hasTradeInserts = tradeInserts.length > 0;


const jobRows = [
      [tPdf("pdfDate"), formatDateMMDDYYYY(date) || "-"],
      ...(attn ? [[tPdf("pdfAttn"), attn]] : []),
      [tPdf("pdfClient"), client || "-"],
      [tPdf("pdfScope"), scopeNotes],

      // ✅ NEW: put itemized materials BELOW Scope / Notes and ABOVE Trade Inserts
      ...(materialsMode === "itemized" && String(itemizedMaterialsPdfText || "").trim()
        ? [[tPdf("pdfMaterialsItemized"), itemizedMaterialsPdfText]]
        : []),

      ...(hasTradeInserts ? [[tPdf("pdfTradeInserts"), tradeInsertText]] : []),
    ];

    autoTable(doc, {
      startY: 114,
      head: [[tPdf("pdfJobInfoHead"), ""]],
      body: jobRows,
      theme: "grid",
      styles: {
        fontSize: 11,
        cellPadding: 3,
        valign: "top",
        lineColor: BORDER,
        lineWidth: 0.1,
        textColor: [20, 20, 20],
      },
      headStyles: {
        fillColor: SHADE,
        textColor: [20, 20, 20],
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 70, fontStyle: "bold", fillColor: [255, 255, 255] },
        1: { cellWidth: INNER_W - 70 },
      },
      margin: { top: 114, left: TABLE_INSET, right: TABLE_INSET, bottom: TABLE_INSET },
      willDrawPage: () => {
        drawHeader();
      },
    });

    const summaryRows = [
      [tPdf("pdfLabor"), money.format(laborAdjusted)],
      [tPdf("pdfMaterials"), money.format(materialsBilled)],
    ];
    if (hazardEnabled) {
      summaryRows.push([tPdf("pdfHazard", hazardPctNormalized), money.format(hazardFeeDollar)]);
    }
    summaryRows.push([tPdf("pdfTotal"), money.format(total)]);

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      head: [[tPdf("pdfTotalsHead"), ""]],
      body: summaryRows,
      theme: "grid",
      styles: {
        fontSize: 12,
        cellPadding: 3,
        lineColor: BORDER,
        lineWidth: 0.1,
        textColor: [20, 20, 20],
      },
      headStyles: {
        fillColor: SHADE,
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

    const terms = String(profile.terms || "").trim();
    const notesRaw = String(additionalNotesForPdf || "").trim();
    const notesHas = Boolean(notesRaw);

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

    if (terms) {
      writeWrapped(`Terms: ${terms}`, termsFont, TEXT_MUTED);
      y += 2;
    }

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

    // Footer note
    const footer = tPdf("pdfFooter");
    writeWrapped(footer, 9, TEXT_MUTED);

    const filePrefix = docType === "invoice" ? "Invoice" : "Estimate";
    const filename = `${filePrefix}-${safeFilename(client)}-${pdfLang}-${Date.now()}.pdf`;

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
        } catch {
          file = null;
        }

        const hasShare = typeof navigator !== "undefined" && !!navigator.share;

        if (hasShare && file) {
          // Some browsers don't expose navigator.canShare; still try share() first.
          try {
            await navigator.share({
              files: [file],
              title: filename,
              text: docType === "invoice" ? "Invoice PDF" : "Estimate PDF",
            });
            return;
          } catch {
            // fall through to download
          }
        }

        // Fallback: download (user can then share/print from Files)
        doc.save(filename);
      } catch {
        try {
          doc.save(filename);
        } catch {
          window.alert("Could not share or download the PDF on this device.");
        }
      }
      return;
    }

    doc.save(filename);};

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
      padding: 2,
      borderRadius: 999,
      border: "1px solid rgba(0,0,0,0.12)",
      background: "rgba(255,255,255,0.45)",
    };

    const btnStyle = (active) => ({
      padding: "8px 14px",
      borderRadius: 999,
      border: "none",
      cursor: "pointer",
      fontWeight: 800,
      background: active ? "rgba(0,0,0,0.12)" : "transparent",
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
            padding: 2,
            borderRadius: 999,
            border: "1px solid rgba(0,0,0,0.12)",
            background: "rgba(255,255,255,0.65)",
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
              fontWeight: docType === "estimate" ? 700 : 500,
              background: docType === "estimate" ? "rgba(0,0,0,0.08)" : "transparent",
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
              fontWeight: docType === "invoice" ? 700 : 500,
              background: docType === "invoice" ? "rgba(0,0,0,0.08)" : "transparent",
              minWidth: 92,
            }}
          >
            {t("invoice")}
          </button>
        </div>
      </div>
    );
  };

  // STEP 1: COMPANY PROFILE
  if (step === "profile") {
    const requiredComplete = isCompanyComplete(profile);

    return (
      <div className="pe-wrap">
        <header className="pe-header">
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
        </header>

        <main className="pe-card">
          <section className="pe-section">
            <div className="pe-section-title">{t("companyProfileTitle")}</div>

            <div className="pe-muted" style={{ marginBottom: 8 }}>
              {t("requiredLabel")}
            </div>

            <form autoComplete="on" onSubmit={(e) => e.preventDefault()}>
<div className="pe-grid">
              <div style={FIELD_STACK}>
                <div style={FIELD_LABEL}>{t("companyNameReq")}</div>
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
              <div style={FIELD_STACK}>
                <div style={FIELD_LABEL}>{t("phoneReq")}</div>
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
              <div style={FIELD_STACK}>
                <div style={FIELD_LABEL}>{t("emailReq")}</div>
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
              <div style={FIELD_STACK}>
                <div style={FIELD_LABEL}>{t("addressReq")}</div>
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
                    maxWidth: 1600,
                    maxHeight: 500,
                    jpegQuality: 0.95,
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
              <div style={FIELD_STACK}>
                <div style={FIELD_LABEL}>{t("rocOpt")}</div>
                <input
                  className="pe-input"
                  value={profile.roc}
                  onChange={(e) => setProfile((p) => ({ ...p, roc: e.target.value }))}
                  placeholder={lang === "es" ? "ROC #" : "ROC #"}
                />
              </div>
              <div style={FIELD_STACK}>
                <div style={FIELD_LABEL}>{t("attnOpt")}</div>
                <input
                  className="pe-input"
                  value={profile.attn}
                  onChange={(e) => setProfile((p) => ({ ...p, attn: e.target.value }))}
                  placeholder={lang === "es" ? "Attn / Contact" : "Attn / Contact"}
                />
              </div>
            </div>

            <div className="pe-grid" style={{ marginTop: 8 }}>
              <div style={FIELD_STACK}>
                <div style={FIELD_LABEL}>{t("websiteOpt")}</div>
                <input
                  className="pe-input"
                  value={profile.website}
                  onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))}
                  placeholder={lang === "es" ? "Sitio web" : "Website"}
                />
              </div>
              <div style={FIELD_STACK}>
                <div style={FIELD_LABEL}>{t("einOpt")}</div>
                <input
                  className="pe-input"
                  value={profile.ein}
                  onChange={(e) => setProfile((p) => ({ ...p, ein: e.target.value }))}
                  placeholder={lang === "es" ? "EIN" : "EIN"}
                />
              </div>
            </div>

            <div className="pe-grid" style={{ marginTop: 8 }}>
              <div style={FIELD_STACK}>
                <div style={FIELD_LABEL}>{t("termsOpt")}</div>
                <input
                  className="pe-input"
                  value={profile.terms}
                  onChange={(e) => setProfile((p) => ({ ...p, terms: e.target.value }))}
                  placeholder={lang === "es" ? "Términos / texto opcional" : "Optional terms / text"}
                />


              <div style={{ marginTop: 10 }}>
                <div style={{ ...FIELD_LABEL, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{lang === "es" ? "Clave de traducción (opcional)" : "Translation key (optional)"}</span>
                  <span style={{ fontSize: 11, opacity: 0.6 }}>
                    {lang === "es" ? "Solo para traducir texto personalizado en PDF" : "Only for translating custom PDF text"}
                  </span>
                </div>
                <input
                  className="pe-input"
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder={
                    lang === "es"
                      ? "Pega tu OpenAI API key (se guarda en este dispositivo)"
                      : "Paste your OpenAI API key (saved on this device)"
                  }
                  autoComplete="off"
                />
              </div>
              </div>
              <div />
            </div>

            <div className="pe-row pe-row-slim" style={{ marginTop: 12 }}>
              <div className="pe-muted">{t("savedAuto")}</div>
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
      <header className="pe-header">
        <div style={{ marginTop: -10 }}>
          <div className="pe-title">Field Pocket Estimator</div>
          <div className="pe-subtitle">{t("subtitleEstimator")}</div>

          <div
            style={{
              marginTop: 4,
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
              title={companyGreen ? t("requiredCompleteTitle") : t("requiredIncompleteTitle")}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: companyGreen ? "#16a34a" : "#dc2626",
                  display: "inline-block",
                }}
              />
              <span>{companyGreen ? t("companyComplete") : t("companyIncomplete")}</span>
            </span>
          </div>

          <DocTypeToggle />
        </div>

        <div className="pe-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <LanguageToggle />

          <button
            className="pe-btn pe-btn-ghost"
            type="button"
            onClick={() => {
              triggerHaptic();
              setStep("profile");
            }}
          >
            {t("editCompany")}
          </button>

          <button className="pe-btn pe-btn-ghost" onClick={resetForm} type="button">
            {t("newClear")}
          </button>

          <button className="pe-btn" onClick={saveEstimate} type="button">
            {t("save")}
          </button>

          {/* ✅ NEW: PDF export language + translate toggle */}
          


          <button className="pe-btn pe-btn-ghost" onClick={() => exportPDF("download")} type="button">
            {t("pdf")}
          </button>

          <button className="pe-btn pe-btn-ghost" onClick={() => exportPDF("share")} type="button">
            {lang === "es" ? "Compartir" : "Share"}
          </button>
        </div>
      </header>

      <main className="pe-card">
        {/* JOB INFO */}
        <section className="pe-section">
          <div className="pe-section-title">{t("jobInfo")}</div>

          <div className="pe-grid">
            <div style={FIELD_STACK}>
              <div style={FIELD_LABEL}>{lang === "es" ? "Fecha" : "Date"}</div>
              <input
                className="pe-input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div style={FIELD_STACK}>
              <div style={FIELD_LABEL}>{t("client")}</div>
              <input
                className="pe-input"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder={lang === "es" ? "Cliente" : "Client"}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <div style={{ ...FIELD_STACK, flex: "1 1 260px", minWidth: 0 }}>
              <div style={FIELD_LABEL}>{lang === "es" ? "Plantilla" : "Template"}</div>
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
                title={lang === "es" ? "Plantilla maestra (opcional)" : "Master Template (optional)"}
              >
                <option value="">
                  {lang === "es" ? "Plantilla maestra (opcional)…" : "Master Template (optional)…"}
                </option>
                {SCOPE_MASTER_TEMPLATES.map((tt) => (
                  <option key={tt.key} value={tt.key}>
                    {lang === "es" ? (MASTER_BY_KEY_ES[tt.key]?.label || tt.label) : tt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ ...FIELD_STACK, flex: "1 1 260px", minWidth: 0 }}>
              <div style={FIELD_LABEL}>{lang === "es" ? "Insertar oficio" : "Trade insert"}</div>
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
                title={lang === "es" ? "Insertar bloque de oficio" : "Insert a trade block"}
              >
                <option value="">
                  {lang === "es" ? "Insertar oficio…" : "Insert trade…"}
                </option>
                {SCOPE_TRADE_INSERTS.map((tt) => (
                  <option key={tt.key} value={tt.key}>
                    {lang === "es" ? (TRADE_BY_KEY_ES[tt.key]?.label || tt.label) : tt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              className="pe-btn pe-btn-ghost"
              type="button"
              onClick={() => {
                triggerHaptic();
                setDescription("");
              }}
              title={lang === "es" ? "Borrar alcance/notas" : "Clear scope/notes"}
              style={{ flex: "0 0 auto" }}
            >
              {t("clearScopeBox")}
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={FIELD_STACK}>
              <div style={FIELD_LABEL}>{lang === "es" ? "Alcance / notas" : "Scope / notes"}</div>
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

        <div className="pe-divider" />

        {/* LABOR */}
        <section className="pe-section">
          <div className="pe-row">
            <div className="pe-section-title">{t("labor")}</div>
            <button className="pe-btn" onClick={addLaborLine} type="button">
              {t("addLabor")}
            </button>
          </div>

          {laborLines.map((l, i) => {
            const presetLabels = LABOR_PRESETS.map((p) => p.label);
            const hasLegacyLabel = l.label && !presetLabels.includes(l.label);

            return (
              <div key={i} className="pe-grid" style={{ marginTop: 8 }}>
                <div style={FIELD_STACK}>
                  <div style={FIELD_LABEL}>{lang === "es" ? "Rol" : "Role"}</div>
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

                <div style={FIELD_STACK}>
                  <div style={FIELD_LABEL}>{t("hours")}</div>
                  <input
                    className="pe-input"
                    placeholder={t("hours")}
                    value={l.hours}
                    onChange={(e) => updateLaborLine(i, "hours", e.target.value)}
                    onBlur={(e) => updateLaborLine(i, "hours", normalizeHoursInput(e.target.value))}
                    inputMode="decimal"
                  />
                </div>

                <div style={FIELD_STACK}>
                  <div style={FIELD_LABEL}>{t("rate")}</div>
                  <input
                    className="pe-input"
                    placeholder={t("rate")}
                    value={l.rate}
                    onChange={(e) => updateLaborLine(i, "rate", e.target.value)}
                    onBlur={(e) => updateLaborLine(i, "rate", normalizeMoneyInput(e.target.value))}
                    inputMode="decimal"
                  />
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
        </section>

        <div className="pe-divider" />

        {/* SPECIAL CONDITIONS */}
        <section className="pe-section">
          <div className="pe-section-title">{t("specialConditions")}</div>

          <div className="pe-grid">
            <div style={FIELD_STACK}>
              <div style={FIELD_LABEL}>{lang === "es" ? "Condición" : "Condition"}</div>
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

            <div style={FIELD_STACK}>
              <div style={FIELD_LABEL}>{t("hazardPct")}</div>
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
              <div style={FIELD_STACK}>
                <div style={FIELD_LABEL}>{t("customMultiplier")}</div>
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
                background: "rgba(255,255,255,0.65)",
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
                  background: materialsMode === "blanket" ? "rgba(0,0,0,0.08)" : "transparent",
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
                  background: materialsMode === "itemized" ? "rgba(0,0,0,0.08)" : "transparent",
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
                <div style={FIELD_STACK}>
                  <div style={FIELD_LABEL}>{t("materialsCost")}</div>
                  <input
                    className="pe-input"
                    value={materialsCost}
                    onChange={(e) => setMaterialsCost(e.target.value)}
                    onBlur={(e) => setMaterialsCost(normalizeMoneyInput(e.target.value))}
                    placeholder={t("materialsCost")}
                    inputMode="decimal"
                  />
                </div>

                <div style={FIELD_STACK}>
                  <div style={FIELD_LABEL}>{t("markupPct")}</div>
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
                  const costVal = it.cost ?? "";
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
                      <div style={FIELD_STACK}>
                        <div style={FIELD_LABEL}>{t("materialDesc")}</div>
                        <input
                          className="pe-input"
                          value={it.desc}
                          onChange={(e) => updateMaterialItem(i, "desc", e.target.value)}
                          placeholder={lang === "es" ? "Descripción" : "Description"}
                          style={{ width: "100%" }}
                        />
                      </div>

                      {/* Bottom row: qty + (internal) cost + charge */}

                      <div
                        style={{
                          marginTop: 8,
                          display: "grid",
                          gridTemplateColumns: "56px 1.2fr 1.2fr 40px",
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
                            value={costVal}
                            onChange={(e) => updateMaterialItem(i, "cost", e.target.value)}
                            onBlur={(e) => updateMaterialItem(i, "cost", normalizeMoneyInput(e.target.value))}
                            placeholder={MONEY_PH}
                            inputMode="decimal"
                            title={
                              lang === "es"
                                ? "Costo interno (no se imprime en PDF)"
                                : "Internal cost (not printed on PDF)"
                            }
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
                {laborLines.length} {t("laborLines")}
                {totalLaborers !== laborLines.length ? ` • ${totalLaborers} ${t("laborers")}` : ""}
                {effectiveMultiplier !== 1 ? ` • ${effectiveMultiplier}${t("complexity")}` : ""}
                {hazardEnabled ? ` • ${hazardPctNormalized}${t("risk")}` : ""}
                {/* Materials meta */}
                {materialsMode === "blanket" && Number.isFinite(Number(normalizedMarkupPct))
                  ? ` • ${normalizedMarkupPct}${t("materialsMeta")}`
                  : ""}

                {materialsMode === "itemized" && itemizedMaterialsTotal > 0
                  ? ` • 1x ${lang === "es" ? "materiales" : "materials"} • ${money.format(itemizedMaterialsTotal)}`
                  : ""}
              </div>
            </div>
            <div className="pe-total-right">{money.format(total)}</div>
          </div>
        </section>

        <div className="pe-divider" />

        {/* ADDITIONAL NOTES (BOTTOM ONLY) */}
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
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={FIELD_STACK}>
              <div style={FIELD_LABEL}>{lang === "es" ? "Notas adicionales" : "Additional notes"}</div>
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

        <div className="pe-divider" />

        {/* HISTORY */}
        <section className="pe-section">
          <div className="pe-row" style={{ marginTop: 0 }}>
            <div className="pe-section-title" style={{ marginBottom: 0 }}>
              {t("savedEstimates")}
            </div>
            <button
              className="pe-btn pe-btn-ghost"
              type="button"
              onClick={clearAllEstimates}
              disabled={history.length === 0}
              title={
                history.length === 0
                  ? lang === "es"
                    ? "No hay estimaciones guardadas"
                    : "No saved estimates"
                  : lang === "es"
                  ? "Eliminar todas"
                  : "Delete all saved estimates"
              }
            >
              {t("clearAll")}
            </button>
          </div>

          {history.length === 0 && <div className="pe-muted">{t("noSaved")}</div>}

          <div style={{ display: "grid", gap: 8 }}>
            {history.map((e) => (
              <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="pe-btn pe-btn-ghost"
                  type="button"
                  onClick={() => loadEstimate(e)}
                  style={{ flex: 1, textAlign: "left" }}
                >
                  {e.date} — {e.client || (lang === "es" ? "Sin nombre" : "Unnamed")} — {money.format(e.total)}
                </button>

                <button
                  className="pe-btn pe-btn-ghost"
                  type="button"
                  onClick={() => deleteEstimate(e.id)}
                  title={lang === "es" ? "Eliminar esta estimación" : "Delete this saved estimate"}
                >
                  {t("delete")}
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function EstimateForm() {
  // language init: localStorage first; otherwise Spanish-first based on device language
  const [lang, setLang] = useState(() => {
    const saved = loadSavedLang();
    return saved || "";
  });

  const [langConfirmed, setLangConfirmed] = useState(false);

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
    <EstimateFormInner lang={lang} setLang={setLang} setLanguage={setLanguage} t={t} forceProfileOnMount={justChoseLanguage} />
  );
}

