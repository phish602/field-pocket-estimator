const fs = require("fs");
const path = require("path");

// The app sends `window.location.origin` as its own `redirectTo`, so an origin
// missing from this exact-match list is silently replaced with `site_url` and
// the magic link, OAuth callback, or recovery link lands on a port nothing is
// serving. This is a static repository check: it needs no running Supabase.
const CONFIG_PATH = path.join(__dirname, "..", "..", "supabase", "config.toml");

function readAdditionalRedirectUrls() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const match = raw.match(/^additional_redirect_urls\s*=\s*\[([\s\S]*?)\]/m);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((entry) => entry.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^"|"$/g, ""));
}

describe("local Supabase auth callback origins", () => {
  test.each([
    ["default npm start", "http://127.0.0.1:3000"],
    ["default npm start", "http://localhost:3000"],
    ["isolated lane server", "http://127.0.0.1:3100"],
    ["isolated lane server", "http://localhost:3100"],
    ["current EstiPaid dev runtime", "http://127.0.0.1:4001"],
    ["current EstiPaid dev runtime", "http://localhost:4001"],
  ])("the %s origin %s is an allowed callback URL", (_label, url) => {
    expect(readAdditionalRedirectUrls()).toContain(url);
  });

  test("no wildcard callback origin is permitted", () => {
    const urls = readAdditionalRedirectUrls();
    expect(urls.length).toBeGreaterThan(0);
    urls.forEach((url) => {
      expect(url).not.toContain("*");
    });
  });
});
