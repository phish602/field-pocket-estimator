// @ts-nocheck
/* eslint-disable */

// Gate 13O-2J: browser download plumbing for the source:"cloud" backup JSON
// artifact built by exportSupabaseCloudBackupArtifact. Mirrors
// localStorageExportDownload.js: all browser dependencies are injected so
// this never touches window/document/URL directly and stays unit-testable.

/**
 * Builds a safe cloud export filename from an ISO timestamp.
 * Format: estipaid-cloud-backup-YYYYMMDD-HHMMSS.json
 */
export function buildCloudBackupExportFilename(exportedAt) {
  const d = exportedAt ? new Date(exportedAt) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `estipaid-cloud-backup-${yyyy}${mm}${dd}-${hh}${min}${ss}.json`;
}

/**
 * Triggers a browser download of a cloud backup JSON artifact.
 *
 * @param {Object} params
 * @param {Object} params.artifact - Artifact from exportSupabaseCloudBackupArtifact.
 * @param {Function} params.BlobConstructor - Injected Blob constructor.
 * @param {Object} params.URLObject - Object with createObjectURL(blob) and revokeObjectURL(url).
 * @param {Object} params.documentObject - Object with createElement(tag) and body.
 * @returns {{ filename, artifact }}
 */
export function triggerCloudBackupExportDownload(params) {
  const { artifact, BlobConstructor, URLObject, documentObject } = params || {};

  if (!artifact || typeof artifact !== "object" || artifact.source !== "cloud") {
    throw new Error("A cloud backup artifact is required for download.");
  }

  const serialized = JSON.stringify(artifact, null, 2);
  const filename = buildCloudBackupExportFilename(artifact.exportedAt);

  const canDownload = (
    typeof BlobConstructor === "function" &&
    URLObject != null &&
    typeof URLObject.createObjectURL === "function" &&
    typeof URLObject.revokeObjectURL === "function" &&
    documentObject != null &&
    typeof documentObject.createElement === "function" &&
    documentObject.body != null &&
    typeof documentObject.body.appendChild === "function" &&
    typeof documentObject.body.removeChild === "function"
  );

  if (canDownload) {
    let objectUrl = null;
    try {
      const blob = new BlobConstructor([serialized], { type: "application/json" });
      objectUrl = URLObject.createObjectURL(blob);
      const anchor = documentObject.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      documentObject.body.appendChild(anchor);
      anchor.click();
      documentObject.body.removeChild(anchor);
    } finally {
      if (objectUrl !== null) {
        URLObject.revokeObjectURL(objectUrl);
      }
    }
  }

  return { filename, artifact };
}
