// @ts-nocheck
/* eslint-disable */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  createManualProject,
  readStoredProjects,
  writeStoredProjects,
} from "../utils/projects";
import { useBusinessMutationGuard } from "../lib/BusinessMutationGuardContext";
import { markCloudBackupDirty } from "../lib/cloudBackupQueue";
import CloudBackupInlineStatus from "../components/CloudBackupInlineStatus";

const PROJECT_STATUS_OPTIONS = [
  { key: "draft", label: "Draft" },
  { key: "estimating", label: "Estimating" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
];

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"];

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
    markCloudBackupDirty({
      reason: "customer_data_saved",
      domains: ["customers"],
      severity: "normal",
      source: "writeCustomers",
    });
  } catch {}
}

function buildCustomerId() {
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function customerDisplayName(c) {
  return String(c?.name || c?.companyName || c?.fullName || "").trim();
}

function joinAddr(a) {
  const street = String(a?.street || "").trim();
  const city = String(a?.city || "").trim();
  const state = String(a?.state || "").trim();
  const zip = String(a?.zip || "").trim();
  const line2 = [city, state].filter(Boolean).join(", ");
  const line2Full = [line2, zip].filter(Boolean).join(" ");
  return [street, line2Full].filter(Boolean).join("\n");
}

function toEstimatorFlat(c) {
  const svc = c?.resService || {};
  const bill = c?.resBillingSame ? (c?.resService || {}) : (c?.resBilling || {});
  return {
    name: String(c?.fullName || "").trim(),
    phone: String(c?.resPhone || "").trim(),
    email: String(c?.resEmail || "").trim(),
    attn: "",
    address: joinAddr(svc),
    billingAddress: joinAddr(bill),
    city: String(svc?.city || "").trim(),
    state: String(svc?.state || "").trim(),
    zip: String(svc?.zip || "").trim(),
  };
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

function buildInlineResidentialCustomer({ id, name, phone, email, now }) {
  const nextItem = {
    id,
    type: "residential",
    fullName: name,
    name,
    resPhone: String(phone || "").trim(),
    resEmail: String(email || "").trim(),
    resService: { street: "", city: "", state: "", zip: "" },
    resBillingSame: true,
    resBilling: { street: "", city: "", state: "", zip: "" },
    companyName: "",
    contactName: "",
    contactTitle: "",
    comPhone: "",
    comEmail: "",
    apEmail: "",
    netTermsType: "DUE_UPON_RECEIPT",
    netTermsDays: null,
    poRequired: false,
    jobsite: { street: "", city: "", state: "", zip: "" },
    billSameAsJob: true,
    billing: { street: "", city: "", state: "", zip: "" },
    createdAt: now,
    updatedAt: now,
  };
  const flat = toEstimatorFlat(nextItem);
  return {
    ...nextItem,
    name: flat.name,
    phone: flat.phone,
    email: flat.email,
    attn: flat.attn,
    address: flat.address,
    billingAddress: flat.billingAddress,
    city: flat.city,
    state: flat.state,
    zip: flat.zip,
  };
}

export default function NewProjectScreen({ onBack, onSave }) {
  const { ensureCanMutateBusinessData } = useBusinessMutationGuard();
  const [customers, setCustomers] = useState(() => readCustomers());

  const [projectName, setProjectName] = useState("");
  const [addrStreet, setAddrStreet] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip] = useState("");
  const [addrSource, setAddrSource] = useState("custom"); // "customer" | "custom"
  const addrUserOwnedRef = useRef(false); // true once user explicitly chooses "Different job site" or edits manually
  const [status, setStatus] = useState("active");
  const [notes, setNotes] = useState("");

  // Customer selection
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerContainerRef = useRef(null);

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
    const onLocalStorage = (event) => {
      if (
        event?.detail?.key === STORAGE_KEYS.CUSTOMERS
        || event?.detail?.key === STORAGE_KEYS.PROJECTS
      ) {
        refreshCustomers();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshCustomers();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("focus", refreshCustomers);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("focus", refreshCustomers);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!customerDropdownOpen) return;
    function handlePointerDown(e) {
      if (customerContainerRef.current && !customerContainerRef.current.contains(e.target)) {
        setCustomerDropdownOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") setCustomerDropdownOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [customerDropdownOpen]);

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
    // Auto-populate address if user hasn't already manually committed to a custom address
    if (!addrUserOwnedRef.current) {
      const cAddr = getCustomerAddress(c);
      if (cAddr) {
        setAddrStreet(cAddr.street);
        setAddrCity(cAddr.city);
        setAddrState(cAddr.state);
        setAddrZip(cAddr.zip);
        setAddrSource("customer");
      }
    }
  }, []);

  const handleClearCustomer = useCallback(() => {
    setSelectedCustomerId("");
    setCustomerSearch("");
    setCustomerDropdownOpen(false);
    setInlineNewMode(false);
    // If we were showing the customer's address, clear it
    if (addrSource === "customer") {
      setAddrStreet("");
      setAddrCity("");
      setAddrState("");
      setAddrZip("");
      setAddrSource("custom");
      addrUserOwnedRef.current = false;
    }
  }, [addrSource]);

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

  const handleUseCustomerAddress = useCallback(() => {
    const cAddr = getCustomerAddress(selectedCustomer);
    if (cAddr) {
      setAddrStreet(cAddr.street);
      setAddrCity(cAddr.city);
      setAddrState(cAddr.state);
      setAddrZip(cAddr.zip);
    }
    setAddrSource("customer");
    addrUserOwnedRef.current = false;
  }, [selectedCustomer]);

  const handleUseDifferentAddress = useCallback(() => {
    setAddrSource("custom");
    addrUserOwnedRef.current = true;
  }, []);

  const customerAddr = useMemo(() => getCustomerAddress(selectedCustomer), [selectedCustomer]);

  const handleInlineCreateCustomer = useCallback(async () => {
    const name = inlineName.trim();
    if (!name) return;
    const id = buildCustomerId();
    const now = Date.now();
    const newCustomer = buildInlineResidentialCustomer({
      id,
      name,
      phone: inlinePhone,
      email: inlineEmail,
      now,
    });
    const mutationAccess = await ensureCanMutateBusinessData("local_save");
    if (!mutationAccess?.ok) {
      window.alert(mutationAccess?.userMessage || "Save stopped because EstiPaid was switched to another device.");
      return;
    }
    const next = [...customers, newCustomer];
    writeCustomers(next);
    window.dispatchEvent(new Event("estipaid:customers-changed"));
    setCustomers(next);
    setSelectedCustomerId(id);
    setCustomerSearch(name);
    setInlineNewMode(false);
    setInlineName("");
    setInlinePhone("");
    setInlineEmail("");
    setAddrSource("custom"); // inline new customers have no address yet
    addrUserOwnedRef.current = false;
  }, [customers, ensureCanMutateBusinessData, inlineName, inlinePhone, inlineEmail]);

  const canSave = projectName.trim().length > 0;

  function composeSiteAddress(street, city, state, zip) {
    const line1 = street.trim();
    const line2parts = [city.trim(), state.trim()].filter(Boolean).join(", ");
    const line2 = [line2parts, zip.trim()].filter(Boolean).join(" ");
    return [line1, line2].filter(Boolean).join(", ");
  }

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    const now = Date.now();
    const source = {
      customerId: selectedCustomer ? String(selectedCustomer?.id || "") : "",
      customerName: selectedCustomer ? customerDisplayName(selectedCustomer) : "",
      projectName: projectName.trim(),
      siteAddress: composeSiteAddress(addrStreet, addrCity, addrState, addrZip),
      status,
      notes: notes.trim(),
      createdAt: now,
      updatedAt: now,
    };
    const projects = readStoredProjects();
    const { project, projects: next } = createManualProject(projects, source);
    const mutationAccess = await ensureCanMutateBusinessData("local_save");
    if (!mutationAccess?.ok) {
      window.alert(mutationAccess?.userMessage || "Save stopped because EstiPaid was switched to another device.");
      return;
    }
    writeStoredProjects(next);
    window.dispatchEvent(new Event("estipaid:projects-changed"));
    if (onSave) onSave(project.id);
  }, [canSave, selectedCustomerId, selectedCustomer, projectName, addrStreet, addrCity, addrState, addrZip, status, notes, onSave, ensureCanMutateBusinessData]);

  return (
    <div style={S.screen}>
      <div style={S.topBar}>
        <button type="button" style={S.backBtn} onClick={onBack}>← Cancel</button>
      </div>

      <div style={S.heroCard}>
        <div style={S.title}>New Project</div>
        <div style={S.subtitle}>Capture project intake details, then continue in the Project Command Center.</div>
      </div>
      <div style={S.workflowHint}>
        <div style={S.workflowHintTitle}>Next Steps</div>
        <div style={S.workflowHintCopy}>Save this intake to open the project in the same command-center workflow used across Projects and Project Detail.</div>
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
        <div style={{ ...S.fieldGroup, ...S.fieldGroupInCard }}>
          <label style={S.label}>Customer</label>
          {!inlineNewMode ? (
            <div ref={customerContainerRef}>
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
            </div>
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
        <div style={{ ...S.fieldGroup, ...S.fieldGroupInCard }}>
          <label style={S.label}>Site / Job Address</label>
          {selectedCustomer && customerAddr ? (
            <div style={S.addrModeRow}>
              <button
                type="button"
                style={{ ...S.addrModeBtn, ...(addrSource === "customer" ? S.addrModeBtnActive : {}) }}
                onClick={handleUseCustomerAddress}
              >
                Use customer address
              </button>
              <button
                type="button"
                style={{ ...S.addrModeBtn, ...(addrSource === "custom" ? S.addrModeBtnActive : {}) }}
                onClick={handleUseDifferentAddress}
              >
                Different job site
              </button>
            </div>
          ) : null}
          <input
            type="text"
            style={{ ...S.input, ...(addrSource === "customer" ? S.inputDisabled : {}), marginTop: selectedCustomer && customerAddr ? 8 : 0 }}
            placeholder="Street address"
            value={addrStreet}
            onChange={(e) => { setAddrStreet(e.target.value); addrUserOwnedRef.current = true; setAddrSource("custom"); }}
            disabled={addrSource === "customer"}
            autoComplete="street-address"
          />
          <div style={S.addrRow}>
            <input
              type="text"
              style={{ ...S.input, flex: 2, ...(addrSource === "customer" ? S.inputDisabled : {}) }}
              placeholder="City"
              value={addrCity}
              onChange={(e) => { setAddrCity(e.target.value); addrUserOwnedRef.current = true; setAddrSource("custom"); }}
              disabled={addrSource === "customer"}
              autoComplete="address-level2"
            />
            <select
              style={{ ...S.input, flex: 1, minWidth: 72, ...(addrSource === "customer" ? S.inputDisabled : {}) }}
              value={addrState}
              onChange={(e) => { setAddrState(e.target.value); addrUserOwnedRef.current = true; setAddrSource("custom"); }}
              disabled={addrSource === "customer"}
              autoComplete="address-level1"
            >
              <option value="">State</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              type="text"
              style={{ ...S.input, flex: 1, minWidth: 72, ...(addrSource === "customer" ? S.inputDisabled : {}) }}
              placeholder="ZIP"
              value={addrZip}
              onChange={(e) => { setAddrZip(e.target.value); addrUserOwnedRef.current = true; setAddrSource("custom"); }}
              disabled={addrSource === "customer"}
              autoComplete="postal-code"
              inputMode="numeric"
            />
          </div>
        </div>
        <div style={{ ...S.fieldGroup, ...S.fieldGroupInCard }}>
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
          <div style={{ fontSize: 12, color: "rgba(230,241,248,0.42)", marginBottom: 8, lineHeight: 1.35 }}>
            {projectName.trim()}{selectedCustomer ? ` · ${customerDisplayName(selectedCustomer)}` : ""}{composeSiteAddress(addrStreet, addrCity, addrState, addrZip) ? ` · ${composeSiteAddress(addrStreet, addrCity, addrState, addrZip)}` : ""}
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
        <CloudBackupInlineStatus style={{ marginTop: 8, textAlign: "center" }} />
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
  sectionHeader: {
    margin: "0 0 10px",
    fontSize: 10.5,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.48)",
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
  addrRow: {
    display: "flex",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
  },
  addrModeRow: {
    display: "flex",
    gap: 6,
    marginBottom: 0,
    flexWrap: "wrap",
  },
  addrModeBtn: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    color: "rgba(190,210,230,0.7)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    padding: "5px 12px",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
  },
  addrModeBtnActive: {
    background: "rgba(99,179,237,0.15)",
    borderColor: "rgba(99,179,237,0.5)",
    color: "rgba(147,210,255,0.95)",
    fontWeight: 600,
  },
  inputDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
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
