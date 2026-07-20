import fs from "fs";
import path from "path";

const root = path.resolve(process.cwd(), "docs");
const forward = fs.readFileSync(path.join(root, "supabase-security-r2-stripe-webhook-replay-ordering-v1.sql"), "utf8");
const cleanup = fs.readFileSync(path.join(root, "supabase-security-r2-stripe-webhook-replay-ordering-v1-cleanup.sql"), "utf8");
const rollback = fs.readFileSync(path.join(root, "supabase-security-r2-stripe-webhook-replay-ordering-v1-rollback.sql"), "utf8");
const verification = fs.readFileSync(path.join(root, "supabase-security-r2-stripe-webhook-replay-ordering-v1-verification.sql"), "utf8");
const executable = forward.split("\n").map((line) => line.replace(/--.*$/, "").trimEnd()).filter(Boolean).join("\n");
const verificationExecutable = verification.split("\n").map((line) => line.replace(/--.*$/, "").trimEnd()).filter(Boolean).join("\n");
const signature = "public.apply_stripe_subscription_webhook_event(text, timestamptz, timestamptz, text, uuid, text, text, text, text, timestamptz)";

function functionBody() {
  const match = executable.match(/create function public\.apply_stripe_subscription_webhook_event\([\s\S]*?\nend \$\$;/i);
  expect(match).not.toBeNull();
  return match[0];
}

describe("Security R2.3B Stripe webhook replay/order migration", () => {
  test("is one forward transaction with preconditions and required tables", () => {
    expect(executable.startsWith("begin;")).toBe(true);
    expect(executable.endsWith("commit;")).toBe(true);
    expect(forward).toContain("app_settings_company_setting_key_uniq");
    expect(forward).toContain("duplicate company subscription_plan_state rows exist");
    expect(forward).toMatch(/create table public\.stripe_subscription_webhook_ordering/i);
    expect(forward).toMatch(/create table public\.stripe_subscription_webhook_events/i);
  });

  test("uses a type-compatible, ordered app_settings company-state uniqueness precondition", () => {
    const start = executable.indexOf("select exists (");
    const end = executable.indexOf(") into v_unique_state_index;");
    const precondition = executable.slice(start, end);
    expect(precondition).toContain("i.indrelid = 'public.app_settings'::regclass");
    expect(precondition).toContain("i.indisunique");
    expect(precondition).toContain("c.relname = 'app_settings_company_setting_key_uniq'");
    expect(precondition).toContain("pg_get_expr(i.indpred, i.indrelid) = '(setting_scope = ''company''::text)'");
    expect(precondition).toMatch(/array_agg\(a\.attname::text\s+order by key\.ord\)/i);
    expect(precondition).toMatch(/array\['company_id',\s*'setting_key'\]::text\[\]/i);
    expect(precondition).not.toMatch(/array_agg\(a\.attname\s+order by key\.ord\)[\s\S]*?=\s*array\['company_id',\s*'setting_key'\](?!::text\[\])/i);
  });

  test("defines the durable ordering and applied-event schema without payload storage", () => {
    expect(forward).toContain("primary key (company_id, stripe_subscription_id)");
    expect(forward).toContain("unique (stripe_subscription_id)");
    expect(forward).toMatch(/stripe_subscription_created_at timestamptz null/i);
    expect(forward).toMatch(/is_superseded boolean not null default false/i);
    expect(forward).toMatch(/constraint stripe_subscription_webhook_ordering_created_at_check\s+check \(stripe_subscription_created_at is not null or is_superseded\)/i);
    expect(forward).toContain("foreign key (company_id, stripe_subscription_id)");
    expect(forward).toContain("primary key (stripe_event_id)");
    expect(forward).toContain("stripe_subscription_webhook_events_type_check");
    ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].forEach((type) => expect(forward).toContain(type));
    expect(forward).toContain("stripe_subscription_webhook_ordering_company_updated_idx");
    expect(forward).toContain("stripe_subscription_webhook_events_company_subscription_created_idx");
    expect(forward).toContain("stripe_subscription_webhook_events_applied_at_idx");
    expect(executable).not.toMatch(/\b(payload|signature|headers?|secret|jsonb)\s+(jsonb|json|text|bytea)/i);
  });

  test("uses RPC-only table access and a hardened exact function signature", () => {
    ["stripe_subscription_webhook_ordering", "stripe_subscription_webhook_events"].forEach((table) => {
      expect(forward).toContain(`alter table public.${table} owner to postgres;`);
      expect(forward).toContain(`alter table public.${table} enable row level security;`);
      ["public", "anon", "authenticated", "service_role"].forEach((role) => {
        expect(forward).toContain(`revoke all privileges on table public.${table} from ${role};`);
      });
    });
    expect(forward).not.toMatch(/grant\s+.*on table public\.stripe_subscription_webhook/i);
    expect(forward).toContain("replay/order table retains PUBLIC ACL");
    expect(forward).toContain("security definer");
    expect(forward).toContain("set search_path = pg_catalog, public");
    expect(forward).toContain(`alter function ${signature} owner to postgres;`);
    ["public", "anon", "authenticated"].forEach((role) => expect(forward).toContain(`revoke all privileges on function ${signature} from ${role};`));
    expect(forward).toContain(`grant execute on function ${signature} to service_role;`);
  });

  test("serializes by company before subscription ordering and reads the billing pointer", () => {
    const body = functionBody();
    const companyLock = body.indexOf("perform 1 from public.companies where id = p_company_id for update;");
    const pointerRead = body.indexOf("from public.company_stripe_billing_refs");
    const orderingInsert = body.indexOf("insert into public.stripe_subscription_webhook_ordering");
    const orderingLock = body.indexOf("for update;", orderingInsert);
    expect(companyLock).toBeGreaterThan(-1);
    expect(pointerRead).toBeGreaterThan(companyLock);
    expect(orderingInsert).toBeGreaterThan(pointerRead);
    expect(orderingLock).toBeGreaterThan(orderingInsert);
  });

  test("enforces replay, same-subscription freshness, tombstone, supersession, and conservative equal-second rules", () => {
    const body = functionBody();
    expect(body).toContain("p_subscription_created_at timestamptz");
    expect(body).toContain("p_subscription_created_at is null or p_subscription_created_at <= 'epoch'::timestamptz");
    expect(body).toMatch(/stripe_subscription_webhook_events where stripe_event_id/i);
    expect(body).toContain("p_event_created_at < v_ordering.last_event_created_at");
    expect(body).toContain("v_ordering.is_deleted and p_event_type <> 'customer.subscription.deleted'");
    expect(body).toContain("v_ordering.is_superseded");
    expect(body).toContain("if p_event_type <> 'customer.subscription.deleted' then");
    expect(body).toMatch(/event_created_at = p_event_created_at[\s\S]*?result_category := 'stale'/i);
    expect(body).toContain("set is_superseded = true");
    expect(body).toContain("is_deleted = is_deleted or p_event_type = 'customer.subscription.deleted'");
    expect(body).not.toMatch(/stripe_event_id\s*(?:<|>|<=|>=)/i);
  });

  test("orders replacement subscription IDs only by immutable subscription creation time", () => {
    const body = functionBody();
    const crossSubscription = body.slice(body.indexOf("elsif p_event_type = 'customer.subscription.deleted' then"), body.indexOf("if v_mutate_company_state then"));
    expect(crossSubscription).toContain("p_subscription_created_at <= v_current_ordering.stripe_subscription_created_at");
    expect(crossSubscription).toContain("v_current_ordering.is_superseded or v_current_ordering.stripe_subscription_created_at is null");
    expect(crossSubscription).not.toMatch(/p_event_created_at\s*(?:<|>|<=|>=)\s*v_current_ordering/i);
    expect(crossSubscription).not.toMatch(/v_current_ordering\.last_event_created_at/i);
    expect(crossSubscription).not.toMatch(/stripe_(?:event|subscription)_id\s*(?:<|>|<=|>=)/i);
    expect(crossSubscription).toMatch(/values \(p_company_id, v_current_subscription_id, null, p_event_created_at, true, v_now, v_now\)/i);
  });

  test("preserves a real subscription creation time and only fills a legacy superseded barrier", () => {
    const body = functionBody();
    expect(body).toContain("v_ordering.stripe_subscription_created_at <> p_subscription_created_at");
    expect(body).toContain("raise exception 'Stripe subscription creation timestamp changed'");
    expect(body).toContain("v_ordering.stripe_subscription_created_at is null and not v_ordering.is_superseded");
    expect(body).toMatch(/when is_superseded then coalesce\(stripe_subscription_created_at, p_subscription_created_at\)/i);
    expect(body).not.toMatch(/stripe_subscription_created_at\s*=\s*p_subscription_created_at/i);
  });

  test("limits non-current deletion and superseded events to ordering plus ledger state", () => {
    const body = functionBody();
    const nonCurrentDeletion = body.indexOf("elsif p_event_type = 'customer.subscription.deleted' then");
    const companyMutationGuard = body.indexOf("if v_mutate_company_state then");
    const billingMutation = body.indexOf("insert into public.company_stripe_billing_refs");
    const ledger = body.indexOf("insert into public.stripe_subscription_webhook_events");
    expect(nonCurrentDeletion).toBeGreaterThan(-1);
    expect(companyMutationGuard).toBeGreaterThan(nonCurrentDeletion);
    expect(billingMutation).toBeGreaterThan(companyMutationGuard);
    expect(ledger).toBeGreaterThan(billingMutation);
    expect(body).toContain("v_mutate_company_state := false;");
  });

  test("performs company state writes atomically before the applied-event ledger", () => {
    const body = functionBody();
    expect(body.indexOf("insert into public.company_stripe_billing_refs")).toBeLessThan(body.indexOf("insert into public.stripe_subscription_webhook_events"));
    expect(body.indexOf("insert into public.app_settings")).toBeLessThan(body.indexOf("insert into public.stripe_subscription_webhook_events"));
    expect(body).toContain("'currentPeriodEnd', p_current_period_end");
    expect(body).not.toContain("stripeCustomerId");
    expect(body).not.toContain("stripeSubscriptionId");
  });

  test("cleanup preserves ordering/tombstones and rollback drops only R2.3B objects", () => {
    expect(cleanup).toContain("separate review and explicit execution");
    expect(cleanup).toContain("o.is_deleted = true");
    expect(cleanup).toContain("interval '35 days'");
    expect(cleanup).not.toMatch(/delete from public\.stripe_subscription_webhook_ordering/i);
    expect(rollback).toContain(`drop function if exists ${signature};`);
    expect(rollback).toContain("drop table if exists public.stripe_subscription_webhook_events;");
    expect(rollback).toContain("drop table if exists public.stripe_subscription_webhook_ordering;");
    expect(rollback).not.toMatch(/drop table.*(company_stripe_billing_refs|app_settings|companies)/i);
  });

  test("verification check 12 validates the nullable creation-time constraint with PostgreSQL-safe whitespace", () => {
    const start = verificationExecutable.indexOf("union all select 12,");
    const end = verificationExecutable.indexOf("union all select 13,");
    const check12 = verificationExecutable.slice(start, end);
    expect(check12).toContain("subscription creation timestamp is nullable timestamptz only for superseded barriers");
    expect(check12).toContain("data_type = 'timestamp with time zone'");
    expect(check12).toContain("is_nullable = 'YES'");
    expect(check12).toContain("conname = 'stripe_subscription_webhook_ordering_created_at_check'");
    expect(check12).toContain("pg_get_constraintdef(oid, true)");
    expect(check12).toContain("stripe_subscription_created_at[[:space:]]+is[[:space:]]+not[[:space:]]+null[()[:space:]]*or[[:space:]]+is_superseded");
    expect(check12).not.toContain("\\\\s");
    expect(check12).toMatch(/case when[\s\S]*?then 'PASS' else 'FAIL' end/i);
    expect(verificationExecutable).toContain("select 1 as seq");
    const resultRows = [1, ...[...verificationExecutable.matchAll(/union all select\s+(\d+)/gi)].map((match) => Number(match[1]))];
    expect(resultRows).toEqual(Array.from({ length: 14 }, (_value, index) => index + 1));
  });

  test("verification is read-only and covers security plus app_settings uniqueness", () => {
    expect(verificationExecutable).not.toMatch(/^\s*(insert|update|delete|create|alter|drop)\b/im);
    ["RLS is enabled", "PUBLIC has no replay/order table ACL", "only service_role executes", "is_superseded is nonnull and defaults false", "subscription creation timestamp is nullable timestamptz only for superseded barriers", "app_settings uniqueness", "no duplicate company subscription_plan_state"].forEach((text) => expect(verification).toContain(text));
    expect(verification).toContain("timestamp with time zone,timestamp with time zone,text,uuid");
  });
});
