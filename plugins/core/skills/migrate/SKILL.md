---
name: migrate
description: Use when creating, pushing, validating, troubleshooting, or repairing Supabase database migrations. Triggers on mentions of migrations, schema changes, database changes, RLS policies, row-level security, Supabase CLI operations (db push, db reset, gen types), migration drift, diverged migrations, declarative schemas (supabase/schemas/), creating tables, altering columns, adding indexes, or any SQL DDL work targeting a Supabase project. Also triggers on "supabase migrate", "db push", "migration repair", "schema diff", or type generation after schema changes.
---

# Supabase Migration Skill

Orchestrate the full lifecycle of a Supabase database migration: detect project mode, create the migration file, validate SQL, push, and run post-push steps.

## Step 1: Detect Project Mode

Check the project root for `supabase/config.toml`:

- **File exists** --> **Local-first mode**. Has Docker/local Supabase, supports `db reset`, local type generation.
- **File does not exist** --> **Remote-only mode**. Pushes directly to hosted Supabase, no local type generation by default.

Then check for declarative schemas:

- **`supabase/schemas/` exists, or `config.toml` sets `[db.migrations] schema_paths`** --> also **Declarative mode**. The schema files are the source of truth and migrations are generated from them, not hand-written. Note the diff engine: `config.toml` has `[experimental.pgdelta]` with `enabled = true` --> **pg-delta**; otherwise --> **legacy migra**.

Report which mode (and, for declarative, which engine) was detected and which project directory you are in before proceeding.

## Step 2: Create the Migration File

1. Create the file with the Supabase CLI. Don't hand-write the filename or its stamp.
   - **Local-first or remote-only mode:** `npx supabase migration new <description>`. The CLI stamps the name from the UTC clock (`YYYYMMDDHHmmss`) and creates an empty `supabase/migrations/<timestamp>_<description>.sql`; write the SQL into it.
   - **Declarative mode:** edit the files under `supabase/schemas/` (append new columns at the end of a table), then generate the migration:
     - pg-delta: `npx supabase db schema declarative sync -f <description> --no-apply`
     - legacy migra: `npx supabase stop`, then `npx supabase db diff -f <description>`, then `npx supabase start`

     Both diff the schema files against `supabase/migrations`, not the live database, so a change made through Studio, the SQL editor, or `psql` is invisible to them and gets dropped. On pg-delta, don't use `db diff`: there it diffs the live database and ignores `supabase/schemas/`.
2. Mind the stamp's order against the base branch:
   > **A stamp is not a reservation.** What decides acceptance is the base branch's head at
   > **merge** time, not the clock when you authored the file. If anything with a higher stamp
   > merges while your branch is open, `supabase db push` refuses your file — at *deploy* time,
   > after the merge, with prod one deploy behind. Nothing warns you earlier: the stamp is valid
   > at authoring, valid on every `db reset`, and valid in CI. This bites hardest on projects with
   > multiple contributors landing migrations in parallel — it has recurred even when the
   > mitigation was written into a plan's own risk section and skipped anyway.
   >
   > So, as the **first** command of the PR-opening sequence:
   > `git fetch origin main && ls supabase/migrations | tail -3`
   > Any local migration stamped at or below main's newest is a blocker. Repair is cheap and boring:
   > `git mv` to a fresh UTC stamp (`date -u +%Y%m%d%H%M%S`, the clock `migration new` uses), then
   > `grep -rl "<old stamp>" src/ supabase/` (comments and test fixtures reference migration
   > filenames), then a `db reset` to prove the replay.
   >
   > Better than remembering it: make CI fail the PR. If the repo has (or can add) a
   > migration-order lint — comparing each ADDED migration's stamp against the base branch's
   > newest migration file — wire it as a required check, plus a workflow that re-runs that one
   > check on open migration-carrying PRs whenever the base branch gains a migration (that's the
   > stale-green window a pre-PR command alone cannot close: a PR can go green, then sit while
   > someone else's migration lands, and merge anyway on the stale pass). If such a check diffs
   > `origin/main...HEAD`, fetch the base branch **undepthed**; a `--depth=1` fetch has no
   > ancestry and dies with "no merge base" as soon as the base branch moves.
3. Start every migration file with this header comment:

```sql
-- Migration: <short description>
-- Created: <YYYY-MM-DD>
-- Tables affected: <comma-separated list>
```

4. For any RLS policy that covers INSERT or UPDATE operations, include a `WITH CHECK` clause. Remind the user if they omit it.

## Step 3: Validate SQL Before Pushing

Before pushing, review the migration SQL for these common problems:

### Syntax and correctness
- Missing semicolons at end of statements
- Referencing tables or columns that do not exist yet (check earlier migrations and the current one)
- Typos in table/column names

### RLS policy completeness
- Every INSERT policy must have `WITH CHECK (...)`
- Every UPDATE policy must have both `USING (...)` and `WITH CHECK (...)`
- SELECT and DELETE policies need `USING (...)` only

### Idempotency guards
- Use `CREATE TABLE IF NOT EXISTS` instead of bare `CREATE TABLE` when the table may already exist
- Use `DROP ... IF EXISTS` before recreating objects
- Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` when safe to do so
- These guards are especially important after a partially-failed push

### Trigger warnings
- If the migration creates triggers on `auth.users`: warn that triggers on `auth.users` defined in migrations may not fire on hosted Supabase. Suggest using Supabase Dashboard webhooks or database functions called via `auth.hook` instead.

### Declarative mode
- Review the generated file with the same checks.
- The diff never captures DML (including storage buckets, which are rows), so data changes go in a separate `migration new` file.
- Generated `GRANT`/`REVOKE` lines you didn't write reflect default privileges.

Report all findings to the user. Do not proceed to push until issues are resolved.

## Step 4: Push the Migration

**IMPORTANT: Never auto-push without showing the user what will change. Always present the migration SQL and ask for confirmation before running any push command.**

### Local-first mode
1. Run `npx supabase db reset` to verify all migrations replay cleanly from scratch.
2. If reset succeeds, run `npx supabase db push`.
3. If reset fails, diagnose the failing migration and fix it before retrying.

### Remote-only mode
1. Run `npx supabase db push` directly (ensure the correct env vars / project linking is in place).

### Handling push failures

If push fails with **drift** or **divergence** errors:
- Explain the situation clearly: what the remote state is, what the local migrations expect, and why they diverged.
- Offer `npx supabase migration repair --status <applied|reverted> <timestamp>` with the correct parameters.
- **Never auto-repair without explicit user confirmation.** Repairing marks migrations as applied/reverted in the remote tracking table without actually running them, which can leave the database in an inconsistent state if used incorrectly.

## Step 5: Post-Push Steps

### Local-first mode
1. Regenerate TypeScript types:
   ```
   npx supabase gen types typescript --local 2>/dev/null > src/types/database.ts
   ```
   Always pipe stderr to `/dev/null` because `supabase gen types` captures CLI noise (spinner output, warnings) in stdout, which corrupts the generated types file.

2. Verify the generated file is valid TypeScript (not empty, no CLI artifacts at the top).

### Remote-only mode
- Skip type generation by default.
- If the user wants types from the remote project, use:
  ```
  npx supabase gen types typescript --project-id <project-id> 2>/dev/null > src/types/database.ts
  ```

### Cross-project impact reminder
If the project has related services or consumers that read this schema (a separate backend, automation scripts, a sync engine, etc.), remind the user to check whether dependent projects need updates.

## Known Gotchas

Keep these in mind throughout the workflow:

| Gotcha | Detail |
|--------|--------|
| CLI noise in type generation | `supabase gen types` can capture spinner/progress output in stdout. Always use `2>/dev/null`. |
| Triggers on auth.users | Triggers defined in migrations on `auth.users` may not fire on hosted Supabase. Use Dashboard webhooks or `auth.hook` instead. |
| Env var typos | Typos like `SUPABASE_SERVICE_ROLE_KE` (missing the Y) cause silent auth failures. Double-check env var names. |
| Partial push failures | When a migration fails mid-push, the next migration should use `IF NOT EXISTS` / `DROP IF EXISTS` guards for any objects that may have been partially created. |
| WITH CHECK on RLS | INSERT and UPDATE policies without `WITH CHECK` silently reject all writes. This is the most common RLS mistake. |
| Timestamp collisions | Two migrations created in the same second get the same stamp. On a collision, wait a second and re-run the CLI command; never hand-edit a stamp to make it unique. |

## Rules

1. **Never auto-push** without showing the user the migration SQL and getting confirmation.
2. **Never auto-repair** diverged migrations without explicit user confirmation.
3. **Always create migration files with the CLI** (`supabase migration new`, or the declarative generate command), never by hand-writing the filename or its stamp.
4. **Always validate SQL** before pushing, even for simple migrations.
5. **Always use `2>/dev/null`** when running `supabase gen types`.
