/**
 * The pure half of the store's lifecycle — what "current", "behind" and "unrecorded" MEAN, what a verify
 * finding is, and the two parsers the destructive verb refuses through. Nothing here connects to anything;
 * `lifecycle.ts` gathers the facts from Postgres and hands them in.
 *
 * ## Why a database's migration state is a classification and not a boolean
 *
 * The archive's `db-push` asked one question — are there zero rows in `drizzle.__drizzle_migrations` while
 * `public.users` exists? — because it only ever had ONE baseline to seed. This store's live database was
 * found in a state that question cannot name: no rows, eight of ten tables present, applied by hand across
 * four migrations (`docs/store/corpus-scale-and-retrieval-slice.md` § "The whole corpus"). So the state is a small closed vocabulary, and
 * every verb that opens the store branches on it rather than on a count. Whether a URL reaches this machine at
 * all is `./localStoreUrl.ts`.
 */

/** One migration as the journal on disk describes it. */
export interface JournalMigration {
  /** The file name without its extension, e.g. `0000_polite_lady_mastermind`. */
  readonly tag: string;
  /** drizzle's sha256 of the file's SQL — what the migrator records and compares. */
  readonly hash: string;
  /** When drizzle-kit generated it, epoch milliseconds — the migrator's ordering key. */
  readonly when: number;
}

/** One row of `drizzle.__drizzle_migrations`, as the migrator wrote it. */
export interface AppliedMigration {
  readonly hash: string;
  readonly createdAt: number;
}

/**
 * Where a database stands against the journal.
 *
 * - `fresh` — no bookkeeping and no declared table: nothing has ever been applied. `push` creates it all.
 * - `current` — every journal entry is recorded, in order, and nothing else is.
 * - `behind` — a prefix of the journal is recorded; the rest is pending. `push` applies it.
 * - `unrecorded` — no bookkeeping, yet declared tables exist: the schema was applied by hand and the
 *   migrator would replay `0000` onto existing tables. `baseline --through <tag>` is the way through.
 * - `foreign` — a recorded hash the journal does not carry: this database was migrated by a different tree
 *   (a squashed journal, a branch that regenerated). Nothing automatic is safe; a person decides.
 */
type MigrationStateKind = "behind" | "current" | "foreign" | "fresh" | "unrecorded";

/** The classification, with what a report needs beside the verdict. */
export interface MigrationState {
  readonly kind: MigrationStateKind;
  /** How many journal entries are recorded as applied. */
  readonly applied: number;
  /** The journal tags not yet recorded, in apply order — empty unless `behind` or `unrecorded`. */
  readonly pending: readonly string[];
  /** Recorded hashes the journal does not carry — empty unless `foreign`. */
  readonly foreignHashes: readonly string[];
  /**
   * True only for the `foreign` database whose every recorded hash the journal DOES carry, out of order — so
   * `foreignHashes` then lists all of them, and no pull can make that history a prefix.
   */
  readonly skipped: boolean;
}

/**
 * Classify a database against the journal.
 *
 * Order matters and is checked: the migrator applies by `when` ascending and records in that order, so a
 * recorded set that is the journal's first N entries is `behind` by exactly the rest, while a recorded
 * set that skips one is not a prefix and is reported `foreign` — a person has to look.
 *
 * @param journal every migration on disk, in journal order
 * @param applied every bookkeeping row the database holds, in `created_at` order
 * @param tablesPresent whether ANY declared table exists in the database
 * @returns the classification
 */
export function classifyMigrationState({
  journal,
  applied,
  tablesPresent,
}: {
  journal: readonly JournalMigration[];
  applied: readonly AppliedMigration[];
  tablesPresent: boolean;
}): MigrationState {
  const known = new Set(journal.map((entry) => entry.hash));
  const foreignHashes = applied.map((row) => row.hash).filter((hash) => !known.has(hash));
  if (foreignHashes.length > 0) {
    return { applied: applied.length, foreignHashes, kind: "foreign", pending: [], skipped: false };
  }
  if (applied.length === 0) {
    const pending = journal.map((entry) => entry.tag);
    return { applied: 0, foreignHashes: [], kind: tablesPresent ? "unrecorded" : "fresh", pending, skipped: false };
  }
  const isPrefix = applied.every((row, index) => journal[index]?.hash === row.hash);
  if (!isPrefix) {
    return {
      applied: applied.length,
      foreignHashes: applied.map((row) => row.hash),
      kind: "foreign",
      pending: [],
      skipped: true,
    };
  }
  const pending = journal.slice(applied.length).map((entry) => entry.tag);
  return {
    applied: applied.length,
    foreignHashes: [],
    kind: pending.length === 0 ? "current" : "behind",
    pending,
    skipped: false,
  };
}

/**
 * The database a connection string names.
 *
 * @param url a `postgresql://` connection string
 * @returns the database name, or undefined when the string names none or does not parse
 */
export function databaseNameOf({ url }: { url: string }): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  return name.length === 0 ? undefined : name;
}

/**
 * The one flag that lets `store reset` destroy a database: it must NAME the database the URL selects.
 *
 * A bare `--yes` protects nothing — it is typed from muscle memory. A flag that has to carry the name of
 * what is about to be dropped cannot be typed without reading it, which is the whole protection.
 *
 * @param acknowledged the value given to `--acknowledge`, or undefined when the flag was absent
 * @param database the database the connection string names
 * @returns nothing when the acknowledgement matches, else the refusal lines
 */
export function acknowledgementProblems({
  acknowledged,
  database,
}: {
  acknowledged: string | undefined;
  database: string | undefined;
}): readonly string[] {
  if (database === undefined) {
    return ["the store URL names no database, so there is nothing to acknowledge and nothing to reset"];
  }
  if (acknowledged === undefined) {
    return [
      `store reset destroys every table in "${database}" — re-run with --acknowledge ${database} to say you mean that one`,
    ];
  }
  if (acknowledged !== database) {
    return [
      `--acknowledge names "${acknowledged}" but the store URL selects "${database}" — the flag must name the database being reset`,
    ];
  }
  return [];
}

/** The DDL objects one migration file creates, by name — what a baseline checks against the catalog. */
export interface CreatedObjects {
  readonly tables: readonly string[];
  readonly policies: readonly string[];
  readonly indexes: readonly string[];
  readonly types: readonly string[];
}

/**
 * The objects one migration's SQL creates, read from drizzle-kit's own spellings.
 *
 * Four kinds rather than tables alone, and the live store is why: it was found with every table of
 * migrations 0000–0001, row level security ON as 0002 enables it, NONE of 0002's 24 policies, and the two
 * trgm indexes 0006 declares already present by hand. A tables-only check would have accepted
 * `--through 0003` and recorded 0002 as applied over a database with no policies — which the migrator
 * would then never apply. Reproduce on the live store:
 * `docker exec supabase_db_slopweaver psql -U postgres -tAc "select count(*) from pg_policies where schemaname='public'"`.
 *
 * @param sql one migration file's SQL
 * @returns the names, in statement order
 */
export function objectsCreatedBy({ sql }: { sql: string }): CreatedObjects {
  // `!` rather than a coalesce: every pattern below has exactly one capture group, so a match without one
  // would be a fault in this function rather than in the SQL, and an empty name would silently pass a check.
  const names = ({ pattern }: { pattern: RegExp }): readonly string[] =>
    [...sql.matchAll(pattern)].map((match) => match[1]!);
  return {
    indexes: names({ pattern: /CREATE (?:UNIQUE )?INDEX "([^"]+)"/g }),
    policies: names({ pattern: /CREATE POLICY "([^"]+)" ON/g }),
    tables: names({ pattern: /CREATE TABLE "([^"]+)"/g }),
    types: names({ pattern: /CREATE TYPE "public"\."([^"]+)"/g }),
  };
}

/** The same four kinds, as the catalog holds them. */
export interface LiveObjects {
  readonly tables: ReadonlySet<string>;
  readonly policies: ReadonlySet<string>;
  readonly indexes: ReadonlySet<string>;
  readonly types: ReadonlySet<string>;
}

/**
 * Every way the catalog disagrees with the claim that migrations up to `throughIndex` are applied and
 * the rest are not.
 *
 * Both directions, for every object kind: something a "applied" migration creates that is absent means
 * that migration is NOT applied; something a "pending" migration creates that is present means it IS,
 * or was created by hand — and the migrator would fail on it either way.
 *
 * @param migrations every migration's tag and what it creates, in journal order
 * @param throughIndex the position of the last migration claimed applied
 * @param live what the catalog holds
 * @returns one line per disagreement
 */
export function baselineDisagreements({
  migrations,
  throughIndex,
  live,
}: {
  migrations: readonly { readonly tag: string; readonly creates: CreatedObjects }[];
  throughIndex: number;
  live: LiveObjects;
}): readonly string[] {
  const out: string[] = [];
  const nouns: Readonly<Record<keyof CreatedObjects, string>> = {
    indexes: "index",
    policies: "policy",
    tables: "table",
    types: "type",
  };
  const kinds: readonly (keyof CreatedObjects)[] = ["tables", "types", "policies", "indexes"];
  migrations.forEach(({ tag, creates }, position) => {
    for (const kind of kinds) {
      const noun = nouns[kind];
      for (const name of creates[kind]) {
        const present = live[kind].has(name);
        if (position <= throughIndex && !present) {
          out.push(`${tag} creates ${noun} "${name}" and the database does not have it, so it is not already applied`);
        }
        if (position > throughIndex && present) {
          out.push(`${tag} creates ${noun} "${name}" and the database already has it, so --through stops too early`);
        }
      }
    }
  });
  return out;
}

/** What kind of thing a verify finding is about. */
type VerifyFindingKind = "enum" | "extension" | "grant" | "migration" | "policy" | "rls" | "role" | "table";

/** One way the live database disagrees with the declared schema. */
export interface VerifyFinding {
  readonly kind: VerifyFindingKind;
  readonly message: string;
}

/** One live policy row, as `pg_policies` reports it. */
export interface LivePolicy {
  readonly table: string;
  readonly name: string;
  readonly roles: readonly string[];
  /** `pg_policies.cmd` — `ALL`, `SELECT`, `INSERT`, `UPDATE` or `DELETE`. */
  readonly cmd: string;
}

/**
 * One policy's two expressions, AS POSTGRES DEPARSES THEM — `pg_get_expr(polqual, polrelid)` and
 * `pg_get_expr(polwithcheck, polrelid)`, `null` where the policy has none.
 *
 * Deparsed text on both sides, never the schema's own source: Postgres adds casts, parentheses, a
 * relation-qualified outer column and line breaks, so `visibility = 'public'` reads back as
 * `(visibility = 'public'::visibility)`. A hand canonicaliser that strips those is lossy — `a and (b or c)`
 * and `(a and b) or c` agree once the parentheses go — so the declared side is deparsed by the same
 * database, from a probe policy the verifier creates and rolls back (`lifecycle.ts`).
 */
export interface PolicyPredicates {
  readonly table: string;
  readonly name: string;
  readonly using: string | null;
  readonly withCheck: string | null;
}

/** One declared policy's expressions as the schema's own SQL renders them — what a probe policy is created with. */
export interface DeclaredPolicyPredicates extends PolicyPredicates {
  /** The operation, as `create policy … for` spells it: a policy with `with check` is refused on `select`. */
  readonly cmd: string;
}

/** Everything the verifier read from the database, gathered by `lifecycle.ts`. */
export interface LiveSchemaFacts {
  /** Tables in `public`, with whether row level security is enabled on each. */
  readonly tables: readonly { readonly name: string; readonly rlsEnabled: boolean }[];
  readonly policies: readonly LivePolicy[];
  /** Each live policy's expressions, from `pg_policies.qual` and `with_check`. */
  readonly livePredicates: readonly PolicyPredicates[];
  /**
   * Each declared policy's expressions, deparsed by THIS database from a rolled-back probe — the text a
   * correct live policy reads back as. Only for tables the database has; an absent table is its own finding.
   */
  readonly declaredPredicates: readonly PolicyPredicates[];
  /** `has_table_privilege(role, table, privilege)` for each role, table and privilege asked. */
  readonly privileges: readonly {
    readonly role: string;
    readonly table: string;
    readonly privilege: string;
    readonly held: boolean;
  }[];
  /** Each declared enum's labels as the database holds them. */
  readonly enums: readonly { readonly name: string; readonly labels: readonly string[] }[];
  /** Installed extensions. */
  readonly extensions: readonly string[];
  /** Roles the connecting user can `set role` to. */
  readonly assumableRoles: readonly string[];
  readonly migration: MigrationState;
  /** What the base ref carries — read only for a `foreign` database, so its finding can say "this checkout is behind". */
  readonly landed?: LandedMigrations;
}

/** What the schema declares, reduced to what the verifier compares against. */
export interface DeclaredSchemaFacts {
  readonly tables: readonly string[];
  /** Expected policies per table: name, operation as `pg_policies.cmd` spells it, and the one role. */
  readonly policies: readonly LivePolicy[];
  /** Each declared policy's expressions as rendered from the schema, for the probe that deparses them. */
  readonly predicates: readonly DeclaredPolicyPredicates[];
  /** Every (role, table, privilege) the grants phase promises. */
  readonly privileges: readonly { readonly role: string; readonly table: string; readonly privilege: string }[];
  readonly enums: readonly { readonly name: string; readonly labels: readonly string[] }[];
  readonly extensions: readonly string[];
  readonly roles: readonly string[];
}

/**
 * Every migration file at the ref a migration must have landed on, by tag — or why that ref could not be read.
 *
 * A record rather than a `Result` because "unreadable" is not a failure of the caller's act: it is one more
 * fact a refusal prints, and the push it gates is refused either way.
 */
export type LandedMigrations =
  | { readonly baseRef: string; readonly hashes: ReadonlyMap<string, string> }
  | { readonly baseRef: string; readonly unreadable: string };

/**
 * Why each migration a push is about to apply has not landed, one line per migration.
 *
 * The shared local store is migrated by whichever checkout runs `store push`, and the migrator records the
 * hash of THAT checkout's file. A file that is not on the base ref byte for byte records a hash every other
 * checkout reads as `foreign` — so "landed" means the same bytes at the same tag, not merely a file of that
 * name. MEASURED: `shasum -a 256 supabase/migrations/0003_colorful_marauders.sql` on main is
 * the recorded hash, and every seat that read it foreign was a checkout that had not pulled main.
 *
 * @param pending the journal entries the push would apply, in apply order
 * @param landed what the base ref carries
 * @returns nothing when every pending migration is landed, else one line per one that is not
 */
export function unlandedMigrationDetails({
  pending,
  landed,
}: {
  pending: readonly JournalMigration[];
  landed: LandedMigrations;
}): readonly string[] {
  if (pending.length === 0) {
    return [];
  }
  if ("unreadable" in landed) {
    return [
      `cannot tell whether ${pending.map((entry) => entry.tag).join(", ")} landed, because ${landed.baseRef} could not be read (${landed.unreadable}); run \`git fetch origin\` in this checkout`,
    ];
  }
  return pending.flatMap((entry) => {
    const landedHash = landed.hashes.get(entry.tag);
    if (landedHash === undefined) {
      return [`${entry.tag} is not on ${landed.baseRef}`];
    }
    if (landedHash !== entry.hash) {
      return [
        `${entry.tag} differs from ${landed.baseRef}'s copy (${entry.hash.slice(0, 12)} here, ${landedHash.slice(0, 12)} landed)`,
      ];
    }
    return [];
  });
}

/**
 * The landed tag of every foreign hash, when EVERY one of them is on the base ref — the signature of a checkout
 * that is behind, not of a database migrated by a different tree.
 *
 * @param foreignHashes the recorded hashes this checkout's journal does not carry
 * @param landed what the base ref carries
 * @returns one `hash is <ref>'s <tag>` phrase per hash, or undefined when any hash is not landed or the ref is unreadable
 */
function behindBaseRef({
  foreignHashes,
  landed,
}: {
  foreignHashes: readonly string[];
  landed: LandedMigrations;
}): readonly string[] | undefined {
  if ("unreadable" in landed || foreignHashes.length === 0) {
    return undefined;
  }
  const tagByHash = new Map([...landed.hashes].map(([tag, hash]) => [hash, tag]));
  const phrases: string[] = [];
  for (const hash of foreignHashes) {
    const tag = tagByHash.get(hash);
    if (tag === undefined) {
      return undefined;
    }
    phrases.push(`${hash.slice(0, 12)} is ${landed.baseRef}'s ${tag}`);
  }
  return phrases;
}

/**
 * One line saying where a database stands, and what to run about it.
 *
 * @param state the classification
 * @param landed what the base ref carries; given, a `foreign` database whose every recorded hash has landed is
 *   named as THIS CHECKOUT being behind, which a pull fixes and a reset or a hatch never should
 * @returns the line
 */
export function migrationStateLine({ state, landed }: { state: MigrationState; landed?: LandedMigrations }): string {
  if (state.kind === "foreign" && !state.skipped && landed !== undefined) {
    const behind = behindBaseRef({ foreignHashes: state.foreignHashes, landed });
    if (behind !== undefined) {
      return `migrations: foreign to this checkout only — ${behind.join(", ")}; this checkout is behind ${landed.baseRef}, so pull or rebase it and the store reads current. Never \`store reset\` or \`SLOPWEAVER_ALLOW_STALE_STORE\` for this`;
    }
  }
  switch (state.kind) {
    case "current":
      return `migrations: current — ${String(state.applied)} recorded, nothing pending`;
    case "fresh":
      return `migrations: fresh — nothing applied yet; \`slopweaver store push\` creates everything (${String(state.pending.length)} pending)`;
    case "behind":
      return `migrations: behind by ${String(state.pending.length)} — ${state.pending.join(", ")}; run \`slopweaver store push\``;
    case "unrecorded":
      return `migrations: unrecorded — declared tables exist and drizzle.__drizzle_migrations is empty, so the migrator would replay 0000 onto them; run \`slopweaver store baseline --through <tag>\` naming the last migration this database already reflects, then \`store push\``;
    case "foreign":
      return `migrations: foreign — ${String(state.foreignHashes.length)} recorded hash(es) the journal does not carry (${state.foreignHashes.map((hash) => hash.slice(0, 12)).join(", ")}); this database was migrated by a different tree, so a person decides: \`store reset\` while nothing here is load-bearing, or a hand-written baseline`;
    default: {
      const exhaustive: never = state.kind;
      return exhaustive;
    }
  }
}

/**
 * Clear the way for the schema drop, without making another role's connection fatal.
 *
 * The archive's `db-reset` ran a bare `select pg_terminate_backend(pid) from pg_stat_activity …`, and that
 * is what stood here. It works on a stack where the connecting role is superuser. MEASURED on
 * the local Supabase stack, where it is NOT: `store reset --acknowledge postgres` died with `reset failed
 * before rebuilding: permission denied to terminate process`, having destroyed nothing, because Supabase
 * keeps its own backends on the same database under roles `postgres` cannot signal — five
 * `supabase_mt_realtime`, two `cluster_node_realtime`, `pg_net`, the `pg_cron` scheduler,
 * `supabase_storage_admin` and PostgREST's `authenticator`. Reproduce with
 * `select usename, application_name from pg_stat_activity where datname = current_database()`.
 *
 * The step is BEST EFFORT by nature and was written as a precondition, which is the whole defect. What
 * follows it drops SCHEMAS, and `drop schema … cascade` takes locks on the objects it removes rather than
 * an exclusive lock on the database — unlike `DROP DATABASE`, which is what a terminate sweep is normally
 * in front of. So a backend this role may not signal does not block the drop; it only blocks the signal.
 *
 * Per-row exception handling rather than a filter on `usename`, because the rule for who may signal whom is
 * role MEMBERSHIP plus `pg_signal_backend`, which no predicate here can restate without eventually being
 * wrong about it. Letting Postgres decide per backend and swallowing exactly the refusal keeps the sweep
 * doing everything it is permitted to do. It is deliberately narrow: only `insufficient_privilege` is
 * caught, so a genuine failure still raises.
 */
export const TERMINATE_OTHER_BACKENDS = `do $$
  declare target record;
  begin
    for target in
      select pid from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()
    loop
      begin
        perform pg_terminate_backend(target.pid);
      exception when insufficient_privilege then
        null;
      end;
    end loop;
  end $$`;
