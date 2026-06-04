// @ts-nocheck
/* eslint-disable */

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clonePlain(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) return value.map((entry) => clonePlain(entry));
    if (isPlainObject(value)) {
      const next = {};
      Object.keys(value).forEach((key) => {
        next[key] = clonePlain(value[key]);
      });
      return next;
    }
    return value;
  }
}

function asText(value) {
  return String(value ?? "").trim();
}

function formatCountLine(label, value) {
  return `${label}: ${Number.isFinite(value) ? value : 0}`;
}

function formatWarningSection(title, warnings = []) {
  const lines = [`${title}:`];
  if (!Array.isArray(warnings) || warnings.length === 0) {
    lines.push("  None");
    return lines;
  }

  warnings.forEach((warning, index) => {
    const code = asText(warning?.code);
    const message = asText(warning?.message);
    const entityType = asText(warning?.entityType);
    const entityId = asText(warning?.entityId);
    const detailParts = [];
    if (code) detailParts.push(code);
    if (entityType) detailParts.push(entityType);
    if (entityId) detailParts.push(entityId);
    const prefix = `  ${index + 1}.`;
    const tail = message ? ` - ${message}` : "";
    lines.push(`${prefix} ${detailParts.join(" / ")}${tail}`.trimEnd());
  });

  return lines;
}

function buildDraftJsonBlock(preview) {
  const draftJson = JSON.stringify(preview?.draft ?? {}, null, 0);
  return ["", "Draft JSON:", draftJson];
}

export function formatBackendMigrationPreviewReport(preview = {}, options = {}) {
  const source = isPlainObject(preview) ? clonePlain(preview) : {};
  const includeDraftJson = options?.includeDraftJson === true;
  const counts = isPlainObject(source?.entityCounts) ? source.entityCounts : {};
  const summary = isPlainObject(source?.warningSummary) ? source.warningSummary : {};
  const warningsBySeverity = isPlainObject(source?.warningsBySeverity) ? source.warningsBySeverity : {};
  const blockerWarnings = Array.isArray(warningsBySeverity.blocker) ? warningsBySeverity.blocker : [];
  const needsReviewWarnings = Array.isArray(warningsBySeverity.needsReview) ? warningsBySeverity.needsReview : [];
  const informationalWarnings = Array.isArray(warningsBySeverity.informational) ? warningsBySeverity.informational : [];
  const status = source?.canProceed ? "Ready for review" : "Blocked";
  const lines = [
    "EstiPaid Backend Migration Preview Report",
    `Mapping version: ${asText(source?.mappingVersion) || "unknown"}`,
    `Generated at: ${asText(source?.generatedAtIso) || "unknown"}`,
    `Status: ${status}`,
    `Can proceed: ${source?.canProceed ? "Yes" : "No"}`,
    "",
    "Entity counts:",
    formatCountLine("  Companies", counts.companies),
    formatCountLine("  Customers", counts.customers),
    formatCountLine("  Projects", counts.projects),
    formatCountLine("  Estimates", counts.estimates),
    formatCountLine("  Invoices", counts.invoices),
    formatCountLine("  Invoice payments", counts.invoicePayments),
    formatCountLine("  Scope templates", counts.scopeTemplates),
    formatCountLine("  Settings", counts.settings),
    formatCountLine("  Audit events", counts.auditEvents),
    "",
    "Warning summary:",
    formatCountLine("  Blocker warnings", summary.blocker),
    formatCountLine("  Needs review warnings", summary.needsReview),
    formatCountLine("  Informational warnings", summary.informational),
    "",
    ...formatWarningSection("Blockers", blockerWarnings),
    "",
    ...formatWarningSection("Needs Review", needsReviewWarnings),
    "",
    ...formatWarningSection("Informational", informationalWarnings),
    "",
    "This is a dry-run report only. No backend writes have been performed.",
  ];

  if (includeDraftJson) {
    lines.push(...buildDraftJsonBlock(source));
  }

  return lines.join("\n");
}
