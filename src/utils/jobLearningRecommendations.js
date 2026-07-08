// @ts-nocheck
/* eslint-disable */

const MAX_RECOMMENDATIONS = 12;
const SECTION_KEYS = ["scope", "labor", "materials"];
const ALLOWED_LEVELS = new Set(["info", "watch", "ready", "blocked"]);
const ALLOWED_AREAS = new Set(["scope", "labor", "materials", "workflow", "registry", "system"]);

function safeString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSnapshot(snapshot) {
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
}

function normalizeAnomalies(anomalies) {
  if (!anomalies || typeof anomalies !== "object" || Array.isArray(anomalies)) return {};
  return anomalies;
}

function countAnomalies(anomalies) {
  return Object.values(normalizeAnomalies(anomalies)).reduce((sum, value) => (
    sum + (Array.isArray(value) ? value.length : 0)
  ), 0);
}

function normalizeSection(sectionKey, section) {
  const source = section && typeof section === "object" && !Array.isArray(section) ? section : {};
  return {
    sectionKey,
    confidenceScore: clamp(safeNumber(source.confidenceScore, 0)),
    rewriteSignalStrength: clamp(safeNumber(source.rewriteSignalStrength, 0)),
    validationFailureRate: clamp(safeNumber(source.validationFailureRate, 0)),
    acceptanceRate: clamp(safeNumber(source.acceptanceRate, 0)),
    saveCompletionRate: clamp(safeNumber(source.saveCompletionRate, 0)),
  };
}

function buildRecommendation(id, level, area, message, reason) {
  return {
    id,
    level,
    area,
    message,
    reason,
    runtimeActionAllowed: false,
  };
}

export function getJobLearningRecommendations(snapshot) {
  try {
    const source = normalizeSnapshot(snapshot);
    const totalEvents = Math.max(0, Math.floor(safeNumber(source.stats?.totalEvents, 0)));
    const anomalies = normalizeAnomalies(source.anomalies);
    const anomalyCount = countAnomalies(anomalies);
    const candidateReadiness = normalizeSnapshot(source.candidateReadiness);
    const healthSummary = normalizeSnapshot(source.healthSummary);
    const sectionSignals = normalizeSnapshot(source.sectionStabilitySignals);
    const recommendations = [];

    if (totalEvents <= 0) {
      return [
        buildRecommendation(
          "system-no-data",
          "info",
          "system",
          "No job learning data is available yet.",
          "The advisory snapshot has no usable events, so learning health and reuse readiness cannot be evaluated."
        ),
      ];
    }

    if (anomalyCount > 0) {
      recommendations.push(buildRecommendation(
        "registry-anomalies-detected",
        "blocked",
        "registry",
        "Registry anomalies should be resolved before any reuse decisions are considered.",
        `The snapshot reports ${anomalyCount} registry anomaly signal${anomalyCount === 1 ? "" : "s"}, which blocks trust in advisory reuse readiness.`
      ));
    }

    const highConfidenceButNotApprovedCount = Math.max(
      0,
      Math.floor(safeNumber(candidateReadiness.highConfidenceButNotApprovedCount, 0))
    );
    if (highConfidenceButNotApprovedCount > 0) {
      recommendations.push(buildRecommendation(
        "workflow-high-confidence-unapproved",
        anomalyCount === 0 ? "ready" : "watch",
        "workflow",
        "High-confidence workflows are present but remain advisory-only.",
        `${highConfidenceButNotApprovedCount} high-confidence workflow candidate${highConfidenceButNotApprovedCount === 1 ? "" : "s"} exist without runtime approval, so they are suitable for review but not activation.`
      ));
    }

    const stableButNotApprovedCount = Math.max(
      0,
      Math.floor(safeNumber(candidateReadiness.stableButNotApprovedCount, 0))
    );
    if (stableButNotApprovedCount > 0) {
      recommendations.push(buildRecommendation(
        "workflow-stable-quarantined",
        "watch",
        "workflow",
        "Stable workflows remain quarantined pending explicit approval.",
        `${stableButNotApprovedCount} stable workflow candidate${stableButNotApprovedCount === 1 ? "" : "s"} are still unapproved, so they should stay outside runtime decisions.`
      ));
    }

    const weakSection = SECTION_KEYS
      .map((sectionKey) => normalizeSection(sectionKey, sectionSignals[sectionKey]))
      .find((section) => section.confidenceScore <= 0.45 || section.rewriteSignalStrength >= 0.4);
    if (weakSection) {
      recommendations.push(buildRecommendation(
        `${weakSection.sectionKey}-rewrite-pressure`,
        "watch",
        weakSection.sectionKey,
        `${weakSection.sectionKey} learning health shows elevated rewrite pressure.`,
        `Confidence is ${weakSection.confidenceScore.toFixed(3)} with rewrite pressure ${weakSection.rewriteSignalStrength.toFixed(3)}, which suggests the section needs more stable accepted outcomes.`
      ));
    }

    const validationRiskSection = SECTION_KEYS
      .map((sectionKey) => normalizeSection(sectionKey, sectionSignals[sectionKey]))
      .find((section) => section.validationFailureRate >= 0.25);
    if (validationRiskSection) {
      recommendations.push(buildRecommendation(
        `${validationRiskSection.sectionKey}-validation-failures`,
        "watch",
        validationRiskSection.sectionKey,
        `${validationRiskSection.sectionKey} is showing repeated validation failures.`,
        `Validation failure rate is ${validationRiskSection.validationFailureRate.toFixed(3)}, which is high enough to weaken advisory confidence in that section.`
      ));
    }

    const strongestSection = SECTION_KEYS
      .map((sectionKey) => normalizeSection(sectionKey, sectionSignals[sectionKey]))
      .sort((a, b) => {
        if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
        return a.sectionKey.localeCompare(b.sectionKey);
      })[0];
    if (strongestSection && strongestSection.confidenceScore >= 0.7) {
      recommendations.push(buildRecommendation(
        `${strongestSection.sectionKey}-strong-stability`,
        anomalyCount === 0 ? "ready" : "info",
        strongestSection.sectionKey,
        `${strongestSection.sectionKey} shows strong section stability.`,
        `Confidence is ${strongestSection.confidenceScore.toFixed(3)} with validation failures at ${strongestSection.validationFailureRate.toFixed(3)}, which makes this section a strong advisory reference point.`
      ));
    }

    const highConfidenceCandidateCount = Math.max(
      0,
      Math.floor(safeNumber(healthSummary.highConfidenceCandidateCount, 0))
    );
    if (highConfidenceCandidateCount > 0 && anomalyCount === 0) {
      recommendations.push(buildRecommendation(
        "system-reuse-readiness",
        "ready",
        "system",
        "Learning data supports future reuse review readiness.",
        `${highConfidenceCandidateCount} high-confidence candidate${highConfidenceCandidateCount === 1 ? "" : "s"} exist with no detected registry anomalies, so advisory review for future reuse planning is justified.`
      ));
    }

    return recommendations
      .slice(0, MAX_RECOMMENDATIONS)
      .map((recommendation) => ({
        ...recommendation,
        runtimeActionAllowed: false,
      }));
  } catch {
    return [
      buildRecommendation(
        "system-no-data",
        "info",
        "system",
        "No job learning data is available yet.",
        "The advisory snapshot could not be interpreted safely, so the recommendation layer returned a no-data result."
      ),
    ];
  }
}

export function summarizeJobLearningRecommendations(recommendations) {
  try {
    const list = Array.isArray(recommendations) ? recommendations : [];
    const normalized = list
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({
        level: ALLOWED_LEVELS.has(item.level) ? item.level : "info",
        area: ALLOWED_AREAS.has(item.area) ? item.area : "system",
      }));

    const byLevel = normalized.reduce((acc, item) => {
      acc[item.level] = (acc[item.level] || 0) + 1;
      return acc;
    }, {
      info: 0,
      watch: 0,
      ready: 0,
      blocked: 0,
    });

    const byArea = normalized.reduce((acc, item) => {
      acc[item.area] = (acc[item.area] || 0) + 1;
      return acc;
    }, {
      scope: 0,
      labor: 0,
      materials: 0,
      workflow: 0,
      registry: 0,
      system: 0,
    });

    return {
      total: normalized.length,
      byLevel,
      byArea,
      readyCount: byLevel.ready,
      blockedCount: byLevel.blocked,
      watchCount: byLevel.watch,
    };
  } catch {
    return {
      total: 0,
      byLevel: {
        info: 0,
        watch: 0,
        ready: 0,
        blocked: 0,
      },
      byArea: {
        scope: 0,
        labor: 0,
        materials: 0,
        workflow: 0,
        registry: 0,
        system: 0,
      },
      readyCount: 0,
      blockedCount: 0,
      watchCount: 0,
    };
  }
}
