#!/usr/bin/env node
/*
 * ISO-15I -- TEST-ONLY loopback static server for the vault regression harness.
 *
 * Binds to 127.0.0.1 only. Serves exactly two generated local files from the
 * caller-supplied directory. It performs no outbound request, contacts no
 * Supabase, Vercel, Stripe, analytics, font, or CDN host, and has no proxy or
 * redirect behaviour of any kind.
 *
 * Usage: node scripts/vault-browser-regression/serve-harness.js --root <dir> --port <n>
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

const root = path.resolve(argument("--root"));
const port = Number(argument("--port"));
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid --port");

const ALLOWED = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/vault-browser-harness.js", { file: "vault-browser-harness.js", type: "text/javascript; charset=utf-8" }],
]);

const server = http.createServer((request, response) => {
  const requestPath = (request.url || "/").split("?")[0];
  const allowed = ALLOWED.get(requestPath);
  if (request.method !== "GET" || !allowed) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }
  fs.readFile(path.join(root, allowed.file), (error, contents) => {
    if (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("unavailable");
      return;
    }
    response.writeHead(200, {
      "content-type": allowed.type,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    response.end(contents);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`HARNESS_SERVER_LISTENING 127.0.0.1:${port}`);
});
