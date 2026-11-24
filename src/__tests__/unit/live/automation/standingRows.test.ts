// The team-repository cases moved to teamStandingRows.test.ts with the template that replaced these rows.
// The Monday Slack row's case went with it; its daily local-page successor is standingFleetCeilingRow.test.ts.
// The daily publication audit row's cases are standingPublicationAuditRow.test.ts.
// The shipped inbox rows' own cases went with the rows; an install declares its own.
// The weekly value-sample row's case is standingValueSampleRow.test.ts.
import { describe, expect, it } from "vitest";

import { DEFAULT_BACKUP_CADENCE } from "../../../../cli/commands/store/backupCore.js";
import { unwrap } from "../../../../lib/result.js";
import { parseRecipeDefinition, RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../live/automation/definition.js";
import { runShapeForDefinition, runShapeForKind } from "../../../../live/automation/definitionShape.js";
import {
  ALIGNMENT_BRIEFING_KIND,
  BUMP_FIX_KIND,
  ERROR_TRACKING_BATCH_KIND,
  HYGIENE_SWEEP_KIND,
  INBOX_TRIAGE_KIND,
  LINEAR_BRIEFING_KIND,
  OWED_REPLY_KIND,
  THREAD_CHASE_KIND,
} from "../../../../live/automation/kinds.js";
import { ALIGNMENT_BRIEFING_WEEKDAY } from "../../../../live/automation/standingAlignmentBriefingRows.js";
import { THREAD_CHASE_DAILY } from "../../../../live/automation/standingChaseRows.js";
import { LINEAR_BRIEFING_DAILY } from "../../../../live/automation/standingLinearBriefingRows.js";
import { CONTEXT_COST_WEEKLY, TOKEN_PASS_WEEKLY } from "../../../../live/automation/standingMeasurementRows.js";
import { MEETING_PREP_HOURLY } from "../../../../live/automation/standingMeetingPrepRows.js";
import { SLACK_OWED_DAILY } from "../../../../live/automation/standingOwedRows.js";
import { ownRepositoryStandingRows } from "../../../../live/automation/standingOwnRepositoryRows.js";
import type { StandingRow } from "../../../../live/automation/standingRow.js";
import { absentStandingRowLine, absentStandingRows } from "../../../../live/automation/standingRowAbsence.js";
import { GENERIC_STANDING_ROWS } from "../../../../live/automation/standingRows.js";
import {
  REHEARSAL_RECIPE_ID,
  STORE_IMPORT_FLEET_NIGHTLY,
  STORE_RESTORE_REHEARSAL,
} from "../../../../live/automation/standingStoreRows.js";
import { planVerbRun, VERB_RUN_KIND } from "../../../../live/automation/verbRun.js";

/** One declared row, built from the real shape rather than a partial. */
const row = ({ recipeId, why }: { recipeId: string; why: string }): StandingRow => ({
  definition: {
    cadence: "0 4 * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: { argv: ["worktree", "prune", "--apply"] },
    recipeId,
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  },
  why,
});

const PRUNE = row({ recipeId: "worktree-prune", why: "nothing else removes a worktree" });
const DIGEST = row({ recipeId: "alerts-digest", why: "nobody sees the overnight alerts" });

describe("GENERIC_STANDING_ROWS", () => {
  it("declares at least one row, so every guard below is over a non-empty registry", () => {
    expect(GENERIC_STANDING_ROWS.length).toBeGreaterThan(0);
  });

  it("declares only rows this build's own reader accepts — every kind registered, no effect past its kind", () => {
    const refused = GENERIC_STANDING_ROWS.filter((declared) =>
      parseRecipeDefinition({ value: declared.definition }).isErr(),
    );
    expect(refused.map((declared) => declared.definition.recipeId)).toEqual([]);
  });

  it("requires both weekly measurement passes, the token pass half an hour after the context check", () => {
    expect(GENERIC_STANDING_ROWS).toContain(CONTEXT_COST_WEEKLY);
    expect(GENERIC_STANDING_ROWS).toContain(TOKEN_PASS_WEEKLY);
    expect([CONTEXT_COST_WEEKLY.definition.cadence, TOKEN_PASS_WEEKLY.definition.cadence]).toEqual([
      "0 5 * * 1",
      "30 5 * * 1",
    ]);
    expect(TOKEN_PASS_WEEKLY.definition.params).toEqual({
      argv: ["session", "spend", "--days", "7", "--finding", "--record-reading", "recipe:token-pass-weekly"],
    });
  });

  it("names no team repository, no person's login and no organisation's Renovate actor in any generic row", () => {
    const named = GENERIC_STANDING_ROWS.filter((declared) => {
      const text = JSON.stringify(declared.definition);
      return text.includes("acme-admin") || text.includes("--author") || text.includes("--renovate-author");
    }).map((declared) => declared.definition.recipeId);
    expect(named).toEqual([]);
  });

  it("declares no error-tracking batch, which only a registered team repository declares, and no top-up", () => {
    const kinds = GENERIC_STANDING_ROWS.filter(
      (declared) =>
        declared.definition.kind === ERROR_TRACKING_BATCH_KIND || declared.definition.recipeId.includes("topup"),
    ).map((declared) => declared.definition.recipeId);
    expect(kinds).toEqual([]);
  });

  it("requires the weekday thread chase, seated, unheld, and reading slack awaiting as its worklist", () => {
    expect(GENERIC_STANDING_ROWS).toContain(THREAD_CHASE_DAILY);
    expect(runShapeForKind({ kind: THREAD_CHASE_KIND })).toBe("spawn");
    expect(THREAD_CHASE_DAILY.definition).toEqual({
      cadence: "30 9 * * 1-5",
      destination: { kind: "local-atlas" },
      effect: "read",
      enabled: true,
      kind: THREAD_CHASE_KIND,
      onMissed: "skip",
      params: { argv: ["slack", "awaiting", "--write"] },
      recipeId: "thread-chase-daily",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    });
  });

  it("runs the thread chase's own read, and refuses its argv drifted to a verb that sends", () => {
    expect(planVerbRun({ definition: THREAD_CHASE_DAILY.definition }).isOk()).toBe(true);
    const drifted = planVerbRun({
      definition: { ...THREAD_CHASE_DAILY.definition, params: { argv: ["slack", "post", "--as", "me"] } },
    });
    expect(drifted._unsafeUnwrapErr().code).toBe("EFFECT_EXCEEDS_ROW");
  });

  it("requires no inbox row of every install: whether, and when, mail is triaged or cleared is the install's", () => {
    const inbox = GENERIC_STANDING_ROWS.filter((declared) => {
      const argv = JSON.stringify(declared.definition.params);
      return declared.definition.kind === INBOX_TRIAGE_KIND || argv.includes('"gmail"');
    }).map((declared) => declared.definition.recipeId);
    expect(inbox).toEqual([]);
  });

  /** An install's own inbox row, as its definition file would declare it. */
  const installRow = ({ argv, effect, kind }: { argv: string[]; effect: string; kind: string }) =>
    unwrap(
      parseRecipeDefinition({
        value: {
          cadence: "0 9 * * *",
          destination: { kind: "local-atlas" },
          effect,
          enabled: true,
          kind,
          onMissed: "skip",
          params: { argv },
          recipeId: "inbox-example",
          schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
        },
      }),
    );

  it("still reads an install's own inbox triage row, seated, and refuses its argv drifted to a mailbox change", () => {
    const triage = installRow({ argv: ["gmail", "triage", "--write"], effect: "read", kind: INBOX_TRIAGE_KIND });
    expect(runShapeForKind({ kind: INBOX_TRIAGE_KIND })).toBe("spawn");
    expect(planVerbRun({ definition: triage }).isOk()).toBe(true);
    const drifted = planVerbRun({ definition: { ...triage, params: { argv: ["gmail", "archive", "m-1"] } } });
    expect(drifted._unsafeUnwrapErr().code).toBe("EFFECT_EXCEEDS_ROW");
  });

  it("still reads an install's own meeting-notes clear, a verb run whose archive only read-write covers", () => {
    const clear = installRow({ argv: ["gmail", "clear-meeting-notes"], effect: "read-write", kind: VERB_RUN_KIND });
    expect(unwrap(planVerbRun({ definition: clear })).verbEffect).toBe("external-write");
    const narrowed = planVerbRun({ definition: { ...clear, effect: "read" } });
    expect(narrowed._unsafeUnwrapErr().code).toBe("EFFECT_EXCEEDS_ROW");
  });

  it("requires the hourly meeting prep, a verb run whose calendar read and board rows `read` covers", () => {
    expect(GENERIC_STANDING_ROWS).toContain(MEETING_PREP_HOURLY);
    expect(MEETING_PREP_HOURLY.definition).toEqual({
      cadence: "5 * * * *",
      destination: { kind: "local-atlas" },
      effect: "read",
      enabled: true,
      kind: VERB_RUN_KIND,
      onMissed: "skip",
      params: { argv: ["calendar", "prep-due"] },
      recipeId: "meeting-prep-hourly",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    });
    expect(unwrap(planVerbRun({ definition: MEETING_PREP_HOURLY.definition })).verbEffect).toBe("local-state");
    const drifted = planVerbRun({
      definition: { ...MEETING_PREP_HOURLY.definition, params: { argv: ["gmail", "archive", "m-1"] } },
    });
    expect(drifted._unsafeUnwrapErr().code).toBe("EFFECT_EXCEEDS_ROW");
  });

  it("requires the daily Linear briefing, seated, unheld, and reading a verified cycle reconcile", () => {
    expect(GENERIC_STANDING_ROWS).toContain(LINEAR_BRIEFING_DAILY);
    expect(runShapeForKind({ kind: LINEAR_BRIEFING_KIND })).toBe("spawn");
    expect(LINEAR_BRIEFING_DAILY.definition).toEqual({
      cadence: "30 17 * * *",
      destination: { kind: "local-atlas" },
      effect: "read",
      enabled: true,
      kind: LINEAR_BRIEFING_KIND,
      onMissed: "skip",
      params: { argv: ["cycle", "reconcile", "--verify", "--write"] },
      recipeId: "linear-briefing-daily",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    });
  });

  it("runs the Linear briefing's own read, and refuses its argv drifted to a verb that writes Linear", () => {
    expect(planVerbRun({ definition: LINEAR_BRIEFING_DAILY.definition }).isOk()).toBe(true);
    const drifted = planVerbRun({
      definition: {
        ...LINEAR_BRIEFING_DAILY.definition,
        params: { argv: ["linear", "comment", "create", "--form", "-"] },
      },
    });
    expect(drifted._unsafeUnwrapErr().code).toBe("EFFECT_EXCEEDS_ROW");
  });

  it("requires the weekday alignment briefing, seated, unheld, and reading every ask waiting on the owner", () => {
    expect(GENERIC_STANDING_ROWS).toContain(ALIGNMENT_BRIEFING_WEEKDAY);
    expect(runShapeForKind({ kind: ALIGNMENT_BRIEFING_KIND })).toBe("spawn");
    expect(ALIGNMENT_BRIEFING_WEEKDAY.definition).toEqual({
      cadence: "0 8 * * 1-5",
      destination: { kind: "local-atlas" },
      effect: "read",
      enabled: true,
      kind: ALIGNMENT_BRIEFING_KIND,
      onMissed: "skip",
      params: { argv: ["handover", "currency", "--json"] },
      recipeId: "alignment-briefing-weekday",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    });
  });

  it("runs the alignment briefing's own read, and refuses its argv drifted to a verb that posts as the owner", () => {
    expect(unwrap(planVerbRun({ definition: ALIGNMENT_BRIEFING_WEEKDAY.definition })).verbEffect).toBe("external-read");
    const drifted = planVerbRun({
      definition: {
        ...ALIGNMENT_BRIEFING_WEEKDAY.definition,
        params: { argv: ["slack", "post", "--as", "me"] },
      },
    });
    expect(drifted._unsafeUnwrapErr().code).toBe("EFFECT_EXCEEDS_ROW");
  });

  it("requires the hourly worktree prune, on both repos, applying and stepping aside for a running apply", () => {
    const prune = GENERIC_STANDING_ROWS.find((declared) => declared.definition.recipeId === "worktree-prune")!;
    expect(prune.definition.enabled).toBe(true);
    expect(prune.definition.cadence).toBe("0 * * * *");
    expect(prune.definition.effect).toBe("read-write");
    expect(prune.definition.params).toEqual({ argv: ["worktree", "prune", "--apply", "--if-idle"] });
  });

  it("names no --repo, so the row inherits the verb's own sweep across every declared main checkout", () => {
    const prune = GENERIC_STANDING_ROWS.find((declared) => declared.definition.recipeId === "worktree-prune")!;
    const argv = (prune.definition.params as { argv: readonly string[] }).argv;
    expect(argv.includes("--repo")).toBe(false);
    expect(argv.includes("--older-than")).toBe(false);
  });

  it("requires the daily self-improvement mine, writing the report the friction gauge reads", () => {
    const mine = GENERIC_STANDING_ROWS.find((declared) => declared.definition.recipeId === "self-improvement")!;
    expect(mine.definition.enabled).toBe(true);
    expect(mine.definition.cadence).toBe("30 6 * * *");
    expect(mine.definition.effect).toBe("read-write");
    expect(mine.definition.kind).toBe(VERB_RUN_KIND);
    expect(mine.definition.params).toEqual({ argv: ["reflect", "brief", "--write"] });
  });

  it("skips a missed self-improvement slot rather than backfilling, because the miner windows off now", () => {
    const mine = GENERIC_STANDING_ROWS.find((declared) => declared.definition.recipeId === "self-improvement")!;
    expect(mine.definition.onMissed).toBe("skip");
  });

  it("names no window or cap on the mine, so the row inherits the miner's own defaults", () => {
    const mine = GENERIC_STANDING_ROWS.find((declared) => declared.definition.recipeId === "self-improvement")!;
    const argv = (mine.definition.params as { argv: readonly string[] }).argv;
    expect(argv.includes("--from")).toBe(false);
    expect(argv.includes("--to")).toBe(false);
    expect(argv.includes("--cap")).toBe(false);
  });

  it("requires the weekly context-cost check, on --alert so a regression FAILS the row rather than reading as a quiet week", () => {
    const check = GENERIC_STANDING_ROWS.find((declared) => declared.definition.recipeId === "context-cost-weekly")!;
    expect(check.definition.cadence).toBe("0 5 * * 1");
    expect(check.definition.onMissed).toBe("skip");
    expect(check.definition.effect).toBe("read-write");
    expect(check.definition.params).toEqual({
      argv: ["session", "compaction", "--days", "7", "--alert", "--record-reading", "recipe:context-cost-weekly"],
    });
  });

  it("requires the weekly token pass, half an hour after the context-cost check, posting only through --finding", () => {
    const pass = GENERIC_STANDING_ROWS.find((declared) => declared.definition.recipeId === "token-pass-weekly")!;
    expect(pass.definition.cadence).toBe("30 5 * * 1");
    expect(pass.definition.onMissed).toBe("skip");
    expect(pass.definition.effect).toBe("read-write");
    expect(pass.definition.params).toEqual({
      argv: ["session", "spend", "--days", "7", "--finding", "--record-reading", "recipe:token-pass-weekly"],
    });
  });

  it("requires the daily compaction, lossless — no --older-than, which would delete records on a schedule", () => {
    const compact = GENERIC_STANDING_ROWS.find((declared) => declared.definition.recipeId === "compact-corpus-daily")!;
    expect(compact.definition.enabled).toBe(true);
    expect(compact.definition.cadence).toBe("30 2 * * *");
    expect(compact.definition.onMissed).toBe("skip");
    expect(compact.definition.effect).toBe("read-write");
    expect(compact.definition.params).toEqual({ argv: ["compact", "run"] });
  });

  it("leaves alert-findings-push undeclared — it is dead on purpose", () => {
    const ids = GENERIC_STANDING_ROWS.map((declared) => declared.definition.recipeId);
    expect(ids.includes("alert-findings-push")).toBe(false);
  });
});

describe("the two rows on this install's own repository", () => {
  const [drive, fix] = ownRepositoryStandingRows({ repository: "acme/slopweaver", supersededRepositories: [] });

  it("requires the four-hourly dependency-bump drive, naming the repository it may act on", () => {
    expect(drive!.definition.recipeId).toBe("bump-drive-slopweaver");
    expect(drive!.definition.enabled).toBe(true);
    expect(drive!.definition.cadence).toBe("0 */4 * * *");
    expect(drive!.definition.effect).toBe("read-write");
    expect(drive!.definition.onMissed).toBe("skip");
    expect(drive!.definition.params).toEqual({
      argv: ["github", "bump-drive", "--repo", "acme/slopweaver"],
    });
  });

  it("names its own repository and nothing else, because this row stays off a team repository", () => {
    const argv = (drive!.definition.params as { argv: readonly string[] }).argv;
    expect(argv.filter((entry) => entry.includes("acme-admin"))).toEqual([]);
    expect(argv.includes("--limit")).toBe(false);
  });

  it("requires the daily bump-fix seat, at 08:15 local, reading a worklist that writes nothing", () => {
    expect(fix!.definition).toEqual({
      cadence: "15 8 * * *",
      destination: { kind: "local-atlas" },
      effect: "read-write",
      enabled: true,
      kind: BUMP_FIX_KIND,
      onMissed: "skip",
      params: { argv: ["github", "bump-drive", "--repo", "acme/slopweaver", "--dry-run"] },
      recipeId: "bump-fix-slopweaver",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    });
  });

  it("plans the bump-fix row through the verb-run planner onto the real bump-drive verb, and seats it", () => {
    const plan = planVerbRun({ definition: fix!.definition });
    expect(plan.isOk()).toBe(true);
    expect([unwrap(plan).noun, unwrap(plan).verb]).toEqual(["github", "bump-drive"]);
    expect(runShapeForDefinition({ definition: fix!.definition })).toBe("spawn");
  });
});

describe("absentStandingRows", () => {
  it("reports a declared row the store does not hold", () => {
    const absent = absentStandingRows({ declared: [PRUNE], existing: [] });
    expect(absent).toEqual([{ recipeId: "worktree-prune", why: "nothing else removes a worktree" }]);
  });

  it("reports nothing when every declared row is in the store", () => {
    const absent = absentStandingRows({ declared: [PRUNE], existing: [PRUNE.definition] });
    expect(absent).toEqual([]);
  });

  it("reports nothing for an empty declaration, whatever the store holds", () => {
    expect(absentStandingRows({ declared: [], existing: [PRUNE.definition] })).toEqual([]);
  });

  it("leaves a row whose file is present but UNREADABLE alone — occupied is not absent", () => {
    const absent = absentStandingRows({
      declared: [PRUNE],
      existing: [],
      unreadable: ["worktree-prune"],
    });
    expect(absent).toEqual([]);
  });

  it("still reports a different declared row while one id is unreadable", () => {
    const absent = absentStandingRows({
      declared: [PRUNE, DIGEST],
      existing: [],
      unreadable: ["worktree-prune"],
    });
    expect(absent).toEqual([{ recipeId: "alerts-digest", why: "nobody sees the overnight alerts" }]);
  });

  it("ignores rows in the store that this build does not declare", () => {
    const absent = absentStandingRows({ declared: [PRUNE], existing: [DIGEST.definition] });
    expect(absent.map((entry) => entry.recipeId)).toEqual(["worktree-prune"]);
  });

  it("orders absences by recipe id, so two runs of one build print the same report", () => {
    const absent = absentStandingRows({ declared: [PRUNE, DIGEST], existing: [] });
    expect(absent.map((entry) => entry.recipeId)).toEqual(["alerts-digest", "worktree-prune"]);
  });
});

describe("absentStandingRowLine", () => {
  it("names the row, what stops happening, and the verb that writes it back", () => {
    const line = absentStandingRowLine({
      absence: { recipeId: "worktree-prune", why: "nothing else removes a worktree" },
    });
    expect(line).toBe(
      "!! worktree-prune · DECLARED by this build and ABSENT from the store — nothing else removes a " +
        "worktree. Write it back with `slopweaver automation register-standing`",
    );
  });

  it("declares every row exactly once, so register-standing cannot write one twice", () => {
    const ids = GENERIC_STANDING_ROWS.map((declared) => declared.definition.recipeId);
    expect(ids.toSorted((left, right) => left.localeCompare(right))).toEqual([
      "alignment-briefing-weekday",
      "call-assessment-daily",
      "claude-survival-forecast",
      "compact-corpus-daily",
      "context-cost-weekly",
      "fleet-ceiling-weekly",
      "hygiene-sweep",
      "linear-briefing-daily",
      "meeting-prep-hourly",
      "publication-audit-daily",
      "self-improvement",
      "slack-owed-daily",
      "store-import-fleet-nightly",
      "store-restore-rehearsal-monthly",
      "sweep-board-daily",
      "thread-chase-daily",
      "token-pass-weekly",
      "value-sample-weekly",
      "worktree-prune",
    ]);
  });

  it("requires the daily followed-thread read, seated as owed-reply, persisting with --write under a read effect", () => {
    expect(GENERIC_STANDING_ROWS).toContain(SLACK_OWED_DAILY);
    expect(runShapeForKind({ kind: OWED_REPLY_KIND })).toBe("spawn");
    const declared = {
      cadence: "55 8 * * *",
      destination: { kind: "local-atlas" },
      effect: "read",
      enabled: true,
      kind: OWED_REPLY_KIND,
      onMissed: "skip",
      params: { argv: ["slack", "owed", "--write"] },
      recipeId: "slack-owed-daily",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    };
    expect(SLACK_OWED_DAILY.definition).toEqual(declared);
    // The verb-run row an install already holds is brought forward, never left running unseated beside this one.
    expect(SLACK_OWED_DAILY.supersedes).toEqual([{ ...declared, kind: VERB_RUN_KIND }]);
  });

  it("runs the owed read itself, and refuses its argv drifted to a verb that sends", () => {
    expect(planVerbRun({ definition: SLACK_OWED_DAILY.definition }).isOk()).toBe(true);
    const drifted = planVerbRun({
      definition: { ...SLACK_OWED_DAILY.definition, params: { argv: ["slack", "reply", "--as", "me"] } },
    });
    expect(drifted._unsafeUnwrapErr().code).toBe("EFFECT_EXCEEDS_ROW");
  });

  it("requires the daily board sweep, publishing its findings, its Queue card, its ended-PR settles and its shipped closes, never running a doc's shell probe", () => {
    const job = GENERIC_STANDING_ROWS.find((declared) => declared.definition.recipeId === "sweep-board-daily")!;
    const all = ["sweep", "board", "--write", "--queue", "--settle-ended", "--close-shipped"];
    expect(job.definition).toEqual({
      cadence: "0 7 * * *",
      destination: { kind: "local-atlas" },
      effect: "read-write",
      enabled: true,
      kind: VERB_RUN_KIND,
      onMissed: "skip",
      params: { argv: all },
      recipeId: "sweep-board-daily",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    });
    // Every earlier row an install may hold — `--write`, then each later flag added — is brought forward.
    expect(job.supersedes).toEqual([3, 4, 5].map((n) => ({ ...job.definition, params: { argv: all.slice(0, n) } })));
  });

  it("requires the daily hygiene seat as the seated kind, with no params for a row to widen", () => {
    const seat = GENERIC_STANDING_ROWS.find((declared) => declared.definition.recipeId === "hygiene-sweep")!;
    expect(seat.definition).toEqual({
      cadence: "15 7 * * *",
      destination: { kind: "local-atlas" },
      effect: "read-write",
      enabled: true,
      kind: HYGIENE_SWEEP_KIND,
      onMissed: "skip",
      params: {},
      recipeId: "hygiene-sweep",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    });
    expect(runShapeForKind({ kind: seat.definition.kind })).toBe("spawn");
  });

  it("requires the hourly survival re-read, firing only the fleet-runs-dry monitor and settling no other card", () => {
    const survival = GENERIC_STANDING_ROWS.find((d) => d.definition.recipeId === "claude-survival-forecast")!;
    expect(survival.definition).toEqual({
      cadence: "17 * * * *",
      destination: { kind: "local-atlas" },
      effect: "read-write",
      enabled: true,
      kind: VERB_RUN_KIND,
      onMissed: "skip",
      params: {
        argv: [
          "monitor",
          "check",
          "--only",
          "fleet-runs-dry",
          "--fire",
          "--by-session",
          "recipe:claude-survival-forecast",
        ],
      },
      recipeId: "claude-survival-forecast",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    });
    expect(unwrap(planVerbRun({ definition: survival.definition })).verb).toBe("check");
  });

  it("requires the nightly fleet import, every leg, half an hour before the backup dumps the store", () => {
    const nightly = GENERIC_STANDING_ROWS.find(
      (declared) => declared.definition.recipeId === "store-import-fleet-nightly",
    )!;
    expect(nightly).toBe(STORE_IMPORT_FLEET_NIGHTLY);
    expect(GENERIC_STANDING_ROWS).toContain(STORE_RESTORE_REHEARSAL);
    expect(STORE_RESTORE_REHEARSAL.definition.recipeId).toBe(REHEARSAL_RECIPE_ID);
    expect(nightly.definition).toEqual({
      cadence: "30 2 * * *",
      destination: { kind: "local-atlas" },
      effect: "read-write",
      enabled: true,
      kind: VERB_RUN_KIND,
      onMissed: "backfill",
      params: { argv: ["store", "import-fleet"] },
      recipeId: "store-import-fleet-nightly",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    });
    expect(DEFAULT_BACKUP_CADENCE).toBe("0 3 * * *");
    expect(unwrap(planVerbRun({ definition: nightly.definition })).verb).toBe("import-fleet");
  });

  it("orders the two morning hygiene rows board, then landing, so the seat reads a fresh document", () => {
    const morning = GENERIC_STANDING_ROWS.filter((declared) =>
      ["sweep-board-daily", "hygiene-sweep"].includes(declared.definition.recipeId),
    ).map((declared) => declared.definition.cadence);
    expect(morning).toEqual(["0 7 * * *", "15 7 * * *"]);
  });

  it("drives no repository among the generic rows, each drive's subject being one install's fact", () => {
    expect(GENERIC_STANDING_ROWS.length).toBeGreaterThan(0);
    const driven = GENERIC_STANDING_ROWS.filter((declared) =>
      JSON.stringify(declared.definition.params).includes("bump-drive"),
    ).map((declared) => declared.definition.recipeId);

    expect(driven).toEqual([]);
  });
});

describe("absentStandingRows", () => {
  it("reports a declared row the store does not hold", () => {
    const absent = absentStandingRows({ declared: [PRUNE], existing: [] });
    expect(absent).toEqual([{ recipeId: "worktree-prune", why: "nothing else removes a worktree" }]);
  });

  it("reports nothing when every declared row is in the store", () => {
    const absent = absentStandingRows({ declared: [PRUNE], existing: [PRUNE.definition] });
    expect(absent).toEqual([]);
  });

  it("reports nothing for an empty declaration, whatever the store holds", () => {
    expect(absentStandingRows({ declared: [], existing: [PRUNE.definition] })).toEqual([]);
  });

  it("leaves a row whose file is present but UNREADABLE alone — occupied is not absent", () => {
    const absent = absentStandingRows({
      declared: [PRUNE],
      existing: [],
      unreadable: ["worktree-prune"],
    });
    expect(absent).toEqual([]);
  });

  it("still reports a different declared row while one id is unreadable", () => {
    const absent = absentStandingRows({
      declared: [PRUNE, DIGEST],
      existing: [],
      unreadable: ["worktree-prune"],
    });
    expect(absent).toEqual([{ recipeId: "alerts-digest", why: "nobody sees the overnight alerts" }]);
  });

  it("ignores rows in the store that this build does not declare", () => {
    const absent = absentStandingRows({ declared: [PRUNE], existing: [DIGEST.definition] });
    expect(absent.map((entry) => entry.recipeId)).toEqual(["worktree-prune"]);
  });

  it("orders absences by recipe id, so two runs of one build print the same report", () => {
    const absent = absentStandingRows({ declared: [PRUNE, DIGEST], existing: [] });
    expect(absent.map((entry) => entry.recipeId)).toEqual(["alerts-digest", "worktree-prune"]);
  });
});

describe("absentStandingRowLine", () => {
  it("names the row, what stops happening, and the verb that writes it back", () => {
    const line = absentStandingRowLine({
      absence: { recipeId: "worktree-prune", why: "nothing else removes a worktree" },
    });
    expect(line).toBe(
      "!! worktree-prune · DECLARED by this build and ABSENT from the store — nothing else removes a " +
        "worktree. Write it back with `slopweaver automation register-standing`",
    );
  });
});
