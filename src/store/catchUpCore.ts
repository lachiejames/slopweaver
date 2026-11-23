/**
 * The pure half of the door's catch-up: whether a database one or more LANDED, ADDITIVE migrations behind the
 * journal is brought current at the moment a verb opens it, rather than refused.
 *
 * ## The failure this closes
 *
 * When the main checkout fast-forwards onto a migration that adds six additive tables and nothing pushes the store,
 * `connectStore` reads `behind` and refuses every verb, so the plans register (a store row) does not read, every
 * spawn fails closed, every new Claude session refuses to boot, and `claude watch` floats a card asking the owner
 * for a plans register repair. Only a hand `store push` clears it, and that this can
 * happen at all is a p0.
 *
 * The owner's rule is that a table in code and not in the database is STRUCTURALLY IMPOSSIBLE. The refusal at
 * the door made it impossible to READ such a database — not impossible for one to exist, because nothing applied a
 * landed migration when main moved. This is the half that was missing: the first verb to open the store after main
 * moves applies what landed, under the same conditions `store push` already demands, and only then reads.
 *
 * ## The four conditions, each a refusal that stays
 *
 * - **Local.** A loopback URL only. A remote database is never migrated as a side effect of a read.
 * - **Landed.** Every pending file is on `origin/main` byte for byte — {@link ./lifecycleCore.unlandedMigrationDetails},
 *   the exact condition `store push` refuses on, because a branch's own file recorded in the shared store reads
 *   `foreign` to every other checkout.
 * - **Additive.** Every statement in every pending file is on {@link ADDITIVE_HEADS}. The `drizzle-migrations`
 *   safety gate checks transaction safety, not loss: a landed migration may still `DROP COLUMN`, and an
 *   irreversible act nobody asked for at that moment is not something a read performs. Such a migration still
 *   refuses at the door and is applied by `store push`, deliberately.
 * - **Nothing reachable unnamed.** The additive check reads names off the text, so it holds only while every piece
 *   of the store's own code runs when named, under the name the text shows: no operator, cast or
 *   domain added since `initdb`, in any schema, running code other than C or `internal` (only a superuser installs either), no added function under a name {@link SAFE_CALLS} admits, and no event trigger in
 *   `public` (this tree installs none, and a pending migration cannot, since none is an additive head). An event
 *   trigger elsewhere is superuser-made and fires on `store push` exactly as on a catch-up.
 * - **Nothing taken over.** No partition holds an index no parent index attached: an index added to the partitioned
 *   parent attaches such an index rather than building its own, and the text cannot see which partitions exist.
 *
 * An allowlist rather than a denylist, so a statement shape nobody thought about refuses rather than applies.
 */
import type { JournalMigration, MigrationState } from "./lifecycleCore.js";

/** The separator drizzle-kit writes between statements in one migration file. */
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/**
 * Every statement head that only ADDS to a database. `ALTER TABLE … ADD` is admitted only as ONE action — see
 * {@link hasSecondAction}.
 */
const ADDITIVE_HEADS: readonly RegExp[] = [
  /^CREATE\s+TYPE\b/i,
  /^CREATE\s+TABLE\b/i,
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i,
  /^CREATE\s+POLICY\b/i,
  /^ALTER\s+TABLE\s+\S+\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;?$/i,
  /^ALTER\s+TABLE\s+\S+\s+ADD\s+(?:CONSTRAINT|COLUMN)\b/i,
];

/**
 * A created type or table whose name opens with `_`, the prefix of every array type Postgres generates. Creating a
 * type under an existing array type's name RENAMES that array type out of the way (`_foo` to `__foo`) rather than
 * failing, and a table brings its own row type, so either takes over an object that was already there. A range's `multirange_type_name`
 * names a second type the head never shows, so it refuses too.
 *
 * Judged on the whole name, not a lexed identifier: any `_` opening a word in the text before the first `(` or `AS`
 * refuses, so no spelling of the qualifier — spaces around its dot, a doubled quote, a `$` — reaches the name
 * unseen (Codex r21, r22). A schema whose own name opens a word with `_` refuses too, which only costs a `store push`.
 */
function takesTypeName({ body }: { body: string }): boolean {
  if (!/^CREATE\s+(?:TYPE|TABLE)\b/i.test(body)) {
    return false;
  }
  // Each quoted identifier collapses to one keeping only whether it opens with `_`, so a `(` or ` AS` quoted inside a
  // schema's name cannot end the name early (Codex r23).
  const flattened = body.replace(/"(?:[^"]|"")*"/g, (quoted) => (quoted.startsWith('"_') ? '"_"' : '"q"'));
  const name = flattened.split(/\(|\sAS\b/i)[0]!;
  return /[\s."]_/.test(name);
}

/**
 * Whether a `CREATE TYPE` is the one shape drizzle-kit writes: `CREATE TYPE <name> AS ENUM (…)`. Every other form is
 * refused. A base type's `CREATE TYPE name (INPUT = …, OUTPUT = …)` fills in an existing SHELL type in place rather
 * than adding a new one, and its I/O functions are named with no `(` the call check would see; a range or composite is a shape this tree has never written. Judged with each quoted identifier collapsed,
 * so an `AS ENUM (` quoted inside a name cannot stand in for the real one.
 *
 * @param body the chunk with its comment lines removed
 * @returns true for a statement that is not a `CREATE TYPE`, or is an enum one
 */
function typeIsEnum({ body }: { body: string }): boolean {
  if (!/^CREATE\s+TYPE\b/i.test(body)) {
    return true;
  }
  const flattened = body.replace(/"(?:[^"]|"")*"/g, '"q"');
  return /^CREATE\s+TYPE\s+[^\s(]+\s+AS\s+ENUM\s*\(/i.test(flattened);
}

/**
 * The characters of a statement that sit outside every parenthesis, in order, the parentheses themselves dropped.
 *
 * @param text the statement with its quoted runs emptied, so a bracket inside a name or literal is not counted
 * @returns the top-level text; an unbalanced `)` keeps what follows it at the top level
 */
function topLevelText({ text }: { text: string }): string {
  let depth = 0;
  let kept = "";
  for (const char of text) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (depth <= 0) {
      kept += char;
    }
  }
  return kept;
}

/**
 * Whether an `ALTER TABLE` carries a second action: a comma outside every parenthesis. `ALTER TABLE x ADD COLUMN n
 * text, DISABLE ROW LEVEL SECURITY` is one statement under an additive head, and listing the
 * actions that subtract would miss the next one nobody listed, so ANY second action refuses. drizzle-kit writes one
 * action per statement; a foreign key's column lists keep their commas inside parentheses.
 *
 * @param text the statement with its quoted runs emptied, so a comma inside a name or literal is not counted
 * @returns true when a top-level comma joins a second action on
 */
function hasSecondAction({ text }: { text: string }): boolean {
  return topLevelText({ text }).includes(",");
}

/**
 * Whether a `CREATE TABLE` fills itself from a query: an `AS` outside every parenthesis. `CREATE TABLE x AS VALUES
 * (1)` writes a row under an additive head with no row word in it, and `AS TABLE y` or `AS
 * EXECUTE p` copy rows the same way, so every form refuses rather than the ones somebody listed. A generated column's
 * `AS (…)` sits inside the column list, and drizzle-kit writes no `CREATE TABLE … AS` at all.
 *
 * @param text the statement with its quoted runs emptied, so an `AS` inside a name or literal is not counted
 * @returns true when the statement is a `CREATE TABLE` with a top-level `AS`
 */
function fillsFromQuery({ text }: { text: string }): boolean {
  return /^CREATE\s+TABLE\b/i.test(text) && /\bAS\b/i.test(topLevelText({ text }));
}

/**
 * A word that reads or writes ROWS, or drops, inside a statement that runs at apply time. A `CREATE TABLE … AS WITH
 * moved AS (DELETE … RETURNING *) SELECT …` is one statement under an additive head and deletes every row it names.
 * Not applied to `CREATE POLICY`, whose predicate runs per row on later reads, never at
 * apply time, and legitimately carries `EXISTS (SELECT …)`.
 */
const ROW_WORDS = /\b(?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|DROP|MERGE|COPY|CALL|EXECUTE|VALUES)\b/i;

/**
 * Every name a statement running at apply time may put before a `(`: SQL keywords, index methods, sized types, and
 * built-in functions that read only their arguments. A CHECK, DEFAULT, generated column or index expression is
 * EVALUATED while the migration applies, against every existing row, so a call to anything else — a function an
 * earlier migration created, say — could write rows with no row word in the text at all
 * (`ADD CONSTRAINT "c" CHECK (public.erase_sentinel())`). An allowlist, so an unknown call refuses and waits for a
 * deliberate `store push`. Measured against every committed migration's call names:
 * `grep -ohiE "[a-z_][a-z0-9_.]*[[:space:]]*\(" supabase/migrations/*.sql | sort -fu`.
 */
const SAFE_CALLS: ReadonlySet<string> = new Set(
  [
    "and or not as in check column distinct enum exists identity key unique",
    "using include with where default references on table index constraint",
    "btree gin gist hash brin",
    "numeric decimal varchar char character timestamp timestamptz time interval bit varbit vector halfvec",
    "now gen_random_uuid coalesce nullif greatest least length char_length octet_length",
    "lower upper btrim trim chr split_part strpos jsonb_typeof jsonb_array_length array_length cardinality to_tsvector",
  ].flatMap((words) => words.split(" ")),
);

/**
 * Every name the additive check admits before a `(`, for the door's catalog read: an added function, in any schema, under one
 * of these names is what the text check would let a statement call, resolved by the search path rather than by the
 * built-in the allowlist meant, so the door declines while one exists.
 *
 * @returns the allowlist, lowercased, in a stable order
 */
export function admittedCallNames(): readonly string[] {
  return [...SAFE_CALLS].toSorted();
}

/** The words a quoted name follows when its `(` opens a column list, never a call: `TABLE "x" (`, `REFERENCES "a"("id")`. */
const COLUMN_LIST_AFTER: ReadonlySet<string> = new Set(["table", "references", "on", "exists"]);

/** A name — bare, emptied-quoted, or dotted — directly before a `(`. Read over {@link unquoted} text. */
const CALL_SHAPE = /((?:[A-Za-z_][\w$]*|"")(?:\s*\.\s*(?:[A-Za-z_][\w$]*|""))*)\s*\(/g;

/**
 * Every call in an apply-time statement that is off {@link SAFE_CALLS}: a dotted bare name, an unknown bare name, or a
 * quoted name not opening a column list.
 *
 * @param text the statement with its quoted runs emptied
 * @returns true when some `(` follows a name this file does not know to be inert
 */
function hasUnsafeCall({ text }: { text: string }): boolean {
  return [...text.matchAll(CALL_SHAPE)].some((match) => {
    const name = match[1]!;
    if (name.includes('""')) {
      const before = /([A-Za-z_]+)\s*$/.exec(text.slice(0, match.index))?.[1];
      return before === undefined || !COLUMN_LIST_AFTER.has(before.toLowerCase());
    }
    return name.includes(".") || !SAFE_CALLS.has(name.toLowerCase());
  });
}

/** A foreign key's referential action, the one place drizzle-kit writes `DELETE`/`UPDATE` in an additive statement. */
const FK_ACTION = /\bON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|RESTRICT|NO\s+ACTION|SET\s+NULL|SET\s+DEFAULT)\b/gi;

/**
 * One quoted identifier or one standard string literal, matched in ONE left-to-right pass so whichever quote opens
 * first owns the run — `'x"' || "f"() || '"'` is two literals around a call, and two separate passes would pair the
 * double quotes across them and empty the call.
 */
const QUOTED_RUN = /"(?:[^"]|"")*"|'(?:[^']|'')*'/g;

/**
 * A statement with every quoted identifier and string literal emptied, so a column named `"deleted_at"` or a default
 * of `'select'` is not read as a keyword. Emptying a literal hides nothing from {@link ROW_WORDS}: a literal is data,
 * never parsed as SQL by the statement holding it.
 *
 * @param body one statement
 * @returns the statement with its quoted runs emptied
 */
function unquoted({ body }: { body: string }): string {
  return body.replace(QUOTED_RUN, (run) => (run.startsWith('"') ? '""' : "''"));
}

/**
 * A lexeme, left over once {@link unquoted} has emptied the quoted runs, that lets a statement say something this
 * file's text checks cannot see: a comment (`"f"/*gap*\/()` is a call Postgres runs with no name before the `(`),
 * a dollar-quoted string, a backslash, an escape (`E''`) or unicode (`U&`) string whose quote
 * the single pass cannot pair, a quote left unpaired, or any character off printable ASCII — Postgres takes
 * `函数(` as a call, and {@link CALL_SHAPE} sees only ASCII names. A regex CHECK's `$` and
 * `\` sit inside a standard literal and are emptied first, so every committed migration still reads.
 */
const HIDING_LEXEME = /\/\*|--|\$|\\|\b[eE]''|\b[uU]&|[^\t\n\r -~]/;

/**
 * Whether the unquoted text carries a lexeme the text checks cannot see past.
 *
 * @param text the statement with its quoted runs emptied
 * @returns true when a comment, dollar quote, backslash, escape string, unpaired quote or non-ASCII character remains
 */
function hidesFromText({ text }: { text: string }): boolean {
  return HIDING_LEXEME.test(text) || /["']/.test(text.replaceAll("''", "").replaceAll('""', ""));
}

/** How much of a refused statement a reason quotes. */
const HEAD_CHARS = 80;

/**
 * One statement with its LEADING SQL comment lines removed, or empty when it was only comments and whitespace. Only
 * the leading ones: a `--` line further down may sit inside a string literal a line above opened, where Postgres
 * reads it as data and runs whatever follows the literal's close — dropping it would classify text that never runs.
 * Left in place, {@link unquoted} pairs the literal and {@link hidesFromText} refuses any
 * `--` outside one.
 *
 * @param statement one breakpoint-separated chunk of a migration file
 * @returns the statement text that would run
 */
function statementBody({ statement }: { statement: string }): string {
  const lines = statement.split("\n");
  const firstCode = lines.findIndex((line) => line.trim() !== "" && !line.trim().startsWith("--"));
  if (firstCode === -1) {
    return "";
  }
  return lines.slice(firstCode).join("\n").trim();
}

/**
 * Whether one chunk only adds to a database.
 *
 * A chunk is judged by its opening words, so it must BE one statement: drizzle runs each breakpoint chunk as a
 * simple query, which executes every `;`-separated statement in it, and `CREATE TABLE x (…); DROP TABLE y;` with
 * no breakpoint between them would otherwise pass on its head alone. Any `;` before the
 * trailing one refuses — a semicolon inside a string literal included, which only costs a deliberate `store push`.
 *
 * A policy is exempt from the row-word and call checks because its predicate runs on later reads, never at apply —
 * but not from {@link hidesFromText}, which every chunk passes before anything else is read off its text.
 *
 * `USING INDEX` refuses too: `ADD CONSTRAINT … UNIQUE USING INDEX i` adopts an index that already exists and renames
 * it to the constraint's name, so it changes an existing object rather than adding one.
 * An added column Postgres fills row by row — a volatile default such as `gen_random_uuid()`, or a `bigserial`'s
 * `nextval` — is ADMITTED, deliberately (Codex r16, refused on the merits): it rewrites the table under a lock, but
 * every existing value survives and only the new column is filled, exactly as `store push` would do it. Refusing it
 * would refuse `0027`, `0031` and `0035`, each of which adds a `bigserial` to a populated table, and leave the boot
 * outage this door exists to end open for a shape this tree writes.
 *
 * @param body the chunk with its comment lines removed
 * @returns true when it is one statement, and one action, on the allowlist carrying no row word or unknown call
 */
function isAdditive({ body }: { body: string }): boolean {
  if (body.replace(/;\s*$/, "").includes(";")) {
    return false;
  }
  if (!ADDITIVE_HEADS.some((head) => head.test(body)) || takesTypeName({ body }) || !typeIsEnum({ body })) {
    return false;
  }
  const bare = unquoted({ body });
  if (
    hidesFromText({ text: bare }) ||
    /\bUSING\s+INDEX\b|\bMULTIRANGE_TYPE_NAME\b/i.test(bare) ||
    fillsFromQuery({ text: bare })
  ) {
    return false;
  }
  const appliesNow = !/^CREATE\s+POLICY\b/i.test(body);
  const text = bare.replace(FK_ACTION, "");
  if (appliesNow && (ROW_WORDS.test(text) || hasUnsafeCall({ text }))) {
    return false;
  }
  return !(/^ALTER\s+TABLE\b/i.test(body) && hasSecondAction({ text: bare }));
}

/**
 * Every statement in one migration file that does not only add, each named by its tag and opening words.
 *
 * @param tag the migration's journal tag, e.g. `0042_tough_skin`
 * @param sql the file's whole text
 * @returns one `<tag>: <head>` line per statement off the allowlist, empty when the file only adds
 */
export function nonAdditiveStatements({ tag, sql }: { tag: string; sql: string }): readonly string[] {
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statementBody({ statement }))
    .filter((body) => body.length > 0 && !isAdditive({ body }))
    .map((body) => `${tag}: ${body.split("\n", 1)[0]!.slice(0, HEAD_CHARS)}`);
}

/**
 * The one stderr line a verb prints when the door caught the store up before its read — on stderr so a `--json`
 * reader's stdout is untouched, and printed at all because a schema change nobody saw happen is the silent kind.
 *
 * @param pending the tags the door applied
 * @returns the line
 */
export function caughtUpLine({ pending }: { pending: readonly string[] }): string {
  return `store: caught up ${pending.join(", ")} before this read — landed on origin/main and additive, so the door applied it rather than refusing; \`slopweaver store verify\` reads the result`;
}

/**
 * Why drizzle's migrator would apply something other than exactly the judged entries, or nothing. The door judges
 * the journal's entries past the recorded COUNT; drizzle applies every entry whose `when` is later than the LAST
 * recorded `created_at` (`pg-core/dialect.js`, `migrate`). The two agree only when that instant is the `when` of the
 * last entry counted applied and every `when` in the journal strictly increases — every row drizzle or `store baseline`
 * writes carries its entry's own `when`, so a ledger that disagrees was written some other way, and the migrator
 * would replay an entry nobody judged.
 *
 * @param journal every journal entry, in journal order
 * @param applied how many entries the ledger records
 * @param lastRecordedAt the latest `created_at` in the ledger, the instant drizzle selects by
 * @returns one line naming the disagreement, or nothing when drizzle selects exactly the entries past `applied`
 */
export function migratorSelectionMismatch({
  journal,
  applied,
  lastRecordedAt,
}: {
  journal: readonly JournalMigration[];
  applied: number;
  lastRecordedAt: number | undefined;
}): readonly string[] {
  const boundary = journal[applied - 1];
  if (boundary === undefined || lastRecordedAt !== boundary.when) {
    const recorded = lastRecordedAt === undefined ? "no instant" : String(lastRecordedAt);
    const expected = boundary === undefined ? "none" : `${boundary.tag}'s ${String(boundary.when)}`;
    return [
      `the ledger's last created_at is ${recorded} where ${expected} was expected, so the migrator would choose its own set`,
    ];
  }
  // The WHOLE journal, not only the pending tail: drizzle compares every entry with the one boundary, so an earlier
  // entry whose `when` passes it would be replayed unjudged.
  const unordered = journal.slice(1).find((entry, index) => entry.when <= journal[index]!.when);
  if (unordered !== undefined) {
    return [
      `${unordered.tag}'s when does not follow the entry before it, so the migrator would not apply the journal in order`,
    ];
  }
  return [];
}

/**
 * The judged tags THIS process recorded. The migrator applies a tail of the journal, so they are the last
 * `recorded` of the judged ones — fewer than all of them when a concurrent `store push` recorded the head first, and
 * the catch-up line must not claim the push's work.
 *
 * @param judged the pending tags the door judged, in apply order
 * @param recorded how many ledger rows this process's apply wrote
 * @returns the tags it applied, in apply order; empty when it wrote none
 */
export function recordedTags({ judged, recorded }: { judged: readonly string[]; recorded: number }): readonly string[] {
  return recorded <= 0 ? [] : judged.slice(Math.max(0, judged.length - recorded));
}

/** Whether the door applies the pending migrations, and when it does not, why — in words the refusal carries. */
export type CatchUpDecision =
  { readonly apply: true; readonly pending: readonly string[] } | { readonly apply: false; readonly why: string };

/**
 * Decide whether a database the door just classified is caught up before it is opened.
 *
 * @param state the classification the door read
 * @param local whether the URL reaches this machine
 * @param unlanded one line per pending migration that is not on `origin/main` byte for byte
 * @param nonAdditive one line per pending statement off the additive allowlist
 * @param reachableCode one line per added object that runs code an expression can reach without naming a
 *   function, or under an admitted name — an operator, a cast, a domain, an event trigger or a function so named;
 *   this tree installs none
 * @returns apply, naming the tags; or not, naming the first condition that failed
 */
export function catchUpDecision({
  state,
  local,
  unlanded,
  nonAdditive,
  reachableCode,
}: {
  state: MigrationState;
  local: boolean;
  unlanded: readonly string[];
  nonAdditive: readonly string[];
  reachableCode: readonly string[];
}): CatchUpDecision {
  if (state.kind !== "behind") {
    return { apply: false, why: `the database is ${state.kind}, and only a behind one is caught up` };
  }
  if (!local) {
    return { apply: false, why: "the store URL is not on this machine, and a remote database is never caught up" };
  }
  if (unlanded.length > 0) {
    return { apply: false, why: `not caught up, because a pending migration has not landed: ${unlanded.join("; ")}` };
  }
  if (nonAdditive.length > 0) {
    return {
      apply: false,
      why: `not caught up, because a pending migration does more than add, so \`store push\` applies it deliberately: ${nonAdditive.join("; ")}`,
    };
  }
  if (reachableCode.length > 0) {
    return {
      apply: false,
      why: `not caught up, because the store holds code an additive statement could run without naming it, which this tree never installs: ${reachableCode.join("; ")}`,
    };
  }
  return { apply: true, pending: state.pending };
}
