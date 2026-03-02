// @ts-nocheck
/* eslint-disable */

export const NET_TERMS = {
  DUE_UPON_RECEIPT: "DUE_UPON_RECEIPT",
  NET_15: "NET_15",
  NET_30: "NET_30",
  NET_CUSTOM: "NET_CUSTOM",
};

const VALID_TYPES = new Set([
  NET_TERMS.DUE_UPON_RECEIPT,
  NET_TERMS.NET_15,
  NET_TERMS.NET_30,
  NET_TERMS.NET_CUSTOM,
]);

function toNum(v) {
  const n = typeof v === "number" ? v : parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : NaN;
}

function parseISODate(dateStr) {
  const s = String(dateStr || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

function toISODate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function normalizeNetTermsType(type) {
  const t = String(type || "").trim();
  return VALID_TYPES.has(t) ? t : "";
}

export function getNetTermsDays(customerLike) {
  const type = normalizeNetTermsType(customerLike?.netTermsType);
  if (!type) return null;
  if (type === NET_TERMS.DUE_UPON_RECEIPT) return 0;
  if (type === NET_TERMS.NET_15) return 15;
  if (type === NET_TERMS.NET_30) return 30;
  const custom = toNum(customerLike?.netTermsDays);
  if (!Number.isFinite(custom)) return null;
  if (custom < 0 || custom > 365) return null;
  return custom;
}

export function addDaysToISODate(dateISO, days) {
  const base = parseISODate(dateISO);
  if (!base) return "";
  const d = toNum(days);
  if (!Number.isFinite(d)) return "";
  base.setUTCDate(base.getUTCDate() + d);
  return toISODate(base);
}

export function computeDueDateFromCustomer(issueDateISO, customerLike, fallbackDue = "") {
  const days = getNetTermsDays(customerLike);
  if (days === null) return String(fallbackDue || "").trim();
  const due = addDaysToISODate(issueDateISO, days);
  if (!due) return String(fallbackDue || "").trim();
  return due;
}

export function getNetTermsLabel(customerLike) {
  const type = normalizeNetTermsType(customerLike?.netTermsType);
  if (!type) return "";
  if (type === NET_TERMS.DUE_UPON_RECEIPT) return "Due upon receipt";
  if (type === NET_TERMS.NET_15) return "Net 15";
  if (type === NET_TERMS.NET_30) return "Net 30";
  const days = getNetTermsDays(customerLike);
  if (days === null) return "Net custom";
  return `Net ${days}`;
}

