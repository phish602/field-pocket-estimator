import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  extractTradeInsertBlocksForPdf,
  normalizeCustomTradeStarterList,
  readStoredCustomTradeStarters,
  stripTradeInsertBlocksFromScope,
  writeStoredCustomTradeStarters,
} from "./scopeTradeStarters";

const TRADE_STARTERS_KEY = STORAGE_KEYS.SCOPE_TRADE_STARTERS || "estipaid-scope-trade-starters-v1";

describe("scopeTradeStarters utility", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("normalizeCustomTradeStarterList handles malformed/non-array input safely", () => {
    expect(normalizeCustomTradeStarterList(null)).toEqual([]);
    expect(normalizeCustomTradeStarterList({ label: "L", text: "T" })).toEqual([]);
    expect(normalizeCustomTradeStarterList("invalid")).toEqual([]);
  });

  test("normalizeCustomTradeStarterList drops invalid records and keeps valid records", () => {
    const records = [
      null,
      {},
      { id: "a", label: "  Demo  ", text: "  Trade Insert: Demo\n- line  ", updatedAt: 100 },
      { id: "b", name: "Paint", body: "Trade Insert: Paint\n- coat", updatedAt: 200 },
      { id: "c", label: "NoText", text: "   " },
    ];
    const result = normalizeCustomTradeStarterList(records);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(["b", "a"]);
    expect(result[0].label).toBe("Paint");
    expect(result[0].text).toBe("Trade Insert: Paint\n- coat");
    expect(result[1].label).toBe("Demo");
    expect(result[1].text).toBe("Trade Insert: Demo\n- line");
  });

  test("normalizeCustomTradeStarterList dedupes by id and sorts by updatedAt desc then label", () => {
    const records = [
      { id: "same", label: "B", text: "x", updatedAt: 100 },
      { id: "same", label: "A", text: "y", updatedAt: 9999 },
      { id: "third", label: "C", text: "z", updatedAt: 50 },
      { id: "first", label: "A", text: "w", updatedAt: 100 },
    ];
    const result = normalizeCustomTradeStarterList(records);
    expect(result.map((r) => r.id)).toEqual(["first", "same", "third"]);
  });

  test("readStoredCustomTradeStarters returns [] on malformed stored JSON", () => {
    localStorage.setItem(TRADE_STARTERS_KEY, "{bad");
    expect(readStoredCustomTradeStarters()).toEqual([]);
  });

  test("writeStoredCustomTradeStarters writes normalized list", () => {
    const input = [
      { id: "one", label: "  One  ", text: " Alpha ", updatedAt: 1 },
      { id: "two", name: "Two", body: " Beta ", updatedAt: 3 },
      { id: "one", label: "Duplicate", text: "Ignored", updatedAt: 9 },
    ];
    const written = writeStoredCustomTradeStarters(input);
    const stored = JSON.parse(localStorage.getItem(TRADE_STARTERS_KEY) || "[]");
    expect(stored).toEqual(written);
    expect(written.map((r) => r.id)).toEqual(["two", "one"]);
    expect(written[0].label).toBe("Two");
    expect(written[1].label).toBe("One");
  });

  test("extractTradeInsertBlocksForPdf preserves current curated/manual/explicit extraction behavior", () => {
    const curated = [{ key: "paint", text: "Trade Insert: Paint\n- coat walls" }];
    const manual = "Trade Insert: Manual\n- field modify";
    const scopeText = [
      "Base scope text.",
      curated[0].text,
      "",
      manual,
      "",
      "Normal paragraph.",
    ].join("\n");
    const blocks = extractTradeInsertBlocksForPdf(scopeText, manual, curated);
    expect(blocks).toEqual([
      curated[0].text,
      "Trade Insert: Manual\n- field modify\n\nNormal paragraph.",
      manual,
    ]);
  });

  test("stripTradeInsertBlocksFromScope removes trade blocks and preserves normal scope text", () => {
    const base = "Scope line 1.";
    const tradeA = "Trade Insert: A\n- line A";
    const tradeB = "Trade Insert: B\n- line B";
    const scope = [base, "", tradeA, "", "Middle text.", "", tradeB, "", "Tail text."].join("\n");
    const stripped = stripTradeInsertBlocksFromScope(scope, [tradeA, tradeB]);
    expect(stripped).toContain("Scope line 1.");
    expect(stripped).toContain("Middle text.");
    expect(stripped).toContain("Tail text.");
    expect(stripped).not.toContain(tradeA);
    expect(stripped).not.toContain(tradeB);
  });
});
