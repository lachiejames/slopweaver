# The lifecycle, leg by leg against the archive's

Part of [The local Supabase store](../store.md).

The goal is that a table existing in code but not in the database, or a row level security policy missing, is
structurally impossible here, as it was in the archive. The diff of how each leg of the database lifecycle is done
in the archive versus here, over the archive's `apps/server/src/shared/db`, `apps/server/drizzle` and `packages/scripts/src/{db-push,db-reset,
check-drizzle-schema,check-drizzle-migration-safety}`:

| Leg                     | Archive                                                                                                  | Here                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Schema in TS, one place | `tables/*.table.ts` + a runtime barrel; `check-drizzle-schema` asserts every table file is in the barrel | `drizzle-migrations [barrel]`: every `pgTable`/`pgEnum` under `schema/` must be exported by the barrel                                |
| Derived types           | `$inferSelect/$inferInsert`; `Database = drizzle<typeof schema>`                                         | `StoreDatabase = PostgresJsDatabase<typeof schema>`; `openStore` passes the barrel                                                    |
| Constraints in schema   | FKs, unique/partial indexes, `check()`                                                                   | the same, plus generated columns; two triggers in the post phase (drizzle has no builder)                                             |
| RLS in schema           | `pgPolicy` on 82/82 tables, by convention                                                                | `drizzle-migrations [rls]`: exactly the three policies per table, read from drizzle's own table config                                |
| Grants and enum labels  | `GRANT ALL ON ALL TABLES` + default privileges                                                           | derived from the barrel (`declared.ts`); a new table or enum is granted and widenable by construction                                 |
| Push                    | `db:push:local` = generate + migrate + grants, one act                                                   | `slopweaver store push` = generate + apply + VERIFY                                                                                   |
| Reset                   | `db:reset:local`; prod disabled, staging behind a flag                                                   | `slopweaver store reset --acknowledge <database>`; loopback only, no hatch                                                            |
| Baseline                | seeds the one baseline hash when tables exist and bookkeeping is empty                                   | `slopweaver store baseline --through <tag>`, checked against the catalog both ways                                                    |
| Static gates            | journal order; unsafe statements (with a baseline allowlist)                                             | coverage, journal, safety, `drift` (the real `drizzle-kit generate` into a scratch copy, no database), `rls`, `barrel` — no allowlist |
| "In the database"       | nothing at runtime; CI pushed the schema to a real Supabase before tests                                 | `connectStore` catches up a `behind` one that is local, landed and additive, refuses any other not `current`; `stale-store` hatch     |
| Environments            | local / staging / prod by env file                                                                       | loopback only at the URL, with no hatch: the owner's hard rule                                                                        |

**The two structural closures, stated as what CANNOT happen.** A schema edit with no migration
cannot pass `yarn lint`, because the drift half runs the same `drizzle-kit generate` the push does and a
new file is a refusal. A table declared without its three policies cannot pass `yarn lint` either, because
the RLS half reads drizzle's table config. And a verb cannot read a database the journal does not describe,
because `connectStore` classifies it first (`fresh`, `behind`, `unrecorded`, `foreign`, `current`) and
refuses everything but `current` — naming the verb that fixes it. `store status` is the one reader that
opens raw, because it is how an operator learns which state a database is in.

**And a landed migration cannot leave the store behind, because the door applies it.** The refusal alone made
such a database impossible to READ, not impossible to exist: nothing applied a landed migration when main
moved. MEASURED: an additive migration reached the main checkout, nothing
pushed the store, and `connectStore` refused every verb, the plans register with them, so every Claude session
boot refused until a hand `store push`. So a `behind`
database is caught up at the door when it is local, every pending file is on `origin/main` byte for byte,
every statement is on an additive allowlist (`src/store/catchUpCore.ts`), and nothing added since `initdb`, in any schema, is an operator, cast,
domain, index support function, or function under a name the allowlist admits, running anything but superuser-installed C (nor `public` an event trigger), that would run code a statement never names, and no partition holds an index no parent index attached, which a new parent index would take over. What is judged is a copy of the migrations folder, and that copy is what is applied, so a file changed while the catch-up waits on the lock never runs; `store verify` must then read it clean,
and the verb prints one stderr line naming what it applied. An open `stale-store` hatch skips the catch-up and opens the database unchanged. A pending migration that has not landed, or that
drops, renames, reads or writes rows (a `CREATE TABLE … AS` included), calls a function off the inert built-ins, packs two statements into one chunk or two actions into one `ALTER TABLE`, adopts an existing index (`USING INDEX`), names a type or table with the `_` array-type prefix (or a `multirange_type_name`),
carries a comment, dollar quote, escape string or non-ASCII name a text check cannot see past, or edits a policy, still refuses and names which condition failed — `store push`
applies that one deliberately — and so does a dry run (`connectStore({ catchUp: false })`: `knowledge redact` and
`knowledge prune` without `--apply`, `handover finish|settle --dry-run`), which promised to change nothing. Two verbs
catching up at once serialise on the apply's advisory lock; the second records nothing and prints nothing
(`src/__tests__/subprocess/store/catchUp.test.ts` races two over a real Postgres). Reproduce on a
throwaway: push it from a tree one migration behind, then any store read from a tree without the catch-up
refuses and from one with it reads, printing `store: caught up <migration>`.

**A push applies only what has landed.** The local store is ONE database every checkout reads, and the
migrator records the hash of the file in whichever checkout ran `store push` — so a branch's own migration
recorded there reads `foreign` to every other checkout until that exact file lands on `origin/main`. `store
push` (and `store reset`, which pushes) therefore refuses a pending migration whose bytes are not on
`origin/main` as last fetched; `unlanded-migration` (`SLOPWEAVER_ALLOW_UNLANDED_MIGRATION=1`) is the hatch, for a
throwaway database. And a `foreign`
refusal whose every recorded hash IS on `origin/main` says the truth: this checkout is behind, pull it.
MEASURED: the hash seats read as foreign after a landing is `shasum -a 256
supabase/migrations/<file>.sql` on main, and `store verify` from main reads current with
zero findings — there was nothing to re-record, only checkouts that had not pulled.

**Each closure was checked rather than assumed.** A column added to `container` reddened the
drift half naming `0007_clammy_azazel.sql`; stripping `container`'s policies reddened the RLS half four
times (RLS off, three policies missing); a `schema/orphan.ts` declaring an unexported table reddened the
barrel half. Each reverts to green. Reproduce any of them with the edit and
`yarn tsx src/devLint/drizzleMigrations.entry.ts`.

**MEASURED against throwaway databases in the running local stack** (`create database
lifecycle_proof`, then `SLOPWEAVER_STORE_URL` pointed at it):

| What                                                                  | Result                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `store verify` on an empty database                                   | 74 findings: every table, policy, grant, enum label, extension and the state  |
| `store status` through `connectStore` on it                           | refused: `fresh`, naming `store push`                                         |
| `store push` from scratch                                             | 7 role and extension statements, 77 guard statements, verify clean, **5.4 s** |
| `store push` again                                                    | nothing generated, nothing pending                                            |
| `set role slopweaver_bot` over one private and one public `gmail` row | bot counts 1, owner counts 2                                                  |
| `store push` after adding a column                                    | generated a migration, applied it, verify clean, column present               |
| that database after the generated file was deleted from the tree      | `foreign` — push refuses, `store reset` recovers it                           |
| `store reset` with no flag / `--acknowledge postgres`                 | two refusals, each naming the database the URL selects                        |
| `store reset --acknowledge lifecycle_proof` over 2 rows               | "9 table(s), 2 row(s) destroyed", rebuilt, verify clean, **4.6 s**            |
| a remote URL, any verb                                                | refused at selection, naming the host; no hatch opens it                      |

The `baseline` verb's own refusals were rehearsed on `lifecycle_unrecorded`, a copy of the live store's
shape — a partial journal applied by hand, row level security on, none of the policies, and two trgm
indexes created by hand (the 838 MB board row). It refused a `--through` in both directions: a tag whose
later migrations were already reflected in the catalog, and a tag whose earlier ones were not. That is
the verb working, and it is why `baseline` is not the live store's path.

**There was never a `--through` tag that would have worked on the live store, and the squeeze is the
proof.** MEASURED against `postgres`, after a session proposed `store baseline --through <tag>`
then `store push` as the way to clear the `unrecorded` refusal:

| Command                                       | Answer                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `store baseline --through 0001_known_spirit`  | `0000 … creates index "uq_memories_seq" and the database does not have it` — not applied   |
| `store baseline --through 0000_polite_lady_…` | `0001 … creates index "uq_person_github_id" and the database already has it` — stops early |

Both directions at once is what makes it structural rather than a wrong guess: the earlier tag claims too
little and the later one claims too much, so no tag's claim is true of that catalog. `baseline` exists for
a database whose tables were created by hand and whose catalog AGREES with some prefix of the journal. A
database that disagrees with every prefix is a database you reset.

**`store reset`'s terminate sweep is best effort, not a precondition.** The archive's `db-reset` assumes
the connecting role is superuser. Here `postgres` is not, and Supabase keeps its own backends on the same
database under roles it cannot signal — a sweep treated as a precondition dies with `reset failed before
rebuilding: permission denied to terminate process` (measured, having destroyed nothing). So it
handles each backend separately and swallows only `insufficient_privilege`
({@link ../src/store/lifecycleCore.ts}'s `TERMINATE_OTHER_BACKENDS`). What follows it drops SCHEMAS, and
`drop schema … cascade` locks the objects it removes rather than the database, so a backend this role may
not signal never blocks the drop — only the signal. Reproduce the condition with
`select usename, application_name from pg_stat_activity where datname = current_database()`.

MEASURED the same day on the live store: **8 tables, 1,961,108 rows destroyed**, rebuilt from the schema,
`store verify` clean on 9 tables, 2 migrations recorded, nothing pending.

## The journal is ONE migration, and it IS the schema

The store is RESET onto the redesigned schema rather than migrated up to it, so the journal begins at a single
`0000` carrying the whole schema. Read the page for the trade;
what matters here is the mechanism and the one thing that made it free.

**The squash stranded nothing, because no database had recorded the tags it deleted.** MEASURED
against the live store — `psql "$(cat ~/.slopweaver/secrets/store-url)" -Atc 'select count(*)
from drizzle.__drizzle_migrations'` answered **0**. `migrate()` records each file by HASH, so a squash
that renames and rewrites every tag would strand any database that had recorded the old ones: they would
read as applied under names the folder no longer has, and the new `0000` would look pending and try to
`CREATE TABLE` over live tables. With an empty ledger everywhere there was nothing to strand. Check it
before ever squashing again — that count is the whole precondition.

**A database whose catalog disagrees with `0000` is reset, never baselined onto it.** `baseline` checks
the catalog agrees with the tag named; the live `postgres` database, with no `memories` table, no `raw`
column on any side table and none of the 24 policies (36 `store verify` findings), did not.
Until it is reset **every store verb refuses such a database as `unrecorded`**;
`SLOPWEAVER_ALLOW_STALE_STORE=1` is the read-only bridge for a session that needs one.

**`0001` is the first migration after the squash, and it is HAND-ORDERED for a reason the generator cannot
know.** `drizzle-kit generate` emits every `ADD COLUMN` and then the `DROP COLUMN`, which would take
`person.identities` away while the `UPDATE` that reads it was still to come — and that `UPDATE` is the
only thing carrying each content row's native author id out of the JSONB before it goes. So the file
interleaves the data steps by hand and says so in its own header. Two habits make that safe rather than a
licence: every DDL statement in it is still the generator's own, and `meta/0001_snapshot.json` is the
snapshot of the FINAL schema, so `drizzle-kit generate` over the tree adds nothing and the `drift` half of
`drizzle-migrations` is what proves it.

Generating it needed two passes, which is worth knowing before the next one: `drizzle-kit generate` opens
an interactive rename prompt whenever ONE table both gains and loses columns, and it has no
non-interactive answer — it fails outright with `Interactive prompts require a TTY terminal`. Declaring the
old column alongside the new ones produces an additions-only diff, removing it again produces a
deletions-only diff, and neither prompts. The two `.sql` bodies then concatenate, and the second pass's
snapshot is the one to keep (repoint its `prevId` at `0000`'s `id`, since the discarded first pass is no
longer in the chain).

**A composite foreign key references a `unique()` CONSTRAINT, never a `uniqueIndex`.** `drizzle-kit
generate` emits in phases — every `CREATE TABLE`, then every `ALTER TABLE … ADD CONSTRAINT`, then every
`CREATE INDEX` — so a composite foreign key can only reference a unique key declared INSIDE a create-table
statement. `uq_content_id_source`, which all four per-source tables key onto, is a `unique()` constraint,
emitted inline, for that reason: as a `uniqueIndex` it lands in the last phase and a single file stops on
an empty database at `there is no unique constraint matching given keys for referenced table "content"`.
`unit/store/schemaDrift.test.ts` asserts the byte order. Reproduce the failure by flipping it and regenerating:
`dropdb squash_proof; createdb squash_proof; psql -v ON_ERROR_STOP=1 -d squash_proof -f supabase/migrations/0000_*.sql`.

**Replayed and loaded, measured** on `squash_proof`, a fresh database on the same local
Postgres:

| Step                                               | Result                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `store push` into an empty database                | 7 role/extension statements, 1 migration, 77 guard statements                  |
| `store verify`                                     | clean — 9 tables with RLS on, every policy, grant, enum label, extension, role |
| `store ingest` a bounded slice of all four sources | 23,157 side rows, 198 MB                                                       |
| the `raw` envelope on those rows                   | Slack, Linear, Notion 100%; GitHub 2,169/2,240 — the 71 are all `release`      |
| every envelope together                            | 36 MB, **18.3% of the whole database**                                         |

## The `raw` envelope: what the store keeps beside the columns

Exactly one column holds a provider's object whole. Every side table
carries `raw jsonb NOT NULL DEFAULT '{}'` holding the provider's object verbatim, BESIDE the promoted columns
and never instead of them. The reason is the conversation it ends rather than the bytes it costs: nobody should
have to keep asking why a field the provider returns is not in the database. With the envelope
that question has one answer every time — it is in the database, and promoting it is a column plus a
backfill over the same table, from disk, with no refetch.

The rule the schema enforces is **never lose a field**, not never hide one. What a reader filters,
joins or indexes on is still a real column on a real per-source table; everything else is one `->>` away.

**The cost, measured on a loaded database rather than on record bytes.** An earlier measurement put `raw`
at 31.3–64.7% of a bronze RECORD's bytes, which is the wrong denominator for a decision about a database.
On `squash_proof` the envelope is 36.6–80.0% of its own side table and **18.3% of the whole database** —
`content` carries the body, the generated tsvector and nine indexes and dominates everything beside it,
and a JSON payload TOAST-compresses where a tsvector does not. Reproduce on any loaded store:

```sql
select pg_size_pretty(pg_database_size(current_database())),
       pg_size_pretty((select sum(pg_column_size(raw)) from content_slack)
                    + (select sum(pg_column_size(raw)) from content_github)
                    + (select sum(pg_column_size(raw)) from content_linear)
                    + (select sum(pg_column_size(raw)) from content_notion));
```

It is not indexed, and that is deliberate: retrieval is Postgres full text over `content.searchable` and
every filter a reader writes is a promoted column, so a GIN index here would be paid for on every write
and read by nothing. Notion's `properties` keeps its own GIN index because that one IS queried by key.
