# Production Baseline Migration-History Repair

Operational record of a one-time repair to Production's Supabase migration history,
performed on 2026-08-04. No schema migration was added, and no schema object changed.

## Incident summary

The Supabase migration check failed with SQLSTATE `42P16`:

```
ERROR: multiple primary keys for table "ai_route_quota_counters" are not allowed (SQLSTATE 42P16)
At statement: 96
```

The failure occurred while replaying baseline version `20260725071222`.

At the time of the failure:

- Production already contained the `ai_route_quota_counters` table and its intended
  primary key;
- the remote migration history was empty, so Supabase treated the baseline as still
  pending and attempted to replay it.

The primary-key SQL was **not** duplicated within the executable migration set. The
baseline declares the constraint exactly once. The error came from replaying a
correct migration against a database that already had the object.

## Root cause

- The repository has exactly one executable migration:
  `supabase/migrations/20260725071222_production_baseline.sql`.
- Earlier manual security and patch SQL exists under `docs/`, but the migration
  runner never executes it. `supabase/config.toml` sets `schema_paths = []`, so only
  `supabase/migrations/` is applied.
- The baseline contains one `CREATE TABLE` and one primary-key declaration for
  `ai_route_quota_counters`.
- On replay, `CREATE TABLE IF NOT EXISTS` skipped the existing Production table
  silently.
- The later, unconditional `ALTER TABLE ... ADD CONSTRAINT ... PRIMARY KEY` is not
  idempotent, so it attempted to add a second primary key and failed.

The defect was **migration-history drift**, not an incorrect primary-key definition.
Production's schema was already correct; only the history record was missing.

## Baseline identity

- Migration version: `20260725071222`
- File: `supabase/migrations/20260725071222_production_baseline.sql`
- SHA-256: `fb2320be99c4869571fe551092e701adb73a996d65c9c9238bfae64e8f4cf1f5`
- File length observed during the audit: 2,191 lines

The checksum was verified before the repair and again afterward; it did not change.

## Equivalence audit

Evidence established **before** the write:

- A clean local replay from an empty local database succeeded with no warnings or
  errors.
- Exactly one migration was applied locally.
- 19 tables and 19 primary keys were present; no table carried more than one primary
  key.
- RLS was enabled on all 19 baseline tables.
- 49 policies were present.
- The quota table had exactly one five-column primary key, `ai_route_quota_counters_pkey`,
  validated, backed by a primary/unique/valid/ready index.
- `supabase db diff --from migrations --to linked --schema public` returned an empty
  diff.
- `supabase db diff --from migrations --to linked --schema extensions,vault` returned
  an empty diff.
- Every material baseline object in Production matched the baseline.
- No unexplained material schema drift remained.

Quota primary-key columns, in order:

1. `subject_type`
2. `subject_id`
3. `budget_key`
4. `window_kind`
5. `bucket_started_at`

## Diff-engine blind spot

An empty schema diff was **not** accepted on its own, and that caution mattered.

- The `pg-delta` comparison used by `supabase db diff` does not report privilege
  differences.
- Full read-only schema dumps of both sides exposed 90 differing lines, all
  GRANT-related, that the diff engine had not reported.
- Production matched the baseline's 29 explicit privilege entries **exactly**.
- The local Supabase stack carried 28 additional ambient privileges
  (`REFERENCES`, `TRIGGER`, `TRUNCATE`, `MAINTAIN`) introduced by its bootstrap
  default privileges at table-creation time. The baseline's own
  `ALTER DEFAULT PRIVILEGES` statements appear after all `CREATE TABLE` statements
  and therefore never applied to these tables.
- The difference was local-environment privilege noise in the safe direction
  (local was a superset of Production), not Production drift.

If a future audit repeats this comparison, expect the same GRANT-only difference and
verify the direction before treating it as drift.

## Publication verification

- Publication `supabase_realtime` existed exactly once in Production.
- Its owner was `postgres`.
- The Production ownership statement matched the baseline byte for byte:
  `ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";`
- The baseline contained no publication membership change (zero `ADD TABLE`
  statements), and Production reported none.
- No publication was altered during the repair.

Note: a `--schema public` dump omits publications. The verification required a full
dump with no schema restriction.

## Production target verification

- The linked Supabase project was proven to be the active project used by canonical
  EstiPaid Production.
- It was **not** the paused older project, which is a separate project in the same
  organization.
- It was **not** a Preview branch and **not** a local project.
- Vercel does not return encrypted environment-variable values through environment
  export; every sensitive variable exported as an empty string. The intended
  comparison could not be completed from Vercel metadata alone.
- The browser-public Supabase URL embedded in the Production JavaScript bundle was
  used only to compare the non-secret project identifier. That value is already
  served to every visitor's browser.
- No secret key was extracted or recorded. The comparison was performed in memory and
  reported only as a boolean match.

## Repair operation

```bash
supabase migration repair 20260725071222 --status applied --linked
```

Executed exactly once, with no additional flags, against the linked Production
project. Result:

```
Repaired migration history: [20260725071222] => applied
```

The command updates only the `supabase_migrations.schema_migrations` tracking table.
It does not execute the baseline SQL.

## Before and after

Migration history, via `supabase migration list --linked`:

| | Local | Remote |
|---|---|---|
| Before | `20260725071222` | *(empty)* |
| After | `20260725071222` | `20260725071222` |

After the repair the version appears exactly once on each side, with no duplicate and
no unexpected version.

Pending migrations, via `supabase db push --linked --dry-run`:

Before:

```
Would push these migrations:
 • 20260725071222_production_baseline.sql
```

After:

```
Remote database is up to date.
```

## Schema-integrity proof

Full read-only schema dumps taken immediately before and immediately after the repair
were **byte-identical** (SHA-256
`4d28d13b9b3c6a62053b3d08f23f0586ea6e1b788dac5f8a8293e923273ed698` on both).

Confirmed for this operation:

- no migration SQL executed;
- no table, primary key, index, policy, function, publication, grant, user,
  authentication record, or storage object changed;
- no contractor business row was queried or modified;
- no deployment, environment variable, or project/branch configuration changed.

Post-repair re-verification confirmed the quota table still has exactly one primary
key, `ai_route_quota_counters_pkey`, with the same five ordered columns, and RLS still
enabled. The baseline file checksum was unchanged.

## Supabase integration check

- The `Supabase Preview` check on the merged commit remains **historically failed**.
  Completed check runs are immutable, so the recorded failure does not clear
  retroactively.
- Per-PR branch creation is disabled at the integration level, so **no new check was
  triggered** by the repair.
- End-to-end confirmation that a future migration run now succeeds has **not** been
  performed. It requires re-enabling or rerunning the Supabase integration, which was
  outside the authorization for this work. Until then, the repair's effect is
  evidenced by the dry run reporting the remote database up to date, not by a green
  integration check.

## Operational rules

Guidance for a maintainer facing this situation again:

- **Do not add a repair migration and do not edit the baseline.** Production's schema
  already matched the baseline. Making the constraint conditional would have changed
  correct SQL to work around a bookkeeping problem and would have left the same
  history gap in place. Recording the baseline as applied is the minimal correct
  action.
- **Do not add a SQL-text-counting unit test.** Such a test was considered and
  rejected: the SQL was never wrong, so it would assert something that never failed
  while giving false confidence about schema equivalence, which text inspection
  cannot establish.
- **`supabase migration repair` asserts equivalence rather than establishing it.** It
  was safe here only because the equivalence audit passed first. Do not run it to
  clear a failing check without repeating that audit.
- **Expect the GRANT-only dump difference** described above when comparing a local
  replay against Production, and verify its direction before treating it as drift.
- **Publication membership was compared by dump output only.** The baseline declares
  no membership, so there was nothing to drift; a different baseline would need a
  stronger check.
