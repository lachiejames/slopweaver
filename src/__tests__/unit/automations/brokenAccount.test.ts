/**
 * The five answers a broken or paused automation owes the owner: why, since when, who fixes it, what is worse, and what
 * runs instead — said as a state, never a promise.
 */
import { describe, expect, it } from "vitest";

import { brokenAccountOf } from "../../../automations/brokenAccount.js";
import type { FiringView } from "../../../automations/card.js";
import { type StandingHold, standingHoldOf } from "../../../automations/health.js";
import { CORPUS_PURPOSES } from "../../../automations/purpose.js";
import { saidPlainlyOf } from "../../../automations/saidPlainly.js";
import type { FailureFixStage } from "../../../live/automation/failureHold.js";
import type { SilentRow } from "../../../live/automation/silentRows.js";
import type { ResyncState } from "../../../live/resync/outcome.js";
import type { SyncRunView } from "../../../syncRun/fold.js";
import { auditedAgainst, HIS_ANCHOR } from "../../auditedOwnerHold.js";

const firing = (over: Partial<FiringView>): FiringView => ({
  attempt: 1,
  detail: null,
  exitCode: 0,
  outcome: "succeeded",
  reason: null,
  runStartedAtIso: null,
  settledAtIso: "2026-10-04T21:24:39.552Z",
  slotIso: "2026-10-04T21:00:00.000Z",
  startedAtIso: "2026-10-04T21:00:01.000Z",
  ...over,
});

const failedAt = ({ slotIso, settledAtIso }: { slotIso: string; settledAtIso: string }): FiringView =>
  firing({ exitCode: 1, outcome: "failed", reason: "exit 1", settledAtIso, slotIso });

const syncRun = (over: Partial<SyncRunView>): SyncRunView => ({
  committedWritten: 0,
  containers: [],
  elapsedMs: 600_000,
  errors: [],
  finishedAtIso: "2026-10-05T05:51:00.000Z",
  gaps: 0,
  lastActivityIso: "2026-10-05T05:51:00.000Z",
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
  source: "linear",
  stalled: false,
  startedAtIso: "2026-10-05T05:41:00.000Z",
  state: "finished",
  warnings: 0,
  why: "finished",
  window: null,
  writtenRate: null,
  ...over,
});

const resync = (over: Partial<ResyncState>): ResyncState => ({
  blocker: null,
  lastAttempt: null,
  lastSuccessAtIso: "2026-10-04T21:22:14.269Z",
  recipeId: "resync-corpus-linear",
  ...over,
});

const fixHold = ({ stage }: { stage: FailureFixStage }): StandingHold => ({
  finding: "fix-row",
  kind: "fix",
  sinceIso: "2026-10-05T05:41:27.877Z",
  stage,
});

const base: Parameters<typeof brokenAccountOf>[0] = {
  explanations: new Map(),
  firings: [],
  historyGaps: [],
  health: "failed",
  hold: null,
  purpose: CORPUS_PURPOSES.linear,
  recipeId: "error-tracking-batch-acme-admin",
  resync: undefined,
  run: undefined,
  silent: undefined,
  slotVerdict: null,
  syncRuns: [],
};

describe("brokenAccountOf", () => {
  it("owes nothing for a row that is neither broken nor paused", () => {
    expect([
      brokenAccountOf({ ...base, health: "healthy" }),
      brokenAccountOf({ ...base, health: "running" }),
      brokenAccountOf({ ...base, health: "off" }),
    ]).toEqual([null, null, null]);
  });

  it("answers all five for a failure-held corpus sync that still stored rows before it stopped", () => {
    const failedSync = syncRun({
      committedWritten: 7,
      lastCommittedIso: "2026-10-05T05:49:00.000Z",
      errors: ["linear customerNeeds lane unavailable: Customer requests are not available in this workspace."],
      state: "failed",
    });

    const account = brokenAccountOf({
      ...base,
      firings: [
        failedAt({ settledAtIso: "2026-10-05T05:41:27.858Z", slotIso: "2026-10-05T05:00:00.000Z" }),
        firing({}),
      ],
      hold: fixHold({ stage: { kind: "queued" } }),
      resync: resync({}),
      syncRuns: [failedSync],
    });

    expect(account).toEqual({
      detail: "linear customerNeeds lane unavailable: Customer requests are not available in this workspace.",
      fix: {
        by: "fleet",
        sinceIso: "2026-10-05T05:41:27.877Z",
        words: "The fix is the fleet's. It is on the board, not picked up yet.",
      },
      freshness: { lastCompleteIso: "2026-10-04T21:22:14.269Z", newestRowsIso: "2026-10-05T05:49:00.000Z" },
      lastWorkedIso: "2026-10-04T21:24:39.552Z",
      meanwhile: [
        "The scheduler will not run it again until its fix lands.",
        CORPUS_PURPOSES.linear.meanwhile,
        "A sync that stopped part way still stored 7 new rows.",
      ],
      plainly: null,
      said: "linear customerNeeds lane unavailable: Customer requests are not available in this workspace.",
      sinceIso: "2026-10-05T05:41:27.858Z",
      state: "broken",
      why: "A run failed, so the scheduler stopped running it until the fix lands.",
      worse: CORPUS_PURPOSES.linear.whenBroken,
    });
  });

  it("dates the break by when each firing SETTLED, so a retry that overwrote an older slot is not read as first", () => {
    const olderSlotSettledLater = failedAt({
      settledAtIso: "2026-10-05T09:00:00.000Z",
      slotIso: "2026-10-05T01:00:00.000Z",
    });
    const newerSlotSettledFirst = failedAt({
      settledAtIso: "2026-10-05T06:00:00.000Z",
      slotIso: "2026-10-05T05:00:00.000Z",
    });

    const account = brokenAccountOf({ ...base, firings: [newerSlotSettledFirst, olderSlotSettledLater, firing({})] });

    expect([account!.sinceIso, account!.lastWorkedIso]).toEqual([
      "2026-10-05T06:00:00.000Z",
      "2026-10-04T21:24:39.552Z",
    ]);
  });

  it("says each fix stage as a state, never a promise, and names who it rests on", () => {
    const stages: readonly FailureFixStage[] = [
      { kind: "taken" },
      { kind: "parked" },
      { kind: "filed", status: "in-progress" },
      { kind: "closed-unsettled", status: "cancelled" },
      { kind: "declined" },
      { kind: "unread" },
    ];
    expect(stages.length).toBeGreaterThan(0);

    const said = stages.map((stage) => brokenAccountOf({ ...base, hold: fixHold({ stage }) })!.fix);

    expect(said.map((fix) => [fix.by, fix.words])).toEqual([
      ["fleet", "The fix is the fleet's, and a session has taken it up."],
      ["fleet", "The fix is the fleet's. The session that took it up has parked it."],
      ["fleet", "The fix is the fleet's, filed as its own piece of work, which reads in-progress."],
      ["unknown", "Its fix row was closed as cancelled without settling, so nothing will lift the pause on its own."],
      ["you", "You declined its fix, so it stays paused until you lift the pause or ask for another fix."],
      ["unknown", "Its fix row could not be read, so where the fix stands is unknown."],
    ]);
  });

  it("puts a sign-in wall on the owner, and says what it hit", () => {
    const signedOut = resync({
      lastAttempt: {
        afterClock: null,
        beforeClock: null,
        exitCode: 1,
        finishedAtIso: "2026-10-05T04:00:00.000Z",
        outcome: "failed",
        problems: [],
        recipeId: "resync-atlas-clerk",
        signInWall: "https://dashboard.clerk.com",
        startedAtIso: "2026-10-05T03:59:00.000Z",
      },
    });

    const account = brokenAccountOf({ ...base, health: "waiting", purpose: null, resync: signedOut });

    expect([account!.why, account!.fix.by, account!.fix.words, account!.worse, account!.meanwhile]).toEqual([
      "It reached a sign-in page instead of the page it reads.",
      "you",
      "It needs you to sign in at https://dashboard.clerk.com.",
      "Nothing in this build says what it is for, so what is missing cannot be named.",
      ["Nothing stands in for it."],
    ]);
  });

  it("puts a recorded blocker on the owner with its own steps", () => {
    const blocked = resync({
      blocker: { findingSlug: null, key: "k", reason: "the token was revoked", steps: ["mint a token", "store it"] },
    });

    const account = brokenAccountOf({ ...base, health: "waiting", resync: blocked });

    expect([account!.why, account!.fix]).toEqual([
      "It is blocked on something only you can clear: the token was revoked.",
      { by: "you", sinceIso: null, words: "It needs you. mint a token; store it." },
    ]);
  });

  it("promises a retry only where the slot is cooling, and otherwise points at the next scheduled run", () => {
    const cooling = brokenAccountOf({
      ...base,
      slotVerdict: {
        attempt: 1,
        failedAtIso: "2026-10-05T05:41:27.858Z",
        kind: "cooling",
        previousDetail: "exit 1",
        retryNotBeforeIso: "2026-10-05T06:41:27.858Z",
      },
    });
    const exhausted = brokenAccountOf({
      ...base,
      slotVerdict: { attempt: 3, holderToken: "t", kind: "exhausted", previousDetail: "exit 1" },
    });

    expect([cooling!.fix.words, brokenAccountOf(base)!.fix.words, exhausted!.why, exhausted!.fix.words]).toEqual([
      "Nobody needs to act yet; the scheduler retries it on its own.",
      "That run is not retried; its next scheduled run tries again.",
      "The run for its latest scheduled time failed, and so did every retry.",
      "Every retry failed; its next scheduled run tries again.",
    ]);
  });

  it("keeps a stuck row whose run was abandoned on the stopped-partway account", () => {
    const abandoned = brokenAccountOf({
      ...base,
      health: "stuck",
      slotVerdict: {
        abandonment: { kind: "lease-expired" },
        attempt: 1,
        holder: "h",
        holderToken: "t",
        kind: "abandoned",
        ran: true,
      },
    })!;

    expect([abandoned.why, abandoned.fix]).toEqual([
      "The run for its latest scheduled time stopped partway and never finished.",
      {
        by: "fleet",
        sinceIso: null,
        words: "Nobody has been named to act; the scheduler decides whether it is safe to try it again.",
      },
    ]);
  });

  it("says who clears a quiet sync while its own run is open: the scheduler, once that run's time is up, by whether it started", () => {
    const held = brokenAccountOf({
      ...base,
      health: "stuck",
      slotVerdict: { attempt: 1, holder: "h", kind: "held", leaseExpiresIso: "2026-10-05T06:00:00.000Z" },
    })!;

    expect([held.why, held.fix]).toEqual([
      "A sync of its source has gone quiet, and this automation's own run has not finished.",
      {
        by: "fleet",
        sinceIso: null,
        words:
          "Nobody needs to act yet. Once its next scheduled time passes, if not sooner, the scheduler stops waiting on " +
          "this run. If the run had started, the scheduler then tries to mark it dead, pause the automation and put a " +
          "fix on the board for the fleet; if not, it decides whether it is safe to try again.",
      },
    ]);
  });

  it("says a quiet sync no run of its own holds is stopped by nothing here, and what it blocks until it ends", () => {
    const notHeld = brokenAccountOf({ ...base, health: "stuck" })!;
    const open = brokenAccountOf({ ...base, health: "stuck", slotVerdict: { attempt: 1, kind: "open" } })!;
    const expected = [
      "A sync of its source is still running, but has gone quiet.",
      {
        by: "unknown",
        sinceIso: null,
        words:
          "Nothing here stops a sync that has gone quiet. Until that sync finishes or is stopped, this automation " +
          "cannot sync its source.",
      },
    ];

    expect([
      [notHeld.why, notHeld.fix],
      [open.why, open.fix],
    ]).toEqual([expected, expected]);
  });

  it("says why a stopped row stopped in plain words, keeping the scheduler's record as the folded detail", () => {
    const silent: SilentRow = {
      cadence: "0 */4 * * *",
      currentSlotHold: null,
      detail: "3 scheduled time(s) went by with no run; it last ran 2026-10-07T13:52:23.126Z; the supervisor saw it",
      lastRunAtIso: "2026-10-07T13:52:23.126Z",
      missedSlots: 3,
      reason: "MISSED",
      recipeId: "r",
      supervisorStop: { firstSeenDueIso: "2026-10-08T13:07:03.370Z", kind: "passed-over", passes: 47 },
    };

    const stopped = brokenAccountOf({ ...base, health: "stopped", silent })!;

    expect([stopped.why, stopped.fix, stopped.detail]).toEqual([
      "It is due, but the supervisor has seen it waiting 47 times without running it or saying why.",
      {
        by: "unknown",
        sinceIso: null,
        words: "No session is on it. You can ask the supervisor to run it, or why it keeps passing it over.",
      },
      silent.detail,
    ]);
  });

  it("quotes a failure only while it is the newest finished run, never one a later run got past", () => {
    const failure = firing({
      outcome: "failed",
      reason: "exit 1: refresh: no token",
      settledAtIso: "2026-09-30T04:48:15.938Z",
      slotIso: "2026-09-30T04:00:00.000Z",
    });
    const later = { settledAtIso: "2026-10-05T00:05:00.000Z", slotIso: "2026-10-05T00:00:00.000Z" };
    // The newer slot fails, but the older slot's run finishes after it and works.
    const outOfOrder = [
      { ...failure, ...later },
      firing({ settledAtIso: "2026-10-05T00:10:00.000Z", slotIso: "2026-10-04T23:00:00.000Z" }),
    ];
    const sinceWorked = brokenAccountOf({ ...base, firings: [firing({}), failure], health: "stopped" })!;
    const stillFailing = brokenAccountOf({
      ...base,
      firings: [{ ...failure, ...later }, firing({})],
      health: "stopped",
    })!;
    const workedLast = brokenAccountOf({ ...base, firings: outOfOrder, health: "stopped" })!;

    expect([sinceWorked.said, stillFailing.said, workedLast.said]).toEqual([null, "refresh: no token", null]);
  });

  it("quotes a sync's failure only while it ended last, never by which run started last", () => {
    const failedSync = syncRun({
      errors: ["exit 1: refresh: no token"],
      finishedAtIso: "2026-10-05T10:10:00.000Z",
      startedAtIso: "2026-10-05T10:05:00.000Z",
      state: "failed",
    });
    const startedAtIso = "2026-10-05T10:00:00.000Z";
    const workedAfter = syncRun({ finishedAtIso: "2026-10-05T10:20:00.000Z", startedAtIso });
    const workedBefore = syncRun({ finishedAtIso: "2026-10-05T10:08:00.000Z", startedAtIso });

    const overtaken = brokenAccountOf({ ...base, syncRuns: [failedSync, workedAfter] })!;
    const endedLast = brokenAccountOf({ ...base, syncRuns: [failedSync, workedBefore] })!;

    expect([overtaken.said, endedLast.said]).toEqual([null, "refresh: no token"]);
  });

  it("quotes a sync's failure only while no firing finished after it", () => {
    const failedSync = syncRun({
      errors: ["exit 1: refresh: no token"],
      finishedAtIso: "2026-10-05T10:10:00.000Z",
      startedAtIso: "2026-10-05T10:02:00.000Z",
      state: "failed",
    });
    const workedLater = firing({
      settledAtIso: "2026-10-05T10:20:00.000Z",
      slotIso: "2026-10-05T10:00:00.000Z",
      startedAtIso: "2026-10-05T10:15:00.000Z",
    });
    const workedEarlier = firing({ settledAtIso: "2026-10-05T10:05:00.000Z", slotIso: "2026-10-05T10:00:00.000Z" });
    const ranIt = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "exit 1: `slopweaver corpus sync` exited 1",
      settledAtIso: "2026-10-05T10:10:01.000Z",
      startedAtIso: "2026-10-05T10:00:00.000Z",
    });

    const outranked = brokenAccountOf({ ...base, firings: [workedLater], syncRuns: [failedSync] })!;
    const stillFailing = brokenAccountOf({ ...base, firings: [workedEarlier], syncRuns: [failedSync] })!;
    const itsOwnSync = brokenAccountOf({ ...base, firings: [ranIt], syncRuns: [failedSync] })!;

    expect([outranked.said, stillFailing.said, itsOwnSync.said]).toEqual([
      null,
      "refresh: no token",
      "refresh: no token",
    ]);
  });

  it("never quotes a sync that ran before a seated firing's session began as that firing's own", () => {
    const earlierSync = syncRun({
      errors: ["stale sync error"],
      finishedAtIso: "2026-10-05T10:30:00.000Z",
      startedAtIso: "2026-10-05T10:20:00.000Z",
      state: "failed",
    });
    const seated = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "exit 1: current firing error",
      runStartedAtIso: "2026-10-05T11:00:00.000Z",
      settledAtIso: "2026-10-05T11:10:00.000Z",
      startedAtIso: "2026-10-05T10:00:00.000Z",
    });

    const account = brokenAccountOf({ ...base, firings: [seated], syncRuns: [earlierSync] })!;

    expect(account.said).toBe("current firing error");
  });

  it("finds the sync a failed firing ran past an overlapping run that ended later", () => {
    const itsOwn = syncRun({
      errors: ["exit 1: current service error"],
      finishedAtIso: "2026-10-05T10:30:00.000Z",
      startedAtIso: "2026-10-05T10:05:00.000Z",
      state: "failed",
    });
    const overlapping = syncRun({
      finishedAtIso: "2026-10-05T10:40:00.000Z",
      startedAtIso: "2026-10-05T09:00:00.000Z",
    });
    const failed = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "exit 1: `slopweaver corpus sync` exited 1",
      runStartedAtIso: "2026-10-05T10:00:00.000Z",
      settledAtIso: "2026-10-05T11:00:00.000Z",
      startedAtIso: "2026-10-05T09:59:00.000Z",
    });

    const account = brokenAccountOf({ ...base, firings: [failed], syncRuns: [itsOwn, overlapping] })!;

    expect(account.said).toBe("current service error");
  });

  it("never lets an older firing's failure speak for a later sync that failed without words", () => {
    const wordless = syncRun({ errors: [], finishedAtIso: "2026-10-05T10:10:00.000Z", state: "failed" });
    const older = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "exit 1: old failure",
      settledAtIso: "2026-10-05T10:00:00.000Z",
      startedAtIso: "2026-10-05T09:55:00.000Z",
    });

    const account = brokenAccountOf({ ...base, firings: [older], syncRuns: [wordless] })!;

    expect(account.said).toBe(null);
  });

  it("never quotes an abandoned run's bookkeeping, nor an older failure, as what the last run said", () => {
    const abandoned = firing({
      exitCode: null,
      outcome: "dead",
      reason: "HOLDER_GONE: attempt 1 was abandoned",
      settledAtIso: "2026-10-05T10:10:00.000Z",
    });
    const older = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "exit 1: old failure",
      settledAtIso: "2026-10-05T10:00:00.000Z",
    });

    const lastAbandoned = brokenAccountOf({ ...base, firings: [abandoned, older], health: "stuck" })!;
    const lastFailed = brokenAccountOf({ ...base, firings: [older], health: "stuck" })!;

    expect([lastAbandoned.said, lastFailed.said]).toEqual([null, "old failure"]);
  });

  it("quotes nothing when the run stamp names a later run whose own ledger row would not read", () => {
    const older = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "exit 1: old service error",
      settledAtIso: "2026-10-10T09:00:00.000Z",
    });

    const laterRunUnread = brokenAccountOf({
      ...base,
      firings: [older],
      health: "stopped",
      run: { exitCode: 0, lastRunAtIso: "2026-10-10T10:00:00.000Z", watermarkIso: "2026-10-10T08:00:00.000Z" },
    })!;
    const stampIsThatRun = brokenAccountOf({
      ...base,
      firings: [older],
      health: "stopped",
      run: { exitCode: 1, lastRunAtIso: "2026-10-10T09:00:00.000Z", watermarkIso: "2026-10-10T07:00:00.000Z" },
    })!;

    expect([laterRunUnread.said, stampIsThatRun.said]).toEqual([null, "old service error"]);
  });

  it("quotes nothing when a success settled in the failure's millisecond and wrote the run stamp", () => {
    const at = "2026-10-10T10:10:00.000Z";
    const failed = firing({
      exitCode: 1,
      outcome: "failed",
      reason: "exit 1: boom",
      settledAtIso: at,
      slotIso: "2026-10-10T10:00:00.000Z",
    });
    const worked = firing({ exitCode: 3, settledAtIso: at, slotIso: "2026-10-10T09:00:00.000Z" });
    const stamp = { lastRunAtIso: at, watermarkIso: "2026-10-10T10:00:00.000Z" };

    const successLast = brokenAccountOf({
      ...base,
      firings: [failed, worked],
      health: "stopped",
      run: { ...stamp, exitCode: 3 },
    })!;
    const failureLast = brokenAccountOf({
      ...base,
      firings: [failed, worked],
      health: "stopped",
      run: { ...stamp, exitCode: 1 },
    })!;

    expect([successLast.said, failureLast.said]).toEqual([null, "boom"]);
  });

  it("dates the newest rows by their commit, never by run start or a run's later activity", () => {
    const committedLastEndedFirst = syncRun({
      committedWritten: 3,
      lastActivityIso: "2026-10-05T10:15:00.000Z",
      lastCommittedIso: "2026-10-05T10:10:00.000Z",
      startedAtIso: "2026-10-05T10:08:00.000Z",
    });
    const startedFirstEndedLast = syncRun({
      committedWritten: 5,
      lastActivityIso: "2026-10-05T10:20:00.000Z",
      lastCommittedIso: "2026-10-05T10:05:00.000Z",
      startedAtIso: "2026-10-05T10:00:00.000Z",
    });
    const syncRuns = [committedLastEndedFirst, startedFirstEndedLast];

    const account = brokenAccountOf({ ...base, syncRuns })!;
    const reversed = brokenAccountOf({ ...base, syncRuns: syncRuns.toReversed() })!;

    expect([account.freshness!.newestRowsIso, reversed.freshness!.newestRowsIso]).toEqual([
      "2026-10-05T10:10:00.000Z",
      "2026-10-05T10:10:00.000Z",
    ]);
  });

  it("lifts a service's own message out of a failure that carries a request path and a JSON body", () => {
    expect([
      saidPlainlyOf({
        raw:
          '/v1/integrations/62f9/resource-kinds?pageSize=100 responded: {"message":"Accessing resource kinds not ' +
          'supported for Connectors integrations"} / `slopweaver atlas vanta sync` exited 1',
      }),
      saidPlainlyOf({ raw: String.raw`{"error":"the \"token\" expired"}` }),
      saidPlainlyOf({ raw: "Customer requests are not available in this workspace." }),
      saidPlainlyOf({ raw: null }),
    ]).toEqual([
      "Accessing resource kinds not supported for Connectors integrations",
      'the "token" expired',
      "Customer requests are not available in this workspace.",
      null,
    ]);
  });

  it("drops the runner's framing — its exit or failure code and the command it names — and says nothing for a bare code", () => {
    expect([
      saidPlainlyOf({
        raw: "exit 1: nothing was published: re-run the sync / `slopweaver atlas jumpcloud sync` exited 1 / exited 1",
      }),
      saidPlainlyOf({ raw: "HOLDER_GONE: attempt 1 was abandoned (its lease expired) with nothing settled" }),
      saidPlainlyOf({ raw: "HOLDER_GONE: exit 1: refresh: no token" }),
      saidPlainlyOf({ raw: "exit 1" }),
      saidPlainlyOf({ raw: "exit 2: " }),
      saidPlainlyOf({ raw: "the page reads a / b split, not a code" }),
      saidPlainlyOf({
        raw: "`slopweaver atlas clerk sync` exited 0, and its browser walk stopped part way: the browser session disappeared",
      }),
      saidPlainlyOf({ raw: "HOLDER_GONE: `slopweaver atlas clerk sync` exited 1, and refresh: no token" }),
      saidPlainlyOf({ raw: "HOLDER_GONE: `slopweaver atlas clerk sync` exited 1" }),
      saidPlainlyOf({
        raw: "exit 1: `handover register` exited 1 — its own lines are printed above and name the cause",
      }),
      saidPlainlyOf({ raw: "`slopweaver atlas hex sync` exited 2: no workspace configured" }),
      saidPlainlyOf({ raw: "exit 1 — HOLDER_GONE – refresh: no token" }),
      saidPlainlyOf({ raw: "exit 1 - refresh: no token" }),
      saidPlainlyOf({ raw: "HTTP-500 from the service" }),
      saidPlainlyOf({ raw: "exited 1 because refresh token expired" }),
      saidPlainlyOf({ raw: "exit 1 because refresh token expired" }),
      saidPlainlyOf({ raw: "API returned no rows" }),
      saidPlainlyOf({ raw: "service words / exited 1: exit 2: refresh: no token" }),
      saidPlainlyOf({ raw: "exit 1. HOLDER_GONE: refresh: no token" }),
    ]).toEqual([
      "nothing was published: re-run the sync",
      "attempt 1 was abandoned (its lease expired) with nothing settled",
      "refresh: no token",
      null,
      null,
      "the page reads a / b split, not a code",
      "its browser walk stopped part way: the browser session disappeared",
      "refresh: no token",
      null,
      "its own lines are printed above and name the cause",
      "no workspace configured",
      "refresh: no token",
      "refresh: no token",
      "HTTP-500 from the service",
      "because refresh token expired",
      "because refresh token expired",
      "API returned no rows",
      "service words / refresh: no token",
      "refresh: no token",
    ]);
  });

  it("reads the owner's own pause as paused, on the owner, with no failure words", () => {
    const definition = auditedAgainst({
      definition: {
        cadence: "0 2 * * *",
        destination: { kind: "local-atlas" },
        effect: "read",
        enabled: true,
        hold: {
          askedIso: "2026-09-29T00:32:24.414Z",
          clearedBy: null,
          placedBy: { anchor: HIS_ANCHOR, words: "pause error-tracking-batch-acme-admin" },
          reason: "too noisy",
        },
        kind: "verb-run",
        onMissed: "backfill",
        params: {},
        recipeId: "error-tracking-batch-acme-admin",
        schemaVersion: 1,
      },
      record: "please pause error-tracking-batch-acme-admin, it is too noisy",
    });
    const account = brokenAccountOf({
      ...base,
      health: "paused",
      hold: standingHoldOf({ definition }),
      purpose: { forWhat: "x", meanwhile: null, name: "Error tracking batch", whenBroken: null },
    });

    expect(account).toEqual({
      detail: null,
      fix: { by: "you", sinceIso: "2026-09-29T00:32:24.414Z", words: "It runs again when you lift the pause." },
      freshness: null,
      lastWorkedIso: null,
      meanwhile: ["The scheduler will not run it until you lift the pause."],
      plainly: null,
      said: null,
      sinceIso: "2026-09-29T00:32:24.414Z",
      state: "paused",
      why: "You paused it.",
      worse: "While it is paused, what it is for does not happen.",
    });
  });

  it("never takes another row's minted state as the owner's pause on this one", () => {
    const definition = auditedAgainst({
      definition: {
        cadence: "0 2 * * *",
        destination: { kind: "local-atlas" },
        effect: "read",
        enabled: true,
        hold: {
          askedIso: "2026-09-29T00:32:24.414Z",
          clearedBy: null,
          placedBy: { anchor: HIS_ANCHOR, words: "pause row-a" },
          reason: "too noisy",
        },
        kind: "verb-run",
        onMissed: "backfill",
        params: {},
        recipeId: "row-a",
        schemaVersion: 1,
      },
      record: "please pause row-a",
    });
    const account = brokenAccountOf({
      ...base,
      health: "paused",
      hold: standingHoldOf({ definition }),
      purpose: { forWhat: "x", meanwhile: null, name: "Row b", whenBroken: null },
      recipeId: "row-b",
    });

    expect([account!.why, account!.fix.by]).toEqual([
      "It is held, but no word of yours naming it is on the hold.",
      "fleet",
    ]);
  });

  it("never takes a hand-built anchored state as the owner's pause", () => {
    const account = brokenAccountOf({
      ...base,
      health: "paused",
      hold: {
        kind: "owner",
        placedByState: { kind: "anchored" },
        reason: "too noisy",
        sinceIso: "2026-09-29T00:32:24.414Z",
      },
      purpose: { forWhat: "x", meanwhile: null, name: "Error tracking batch", whenBroken: null },
    });

    expect([account!.why, account!.fix.by, account!.meanwhile]).toEqual([
      "It is held, but no word of yours naming it is on the hold.",
      "fleet",
      ["The scheduler will not run it while the hold stands."],
    ]);
  });

  it("never says the owner paused a row whose hold carries no owner word naming it, and puts the fix on the fleet", () => {
    // A row held on a chair keypress must not tell the owner they chose the hold.
    const account = brokenAccountOf({
      ...base,
      health: "paused",
      hold: {
        kind: "owner",
        placedByState: { kind: "unresolved", reason: "the hold's words name none of this automation's names" },
        reason: "owner chose hold",
        sinceIso: "2026-10-17T08:55:40.188Z",
      },
      purpose: { forWhat: "x", meanwhile: null, name: "Security fixes", whenBroken: null },
    });

    expect(account).toEqual({
      detail: "the hold's words name none of this automation's names",
      fix: {
        by: "fleet",
        sinceIso: "2026-10-17T08:55:40.188Z",
        words: "The fleet looks for your word naming it; with none, it asks you on the Queue whether to lift the hold.",
      },
      freshness: null,
      lastWorkedIso: null,
      meanwhile: ["The scheduler will not run it while the hold stands."],
      plainly: null,
      said: null,
      sinceIso: "2026-10-17T08:55:40.188Z",
      state: "paused",
      why: "It is held, but no word of yours naming it is on the hold.",
      worse: "While it is paused, what it is for does not happen.",
    });
  });
});
