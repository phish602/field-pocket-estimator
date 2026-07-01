// @ts-nocheck
/* eslint-disable */

import { DEFAULT_STATE } from "../estimator/defaultState";
import { computeTotals } from "../estimator/engine";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { appendAuditEvents, createStoredAuditEvent } from "./auditStore";
import {
  backfillProjectCollections,
  createProjectRecord,
  readStoredProjects,
  writeStoredProjects,
} from "./projects";
import {
  INVOICE_STATUSES,
  deriveInvoiceStatus,
  normalizeInvoiceLifecycleRecord,
  normalizeIsoDate,
  normalizeStoredInvoiceStatus,
} from "./invoiceStatus";

export { INVOICE_STATUSES, deriveInvoiceStatus, normalizeStoredInvoiceStatus };

export const INVOICE_TYPES = {
  DEPOSIT: "deposit",
  PROGRESS: "progress",
  FINAL: "final",
  CUSTOM: "custom",
  MANUAL: "manual",
};

export const PAYMENT_STATUSES = {
  UNPAID: "unpaid",
  PARTIAL: "partial",
  PAID: "paid",
  VOID: "void",
};

const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const EPSILON = 0.005;

function readStoredArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function readStoredCustomers() {
  return readStoredArray(STORAGE_KEYS.CUSTOMERS);
}

function deepClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) return value.map((entry) => deepClone(entry));
    if (value && typeof value === "object") {
      const next = {};
      Object.keys(value).forEach((key) => {
        next[key] = deepClone(value[key]);
      });
      return next;
    }
    return value;
  }
}

function asText(value) {
  return String(value || "").trim();
}

function normalizeTextKey(value) {
  return asText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeAdditionalChargeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(Boolean)
    .map((item, index) => ({
      id: asText(item?.id) || `ac_${index}`,
      desc: asText(item?.desc || item?.description || item?.label),
      qty: item?.qty ?? "",
      priceEach: item?.priceEach ?? item?.charge ?? item?.amount ?? "",
    }));
}

export function toCurrencyNumber(value) {
  const next = typeof value === "number"
    ? value
    : parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(next) ? next : 0;
}

export function roundCurrency(value) {
  return Math.round(toCurrencyNumber(value) * 100) / 100;
}

function todayParts(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function todayISO() {
  return todayParts(new Date());
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function resolveMaterialsMode(doc) {
  const explicit = asText(doc?.ui?.materialsMode || doc?.materialsMode).toLowerCase();
  if (explicit === "itemized" || explicit === "blanket") return explicit;
  if (Array.isArray(doc?.materials?.items) && doc.materials.items.length > 0) return "itemized";
  if (Array.isArray(doc?.materialItems) && doc.materialItems.length > 0) return "itemized";
  return "blanket";
}

function toEstimatorState(doc) {
  const laborLines = Array.isArray(doc?.labor?.lines)
    ? doc.labor.lines
    : (Array.isArray(doc?.laborLines) ? doc.laborLines : []);
  const materialItems = Array.isArray(doc?.materials?.items)
    ? doc.materials.items
    : (Array.isArray(doc?.materialItems) ? doc.materialItems : []);
  const additionalChargeItems = Array.isArray(doc?.additionalCharges?.items)
    ? doc.additionalCharges.items
    : (Array.isArray(doc?.additionalChargeItems) ? doc.additionalChargeItems : []);
  const multiplierMode = asText(doc?.multiplierMode).toLowerCase();
  const customMultiplier = toCurrencyNumber(doc?.customMultiplier);
  const presetMultiplier = toCurrencyNumber(doc?.laborMultiplier);
  const directMultiplier = toCurrencyNumber(doc?.labor?.multiplier);
  const multiplier = directMultiplier > 0
    ? directMultiplier
    : (multiplierMode === "custom" ? (customMultiplier || 1) : (presetMultiplier || 1));

  return {
    ui: {
      materialsMode: resolveMaterialsMode(doc),
    },
    labor: {
      hazardPct: toCurrencyNumber(doc?.labor?.hazardPct ?? doc?.hazardPct),
      riskPct: toCurrencyNumber(doc?.labor?.riskPct ?? doc?.riskPct),
      multiplier: multiplier > 0 ? multiplier : 1,
      lines: laborLines.map((line, index) => ({
        id: asText(line?.id) || `labor_${index}`,
        role: asText(line?.role),
        label: asText(line?.label || line?.name),
        qty: Math.max(1, toCurrencyNumber(line?.qty || 1)),
        hours: Math.max(0, toCurrencyNumber(line?.hours)),
        rate: Math.max(0, toCurrencyNumber(line?.rate ?? line?.billRate)),
        markupPct: toCurrencyNumber(line?.markupPct),
        trueRateInternal: Math.max(
          0,
          toCurrencyNumber(line?.trueRateInternal ?? line?.internalRate ?? line?.rateInternal)
        ),
      })),
    },
    materials: {
      blanketCost: Math.max(0, toCurrencyNumber(doc?.materials?.blanketCost ?? doc?.blanketCost ?? doc?.materialsCost)),
      blanketInternalCost: Math.max(
        0,
        toCurrencyNumber(doc?.materials?.blanketInternalCost ?? doc?.blanketInternalCost ?? doc?.materialsCost)
      ),
      markupPct: toCurrencyNumber(doc?.materials?.markupPct ?? doc?.materialsMarkupPct),
      items: materialItems.map((item, index) => ({
        id: asText(item?.id) || `mat_${index}`,
        desc: asText(item?.desc || item?.name),
        qty: Math.max(1, toCurrencyNumber(item?.qty || 1)),
        priceEach: Math.max(
          0,
          toCurrencyNumber(item?.priceEach ?? item?.chargeEach ?? item?.charge ?? item?.price ?? item?.unitPrice)
        ),
        markupPct: toCurrencyNumber(item?.markupPct),
        unitCostInternal: Math.max(
          0,
          toCurrencyNumber(
            item?.unitCostInternal
            ?? item?.costInternal
            ?? item?.internalCost
            ?? item?.internalEach
            ?? item?.internalPrice
            ?? item?.cost
          )
        ),
      })),
    },
    additionalCharges: {
      items: additionalChargeItems.map((item, index) => ({
        id: asText(item?.id) || `charge_${index}`,
        desc: asText(item?.desc || item?.description || item?.label),
        qty: Math.max(0, toCurrencyNumber(item?.qty)),
        priceEach: Math.max(
          0,
          toCurrencyNumber(item?.priceEach ?? item?.charge ?? item?.amount ?? item?.unitPrice)
        ),
      })),
    },
  };
}

function buildFinancialSummary({
  approvedTotal = null,
  totalRevenue = 0,
  totalCost = 0,
  laborRevenue = 0,
  laborCost = 0,
  materialsRevenue = 0,
  materialsCost = 0,
  additionalChargesRevenue = 0,
}) {
  const revenue = roundCurrency(totalRevenue);
  const cost = roundCurrency(totalCost);
  const grossProfit = roundCurrency(revenue - cost);
  const marginRatio = revenue > 0 ? roundCurrency(grossProfit / revenue) : 0;
  const marginPercent = roundCurrency(marginRatio * 100);
  const approved = approvedTotal === null || approvedTotal === undefined || approvedTotal === ""
    ? revenue
    : roundCurrency(approvedTotal);
  const normalizedLaborRevenue = roundCurrency(laborRevenue);
  const normalizedLaborCost = roundCurrency(laborCost);
  const normalizedMaterialsRevenue = roundCurrency(materialsRevenue);
  const normalizedMaterialsCost = roundCurrency(materialsCost);
  const normalizedAdditionalChargesRevenue = roundCurrency(additionalChargesRevenue);

  return {
    approvedTotal: approved,
    totalRevenue: revenue,
    grandTotal: revenue,
    total: revenue,
    totalCost: cost,
    internalCost: cost,
    grossProfit,
    grossMargin: marginRatio,
    grossMarginPct: marginRatio,
    grossProfitMargin: marginRatio,
    margin: marginRatio,
    marginPct: marginPercent,
    marginPercent,
    laborRevenue: normalizedLaborRevenue,
    laborCost: normalizedLaborCost,
    materialsRevenue: normalizedMaterialsRevenue,
    materialsCost: normalizedMaterialsCost,
    additionalChargesRevenue: normalizedAdditionalChargesRevenue,
    financials: {
      approvedTotal: approved,
      totalRevenue: revenue,
      grandTotal: revenue,
      totalCost: cost,
      internalCost: cost,
      grossProfit,
      grossMargin: marginRatio,
      grossMarginPct: marginRatio,
      grossProfitMargin: marginRatio,
      margin: marginRatio,
      marginPct: marginPercent,
      marginPercent,
      laborRevenue: normalizedLaborRevenue,
      laborCost: normalizedLaborCost,
      materialsRevenue: normalizedMaterialsRevenue,
      materialsCost: normalizedMaterialsCost,
      additionalChargesRevenue: normalizedAdditionalChargesRevenue,
    },
    totals: {
      approvedTotal: approved,
      totalRevenue: revenue,
      grandTotal: revenue,
      totalCost: cost,
      internalCost: cost,
      grossProfit,
      grossMargin: marginRatio,
      grossMarginPct: marginRatio,
      grossProfitMargin: marginRatio,
      margin: marginRatio,
      marginPct: marginPercent,
      marginPercent,
      laborRevenue: normalizedLaborRevenue,
      laborCost: normalizedLaborCost,
      materialsRevenue: normalizedMaterialsRevenue,
      materialsCost: normalizedMaterialsCost,
      additionalChargesRevenue: normalizedAdditionalChargesRevenue,
    },
  };
}

export function buildFinancialSummaryFromComputed(computed, approvedTotal = null) {
  const laborRevenue = roundCurrency(
    computed?.labor?.totalRevenue
    ?? computed?.laborAfterAdjustments
    ?? computed?.laborAfterMultiplier
    ?? computed?.labor?.subtotal
    ?? 0
  );
  const laborCost = roundCurrency(
    computed?.labor?.totalCost
    ?? computed?.labor?.internalCost
    ?? computed?.labor?.cost
    ?? 0
  );
  const materialsRevenue = roundCurrency(
    computed?.materials?.totalRevenue
    ?? computed?.materials?.totalCharge
    ?? 0
  );
  const materialsCost = roundCurrency(
    computed?.materials?.totalCost
    ?? computed?.materials?.internalCost
    ?? 0
  );
  const additionalChargesRevenue = roundCurrency(
    computed?.additionalCharges?.totalRevenue
    ?? computed?.additionalCharges?.subtotal
    ?? 0
  );
  const totalRevenue = roundCurrency(
    computed?.totalRevenue
    ?? computed?.grandTotal
    ?? (laborRevenue + materialsRevenue + additionalChargesRevenue)
  );
  const totalCost = roundCurrency(
    computed?.totalCost
    ?? (laborCost + materialsCost)
  );

  return buildFinancialSummary({
    approvedTotal,
    totalRevenue,
    totalCost,
    laborRevenue,
    laborCost,
    materialsRevenue,
    materialsCost,
    additionalChargesRevenue,
  });
}

export function allocateFinancialSummaryFromSource(source, invoiceTotal, approvedTotalOverride = null) {
  const normalizedInvoiceTotal = roundCurrency(invoiceTotal);
  const base = extractFinancialSummaryFromDoc(source, { approvedTotal: approvedTotalOverride });
  const approvedTotal = roundCurrency(
    approvedTotalOverride
    ?? base?.approvedTotal
    ?? base?.totalRevenue
    ?? normalizedInvoiceTotal
  );
  const ratioBase = approvedTotal > 0 ? approvedTotal : roundCurrency(base?.totalRevenue);
  const ratio = ratioBase > 0 ? normalizedInvoiceTotal / ratioBase : 0;

  return buildFinancialSummary({
    approvedTotal,
    totalRevenue: normalizedInvoiceTotal,
    totalCost: roundCurrency((base?.totalCost || 0) * ratio),
    laborRevenue: roundCurrency((base?.laborRevenue || 0) * ratio),
    laborCost: roundCurrency((base?.laborCost || 0) * ratio),
    materialsRevenue: roundCurrency((base?.materialsRevenue || 0) * ratio),
    materialsCost: roundCurrency((base?.materialsCost || 0) * ratio),
    additionalChargesRevenue: roundCurrency((base?.additionalChargesRevenue || 0) * ratio),
  });
}

export function extractFinancialSummaryFromDoc(doc, options = {}) {
  const source = doc && typeof doc === "object" ? doc : {};
  const explicitApprovedTotal = firstFiniteNumber(
    options?.approvedTotal,
    source?.approvedTotal,
    source?.financials?.approvedTotal,
    source?.totals?.approvedTotal,
    source?.sourceEstimateSnapshot?.approvedTotal
  );
  const directRevenue = firstFiniteNumber(
    source?.financials?.totalRevenue,
    source?.totals?.totalRevenue,
    source?.totalRevenue,
    source?.grandTotal,
    source?.invoiceTotal,
    source?.total
  );
  const directCost = firstFiniteNumber(
    source?.financials?.totalCost,
    source?.totals?.totalCost,
    source?.totalCost,
    source?.internalCost
  );
  const directGrossProfit = firstFiniteNumber(
    source?.financials?.grossProfit,
    source?.totals?.grossProfit,
    source?.grossProfit
  );
  const directLaborRevenue = firstFiniteNumber(
    source?.financials?.laborRevenue,
    source?.totals?.laborRevenue,
    source?.laborRevenue
  );
  const directLaborCost = firstFiniteNumber(
    source?.financials?.laborCost,
    source?.totals?.laborCost,
    source?.laborCost
  );
  const directMaterialsRevenue = firstFiniteNumber(
    source?.financials?.materialsRevenue,
    source?.totals?.materialsRevenue,
    source?.materialsRevenue
  );
  const directMaterialsCost = firstFiniteNumber(
    source?.financials?.materialsCost,
    source?.totals?.materialsCost,
    source?.materialsCost
  );
  const directAdditionalChargesRevenue = firstFiniteNumber(
    source?.financials?.additionalChargesRevenue,
    source?.totals?.additionalChargesRevenue,
    source?.additionalChargesRevenue
  );
  const snapshot = source?.sourceEstimateSnapshot && typeof source.sourceEstimateSnapshot === "object"
    ? source.sourceEstimateSnapshot
    : null;

  if (asText(source?.sourceEstimateId) && snapshot && directCost === null && directRevenue !== null) {
    return allocateFinancialSummaryFromSource(
      snapshot,
      directRevenue,
      explicitApprovedTotal ?? snapshot?.approvedTotal
    );
  }

  if (directRevenue !== null || directCost !== null || directGrossProfit !== null) {
    const revenue = roundCurrency(directRevenue ?? 0);
    let cost = directCost;
    let grossProfit = directGrossProfit;
    if (cost === null && grossProfit !== null) cost = roundCurrency(revenue - grossProfit);
    if (grossProfit === null && cost !== null) grossProfit = roundCurrency(revenue - cost);
    return buildFinancialSummary({
      approvedTotal: explicitApprovedTotal,
      totalRevenue: revenue,
      totalCost: cost ?? 0,
      laborRevenue: directLaborRevenue ?? 0,
      laborCost: directLaborCost ?? 0,
      materialsRevenue: directMaterialsRevenue ?? 0,
      materialsCost: directMaterialsCost ?? 0,
      additionalChargesRevenue: directAdditionalChargesRevenue ?? 0,
    });
  }

  try {
    const computed = computeTotals(toEstimatorState(source));
    return buildFinancialSummaryFromComputed(computed, explicitApprovedTotal);
  } catch {
    return buildFinancialSummary({
      approvedTotal: explicitApprovedTotal,
      totalRevenue: roundCurrency(directRevenue ?? 0),
      totalCost: roundCurrency(directCost ?? 0),
      laborRevenue: roundCurrency(directLaborRevenue ?? 0),
      laborCost: roundCurrency(directLaborCost ?? 0),
      materialsRevenue: roundCurrency(directMaterialsRevenue ?? 0),
      materialsCost: roundCurrency(directMaterialsCost ?? 0),
      additionalChargesRevenue: roundCurrency(directAdditionalChargesRevenue ?? 0),
    });
  }
}

export function createInvoiceId() {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPaymentId() {
  return `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeInvoiceType(value) {
  const raw = asText(value).toLowerCase();
  if (raw === INVOICE_TYPES.DEPOSIT) return INVOICE_TYPES.DEPOSIT;
  if (raw === INVOICE_TYPES.PROGRESS) return INVOICE_TYPES.PROGRESS;
  if (raw === INVOICE_TYPES.FINAL) return INVOICE_TYPES.FINAL;
  if (raw === INVOICE_TYPES.CUSTOM) return INVOICE_TYPES.CUSTOM;
  return INVOICE_TYPES.MANUAL;
}

function normalizePayments(payments) {
  const arr = Array.isArray(payments) ? payments.filter(Boolean) : [];
  return arr.map((payment, index) => ({
    id: asText(payment?.id) || createPaymentId(),
    amount: roundCurrency(payment?.amount),
    paidAt: normalizeIsoDate(payment?.paidAt || payment?.date, todayISO()),
    note: asText(payment?.note),
    method: asText(payment?.method) || "manual",
    order: Number.isFinite(Number(payment?.order)) ? Number(payment.order) : index,
    stripeSessionId: asText(payment?.stripeSessionId || payment?.sessionId),
    stripePaymentIntentId: asText(payment?.stripePaymentIntentId || payment?.paymentIntentId),
    stripeAccountId: asText(payment?.stripeAccountId),
    stripeEventId: asText(payment?.stripeEventId),
    stripeSyncKey: asText(payment?.stripeSyncKey),
    paymentMethodType: asText(payment?.paymentMethodType),
    cardBrand: asText(payment?.cardBrand),
    cardLast4: asText(payment?.cardLast4),
    receiptEmail: asText(payment?.receiptEmail),
    receiptUrl: asText(payment?.receiptUrl),
    stripePaymentStatus: asText(payment?.stripePaymentStatus),
    currency: asText(payment?.currency),
  }));
}

function invoiceDateLabel(value, fallback = "") {
  return normalizeIsoDate(value, fallback);
}

export function sortInvoicesByDateDesc(a, b) {
  const bTs = Number(b?.updatedAt || b?.savedAt || b?.createdAt || 0) || 0;
  const aTs = Number(a?.updatedAt || a?.savedAt || a?.createdAt || 0) || 0;
  if (bTs !== aTs) return bTs - aTs;
  return asText(b?.invoiceNumber).localeCompare(asText(a?.invoiceNumber));
}

function dedupeInvoices(records) {
  const seen = new Set();
  return records.filter((invoice) => {
    const key = asText(invoice?.invoiceNumber || invoice?.id);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildRecordIdMap(records) {
  return new Map(
    (Array.isArray(records) ? records : [])
      .filter(Boolean)
      .map((record) => [asText(record?.id), record])
      .filter(([id]) => Boolean(id))
  );
}

function findCustomerRecord(customerById, customerId, customerName) {
  if (customerId && customerById.has(customerId)) return customerById.get(customerId) || null;
  const normalizedName = normalizeTextKey(customerName);
  if (!normalizedName) return null;
  for (const record of customerById.values()) {
    const candidateName = normalizeTextKey(
      record?.name
      || record?.displayName
      || record?.companyName
      || record?.fullName
      || record?.contactName
    );
    if (candidateName && candidateName === normalizedName) return record;
  }
  return null;
}

function resolveInvoiceNormalizationOptions(options = {}) {
  const customerById = options?.customerById instanceof Map
    ? options.customerById
    : buildRecordIdMap(Array.isArray(options?.customers) ? options.customers : readStoredCustomers());
  const projectById = options?.projectById instanceof Map
    ? options.projectById
    : buildRecordIdMap(Array.isArray(options?.projects) ? options.projects : readStoredProjects());
  return { customerById, projectById };
}

function hasStructuredInvoiceSections(source) {
  return Boolean(
    (Array.isArray(source?.labor?.lines) && source.labor.lines.length > 0)
    || (Array.isArray(source?.laborLines) && source.laborLines.length > 0)
    || (Array.isArray(source?.materials?.items) && source.materials.items.length > 0)
    || (Array.isArray(source?.materialItems) && source.materialItems.length > 0)
    || (Array.isArray(source?.additionalCharges?.items) && source.additionalCharges.items.length > 0)
    || (Array.isArray(source?.additionalChargeItems) && source.additionalChargeItems.length > 0)
  );
}

function readThinInvoiceLineItems(source) {
  if (Array.isArray(source?.lineItems) && source.lineItems.length > 0) return source.lineItems;
  if (Array.isArray(source?.invoiceLineItems) && source.invoiceLineItems.length > 0) return source.invoiceLineItems;
  if (Array.isArray(source?.items) && source.items.length > 0) return source.items;
  return [];
}

function mapThinInvoiceLineItemsToMaterials(source) {
  if (hasStructuredInvoiceSections(source)) return [];
  const lineItems = readThinInvoiceLineItems(source);
  return lineItems
    .filter(Boolean)
    .map((item, index) => {
      const qty = Math.max(
        1,
        toCurrencyNumber(
          item?.qty
          ?? item?.quantity
          ?? 1
        )
      );
      const explicitPrice = firstFiniteNumber(
        item?.priceEach,
        item?.price,
        item?.unitPrice,
        item?.unit_price
      );
      const explicitTotal = firstFiniteNumber(
        item?.total,
        item?.totalPrice,
        item?.total_price
      );
      const priceEach = explicitPrice !== null
        ? roundCurrency(explicitPrice)
        : roundCurrency((explicitTotal ?? 0) / (qty || 1));

      return {
        id: asText(item?.id) || `invoice_line_${index}`,
        desc: asText(item?.desc || item?.description || item?.label || item?.name),
        qty,
        priceEach,
        markupPct: toCurrencyNumber(item?.markupPct),
        unitCostInternal: item?.unitCostInternal ?? item?.costInternal ?? "",
        costInternal: item?.costInternal ?? "",
        note: asText(item?.note || item?.unit),
      };
    })
    .filter((item) => item.desc || item.priceEach || item.qty);
}

export function generateNextInvoiceNumber(invoices) {
  const arr = Array.isArray(invoices) ? invoices.filter(Boolean) : [];
  let max = 0;
  arr.forEach((invoice) => {
    const raw = asText(invoice?.invoiceNumber);
    if (!raw) return;
    const match = raw.match(/(\d+)(?!.*\d)/);
    if (!match) return;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > max) {
      max = parsed;
    }
  });
  return `INV-${String(max + 1).padStart(4, "0")}`;
}

function readLegacyEstimateInvoices() {
  return readStoredArray(STORAGE_KEYS.ESTIMATES)
    .filter((entry) => asText(entry?.docType).toLowerCase() === "invoice");
}

function createInvoiceAuditMetadata(invoice, extra = {}) {
  return {
    invoiceId: asText(invoice?.id),
    projectId: asText(invoice?.projectId),
    paymentStatus: asText(invoice?.paymentStatus),
    invoiceTotal: roundCurrency(invoice?.invoiceTotal ?? invoice?.total),
    amountPaid: roundCurrency(invoice?.amountPaid),
    balanceRemaining: roundCurrency(invoice?.balanceRemaining),
    ...extra,
  };
}

function collectAddedPayments(previousInvoice, nextInvoice) {
  const previousPayments = normalizePayments(previousInvoice?.payments);
  const nextPayments = normalizePayments(nextInvoice?.payments);
  const previousIds = new Set(previousPayments.map((payment) => asText(payment?.id)).filter(Boolean));
  return nextPayments.filter((payment) => {
    const paymentId = asText(payment?.id);
    return paymentId && !previousIds.has(paymentId);
  });
}

function buildInvoiceAuditEvents(previousInvoices = [], nextInvoices = []) {
  const previousMap = new Map(
    normalizeInvoiceList(previousInvoices).map((invoice) => [asText(invoice?.id), invoice])
  );

  return normalizeInvoiceList(nextInvoices).reduce((events, invoice) => {
    const invoiceId = asText(invoice?.id);
    if (!invoiceId) return events;

    const previousInvoice = previousMap.get(invoiceId) || null;
    const nextDerivedStatus = deriveInvoiceStatus(invoice);

    if (!previousInvoice) {
      const createdEvent = createStoredAuditEvent("invoice.created", {
        targetType: "invoice",
        targetId: invoiceId,
        relatedIds: [asText(invoice?.projectId)].filter(Boolean),
        source: "invoice_write_boundary",
        reason: "persisted",
        metadata: createInvoiceAuditMetadata(invoice, {
          nextStatus: nextDerivedStatus,
        }),
      });
      if (createdEvent) events.push(createdEvent);
      return events;
    }

    const previousDerivedStatus = deriveInvoiceStatus(previousInvoice);
    if (previousDerivedStatus !== nextDerivedStatus) {
      const statusEvent = createStoredAuditEvent("invoice.status_changed", {
        targetType: "invoice",
        targetId: invoiceId,
        relatedIds: [asText(invoice?.projectId)].filter(Boolean),
        source: "invoice_write_boundary",
        reason: "status_transition",
        metadata: createInvoiceAuditMetadata(invoice, {
          previousStatus: previousDerivedStatus,
          nextStatus: nextDerivedStatus,
        }),
      });
      if (statusEvent) events.push(statusEvent);
    }

    const addedPayments = collectAddedPayments(previousInvoice, invoice);
    if (addedPayments.length > 0) {
      const hasStripePayment = addedPayments.some((payment) => asText(payment?.method).toLowerCase() === "stripe");
      const paymentEvent = createStoredAuditEvent(
        hasStripePayment ? "invoice.payment_synced" : "invoice.payment_added",
        {
          targetType: "invoice",
          targetId: invoiceId,
          relatedIds: [asText(invoice?.projectId)].filter(Boolean),
          source: "invoice_write_boundary",
          reason: hasStripePayment ? "stripe_sync" : "manual_payment",
          metadata: createInvoiceAuditMetadata(invoice, {
            previousStatus: previousDerivedStatus,
            nextStatus: nextDerivedStatus,
          }),
        }
      );
      if (paymentEvent) events.push(paymentEvent);
    }

    return events;
  }, []);
}

function collectInvoiceIdentityKeys(invoice) {
  const keys = new Set();
  const id = asText(invoice?.id);
  const invoiceNumber = asText(
    invoice?.invoiceNumber
    || invoice?.job?.docNumber
    || invoice?.docNumber
    || invoice?.documentNumber
    || invoice?.documentNo
    || invoice?.number
  );
  const docNumber = asText(
    invoice?.docNumber
    || invoice?.documentNumber
    || invoice?.documentNo
    || invoice?.number
  );
  if (id) keys.add(`id:${id}`);
  if (invoiceNumber) keys.add(`invoiceNumber:${invoiceNumber}`);
  if (docNumber) keys.add(`docNumber:${docNumber}`);
  return keys;
}

function reconcileLegacyEstimateInvoices(nextInvoices) {
  const estimateRecords = readStoredArray(STORAGE_KEYS.ESTIMATES);
  if (!estimateRecords.length) return;

  const legacyInvoices = estimateRecords.filter((entry) => asText(entry?.docType).toLowerCase() === "invoice");
  if (!legacyInvoices.length) return;

  const persistedInvoices = readStoredArray(INVOICES_KEY);
  const previousRenderedInvoices = normalizeInvoiceList([
    ...persistedInvoices,
    ...legacyInvoices,
  ]);
  const nextRenderedInvoices = normalizeInvoiceList(nextInvoices);

  const nextIdentityKeys = new Set(nextRenderedInvoices.flatMap((invoice) => [...collectInvoiceIdentityKeys(invoice)]));
  const removedIdentityKeys = new Set();
  previousRenderedInvoices.forEach((invoice) => {
    const invoiceKeys = [...collectInvoiceIdentityKeys(invoice)];
    const stillPresent = invoiceKeys.some((key) => nextIdentityKeys.has(key));
    if (!stillPresent) {
      invoiceKeys.forEach((key) => removedIdentityKeys.add(key));
    }
  });

  const controlledIdentityKeys = new Set([
    ...nextIdentityKeys,
    ...removedIdentityKeys,
  ]);

  const reconciledEstimateRecords = estimateRecords.filter((entry) => {
    if (asText(entry?.docType).toLowerCase() !== "invoice") return true;
    const entryKeys = [...collectInvoiceIdentityKeys(entry)];
    if (!entryKeys.length) return true;
    return !entryKeys.some((key) => controlledIdentityKeys.has(key));
  });

  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(reconciledEstimateRecords));
}

export function readStoredInvoices() {
  try {
    const parsed = readStoredArray(INVOICES_KEY);
    let merged = Array.isArray(parsed) ? parsed : [];

    try {
      const legacyInvoices = readLegacyEstimateInvoices();
      if (legacyInvoices.length > 0) {
        merged = [...merged, ...legacyInvoices];
      }
    } catch {}

    const nextInvoices = normalizeInvoiceList(merged, resolveInvoiceNormalizationOptions());
    return nextInvoices;
  } catch {
    return [];
  }
}

export function writeStoredInvoices(invoices) {
  const previousInvoices = readStoredInvoices();
  const next = normalizeInvoiceList(invoices, resolveInvoiceNormalizationOptions());
  const sync = backfillProjectCollections({
    customers: readStoredCustomers(),
    projects: readStoredProjects(),
    invoices: next,
  });
  if (sync.changed) {
    writeStoredProjects(sync.projects);
  }
  localStorage.setItem(INVOICES_KEY, JSON.stringify(sync.invoices));
  reconcileLegacyEstimateInvoices(sync.invoices);
  try {
    const auditEvents = buildInvoiceAuditEvents(previousInvoices, sync.invoices);
    if (auditEvents.length > 0) appendAuditEvents(auditEvents);
  } catch {}
  return sync.invoices;
}

export function buildEstimateInvoiceSnapshot(estimate) {
  const source = estimate && typeof estimate === "object" ? estimate : {};
  const financialSummary = extractFinancialSummaryFromDoc(source, {
    approvedTotal: source?.approvedTotal ?? source?.total,
  });
  return {
    estimateId: asText(source?.id),
    estimateNumber: asText(source?.estimateNumber || source?.job?.docNumber),
    projectId: asText(source?.projectId || source?.customer?.projectId || source?.sourceEstimateSnapshot?.projectId),
    approvedTotal: financialSummary.approvedTotal,
    totalRevenue: financialSummary.totalRevenue,
    grandTotal: financialSummary.grandTotal,
    total: financialSummary.total,
    totalCost: financialSummary.totalCost,
    internalCost: financialSummary.internalCost,
    grossProfit: financialSummary.grossProfit,
    grossMargin: financialSummary.grossMargin,
    grossMarginPct: financialSummary.grossMarginPct,
    grossProfitMargin: financialSummary.grossProfitMargin,
    margin: financialSummary.margin,
    marginPct: financialSummary.marginPct,
    marginPercent: financialSummary.marginPercent,
    laborRevenue: financialSummary.laborRevenue,
    laborCost: financialSummary.laborCost,
    materialsRevenue: financialSummary.materialsRevenue,
    materialsCost: financialSummary.materialsCost,
    additionalChargesRevenue: financialSummary.additionalChargesRevenue,
    estimateStatus: asText(source?.status || "approved"),
    customerId: asText(source?.customerId || source?.customer?.id),
    customerName: asText(source?.customerName || source?.customer?.name),
    projectName: asText(source?.projectName || source?.customer?.projectName),
    projectNumber: asText(source?.projectNumber || source?.customer?.projectNumber),
    poNumber: asText(source?.poNumber || source?.job?.poNumber),
    estimateDate: invoiceDateLabel(source?.date || source?.job?.date),
    dueDate: invoiceDateLabel(source?.dueDate || source?.job?.due),
    customer: deepClone(source?.customer || {}),
    job: deepClone(source?.job || {}),
    additionalCharges: {
      items: normalizeAdditionalChargeItems(source?.additionalCharges?.items),
    },
    financials: {
      ...(source?.financials || {}),
      ...(financialSummary?.financials || {}),
    },
    totals: {
      ...(source?.totals || {}),
      ...(financialSummary?.totals || {}),
    },
    summary: {
      total: financialSummary.totalRevenue,
      totalCost: financialSummary.totalCost,
      grossProfit: financialSummary.grossProfit,
      savedAt: Number(source?.savedAt || 0) || 0,
      updatedAt: Number(source?.updatedAt || 0) || 0,
    },
  };
}

export function normalizeInvoiceRecord(record, options = {}) {
  const source = record && typeof record === "object" ? deepClone(record) : {};
  const { customerById, projectById } = resolveInvoiceNormalizationOptions(options);
  const snapshot = source?.sourceEstimateSnapshot && typeof source.sourceEstimateSnapshot === "object"
    ? deepClone(source.sourceEstimateSnapshot)
    : null;
  const invoiceNumber = asText(source?.invoiceNumber || source?.job?.docNumber || source?.docNumber);
  const estimateNumber = asText(source?.estimateNumber || snapshot?.estimateNumber);
  const sourceEstimateId = asText(source?.sourceEstimateId || snapshot?.estimateId);
  const invoiceDate = invoiceDateLabel(source?.date || source?.job?.date, todayISO());
  const payments = normalizePayments(source?.payments);
  const invoiceTotal = roundCurrency(source?.invoiceTotal ?? source?.total);
  const lifecycle = normalizeInvoiceLifecycleRecord(source);
  const status = lifecycle.status;
  const amountPaid = lifecycle.amountPaid;
  const paymentStatus = lifecycle.paymentStatus;
  const balanceRemaining = lifecycle.balanceRemaining;
  const dueDate = lifecycle.dueDate;
  const requestedProjectId = asText(source?.projectId || source?.project?.id || snapshot?.projectId);
  const storedProject = requestedProjectId ? (projectById.get(requestedProjectId) || null) : null;
  const customerId = asText(
    source?.customerId
    || source?.customer?.id
    || storedProject?.customerId
    || snapshot?.customerId
  );
  const storedCustomer = findCustomerRecord(
    customerById,
    customerId,
    source?.customerName || source?.customer?.name || source?.customer?.displayName || snapshot?.customerName
  );
  const customerName = asText(
    source?.customerName
    || source?.customer?.name
    || source?.customer?.displayName
    || storedCustomer?.name
    || storedCustomer?.displayName
    || storedCustomer?.companyName
    || storedCustomer?.fullName
    || storedCustomer?.contactName
    || snapshot?.customerName
  );
  const projectName = asText(
    source?.projectName
    || source?.customer?.projectName
    || storedProject?.projectName
    || snapshot?.projectName
  );
  const projectNumber = asText(
    source?.projectNumber
    || source?.customer?.projectNumber
    || storedProject?.projectNumber
    || snapshot?.projectNumber
  );
  const invoiceType = normalizeInvoiceType(
    source?.invoiceType || (sourceEstimateId ? INVOICE_TYPES.CUSTOM : INVOICE_TYPES.MANUAL)
  );
  const createdAt = Number(source?.createdAt || source?.savedAt || Date.now()) || Date.now();
  const updatedAt = Number(source?.updatedAt || source?.savedAt || createdAt) || createdAt;
  const projectId = asText(source?.projectId || source?.project?.id || snapshot?.projectId)
    || createProjectRecord({
      customerId,
      customerName,
      projectName,
      projectNumber,
      siteAddress: asText(
        source?.siteAddress
        || source?.projectAddress
        || source?.customer?.projectAddress
        || source?.customer?.address
        || snapshot?.siteAddress
        || source?.job?.location
      ),
      status: source?.projectStatus || source?.status,
      notes: source?.notes || source?.projectNotes,
      scopeSummary: source?.scopeSummary || source?.scopeNotes || source?.additionalNotes || source?.notes,
      createdAt,
      updatedAt,
    }, { nowTs: updatedAt }).id;
  const fallbackMaterialItems = mapThinInvoiceLineItemsToMaterials(source);
  const hasFallbackMaterialItems = fallbackMaterialItems.length > 0;
  const normalizedSnapshot = sourceEstimateId
    ? {
        ...(snapshot || {}),
        ...buildEstimateInvoiceSnapshot(snapshot || {}),
      }
    : null;
  const normalizedAdditionalCharges = normalizeAdditionalChargeItems(source?.additionalCharges?.items);
  const financialSummary = extractFinancialSummaryFromDoc(source, {
    approvedTotal: normalizedSnapshot?.approvedTotal ?? source?.approvedTotal ?? invoiceTotal,
  });
  const projectAddress = asText(
    source?.projectAddress
    || source?.customer?.projectAddress
    || storedProject?.siteAddress
    || storedCustomer?.projectAddress
    || storedCustomer?.address
    || source?.job?.location
  );
  const resolvedMaterialsMode = hasFallbackMaterialItems
    ? "itemized"
    : resolveMaterialsMode(source);

  return {
    ...source,
    ...financialSummary,
    id: asText(source?.id) || createInvoiceId(),
    docType: "invoice",
    ui: {
      ...(source?.ui || {}),
      docType: "invoice",
      materialsMode: resolvedMaterialsMode,
    },
    invoiceType,
    invoiceNumber,
    estimateNumber,
    status,
    invoiceTotal,
    total: invoiceTotal,
    amountPaid,
    balanceRemaining,
    paymentStatus,
    payments,
    customerId,
    customerName,
    projectName,
    projectNumber,
    projectId,
    sourceEstimateId,
    sourceEstimateSnapshot: normalizedSnapshot,
    date: invoiceDate,
    dueDate,
    additionalNotes: asText(source?.additionalNotes || source?.notes),
    job: {
      ...(source?.job || {}),
      date: invoiceDate,
      due: dueDate,
      docNumber: invoiceNumber,
      location: asText(source?.job?.location || projectAddress),
      projectName,
      projectNumber,
    },
    customer: {
      ...(storedCustomer && typeof storedCustomer === "object" ? storedCustomer : {}),
      ...(source?.customer || {}),
      id: customerId,
      name: customerName,
      projectName,
      projectNumber,
      projectAddress,
      address: asText(source?.customer?.address || storedCustomer?.address || projectAddress),
    },
    materials: {
      ...(source?.materials || {}),
      items: hasFallbackMaterialItems
        ? fallbackMaterialItems
        : (Array.isArray(source?.materials?.items)
          ? source.materials.items
          : (Array.isArray(source?.materialItems) ? source.materialItems : [])),
    },
    additionalCharges: {
      ...(source?.additionalCharges || {}),
      items: normalizedAdditionalCharges,
    },
    financials: {
      ...(source?.financials || {}),
      ...(financialSummary?.financials || {}),
    },
    totals: {
      ...(source?.totals || {}),
      ...(financialSummary?.totals || {}),
    },
    createdAt,
    savedAt: Number(source?.savedAt || updatedAt) || updatedAt,
    updatedAt,
    ts: Number(source?.ts || updatedAt) || updatedAt,
  };
}

export function normalizeInvoiceList(records, options = {}) {
  const arr = Array.isArray(records) ? records.filter(Boolean) : [];
  const normalizationOptions = resolveInvoiceNormalizationOptions(options);
  const normalized = arr
    .map((invoice) => normalizeInvoiceRecord(invoice, normalizationOptions))
    .sort(sortInvoicesByDateDesc);
  return dedupeInvoices(normalized);
}

export function isInvoiceFinanciallyCommitted(record, nowTs = Date.now()) {
  const invoice = normalizeInvoiceRecord(record);
  const status = deriveInvoiceStatus(invoice, nowTs);
  if (status === INVOICE_STATUSES.VOID) return false;
  if (status !== INVOICE_STATUSES.DRAFT) return true;
  return (
    invoice.paymentStatus === PAYMENT_STATUSES.PAID
    || invoice.paymentStatus === PAYMENT_STATUSES.PARTIAL
    || roundCurrency(invoice.amountPaid) > 0
  );
}

export function isInvoiceReceivable(record, nowTs = Date.now()) {
  const invoice = normalizeInvoiceRecord(record);
  const status = deriveInvoiceStatus(invoice, nowTs);
  if (status === INVOICE_STATUSES.VOID) return false;
  if (status === INVOICE_STATUSES.PAID || invoice.paymentStatus === PAYMENT_STATUSES.PAID) return false;
  if (!isInvoiceFinanciallyCommitted(invoice, nowTs)) return false;
  return roundCurrency(invoice.balanceRemaining) > 0;
}

export function buildEstimateInvoiceSummary(estimate, invoices, options = {}) {
  const sourceEstimateId = asText(estimate?.id);
  const ignoreInvoiceId = asText(options?.ignoreInvoiceId);
  const approvedTotal = roundCurrency(estimate?.total ?? estimate?.approvedTotal);
  const arr = Array.isArray(invoices) ? invoices : [];
  const childInvoices = arr
    .map((invoice) => normalizeInvoiceRecord(invoice))
    .filter((invoice) => invoice.sourceEstimateId && invoice.sourceEstimateId === sourceEstimateId)
    .filter((invoice) => !ignoreInvoiceId || invoice.id !== ignoreInvoiceId);
  const activeInvoices = childInvoices.filter((invoice) => deriveInvoiceStatus(invoice) !== INVOICE_STATUSES.VOID);
  const invoicedTotal = roundCurrency(
    activeInvoices.reduce((sum, invoice) => sum + roundCurrency(invoice.invoiceTotal), 0)
  );
  return {
    approvedTotal,
    invoicedTotal,
    remainingToInvoice: roundCurrency(Math.max(approvedTotal - invoicedTotal, 0)),
    linkedInvoiceCount: childInvoices.length,
    activeInvoiceCount: activeInvoices.length,
  };
}

function resolveRequestedInvoiceAmount(invoiceType, requestedValue, summary) {
  const remainingToInvoice = roundCurrency(summary?.remainingToInvoice);
  const approvedTotal = roundCurrency(summary?.approvedTotal);
  const raw = asText(requestedValue);

  if (invoiceType === INVOICE_TYPES.FINAL && !raw) {
    if (remainingToInvoice <= 0) {
      return { error: "Nothing remains to invoice for this estimate." };
    }
    return {
      amount: remainingToInvoice,
      amountMode: "remaining",
      requestedPercent: approvedTotal > 0 ? roundCurrency((remainingToInvoice / approvedTotal) * 100) : 0,
    };
  }

  if (!raw) {
    return { error: "Enter an amount or percent to invoice." };
  }

  const percentMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  const requestedPercent = percentMatch ? Number(percentMatch[1]) : null;
  const amount = percentMatch
    ? roundCurrency((approvedTotal * requestedPercent) / 100)
    : roundCurrency(raw);
  const amountMode = percentMatch ? "percent" : "amount";

  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Invoice amount must be greater than $0.00." };
  }
  if (percentMatch && (!Number.isFinite(requestedPercent) || requestedPercent <= 0)) {
    return { error: "Invoice percent must be greater than 0%." };
  }
  if (remainingToInvoice > 0 && amount > remainingToInvoice + EPSILON) {
    return {
      error: `Invoice exceeds the remaining amount to invoice (${remainingToInvoice.toFixed(2)}).`,
    };
  }

  return {
    amount,
    amountMode,
    requestedPercent: percentMatch ? roundCurrency(requestedPercent) : null,
  };
}

export function validateInvoiceAgainstEstimate(options = {}) {
  const invoice = normalizeInvoiceRecord(options?.invoice);
  if (!invoice.sourceEstimateId) {
    return { ok: true, summary: null };
  }

  const invoices = Array.isArray(options?.invoices) ? options.invoices : [];
  const estimate = options?.estimate && typeof options.estimate === "object"
    ? options.estimate
    : { id: invoice.sourceEstimateId, total: invoice?.sourceEstimateSnapshot?.approvedTotal || 0 };
  const summary = buildEstimateInvoiceSummary(estimate, invoices, {
    ignoreInvoiceId: asText(options?.ignoreInvoiceId || invoice.id),
  });
  const nextInvoicedTotal = deriveInvoiceStatus(invoice) === INVOICE_STATUSES.VOID
    ? summary.invoicedTotal
    : roundCurrency(summary.invoicedTotal + invoice.invoiceTotal);

  if (summary.approvedTotal > 0 && nextInvoicedTotal > summary.approvedTotal + EPSILON) {
    return {
      ok: false,
      summary,
      message: `This invoice exceeds the estimate's remaining billable total (${summary.remainingToInvoice.toFixed(2)} remaining).`,
    };
  }

  return { ok: true, summary };
}

function baseInvoiceDraft(nowTs) {
  const base = deepClone(DEFAULT_STATE);
  const now = Number(nowTs) || Date.now();
  return {
    ...base,
    id: createInvoiceId(),
    docType: "invoice",
    ui: {
      ...(base?.ui || {}),
      docType: "invoice",
    },
    status: INVOICE_STATUSES.DRAFT,
    invoiceType: INVOICE_TYPES.MANUAL,
    invoiceNumber: "",
    invoiceTotal: 0,
    amountPaid: 0,
    balanceRemaining: 0,
    paymentStatus: PAYMENT_STATUSES.UNPAID,
    payments: [],
    savedAt: now,
    updatedAt: now,
    createdAt: now,
    ts: now,
    meta: {
      ...(base?.meta || {}),
      savedDocId: "",
      savedDocCreatedAt: now,
      lastSavedAt: now,
      ephemeralDraft: true,
    },
  };
}

function buildInvoiceScopeCarryover(source = {}, options = {}) {
  const sourceScopeNotes = asText(source?.scopeNotes).trim();
  const tradeInsert = source?.tradeInsert && typeof source.tradeInsert === "object"
    ? deepClone(source.tradeInsert)
    : { key: "", text: "" };
  const fallbackTradeInsertText = asText(tradeInsert?.text).trim();
  const scopeNotes = sourceScopeNotes || fallbackTradeInsertText;
  const additionalNotes = [
    asText(source?.additionalNotes).trim(),
    asText(options?.note).trim(),
  ].filter(Boolean).join("\n\n");
  const scopeImages = Array.isArray(source?.scopeImages)
    ? deepClone(source.scopeImages.filter(Boolean))
    : [];
  const includeInvoiceScopeNotes = Boolean(
    scopeNotes
    || scopeImages.length > 0
    || asText(tradeInsert?.text)
  );

  return {
    scopeNotes,
    additionalNotes,
    tradeInsert,
    scopeImages,
    includeInvoiceScopeNotes,
  };
}

export function createManualInvoiceDraft(existingInvoices, options = {}) {
  const now = Number(options?.nowTs) || Date.now();
  const invoiceNumber = generateNextInvoiceNumber(existingInvoices);
  const draft = baseInvoiceDraft(now);
  draft.id = createInvoiceId();
  draft.invoiceType = INVOICE_TYPES.MANUAL;
  draft.invoiceNumber = invoiceNumber;
  draft.job = {
    ...(draft.job || {}),
    date: normalizeIsoDate(options?.invoiceDate, todayISO()),
    due: normalizeIsoDate(options?.dueDate),
    docNumber: invoiceNumber,
  };
  draft.meta = {
    ...(draft.meta || {}),
    savedDocId: draft.id,
    savedDocCreatedAt: now,
    lastSavedAt: now,
    ephemeralDraft: true,
  };
  return normalizeInvoiceRecord(draft);
}

export function createInvoiceDraftFromEstimate(estimate, invoices, options = {}) {
  const status = asText(estimate?.status).toLowerCase();
  if (status !== "approved") {
    return { ok: false, message: "Only approved estimates can create child invoices." };
  }

  const summary = buildEstimateInvoiceSummary(estimate, invoices);
  if (summary.remainingToInvoice <= 0) {
    return { ok: false, message: "This estimate has no remaining amount to invoice." };
  }

  const invoiceType = normalizeInvoiceType(options?.invoiceType || INVOICE_TYPES.FINAL);
  const amountResolution = resolveRequestedInvoiceAmount(invoiceType, options?.requestedValue, summary);
  if (amountResolution.error) {
    return { ok: false, message: amountResolution.error, summary };
  }

  const now = Number(options?.nowTs) || Date.now();
  const invoiceNumber = generateNextInvoiceNumber(invoices);
  const snapshot = buildEstimateInvoiceSnapshot(estimate);
  const scopeCarryover = buildInvoiceScopeCarryover(estimate, { note: options?.note });
  const invoiceDate = normalizeIsoDate(options?.invoiceDate, todayISO());
  const dueDate = normalizeIsoDate(options?.dueDate || estimate?.job?.due);
  const draft = baseInvoiceDraft(now);
  const allocatedFinancialSummary = allocateFinancialSummaryFromSource(
    snapshot,
    amountResolution.amount,
    summary.approvedTotal
  );

  draft.id = createInvoiceId();
  draft.invoiceType = invoiceType;
  draft.invoiceNumber = invoiceNumber;
  draft.estimateNumber = snapshot.estimateNumber;
  draft.sourceEstimateId = snapshot.estimateId;
  draft.sourceEstimateSnapshot = snapshot;
  draft.projectId = asText(snapshot?.projectId || draft?.projectId || createProjectRecord(snapshot || {}).id);
  draft.customerId = snapshot.customerId;
  draft.customerName = snapshot.customerName;
  draft.projectName = snapshot.projectName;
  draft.projectNumber = snapshot.projectNumber;
  draft.invoiceTotal = amountResolution.amount;
  draft.total = amountResolution.amount;
  draft.amountPaid = 0;
  draft.balanceRemaining = amountResolution.amount;
  draft.paymentStatus = PAYMENT_STATUSES.UNPAID;
  draft.payments = [];
  draft.scopeNotes = scopeCarryover.scopeNotes;
  draft.additionalNotes = scopeCarryover.additionalNotes;
  draft.tradeInsert = scopeCarryover.tradeInsert;
  draft.scopeImages = scopeCarryover.scopeImages;
  draft.customer = {
    ...(draft.customer || {}),
    ...(snapshot.customer || {}),
    id: snapshot.customerId,
    name: snapshot.customerName,
    projectName: snapshot.projectName,
    projectNumber: snapshot.projectNumber,
  };
  draft.job = {
    ...(draft.job || {}),
    ...(snapshot.job || {}),
    date: invoiceDate,
    due: dueDate,
    poNumber: snapshot.poNumber,
    docNumber: invoiceNumber,
  };
  draft.ui = {
    ...(draft.ui || {}),
    docType: "invoice",
    materialsMode: "blanket",
    includeInvoiceScopeNotes: scopeCarryover.includeInvoiceScopeNotes,
  };
  draft.labor = {
    ...(draft.labor || {}),
    hazardPct: 0,
    riskPct: 0,
    multiplier: 1,
    lines: [{ id: "l1", role: "", hours: "", rate: "", trueRateInternal: "" }],
  };
  draft.materials = {
    ...(draft.materials || {}),
    blanketCost: String(amountResolution.amount),
    blanketInternalCost: "",
    materialsBlanketDescription: `${invoiceType.charAt(0).toUpperCase()}${invoiceType.slice(1)} invoice for Estimate #${snapshot.estimateNumber || "-"}`,
    markupPct: 0,
    items: [{ id: "m1", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" }],
  };
  draft.invoiceMeta = {
    sourceType: "estimate",
    amountMode: amountResolution.amountMode,
    requestedPercent: amountResolution.requestedPercent,
    approvedTotalAtCreation: summary.approvedTotal,
    remainingToInvoiceAtCreation: summary.remainingToInvoice,
    createdFromEstimateAt: now,
    financialSource: "estimate-proportional",
  };
  draft.approvedTotal = allocatedFinancialSummary.approvedTotal;
  draft.totalRevenue = allocatedFinancialSummary.totalRevenue;
  draft.grandTotal = allocatedFinancialSummary.grandTotal;
  draft.totalCost = allocatedFinancialSummary.totalCost;
  draft.internalCost = allocatedFinancialSummary.internalCost;
  draft.grossProfit = allocatedFinancialSummary.grossProfit;
  draft.grossMargin = allocatedFinancialSummary.grossMargin;
  draft.grossMarginPct = allocatedFinancialSummary.grossMarginPct;
  draft.grossProfitMargin = allocatedFinancialSummary.grossProfitMargin;
  draft.margin = allocatedFinancialSummary.margin;
  draft.marginPct = allocatedFinancialSummary.marginPct;
  draft.marginPercent = allocatedFinancialSummary.marginPercent;
  draft.laborRevenue = allocatedFinancialSummary.laborRevenue;
  draft.laborCost = allocatedFinancialSummary.laborCost;
  draft.materialsRevenue = allocatedFinancialSummary.materialsRevenue;
  draft.materialsCost = allocatedFinancialSummary.materialsCost;
  draft.financials = {
    ...(draft.financials || {}),
    ...(allocatedFinancialSummary.financials || {}),
  };
  draft.totals = {
    ...(draft.totals || {}),
    ...(allocatedFinancialSummary.totals || {}),
  };
  draft.meta = {
    ...(draft.meta || {}),
    savedDocId: draft.id,
    savedDocCreatedAt: now,
    lastSavedAt: now,
    ephemeralDraft: true,
  };

  const normalized = normalizeInvoiceRecord(draft);
  const validation = validateInvoiceAgainstEstimate({
    invoice: normalized,
    estimate,
    invoices,
  });
  if (!validation.ok) {
    return { ok: false, message: validation.message, summary };
  }

  return {
    ok: true,
    draft: normalized,
    summary,
  };
}

export function createInvoiceBuilderDraftFromEstimate(estimate, invoices, options = {}) {
  const source = estimate && typeof estimate === "object" ? deepClone(estimate) : {};
  const status = asText(source?.status).toLowerCase();
  if (status !== "approved") {
    return { ok: false, message: "Only approved estimates can create child invoices." };
  }

  const summary = buildEstimateInvoiceSummary(source, invoices);
  if (summary.remainingToInvoice <= 0) {
    return { ok: false, message: "This estimate has no remaining amount to invoice." };
  }

  const now = Number(options?.nowTs) || Date.now();
  const invoiceNumber = asText(options?.invoiceNumber) || generateNextInvoiceNumber(invoices);
  const invoiceDate = normalizeIsoDate(options?.invoiceDate, todayISO());
  const dueDate = normalizeIsoDate(options?.dueDate || source?.job?.due);
  const snapshot = buildEstimateInvoiceSnapshot(source);
  const customerId = asText(source?.customerId || source?.customer?.id || snapshot?.customerId);
  const customerName = asText(source?.customerName || source?.customer?.name || snapshot?.customerName);
  const projectName = asText(source?.projectName || source?.customer?.projectName || snapshot?.projectName);
  const projectNumber = asText(source?.projectNumber || source?.customer?.projectNumber || snapshot?.projectNumber);
  const projectId = asText(source?.projectId || snapshot?.projectId);
  const materialsMode = asText(source?.ui?.materialsMode || source?.materialsMode).toLowerCase() === "itemized"
    ? "itemized"
    : "blanket";
  const invoiceTotal = roundCurrency(
    source?.invoiceTotal
    ?? source?.totalRevenue
    ?? source?.grandTotal
    ?? source?.total
    ?? snapshot?.approvedTotal
    ?? 0
  );
  const scopeCarryover = buildInvoiceScopeCarryover(source);

  const draft = normalizeInvoiceRecord({
    ...source,
    id: "",
    docType: "invoice",
    status: INVOICE_STATUSES.DRAFT,
    invoiceType: source?.invoiceType || INVOICE_TYPES.CUSTOM,
    invoiceNumber,
    estimateNumber: snapshot.estimateNumber,
    docNumber: invoiceNumber,
    documentNumber: invoiceNumber,
    documentNo: invoiceNumber,
    number: invoiceNumber,
    sourceEstimateId: snapshot.estimateId,
    sourceEstimateSnapshot: snapshot,
    projectId,
    customerId,
    customerName,
    projectName,
    projectNumber,
    invoiceTotal,
    total: invoiceTotal,
    amountPaid: 0,
    balanceRemaining: invoiceTotal,
    paymentStatus: PAYMENT_STATUSES.UNPAID,
    payments: [],
    date: invoiceDate,
    dueDate,
    scopeNotes: scopeCarryover.scopeNotes,
    additionalNotes: scopeCarryover.additionalNotes,
    tradeInsert: scopeCarryover.tradeInsert,
    scopeImages: scopeCarryover.scopeImages,
    ui: {
      ...(source?.ui || {}),
      docType: "invoice",
      materialsMode,
      includeInvoiceScopeNotes: scopeCarryover.includeInvoiceScopeNotes,
    },
    customer: {
      ...(source?.customer || {}),
      id: customerId,
      name: customerName,
      projectName,
      projectNumber,
    },
    job: {
      ...(source?.job || {}),
      date: invoiceDate,
      due: dueDate,
      docNumber: invoiceNumber,
    },
    invoiceMeta: {
      ...(source?.invoiceMeta || {}),
      sourceType: "estimate",
      approvedTotalAtCreation: summary.approvedTotal,
      remainingToInvoiceAtCreation: summary.remainingToInvoice,
      createdFromEstimateAt: now,
      financialSource: "estimate-full-builder",
    },
    meta: {
      ...(source?.meta || {}),
      savedDocId: "",
      savedDocCreatedAt: now,
      lastSavedAt: 0,
      ephemeralDraft: true,
    },
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    ts: now,
  });

  return {
    ok: true,
    draft,
    summary,
  };
}

export function duplicateInvoiceDraft(invoice, invoices, options = {}) {
  const source = normalizeInvoiceRecord(invoice);
  const now = Number(options?.nowTs) || Date.now();
  const invoiceNumber = generateNextInvoiceNumber(invoices);
  const duplicate = normalizeInvoiceRecord({
    ...deepClone(source),
    id: createInvoiceId(),
    invoiceNumber,
    status: INVOICE_STATUSES.DRAFT,
    amountPaid: 0,
    balanceRemaining: source.invoiceTotal,
    paymentStatus: PAYMENT_STATUSES.UNPAID,
    payments: [],
    date: normalizeIsoDate(options?.invoiceDate, todayISO()),
    dueDate: normalizeIsoDate(options?.dueDate || source?.dueDate),
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    ts: now,
    job: {
      ...(source?.job || {}),
      docNumber: invoiceNumber,
      date: normalizeIsoDate(options?.invoiceDate, todayISO()),
      due: normalizeIsoDate(options?.dueDate || source?.dueDate),
    },
    meta: {
      ...(source?.meta || {}),
      savedDocId: "",
      savedDocCreatedAt: now,
      lastSavedAt: now,
      ephemeralDraft: true,
    },
  });
  duplicate.meta = {
    ...(duplicate.meta || {}),
    savedDocId: duplicate.id,
  };

  if (duplicate.sourceEstimateId) {
    const estimates = Array.isArray(options?.estimates) ? options.estimates : [];
    const estimate = estimates.find((entry) => asText(entry?.id) === duplicate.sourceEstimateId) || null;
    const validation = validateInvoiceAgainstEstimate({
      invoice: duplicate,
      estimate,
      invoices,
    });
    if (!validation.ok) {
      return { ok: false, message: validation.message, summary: validation.summary };
    }
  }

  return { ok: true, draft: duplicate };
}

export function updateInvoiceLifecycleStatus(invoice, nextStatus, options = {}) {
  const source = normalizeInvoiceRecord(invoice);
  const status = asText(nextStatus).toLowerCase();
  const now = Number(options?.nowTs) || Date.now();
  const today = todayParts(new Date(now));

  if (status === INVOICE_STATUSES.PAID) {
    const paymentAmount = roundCurrency(source.invoiceTotal);
    return normalizeInvoiceRecord({
      ...source,
      status: INVOICE_STATUSES.PAID,
      amountPaid: paymentAmount,
      balanceRemaining: 0,
      paymentStatus: PAYMENT_STATUSES.PAID,
      payments: [
        {
          id: createPaymentId(),
          amount: paymentAmount,
          paidAt: today,
          note: asText(options?.note) || "Marked paid",
          method: "manual",
        },
      ],
      updatedAt: now,
      savedAt: now,
      ts: now,
    });
  }

  if (status === INVOICE_STATUSES.VOID) {
    return normalizeInvoiceRecord({
      ...source,
      status: INVOICE_STATUSES.VOID,
      amountPaid: 0,
      balanceRemaining: 0,
      paymentStatus: PAYMENT_STATUSES.VOID,
      payments: [],
      updatedAt: now,
      savedAt: now,
      ts: now,
    });
  }

  if (status === INVOICE_STATUSES.SENT) {
    return normalizeInvoiceRecord({
      ...source,
      status: INVOICE_STATUSES.SENT,
      updatedAt: now,
      savedAt: now,
      ts: now,
    });
  }

  return normalizeInvoiceRecord({
    ...source,
    status: INVOICE_STATUSES.DRAFT,
    updatedAt: now,
    savedAt: now,
    ts: now,
  });
}

export function addManualInvoicePayment(invoice, paymentInput = {}, options = {}) {
  const source = normalizeInvoiceRecord(invoice);
  const now = Number(options?.nowTs) || Date.now();
  const derivedStatus = deriveInvoiceStatus(source, now);

  if (derivedStatus === INVOICE_STATUSES.DRAFT) {
    return {
      ok: false,
      message: "Payments can only be recorded on sent or overdue invoices.",
    };
  }

  if (derivedStatus === INVOICE_STATUSES.VOID || source.paymentStatus === PAYMENT_STATUSES.VOID) {
    return {
      ok: false,
      message: "Void invoices cannot accept payments.",
    };
  }

  if (derivedStatus === INVOICE_STATUSES.PAID || source.paymentStatus === PAYMENT_STATUSES.PAID) {
    return {
      ok: false,
      message: "This invoice is already fully paid.",
    };
  }

  const balanceRemaining = roundCurrency(source.balanceRemaining);
  if (balanceRemaining <= 0) {
    return {
      ok: false,
      message: "This invoice has no remaining balance.",
    };
  }

  const amount = roundCurrency(paymentInput?.amount);
  if (amount <= 0) {
    return {
      ok: false,
      message: "Payment amount must be greater than $0.",
    };
  }

  if (amount > balanceRemaining + EPSILON) {
    return {
      ok: false,
      message: "Payment amount cannot exceed the remaining balance.",
    };
  }

  const payments = normalizePayments(source.payments);
  const nextPayment = {
    id: createPaymentId(),
    amount,
    paidAt: normalizeIsoDate(paymentInput?.paidAt || paymentInput?.date, todayParts(new Date(now))),
    note: asText(paymentInput?.note),
    method: asText(paymentInput?.method) || "manual",
    order: payments.length,
  };
  const nextAmountPaid = roundCurrency(source.amountPaid + amount);
  const isPaidInFull = nextAmountPaid >= source.invoiceTotal - EPSILON;

  return {
    ok: true,
    invoice: normalizeInvoiceRecord({
      ...source,
      status: isPaidInFull ? INVOICE_STATUSES.PAID : source.status,
      payments: [...payments, nextPayment],
      updatedAt: now,
      savedAt: now,
      ts: now,
    }),
  };
}

export function appendStripeInvoicePayment(invoice, paymentInput = {}, options = {}) {
  const source = normalizeInvoiceRecord(invoice);
  const now = Number(options?.nowTs) || Date.now();
  const derivedStatus = deriveInvoiceStatus(source, now);

  if (derivedStatus === INVOICE_STATUSES.DRAFT) {
    return {
      ok: false,
      code: "invoice_not_billable",
      message: "Payments can only be recorded on sent or overdue invoices.",
    };
  }

  if (derivedStatus === INVOICE_STATUSES.VOID || source.paymentStatus === PAYMENT_STATUSES.VOID) {
    return {
      ok: false,
      code: "invoice_void",
      message: "Void invoices cannot accept payments.",
    };
  }

  if (derivedStatus === INVOICE_STATUSES.PAID || source.paymentStatus === PAYMENT_STATUSES.PAID) {
    return {
      ok: false,
      code: "invoice_paid",
      message: "This invoice is already fully paid.",
    };
  }

  const amount = roundCurrency(paymentInput?.amount);
  if (amount <= 0) {
    return {
      ok: false,
      code: "invalid_amount",
      message: "Payment amount must be greater than $0.",
    };
  }

  const balanceRemaining = roundCurrency(source.balanceRemaining);
  if (amount > balanceRemaining + EPSILON) {
    return {
      ok: false,
      code: "amount_exceeds_balance",
      message: "Stripe payment exceeds the remaining balance.",
    };
  }

  const payments = normalizePayments(source.payments);
  const stripeSessionId = asText(paymentInput?.stripeSessionId || paymentInput?.sessionId);
  const stripePaymentIntentId = asText(paymentInput?.stripePaymentIntentId || paymentInput?.paymentIntentId);
  const stripeAccountId = asText(paymentInput?.stripeAccountId);
  const stripeEventId = asText(paymentInput?.stripeEventId);
  const stripeSyncKey = asText(paymentInput?.stripeSyncKey || stripePaymentIntentId || stripeSessionId);

  if (stripePaymentIntentId && payments.some((payment) => asText(payment?.stripePaymentIntentId) === stripePaymentIntentId)) {
    return {
      ok: false,
      code: "duplicate_payment_intent",
      message: "This Stripe payment is already synced.",
    };
  }

  if (stripeSessionId && payments.some((payment) => asText(payment?.stripeSessionId) === stripeSessionId)) {
    return {
      ok: false,
      code: "duplicate_session",
      message: "This Stripe payment is already synced.",
    };
  }

  if (!stripeSessionId && !stripePaymentIntentId) {
    return {
      ok: false,
      code: "missing_stripe_reference",
      message: "Missing Stripe payment reference.",
    };
  }

  const nextPayment = {
    id: createPaymentId(),
    amount,
    paidAt: normalizeIsoDate(paymentInput?.paidAt || paymentInput?.date, todayParts(new Date(now))),
    note: asText(paymentInput?.note) || "Stripe Checkout",
    method: "stripe",
    order: payments.length,
    stripeSessionId,
    stripePaymentIntentId,
    stripeAccountId,
    stripeEventId,
    stripeSyncKey,
    paymentMethodType: asText(paymentInput?.paymentMethodType),
    cardBrand: asText(paymentInput?.cardBrand),
    cardLast4: asText(paymentInput?.cardLast4),
    receiptEmail: asText(paymentInput?.receiptEmail),
    receiptUrl: asText(paymentInput?.receiptUrl),
    stripePaymentStatus: asText(paymentInput?.stripePaymentStatus),
    currency: asText(paymentInput?.currency),
  };
  const nextAmountPaid = roundCurrency(source.amountPaid + amount);
  const isPaidInFull = nextAmountPaid >= source.invoiceTotal - EPSILON;

  return {
    ok: true,
    payment: nextPayment,
    invoice: normalizeInvoiceRecord({
      ...source,
      status: isPaidInFull ? INVOICE_STATUSES.PAID : source.status,
      payments: [...payments, nextPayment],
      updatedAt: now,
      savedAt: now,
      ts: now,
    }),
  };
}

export function backfillStripeInvoicePaymentDetails(invoice, paymentInput = {}) {
  const source = normalizeInvoiceRecord(invoice);
  const payments = normalizePayments(source.payments);
  const stripeSessionId = asText(paymentInput?.stripeSessionId || paymentInput?.sessionId);
  const stripePaymentIntentId = asText(paymentInput?.stripePaymentIntentId || paymentInput?.paymentIntentId);

  if (!stripeSessionId && !stripePaymentIntentId) {
    return {
      ok: false,
      code: "missing_stripe_reference",
      message: "Missing Stripe payment reference.",
    };
  }

  const matchIndex = payments.findIndex((payment) => {
    const method = asText(payment?.method).toLowerCase();
    if (method !== "stripe") return false;
    const paymentSessionId = asText(payment?.stripeSessionId || payment?.sessionId);
    const paymentIntentId = asText(payment?.stripePaymentIntentId || payment?.paymentIntentId);
    return (
      (stripePaymentIntentId && paymentIntentId && paymentIntentId === stripePaymentIntentId)
      || (stripeSessionId && paymentSessionId && paymentSessionId === stripeSessionId)
    );
  });

  if (matchIndex < 0) {
    return {
      ok: false,
      code: "payment_not_found",
      message: "This Stripe payment is not recorded in EstiPaid.",
    };
  }

  const existingPayment = payments[matchIndex];
  const mergedPayment = {
    ...existingPayment,
    paymentMethodType: asText(paymentInput?.paymentMethodType) || asText(existingPayment?.paymentMethodType),
    cardBrand: asText(paymentInput?.cardBrand) || asText(existingPayment?.cardBrand),
    cardLast4: asText(paymentInput?.cardLast4) || asText(existingPayment?.cardLast4),
    receiptEmail: asText(paymentInput?.receiptEmail) || asText(existingPayment?.receiptEmail),
    receiptUrl: asText(paymentInput?.receiptUrl) || asText(existingPayment?.receiptUrl),
    stripePaymentStatus: asText(paymentInput?.stripePaymentStatus) || asText(existingPayment?.stripePaymentStatus),
    currency: asText(paymentInput?.currency) || asText(existingPayment?.currency),
  };

  const changed = (
    mergedPayment.paymentMethodType !== asText(existingPayment?.paymentMethodType)
    || mergedPayment.cardBrand !== asText(existingPayment?.cardBrand)
    || mergedPayment.cardLast4 !== asText(existingPayment?.cardLast4)
    || mergedPayment.receiptEmail !== asText(existingPayment?.receiptEmail)
    || mergedPayment.receiptUrl !== asText(existingPayment?.receiptUrl)
    || mergedPayment.stripePaymentStatus !== asText(existingPayment?.stripePaymentStatus)
    || mergedPayment.currency !== asText(existingPayment?.currency)
  );

  if (!changed) {
    return {
      ok: true,
      changed: false,
      payment: existingPayment,
      invoice: source,
    };
  }

  const nextPayments = payments.map((payment, index) => (
    index === matchIndex ? mergedPayment : payment
  ));

  return {
    ok: true,
    changed: true,
    payment: mergedPayment,
    invoice: normalizeInvoiceRecord({
      ...source,
      payments: nextPayments,
    }),
  };
}
