// @ts-nocheck
/* eslint-disable */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { GUIDED_AUDIT_STATUS } from "./registry";
import { formatOperationValue } from "./writeback";

const ESTIPAID_GUIDED_TRACE_KEY = "__ESTIPAID_GUIDED_TRACE__";
const ESTIPAID_GUIDED_DEBUG_KEY = "__ESTIPAID_GUIDED_DEBUG__";

function shouldUseEstiPaidGuidedDebugGate() {
  if (typeof window === "undefined") return false;
  try {
    const queryEnabled = typeof window.location?.search === "string"
      && new URLSearchParams(window.location.search).get(ESTIPAID_GUIDED_DEBUG_KEY) === "1";
    return window[ESTIPAID_GUIDED_DEBUG_KEY] === true
      || window.localStorage?.getItem(ESTIPAID_GUIDED_DEBUG_KEY) === "1"
      || queryEnabled;
  } catch {
    return window[ESTIPAID_GUIDED_DEBUG_KEY] === true;
  }
}

function shouldTraceEstiPaidGuidedRuntime() {
  if (typeof window === "undefined") return false;
  try {
    return window[ESTIPAID_GUIDED_TRACE_KEY] === true
      || window.localStorage?.getItem(ESTIPAID_GUIDED_TRACE_KEY) === "1"
      || shouldUseEstiPaidGuidedDebugGate();
  } catch {
    return window[ESTIPAID_GUIDED_TRACE_KEY] === true || shouldUseEstiPaidGuidedDebugGate();
  }
}

function traceEstiPaidGuidedRuntime(source, event, payload = {}) {
  if (!shouldTraceEstiPaidGuidedRuntime()) return;
  try {
    console.info(`[ESTIPAID_GUIDED_TRACE][${source}] ${event}`, payload);
  } catch {}
}

function statusLabel(status) {
  if (status === GUIDED_AUDIT_STATUS.COMPLETE) return "Looks good";
  if (status === GUIDED_AUDIT_STATUS.INFERRED) return "Auto-filled";
  if (status === GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION) return "Check this";
  if (status === GUIDED_AUDIT_STATUS.MISSING) return "Still needed";
  return "Not started";
}

function statusClassName(status) {
  if (status === GUIDED_AUDIT_STATUS.COMPLETE) return "is-complete";
  if (status === GUIDED_AUDIT_STATUS.INFERRED) return "is-inferred";
  if (status === GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION) return "is-confirm";
  if (status === GUIDED_AUDIT_STATUS.MISSING) return "is-missing";
  return "";
}

function getCoveredFieldCount(counts = {}) {
  return Number(counts?.complete || 0)
    + Number(counts?.inferred || 0)
    + Number(counts?.needs_confirmation || 0);
}

function getTotalFieldCount(counts = {}, reviewFields = []) {
  if (Array.isArray(reviewFields) && reviewFields.length) return reviewFields.length;
  return Number(counts?.complete || 0)
    + Number(counts?.inferred || 0)
    + Number(counts?.needs_confirmation || 0)
    + Number(counts?.missing || 0);
}

function normalizeGuidedHeaderProgressPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function getProgressPercentFromAudit(audit = {}) {
  const counts = audit?.counts || {};
  const reviewFields = Array.isArray(audit?.fields) ? audit.fields : [];
  const totalFieldCount = getTotalFieldCount(counts, reviewFields);
  if (totalFieldCount <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((getCoveredFieldCount(counts) / totalFieldCount) * 100)));
}

function getGuidedHeaderProgressMode(guided = {}) {
  return String(guided?.headerProgressMode || "normal").trim() || "normal";
}

function normalizeSummaryItems(summary) {
  return Array.isArray(summary?.items)
    ? summary.items.filter((item) => String(item?.label || "").trim() && String(item?.value || "").trim())
    : [];
}

function normalizeSummaryHighlights(summary) {
  return Array.isArray(summary?.highlights)
    ? summary.highlights.filter((item) => String(item?.label || "").trim() && String(item?.value || "").trim())
    : [];
}

function findNextActionSection(sections = []) {
  const priority = [
    GUIDED_AUDIT_STATUS.MISSING,
    GUIDED_AUDIT_STATUS.NEEDS_CONFIRMATION,
    GUIDED_AUDIT_STATUS.INFERRED,
  ];

  for (const status of priority) {
    const match = sections.find((section) => section?.status === status);
    if (match?.key) return match;
  }

  return sections.find((section) => String(section?.status || "").trim() !== GUIDED_AUDIT_STATUS.COMPLETE) || null;
}

export default function GuidedBuildOverlay(props) {
  const {
    guided,
    summary,
    isThinking,
    pendingStepKey,
    pendingSectionKey,
    onClose,
    onSubmitAnswer,
    onSelectChoice,
    onSkip,
    onOpenReview,
    onJumpToSection,
    onConfirmPending,
    onRejectPending,
  } = props || {};

  const [draft, setDraft] = useState("");
  const submitLockRef = useRef(false);
  const reviewSections = guided?.completionAudit?.sections || [];
  const reviewFields = guided?.completionAudit?.fields || [];
  const thinking = !!(isThinking ?? guided?.isThinking);
  const activeSectionKey = pendingSectionKey || guided?.pendingSectionKey || guided?.currentSection;
  const activeSectionLabel = reviewSections.find((section) => section.key === activeSectionKey)?.label || activeSectionKey || "";
  const activeFieldLabel = guided?.currentField?.label
    || (pendingStepKey || guided?.pendingStepKey || "")
      .split(".")
      .filter(Boolean)
      .slice(-1)[0]
      .replace(/([A-Z])/g, " $1")
      .trim();
  const sectionSummary = useMemo(() => {
    return reviewSections.map((section) => ({
      ...section,
      active: section.key === guided?.currentSection,
    }));
  }, [guided?.currentSection, reviewSections]);
  const counts = guided?.completionAudit?.counts || {};
  const headerProgressAudit = guided?.headerProgressAudit || null;
  const headerProgressMode = getGuidedHeaderProgressMode(guided);
  const coveredFieldCount = getCoveredFieldCount(counts);
  const totalFieldCount = getTotalFieldCount(counts, reviewFields);
  const rawCompletionAuditPercent = totalFieldCount > 0
    ? Math.max(0, Math.min(100, Math.round((coveredFieldCount / totalFieldCount) * 100)))
    : 0;
  const headerProgressAuditPercent = headerProgressAudit ? getProgressPercentFromAudit(headerProgressAudit) : null;
  const explicitHeaderProgressPercent = normalizeGuidedHeaderProgressPercent(guided?.headerProgressPercent);
  const isCanonicalBlank = headerProgressMode === "canonicalBlank" || guided?.isCanonicalBlankDisplay === true;
  // Never use rawCompletionAuditPercent as shownPercent — it scores ~79% on blank estimates because
  // isFieldMissing() returns false (COMPLETE) for most required fields by default. Use explicit
  // headerProgressPercent (always 0 on blank states from the hook) as the safe fallback instead.
  const shownPercent = isCanonicalBlank
    ? (explicitHeaderProgressPercent ?? 0)
    : (headerProgressAuditPercent ?? explicitHeaderProgressPercent ?? 0);
  const progressPercentSource = isCanonicalBlank
    ? "headerProgressPercent"
    : (headerProgressAuditPercent !== null
      ? (guided?.headerProgressSource || "headerProgressAudit")
      : (explicitHeaderProgressPercent !== null ? "headerProgressPercent" : "fallback-0"));
  const showDevelopmentHeaderDebug = shouldUseEstiPaidGuidedDebugGate();
  const visibleHeaderDebugLabel = showDevelopmentHeaderDebug
    ? `GBHDR-V3 mode=${headerProgressMode} blank=${isCanonicalBlank ? 1 : 0} shown=${shownPercent} hdr=${explicitHeaderProgressPercent ?? "na"} audit=${headerProgressAuditPercent ?? "na"} raw=${rawCompletionAuditPercent} cbd=${guided?.isCanonicalBlankDisplay ? 1 : 0} fcb=${guided?.failClosedBlankDisplayGuard ? 1 : 0}`
    : "";
  const currentSectionIndex = Math.max(0, sectionSummary.findIndex((section) => section.key === activeSectionKey));
  const currentSectionStepLabel = sectionSummary.length
    ? `Section ${Math.min(currentSectionIndex + 1, sectionSummary.length)} of ${sectionSummary.length}`
    : "Guided intake";
  const nextActionSection = useMemo(() => findNextActionSection(reviewSections), [reviewSections]);
  const summaryItems = useMemo(() => normalizeSummaryItems(summary), [summary]);
  const summaryHighlights = useMemo(() => normalizeSummaryHighlights(summary), [summary]);
  const canContinueWithText = String(draft || "").trim().length > 0 && !thinking && !guided?.isLoading;
  const hasPendingConfirmations = Array.isArray(guided?.pendingConfirmations) && guided.pendingConfirmations.length > 0;
  const reviewReady = guided?.reviewReadiness?.ready === true && !hasPendingConfirmations;
  const overlayTraceKeyRef = useRef("");

  useEffect(() => {
    const payload = {
      fileMarker: "src/estimator/guided/GuidedBuildOverlay.js",
      guidedEnabled: guided?.enabled === true,
      isCanonicalBlankDisplay: guided?.isCanonicalBlankDisplay === true,
      headerSources: {
        sectionLabel: "guided.currentSection + guided.completionAudit.sections",
        progressPercent: "canonicalBlank mode => guided.headerProgressPercent ?? 0; else guided.headerProgressAudit; else guided.completionAudit.counts/fields",
        promptText: "guided.assistantMessage",
        blockerIdentity: "guided.currentQuestion + guided.activeStepId",
      },
      activeSectionKey,
      activeSectionLabel,
      activeFieldLabel,
      currentSectionStepLabel,
      progressPercent: shownPercent,
      currentSection: guided?.currentSection || "",
      currentQuestion: guided?.currentQuestion || "",
      activeStepId: guided?.activeStepId || "",
      assistantMessage: guided?.assistantMessage || "",
      headerProgressMode,
      progressPercentSource,
      headerProgressPercent: guided?.headerProgressPercent ?? null,
      headerProgressCounts: headerProgressAudit?.counts || null,
      headerProgressAuditPercent,
      rawCompletionAuditPercent,
      completionAuditCounts: guided?.completionAudit?.counts || null,
      reviewReadiness: guided?.reviewReadiness || null,
      unresolvedRequiredFields: Array.isArray(guided?.unresolvedRequiredFields) ? guided.unresolvedRequiredFields : [],
    };
    const key = JSON.stringify(payload);
    if (key === overlayTraceKeyRef.current) return;
    overlayTraceKeyRef.current = key;
    traceEstiPaidGuidedRuntime("GuidedBuildOverlay.js", "render-snapshot", payload);
  }, [
    activeFieldLabel,
    activeSectionKey,
    activeSectionLabel,
    currentSectionStepLabel,
    guided,
    headerProgressMode,
    shownPercent,
  ]);

  useEffect(() => {
    setDraft("");
  }, [guided?.currentQuestion, guided?.reviewOpen]);

  useEffect(() => {
    submitLockRef.current = false;
  }, [guided?.currentQuestion, guided?.reviewOpen, guided?.assistantMessage]);

  const handleContinue = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const submissionText = String(draft || "").trim();
    if (!submissionText || !canContinueWithText || submitLockRef.current) return;
    submitLockRef.current = true;
    try {
      const submitResult = onSubmitAnswer(submissionText);
      setDraft("");
      Promise.resolve(submitResult).finally(() => {
        submitLockRef.current = false;
      });
    } catch (error) {
      submitLockRef.current = false;
      throw error;
    }
  };

  const handleInputKeyDown = (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    handleContinue(event);
  };

  const handleResumeFromReview = () => {
    if (thinking) return;
    if (reviewReady) {
      onClose();
      return;
    }
    if (!nextActionSection?.key) return;
    onJumpToSection(nextActionSection.key);
  };

  const handleOpenReview = () => {
    if (thinking || hasPendingConfirmations) return;
    onOpenReview();
  };

  if (!guided?.enabled) return null;

  return (
    <div className="pe-guided-overlay" role="dialog" aria-modal="true" aria-label="Guided Build">
      <div className="pe-guided-shell">

        {/* ── Header: title + tiny progress ── */}
        <div className="pe-guided-header">
          <div className="pe-guided-eyebrow">Guided Build</div>
          <div className="pe-guided-title">
            {guided?.mode === "invoice" ? "Invoice Builder" : "Estimate Builder"}
          </div>
          <div className="pe-guided-progress-line">
            <span>{guided?.reviewOpen ? "Review" : currentSectionStepLabel}{!guided?.reviewOpen && activeSectionLabel ? ` · ${activeSectionLabel}` : ""}</span>
            <span>{shownPercent}% built</span>
            {showDevelopmentHeaderDebug ? (
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#ffb38a", marginLeft: 8 }}>
                {visibleHeaderDebugLabel}
              </span>
            ) : null}
          </div>
          {/* TEMPORARY SENTINEL — remove after one browser confirmation pass */}
          <div style={{ fontFamily: "monospace", fontSize: 9, color: "#ff6b6b", background: "rgba(0,0,0,0.75)", padding: "2px 6px", lineHeight: 1.4, wordBreak: "break-all" }}>
            {`ACTIVE-GBHDR-V6 shown=${shownPercent} src=${progressPercentSource} rawPct=${rawCompletionAuditPercent} hpPct=${explicitHeaderProgressPercent ?? "na"} hpAuditPct=${headerProgressAuditPercent ?? "na"} blank=${isCanonicalBlank ? 1 : 0} section=${activeSectionKey || "?"}`}
          </div>
          <progress value={shownPercent} max="100" aria-label="Guided build progress" />
        </div>

        {/* ── Main scrollable area ── */}
        <div className="pe-guided-main">
          {guided?.reviewOpen ? (
            <div className="pe-guided-review">
              <div className="pe-guided-assistant-message">
                {reviewReady
                  ? "This estimate is ready to finish in the builder."
                  : "Check the estimate before you finish it in the builder."}
              </div>
              {!reviewReady ? (
                <div className="pe-guided-review-copy">A couple items still need to be nailed down.</div>
              ) : null}
              <div className="pe-guided-audit-stats">
                <div className="pe-guided-audit-stat">
                  <span>Filled in</span>
                  <strong>{Number(counts?.complete || 0)}</strong>
                </div>
                <div className="pe-guided-audit-stat">
                  <span>Auto-filled</span>
                  <strong>{Number(counts?.inferred || 0)}</strong>
                </div>
                <div className="pe-guided-audit-stat">
                  <span>Check these</span>
                  <strong>{Number(counts?.needs_confirmation || 0)}</strong>
                </div>
                <div className="pe-guided-audit-stat">
                  <span>Still needed</span>
                  <strong>{Number(counts?.missing || 0)}</strong>
                </div>
              </div>
              <div className="pe-guided-review-grid">
                <div className="pe-guided-review-sections">
                  {reviewSections.map((section) => (
                    <button
                      key={section.key}
                      type="button"
                      className={`pe-guided-review-section ${statusClassName(section.status)}`}
                      onClick={() => onJumpToSection(section.key)}
                      disabled={thinking}
                    >
                      <span>{section.label}</span>
                      <span className="pe-guided-chip-status">{statusLabel(section.status)}</span>
                    </button>
                  ))}
                </div>
                <div className="pe-guided-review-fields">
                  {reviewFields
                    .filter((field) => !activeSectionKey || activeSectionKey === "review" || field.sectionKey === activeSectionKey)
                    .map((field) => (
                      <button
                        key={field.key}
                        type="button"
                        className={`pe-guided-review-field ${statusClassName(field.status)}`}
                        onClick={() => onJumpToSection(field.sectionKey)}
                        disabled={thinking}
                      >
                        <span className="pe-guided-review-field-label">{field.label}</span>
                        <span className="pe-guided-review-field-status">{statusLabel(field.status)}</span>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* ── Active prompt (owns the screen) ── */}
              <div className="pe-guided-prompt">
                <div className="pe-guided-assistant-message">
                  {guided?.assistantMessage || "Getting the next question ready."}
                </div>
                {activeSectionLabel ? (
                  <div className="pe-guided-prompt-context">
                    {activeSectionLabel}{activeFieldLabel ? ` · ${activeFieldLabel}` : ""}
                  </div>
                ) : null}
              </div>

              {thinking ? (
                <div className="pe-guided-thinking" role="status" aria-live="polite" aria-busy="true">
                  <div className="pe-guided-thinking-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="pe-guided-thinking-copy">
                    <strong>Getting the next question ready…</strong>
                    <span>
                      {activeFieldLabel
                        ? `${activeFieldLabel}${activeSectionLabel ? ` in ${activeSectionLabel}` : ""}`
                        : "Getting the next question ready."}
                    </span>
                  </div>
                </div>
              ) : null}

              {hasPendingConfirmations ? (
                <div className="pe-guided-confirm-area">
                  <div className="pe-guided-panel-title">Confirm before continuing</div>
                  <div className="pe-guided-confirm-grid">
                    {guided.pendingConfirmations.map((item) => (
                      <div key={item.id} className="pe-guided-confirm-card">
                        <div className="pe-guided-confirm-head">
                          <div>{item.label}</div>
                          <div className="pe-guided-confirm-confidence">
                            {`${Math.round(Number(item.confidence || 0) * 100)}%`}
                          </div>
                        </div>
                        <div className="pe-guided-confirm-row">
                          <span>Current</span>
                          <strong>{formatOperationValue(item.existingValue) || "Blank"}</strong>
                        </div>
                        <div className="pe-guided-confirm-row">
                          <span>Suggested</span>
                          <strong>{formatOperationValue(item.value)}</strong>
                        </div>
                        {item.reason ? (
                          <div className="pe-guided-confirm-reason">{item.reason}</div>
                        ) : null}
                        <div className="pe-guided-confirm-actions">
                          <button type="button" className="pe-btn" onClick={() => onConfirmPending(item.id)} disabled={thinking}>
                            Confirm
                          </button>
                          <button type="button" className="pe-btn pe-btn-ghost" onClick={() => onRejectPending(item.id)} disabled={thinking}>
                            Keep Current
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {guided?.suggestedChoices?.length ? (
                <div className="pe-guided-choice-grid">
                  {guided.suggestedChoices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      className="pe-guided-choice"
                      onClick={() => onSelectChoice(choice)}
                      disabled={thinking}
                    >
                      <span className="pe-guided-choice-label">{choice.label}</span>
                      {choice.description ? (
                        <span className="pe-guided-choice-description">{choice.description}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="pe-guided-input-form">
                <textarea
                  id="pe-guided-input"
                  className="pe-input pe-guided-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  disabled={thinking}
                  aria-label="Add job detail"
                  placeholder={guided?.currentField?.label
                    ? `Add detail for ${guided.currentField.label.toLowerCase()}…`
                    : "Add job detail here…"}
                  rows={3}
                />
              </div>

              {guided?.warnings?.length ? (
                <div className="pe-guided-warnings">
                  {guided.warnings.map((warning, index) => (
                    <div key={`warn-${index}`} className="pe-guided-warning">{warning}</div>
                  ))}
                </div>
              ) : null}
            </>
          )}

          {/* ── Compact estimate preview ── */}
          {(summaryItems.length > 0 || String(summary?.value || "").trim()) ? (
            <div className="pe-guided-preview">
              {summary?.title ? (
                <div className="pe-guided-preview-title">{summary.title}</div>
              ) : null}
              {String(summary?.value || "").trim() ? (
                <div className="pe-guided-preview-total">
                  <span>Estimate</span>
                  <strong>{summary.value}</strong>
                </div>
              ) : null}
              {summaryItems.length ? (
                <div className="pe-guided-preview-items">
                  {summaryItems.map((item) => (
                    <div key={`${item.label}:${item.value}`} className="pe-guided-preview-item">
                      <span>{item.label}</span>
                      <span>{item.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ── Footer ── */}
        <div className="pe-guided-footer">
          <button type="button" className="pe-btn pe-btn-ghost" onClick={onClose}>
            Back to Builder
          </button>
          {!guided?.reviewOpen ? (
            <>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={onSkip} disabled={thinking}>
                Defer
              </button>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={handleOpenReview} disabled={thinking || hasPendingConfirmations}>
                Review estimate
              </button>
              <button type="button" className="pe-btn" onClick={handleContinue} disabled={!canContinueWithText}>
                {thinking || guided?.isLoading ? "Working…" : "Continue"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pe-btn"
              onClick={handleResumeFromReview}
              disabled={thinking || (!reviewReady && !nextActionSection?.key)}
            >
              {reviewReady ? "Continue in Builder" : "Keep building estimate"}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
