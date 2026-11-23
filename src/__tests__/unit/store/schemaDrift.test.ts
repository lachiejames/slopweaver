/**
 * The store's closed vocabularies against the corpus unions they mirror, and against the DDL on disk.
 *
 * Two different failures live here and only one of them is a comparison of two lists.
 *
 * `content_kind` is BUILT from `CORPUS_KINDS`, so a kind the corpus can write and the store cannot hold
 * is unrepresentable rather than tested for. Asserting that the two agree would be a check that cannot
 * fail. `content_source` is a genuine subset — every corpus source except `gold`, which is synthesised at
 * query time and never persisted — so its agreement IS checkable, and it is checked below with the one
 * exclusion named as a value rather than expressed as a subset relation, so a second source going missing
 * reddens instead of widening the hole.
 *
 * What replaces the tautology is the check that actually has a failure mode: **the generated migration on
 * disk against the schema that generated it.** Generating a migration is a step a person runs, so a schema
 * change can land with the DDL still describing the previous shape — and every gate in this repository
 * would stay green, because nothing else reads the `.sql`. That file is what creates the database, so a
 * stale one means the tables do not have the columns the typed client is compiled against.
 *
 * MEASURED on the store's first commit, before it was pushed. The kind list was wrong in BOTH
 * directions at once — no word for `need`, `huddle` or `transcript`, so a Slack huddle and a Google Meet
 * transcript were both unstorable, and an `email` no connector has ever emitted. Reproduce the second half
 * with `grep -rhon 'kind: "[a-z]*"' src/corpus/gmail/`: the mailbox writes `message` and `transcript`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { CORPUS_KINDS } from "../../../corpus/types.js";
import { ALL_CORPUS_SOURCES, BRONZE_SOURCES } from "../../../integrations/corpusSources.js";
import { OWNER_JUDGEMENT_ORIGINS } from "../../../judgement/ownerJudgementRecords.js";
import { MEMORY_KINDS, type MemoryRecording, TRACE_OUTCOMES } from "../../../knowledge/memory.js";
import { LESSON_SURFACES, LESSON_TIERS, LESSON_VERDICTS } from "../../../knowledge/types.js";
import { STANDING_ASK_ORIGINS, STANDING_ASK_STATES } from "../../../profile/standingAskRecords.js";
import { STEER_MEASUREMENT_ORIGINS } from "../../../profile/steerMeasurementRecords.js";
import { enumValueStatements } from "../../../store/policies.js";
import { containerKindEnum, contentKindEnum, contentSourceEnum, visibilityEnum } from "../../../store/schema/enums.js";
import {
  MEMORY_TIER_VALUES,
  type MemoryRecordingRow,
  memoryKindEnum,
  memorySurfaceEnum,
  memoryTraceOutcomeEnum,
  memoryVerdictEnum,
} from "../../../store/schema/memories.js";
import { ownerJudgementOriginEnum } from "../../../store/schema/ownerJudgement.js";
import { standingAskOriginEnum, standingAskStateEnum } from "../../../store/schema/standingAsks.js";
import { steerMeasurementOriginEnum } from "../../../store/schema/steerMeasurements.js";
import * as storeSchema from "../../../store/schema.js";

/** The one corpus source with no bytes on disk, so no row in the store. */
const SYNTHETIC_SOURCE = "gold";

/**
 * Every table the schema barrel exports, by the name Postgres knows it as.
 *
 * DERIVED from the barrel rather than listed, and that is the whole point of it. The first version of the
 * assertion below named `person`, `container` and `content` as three literals, and a later slice added
 * five more tables without touching it — so it went on passing while checking three eighths of the store,
 * and a ninth table would have been just as invisible. A list that has to AGREE with another list is a
 * list that eventually will not.
 *
 * The barrel is the same module `drizzle.config.ts` points at, so a table drizzle-kit generates DDL for is
 * exactly a table this test demands DDL for. `is(value, PgTable)` rather than a duck-type check, because
 * the barrel also exports enums, statement builders and types, and only one of those has a table name.
 *
 * The witness was checked rather than assumed, because a coverage assertion that cannot fail is worse than
 * no assertion: rename `content_slack` in `src/store/schema/sourceRows.ts`, run this file, and it reddens
 * naming `content_slack_renamed` as missing from the DDL. Revert with `git checkout --` on that file.
 *
 * MEASURED, and it is why the loop below is not a `.filter().map()`: the first version used a
 * type predicate, vitest ran it green, and CI's `build` failed on `tsc` with TS2677 — the barrel's value
 * union is narrower than `PgTable<TableConfig>`, so the predicate is not assignable. `yarn validate:local`
 * does not typecheck, so `yarn tsc --noEmit -p tsconfig.json` is the command that catches this class.
 *
 * @returns every exported table's Postgres name, sorted
 */
function declaredTables(): readonly string[] {
  // `Object.values<unknown>` rather than the inferred union, and the reason is a real compile error rather
  // than taste: the barrel's value union is NARROWER than `PgTable<TableConfig>`, so a type predicate over
  // it is not assignable and `tsc` refuses it — while vitest, which strips types, runs the same file
  // happily. Widening to `unknown` first lets drizzle's own `is` do the narrowing it is built for.
  const names: string[] = [];
  for (const value of Object.values<unknown>(storeSchema)) {
    if (is(value, PgTable)) {
      names.push(getTableName(value));
    }
  }
  return names.toSorted();
}

/** Every generated migration's SQL, concatenated — the DDL that actually creates the database. */
function migrationSql(): string {
  const dir = join(process.cwd(), "supabase", "migrations");
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".sql"))
    .toSorted()
    .map((entry) => readFileSync(join(dir, entry), "utf8"))
    .join("\n");
}

describe("content sources mirror the corpus union", () => {
  it("stores every corpus source except the synthetic one", () => {
    const persisted = ALL_CORPUS_SOURCES.filter((source) => source !== SYNTHETIC_SOURCE);
    expect([...contentSourceEnum.enumValues].toSorted()).toEqual([...persisted].toSorted());
  });

  it("is the bronze list itself, in the enum's own order, so a derived reorder is a red test and never a migration", () => {
    expect(contentSourceEnum.enumValues).toEqual([...BRONZE_SOURCES]);
    expect(contentSourceEnum.enumValues).toEqual([
      "github",
      "slack",
      "linear",
      "notion",
      "self",
      "gmail",
      "calendar",
      "fathom",
      "chatgpt",
      "outlook-calendar",
    ]);
  });

  it("has no word for the source that is synthesised at query time", () => {
    expect(contentSourceEnum.enumValues).not.toContain(SYNTHETIC_SOURCE);
  });
});

describe("content kinds are the corpus union", () => {
  it("is the same value, so a kind the corpus writes cannot be one the store refuses", () => {
    expect(contentKindEnum.enumValues).toEqual([...CORPUS_KINDS]);
  });

  it("carries the three kinds a hand-written list had missed", () => {
    expect(contentKindEnum.enumValues).toContain("need");
    expect(contentKindEnum.enumValues).toContain("huddle");
    expect(contentKindEnum.enumValues).toContain("transcript");
  });
});

describe("the generated migration is not stale", () => {
  const sql = migrationSql();

  /**
   * Every label the apply will actually put into the database: the ones the migrations create the types
   * with, PLUS the ones the post-migration phase adds outside the migrator's transaction.
   *
   * The second half is not a widening of the test — it is where a widened enum now lives. A generated
   * `ALTER TYPE` is the shape the `drizzle-migrations` safety gate refuses, so `enumValueStatements`
   * carries it instead (`src/store/policies.ts`), and a test reading only the SQL files would report a
   * label missing from a database that will have it.
   */
  const appliedDdl = [sql, ...enumValueStatements()].join("\n");

  it("declares every content kind the schema does", () => {
    const missing = CORPUS_KINDS.filter((kind) => !appliedDdl.includes(`'${kind}'`));
    expect(missing).toEqual([]);
  });

  it("declares every content source the schema does", () => {
    const missing = contentSourceEnum.enumValues.filter((source) => !appliedDdl.includes(`'${source}'`));
    expect(missing).toEqual([]);
  });

  it("declares every visibility and container kind the schema does", () => {
    const declared = [...visibilityEnum.enumValues, ...containerKindEnum.enumValues];
    const missing = declared.filter((value) => !appliedDdl.includes(`'${value}'`));
    expect(missing).toEqual([]);
  });

  it("creates EVERY table the schema declares, however many that is", () => {
    const missing = declaredTables().filter((table) => !sql.includes(`CREATE TABLE "${table}"`));
    expect(missing).toEqual([]);
  });

  it("has tables to check, so the assertion above cannot pass by finding none", () => {
    expect(declaredTables().length).toBe(77);
  });

  it("knows the store's tables by their Postgres names", () => {
    expect(declaredTables()).toEqual([
      "atlas_coverage",
      "atlas_entity",
      "atlas_entity_channel",
      "atlas_gap",
      "atlas_kind_status",
      "authored_absent",
      "authored_body",
      "authored_file",
      "autonomy_event",
      "autonomy_register",
      "board_row",
      "cmux_event_state",
      "codex_fallback_receipt",
      "codex_fallback_request",
      "codex_fleet_cap",
      "codex_pass",
      "codex_sign_in_observation",
      "codex_supersession",
      "container",
      "content",
      "content_github",
      "content_linear",
      "content_notion",
      "content_slack",
      "door_event",
      "door_register",
      "fleet_config",
      "fleet_journal",
      "fleet_journal_event",
      "grant_row",
      "home_file_import",
      "knowledge_domain",
      "landing_press",
      "landing_read_cursor",
      "measurement_blob",
      "measurement_location",
      "memories",
      "memory_recalls",
      "org_health_acknowledgement",
      "org_health_incident",
      "org_health_sighting",
      "organisation",
      "owner_capture",
      "owner_correction",
      "owner_directive",
      "owner_profile",
      "owner_turn",
      "owner_turn_location",
      "owner_voice_register",
      "person",
      "person_link_candidate",
      "plan_register",
      "published_page",
      "published_page_alias",
      "published_page_blob",
      "published_page_file",
      "published_page_version",
      "run",
      "run_event",
      "singleton_register",
      "spend_merchant",
      "standing_ask",
      "standing_ask_coverage",
      "standing_ask_event",
      "steer_measurement",
      "store_import_application",
      "store_import_batch",
      "store_import_item",
      "store_import_part",
      "store_import_question",
      "store_import_resolution",
      "workstream",
      "workstream_entry",
      "workstream_link",
      "workstream_milestone",
      "workstream_milestone_after",
      "workstream_register_meta",
    ]);
  });
});

describe("the memories table's vocabularies against the unions they mirror", () => {
  // These three are spelled TWICE on purpose — `src/store/schema/memories.ts` says why, and the reason is a
  // measured gate failure rather than a preference. A second list is a list that eventually disagrees, so
  // the agreement is asserted here: `satisfies` in that file stops a TYPO compiling, and these stop a
  // MISSING member shipping, which is the half a type cannot see.
  it("spells every verdict the register can record", () => {
    expect(memoryVerdictEnum.enumValues).toEqual([...LESSON_VERDICTS]);
  });

  it("spells every surface the register can record", () => {
    expect(memorySurfaceEnum.enumValues).toEqual([...LESSON_SURFACES]);
  });

  it("spells every tier, so the CHECK bound cannot be left behind by a widened ladder", () => {
    expect([...MEMORY_TIER_VALUES]).toEqual([...LESSON_TIERS]);
  });

  it("spells every memory kind, the trace included", () => {
    expect(memoryKindEnum.enumValues).toEqual([...MEMORY_KINDS]);
  });

  it("spells every trace outcome", () => {
    expect(memoryTraceOutcomeEnum.enumValues).toEqual([...TRACE_OUTCOMES]);
  });
});

describe("the owner-judgement origins against the domain's list", () => {
  // Spelled twice — the schema does not import the judgement domain — so the agreement is asserted here, and a
  // writer the domain names that the store cannot hold fails this rather than an insert.
  it("spells every writer a version can name, store-import included", () => {
    expect(ownerJudgementOriginEnum.enumValues).toEqual([...OWNER_JUDGEMENT_ORIGINS]);
  });
});

describe("the standing-ask states and origins against the domain's lists", () => {
  // Spelled twice for the same reason: the schema does not import the profile domain.
  it("spells every state a generation can stand in, inactive included", () => {
    expect(standingAskStateEnum.enumValues).toEqual([...STANDING_ASK_STATES]);
  });

  it("spells every writer a generation or an event can name, store-import included", () => {
    expect(standingAskOriginEnum.enumValues).toEqual([...STANDING_ASK_ORIGINS]);
  });
});

describe("the steer-measurement origins against the domain's list", () => {
  it("spells every writer a measurement can name, store-import included", () => {
    expect(steerMeasurementOriginEnum.enumValues).toEqual([...STEER_MEASUREMENT_ORIGINS]);
  });
});

describe("the concrete recording shape against what an insert actually takes", () => {
  // `src/knowledge/memory.ts` spells `MemoryRecording` out instead of using `$inferInsert`, because that
  // inferred type breaks the `named-object-params` gate — its header carries the measurement. The cost of
  // spelling it is that a column rename would stop being a compile error at every call site, so the link is
  // restored HERE, against the SELECT type: `$inferSelect` is a plain concrete shape with none of the
  // `SQL`-placeholder union that makes the insert type unwalkable, and it names the same columns. The two
  // assignments are the compile-time check; the runtime assertion only keeps the test from passing as a
  // no-op. Rename a column and this stops compiling.
  it("names exactly the table's own columns, generated ones aside", () => {
    const recording: MemoryRecording = {
      behaviourChange: "check the sample rate first",
      caveat: null,
      claim: "APM adaptive sampling sits upstream of retention filters",
      domain: "datadog",
      evidence: "0 of 412 traces over 7d",
      id: "l-abc",
      importKey: null,
      kind: "lesson",
      learner: "fleet",
      outcome: null,
      question: null,
      recordedAt: new Date("2026-09-12T10:00:00.000Z"),
      recordingId: "a0000075-0000-4000-8000-000000000081",
      repro: null,
      retrievalCue: "a datadog tracing task",
      run: "ad-hoc",
      seq: 1,
      supersedes: null,
      surface: "api",
      tier: 2,
      verdict: "confirmed",
    };
    // One direction only: `tier` is `smallint`, so the table's own type is `number | null` while this one
    // narrows to the four-value ladder. The narrowing is deliberate, so the reverse assignment is expected
    // to fail and a rename or a dropped column still breaks this one.
    // `createdAt` and `seq` are database-assigned on a fresh write and only SET on a restore, so they are
    // optional here and required there; `tier` narrows from `number` to the four-value ladder. Everything
    // else must match exactly, so a rename or a dropped column still breaks this.
    const fromTable: Omit<MemoryRecordingRow, "createdAt" | "searchable" | "seq" | "tier"> = recording;
    expect(fromTable.id).toBe("l-abc");
  });
});
