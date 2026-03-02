// @ts-nocheck
/* eslint-disable */

export function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function clampNum(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function safePct(numerator, denominator) {
  const den = toNum(denominator);
  if (den <= 0) return 0;
  return toNum(numerator) / den;
}

export function calcLabor(lines) {
  let subtotal = 0;
  let totalRevenue = 0;
  let totalCost = 0;

  const normalized = (lines || []).map((ln) => {
    const qty = Math.max(1, toNum(ln?.qty) || 1);
    const hours = toNum(ln?.hours);
    const rate = toNum(ln?.rate);
    const trueRateInternal = toNum(ln?.trueRateInternal ?? ln?.internalRate);
    const total = qty * hours * rate;
    const internalCost = qty * hours * trueRateInternal;
    const grossProfit = total - internalCost;
    const marginPct = safePct(grossProfit, total);
    subtotal += total;
    totalRevenue += total;
    totalCost += internalCost;

    return {
      ...ln,
      qty,
      hours,
      rate,
      trueRateInternal,
      total,
      internalCost,
      grossProfit,
      marginPct,
    };
  });

  return {
    subtotal,
    totalRevenue,
    totalCost,
    grossProfit: totalRevenue - totalCost,
    marginPct: safePct(totalRevenue - totalCost, totalRevenue),
    normalized,
  };
}

export function calcMaterials(mode, materials) {
  if (mode === "itemized") {
    let totalCharge = 0;
    let totalRevenue = 0;
    let totalCost = 0;

    const normalized = (materials?.items || []).map((it) => {
      const qty = toNum(it?.qty);
      const priceEach = toNum(it?.priceEach);
      const unitCostInternal = toNum(it?.unitCostInternal ?? it?.costInternal);
      const charge = qty * priceEach;
      const internalCost = qty * unitCostInternal;
      const grossProfit = charge - internalCost;
      const marginPct = safePct(grossProfit, charge);
      totalCharge += charge;
      totalRevenue += charge;
      totalCost += internalCost;

      return { ...it, qty, priceEach, unitCostInternal, charge, internalCost, grossProfit, marginPct };
    });

    return {
      totalCharge,
      totalRevenue,
      totalCost,
      grossProfit: totalRevenue - totalCost,
      marginPct: safePct(totalRevenue - totalCost, totalRevenue),
      normalized,
    };
  }

  const base = toNum(materials?.blanketCost);
  const markupPct = clampNum(materials?.markupPct, 0, 400);
  const totalCharge = base * (1 + markupPct / 100);
  const blanketInternalCost = toNum(materials?.blanketInternalCost);

  return {
    totalCharge,
    totalRevenue: totalCharge,
    totalCost: blanketInternalCost,
    grossProfit: totalCharge - blanketInternalCost,
    marginPct: safePct(totalCharge - blanketInternalCost, totalCharge),
    normalized: [],
  };
}

export function computeTotals(state) {
  const labor = calcLabor(state?.labor?.lines || []);
  const hazardPct = clampNum(state?.labor?.hazardPct, 0, 200);
  const riskPct = clampNum(state?.labor?.riskPct, 0, 200);
  const multiplier = clampNum(state?.labor?.multiplier, 0.25, 5);

  const laborAfterMultiplier = labor.subtotal * multiplier;
  const hazardAmount = laborAfterMultiplier * (hazardPct / 100);
  const riskAmount = laborAfterMultiplier * (riskPct / 100);
  const laborAfterAdjustments = laborAfterMultiplier + hazardAmount + riskAmount;

  const materials = calcMaterials(
    state?.ui?.materialsMode === "itemized" ? "itemized" : "blanket",
    state?.materials
  );

  const totalRevenue = laborAfterAdjustments + materials.totalRevenue;
  const totalCost = labor.totalCost + materials.totalCost;
  const grossProfit = totalRevenue - totalCost;
  const grossMarginPct = safePct(grossProfit, totalRevenue);
  const grandTotal = totalRevenue;

  return {
    labor,
    hazardPct,
    riskPct,
    multiplier,
    hazardAmount,
    riskAmount,
    laborAfterMultiplier,
    laborAfterAdjustments,
    materials,
    totalRevenue,
    totalCost,
    grossProfit,
    grossMarginPct,
    grandTotal,
  };
}
