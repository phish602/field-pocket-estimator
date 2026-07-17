-- EstiPaid Gate 17A — company_entitlement_grants (forward migration)
--
-- Purpose:
-- Internal complimentary access is a server-only authority. It is NOT an email
-- allowlist, a founder flag, a browser toggle, or a fake Stripe subscription.
-- It lives in this dedicated table so it can be granted, revoked, audited and
-- reasoned about independently of billing.
--
-- Security model:
-- Only service_role may read or write these rows. Browser clients (anon and
-- authenticated) have no privileges and no policies, so RLS denies them by
-- default -- a company owner cannot grant themselves complimentary access.
-- Grants are revoked, never deleted, so history is preserved: service_role is
-- intentionally NOT given delete.
--
-- Applies to: public.company_entitlement_grants only.
-- Alters no existing table, policy, or business record.

begin;

create table if not exists public.company_entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plan text not null,
  source text not null default 'internal_comp',
  starts_at timestamptz not null default now(),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  granted_by_user_id uuid not null,
  reason text not null,
  revoked_by_user_id uuid null,
  revoke_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Free is never granted: absence of a grant already means Free.
  constraint company_entitlement_grants_plan_check
    check (plan in ('solo', 'pro', 'business')),
  -- This table exclusively represents internal complimentary access. It must
  -- never be used to impersonate Stripe billing authority.
  constraint company_entitlement_grants_source_check
    check (source = 'internal_comp'),
  constraint company_entitlement_grants_reason_check
    check (btrim(reason) <> ''),
  constraint company_entitlement_grants_expires_after_starts_check
    check (expires_at is null or expires_at > starts_at),
  constraint company_entitlement_grants_revoked_after_starts_check
    check (revoked_at is null or revoked_at >= starts_at),
  -- Revocation must always carry a human reason, and a live grant must not
  -- carry a revoke reason.
  constraint company_entitlement_grants_revoke_reason_check
    check (
      (revoked_at is null and revoke_reason is null)
      or (revoked_at is not null and btrim(coalesce(revoke_reason, '')) <> '')
    ),
  constraint company_entitlement_grants_revoked_by_check
    check (
      (revoked_at is null and revoked_by_user_id is null)
      or (revoked_at is not null and revoked_by_user_id is not null)
    )
);

-- Company lookup.
create index if not exists company_entitlement_grants_company_id_idx
  on public.company_entitlement_grants (company_id);

-- Active-grant lookup: the resolver reads unrevoked rows for one company.
-- now() is deliberately NOT used in the predicate (it is not immutable); the
-- starts_at/expires_at window is evaluated in the resolver instead.
create index if not exists company_entitlement_grants_active_idx
  on public.company_entitlement_grants (company_id, starts_at, expires_at)
  where revoked_at is null;

-- At most one unrevoked grant per company. An expired-but-unrevoked grant is a
-- historical record and still occupies this slot: it must be explicitly revoked
-- before a new grant can be created, so nothing is ever silently replaced.
create unique index if not exists company_entitlement_grants_one_active_per_company_idx
  on public.company_entitlement_grants (company_id)
  where revoked_at is null;

alter table public.company_entitlement_grants enable row level security;

-- No anon/authenticated policies are created. With RLS enabled and no policy,
-- browser clients are denied by default.
revoke all on table public.company_entitlement_grants from anon;
revoke all on table public.company_entitlement_grants from authenticated;

-- service_role reads grants (resolver), inserts them (grant) and updates them
-- (revoke). Everything else is withheld: grant history is immutable.
--
-- The REVOKE below is essential, not decorative. Supabase ships a default
-- privilege rule granting broad access on new public tables to service_role, so
-- without this a fresh table arrives holding TRUNCATE/REFERENCES/TRIGGER and the
-- additive grant beneath it would be redundant. TRUNCATE in particular would
-- erase the entire audit history in one statement.
revoke all on table public.company_entitlement_grants from service_role;
grant select, insert, update on table public.company_entitlement_grants to service_role;

commit;
