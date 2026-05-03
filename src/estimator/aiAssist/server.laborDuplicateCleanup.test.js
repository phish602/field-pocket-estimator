import fs from "fs";
import path from "path";
import vm from "vm";

function loadLaborDuplicateCleanupHelpers() {
  const filePath = path.resolve(process.cwd(), "server/dev-ai.js");
  const source = fs.readFileSync(filePath, "utf8");
  const start = source.indexOf("function normalizeLaborDuplicateRoleKey");
  const end = source.indexOf("function parseRetryAfterMs", start);
  if (start === -1 || end === -1) {
    throw new Error("Could not locate labor duplicate cleanup helpers in server/dev-ai.js");
  }

  const helperSource = `${source.slice(start, end)}
module.exports = { normalizeLaborDuplicateRoleKey, mergeExactDuplicateLaborLines };`;
  const sandbox = {
    module: { exports: {} },
    exports: {},
  };
  vm.runInNewContext(helperSource, sandbox, { filename: "server/dev-ai.js" });
  return sandbox.module.exports;
}

describe("server labor duplicate-row cleanup", () => {
  const { mergeExactDuplicateLaborLines } = loadLaborDuplicateCleanupHelpers();

  test("merges exact duplicate labor rows by summing hours and preserving first row order/text", () => {
    const payload = {
      lines: [
        { role: "Plumber", hours: 8, rate: 125, qty: 1 },
        { role: "  plumber  ", hours: 4, rate: 125, qty: 1 },
        { role: "Helper", hours: 2, rate: 60, qty: 1 },
      ],
    };

    const result = mergeExactDuplicateLaborLines(payload);

    expect(result.lines).toEqual([
      { role: "Plumber", hours: 12, rate: 125, qty: 1 },
      { role: "Helper", hours: 2, rate: 60, qty: 1 },
    ]);
  });

  test("keeps distinct role labels separate", () => {
    const payload = {
      lines: [
        { role: "Welder", hours: 6, rate: 110, qty: 1 },
        { role: "Fabricator", hours: 6, rate: 110, qty: 1 },
        { role: "Grinder", hours: 6, rate: 110, qty: 1 },
      ],
    };

    const result = mergeExactDuplicateLaborLines(payload);

    expect(result.lines).toEqual(payload.lines);
  });

  test("keeps same role rows separate when rate differs", () => {
    const payload = {
      lines: [
        { role: "Installer", hours: 5, rate: 95, qty: 1 },
        { role: "Installer", hours: 5, rate: 105, qty: 1 },
      ],
    };

    const result = mergeExactDuplicateLaborLines(payload);

    expect(result.lines).toEqual(payload.lines);
  });

  test("keeps same role rows separate when qty differs", () => {
    const payload = {
      lines: [
        { role: "Door Hardware Technician", hours: 4, rate: 90, qty: 1 },
        { role: "Door Hardware Technician", hours: 4, rate: 90, qty: 2 },
      ],
    };

    const result = mergeExactDuplicateLaborLines(payload);

    expect(result.lines).toEqual(payload.lines);
  });

  test("does not merge rows with invalid or non-positive values", () => {
    const payload = {
      lines: [
        { role: "Painter", hours: -2, rate: 85, qty: 1 },
        { role: "Painter", hours: -3, rate: 85, qty: 1 },
        { role: "Installer", hours: 0, rate: 95, qty: 1 },
        { role: "Installer", hours: 2, rate: 95, qty: 1 },
        { role: "Plumber", hours: 3, rate: 0, qty: 1 },
        { role: "Plumber", hours: 2, rate: 0, qty: 1 },
        { role: "Laborer", hours: 4, rate: 50, qty: 0 },
        { role: "Laborer", hours: 4, rate: 50, qty: 0 },
      ],
    };

    const result = mergeExactDuplicateLaborLines(payload);

    expect(result.lines).toEqual(payload.lines);
  });
});
