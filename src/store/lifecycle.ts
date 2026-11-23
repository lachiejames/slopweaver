/**
 * The store's lifecycle against a live Postgres: where a database stands, whether it matches the schema,
 * and the three acts that move it — push, baseline, reset. The archive's `db-push` and `db-reset`
 * re-implemented in this repo's idiom (AGENTS.md § "Porting from private sources"), with one thing the
 * archive never had: a verifier that reads the database back and refuses to call an apply done until
 * every declared table, policy, grant, enum label, extension and role is actually there.
 *
 * Pushing the schema and resetting a database are meant to be easy and effortless, so the archive's push and reset
 * behaviour lives here.
 *
 * Every function here takes an OPEN connection or a URL and never resolves one: `config.ts` is the one
 * place a database is selected, and the local-only rule lives there.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

import { hatchFor } from "../hatch/lookup.js";
import { hatchOpen } from "../hatch/open.js";
import { hatchRefusalLines } from "../hatch/render.js";
import { gitEnv } from "../lib/gitRepo.js";
import { err, ok, type Result } from "../lib/result.js";

import { declaredEnums, declaredTableNames, declaredTablePolicies } from "./declared.js";
import { isUnreachableReason, type StoreError, StoreErrors, storeErrorLines } from "./errors.js";
import { generateMigrations } from "./generate.js";
import { GIT_READ_TIMEOUT_MS, landedHashes, landedUnreadable } from "./landedRead.js";
import {
  type AppliedMigration,
  acknowledgementProblems,
  baselineDisagreements,
  classifyMigrationState,
  type DeclaredSchemaFacts,
  databaseNameOf,
  type JournalMigration,
  type LandedMigrations,
  type LiveObjects,
  type LivePolicy,
  type LiveSchemaFacts,
  type MigrationState,
  migrationStateLine,
  objectsCreatedBy,
  TERMINATE_OTHER_BACKENDS,
  unlandedMigrationDetails,
  type VerifyFinding,
} from "./lifecycleCore.js";
import { verifyFindings } from "./lifecycleVerify.js";
import { isLocalStoreUrl } from "./localStoreUrl.js";
import { type ApplyReport, applyStore, firstLineOf, MIGRATIONS_DIR } from "./migrate.js";
import { STORE_EXTENSIONS, tablesOwnerMayInsert } from "./policies.js";
import { declaredPolicyPredicates, readPolicyFacts } from "./policyPredicates.js";
import { STORE_ROLES } from "./schema/enums.js";

/** How {@link readLandedMigrations} runs git: text out, every migration file's ceiling, killed hard at its bound. */
const LANDED_READ = { encoding: "utf8", killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, stdio: "pipe" } as const;

/**
 * The journal as the migrator will read it: each entry's tag and generation instant from `_journal.json`,
 * zipped with the hash `readMigrationFiles` computes for the same position.
 *
 * `readMigrationFiles` is drizzle's own reader, so the hashes here are byte-for-byte what `migrate()`
 * records — a baseline written from them is one the migrator later agrees with.
 *
 * @param cwd the repository root the migrations directory is resolved from
 * @returns the journal, or the read failure
 * @internal
 */
export function readJournal({ cwd }: { cwd: string }): Result<readonly JournalMigration[], StoreError> {
  const folder = join(cwd, MIGRATIONS_DIR);
  try {
    const raw: unknown = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));
    const entries = journalEntries({ raw });
    const files = readMigrationFiles({ migrationsFolder: folder });
    if (entries.length !== files.length) {
      return err(StoreErrors.journalMismatch({ entries: entries.length, files: files.length }));
    }
    // `!` rather than a coalesce: the lengths were just checked equal, so an absent entry would be a fault
    // in this function, and a migration recorded under an empty tag is worse than a crash.
    return ok(files.map((file, index) => ({ hash: file.hash, tag: entries[index]!.tag, when: file.folderMillis })));
  } catch (error: unknown) {
    return err(StoreErrors.journalUnreadable({ detail: firstLineOf({ error }), folder }));
  }
}

/**
 * The `entries` of a parsed journal, or none when the document is not a journal.
 *
 * @param raw the parsed JSON
 * @returns the entries' tags
 */
function journalEntries({ raw }: { raw: unknown }): readonly { readonly tag: string }[] {
  if (typeof raw !== "object" || raw === null || !("entries" in raw) || !Array.isArray(raw.entries)) {
    return [];
  }
  const out: { tag: string }[] = [];
  for (const entry of raw.entries as unknown[]) {
    if (typeof entry === "object" && entry !== null && "tag" in entry && typeof entry.tag === "string") {
      out.push({ tag: entry.tag });
    }
  }
  return out;
}

/**
 * Where one database stands against the journal.
 *
 * @param sql an open connection
 * @param cwd the repository root
 * @returns the classification, or a read failure
 */
export async function readMigrationState({
  sql,
  cwd,
}: {
  sql: postgres.Sql;
  cwd: string;
}): Promise<Result<MigrationState, StoreError>> {
  const journal = readJournal({ cwd });
  if (journal.isErr()) {
    return err(journal.error);
  }
  try {
    const bookkeeping = await sql<{ present: boolean }[]>`
      select to_regclass('drizzle.__drizzle_migrations') is not null as present`;
    let applied: AppliedMigration[] = [];
    if (bookkeeping[0]?.present === true) {
      const rows = await sql<{ hash: string; created_at: string }[]>`
        select hash, created_at from drizzle.__drizzle_migrations order by created_at asc, id asc`;
      applied = rows.map((row) => ({ createdAt: Number(row.created_at), hash: row.hash }));
    }
    const present = await sql<{ n: string }[]>`
      select count(*)::text as n from pg_tables where schemaname = 'public' and tablename = any(${[...declaredTableNames()]})`;
    return ok(
      classifyMigrationState({ applied, journal: journal.value, tablesPresent: Number(present[0]?.n ?? "0") > 0 }),
    );
  } catch (error: unknown) {
    // A refused connection is a different fact from a query the database answered no to, and it is the one
    // an operator can act on — so it says the stack is down and how to start it, rather than naming a port.
    // The wording lives in `./errors.ts` because `connectStore` has to give the same answer; see
    // `StoreUnreachableError` for the owner ruling behind it.
    const reason = firstLineOf({ error });
    if (isUnreachableReason({ reason })) {
      return err(StoreErrors.unreachable({ reason }));
    }
    return err(StoreErrors.lifecycleReadFailed({ detail: reason, subject: "migration-state" }));
  }
}

/**
 * What the schema declares, in the verifier's vocabulary.
 *
 * @returns the declared facts
 * @internal
 */
export function declaredSchemaFacts(): DeclaredSchemaFacts {
  const tables = declaredTableNames();
  const policies: LivePolicy[] = declaredTablePolicies().flatMap((entry) =>
    entry.policies.map((policy) => ({
      cmd: (policy.for ?? "all").toUpperCase(),
      name: policy.name,
      roles: [roleNameOf({ to: policy.to })],
      table: entry.table,
    })),
  );
  const insertable = new Set(tablesOwnerMayInsert());
  const privileges = [
    ...STORE_ROLES.flatMap((role) => tables.map((table) => ({ privilege: "SELECT", role, table }))),
    ...tables
      .filter((table) => insertable.has(table))
      .map((table) => ({ privilege: "INSERT", role: "slopweaver_owner", table })),
  ];
  return {
    enums: declaredEnums().map((enumeration) => ({ labels: enumeration.enumValues, name: enumeration.enumName })),
    extensions: [...STORE_EXTENSIONS],
    policies,
    predicates: declaredPolicyPredicates(),
    privileges,
    roles: [...STORE_ROLES],
    tables,
  };
}

/**
 * A policy's role as a name.
 *
 * @param to drizzle's `to` option
 * @returns the role name, or `public` when the policy names none — which is what Postgres records
 */
function roleNameOf({ to }: { to: unknown }): string {
  if (typeof to === "object" && to !== null && "name" in to && typeof to.name === "string") {
    return to.name;
  }
  if (typeof to === "string") {
    return to;
  }
  return "public";
}

/**
 * Read back everything the verifier compares, from the catalog.
 *
 * @param sql an open connection
 * @param cwd the repository root
 * @returns the live facts, or a read failure
 * @internal
 */
export async function readLiveSchemaFacts({
  sql,
  cwd,
}: {
  sql: postgres.Sql;
  cwd: string;
}): Promise<Result<LiveSchemaFacts, StoreError>> {
  const migration = await readMigrationState({ cwd, sql });
  if (migration.isErr()) {
    return err(migration.error);
  }
  const declared = declaredSchemaFacts();
  try {
    const tables = await sql<{ name: string; rls: boolean }[]>`
      select c.relname as name, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by c.relname`;
    const present = new Set(tables.map((table) => table.name));
    const policyFacts = await readPolicyFacts({
      predicates: declared.predicates.filter((predicate) => present.has(predicate.table)),
      sql,
    });
    const checkable = declared.privileges.filter((grant) => present.has(grant.table));
    const privileges = await sql<{ role: string; tbl: string; priv: string; held: boolean }[]>`
      select g.role, g.tbl, g.priv, has_table_privilege(g.role, format('public.%I', g.tbl), g.priv) as held
      from unnest(${checkable.map((grant) => grant.role)}::text[], ${checkable.map((grant) => grant.table)}::text[], ${checkable.map((grant) => grant.privilege)}::text[]) as g(role, tbl, priv)`;
    const enums = await sql<{ name: string; labels: string[] }[]>`
      select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      where t.typname = any(${declared.enums.map((enumeration) => enumeration.name)}) group by t.typname`;
    const extensions = await sql<{ extname: string }[]>`select extname from pg_extension`;
    const assumable = await sql<{ rolname: string }[]>`
      select rolname from pg_roles where rolname = any(${[...declared.roles]}) and pg_has_role(current_user, oid, 'SET')`;
    return ok({
      assumableRoles: assumable.map((row) => row.rolname),
      enums: enums.map((row) => ({ labels: row.labels, name: row.name })),
      extensions: extensions.map((row) => row.extname),
      ...(migration.value.kind === "foreign" ? { landed: readLandedMigrations({ cwd }) } : {}),
      migration: migration.value,
      ...policyFacts,
      privileges: privileges.map((row) => ({ held: row.held, privilege: row.priv, role: row.role, table: row.tbl })),
      tables: tables.map((row) => ({ name: row.name, rlsEnabled: row.rls })),
    });
  } catch (error: unknown) {
    return err(StoreErrors.lifecycleReadFailed({ detail: firstLineOf({ error }), subject: "live-schema" }));
  }
}

/** What a verify produced. */
export interface VerifyReport {
  readonly findings: readonly VerifyFinding[];
  readonly declaredTables: number;
  readonly state: MigrationState;
}

/**
 * Verify one database against the schema.
 *
 * @param url the connection string
 * @param cwd the repository root
 * @returns every disagreement, or a read failure
 */
export async function verifyStore({
  url,
  cwd,
}: {
  url: string;
  cwd: string;
}): Promise<Result<VerifyReport, StoreError>> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const live = await readLiveSchemaFacts({ cwd, sql });
    if (live.isErr()) {
      return err(live.error);
    }
    const declared = declaredSchemaFacts();
    return ok({
      declaredTables: declared.tables.length,
      findings: verifyFindings({ declared, live: live.value }),
      state: live.value.migration,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** What a push did. */
export interface PushReport {
  /** The migration file drizzle-kit generated, when the schema had changed — it must be committed. */
  readonly generated: readonly string[];
  readonly applied: ApplyReport;
  readonly verify: VerifyReport;
}

/**
 * Push the schema to one database: generate a migration if the schema changed, apply everything pending,
 * then read the database back and refuse to report success unless it matches.
 *
 * The archive's `db:push:local`, plus the verify. `generate` is a parameter because `yarn store:migrate`
 * — the apply-only path CI-shaped callers want — is this with it off.
 *
 * @param url the connection string
 * @param cwd the repository root
 * @param generate whether to run `drizzle-kit generate` first
 * @returns what was generated, applied and verified — or the first failure
 */
export async function pushStore({
  url,
  cwd,
  generate,
}: {
  url: string;
  cwd: string;
  generate: boolean;
}): Promise<Result<PushReport, StoreError>> {
  let generated: readonly string[] = [];
  if (generate) {
    const report = generateMigrations({ cwd, out: join(cwd, MIGRATIONS_DIR) });
    if (report.isErr()) {
      return err(report.error);
    }
    generated = report.value.created;
  }
  const state = await withConnection({ url, work: (sql) => readMigrationState({ cwd, sql }) });
  if (state.isErr()) {
    return err(state.error);
  }
  if (state.value.kind === "unrecorded" || state.value.kind === "foreign") {
    const stateLine = migrationStateLine({ landed: readLandedMigrations({ cwd }), state: state.value });
    return err(StoreErrors.pushStateRefused({ state: state.value.kind, stateLine }));
  }
  const unlanded = unlandedRefusal({ cwd, pending: state.value.pending });
  if (unlanded.length > 0) {
    return err(StoreErrors.lifecycleRefused({ reasons: unlanded }));
  }
  const applied = await applyStore({ cwd, url });
  if (applied.isErr()) {
    return err(applied.error);
  }
  const verify = await verifyStore({ cwd, url });
  if (verify.isErr()) {
    return err(verify.error);
  }
  return ok({ applied: applied.value, generated, verify: verify.value });
}

/**
 * The ref a migration must be on, byte for byte, before `store push` applies it.
 *
 * `origin/main` as this checkout last fetched it — never fetched here, because a store verb that reaches the
 * network is a surprise, and a stale ref refuses a landed migration loudly rather than admitting an unlanded one.
 *
 * @internal
 */
export const LANDED_BASE_REF = "origin/main";

/**
 * The `unlanded-migration` row's key, spelled here so the refusal, the reader and the register agree on one name.
 *
 * @internal — the `escape-hatch` gate reads this file for the row's key; nothing imports the constant
 */
export const ALLOW_UNLANDED_MIGRATION_ENV = "SLOPWEAVER_ALLOW_UNLANDED_MIGRATION";

/**
 * Every migration file on {@link LANDED_BASE_REF}, hashed exactly as drizzle's `readMigrationFiles` hashes the
 * working tree's copy — sha256 of the file's text — so a landed hash and a recorded one compare directly.
 *
 * The ref is resolved to ONE commit first and every name and blob is read from that commit, so a ref moved between
 * the listing and the batch cannot hand back names from one commit and bytes from another, and
 * every read ignores `refs/replace/`, which would otherwise serve another commit's tree under that commit's id.
 *
 * @param cwd the checkout whose refs are read
 * @returns the hash per tag, or why the ref could not be read
 */
export function readLandedMigrations({ cwd }: { cwd: string }): LandedMigrations {
  const baseRef = LANDED_BASE_REF;
  const env = { ...gitEnv(), GIT_NO_REPLACE_OBJECTS: "1" };
  const options = { ...LANDED_READ, env, timeout: GIT_READ_TIMEOUT_MS } as const;
  try {
    const commit = execFileSync("git", ["-C", cwd, "rev-parse", "--verify", `${baseRef}^{commit}`], options).trim();
    const names = execFileSync("git", ["-C", cwd, "ls-tree", "--name-only", `${commit}:${MIGRATIONS_DIR}`], options)
      .split("\n")
      .filter((name) => name.endsWith(".sql"));
    const input = names.map((name) => `${commit}:${MIGRATIONS_DIR}/${name}\n`).join("");
    const { encoding: _text, ...bytes } = options;
    const batch = { ...bytes, input, timeout: GIT_READ_TIMEOUT_MS };
    const output = execFileSync("git", ["-C", cwd, "cat-file", "--batch"], batch);
    return { baseRef, hashes: landedHashes({ names, output }) };
  } catch (error: unknown) {
    return { baseRef, unreadable: landedUnreadable({ baseRef, error }) };
  }
}

/**
 * The refusal a push owes when it would apply a migration that has not landed, or nothing.
 *
 * The shared local store is one database every checkout reads, so the checkout that migrates it decides the
 * hash every other one compares against. A branch's own file recorded there reads `foreign` to all of them
 * until that exact file lands — and if review changes it first, forever. Opened by `unlanded-migration`, whose
 * exceptions are a throwaway database and a rehearsal the operator resets.
 *
 * @param cwd the checkout the push runs from
 * @param pending the journal tags the push would apply
 * @returns the four-line refusal, or nothing when every pending migration landed or the hatch is open
 */
function unlandedRefusal({ cwd, pending }: { cwd: string; pending: readonly string[] }): readonly string[] {
  if (pending.length === 0) {
    return [];
  }
  const journal = readJournal({ cwd });
  if (journal.isErr()) {
    return storeErrorLines({ error: journal.error });
  }
  const waiting = new Set(pending);
  const details = unlandedMigrationDetails({
    landed: readLandedMigrations({ cwd }),
    pending: journal.value.filter((entry) => waiting.has(entry.tag)),
  });
  if (details.length === 0) {
    return [];
  }
  const open = hatchOpen({
    env: process.env,
    id: "unlanded-migration",
    nowIso: new Date().toISOString(),
  });
  if (open) {
    return [];
  }
  return hatchRefusalLines({ detail: details.join("; "), hatch: hatchFor({ id: "unlanded-migration" }) });
}

/**
 * Run one unit of work over a connection that is closed afterwards whatever happens.
 *
 * @param url the connection string
 * @param work what to do with the open connection
 * @returns whatever the work returned
 */
async function withConnection<T>({ url, work }: { url: string; work: (sql: postgres.Sql) => Promise<T> }): Promise<T> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await work(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** What a baseline recorded. */
export interface BaselineReport {
  /** The tags recorded as already applied, in journal order. */
  readonly recorded: readonly string[];
  /** The tags left pending for `store push`. */
  readonly pending: readonly string[];
}

/**
 * Record migrations as already applied on a database whose tables were created by hand.
 *
 * The archive's `maybeSeedBaseline`, generalised: it seeded exactly ONE migration because it only ever
 * had one baseline, while this store's live database sits between migrations. So the operator names the
 * last migration the database reflects, and the verb CHECKS that claim against the catalog both ways —
 * every table, type, policy and index a migration up to `through` creates must exist, and none a later
 * one creates may — before it writes a single bookkeeping row. A baseline that could be wrong is worse
 * than none: the migrator would then skip a migration whose objects are genuinely missing.
 *
 * @param url the connection string
 * @param cwd the repository root
 * @param through the tag of the last migration the database already reflects
 * @returns what was recorded and what is still pending
 */
export async function baselineStore({
  url,
  cwd,
  through,
}: {
  url: string;
  cwd: string;
  through: string;
}): Promise<Result<BaselineReport, StoreError>> {
  const journal = readJournal({ cwd });
  if (journal.isErr()) {
    return err(journal.error);
  }
  const index = journal.value.findIndex((entry) => entry.tag === through);
  if (index < 0) {
    return err(StoreErrors.migrationUnknown({ known: journal.value.map((entry) => entry.tag), through }));
  }
  return withConnection({
    url,
    work: async (sql): Promise<Result<BaselineReport, StoreError>> => {
      const checked = await baselineIsHonest({ cwd, index, journal: journal.value, sql });
      if (checked.isErr()) {
        return err(checked.error);
      }
      const recorded = journal.value.slice(0, index + 1);
      // ONE transaction, because a half-written baseline is the worst state of the three: the database
      // would then read `behind` rather than `unrecorded`, so the next `store push` would apply a
      // migration whose objects are already there and fail on them, and this verb — which only ever acts on
      // an `unrecorded` database — would refuse to try again.
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(`create schema if not exists "drizzle"`);
          await tx.unsafe(
            `create table if not exists "drizzle"."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)`,
          );
          for (const entry of recorded) {
            await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${entry.hash}, ${entry.when})`;
          }
        });
      } catch (error: unknown) {
        return err(StoreErrors.lifecycleWriteFailed({ detail: firstLineOf({ error }), stage: "baseline" }));
      }
      return ok({
        pending: journal.value.slice(index + 1).map((entry) => entry.tag),
        recorded: recorded.map((entry) => entry.tag),
      });
    },
  });
}

/**
 * Whether the catalog agrees that migrations up to `index` are applied and the rest are not.
 *
 * Split out of {@link baselineStore} so the CHECK is one readable function and the WRITE is another: the
 * write is three statements, and everything that can refuse happens before the first of them.
 *
 * @param sql an open connection
 * @param cwd the repository root
 * @param journal every migration on disk, in journal order
 * @param index the position of the last migration claimed applied
 * @returns nothing on agreement, or every disagreement
 * @internal
 */
async function baselineIsHonest({
  sql,
  cwd,
  journal,
  index,
}: {
  sql: postgres.Sql;
  cwd: string;
  journal: readonly JournalMigration[];
  index: number;
}): Promise<Result<null, StoreError>> {
  const state = await readMigrationState({ cwd, sql });
  if (state.isErr()) {
    return err(state.error);
  }
  if (state.value.kind !== "unrecorded") {
    return err(StoreErrors.baselineStateRefused({ state: state.value.kind }));
  }
  const live = await readLiveObjects({ sql });
  if (live.isErr()) {
    return err(live.error);
  }
  const files = readMigrationFiles({ migrationsFolder: join(cwd, MIGRATIONS_DIR) });
  const problems = baselineDisagreements({
    live: live.value,
    migrations: files.map((file, position) => ({
      creates: objectsCreatedBy({ sql: file.sql.join("\n") }),
      // `!` rather than a coalesce: `readJournal` refuses unless the journal and the files are the same
      // length, so an absent entry here would be a fault in this module rather than in the directory.
      tag: journal[position]!.tag,
    })),
    throughIndex: index,
  });
  if (problems.length > 0) {
    return err(StoreErrors.catalogDisagrees({ problems }));
  }
  return ok(null);
}

/**
 * The four object kinds a baseline compares, as the catalog holds them.
 *
 * @param sql an open connection
 * @returns the names present in `public`
 */
async function readLiveObjects({ sql }: { sql: postgres.Sql }): Promise<Result<LiveObjects, StoreError>> {
  try {
    const tables = await sql<{ name: string }[]>`select tablename as name from pg_tables where schemaname = 'public'`;
    const policies = await sql<
      { name: string }[]
    >`select policyname as name from pg_policies where schemaname = 'public'`;
    const indexes = await sql<{ name: string }[]>`select indexname as name from pg_indexes where schemaname = 'public'`;
    const types = await sql<{ name: string }[]>`
      select t.typname as name from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typtype = 'e'`;
    const names = ({ rows }: { rows: readonly { name: string }[] }): ReadonlySet<string> =>
      new Set(rows.map((row) => row.name));
    return ok({
      indexes: names({ rows: indexes }),
      policies: names({ rows: policies }),
      tables: names({ rows: tables }),
      types: names({ rows: types }),
    });
  } catch (error: unknown) {
    return err(StoreErrors.lifecycleReadFailed({ detail: firstLineOf({ error }), subject: "catalog" }));
  }
}

/**
 * Generate, then gate every journal migration, before a reset drops anything.
 *
 * After the drop every migration is pending, so `pushStore`'s unlanded refusal firing THERE would leave the
 * database empty rather than untouched. Generating here too is what lets the rebuild push with generation off:
 * no migration can appear between this gate and the apply.
 *
 * @param cwd the checkout the reset runs from
 * @returns the migration files generated, or the refusal
 */
function generateAndGateBeforeDrop({ cwd }: { cwd: string }): Result<readonly string[], StoreError> {
  const generated = generateMigrations({ cwd, out: join(cwd, MIGRATIONS_DIR) });
  if (generated.isErr()) {
    return err(generated.error);
  }
  const journal = readJournal({ cwd });
  if (journal.isErr()) {
    return err(journal.error);
  }
  const unlanded = unlandedRefusal({ cwd, pending: journal.value.map((entry) => entry.tag) });
  if (unlanded.length > 0) {
    return err(StoreErrors.lifecycleRefused({ reasons: unlanded }));
  }
  return ok(generated.value.created);
}

/**
 * Count every declared table's rows, then drop the bookkeeping schema and `public` and recreate `public`.
 *
 * @param url the connection string
 * @returns the rows per declared table BEFORE the drop, or the failure — which destroyed nothing when it fired
 *   before the first drop statement
 */
async function countAndDrop({
  url,
}: {
  url: string;
}): Promise<Result<readonly { table: string; rows: number }[], StoreError>> {
  return withConnection({
    url,
    work: async (sql): Promise<Result<readonly { table: string; rows: number }[], StoreError>> => {
      try {
        const present = new Set(
          (await sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public'`).map(
            (row) => row.tablename,
          ),
        );
        const counts: { table: string; rows: number }[] = [];
        for (const table of declaredTableNames().filter((name) => present.has(name))) {
          const rows = await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from "${table}"`);
          counts.push({ rows: Number(rows[0]?.n ?? "0"), table });
        }
        await sql.unsafe(TERMINATE_OTHER_BACKENDS);
        for (const statement of [
          `drop schema if exists "drizzle" cascade`,
          `drop schema public cascade`,
          `create schema public`,
          `grant all on schema public to public`,
        ]) {
          await sql.unsafe(statement);
        }
        return ok(counts);
      } catch (error: unknown) {
        return err(StoreErrors.lifecycleWriteFailed({ detail: firstLineOf({ error }), stage: "reset-drop" }));
      }
    },
  });
}

/** What a reset destroyed and rebuilt. */
export interface ResetReport {
  readonly database: string;
  /** Rows per declared table BEFORE the drop — what was destroyed, so the report says so. */
  readonly destroyed: readonly { readonly table: string; readonly rows: number }[];
  readonly push: PushReport;
}

/**
 * Drop everything in one LOCAL database and rebuild it from the schema.
 *
 * The archive's `db-reset`: terminate every other backend it can, drop the bookkeeping schema and `public`,
 * recreate `public`, then push. While a schema is still immature, a full reset of the local database
 * to a new schema is the intended alternative to writing a migration. Two refusals stand in front of it and neither has a hatch: the URL must be loopback (a
 * remote database is never reset from here, whatever is exported), and `--acknowledge` must name the
 * database — `acknowledgementProblems` says why a bare flag would protect nothing.
 *
 * BOTH refusals are HERE rather than in the verb, and a review pass is why. They were in `lifecycleRun.ts`,
 * so this exported function would have dropped `public` on a remote host for any future caller that did not
 * repeat the check — a test helper, the reset orchestration verb, a bulk tool. Every other invariant in this
 * module is attached to the thing it governs (the policies to the tables, the migration state inside
 * `connectStore`), and a refusal attached to one caller is the shape the next caller forgets. The verb still
 * refuses first, so an operator gets the usage line rather than a bare error.
 *
 * @param url the connection string
 * @param cwd the repository root
 * @param acknowledged the `--acknowledge` value
 * @returns what was destroyed and the push that rebuilt it
 */
export async function resetStore({
  url,
  cwd,
  acknowledged,
}: {
  url: string;
  cwd: string;
  acknowledged: string | undefined;
}): Promise<Result<ResetReport, StoreError>> {
  if (!isLocalStoreUrl({ url })) {
    return err(StoreErrors.resetRemote());
  }
  const database = databaseNameOf({ url });
  const problems = acknowledgementProblems({ acknowledged, database });
  if (problems.length > 0 || database === undefined) {
    return err(StoreErrors.lifecycleRefused({ reasons: problems }));
  }
  const generated = generateAndGateBeforeDrop({ cwd });
  if (generated.isErr()) {
    return err(generated.error);
  }
  const destroyed = await countAndDrop({ url });
  if (destroyed.isErr()) {
    return err(destroyed.error);
  }
  const push = await pushStore({ cwd, generate: false, url });
  if (push.isErr()) {
    return err(StoreErrors.rebuildFailed({ pushLines: storeErrorLines({ error: push.error }) }));
  }
  return ok({ database, destroyed: destroyed.value, push: { ...push.value, generated: generated.value } });
}
