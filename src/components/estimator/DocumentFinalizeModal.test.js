import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import DocumentFinalizeModal from "./DocumentFinalizeModal";

const EN_COPY = {
  dialogLabel: "Document finalization",
  close: "Close finalization",
  reviewTitle: "Review & Save Estimate",
  reviewIntro: "Review the customer-facing estimate PDF before approving the final document.",
  viewPdf: "View PDF",
  downloadPreview: "Download Preview",
  backToEditing: "Back to Editing",
  approveSave: "Save Estimate",
  approveConvert: "Approve & Convert to Invoice",
  markSent: "Mark as Sent",
  markApproved: "Mark Approved",
  convertInvoice: "Convert to Invoice",
  nextActions: "Next actions",
  saving: "Saving estimate…",
  savedTitle: "Estimate Saved",
  savedIntro: "Your estimate is saved and ready for its next step.",
  documentActions: "Document",
  downloadPdf: "Download PDF",
  sharePdf: "Share PDF",
  continueEditing: "Continue Editing",
  exitBuilder: "Exit Builder",
  saveFailed: "The document could not be saved.",
};

const ES_INVOICE_COPY = {
  dialogLabel: "Finalización del documento",
  close: "Cerrar finalización",
  reviewTitle: "Revisar y guardar factura",
  reviewIntro: "Revisa el PDF de la factura antes de aprobar el documento final.",
  viewPdf: "Ver PDF",
  downloadPreview: "Descargar vista previa",
  backToEditing: "Volver a editar",
  approveSave: "Aprobar y guardar",
  saving: "Guardando factura…",
  savedTitle: "Factura guardada",
  savedIntro: "Tu factura está guardada y lista para el siguiente paso.",
  documentActions: "Documento",
  downloadPdf: "Descargar PDF",
  sharePdf: "Compartir PDF",
  continueEditing: "Continuar editando",
  exitBuilder: "Salir del generador",
  saveFailed: "No se pudo guardar el documento.",
};

function renderModal(overrides = {}) {
  const handlers = {
    onClose: jest.fn(),
    onViewPdf: jest.fn(),
    onDownloadPdf: jest.fn(),
    onSharePdf: jest.fn(),
    onApproveSave: jest.fn(() => Promise.resolve({ ok: true, lifecycleStatus: "draft" })),
    onApproveConvert: jest.fn(() => Promise.resolve({ ok: true })),
    onMarkSent: jest.fn(() => Promise.resolve({ ok: true, lifecycleStatus: "pending", message: "Estimate marked as sent." })),
    onMarkApproved: jest.fn(() => Promise.resolve({ ok: true, lifecycleStatus: "approved", message: "Estimate marked approved." })),
    onConvertInvoice: jest.fn(() => Promise.resolve({ ok: true })),
    onExitBuilder: jest.fn(),
  };
  const props = {
    open: true,
    lang: "en",
    docType: "estimate",
    customerName: "Acme Roofing",
    projectName: "Lobby Refresh",
    totalLabel: "Estimate Total",
    totalValue: "$8,420.00",
    copy: EN_COPY,
    ...handlers,
    ...overrides,
  };
  return { handlers, props, ...render(<DocumentFinalizeModal {...props} />) };
}

describe("DocumentFinalizeModal preview", () => {
  test("opens as an accessible read-only Estimate approval surface", () => {
    renderModal();

    const dialog = screen.getByRole("dialog", { name: "Review & Save Estimate" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Review & Save Estimate" })).toHaveFocus();
    expect(screen.getByText("Acme Roofing")).toBeInTheDocument();
    expect(screen.getByText("Lobby Refresh")).toBeInTheDocument();
    expect(screen.getByText("Estimate Total")).toBeInTheDocument();
    expect(screen.getByText("$8,420.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Estimate" })).toHaveClass("pe-btn", "pe-finalize-primary");
    expect(screen.getByRole("button", { name: "Save Estimate" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Approve & Convert to Invoice" })).toHaveClass("pe-btn-ghost");
    expect(screen.queryByText("Send to Customer")).not.toBeInTheDocument();
  });

  test("keeps approval and conversion behind the explicit Estimate shortcut", async () => {
    const { handlers } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Approve & Convert to Invoice" }));

    expect(handlers.onApproveConvert).toHaveBeenCalledTimes(1);
    expect(handlers.onApproveSave).not.toHaveBeenCalled();
  });

  test("View PDF and Download Preview reuse supplied PDF handlers without saving", () => {
    const { handlers } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "View PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Download Preview" }));

    expect(handlers.onViewPdf).toHaveBeenCalledTimes(1);
    expect(handlers.onDownloadPdf).toHaveBeenCalledTimes(1);
    expect(handlers.onApproveSave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Review & Save Estimate" })).toBeInTheDocument();
  });

  test("Back to Editing and Escape close without invoking save", () => {
    const first = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Back to Editing" }));
    expect(first.handlers.onClose).toHaveBeenCalledTimes(1);
    expect(first.handlers.onApproveSave).not.toHaveBeenCalled();
    first.unmount();

    const second = renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(second.handlers.onClose).toHaveBeenCalledTimes(1);
    expect(second.handlers.onApproveSave).not.toHaveBeenCalled();
  });
});

describe("DocumentFinalizeModal approval and saved state", () => {
  test("prevents duplicate approval and transitions the same dialog after success", async () => {
    let resolveSave;
    const onApproveSave = jest.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    renderModal({ onApproveSave });

    const approve = screen.getByRole("button", { name: "Save Estimate" });
    fireEvent.click(approve);
    fireEvent.click(approve);

    expect(onApproveSave).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saving estimate…")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(approve).toBeDisabled();
    expect(approve).toHaveClass("pe-btn", "pe-finalize-primary");
    expect(screen.getByRole("button", { name: "Close finalization" })).toBeDisabled();

    await act(async () => { resolveSave({ ok: true, lifecycleStatus: "draft" }); });

    expect(await screen.findByRole("heading", { name: "Estimate Saved" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("Send to Customer")).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByText(/portal backend is connected/i)).toBeInTheDocument();
  });

  test("save failure stays in Preview and surfaces the authoritative message", async () => {
    renderModal({
      onApproveSave: jest.fn(() => Promise.resolve({
        ok: false,
        tone: "warn",
        message: "Cannot save yet. Missing: Date.",
      })),
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Estimate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot save yet. Missing: Date.");
    expect(screen.getByRole("heading", { name: "Review & Save Estimate" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Estimate Saved" })).not.toBeInTheDocument();
  });

  test("Saved state keeps PDF/share actions distinct from unavailable customer delivery", async () => {
    const { handlers } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Save Estimate" }));
    await screen.findByRole("heading", { name: "Estimate Saved" });

    fireEvent.click(screen.getByRole("button", { name: "View PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Share PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue Editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit Builder" }));

    expect(handlers.onViewPdf).toHaveBeenCalledTimes(1);
    expect(handlers.onDownloadPdf).toHaveBeenCalledTimes(1);
    expect(handlers.onSharePdf).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onExitBuilder).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-customer-delivery="coming-soon"]')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send to Customer" })).not.toBeInTheDocument();
  });

  test("offers compact post-save Estimate lifecycle actions without creating a second workflow", async () => {
    const { handlers } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Save Estimate" }));
    await screen.findByRole("heading", { name: "Estimate Saved" });

    fireEvent.click(screen.getByRole("button", { name: "Mark as Sent" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Estimate marked as sent.");
    expect(handlers.onMarkSent).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Mark as Sent" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark Approved" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Estimate marked approved.");
    expect(handlers.onMarkApproved).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Convert to Invoice" }));
    expect(handlers.onConvertInvoice).toHaveBeenCalledTimes(1);
  });

  test("cannot be dismissed with Escape while the authoritative save is pending", async () => {
    let resolveSave;
    const onClose = jest.fn();
    renderModal({
      onClose,
      onApproveSave: () => new Promise((resolve) => { resolveSave = resolve; }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Estimate" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { resolveSave({ ok: false, message: "Try again." }); });
  });
});

describe("DocumentFinalizeModal parity", () => {
  test("uses the same workflow with localized Spanish Invoice wording", async () => {
    renderModal({
      lang: "es",
      docType: "invoice",
      totalLabel: "Total de la factura",
      copy: ES_INVOICE_COPY,
    });

    expect(screen.getByRole("heading", { name: "Revisar y guardar factura" })).toBeInTheDocument();
    expect(screen.getByText("Total de la factura")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar vista previa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar y guardar" })).toHaveClass("pe-btn", "pe-finalize-primary");
    expect(screen.getByRole("button", { name: "Aprobar y guardar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Aprobar y guardar" }));
    expect(await screen.findByRole("heading", { name: "Factura guardada" })).toBeInTheDocument();
    expect(screen.getByText("Enviar al cliente")).toBeInTheDocument();
    expect(screen.getByText("Próximamente")).toBeInTheDocument();
  });
});
