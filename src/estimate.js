// src/estimate.js

const toNum = (x) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
};

const toQty = (x) => {
  const v = Math.floor(Number(x));
  return Number.isFinite(v) && v > 0 ? v : 1;
};

export function calculateEstimateWithLaborLines(
  laborLines,
  materialsCost,
  laborMultiplier,
  hazardFee,
  materialsMarkupPct
) {
  const lines = Array.isArray(laborLines) ? laborLines : [];

  const laborBase = lines.reduce((sum, l) => {
    const qty = toQty(l?.qty);
    const hours = toNum(l?.hours);
    const rate = toNum(l?.rate);
    return sum + qty * hours * rate;
  }, 0);

  const mult = toNum(laborMultiplier) || 1;
  const laborAdjusted = laborBase * mult;

  const markupPctRaw = toNum(materialsMarkupPct);
  const markupPct = Number.isFinite(markupPctRaw) ? markupPctRaw : 20;

  const matCost = toNum(materialsCost);
  const materialsBilled = matCost * (1 + markupPct / 100);

  const riskFeeNum = toNum(hazardFee);
  const total = laborAdjusted + materialsBilled + riskFeeNum;

  return {
    laborBase,
    laborAdjusted,
    materialsBilled,
    total,
    materialsMarkupPct: markupPct,
  };
}
