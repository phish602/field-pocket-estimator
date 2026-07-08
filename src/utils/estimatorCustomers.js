import { STORAGE_KEYS } from "../constants/storageKeys";

const CUSTOMER_RECENTS_KEY = STORAGE_KEYS.CUSTOMER_RECENTS;

export function readCustomerRecents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOMER_RECENTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addToCustomerRecents(id) {
  try {
    const prev = readCustomerRecents();
    const next = [id, ...prev.filter((r) => r !== id)].slice(0, 8);
    localStorage.setItem(CUSTOMER_RECENTS_KEY, JSON.stringify(next));
  } catch {}
}

export function flattenCustomerForEstimator(c) {
  if (!c) return {};
  const joinAddr = (a) => {
    const street = String(a?.street || "").trim();
    const line2 = [String(a?.city || "").trim(), String(a?.state || "").trim()].filter(Boolean).join(", ");
    const line2Full = [line2, String(a?.zip || "").trim()].filter(Boolean).join(" ");
    return [street, line2Full].filter(Boolean).join("\n");
  };
  const inferredType = String(c?.type || (c?.companyName ? "commercial" : "residential")).toLowerCase();
  if (inferredType === "commercial") {
    const job = c.jobsite || {};
    const bill = c.billSameAsJob ? (c.jobsite || {}) : (c.billing || {});
    return {
      name: String(c.companyName || c.name || "").trim(),
      phone: String(c.comPhone || c.phone || "").trim(),
      email: String(c.comEmail || c.email || "").trim(),
      attn: String(c.contactName || c.attn || "").trim(),
      address: joinAddr(job) || String(c.address || "").trim(),
      billingAddress: joinAddr(bill) || String(c.billingAddress || "").trim(),
    };
  }
  const svc = c.resService || {};
  const bill = c.resBillingSame ? (c.resService || {}) : (c.resBilling || {});
  return {
    name: String(c.fullName || c.name || c.companyName || "").trim(),
    phone: String(c.resPhone || c.phone || "").trim(),
    email: String(c.resEmail || c.email || c.comEmail || "").trim(),
    attn: String(c.attn || "").trim(),
    address: joinAddr(svc) || String(c.address || "").trim(),
    billingAddress: joinAddr(bill) || String(c.billingAddress || "").trim(),
  };
}

export function buildSelectedCustomerProfileFromDraft(customerState, customerId = "", customerList = []) {
  const sid = String(customerId || customerState?.id || "").trim();
  if (!sid) return null;

  const matchedCustomer = Array.isArray(customerList)
    ? customerList.find((item) => String(item?.id || "").trim() === sid)
    : null;

  if (matchedCustomer) {
    return {
      ...matchedCustomer,
      ...flattenCustomerForEstimator(matchedCustomer),
      id: sid,
    };
  }

  const name = String(customerState?.name || "").trim();
  return {
    id: sid,
    name,
    fullName: name,
    attn: String(customerState?.attn || "").trim(),
    phone: String(customerState?.phone || "").trim(),
    email: String(customerState?.email || "").trim(),
    netTermsType: String(customerState?.netTermsType || "").trim(),
    netTermsDays: customerState?.netTermsDays === null || customerState?.netTermsDays === undefined
      ? ""
      : String(customerState?.netTermsDays),
    address: String(customerState?.address || "").trim(),
    billingAddress: String(customerState?.billingAddress || "").trim(),
  };
}
