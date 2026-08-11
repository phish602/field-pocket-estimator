// Development bootstrap for the local dev-ai bridge (port 5055).
//
// The cloud repair route inside server/dev-ai.js can only build a real Supabase
// admin client when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present in the
// SERVER process environment. `node server/dev-ai.js` on its own has neither, so
// the endpoint answered every request from its unconfigured path and the repair
// could never actually run -- while mocked tests stayed green.
//
// This script closes that gap WITHOUT persisting a secret anywhere:
//   * it asks the already-installed local Supabase CLI for the running local
//     instance's credentials,
//   * keeps them in memory only,
//   * proves the API target is the approved LOCAL instance,
//   * and injects them into the child process environment for this run only.
//
// The service-role key is never printed, never written to disk, never placed in
// argv (so it cannot appear in `ps`), and never exported to the parent shell.

const { execFileSync, spawn } = require("child_process");
const path = require("path");

// EXACT canonical values only. No substring matching, no regex, no hostname
// parsing -- "localhost.attacker.example" must never satisfy this.
const APPROVED_LOCAL_SUPABASE_URLS = Object.freeze([
  "http://127.0.0.1:54321",
  "http://127.0.0.1:54321/",
  "http://localhost:54321",
  "http://localhost:54321/",
]);

const REPO_ROOT = path.resolve(__dirname, "..");

function isApprovedLocalSupabaseUrl(value) {
  return APPROVED_LOCAL_SUPABASE_URLS.includes(String(value == null ? "" : value).trim());
}

// `supabase status -o env` emits KEY=VALUE lines, but also non-assignment noise
// (stopped-service notices, CLI upgrade banners). Values may be quoted.
function parseSupabaseStatusEnv(output) {
  const entries = new Map();
  String(output == null ? "" : output).split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) return;
    let value = match[2].trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    entries.set(match[1], value);
  });
  return entries;
}

// Returns { ok: true, supabaseUrl, serviceRoleKey } or { ok: false, code }.
// FAILS CLOSED. The failure code is a fixed non-sensitive token: it never
// carries the rejected URL (which could name a hosted project) or any key.
function resolveLocalSupabaseRuntime(statusOutput) {
  const entries = parseSupabaseStatusEnv(statusOutput);
  const supabaseUrl = entries.get("API_URL") || "";
  const serviceRoleKey = entries.get("SERVICE_ROLE_KEY") || "";

  if (!supabaseUrl) return { ok: false, code: "local_supabase_url_missing" };
  if (!isApprovedLocalSupabaseUrl(supabaseUrl)) return { ok: false, code: "local_supabase_url_not_approved" };
  if (!serviceRoleKey) return { ok: false, code: "local_service_role_key_missing" };
  return { ok: true, supabaseUrl, serviceRoleKey };
}

const FAILURE_MESSAGES = {
  supabase_status_failed: "Dev AI repair runtime refused: could not read local Supabase status. Start local Supabase first.",
  local_supabase_url_missing: "Dev AI repair runtime refused: local Supabase did not report an API URL.",
  local_supabase_url_not_approved: "Dev AI repair runtime refused: Supabase target is not the approved local instance.",
  local_service_role_key_missing: "Dev AI repair runtime refused: local Supabase did not report a service-role key.",
};

function readSupabaseStatusEnv({ exec = execFileSync, cwd = REPO_ROOT } = {}) {
  // Captured in memory. stderr is ignored on purpose so CLI banners and any
  // incidental diagnostics never reach this process's output.
  return exec("supabase", ["status", "-o", "env"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 10 * 1024 * 1024,
  });
}

function main() {
  let statusOutput = "";
  try {
    statusOutput = readSupabaseStatusEnv();
  } catch {
    process.stderr.write(`${FAILURE_MESSAGES.supabase_status_failed}\n`);
    process.exit(1);
    return;
  }

  const resolved = resolveLocalSupabaseRuntime(statusOutput);
  if (!resolved.ok) {
    process.stderr.write(`${FAILURE_MESSAGES[resolved.code] || FAILURE_MESSAGES.local_supabase_url_not_approved}\n`);
    process.exit(1);
    return;
  }

  // Safe to show: an approved local URL is a fixed public constant. The key is
  // never referenced in any output.
  process.stdout.write(`[dev:ai] local Supabase repair runtime enabled (${resolved.supabaseUrl})\n`);

  const child = spawn(process.execPath, [path.join(REPO_ROOT, "server", "dev-ai.js")], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: {
      // Inherit the developer's existing shell environment so GROQ / Stripe dev
      // variables keep working exactly as they do today.
      ...process.env,
      SUPABASE_URL: resolved.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: resolved.serviceRoleKey,
      // Tells the dev bridge to enforce the local-only repair policy itself.
      DEV_AI_REQUIRE_LOCAL_SUPABASE: "1",
    },
  });

  const forward = (signal) => {
    try { if (!child.killed) child.kill(signal); } catch {}
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (signal) { process.exit(1); return; }
    process.exit(typeof code === "number" ? code : 1);
  });
  child.on("error", () => {
    process.stderr.write("[dev:ai] failed to start the dev bridge process.\n");
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = {
  APPROVED_LOCAL_SUPABASE_URLS,
  FAILURE_MESSAGES,
  isApprovedLocalSupabaseUrl,
  parseSupabaseStatusEnv,
  resolveLocalSupabaseRuntime,
  readSupabaseStatusEnv,
};
