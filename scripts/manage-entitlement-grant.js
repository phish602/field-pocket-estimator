#!/usr/bin/env node
// Operator CLI for internal complimentary entitlement grants.
//
// This is intentionally NOT an API route. It requires SUPABASE_SERVICE_ROLE_KEY
// in the local environment, so it can only be run by someone who already holds
// service-role credentials -- never by an application user.
//
// Usage:
//   node scripts/manage-entitlement-grant.js inspect --company-id <uuid>
//
//   node scripts/manage-entitlement-grant.js grant \
//     --company-id <uuid> --confirm-company-id <uuid> \
//     --plan business --granted-by-user-id <uuid> \
//     --reason "Founder demonstration workspace" [--starts-at <iso>] [--expires-at <iso>] [--apply]
//
//   node scripts/manage-entitlement-grant.js revoke \
//     --company-id <uuid> --confirm-company-id <uuid> \
//     --grant-id <uuid> --revoked-by-user-id <uuid> \
//     --reason "No longer required" [--apply]
//
// Every write is a dry run unless --apply is passed.

const {
  inspectEntitlementGrants,
  grantInternalEntitlement,
  revokeInternalEntitlement,
} = require("../server/internalEntitlementGrantAdmin");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) { args._.push(token); continue; }
    const key = token.slice(2);
    if (key === "apply") { args.apply = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { args[key] = true; continue; }
    args[key] = next;
    i += 1;
  }
  return args;
}

// Only safe fields ever reach stdout: no secrets, no tokens, no environment,
// no reason text, no raw database responses.
function printResult(result) {
  if (!result?.ok) {
    console.error(`FAILED: ${result?.error || "Unknown error."}`);
    if (Array.isArray(result?.activeGrants) && result.activeGrants.length) {
      console.error("Existing unrevoked grants:");
      result.activeGrants.forEach((g) => console.error(`  grantId=${g.grantId} plan=${g.plan} startsAt=${g.startsAt} expiresAt=${g.expiresAt ?? "(none)"} active=${g.active}`));
    }
    return 1;
  }

  if (result.action === "inspect") {
    console.log(`action=inspect company=${result.companyId} name=${result.companyName}`);
    if (!result.activeGrants.length) { console.log("  no unrevoked grants"); return 0; }
    result.activeGrants.forEach((g) => {
      console.log(`  grantId=${g.grantId} plan=${g.plan} source=${g.source} startsAt=${g.startsAt} expiresAt=${g.expiresAt ?? "(none)"} revokedAt=${g.revokedAt ?? "(none)"} active=${g.active}`);
    });
    return 0;
  }

  const applied = result.applied ? "APPLIED" : "DRY RUN (nothing written)";
  console.log(`action=${result.action} ${applied}`);
  console.log(`  company=${result.companyId ?? "(n/a)"}${result.companyName ? ` name=${result.companyName}` : ""}`);
  console.log(`  plan=${result.plan ?? "(n/a)"} source=${result.source ?? "(n/a)"}`);
  console.log(`  startsAt=${result.startsAt ?? "(n/a)"} expiresAt=${result.expiresAt ?? "(none)"} revokedAt=${result.revokedAt ?? "(none)"}`);
  if (result.grantId) console.log(`  grantId=${result.grantId}`);
  if (result.message) console.log(`  ${result.message}`);
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = args._[0];

  let result;
  if (command === "inspect") {
    result = await inspectEntitlementGrants({ companyId: args["company-id"] });
  } else if (command === "grant") {
    result = await grantInternalEntitlement({
      companyId: args["company-id"],
      confirmCompanyId: args["confirm-company-id"],
      plan: args.plan,
      grantedByUserId: args["granted-by-user-id"],
      reason: args.reason,
      startsAt: args["starts-at"] || null,
      expiresAt: args["expires-at"] || null,
      apply: Boolean(args.apply),
    });
  } else if (command === "revoke") {
    result = await revokeInternalEntitlement({
      companyId: args["company-id"],
      confirmCompanyId: args["confirm-company-id"],
      grantId: args["grant-id"],
      revokedByUserId: args["revoked-by-user-id"],
      reason: args.reason,
      apply: Boolean(args.apply),
    });
  } else {
    console.error("Usage: manage-entitlement-grant.js <inspect|grant|revoke> [options]");
    console.error("See the header of this file for the full argument list.");
    process.exit(1);
    return;
  }

  process.exit(printResult(result));
}

if (require.main === module) {
  main().catch(() => {
    // Never print an exception: it could contain connection details.
    console.error("FAILED: Unexpected error.");
    process.exit(1);
  });
}

module.exports = { parseArgs, printResult };
