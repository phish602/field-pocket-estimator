// @ts-nocheck
/* eslint-disable */

import { sanitizePhoneDigits } from "./sanitize";
import { composeAddressFull, loadCompanyProfile, normalizeCompanyProfile } from "./storage";

function hasValidPhone(phone) {
  const digits = sanitizePhoneDigits(phone, 11);
  return digits.length === 10 || digits.length === 11;
}

export function isCompanyProfileComplete(profile) {
  const p = normalizeCompanyProfile(profile || {});
  return Boolean(
    String(p.companyName || "").trim()
    && hasValidPhone(p.phone)
    && String(p.addressLine1 || "").trim()
    && String(p.city || "").trim()
    && String(p.state || "").trim()
    && String(p.zip || "").trim()
  );
}

export function requireCompanyProfile(options = {}) {
  const {
    profile,
    onAllow,
    onBlock,
    onRequireProfile,
    confirmFn,
    message = "User Profile required. Open User Profile?",
  } = options;

  const currentProfile = profile ? normalizeCompanyProfile(profile) : loadCompanyProfile();
  if (isCompanyProfileComplete(currentProfile)) {
    try {
      if (typeof onAllow === "function") onAllow(currentProfile);
    } catch {}
    return { allowed: true, profile: currentProfile };
  }

  let shouldOpen = false;
  try {
    const ask = typeof confirmFn === "function"
      ? confirmFn
      : (typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm : null);
    shouldOpen = ask ? !!ask(message) : false;
  } catch {
    shouldOpen = false;
  }

  if (shouldOpen && typeof onRequireProfile === "function") {
    try { onRequireProfile(); } catch {}
  }

  try {
    if (typeof onBlock === "function") {
      onBlock({
        profile: currentProfile,
        accepted: shouldOpen,
      });
    }
  } catch {}

  return {
    allowed: false,
    profile: { ...currentProfile, address: composeAddressFull(currentProfile) },
    prompted: true,
    accepted: shouldOpen,
  };
}
