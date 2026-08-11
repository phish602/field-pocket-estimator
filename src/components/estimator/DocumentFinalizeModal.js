import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CustomerPortalDeliveryStatus } from "../portal/CustomerPortalSharePanel";

const FALLBACK_COPY = Object.freeze({
  dialogLabel: "Document finalization",
  close: "Close finalization",
  reviewTitle: "Review & Save Estimate",
  reviewIntro: "Review the customer-facing PDF before approving the final document.",
  viewPdf: "View PDF",
  downloadPreview: "Download Preview",
  backToEditing: "Back to Editing",
  approveSave: "Approve & Save",
  approveConvert: "Approve & Convert to Invoice",
  markSent: "Mark as Sent",
  markApproved: "Mark Approved",
  convertInvoice: "Convert to Invoice",
  saving: "Saving estimate…",
  savedTitle: "Estimate Saved",
  savedIntro: "Your estimate is saved and ready for its next step.",
  documentActions: "Document",
  downloadPdf: "Download PDF",
  sharePdf: "Share PDF",
  continueEditing: "Continue Editing",
  exitBuilder: "Exit Builder",
  saveFailed: "The document could not be saved. Review the details and try again.",
});

function getFocusableNodes(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((node) => !node.hasAttribute("hidden") && node.getAttribute("aria-hidden") !== "true");
}

export default function DocumentFinalizeModal({
  open = false,
  lang = "en",
  docType = "estimate",
  customerName = "",
  projectName = "",
  totalLabel = "",
  totalValue = "",
  copy: suppliedCopy = null,
  onClose,
  onViewPdf,
  onDownloadPdf,
  onSharePdf,
  onApproveSave,
  onApproveConvert,
  onMarkSent,
  onMarkApproved,
  onConvertInvoice,
  onExitBuilder,
}) {
  const copy = { ...FALLBACK_COPY, ...(suppliedCopy || {}) };
  const [phase, setPhase] = useState("preview");
  const [saveError, setSaveError] = useState("");
  const [lifecycleStatus, setLifecycleStatus] = useState("");
  const [lifecycleMessage, setLifecycleMessage] = useState("");
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const previousFocusRef = useRef(null);
  const savingRef = useRef(false);
  const normalizedCustomerName = String(customerName || "").trim();
  const normalizedProjectName = String(projectName || "").trim();
  const hasContext = Boolean(normalizedCustomerName || normalizedProjectName);
  const isSaving = phase === "saving";
  const isSaved = phase === "saved";

  useEffect(() => {
    if (!open) return;
    setPhase("preview");
    setSaveError("");
    setLifecycleStatus("");
    setLifecycleMessage("");
    savingRef.current = false;
  }, [open, docType]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    previousFocusRef.current = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    titleRef.current?.focus();
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      const previous = previousFocusRef.current;
      if (previous && typeof previous.focus === "function" && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (open && phase === "saved") titleRef.current?.focus();
  }, [open, phase]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (savingRef.current) return;
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableNodes(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        titleRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const handleApprove = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveError("");
    setPhase("saving");
    try {
      const result = await onApproveSave?.();
      if (result?.ok) {
        setLifecycleStatus(String(result?.lifecycleStatus || "").trim().toLowerCase());
        setPhase("saved");
        return;
      }
      setSaveError(String(result?.message || copy.saveFailed));
      setPhase("preview");
    } catch (error) {
      setSaveError(String(error?.message || copy.saveFailed));
      setPhase("preview");
    } finally {
      savingRef.current = false;
    }
  };

  const handleLifecycleAction = async (action) => {
    if (savingRef.current || typeof action !== "function") return;
    savingRef.current = true;
    setSaveError("");
    setLifecycleMessage("");
    try {
      const result = await action();
      if (!result?.ok) {
        setSaveError(String(result?.message || copy.saveFailed));
        return;
      }
      if (result?.lifecycleStatus) {
        setLifecycleStatus(String(result.lifecycleStatus).trim().toLowerCase());
      }
      if (result?.message) setLifecycleMessage(String(result.message));
    } catch (error) {
      setSaveError(String(error?.message || copy.saveFailed));
    } finally {
      savingRef.current = false;
    }
  };

  const title = isSaved ? copy.savedTitle : copy.reviewTitle;
  const description = isSaved ? copy.savedIntro : copy.reviewIntro;
  const titleId = "pe-document-finalize-title";
  const descriptionId = "pe-document-finalize-description";

  return createPortal(
    <div
      className="pe-finalize-backdrop"
      data-finalization-phase={phase}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !savingRef.current) onClose?.();
      }}
    >
      <section
        ref={dialogRef}
        className={`pe-finalize-panel ${isSaved ? "is-saved" : "is-preview"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isSaving ? "true" : undefined}
      >
        <header className="pe-finalize-header">
          <div className="pe-finalize-heading">
            <span className="pe-finalize-kicker">{copy.dialogLabel}</span>
            <h2 id={titleId} ref={titleRef} tabIndex="-1">{title}</h2>
          </div>
          <button
            type="button"
            className="pe-finalize-close"
            aria-label={copy.close}
            onClick={onClose}
            disabled={isSaving}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="pe-finalize-body">
          {isSaved ? (
            <div className="pe-finalize-success-mark" aria-hidden="true">✓</div>
          ) : null}

          {hasContext ? (
            <div className="pe-finalize-context" aria-label={[normalizedCustomerName, normalizedProjectName].filter(Boolean).join(" · ")}>
              {normalizedCustomerName ? <strong>{normalizedCustomerName}</strong> : null}
              {normalizedCustomerName && normalizedProjectName ? <span aria-hidden="true">·</span> : null}
              {normalizedProjectName ? <span>{normalizedProjectName}</span> : null}
            </div>
          ) : null}

          <div className="pe-finalize-total">
            <span>{totalLabel}</span>
            <strong>{totalValue}</strong>
          </div>

          <p id={descriptionId} className="pe-finalize-description">{description}</p>

          {saveError ? <div className="pe-finalize-error" role="alert">{saveError}</div> : null}
          {lifecycleMessage ? <div className="pe-finalize-lifecycle-message" role="status">{lifecycleMessage}</div> : null}

          {!isSaved ? (
            <div className="pe-finalize-preview-actions" aria-label={copy.documentActions}>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={onViewPdf} disabled={isSaving}>
                {copy.viewPdf}
              </button>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={onDownloadPdf} disabled={isSaving}>
                {copy.downloadPreview}
              </button>
            </div>
          ) : (
            <>
              <CustomerPortalDeliveryStatus documentType={docType} lang={lang} />
              {docType === "estimate" ? (
                <div className="pe-finalize-lifecycle-actions" aria-label={copy.nextActions || "Estimate next actions"}>
                  <span className="pe-finalize-section-label">{copy.nextActions || "Next actions"}</span>
                  <div>
                    {(!lifecycleStatus || lifecycleStatus === "draft") && onMarkSent ? (
                      <button type="button" className="pe-btn pe-btn-ghost" onClick={() => handleLifecycleAction(onMarkSent)}>
                        {copy.markSent}
                      </button>
                    ) : null}
                    {lifecycleStatus !== "approved" && onMarkApproved ? (
                      <button type="button" className="pe-btn pe-btn-ghost" onClick={() => handleLifecycleAction(onMarkApproved)}>
                        {copy.markApproved}
                      </button>
                    ) : null}
                    {lifecycleStatus === "approved" && onConvertInvoice ? (
                      <button type="button" className="pe-btn" onClick={() => handleLifecycleAction(onConvertInvoice)}>
                        {copy.convertInvoice}
                      </button>
                    ) : onApproveConvert ? (
                      <button type="button" className="pe-btn" onClick={() => handleLifecycleAction(onApproveConvert)}>
                        {copy.approveConvert}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="pe-finalize-document-actions">
                <span className="pe-finalize-section-label">{copy.documentActions}</span>
                <div>
                  <button type="button" className="pe-btn pe-btn-ghost" onClick={onViewPdf}>{copy.viewPdf}</button>
                  <button type="button" className="pe-btn pe-btn-ghost" onClick={onDownloadPdf}>{copy.downloadPdf}</button>
                  {onSharePdf ? (
                    <button type="button" className="pe-btn pe-btn-ghost" onClick={onSharePdf}>{copy.sharePdf}</button>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="pe-finalize-footer">
          {!isSaved ? (
            <>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={onClose} disabled={isSaving}>
                {copy.backToEditing}
              </button>
              {docType === "estimate" && onApproveConvert ? (
                <button
                  type="button"
                  className="pe-btn pe-btn-ghost pe-finalize-convert-shortcut"
                  onClick={() => handleLifecycleAction(onApproveConvert)}
                  disabled={isSaving}
                >
                  {copy.approveConvert}
                </button>
              ) : null}
              <button type="button" className="pe-btn pe-finalize-primary" onClick={handleApprove} disabled={isSaving}>
                {isSaving ? (
                  <><span className="pe-finalize-saving-dot" aria-hidden="true" />{copy.saving}</>
                ) : copy.approveSave}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={onClose}>{copy.continueEditing}</button>
              <button type="button" className="pe-btn pe-finalize-primary" onClick={onExitBuilder}>{copy.exitBuilder}</button>
            </>
          )}
        </footer>
      </section>
    </div>,
    document.body
  );
}
