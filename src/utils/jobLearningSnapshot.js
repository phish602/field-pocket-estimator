// @ts-nocheck
/* eslint-disable */

import { readJobLearningEvents } from "./jobLearningStore";
import {
  getLearningAcceptanceRates,
  getLearningEditSignals,
  getLearningEventStats,
  getLearningWorkflowSequences,
} from "./jobLearningAnalysis";
import {
  deriveLearningHealthSummary,
  deriveSaveCompletionPatterns,
  deriveSectionStabilitySignals,
  deriveWorkflowPatternCandidates,
} from "./jobPatternCandidates";
import {
  createJobPatternRegistry,
  summarizeRegistryHealth,
} from "./jobPatternRegistry";
import {
  detectRegistryAnomalies,
  summarizeCandidateReadiness,
  summarizeSectionHealth,
  summarizeWorkflowStrength,
} from "./jobPatternDiagnostics";

function safeString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function buildEmptySnapshot() {
  const stats = getLearningEventStats([]);
  const workflowSequences = getLearningWorkflowSequences([]);
  const acceptanceRates = getLearningAcceptanceRates([]);
  const editSignals = getLearningEditSignals([]);
  const workflowCandidates = deriveWorkflowPatternCandidates([]);
  const sectionStabilitySignals = deriveSectionStabilitySignals([]);
  const saveCompletionPatterns = deriveSaveCompletionPatterns([]);
  const healthSummary = deriveLearningHealthSummary([]);
  const registry = createJobPatternRegistry(workflowCandidates);
  const registryHealth = summarizeRegistryHealth(registry);
  const workflowStrength = summarizeWorkflowStrength(registry);
  const sectionHealth = summarizeSectionHealth(sectionStabilitySignals);
  const candidateReadiness = summarizeCandidateReadiness(registry);
  const anomalies = detectRegistryAnomalies(registry);

  return {
    generatedAt: null,
    stats,
    workflowSequences,
    acceptanceRates,
    editSignals,
    workflowCandidates,
    sectionStabilitySignals,
    saveCompletionPatterns,
    healthSummary,
    registry,
    registryHealth,
    workflowStrength,
    sectionHealth,
    candidateReadiness,
    anomalies,
  };
}

export function buildJobLearningSnapshot(events) {
  try {
    const sourceEvents = Array.isArray(events) ? events.slice() : [];
    const stats = getLearningEventStats(sourceEvents);
    const workflowSequences = getLearningWorkflowSequences(sourceEvents);
    const acceptanceRates = getLearningAcceptanceRates(sourceEvents);
    const editSignals = getLearningEditSignals(sourceEvents);
    const workflowCandidates = deriveWorkflowPatternCandidates(sourceEvents);
    const sectionStabilitySignals = deriveSectionStabilitySignals(sourceEvents);
    const saveCompletionPatterns = deriveSaveCompletionPatterns(sourceEvents);
    const healthSummary = deriveLearningHealthSummary(sourceEvents);
    const registry = createJobPatternRegistry(workflowCandidates);
    const registryHealth = summarizeRegistryHealth(registry);
    const workflowStrength = summarizeWorkflowStrength(registry);
    const sectionHealth = summarizeSectionHealth(sectionStabilitySignals);
    const candidateReadiness = summarizeCandidateReadiness(registry);
    const anomalies = detectRegistryAnomalies(registry);

    return {
      generatedAt: Date.now(),
      stats,
      workflowSequences,
      acceptanceRates,
      editSignals,
      workflowCandidates,
      sectionStabilitySignals,
      saveCompletionPatterns,
      healthSummary,
      registry,
      registryHealth,
      workflowStrength,
      sectionHealth,
      candidateReadiness,
      anomalies,
    };
  } catch {
    return buildEmptySnapshot();
  }
}

export function buildJobLearningSnapshotFromStore() {
  try {
    const events = readJobLearningEvents();
    return buildJobLearningSnapshot(Array.isArray(events) ? events : []);
  } catch {
    return buildJobLearningSnapshot([]);
  }
}

export function summarizeJobLearningSnapshot(snapshot) {
  try {
    const source = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? snapshot
      : buildEmptySnapshot();
    const anomalies = source.anomalies && typeof source.anomalies === "object" && !Array.isArray(source.anomalies)
      ? source.anomalies
      : {};
    const anomalyCount = Object.values(anomalies).reduce((sum, value) => (
      sum + (Array.isArray(value) ? value.length : 0)
    ), 0);
    const strongestWorkflowId = safeString(source.workflowStrength?.strongestWorkflows?.[0]?.registryId);

    return {
      totalEvents: Math.max(0, Math.floor(safeNumber(source.stats?.totalEvents, 0))),
      stableWorkflowCount: Math.max(0, Math.floor(safeNumber(source.registryHealth?.stableCount, 0))),
      highConfidenceCandidateCount: Math.max(0, Math.floor(safeNumber(source.healthSummary?.highConfidenceCandidateCount, 0))),
      anomalyCount: Math.max(0, Math.floor(safeNumber(anomalyCount, 0))),
      runtimeApprovedCount: Math.max(0, Math.floor(safeNumber(source.registryHealth?.runtimeApprovedCount, 0))),
      reusableEnabledCount: Math.max(0, Math.floor(safeNumber(source.registryHealth?.reusableEnabledCount, 0))),
      weakestSection: safeString(source.sectionHealth?.weakestSection?.sectionKey),
      strongestWorkflowId,
      generatedAt: source.generatedAt ?? null,
    };
  } catch {
    return {
      totalEvents: 0,
      stableWorkflowCount: 0,
      highConfidenceCandidateCount: 0,
      anomalyCount: 0,
      runtimeApprovedCount: 0,
      reusableEnabledCount: 0,
      weakestSection: "",
      strongestWorkflowId: "",
      generatedAt: null,
    };
  }
}
