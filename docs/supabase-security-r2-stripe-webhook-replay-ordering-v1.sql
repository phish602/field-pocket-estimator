-- EstiPaid Security R2.3B — forward-only durable Stripe webhook replay/order authority.
-- Exact scope: subscription webhook replay, stale-event and deletion-tombstone protection.
-- Stores no raw payloads, arbitrary event JSON, signatures, headers, secrets, or customer PII.
-- REVIEW AND SEPARATE EXECUTION AUTHORIZATION ARE REQUIRED BEFORE RUNNING IN PRODUCTION.
-- These additive objects are compatible with deployed R2.3A code until the new RPC caller ships.

begin;

do $$
declare
  v_unique_state_index boolean;
begin
  if to_regclass('public.companies') is null
     or to_regclass('public.app_settings') is null
     or to_regclass('public.company_stripe_billing_refs') is null then
    raise exception 'Security R2.3B precondition failed: required existing table is missing';
  end if;
  if to_regclass('public.stripe_subscription_webhook_ordering') is not null
     or to_regclass('public.stripe_subscription_webhook_events') is not null then
    raise exception 'Security R2.3B refused: replay/order tables already exist';
  end if;
  if to_regprocedure('public.apply_stripe_subscription_webhook_event(text,timestamp with time zone,timestamp with time zone,text,uuid,text,text,text,text,timestamp with time zone)') is not null then
    raise exception 'Security R2.3B refused: replay/order function already exists';
  end if;

  select exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where i.indrelid = 'public.app_settings'::regclass
       and i.indisunique
       and c.relname = 'app_settings_company_setting_key_uniq'
       and pg_get_expr(i.indpred, i.indrelid) = '(setting_scope = ''company''::text)'
       and (select array_agg(a.attname::text order by key.ord)
              from unnest(i.indkey) with ordinality as key(attnum, ord)
              join pg_attribute a on a.attrelid = i.indrelid and a.attnum = key.attnum)
           = array['company_id', 'setting_key']::text[]
  ) into v_unique_state_index;
  if not v_unique_state_index then
    raise exception 'Security R2.3B precondition failed: app_settings_company_setting_key_uniq does not guarantee one company subscription_plan_state row';
  end if;
  if exists (
    select 1 from public.app_settings
     where setting_scope = 'company' and setting_key = 'subscription_plan_state'
     group by company_id having count(*) > 1
  ) then
    raise exception 'Security R2.3B precondition failed: duplicate company subscription_plan_state rows exist';
  end if;
end $$;

create table public.stripe_subscription_webhook_ordering (
  company_id uuid not null references public.companies(id) on delete cascade,
  stripe_subscription_id text not null,
  stripe_subscription_created_at timestamptz null,
  last_event_created_at timestamptz not null,
  is_deleted boolean not null default false,
  is_superseded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_subscription_webhook_ordering_pkey primary key (company_id, stripe_subscription_id),
  constraint stripe_subscription_webhook_ordering_subscription_key unique (stripe_subscription_id),
  constraint stripe_subscription_webhook_ordering_subscription_nonblank_check
    check (btrim(stripe_subscription_id) <> ''),
  constraint stripe_subscription_webhook_ordering_created_at_check
    check (stripe_subscription_created_at is not null or is_superseded)
);
alter table public.stripe_subscription_webhook_ordering owner to postgres;
create index stripe_subscription_webhook_ordering_company_updated_idx
  on public.stripe_subscription_webhook_ordering (company_id, updated_at);
comment on table public.stripe_subscription_webhook_ordering is
  'Security R2.3B durable ordering: event time within a subscription; immutable Stripe subscription creation time across replacements; permanent tombstones and superseded barriers. No payloads, signatures, secrets, or PII.';

create table public.stripe_subscription_webhook_events (
  stripe_event_id text not null,
  company_id uuid not null,
  stripe_subscription_id text not null,
  event_type text not null,
  event_created_at timestamptz not null,
  applied_at timestamptz not null default now(),
  constraint stripe_subscription_webhook_events_pkey primary key (stripe_event_id),
  constraint stripe_subscription_webhook_events_ordering_fkey
    foreign key (company_id, stripe_subscription_id)
    references public.stripe_subscription_webhook_ordering (company_id, stripe_subscription_id)
    on delete cascade,
  constraint stripe_subscription_webhook_events_event_nonblank_check check (btrim(stripe_event_id) <> ''),
  constraint stripe_subscription_webhook_events_subscription_nonblank_check check (btrim(stripe_subscription_id) <> ''),
  constraint stripe_subscription_webhook_events_type_check check (event_type in (
    'checkout.session.completed', 'customer.subscription.created',
    'customer.subscription.updated', 'customer.subscription.deleted'
  ))
);
alter table public.stripe_subscription_webhook_events owner to postgres;
create index stripe_subscription_webhook_events_company_subscription_created_idx
  on public.stripe_subscription_webhook_events (company_id, stripe_subscription_id, event_created_at);
create index stripe_subscription_webhook_events_applied_at_idx
  on public.stripe_subscription_webhook_events (applied_at);
comment on table public.stripe_subscription_webhook_events is
  'Security R2.3B successfully applied Stripe event ledger only. No payloads, signatures, secrets, or PII.';

alter table public.stripe_subscription_webhook_ordering enable row level security;
alter table public.stripe_subscription_webhook_events enable row level security;
revoke all privileges on table public.stripe_subscription_webhook_ordering from public;
revoke all privileges on table public.stripe_subscription_webhook_ordering from anon;
revoke all privileges on table public.stripe_subscription_webhook_ordering from authenticated;
revoke all privileges on table public.stripe_subscription_webhook_ordering from service_role;
revoke all privileges on table public.stripe_subscription_webhook_events from public;
revoke all privileges on table public.stripe_subscription_webhook_events from anon;
revoke all privileges on table public.stripe_subscription_webhook_events from authenticated;
revoke all privileges on table public.stripe_subscription_webhook_events from service_role;

create function public.apply_stripe_subscription_webhook_event(
  p_stripe_event_id text,
  p_event_created_at timestamptz,
  p_subscription_created_at timestamptz,
  p_event_type text,
  p_company_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_plan text,
  p_status text,
  p_current_period_end timestamptz
)
returns table (result_category text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
alter function public.apply_stripe_subscription_webhook_event(text, timestamptz, timestamptz, text, uuid, text, text, text, text, timestamptz) owner to postgres;
comment on function public.apply_stripe_subscription_webhook_event(text, timestamptz, timestamptz, text, uuid, text, text, text, text, timestamptz) is
  'Security R2.3B atomic Stripe webhook replay/order authority. service_role only.';
revoke all privileges on function public.apply_stripe_subscription_webhook_event(text, timestamptz, timestamptz, text, uuid, text, text, text, text, timestamptz) from public;
revoke all privileges on function public.apply_stripe_subscription_webhook_event(text, timestamptz, timestamptz, text, uuid, text, text, text, text, timestamptz) from anon;
revoke all privileges on function public.apply_stripe_subscription_webhook_event(text, timestamptz, timestamptz, text, uuid, text, text, text, text, timestamptz) from authenticated;
grant execute on function public.apply_stripe_subscription_webhook_event(text, timestamptz, timestamptz, text, uuid, text, text, text, text, timestamptz) to service_role;

do $$
declare v_role text; v_privilege text; v_function record;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, 'public.stripe_subscription_webhook_ordering', v_privilege)
         or has_table_privilege(v_role, 'public.stripe_subscription_webhook_events', v_privilege) then
        raise exception 'Security R2.3B refused: % retains table privilege %', v_role, v_privilege;
      end if;
    end loop;
  end loop;
  if exists (
    select 1 from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     where c.oid in ('public.stripe_subscription_webhook_ordering'::regclass, 'public.stripe_subscription_webhook_events'::regclass)
       and a.grantee = 0
  ) then raise exception 'Security R2.3B refused: replay/order table retains PUBLIC ACL'; end if;
  for v_function in select prosecdef, proconfig, pg_get_userbyid(proowner) as owner from pg_proc
    where oid = 'public.apply_stripe_subscription_webhook_event(text,timestamp with time zone,timestamp with time zone,text,uuid,text,text,text,text,timestamp with time zone)'::regprocedure loop
    if not v_function.prosecdef or v_function.owner is distinct from 'postgres'
       or not coalesce(v_function.proconfig, array[]::text[]) @> array['search_path=pg_catalog, public'] then
      raise exception 'Security R2.3B refused: function security postcondition failed';
    end if;
  end loop;
end $$;

commit;
