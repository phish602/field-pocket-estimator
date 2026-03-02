// @ts-nocheck
/* eslint-disable */

export function isCompanyProfileComplete(profile) {
  const p = profile || {};
  return Boolean(
    String(p.companyName || "").trim()
    && String(p.phone || "").trim()
    && String(p.email || "").trim()
    && String(p.address || "").trim()
  );
}
