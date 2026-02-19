// @ts-nocheck
/* eslint-disable */
import { useMemo, useRef, useState } from "react";

const CUSTOMERS_KEY = "field-pocket-customers-v1";

function persistCustomers(list) {
  try {
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  } catch {
    // ignore
  }
}

function nowTs() {
  return Date.now();
}

function normKey(s) {
  return String(s || "").trim().toLowerCase();
}


function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
  const parts = [];
  if (digits.length > 0) parts.push("(" + digits.slice(0, 3));
  if (digits.length >= 4) parts[0] += ") ";
  if (digits.length >= 4) parts.push(digits.slice(3, 6));
  if (digits.length >= 7) parts.push("-" + digits.slice(6, 10));
  return parts.join("");
}

function buildId(prefix) {
  return `${prefix}_${nowTs()}_${Math.random().toString(16).slice(2)}`;
}

function upsert(list, data) {
  const next = Array.isArray(list) ? [...list] : [];
  const name = String(data?.name || "").trim();
  if (!name) return next;

  const dataId = String(data?.id || "").trim();
  const idxById = dataId ? next.findIndex((c) => String(c?.id) === dataId) : -1;
  const idxByName = next.findIndex((c) => normKey(c?.name) === normKey(name));
  const idx = idxById >= 0 ? idxById : idxByName;

  const payload = {
    id: idx >= 0 ? (next[idx]?.id || dataId || buildId("c")) : (dataId || buildId("c")),
    name,
    company: String(data?.company || "").trim(),
    attn: String(data?.attn || "").trim(),
    phone: String(data?.phone || "").trim(),
    email: String(data?.email || "").trim(),
    address: String(data?.address || "").trim(),
    billingDiff: Boolean(data?.billingDiff),
    billingAddress: String(data?.billingAddress || "").trim(),
    termsDays: Number.isFinite(Number(data?.termsDays)) ? Number(data?.termsDays) : 0,
    lastUsed: Number(data?.lastUsed) || nowTs(),
  };

  if (idx >= 0) next[idx] = { ...next[idx], ...payload };
  else next.unshift(payload);

  next.sort((a, b) => (Number(b?.lastUsed) || 0) - (Number(a?.lastUsed) || 0));
  return next.slice(0, 250);
}

function removeById(list, id) {
  const sId = String(id || "");
  return (Array.isArray(list) ? list : []).filter((c) => String(c?.id || "") !== sId);
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 12.5, opacity: 0.82, letterSpacing: 0.2 }}>{children}</div>;
}

function TextLine({ children }) {
  return <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.25 }}>{children}</div>;
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
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("list"); // "list" | "edit"
  const [draft, setDraft] = useState({
    id: "",
    name: "",
    company: "",
    attn: "",
    phone: "",
    email: "",
    address: "",
    billingDiff: false,
    billingAddress: "",
    termsDays: 0,
  });

  // search prediction / dropdown
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSug, setActiveSug] = useState(-1);
  const searchWrapRef = useRef(null);
  const searchInputRef = useRef(null);

  const list = useMemo(() => (Array.isArray(customers) ? customers : []), [customers]);

  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return list;
    return list.filter((c) => {
      const name = String(c?.name || "").toLowerCase();
      const company = String(c?.company || "").toLowerCase();
      const email = String(c?.email || "").toLowerCase();
      const phone = String(c?.phone || "").toLowerCase();
      return name.includes(s) || company.includes(s) || email.includes(s) || phone.includes(s);
    });
  }, [list, q]);

  const suggestions = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return [];
    // prioritize "startsWith name/company" then includes
    const scored = (Array.isArray(list) ? list : [])
      .map((c) => {
        const name = String(c?.name || "");
        const company = String(c?.company || "");
        const hay = (name + " " + company + " " + String(c?.email || "") + " " + String(c?.phone || "")).toLowerCase();
        if (!hay.includes(s)) return null;

        const n = name.toLowerCase();
        const co = company.toLowerCase();

        let score = 0;
        if (n.startsWith(s)) score += 40;
        if (co.startsWith(s)) score += 25;
        if (n.includes(s)) score += 10;
        if (co.includes(s)) score += 6;
        if (String(c?.email || "").toLowerCase().includes(s)) score += 2;
        if (String(c?.phone || "").toLowerCase().includes(s)) score += 1;

        // prefer recently used
        score += Math.min(10, Math.floor((Number(c?.lastUsed) || 0) / 1e13));

        return { c, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.c);

    return scored;
  }, [list, q]);

  const label = (en, es) => (lang === "es" ? es : en);

  const startNew = () => {
    setDraft({
      id: "",
      name: "",
      company: "",
      attn: "",
      phone: "",
      email: "",
      address: "",
      billingDiff: false,
      billingAddress: "",
      termsDays: 0,
    });
    setMode("edit");
  };

  const startEdit = (c) => {
    setDraft({
      id: String(c?.id || ""),
      name: String(c?.name || ""),
      company: String(c?.company || ""),
      attn: String(c?.attn || ""),
      phone: String(c?.phone || ""),
      email: String(c?.email || ""),
      address: String(c?.address || ""),
      billingDiff: Boolean(c?.billingDiff),
      billingAddress: String(c?.billingAddress || ""),
      termsDays: Number.isFinite(Number(c?.termsDays)) ? Number(c?.termsDays) : 0,
    });
    setMode("edit");
  };

  const pick = (id) => {
    if (typeof setSelectedCustomerId === "function") setSelectedCustomerId(String(id || ""));
    if (typeof onDone === "function") onDone();
  };

  const del = (id) => {
    const ok = window.confirm(lang === "es" ? "¿Eliminar este cliente?" : "Delete this customer?");
    if (!ok) return;
    const next = removeById(list, id);
    if (typeof setCustomers === "function") setCustomers(next);
    persistCustomers(next);
    if (String(selectedCustomerId || "") === String(id || "")) {
      if (typeof setSelectedCustomerId === "function") setSelectedCustomerId("");
    }
  };

  const save = () => {
    const name = String(draft?.name || "").trim();
    if (!name) {
      window.alert(lang === "es" ? "Nombre requerido." : "Name is required.");
      return;
    }

    const ensuredId = String(draft?.id || "").trim() || buildId("c");
    const payload = { ...draft, id: ensuredId, name, lastUsed: nowTs() };

    const next = upsert(list, payload);
    if (typeof setCustomers === "function") setCustomers(next);
    persistCustomers(next);

    const saved =
      next.find((c) => String(c?.id) === String(ensuredId)) ||
      next.find((c) => normKey(c?.name) === normKey(name));

    if (saved?.id && typeof setSelectedCustomerId === "function") setSelectedCustomerId(String(saved.id));
    setMode("list");
  };

  const headerWrapStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  };

  const headerActionsStyle = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
  };

  const cardBaseStyle = {
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.12)",
    boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
  };

  const cardActiveStyle = {
    border: "1px solid rgba(255,255,255,0.28)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.26)",
  };

  const twoColStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 10,
    alignItems: "start",
  };

  const fullRowStyle = {
    gridColumn: "1 / -1",
  };

  const compactInputStyle = {
    minHeight: 44,
  };

  const textAreaStyle = {
    minHeight: 86,
    resize: "vertical",
  };

  const closeSearchDropdown = () => {
    setSearchOpen(false);
    setActiveSug(-1);
  };

  const acceptSuggestion = (c) => {
    if (!c) return;
    setQ(String(c?.name || ""));
    closeSearchDropdown();
    // optional: auto-select customer when chosen from dropdown
    if (c?.id) {
      if (typeof setSelectedCustomerId === "function") setSelectedCustomerId(String(c.id));
    }
    // keep focus for quick edit/enter
    try {
      searchInputRef.current && searchInputRef.current.focus && searchInputRef.current.focus();
    } catch {
      // ignore
    }
  };

  const onSearchKeyDown = (e) => {
    if (!searchOpen || suggestions.length === 0) {
      if (e.key === "Escape") closeSearchDropdown();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSug((i) => {
        const next = i + 1;
        return next >= suggestions.length ? 0 : next;
      });
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSug((i) => {
        const next = i - 1;
        return next < 0 ? suggestions.length - 1 : next;
      });
      return;
    }

    if (e.key === "Enter") {
      if (activeSug >= 0 && activeSug < suggestions.length) {
        e.preventDefault();
        acceptSuggestion(suggestions[activeSug]);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchDropdown();
      return;
    }
  };

  if (mode === "edit") {
    const isEditing = !!String(draft?.id || "").trim();

    return (
      <section className="pe-section">
        <div className="pe-section-title" style={headerWrapStyle}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <div>{label(isEditing ? "Edit Customer" : "New Customer", isEditing ? "Editar Cliente" : "Nuevo Cliente")}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{label("Required fields marked *", "Campos requeridos marcados *")}</div>
          </div>
          <div style={headerActionsStyle} />
        </div>

        <div className="pe-grid" style={{ gap: 12 }}>
          <div style={cardBaseStyle}>
            <div style={twoColStyle}>
              <div style={{ display: "grid", gap: 6 }}>
                <FieldLabel>{label("Name *", "Nombre *")}</FieldLabel>
                <input
                  className="pe-input"
                  style={compactInputStyle}
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder={label("e.g., John Smith", "Ej: Juan Pérez")}
                />
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <FieldLabel>{label("Company", "Compañía")}</FieldLabel>
                <input
                  className="pe-input"
                  style={compactInputStyle}
                  value={draft.company}
                  onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))}
                  placeholder={label("e.g., ABC Construction", "Ej: Construcciones ABC")}
                />
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <FieldLabel>{label("Attn", "Atención")}</FieldLabel>
                <input
                  className="pe-input"
                  style={compactInputStyle}
                  value={draft.attn}
                  onChange={(e) => setDraft((d) => ({ ...d, attn: e.target.value }))}
                  placeholder={label("e.g., Project Manager", "Ej: Gerente de proyecto")}
                />
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <FieldLabel>{label("Phone", "Teléfono")}</FieldLabel>
                <input
                  className="pe-input"
                  style={compactInputStyle}
                  type="tel"
                  inputMode="tel"
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: formatPhone(e.target.value) }))}
                  placeholder={label("e.g., (602) 555-0123", "Ej: (602) 555-0123")}
                />
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <FieldLabel>{label("Email", "Correo")}</FieldLabel>
                <input
                  className="pe-input"
                  style={compactInputStyle}
                  type="email"
                  inputMode="email"
                  pattern="^[^\s@]+@[^\s@]+\.[^\s@]+$"
                  value={draft.email}
                  onChange={(e) => setDraft((d) => ({ ...d, email: String(e.target.value || "").toLowerCase() }))}
                  placeholder={label("e.g., name@company.com", "Ej: nombre@empresa.com")}
                />
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <FieldLabel>{label("Terms (days)", "Términos (días)")}</FieldLabel>
                <input
                  className="pe-input"
                  style={compactInputStyle}
                  inputMode="numeric"
                  value={String(draft.termsDays ?? 0)}
                  onChange={(e) => setDraft((d) => ({ ...d, termsDays: Number(e.target.value || 0) }))}
                  placeholder={label("e.g., 30", "Ej: 30")}
                />
              </div>

              <div style={{ display: "grid", gap: 6, ...fullRowStyle }}>
                <FieldLabel>{label("Address", "Dirección")}</FieldLabel>
                <textarea
                  className="pe-input"
                  style={textAreaStyle}
                  value={draft.address}
                  onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value.replace(/\s{2,}/g, " ") }))}
                  placeholder={label("e.g., 123 Main St, Phoenix, AZ 85001", "Ej: 123 Calle Principal, Phoenix, AZ 85001")}
                />
              </div>
            </div>
          </div>

          <div style={cardBaseStyle}>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={!!draft.billingDiff}
                  onChange={(e) => setDraft((d) => ({ ...d, billingDiff: !!e.target.checked }))}
                />
                <span style={{ fontWeight: 700 }}>{label("Billing address is different", "Dirección de facturación diferente")}</span>
              </label>

              {draft.billingDiff ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <FieldLabel>{label("Billing address", "Dirección de facturación")}</FieldLabel>
                  <textarea
                    className="pe-input"
                    style={textAreaStyle}
                    value={draft.billingAddress}
                    onChange={(e) => setDraft((d) => ({ ...d, billingAddress: e.target.value.replace(/\s{2,}/g, " ") }))}
                    placeholder={label("e.g., PO Box 123, Phoenix, AZ 85001", "Ej: Apartado 123, Phoenix, AZ 85001")}
                  />
                </div>
              ) : (
                <div style={{ fontSize: 13, opacity: 0.78 }}>{label("Uses the same address as above.", "Usa la misma dirección de arriba.")}</div>
              )}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                <button className="pe-btn" type="button" onClick={save}>
                  {label("Save", "Guardar")}
                </button>
                <button className="pe-btn pe-btn-ghost" type="button" onClick={() => setMode("list")}>
                  {label("Cancel", "Cancelar")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="pe-section">
      <div className="pe-section-title" style={headerWrapStyle}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div>{typeof t === "function" ? t("customers") : label("Customers", "Clientes")}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{label(`${filtered.length} shown`, `${filtered.length} mostrados`)}</div>
        </div>
        <div style={headerActionsStyle}>
          <button className="pe-btn" type="button" onClick={startNew}>
            {label("Create New", "Crear Nuevo")}
          </button>
        </div>
      </div>

      <div className="pe-grid" style={{ gap: 12 }}>
        <div style={{ ...cardBaseStyle, padding: 12 }}>
          <div ref={searchWrapRef} style={{ position: "relative", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              ref={searchInputRef}
              className="pe-input"
              style={{ flex: "1 1 260px", minHeight: 44 }}
              placeholder={label("Search customers…", "Buscar clientes…")}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSearchOpen(true);
                setActiveSug(-1);
              }}
              onFocus={() => {
                if (String(q || "").trim()) setSearchOpen(true);
              }}
              onKeyDown={onSearchKeyDown}
              onBlur={() => {
                // allow click on dropdown items
                setTimeout(() => closeSearchDropdown(), 150);
              }}
              autoComplete="off"
            />
            <button
              className="pe-btn pe-btn-ghost"
              type="button"
              onClick={() => {
                setQ("");
                closeSearchDropdown();
              }}
              style={{ minWidth: 110 }}
              disabled={!String(q || "")}
            >
              {label("Clear", "Limpiar")}
            </button>

            {searchOpen && suggestions.length > 0 ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 52,
                  zIndex: 50,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(10, 12, 14, 0.98)",
                  boxShadow: "0 16px 36px rgba(0,0,0,0.35)",
                  overflow: "hidden",
                }}
              >
                {suggestions.map((c, idx) => {
                  const active = idx === activeSug;
                  return (
                    <button
                      key={String(c?.id || idx)}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => acceptSuggestion(c)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        border: "none",
                        background: active ? "rgba(255,255,255,0.08)" : "transparent",
                        color: "inherit",
                        cursor: "pointer",
                        display: "grid",
                        gap: 2,
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900 }}>{c?.name || label("Unnamed", "Sin nombre")}</div>
                        {c?.company ? <div style={{ fontWeight: 700, opacity: 0.78 }}>{"•"} {c.company}</div> : null}
                      </div>
                      <div style={{ fontSize: 12.5, opacity: 0.72 }}>
                        {[c?.email, c?.phone].filter(Boolean).join(" • ")}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {filtered.length === 0 ? (
            <div style={{ ...cardBaseStyle, textAlign: "center", padding: 18 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{label("No saved customers", "Sin clientes guardados")}</div>
              <div style={{ fontSize: 13.5, opacity: 0.8, marginBottom: 12 }}>
                {label("Create one to attach to estimates and invoices.", "Crea uno para adjuntarlo a estimaciones y facturas.")}
              </div>
              <button className="pe-btn" type="button" onClick={startNew}>
                {label("Create Customer", "Crear Cliente")}
              </button>
            </div>
          ) : (
            filtered.map((c) => {
              const id = c?.id;
              const active = String(selectedCustomerId || "") && String(selectedCustomerId) === String(id);

              return (
                <div
                  key={String(id || c?.name || Math.random())}
                  style={{
                    ...cardBaseStyle,
                    ...(active ? cardActiveStyle : null),
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: 6, minWidth: 240, flex: "1 1 320px" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: 0.2 }}>
                          {c?.name || label("Unnamed", "Sin nombre")}
                        </div>
                        {c?.company ? <div style={{ fontWeight: 700, opacity: 0.82 }}>{"•"} {c.company}</div> : null}
                        {active ? <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.85 }}>{label("Selected", "Seleccionado")}</div> : null}
                      </div>

                      <div style={{ display: "grid", gap: 3 }}>
                        {c?.attn ? <TextLine>{c.attn}</TextLine> : null}
                        {c?.email ? <TextLine>{c.email}</TextLine> : null}
                        {c?.phone ? <TextLine>{c.phone}</TextLine> : null}
                        {c?.address ? <TextLine>{c.address}</TextLine> : null}
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 8, minWidth: 220, justifyItems: "stretch" }}>
                      <button className="pe-btn" type="button" onClick={() => pick(id)} style={{ width: "100%" }}>
                        {label("Use", "Usar")}
                      </button>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <button className="pe-btn pe-btn-ghost" type="button" onClick={() => startEdit(c)} style={{ width: "100%" }}>
                          {label("Edit", "Editar")}
                        </button>
                        <button className="pe-btn pe-btn-ghost" type="button" onClick={() => del(id)} style={{ width: "100%" }}>
                          {label("Delete", "Eliminar")}
                        </button>
                      </div>
                    </div>
                  </div>

                  {c?.billingDiff && c?.billingAddress ? (
                    <div style={{ paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.10)" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, opacity: 0.85, marginBottom: 4 }}>
                        {label("Billing Address", "Dirección de facturación")}
                      </div>
                      <div style={{ fontSize: 13, opacity: 0.82, lineHeight: 1.25 }}>{c.billingAddress}</div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
