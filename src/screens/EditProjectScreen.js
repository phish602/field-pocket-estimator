// @ts-nocheck
/* eslint-disable */
import { useCallback, useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { readStoredProjects, updateProjectMetadata } from "../utils/projects";

// Reads the same target key used by ProjectDetailScreen — no separate key needed.
const DETAIL_TARGET_KEY = "estipaid-project-detail-target-v1";

const STATUS_OPTIONS = [
  { key: "draft", label: "Draft" },
  { key: "estimating", label: "Estimating" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
];

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

function composeSiteAddress(street, city, state, zip) {
  const line1 = street.trim();
  const line2parts = [city.trim(), state.trim()].filter(Boolean).join(", ");
  const line2 = [line2parts, zip.trim()].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ");
}

// Parses an existing one-line address into structured fields.
// City/state/zip parsing is best-effort; unrecognized strings go into street.
function parseSiteAddress(raw) {
  const s = String(raw || "").trim();
  if (!s) return { street: "", city: "", state: "", zip: "" };
  // If it has a comma, attempt to split street / "City, ST ZIP"
  const commaIdx = s.indexOf(",");
  if (commaIdx > 0) {
    const street = s.slice(0, commaIdx).trim();
    const rest = s.slice(commaIdx + 1).trim();
    // Match "City, ST ZIP" or "City ST ZIP"
    const stateZipMatch = rest.match(/^(.*?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (stateZipMatch) {
      return { street, city: stateZipMatch[1].trim(), state: stateZipMatch[2], zip: stateZipMatch[3] };
    }
    // Match "City, ST" without zip
    const stateOnlyMatch = rest.match(/^(.*?),?\s+([A-Z]{2})$/);
    if (stateOnlyMatch) {
      return { street, city: stateOnlyMatch[1].trim(), state: stateOnlyMatch[2], zip: "" };
    }
  }
  // Fallback: put entire string in street
  return { street: s, city: "", state: "", zip: "" };
}

function readCustomers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);
    return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
  } catch { return []; }
}

function getCustomerAddress(c) {
  if (!c) return null;
  const svc = c.resService || {};
  const job = c.jobsite || {};
  const primary = (svc.street || svc.city) ? svc : (job.street || job.city) ? job : null;
  if (primary) {
    return {
      street: String(primary.street || "").trim(),
      city: String(primary.city || "").trim(),
      state: String(primary.state || "").trim(),
      zip: String(primary.zip || "").trim(),
    };
  }
  const flat = String(c.address || "").trim();
  if (flat) return { street: flat, city: "", state: "", zip: "" };
  return null;
}

function readProjectById(projectId) {
  if (!projectId) return null;
  try {
    const projects = readStoredProjects();
    return projects.find((p) => String(p?.id || "") === projectId) || null;
  } catch {
    return null;
  }
}

function normalizeStatusValue(value) {
  const status = String(value || "active").toLowerCase();
  return STATUS_OPTIONS.some((option) => option.key === status) ? status : "active";
}

export default function EditProjectScreen({ onBack, onSave }) {
  const [projectId] = useState(() => {
    try { return String(localStorage.getItem(DETAIL_TARGET_KEY) || "").trim(); } catch { return ""; }
  });
  const [project, setProject] = useState(() => readProjectById(projectId));
  const [customers] = useState(() => readCustomers());

  const linkedCustomer = useMemo(() => {
    const id = String(project?.customerId || "").trim();
    if (!id) return null;
    return customers.find((c) => String(c?.id || "") === id) || null;
  }, [project, customers]);

  const linkedCustomerAddr = useMemo(() => getCustomerAddress(linkedCustomer), [linkedCustomer]);

  const [projectName, setProjectName] = useState(() => String(project?.projectName || ""));
  const [addrStreet, setAddrStreet] = useState(() => parseSiteAddress(project?.siteAddress).street);
  const [addrCity, setAddrCity] = useState(() => parseSiteAddress(project?.siteAddress).city);
  const [addrState, setAddrState] = useState(() => parseSiteAddress(project?.siteAddress).state);
  const [addrZip, setAddrZip] = useState(() => parseSiteAddress(project?.siteAddress).zip);
  const [status, setStatus] = useState(() => normalizeStatusValue(project?.status));
  const [notes, setNotes] = useState(() => String(project?.notes || ""));

  useEffect(() => {
    if (!projectId) return undefined;

    const relevantStorageKeys = new Set([
      STORAGE_KEYS.PROJECTS,
      STORAGE_KEYS.CUSTOMERS,
    ]);

    const syncProject = () => {
      setProject((currentProject) => {
        const latestProject = readProjectById(projectId);
        const currentName = String(currentProject?.projectName || "");
        const currentAddress = String(currentProject?.siteAddress || "");
        const currentStatus = normalizeStatusValue(currentProject?.status);
        const currentNotes = String(currentProject?.notes || "");

        if (!latestProject) {
          if (projectName === currentName) setProjectName("");
          if (composeSiteAddress(addrStreet, addrCity, addrState, addrZip) === currentAddress) {
            const p = parseSiteAddress("");
            setAddrStreet(p.street); setAddrCity(p.city); setAddrState(p.state); setAddrZip(p.zip);
          }
          if (status === currentStatus) setStatus("active");
          if (notes === currentNotes) setNotes("");
          return null;
        }

        const nextName = String(latestProject?.projectName || "");
        const nextAddress = String(latestProject?.siteAddress || "");
        const nextStatus = normalizeStatusValue(latestProject?.status);
        const nextNotes = String(latestProject?.notes || "");

        if (projectName === currentName) setProjectName(nextName);
        if (composeSiteAddress(addrStreet, addrCity, addrState, addrZip) === currentAddress) {
          const p = parseSiteAddress(nextAddress);
          setAddrStreet(p.street); setAddrCity(p.city); setAddrState(p.state); setAddrZip(p.zip);
        }
        if (status === currentStatus) setStatus(nextStatus);
        if (notes === currentNotes) setNotes(nextNotes);
        return latestProject;
      });
    };

    const onStorage = (event) => {
      if (!event || event.key == null || relevantStorageKeys.has(event.key)) {
        syncProject();
      }
    };
    const onLocalStorage = (event) => {
      if (
        !event?.detail?.key
        || relevantStorageKeys.has(event.detail.key)
      ) {
        syncProject();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") syncProject();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("focus", syncProject);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("focus", syncProject);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [notes, projectId, projectName, addrStreet, addrCity, addrState, addrZip, status]);

  const canSave = projectName.trim().length > 0;

  const handleUseCustomerAddress = useCallback(() => {
    if (!linkedCustomerAddr) return;
    setAddrStreet(linkedCustomerAddr.street);
    setAddrCity(linkedCustomerAddr.city);
    setAddrState(linkedCustomerAddr.state);
    setAddrZip(linkedCustomerAddr.zip);
  }, [linkedCustomerAddr]);

  const handleSave = useCallback(() => {
    if (!canSave || !projectId) return;
    const latestProject = readProjectById(projectId);
    if (!latestProject) return;
    const updated = updateProjectMetadata(projectId, {
      projectName: projectName.trim(),
      siteAddress: composeSiteAddress(addrStreet, addrCity, addrState, addrZip),
      status,
      notes: notes.trim(),
    });
    if (updated) {
      window.dispatchEvent(new Event("estipaid:projects-changed"));
      if (onSave) onSave(projectId);
    }
  }, [canSave, projectId, projectName, addrStreet, addrCity, addrState, addrZip, status, notes, onSave]);

  if (!project) {
    return (
      <div style={S.screen}>
        <div style={S.topBar}>
          <button type="button" style={S.backBtn} onClick={onBack}>← Cancel</button>
        </div>
        <div style={{ margin: "0 16px", color: "rgba(230,241,248,0.4)", fontSize: 13 }}>Project not found.</div>
      </div>
    );
  }

  const customerLabel = String(project?.customerName || "").trim() || null;

  return (
    <div style={S.screen}>
      <div style={S.topBar}>
        <button type="button" style={S.backBtn} onClick={onBack}>← Cancel</button>
      </div>

      <div style={S.heroCard}>
        <div style={S.title}>Edit Project</div>
        <div style={S.subtitle}>Refine project metadata and continue in the Project Command Center workflow.</div>
      </div>
      <div style={S.workflowHint}>
        <div style={S.workflowHintTitle}>Next Steps</div>
        <div style={S.workflowHintCopy}>Saving updates keeps this project aligned with Projects portfolio and Project Detail command controls.</div>
      </div>

      <div style={S.sectionCard}>
        <div style={S.sectionHeader}>Project</div>
        <div style={{ ...S.fieldGroup, ...S.fieldGroupInCard }}>
          <label style={S.label}>Project Name <span style={S.required}>*</span></label>
          <input
            type="text"
            style={S.input}
            placeholder="e.g. Kitchen Remodel, Roof Repair…"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            autoFocus
          />
        </div>

        {customerLabel ? (
          <div style={{ ...S.fieldGroup, ...S.fieldGroupInCard }}>
            <div style={S.label}>Linked Customer <span style={S.readOnlyTag}>view only</span></div>
            <div style={S.readOnlyField}>{customerLabel}</div>
          </div>
        ) : null}

        <div style={{ ...S.fieldGroup, ...S.fieldGroupInCard }}>
          <label style={S.label}>Site / Job Address</label>
          {linkedCustomer && linkedCustomerAddr && !composeSiteAddress(addrStreet, addrCity, addrState, addrZip) ? (
            <button
              type="button"
              style={S.useCustomerAddrBtn}
              onClick={handleUseCustomerAddress}
            >
              Use customer address
            </button>
          ) : null}
          <input
            type="text"
            style={S.input}
            placeholder="Street address"
            value={addrStreet}
            onChange={(e) => setAddrStreet(e.target.value)}
            autoComplete="street-address"
          />
          <div style={S.addrRow}>
            <input
              type="text"
              style={{ ...S.input, flex: 2 }}
              placeholder="City"
              value={addrCity}
              onChange={(e) => setAddrCity(e.target.value)}
              autoComplete="address-level2"
            />
            <select
              style={{ ...S.input, flex: 1, minWidth: 72 }}
              value={addrState}
              onChange={(e) => setAddrState(e.target.value)}
              autoComplete="address-level1"
            >
              <option value="">State</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              type="text"
              style={{ ...S.input, flex: 1, minWidth: 72 }}
              placeholder="ZIP"
              value={addrZip}
              onChange={(e) => setAddrZip(e.target.value)}
              autoComplete="postal-code"
              inputMode="numeric"
            />
          </div>
        </div>

        <div style={{ ...S.fieldGroup, ...S.fieldGroupInCard, marginBottom: 0 }}>
          <label style={S.label}>Status</label>
          <div style={S.statusGrid}>
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                style={{ ...S.statusOption, ...(status === opt.key ? S.statusOptionActive : {}) }}
                onClick={() => setStatus(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={S.sectionCard}>
        <div style={S.sectionHeader}>Additional</div>
        <div style={{ ...S.fieldGroup, ...S.fieldGroupInCard, marginBottom: 0 }}>
          <label style={S.label}>Notes <span style={S.optional}>(optional)</span></label>
          <textarea
            style={{ ...S.input, ...S.textarea }}
            placeholder="Scope notes, special instructions…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
      </div>

      {/* Save */}
      <div style={S.actionWrap}>
        {canSave ? (
          <div style={S.preSaveSummary}>
            {projectName.trim()}{customerLabel ? ` · ${customerLabel}` : ""}{composeSiteAddress(addrStreet, addrCity, addrState, addrZip) ? ` · ${composeSiteAddress(addrStreet, addrCity, addrState, addrZip)}` : ""}
          </div>
        ) : null}
        <button
          type="button"
          style={{ ...S.saveBtn, ...(canSave ? {} : S.saveBtnDisabled) }}
          disabled={!canSave}
          onClick={handleSave}
        >
          Save Changes
        </button>
      </div>
    </div>
  );
}

const S = {
  screen: {
    padding: "0 0 32px",
    minHeight: "100%",
    color: "rgba(230,241,248,0.92)",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 16px 10px",
  },
  backBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "rgba(99,179,237,0.85)",
    fontSize: 14,
    fontWeight: 600,
    padding: "4px 8px",
    borderRadius: 6,
  },
  heroCard: {
    margin: "0 16px 18px",
    padding: "18px 18px 14px",
    borderRadius: 18,
    background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(34,197,94,0.08) 48%, rgba(245,158,11,0.06)), linear-gradient(180deg, rgba(24,34,44,0.4), rgba(7,10,15,0.94))",
    border: "1px solid rgba(168,184,195,0.14)",
    boxShadow: "0 20px 42px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.04)",
    display: "grid",
    gap: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: 800,
    lineHeight: 1.25,
    color: "rgba(230,241,248,0.96)",
  },
  subtitle: {
    fontSize: 12.5,
    fontWeight: 500,
    color: "rgba(230,241,248,0.66)",
    lineHeight: 1.45,
  },
  workflowHint: {
    margin: "0 16px 14px",
    padding: "12px 12px 11px",
    borderRadius: 14,
    border: "1px solid rgba(99,179,237,0.2)",
    background: "rgba(59,130,246,0.08)",
    display: "grid",
    gap: 4,
  },
  workflowHintTitle: {
    fontSize: 10.5,
    fontWeight: 900,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "rgba(147,197,253,0.9)",
  },
  workflowHintCopy: {
    fontSize: 12.5,
    lineHeight: 1.45,
    color: "rgba(219,234,254,0.8)",
  },
  sectionCard: {
    margin: "0 16px 12px",
    padding: "12px 12px 11px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.09)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015))",
    boxShadow: "0 10px 24px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.02)",
  },
  fieldGroup: {
    margin: "0 16px 14px",
    position: "relative",
  },
  fieldGroupInCard: {
    margin: "0 0 12px",
  },
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.4)",
    marginBottom: 6,
  },
  required: {
    color: "rgba(237,137,99,0.7)",
    fontWeight: 600,
  },
  optional: {
    fontWeight: 500,
    textTransform: "none",
    letterSpacing: "0.02em",
    color: "rgba(230,241,248,0.28)",
  },
  readOnlyField: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.07)",
    background: "rgba(255,255,255,0.03)",
    color: "rgba(230,241,248,0.55)",
    fontSize: 14,
    fontWeight: 500,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(230,241,248,0.92)",
    fontSize: 14,
    fontWeight: 500,
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  },
  textarea: {
    resize: "vertical",
    minHeight: 60,
    lineHeight: 1.45,
  },
  addrRow: {
    display: "flex",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
  },
  useCustomerAddrBtn: {
    background: "rgba(99,179,237,0.08)",
    border: "1px solid rgba(99,179,237,0.3)",
    borderRadius: 6,
    color: "rgba(147,210,255,0.9)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    padding: "5px 12px",
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  statusGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 6,
  },
  statusOption: {
    padding: "8px 0",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(230,241,248,0.55)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "center",
    fontFamily: "inherit",
  },
  statusOptionActive: {
    background: "rgba(99,179,237,0.1)",
    border: "1px solid rgba(99,179,237,0.25)",
    color: "rgba(99,179,237,0.92)",
  },
  sectionHeader: {
    margin: "0 0 10px",
    fontSize: 10.5,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.48)",
  },
  readOnlyTag: {
    fontWeight: 500,
    textTransform: "none",
    letterSpacing: "0.02em",
    color: "rgba(230,241,248,0.22)",
    fontSize: 10,
    marginLeft: 4,
  },
  preSaveSummary: {
    fontSize: 12,
    color: "rgba(230,241,248,0.42)",
    marginBottom: 8,
    lineHeight: 1.35,
  },
  actionWrap: {
    margin: "8px 16px 0",
  },
  saveBtn: {
    width: "100%",
    padding: "13px 0",
    borderRadius: 12,
    border: "1px solid rgba(72,187,120,0.32)",
    background: "rgba(72,187,120,0.14)",
    color: "rgba(72,187,120,0.95)",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: "0.03em",
    textAlign: "center",
    fontFamily: "inherit",
  },
  saveBtnDisabled: {
    opacity: 0.4,
    cursor: "default",
  },
};
