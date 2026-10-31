import { STORAGE_KEYS } from "./constants/storageKeys";
import { commitStoredEstimateCollectionMutation } from "./lib/estimateCloudMutationPlan";
import { writeStoredEstimatesLocal } from "./EstimateForm";
import { writeStoredEstimatesPreservingLegacy } from "./screens/EstimatesScreen";

jest.mock("./lib/estimateCloudMutationPlan", () => ({
  commitStoredEstimateCollectionMutation: jest.fn(),
}));

const previous = { id: "estimate-2606", docType: "estimate", estimateNumber: "EST-2606", total: 5000 };
const next = { ...previous, total: 6000 };
const legacyInvoice = { id: "legacy-invoice", docType: "invoice", invoiceNumber: "INV-OLD" };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([previous, legacyInvoice]));
  commitStoredEstimateCollectionMutation.mockReset();
  commitStoredEstimateCollectionMutation.mockResolvedValue({ ok: true });
});

test("EstimateForm save owner delegates its accepted post-state to the shared estimate mutation commit", async () => {
  await writeStoredEstimatesLocal([next], {
    companyId: "company-1",
    source: "EstimateForm.saveEstimate",
    documentId: next.id,
    additionalWrites: [{ key: STORAGE_KEYS.PROJECTS, value: "[]" }],
  });

  expect(commitStoredEstimateCollectionMutation).toHaveBeenCalledWith(expect.objectContaining({
    previousEstimates: [previous],
    nextEstimates: [next],
    event: expect.objectContaining({ source: "EstimateForm.saveEstimate", documentId: next.id }),
    writes: [
      { key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([next, legacyInvoice]) },
      { key: STORAGE_KEYS.PROJECTS, value: "[]" },
    ],
  }));
});

test("EstimatesScreen save owner delegates status/create post-state to the same estimate mutation commit", async () => {
  const approved = { ...next, status: "approved" };
  await writeStoredEstimatesPreservingLegacy([approved], {
    companyId: "company-1",
    source: "EstimatesScreen.setEstimateStatus",
    documentId: approved.id,
  });

  expect(commitStoredEstimateCollectionMutation).toHaveBeenCalledWith(expect.objectContaining({
    previousEstimates: [previous],
    nextEstimates: [approved],
    event: expect.objectContaining({ source: "EstimatesScreen.setEstimateStatus", documentId: approved.id }),
    writes: [{ key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([approved, legacyInvoice]) }],
  }));
});
