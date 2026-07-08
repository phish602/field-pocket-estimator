const SCOPE_IMAGE_SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export const SCOPE_IMAGE_UPLOAD_HARD_LIMIT_BYTES = 25 * 1024 * 1024;
export const SCOPE_IMAGE_TARGET_STORED_BYTES = 90 * 1024;
export const SCOPE_IMAGE_HARD_MAX_STORED_BYTES = 150 * 1024;

const SCOPE_IMAGE_MAX_DIMENSIONS = [1024, 800, 640];
const SCOPE_IMAGE_JPEG_QUALITIES = [0.68, 0.58, 0.5, 0.42];

export function isStorageQuotaExceededError(error) {
  const name = String(error?.name || "").trim();
  const message = String(error?.message || "").trim().toLowerCase();
  return (
    name === "QuotaExceededError"
    || name === "NS_ERROR_DOM_QUOTA_REACHED"
    || message.includes("quota")
    || message.includes("storage")
  );
}

export function estimateDataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function fitWithinBox(width, height, maxDimension) {
  const safeWidth = Math.max(1, Number(width || 0));
  const safeHeight = Math.max(1, Number(height || 0));
  const scale = Math.min(1, maxDimension / safeWidth, maxDimension / safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function createBrowserCanvas() {
  return document.createElement("canvas");
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      reject(new Error("Could not process this photo. Try another image."));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not process this photo. Try another image."));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== "function") {
      try {
        const dataUrl = canvas.toDataURL(mimeType, quality);
        const size = estimateDataUrlBytes(dataUrl);
        resolve({ size, dataUrl });
      } catch {
        reject(new Error("Could not process this photo. Try another image."));
      }
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not process this photo. Try another image."));
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
}

function blobToDataUrl(blob) {
  if (blob && typeof blob.dataUrl === "string") {
    return Promise.resolve(blob.dataUrl);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not process this photo. Try another image."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}

function clearCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

export async function normalizeScopeImageForStorage(file, deps = {}) {
  const mimeType = String(file?.type || "").trim().toLowerCase();
  if (!SCOPE_IMAGE_SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new Error("Could not process this photo. Try another image.");
  }

  if (Number(file?.size || 0) > SCOPE_IMAGE_UPLOAD_HARD_LIMIT_BYTES) {
    throw new Error("Photo is too large to save. Try a smaller image.");
  }

  const loadImage = deps.loadImageFromFile || loadImageFromFile;
  const makeCanvas = deps.createCanvas || createBrowserCanvas;
  const exportBlob = deps.canvasToBlob || canvasToBlob;
  const readBlob = deps.blobToDataUrl || blobToDataUrl;

  let image;
  try {
    image = await loadImage(file);
  } catch (error) {
    throw new Error(error?.message || "Could not process this photo. Try another image.");
  }

  const originalWidth = Number(image?.naturalWidth || image?.width || 0);
  const originalHeight = Number(image?.naturalHeight || image?.height || 0);
  if (!originalWidth || !originalHeight) {
    throw new Error("Could not process this photo. Try another image.");
  }

  let bestCandidate = null;

  for (const maxDimension of SCOPE_IMAGE_MAX_DIMENSIONS) {
    const { width, height } = fitWithinBox(originalWidth, originalHeight, maxDimension);
    const canvas = makeCanvas();
    canvas.width = width;
    canvas.height = height;

    const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!ctx) {
      clearCanvas(canvas);
      throw new Error("Could not process this photo. Try another image.");
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    for (const quality of SCOPE_IMAGE_JPEG_QUALITIES) {
      let blob;
      try {
        blob = await exportBlob(canvas, "image/jpeg", quality);
      } catch {
        clearCanvas(canvas);
        throw new Error("Could not process this photo. Try another image.");
      }

      let dataUrl;
      try {
        dataUrl = await readBlob(blob);
      } catch {
        clearCanvas(canvas);
        throw new Error("Could not process this photo. Try another image.");
      }

      if (!/^data:image\/jpeg;base64,/i.test(dataUrl)) {
        clearCanvas(canvas);
        throw new Error("Could not process this photo. Try another image.");
      }

      const storedSizeBytes = Number(blob?.size || 0) || estimateDataUrlBytes(dataUrl);
      const candidate = {
        mimeType: "image/jpeg",
        dataUrl,
        originalSizeBytes: Number(file?.size || 0),
        storedSizeBytes,
        originalWidth,
        originalHeight,
        storedWidth: width,
        storedHeight: height,
      };

      if (storedSizeBytes <= SCOPE_IMAGE_TARGET_STORED_BYTES) {
        clearCanvas(canvas);
        return candidate;
      }

      if (
        storedSizeBytes <= SCOPE_IMAGE_HARD_MAX_STORED_BYTES
        && (!bestCandidate || storedSizeBytes < bestCandidate.storedSizeBytes)
      ) {
        bestCandidate = candidate;
      }
    }

    clearCanvas(canvas);
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  throw new Error("Photo is too large to save. Try a smaller image.");
}
