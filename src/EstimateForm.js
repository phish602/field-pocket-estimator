import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { calculateEstimateWithLaborLines } from "./estimate";
import "./EstimateForm.css";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

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
   SCOPE / NOTES (POWER TEMPLATES)
   ========================= */
const SCOPE_MASTER_TEMPLATES = [
  {
    key: "industrial",
    label: "Industrial (Master)",
    text: `Scope (Summary):
- Provide labor, tools, and supervision to complete work described below.
- Work area/location: [__________]
- Quantity / units (as applicable): [__________]
- Access / constraints: [Normal / Tight / Confined / Elevated / Live plant]

Included (General):
- Mobilization and basic daily cleanup
- Layout/verification of field conditions prior to work
- Standard hand tools / consumables (unless noted)
- Coordination with site contact for work sequencing

Quality / Acceptance:
- Work performed to standard industry practice and project requirements.
- Final acceptance based on site walk / owner rep signoff.

Assumptions:
- Normal working hours unless noted
- Clear access and staging area provided by GC/Owner
- Existing conditions as observed at time of estimate

Exclusions:
- Hidden/unforeseen conditions
- Rework due to changes in scope or direction
- Permits/engineering unless noted
- Specialty testing/inspections unless noted

Notes:
- [__________]
`,
  },
  {
    key: "commercial",
    label: "Commercial (Master)",
    text: `Scope (Summary):
- Provide labor and supervision to complete work described below.
- Area/location: [__________]
- Quantity / units: [__________]

Included:
- Protect adjacent areas as reasonable
- Standard tools and cleanup
- Coordination with on-site contact

Assumptions:
- Work performed during normal hours unless noted
- Access and staging available

Exclusions:
- Permits/engineering
- Hidden damage / unforeseen conditions
- Specialty trades unless listed

Notes:
- [__________]
`,
  },
  {
    key: "service",
    label: "Service / T&M Style (Master)",
    text: `Service Scope (Summary):
- Dispatch labor to perform requested service/repair work.
- Location/area: [__________]
- Issue/goal: [__________]

Included:
- Troubleshooting/assessment as needed
- Perform repairs/adjustments within approved limits
- Cleanup

Assumptions:
- Parts/materials billed separately unless included
- Access provided at time of service

Exclusions:
- Hidden damage
- Major replacement work unless authorized

Notes:
- [__________]
`,
  },
];

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
- Productivity dependent on site access, congestion, and coordination.
`,
  },
  {
    key: "painting",
    label: "Painting (Insert)",
    text: `Trade Insert: Painting
- Surface prep as required (masking, patch/spot prep, sanding as needed).
- Apply primer/finish coats per specified system.
- Cut-in/roll/spray methods as appropriate for area and conditions.
- Touch-up and cleanup upon completion.
`,
  },
  {
    key: "demoCrew",
    label: "Demolition Crew (Insert)",
    text: `Trade Insert: Demolition Crew
- Provide labor for selective demolition/removal of specified items/areas.
- Protect adjacent finishes and active areas as reasonable.
- Debris staged in designated area; haul-off/dump fees by others unless included.
- Unknown/hidden conditions (behind walls/ceilings/slabs) excluded unless authorized.
`,
  },
  {
    key: "drywall",
    label: "Drywall (Insert)",
    text: `Trade Insert: Drywall
- Install drywall per scope (hang, fasten, and finish as specified).
- Tape/finish level per project requirements (Level [__]).
- Cutouts for penetrations as required.
- Final texture/paint by others unless included.
`,
  },
  {
    key: "framing",
    label: "Framing (Insert)",
    text: `Trade Insert: Framing
- Layout and install framing per scope (metal/wood as specified).
- Anchor/fasten to existing structure as required.
- Field verification of dimensions and conditions prior to build.
- Engineering/structural design by others unless included.
`,
  },
  {
    key: "insulation",
    label: "Insulation (Insert)",
    text: `Trade Insert: Insulation
- Furnish/install insulation per scope (batt/blown/spray as specified).
- Seal/fit around penetrations as required for typical installation.
- Vapor barrier/air sealing by others unless included.
- Specialty testing excluded unless included.
`,
  },
  {
    key: "finishCarpentry",
    label: "Finish Carpentry (Insert)",
    text: `Trade Insert: Finish Carpentry
- Install finish carpentry items per scope (trim, base, casing, doors/hardware if specified).
- Scribe and fit to existing conditions as needed.
- Caulk/fill as required for finish readiness.
- Final paint/stain by others unless included.
`,
  },
  {
    key: "flooring",
    label: "Flooring (Insert)",
    text: `Trade Insert: Flooring
- Install flooring per scope (LVP/tile/carpet/epoxy as specified).
- Subfloor assumed suitable; leveling/moisture mitigation excluded unless included.
- Transitions and edge details installed as specified.
`,
  },
  {
    key: "hvac",
    label: "HVAC (Insert)",
    text: `Trade Insert: HVAC
- Install/modify HVAC components per scope (duct, units, diffusers, thermostats as specified).
- Start-up/commissioning/TAB by others unless included.
- Permits/engineering excluded unless included.
`,
  },
  {
    key: "plumbing",
    label: "Plumbing (Insert)",
    text: `Trade Insert: Plumbing
- Install/modify plumbing per scope (water, waste/vent, fixtures as specified).
- Tie-ins coordinated with site contact; shutdown windows by others unless included.
- Permits/engineering excluded unless included.
`,
  },
  {
    key: "controls",
    label: "Controls / BAS / Instrumentation (Insert)",
    text: `Trade Insert: Controls / BAS / Instrumentation
- Install/terminate controls wiring and devices per scope (sensors, actuators, controllers as specified).
- Point-to-point checkout and basic functional verification as specified.
- Programming/graphics/commissioning by others unless included.
`,
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
- Specialty consumables or exotic alloys
`,
  },
  {
    key: "pipefitting",
    label: "Pipefitting (General Insert)",
    text: `Trade Insert: Pipefitting
- Field measure, fit, and install piping/spools as required.
- Support/hanger coordination as required.
- Tie-ins/shutdown windows coordinated with site contact.
- Final alignment and leak checks per project requirements (testing if specified).
`,
  },
  {
    key: "orbital",
    label: "Orbital Welding (Insert)",
    text: `Trade Insert: Orbital Welding
- Provide setup and operation for orbital welding as required.
- Prep, purge, and fit-up to achieve acceptable weld conditions.
- Weld parameters and acceptance per project requirements.
- Production rate dependent on access, prep quality, and purge conditions.
`,
  },
  {
    key: "ironwork",
    label: "Ironwork / Structural (Insert)",
    text: `Trade Insert: Ironwork / Structural
- Layout, fit, and install steel/structural members as required.
- Bolt-up and/or weld connections per project requirements.
- Field modifications as needed within reason.
- Final plumb/level verification as required.
`,
  },
  {
    key: "electrical",
    label: "Electrician (Insert)",
    text: `Trade Insert: Electrical
- Install/terminate electrical components as required (circuits, devices, panels, controls as specified).
- Verify power, labeling, and basic functionality per project requirements.
- Work coordinated around lockout/tagout and site safety requirements.
- Materials/fixtures by owner/GC unless included.
`,
  },
  {
    key: "rigging",
    label: "Rigging / Crane (Insert)",
    text: `Trade Insert: Rigging / Crane
- Provide rigging labor to support lifts/moves as required.
- Lift planning and execution coordinated with site contact.
- Standard rigging gear as typical (specialty gear if specified).
- Work dependent on access, pick points, and site constraints.
`,
  },
  {
    key: "heavyEquipment",
    label: "Heavy Machinery / Equipment Ops (Insert)",
    text: `Trade Insert: Heavy Machinery / Equipment Ops
- Provide operator(s) for equipment as required (lift/grade/haul/support).
- Production dependent on site access, weather, and staging/logistics.
- Fuel/transport/permits excluded unless included.
`,
  },
  {
    key: "concrete",
    label: "Concrete (Insert)",
    text: `Trade Insert: Concrete
- Form, place, finish, and cure concrete work as specified.
- Subgrade and reinforcement by others unless included.
- Finish level and cure method per project requirements.
- Production dependent on access, weather, and site readiness.
`,
  },
  {
    key: "demo",
    label: "Demolition (Insert)",
    text: `Trade Insert: Demolition
- Selective demo/removal of specified items/areas.
- Protect adjacent areas as reasonable.
- Debris staging and haul-off as specified (or excluded).
- Unknown conditions behind walls/ceilings excluded.
`,
  },
];

/* =========================
   QUICK NOTES (BOTTOM ONLY)
   ========================= */
const QUICK_NOTES = [
  { key: "schedule", label: "+ Schedule", line: "Schedule: Estimated start ___ / completion ___" },
  { key: "exclusions", label: "+ Exclusions", line: "Exclusions: Hidden/unforeseen conditions not included unless written." },
  { key: "payment", label: "+ Payment", line: "Payment: ___% deposit / balance due upon completion (or Net ___ days)." },
  { key: "change", label: "+ Change Orders", line: "Change Orders: Additional work requires written approval; pricing/schedule may change." },
  { key: "safety", label: "+ Safety", line: "Safety: Work performed per site safety requirements (PPE, LOTO, hot work, confined space if applicable)." },
  { key: "access", label: "+ Access", line: "Access: Pricing assumes reasonable access and staging; delays due to access constraints may affect cost." },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function newLaborLine() {
  return { label: "", hours: "", rate: "", qty: 1 };
}

function safeFilename(s) {
  const base = String(s || "").trim() || "Client";
  return base.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
}

// ✅ STRICT: green only when ALL 4 required fields are filled
function isCompanyComplete(p) {
  const nameOk = Boolean(p?.companyName && String(p.companyName).trim());
  const phoneOk = Boolean(p?.phone && String(p.phone).trim());
  const emailOk = Boolean(p?.email && String(p.email).trim());
  const addrOk = Boolean(p?.address && String(p.address).trim());
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
  const t = String(text || "");
  const n = String(needle || "");
  if (!n.trim()) return false;
  return t.includes(n);
}

/**
 * ✅ PDF extraction
 * We want:
 *  - Scope Summary section (first one)
 *  - ALL Trade Insert blocks (every occurrence)
 */
function extractScopeSummary(fullText) {
  const t = String(fullText || "");

  const start = t.indexOf("Scope (Summary):");
  if (start >= 0) {
    const after = t.slice(start);

    const stopHeaders = [
      "\n\nIncluded",
      "\n\nIncluded (",
      "\n\nQuality",
      "\n\nAssumptions",
      "\n\nExclusions",
      "\n\nNotes:",
      "\n\nTrade Insert:",
    ];

    let stopAt = after.length;
    for (const h of stopHeaders) {
      const idx = after.indexOf(h);
      if (idx > 0) stopAt = Math.min(stopAt, idx);
    }

    return after.slice(0, stopAt).trim();
  }

  const start2 = t.indexOf("Service Scope (Summary):");
  if (start2 >= 0) {
    const after = t.slice(start2);

    const stopHeaders = ["\n\nIncluded", "\n\nAssumptions", "\n\nExclusions", "\n\nNotes:", "\n\nTrade Insert:"];
    let stopAt = after.length;
    for (const h of stopHeaders) {
      const idx = after.indexOf(h);
      if (idx > 0) stopAt = Math.min(stopAt, idx);
    }

    return after.slice(0, stopAt).trim();
  }

  return "";
}

function extractAllTradeInserts(fullText) {
  const t = String(fullText || "");
  const marker = "Trade Insert:";
  const pieces = [];

  let pos = 0;
  while (true) {
    const idx = t.indexOf(marker, pos);
    if (idx < 0) break;

    const after = t.slice(idx);

    // end at first double-newline AFTER the marker block, or end-of-text
    const end = after.indexOf("\n\n");
    const block = (end > 0 ? after.slice(0, end) : after).trim();

    if (block) pieces.push(block);
    pos = idx + marker.length;
  }

  // de-dupe exact repeats (common when people re-insert the same block)
  const uniq = [];
  for (const b of pieces) {
    if (!uniq.includes(b)) uniq.push(b);
  }

  return uniq;
}

/**
 * ✅ Logo resize for crisp logos (no squish)
 * - keeps PNG when source is PNG (best)
 * - never upscales
 * - big clamps so you keep resolution for PDF
 */
function resizeLogoFile(file, opts = {}) {
  const {
    maxWidth = 1600,
    maxHeight = 500,
    jpegQuality = 0.95,
    forcePng = false,
  } = opts;

  return new Promise((resolve) => {
    if (!file) return resolve("");

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const iw = Number(img.width) || 1;
        const ih = Number(img.height) || 1;

        // never upscale
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

        const dataUrl =
          mime === "image/jpeg"
            ? canvas.toDataURL(mime, jpegQuality)
            : canvas.toDataURL(mime);

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

export default function EstimateForm() {
  const [profile, setProfile] = useState({
    // REQUIRED (for green indicator + PDF export)
    companyName: "",
    phone: "",
    email: "",
    address: "",

    // OPTIONAL
    logoDataUrl: "", // ✅ resized/compressed
    roc: "",
    attn: "",
    website: "",
    ein: "",
    terms: "",
  });

  const [step, setStep] = useState("estimate"); // "profile" | "estimate"

  // Job info
  const [date, setDate] = useState(todayISO());
  const [client, setClient] = useState("");
  const [description, setDescription] = useState("");

  // Scope template selectors
  const [masterScopeKey, setMasterScopeKey] = useState("");
  const [tradeInsertKey, setTradeInsertKey] = useState("");

  // ✅ Editable Additional Notes text
  const [additionalNotesText, setAdditionalNotesText] = useState("");

  // Labor
  const [laborLines, setLaborLines] = useState([newLaborLine()]);

  // Multiplier (preset/custom)
  const [laborMultiplier, setLaborMultiplier] = useState(1);
  const [multiplierMode, setMultiplierMode] = useState("preset");
  const [customMultiplier, setCustomMultiplier] = useState("1");

  // Materials / risk
  const [materialsCost, setMaterialsCost] = useState("");
  const [hazardPct, setHazardPct] = useState(""); // ✅ percent (labor only)

  // Materials markup %
  const [materialsMarkupPct, setMaterialsMarkupPct] = useState("20");

  // History
  const [history, setHistory] = useState([]);

  // Load profile + history
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

  // Persist profile automatically
  useEffect(() => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, [profile]);

  const effectiveMultiplier =
    multiplierMode === "custom"
      ? Number(customMultiplier) || 1
      : Number(laborMultiplier) || 1;

  // ✅ Two-pass calc so hazard can be % of LABOR ONLY (laborAdjusted)
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
      materialsCost,
      effectiveMultiplier,
      0,
      materialsMarkupPct
    );

    const pct = clampPct(hazardPct);
    const enabled = pct > 0;
    const hazardBase = Number(base.laborAdjusted) || 0;
    const hazardDollars = enabled ? hazardBase * (pct / 100) : 0;

    const withHazard = calculateEstimateWithLaborLines(
      laborLines,
      materialsCost,
      effectiveMultiplier,
      hazardDollars,
      materialsMarkupPct
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
  }, [laborLines, materialsCost, effectiveMultiplier, hazardPct, materialsMarkupPct]);

  // Labor helpers
  const addLaborLine = () => {
    if (laborLines.length >= 10) return;
    setLaborLines([...laborLines, newLaborLine()]);
  };

  const removeLaborLine = (i) => {
    if (laborLines.length <= 1) return;
    setLaborLines(laborLines.filter((_, idx) => idx !== i));
  };

  const updateLaborLine = (i, key, value) => {
    setLaborLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, [key]: value } : l))
    );
  };

  const applyLaborPresetByLabel = (i, selectedLabel) => {
    if (!selectedLabel) return;
    setLaborLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, label: selectedLabel } : l))
    );
  };

  const duplicateLaborLine = (i) => {
    setLaborLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, qty: (Number(l.qty) || 1) + 1 } : l))
    );
  };

  const decrementLaborQty = (i) => {
    setLaborLines((prev) =>
      prev.map((l, idx) =>
        idx === i ? { ...l, qty: Math.max(1, (Number(l.qty) || 1) - 1) } : l
      )
    );
  };

  const totalLaborers = useMemo(() => {
    return laborLines.reduce((sum, l) => sum + (Number(l.qty) || 1), 0);
  }, [laborLines]);

  // Scope template helpers
  const insertBlock = (blockText) => {
    if (!blockText) return;
    setDescription((prev) => {
      const p = String(prev || "").trim();
      return p ? `${p}\n\n${blockText}` : blockText;
    });
  };

  const applyMasterTemplate = (key) => {
    const t = SCOPE_MASTER_TEMPLATES.find((x) => x.key === key);
    if (!t) return;

    if (containsExact(description, t.text)) {
      const ok = window.confirm(
        "That master template text already appears in your scope box.\n\nAdd it again anyway?"
      );
      if (!ok) return;
    } else {
      const hasAnySummary =
        description.includes("Scope (Summary):") || description.includes("Service Scope (Summary):");
      if (hasAnySummary) {
        const ok = window.confirm(
          "A scope summary already appears in the box.\n\nAdding another master template may get messy.\n\nAdd anyway?"
        );
        if (!ok) return;
      }
    }

    insertBlock(t.text);
  };

  const applyTradeInsert = (key) => {
    const t = SCOPE_TRADE_INSERTS.find((x) => x.key === key);
    if (!t) return;

    if (containsExact(description, t.text)) {
      const ok = window.confirm(
        "That trade insert already appears in your scope box.\n\nAdd it again anyway?"
      );
      if (!ok) return;
    }

    insertBlock(t.text);
  };

  // ✅ Additional Notes (editable): buttons append text, but user can type too
  const addAdditionalNoteLine = (line) => {
    const current = String(additionalNotesText || "");
    const already = current.includes(line);

    if (already) {
      const ok = window.confirm(
        "That note already appears in Additional Notes.\n\nAdd it again anyway?"
      );
      if (!ok) return;
    }

    setAdditionalNotesText((prev) => {
      const p = String(prev || "").trimEnd();
      return p ? `${p}\n\n${line}` : line;
    });
  };

  const clearAdditionalNotes = () => setAdditionalNotesText("");

  // RESET (does not touch company)
  const resetForm = () => {
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
    setMaterialsCost("");
    setHazardPct("");
    setMaterialsMarkupPct("20");
  };

  // Save / load
  const saveEstimate = () => {
    const entry = {
      id: Date.now(),
      date,
      client,
      description,
      additionalNotesText,

      laborLines,
      multiplierMode,
      laborMultiplier,
      customMultiplier,

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
    setDate(e.date);
    setClient(e.client);
    setDescription(e.description);

    setMasterScopeKey("");
    setTradeInsertKey("");

    setAdditionalNotesText(e.additionalNotesText ?? "");

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
      e.customMultiplier !== undefined && e.customMultiplier !== null
        ? String(e.customMultiplier)
        : "1"
    );

    setMaterialsCost(e.materialsCost ?? "");
    setMaterialsMarkupPct(
      e.materialsMarkupPct !== undefined && e.materialsMarkupPct !== null
        ? String(e.materialsMarkupPct)
        : "20"
    );

    setHazardPct(e.hazardPct !== undefined && e.hazardPct !== null ? String(e.hazardPct) : "");
  };

  const deleteEstimate = (id) => {
    const ok = window.confirm("Delete this saved estimate?");
    if (!ok) return;

    const updated = history.filter((x) => x.id !== id);
    setHistory(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const clearAllEstimates = () => {
    const ok = window.confirm("Delete ALL saved estimates?");
    if (!ok) return;

    setHistory([]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
  };

  // Multiplier dropdown handler
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

  // PDF helpers
  const drawFrame = (doc) => {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const BORDER = [210, 210, 210];
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.5);
    doc.rect(8, 8, pageWidth - 16, pageHeight - 16);
  };

  // PDF
  const exportPDF = () => {
    if (!companyGreen) {
      const go = window.confirm(
        "Company info incomplete.\n\nPDF export requires ALL required fields:\n- Company name\n- Phone\n- Email\n- Address\n\nGo to Company Profile now?"
      );
      if (go) setStep("profile");
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const BORDER = [210, 210, 210];
    const SHADE = [245, 245, 245];
    const TEXT_MUTED = [80, 80, 80];

    drawFrame(doc);

    const companyName = (profile.companyName || "").trim() || "Company Name";
    const contactBits = [profile.phone, profile.email].filter(Boolean).join(" • ");
    const addressLine = (profile.address || "").trim();

    const optionalBits = [
      profile.roc ? `ROC: ${String(profile.roc).trim()}` : "",
      profile.website ? String(profile.website).trim() : "",
      profile.ein ? `EIN: ${String(profile.ein).trim()}` : "",
    ].filter(Boolean);
    const optionalLine = optionalBits.join(" • ");

    // Header band (shaded)
    doc.setFillColor(...SHADE);
    doc.rect(8, 10, pageWidth - 16, 30, "F");

    // ✅ Logo (left) — BIGGER BOX + PERFECT ASPECT (prevents “squish”)
    if (profile.logoDataUrl) {
      try {
        const imgType = detectDataUrlType(profile.logoDataUrl);

        // Bigger bounding box (wider + a bit taller)
        // If your logo is a long text banner, this is what fixes the "squished" look.
        const boxX = 12;
        const boxY = 12;
        const boxW = 82; // wider
        const boxH = 26; // taller

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
        // ignore logo rendering errors
      }
    }

    doc.setTextColor(20, 20, 20);
    doc.setFontSize(18);
    doc.text(companyName, pageWidth / 2, 22, { align: "center" });

    doc.setFontSize(10);
    doc.setTextColor(...TEXT_MUTED);
    if (contactBits) doc.text(contactBits, pageWidth / 2, 28, { align: "center" });
    if (addressLine) doc.text(addressLine, pageWidth / 2, 33, { align: "center" });
    if (optionalLine) doc.text(optionalLine, pageWidth / 2, 38, { align: "center" });

    doc.setTextColor(20, 20, 20);
    doc.setFontSize(14);
    doc.text("ESTIMATE", pageWidth / 2, 50, { align: "center" });

    doc.setDrawColor(...BORDER);
    doc.line(14, 54, pageWidth - 14, 54);

    // Extract only what you want on invoice
    const scopeSummary = extractScopeSummary(description);
    const tradeInserts = extractAllTradeInserts(description);
    const tradeInsertText = tradeInserts.length ? tradeInserts.join("\n\n") : "-";
    const attn = String(profile.attn || "").trim();

    // Job info table
    autoTable(doc, {
      startY: 58,
      body: [
        ["Date", date || "-"],
        ...(attn ? [["Attn", attn]] : []),
        ["Client", client || "-"],
        ["Scope Summary", scopeSummary || "-"],
        ["Trade Insert(s)", tradeInsertText],
      ],
      theme: "grid",
      styles: {
        fontSize: 11,
        cellPadding: 3,
        valign: "top",
        lineColor: BORDER,
        lineWidth: 0.1,
        textColor: [20, 20, 20],
      },
      columnStyles: {
        0: { cellWidth: 34, fontStyle: "bold", fillColor: SHADE },
        1: { cellWidth: pageWidth - 28 - 34 },
      },
      margin: { left: 14, right: 14 },
    });

    // Totals table
    const summaryRows = [
      ["Labor", money.format(laborAdjusted)],
      ["Materials", money.format(materialsBilled)],
    ];
    if (hazardEnabled) {
      summaryRows.push([`Hazard / risk (${hazardPctNormalized}%)`, money.format(hazardFeeDollar)]);
    }
    summaryRows.push(["TOTAL", money.format(total)]);

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      body: summaryRows,
      theme: "grid",
      styles: {
        fontSize: 12,
        cellPadding: 3,
        lineColor: BORDER,
        lineWidth: 0.1,
        textColor: [20, 20, 20],
      },
      columnStyles: {
        0: { cellWidth: pageWidth - 28 - 60 },
        1: { cellWidth: 60, halign: "right" },
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.row.index === summaryRows.length - 1) {
          data.cell.styles.fillColor = SHADE;
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fontSize = 13;
        }
      },
    });

    // ✅ Small-print footer + Additional Notes (NO TABLE)
    const marginLeft = 14;
    const marginRight = 14;
    const usableWidth = pageWidth - marginLeft - marginRight;

    const terms = String(profile.terms || "").trim();
    const notesRaw = String(additionalNotesText || "").trim();
    const notesHas = Boolean(notesRaw);

    let y = doc.lastAutoTable.finalY + 10;

    const ensureSpace = (neededLines = 1) => {
      const bottom = pageHeight - 14; // inside frame
      const neededHeight = neededLines * 4.2;
      if (y + neededHeight > bottom) {
        doc.addPage();
        drawFrame(doc);
        y = 18;
      }
    };

    doc.setFontSize(9);
    doc.setTextColor(...TEXT_MUTED);

    if (terms) {
      const tLines = doc.splitTextToSize(`Terms: ${terms}`, usableWidth);
      ensureSpace(tLines.length);
      doc.text(tLines, marginLeft, y);
      y += tLines.length * 4.2 + 2;
    }

    if (notesHas) {
      ensureSpace(1);
      doc.text("Additional Notes:", marginLeft, y);
      y += 4.2;

      const paragraphs = notesRaw
        .split(/\n\s*\n/g)
        .map((p) => p.trim())
        .filter(Boolean);

      for (const p of paragraphs) {
        const lines = doc.splitTextToSize(`• ${p}`, usableWidth);
        ensureSpace(lines.length);
        doc.text(lines, marginLeft, y);
        y += lines.length * 4.2 + 1.5;
      }

      y += 1.5;
    }

    const footer = "Notes: Pricing subject to site conditions. Materials and labor based on inputs above.";
    const fLines = doc.splitTextToSize(footer, usableWidth);
    ensureSpace(fLines.length);
    doc.text(fLines, marginLeft, y);

    doc.save(`Estimate-${safeFilename(client)}.pdf`);
  };

  // STEP 1: COMPANY PROFILE
  if (step === "profile") {
    const requiredComplete = isCompanyComplete(profile);

    return (
      <div className="pe-wrap">
        <header className="pe-header">
          <div>
            <div className="pe-title">Field Pocket Estimator</div>
            <div className="pe-subtitle">Company header for PDF</div>

            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                display: "flex",
                gap: 8,
                alignItems: "center",
                opacity: 0.95,
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
                title={
                  requiredComplete
                    ? "Required company fields complete"
                    : "Fill all required company fields to enable PDF export"
                }
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
                <span>{requiredComplete ? "Company complete" : "Company incomplete"}</span>
              </span>
            </div>
          </div>

          <div className="pe-actions">
            <button className="pe-btn" type="button" onClick={() => setStep("estimate")}>
              Continue →
            </button>
          </div>
        </header>

        <main className="pe-card">
          <section className="pe-section">
            <div className="pe-section-title">Company Profile (for PDF)</div>

            <div className="pe-muted" style={{ marginBottom: 8 }}>
              Required (must be filled to export PDF)
            </div>

            <div className="pe-grid">
              <input
                className="pe-input"
                value={profile.companyName}
                onChange={(e) => setProfile((p) => ({ ...p, companyName: e.target.value }))}
                placeholder="Company name (required)"
              />
              <input
                className="pe-input"
                value={profile.phone}
                onChange={(e) => setProfile((p) => ({ ...p, phone: formatPhoneUS(e.target.value) }))}
                placeholder="Phone (required) 555-555-5555"
                inputMode="numeric"
              />
            </div>

            <div className="pe-grid" style={{ marginTop: 8 }}>
              <input
                className="pe-input"
                value={profile.email}
                onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                placeholder="Email (required)"
              />
              <input
                className="pe-input"
                value={profile.address}
                onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
                placeholder="Address (required)"
              />
            </div>

            <div className="pe-divider" style={{ margin: "14px 0" }} />

            <div className="pe-muted" style={{ marginBottom: 8 }}>
              Optional
            </div>

            {/* ✅ Logo upload (auto-resize BEFORE saving) */}
            <div className="pe-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div className="pe-muted" style={{ minWidth: 140 }}>
                Company logo (optional)
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
                    onClick={() => setProfile((p) => ({ ...p, logoDataUrl: "" }))}
                    title="Remove saved logo"
                  >
                    Remove logo
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
              <input
                className="pe-input"
                value={profile.roc}
                onChange={(e) => setProfile((p) => ({ ...p, roc: e.target.value }))}
                placeholder="ROC # (optional)"
              />
              <input
                className="pe-input"
                value={profile.attn}
                onChange={(e) => setProfile((p) => ({ ...p, attn: e.target.value }))}
                placeholder="Attn / Contact (optional)"
              />
            </div>

            <div className="pe-grid" style={{ marginTop: 8 }}>
              <input
                className="pe-input"
                value={profile.website}
                onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))}
                placeholder="Website (optional)"
              />
              <input
                className="pe-input"
                value={profile.ein}
                onChange={(e) => setProfile((p) => ({ ...p, ein: e.target.value }))}
                placeholder="EIN / Tax ID (optional)"
              />
            </div>

            <div className="pe-grid" style={{ marginTop: 8 }}>
              <input
                className="pe-input"
                value={profile.terms}
                onChange={(e) => setProfile((p) => ({ ...p, terms: e.target.value }))}
                placeholder="Default terms (optional) ex: Net 15"
              />
              <div />
            </div>

            <div className="pe-row pe-row-slim" style={{ marginTop: 12 }}>
              <div className="pe-muted">Saved automatically. PDF export requires all required fields complete.</div>
              <button className="pe-btn pe-btn-ghost" type="button" onClick={() => setStep("estimate")}>
                Back →
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
        <div>
          <div className="pe-title">Field Pocket Estimator</div>
          <div className="pe-subtitle">Fast numbers. No fluff.</div>

          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              display: "flex",
              gap: 8,
              alignItems: "center",
              opacity: 0.95,
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
              title={
                companyGreen
                  ? "Required company info is complete — PDF export enabled"
                  : "Fill Company name, Phone, Email, Address to enable PDF export"
              }
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
              <span>{companyGreen ? "Company complete" : "Company incomplete"}</span>
            </span>
          </div>
        </div>

        <div className="pe-actions">
          <button className="pe-btn pe-btn-ghost" type="button" onClick={() => setStep("profile")}>
            Edit Company
          </button>
          <button className="pe-btn pe-btn-ghost" onClick={resetForm}>
            New / Clear
          </button>
          <button className="pe-btn" onClick={saveEstimate}>
            Save
          </button>
          <button className="pe-btn pe-btn-ghost" onClick={exportPDF}>
            PDF
          </button>
        </div>
      </header>

      <main className="pe-card">
        {/* JOB INFO */}
        <section className="pe-section">
          <div className="pe-section-title">Job Info</div>

          <div className="pe-grid">
            <input className="pe-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input className="pe-input" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client" />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <select
              className="pe-input"
              style={{ maxWidth: 260 }}
              value={masterScopeKey}
              onChange={(e) => {
                const v = e.target.value;
                setMasterScopeKey(v);
                if (v) {
                  applyMasterTemplate(v);
                  setMasterScopeKey("");
                }
              }}
              title="Template (optional)"
            >
              <option value="">Template (optional)…</option>
              {SCOPE_MASTER_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>

            <select
              className="pe-input"
              style={{ maxWidth: 260 }}
              value={tradeInsertKey}
              onChange={(e) => {
                const v = e.target.value;
                setTradeInsertKey(v);
                if (v) {
                  applyTradeInsert(v);
                  setTradeInsertKey("");
                }
              }}
              title="Template add-on (optional)"
            >
              <option value="">Template add-on (optional)…</option>
              {SCOPE_TRADE_INSERTS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>

            <button className="pe-btn pe-btn-ghost" type="button" onClick={() => setDescription("")} title="Clear scope/notes">
              Clear Scope Box
            </button>
          </div>

          <textarea
            className="pe-input pe-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Scope / notes (templates insert here)"
            style={{ minHeight: 320 }}
          />
        </section>

        <div className="pe-divider" />

        {/* LABOR */}
        <section className="pe-section">
          <div className="pe-row">
            <div className="pe-section-title">Labor</div>
            <button className="pe-btn" onClick={addLaborLine}>
              + Add labor
            </button>
          </div>

          {laborLines.map((l, i) => {
            const presetLabels = LABOR_PRESETS.map((p) => p.label);
            const hasLegacyLabel = l.label && !presetLabels.includes(l.label);

            return (
              <div key={i} className="pe-grid" style={{ marginTop: 8 }}>
                <select className="pe-input" value={l.label || ""} onChange={(e) => applyLaborPresetByLabel(i, e.target.value)} title="Role">
                  <option value="">Select role…</option>
                  {hasLegacyLabel && <option value={l.label}>{l.label}</option>}
                  {LABOR_PRESETS.map((p) => (
                    <option key={p.key} value={p.label}>
                      {p.label}
                    </option>
                  ))}
                </select>

                <input className="pe-input" placeholder="Hours" value={l.hours} onChange={(e) => updateLaborLine(i, "hours", e.target.value)} />
                <input className="pe-input" placeholder="Rate" value={l.rate} onChange={(e) => updateLaborLine(i, "rate", e.target.value)} />

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div className="pe-muted" title="Headcount on this line" style={{ minWidth: 54 }}>
                    x{Number(l.qty) || 1}
                  </div>

                  <button className="pe-btn pe-btn-ghost" type="button" onClick={() => decrementLaborQty(i)} title="Decrease headcount (min 1)">
                    -
                  </button>

                  <button className="pe-btn pe-btn-ghost" type="button" onClick={() => duplicateLaborLine(i)} title="Duplicate laborer on this SAME line (does not add a new row)">
                    Duplicate
                  </button>

                  <button className="pe-btn pe-btn-ghost" onClick={() => removeLaborLine(i)}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}

          <div className="pe-row pe-row-slim">
            <div className="pe-muted">Base labor</div>
            <div className="pe-value">{money.format(laborBase)}</div>
          </div>
        </section>

        <div className="pe-divider" />

        {/* SPECIAL CONDITIONS */}
        <section className="pe-section">
          <div className="pe-section-title">Special Conditions</div>

          <div className="pe-grid">
            <select className="pe-input" value={multiplierSelectValue} onChange={(e) => handleMultiplierSelect(e.target.value)}>
              <option value="1">Standard (1.00×)</option>
              <option value="1.1">Difficult access (1.10×)</option>
              <option value="1.2">High-risk / PPE (1.20×)</option>
              <option value="1.25">Off-hours / Night (1.25×)</option>
              <option value="custom">Custom…</option>
            </select>

            <input className="pe-input" value={hazardPct} onChange={(e) => setHazardPct(e.target.value)} placeholder="Hazard / risk % of LABOR (ex: 30)" title="Percent of adjusted labor only" />
          </div>

          {multiplierMode === "custom" && (
            <div className="pe-grid" style={{ marginTop: 8 }}>
              <input className="pe-input" value={customMultiplier} onChange={(e) => setCustomMultiplier(e.target.value)} placeholder="Custom labor multiplier (ex: 1.18)" />
              <div />
            </div>
          )}

          <div className="pe-row pe-row-slim">
            <div className="pe-muted">Adjusted labor</div>
            <div className="pe-value">{money.format(laborAdjusted)}</div>
          </div>

          {hazardEnabled && (
            <div className="pe-row pe-row-slim">
              <div className="pe-muted">Hazard / risk ({hazardPctNormalized}% of labor)</div>
              <div className="pe-value">{money.format(hazardFeeDollar)}</div>
            </div>
          )}
        </section>

        <div className="pe-divider" />

        {/* MATERIALS */}
        <section className="pe-section">
          <div className="pe-section-title">Materials</div>

          <div className="pe-grid">
            <input className="pe-input" value={materialsCost} onChange={(e) => setMaterialsCost(e.target.value)} placeholder="Materials cost" />
            <input className="pe-input" value={materialsMarkupPct} onChange={(e) => setMaterialsMarkupPct(e.target.value)} placeholder="Markup % (ex: 20)" />
          </div>

          <div className="pe-row pe-row-slim">
            <div className="pe-muted">Materials billed ({normalizedMarkupPct}%)</div>
            <div className="pe-value">{money.format(materialsBilled)}</div>
          </div>
        </section>

        <div className="pe-divider" />

        {/* TOTAL */}
        <section className="pe-section">
          <div className="pe-total">
            <div>
              <div className="pe-total-label">Estimate Total</div>
              <div className="pe-total-meta">
                {laborLines.length} labor line(s)
                {totalLaborers !== laborLines.length ? ` • ${totalLaborers} laborer(s)` : ""}
                {effectiveMultiplier !== 1 ? ` • ${effectiveMultiplier}× complexity` : ""}
                {hazardEnabled ? ` • ${hazardPctNormalized}% risk` : ""}
                {Number.isFinite(Number(normalizedMarkupPct)) ? ` • ${normalizedMarkupPct}% materials` : ""}
              </div>
            </div>
            <div className="pe-total-right">{money.format(total)}</div>
          </div>
        </section>

        <div className="pe-divider" />

        {/* ADDITIONAL NOTES (BOTTOM ONLY) */}
        <section className="pe-section">
          <div className="pe-row">
            <div className="pe-section-title">Additional Notes</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                className="pe-btn pe-btn-ghost"
                type="button"
                onClick={clearAdditionalNotes}
                disabled={!String(additionalNotesText || "").trim()}
                title={!String(additionalNotesText || "").trim() ? "No notes to clear" : "Clear all notes"}
              >
                Clear Notes
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            {QUICK_NOTES.map((b) => (
              <button
                key={b.key}
                className="pe-btn pe-btn-ghost"
                type="button"
                onClick={() => addAdditionalNoteLine(b.line)}
                title="Adds to Additional Notes (warns if already present)"
              >
                {b.label}
              </button>
            ))}
          </div>

          <textarea
            className="pe-input pe-textarea"
            value={additionalNotesText}
            onChange={(e) => setAdditionalNotesText(e.target.value)}
            placeholder="Type any additional notes here… (the + buttons will append too)"
            style={{ marginTop: 10, minHeight: 160 }}
          />

          <div className="pe-muted" style={{ marginTop: 6 }}>
            These print on the PDF as small text (not a table).
          </div>
        </section>

        <div className="pe-divider" />

        {/* HISTORY */}
        <section className="pe-section">
          <div className="pe-row" style={{ marginTop: 0 }}>
            <div className="pe-section-title" style={{ marginBottom: 0 }}>
              Saved Estimates
            </div>
            <button className="pe-btn pe-btn-ghost" onClick={clearAllEstimates} disabled={history.length === 0} title={history.length === 0 ? "No saved estimates" : "Delete all saved estimates"}>
              Clear All
            </button>
          </div>

          {history.length === 0 && <div className="pe-muted">No saved estimates.</div>}

          <div style={{ display: "grid", gap: 8 }}>
            {history.map((e) => (
              <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="pe-btn pe-btn-ghost" onClick={() => loadEstimate(e)} style={{ flex: 1, textAlign: "left" }}>
                  {e.date} — {e.client || "Unnamed"} — {money.format(e.total)}
                </button>

                <button className="pe-btn pe-btn-ghost" onClick={() => deleteEstimate(e.id)} title="Delete this saved estimate">
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
