// @ts-nocheck
/* eslint-disable */

export function sanitizePdfToken(v, fallback = "Draft") {
  const cleaned = String(v || "")
    .trim()
    .replace(/[^\w\-]+/g, "-")
    .replace(/\-+/g, "-")
    .replace(/^\-+|\-+$/g, "");
  return cleaned || fallback;
}

export function sanitizeFilename(v, fallback = "Draft") {
  return sanitizePdfToken(v, fallback);
}

export function sanitizePhoneDigits(v, maxLen = 11) {
  const digits = String(v || "").replace(/\D+/g, "");
  return digits.slice(0, Math.max(1, Number(maxLen) || 11));
}

export function sanitizeZip(v, maxLen = 10) {
  const sanitized = String(v || "").replace(/[^\d-]/g, "");
  return sanitized.slice(0, Math.max(1, Number(maxLen) || 10));
}

export function formatPhoneForDisplay(v) {
  const digits = sanitizePhoneDigits(v, 11);
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7, 11);
    return `+1 (${area}) ${prefix}-${line}`;
  }
  if (digits.length >= 10) {
    const d = digits.slice(0, 10);
    const area = d.slice(0, 3);
    const prefix = d.slice(3, 6);
    const line = d.slice(6, 10);
    return `(${area}) ${prefix}-${line}`;
  }
  return digits;
}

export function detectDataUrlType(dataUrl) {
  const s = String(dataUrl || "");
  if (s.includes("image/png")) return "PNG";
  if (s.includes("image/jpeg") || s.includes("image/jpg")) return "JPEG";
  if (s.includes("image/webp")) return "WEBP";
  return "PNG";
}
