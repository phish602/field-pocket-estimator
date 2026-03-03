// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";

export const BUILD_TAG = "ESTIPAID_ESTIMATOR_V1_SPLIT";
export const STORAGE_KEY = STORAGE_KEYS.ESTIMATOR_STATE;

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export const DEFAULT_STATE = {
  ui: {
    docType: "estimate",
    materialsMode: "blanket",
  },

  customer: {
    name: "",
    attn: "",
    phone: "",
    email: "",
    netTermsType: "",
    netTermsDays: "",
    address: "",
    billingDiff: false,
    billingAddress: "",
    projectName: "",
    projectNumber: "",
    projectAddress: "",
    projectSameAsCustomer: true,
  },

  job: {
    date: todayISO(),
    location: "",
    poNumber: "",
    due: "",
    docNumber: "",
  },

  scopeNotes: "",

  tradeInsert: { key: "", text: "" },

  labor: {
    hazardPct: 0,
    riskPct: 0,
    multiplier: 1,
    lines: [{ id: "l1", role: "", hours: "", rate: "", trueRateInternal: "" }],
  },

  materials: {
    blanketCost: "",
    blanketInternalCost: "",
    materialsBlanketDescription: "",
    markupPct: 0,
    items: [{ id: "m1", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" }],
  },

  additionalNotes: "",

  meta: {
    lastSavedAt: 0,
  },
};
