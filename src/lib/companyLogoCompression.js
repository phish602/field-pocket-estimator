// @ts-nocheck
/* eslint-disable */

// Company Profile logo optimization.
//
// The Company Profile is one localStorage JSON object and the logo data URL is
// embedded directly inside it. A very large logo makes every profile write
// large enough to fail local persistence. This utility re-encodes a selected
// image (or an already-embedded oversized data URL) into a compact data URL
// BEFORE the profile is persisted, so any Company Profile field can be changed
// without tripping storage limits.
//
// Safety notes:
// - Never logs or prints image / base64 contents.
// - Never enlarges the source image.
// - Preserves aspect ratio and transparency (canvas stays transparent; WebP and
//   PNG both carry alpha).
// - Bounds input size so an extreme image cannot exhaust browser memory.

export const COMPANY_LOGO_MAX_DIMENSION = 768;
export const COMPANY_LOGO_TARGET_MAX_CHARS = 240000;
export const COMPANY_LOGO_ABSOLUTE_MAX_CHARS = 350000;
export const COMPANY_LOGO_INPUT_MAX_BYTES = 20 * 1024 * 1024; // 20 MB
export const COMPANY_LOGO_QUALITY_STEPS = [0.92, 0.85, 0.78, 0.68, 0.58];
// Progressive dimension scales applied to the (already capped) target size when
// quality reduction alone cannot reach the target. Ordered largest-first.
const DIMENSION_SCALE_STEPS = [1, 0.85, 0.72, 0.6, 0.5, 0.4, 0.32, 0.25, 0.2, 0.16];
const MIN_OUTPUT_DIMENSION = 32;

const GENERIC_ERROR = "EstiPaid could not optimize this logo. Choose a smaller PNG, JPEG, or WebP image.";

function fail(error, extra = {}) {
  return {
    ok: false,
    dataUrl: "",
    originalCharacters: 0,
    optimizedCharacters: 0,
    width: 0,
    height: 0,
    mimeType: "",
    wasCompressed: false,
    error: error || GENERIC_ERROR,
    ...extra,
  };
}

function isDataUrlImage(value) {
  return typeof value === "string" && /^data:image\//i.test(value.trim());
}

function dataUrlMimeType(dataUrl) {
  const match = /^data:([^;,]+)[;,]/i.exec(String(dataUrl || ""));
  return match ? match[1].toLowerCase() : "";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    } catch {
      resolve("");
    }
  });
}

function decodeImage(dataUrl) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    } catch {
      resolve(null);
    }
  });
}

function supportsWebp() {
  try {
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
    if (!canvas || typeof canvas.getContext !== "function" || typeof canvas.toDataURL !== "function") return false;
    canvas.width = 1;
    canvas.height = 1;
    const url = canvas.toDataURL("image/webp");
    return typeof url === "string" && url.indexOf("data:image/webp") === 0;
  } catch {
    return false;
  }
}

function drawToCanvas(image, width, height) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (!ctx) return null;
  try {
    // Transparent background is preserved; no fill is applied.
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
  } catch {
    return null;
  }
  return canvas;
}

function encodeCanvas(canvas, mimeType, quality) {
  try {
    const url = mimeType === "image/png"
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL(mimeType, quality);
    if (typeof url !== "string") return "";
    // Guard against a browser silently substituting a different encoder.
    if (url.indexOf(`data:${mimeType}`) !== 0) return "";
    return url;
  } catch {
    return "";
  }
}

/**
 * Optimize a company logo image for durable local persistence.
 *
 * @param {File|Blob|string} input - An image File/Blob or an image data URL.
 * @param {Object} [options] - Optional limit overrides (used by tests).
 * @returns {Promise<{ok:boolean, dataUrl:string, originalCharacters:number,
 *   optimizedCharacters:number, width:number, height:number, mimeType:string,
 *   wasCompressed:boolean, error:string}>}
 */
export async function optimizeCompanyLogo(input, options = {}) {
  const maxDimension = Number(options.maxDimension) > 0 ? Number(options.maxDimension) : COMPANY_LOGO_MAX_DIMENSION;
  const targetMaxChars = Number(options.targetMaxChars) > 0 ? Number(options.targetMaxChars) : COMPANY_LOGO_TARGET_MAX_CHARS;
  const absoluteMaxChars = Number(options.absoluteMaxChars) > 0 ? Number(options.absoluteMaxChars) : COMPANY_LOGO_ABSOLUTE_MAX_CHARS;
  const inputMaxBytes = Number(options.inputMaxBytes) > 0 ? Number(options.inputMaxBytes) : COMPANY_LOGO_INPUT_MAX_BYTES;
  const qualitySteps = Array.isArray(options.qualitySteps) && options.qualitySteps.length
    ? options.qualitySteps
    : COMPANY_LOGO_QUALITY_STEPS;

  // 1. Resolve the source to an image data URL.
  let sourceDataUrl = "";
  if (typeof input === "string") {
    if (!isDataUrlImage(input)) return fail("Choose a PNG, JPEG, or WebP image.");
    sourceDataUrl = input.trim();
  } else if (input && typeof input === "object" && (typeof input.arrayBuffer === "function" || typeof File !== "undefined")) {
    // File / Blob
    const size = Number(input.size) || 0;
    if (size > inputMaxBytes) return fail("This image is too large. Choose an image under 20 MB.");
    const declaredType = String(input.type || "");
    if (declaredType && !/^image\//i.test(declaredType)) return fail("Choose a PNG, JPEG, or WebP image.");
    sourceDataUrl = await readFileAsDataUrl(input);
    if (!isDataUrlImage(sourceDataUrl)) return fail("EstiPaid could not read this image file.");
  } else {
    return fail("Choose a PNG, JPEG, or WebP image.");
  }

  const originalCharacters = sourceDataUrl.length;
  const sourceMime = dataUrlMimeType(sourceDataUrl) || "image/png";

  // 2. Decode to obtain intrinsic dimensions and validate the image.
  const image = await decodeImage(sourceDataUrl);
  const naturalWidth = Number(image && (image.naturalWidth || image.width)) || 0;
  const naturalHeight = Number(image && (image.naturalHeight || image.height)) || 0;
  if (!image || naturalWidth <= 0 || naturalHeight <= 0) {
    return fail("EstiPaid could not read this image. Choose a PNG, JPEG, or WebP image.");
  }

  // 3. Already compact enough: keep the exact source bytes (no recompression,
  //    no quality loss, and never larger than the source).
  if (originalCharacters <= targetMaxChars) {
    return {
      ok: true,
      dataUrl: sourceDataUrl,
      originalCharacters,
      optimizedCharacters: originalCharacters,
      width: naturalWidth,
      height: naturalHeight,
      mimeType: sourceMime,
      wasCompressed: false,
      error: "",
    };
  }

  // 4. Re-encode through canvas. Prefer WebP (lossy + alpha) when supported;
  //    otherwise PNG (lossless + alpha) with dimension-only reduction.
  const useWebp = supportsWebp();
  const outputMime = useWebp ? "image/webp" : "image/png";
  const qualities = useWebp ? qualitySteps : [undefined];

  // Never enlarge: cap the longest side at min(maxDimension, source longest side).
  const longestSide = Math.max(naturalWidth, naturalHeight);
  const baseCap = Math.min(maxDimension, longestSide);
  const aspect = naturalWidth / naturalHeight;

  let best = null; // smallest acceptable result seen so far ( < source, <= absolute )

  for (const scale of DIMENSION_SCALE_STEPS) {
    const cappedLongest = Math.max(MIN_OUTPUT_DIMENSION, Math.round(baseCap * scale));
    let targetWidth;
    let targetHeight;
    if (naturalWidth >= naturalHeight) {
      targetWidth = cappedLongest;
      targetHeight = Math.max(1, Math.round(cappedLongest / aspect));
    } else {
      targetHeight = cappedLongest;
      targetWidth = Math.max(1, Math.round(cappedLongest * aspect));
    }

    const canvas = drawToCanvas(image, targetWidth, targetHeight);
    if (!canvas) continue;

    for (const quality of qualities) {
      const encoded = encodeCanvas(canvas, outputMime, quality);
      if (!encoded) continue;
      const length = encoded.length;
      // Never accept a result that is not actually smaller than the source.
      if (length >= originalCharacters) continue;

      if (length <= targetMaxChars) {
        // First result at or under the target wins (dimensions/quality are
        // scanned largest-first, so this keeps the best visual quality).
        return {
          ok: true,
          dataUrl: encoded,
          originalCharacters,
          optimizedCharacters: length,
          width: targetWidth,
          height: targetHeight,
          mimeType: outputMime,
          wasCompressed: true,
          error: "",
        };
      }

      if (length <= absoluteMaxChars && (!best || length < best.optimizedCharacters)) {
        best = {
          ok: true,
          dataUrl: encoded,
          originalCharacters,
          optimizedCharacters: length,
          width: targetWidth,
          height: targetHeight,
          mimeType: outputMime,
          wasCompressed: true,
          error: "",
        };
      }
    }
  }

  // Could not reach the target, but produced a smaller result under the hard
  // limit -- accept the best improvement.
  if (best) return best;

  // No acceptable improvement. If the source itself is already within the hard
  // limit, keep it unchanged rather than accepting a larger result.
  if (originalCharacters <= absoluteMaxChars) {
    return {
      ok: true,
      dataUrl: sourceDataUrl,
      originalCharacters,
      optimizedCharacters: originalCharacters,
      width: naturalWidth,
      height: naturalHeight,
      mimeType: sourceMime,
      wasCompressed: false,
      error: "",
    };
  }

  return fail("This logo is too large to save. Choose a smaller PNG, JPEG, or WebP image.", { originalCharacters });
}
