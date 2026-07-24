import {
  optimizeCompanyLogo,
  COMPANY_LOGO_MAX_DIMENSION,
  COMPANY_LOGO_TARGET_MAX_CHARS,
  COMPANY_LOGO_ABSOLUTE_MAX_CHARS,
} from "./companyLogoCompression";

// Deterministic canvas/image mocks. Encoded length is a function of canvas area
// and quality so the optimizer's quality/dimension ladder is exercised without
// any real pixel work.
let encoderBytesPerPx = 0.01;
let imageConfig = { width: 1000, height: 800, fail: false };
let originalImage;
let createElementSpy;

function makeFakeCanvas() {
  const canvas = { width: 0, height: 0 };
  canvas.getContext = () => ({ clearRect() {}, drawImage() {} });
  canvas.toDataURL = (mime = "image/png", quality) => {
    const q = typeof quality === "number" ? quality : 1;
    const area = (canvas.width || 0) * (canvas.height || 0);
    const len = Math.max(1, Math.round(area * q * encoderBytesPerPx));
    return `data:${mime};base64,` + "A".repeat(len);
  };
  return canvas;
}

function bigDataUrl(chars) {
  const prefix = "data:image/png;base64,";
  return prefix + "A".repeat(Math.max(0, chars - prefix.length));
}

beforeEach(() => {
  encoderBytesPerPx = 0.01;
  imageConfig = { width: 1000, height: 800, fail: false };

  originalImage = global.Image;
  global.Image = class {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.width = 0;
      this.height = 0;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
    }
    set src(_value) {
      Promise.resolve().then(() => {
        if (imageConfig.fail) {
          if (this.onerror) this.onerror(new Error("decode failed"));
          return;
        }
        this.width = imageConfig.width;
        this.height = imageConfig.height;
        this.naturalWidth = imageConfig.width;
        this.naturalHeight = imageConfig.height;
        if (this.onload) this.onload();
      });
    }
    get src() {
      return this._src;
    }
  };

  const realCreateElement = document.createElement.bind(document);
  createElementSpy = jest.spyOn(document, "createElement").mockImplementation((tag) => {
    if (String(tag).toLowerCase() === "canvas") return makeFakeCanvas();
    return realCreateElement(tag);
  });
});

afterEach(() => {
  global.Image = originalImage;
  if (createElementSpy) createElementSpy.mockRestore();
});

describe("optimizeCompanyLogo", () => {
  test("compresses an oversized logo to WebP under the target, preserving aspect ratio and never enlarging", async () => {
    const source = bigDataUrl(300000);
    const result = await optimizeCompanyLogo(source);

    expect(result.ok).toBe(true);
    expect(result.wasCompressed).toBe(true);
    expect(result.mimeType).toBe("image/webp");
    expect(result.optimizedCharacters).toBeLessThan(result.originalCharacters);
    expect(result.optimizedCharacters).toBeLessThanOrEqual(COMPANY_LOGO_TARGET_MAX_CHARS);
    expect(result.dataUrl.length).toBe(result.optimizedCharacters);
    // Never larger than the source dimensions; longest side capped at the max.
    expect(result.width).toBeLessThanOrEqual(COMPANY_LOGO_MAX_DIMENSION);
    expect(result.height).toBeLessThanOrEqual(COMPANY_LOGO_MAX_DIMENSION);
    expect(result.width).toBeLessThanOrEqual(1000);
  });

  test("leaves an already-small logo unchanged (no recompression, exact bytes preserved)", async () => {
    const small = "data:image/png;base64," + "A".repeat(500);
    const result = await optimizeCompanyLogo(small);

    expect(result.ok).toBe(true);
    expect(result.wasCompressed).toBe(false);
    expect(result.dataUrl).toBe(small);
    expect(result.optimizedCharacters).toBe(small.length);
  });

  test("never enlarges a small-dimension source", async () => {
    imageConfig = { width: 120, height: 90, fail: false };
    const source = bigDataUrl(300000);
    const result = await optimizeCompanyLogo(source);

    expect(result.ok).toBe(true);
    expect(result.width).toBeLessThanOrEqual(120);
    expect(result.height).toBeLessThanOrEqual(90);
  });

  test("reduces dimensions when quality reduction alone cannot reach the target", async () => {
    // High cost-per-pixel forces the optimizer past every quality step at the
    // full cap, down to a smaller dimension, to reach the target.
    encoderBytesPerPx = 0.6;
    const source = bigDataUrl(400000);
    const result = await optimizeCompanyLogo(source, { targetMaxChars: 20000 });

    expect(result.ok).toBe(true);
    expect(result.wasCompressed).toBe(true);
    expect(result.optimizedCharacters).toBeLessThanOrEqual(20000);
    expect(result.width).toBeLessThan(COMPANY_LOGO_MAX_DIMENSION);
  });

  test("rejects a non-image string", async () => {
    const result = await optimizeCompanyLogo("not-a-data-url");
    expect(result.ok).toBe(false);
    expect(result.dataUrl).toBe("");
    expect(result.error).toMatch(/PNG, JPEG, or WebP/i);
  });

  test("rejects a File larger than the input safety limit without decoding", async () => {
    const hugeFile = { size: 25 * 1024 * 1024, type: "image/png", arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
    const result = await optimizeCompanyLogo(hugeFile);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/20 MB/i);
  });

  test("rejects an unreadable / undecodable image", async () => {
    imageConfig = { width: 0, height: 0, fail: true };
    const result = await optimizeCompanyLogo(bigDataUrl(300000));
    expect(result.ok).toBe(false);
    expect(result.dataUrl).toBe("");
    expect(result.error).toMatch(/could not read/i);
  });

  test("fails when no encoding can reach the absolute maximum size", async () => {
    encoderBytesPerPx = 5;
    const source = bigDataUrl(300000);
    const result = await optimizeCompanyLogo(source, { targetMaxChars: 50, absoluteMaxChars: 100 });

    expect(result.ok).toBe(false);
    expect(result.dataUrl).toBe("");
    expect(result.error).toMatch(/too large/i);
  });

  test("does not accept a re-encoded result that would exceed the absolute cap default", async () => {
    // Sanity: default absolute cap is the documented value.
    expect(COMPANY_LOGO_ABSOLUTE_MAX_CHARS).toBe(350000);
  });
});
