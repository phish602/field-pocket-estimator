import {
  normalizeScopeImageForStorage,
  SCOPE_IMAGE_HARD_MAX_STORED_BYTES,
  SCOPE_IMAGE_TARGET_STORED_BYTES,
} from "./scopeImageStorage";

function createMockCanvas(drawCalls) {
  const ctx = {
    fillStyle: "#ffffff",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    fillRect: jest.fn(),
    drawImage: jest.fn((image, x, y, width, height) => {
      drawCalls.push({ image, x, y, width, height });
    }),
  };

  return {
    width: 0,
    height: 0,
    getContext: jest.fn(() => ctx),
  };
}

describe("normalizeScopeImageForStorage", () => {
  test("compresses a selected scope photo before storing it", async () => {
    const drawCalls = [];
    const file = { type: "image/jpeg", size: 2400000, name: "Scope Photo.jpg" };

    const result = await normalizeScopeImageForStorage(file, {
      loadImageFromFile: jest.fn().mockResolvedValue({ naturalWidth: 4032, naturalHeight: 3024 }),
      createCanvas: () => createMockCanvas(drawCalls),
      canvasToBlob: jest.fn().mockResolvedValue({
        size: SCOPE_IMAGE_TARGET_STORED_BYTES - 4000,
        dataUrl: "data:image/jpeg;base64,compressed-180kb",
      }),
      blobToDataUrl: jest.fn((blob) => Promise.resolve(blob.dataUrl)),
    });

    expect(result).toEqual(expect.objectContaining({
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,compressed-180kb",
      originalSizeBytes: 2400000,
      storedSizeBytes: SCOPE_IMAGE_TARGET_STORED_BYTES - 4000,
      originalWidth: 4032,
      originalHeight: 3024,
      storedWidth: 1024,
      storedHeight: 768,
    }));
    expect(result.dataUrl).not.toContain("raw-photo");
    expect(drawCalls[0]).toEqual(expect.objectContaining({ width: 1024, height: 768 }));
  });

  test("reduces quality and dimensions until the compressed photo fits the hard limit", async () => {
    const drawCalls = [];
    const blobSizes = [
      240000,
      220000,
      205000,
      180000,
      SCOPE_IMAGE_HARD_MAX_STORED_BYTES - 8000,
      170000,
      166000,
      162000,
      158000,
      154000,
      151000,
      149500,
    ];
    const file = { type: "image/png", size: 3100000, name: "Large Scope Photo.png" };

    const result = await normalizeScopeImageForStorage(file, {
      loadImageFromFile: jest.fn().mockResolvedValue({ naturalWidth: 4032, naturalHeight: 3024 }),
      createCanvas: () => createMockCanvas(drawCalls),
      canvasToBlob: jest.fn().mockImplementation(() => {
        const size = blobSizes.shift();
        return Promise.resolve({
          size,
          dataUrl: `data:image/jpeg;base64,compressed-${size}`,
        });
      }),
      blobToDataUrl: jest.fn((blob) => Promise.resolve(blob.dataUrl)),
    });

    expect(result.storedSizeBytes).toBe(SCOPE_IMAGE_HARD_MAX_STORED_BYTES - 8000);
    expect(result.storedWidth).toBe(800);
    expect(result.storedHeight).toBe(600);
    expect(drawCalls).toHaveLength(3);
    expect(drawCalls[0]).toEqual(expect.objectContaining({ width: 1024, height: 768 }));
    expect(drawCalls[1]).toEqual(expect.objectContaining({ width: 800, height: 600 }));
    expect(drawCalls[2]).toEqual(expect.objectContaining({ width: 640, height: 480 }));
  });

  test("rejects a scope photo that is still too large after compression attempts", async () => {
    const file = { type: "image/jpeg", size: 4200000, name: "Huge Scope Photo.jpg" };

    await expect(normalizeScopeImageForStorage(file, {
      loadImageFromFile: jest.fn().mockResolvedValue({ naturalWidth: 4032, naturalHeight: 3024 }),
      createCanvas: () => createMockCanvas([]),
      canvasToBlob: jest.fn().mockResolvedValue({
        size: SCOPE_IMAGE_HARD_MAX_STORED_BYTES + 5000,
        dataUrl: "data:image/jpeg;base64,still-too-large",
      }),
      blobToDataUrl: jest.fn((blob) => Promise.resolve(blob.dataUrl)),
    })).rejects.toThrow("Photo is too large to save. Try a smaller image.");
  });

  test("shows a friendly processing error for unsupported photo types", async () => {
    await expect(normalizeScopeImageForStorage({
      type: "image/heic",
      size: 1500000,
      name: "Unsupported.heic",
    })).rejects.toThrow("Could not process this photo. Try another image.");
  });
});
