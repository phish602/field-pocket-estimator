


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."apply_stripe_subscription_webhook_event"("p_stripe_event_id" "text", "p_event_created_at" timestamp with time zone, "p_subscription_created_at" timestamp with time zone, "p_event_type" "text", "p_company_id" "uuid", "p_stripe_customer_id" "text", "p_stripe_subscription_id" "text", "p_plan" "text", "p_status" "text", "p_current_period_end" timestamp with time zone) RETURNS TABLE("result_category" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_ordering public.stripe_subscription_webhook_ordering%rowtype;
  v_current_ordering public.stripe_subscription_webhook_ordering%rowtype;
  v_now timestamptz := now();
  v_state jsonb;
  v_current_subscription_id text;
  v_mutate_company_state boolean := false;
begin
  if nullif(btrim(p_stripe_event_id), '') is null then raise exception 'invalid Stripe webhook event id'; end if;
  if p_event_type not in ('checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted') then raise exception 'invalid Stripe webhook event type'; end if;
  if p_company_id is null then raise exception 'invalid Stripe webhook company'; end if;
  if nullif(btrim(p_stripe_subscription_id), '') is null then raise exception 'invalid Stripe webhook subscription'; end if;
  if p_plan not in ('free', 'solo', 'pro', 'business') then raise exception 'invalid Stripe webhook plan'; end if;
  if p_status not in ('free', 'trialing', 'active', 'past_due', 'canceled', 'unknown') then raise exception 'invalid Stripe webhook status'; end if;
  if p_event_created_at is null or p_event_created_at <= 'epoch'::timestamptz then raise exception 'invalid Stripe webhook event timestamp'; end if;
  if p_subscription_created_at is null or p_subscription_created_at <= 'epoch'::timestamptz then raise exception 'invalid Stripe subscription creation timestamp'; end if;
  if p_event_type = 'customer.subscription.deleted' and p_status <> 'canceled' then raise exception 'inconsistent Stripe webhook deletion state'; end if;

  -- Every webhook mutation for one company serializes here before any
  -- subscription-level decision, because billing refs and plan state are
  -- company-wide even though subscription ordering is per subscription.
  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'invalid Stripe webhook company'; end if;

  select nullif(btrim(stripe_subscription_id), '') into v_current_subscription_id
    from public.company_stripe_billing_refs
   where company_id = p_company_id
   for update;

  insert into public.stripe_subscription_webhook_ordering
    (company_id, stripe_subscription_id, stripe_subscription_created_at, last_event_created_at)
  values (p_company_id, btrim(p_stripe_subscription_id), p_subscription_created_at, p_event_created_at)
  on conflict (company_id, stripe_subscription_id) do nothing;

  select * into v_ordering
    from public.stripe_subscription_webhook_ordering
   where company_id = p_company_id and stripe_subscription_id = btrim(p_stripe_subscription_id)
   for update;
  if not found then raise exception 'could not establish Stripe webhook ordering row'; end if;
  if v_ordering.stripe_subscription_created_at is not null
     and v_ordering.stripe_subscription_created_at <> p_subscription_created_at then
    raise exception 'Stripe subscription creation timestamp changed';
  end if;
  if v_ordering.stripe_subscription_created_at is null and not v_ordering.is_superseded then
    raise exception 'non-superseded Stripe ordering row has no creation timestamp';
  end if;

  if exists (select 1 from public.stripe_subscription_webhook_events where stripe_event_id = btrim(p_stripe_event_id)) then
    result_category := 'duplicate'; return next; return;
  end if;
  if p_event_created_at < v_ordering.last_event_created_at
     and not (v_ordering.is_superseded and v_ordering.stripe_subscription_created_at is null
              and p_event_type = 'customer.subscription.deleted') then
    result_category := 'stale'; return next; return;
  end if;
  if v_ordering.is_deleted and p_event_type <> 'customer.subscription.deleted' then
    result_category := 'stale'; return next; return;
  end if;

  -- Retrieval happens before this transaction. A distinct non-deletion event
  -- with the same second cannot be safely ordered after retrieval, so only the
  -- first successfully applied event at that timestamp may mutate state.
  if p_event_type <> 'customer.subscription.deleted'
     and p_event_created_at = v_ordering.last_event_created_at
     and exists (
       select 1 from public.stripe_subscription_webhook_events
        where company_id = p_company_id
          and stripe_subscription_id = btrim(p_stripe_subscription_id)
          and event_created_at = p_event_created_at
     ) then
    result_category := 'stale'; return next; return;
  end if;

  if v_ordering.is_superseded then
    if p_event_type <> 'customer.subscription.deleted' then
      result_category := 'stale'; return next; return;
    end if;
    -- A superseded deletion records only its own terminal ordering/ledger fact.
    v_mutate_company_state := false;
  elsif v_current_subscription_id is null
     or v_current_subscription_id = btrim(p_stripe_subscription_id) then
    v_mutate_company_state := true;
  elsif p_event_type = 'customer.subscription.deleted' then
    -- A non-current deletion must never cancel or repoint company-wide state.
    v_mutate_company_state := false;
  else
    select * into v_current_ordering
      from public.stripe_subscription_webhook_ordering
     where company_id = p_company_id and stripe_subscription_id = v_current_subscription_id
     for update;

    if found then
      if v_current_ordering.is_superseded or v_current_ordering.stripe_subscription_created_at is null then
        raise exception 'current Stripe subscription ordering row is internally inconsistent';
      end if;
      if p_subscription_created_at <= v_current_ordering.stripe_subscription_created_at then
        result_category := 'stale'; return next; return;
      end if;
    end if;

    -- A strictly newer replacement becomes current. The prior subscription is
    -- permanently barred from regaining company-state authority. If it predates
    -- R2.3B, establish a superseded barrier that still permits its deletion.
    if found then
      update public.stripe_subscription_webhook_ordering
         set is_superseded = true, updated_at = v_now
       where company_id = p_company_id and stripe_subscription_id = v_current_subscription_id;
    else
      insert into public.stripe_subscription_webhook_ordering
        (company_id, stripe_subscription_id, stripe_subscription_created_at, last_event_created_at, is_superseded, created_at, updated_at)
      values (p_company_id, v_current_subscription_id, null, p_event_created_at, true, v_now, v_now)
      on conflict (company_id, stripe_subscription_id) do update
        set is_superseded = true,
            updated_at = v_now;
    end if;
    v_mutate_company_state := true;
  end if;

  if v_mutate_company_state then
    insert into public.company_stripe_billing_refs
      (company_id, stripe_customer_id, stripe_subscription_id, created_at, updated_at)
    values (p_company_id, nullif(btrim(p_stripe_customer_id), ''), btrim(p_stripe_subscription_id), v_now, v_now)
    on conflict (company_id) do update set
      stripe_customer_id = coalesce(excluded.stripe_customer_id, public.company_stripe_billing_refs.stripe_customer_id),
      stripe_subscription_id = coalesce(excluded.stripe_subscription_id, public.company_stripe_billing_refs.stripe_subscription_id),
      updated_at = v_now;

    v_state := jsonb_strip_nulls(jsonb_build_object(
      'plan', p_plan, 'status', p_status, 'source', 'stripe',
      'currentPeriodEnd', p_current_period_end, 'updatedAt', v_now
    ));
    insert into public.app_settings
      (id, company_id, user_id, setting_scope, setting_key, setting_value, legacy_local_id, created_at, updated_at)
    values (gen_random_uuid(), p_company_id, null, 'company', 'subscription_plan_state', v_state,
      'subscription_plan_state', v_now, v_now)
    on conflict (company_id, setting_key) where setting_scope = 'company' do update set
      setting_value = excluded.setting_value, updated_at = v_now;
  end if;

  update public.stripe_subscription_webhook_ordering
     set last_event_created_at = greatest(last_event_created_at, p_event_created_at),
         is_deleted = is_deleted or p_event_type = 'customer.subscription.deleted',
         stripe_subscription_created_at = case
           when is_superseded then coalesce(stripe_subscription_created_at, p_subscription_created_at)
           else stripe_subscription_created_at
         end,
         updated_at = v_now
   where company_id = p_company_id and stripe_subscription_id = btrim(p_stripe_subscription_id);

  insert into public.stripe_subscription_webhook_events
    (stripe_event_id, company_id, stripe_subscription_id, event_type, event_created_at, applied_at)
  values (btrim(p_stripe_event_id), p_company_id, btrim(p_stripe_subscription_id), p_event_type, p_event_created_at, v_now);
  result_category := 'applied'; return next; return;
end $$;


ALTER FUNCTION "public"."apply_stripe_subscription_webhook_event"("p_stripe_event_id" "text", "p_event_created_at" timestamp with time zone, "p_subscription_created_at" timestamp with time zone, "p_event_type" "text", "p_company_id" "uuid", "p_stripe_customer_id" "text", "p_stripe_subscription_id" "text", "p_plan" "text", "p_status" "text", "p_current_period_end" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_stripe_subscription_webhook_event"("p_stripe_event_id" "text", "p_event_created_at" timestamp with time zone, "p_subscription_created_at" timestamp with time zone, "p_event_type" "text", "p_company_id" "uuid", "p_stripe_customer_id" "text", "p_stripe_subscription_id" "text", "p_plan" "text", "p_status" "text", "p_current_period_end" timestamp with time zone) IS 'Security R2.3B atomic Stripe webhook replay/order authority. service_role only.';



CREATE OR REPLACE FUNCTION "public"."can_manage_company"("company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
  select public.company_role($1) in ('owner', 'admin');
$_$;


ALTER FUNCTION "public"."can_manage_company"("company_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_manage_company"("company_id" "uuid") IS 'RLS helper: owner/admin only.';



CREATE OR REPLACE FUNCTION "public"."can_write_company_records"("company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
  select public.company_role($1) in ('owner', 'admin', 'member');
$_$;


ALTER FUNCTION "public"."can_write_company_records"("company_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_write_company_records"("company_id" "uuid") IS 'RLS helper: owner/admin/member can write operational records where allowed.';



CREATE OR REPLACE FUNCTION "public"."company_role"("company_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
  select cu.role
  from public.company_users cu
  where cu.company_id = $1
    and cu.user_id = auth.uid()
    and cu.status = 'active'
  order by cu.updated_at desc
  limit 1;
$_$;


ALTER FUNCTION "public"."company_role"("company_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."company_role"("company_id" "uuid") IS 'RLS helper: returns the active role for auth.uid() within a company.';



CREATE OR REPLACE FUNCTION "public"."consume_ai_route_quota"("p_user_id" "uuid", "p_company_id" "uuid", "p_budget" "text", "p_user_short_limit" integer, "p_company_short_limit" integer, "p_user_daily_limit" integer, "p_company_daily_limit" integer) RETURNS TABLE("allowed" boolean, "retry_after_seconds" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_short_seconds constant integer := 60;
  v_now timestamptz := now();
  v_short_bucket timestamptz;
  v_daily_bucket timestamptz;
  v_short_retry integer;
  v_daily_retry integer;
  v_company_short integer;
  v_company_daily integer;
  v_user_short integer;
  v_user_daily integer;
begin
  if p_user_id is null or p_company_id is null then
    raise exception 'consume_ai_route_quota requires a resolved user and company';
  end if;

  if p_budget is null or p_budget <> 'paid_ai' then
    raise exception 'consume_ai_route_quota received an unsupported budget';
  end if;

  if p_user_short_limit is null or p_company_short_limit is null
     or p_user_daily_limit is null or p_company_daily_limit is null
     or p_user_short_limit < 1 or p_company_short_limit < 1
     or p_user_daily_limit < 1 or p_company_daily_limit < 1
     or p_user_short_limit > 100000 or p_company_short_limit > 100000
     or p_user_daily_limit > 100000 or p_company_daily_limit > 100000 then
    raise exception 'consume_ai_route_quota received an invalid limit';
  end if;

  v_short_bucket := to_timestamp(
    floor(extract(epoch from v_now) / v_short_seconds) * v_short_seconds
  );
  v_daily_bucket := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';

  v_short_retry := greatest(1, ceil(
    extract(epoch from (v_short_bucket + make_interval(secs => v_short_seconds)) - v_now)
  )::integer);
  v_daily_retry := greatest(1, ceil(
    extract(epoch from (v_daily_bucket + interval '1 day') - v_now)
  )::integer);

  -- Retention: expired buckets for these subjects are removed on every call, so
  -- the live row set stays bounded without a scheduled job.
  -- Each subject id is matched only within its OWN namespace: a user id is
  -- never allowed to match a company row, or vice versa.
  -- prune_ai_route_quota_counters() below is the global sweep for abandoned
  -- subjects.
  delete from public.ai_route_quota_counters
   where budget_key = p_budget
     and (
       (subject_type = 'user' and subject_id = p_user_id and (
         (window_kind = 'short' and bucket_started_at < v_short_bucket)
         or (window_kind = 'daily' and bucket_started_at < v_daily_bucket)))
       or (subject_type = 'company' and subject_id = p_company_id and (
         (window_kind = 'short' and bucket_started_at < v_short_bucket)
         or (window_kind = 'daily' and bucket_started_at < v_daily_bucket)))
     );

  insert into public.ai_route_quota_counters
    (subject_type, subject_id, budget_key, window_kind, bucket_started_at)
  values
    ('company', p_company_id, p_budget, 'short', v_short_bucket),
    ('company', p_company_id, p_budget, 'daily', v_daily_bucket),
    ('user', p_user_id, p_budget, 'short', v_short_bucket),
    ('user', p_user_id, p_budget, 'daily', v_daily_bucket)
  on conflict do nothing;

  select request_count into v_company_short
    from public.ai_route_quota_counters
   where subject_type = 'company' and subject_id = p_company_id
     and budget_key = p_budget and window_kind = 'short'
     and bucket_started_at = v_short_bucket
     for update;

  select request_count into v_company_daily
    from public.ai_route_quota_counters
   where subject_type = 'company' and subject_id = p_company_id
     and budget_key = p_budget and window_kind = 'daily'
     and bucket_started_at = v_daily_bucket
     for update;

  select request_count into v_user_short
    from public.ai_route_quota_counters
   where subject_type = 'user' and subject_id = p_user_id
     and budget_key = p_budget and window_kind = 'short'
     and bucket_started_at = v_short_bucket
     for update;

  select request_count into v_user_daily
    from public.ai_route_quota_counters
   where subject_type = 'user' and subject_id = p_user_id
     and budget_key = p_budget and window_kind = 'daily'
     and bucket_started_at = v_daily_bucket
     for update;

  if v_company_short is null or v_company_daily is null
     or v_user_short is null or v_user_daily is null then
    raise exception 'consume_ai_route_quota could not establish quota buckets';
  end if;

  if v_user_short >= p_user_short_limit then
    allowed := false; retry_after_seconds := v_short_retry; return next; return;
  end if;
  if v_company_short >= p_company_short_limit then
    allowed := false; retry_after_seconds := v_short_retry; return next; return;
  end if;
  if v_user_daily >= p_user_daily_limit then
    allowed := false; retry_after_seconds := v_daily_retry; return next; return;
  end if;
  if v_company_daily >= p_company_daily_limit then
    allowed := false; retry_after_seconds := v_daily_retry; return next; return;
  end if;

  update public.ai_route_quota_counters
     set request_count = request_count + 1,
         updated_at = v_now
   where budget_key = p_budget
     and (
       (subject_type = 'company' and subject_id = p_company_id and (
         (window_kind = 'short' and bucket_started_at = v_short_bucket)
         or (window_kind = 'daily' and bucket_started_at = v_daily_bucket)))
       or (subject_type = 'user' and subject_id = p_user_id and (
         (window_kind = 'short' and bucket_started_at = v_short_bucket)
         or (window_kind = 'daily' and bucket_started_at = v_daily_bucket)))
     );

  allowed := true; retry_after_seconds := 0; return next; return;
end $$;


ALTER FUNCTION "public"."consume_ai_route_quota"("p_user_id" "uuid", "p_company_id" "uuid", "p_budget" "text", "p_user_short_limit" integer, "p_company_short_limit" integer, "p_user_daily_limit" integer, "p_company_daily_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."consume_ai_route_quota"("p_user_id" "uuid", "p_company_id" "uuid", "p_budget" "text", "p_user_short_limit" integer, "p_company_short_limit" integer, "p_user_daily_limit" integer, "p_company_daily_limit" integer) IS 'Security R2.2: atomically consume one shared paid-AI quota unit under per-user and per-company short-window and daily limits. service_role only.';



CREATE OR REPLACE FUNCTION "public"."is_company_member"("company_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
  select exists (
    select 1
    from public.company_users cu
    where cu.company_id = $1
      and cu.user_id = auth.uid()
      and cu.status = 'active'
  );
$_$;


ALTER FUNCTION "public"."is_company_member"("company_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_company_member"("company_id" "uuid") IS 'RLS helper: active company membership based on auth.uid().';



CREATE OR REPLACE FUNCTION "public"."prune_ai_route_quota_counters"("p_retention_days" integer DEFAULT 2) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_deleted integer;
begin
  if p_retention_days is null or p_retention_days < 1 or p_retention_days > 90 then
    raise exception 'prune_ai_route_quota_counters received an invalid retention window';
  end if;

  delete from public.ai_route_quota_counters
   where bucket_started_at < now() - make_interval(days => p_retention_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;


ALTER FUNCTION "public"."prune_ai_route_quota_counters"("p_retention_days" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prune_ai_route_quota_counters"("p_retention_days" integer) IS 'Security R2.2 retention sweep for abandoned quota buckets. service_role only.';



CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ai_route_quota_counters" (
    "subject_type" "text" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "budget_key" "text" NOT NULL,
    "window_kind" "text" NOT NULL,
    "bucket_started_at" timestamp with time zone NOT NULL,
    "request_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_route_quota_counters_budget_key_check" CHECK (("budget_key" = 'paid_ai'::"text")),
    CONSTRAINT "ai_route_quota_counters_request_count_check" CHECK (("request_count" >= 0)),
    CONSTRAINT "ai_route_quota_counters_subject_type_check" CHECK (("subject_type" = ANY (ARRAY['user'::"text", 'company'::"text"]))),
    CONSTRAINT "ai_route_quota_counters_window_kind_check" CHECK (("window_kind" = ANY (ARRAY['short'::"text", 'daily'::"text"])))
);


ALTER TABLE "public"."ai_route_quota_counters" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_route_quota_counters" IS 'Security R2.2 durable paid-AI request quota, shared by every paid AI route. Identifiers, bucket timestamps and counters only: never routes, tokens, prompts, customer text, AI responses or IP addresses.';



COMMENT ON COLUMN "public"."ai_route_quota_counters"."subject_id" IS 'auth user id or company id. No other identifier is ever stored here.';



COMMENT ON COLUMN "public"."ai_route_quota_counters"."budget_key" IS 'Shared allowance these counters belong to. Deliberately not a route: all paid AI routes draw down the same budget.';



COMMENT ON COLUMN "public"."ai_route_quota_counters"."request_count" IS 'Admitted HTTP requests in this bucket. One quota unit per admitted request.';



CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "setting_scope" "text" NOT NULL,
    "setting_key" "text" NOT NULL,
    "setting_value" "jsonb",
    "legacy_local_id" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    CONSTRAINT "app_settings_scope_check" CHECK (("setting_scope" = ANY (ARRAY['company'::"text", 'user'::"text"])))
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."app_settings" IS 'App settings scope behavior: company settings default for shared/company behavior; user settings for personal UI preferences.';



CREATE TABLE IF NOT EXISTS "public"."audit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "legacy_local_id" "text",
    "event_type" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_events" IS 'Append-only by design. Audit rows are company-scoped and should not be casually updated or deleted.';



CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "legacy_local_id" "text",
    "name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "address" "jsonb",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid"
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


COMMENT ON TABLE "public"."companies" IS 'REVIEW ARTIFACT ONLY. Not deployed. No runtime wiring. Company-owned records use company_id.';



CREATE TABLE IF NOT EXISTS "public"."company_entitlement_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "plan" "text" NOT NULL,
    "source" "text" DEFAULT 'internal_comp'::"text" NOT NULL,
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "granted_by_user_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "revoked_by_user_id" "uuid",
    "revoke_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "company_entitlement_grants_expires_after_starts_check" CHECK ((("expires_at" IS NULL) OR ("expires_at" > "starts_at"))),
    CONSTRAINT "company_entitlement_grants_plan_check" CHECK (("plan" = ANY (ARRAY['solo'::"text", 'pro'::"text", 'business'::"text"]))),
    CONSTRAINT "company_entitlement_grants_reason_check" CHECK (("btrim"("reason") <> ''::"text")),
    CONSTRAINT "company_entitlement_grants_revoke_reason_check" CHECK (((("revoked_at" IS NULL) AND ("revoke_reason" IS NULL)) OR (("revoked_at" IS NOT NULL) AND ("btrim"(COALESCE("revoke_reason", ''::"text")) <> ''::"text")))),
    CONSTRAINT "company_entitlement_grants_revoked_after_starts_check" CHECK ((("revoked_at" IS NULL) OR ("revoked_at" >= "starts_at"))),
    CONSTRAINT "company_entitlement_grants_revoked_by_check" CHECK (((("revoked_at" IS NULL) AND ("revoked_by_user_id" IS NULL)) OR (("revoked_at" IS NOT NULL) AND ("revoked_by_user_id" IS NOT NULL)))),
    CONSTRAINT "company_entitlement_grants_source_check" CHECK (("source" = 'internal_comp'::"text"))
);


ALTER TABLE "public"."company_entitlement_grants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_stripe_billing_refs" (
    "company_id" "uuid" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "company_stripe_billing_refs_customer_nonblank_check" CHECK ((("stripe_customer_id" IS NULL) OR ("btrim"("stripe_customer_id") <> ''::"text"))),
    CONSTRAINT "company_stripe_billing_refs_subscription_nonblank_check" CHECK ((("stripe_subscription_id" IS NULL) OR ("btrim"("stripe_subscription_id") <> ''::"text")))
);


ALTER TABLE "public"."company_stripe_billing_refs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "invited_at" timestamp with time zone,
    "joined_at" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    CONSTRAINT "company_users_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."company_users" OWNER TO "postgres";


COMMENT ON TABLE "public"."company_users" IS 'Membership table. Owner/admin manage membership; viewer remains read-only.';



CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "legacy_local_id" "text",
    "display_name" "text",
    "company_name" "text",
    "contact_name" "text",
    "phone" "text",
    "email" "text",
    "billing_address" "jsonb",
    "customer_type" "text",
    "customer_status" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid"
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


COMMENT ON TABLE "public"."customers" IS 'Archive/soft-delete preferred. Hard delete should remain restricted when linked records exist.';



CREATE TABLE IF NOT EXISTS "public"."estimate_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "estimate_id" "uuid" NOT NULL,
    "legacy_local_id" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "description" "text",
    "quantity" numeric(12,2),
    "unit" "text",
    "unit_price" numeric(12,2),
    "total_price" numeric(12,2),
    "line_role" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."estimate_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."estimates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "project_id" "uuid",
    "legacy_local_id" "text",
    "estimate_number" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "document_type" "text" DEFAULT 'estimate'::"text" NOT NULL,
    "estimate_date" "date",
    "due_date" "date",
    "total_amount" numeric(12,2),
    "subtotal_amount" numeric(12,2),
    "tax_amount" numeric(12,2),
    "discount_amount" numeric(12,2),
    "notes" "text",
    "terms" "text",
    "converted_invoice_id" "uuid",
    "converted_invoice_legacy_id" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "restore_payload" "jsonb",
    "restore_payload_version" "text",
    "restore_payload_captured_at" timestamp with time zone,
    CONSTRAINT "estimates_restore_payload_object_check" CHECK ((("restore_payload" IS NULL) OR ("jsonb_typeof"("restore_payload") = 'object'::"text"))),
    CONSTRAINT "estimates_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending'::"text", 'sent'::"text", 'approved'::"text", 'lost'::"text"])))
);


ALTER TABLE "public"."estimates" OWNER TO "postgres";


COMMENT ON TABLE "public"."estimates" IS 'Separate estimate number space per company. Future stricter handling required for sent/approved records.';



CREATE TABLE IF NOT EXISTS "public"."invoice_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "legacy_local_id" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "description" "text",
    "quantity" numeric(12,2),
    "unit" "text",
    "unit_price" numeric(12,2),
    "total_price" numeric(12,2),
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invoice_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "legacy_local_id" "text",
    "amount" numeric(12,2) NOT NULL,
    "method" "text",
    "status" "text",
    "paid_at" timestamp with time zone,
    "payment_reference" "text",
    "notes" "text",
    "actor_id" "uuid",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid"
);


ALTER TABLE "public"."invoice_payments" OWNER TO "postgres";


COMMENT ON TABLE "public"."invoice_payments" IS 'Payment safety: do not encourage casual deletion or silent replacement.';



CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "project_id" "uuid",
    "estimate_id" "uuid",
    "source_estimate_legacy_id" "text",
    "legacy_local_id" "text",
    "invoice_number" "text" NOT NULL,
    "estimate_number" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "payment_status" "text",
    "invoice_date" "date",
    "due_date" "date",
    "total_amount" numeric(12,2),
    "amount_paid" numeric(12,2) DEFAULT 0 NOT NULL,
    "balance_remaining" numeric(12,2),
    "notes" "text",
    "terms" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'partial'::"text", 'paid'::"text", 'overdue'::"text", 'void'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


COMMENT ON TABLE "public"."invoices" IS 'Separate invoice number space per company. Future stricter handling required for paid/partial/void records.';



CREATE TABLE IF NOT EXISTS "public"."migration_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "migration_batch_id" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "notes" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "migration_batches_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'previewed'::"text", 'approved'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'rolled_back'::"text"])))
);


ALTER TABLE "public"."migration_batches" OWNER TO "postgres";


COMMENT ON TABLE "public"."migration_batches" IS 'Migration traceability table. Owner/admin only. Production execution remains blocked until separate approval.';



CREATE TABLE IF NOT EXISTS "public"."migration_write_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "migration_batch_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "legacy_local_id" "text",
    "backend_id" "uuid",
    "action" "text" NOT NULL,
    "status" "text" NOT NULL,
    "error_reason" "text",
    "attempted_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."migration_write_results" OWNER TO "postgres";


COMMENT ON TABLE "public"."migration_write_results" IS 'Migration traceability table. Owner/admin only. Production execution remains blocked until separate approval.';



CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "legacy_local_id" "text",
    "project_number" "text",
    "project_name" "text",
    "site_address" "jsonb",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "notes" "text",
    "scope_summary" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'completed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


COMMENT ON TABLE "public"."projects" IS 'Archive/soft-delete preferred. Hard delete should remain restricted when linked records exist.';



CREATE TABLE IF NOT EXISTS "public"."scope_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "legacy_local_id" "text",
    "name" "text" NOT NULL,
    "scope_text" "text",
    "template_type" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid"
);


ALTER TABLE "public"."scope_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."scope_templates" IS 'Company-scoped templates by default. Future user-specific scoping is not introduced here.';



CREATE TABLE IF NOT EXISTS "public"."stripe_subscription_webhook_events" (
    "stripe_event_id" "text" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "stripe_subscription_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "event_created_at" timestamp with time zone NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stripe_subscription_webhook_events_event_nonblank_check" CHECK (("btrim"("stripe_event_id") <> ''::"text")),
    CONSTRAINT "stripe_subscription_webhook_events_subscription_nonblank_check" CHECK (("btrim"("stripe_subscription_id") <> ''::"text")),
    CONSTRAINT "stripe_subscription_webhook_events_type_check" CHECK (("event_type" = ANY (ARRAY['checkout.session.completed'::"text", 'customer.subscription.created'::"text", 'customer.subscription.updated'::"text", 'customer.subscription.deleted'::"text"])))
);


ALTER TABLE "public"."stripe_subscription_webhook_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."stripe_subscription_webhook_events" IS 'Security R2.3B successfully applied Stripe event ledger only. No payloads, signatures, secrets, or PII.';



CREATE TABLE IF NOT EXISTS "public"."stripe_subscription_webhook_ordering" (
    "company_id" "uuid" NOT NULL,
    "stripe_subscription_id" "text" NOT NULL,
    "stripe_subscription_created_at" timestamp with time zone,
    "last_event_created_at" timestamp with time zone NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "is_superseded" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stripe_subscription_webhook_ordering_created_at_check" CHECK ((("stripe_subscription_created_at" IS NOT NULL) OR "is_superseded")),
    CONSTRAINT "stripe_subscription_webhook_ordering_subscription_nonblank_chec" CHECK (("btrim"("stripe_subscription_id") <> ''::"text"))
);


ALTER TABLE "public"."stripe_subscription_webhook_ordering" OWNER TO "postgres";


COMMENT ON TABLE "public"."stripe_subscription_webhook_ordering" IS 'Security R2.3B durable ordering: event time within a subscription; immutable Stripe subscription creation time across replacements; permanent tombstones and superseded barriers. No payloads, signatures, secrets, or PII.';



ALTER TABLE ONLY "public"."ai_route_quota_counters"
    ADD CONSTRAINT "ai_route_quota_counters_pkey" PRIMARY KEY ("subject_type", "subject_id", "budget_key", "window_kind", "bucket_started_at");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_company_legacy_local_id_uniq" UNIQUE ("company_id", "legacy_local_id");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_events"
    ADD CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_entitlement_grants"
    ADD CONSTRAINT "company_entitlement_grants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_stripe_billing_refs"
    ADD CONSTRAINT "company_stripe_billing_refs_pkey" PRIMARY KEY ("company_id");



ALTER TABLE ONLY "public"."company_users"
    ADD CONSTRAINT "company_users_company_id_user_id_key" UNIQUE ("company_id", "user_id");



ALTER TABLE ONLY "public"."company_users"
    ADD CONSTRAINT "company_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_company_id_id_key" UNIQUE ("company_id", "id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_company_legacy_local_id_uniq" UNIQUE ("company_id", "legacy_local_id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."estimate_line_items"
    ADD CONSTRAINT "estimate_line_items_company_legacy_local_id_key" UNIQUE ("company_id", "legacy_local_id");



ALTER TABLE ONLY "public"."estimate_line_items"
    ADD CONSTRAINT "estimate_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."estimates"
    ADD CONSTRAINT "estimates_company_estimate_number_uniq" UNIQUE ("company_id", "estimate_number");



ALTER TABLE ONLY "public"."estimates"
    ADD CONSTRAINT "estimates_company_id_id_key" UNIQUE ("company_id", "id");



ALTER TABLE ONLY "public"."estimates"
    ADD CONSTRAINT "estimates_company_legacy_local_id_uniq" UNIQUE ("company_id", "legacy_local_id");



ALTER TABLE ONLY "public"."estimates"
    ADD CONSTRAINT "estimates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_company_legacy_local_id_key" UNIQUE ("company_id", "legacy_local_id");



ALTER TABLE ONLY "public"."invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_company_legacy_local_id_uniq" UNIQUE ("company_id", "legacy_local_id");



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_company_id_id_key" UNIQUE ("company_id", "id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_company_invoice_number_uniq" UNIQUE ("company_id", "invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_company_legacy_local_id_uniq" UNIQUE ("company_id", "legacy_local_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."migration_batches"
    ADD CONSTRAINT "migration_batches_company_id_id_key" UNIQUE ("company_id", "id");



ALTER TABLE ONLY "public"."migration_batches"
    ADD CONSTRAINT "migration_batches_company_migration_batch_id_uniq" UNIQUE ("company_id", "migration_batch_id");



ALTER TABLE ONLY "public"."migration_batches"
    ADD CONSTRAINT "migration_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."migration_write_results"
    ADD CONSTRAINT "migration_write_results_company_legacy_local_id_uniq" UNIQUE ("company_id", "legacy_local_id");



ALTER TABLE ONLY "public"."migration_write_results"
    ADD CONSTRAINT "migration_write_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_company_id_id_key" UNIQUE ("company_id", "id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_company_legacy_local_id_uniq" UNIQUE ("company_id", "legacy_local_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_company_project_number_uniq" UNIQUE ("company_id", "project_number");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scope_templates"
    ADD CONSTRAINT "scope_templates_company_legacy_local_id_uniq" UNIQUE ("company_id", "legacy_local_id");



ALTER TABLE ONLY "public"."scope_templates"
    ADD CONSTRAINT "scope_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_subscription_webhook_events"
    ADD CONSTRAINT "stripe_subscription_webhook_events_pkey" PRIMARY KEY ("stripe_event_id");



ALTER TABLE ONLY "public"."stripe_subscription_webhook_ordering"
    ADD CONSTRAINT "stripe_subscription_webhook_ordering_pkey" PRIMARY KEY ("company_id", "stripe_subscription_id");



ALTER TABLE ONLY "public"."stripe_subscription_webhook_ordering"
    ADD CONSTRAINT "stripe_subscription_webhook_ordering_subscription_key" UNIQUE ("stripe_subscription_id");



CREATE INDEX "ai_route_quota_counters_bucket_started_at_idx" ON "public"."ai_route_quota_counters" USING "btree" ("bucket_started_at");



CREATE INDEX "app_settings_company_id_idx" ON "public"."app_settings" USING "btree" ("company_id");



CREATE UNIQUE INDEX "app_settings_company_setting_key_uniq" ON "public"."app_settings" USING "btree" ("company_id", "setting_key") WHERE ("setting_scope" = 'company'::"text");



CREATE INDEX "app_settings_legacy_local_id_idx" ON "public"."app_settings" USING "btree" ("company_id", "legacy_local_id");



CREATE INDEX "app_settings_scope_lookup_idx" ON "public"."app_settings" USING "btree" ("company_id", "setting_scope", "setting_key");



CREATE INDEX "app_settings_user_id_idx" ON "public"."app_settings" USING "btree" ("user_id");



CREATE UNIQUE INDEX "app_settings_user_setting_key_uniq" ON "public"."app_settings" USING "btree" ("company_id", "user_id", "setting_key") WHERE ("setting_scope" = 'user'::"text");



CREATE INDEX "audit_events_actor_id_idx" ON "public"."audit_events" USING "btree" ("actor_id");



CREATE INDEX "audit_events_company_created_at_idx" ON "public"."audit_events" USING "btree" ("company_id", "created_at" DESC);



CREATE INDEX "audit_events_legacy_local_id_idx" ON "public"."audit_events" USING "btree" ("company_id", "legacy_local_id");



CREATE INDEX "companies_legacy_local_id_idx" ON "public"."companies" USING "btree" ("legacy_local_id");



CREATE INDEX "company_entitlement_grants_active_idx" ON "public"."company_entitlement_grants" USING "btree" ("company_id", "starts_at", "expires_at") WHERE ("revoked_at" IS NULL);



CREATE INDEX "company_entitlement_grants_company_id_idx" ON "public"."company_entitlement_grants" USING "btree" ("company_id");



CREATE UNIQUE INDEX "company_entitlement_grants_one_active_per_company_idx" ON "public"."company_entitlement_grants" USING "btree" ("company_id") WHERE ("revoked_at" IS NULL);



CREATE UNIQUE INDEX "company_stripe_billing_refs_customer_uniq_idx" ON "public"."company_stripe_billing_refs" USING "btree" ("stripe_customer_id") WHERE ("stripe_customer_id" IS NOT NULL);



CREATE UNIQUE INDEX "company_stripe_billing_refs_subscription_uniq_idx" ON "public"."company_stripe_billing_refs" USING "btree" ("stripe_subscription_id") WHERE ("stripe_subscription_id" IS NOT NULL);



CREATE INDEX "company_users_company_id_idx" ON "public"."company_users" USING "btree" ("company_id");



CREATE INDEX "company_users_user_id_idx" ON "public"."company_users" USING "btree" ("user_id");



CREATE INDEX "customers_company_id_idx" ON "public"."customers" USING "btree" ("company_id");



CREATE INDEX "customers_legacy_local_id_idx" ON "public"."customers" USING "btree" ("company_id", "legacy_local_id");



CREATE INDEX "estimate_line_items_company_id_idx" ON "public"."estimate_line_items" USING "btree" ("company_id");



CREATE INDEX "estimate_line_items_estimate_id_idx" ON "public"."estimate_line_items" USING "btree" ("estimate_id");



CREATE INDEX "estimates_company_id_idx" ON "public"."estimates" USING "btree" ("company_id");



CREATE INDEX "estimates_customer_id_idx" ON "public"."estimates" USING "btree" ("customer_id");



CREATE INDEX "estimates_estimate_number_idx" ON "public"."estimates" USING "btree" ("company_id", "estimate_number");



CREATE INDEX "estimates_legacy_local_id_idx" ON "public"."estimates" USING "btree" ("company_id", "legacy_local_id");



CREATE INDEX "estimates_project_id_idx" ON "public"."estimates" USING "btree" ("project_id");



CREATE INDEX "invoice_line_items_company_id_idx" ON "public"."invoice_line_items" USING "btree" ("company_id");



CREATE INDEX "invoice_line_items_invoice_id_idx" ON "public"."invoice_line_items" USING "btree" ("invoice_id");



CREATE INDEX "invoice_payments_company_id_idx" ON "public"."invoice_payments" USING "btree" ("company_id");



CREATE INDEX "invoice_payments_invoice_id_idx" ON "public"."invoice_payments" USING "btree" ("invoice_id");



CREATE INDEX "invoice_payments_legacy_local_id_idx" ON "public"."invoice_payments" USING "btree" ("company_id", "legacy_local_id");



CREATE INDEX "invoices_company_id_idx" ON "public"."invoices" USING "btree" ("company_id");



CREATE INDEX "invoices_customer_id_idx" ON "public"."invoices" USING "btree" ("customer_id");



CREATE INDEX "invoices_estimate_id_idx" ON "public"."invoices" USING "btree" ("estimate_id");



CREATE INDEX "invoices_invoice_number_idx" ON "public"."invoices" USING "btree" ("company_id", "invoice_number");



CREATE INDEX "invoices_legacy_local_id_idx" ON "public"."invoices" USING "btree" ("company_id", "legacy_local_id");



CREATE INDEX "invoices_project_id_idx" ON "public"."invoices" USING "btree" ("project_id");



CREATE INDEX "migration_batches_company_id_idx" ON "public"."migration_batches" USING "btree" ("company_id");



CREATE INDEX "migration_batches_migration_batch_id_idx" ON "public"."migration_batches" USING "btree" ("company_id", "migration_batch_id");



CREATE INDEX "migration_write_results_batch_id_idx" ON "public"."migration_write_results" USING "btree" ("migration_batch_id");



CREATE INDEX "migration_write_results_company_id_idx" ON "public"."migration_write_results" USING "btree" ("company_id");



CREATE INDEX "migration_write_results_legacy_local_id_idx" ON "public"."migration_write_results" USING "btree" ("company_id", "legacy_local_id");



CREATE INDEX "projects_company_id_idx" ON "public"."projects" USING "btree" ("company_id");



CREATE INDEX "projects_customer_id_idx" ON "public"."projects" USING "btree" ("customer_id");



CREATE INDEX "projects_legacy_local_id_idx" ON "public"."projects" USING "btree" ("company_id", "legacy_local_id");



CREATE INDEX "scope_templates_company_id_idx" ON "public"."scope_templates" USING "btree" ("company_id");



CREATE INDEX "scope_templates_legacy_local_id_idx" ON "public"."scope_templates" USING "btree" ("company_id", "legacy_local_id");



CREATE INDEX "stripe_subscription_webhook_events_applied_at_idx" ON "public"."stripe_subscription_webhook_events" USING "btree" ("applied_at");



CREATE INDEX "stripe_subscription_webhook_events_company_subscription_created" ON "public"."stripe_subscription_webhook_events" USING "btree" ("company_id", "stripe_subscription_id", "event_created_at");



CREATE INDEX "stripe_subscription_webhook_ordering_company_updated_idx" ON "public"."stripe_subscription_webhook_ordering" USING "btree" ("company_id", "updated_at");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."audit_events"
    ADD CONSTRAINT "audit_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."company_entitlement_grants"
    ADD CONSTRAINT "company_entitlement_grants_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_stripe_billing_refs"
    ADD CONSTRAINT "company_stripe_billing_refs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_users"
    ADD CONSTRAINT "company_users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."estimate_line_items"
    ADD CONSTRAINT "estimate_line_items_company_estimate_fkey" FOREIGN KEY ("company_id", "estimate_id") REFERENCES "public"."estimates"("company_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."estimate_line_items"
    ADD CONSTRAINT "estimate_line_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."estimate_line_items"
    ADD CONSTRAINT "estimate_line_items_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."estimates"
    ADD CONSTRAINT "estimates_company_customer_fkey" FOREIGN KEY ("company_id", "customer_id") REFERENCES "public"."customers"("company_id", "id") ON DELETE SET NULL ("customer_id");



ALTER TABLE ONLY "public"."estimates"
    ADD CONSTRAINT "estimates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."estimates"
    ADD CONSTRAINT "estimates_company_project_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "public"."projects"("company_id", "id") ON DELETE SET NULL ("project_id");



ALTER TABLE ONLY "public"."estimates"
    ADD CONSTRAINT "estimates_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."estimates"
    ADD CONSTRAINT "estimates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_company_invoice_fkey" FOREIGN KEY ("company_id", "invoice_id") REFERENCES "public"."invoices"("company_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_company_invoice_fkey" FOREIGN KEY ("company_id", "invoice_id") REFERENCES "public"."invoices"("company_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_company_customer_fkey" FOREIGN KEY ("company_id", "customer_id") REFERENCES "public"."customers"("company_id", "id") ON DELETE SET NULL ("customer_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_company_estimate_fkey" FOREIGN KEY ("company_id", "estimate_id") REFERENCES "public"."estimates"("company_id", "id") ON DELETE SET NULL ("estimate_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_company_project_fkey" FOREIGN KEY ("company_id", "project_id") REFERENCES "public"."projects"("company_id", "id") ON DELETE SET NULL ("project_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."migration_batches"
    ADD CONSTRAINT "migration_batches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."migration_write_results"
    ADD CONSTRAINT "migration_write_results_company_batch_fkey" FOREIGN KEY ("company_id", "migration_batch_id") REFERENCES "public"."migration_batches"("company_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."migration_write_results"
    ADD CONSTRAINT "migration_write_results_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."migration_write_results"
    ADD CONSTRAINT "migration_write_results_migration_batch_id_fkey" FOREIGN KEY ("migration_batch_id") REFERENCES "public"."migration_batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_company_customer_fkey" FOREIGN KEY ("company_id", "customer_id") REFERENCES "public"."customers"("company_id", "id") ON DELETE SET NULL ("customer_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."scope_templates"
    ADD CONSTRAINT "scope_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stripe_subscription_webhook_events"
    ADD CONSTRAINT "stripe_subscription_webhook_events_ordering_fkey" FOREIGN KEY ("company_id", "stripe_subscription_id") REFERENCES "public"."stripe_subscription_webhook_ordering"("company_id", "stripe_subscription_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stripe_subscription_webhook_ordering"
    ADD CONSTRAINT "stripe_subscription_webhook_ordering_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE CASCADE;



ALTER TABLE "public"."ai_route_quota_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_settings_insert_company_scope" ON "public"."app_settings" FOR INSERT TO "authenticated" WITH CHECK ((("setting_scope" = 'company'::"text") AND ("user_id" IS NULL) AND "public"."can_manage_company"("company_id") AND ("setting_key" IS DISTINCT FROM 'subscription_plan_state'::"text")));



CREATE POLICY "app_settings_insert_company_scope_device_lock_members" ON "public"."app_settings" FOR INSERT TO "authenticated" WITH CHECK ((("setting_scope" = 'company'::"text") AND ("company_id" IS NOT NULL) AND ("user_id" IS NULL) AND ("setting_key" = 'active_device_lock'::"text") AND "public"."can_write_company_records"("company_id")));



CREATE POLICY "app_settings_insert_user_scope" ON "public"."app_settings" FOR INSERT TO "authenticated" WITH CHECK ((("setting_scope" = 'user'::"text") AND ("user_id" = "auth"."uid"()) AND "public"."is_company_member"("company_id")));



CREATE POLICY "app_settings_select_company_scope" ON "public"."app_settings" FOR SELECT TO "authenticated" USING ((("setting_scope" = 'company'::"text") AND ("user_id" IS NULL) AND "public"."is_company_member"("company_id")));



CREATE POLICY "app_settings_select_user_scope" ON "public"."app_settings" FOR SELECT TO "authenticated" USING ((("setting_scope" = 'user'::"text") AND ("user_id" = "auth"."uid"()) AND "public"."is_company_member"("company_id")));



CREATE POLICY "app_settings_update_company_scope" ON "public"."app_settings" FOR UPDATE TO "authenticated" USING ((("setting_scope" = 'company'::"text") AND ("user_id" IS NULL) AND "public"."can_manage_company"("company_id") AND ("setting_key" IS DISTINCT FROM 'subscription_plan_state'::"text"))) WITH CHECK ((("setting_scope" = 'company'::"text") AND ("user_id" IS NULL) AND "public"."can_manage_company"("company_id") AND ("setting_key" IS DISTINCT FROM 'subscription_plan_state'::"text")));



CREATE POLICY "app_settings_update_company_scope_device_lock_members" ON "public"."app_settings" FOR UPDATE TO "authenticated" USING ((("setting_scope" = 'company'::"text") AND ("company_id" IS NOT NULL) AND ("user_id" IS NULL) AND ("setting_key" = 'active_device_lock'::"text") AND "public"."can_write_company_records"("company_id"))) WITH CHECK ((("setting_scope" = 'company'::"text") AND ("company_id" IS NOT NULL) AND ("user_id" IS NULL) AND ("setting_key" = 'active_device_lock'::"text") AND "public"."can_write_company_records"("company_id")));



CREATE POLICY "app_settings_update_user_scope" ON "public"."app_settings" FOR UPDATE TO "authenticated" USING ((("setting_scope" = 'user'::"text") AND ("user_id" = "auth"."uid"()) AND "public"."is_company_member"("company_id"))) WITH CHECK ((("setting_scope" = 'user'::"text") AND ("user_id" = "auth"."uid"()) AND "public"."is_company_member"("company_id")));



ALTER TABLE "public"."audit_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_events_insert_member_path" ON "public"."audit_events" FOR INSERT TO "authenticated" WITH CHECK (("public"."can_write_company_records"("company_id") AND ("actor_id" = "auth"."uid"())));



ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "companies_insert_authenticated" ON "public"."companies" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("created_by" = "auth"."uid"()) AND ("updated_by" = "auth"."uid"())));



CREATE POLICY "companies_select_active_members" ON "public"."companies" FOR SELECT TO "authenticated" USING (("public"."is_company_member"("id") OR ("created_by" = "auth"."uid"())));



CREATE POLICY "companies_update_owner_admin" ON "public"."companies" FOR UPDATE TO "authenticated" USING ("public"."can_manage_company"("id")) WITH CHECK ("public"."can_manage_company"("id"));



ALTER TABLE "public"."company_entitlement_grants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_stripe_billing_refs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."company_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_users_delete_owner_admin" ON "public"."company_users" FOR DELETE TO "authenticated" USING ("public"."can_manage_company"("company_id"));



CREATE POLICY "company_users_insert_bootstrap_owner" ON "public"."company_users" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("user_id" = "auth"."uid"()) AND ("role" = 'owner'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."companies" "c"
  WHERE (("c"."id" = "company_users"."company_id") AND ("c"."created_by" = "auth"."uid"()))))));



CREATE POLICY "company_users_insert_owner_admin" ON "public"."company_users" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_company"("company_id"));



CREATE POLICY "company_users_select_active_members" ON "public"."company_users" FOR SELECT TO "authenticated" USING (("public"."is_company_member"("company_id") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "company_users_update_owner_admin" ON "public"."company_users" FOR UPDATE TO "authenticated" USING ("public"."can_manage_company"("company_id")) WITH CHECK ("public"."can_manage_company"("company_id"));



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers_insert_operational" ON "public"."customers" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_write_company_records"("company_id"));



CREATE POLICY "customers_select_members" ON "public"."customers" FOR SELECT TO "authenticated" USING ("public"."is_company_member"("company_id"));



CREATE POLICY "customers_update_operational" ON "public"."customers" FOR UPDATE TO "authenticated" USING ("public"."can_write_company_records"("company_id")) WITH CHECK ("public"."can_write_company_records"("company_id"));



ALTER TABLE "public"."estimate_line_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "estimate_line_items_delete_operational" ON "public"."estimate_line_items" FOR DELETE TO "authenticated" USING ("public"."can_write_company_records"("company_id"));



CREATE POLICY "estimate_line_items_insert_operational" ON "public"."estimate_line_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_write_company_records"("company_id"));



CREATE POLICY "estimate_line_items_select_members" ON "public"."estimate_line_items" FOR SELECT TO "authenticated" USING ("public"."is_company_member"("company_id"));



CREATE POLICY "estimate_line_items_update_operational" ON "public"."estimate_line_items" FOR UPDATE TO "authenticated" USING ("public"."can_write_company_records"("company_id")) WITH CHECK ("public"."can_write_company_records"("company_id"));



ALTER TABLE "public"."estimates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "estimates_insert_operational" ON "public"."estimates" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_write_company_records"("company_id"));



CREATE POLICY "estimates_select_members" ON "public"."estimates" FOR SELECT TO "authenticated" USING ("public"."is_company_member"("company_id"));



CREATE POLICY "estimates_update_operational" ON "public"."estimates" FOR UPDATE TO "authenticated" USING ("public"."can_write_company_records"("company_id")) WITH CHECK ("public"."can_write_company_records"("company_id"));



ALTER TABLE "public"."invoice_line_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_line_items_delete_owner_admin" ON "public"."invoice_line_items" FOR DELETE TO "authenticated" USING ("public"."can_manage_company"("company_id"));



CREATE POLICY "invoice_line_items_insert_operational" ON "public"."invoice_line_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_write_company_records"("company_id"));



CREATE POLICY "invoice_line_items_select_members" ON "public"."invoice_line_items" FOR SELECT TO "authenticated" USING ("public"."is_company_member"("company_id"));



CREATE POLICY "invoice_line_items_update_operational" ON "public"."invoice_line_items" FOR UPDATE TO "authenticated" USING ("public"."can_write_company_records"("company_id")) WITH CHECK ("public"."can_write_company_records"("company_id"));



ALTER TABLE "public"."invoice_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_payments_insert_operational" ON "public"."invoice_payments" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_write_company_records"("company_id"));



CREATE POLICY "invoice_payments_select_members" ON "public"."invoice_payments" FOR SELECT TO "authenticated" USING ("public"."is_company_member"("company_id"));



CREATE POLICY "invoice_payments_update_owner_admin" ON "public"."invoice_payments" FOR UPDATE TO "authenticated" USING ("public"."can_manage_company"("company_id")) WITH CHECK ("public"."can_manage_company"("company_id"));



ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoices_insert_operational" ON "public"."invoices" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_write_company_records"("company_id"));



CREATE POLICY "invoices_select_members" ON "public"."invoices" FOR SELECT TO "authenticated" USING ("public"."is_company_member"("company_id"));



CREATE POLICY "invoices_update_operational" ON "public"."invoices" FOR UPDATE TO "authenticated" USING ("public"."can_write_company_records"("company_id")) WITH CHECK ("public"."can_write_company_records"("company_id"));



ALTER TABLE "public"."migration_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "migration_batches_insert_owner_admin" ON "public"."migration_batches" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_company"("company_id"));



CREATE POLICY "migration_batches_select_owner_admin" ON "public"."migration_batches" FOR SELECT TO "authenticated" USING ("public"."can_manage_company"("company_id"));



CREATE POLICY "migration_batches_update_owner_admin" ON "public"."migration_batches" FOR UPDATE TO "authenticated" USING ("public"."can_manage_company"("company_id")) WITH CHECK ("public"."can_manage_company"("company_id"));



ALTER TABLE "public"."migration_write_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "migration_write_results_insert_owner_admin" ON "public"."migration_write_results" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_manage_company"("company_id"));



CREATE POLICY "migration_write_results_select_owner_admin" ON "public"."migration_write_results" FOR SELECT TO "authenticated" USING ("public"."can_manage_company"("company_id"));



CREATE POLICY "migration_write_results_update_owner_admin" ON "public"."migration_write_results" FOR UPDATE TO "authenticated" USING ("public"."can_manage_company"("company_id")) WITH CHECK ("public"."can_manage_company"("company_id"));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_insert_operational" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_write_company_records"("company_id"));



CREATE POLICY "projects_select_members" ON "public"."projects" FOR SELECT TO "authenticated" USING ("public"."is_company_member"("company_id"));



CREATE POLICY "projects_update_operational" ON "public"."projects" FOR UPDATE TO "authenticated" USING ("public"."can_write_company_records"("company_id")) WITH CHECK ("public"."can_write_company_records"("company_id"));



ALTER TABLE "public"."scope_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scope_templates_insert_operational" ON "public"."scope_templates" FOR INSERT TO "authenticated" WITH CHECK ("public"."can_write_company_records"("company_id"));



CREATE POLICY "scope_templates_select_members" ON "public"."scope_templates" FOR SELECT TO "authenticated" USING ("public"."is_company_member"("company_id"));



CREATE POLICY "scope_templates_update_operational" ON "public"."scope_templates" FOR UPDATE TO "authenticated" USING ("public"."can_write_company_records"("company_id")) WITH CHECK ("public"."can_write_company_records"("company_id"));



ALTER TABLE "public"."stripe_subscription_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_subscription_webhook_ordering" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."apply_stripe_subscription_webhook_event"("p_stripe_event_id" "text", "p_event_created_at" timestamp with time zone, "p_subscription_created_at" timestamp with time zone, "p_event_type" "text", "p_company_id" "uuid", "p_stripe_customer_id" "text", "p_stripe_subscription_id" "text", "p_plan" "text", "p_status" "text", "p_current_period_end" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_stripe_subscription_webhook_event"("p_stripe_event_id" "text", "p_event_created_at" timestamp with time zone, "p_subscription_created_at" timestamp with time zone, "p_event_type" "text", "p_company_id" "uuid", "p_stripe_customer_id" "text", "p_stripe_subscription_id" "text", "p_plan" "text", "p_status" "text", "p_current_period_end" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_manage_company"("company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_manage_company"("company_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."can_write_company_records"("company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_write_company_records"("company_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."company_role"("company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."company_role"("company_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."consume_ai_route_quota"("p_user_id" "uuid", "p_company_id" "uuid", "p_budget" "text", "p_user_short_limit" integer, "p_company_short_limit" integer, "p_user_daily_limit" integer, "p_company_daily_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_ai_route_quota"("p_user_id" "uuid", "p_company_id" "uuid", "p_budget" "text", "p_user_short_limit" integer, "p_company_short_limit" integer, "p_user_daily_limit" integer, "p_company_daily_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_company_member"("company_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_company_member"("company_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."prune_ai_route_quota_counters"("p_retention_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prune_ai_route_quota_counters"("p_retention_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;


















GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."app_settings" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."app_settings" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_events" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."companies" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."companies" TO "authenticated";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."company_entitlement_grants" TO "service_role";



GRANT SELECT,INSERT,UPDATE ON TABLE "public"."company_stripe_billing_refs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."company_users" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."company_users" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customers" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."customers" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."estimate_line_items" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."estimate_line_items" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."estimates" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."estimates" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invoice_line_items" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."invoice_line_items" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invoice_payments" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."invoice_payments" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invoices" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."invoices" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."migration_batches" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."migration_batches" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."migration_write_results" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."migration_write_results" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."projects" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."projects" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scope_templates" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."scope_templates" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";




































-- EstiPaid Production baseline parity:
-- Supabase schema dump omitted the database-level event trigger attached to
-- public.rls_auto_enable(). This definition was reconstructed from the
-- Production pg_event_trigger catalog and matches Production exactly.

CREATE EVENT TRIGGER ensure_rls
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
EXECUTE FUNCTION public.rls_auto_enable();
