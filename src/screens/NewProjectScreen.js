// @ts-nocheck
/* eslint-disable */
import { useCallback, useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  createProjectRecord,
  readStoredProjects,
  writeStoredProjects,
  upsertProject,
} from "../utils/projects";

const PROJECT_STATUS_OPTIONS = [
  { key: "draft", label: "Draft" },
  { key: "estimating", label: "Estimating" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
];

function readCustomers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeCustomers(list) {
  try {
    localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(Array.isArray(list) ? list : []));
  } catch {}
}

function buildCustomerId() {
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function customerDisplayName(c) {
  return String(c?.name || c?.companyName || c?.fullName || "").trim();
}

function normalizeLookupValue(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesCreatedProject(project, record) {
  const projectCustomerId = normalizeLookupValue(project?.customerId || project?.customer?.id);
  const recordCustomerId = normalizeLookupValue(record?.customerId || record?.customer?.id);
  const projectCustomerName = normalizeLookupValue(project?.customerName || project?.customer?.name || project?.customer?.companyName || project?.customer?.fullName);
  const recordCustomerName = normalizeLookupValue(record?.customerName || record?.customer?.name || record?.customer?.companyName || record?.customer?.fullName);
  return (
    (projectCustomerId || projectCustomerName) === (recordCustomerId || recordCustomerName)
    && normalizeLookupValue(project?.projectName) === normalizeLookupValue(record?.projectName)
    && normalizeLookupValue(project?.siteAddress) === normalizeLookupValue(record?.siteAddress)
  );
}

export default function NewProjectScreen({ onBack, onSave }) {
  const [customers, setCustomers] = useState(() => readCustomers());

  const [projectName, setProjectName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [status, setStatus] = useState("active");
  const [notes, setNotes] = useState("");

  // Customer selection
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);

  // Inline new customer
  const [inlineNewMode, setInlineNewMode] = useState(false);
  const [inlineName, setInlineName] = useState("");
  const [inlinePhone, setInlinePhone] = useState("");
  const [inlineEmail, setInlineEmail] = useState("");

  useEffect(() => {
    const refreshCustomers = () => setCustomers(readCustomers());
    const onStorage = (event) => {
      if (!event || event.key === STORAGE_KEYS.CUSTOMERS) {
        refreshCustomers();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshCustomers();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refreshCustomers);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refreshCustomers);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers.find((c) => String(c?.id || "") === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.toLowerCase().trim();
    if (!q) return customers;
    return customers.filter((c) => {
      const name = customerDisplayName(c).toLowerCase();
      const company = String(c?.companyName || "").toLowerCase();
      return name.includes(q) || company.includes(q);
    });
  }, [customers, customerSearch]);

  const handleSelectCustomer = useCallback((c) => {
    setSelectedCustomerId(String(c?.id || ""));
    setCustomerSearch(customerDisplayName(c));
    setCustomerDropdownOpen(false);
    setInlineNewMode(false);
  }, []);

  const handleClearCustomer = useCallback(() => {
    setSelectedCustomerId("");
    setCustomerSearch("");
    setCustomerDropdownOpen(false);
    setInlineNewMode(false);
  }, []);

  const openInlineNew = useCallback(() => {
    setCustomerDropdownOpen(false);
    setInlineName(customerSearch.trim());
    setInlinePhone("");
    setInlineEmail("");
    setInlineNewMode(true);
  }, [customerSearch]);

  const cancelInlineNew = useCallback(() => {
    setInlineNewMode(false);
    setInlineName("");
    setInlinePhone("");
    setInlineEmail("");
  }, []);

  const handleInlineCreateCustomer = useCallback(() => {
    const name = inlineName.trim();
    if (!name) return;
    const id = buildCustomerId();
    const now = Date.now();
    const newCustomer = {
      id,
      type: "residential",
      fullName: name,
      name,
      resPhone: inlinePhone.trim(),
      resEmail: inlineEmail.trim(),
      createdAt: now,
      updatedAt: now,
    };
    const next = [...customers, newCustomer];
    writeCustomers(next);
    setCustomers(next);
    setSelectedCustomerId(id);
    setCustomerSearch(name);
    setInlineNewMode(false);
    setInlineName("");
    setInlinePhone("");
    setInlineEmail("");
  }, [customers, inlineName, inlinePhone, inlineEmail]);

  const canSave = projectName.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!canSave) return;
    const now = Date.now();
    const record = createProjectRecord({
      customerId: selectedCustomer ? String(selectedCustomer?.id || "") : "",
      customerName: selectedCustomer ? customerDisplayName(selectedCustomer) : "",
      projectName: projectName.trim(),
      siteAddress: siteAddress.trim(),
      status,
      notes: notes.trim(),
      createdAt: now,
      updatedAt: now,
    });
    const projects = readStoredProjects();
    const next = upsertProject(projects, record);
    const savedProjects = writeStoredProjects(next);
    const persisted = savedProjects.find((project) => String(project?.id || "") === String(record.id || ""))
      || savedProjects.find((project) => matchesCreatedProject(project, record))
      || record;
    if (onSave) onSave(persisted.id);
  }, [canSave, selectedCustomerId, selectedCustomer, projectName, siteAddress, status, notes, onSave]);

  return (
    <div style={S.screen}>
      <div style={S.topBar}>
        <button type="button" style={S.backBtn} onClick={onBack}>← Cancel</button>
      </div>

      <div style={S.heroCard}>
        <div style={S.title}>New Project</div>
        <div style={S.subtitle}>Name the job, link a customer, and start tracking.</div>
      </div>

      {/* ── Project Identity ── */}
      <div style={{ margin: "0 16px 10px", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(230,241,248,0.32)" }}>Project</div>

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
        <div style={S.statusRow}>
          {PROJECT_STATUS_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              style={{ ...S.statusOption, ...(status === option.key ? S.statusOptionActive : {}) }}
              onClick={() => setStatus(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Customer ── */}
      <div style={{ margin: "6px 16px 10px", paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.07)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(230,241,248,0.32)" }}>Customer</div>

      {/* Customer */}
      <div style={S.fieldGroup}>
        <label style={S.label}>Customer</label>
        {!inlineNewMode ? (
          <>
            <div style={S.customerInputWrap}>
              <input
                type="text"
                style={S.input}
                placeholder="Search or select customer…"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setCustomerDropdownOpen(true);
                  if (!e.target.value.trim()) setSelectedCustomerId("");
                }}
                onFocus={() => setCustomerDropdownOpen(true)}
              />
              {selectedCustomerId ? (
                <button type="button" style={S.clearBtn} onClick={handleClearCustomer} aria-label="Clear customer">✕</button>
              ) : null}
            </div>
            {customerDropdownOpen ? (
              <div style={S.dropdown}>
                {filteredCustomers.slice(0, 8).map((c) => {
                  const name = customerDisplayName(c);
                  const isSelected = String(c?.id || "") === selectedCustomerId;
                  return (
                    <button
                      key={c?.id || name}
                      type="button"
                      style={{ ...S.dropdownItem, ...(isSelected ? S.dropdownItemActive : {}) }}
                      onClick={() => handleSelectCustomer(c)}
                    >
                      {name || "Unnamed"}
                    </button>
                  );
                })}
                <button
                  type="button"
                  style={S.dropdownNewCustomer}
                  onClick={openInlineNew}
                >
                  + New Customer
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div style={S.inlineNewWrap}>
            <div style={S.inlineNewTitle}>New Customer</div>
            <input
              type="text"
              style={S.input}
              placeholder="Full name *"
              value={inlineName}
              onChange={(e) => setInlineName(e.target.value)}
              autoFocus
            />
            <input
              type="tel"
              style={{ ...S.input, marginTop: 8 }}
              placeholder="Phone (optional)"
              value={inlinePhone}
              onChange={(e) => setInlinePhone(e.target.value)}
            />
            <input
              type="email"
              style={{ ...S.input, marginTop: 8 }}
              placeholder="Email (optional)"
              value={inlineEmail}
              onChange={(e) => setInlineEmail(e.target.value)}
            />
            <div style={S.inlineNewActions}>
              <button type="button" style={S.inlineNewCancel} onClick={cancelInlineNew}>Cancel</button>
              <button
                type="button"
                style={{ ...S.inlineNewSave, ...(inlineName.trim() ? {} : S.inlineNewSaveDisabled) }}
                disabled={!inlineName.trim()}
                onClick={handleInlineCreateCustomer}
              >
                Add Customer
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Additional ── */}
      <div style={{ margin: "6px 16px 10px", paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.07)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(230,241,248,0.32)" }}>Additional</div>

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
          <div style={{ fontSize: 12, color: "rgba(230,241,248,0.42)", marginBottom: 8, lineHeight: 1.35 }}>
            {projectName.trim()}{selectedCustomer ? ` · ${customerDisplayName(selectedCustomer)}` : ""}{siteAddress.trim() ? ` · ${siteAddress.trim()}` : ""}
          </div>
        ) : null}
        <button
          type="button"
          style={{ ...S.saveBtn, ...(canSave ? {} : S.saveBtnDisabled) }}
          disabled={!canSave}
          onClick={handleSave}
        >
          Create Project
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
  customerInputWrap: {
    position: "relative",
  },
  clearBtn: {
    position: "absolute",
    right: 8,
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "rgba(230,241,248,0.35)",
    fontSize: 13,
    padding: "4px 6px",
  },
  dropdown: {
    marginTop: 4,
    borderRadius: 10,
    background: "rgba(20,30,45,0.98)",
    border: "1px solid rgba(255,255,255,0.12)",
    maxHeight: 200,
    overflowY: "auto",
    zIndex: 10,
  },
  dropdownItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "9px 12px",
    background: "none",
    border: "none",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    color: "rgba(230,241,248,0.82)",
    fontSize: 13.5,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  dropdownItemActive: {
    background: "rgba(99,179,237,0.1)",
    color: "rgba(99,179,237,0.95)",
  },
  dropdownNewCustomer: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "9px 12px",
    background: "none",
    border: "none",
    borderTop: "1px solid rgba(255,255,255,0.08)",
    color: "rgba(99,179,237,0.82)",
    fontSize: 13.5,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  inlineNewWrap: {
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid rgba(99,179,237,0.2)",
    background: "rgba(99,179,237,0.04)",
    display: "grid",
    gap: 0,
  },
  inlineNewTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "rgba(99,179,237,0.72)",
    marginBottom: 10,
  },
  inlineNewActions: {
    display: "flex",
    gap: 8,
    marginTop: 10,
    justifyContent: "flex-end",
  },
  inlineNewCancel: {
    padding: "7px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "none",
    color: "rgba(230,241,248,0.5)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  inlineNewSave: {
    padding: "7px 16px",
    borderRadius: 8,
    border: "1px solid rgba(99,179,237,0.3)",
    background: "rgba(99,179,237,0.14)",
    color: "rgba(99,179,237,0.95)",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  inlineNewSaveDisabled: {
    opacity: 0.38,
    cursor: "default",
  },
  statusRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))",
    gap: 8,
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
