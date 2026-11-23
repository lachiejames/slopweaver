# The apply loop, and the gates over it

Part of [The local Supabase store](../store.md).

**This repository applies its own generated DDL and records what it applied**, so
a new migration is additive and never a reason to drop the database or pipe SQL through `psql` by hand.

`store push`'s apply (`src/store/migrate.ts`) is three phases in one act, and the order is forced rather than chosen:

1. **Roles** — `create policy … to slopweaver_owner` fails if the role does not exist, and drizzle emits
   no `CREATE ROLE`. Telling drizzle-kit to manage roles was rejected: this is a Supabase stack whose own
   `anon`, `authenticated` and `service_role` it does not own, and a role manager generates DROPs for
   every role it did not declare.
2. **The migration** — `migrate()` from `drizzle-orm/postgres-js/migrator`, recording each file by hash in
   `drizzle.__drizzle_migrations`, which is what makes a second run a no-op and a new migration additive.
3. **The guards** — every declared ENUM LABEL, then the two triggers and the grants: drizzle has no
   builder for the last two, and all three need the types and tables to exist.

**The Supabase CLI's own migrator is off on purpose** (`[db.migrations] enabled = false` in
`supabase/config.toml`): applying the files itself skips `pg_trgm`, the roles, the guards and the drizzle
ledger. A new empty store is `yarn store:start`, then `slopweaver store push`. `yarn supabase db reset` recreates the
local database without the Slopweaver schema: follow it with `slopweaver store push`. For a
Slopweaver-schema-only reset, use `slopweaver store reset --acknowledge <database>`.

**A widened enum is applied HERE, not in a migration, and that is the safety gate's own way through.**
`drizzle-kit` emits a widened vocabulary as an `ALTER TYPE … ADD VALUE`, which the third gate below
refuses outright because `migrate()` runs every pending migration in one transaction. So
`enumValueStatements()` (`src/store/policies.ts`) derives one idempotent `add value if not exists` per
declared label from the `pgEnum` objects themselves and runs it in phase 3, outside that transaction.
Post-migration rather than pre-, and the order is forced: on a fresh database the type does not exist
until the first migration creates it. The consequence worth knowing is that widening a vocabulary is one
edit to `schema/enums.ts` with no migration statement at all — which is why a `generate` over a widened
enum can legitimately produce an empty `.sql`.

**The policies live inside the tables.** They are `pgPolicy()` calls in the `pgTable` bodies
(`schema/rls.ts` builds the three every table carries), so a table added without a policy is visible in
the DDL a reviewer reads rather than dependent on somebody adding a name to a list in another module. The
generated migration carries each table's policies beside its `ENABLE ROW LEVEL SECURITY`.

MEASURED against a throwaway Postgres 17 — reproduce with
`docker run -d --rm -e POSTGRES_PASSWORD=proof -p 55499:5432 postgres:17`, then export
`SLOPWEAVER_STORE_URL` and run `slopweaver store push --no-generate`:

| What                                                             | Result                                          |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| Apply from scratch                                               | 3 migrations, 8 tables, 24 policies, 3 roles    |
| Apply again with nothing new                                     | still 3 — the bookkeeping made it a no-op       |
| Add a column, regenerate, apply against a database holding a row | 4 applied, column present, **the row survived** |
| `set role slopweaver_bot; select count(*) from content`          | 0, against the owner's 1, on one private row    |

The last two are the point: the third is the non-destructive path, the fourth the bot's denial,
generated rather than hand-applied.

## Six gates, and a verb for when two branches both generate

`yarn lint` runs `drizzle-migrations` (`src/devLint/drizzleMigrations.ts`), ported as design from the
archive's `check-drizzle-schema --journal` and `check-drizzle-migration-safety`. There is no allowlist
and no exemption marker in any of the six:

- **Barrel** — a `pgTable` or `pgEnum` declared under `src/store/schema/` that `src/store/schema.ts` does
  not export. The barrel is what drizzle-kit, the grants, the enum labels, the verifier and every other
  check read, so a module left out of it is invisible to all of them at once.
- **RLS** — a table whose drizzle config does not carry exactly the three `storeTablePolicies` (owner
  `all`, agent `select`, bot `select`, each to its own role). Exactly, not at least: a fourth policy can
  widen the bot's read, and a check that counted three would call it fine.
- **Coverage** — a table the schema declares that no migration creates. The declared list is derived from
  the schema BARREL, the same module `drizzle.config.ts` points at, so a ninth table is covered by
  construction.
- **Drift** — anything else: the gate copies `supabase/migrations` to a scratch directory and runs the real
  `drizzle-kit generate` into it, which needs no database, and a new `.sql` is a refusal. A column, an
  index, a CHECK or a policy changed with no migration is caught here, where coverage could not see it.
- **Journal order** — an index or timestamp that does not strictly increase, a `.sql` the journal never
  names (never applied, and nothing says so), an entry with no file (the migrator throws at apply time).
- **Single-transaction safety** — `ALTER TYPE … ADD VALUE`, `DROP TYPE`, anything `CONCURRENTLY`, and
  `VACUUM`. `migrate()` runs every pending migration in ONE transaction and Postgres refuses these there.

Each witness was checked rather than assumed: renaming `content_slack` in
`schema/sourceRows.ts` reddens the coverage half naming `content_slack_renamed`; moving one journal
entry's `when` backwards reddens the order half; dropping an `ALTER TYPE … ADD VALUE` file into the
directory reddens both the file and the safety halves. Each reverts to green. The drift, RLS and barrel
halves were checked the same way ([§ "The lifecycle"](lifecycle-and-schema.md)).

`slopweaver dev drizzle-rebase [--dry-run]` handles the case the gate reports and cannot fix: two
branches each generated a migration and the merge kept both. It discards the entries that arrived out of
order along with their `.sql` and their snapshot, renumbers the journal, and stops — `slopweaver store
push` then emits one migration carrying whatever the merged schema says. **It keeps the
earliest of a conflicting pair**, because that is the one that may already have been applied somewhere,
and deleting an applied migration is not recoverable by re-running anything.

**`yarn store:start` deliberately boots a LEAN stack of three containers: Postgres, Kong and Storage.** The store
has exactly two paths into the stack: Postgres directly on the `[db]` port through `SLOPWEAVER_STORE_URL`, and
Storage through Kong at `/storage/v1` with Storage's own service key (`src/store/objects/`). So everything else is
off. `[studio]`, `[analytics]`, `[edge_runtime]`, `[realtime]`, `[auth]` and `[local_smtp]` are `enabled = false`
in `supabase/config.toml`, which drops Studio, `pg_meta`, Logflare, the `vector` log shipper, the edge runtime,
Realtime, GoTrue and Mailpit. PostgREST shares `[api] enabled` with Kong, so `slopweaver store start` excludes it at
launch (`--exclude postgrest`, `src/cli/commands/store/lockCore.ts`). No source file calls `/rest/v1`, `/auth/v1`,
a Supabase realtime channel or Mailpit. The last four cost about 300 MiB resident on the 16 GB Mac, Realtime 253 MiB
of it (`docker stats --no-stream`). Turn one back on by flipping its `enabled` (the recipe is
[§ Where the local stack is](overview-and-local-stack.md#where-the-local-stack-is-and-how-to-open-studio), above),
and expect `pg_meta` to return with Studio rather than on its own.
