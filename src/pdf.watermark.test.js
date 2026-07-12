// Integration test for the plan-aware PDF watermark. jsPDF + autoTable are
// replaced with a lightweight capturing mock so we can assert exactly what text
// buildPdfDoc draws, without a real PDF renderer.

let mockTextCalls = [];
let mockPages = 1;

jest.mock("jspdf", () =>
  function MockJsPDF() {
    mockPages = 1;
    const base = {
      text: (...args) => { mockTextCalls.push(args); },
      addPage: () => { mockPages += 1; },
      getNumberOfPages: () => mockPages,
      setPage: () => {},
      getFontSize: () => 10,
      getTextWidth: () => 20,
      splitTextToSize: (t) => String(t == null ? "" : t).split("\n"),
      getImageProperties: () => ({ width: 100, height: 100 }),
      output: () => new ArrayBuffer(8),
      save: () => {},
      internal: {
        scaleFactor: 1,
        pageSize: { getWidth: () => 210, getHeight: () => 297, width: 210, height: 297 },
      },
    };
    // Returning an object from a constructor makes `new MockJsPDF()` use it.
    return new Proxy(base, {
      get(target, prop) {
        return prop in target ? target[prop] : () => {};
      },
    });
  },
);
jest.mock("jspdf-autotable", () => jest.fn());

const { exportPdf } = require("./pdf");
const { STORAGE_KEYS } = require("./constants/storageKeys");

function basePayload(overrides = {}) {
  return {
    docType: "estimate",
    documentNumber: "EST-1001",
    company: { companyName: "Test Co", ...(overrides.company || {}) },
    customer: { name: "Test Customer" },
    job: { projectName: "Test Project", date: "2026-07-10" },
    summaryRows: [["Total", "$1,000.00"]],
    ...overrides,
    // keep company override explicit above
    ...(overrides.company ? { company: { companyName: "Test Co", ...overrides.company } } : {}),
  };
}

function drewText(needle) {
  return mockTextCalls.some((args) => String(args[0]).includes(needle));
}

function seedSubscriptionState(state) {
  localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE, JSON.stringify({
    source: "local_dev",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...state,
  }));
}

describe("PDF plan-aware watermark", () => {
  beforeEach(() => {
    mockTextCalls = [];
    mockPages = 1;
    localStorage.removeItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE);
    localStorage.removeItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE);
  });

  test("Free plan (no plan field) draws the 'Created with EstiPaid' watermark", async () => {
    await exportPdf(basePayload(), "download");
    expect(drewText("Created with EstiPaid")).toBe(true);
    // Export still runs its normal footer/page content.
    expect(drewText("Page 1 of 1")).toBe(true);
  });

  test("a Company Profile plan field alone does not remove the watermark", async () => {
    await exportPdf(basePayload({ company: { plan: "pro" } }), "download");
    expect(drewText("Created with EstiPaid")).toBe(true);
  });

  test("active Pro subscription state does not draw the estimate watermark", async () => {
    seedSubscriptionState({ plan: "pro", status: "active" });
    await exportPdf(basePayload({ company: { plan: "free" } }), "download");
    expect(drewText("Created with EstiPaid")).toBe(false);
    expect(drewText("Page 1 of 1")).toBe(true);
  });

  test("active Solo and Business subscription states do not draw the estimate watermark", async () => {
    seedSubscriptionState({ plan: "solo", status: "active" });
    await exportPdf(basePayload({ company: { plan: "free" } }), "download");
    expect(drewText("Created with EstiPaid")).toBe(false);
    mockTextCalls = [];
    seedSubscriptionState({ plan: "business", status: "active" });
    await exportPdf(basePayload({ company: { plan: "free" } }), "download");
    expect(drewText("Created with EstiPaid")).toBe(false);
  });

  test("invoice PDFs also carry the watermark on Free", async () => {
    await exportPdf(basePayload({ docType: "invoice" }), "download");
    expect(drewText("Created with EstiPaid")).toBe(true);
  });

  test("invoice PDFs follow active Business and canceled Pro state", async () => {
    seedSubscriptionState({ plan: "business", status: "active" });
    await exportPdf(basePayload({ docType: "invoice" }), "download");
    expect(drewText("Created with EstiPaid")).toBe(false);

    mockTextCalls = [];
    seedSubscriptionState({ plan: "pro", status: "canceled" });
    await exportPdf(basePayload({ docType: "invoice" }), "download");
    expect(drewText("Created with EstiPaid")).toBe(true);
  });

  test("cached remote state takes priority over local dev state for every PDF type", async () => {
    seedSubscriptionState({ plan: "pro", status: "active" });
    localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE, JSON.stringify({
      state: { plan: "pro", status: "canceled", source: "stripe" },
      resolvedAt: "2026-07-10T00:00:00.000Z",
    }));
    await exportPdf(basePayload({ docType: "estimate" }), "download");
    expect(drewText("Created with EstiPaid")).toBe(true);

    mockTextCalls = [];
    localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE, JSON.stringify({
      state: { plan: "business", status: "active", source: "stripe" },
      resolvedAt: "2026-07-10T00:00:00.000Z",
    }));
    await exportPdf(basePayload({ docType: "invoice" }), "download");
    expect(drewText("Created with EstiPaid")).toBe(false);
  });
});
