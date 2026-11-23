/**
 * What row-level security still needs that drizzle cannot generate: the three roles, and the grants.
 *
 * The POLICIES themselves live inside the drizzle
 * tables and are generated into the migration — see `schema/rls.ts`. What is left here is what
 * drizzle has no builder for and never will: `CREATE ROLE`, `GRANT USAGE ON SCHEMA` and `GRANT SELECT`.
 * They are applied around the migration by `migrate.ts`, roles before it and grants after it, because a
 * policy naming a role that does not exist fails and a grant on a table that does not exist fails.
 *
 * Three roles are the right shape for now: owner, bot and read-only agent. Segmentation only means something if some role is denied something, and the denial that earns
 * its keep here is the `bot` role's: a Slack-facing turn runs as `slopweaver_bot` and **cannot** read a
 * private-lane row — a private channel, a direct message, the mailbox or the diary — instead of being
 * trusted not to.
 *
 * ## Why this is not a WHERE clause in the query layer
 *
 * Because a WHERE clause is a thing every future caller has to remember, and the one that forgets is the
 * one that posts to Slack. The corpus already carries `visibility` and already has a scoping function
 * that applies it at answer time; what it does not have is any way to stop a NEW code path from reading
 * a private record and never calling that function. A policy attaches to the table, so a path that does
 * not know the rule exists is still governed by it.
 *
 * ## Why every table gets a policy, including ones with nothing private in them
 *
 * `alter table … enable row level security` denies everything by default, so a table without policies is
 * a table nobody can read. Declaring a permissive policy on the harmless tables is therefore not
 * ceremony — it is what keeps "RLS is on everywhere" true, so the answer to "is this table protected"
 * is never "it depends which table". The policies themselves are declared in `schema/rls.ts`; the grant
 * that lets a role reach the relation a policy governs is here, because drizzle cannot emit it.
 */
import { declaredEnums, declaredTableNames } from "./declared.js";
import { STORE_ROLES } from "./schema/enums.js";
import { SOURCES_WITH_ROW_TABLE } from "./schema/sourceRows.js";

/** Tables carrying a `visibility` column, and therefore a private lane the bot is denied. */
const TABLES_WITH_VISIBILITY = new Set<string>(["content"]);

/**
 * Tables with no `visibility` column of their own whose rows still belong to that lane, through the
 * content row each hangs off — the four per-source tables. Derived from the source list rather than
 * listed, so a fifth per-source table is narrowed by construction.
 */
const TABLES_NARROWED_THROUGH_PARENT = new Set<string>(SOURCES_WITH_ROW_TABLE.map((source) => `content_${source}`));

/**
 * Tables the OWNER role may insert into, on top of the SELECT every role gets.
 *
 * A `for: "all"` policy is not a grant: RLS decides which rows a role may touch and `GRANT` decides
 * whether it may touch the relation at all, and a table with only `grant select` refuses an insert from
 * `slopweaver_owner` however permissive its policy reads. That combination is invisible in the policy
 * list, which is why the exception is named here rather than assumed from `storeTablePolicies`.
 *
 * `memories` and `memory_recalls` are the entries because they are the tables a VERB writes under a store
 * role — `knowledge remember`/`trace` and `knowledge recalled` — while every other table is loaded by
 * ingest, which connects as the database's own owner.
 */
const TABLES_OWNER_MAY_INSERT = new Set<string>(["memories", "memory_recalls"]);

/** The extensions the schema needs, named once so the apply loop and the verifier read the same list. */
export const STORE_EXTENSIONS = ["pg_trgm"] as const;

/**
 * The extensions the schema's declared INDEXES need, created before anything declares one.
 *
 * `pg_trgm` is here rather than in the generated migration for two independent reasons, and each alone
 * would be enough. Drizzle emits no `CREATE EXTENSION` at all, so `gin (body gin_trgm_ops)` generates DDL
 * that fails on apply with `operator class "gin_trgm_ops" does not exist`. And `migrate()` runs every
 * pending migration in ONE transaction, where a failure rolls the extension back too — so the extension
 * belongs in the phase that runs before it, beside the roles, for the same reason the roles are there.
 *
 * No COLUMN type depends on an extension: there is no `vector` type, because there is no embedding lane
 * (no pgvector, no embeddings, no re-ranking). The two
 * trigram indexes are what make the detective's substring ladder affordable at all — MEASURED,
 * `body ilike '%nz%'` takes several seconds without one. A store that applied cleanly and then answered every
 * wildcard shape with a full scan is exactly the silent degradation this phase exists to prevent.
 *
 * `if not exists` makes every run a no-op after the first. Nothing drops it: an extension a store's own
 * index depends on is not something an apply loop should be able to remove.
 *
 * @returns the idempotent extension statements
 */
export function storeExtensionStatements(): readonly string[] {
  return STORE_EXTENSIONS.map((extension) => `create extension if not exists ${extension}`);
}

/**
 * The role-creation statements, written so a re-run is harmless.
 *
 * `NOLOGIN` because these are roles a connection assumes with `SET ROLE`, not accounts anybody signs in
 * as — the local stack has one connection and three hats it wears, which is what "on one local machine"
 * makes of role-based access.
 *
 * ## Why each role is then granted back to the connecting user, with `SET`
 *
 * Because without it the store creates three roles that NOTHING on the machine it targets can assume.
 * MEASURED against the local Supabase stack this store actually runs on: every `set role
 * slopweaver_bot` answered `permission denied to set role "slopweaver_bot"`, so the segmentation was
 * unreachable and the private lane was protected by nothing a caller would ever hit.
 *
 * Two facts combine to produce it, and neither is visible from the statement list. Supabase's `postgres`
 * is **not** a superuser (`select rolsuper from pg_roles where rolname = 'postgres'` reads `f`), so it
 * cannot assume an arbitrary role the way the plain Postgres 15 this was first checked against let it.
 * And since Postgres 16, `CREATE ROLE` grants the creator membership with `ADMIN OPTION` but with
 * neither `SET` nor `INHERIT` — so `pg_auth_members` shows the membership, which is exactly why this
 * reads as working when you look for it. Reproduce both halves on any local stack:
 * `select r.rolname, m.rolname, am.admin_option from pg_auth_members am …` returns the rows, and
 * `set role slopweaver_bot` still fails.
 *
 * `inherit false` is the deliberate half: the connection must ASK for a hat rather than wear all three
 * at once, or `slopweaver_owner`'s unrestricted policy would silently apply to every query.
 *
 * @returns one idempotent create statement per role, each followed by the grant that makes it assumable
 */
export function storeRoleStatements(): readonly string[] {
  return STORE_ROLES.flatMap((role) => [
    `do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${role}') then
        create role ${role} nologin;
      end if;
    end $$`,
    `do $$ begin
      execute format('grant ${role} to %I with inherit false, set true', current_user);
    end $$`,
  ]);
}

/**
 * The grants the migration cannot carry: schema usage, then SELECT on each table.
 *
 * Runs AFTER the migration, because a grant on a table that does not exist is an error rather than a
 * no-op. Every table the BARREL declares gets one, including the ones with nothing private in them, for
 * the reason this module's header gives: `enable row level security` denies everything by default, and a
 * policy is only consulted for a role that can reach the relation at all. The table set is derived
 * (`declared.ts`), never listed: a hand list here is how a new table shipped with a policy and no grant.
 *
 * MEASURED, and it is why the schema grant is spelled separately rather than assumed: the
 * first version granted SELECT on each table and omitted `usage on schema public`, so all three roles
 * answered "relation does not exist" and no policy was ever consulted. The unit tests passed throughout,
 * because they assert what a statement list CONTAINS and a missing grant is an absence — which is the
 * standing reason this set is also applied against a real database.
 *
 * @returns the schema-usage grant, one SELECT per store table, then the owner's INSERT where one is owed
 */
export function storeTableGrantStatements(): readonly string[] {
  const roles = STORE_ROLES.join(", ");
  const tables = declaredTableNames();
  return [
    `grant usage on schema public to ${roles}`,
    ...tables.map((table) => `grant select on ${table} to ${roles}`),
    ...tables
      .filter((table) => TABLES_OWNER_MAY_INSERT.has(table))
      .map((table) => `grant insert on ${table} to slopweaver_owner`),
  ];
}

/**
 * Every enum value this schema declares, as an idempotent statement that ADDS it if the type lacks it.
 *
 * The enums are DERIVED from the barrel too (`declared.ts`): a hand list of four stood here while the
 * schema declared eight, so the three `memory_*` vocabularies and `link_status` had no way to widen at
 * all — the safety gate refuses the migration form and this loop never saw them.
 *
 * ## Why this exists at all, rather than riding the generated migration
 *
 * `drizzle-kit` emits a widened enum as `ALTER TYPE … ADD VALUE`, and `migrate()` runs every pending
 * migration inside ONE transaction — where Postgres refuses to let any later statement USE a value that
 * transaction added. The `drizzle-migrations` gate refuses the shape categorically, and its own header
 * names the only sanctioned way out: *"a migration that genuinely needs an unsafe statement needs it
 * applied outside the transaction, which is a change to the apply loop rather than a licence in the
 * file."* This is that change.
 *
 * It runs in the POST-migration phase rather than the pre-migration one, and the order is forced rather
 * than chosen: on a fresh database the types do not exist until the first migration creates them, so a
 * pre-migration `ALTER TYPE` would silently no-op and the vocabulary would never widen. After the
 * migration the type exists on a fresh database and an existing one alike.
 *
 * ## It is DERIVED, so the class cannot come back
 *
 * The values come from the `pgEnum` declarations themselves, so widening a vocabulary is one edit to
 * `./schema/enums.ts` and needs no migration statement at all — which is the difference between fixing
 * this instance and closing it. `add value if not exists` makes every run idempotent, including the one
 * where the migration that created the type already listed the value.
 *
 * @returns one statement per declared value of every store enum, enum by enum, in declaration order
 */
export function enumValueStatements(): readonly string[] {
  return declaredEnums().flatMap((enumeration) =>
    enumeration.enumValues.map((value) => `alter type ${enumeration.enumName} add value if not exists '${value}'`),
  );
}

/**
 * Which tables the bot's read is narrowed on by a column of their own.
 *
 * Exported so a test can assert the narrowing exists where it should rather than inspecting generated
 * SQL strings: a policy set that quietly stopped covering `content` would otherwise be invisible until a
 * private message reached Slack.
 *
 * @returns the table names carrying a private lane
 */
export function tablesWithPrivateLane(): readonly string[] {
  return [...TABLES_WITH_VISIBILITY].toSorted();
}

/**
 * Which tables the bot's read is narrowed on through their PARENT row rather than a column of their own.
 *
 * The per-source tables: a `content_slack` row is visible to the bot exactly when its `content` row is
 * public. Exported for the same reason as {@link tablesWithPrivateLane} — a side table that quietly went
 * back to `true` would read fine and leak every private message's channel and counts.
 *
 * @returns the table names, sorted
 */
export function tablesNarrowedThroughParent(): readonly string[] {
  return [...TABLES_NARROWED_THROUGH_PARENT].toSorted();
}

/**
 * Every table the store declares, for a test that asserts policies cover all of them.
 *
 * @returns the table names, sorted
 */
export function storeTables(): readonly string[] {
  return declaredTableNames();
}

/**
 * The tables the owner role may INSERT into, for a test that asserts each is a table the schema declares.
 *
 * An exception list that names a table the schema no longer has would silently grant nothing; the test
 * that reads this is what keeps the list honest against the barrel.
 *
 * @returns the table names, sorted
 */
export function tablesOwnerMayInsert(): readonly string[] {
  return [...TABLES_OWNER_MAY_INSERT].toSorted();
}
