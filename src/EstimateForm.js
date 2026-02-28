// @ts-nocheck
/* eslint-disable */

import React, { useEffect, useMemo, useRef, useState } from "react";
import "./EstimateForm.css";

import { BUILD_TAG } from "./estimator/defaultState";
import { computeTotals } from "./estimator/engine";
import useEstimatorState, { useEstimatorState as useEstimatorStateNamed } from "./estimator/useEstimatorState";
import { buildPdf } from "./estimator/pdf";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Customer-use handoff key (written by CustomersScreen when a customer is selected)
const PENDING_CUSTOMER_USE_KEY = "estipaid-pending-customer-use-v1";
const CUSTOMERS_KEY = "estipaid-customers-v1";
const CUSTOMER_RECENTS_KEY = "estipaid-customer-recent-v1";
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

const MAX_SEARCH_RESULTS = 10;
const DROPDOWN_BLUR_DELAY = 150;

export default function EstimateForm(props) {
  const { embeddedInShell = false } = props || {};

  const customerTopRef = useRef(null);
  const customerNameRef = useRef(null);

  const hook = typeof useEstimatorStateNamed === "function" ? useEstimatorStateNamed : useEstimatorState;

  const {
    state,
    patch,
    addLaborLine,
    dupLaborLine,
    removeLaborLine,
    updateLaborLine,
    addMaterialItem,
    dupMaterialItem,
    removeMaterialItem,
    updateMaterialItem,
    clearAll,
    saveNow,
  } = hook();

  const [searchCustomerText, setSearchCustomerText] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [allCustomers, setAllCustomers] = useState(() => readSavedCustomers());

  // Customer-first: always top + first focus
  useEffect(() => {
    try {
      if (customerTopRef.current?.scrollIntoView) {
        customerTopRef.current.scrollIntoView({ behavior: "auto", block: "start" });
      } else if (typeof window !== "undefined") {
        window.scrollTo(0, 0);
      }
    } catch {}

    try {
      const t = setTimeout(() => {
        try {
          customerNameRef.current?.focus?.({ preventScroll: true });
        } catch {
          try {
            customerNameRef.current?.focus?.();
          } catch {}
        }
      }, 0);
      return () => clearTimeout(t);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      console.log("Loaded EstimateForm BUILD:", BUILD_TAG);
    } catch {}
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
        if (String(c.name || "").trim()) patch("customer.name", String(c.name || "").trim());
        if (String(c.attn || "").trim()) patch("customer.attn", String(c.attn || "").trim());
        if (String(c.phone || "").trim()) patch("customer.phone", String(c.phone || "").trim());
        if (String(c.email || "").trim()) patch("customer.email", String(c.email || "").trim());
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

  function handleSelectCustomer(id) {
    if (!id) { setSelectedCustomerId(""); setSearchCustomerText(""); setDropdownOpen(false); try { localStorage.removeItem(PENDING_CUSTOMER_USE_KEY); } catch {} return; }
    const c = allCustomers.find((x) => String(x.id) === id);
    if (!c) return;
    setSelectedCustomerId(id);
    setSearchCustomerText(customerDisplayName(c));
    setDropdownOpen(false);
    try {
      const flat = flattenCustomerForEstimator(c);
      const payload = { id, customer: { ...c, ...flat }, ts: Date.now() };
      localStorage.setItem(PENDING_CUSTOMER_USE_KEY, JSON.stringify(payload));
      window.dispatchEvent(new Event("estipaid:customer-use"));
      addToCustomerRecents(id);
    } catch {}
  }

  const computed = useMemo(() => computeTotals(state), [state]);

  const laborTotalsById = useMemo(() => {
    const map = new Map();
    try {
      const arr = computed?.labor?.normalized || [];
      for (const ln of arr) map.set(String(ln?.id), Number(ln?.total || 0));
    } catch {}
    return map;
  }, [computed]);

  const materialChargeById = useMemo(() => {
    const map = new Map();
    try {
      const arr = computed?.materials?.normalized || [];
      for (const it of arr) map.set(String(it?.id), Number(it?.charge || 0));
    } catch {}
    return map;
  }, [computed]);

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
  };

  const onSaveNow = () => {
    try {
      saveNow?.();
    } catch {}
  };

  const onPdf = () => {
    try {
      const doc = buildPdf(state, computed);
      const stamp = (() => {
        try {
          const d = new Date();
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          return `${yyyy}${mm}${dd}`;
        } catch {
          return "export";
        }
      })();

      const docNo = String(state?.job?.docNumber || state?.customer?.projectNumber || "").trim();
      const safeDocNo = docNo ? `_${docNo.replace(/[^\w\-]+/g, "_").slice(0, 32)}` : "";
      doc.save(`EstiPaid_${state?.ui?.docType || "estimate"}_${stamp}${safeDocNo}.pdf`);
    } catch {
      window.alert("PDF export failed.");
    }
  };

  const uiDocType = state?.ui?.docType === "invoice" ? "invoice" : "estimate";
  const materialsMode = state?.ui?.materialsMode === "itemized" ? "itemized" : "blanket";

  return (
    <div className="pe-wrap" style={{ paddingTop: embeddedInShell ? 8 : undefined, paddingBottom: embeddedInShell ? 110 : undefined }}>
      {/* Header (no weird middle card) */}
      <div className="pe-header">
        <div>
          <div className="pe-title">Estimator</div>
          <div className="pe-subtitle">{uiDocType === "invoice" ? "Invoice Builder" : "Estimate Builder"}</div>
        </div>

        <div className="pe-actions">
          <button className={uiDocType === "estimate" ? "pe-btn" : "pe-btn pe-btn-ghost"} type="button" onClick={() => patch("ui.docType", "estimate")}>
            Estimate
          </button>
          <button className={uiDocType === "invoice" ? "pe-btn" : "pe-btn pe-btn-ghost"} type="button" onClick={() => patch("ui.docType", "invoice")}>
            Invoice
          </button>
        </div>
      </div>

      {/* Customer first card */}
      <div className="pe-card" ref={customerTopRef}>
        <div className="pe-section-title">Customer</div>

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
            {dropdownOpen && (
              <div style={styles.dropdown}>
                {(searchCustomerText.trim() ? filteredCustomers : recentCustomers).map((c) => (
                  <div
                    key={String(c.id)}
                    style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--pe-border, #333)" }}
                    onMouseDown={(e) => { e.preventDefault(); handleSelectCustomer(String(c.id)); }}
                  >
                    {customerDisplayName(c)}
                  </div>
                ))}
                {(searchCustomerText.trim() ? filteredCustomers : recentCustomers).length === 0 && (
                  <div style={{ padding: "10px 14px", opacity: 0.6, fontSize: 13 }}>No customers found.</div>
                )}
              </div>
            )}
          </div>
          <button
            className="pe-btn pe-btn-ghost"
            type="button"
            disabled={!selectedCustomerId}
            onClick={() => {
              try {
                localStorage.setItem("estipaid-customer-edit-target-v1", JSON.stringify({ id: selectedCustomerId, returnTo: "estimator" }));
                window.dispatchEvent(new Event("estipaid:navigate-customers"));
              } catch {}
            }}
          >
            Edit
          </button>
        </div>
      </div>

      <div className="pe-card">
        <div className="pe-section-title">Job Info</div>

        <div style={styles.grid2}>
          <div>
            <label style={styles.label}>Document #</label>
            <input className="pe-input" value={state.job.docNumber} onChange={(e) => patch("job.docNumber", e.target.value)} placeholder={uiDocType === "invoice" ? "Invoice #" : "Estimate #"} />
          </div>
          <div>
            <label style={styles.label}>PO Number</label>
            <input className="pe-input" value={state.job.poNumber} onChange={(e) => patch("job.poNumber", e.target.value)} placeholder="PO # (optional)" />
          </div>
        </div>

        <div style={styles.grid2}>
          <div>
            <label style={styles.label}>Date</label>
            <input className="pe-input" type="date" value={state.job.date} onChange={(e) => patch("job.date", e.target.value)} />
          </div>
          <div>
            <label style={styles.label}>Due</label>
            <input className="pe-input" type="date" value={state.job.due} onChange={(e) => patch("job.due", e.target.value)} />
          </div>
        </div>
      </div>

      <div className="pe-card">
        <div className="pe-section-title">Scope / Notes</div>
        <select
          className="pe-input"
          defaultValue=""
          style={{ marginBottom: 8 }}
          onChange={(e) => {
            const key = e.target.value;
            if (!key) return;
            const tmpl = SCOPE_MASTER_TEMPLATES.find((t) => t.key === key);
            if (!tmpl) return;
            const existing = state.scopeNotes || "";
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
          style={{ marginBottom: 8 }}
          onChange={(e) => {
            const key = e.target.value;
            if (!key) return;
            const insert = SCOPE_TRADE_INSERTS.find((t) => t.key === key);
            if (!insert) return;
            const existing = state.scopeNotes || "";
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
        <textarea className="pe-input pe-textarea" value={state.scopeNotes} onChange={(e) => patch("scopeNotes", e.target.value)} placeholder="Scope / notes…" style={{ minHeight: 170 }} />
      </div>

      <div className="pe-card">
        <div className="pe-section-title">Labor</div>

        <div style={styles.grid3}>
          <div>
            <label style={styles.label}>Hazard / risk %</label>
            <input className="pe-input" inputMode="decimal" value={String(state.labor.hazardPct)} onChange={(e) => patch("labor.hazardPct", e.target.value)} placeholder="0" />
          </div>
          <div>
            <label style={styles.label}>Multiplier</label>
            <input className="pe-input" inputMode="decimal" value={String(state.labor.multiplier)} onChange={(e) => patch("labor.multiplier", e.target.value)} placeholder="1" />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="pe-btn" type="button" onClick={addLaborLine} style={{ width: "100%" }}>
              + Add labor line
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {(state.labor.lines || []).map((ln, idx) => (
            <div key={ln.id || idx} className="pe-row" style={styles.row}>
              <div style={styles.rowCols}>
                <div style={styles.field}>
                  <div style={styles.label}>Role</div>
                  <select className="pe-input" value={ln.role || ""} onChange={(e) => updateLaborLine(ln.id, { role: e.target.value })}>
                    <option value="" disabled>Select role…</option>
                    {LABOR_PRESETS.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.field}>
                  <div style={styles.label}>Hours</div>
                  <input className="pe-input" inputMode="decimal" value={String(ln.hours ?? "")} onChange={(e) => updateLaborLine(ln.id, { hours: e.target.value })} placeholder="0" />
                </div>
                <div style={styles.field}>
                  <div style={styles.label}>Rate</div>
                  <input className="pe-input" inputMode="decimal" value={String(ln.rate ?? "")} onChange={(e) => updateLaborLine(ln.id, { rate: e.target.value })} placeholder="0" />
                </div>
                <div style={styles.field}>
                  <div style={styles.label}>Line total</div>
                  <input className="pe-input" value={money.format(laborTotalsById.get(String(ln.id)) || 0)} readOnly />
                </div>
              </div>

              <div style={styles.rowActions}>
                <button className="pe-btn pe-btn-ghost" type="button" onClick={() => dupLaborLine(ln.id)}>
                  Duplicate
                </button>
                <button className="pe-btn pe-btn-ghost" type="button" onClick={() => removeLaborLine(ln.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pe-card">
        <div className="pe-section-title">Materials</div>

        <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className={materialsMode === "blanket" ? "pe-btn" : "pe-btn pe-btn-ghost"} type="button" onClick={() => patch("ui.materialsMode", "blanket")}>
            Blanket
          </button>
          <button className={materialsMode === "itemized" ? "pe-btn" : "pe-btn pe-btn-ghost"} type="button" onClick={() => patch("ui.materialsMode", "itemized")}>
            Itemized
          </button>
        </div>

        {materialsMode === "blanket" ? (
          <div style={styles.grid2}>
            <div style={{ marginTop: 10 }}>
              <label style={styles.label}>Blanket cost</label>
              <input className="pe-input" inputMode="decimal" value={String(state.materials.blanketCost ?? "")} onChange={(e) => patch("materials.blanketCost", e.target.value)} placeholder="0.00" />
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={styles.label}>Markup %</label>
              <input className="pe-input" inputMode="decimal" value={String(state.materials.markupPct ?? 0)} onChange={(e) => patch("materials.markupPct", e.target.value)} placeholder="0" />
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
              <button className="pe-btn" type="button" onClick={addMaterialItem}>
                + Add item
              </button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {(state.materials.items || []).map((it, idx) => (
                <div key={it.id || idx} className="pe-row" style={styles.row}>
                  <div style={styles.rowColsMat}>
                    <div style={{ ...styles.field, gridColumn: "span 2" }}>
                      <div style={styles.label}>Description</div>
                      <input className="pe-input" value={it.desc || ""} onChange={(e) => updateMaterialItem(it.id, { desc: e.target.value })} placeholder="Material / item" />
                    </div>
                    <div style={styles.field}>
                      <div style={styles.label}>Qty</div>
                      <input className="pe-input" inputMode="decimal" value={String(it.qty ?? "")} onChange={(e) => updateMaterialItem(it.id, { qty: e.target.value })} placeholder="0" />
                    </div>
                    <div style={styles.field}>
                      <div style={styles.label}>Price each</div>
                      <input className="pe-input" inputMode="decimal" value={String(it.priceEach ?? "")} onChange={(e) => updateMaterialItem(it.id, { priceEach: e.target.value })} placeholder="0.00" />
                    </div>
                    <div style={styles.field}>
                      <div style={styles.label}>Line charge</div>
                      <input className="pe-input" value={money.format(materialChargeById.get(String(it.id)) || 0)} readOnly />
                    </div>
                  </div>

                  <div style={styles.rowActions}>
                    <button className="pe-btn pe-btn-ghost" type="button" onClick={() => dupMaterialItem(it.id)}>
                      Duplicate
                    </button>
                    <button className="pe-btn pe-btn-ghost" type="button" onClick={() => removeMaterialItem(it.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Additional Notes */}
      <div className="pe-card">
        <div className="pe-section-title">Additional Notes</div>
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
          className="pe-input pe-textarea"
          value={state.additionalNotes || ""}
          onChange={(e) => patch("additionalNotes", e.target.value)}
          placeholder="Additional notes, terms, exclusions…"
          style={{ minHeight: 120 }}
        />
      </div>

      {/* Bottom totals (green box like the big file) */}
      <div style={{ maxWidth: 720, margin: "14px auto 0" }}>
        <div className="pe-total">
          <div>
            <div className="pe-total-label">Total</div>
            <div className="pe-total-meta">{lastSavedLabel}</div>
          </div>
          <div className="pe-total-right">{money.format(computed.grandTotal || 0)}</div>
        </div>

        {/* Bottom action buttons (3) */}
        <div className="pe-actions" style={{ justifyContent: "center", marginTop: 12 }}>
          <button className="pe-btn" type="button" onClick={onSaveNow} style={{ minWidth: 160 }}>
            Save
          </button>
          <button className="pe-btn pe-btn-ghost" type="button" onClick={onClearAll} style={{ minWidth: 160 }}>
            Clear
          </button>
          <button className="pe-btn" type="button" onClick={onPdf} style={{ minWidth: 160 }}>
            Export PDF
          </button>
        </div>
      </div>

      <div className="pe-footer">Build: {BUILD_TAG}</div>
    </div>
  );
}

const styles = {
  grid2: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 10 },
  grid3: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 10 },
  label: { display: "block", fontSize: 12, fontWeight: 800, letterSpacing: "1.2px", textTransform: "uppercase", opacity: 0.72, marginBottom: 6 },
  small: { fontSize: 12, fontWeight: 800, letterSpacing: "0.6px", opacity: 0.78, textTransform: "uppercase" },
  row: { display: "grid", gap: 10, padding: 10 },
  rowCols: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 },
  rowColsMat: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 },
  rowActions: { display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" },
  field: { display: "grid", gap: 4 },
  dropdown: { position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.4)", maxHeight: 260, overflowY: "auto", marginTop: 6 },
};
