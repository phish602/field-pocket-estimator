// @ts-nocheck
import { calculateEstimateWithLaborLines } from "../estimate";

export function calcLabor(laborLines, multiplier) {
  const result = calculateEstimateWithLaborLines(laborLines, 0, multiplier, 0, 0);
  return { laborBase: result.laborBase, laborAdjusted: result.laborAdjusted };
}

export function calcMaterials(materialsCost, markupPct) {
  const result = calculateEstimateWithLaborLines([], materialsCost, 1, 0, markupPct);
  return { materialsBilled: result.materialsBilled };
}

export function computeTotals(laborLines, materialsCost, multiplier, hazardFee, markupPct) {
  return calculateEstimateWithLaborLines(laborLines, materialsCost, multiplier, hazardFee, markupPct);
}
