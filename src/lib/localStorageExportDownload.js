// @ts-nocheck
/* eslint-disable */

import {
  buildLocalStorageExportArtifact,
  serializeArtifact,
  buildArtifactFilename,
} from "./localStorageExportArtifact";

/**
 * Triggers a browser download of the localStorage export artifact.
 *
 * All browser dependencies must be injected — this function never accesses
 * window, document, localStorage, or URL directly. Operator use only.
 * Do not call from app startup, normal save/load flows, or any automatic path.
 *
 * @param {Object} params
 * @param {Object} params.storageSnapshot - Plain key/value object or localStorage-like
 *   object with .getItem(). Not mutated.
 * @param {Function} params.BlobConstructor - Injected Blob constructor.
 * @param {Object} params.URLObject - Object with createObjectURL(blob) and revokeObjectURL(url).
 * @param {Object} params.documentObject - Object with createElement(tag) and body.
 * @param {string} [params.createdAt] - ISO timestamp override for deterministic testing.
 * @returns {{ filename, artifact, storageKeysFound, storageKeysMissing, parseWarnings, migrationReadiness }}
 */
export function triggerLocalStorageExportDownload(params) {
  const {
    storageSnapshot,
    BlobConstructor,
    URLObject,
    documentObject,
    createdAt,
  } = params || {};

  const artifact = buildLocalStorageExportArtifact(storageSnapshot, { createdAt });
  const serialized = serializeArtifact(artifact);
  const filename = buildArtifactFilename(artifact.createdAt);

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

  return {
    filename,
    artifact,
    storageKeysFound: artifact.storageKeysFound,
    storageKeysMissing: artifact.storageKeysMissing,
    parseWarnings: artifact.parseWarnings,
    migrationReadiness: artifact.migrationReadiness,
  };
}
