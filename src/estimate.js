// src/estimate.js
import { computeTotals } from "./estimator/engine";

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

  const markupPctRaw = toNum(materialsMarkupPct);
  const markupPct = Number.isFinite(markupPctRaw) ? markupPctRaw : 20;

  const riskFeeNum = toNum(hazardFee);
  const computed = computeTotals({
    ui: { materialsMode: "blanket" },
    labor: {
      multiplier: toNum(laborMultiplier) || 1,
      hazardPct: 0,
      riskPct: 0,
      lines: lines.map((l, idx) => ({
        id: String(l?.id ?? `legacy_l_${idx}`),
        qty: toQty(l?.qty),
        hours: toNum(l?.hours),
        rate: toNum(l?.rate),
        markupPct: 0,
        trueRateInternal: 0,
      })),
    },
    materials: {
      blanketCost: toNum(materialsCost),
      blanketInternalCost: 0,
      markupPct,
      items: [],
    },
  });

  const laborBase = toNum(computed?.labor?.subtotal);
  const laborAdjusted = toNum(computed?.laborAfterMultiplier);
  const materialsBilled = toNum(computed?.materials?.totalRevenue);
  const total = laborAdjusted + materialsBilled + riskFeeNum;

  return {
    laborBase,
    laborAdjusted,
    materialsBilled,
    total,
    materialsMarkupPct: markupPct,
  };
}
