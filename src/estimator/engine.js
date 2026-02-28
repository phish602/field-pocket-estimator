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

export function calcLabor(lines) {
  let subtotal = 0;

  const normalized = (lines || []).map((ln) => {
    const hours = toNum(ln?.hours);
    const rate = toNum(ln?.rate);
    const total = hours * rate;
    subtotal += total;

    return {
      ...ln,
      hours,
      rate,
      total,
    };
  });

  return { subtotal, normalized };
}

export function calcMaterials(mode, materials) {
  if (mode === "itemized") {
    let totalCharge = 0;

    const normalized = (materials?.items || []).map((it) => {
      const qty = toNum(it?.qty);
      const priceEach = toNum(it?.priceEach);
      const charge = qty * priceEach;
      totalCharge += charge;

      return { ...it, qty, priceEach, charge };
    });

    return { totalCharge, normalized };
  }

  const base = toNum(materials?.blanketCost);
  const markupPct = clampNum(materials?.markupPct, 0, 400);
  const totalCharge = base * (1 + markupPct / 100);

  return { totalCharge, normalized: [] };
}

export function computeTotals(state) {
  const labor = calcLabor(state?.labor?.lines || []);
  const hazardPct = clampNum(state?.labor?.hazardPct, 0, 200);
  const multiplier = clampNum(state?.labor?.multiplier, 0.25, 5);

  const hazardAmount = labor.subtotal * (hazardPct / 100);
  const laborAfterMultiplier = (labor.subtotal + hazardAmount) * multiplier;

  const materials = calcMaterials(
    state?.ui?.materialsMode === "itemized" ? "itemized" : "blanket",
    state?.materials
  );

  const grandTotal = laborAfterMultiplier + materials.totalCharge;

  return {
    labor,
    hazardAmount,
    laborAfterMultiplier,
    materials,
    grandTotal,
  };
}
