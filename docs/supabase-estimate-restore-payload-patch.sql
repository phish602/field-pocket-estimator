-- Supabase Gate 10C-A
-- This patch only adds a nullable JSONB restore payload path to
-- public.estimates so a future gate (10C-B) can backfill/write the exact
-- local estimate-builder state needed for faithful cloud -> local restore.
--
-- Why this is needed: public.estimates today stores display-level columns
-- only (estimate_number, status, document_type, total_amount, notes, terms).
-- It does not store the local estimator engine's computational/editing
-- state -- labor.lines[].hours, labor.hazardPct, labor.riskPct,
-- labor.multiplier, materials.markupPct, ui.materialsMode, etc. (see
-- src/estimator/defaultState.js). Without that state, restoring an estimate
-- and then reopening it for edits would force the estimator engine to
-- recompute totals from guessed defaults -- silently wrong math. A single
-- versioned JSONB column lets the local app's estimate shape be preserved
-- exactly, without modeling every estimator field as its own SQL column and
-- without guessing.
--
-- This patch does NOT:
--   - backfill restore_payload for any existing row (Gate 10C-B)
--   - implement the writer code that populates restore_payload (Gate 10C-B)
--   - implement estimate restore itself (Gate 10C-B+)
--   - delete or mutate any existing business data
--   - touch RLS policies (the existing estimates_select_members /
--     estimates_insert_operational / estimates_update_operational policies
--     already cover all columns on the row, including the ones added here --
--     RLS in Postgres is row-level, not column-level, so no new policy is
--     needed for a new nullable column)
--
-- Run the diagnostic query first to confirm no restore-payload columns
-- already exist (expected: zero rows on a database that has not run this
-- patch yet).

-- Diagnostic: does public.estimates already have any restore-payload-shaped
-- column? If this returns rows, stop and review before proceeding --
-- this patch assumes none of these columns exist yet.
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'estimates'
  and column_name in (
    'restore_payload',
    'restore_payload_version',
    'restore_payload_captured_at',
    'metadata',
    'local_snapshot',
    'estimate_state'
  )
order by column_name;

begin;

alter table public.estimates
  add column if not exists restore_payload jsonb;

alter table public.estimates
  add column if not exists restore_payload_version text;

alter table public.estimates
  add column if not exists restore_payload_captured_at timestamptz;

-- restore_payload is intentionally left nullable: existing migrated rows
-- (Gate 7C and earlier) do not have a restore payload yet, and this patch
-- does not backfill one. Only the shape is constrained -- when present, it
-- must be a JSON object, never an array/scalar/string -- so a future writer
-- can rely on jsonb_typeof without re-validating it everywhere it's read.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'estimates_restore_payload_object_check'
      and conrelid = 'public.estimates'::regclass
  ) then
    alter table public.estimates
      add constraint estimates_restore_payload_object_check
      check (
        restore_payload is null
        or jsonb_typeof(restore_payload) = 'object'
      );
  end if;
end
$$;

commit;

-- Verification: confirm the three columns exist with the expected types.
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'estimates'
  and column_name in (
    'restore_payload',
    'restore_payload_version',
    'restore_payload_captured_at'
  )
order by column_name;

-- Verification: confirm the check constraint exists with the expected definition.
select
  n.nspname as schema_name,
  c.relname as table_name,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as constraint_definition
from pg_constraint con
join pg_class c
  on c.oid = con.conrelid
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'estimates'
  and con.conname = 'estimates_restore_payload_object_check';

-- Verification: confirm no existing rows were touched (should equal the
-- restore_payload column being null for every row, since this patch never
-- writes to it).
select
  count(*) as total_estimates,
  count(restore_payload) as estimates_with_restore_payload
from public.estimates;

-- Rollback if needed:
-- alter table public.estimates
--   drop constraint if exists estimates_restore_payload_object_check;
--
-- alter table public.estimates
--   drop column if exists restore_payload_captured_at;
--
-- alter table public.estimates
--   drop column if exists restore_payload_version;
--
-- alter table public.estimates
--   drop column if exists restore_payload;
