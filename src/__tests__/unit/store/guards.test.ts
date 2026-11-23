/**
 * The store's guards, asserted without a database.
 *
 * These are the statements least likely to be read again once they work, and the ones whose failure is
 * silent: a policy set that stopped covering `content` would not break a query, it would let a private
 * message reach Slack. So they are pinned here as pure values rather than only exercised against a live
 * Postgres — a test that needed a running database would not run in this lane at all, which is precisely
 * how a guard stops being checked.
 *
 * The behaviour of the SQL itself was verified against Postgres 15 and is recorded in the
 * modules' own headers; what this file protects is that the right statements are still GENERATED.
 *
 * ## Where the policies moved, and why these assertions follow them into the DDL
 *
 * The policies are declared inside the drizzle tables
 * now, so they are emitted by `drizzle-kit` into `supabase/migrations/` rather than assembled by a
 * function here. The properties worth protecting did not change — the bot is still narrowed on the one
 * table with a private lane, the agent still has no write policy — so those assertions read the EMITTED
 * SQL instead of a statement list. That is strictly stronger: a statement list is what a function
 * intends, and the DDL is what the database will actually have.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { declaredEnums } from "../../../store/declared.js";
import { firstLineOf, postMigrationStatements, preMigrationStatements } from "../../../store/migrate.js";
import {
  enumValueStatements,
  storeExtensionStatements,
  storeRoleStatements,
  storeTableGrantStatements,
  storeTables,
  tablesNarrowedThroughParent,
  tablesOwnerMayInsert,
  tablesWithPrivateLane,
} from "../../../store/policies.js";
import { STORE_ROLES } from "../../../store/schema/enums.js";
import {
  IMPORT_STAGING_IMMUTABLE_STATEMENTS,
  IMPORT_STAGING_TRIGGERS,
  missingStagingTriggers,
} from "../../../store/schema/importStaging.js";
import {
  hasSourceRowTable,
  SOURCE_ROW_PRESENCE_STATEMENTS,
  SOURCE_ROW_PRESENCE_TRIGGER,
  SOURCES_WITH_ROW_TABLE,
} from "../../../store/schema/sourceRows.js";
import {
  STEER_MEASUREMENT_IMMUTABLE_STATEMENTS,
  STEER_MEASUREMENT_TRIGGERS,
} from "../../../store/schema/steerMeasurements.js";

/**
 * Every migration's SQL, concatenated in apply order — what the database will actually have.
 *
 * Read rather than reconstructed, for the reason this file's header gives: a statement list is what a
 * function intends and the DDL is what gets applied, and after the B1 move only one of those two is
 * still the thing worth protecting.
 */
function migrationSql(): string {
  const dir = join(process.cwd(), "supabase", "migrations");
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".sql"))
    .toSorted()
    .map((entry) => readFileSync(join(dir, entry), "utf8"))
    .join("\n");
}

describe("per-source tables", () => {
  it("names the four sources that carry a table of their own", () => {
    expect([...SOURCES_WITH_ROW_TABLE]).toEqual(["github", "linear", "notion", "slack"]);
  });

  it("narrows a source that has a table", () => {
    expect(hasSourceRowTable("slack")).toBe(true);
  });

  it("does not narrow a source with no table, which is how a mailbox row skips the presence check", () => {
    expect(hasSourceRowTable("gmail")).toBe(false);
  });

  it("emits the function, the drop and the trigger, in that order", () => {
    expect(SOURCE_ROW_PRESENCE_STATEMENTS.length).toBe(3);
    expect(SOURCE_ROW_PRESENCE_STATEMENTS[0]!.includes("create or replace function content_source_row_present()")).toBe(
      true,
    );
    expect(SOURCE_ROW_PRESENCE_STATEMENTS[1]!.includes(`drop trigger if exists ${SOURCE_ROW_PRESENCE_TRIGGER}`)).toBe(
      true,
    );
    expect(
      SOURCE_ROW_PRESENCE_STATEMENTS[2]!.includes(`create constraint trigger ${SOURCE_ROW_PRESENCE_TRIGGER}`),
    ).toBe(true);
  });

  it("defers the check to commit, without which the content insert would fail before its side row exists", () => {
    expect(SOURCE_ROW_PRESENCE_STATEMENTS[2]!.includes("deferrable initially deferred")).toBe(true);
  });

  it("exempts every source with no table, naming them in the function rather than in a caller", () => {
    const guard = SOURCE_ROW_PRESENCE_STATEMENTS[0]!;
    const named = SOURCES_WITH_ROW_TABLE.filter((source) => guard.includes(`'${source}'`));
    expect([...named]).toEqual([...SOURCES_WITH_ROW_TABLE]);
  });
});

describe("row-level security", () => {
  it("creates exactly the three ruled roles, each with the grant that makes it assumable", () => {
    expect(storeRoleStatements().length).toBe(6);
    expect([...STORE_ROLES]).toEqual(["slopweaver_owner", "slopweaver_bot", "slopweaver_agent"]);
  });

  it("grants every role back to the connecting user with SET, without which nothing can assume one", () => {
    const granted = STORE_ROLES.filter((role) =>
      storeRoleStatements().some((statement) => statement.includes(`grant ${role} to %I with inherit false, set true`)),
    );
    expect([...granted]).toEqual([...STORE_ROLES]);
  });

  it("grants no role by inheritance, so a connection wears one hat rather than all three", () => {
    const inheriting = storeRoleStatements().filter((statement) => statement.includes("with inherit true"));
    expect(inheriting).toEqual([]);
  });

  it("enables row level security on every table the store declares, in the emitted DDL", () => {
    const enabled = storeTables().filter((table) =>
      migrationSql().includes(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`),
    );
    expect(enabled).toEqual(storeTables());
  });

  it("grants schema usage, without which every role sees nothing and no policy is consulted", () => {
    expect(storeTableGrantStatements()).toContain(
      "grant usage on schema public to slopweaver_owner, slopweaver_bot, slopweaver_agent",
    );
  });

  it("grants select on every table the store declares, after the migration created them", () => {
    const granted = storeTables().filter((table) =>
      storeTableGrantStatements().includes(
        `grant select on ${table} to slopweaver_owner, slopweaver_bot, slopweaver_agent`,
      ),
    );
    expect(granted).toEqual(storeTables());
  });

  it("narrows the bot to public rows on the table with a private lane", () => {
    expect(migrationSql()).toContain(
      `CREATE POLICY "content_bot_read" ON "content" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (visibility = 'public')`,
    );
  });

  it("names content as the one table carrying a private lane in a column of its own", () => {
    expect(tablesWithPrivateLane()).toEqual(["content"]);
  });

  it("names the four per-source tables as narrowed through their parent, derived from the source list", () => {
    expect(tablesNarrowedThroughParent()).toEqual([
      "content_github",
      "content_linear",
      "content_notion",
      "content_slack",
    ]);
  });

  it("correlates every per-source bot policy on the parent row's visibility, in the LAST statement that sets it", () => {
    // A composite foreign key carries no row-level security across, so `true` on a side table let the bot
    // read every private message's channel and counts (MEASURED, `schema/rls.ts`). The last
    // CREATE or ALTER of each policy in apply order is what the database ends up with, so that is what
    // is pinned — a later migration that quietly relaxed it back would fail here.
    const parentLane = "USING (exists (select 1 from content c where c.id = content_id and c.visibility = 'public'))";
    const finalPredicates = tablesNarrowedThroughParent().map((table) => {
      const statements = migrationSql()
        .split("\n")
        .filter((line) => line.includes(`POLICY "${table}_bot_read" ON "${table}"`));
      return { carriesParentLane: statements.at(-1)!.includes(parentLane), table };
    });
    expect(finalPredicates).toEqual(tablesNarrowedThroughParent().map((table) => ({ carriesParentLane: true, table })));
  });

  it("declares a policy for every per-source table, without which nobody could read one", () => {
    const covered = SOURCES_WITH_ROW_TABLE.filter((source) =>
      migrationSql().includes(`ALTER TABLE "content_${source}" ENABLE ROW LEVEL SECURITY`),
    );
    expect([...covered]).toEqual([...SOURCES_WITH_ROW_TABLE]);
  });

  it("leaves the bot unnarrowed on a table with no private lane", () => {
    expect(migrationSql()).toContain(
      `CREATE POLICY "person_bot_read" ON "person" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true)`,
    );
  });

  it("gives the owner every operation rather than select alone", () => {
    expect(migrationSql()).toContain(
      `CREATE POLICY "content_owner_all" ON "content" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true)`,
    );
  });

  it("grants the read-only agent select and declares no write policy for it", () => {
    const agentWrites = migrationSql()
      .split("\n")
      .filter((line) => line.includes(`TO "slopweaver_agent"`) && line.includes("FOR ALL"));
    expect(agentWrites).toEqual([]);
  });

  it("emits three policies per table, so a table cannot arrive carrying fewer", () => {
    const created = migrationSql()
      .split("\n")
      .filter((line) => line.startsWith("CREATE POLICY"));
    expect(created.length).toBe(storeTables().length * 3);
  });
});

describe("what the grants and enum labels are derived from", () => {
  it("grants select on every table the BARREL declares, sorted, rather than a hand list", () => {
    // No count here on purpose: a literal would have to be edited every time a table lands or is retired,
    // which is the drift this derivation removed. What matters is that the set comes from the barrel and
    // that the two callers of it agree on order.
    expect(storeTables()).toEqual([...storeTables()].toSorted());
    expect(storeTables()).toContain("content");
    expect(storeTables()).toContain("memories");
  });

  it("names only declared tables as owner-insertable, so a retired table cannot keep a phantom grant", () => {
    const declared = new Set(storeTables());
    expect(tablesOwnerMayInsert().every((table) => declared.has(table))).toBe(true);
    expect(tablesOwnerMayInsert()).toEqual(["memories", "memory_recalls"]);
  });

  it("emits an add-value statement for every label of every declared enum, the memory and link vocabularies included", () => {
    const statements = enumValueStatements();
    expect(
      statements.some((statement) =>
        statement.startsWith("alter type memory_verdict add value if not exists 'refuted'"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.startsWith("alter type person_link_status add value if not exists 'rejected'"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.startsWith("alter type memory_kind add value if not exists 'preference'"),
      ),
    ).toBe(true);
    // The trace label reaches an existing database HERE, never through its migration.
    expect(
      statements.some((statement) => statement.startsWith("alter type memory_kind add value if not exists 'trace'")),
    ).toBe(true);
    // Derived rather than typed: a new enum in the barrel must reach this loop, and a hand-kept number
    // here would only ever record that somebody remembered to raise it.
    expect(new Set(statements.map((statement) => statement.split(" ")[2])).size).toBe(declaredEnums().length);
  });
});

describe("the apply loop's three phases", () => {
  it("creates the extensions and then the roles BEFORE the migration, because every policy in it names a role", () => {
    expect(preMigrationStatements()).toEqual([...storeExtensionStatements(), ...storeRoleStatements()]);
  });

  it("creates pg_trgm FIRST and no other extension, because pgvector is out of the schema", () => {
    const extensions = preMigrationStatements().filter((statement) => statement.includes("create extension"));
    expect(extensions).toEqual(["create extension if not exists pg_trgm"]);
    expect(preMigrationStatements()[0]).toBe("create extension if not exists pg_trgm");
  });

  it("declares no pgvector column anywhere in the migration history a fresh install replays", () => {
    // Word-boundary, deliberately: `tsvector` CONTAINS `vector`, and `content.searchable` is the kept
    // full-text column. A substring test here would fail on the one thing the schema kept.
    expect(/\bvector\s*\(/.test(migrationSql())).toBe(false);
    expect(migrationSql().includes("tsvector")).toBe(true);
  });

  it("grants nothing before the migration, because a grant on a table that does not exist fails", () => {
    const grants = preMigrationStatements().filter((statement) => statement.startsWith("grant select"));
    expect(grants).toEqual([]);
  });

  it("installs the presence trigger before any grant, so a guard never follows the access it guards", () => {
    const statements = postMigrationStatements();
    const trigger = statements.findIndex((s) => s.includes("create constraint trigger"));
    const firstGrant = statements.findIndex((s) => s.startsWith("grant "));
    expect(trigger).toBeGreaterThan(-1);
    expect(firstGrant).toBeGreaterThan(trigger);
  });

  it("composes exactly the enum labels, both triggers' statements and the grants", () => {
    expect(postMigrationStatements().length).toBe(
      enumValueStatements().length +
        SOURCE_ROW_PRESENCE_STATEMENTS.length +
        IMPORT_STAGING_IMMUTABLE_STATEMENTS.length +
        STEER_MEASUREMENT_IMMUTABLE_STATEMENTS.length +
        storeTableGrantStatements().length,
    );
  });

  it("names exactly the steer-measurement triggers: no row changed or removed, the table never truncated", () => {
    expect(STEER_MEASUREMENT_TRIGGERS.map((trigger) => [trigger.table, trigger.name])).toEqual([
      ["steer_measurement", "trg_steer_measurement_kept"],
      ["steer_measurement", "trg_steer_measurement_no_truncate"],
    ]);
  });

  it("replaces every steer-measurement trigger and enables it ALWAYS in one statement, after its function and before any grant", () => {
    expect(STEER_MEASUREMENT_TRIGGERS.length).toBeGreaterThan(0);
    const statements = postMigrationStatements();
    const firstGrant = statements.findIndex((s) => s.startsWith("grant "));
    const fn = statements.findIndex((s) =>
      s.startsWith(
        "create or replace function public.steer_measurement_kept() returns trigger language plpgsql set search_path = '' as $$",
      ),
    );
    expect(fn).toBeGreaterThan(-1);
    const misplaced = STEER_MEASUREMENT_TRIGGERS.filter((trigger) => {
      const create = statements.findIndex(
        (s) =>
          s.startsWith("do $$ begin") &&
          s.includes(`create or replace trigger ${trigger.name} ${trigger.fires};`) &&
          s.includes(`alter table public.${trigger.table} enable always trigger ${trigger.name};`),
      );
      return !(create > fn && create < firstGrant);
    });
    expect(misplaced).toEqual([]);
  });

  it("names exactly the staging triggers: answers and receipts frozen, a batch sealed and whole, rows never updated, nothing truncated, nothing written in replica mode", () => {
    expect(IMPORT_STAGING_TRIGGERS.map((trigger) => trigger.name)).toEqual([
      "trg_store_import_resolution_immutable",
      "trg_store_import_application_immutable",
      "trg_store_import_part_sealed",
      "trg_store_import_item_sealed",
      "trg_store_import_question_sealed",
      "trg_store_import_batch_unchanged",
      "trg_store_import_part_unchanged",
      "trg_store_import_item_unchanged",
      "trg_store_import_question_unchanged",
      "trg_store_import_batch_answered_kept",
      "trg_store_import_part_whole",
      "trg_store_import_item_whole",
      "trg_store_import_question_whole",
      "trg_store_import_batch_no_truncate",
      "trg_store_import_part_no_truncate",
      "trg_store_import_item_no_truncate",
      "trg_store_import_question_no_truncate",
      "trg_store_import_resolution_no_truncate",
      "trg_store_import_application_no_truncate",
      "trg_store_import_batch_keys_enforced",
      "trg_store_import_part_keys_enforced",
      "trg_store_import_item_keys_enforced",
      "trg_store_import_question_keys_enforced",
      "trg_store_import_resolution_keys_enforced",
      "trg_store_import_application_keys_enforced",
    ]);
  });

  it("guards the application receipt with a function of its own that refuses every update and delete", () => {
    const trigger = IMPORT_STAGING_TRIGGERS.find((one) => one.name === "trg_store_import_application_immutable")!;
    expect(trigger.fires).toBe(
      "before update or delete on public.store_import_application for each row execute function public.store_import_application_immutable()",
    );
    expect(
      IMPORT_STAGING_IMMUTABLE_STATEMENTS.filter((s) =>
        s.startsWith("create or replace function public.store_import_application_immutable()"),
      ).length,
    ).toBe(1);
  });

  it("replaces every staging trigger and enables it ALWAYS in one statement, after every function and before any grant", () => {
    expect(IMPORT_STAGING_TRIGGERS.length).toBeGreaterThan(0);
    const statements = postMigrationStatements();
    const firstGrant = statements.findIndex((s) => s.startsWith("grant "));
    const lastFunction = statements.findLastIndex((s) =>
      s.startsWith("create or replace function public.store_import_"),
    );
    expect(lastFunction).toBeGreaterThan(-1);
    const misplaced = IMPORT_STAGING_TRIGGERS.filter((trigger) => {
      const create = statements.findIndex(
        (s) =>
          s.startsWith("do $$ begin") &&
          s.includes(`create or replace trigger ${trigger.name} ${trigger.fires};`) &&
          s.includes(`alter table public.${trigger.table} enable always trigger ${trigger.name};`),
      );
      return !(create > lastFunction && create < firstGrant);
    });
    expect(misplaced).toEqual([]);
  });

  it("runs every staging guard function on an empty search_path, naming each table public., so no temporary table shadows one", () => {
    const functions = IMPORT_STAGING_IMMUTABLE_STATEMENTS.filter((s) => s.startsWith("create or replace function"));
    expect(functions.length).toBeGreaterThan(0);
    expect(functions.filter((s) => !s.includes("language plpgsql set search_path = '' as $$"))).toEqual([]);
    expect(functions.filter((s) => /\b(from|join)\s+(?!public\.)\w/.test(s))).toEqual([]);
  });

  it("names every staging function and table public. in the install, so the apply's search_path cannot redirect a guard", () => {
    expect(IMPORT_STAGING_TRIGGERS.length).toBeGreaterThan(0);
    const unqualified = IMPORT_STAGING_TRIGGERS.filter(
      (trigger) =>
        !new RegExp(
          `^before [a-z ]+ on public\\.${trigger.table} for each (row|statement) execute function public\\.store_import_\\w+\\(\\)$`,
        ).test(trigger.fires),
    );
    expect(unqualified).toEqual([]);
    const functions = IMPORT_STAGING_IMMUTABLE_STATEMENTS.filter((s) => s.startsWith("create or replace function"));
    expect(functions.filter((s) => !s.startsWith("create or replace function public.store_import_"))).toEqual([]);
  });

  it("never drops a staging trigger, which would leave a window with no guard", () => {
    expect(IMPORT_STAGING_TRIGGERS.length).toBeGreaterThan(0);
    const names = IMPORT_STAGING_TRIGGERS.map((trigger) => trigger.name);
    const drops = postMigrationStatements().filter(
      (s) => s.startsWith("drop trigger") && names.some((name) => s.includes(name)),
    );
    expect(drops).toEqual([]);
  });

  it("finds no staging trigger missing from a store that reports every one enabled", () => {
    expect(IMPORT_STAGING_TRIGGERS.length).toBeGreaterThan(0);
    const installed = [{ name: "trg_unrelated", table: "content" }, ...IMPORT_STAGING_TRIGGERS];
    expect(missingStagingTriggers({ installed })).toEqual([]);
  });

  it("names every staging trigger a store lacks, as an apply that never reached its guard phase leaves it", () => {
    expect(missingStagingTriggers({ installed: [] })).toEqual(IMPORT_STAGING_TRIGGERS.map((trigger) => trigger.name));
  });

  it("counts a staging trigger's name on another table as missing, since a trigger is named per table", () => {
    const installed = IMPORT_STAGING_TRIGGERS.map((trigger) =>
      trigger.name === "trg_store_import_item_unchanged" ? { ...trigger, table: "store_import_question" } : trigger,
    );
    expect(missingStagingTriggers({ installed })).toEqual(["trg_store_import_item_unchanged"]);
  });

  it("widens every enum BEFORE any trigger or grant, because a label a guard reads must already exist", () => {
    const statements = postMigrationStatements();
    const lastEnum = statements.findLastIndex((s) => s.startsWith("alter type "));
    const firstTrigger = statements.findIndex((s) => s.includes("create constraint trigger"));
    expect(lastEnum).toBeGreaterThan(-1);
    expect(firstTrigger).toBeGreaterThan(lastEnum);
  });

  it("adds every declared label idempotently, so a re-apply is a no-op rather than a duplicate-value error", () => {
    const notIdempotent = enumValueStatements().filter((s) => !s.includes("add value if not exists"));
    expect(notIdempotent).toEqual([]);
  });

  it("carries the two labels the recorded-call source needed", () => {
    expect(enumValueStatements()).toContain("alter type content_source add value if not exists 'fathom'");
    expect(enumValueStatements()).toContain("alter type container_kind add value if not exists 'recorder'");
  });

  it("installs the presence trigger before any grant too", () => {
    const statements = postMigrationStatements();
    const trigger = statements.findIndex((s) => s.includes(`create constraint trigger ${SOURCE_ROW_PRESENCE_TRIGGER}`));
    const firstGrant = statements.findIndex((s) => s.startsWith("grant "));
    expect(trigger).toBeGreaterThan(-1);
    expect(firstGrant).toBeGreaterThan(trigger);
  });
});

describe("a driver failure is printed as its first line only", () => {
  it("keeps the first line and drops the statement and parameters under it", () => {
    const error = new Error('relation "content" does not exist\ninsert into content values ($1)\n[secret]');
    expect(firstLineOf({ error })).toBe('relation "content" does not exist');
  });

  it("prints a message opening on a line break as the empty first line it is", () => {
    expect(firstLineOf({ error: new Error("\ninsert into content values ($1)") })).toBe("");
  });

  it("caps a single long line at 300 characters", () => {
    expect(firstLineOf({ error: new Error("x".repeat(301)) })).toBe(`${"x".repeat(300)}…`);
  });
});
