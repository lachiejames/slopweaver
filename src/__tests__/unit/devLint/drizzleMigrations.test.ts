/**
 * The drizzle-migrations gate's three checks, over hand-built inputs and over this repository's own
 * migrations.
 *
 * Every check here is asserted in both directions, because a gate that reports clean is indistinguishable
 * from a gate that cannot fail — nine instances of that class stand in this repository's history, and the
 * one that started this slice was a coverage assertion comparing a literal list of three table names to
 * itself. So each `describe` below pairs "it stays quiet on a correct input" with "it fires on the exact
 * defect it exists for", and the second half is the one that matters.
 *
 * The witnesses were also checked against the REAL gate, not only against these functions.
 * Reproduce: rename `content_slack` in `src/store/schema/sourceRows.ts` and run
 * `yarn tsx src/devLint/drizzleMigrations.entry.ts` — it names `content_slack_renamed` as missing from
 * the DDL; revert and it goes green.
 */
import { describe, expect, it } from "vitest";
import {
  barrelViolations,
  driftViolations,
  expectedPolicies,
  type JournalEntry,
  journalFileMismatches,
  journalOrderViolations,
  MIGRATIONS_DIRNAME,
  migrationViolations,
  readMigrationSet,
  rlsViolations,
  tablesMissingFromMigrations,
  unsafeStatements,
} from "../../../devLint/drizzleMigrations.js";
import { declaredEnums, declaredTableNames, declaredTablePolicies } from "../../../store/declared.js";

/** One journal entry, so a test names only the field it is about. */
function entry({ idx, tag, when }: { idx: number; tag: string; when: number }): JournalEntry {
  return { idx, tag, when };
}

describe("coverage: a declared table with no CREATE TABLE", () => {
  it("reports nothing when every declared table is created", () => {
    const missing = tablesMissingFromMigrations({
      declared: ["person", "content"],
      sql: 'CREATE TABLE "person" (id uuid);\nCREATE TABLE "content" (id uuid);',
    });
    expect(missing).toEqual([]);
  });

  it("names the table the schema declares and no migration creates", () => {
    const missing = tablesMissingFromMigrations({
      declared: ["person", "atlas_entity"],
      sql: 'CREATE TABLE "person" (id uuid);',
    });
    expect(missing).toEqual(["atlas_entity"]);
  });

  it("does not report a table the SQL creates and the schema no longer declares, which a drop makes normal", () => {
    const missing = tablesMissingFromMigrations({
      declared: ["person"],
      sql: 'CREATE TABLE "person" (id uuid);\nCREATE TABLE "retired" (id uuid);',
    });
    expect(missing).toEqual([]);
  });

  it("matches on the quoted name, so a table whose name is a prefix of another is not covered by it", () => {
    const missing = tablesMissingFromMigrations({
      declared: ["content"],
      sql: 'CREATE TABLE "content_slack" (id uuid);',
    });
    expect(missing).toEqual(["content"]);
  });
});

describe("journal order: two branches that both generated a migration", () => {
  it("reports nothing when index and timestamp both increase", () => {
    const violations = journalOrderViolations({
      entries: [entry({ idx: 0, tag: "a", when: 100 }), entry({ idx: 1, tag: "b", when: 200 })],
    });
    expect(violations).toEqual([]);
  });

  it("names an entry generated before the one it is ordered after", () => {
    const violations = journalOrderViolations({
      entries: [entry({ idx: 0, tag: "a", when: 200 }), entry({ idx: 1, tag: "b", when: 100 })],
    });
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("b was generated at 100");
  });

  it("names a repeated index, which is what a merge keeping both sides produces", () => {
    const violations = journalOrderViolations({
      entries: [entry({ idx: 3, tag: "a", when: 100 }), entry({ idx: 3, tag: "b", when: 200 })],
    });
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("b has idx 3");
  });

  it("reports both axes when both are wrong on the same entry", () => {
    const violations = journalOrderViolations({
      entries: [entry({ idx: 5, tag: "a", when: 500 }), entry({ idx: 2, tag: "b", when: 100 })],
    });
    expect(violations.length).toBe(2);
  });

  it("reports nothing for a single entry, which cannot be out of order with anything", () => {
    expect(journalOrderViolations({ entries: [entry({ idx: 0, tag: "a", when: 1 })] })).toEqual([]);
  });

  it("reports nothing for an empty journal", () => {
    expect(journalOrderViolations({ entries: [] })).toEqual([]);
  });
});

describe("journal files: a migration that is never applied, and one that cannot be found", () => {
  it("reports nothing when the journal and the directory agree", () => {
    expect(journalFileMismatches({ fileTags: ["a", "b"], journalTags: ["a", "b"] })).toEqual([]);
  });

  it("names a file on disk the journal does not list, because it is never applied", () => {
    const mismatches = journalFileMismatches({ fileTags: ["a", "b"], journalTags: ["a"] });
    expect(mismatches.length).toBe(1);
    expect(mismatches[0]).toContain("b.sql is on disk but not in the journal");
  });

  it("names an entry with no file, because the migrator throws on it at apply time", () => {
    const mismatches = journalFileMismatches({ fileTags: ["a"], journalTags: ["a", "b"] });
    expect(mismatches.length).toBe(1);
    expect(mismatches[0]).toContain("the journal names b");
  });
});

describe("safety: statements Postgres refuses inside one transaction", () => {
  it("reports nothing on ordinary DDL", () => {
    expect(unsafeStatements({ sql: 'CREATE TABLE "person" (id uuid);', tag: "0000_x" })).toEqual([]);
  });

  it("names an enum value added and then usable only in a later transaction", () => {
    const unsafe = unsafeStatements({ sql: `ALTER TYPE "content_kind" ADD VALUE 'huddle';`, tag: "0003_x" });
    expect(unsafe.length).toBe(1);
    expect(unsafe[0]).toContain("a new enum value cannot be used in the transaction that added it");
  });

  it("names a dropped type", () => {
    const unsafe = unsafeStatements({ sql: `DROP TYPE "public"."old_kind";`, tag: "0004_x" });
    expect(unsafe.length).toBe(1);
    expect(unsafe[0]).toContain("dropping a type");
  });

  it("names a concurrent index, which cannot run in a transaction block at all", () => {
    const unsafe = unsafeStatements({ sql: 'CREATE INDEX CONCURRENTLY "i" ON "person" (id);', tag: "0005_x" });
    expect(unsafe.length).toBe(1);
    expect(unsafe[0]).toContain("CONCURRENTLY cannot run inside a transaction block");
  });

  it("reports one finding per offending statement rather than one per file", () => {
    const unsafe = unsafeStatements({
      sql: `ALTER TYPE "a" ADD VALUE 'x';--> statement-breakpoint\nALTER TYPE "b" ADD VALUE 'y';`,
      tag: "0006_x",
    });
    expect(unsafe.length).toBe(2);
  });

  it("does not match across a statement boundary, so two harmless statements are not read as one", () => {
    const unsafe = unsafeStatements({
      sql: `ALTER TYPE "a" OWNER TO postgres;--> statement-breakpoint\nSELECT 'ADD VALUE';`,
      tag: "0007_x",
    });
    expect(unsafe).toEqual([]);
  });
});

describe("this repository's own migrations", () => {
  const set = readMigrationSet({ dir: MIGRATIONS_DIRNAME });

  it("has migrations to check at all, so this suite cannot pass by finding nothing", () => {
    expect(set.files.length).toBeGreaterThan(0);
  });

  it("has a journal, so the apply order is recorded rather than implied by file names", () => {
    expect(set.journalPresent).toBe(true);
  });

  it("has one journal entry per migration file", () => {
    expect(set.entries.length).toBe(set.files.length);
  });

  /** The barrel-derived inputs a clean run carries, so a case can vary ONE axis. */
  const clean = {
    barrel: { barrelEnums: [], barrelTables: [], modules: [] },
    drift: { after: [], before: [] },
    rls: [],
  };

  it("passes every check against the ten tables the store declares", () => {
    const violations = migrationViolations({ ...clean, declaredTables: declaredTableNames(), set });
    expect(violations).toEqual([]);
  });

  it("checks the tables the barrel actually declares, so the case above cannot pass on an empty list", () => {
    // A COUNT rather than a number, and the point is only that it is not zero: a coverage check over an
    // empty list passes by finding nothing, which is the one way the case above could be vacuous.
    expect(declaredTableNames().length).toBeGreaterThan(0);
    expect(declaredTableNames()).toContain("content");
  });

  it("fires on a table the schema would declare and no migration creates", () => {
    // A name no migration will ever carry. It used to be `atlas_entity`, which stopped being absent the
    // day the atlas landed in the store — a fixture naming a plausible FUTURE table is a fixture with an
    // expiry date on it.
    const violations = migrationViolations({ ...clean, declaredTables: ["not_a_table_this_repo_will_have"], set });
    expect(violations.length).toBe(1);
    expect(violations[0]?.check).toBe("coverage");
  });

  it("fires on a schema change drizzle-kit would emit a migration for", () => {
    const violations = migrationViolations({
      ...clean,
      declaredTables: declaredTableNames(),
      drift: { after: ["0000_a.sql", "0007_new.sql"], before: ["0000_a.sql"] },
      set,
    });
    expect(violations.map((violation) => violation.check)).toEqual(["drift"]);
    expect(violations[0]?.message).toContain("0007_new.sql");
    expect(violations[0]?.message).toContain("slopweaver store push");
  });

  it("passes the RLS check on the schema's own tables, read through drizzle's config", () => {
    const rls = declaredTablePolicies().map((declared) => ({
      policies: declared.policies.map((policy) => ({
        for: policy.for,
        name: policy.name,
        to: typeof policy.to === "object" && policy.to !== null && "name" in policy.to ? policy.to.name : undefined,
      })),
      rlsEnabled: declared.rlsEnabled,
      table: declared.table,
    }));
    expect(rls.length).toBe(declaredTableNames().length);
    expect(rlsViolations({ tables: rls })).toEqual([]);
  });
});

describe("the row-level-security check", () => {
  it("names the three policies a table must carry", () => {
    expect(expectedPolicies({ table: "widget" })).toEqual([
      { for: "all", name: "widget_owner_all", to: "slopweaver_owner" },
      { for: "select", name: "widget_agent_read", to: "slopweaver_agent" },
      { for: "select", name: "widget_bot_read", to: "slopweaver_bot" },
    ]);
  });

  it("fires on a table with no policies at all, once for RLS and once per missing policy", () => {
    const out = rlsViolations({ tables: [{ policies: [], rlsEnabled: false, table: "widget" }] });
    expect(out.length).toBe(4);
    expect(out[0]).toBe('"widget" does not enable row level security — spread storeTablePolicies() into its extras');
    expect(out[1]).toBe('"widget" is missing policy widget_owner_all for all to slopweaver_owner');
  });

  it("fires on an EXTRA policy, because a fourth one can widen the bot's read", () => {
    const out = rlsViolations({
      tables: [
        {
          policies: [
            ...expectedPolicies({ table: "widget" }),
            { for: "insert", name: "widget_bot_write", to: "slopweaver_bot" },
          ],
          rlsEnabled: true,
          table: "widget",
        },
      ],
    });
    expect(out).toEqual(['"widget" carries an undeclared policy widget_bot_write for insert to slopweaver_bot']);
  });

  it("prints `?` for an operation and a role a policy left unset", () => {
    const out = rlsViolations({
      tables: [
        {
          policies: [...expectedPolicies({ table: "widget" }), { for: undefined, name: "widget_open", to: undefined }],
          rlsEnabled: true,
          table: "widget",
        },
      ],
    });
    expect(out).toEqual(['"widget" carries an undeclared policy widget_open for ? to ?']);
  });

  it("fires on a policy pointed at the wrong role, as one missing and one undeclared", () => {
    const wrong = expectedPolicies({ table: "widget" }).map((policy) =>
      policy.name === "widget_bot_read" ? { ...policy, to: "slopweaver_agent" } : policy,
    );
    const out = rlsViolations({ tables: [{ policies: wrong, rlsEnabled: true, table: "widget" }] });
    expect(out).toEqual([
      '"widget" is missing policy widget_bot_read for select to slopweaver_bot',
      '"widget" carries an undeclared policy widget_bot_read for select to slopweaver_agent',
    ]);
  });
});

describe("the barrel check", () => {
  it("fires on a table or enum a module declares and the barrel does not export", () => {
    const out = barrelViolations({
      barrelEnums: ["content_kind"],
      barrelTables: ["content"],
      modules: [
        { enums: ["content_kind", "orphan_kind"], file: "src/store/schema/x.ts", tables: ["content", "orphan"] },
      ],
    });
    expect(out).toEqual([
      'src/store/schema/x.ts declares table "orphan" and src/store/schema.ts does not export it',
      'src/store/schema/x.ts declares enum "orphan_kind" and src/store/schema.ts does not export it',
    ]);
  });

  it("passes when every declaration is exported", () => {
    const out = barrelViolations({
      barrelEnums: ["content_kind"],
      barrelTables: ["content"],
      modules: [{ enums: ["content_kind"], file: "src/store/schema/x.ts", tables: ["content"] }],
    });
    expect(out).toEqual([]);
  });

  it("exports every table and enum the schema modules declare, on this tree", () => {
    const tables = declaredTableNames();
    const enums = declaredEnums()
      .map((enumeration) => enumeration.enumName)
      .toSorted();
    expect(tables).toContain("content");
    expect(enums).toEqual([
      "atlas_coverage_state",
      "atlas_entity_state",
      "atlas_evidence_role",
      "autonomy_entry",
      "board_kind",
      "board_origin",
      "board_priority",
      "board_settlement",
      "board_status",
      "container_kind",
      "content_kind",
      "content_source",
      "data_class",
      "door_provenance",
      "judgement_instruction_state",
      "memory_kind",
      "memory_surface",
      "memory_trace_outcome",
      "memory_verdict",
      "owner_judgement_origin",
      "person_link_status",
      "recall_outcome",
      "run_phase",
      "standing_ask_origin",
      "standing_ask_state",
      "steer_measurement_origin",
      "visibility",
      "workstream_entry_kind",
      "workstream_kind",
      "workstream_link_kind",
      "workstream_status",
      "workstream_workspace",
    ]);
  });
});

describe("the drift check", () => {
  it("names each file the generate added and nothing it kept", () => {
    expect(driftViolations({ after: ["0000_a.sql", "0001_b.sql"], before: ["0000_a.sql"] })).toEqual([
      "the schema has changed and no committed migration carries it — drizzle-kit would emit 0001_b.sql",
    ]);
  });

  it("is silent when the generate added nothing", () => {
    expect(driftViolations({ after: ["0000_a.sql"], before: ["0000_a.sql"] })).toEqual([]);
  });
});
