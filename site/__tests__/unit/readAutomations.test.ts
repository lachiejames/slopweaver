/**
 * The Automations page's strict reader: a `automation status --json` document reads whole, a `null` on the wire reads as
 * absent, and a run or card whose shape moved refuses the whole document rather than drawing a shorter list.
 */
import { describe, expect, it } from "vitest";

import { readAutomations } from "../../components/live/readAutomations";
import { readSyncRun } from "../../components/live/readAutomationsSyncRun";

const run = {
  committedWritten: 3,
  containers: [
    {
      container: "linear/SUP",
      kinds: { issue: { offered: 2, written: 1 } },
      label: "linear/SUP",
      offered: 2,
      written: 1,
    },
  ],
  elapsedMs: 587_217,
  errors: [],
  finishedAtIso: "2026-10-03T04:32:40.635Z",
  gaps: 0,
  lastActivityIso: "2026-10-03T04:32:40.635Z",
  ledgerFailures: 0,
  malformedLines: 0,
  newByKind: { issue: 3 },
  progress: { done: 0, item: "page 1", phase: "projects" },
  progressRate: null,
  quietContainers: [
    {
      container: "linear/CORE",
      kinds: { issue: { offered: 1, written: 0 } },
      label: "linear/CORE",
      offered: 1,
      written: 0,
    },
  ],
  quietForMs: null,
  runId: "1896fc09",
  source: "linear",
  stalled: false,
  startedAtIso: "2026-10-03T04:22:53.418Z",
  state: "finished",
  why: "finished at 2026-10-03T04:32:40.635Z",
  writtenRate: { amount: 3, overMs: 587_217, unit: "new rows" },
};

const card = {
  brokeAtIsos: ["2026-09-30T05:51:58.232Z"],
  cadence: "0 */4 * * *",
  destination: "local-atlas",
  durationWords: "The last run took 2h; too few runs have worked to say what is usual.",
  glanceWords: "last 2h · 20/22 worked",
  reliabilityWords: "Worked 8 of its last 10 runs. 41 scheduled times passed with no run.",
  firings: {
    dead: 2,
    deferred: 0,
    failed: 0,
    open: 1,
    recorded: 23,
    sinceIso: "2026-09-16T18:00:00.000Z",
    succeeded: 20,
    unrun: { bound: "exact", count: 41 },
  },
  health: "failed",
  kind: "resync",
  kindSummary: null,
  lastBrokeIso: "2026-09-30T05:51:58.232Z",
  firingsGap: null,
  syncRunsGap: null,
  lastRunAtIso: null,
  lastSucceededIso: "2026-10-03T03:53:42.706Z",
  newestFailure: { atIso: "2026-09-30T05:51:58.232Z", detail: "HOLDER_GONE: abandoned" },
  nowDoing: "idle until its next firing",
  recentFirings: [
    {
      attempt: 1,
      detail: null,
      outcome: "succeeded",
      plainly: null,
      reason: null,
      runMs: 6_821_706,
      said: null,
      settledAtIso: "2026-10-03T03:53:42.706Z",
      slotIso: "2026-10-03T02:00:00.000Z",
      startedAtIso: "2026-10-03T02:00:01.000Z",
      underWay: false,
    },
  ],
  account: {
    detail: 'exit 1: linear 400 {"message":"customer requests are not available"}',
    fix: { by: "fleet", sinceIso: "2026-10-03T04:00:00.000Z", words: "The fix is the fleet's." },
    freshness: { lastCompleteIso: "2026-10-03T03:53:42.706Z", newestRowsIso: null },
    lastWorkedIso: "2026-10-03T03:53:42.706Z",
    meanwhile: ["The scheduler will not run it again until its fix lands."],
    plainly: "The service refused it permission. The connection needs the access it is missing.",
    said: "customer requests are not available",
    sinceIso: "2026-10-03T04:00:00.000Z",
    state: "broken",
    why: "A run failed, so the scheduler stopped running it until the fix lands.",
    worse: "Issues since it last ran are missing.",
  },
  fixRow: "r1",
  forWhat: "Keeps the Linear history current.",
  name: "Linear history sync",
  pauseReason: null,
  outputs: {
    firings: [
      {
        finding: null,
        findingNote: null,
        posting: { channel: "C1", postedAtIso: "2026-10-03T03:53:00.000Z", ts: "1789.0001" },
        postingNote: null,
        postingUnreadable: null,
        slotIso: "2026-10-03T02:00:00.000Z",
      },
    ],
    notes: [{ atIso: "2026-10-02T00:00:00.000Z", url: null, what: "re-auth Linear" }],
    postingsNote: null,
    storeGap: null,
    readings: [{ atIso: "2026-10-02T00:00:00.000Z", bytes: 12, file: "r.json", producer: "atlas" }],
  },
  recipeId: "resync-corpus-linear",
  steering: {
    key: "recipe:resync-corpus-linear",
    keyRefusal: null,
    nextFiringIso: "2026-10-03T08:00:00.000Z",
    steers: [
      {
        answer: { settlement: "answered", witness: null },
        answerUnreadable: null,
        boardRowMissing: false,
        delivery: { atIso: "2026-10-02T09:00:01.000Z", detail: "typed", kind: "typed" },
        sentAtIso: "2026-10-02T09:00:00.000Z",
        slug: "talk-a",
        turnId: "a",
        words: "only the SUP team",
      },
    ],
    timeline: [
      {
        atIso: "2026-09-16T18:00:00.000Z",
        earliestFrom: "file-born",
        firingAfter: null,
        kind: "stated",
        rowEditedAfterIso: null,
        steer: null,
        text: "slopweaver automation resync --source linear",
      },
      {
        atIso: "2026-10-02T09:00:00.000Z",
        earliestFrom: null,
        firingAfter: {
          outcome: "succeeded",
          posting: null,
          postingUnreadable: "the posting record at p.json will not parse",
          slotIso: "2026-10-02T12:00:00.000Z",
          startedAtIso: "2026-10-02T12:00:01.000Z",
        },
        kind: "steer",
        rowEditedAfterIso: null,
        steer: null,
        text: "only the SUP team",
      },
    ],
    unanswered: 0,
    storeGap: "the relay ledger at r.jsonl will not parse — no card shows the steers sent about it",
  },
  switchedOn: true,
  syncRuns: [{ ...run, said: null }],
  syncSource: "linear",
  waitingOn: null,
  what: "slopweaver automation resync --source linear",
  why: "a run failed, so the scheduler paused it until its fix lands",
};

const document = {
  cards: [card],
  issues: [],
  observedAtIso: "2026-10-03T04:40:00.000Z",
  rejected: [],
  rosterGap: null,
  unscheduledSyncs: [],
};

describe("readAutomations", () => {
  it("reads a whole document, every card and its runs", () => {
    const view = readAutomations(document)!;
    expect(view.automations.map((automation) => automation.recipeId)).toEqual(["resync-corpus-linear"]);
    expect(view.automations[0].firings.succeeded).toBe(20);
    expect(view.automations[0].syncRuns[0].containers[0].label).toBe("linear/SUP");
    expect(view.automations[0].syncRuns[0].writtenRate).toEqual({ amount: 3, overMs: 587_217, unit: "new rows" });
  });

  it("reads a null on the wire as absent", () => {
    const view = readAutomations(document)!;
    expect(view.automations[0].kindSummary).toBe(undefined);
    expect(view.automations[0].recentFirings[0].detail).toBe(undefined);
    expect(view.automations[0].syncRuns[0].progressRate).toBe(undefined);
    expect(view.automations[0].firingsGap).toBe(undefined);
    expect([view.automations[0].syncRunsGap, view.automations[0].outputs.storeGap]).toEqual([undefined, undefined]);
  });

  it("refuses the whole document when one run's shape moved", () => {
    const { stalled: _stalled, ...movedRun } = run;
    expect(readAutomations({ ...document, cards: [{ ...card, syncRuns: [movedRun] }] })).toBe(undefined);
  });

  it("refuses a firing tally missing a count", () => {
    const { open: _open, ...firings } = card.firings;
    expect(readAutomations({ ...document, cards: [{ ...card, firings }] })).toBe(undefined);
  });

  it("reads the unrun-slot count, a null one as not counted, and refuses a bound the verb never writes", () => {
    const uncounted = { ...card, firings: { ...card.firings, unrun: null } };
    const strangeBound = { ...card, firings: { ...card.firings, unrun: { bound: "roughly", count: 3 } } };
    expect(readAutomations(document)!.automations[0].firings.unrun).toEqual({ bound: "exact", count: 41 });
    expect(readAutomations({ ...document, cards: [uncounted] })!.automations[0].firings.unrun).toBe(undefined);
    expect(readAutomations({ ...document, cards: [strangeBound] })).toBe(undefined);
  });

  it("refuses an unrun count the server never writes: negative or fractional", () => {
    const withCount = (count: number) => ({ ...card, firings: { ...card.firings, unrun: { bound: "exact", count } } });
    expect([
      readAutomations({ ...document, cards: [withCount(-1)] }),
      readAutomations({ ...document, cards: [withCount(1.5)] }),
    ]).toEqual([undefined, undefined]);
  });

  it("reads whether each row is switched on, which the sidebar counts", () => {
    expect([
      readAutomations(document)!.automations[0].switchedOn,
      readAutomations({ ...document, cards: [{ ...card, switchedOn: false }] })!.automations[0].switchedOn,
    ]).toEqual([true, false]);
  });

  it("refuses a card that does not say whether it is switched on, rather than guessing it off its health", () => {
    const { switchedOn: _switchedOn, ...unsaid } = card;
    expect([
      readAutomations({ ...document, cards: [unsaid] }),
      readAutomations({ ...document, cards: [{ ...card, switchedOn: "true" }] }),
      readAutomations({ ...document, cards: [{ ...card, switchedOn: 1 }] }),
      readAutomations({ ...document, cards: [{ ...card, switchedOn: null }] }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("refuses a nullable field carrying the wrong type", () => {
    expect(readAutomations({ ...document, cards: [{ ...card, waitingOn: 7 }] })).toBe(undefined);
    expect(readAutomations({ ...document, cards: [{ ...card, firingsGap: 7 }] })).toBe(undefined);
    expect(readAutomations({ ...document, cards: [{ ...card, syncRunsGap: 7 }] })).toBe(undefined);
    expect(readAutomations({ ...document, rosterGap: 7 })).toBe(undefined);
  });

  it("carries why the roster would not list, so the page never draws it as zero scheduled", () => {
    const rosterGap = "the recipe definitions at d will not list (EACCES)";
    expect(readAutomations({ ...document, cards: [], rosterGap })!.rosterGap).toBe(rosterGap);
    expect(readAutomations(document)!.rosterGap).toBe(undefined);
  });

  it("reads each firing's posting, the row's steers with their answers, and its timeline", () => {
    const automation = readAutomations(document)!.automations[0];
    expect(automation.outputs.firings[0].posting).toEqual({
      channel: "C1",
      postedAtIso: "2026-10-03T03:53:00.000Z",
      ts: "1789.0001",
    });
    expect([automation.outputs.notes[0].url, automation.outputs.firings[0].finding]).toEqual([undefined, undefined]);
    expect(automation.steering.steers[0].answer).toEqual({ settlement: "answered", witness: undefined });
    expect(automation.steering.storeGap).toBe(
      "the relay ledger at r.jsonl will not parse — no card shows the steers sent about it",
    );
    expect(
      automation.steering.timeline.map((entry) => [entry.kind, entry.earliestFrom, entry.steer, entry.firingAfter]),
    ).toEqual([
      ["stated", "file-born", undefined, undefined],
      [
        "steer",
        undefined,
        undefined,
        {
          outcome: "succeeded",
          posting: undefined,
          postingUnreadable: "the posting record at p.json will not parse",
          slotIso: "2026-10-02T12:00:00.000Z",
          startedAtIso: "2026-10-02T12:00:01.000Z",
        },
      ],
    ]);
  });

  it("refuses a card whose steer lost its words, or whose timeline names an unknown kind", () => {
    const { words: _words, ...wordless } = card.steering.steers[0];
    const steers = { ...card.steering, steers: [wordless] };
    const timeline = { ...card.steering, timeline: [{ ...card.steering.timeline[0], kind: "edited" }] };
    expect([
      readAutomations({ ...document, cards: [{ ...card, steering: steers }] }),
      readAutomations({ ...document, cards: [{ ...card, steering: timeline }] }),
      readAutomations({ ...document, cards: [{ ...card, outputs: undefined }] }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("readAutomations: the five answers", () => {
  it("reads a broken row's name, purpose and account, a null freshness instant read as absent", () => {
    const automation = readAutomations(document)!.automations[0];
    expect([automation.name, automation.forWhat, automation.fixRow, automation.pauseReason]).toEqual([
      "Linear history sync",
      "Keeps the Linear history current.",
      "r1",
      undefined,
    ]);
    expect(automation.account).toEqual({
      detail: 'exit 1: linear 400 {"message":"customer requests are not available"}',
      fix: { by: "fleet", sinceIso: "2026-10-03T04:00:00.000Z", words: "The fix is the fleet's." },
      freshness: { lastCompleteIso: "2026-10-03T03:53:42.706Z", newestRowsIso: undefined },
      lastWorkedIso: "2026-10-03T03:53:42.706Z",
      meanwhile: ["The scheduler will not run it again until its fix lands."],
      plainly: "The service refused it permission. The connection needs the access it is missing.",
      said: "customer requests are not available",
      sinceIso: "2026-10-03T04:00:00.000Z",
      state: "broken",
      why: "A run failed, so the scheduler stopped running it until the fix lands.",
      worse: "Issues since it last ran are missing.",
    });
  });

  it("reads how long it takes, how often it works, and each firing's run time, a null one as untimed", () => {
    const automation = readAutomations(document)!.automations[0];
    const untimed = { ...card, recentFirings: [{ ...card.recentFirings[0], runMs: null }] };
    expect([
      automation.durationWords,
      automation.reliabilityWords,
      automation.glanceWords,
      automation.recentFirings[0].runMs,
    ]).toEqual([
      "The last run took 2h; too few runs have worked to say what is usual.",
      "Worked 8 of its last 10 runs. 41 scheduled times passed with no run.",
      "last 2h · 20/22 worked",
      6_821_706,
    ]);
    expect(readAutomations({ ...document, cards: [untimed] })!.automations[0].recentFirings[0].runMs).toBe(undefined);
  });

  it("refuses a card missing an answer, or a firing whose run time is not a number", () => {
    const { durationWords: _durationWords, ...unanswered } = card;
    const strangeRun = { ...card, recentFirings: [{ ...card.recentFirings[0], runMs: "2h" }] };
    expect([
      readAutomations({ ...document, cards: [unanswered] }),
      readAutomations({ ...document, cards: [strangeRun] }),
    ]).toEqual([undefined, undefined]);
  });

  it("reads each firing's and sync run's plain words, and refuses a card whose firing or run omits them", () => {
    const { said: _firingSaid, ...unsaidFiring } = card.recentFirings[0];
    const { said: _runSaid, ...unsaidRun } = card.syncRuns[0];
    const said = {
      ...card,
      recentFirings: [{ ...card.recentFirings[0], said: "refresh: no token" }],
      syncRuns: [{ ...card.syncRuns[0], said: "the lane is unavailable" }],
    };
    const automation = readAutomations({ ...document, cards: [said] })!.automations[0];

    expect([automation.recentFirings[0].said, automation.syncRuns[0].said]).toEqual([
      "refresh: no token",
      "the lane is unavailable",
    ]);
    expect([
      readAutomations({ ...document, cards: [{ ...card, recentFirings: [unsaidFiring] }] }),
      readAutomations({ ...document, cards: [{ ...card, syncRuns: [unsaidRun] }] }),
    ]).toEqual([undefined, undefined]);
  });

  it("reads a failed firing's plain cause, a null one as absent, and refuses one omitting it or carrying it unfailed", () => {
    const plainly = "The sign-in expired, so reconnecting it fixes it.";
    const failedFiring = { ...card.recentFirings[0], outcome: "failed", plainly };
    const explained = { ...card, recentFirings: [failedFiring] };
    const { plainly: _firingPlainly, ...unsaidFiring } = card.recentFirings[0];
    const { plainly: _accountPlainly, ...unsaidAccount } = card.account;
    const onOutcome = ["succeeded", "deferred", "open"].map((outcome) =>
      readAutomations({ ...document, cards: [{ ...card, recentFirings: [{ ...failedFiring, outcome }] }] }),
    );

    expect([
      readAutomations({ ...document, cards: [explained] })!.automations[0].recentFirings[0].plainly,
      readAutomations({ ...document, cards: [{ ...card, recentFirings: [{ ...failedFiring, outcome: "dead" }] }] })!
        .automations[0].recentFirings[0].plainly,
      readAutomations(document)!.automations[0].recentFirings[0].plainly,
      readAutomations({ ...document, cards: [{ ...card, recentFirings: [unsaidFiring] }] }),
      readAutomations({ ...document, cards: [{ ...card, account: unsaidAccount }] }),
      ...onOutcome,
    ]).toEqual([plainly, plainly, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("reads a null account as a row that is neither broken nor paused", () => {
    expect(readAutomations({ ...document, cards: [{ ...card, account: null }] })!.automations[0].account).toBe(
      undefined,
    );
  });

  it("refuses an account whose fix names an owner the verb never writes, or whose state moved", () => {
    const strangeOwner = { ...card.account, fix: { ...card.account.fix, by: "supervisor" } };
    const strangeState = { ...card.account, state: "degraded" };
    expect([
      readAutomations({ ...document, cards: [{ ...card, account: strangeOwner }] }),
      readAutomations({ ...document, cards: [{ ...card, account: strangeState }] }),
      readAutomations({ ...document, cards: [{ ...card, name: 7 }] }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("refuses a firing that lost its start, which the timeline measures from", () => {
    const { startedAtIso: _started, ...startless } = card.recentFirings[0];
    expect(readAutomations({ ...document, cards: [{ ...card, recentFirings: [startless] }] })).toBe(undefined);
  });

  it("refuses a firing that does not say whether it is the run under way", () => {
    const { underWay: _underWay, ...unsure } = card.recentFirings[0];
    expect([
      readAutomations({ ...document, cards: [{ ...card, recentFirings: [unsure] }] }),
      readAutomations({ ...document, cards: [card] })!.automations[0].recentFirings[0].underWay,
    ]).toEqual([undefined, false]);
  });
});

describe("readSyncRun", () => {
  it("reads one run on its own, as onboarding will", () => {
    expect(readSyncRun(run)!.quietContainers.map((container) => container.label)).toEqual(["linear/CORE"]);
  });
});
