import { describe, expect, it } from "vitest";

import { automationCard } from "../../../automations/card.js";
import { automationsLines } from "../../../automations/lines.js";
import { CORPUS_PURPOSES } from "../../../automations/purpose.js";
import { corpusSourceOf } from "../../../automations/rowAsks.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import type { RecipeDueVerdict } from "../../../live/automation/definitionDue.js";
import type { SilentRow } from "../../../live/automation/silentRows.js";
import {
  RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION,
  type RecipeSlotAttempt,
  type RecipeSlotVerdict,
} from "../../../live/automation/slotAttempt.js";
import type { SyncRunView } from "../../../syncRun/fold.js";
import { auditedAgainst, HIS_ANCHOR } from "../../auditedOwnerHold.js";
import { verdict } from "./dueVerdictFixture.js";

const definition = (over: Partial<RecipeDefinition> = {}): RecipeDefinition => ({
  cadence: "0 */4 * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: true,
  kind: "resync",
  onMissed: "backfill",
  params: { argv: ["recipe", "resync", "--source", "slack"] },
  recipeId: "resync-corpus-slack",
  schemaVersion: 1,
  ...over,
});

const attempt = (over: Partial<RecipeSlotAttempt> = {}): RecipeSlotAttempt => ({
  attempt: 1,
  holder: "recipe run-due",
  holderPid: 10,
  holderToken: "t",
  leaseExpiresIso: "2026-10-03T04:00:00.000Z",
  outcome: { exitCode: 0, kind: "succeeded", settledAtIso: "2026-10-03T00:20:00.000Z" },
  recipeId: "resync-corpus-slack",
  runStartedAtIso: "2026-10-03T00:00:01.000Z",
  slotIso: "2026-10-03T00:00:00.000Z",
  startedAtIso: "2026-10-03T00:00:00.000Z",
  schemaVersion: RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION,
  ...over,
});

const syncRun = (over: Partial<SyncRunView>): SyncRunView => ({
  committedWritten: 0,
  containers: [],
  elapsedMs: 600_000,
  errors: [],
  finishedAtIso: "2026-10-03T00:10:00.000Z",
  gaps: 0,
  lastActivityIso: "2026-10-03T00:10:00.000Z",
  lastCommittedIso: null,
  ledgerFailures: 0,
  malformedLines: 0,
  newByKind: {},
  pid: null,
  progress: null,
  progressRate: null,
  quietContainers: [],
  quietForMs: null,
  reported: null,
  runId: "r",
  source: "slack",
  stalled: false,
  startedAtIso: "2026-10-03T00:00:00.000Z",
  state: "finished",
  warnings: 0,
  why: "finished",
  window: null,
  writtenRate: null,
  ...over,
});

const card = ({
  def = definition(),
  attempts = [attempt()],
  slotVerdict = null,
  silent,
  firingsGap = null,
  nowIso = "2026-10-03T00:30:00.000Z",
  syncRuns = [],
  due = verdict(),
}: {
  def?: RecipeDefinition;
  due?: RecipeDueVerdict;
  attempts?: RecipeSlotAttempt[];
  firingsGap?: string | null;
  slotVerdict?: RecipeSlotVerdict | null;
  silent?: SilentRow;
  nowIso?: string;
  syncRuns?: SyncRunView[];
}) =>
  automationCard({
    attempts,
    definition: def,
    explanations: new Map(),
    firingsGap,
    kindSummary: null,
    nowIso,
    outputs: { firings: [], notes: [], postingsNote: null, readings: [], storeGap: null },
    purpose: CORPUS_PURPOSES.slack,
    resync: undefined,
    run: undefined,
    runsGap: null,
    silent,
    slotVerdict,
    steering: {
      key: null,
      keyRefusal: null,
      nextFiringIso: null,
      steers: [],
      storeGap: null,
      timeline: [],
      unanswered: 0,
    },
    syncRuns,
    syncRunsGap: null,
    verdict: due,
  });

const failedEarlier = attempt({
  outcome: {
    detail: "exit 1",
    exitCode: 1,
    kind: "failed",
    retryNotBeforeIso: "x",
    settledAtIso: "2026-10-01T00:30:00.000Z",
  },
  slotIso: "2026-10-01T00:00:00.000Z",
});

const failedLater = attempt({
  outcome: {
    detail:
      "recipe resync-corpus-slack · ran · slopweaver automation resync --source slack · exit 1 · why: refresh: no token",
    exitCode: 1,
    kind: "failed",
    retryNotBeforeIso: "x",
    settledAtIso: "2026-10-03T04:30:00.000Z",
  },
  slotIso: "2026-10-03T04:00:00.000Z",
  startedAtIso: "2026-10-03T04:00:00.000Z",
});

describe("automationCard health", () => {
  it("is healthy when the newest firing succeeded, whatever an older one did, and still says when it last broke", () => {
    // Hourly, so the count is the same in every timezone: 48 hours span the two firings, one of them recorded.
    const view = card({ attempts: [failedEarlier, attempt()], def: definition({ cadence: "0 * * * *" }) });

    expect(view.health).toBe("healthy");
    expect(view.lastBrokeIso).toBe("2026-10-01T00:30:00.000Z");
    expect(view.brokeAtIsos).toEqual(["2026-10-01T00:30:00.000Z"]);
    expect(view.firings).toEqual({
      dead: 0,
      deferred: 0,
      failed: 1,
      open: 0,
      recorded: 2,
      sinceIso: "2026-10-01T00:00:00.000Z",
      succeeded: 1,
      unrun: { bound: "exact", count: 47 },
    });
  });

  it("names the failure that finished last as the newest, not the newest slot's, when two settle out of order", () => {
    // The 01:00 slot fails at 01:05; the older 00:00 slot then fails at 01:10.
    const failed = ({ slotIso, settledAtIso, detail }: { slotIso: string; settledAtIso: string; detail: string }) =>
      attempt({ outcome: { detail, exitCode: 1, kind: "failed", retryNotBeforeIso: "x", settledAtIso }, slotIso });
    const view = card({
      attempts: [
        failed({ detail: "A", settledAtIso: "2026-10-03T01:05:00.000Z", slotIso: "2026-10-03T01:00:00.000Z" }),
        failed({ detail: "B", settledAtIso: "2026-10-03T01:10:00.000Z", slotIso: "2026-10-03T00:00:00.000Z" }),
      ],
      nowIso: "2026-10-03T01:30:00.000Z",
    });

    expect([view.newestFailure, view.lastBrokeIso, view.brokeAtIsos]).toEqual([
      { atIso: "2026-10-03T01:10:00.000Z", detail: "B" },
      "2026-10-03T01:10:00.000Z",
      ["2026-10-03T01:10:00.000Z", "2026-10-03T01:05:00.000Z"],
    ]);
  });

  it("names the success that finished last as last ok, not the newest slot's", () => {
    const ok = ({ settledAtIso, slotIso }: { settledAtIso: string; slotIso: string }) =>
      attempt({ outcome: { exitCode: 0, kind: "succeeded", settledAtIso }, slotIso });
    const view = card({
      attempts: [
        ok({ settledAtIso: "2026-10-03T01:05:00.000Z", slotIso: "2026-10-03T01:00:00.000Z" }),
        ok({ settledAtIso: "2026-10-03T01:10:00.000Z", slotIso: "2026-10-03T00:00:00.000Z" }),
      ],
      nowIso: "2026-10-03T01:30:00.000Z",
    });

    expect(view.lastSucceededIso).toBe("2026-10-03T01:10:00.000Z");
  });

  it("does not count unrun times when the slot ledger did not read whole, and prints the count when it did", () => {
    const def = definition({ cadence: "0 * * * *" });
    const gapped = card({ attempts: [failedEarlier, attempt()], def, firingsGap: "the slot ledger will not list" });
    const report = { observedAtIso: "now", issues: [], rejected: [], rosterGap: null, unscheduledSyncs: [] };

    expect(gapped.firings.unrun).toBe(null);
    expect(gapped.reliabilityWords).toBe("Worked 1 of its last 2 runs.");
    expect(automationsLines({ report: { ...report, cards: [gapped] } }).slice(1, 5)).toEqual([
      "  how long: The last run took 20m; too few runs have worked to say what is usual.",
      "  how often it works: Worked 1 of its last 2 runs.",
      `  now: ${gapped.nowDoing}`,
      "  history unread, so a run may be missing from both answers: the slot ledger will not list",
    ]);
    const lines = automationsLines({
      report: { ...report, cards: [card({ attempts: [failedEarlier, attempt()], def })] },
    });
    expect(lines.slice(1, 3)).toEqual([
      "  how long: The last run took 20m; too few runs have worked to say what is usual.",
      "  how often it works: Worked 1 of its last 2 runs. 47 scheduled times passed with no run.",
    ]);
    expect(lines[4]).toBe(
      "  2 firing(s) recorded since 2026-10-01T00:00:00.000Z: 1 ok, 1 failed, 0 dead, 0 deferred, 0 open; " +
        "47 scheduled time(s) went by with no run",
    );
  });

  it("reads a standing failure hold as failed, naming the board row that fixes it outside the account's words", () => {
    const def = definition({
      hold: {
        askedIso: "2026-09-30T16:36:22.329Z",
        clearedBy: null,
        finding: "fix-row",
        findingState: { held: true, line: "queued", stage: { kind: "queued" } },
        reason: "held",
      },
    });

    const view = card({ attempts: [attempt(), failedLater], def });

    expect([view.health, view.waitingOn, view.fixRow, view.pauseReason]).toEqual(["failed", null, "fix-row", null]);
    expect(view.account).toEqual({
      detail: "exit 1: refresh: no token",
      fix: {
        by: "fleet",
        sinceIso: "2026-09-30T16:36:22.329Z",
        words: "The fix is the fleet's. It is on the board, not picked up yet.",
      },
      freshness: null,
      lastWorkedIso: "2026-10-03T00:20:00.000Z",
      meanwhile: ["The scheduler will not run it again until its fix lands."],
      plainly: null,
      said: "refresh: no token",
      sinceIso: "2026-10-03T04:30:00.000Z",
      state: "broken",
      why: "A run failed, so the scheduler stopped running it until the fix lands.",
      worse: CORPUS_PURPOSES.slack.whenBroken,
    });
    // The timeline quotes the same plain words per firing, never the runner's framing.
    expect(view.recentFirings.map((firing) => [firing.reason, firing.said])).toEqual([
      ["exit 1: refresh: no token", "refresh: no token"],
      [null, null],
    ]);
  });

  it("never quotes an abandoned run's bookkeeping in the timeline as what it said", () => {
    const died = attempt({
      outcome: {
        detail: "attempt 1 was abandoned (its lease expired) with nothing settled",
        kind: "dead",
        reason: "HOLDER_GONE",
        settledAtIso: "2026-10-03T04:30:00.000Z",
      },
      slotIso: "2026-10-03T04:00:00.000Z",
      startedAtIso: "2026-10-03T04:00:00.000Z",
    });

    const view = card({ attempts: [attempt(), died] });

    expect(view.recentFirings.map((firing) => [firing.outcome, firing.reason, firing.said])).toEqual([
      ["dead", "HOLDER_GONE: attempt 1 was abandoned (its lease expired) with nothing settled", null],
      ["succeeded", null, null],
    ]);
  });

  it("marks only the run under way as under way: an open firing behind a later finished run is not", () => {
    const later = attempt({
      outcome: { exitCode: 0, kind: "succeeded", settledAtIso: "2026-10-03T04:20:00.000Z" },
      slotIso: "2026-10-03T04:00:00.000Z",
      startedAtIso: "2026-10-03T04:00:00.000Z",
    });
    const newestOpen = attempt({ outcome: null, slotIso: "2026-10-03T08:00:00.000Z" });

    const stranded = card({ attempts: [attempt({ outcome: null }), later] });
    const running = card({ attempts: [later, newestOpen] });

    expect([
      stranded.recentFirings.map((firing) => [firing.outcome, firing.underWay]),
      running.recentFirings.map((firing) => [firing.outcome, firing.underWay]),
    ]).toEqual([
      [
        ["succeeded", false],
        ["open", false],
      ],
      [
        ["open", true],
        ["succeeded", false],
      ],
    ]);
  });

  it("says each sync run's plain words — never its sentence of instants and pids, nor the runner's framing", () => {
    const runs = [
      syncRun({ errors: ["exit 1: slack 429 rate limited / exited 1"], runId: "framed", state: "failed" }),
      syncRun({ errors: ["`slopweaver refresh --source slack` exited 1"], runId: "bare", state: "failed" }),
      syncRun({
        runId: "killed",
        state: "ended-unfinished",
        why: "process 4242 no longer holds the slack refresh slot",
      }),
      syncRun({ runId: "ok" }),
    ];

    expect(card({ syncRuns: runs }).syncRuns.map((run) => [run.runId, run.said])).toEqual([
      ["framed", "slack 429 rate limited"],
      ["bare", null],
      ["killed", "It was stopped or crashed before it finished; the next refresh reads the same window again."],
      ["ok", null],
    ]);
  });

  it("reads a lifted failure hold as no hold: the card says what its firings say, not waiting", () => {
    const def = definition({
      hold: {
        askedIso: "2026-09-30T16:36:22.329Z",
        clearedBy: null,
        finding: "fix-row",
        findingState: { held: false, line: "landed", stage: { kind: "landed" } },
        reason: "held",
      },
    });

    const view = card({ def });

    expect([view.health, view.waitingOn, view.fixRow, view.account]).toEqual(["healthy", null, null, null]);
  });

  it("reads an owner pause with no owner word on it as the fleet's to resolve, never as the owner's", () => {
    const def = definition({ hold: { askedIso: "2026-10-01T09:00:00.000Z", clearedBy: null, reason: "too noisy" } });

    const view = card({ def });

    expect([view.health, view.switchedOn]).toEqual(["paused", false]);
    expect([view.account!.why, view.account!.fix.by]).toEqual([
      "It is held, but no word of yours naming it is on the hold.",
      "fleet",
    ]);
  });

  it("never shows an unowned hold's stored reason bare as why it is paused", () => {
    const reason = "owner chose 'Hold, discussion first'";
    const def = definition({ hold: { askedIso: "2026-10-17T08:55:40.188Z", clearedBy: null, reason } });

    const view = card({ def });

    expect(view.pauseReason).toBe(
      "UNOWNED — no word of the owner's names this automation; the hold's own note says “owner chose 'Hold, discussion first'”",
    );
  });

  it("reads the owner's own pause as paused, keeping the recorded reason off the account's words", () => {
    const def = auditedAgainst({
      definition: definition({
        hold: {
          askedIso: "2026-10-01T09:00:00.000Z",
          clearedBy: null,
          placedBy: { anchor: HIS_ANCHOR, words: "pause resync-corpus-slack" },
          reason: "too noisy",
        },
      }),
      record: "please pause resync-corpus-slack for now",
    });

    const view = card({ def });

    expect([view.health, view.pauseReason, view.fixRow]).toEqual(["paused", "too noisy", null]);
    expect(view.account).toEqual({
      detail: null,
      fix: { by: "you", sinceIso: "2026-10-01T09:00:00.000Z", words: "It runs again when you lift the pause." },
      freshness: null,
      lastWorkedIso: "2026-10-03T00:20:00.000Z",
      meanwhile: ["The scheduler will not run it until you lift the pause."],
      plainly: null,
      said: null,
      sinceIso: "2026-10-01T09:00:00.000Z",
      state: "paused",
      why: "You paused it.",
      worse: CORPUS_PURPOSES.slack.whenBroken,
    });
  });

  it("carries the plain name and purpose, and no account for a healthy row", () => {
    const view = card({});

    expect([view.name, view.forWhat, view.account]).toEqual([
      CORPUS_PURPOSES.slack.name,
      CORPUS_PURPOSES.slack.forWhat,
      null,
    ]);
  });

  it("reads the scheduler's cooling verdict as failed, with when the next attempt may start", () => {
    const slotVerdict: RecipeSlotVerdict = {
      attempt: 1,
      failedAtIso: "2026-10-03T00:30:00.000Z",
      kind: "cooling",
      previousDetail: "exit 1",
      retryNotBeforeIso: "2026-10-03T01:00:00.000Z",
    };

    expect(card({ slotVerdict }).why).toBe(
      "attempt 1 failed at 2026-10-03T00:30:00.000Z (exit 1); the next may start at 2026-10-03T01:00:00.000Z",
    );
  });

  it("reads an abandoned verdict as stuck rather than as running long, even with its pid alive", () => {
    const slotVerdict: RecipeSlotVerdict = {
      abandonment: { kind: "lease-expired" },
      attempt: 2,
      holder: "recipe run-due",
      holderToken: "t",
      kind: "abandoned",
      ran: true,
    };

    const view = card({ attempts: [attempt({ outcome: null })], slotVerdict });

    expect(view.health).toBe("stuck");
    expect(view.why).toBe("the scheduler reads attempt 2 abandoned: its lease ran out; the next tick retakes it");
  });

  it("reads a held verdict as running, naming the held firing's own slot", () => {
    const slotVerdict: RecipeSlotVerdict = {
      attempt: 1,
      holder: "recipe run-due",
      kind: "held",
      leaseExpiresIso: "2026-10-03T04:00:00.000Z",
    };

    const view = card({ attempts: [attempt({ outcome: null })], slotVerdict });

    expect(view.health).toBe("running");
    expect(view.nowDoing).toBe("running firing 2026-10-03T00:00:00.000Z (attempt 1)");
  });

  it("reads a silent row as stopped with the silence measure's own words", () => {
    const silent: SilentRow = {
      cadence: "0 */4 * * *",
      currentSlotHold: null,
      detail: "missed 3 firings",
      lastRunAtIso: null,
      missedSlots: 3,
      reason: "MISSED",
      recipeId: "resync-corpus-slack",
    };

    expect(card({ silent }).why).toBe("missed 3 firings");
  });

  it("says nothing is measured for a row with no firing on disk, rather than calling it healthy", () => {
    expect(card({ attempts: [] }).health).toBe("not-measured");
  });

  it("says the slot ledger did not read whole, rather than that no firing is on disk, when it is missing rows", () => {
    const gap = "the slot ledger at /h/slot-attempts will not list (Error: EACCES), so no firing history can be read";

    const view = card({ attempts: [], firingsGap: gap });

    expect([view.health, view.why, view.firingsGap]).toEqual(["not-measured", gap, gap]);
  });
});

// The sidebar counts "active automations", those switched on whenever they next run; a paused one stops counting.
describe("automationCard switchedOn", () => {
  const fixHold = {
    askedIso: "2026-09-30T16:36:22.329Z",
    clearedBy: null,
    finding: "fix-row",
    findingState: { held: true, line: "queued", stage: { kind: "queued" as const } },
    reason: "held",
  };

  it("is on for an enabled row with no hold", () => {
    expect(card({}).switchedOn).toBe(true);
  });

  it("is off for a disabled row whose last attempt failed, which health reads as failed rather than off", () => {
    const view = card({
      def: definition({ enabled: false }),
      due: verdict({ offReason: "disabled" }),
      slotVerdict: {
        attempt: 1,
        failedAtIso: "2026-10-03T00:30:00.000Z",
        kind: "cooling",
        previousDetail: "exit 1",
        retryNotBeforeIso: "2026-10-03T01:00:00.000Z",
      },
    });

    expect([view.health, view.switchedOn]).toEqual(["failed", false]);
  });

  it("is off for a disabled row with nothing else to say, which health reads as off", () => {
    const view = card({ def: definition({ enabled: false }) });

    expect([view.health, view.switchedOn]).toEqual(["off", false]);
  });

  it("is off for a row the verdict calls disabled, whatever the definition's own flag says", () => {
    expect(card({ due: verdict({ offReason: "disabled" }) }).switchedOn).toBe(false);
  });

  it("is off while the owner's own pause stands", () => {
    const def = definition({ hold: { askedIso: "2026-10-01T09:00:00.000Z", clearedBy: null, reason: "too noisy" } });

    expect(card({ def }).switchedOn).toBe(false);
  });

  it("stays on under the fleet's standing fix hold, which is not the owner's switch", () => {
    const view = card({ attempts: [attempt(), failedLater], def: definition({ hold: fixHold }) });

    expect([view.health, view.switchedOn]).toEqual(["failed", true]);
  });

  it("is on once a fix hold has lifted", () => {
    const def = definition({
      hold: { ...fixHold, findingState: { held: false, line: "landed", stage: { kind: "landed" as const } } },
    });

    expect(card({ def }).switchedOn).toBe(true);
  });
});

describe("corpusSourceOf", () => {
  it("reads the source off a corpus resync's argv and nothing off an atlas resync", () => {
    expect(corpusSourceOf({ definition: definition() })).toBe("slack");
    expect(
      corpusSourceOf({
        definition: definition({
          params: { argv: ["recipe", "resync", "--atlas", "slack"] },
          recipeId: "resync-atlas-slack",
        }),
      }),
    ).toBe(null);
  });
});

describe("automationsLines", () => {
  it("prints unreadable stores and rejected files before any card", () => {
    const lines = automationsLines({
      report: {
        cards: [card({})],
        observedAtIso: "now",
        issues: ["the slot ledger will not list"],
        rejected: [{ file: "zz.json", why: "not JSON" }],
        rosterGap: null,
        unscheduledSyncs: [],
      },
    });

    expect(lines.slice(0, 3)).toEqual([
      "ISSUE · the slot ledger will not list",
      "REJECTED · zz.json · not JSON",
      "resync-corpus-slack · HEALTHY · the run for its latest scheduled time succeeded at 2026-10-03T00:20:00.000Z",
    ]);
  });
});
