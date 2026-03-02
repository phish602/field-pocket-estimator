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

export function detectDataUrlType(dataUrl) {
  const s = String(dataUrl || "");
  if (s.includes("image/png")) return "PNG";
  if (s.includes("image/jpeg") || s.includes("image/jpg")) return "JPEG";
  if (s.includes("image/webp")) return "WEBP";
  return "PNG";
}
