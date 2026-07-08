// @ts-nocheck
/* eslint-disable */

import { scopeAssistConfig } from "./adapters/scope";
import { laborAssistConfig } from "./adapters/labor";
import { materialsAssistConfig } from "./adapters/materials";

const AI_ASSIST_REGISTRY = {
  scope: scopeAssistConfig,
  labor: laborAssistConfig,
  materials: materialsAssistConfig,
};

export function normalizeAssistSectionKey(sectionKey) {
  return String(sectionKey ?? "").trim().toLowerCase();
}

export function getAssistConfig(sectionKey) {
  return AI_ASSIST_REGISTRY[normalizeAssistSectionKey(sectionKey)] || null;
}

export default AI_ASSIST_REGISTRY;
