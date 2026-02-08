import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { calculateEstimateWithLaborLines } from "./estimate";
import "./EstimateForm.css";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function newLaborLine() {
  return { label: "", hours: "", rate: "" };
}

function safeFilename(s) {
  const base = String(s || "").trim() || "Client";
  return base.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim();
}

const STORAGE_KEY = "field-pocket-estimates";
const PROFILE_KEY = "field-pocket-profile";

export default function EstimateForm() {
  // Company profile (for PDF branding)
  const [profile, setProfile] = useState({
    companyName: "",
    phone: "",
    email: "",
    address: "",
  });

  // Job info
  const [date, setDate] = useState(todayISO());
  const [client, setClient] = useState("");
  const [description, setDescription] = useState("");

  // Labor
  const [laborLines, setLaborLines] = useState([newLaborLine()]);

  // Multiplier (preset/custom)
  const [laborMultiplier, setLaborMultiplier] = useState(1);
  const [multiplierMode, setMultiplierMode] = useState("preset"); // "preset" | "custom"
  const [customMultiplier, setCustomMultiplier] = useState("1");

  // Materials / risk
  const [materialsCost, setMaterialsCost] = useState("");
  const [hazardFee, setHazardFee] = useState("");

  // Materials markup %
  const [materialsMarkupPct, setMaterialsMarkupPct] = useState("20");

  // History
  const [history, setHistory] = useState([]);

  // Load profile + history
  useEffect(() => {
    const savedProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    if (savedProfile && typeof savedProfile === "object") setProfile(savedProfile);

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

  const {
    laborBase,
    laborAdjusted,
    materialsBilled,
    total,
    materialsMarkupPct: normalizedMarkupPct,
  } = useMemo(() => {
    return calculateEstimateWithLaborLines(
      laborLines,
      materialsCost,
      effectiveMultiplier,
      hazardFee,
      materialsMarkupPct
    );
  }, [laborLines, materialsCost, effectiveMultiplier, hazardFee, materialsMarkupPct]);

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

  // RESET
  const resetForm = () => {
    setDate(todayISO());
    setClient("");
    setDescription("");
    setLaborLines([newLaborLine()]);
    setLaborMultiplier(1);
    setMultiplierMode("preset");
    setCustomMultiplier("1");
    setMaterialsCost("");
    setHazardFee("");
    setMaterialsMarkupPct("20");
  };

  // Save / load
  const saveEstimate = () => {
    const entry = {
      id: Date.now(),
      date,
      client,
      description,
      laborLines,

      // save multiplier settings
      multiplierMode,
      laborMultiplier,
      customMultiplier,

      // materials / risk
      materialsCost,
      materialsMarkupPct,
      hazardFee,

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
    setLaborLines(e.laborLines);

    setMultiplierMode(e.multiplierMode || "preset");
    setLaborMultiplier(Number(e.laborMultiplier) || 1);
    setCustomMultiplier(
      e.customMultiplier !== undefined && e.customMultiplier !== null
        ? String(e.customMultiplier)
        : "1"
    );

    setMaterialsCost(e.materialsCost);
    setMaterialsMarkupPct(
      e.materialsMarkupPct !== undefined && e.materialsMarkupPct !== null
        ? String(e.materialsMarkupPct)
        : "20"
    );
    setHazardFee(e.hazardFee);
  };

  // DELETE SAVED JOBS (with confirm)
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
      // keep current customMultiplier as-is
      return;
    }
    setMultiplierMode("preset");
    setLaborMultiplier(Number(value) || 1);
  };

  const multiplierSelectValue =
    multiplierMode === "custom" ? "custom" : String(laborMultiplier);

  // PDF (centered company name, NO labor line table, NO multiplier line, NO markup % shown)
  const exportPDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    const companyName = (profile.companyName || "").trim() || "Company Name";
    const contactBits = [profile.phone, profile.email].filter(Boolean).join(" • ");
    const addressLine = (profile.address || "").trim();

    // Header (centered)
    doc.setFontSize(18);
    doc.text(companyName, pageWidth / 2, 16, { align: "center" });

    doc.setFontSize(10);
    if (contactBits) doc.text(contactBits, pageWidth / 2, 22, { align: "center" });
    if (addressLine) doc.text(addressLine, pageWidth / 2, 27, { align: "center" });

    // Title
    doc.setFontSize(14);
    doc.text("ESTIMATE", pageWidth / 2, 36, { align: "center" });

    // Meta box
    doc.setDrawColor(200);
    doc.rect(14, 42, pageWidth - 28, 26);

    doc.setFontSize(11);
    doc.text(`Date: ${date}`, 18, 50);
    doc.text(`Client: ${client || "-"}`, 18, 57);

    const desc = (description || "-").trim() || "-";
    const descLines = doc.splitTextToSize(`Description: ${desc}`, pageWidth - 36);
    doc.text(descLines, 18, 64);

    // Summary ONLY (no labor table, no multiplier line, no markup % shown)
    const riskFeeNum = Number(hazardFee) || 0;

    const summaryRows = [
      ["Labor", money.format(laborAdjusted)],
      ["Materials", money.format(materialsBilled)], // <- percent removed
      ["Hazard / risk fee", money.format(riskFeeNum)],
      ["TOTAL", money.format(total)],
    ];

    autoTable(doc, {
      startY: 74,
      body: summaryRows,
      styles: { fontSize: 12 },
      columnStyles: {
        0: { cellWidth: pageWidth - 28 - 60 },
        1: { cellWidth: 60, halign: "right" },
      },
      theme: "plain",
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.row.index === summaryRows.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fontSize = 13;
        }
      },
    });

    const footerY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text(
      "Notes: Pricing subject to site conditions. Materials and labor based on inputs above.",
      14,
      footerY
    );

    doc.save(`Estimate-${safeFilename(client)}.pdf`);
  };

  return (
    <div className="pe-wrap">
      <header className="pe-header">
        <div>
          <div className="pe-title">Field Pocket Estimator</div>
          <div className="pe-subtitle">Fast numbers. No fluff.</div>
        </div>
        <div className="pe-actions">
          <button className="pe-btn pe-btn-ghost" onClick={resetForm}>
            New / Clear
          </button>
          <button className="pe-btn" onClick={saveEstimate}>Save</button>
          <button className="pe-btn pe-btn-ghost" onClick={exportPDF}>PDF</button>
        </div>
      </header>

      <main className="pe-card">
        {/* COMPANY PROFILE */}
        <section className="pe-section">
          <div className="pe-section-title">Company Profile (for PDF)</div>

          <div className="pe-grid">
            <input
              className="pe-input"
              value={profile.companyName}
              onChange={(e) => setProfile((p) => ({ ...p, companyName: e.target.value }))}
              placeholder="Company name (shows on PDF)"
            />
            <input
              className="pe-input"
              value={profile.phone}
              onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
              placeholder="Phone"
            />
          </div>

          <div className="pe-grid" style={{ marginTop: 8 }}>
            <input
              className="pe-input"
              value={profile.email}
              onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
              placeholder="Email"
            />
            <input
              className="pe-input"
              value={profile.address}
              onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
              placeholder="Address"
            />
          </div>
        </section>

        <div className="pe-divider" />

        {/* JOB INFO */}
        <section className="pe-section">
          <div className="pe-section-title">Job Info</div>

          <div className="pe-grid">
            <input className="pe-input" type="date" value={date} onChange={(e)=>setDate(e.target.value)} />
            <input className="pe-input" value={client} onChange={(e)=>setClient(e.target.value)} placeholder="Client" />
          </div>

          <textarea
            className="pe-input pe-textarea"
            value={description}
            onChange={(e)=>setDescription(e.target.value)}
            placeholder="Scope / notes"
          />
        </section>

        <div className="pe-divider" />

        {/* LABOR */}
        <section className="pe-section">
          <div className="pe-row">
            <div className="pe-section-title">Labor</div>
            <button className="pe-btn" onClick={addLaborLine}>+ Add labor</button>
          </div>

          {laborLines.map((l,i)=>(
            <div key={i} className="pe-grid" style={{ marginTop: 8 }}>
              <input className="pe-input" placeholder="Label" value={l.label} onChange={(e)=>updateLaborLine(i,"label",e.target.value)} />
              <input className="pe-input" placeholder="Hours" value={l.hours} onChange={(e)=>updateLaborLine(i,"hours",e.target.value)} />
              <input className="pe-input" placeholder="Rate" value={l.rate} onChange={(e)=>updateLaborLine(i,"rate",e.target.value)} />
              <button className="pe-btn pe-btn-ghost" onClick={()=>removeLaborLine(i)}>Remove</button>
            </div>
          ))}

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
            <select
              className="pe-input"
              value={multiplierSelectValue}
              onChange={(e) => handleMultiplierSelect(e.target.value)}
            >
              <option value="1">Standard (1.00×)</option>
              <option value="1.1">Difficult access (1.10×)</option>
              <option value="1.2">High-risk / PPE (1.20×)</option>
              <option value="1.25">Off-hours / Night (1.25×)</option>
              <option value="custom">Custom…</option>
            </select>

            <input
              className="pe-input"
              value={hazardFee}
              onChange={(e)=>setHazardFee(e.target.value)}
              placeholder="Hazard fee $"
            />
          </div>

          {multiplierMode === "custom" && (
            <div className="pe-grid" style={{ marginTop: 8 }}>
              <input
                className="pe-input"
                value={customMultiplier}
                onChange={(e)=>setCustomMultiplier(e.target.value)}
                placeholder="Custom labor multiplier (ex: 1.18)"
              />
              <div />
            </div>
          )}

          <div className="pe-row pe-row-slim">
            <div className="pe-muted">Adjusted labor</div>
            <div className="pe-value">{money.format(laborAdjusted)}</div>
          </div>
        </section>

        <div className="pe-divider" />

        {/* MATERIALS */}
        <section className="pe-section">
          <div className="pe-section-title">Materials</div>

          <div className="pe-grid">
            <input
              className="pe-input"
              value={materialsCost}
              onChange={(e)=>setMaterialsCost(e.target.value)}
              placeholder="Materials cost"
            />
            <input
              className="pe-input"
              value={materialsMarkupPct}
              onChange={(e)=>setMaterialsMarkupPct(e.target.value)}
              placeholder="Markup % (ex: 20)"
            />
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
                {effectiveMultiplier !== 1 ? ` • ${effectiveMultiplier}× complexity` : ""}
                {hazardFee ? ` • $${Number(hazardFee).toFixed(2)} risk fee` : ""}
                {Number.isFinite(Number(normalizedMarkupPct)) ? ` • ${normalizedMarkupPct}% materials` : ""}
              </div>
            </div>
            <div className="pe-total-right">{money.format(total)}</div>
          </div>
        </section>

        <div className="pe-divider" />

        {/* HISTORY */}
        <section className="pe-section">
          <div className="pe-row" style={{ marginTop: 0 }}>
            <div className="pe-section-title" style={{ marginBottom: 0 }}>
              Saved Estimates
            </div>
            <button
              className="pe-btn pe-btn-ghost"
              onClick={clearAllEstimates}
              disabled={history.length === 0}
              title={history.length === 0 ? "No saved estimates" : "Delete all saved estimates"}
            >
              Clear All
            </button>
          </div>

          {history.length === 0 && (
            <div className="pe-muted">No saved estimates.</div>
          )}

          <div style={{ display: "grid", gap: 8 }}>
            {history.map((e) => (
              <div
                key={e.id}
                style={{ display: "flex", gap: 8, alignItems: "center" }}
              >
                <button
                  className="pe-btn pe-btn-ghost"
                  onClick={() => loadEstimate(e)}
                  style={{ flex: 1, textAlign: "left" }}
                >
                  {e.date} — {e.client || "Unnamed"} — {money.format(e.total)}
                </button>

                <button
                  className="pe-btn pe-btn-ghost"
                  onClick={() => deleteEstimate(e.id)}
                  title="Delete this saved estimate"
                >
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
