function asText(value) {
  return String(value ?? "").trim();
}

function legacyNumberCandidates(record, type) {
  const source = record && typeof record === "object" ? record : {};
  const primaryNumber = type === "invoice" ? source?.invoiceNumber : source?.estimateNumber;

  return [
    primaryNumber,
    source?.job?.docNumber,
    source?.docNumber,
    source?.documentNumber,
    source?.documentNo,
    source?.number,
  ]
    .map(asText)
    .filter(Boolean);
}

// The edit-target storage slots predate current document ids. Keep accepting
// the legacy identifiers that list views already recognize, without writing a
// replacement id merely to start an edit session.
export function documentEditTargetCandidates(record, type = "estimate") {
  const source = record && typeof record === "object" ? record : {};
  const candidates = [
    asText(source?.id),
    asText(source?.meta?.savedDocId),
    asText(source?.__legacyEditTarget),
    ...legacyNumberCandidates(source, type === "invoice" ? "invoice" : "estimate"),
  ].filter(Boolean);

  return [...new Set(candidates)];
}

export function getDocumentEditTarget(record, type = "estimate") {
  return documentEditTargetCandidates(record, type)[0] || "";
}

export function resolveDocumentEditTarget(records, target, type = "estimate") {
  const normalizedTarget = asText(target);
  if (!normalizedTarget) return null;

  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  const normalizedType = type === "invoice" ? "invoice" : "estimate";

  // A current id (or a prior saved-doc id) wins over a legacy document number
  // if a data set happens to contain the same string in both roles.
  const directMatches = list.filter((record) => (
    [asText(record?.id), asText(record?.meta?.savedDocId)].includes(normalizedTarget)
  ));
  if (directMatches.length > 0) {
    return directMatches.length === 1 ? directMatches[0] : null;
  }

  // An id-less normalized legacy invoice carries this non-persisted lookup
  // target solely so the original stored record can be opened without a write.
  const normalizedLegacyMatches = list.filter((record) => (
    asText(record?.__legacyEditTarget) === normalizedTarget
  ));
  if (normalizedLegacyMatches.length > 0) {
    return normalizedLegacyMatches.length === 1 ? normalizedLegacyMatches[0] : null;
  }

  const legacyMatches = list.filter((record) => (
    legacyNumberCandidates(record, normalizedType).includes(normalizedTarget)
  ));
  return legacyMatches.length === 1 ? legacyMatches[0] : null;
}

export function updateResolvedDocumentEditTarget(records, target, type, update) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  const record = resolveDocumentEditTarget(list, target, type);
  if (!record || typeof update !== "function") return null;

  const updatedRecord = update(record);
  if (!updatedRecord || typeof updatedRecord !== "object") return null;

  return {
    record: updatedRecord,
    records: list.map((entry) => (entry === record ? updatedRecord : entry)),
  };
}
