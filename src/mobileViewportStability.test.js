/**
 * Lane 1 regression guard: mobile navigation / viewport stability.
 *
 * Mobile WebKit zooms the whole page when a text-entry control smaller than
 * 16px receives focus, and it does NOT restore the previous scale on blur. The
 * zoom therefore follows the user into every screen they navigate to next,
 * which is what "the app randomly zooms in while navigating" actually was.
 *
 * These assertions are static on purpose: jsdom has no layout engine, so the
 * only reliable place to catch a reintroduced sub-threshold control is the
 * declaration itself.
 */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname);

// The browser threshold, not a design choice: the largest size that triggers
// no focus zoom on mobile WebKit.
const MIN_CONTROL_FONT_PX = 16;

const STYLE_SHEETS = [
  "App.css",
  "AppShell.css",
  "EstimateForm.css",
  "FieldSystem.css",
];

/** Controls that never take text entry and so never trigger focus zoom. */
const NON_TEXT_ENTRY = /\[type=["'](checkbox|radio|hidden|file|range|submit|button|color)["']\]/;

function readSheet(name) {
  return fs.readFileSync(path.join(SRC, name), "utf8");
}

/**
 * Only the selector's subject decides what gets styled. `.pe-x-input + span`
 * sizes the span, not the control, and `.pe-scope-textarea h2` sizes a heading,
 * so matching "input"/"textarea" anywhere in the selector reports the wrong
 * element. Take the last compound, after the final combinator.
 */
function subjectOf(selector) {
  const compounds = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  return compounds[compounds.length - 1] || "";
}

/**
 * Classes that JSX actually puts on an input/select/textarea. Derived from the
 * source rather than hardcoded so a renamed control cannot quietly slip past.
 */
function controlClassNames() {
  const classes = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".js") && !entry.name.includes(".test.")) {
        const source = fs.readFileSync(full, "utf8");
        const tagPattern = /<(input|select|textarea)\b([^>]*)>/gs;
        let tag;
        while ((tag = tagPattern.exec(source)) !== null) {
          const attrs = tag[2];
          const className = /className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/.exec(attrs);
          if (!className) continue;
          const value = className[1] || className[2] || className[3] || "";
          for (const name of value.split(/\s+/)) {
            if (name) classes.add(name);
          }
        }
      }
    }
  };
  walk(SRC);
  return classes;
}

const CONTROL_CLASSES = controlClassNames();

/** True when the selector's subject is a text-entry control. */
function targetsTextEntryControl(selector) {
  if (NON_TEXT_ENTRY.test(selector)) return false;

  const subject = subjectOf(selector);

  // A bare element name, e.g. `.pe-estimate-filters select` or `textarea:focus`.
  if (/(^|[^.\w-])(input|select|textarea)($|[^\w-])/.test(subject)) return true;

  // A class that JSX puts directly on a control, e.g. `.pe-guided-input`.
  return [...subject.matchAll(/\.([A-Za-z0-9_-]+)/g)].some((m) =>
    CONTROL_CLASSES.has(m[1])
  );
}

/** Yields { selector, fontPx, line } for every rule that sizes a control. */
function findControlFontSizes(css) {
  const found = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(css)) !== null) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    const body = match[2];

    // A rule list styles every selector in it, so check them independently.
    if (!selector.split(",").some(targetsTextEntryControl)) continue;

    const declaration = /font-size\s*:\s*([^;]+);/.exec(body);
    if (!declaration) continue;

    const px = /^([\d.]+)px/.exec(declaration[1].trim());
    if (!px) continue; // clamp()/em/% are not a fixed sub-threshold size

    found.push({
      selector,
      fontPx: parseFloat(px[1]),
      line: css.slice(0, match.index).split("\n").length,
    });
  }
  return found;
}

describe("mobile viewport stability", () => {
  test.each(STYLE_SHEETS)(
    "%s declares no text-entry control below the focus-zoom threshold",
    (sheet) => {
      const offenders = findControlFontSizes(readSheet(sheet))
        .filter((rule) => rule.fontPx < MIN_CONTROL_FONT_PX)
        .map((rule) => `${sheet}:${rule.line} ${rule.selector} -> ${rule.fontPx}px`);

      expect(offenders).toEqual([]);
    }
  );

  test("the shared field system sets the control font floor", () => {
    const fieldSystem = readSheet("FieldSystem.css");

    // The shared boundary that keeps un-classed controls safe by default.
    expect(fieldSystem).toMatch(/\.pe-app select,\s*\n\.pe-app textarea \{\s*\n\s*font-size: 16px;/);
  });

  test("the Projects search field stays at the floor despite being inline-styled", () => {
    // Inline styles beat the shared stylesheet guard, so this one repeats the
    // floor locally and needs its own assertion.
    const projects = fs.readFileSync(
      path.join(SRC, "screens", "ProjectsScreen.js"),
      "utf8"
    );
    const searchInput = /searchInput:\s*\{([\s\S]*?)\}/.exec(projects);
    expect(searchInput).not.toBeNull();

    const fontSize = /fontSize:\s*(\d+)/.exec(searchInput[1]);
    expect(fontSize).not.toBeNull();
    expect(Number(fontSize[1])).toBeGreaterThanOrEqual(MIN_CONTROL_FONT_PX);
  });

  test("accessibility zoom is never disabled to work around the defect", () => {
    const html = fs.readFileSync(
      path.join(__dirname, "..", "public", "index.html"),
      "utf8"
    );
    const viewport = /<meta\s+name="viewport"[^>]*>/i.exec(html);
    expect(viewport).not.toBeNull();
    expect(viewport[0]).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(viewport[0]).not.toMatch(/maximum-scale/i);
  });
});
