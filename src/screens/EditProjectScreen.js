// @ts-nocheck
/* eslint-disable */
import { useCallback, useEffect, useState } from "react";
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

  const [projectName, setProjectName] = useState(() => String(project?.projectName || ""));
  const [siteAddress, setSiteAddress] = useState(() => String(project?.siteAddress || ""));
  const [status, setStatus] = useState(() => normalizeStatusValue(project?.status));
  const [notes, setNotes] = useState(() => String(project?.notes || ""));

  useEffect(() => {
    if (!projectId) return undefined;

    const syncProject = () => {
      setProject((currentProject) => {
        const latestProject = readProjectById(projectId);
        const currentName = String(currentProject?.projectName || "");
        const currentAddress = String(currentProject?.siteAddress || "");
        const currentStatus = normalizeStatusValue(currentProject?.status);
        const currentNotes = String(currentProject?.notes || "");

        if (!latestProject) {
          if (projectName === currentName) setProjectName("");
          if (siteAddress === currentAddress) setSiteAddress("");
          if (status === currentStatus) setStatus("active");
          if (notes === currentNotes) setNotes("");
          return null;
        }

        const nextName = String(latestProject?.projectName || "");
        const nextAddress = String(latestProject?.siteAddress || "");
        const nextStatus = normalizeStatusValue(latestProject?.status);
        const nextNotes = String(latestProject?.notes || "");

        if (projectName === currentName) setProjectName(nextName);
        if (siteAddress === currentAddress) setSiteAddress(nextAddress);
        if (status === currentStatus) setStatus(nextStatus);
        if (notes === currentNotes) setNotes(nextNotes);
        return latestProject;
      });
    };

    const onStorage = (event) => {
      if (!event || event.key == null || event.key === STORAGE_KEYS.PROJECTS) {
        syncProject();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") syncProject();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncProject);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncProject);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [notes, projectId, projectName, siteAddress, status]);

  const canSave = projectName.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!canSave || !projectId) return;
    const latestProject = readProjectById(projectId);
    if (!latestProject) return;
    const updated = updateProjectMetadata(projectId, {
      projectName: projectName.trim(),
      siteAddress: siteAddress.trim(),
      status,
      notes: notes.trim(),
    });
    if (updated && onSave) onSave(projectId);
  }, [canSave, projectId, projectName, siteAddress, status, notes, onSave]);

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
        <div style={S.subtitle}>Update project details, status, and notes.</div>
      </div>

      {/* ── Project ── */}
      <div style={S.sectionHeader}>Project</div>

      {/* Project Name */}
      <div style={S.fieldGroup}>
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

      {/* Site Address */}
      <div style={S.fieldGroup}>
        <label style={S.label}>Site / Job Address</label>
        <input
          type="text"
          style={S.input}
          placeholder="123 Main St, City, State"
          value={siteAddress}
          onChange={(e) => setSiteAddress(e.target.value)}
        />
      </div>

      {/* Status */}
      <div style={S.fieldGroup}>
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

      {/* ── Customer ── */}
      {customerLabel ? (
        <>
          <div style={S.sectionHeaderDivided}>Customer</div>
          <div style={S.fieldGroup}>
            <div style={S.label}>Linked Customer <span style={S.readOnlyTag}>view only</span></div>
            <div style={S.readOnlyField}>{customerLabel}</div>
          </div>
        </>
      ) : null}

      {/* ── Additional ── */}
      <div style={S.sectionHeaderDivided}>Additional</div>

      {/* Notes */}
      <div style={S.fieldGroup}>
        <label style={S.label}>Notes <span style={S.optional}>(optional)</span></label>
        <textarea
          style={{ ...S.input, ...S.textarea }}
          placeholder="Scope notes, special instructions…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </div>

      {/* Save */}
      <div style={S.actionWrap}>
        {canSave ? (
          <div style={S.preSaveSummary}>
            {projectName.trim()}{customerLabel ? ` · ${customerLabel}` : ""}{siteAddress.trim() ? ` · ${siteAddress.trim()}` : ""}
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
    borderRadius: 14,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)",
    display: "grid",
    gap: 4,
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
    color: "rgba(230,241,248,0.42)",
  },
  fieldGroup: {
    margin: "0 16px 14px",
    position: "relative",
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
    margin: "0 16px 10px",
    fontSize: 10.5,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.32)",
  },
  sectionHeaderDivided: {
    margin: "6px 16px 10px",
    paddingTop: 10,
    borderTop: "1px solid rgba(255,255,255,0.07)",
    fontSize: 10.5,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.32)",
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
