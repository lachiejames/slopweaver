/**
 * The ordering invariants in the generated DDL that only a live apply would otherwise catch.
 *
 * MEASURED: `drizzle-kit generate` emits the per-source tables' composite foreign keys BEFORE
 * the unique key they reference, and Postgres refuses a foreign key whose referenced column list has no
 * unique constraint — `there is no unique constraint matching given keys for referenced table "content"`.
 * The generated file was reordered BY HAND, and this file's own header said at the time that a hand
 * reorder "fixes today and not tomorrow: a regeneration puts it back, silently". That is exactly what
 * happened. MEASURED AGAIN, squashing the journal to one `0000`:
 * the first regeneration since put the keys back ahead of the index and the single file stopped on an
 * empty database at that same error. Across six files the test had gone on passing, because the index
 * came from an earlier migration than the keys and no single file ever had to order the two.
 *
 * So the fix is structural now rather than positional: `uq_content_id_source` is declared with `unique()`
 * instead of `uniqueIndex()`, which drizzle emits INSIDE the `CREATE TABLE` — the first of the three
 * phases it generates (`CREATE TABLE`, then `ALTER TABLE … ADD CONSTRAINT`, then `CREATE INDEX`) — so it
 * exists before any phase that could reference it and the generator has no ordering left to get wrong.
 * Postgres backs the constraint with a unique index of the same name and definition, so nothing that
 * reads it changed; VERIFIED by replaying both DDL sets into two empty databases and diffing their
 * catalogs, where `uq_content_id_source` appears as an identical `CREATE UNIQUE INDEX` on both sides.
 *
 * The invariant is still asserted over the emitted SQL rather than over the schema module, for the same
 * reason it always was: the schema module is right either way, and it is the generator's output that has
 * the failure mode. What changed is that the assertion now names the shape that cannot regress instead of
 * an ordering that a regeneration is free to undo.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** The migration directory, relative to the repository root this suite runs from. */
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** Every generated migration's text, in the order they apply. */
const files: readonly { name: string; sql: string }[] = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .toSorted()
  .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));

/** The whole migration sequence as one string, which is how Postgres experiences it. */
const applied = files.map((file) => file.sql).join("\n");

/**
 * A drop and its name: quoted (a doubled quote is one quote inside it) or bare, `IF EXISTS` or not, in either case. A
 * bare name is Postgres's own lexer rule (`scan.l`'s `ident_start`/`ident_cont`): an ASCII letter, underscore or ANY
 * non-ASCII character, then those, digits and `$` — so a combining mark is part of the name, never its end.
 */
const NAMED_DROP =
  /\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?("(?:[^"]|"")+"|[A-Za-z_\u{80}-\u{10FFFF}][A-Za-z0-9_$\u{80}-\u{10FFFF}]*)/giu;

/**
 * A drop and the table it is on, in the one shape a generator writes: `ALTER TABLE <table> DROP CONSTRAINT <name>;`, one
 * action ending the statement, the table unqualified. A constraint name is unique only within its table,
 * so a drop is known by both; one in any other shape — a second action before or after it, a CASCADE, ONLY,
 * IF EXISTS, a qualified table — yields no target and reddens. Space is Postgres's own (`scan.l`'s `space`), ASCII
 * only, so a non-ASCII space is part of a name, exactly as Postgres reads it, and never also a separator.
 */
const TABLE_DROP =
  /\bALTER[ \t\n\r\f\v]+TABLE[ \t\n\r\f\v]+(?!(?:IF|ONLY)\b)("(?:[^"]|"")+"|[A-Za-z_\u{80}-\u{10FFFF}][A-Za-z0-9_$\u{80}-\u{10FFFF}]*)[ \t\n\r\f\v]+DROP[ \t\n\r\f\v]+CONSTRAINT[ \t\n\r\f\v]+(?!IF\b)("(?:[^"]|"")+"|[A-Za-z_\u{80}-\u{10FFFF}][A-Za-z0-9_$\u{80}-\u{10FFFF}]*)(?=[ \t\n\r\f\v]*;)/giu;

/**
 * What no migration may hold, matched on the RAW text so a comment or a literal cannot hide one. The reader below lexes
 * by Postgres's default rules (`standard_conforming_strings` on since 9.1), and each of these could change those rules
 * for the statements after it — a setting by name, by a Unicode-escaped name (`U&"…\0073"`), by `set_config`, by a
 * database or role default, or by SQL a static reader never sees, run from procedural code. Every migration is plain
 * generated DDL and DML, so a file holding any of them reddens, comment or not.
 *
 * Every shape is also tried on the CODE — literals, quoted names and comments read as spaces — so a comment between
 * two of its words hides nothing. A KEYWORD shape is read from the code ONLY, so a literal `'call'` or a column named
 * `"do"` is no keyword, while a NAME shape — a rename, a shadowing schema, a function that runs a string — also reads
 * the code with its quoted names kept, since `"pg_temp"` and `"query_to_xml"` name what they spell. That is sound by induction over the file: the first statement that could change
 * the lexer is either one of the raw shapes, caught wherever it sits, or procedural code lexed by rules nothing before
 * it could have changed.
 */
const UNREADABLE: readonly {
  readonly construct: string;
  readonly pattern: RegExp;
  readonly code?: true;
  /** Also tried on the code with its quoted names kept, since a quoted name is still the name it spells. */
  readonly names?: true;
}[] = [
  { construct: "a lexer setting", pattern: /\b(?:standard_conforming_strings|backslash_quote)\b/iu },
  { construct: "a Unicode escape", pattern: /(?<![\w$\u{80}-\u{10FFFF}])U&['"]/iu },
  { construct: "set_config", pattern: /\bset_config\b/iu },
  { construct: "a database, role or system default", pattern: /\bALTER\s+(?:DATABASE|ROLE|USER|SYSTEM)\b/iu },
  // A rename or a schema move changes what a name refers to, so a drop by name could reach another guard.
  { code: true, construct: "a rename or a schema move", names: true, pattern: /\bRENAME\b|\bSET\s+SCHEMA\b/iu },
  // A temporary table or a new schema can shadow an unqualified table name, so a re-add could land elsewhere.
  {
    code: true,
    construct: "a shadowing table or schema",
    names: true,
    pattern: /\bTEMP(?:ORARY)?\b|\bpg_temp\w*|\bSCHEMA\b/iu,
  },
  {
    code: true,
    construct: "procedural code",
    pattern:
      /\b(?:EXECUTE|PREPARE|CALL)\b|\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b|\bDO\b(?!\s+(?:NOTHING|UPDATE)\b)|\bCREATE\s+EXTENSION\b|\bPROGRAM\b/iu,
  },
  // An extension's dblink, and core query_to_xml, ts_stat and ts_rewrite, run SQL from a string a static reader masks;
  // a function quoted is still the function it names, so its quoted name counts.
  {
    code: true,
    construct: "a call that runs SQL from a string",
    names: true,
    pattern: /\bdblink\w*|\bquery_to_xml\w*|\bts_stat\b|\bts_rewrite\b/iu,
  },
  { construct: "a dollar quote", pattern: /\$(?:[A-Za-z_\u{80}-\u{10FFFF}][A-Za-z0-9_\u{80}-\u{10FFFF}]*)?\$/u },
];

/**
 * Whether any statement opens with SET or RESET. Every place a statement can start is tried — the file's start, past
 * every `;` and past every drizzle breakpoint, literal or not — so a real start is never skipped, and the comments
 * before it are passed over as Postgres passes over them.
 */
function opensWithSet({ sql }: { sql: string }): boolean {
  const starts = [0, ...[...sql.matchAll(/;|statement-breakpoint/gu)].map((match) => match.index + match[0].length)];
  return starts.some((start) => /^(?:SET|RESET)\b/iu.test(sql.slice(firstWordAt({ sql, start }))));
}

/** Where the first word past `start` begins, whitespace, line comments and nested block comments passed over. */
function firstWordAt({ sql, start }: { sql: string; start: number }): number {
  let at = start;
  let moved = true;
  while (moved) {
    const before = at;
    const space = /^\s+/u.exec(sql.slice(at));
    if (space !== null) {
      at += space[0].length;
    } else if (sql.startsWith("--", at)) {
      const newline = sql.slice(at).search(/[\r\n]/u);
      at = newline === -1 ? sql.length : at + newline;
    } else if (sql.startsWith("/*", at)) {
      at = blockCommentEnd({ sql, start: at });
    }
    moved = at !== before;
  }
  return at;
}

/** Every construct a file holds that the reader below cannot read past, in the order {@link UNREADABLE} lists them. */
function unreadableConstructs({ sql }: { sql: string }): readonly string[] {
  const code = withoutComments({ masked: true, sql });
  const named = withoutComments({ keepNames: true, masked: true, sql });
  // A raw shape is tried on the code as well, so a comment between its words (`ALTER/**/ROLE`) hides nothing; a name
  // shape on the code with its quoted names kept, so `"pg_temp"` is the schema it names.
  const held = UNREADABLE.filter(
    (one) =>
      one.pattern.test(code) ||
      (one.names === true && one.pattern.test(named)) ||
      (one.code !== true && one.pattern.test(sql)),
  ).map((one) => one.construct);
  return opensWithSet({ sql }) ? [...held, "a SET or RESET statement"] : held;
}

/** The name Postgres gives a token: a quoted one with its doubled quotes undone, a bare one with ASCII folded down. */
function constraintName({ token }: { token: string }): string {
  if (token.startsWith('"')) {
    return token.slice(1, -1).replaceAll('""', '"');
  }
  return token.replaceAll(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

/**
 * One run Postgres reads verbatim, so a comment marker inside it is text: an escape string (`E'\''`), a bare word or
 * number (so `E'` mid-identifier is no escape string, and `a$b$` no dollar quote), a literal, a quoted identifier, or a
 * dollar quote whose tag follows identifier rules (`$x1$`). Sticky, so it is tried at one offset only.
 */
const VERBATIM =
  /[Ee]'(?:[^'\\]|\\[\s\S]|'')*'|[A-Za-z0-9_\u{80}-\u{10FFFF}][A-Za-z0-9_$\u{80}-\u{10FFFF}]*|'(?:[^']|'')*'|"(?:[^"]|"")*"|(\$(?:[A-Za-z_\u{80}-\u{10FFFF}][A-Za-z0-9_\u{80}-\u{10FFFF}]*)?\$)[\s\S]*?\1/uy;

/** The end of the block comment opening at `start`, counting depth, because Postgres nests block comments. */
function blockCommentEnd({ sql, start }: { sql: string; start: number }): number {
  let depth = 0;
  let at = start;
  while (at < sql.length) {
    if (sql.startsWith("/*", at)) {
      depth += 1;
      at += 2;
    } else if (sql.startsWith("*/", at)) {
      depth -= 1;
      at += 2;
      if (depth === 0) {
        return at;
      }
    } else {
      at += 1;
    }
  }
  return sql.length;
}

/** What one unquoted step at `at` reads as: a comment as one space, ending where it ends, else the one character. */
function unquotedStep({ sql, at }: { sql: string; at: number }): { text: string; next: number } {
  if (sql.startsWith("--", at)) {
    // Postgres ends a line comment at a CR as well as an LF.
    const newline = sql.slice(at).search(/[\r\n]/u);
    return { next: newline === -1 ? sql.length : at + newline, text: " " };
  }
  if (sql.startsWith("/*", at)) {
    return { next: blockCommentEnd({ sql, start: at }), text: " " };
  }
  return { next: at + 1, text: sql[at]! };
}

/**
 * The SQL with every comment, line or nested block, read as the whitespace Postgres reads it as;
 * `masked`, every literal and dollar quote reads as a space too, and every quoted name unless `keepNames`.
 *
 * Drizzle's migrator splits a file on the raw text `--> statement-breakpoint` BEFORE Postgres lexes anything
 * (`node_modules/drizzle-orm/migrator.js`, `query.split("--> statement-breakpoint")`) and sends each piece as its own
 * query, so each piece is lexed here on its own and the pieces are joined by a statement end. Lexed whole, a statement
 * after an inline breakpoint would read as the rest of a `--` comment.
 */
function withoutComments({
  sql,
  masked = false,
  keepNames = false,
}: {
  sql: string;
  masked?: boolean;
  keepNames?: boolean;
}): string {
  return sql
    .split("--> statement-breakpoint")
    .map((query) => lexedQuery({ keepNames, masked, sql: query }))
    .join("\n;\n");
}

/** One query drizzle sends, lexed as {@link withoutComments} describes. */
function lexedQuery({ sql, masked, keepNames }: { sql: string; masked: boolean; keepNames: boolean }): string {
  let out = "";
  let at = 0;
  while (at < sql.length) {
    VERBATIM.lastIndex = at;
    const quoted = VERBATIM.exec(sql);
    if (quoted === null) {
      const step = unquotedStep({ at, sql });
      out += step.text;
      at = step.next;
      continue;
    }
    const word = /^[A-Za-z0-9_\u{80}-\u{10FFFF}][A-Za-z0-9_$\u{80}-\u{10FFFF}]*$/u.test(quoted[0]);
    const kept = word || (keepNames && quoted[0].startsWith('"'));
    out += masked && !kept ? " " : quoted[0];
    at += quoted[0].length;
  }
  return out;
}

/**
 * Every constraint one migration drops: by name, as `table.constraint` where the drop is in the shape a generator
 * writes, and how many `DROP CONSTRAINT` it holds whether named or not.
 */
function droppedConstraints({ sql }: { sql: string }): {
  names: readonly string[];
  targets: readonly string[];
  occurrences: number;
} {
  // Code only: a comment, a literal or a dollar quote reads as a space, a quoted name as itself.
  const tokens = withoutComments({ keepNames: true, masked: true, sql });
  const names = [...tokens.matchAll(NAMED_DROP)].map((match) => constraintName({ token: match[1]! }));
  const targets = [...tokens.matchAll(TABLE_DROP)].map(
    (match) => `${constraintName({ token: match[1]! })}.${constraintName({ token: match[2]! })}`,
  );
  return { names, occurrences: [...tokens.matchAll(/\bDROP\s+CONSTRAINT\b/giu)].length, targets };
}

/**
 * Whether a migration's CODE adds the named constraint of the named kind to the named table — a statement Postgres
 * runs, never text inside a comment or a literal.
 */
function addsConstraint({
  sql,
  table,
  name,
  kind,
}: {
  sql: string;
  table: string;
  name: string;
  kind: string;
}): boolean {
  return withoutComments({ keepNames: true, masked: true, sql }).includes(
    `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" ${kind}`,
  );
}

describe("a foreign key never precedes the unique key it references", () => {
  it("declares uq_content_id_source as a table constraint, which is what puts it in the first phase", () => {
    expect(applied).toContain('CONSTRAINT "uq_content_id_source" UNIQUE("id","source")');
  });

  it("declares it before the first composite key onto it", () => {
    const declared = applied.indexOf('CONSTRAINT "uq_content_id_source" UNIQUE("id","source")');
    const firstKey = applied.indexOf('FOREIGN KEY ("content_id","source")');
    expect(declared).toBeGreaterThan(-1);
    expect(firstKey).toBeGreaterThan(declared);
  });

  it("never emits it as a standalone index, the spelling that lands in the last phase", () => {
    expect(applied).not.toContain('CREATE UNIQUE INDEX "uq_content_id_source"');
  });

  it("references it from all four per-source tables, so the order matters four times", () => {
    expect(applied.split('FOREIGN KEY ("content_id","source")').length - 1).toBe(4);
  });

  it("has a migration to check at all, so this test cannot pass by finding nothing", () => {
    expect(files.length).toBeGreaterThan(0);
  });
});

describe("the per-source tables are pinned to one source each", () => {
  it("emits a CHECK naming the source for every one of them", () => {
    const pinned = ["github", "linear", "notion", "slack"].filter((source) =>
      applied.includes(`CONSTRAINT "content_${source}_is_${source}" CHECK (source = '${source}')`),
    );
    expect(pinned).toEqual(["github", "linear", "notion", "slack"]);
  });

  /**
   * The squashed journal states the END shape, never a step on the way to it.
   *
   * Before the squash this read "drops the metadata presence checks the per-source columns replaced,
   * AFTER having created them" — a true statement about a six-file history in which
   * `content_slack_needs_channel` was created by one migration and dropped by a later one. One `0000`
   * that IS the schema has no intermediate state to order, so the property worth asserting is that the
   * replaced shape is absent outright. A migration that resurrected it would fail here.
   */
  it("carries no metadata presence CHECK, the shape the per-source columns replaced", () => {
    expect(applied).not.toContain("needs_channel");
    expect(applied).not.toContain("metadata ?");
  });

  it("carries no DROP CONSTRAINT in the squashed 0000, because one 0000 undoes nothing it never did", () => {
    expect(files[0]!.name).toBe("0000_polite_lady_mastermind.sql");
    expect(files[0]!.sql).not.toContain("DROP CONSTRAINT");
  });

  /**
   * The constraints a later migration has dropped, and why none is a gap.
   *
   * The `trace` kind was added, which widened the memories CHECK, and the steer measurements
   * joining the witnessed registers widened the home-file import's witness CHECK. An applied import widened
   * four more in one file: a batch is unique by its export AND its plan, a restored standing ask may sit
   * inactive with no recording, and a staged question may be an alignment. The identity roster joining the
   * singleton registers widened that table's known-id CHECK, and the Claude plan probes widened it again. Drizzle emits a changed constraint
   * as a DROP and an ADD, and the migrator runs a file in ONE transaction, so no committed state ever lacks
   * both. Pinned by table and name so a migration dropping any OTHER constraint still reddens this suite.
   */
  it("reads every drop's name, quoted or bare, in any case, and counts a drop it cannot name", () => {
    expect(
      droppedConstraints({
        sql: 'DROP CONSTRAINT unlisted_guard;\ndrop constraint if exists "a_sha256_fk";\nALTER TABLE "t" DROP CONSTRAINT',
      }),
    ).toEqual({ names: ["unlisted_guard", "a_sha256_fk"], occurrences: 3, targets: [] });
  });

  it("names a drop as Postgres does: a doubled quote kept inside a quoted name, a bare name folded to lower case", () => {
    expect(
      droppedConstraints({
        sql: [
          'ALTER TABLE "t" DROP CONSTRAINT "uq_store_import_batch_content""evil";',
          "ALTER TABLE t DROP CONSTRAINT Mixed_Guard;",
          "ALTER TABLE t DROP CONSTRAINT uq_store_import_batch_content́;",
          "ALTER TABLE t DROP CONSTRAINT Ünïcode_Guard;",
        ].join("\n"),
      }),
    ).toEqual({
      names: ['uq_store_import_batch_content"evil', "mixed_guard", "uq_store_import_batch_content́", "Ünïcode_guard"],
      occurrences: 4,
      targets: [
        't.uq_store_import_batch_content"evil',
        "t.mixed_guard",
        "t.uq_store_import_batch_content́",
        "t.Ünïcode_guard",
      ],
    });
  });

  it("reads a drop split by a comment, which Postgres still runs", () => {
    expect(
      droppedConstraints({
        sql: 'ALTER TABLE "t" DROP/*x*/CONSTRAINT "other_guard";\nALTER TABLE "t" DROP --x\nCONSTRAINT second_guard;\n-- x\rALTER TABLE "t" DROP CONSTRAINT after_cr;\n',
      }),
    ).toEqual({
      names: ["other_guard", "second_guard", "after_cr"],
      occurrences: 3,
      targets: ["t.other_guard", "t.second_guard", "t.after_cr"],
    });
  });

  it("reads a drop past a nested comment, and never takes a quoted comment marker for a comment", () => {
    expect(
      droppedConstraints({
        sql: [
          'ALTER TABLE "t" DROP /* outer /* inner */ still-outer */ CONSTRAINT "nested_guard";',
          'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK (note <> \'/*\'); ALTER TABLE "t" DROP CONSTRAINT after_literal;',
          "DO $x$ BEGIN PERFORM '*/'; END $x$; ALTER TABLE \"t\" DROP CONSTRAINT after_dollar; -- '",
          'DO $x1$ BEGIN NULL; END; -- $x1$; ALTER TABLE "t" DROP CONSTRAINT after_digit_tag;',
          "SELECT E'\\' -- '; ALTER TABLE \"t\" DROP CONSTRAINT after_escape;",
        ].join("\n"),
      }),
    ).toEqual({
      names: ["nested_guard", "after_literal", "after_dollar", "after_digit_tag", "after_escape"],
      occurrences: 5,
      targets: ["t.nested_guard", "t.after_literal", "t.after_dollar", "t.after_digit_tag", "t.after_escape"],
    });
  });

  it("knows a drop by its table, so a listed name dropped from another table is a different drop", () => {
    expect(
      droppedConstraints({
        sql: [
          'ALTER TABLE "store_import_question" DROP CONSTRAINT "uq_store_import_batch_content";',
          'ALTER TABLE "public"."store_import_batch" DROP CONSTRAINT "uq_store_import_batch_content";',
          'ALTER TABLE "store_import_batch" ADD COLUMN "x" text, DROP CONSTRAINT "uq_store_import_batch_content";',
          'ALTER TABLE "standing_ask" DROP CONSTRAINT "standing_ask_recorded_seq", ALTER COLUMN "x" DROP NOT NULL;',
          'ALTER TABLE "standing_ask" DROP CONSTRAINT "standing_ask_recorded_seq" CASCADE;',
          'ALTER TABLE ONLY "store_import_batch" DROP CONSTRAINT "uq_store_import_batch_content";',
          'ALTER TABLE IF EXISTS "store_import_batch" DROP CONSTRAINT "uq_store_import_batch_content";',
          'ALTER TABLE "store_import_batch" DROP CONSTRAINT IF EXISTS "uq_store_import_batch_content";',
          'ALTER TABLE only DROP CONSTRAINT "uq_store_import_batch_content";',
        ].join("\n"),
      }).targets,
    ).toEqual(["store_import_question.uq_store_import_batch_content"]);
  });

  it("reads a drop only in code, so one inside a literal is neither a target nor an occurrence", () => {
    const { names, occurrences, targets } = droppedConstraints({
      sql: [
        "SELECT 'ALTER TABLE victim DROP CONSTRAINT guard;';",
        'SELECT E\'ALTER TABLE "victim" DROP CONSTRAINT "guard";\';',
      ].join("\n"),
    });
    expect({ names, occurrences, targets }).toEqual({ names: [], occurrences: 0, targets: [] });
  });

  it("reads a statement after an inline breakpoint as the query drizzle sends, never as a comment", () => {
    const sql = [
      'ALTER TABLE "store_import_batch" ADD CONSTRAINT "uq_store_import_batch_plan" UNIQUE("id","plan_digest");',
      '--> statement-breakpoint ALTER TABLE "store_import_batch" DROP CONSTRAINT "uq_store_import_batch_plan";',
    ].join("");
    expect(droppedConstraints({ sql })).toEqual({
      names: ["uq_store_import_batch_plan"],
      occurrences: 1,
      targets: ["store_import_batch.uq_store_import_batch_plan"],
    });
  });

  it("counts a replacement only where the code adds it to the same table, never in a comment or a literal", () => {
    const add = { kind: "UNIQUE", name: "uq_store_import_batch_content_plan", table: "store_import_batch" };
    expect(
      [
        'ALTER TABLE "store_import_batch" ADD CONSTRAINT "uq_store_import_batch_content_plan" UNIQUE("a");',
        'ALTER TABLE "store_import_question" ADD CONSTRAINT "uq_store_import_batch_content_plan" UNIQUE("a");',
        '-- ALTER TABLE "store_import_batch" ADD CONSTRAINT "uq_store_import_batch_content_plan" UNIQUE("a");',
        'SELECT \'ALTER TABLE "store_import_batch" ADD CONSTRAINT "uq_store_import_batch_content_plan" UNIQUE\';',
      ].map((sql) => addsConstraint({ ...add, sql })),
    ).toEqual([true, false, false, false]);
  });

  it("finds every construct that could change the lexer, even inside a comment or a literal", () => {
    expect(
      unreadableConstructs({
        sql: [
          "/* Backslash_Quote */ SELECT 'set_config';",
          "SELECT 1 /* /* */ */; /* lead */ -- line",
          ' set U&"standard_conforming_string\\0073" = off;',
          "ALTER/* split */ROLE r SET x = 1; DO 'BEGIN END'; SELECT $tag$ x $tag$;",
          'ALTER TABLE "t" RENAME CONSTRAINT "a" TO "b";',
          'CREATE TEMP TABLE "standing_ask" ("x" int);',
        ].join("\n"),
      }),
    ).toEqual([
      "a lexer setting",
      "a Unicode escape",
      "set_config",
      "a database, role or system default",
      "a rename or a schema move",
      "a shadowing table or schema",
      "procedural code",
      "a dollar quote",
      "a SET or RESET statement",
    ]);
  });

  it("finds every call that runs SQL out of a string, each one on its own", () => {
    expect(
      [
        "CREATE EXTENSION IF NOT EXISTS dblink;",
        "SELECT dblink_exec('dbname=x', 'ALTER TABLE t DROP CONSTRAINT c;');",
        "SELECT query_to_xml('select 1', true, false, '');",
        "SELECT pg_catalog.\"query_to_xml\"('SELECT 1', true, false, '');",
        "SELECT * FROM ts_stat('SELECT v FROM t');",
        "SELECT ts_rewrite('a'::tsquery, 'SELECT t, s FROM aliases');",
        "COPY t FROM PROGRAM 'psql -c \"ALTER TABLE t DROP CONSTRAINT c\"';",
      ].map((sql) => unreadableConstructs({ sql })),
    ).toEqual([
      ["procedural code", "a call that runs SQL from a string"],
      ["a call that runs SQL from a string"],
      ["a call that runs SQL from a string"],
      ["a call that runs SQL from a string"],
      ["a call that runs SQL from a string"],
      ["a call that runs SQL from a string"],
      ["procedural code"],
    ]);
  });

  it("passes the plain DDL and DML a generator writes, a SET inside a statement included", () => {
    expect(
      unreadableConstructs({
        sql: [
          'UPDATE "content" c SET "author_id" = NULL;--> statement-breakpoint',
          'ALTER TABLE "t" ALTER COLUMN "x" SET NOT NULL; INSERT INTO "t" VALUES (1) ON CONFLICT DO NOTHING;',
          'ALTER TABLE "t" ADD CONSTRAINT "f" FOREIGN KEY ("p") REFERENCES "u"("id") ON DELETE set null; SELECT \'a$b\';',
          "SELECT 'call', \"do\", E'execute', 'rename', 'temp', 'schema' FROM t; -- do it, rename it\nDROP FUNCTION IF EXISTS f;",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("reads a quoted name as the name it spells, so a quoted pg_temp or rename is still found", () => {
    expect(
      [
        'CREATE TABLE "pg_temp"."store_import_batch" ("id" uuid);',
        'ALTER TABLE "t" "RENAME" CONSTRAINT "a" TO "b";',
        'CREATE "SCHEMA" "s";',
      ].map((sql) => unreadableConstructs({ sql })),
    ).toEqual([["a shadowing table or schema"], ["a rename or a schema move"], ["a shadowing table or schema"]]);
  });

  it("holds nothing that could change how a later statement lexes, so the reader above is Postgres's for every file", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(
      files
        .map((file) => ({ held: unreadableConstructs({ sql: file.sql }), name: file.name }))
        .filter((file) => file.held.length > 0),
    ).toEqual([]);
  });

  it("drops only the widened constraints, each replaced in the same file", () => {
    const dropping = files
      .map((file) => ({ name: file.name, sql: file.sql, ...droppedConstraints({ sql: file.sql }) }))
      .filter((file) => file.occurrences > 0);
    // Every DROP CONSTRAINT must yield a table and a name, so a form this reader cannot parse reddens rather than hides.
    expect(dropping.filter((file) => file.targets.length !== file.occurrences).map((file) => file.name)).toEqual([]);
    expect(dropping.map((file) => file.targets)).toEqual([
      ["memories.memories_lesson_facets"],
      ["home_file_import.home_file_import_witness_required"],
      [
        "store_import_batch.uq_store_import_batch_content",
        "standing_ask.standing_ask_recorded_seq",
        "store_import_question.store_import_question_kind",
        "store_import_resolution.store_import_resolution_action",
      ],
      ["singleton_register.singleton_register_known_id"],
      ["singleton_register.singleton_register_known_id"],
      ["published_page.published_page_kind"],
    ]);
    const replacements = [
      [{ kind: "CHECK", name: "memories_kind_facets", table: "memories" }],
      [{ kind: "CHECK", name: "home_file_import_witness_required", table: "home_file_import" }],
      [
        { kind: "UNIQUE", name: "uq_store_import_batch_content_plan", table: "store_import_batch" },
        { kind: "CHECK", name: "standing_ask_recorded_seq", table: "standing_ask" },
        { kind: "CHECK", name: "store_import_question_kind", table: "store_import_question" },
        { kind: "CHECK", name: "store_import_resolution_action", table: "store_import_resolution" },
      ],
      [{ kind: "CHECK", name: "singleton_register_known_id", table: "singleton_register" }],
      [{ kind: "CHECK", name: "singleton_register_known_id", table: "singleton_register" }],
      [{ kind: "CHECK", name: "published_page_kind", table: "published_page" }],
    ];
    expect(
      replacements.flatMap((adds, at) =>
        adds.filter((add) => !addsConstraint({ ...add, sql: dropping[at]!.sql })).map((add) => add.name),
      ),
    ).toEqual([]);
  });
});
