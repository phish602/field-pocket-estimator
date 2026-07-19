-- EstiPaid Security Gate R2.2 — forward-only durable paid-AI request quota.
-- Canonical Postgres is the quota authority so enforcement holds across
-- concurrent Vercel instances and process restarts.
--
-- SCOPE: every paid AI endpoint. Both POST /api/ai-assist and POST
-- /api/guided-build consume from ONE shared per-user and per-company budget.
-- Guided Build has no reachable trigger in the current UI, but the endpoint
-- still accepts direct authenticated requests, so it is enrolled here. Counters
-- are therefore keyed by budget, never by route: two routes must not hand a
-- caller two independent allowances.
--
-- This migration stores identifiers, bucket timestamps, counters and
-- maintenance timestamps ONLY. It never stores routes, access tokens, prompts,
-- estimates, customer text, AI responses, IP addresses or any other request
-- content. It changes no existing business-table policy, grant, constraint or
-- row.

begin;

-- Fail closed on preconditions. CREATE TABLE IF NOT EXISTS would silently
-- accept a pre-existing relation missing required columns, keys, checks, RLS or
-- trusted ownership, so this migration refuses to run against one at all.
do $$
begin
  if to_regclass('public.company_users') is null then
    raise exception 'Security R2.2 precondition failed: public.company_users is missing';
  end if;

  if to_regclass('public.ai_route_quota_counters') is not null then
    raise exception 'Security R2.2 refused: public.ai_route_quota_counters already exists; review and drop it deliberately before re-running this forward-only migration';
  end if;
end $$;

-- Bounded time buckets: at most four live rows per (user, company) pair for the
-- whole paid-AI budget -- one short bucket and one daily bucket for each
-- subject. There is no per-request row and no per-route row.
create table public.ai_route_quota_counters (
  subject_type text not null,
  subject_id uuid not null,
  budget_key text not null,
  window_kind text not null,
  bucket_started_at timestamptz not null,
  request_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_route_quota_counters_pkey
    primary key (subject_type, subject_id, budget_key, window_kind, bucket_started_at),
  constraint ai_route_quota_counters_subject_type_check
    check (subject_type in ('user', 'company')),
  constraint ai_route_quota_counters_budget_key_check
    check (budget_key in ('paid_ai')),
  constraint ai_route_quota_counters_window_kind_check
    check (window_kind in ('short', 'daily')),
  constraint ai_route_quota_counters_request_count_check
    check (request_count >= 0)
);

alter table public.ai_route_quota_counters owner to postgres;

comment on table public.ai_route_quota_counters is
  'Security R2.2 durable paid-AI request quota, shared by every paid AI route. Identifiers, bucket timestamps and counters only: never routes, tokens, prompts, customer text, AI responses or IP addresses.';
comment on column public.ai_route_quota_counters.subject_id is
  'auth user id or company id. No other identifier is ever stored here.';
comment on column public.ai_route_quota_counters.budget_key is
  'Shared allowance these counters belong to. Deliberately not a route: all paid AI routes draw down the same budget.';
comment on column public.ai_route_quota_counters.request_count is
  'Admitted HTTP requests in this bucket. One quota unit per admitted request.';

create index ai_route_quota_counters_bucket_started_at_idx
  on public.ai_route_quota_counters (bucket_started_at);

-- Browser roles get nothing: no policy, no grant, no readable usage. RLS is
-- enabled with zero policies so any non-bypassing role sees an empty table.
-- FORCE is intentionally not used: the SECURITY DEFINER owner must retain
-- access for atomic consumption to work.
alter table public.ai_route_quota_counters enable row level security;

revoke all privileges on table public.ai_route_quota_counters from public;
revoke all privileges on table public.ai_route_quota_counters from anon;
revoke all privileges on table public.ai_route_quota_counters from authenticated;
-- service_role reaches this table only through the two SECURITY DEFINER
-- functions below; it holds no direct read or DML privilege on the table.
-- This narrows the blast radius, it does not eliminate it: service_role keeps
-- EXECUTE on those functions by design, so a compromised service-role
-- credential can still consume quota through them. Defending the credential
-- itself is outside what this table-grant boundary can guarantee.
revoke all privileges on table public.ai_route_quota_counters from service_role;

-- Atomically consume one paid-AI quota unit, enforcing per-user and
-- per-company limits in both the short window and the UTC day.
--
-- The caller passes a BUDGET, not a route. /api/ai-assist and
-- /api/guided-build both pass 'paid_ai' and therefore contend for the same four
-- rows; neither route can grant a caller a second allowance.
--
-- Concurrency: rows are created first, then locked FOR UPDATE in a fixed order
-- -- company short, company daily, user short, user daily. Company rows are the
-- only rows shared between callers and are always taken first, so concurrent
-- requests serialize on them and no lock cycle can form. Counts are read under
-- those locks and incremented only if EVERY limit still has room, so two
-- concurrent requests can never together exceed a limit. A denial increments
-- nothing.
create or replace function public.consume_ai_route_quota(
  p_user_id uuid,
  p_company_id uuid,
  p_budget text,
  p_user_short_limit integer,
  p_company_short_limit integer,
  p_user_daily_limit integer,
  p_company_daily_limit integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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

-- CREATE OR REPLACE preserves any pre-existing owner, so ownership is set
-- explicitly: a SECURITY DEFINER function must never run as an untrusted role.
alter function public.consume_ai_route_quota(uuid, uuid, text, integer, integer, integer, integer) owner to postgres;

comment on function public.consume_ai_route_quota(uuid, uuid, text, integer, integer, integer, integer) is
  'Security R2.2: atomically consume one shared paid-AI quota unit under per-user and per-company short-window and daily limits. service_role only.';

-- Global maintenance sweep for subjects that stopped calling entirely.
create or replace function public.prune_ai_route_quota_counters(
  p_retention_days integer default 2
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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

alter function public.prune_ai_route_quota_counters(integer) owner to postgres;

comment on function public.prune_ai_route_quota_counters(integer) is
  'Security R2.2 retention sweep for abandoned quota buckets. service_role only.';

-- Quota consumption is a server capability, never a browser one.
revoke all privileges on function public.consume_ai_route_quota(uuid, uuid, text, integer, integer, integer, integer) from public;
revoke all privileges on function public.consume_ai_route_quota(uuid, uuid, text, integer, integer, integer, integer) from anon;
revoke all privileges on function public.consume_ai_route_quota(uuid, uuid, text, integer, integer, integer, integer) from authenticated;
grant execute on function public.consume_ai_route_quota(uuid, uuid, text, integer, integer, integer, integer) to service_role;

revoke all privileges on function public.prune_ai_route_quota_counters(integer) from public;
revoke all privileges on function public.prune_ai_route_quota_counters(integer) from anon;
revoke all privileges on function public.prune_ai_route_quota_counters(integer) from authenticated;
grant execute on function public.prune_ai_route_quota_counters(integer) to service_role;

-- Post-conditions. The migration aborts rather than leaving a quota authority
-- that is unowned, unprotected, browser-readable or not SECURITY DEFINER.
do $$
declare
  v_owner text;
  v_rls boolean;
  v_function record;
  v_role text;
  v_privilege text;
begin
  select pg_get_userbyid(relowner), relrowsecurity
    into v_owner, v_rls
    from pg_class
   where oid = 'public.ai_route_quota_counters'::regclass;

  if v_owner is distinct from 'postgres' then
    raise exception 'Security R2.2 refused: ai_route_quota_counters is owned by % rather than postgres', v_owner;
  end if;
  if not v_rls then
    raise exception 'Security R2.2 refused: row level security is not enabled on ai_route_quota_counters';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'ai_route_quota_counters'
  ) then
    raise exception 'Security R2.2 refused: ai_route_quota_counters must have no policy';
  end if;
  -- Effective-privilege check. information_schema.role_table_grants is not
  -- authoritative here: it does not surface privileges a role holds only by
  -- inheritance, and it does not reliably represent PUBLIC. has_table_privilege
  -- resolves the privilege a role can actually exercise, inheritance included.
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if to_regrole(v_role) is null then
      raise exception 'Security R2.2 refused: expected role % does not exist on this database', v_role;
    end if;
    foreach v_privilege in array array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] loop
      if has_table_privilege(v_role, 'public.ai_route_quota_counters', v_privilege) then
        raise exception 'Security R2.2 refused: % retains effective % on ai_route_quota_counters', v_role, v_privilege;
      end if;
    end loop;
  end loop;

  -- PUBLIC is not a role and never appears in has_table_privilege, so it is
  -- verified straight from the table ACL. aclexplode reports the PUBLIC
  -- grantee as OID 0; any entry at all means some privilege reaches everyone.
  if exists (
    select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid = 'public.ai_route_quota_counters'::regclass
       and a.grantee = 0
  ) then
    raise exception 'Security R2.2 refused: ai_route_quota_counters still carries a PUBLIC table ACL entry';
  end if;

  for v_function in
    select proname, prosecdef, proconfig, pg_get_userbyid(proowner) as owner
      from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('consume_ai_route_quota', 'prune_ai_route_quota_counters')
  loop
    if v_function.owner is distinct from 'postgres' then
      raise exception 'Security R2.2 refused: % is owned by % rather than postgres', v_function.proname, v_function.owner;
    end if;
    if not v_function.prosecdef then
      raise exception 'Security R2.2 refused: % is not SECURITY DEFINER', v_function.proname;
    end if;
    if not coalesce(v_function.proconfig, array[]::text[]) @> array['search_path=pg_catalog, public'] then
      raise exception 'Security R2.2 refused: % does not fix search_path', v_function.proname;
    end if;
  end loop;
end $$;

commit;
