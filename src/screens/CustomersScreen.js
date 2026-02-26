// @ts-nocheck
/* eslint-disable */
import React, { useEffect, useMemo, useState } from "react";

const CUSTOMERS_KEY = "estipaid-customers-v1";
const CUSTOMERS_KEY_LEGACY = "field-pocket-customers-v1";

const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"];

function safeParse(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function readCustomers() {
  const rawNew = localStorage.getItem(CUSTOMERS_KEY);
  const rawLegacy = localStorage.getItem(CUSTOMERS_KEY_LEGACY);
  const arrNew = rawNew ? safeParse(rawNew, []) : [];
  const arrLegacy = rawLegacy ? safeParse(rawLegacy, []) : [];
  const arr = Array.isArray(arrNew) && arrNew.length ? arrNew : Array.isArray(arrLegacy) ? arrLegacy : [];
  return (Array.isArray(arr) ? arr : []).filter(Boolean);
}

function persistCustomers(list) {
  const safe = Array.isArray(list) ? list : [];
  try {
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(safe));
  } catch {}
  try {
    localStorage.setItem(CUSTOMERS_KEY_LEGACY, JSON.stringify(safe));
  } catch {}
}

function buildId() {
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function norm(s) {
  return String(s || "").trim().toLowerCase();
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


function digitsOnly(s) {
  return String(s || "").replace(/\D+/g, "");
}

function formatPhoneUS(input) {
  const d = digitsOnly(input).slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (d.length <= 3) return a;
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function formatZipUS(input) {
  const d = digitsOnly(input).slice(0, 9);
  if (d.length <= 5) return d;
  return `${d.slice(0,5)}-${d.slice(5)}`;
}

function formatStateUS(input) {
  return String(input || "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, 2);
}


function FieldLabel({ children }) {
  return <div style={{ fontSize: 12.5, opacity: 0.82, letterSpacing: 0.2, fontWeight: 900 }}>{children}</div>;
}

function StateSelect({ value, onChange, placeholder = "State" }) {
  return (
    <select className="pe-input" value={value || ""} onChange={onChange} autoComplete="address-level1">
      <option value="">{placeholder}</option>
      {US_STATES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}


function TextLine({ children }) {
  return <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.25, whiteSpace: "pre-line" }}>{children}</div>;
}

function labelOf(lang, en, es) {
  return lang === "es" ? es : en;
}

const cardBaseStyle = {
  borderRadius: 18,
  padding: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  boxShadow: "0 10px 26px rgba(0,0,0,0.30)",
};

const cardActiveStyle = {
  border: "1px solid rgba(34,197,94,0.50)",
  background: "rgba(34,197,94,0.06)",
};

const twoCol = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
};

const fullRow = { gridColumn: "1 / -1" };

function emptyDraft(type = "residential") {
  return {
    id: "",
    type,

    // residential
    fullName: "",
    resPhone: "",
    resEmail: "",
    resService: { street: "", city: "", state: "", zip: "" },
    resBillingSame: true,
    resBilling: { street: "", city: "", state: "", zip: "" },

    // commercial
    companyName: "",
    contactName: "",
    contactTitle: "",
    comPhone: "",
    comEmail: "",
    apEmail: "",
    poRequired: false,
    jobsite: { street: "", city: "", state: "", zip: "" },
    billSameAsJob: true,
    billing: { street: "", city: "", state: "", zip: "" },
  };
}

function displayName(c) {
  const type = String(c?.type || "residential");
  if (type === "commercial") return String(c?.companyName || "").trim() || "Unnamed";
  return String(c?.fullName || "").trim() || "Unnamed";
}

function contactLine(c) {
  const type = String(c?.type || "residential");
  if (type === "commercial") {
    const contact = [c?.contactName, c?.contactTitle].filter(Boolean).join(c?.contactTitle ? ", " : "");
    return contact || "";
  }
  return "";
}

function phoneEmailLine(c) {
  const type = String(c?.type || "residential");
  const phone = type === "commercial" ? c?.comPhone : c?.resPhone;
  const email = type === "commercial" ? c?.comEmail : c?.resEmail;
  return [email, phone].filter(Boolean).join(" • ");
}

function mainAddressText(c) {
  const type = String(c?.type || "residential");
  const a = type === "commercial" ? c?.jobsite : c?.resService;
  return joinAddr(a);
}

export default function CustomersScreen({
  lang = "en",
  t = (k) => k,
  customers,
  setCustomers,
  selectedCustomerId,
  setSelectedCustomerId,
  onDone,
}) {
  const label = (en, es) => labelOf(lang, en, es);

  const [localCustomers, setLocalCustomers] = useState(() => (Array.isArray(customers) ? [] : readCustomers()));
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("list"); // list | edit
  const [draft, setDraft] = useState(() => emptyDraft("residential"));

  useEffect(() => {
    if (!Array.isArray(customers)) setLocalCustomers(readCustomers());
  }, [customers]);

  useEffect(() => {
    const onStorage = (e) => {
      if (!e) return;
      if (e.key === CUSTOMERS_KEY || e.key === CUSTOMERS_KEY_LEGACY) {
        if (!Array.isArray(customers)) setLocalCustomers(readCustomers());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [customers]);

  const list = useMemo(() => (Array.isArray(customers) ? customers : localCustomers), [customers, localCustomers]);

  const filtered = useMemo(() => {
  const qq = norm(q);
  const arr = list || [];
  if (!qq) return arr;

  const vals = [];
  const pushVal = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      vals.push(String(v));
    }
  };

  const walk = (obj, depth = 0) => {
    if (obj === null || obj === undefined) return;
    if (depth > 4) return;
    if (Array.isArray(obj)) {
      for (const it of obj) walk(it, depth + 1);
      return;
    }
    if (typeof obj === "object") {
      for (const k of Object.keys(obj)) {
        // Ignore huge blobs if ever present
        if (k === "_raw" || k === "raw" || k === "html") continue;
        walk(obj[k], depth + 1);
      }
      return;
    }
    pushVal(obj);
  };

  return arr.filter((c) => {
    vals.length = 0;
    walk(c, 0);
    const blob = norm(vals.join(" "));
    return blob.includes(qq);
  });
}, [list, q]);

  function startNew(type = "commercial") {
    setDraft(emptyDraft(type));
    setMode("edit");
  }

  function startEdit(c) {
    const type = String(c?.type || "residential");
    const base = emptyDraft(type);
    setDraft({ ...base, ...(c || {}) });
    setMode("edit");
  }

  function saveDraft() {
    const d = draft || emptyDraft("residential");
    const type = String(d.type || "residential");

    if (type === "commercial") {
      if (!String(d.companyName || "").trim()) return alert(label("Company Name is required.", "Nombre de la compañía es requerido."));
      if (!String(d.contactName || "").trim()) return alert(label("Primary Contact is required.", "Contacto principal es requerido."));
      if (!String(d.jobsite?.street || "").trim()) return alert(label("Jobsite Street is required.", "Calle del sitio es requerida."));
      if (!String(d.jobsite?.city || "").trim()) return alert(label("Jobsite City is required.", "Ciudad del sitio es requerida."));
      if (!String(d.jobsite?.state || "").trim()) return alert(label("Jobsite State is required.", "Estado del sitio es requerido."));
      if (!String(d.jobsite?.zip || "").trim()) return alert(label("Jobsite ZIP is required.", "ZIP del sitio es requerido."));
    } else {
      if (!String(d.fullName || "").trim()) return alert(label("Full Name is required.", "Nombre completo es requerido."));
      if (!String(d.resService?.street || "").trim()) return alert(label("Street is required.", "Calle es requerida."));
      if (!String(d.resService?.city || "").trim()) return alert(label("City is required.", "Ciudad es requerida."));
      if (!String(d.resService?.state || "").trim()) return alert(label("State is required.", "Estado es requerido."));
      if (!String(d.resService?.zip || "").trim()) return alert(label("ZIP is required.", "ZIP es requerido."));
    }

    const id = String(d.id || "").trim() || buildId();
    const now = Date.now();

    // normalize booleans
    const nextItem = { ...d, id, updatedAt: now };

    // Enforce billing address behavior
    if (type === "commercial") {
      if (nextItem.billSameAsJob) nextItem.billing = { ...nextItem.jobsite };
    } else {
      if (nextItem.resBillingSame) nextItem.resBilling = { ...nextItem.resService };
    }

    const next = Array.isArray(list) ? [...list] : [];
    const idx = next.findIndex((x) => String(x?.id) === String(id));
    if (idx >= 0) next[idx] = { ...next[idx], ...nextItem };
    else next.unshift(nextItem);

    // sort recently used
    next.sort((a, b) => (Number(b?.lastUsed) || 0) - (Number(a?.lastUsed) || 0));
    persistCustomers(next);

    if (typeof setCustomers === "function") setCustomers(next);
    else setLocalCustomers(next);

    setMode("list");
  }

  function del(id) {
    const sid = String(id || "");
    const target = (Array.isArray(list) ? list : []).find((c) => String(c?.id || "") === sid);
    const nm = target ? displayName(target) : sid;
    const ok = window.confirm(label(`Delete customer: ${nm}? This cannot be undone.`, `¿Eliminar cliente: ${nm}? Esto no se puede deshacer.`));
    if (!ok) return;
    const next = (Array.isArray(list) ? list : []).filter((c) => String(c?.id || "") !== sid);
    persistCustomers(next);
    if (typeof setCustomers === "function") setCustomers(next);
    else setLocalCustomers(next);
    if (String(selectedCustomerId || "") === sid && typeof setSelectedCustomerId === "function") setSelectedCustomerId("");
  }

  function useCustomer(c) {
    const id = String(c?.id || "");
    const next = (Array.isArray(list) ? [...list] : []).map((x) => (String(x?.id) === id ? { ...x, lastUsed: Date.now() } : x));
    persistCustomers(next);
    if (typeof setCustomers === "function") setCustomers(next);
    else setLocalCustomers(next);

    if (typeof setSelectedCustomerId === "function") setSelectedCustomerId(id);

    if (typeof onDone === "function") onDone({ id, customer: c });
  }

  const editorTitle = mode === "edit" ? label("Customer", "Cliente") : label("Customers", "Clientes");

  return (
    <section className="pe-section">
      <div className="pe-section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>{editorTitle}</div>
        {mode === "list" ? (
          <button className="pe-btn" type="button" onClick={() => startNew("commercial")}>
            {label("Create", "Crear")}
          </button>
        ) : (
          <button className="pe-btn pe-btn-ghost" type="button" onClick={() => setMode("list")}>
            {label("Back", "Atrás")}
          </button>
        )}
      </div>

      {mode === "list" ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ ...cardBaseStyle, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                className="pe-input"
                placeholder={label("Search name, phone, email, PO, address…", "Buscar nombre, teléfono, correo, PO, dirección…")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ flex: "1 1 280px" }}
              />
</div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ ...cardBaseStyle, textAlign: "center", padding: 18 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{label("No saved customers", "Sin clientes guardados")}</div>
              <div style={{ fontSize: 13.5, opacity: 0.8, marginBottom: 12 }}>
                {label("Create one to attach to estimates and invoices.", "Crea uno para adjuntarlo a estimaciones y facturas.")}
              </div>
              <button className="pe-btn" type="button" onClick={() => startNew("commercial")}>
                {label("Create Customer", "Crear Cliente")}
              </button>
            </div>
          ) : (
            filtered.map((c) => {
              const id = String(c?.id || "");
              const active = String(selectedCustomerId || "") && String(selectedCustomerId) === id;

              return (
                <div key={id || Math.random()} style={{ ...cardBaseStyle, ...(active ? cardActiveStyle : null), display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: 6, minWidth: 240, flex: "1 1 320px" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: 0.2 }}>{displayName(c)}</div>
                        <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>
                          {String(c?.type || "residential") === "commercial" ? label("Commercial", "Comercial") : label("Residential", "Residencial")}
                        </div>
                        {active ? <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>{label("Selected", "Seleccionado")}</div> : null}
                      </div>

                      {contactLine(c) ? <TextLine>{contactLine(c)}</TextLine> : null}
                      {phoneEmailLine(c) ? <TextLine>{phoneEmailLine(c)}</TextLine> : null}
                      {mainAddressText(c) ? <TextLine>{mainAddressText(c)}</TextLine> : null}
                    </div>

                    <div style={{ display: "grid", gap: 8, minWidth: 220, justifyItems: "stretch" }}>
                      <button className="pe-btn" type="button" onClick={() => useCustomer(c)} style={{ width: "100%" }}>
                        {label("Use", "Usar")}
                      </button>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <button className="pe-btn pe-btn-ghost" type="button" onClick={() => startEdit(c)} style={{ width: "100%" }}>
                          {label("Edit", "Editar")}
                        </button>
                        <button className="pe-btn pe-btn-ghost" type="button" onClick={() => del(c?.id)} style={{ width: "100%" }}>
                          {label("Delete", "Eliminar")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ ...cardBaseStyle, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <FieldLabel>{label("Customer Type", "Tipo de cliente")}</FieldLabel>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
  type="button"
  onClick={() => setDraft((d) => ({ ...emptyDraft("residential"), ...d, type: "residential" }))}
  className="pe-btn"
  style={{
    flex: 1,
    cursor: "pointer",
    opacity: (draft.type || "commercial") === "residential" ? 1 : 0.75,
    background: (draft.type || "commercial") === "residential" ? "rgba(255,255,255,0.10)" : "transparent",
    border: (draft.type || "commercial") === "residential" ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(255,255,255,0.10)",
  }}
>
  {label("Residential", "Residencial")}
</button>

<button
  type="button"
  onClick={() => setDraft((d) => ({ ...emptyDraft("commercial"), ...d, type: "commercial" }))}
  className="pe-btn"
  style={{
    flex: 1,
    cursor: "pointer",
    opacity: (draft.type || "commercial") === "commercial" ? 1 : 0.75,
    background: (draft.type || "commercial") === "commercial" ? "rgba(255,255,255,0.10)" : "transparent",
    border: (draft.type || "commercial") === "commercial" ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(255,255,255,0.10)",
  }}
>
  {label("Commercial", "Comercial")}
</button>
</div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button className="pe-btn pe-btn-ghost" type="button" onClick={() => setMode("list")}>
                  {label("Cancel", "Cancelar")}
                </button>
                <button className="pe-btn" type="button" onClick={saveDraft}>
                  {label("Save", "Guardar")}
                </button>
              </div>
            </div>

            {(draft.type || "residential") === "commercial" ? (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ ...cardBaseStyle, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ fontWeight: 950 }}>{label("Company Information", "Información de la compañía")}</div>
                  </div>

                  
                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      <div style={twoCol}>
                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("Company Name *", "Nombre de la compañía *")}</FieldLabel>
                          <input className="pe-input" value={draft.companyName} onChange={(e) => setDraft((d) => ({ ...d, companyName: e.target.value }))} />
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("Primary Contact *", "Contacto principal *")}</FieldLabel>
                          <input className="pe-input" value={draft.contactName} onChange={(e) => setDraft((d) => ({ ...d, contactName: e.target.value }))} />
                        </div>

                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("Contact Title", "Puesto")}</FieldLabel>
                          <input className="pe-input" value={draft.contactTitle} onChange={(e) => setDraft((d) => ({ ...d, contactTitle: e.target.value }))} />
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("Phone", "Teléfono")}</FieldLabel>
                          <input className="pe-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 555-5555" value={draft.comPhone} onChange={(e) => setDraft((d) => ({ ...d, comPhone: formatPhoneUS(e.target.value) }))} />
                        </div>

                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("Primary Email", "Correo")}</FieldLabel>
                          <input className="pe-input" type="email" inputMode="email" autoComplete="email" placeholder="name@company.com" value={draft.comEmail} onChange={(e) => setDraft((d) => ({ ...d, comEmail: e.target.value }))} />
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("AP Email", "Correo de Cuentas por Pagar")}</FieldLabel>
                          <input className="pe-input" type="email" inputMode="email" autoComplete="email" placeholder="ap@company.com" value={draft.apEmail} onChange={(e) => setDraft((d) => ({ ...d, apEmail: e.target.value }))} />
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                        <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                          <input type="checkbox" checked={Boolean(draft.poRequired)} onChange={(e) => setDraft((d) => ({ ...d, poRequired: e.target.checked }))} />
                          <span style={{ fontSize: 13, fontWeight: 900, opacity: 0.9 }}>{label("PO Required", "PO Requerido")}</span>
                        </label>
                      </div>
                    </div>
                </div>

                <div style={{ ...cardBaseStyle, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ fontWeight: 950 }}>{label("Jobsite & Billing", "Sitio de trabajo y facturación")}</div>
                  </div>

                  
                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      <div style={{ fontWeight: 900, opacity: 0.85 }}>{label("Jobsite Address", "Dirección del sitio")}</div>
                      <div style={twoCol}>
                        <div style={{ display: "grid", gap: 6, ...fullRow }}>
                          <FieldLabel>{label("Street *", "Calle *")}</FieldLabel>
                          <input className="pe-input" type="text" autoComplete="street-address" value={draft.jobsite.street} onChange={(e) => setDraft((d) => ({ ...d, jobsite: { ...d.jobsite, street: e.target.value } }))} />
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("City *", "Ciudad *")}</FieldLabel>
                          <input className="pe-input" type="text" autoComplete="address-level2" value={draft.jobsite.city} onChange={(e) => setDraft((d) => ({ ...d, jobsite: { ...d.jobsite, city: e.target.value } }))} />
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("State *", "Estado *")}</FieldLabel>
                          <StateSelect value={draft.jobsite.state} onChange={(e) => setDraft((d) => ({ ...d, jobsite: { ...d.jobsite, state: e.target.value } }))} />
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("ZIP *", "ZIP *")}</FieldLabel>
                          <input className="pe-input" type="text" inputMode="numeric" autoComplete="postal-code" placeholder="85001" value={draft.jobsite.zip} onChange={(e) => setDraft((d) => ({ ...d, jobsite: { ...d.jobsite, zip: formatZipUS(e.target.value) } }))} />
                        </div>
                      </div>

                      <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(draft.billSameAsJob)} onChange={(e) => setDraft((d) => ({ ...d, billSameAsJob: e.target.checked }))} />
                        <span style={{ fontSize: 13, fontWeight: 900, opacity: 0.9 }}>{label("Billing same as Jobsite", "Facturación igual al sitio")}</span>
                      </label>

                      {!draft.billSameAsJob ? (
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ fontWeight: 900, opacity: 0.85 }}>{label("Billing Address", "Dirección de facturación")}</div>
                          <div style={twoCol}>
                            <div style={{ display: "grid", gap: 6, ...fullRow }}>
                              <FieldLabel>{label("Street", "Calle")}</FieldLabel>
                              <input className="pe-input" type="text" autoComplete="street-address" value={draft.billing.street} onChange={(e) => setDraft((d) => ({ ...d, billing: { ...d.billing, street: e.target.value } }))} />
                            </div>
                            <div style={{ display: "grid", gap: 6 }}>
                              <FieldLabel>{label("City", "Ciudad")}</FieldLabel>
                              <input className="pe-input" type="text" autoComplete="address-level2" value={draft.billing.city} onChange={(e) => setDraft((d) => ({ ...d, billing: { ...d.billing, city: e.target.value } }))} />
                            </div>
                            <div style={{ display: "grid", gap: 6 }}>
                              <FieldLabel>{label("State", "Estado")}</FieldLabel>
                              <StateSelect value={draft.billing.state} onChange={(e) => setDraft((d) => ({ ...d, billing: { ...d.billing, state: e.target.value } }))} placeholder={label("State", "Estado")} />
                            </div>
                            <div style={{ display: "grid", gap: 6 }}>
                              <FieldLabel>{label("ZIP", "ZIP")}</FieldLabel>
                              <input className="pe-input" type="text" inputMode="numeric" autoComplete="postal-code" placeholder="85001" value={draft.billing.zip} onChange={(e) => setDraft((d) => ({ ...d, billing: { ...d.billing, zip: formatZipUS(e.target.value) } }))} />
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ ...cardBaseStyle, padding: 12 }}>
                  <div style={{ fontWeight: 950, marginBottom: 10 }}>{label("Residential Contact", "Contacto residencial")}</div>
                  <div style={twoCol}>
                    <div style={{ display: "grid", gap: 6, ...fullRow }}>
                      <FieldLabel>{label("Full Name *", "Nombre completo *")}</FieldLabel>
                      <input className="pe-input" value={draft.fullName} onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))} />
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <FieldLabel>{label("Phone", "Teléfono")}</FieldLabel>
                      <input className="pe-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 555-5555" value={draft.resPhone} onChange={(e) => setDraft((d) => ({ ...d, resPhone: formatPhoneUS(e.target.value) }))} />
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <FieldLabel>{label("Email", "Correo")}</FieldLabel>
                      <input className="pe-input" type="email" inputMode="email" autoComplete="email" placeholder="name@email.com" value={draft.resEmail} onChange={(e) => setDraft((d) => ({ ...d, resEmail: e.target.value }))} />
                    </div>
                  </div>
                </div>

                <div style={{ ...cardBaseStyle, padding: 12 }}>
                  <div style={{ fontWeight: 950, marginBottom: 10 }}>{label("Service Address", "Dirección del servicio")}</div>
                  <div style={twoCol}>
                    <div style={{ display: "grid", gap: 6, ...fullRow }}>
                      <FieldLabel>{label("Street *", "Calle *")}</FieldLabel>
                      <input className="pe-input" type="text" autoComplete="street-address" value={draft.resService.street} onChange={(e) => setDraft((d) => ({ ...d, resService: { ...d.resService, street: e.target.value } }))} />
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <FieldLabel>{label("City *", "Ciudad *")}</FieldLabel>
                      <input className="pe-input" type="text" autoComplete="address-level2" value={draft.resService.city} onChange={(e) => setDraft((d) => ({ ...d, resService: { ...d.resService, city: e.target.value } }))} />
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <FieldLabel>{label("State *", "Estado *")}</FieldLabel>
                      <StateSelect value={draft.resService.state} onChange={(e) => setDraft((d) => ({ ...d, resService: { ...d.resService, state: e.target.value } }))} />
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <FieldLabel>{label("ZIP *", "ZIP *")}</FieldLabel>
                      <input className="pe-input" type="text" inputMode="numeric" autoComplete="postal-code" placeholder="85001" value={draft.resService.zip} onChange={(e) => setDraft((d) => ({ ...d, resService: { ...d.resService, zip: formatZipUS(e.target.value) } }))} />
                    </div>
                  </div>

                  <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer", marginTop: 10 }}>
                    <input type="checkbox" checked={Boolean(draft.resBillingSame)} onChange={(e) => setDraft((d) => ({ ...d, resBillingSame: e.target.checked }))} />
                    <span style={{ fontSize: 13, fontWeight: 900, opacity: 0.9 }}>{label("Billing same as Service", "Facturación igual al servicio")}</span>
                  </label>

                  {!draft.resBillingSame ? (
                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      <div style={{ fontWeight: 900, opacity: 0.85 }}>{label("Billing Address", "Dirección de facturación")}</div>
                      <div style={twoCol}>
                        <div style={{ display: "grid", gap: 6, ...fullRow }}>
                          <FieldLabel>{label("Street", "Calle")}</FieldLabel>
                          <input className="pe-input" type="text" autoComplete="street-address" value={draft.resBilling.street} onChange={(e) => setDraft((d) => ({ ...d, resBilling: { ...d.resBilling, street: e.target.value } }))} />
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("City", "Ciudad")}</FieldLabel>
                          <input className="pe-input" type="text" autoComplete="address-level2" value={draft.resBilling.city} onChange={(e) => setDraft((d) => ({ ...d, resBilling: { ...d.resBilling, city: e.target.value } }))} />
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("State", "Estado")}</FieldLabel>
                          <StateSelect value={draft.resBilling.state} onChange={(e) => setDraft((d) => ({ ...d, resBilling: { ...d.resBilling, state: e.target.value } }))} placeholder={label("State", "Estado")} />
                        </div>
                        <div style={{ display: "grid", gap: 6 }}>
                          <FieldLabel>{label("ZIP", "ZIP")}</FieldLabel>
                          <input className="pe-input" type="text" inputMode="numeric" autoComplete="postal-code" placeholder="85001" value={draft.resBilling.zip} onChange={(e) => setDraft((d) => ({ ...d, resBilling: { ...d.resBilling, zip: formatZipUS(e.target.value) } }))} />
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
