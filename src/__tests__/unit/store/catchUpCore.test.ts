/**
 * The door's catch-up decision, asserted without a database: which `behind` stores are applied at open and which
 * still refuse. The incident it closes is in `../../../store/catchUpCore.ts`'s header — `0042_tough_skin`, the
 * migration that bricked every boot, is read off disk here and must be caught up.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  admittedCallNames,
  catchUpDecision,
  caughtUpLine,
  migratorSelectionMismatch,
  nonAdditiveStatements,
  recordedTags,
} from "../../../store/catchUpCore.js";
import type { MigrationState } from "../../../store/lifecycleCore.js";

/** A `behind` classification, one migration pending — the shape the store read at the incident. */
const BEHIND: MigrationState = {
  applied: 42,
  foreignHashes: [],
  kind: "behind",
  pending: ["0042_tough_skin"],
  skipped: false,
};

/** The migration that started it, read from the committed tree. */
const INCIDENT_SQL = readFileSync(join(process.cwd(), "supabase", "migrations", "0042_tough_skin.sql"), "utf8");

describe("nonAdditiveStatements", () => {
  it("finds nothing in 0042_tough_skin, the six-table migration behind the outage", () => {
    expect(nonAdditiveStatements({ sql: INCIDENT_SQL, tag: "0042_tough_skin" })).toEqual([]);
  });

  it("names a DROP COLUMN by its tag and opening words", () => {
    const sql = 'CREATE TABLE "a" ("id" text);--> statement-breakpoint\nALTER TABLE "a" DROP COLUMN "old";';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual(['0099_x: ALTER TABLE "a" DROP COLUMN "old";']);
  });

  it("refuses an ADD that carries a later DROP in the same ALTER TABLE", () => {
    const sql = 'ALTER TABLE "a" ADD COLUMN "n" text, DROP COLUMN "o";';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([
      '0099_x: ALTER TABLE "a" ADD COLUMN "n" text, DROP COLUMN "o";',
    ]);
  });

  it("refuses an ADD carrying ANY second action, not only one that drops", () => {
    const sql = 'ALTER TABLE "accounts" ADD COLUMN "note" text, DISABLE ROW LEVEL SECURITY;';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([
      '0099_x: ALTER TABLE "accounts" ADD COLUMN "note" text, DISABLE ROW LEVEL SECURITY;',
    ]);
  });

  it("admits a composite foreign key and a comma inside a quoted name, neither a second action", () => {
    const sql =
      'ALTER TABLE "b" ADD CONSTRAINT "a,b_fk" FOREIGN KEY ("x","y") REFERENCES "public"."a"("x","y") ON DELETE cascade;';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([]);
  });

  it("admits a foreign key whose ON DELETE clause names a subtractive word inside the constraint", () => {
    const sql =
      'ALTER TABLE "b" ADD CONSTRAINT "fk" FOREIGN KEY ("a_id") REFERENCES "public"."a"("id") ON DELETE cascade ON UPDATE no action;';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([]);
  });

  it("refuses every shape off the allowlist — data writes, policy edits, drops", () => {
    const sql = [
      'DELETE FROM "a";',
      'UPDATE "a" SET "n" = 1;',
      'ALTER POLICY "p" ON "a" USING (true);',
      'DROP INDEX "i";',
      'ALTER TABLE "a" ALTER COLUMN "n" SET NOT NULL;',
    ].join("--> statement-breakpoint\n");
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toHaveLength(5);
  });

  it("refuses an additive head hiding a second statement with no breakpoint between them", () => {
    const sql = 'CREATE TABLE "catch_up_proof" ("id" integer); DROP TABLE "catch_up_proof";';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([
      '0099_x: CREATE TABLE "catch_up_proof" ("id" integer); DROP TABLE "catch_up_proof";',
    ]);
  });

  it("refuses a second statement on a later line of the same chunk", () => {
    const sql = 'CREATE INDEX "i" ON "a" ("n");\nDELETE FROM "a";\n';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual(['0099_x: CREATE INDEX "i" ON "a" ("n");']);
  });

  it("refuses a CREATE TABLE AS whose data-modifying CTE deletes rows", () => {
    const sql = 'CREATE TABLE "deleted_rows" AS WITH moved AS (DELETE FROM "victim" RETURNING *) SELECT * FROM moved;';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([
      '0099_x: CREATE TABLE "deleted_rows" AS WITH moved AS (DELETE FROM "victim" RETURNING *) ',
    ]);
  });

  it("refuses a plain CREATE TABLE AS SELECT, which copies rows at apply time", () => {
    const sql = 'CREATE TABLE "copy" AS SELECT * FROM "a";';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toHaveLength(1);
  });

  it("refuses every CREATE TABLE that fills itself from a query, VALUES, TABLE or EXECUTE included", () => {
    const shapes = [
      'CREATE TABLE "seeded" AS VALUES (1);',
      'CREATE TABLE "seeded" ("n") AS VALUES (1);',
      'CREATE TABLE "copy" AS TABLE "a";',
      'CREATE TABLE "run" AS EXECUTE "prepared";',
    ];
    expect(shapes.map((sql) => nonAdditiveStatements({ sql, tag: "0099_x" }).length)).toEqual([1, 1, 1, 1]);
  });

  it("admits a generated column, whose AS sits inside the column list", () => {
    const sql = 'CREATE TABLE "g" ("a" integer, "b" integer GENERATED ALWAYS AS ("a" + 1) STORED);';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([]);
  });

  it("reads a keyword-shaped column name or default as data, not as a row word", () => {
    const sql = 'CREATE TABLE "a" ("deleted" boolean DEFAULT false, "kind" text DEFAULT \'select\' NOT NULL);';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([]);
  });

  it("admits a policy whose predicate carries a subquery, because it runs on later reads, never at apply", () => {
    const sql =
      'CREATE POLICY "p" ON "b" AS PERMISSIVE FOR SELECT TO "bot" USING (EXISTS (SELECT 1 FROM "a" WHERE "a"."id" = "b"."a_id"));';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([]);
  });

  it("refuses a CHECK calling a function, which runs against every existing row at apply time", () => {
    const shapes = [
      'ALTER TABLE "target" ADD CONSTRAINT "c" CHECK (public.erase_sentinel());',
      'ALTER TABLE "target" ADD CONSTRAINT "c" CHECK ("public"."erase_sentinel"());',
      'ALTER TABLE "target" ADD CONSTRAINT "c" CHECK (erase_sentinel());',
      'ALTER TABLE "target" ADD COLUMN "n" boolean DEFAULT erase_sentinel() NOT NULL;',
    ].join("--> statement-breakpoint\n");
    expect(nonAdditiveStatements({ sql: shapes, tag: "0099_x" })).toHaveLength(4);
  });

  it("admits a CHECK and a DEFAULT built only from inert built-ins and sized types", () => {
    const sql = [
      'ALTER TABLE "a" ADD CONSTRAINT "c" CHECK (char_length("name") > 0 AND "kind" in (\'x\', \'y\'));',
      'ALTER TABLE "a" ADD COLUMN "at" timestamp (3) with time zone DEFAULT now() NOT NULL;',
      'ALTER TABLE "a" ADD COLUMN "amount" numeric(10, 2);',
    ].join("--> statement-breakpoint\n");
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([]);
  });

  it("refuses a call hidden from the text checks by a comment, a dollar quote or an escape string", () => {
    const shapes = [
      'ALTER TABLE "target" ADD COLUMN "n" boolean DEFAULT "public"."erase_sentinel"/*gap*/() NOT NULL;',
      'ALTER TABLE "target" ADD COLUMN "n" boolean DEFAULT "erase_sentinel"--gap\n() NOT NULL;',
      'ALTER TABLE "target" ADD COLUMN "n" text DEFAULT $$x$$ NOT NULL;',
      "ALTER TABLE \"target\" ADD COLUMN \"n\" text DEFAULT E'\\'' || erase_sentinel()::text || '' NOT NULL;",
      'ALTER TABLE "target" ADD CONSTRAINT U&"c" CHECK (true);',
      'ALTER TABLE "target" ADD COLUMN "n" text DEFAULT \'unterminated NOT NULL;',
    ].join("--> statement-breakpoint\n");
    expect(nonAdditiveStatements({ sql: shapes, tag: "0099_x" })).toHaveLength(6);
  });

  it("refuses a call whose bare name is not ASCII, which the call scanner cannot read", () => {
    const sql = 'ALTER TABLE "target" ADD CONSTRAINT "c" CHECK (函数());';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([
      '0099_x: ALTER TABLE "target" ADD CONSTRAINT "c" CHECK (函数());',
    ]);
  });

  it("admits a non-ASCII character inside a literal, which is data", () => {
    const sql = 'CREATE TABLE "a" ("n" text DEFAULT \'函数()\' NOT NULL);';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([]);
  });

  it("refuses a call sitting between two literals whose quotes a two-pass unquote would pair across it", () => {
    const sql = 'ALTER TABLE "target" ADD COLUMN "n" text DEFAULT \'x"\' || "erase_sentinel"() || \'"\' NOT NULL;';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([
      '0099_x: ALTER TABLE "target" ADD COLUMN "n" text DEFAULT \'x"\' || "erase_sentinel"() || \'',
    ]);
  });

  it("admits a regex CHECK whose literal carries a dollar sign and backslashes, as committed migrations do", () => {
    const sql = 'ALTER TABLE "a" ADD CONSTRAINT "c" CHECK ("n" ~ \'^[^\\s@]+$\' and strpos("n", chr(10)) = 0);';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([]);
  });

  it("refuses a call after a `--` line that sits inside a multi-line literal, which Postgres reads as data", () => {
    const sql =
      "ALTER TABLE \"target\" ADD COLUMN \"n\" text DEFAULT 'prefix\n-- suffix' || erase_sentinel() || '\nend' NOT NULL;";
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([
      '0099_x: ALTER TABLE "target" ADD COLUMN "n" text DEFAULT \'prefix',
    ]);
  });

  it("refuses a `--` comment line after the statement has begun, which no committed migration writes", () => {
    const sql = 'CREATE INDEX "i" ON "a"\n-- trailing note\n("n");';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" }).length).toBe(1);
  });

  it("refuses a constraint that adopts and renames an existing index with USING INDEX", () => {
    const sql = 'ALTER TABLE "victim" ADD CONSTRAINT "victim_key" UNIQUE USING INDEX "victim_uidx";';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([
      '0099_x: ALTER TABLE "victim" ADD CONSTRAINT "victim_key" UNIQUE USING INDEX "victim_uidx',
    ]);
  });

  it("refuses a type or table named like an array type, which renames the existing one out of the way", () => {
    const sql = [
      'CREATE TYPE "public"."_foo" AS ENUM(\'new\');',
      'CREATE TABLE IF NOT EXISTS _bar (\n\t"id" integer\n);',
      'CREATE TYPE "span" AS RANGE (subtype = integer, multirange_type_name = "_baz");',
      "CREATE TYPE public . _qux AS ENUM ('x');",
      'CREATE TABLE "s""x"."_quux" ("id" integer);',
      'CREATE TABLE s$x._corge ("id" integer);',
      'CREATE TABLE "schema AS (x"."_grault" ("id" integer);',
      'CREATE TYPE "public"."foo_kind" AS ENUM(\'ok\');',
    ].join("\n--> statement-breakpoint\n");
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([
      '0099_x: CREATE TYPE "public"."_foo" AS ENUM(\'new\');',
      "0099_x: CREATE TABLE IF NOT EXISTS _bar (",
      '0099_x: CREATE TYPE "span" AS RANGE (subtype = integer, multirange_type_name = "_baz");',
      "0099_x: CREATE TYPE public . _qux AS ENUM ('x');",
      '0099_x: CREATE TABLE "s""x"."_quux" ("id" integer);',
      '0099_x: CREATE TABLE s$x._corge ("id" integer);',
      '0099_x: CREATE TABLE "schema AS (x"."_grault" ("id" integer);',
    ]);
  });

  it("refuses every CREATE TYPE but an enum, since a base type fills in an existing shell type in place", () => {
    const sql = [
      "CREATE TYPE lower (INPUT = lower_in, OUTPUT = lower_out, INTERNALLENGTH = VARIABLE);",
      'CREATE TYPE "pair" AS ("a" integer, "b" integer);',
      'CREATE TYPE "x AS ENUM(" (INPUT = lower_in, OUTPUT = lower_out);',
      "CREATE TYPE lower;",
      'CREATE TYPE "public"."foo_kind" AS ENUM(\'ok\');',
      "CREATE TYPE plain_kind AS ENUM ('ok');",
    ].join("\n--> statement-breakpoint\n");
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([
      "0099_x: CREATE TYPE lower (INPUT = lower_in, OUTPUT = lower_out, INTERNALLENGTH = VARIAB",
      '0099_x: CREATE TYPE "pair" AS ("a" integer, "b" integer);',
      '0099_x: CREATE TYPE "x AS ENUM(" (INPUT = lower_in, OUTPUT = lower_out);',
      "0099_x: CREATE TYPE lower;",
    ]);
  });

  it("admits a column filled row by row, which keeps every existing value — 0027 adds a bigserial", () => {
    const sql = [
      'ALTER TABLE "grant_row" ADD COLUMN "seq" bigserial NOT NULL;',
      'ALTER TABLE "victim" ADD COLUMN "token" uuid DEFAULT gen_random_uuid() NOT NULL;',
    ].join("\n--> statement-breakpoint\n");
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([]);
  });

  it("skips a chunk that is only comments and whitespace", () => {
    const sql = '-- a header the generator never writes\n\n--> statement-breakpoint\nCREATE INDEX "i" ON "a" ("n");';
    expect(nonAdditiveStatements({ sql, tag: "0099_x" })).toEqual([]);
  });
});

describe("catchUpDecision", () => {
  it("applies a local, landed, additive behind store, naming what it applies", () => {
    expect(catchUpDecision({ local: true, nonAdditive: [], reachableCode: [], state: BEHIND, unlanded: [] })).toEqual({
      apply: true,
      pending: ["0042_tough_skin"],
    });
  });

  it("never touches a store that is not behind", () => {
    const foreign: MigrationState = { ...BEHIND, foreignHashes: ["abc"], kind: "foreign", pending: [] };
    expect(catchUpDecision({ local: true, nonAdditive: [], reachableCode: [], state: foreign, unlanded: [] })).toEqual({
      apply: false,
      why: "the database is foreign, and only a behind one is caught up",
    });
  });

  it("refuses a remote store before anything else is weighed", () => {
    expect(catchUpDecision({ local: false, nonAdditive: [], reachableCode: [], state: BEHIND, unlanded: [] })).toEqual({
      apply: false,
      why: "the store URL is not on this machine, and a remote database is never caught up",
    });
  });

  it("refuses a pending migration that has not landed, quoting why", () => {
    const unlanded = ["0042_tough_skin is not on origin/main"];
    expect(catchUpDecision({ local: true, nonAdditive: [], reachableCode: [], state: BEHIND, unlanded })).toEqual({
      apply: false,
      why: "not caught up, because a pending migration has not landed: 0042_tough_skin is not on origin/main",
    });
  });

  it("refuses a landed migration that does more than add, leaving it to store push", () => {
    const nonAdditive = ['0042_tough_skin: ALTER TABLE "a" DROP COLUMN "old";'];
    expect(catchUpDecision({ local: true, nonAdditive, reachableCode: [], state: BEHIND, unlanded: [] })).toEqual({
      apply: false,
      why: 'not caught up, because a pending migration does more than add, so `store push` applies it deliberately: 0042_tough_skin: ALTER TABLE "a" DROP COLUMN "old";',
    });
  });

  it("refuses while the store holds an operator, cast, domain or event trigger a statement could run unnamed", () => {
    const reachableCode = ["operator === (erase_sentinel)"];
    expect(catchUpDecision({ local: true, nonAdditive: [], reachableCode, state: BEHIND, unlanded: [] })).toEqual({
      apply: false,
      why: "not caught up, because the store holds code an additive statement could run without naming it, which this tree never installs: operator === (erase_sentinel)",
    });
  });
});

describe("admittedCallNames", () => {
  it("lists every name the call check admits, sorted, so the door's catalog read checks the same contract", () => {
    const names = admittedCallNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual(names.toSorted());
    expect(["btree", "lower", "now", "numeric"].filter((name) => !names.includes(name))).toEqual([]);
    expect(names.includes("erase_sentinel")).toBe(false);
  });
});

describe("caughtUpLine", () => {
  it("names every applied tag and the verb that reads the result", () => {
    expect(caughtUpLine({ pending: ["0042_tough_skin", "0043_next"] })).toBe(
      "store: caught up 0042_tough_skin, 0043_next before this read — landed on origin/main and additive, so the door applied it rather than refusing; `slopweaver store verify` reads the result",
    );
  });
});

describe("recordedTags", () => {
  it("names every judged tag when this process recorded them all", () => {
    expect(recordedTags({ judged: ["0042_b", "0043_c"], recorded: 2 })).toEqual(["0042_b", "0043_c"]);
  });

  it("names only the tail when a concurrent push recorded the head first", () => {
    expect(recordedTags({ judged: ["0042_b", "0043_c"], recorded: 1 })).toEqual(["0043_c"]);
  });

  it("names nothing when this process recorded nothing", () => {
    expect(recordedTags({ judged: ["0042_b", "0043_c"], recorded: 0 })).toEqual([]);
  });
});

describe("migratorSelectionMismatch", () => {
  const JOURNAL = [
    { hash: "h1", tag: "0001_a", when: 100 },
    { hash: "h2", tag: "0002_b", when: 200 },
    { hash: "h3", tag: "0003_c", when: 300 },
  ];

  it("finds nothing when the last recorded instant is the last applied entry's own when", () => {
    expect(migratorSelectionMismatch({ applied: 2, journal: JOURNAL, lastRecordedAt: 200 })).toEqual([]);
  });

  it("names a last instant earlier than its entry's, which would replay an entry nobody judged", () => {
    expect(migratorSelectionMismatch({ applied: 2, journal: JOURNAL, lastRecordedAt: 150 })).toEqual([
      "the ledger's last created_at is 150 where 0002_b's 200 was expected, so the migrator would choose its own set",
    ]);
  });

  it("names a last instant past a pending entry's when, which the migrator would skip", () => {
    expect(migratorSelectionMismatch({ applied: 2, journal: JOURNAL, lastRecordedAt: 300 })).toEqual([
      "the ledger's last created_at is 300 where 0002_b's 200 was expected, so the migrator would choose its own set",
    ]);
  });

  it("names an empty ledger, which the door never catches up", () => {
    expect(migratorSelectionMismatch({ applied: 0, journal: JOURNAL, lastRecordedAt: undefined })).toEqual([
      "the ledger's last created_at is no instant where none was expected, so the migrator would choose its own set",
    ]);
  });

  it("names an APPLIED entry whose when passes the boundary, which the migrator would replay unjudged", () => {
    const journal = [
      { hash: "h1", tag: "0001_a", when: 300 },
      { hash: "h2", tag: "0002_b", when: 200 },
      { hash: "h3", tag: "0003_c", when: 400 },
    ];

    expect(migratorSelectionMismatch({ applied: 2, journal, lastRecordedAt: 200 })).toEqual([
      "0002_b's when does not follow the entry before it, so the migrator would not apply the journal in order",
    ]);
  });

  it("names a pending entry whose when does not follow the one before it", () => {
    const journal = [...JOURNAL.slice(0, 2), { hash: "h3", tag: "0003_c", when: 200 }];

    expect(migratorSelectionMismatch({ applied: 2, journal, lastRecordedAt: 200 })).toEqual([
      "0003_c's when does not follow the entry before it, so the migrator would not apply the journal in order",
    ]);
  });

  it("finds nothing in this tree's own journal one entry behind, the incident shape", () => {
    const path = join(process.cwd(), "supabase", "migrations", "meta", "_journal.json");
    const { entries } = JSON.parse(readFileSync(path, "utf8")) as { entries: { tag: string; when: number }[] };
    const journal = entries.map((entry) => ({ hash: entry.tag, tag: entry.tag, when: entry.when }));

    expect(journal.length).toBeGreaterThan(1);
    expect(
      migratorSelectionMismatch({ applied: journal.length - 1, journal, lastRecordedAt: journal.at(-2)!.when }),
    ).toEqual([]);
  });
});
