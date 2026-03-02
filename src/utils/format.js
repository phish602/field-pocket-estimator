// @ts-nocheck
/* eslint-disable */

export function normalizePercentInput(v) {
  const cleaned = String(v ?? "").replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  const normalized = dot === -1 ? cleaned : `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, "")}`;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return "";
  const clamped = Math.max(0, Math.min(200, n));
  return String(clamped);
}

export function normalizeMultiplierInput(v) {
  const cleaned = String(v ?? "").replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  const normalized = dot === -1 ? cleaned : `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, "")}`;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return "1";
  const clamped = Math.max(0.25, Math.min(5, n));
  return String(clamped);
}

export function normalizeMoneyInput(v) {
  const cleaned = String(v ?? "").replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  const normalized = dot === -1 ? cleaned : `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, "")}`;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return "";
  return String(Math.max(0, n));
}

export function normalizeHoursInput(v) {
  const cleaned = String(v ?? "").replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  const normalized = dot === -1 ? cleaned : `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, "")}`;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return "";
  return String(Math.max(0, n));
}

export function formatDateMMDDYYYY(iso) {
  const s = String(iso || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  try {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    }
  } catch {}
  return s;
}

export function createMoneyFormatter(locale = "en-US", currency = "USD") {
  return new Intl.NumberFormat(locale, { style: "currency", currency });
}
