/**
 * What a dispatched turn's live card SAYS while its worker works — the three sources it picks its running
 * detail from, the staleness probe over the turn's own progress log, and whether this dispatch's own ticker
 * is alive. Split out of `dispatch.test.ts` alongside the module it covers.
 *
 * Every case here is pure: a log, a screen string or a process-table reading in, a plan or a line out. No
 * Slack transport, no cmux socket and no real `ps` anywhere near it.
 */
import { describe, expect, it } from "vitest";

import {
  attemptChecklistAdvance,
  cardStaleSweepLine,
  liveChecklistUpdatePlan,
  tickerMissingClause,
  tickerRunning,
} from "../../../../../cli/commands/turn/sweepCard.js";
import { type AskLifecycleEvent, type CapturedEvent, foldAskLifecycle } from "../../../../../live/ask/lifecycle.js";
import { liveLineOf } from "../../../../../live/turn/progressCard.js";

/**
 * A stated absolute launcher path, so the remedy clause's cases assert against an input this file declares
 * rather than against whatever tree the runner happens to be in. `bundledLauncherPath`'s own resolution —
 * including that it names a file which really exists — is covered in `unit/lib/pluginRoot.test.ts`.
 */
const LAUNCHER = "/opt/slopweaver/bin/slopweaver";

describe("liveChecklistUpdatePlan", () => {
  const CAPTURED: CapturedEvent = {
    channel: "C1",
    kind: "captured",
    messageTs: "1.1",
    surface: "channel",
    threadTs: "1.1",
    tsIso: "2026-08-13T00:00:00.000Z",
    userId: "U0OWNER",
  };
  const CHECKLIST_POSTED: AskLifecycleEvent = {
    ...CAPTURED,
    kind: "checklist-posted",
    turnId: "turn-1",
    workingTs: "1785000000.000900",
  };
  /** One minute after the fold's last event — inside the stall grace window, so only the SCREEN can speak. */
  const FRESH_NOW = "2026-08-13T00:01:00.000Z";

  it("is undefined when the ask has no `started` ref at all — nothing to advance", () => {
    const entry = foldAskLifecycle({ events: [CAPTURED] }).get(JSON.stringify(["C1", "1.1"]))!;

    expect(
      liveChecklistUpdatePlan({
        entry,
        nowIso: FRESH_NOW,
        question: "what are my open PRs?",
        screen: "checking GitHub now",
        timeline: [],
      }),
    ).toBe(undefined);
  });

  it("is undefined when the screen has nothing worth showing and the turn has not been quiet long enough", () => {
    const entry = foldAskLifecycle({ events: [CAPTURED, CHECKLIST_POSTED] }).get(JSON.stringify(["C1", "1.1"]))!;

    expect(
      liveChecklistUpdatePlan({
        entry,
        nowIso: FRESH_NOW,
        question: "what are my open PRs?",
        screen: "   \n\n  ",
        timeline: [],
      }),
    ).toBe(undefined);
  });

  /**
   * The half of the daily failure a screen scrape can never cover: a dispatched session whose screen shows
   * nothing informative is indistinguishable, on the card, from one working hard — and the owner's own report
   * is that they then have to go and ask a session whether a thread is stuck. Once the silence passes the grace
   * window the card says so ITSELF, naming when the turn was last heard from so the reader can act on it.
   */
  it("falls back to a staleness line, naming when the turn was last heard, once the silence passes the window", () => {
    const entry = foldAskLifecycle({ events: [CAPTURED, CHECKLIST_POSTED] }).get(JSON.stringify(["C1", "1.1"]))!;

    const plan = liveChecklistUpdatePlan({
      entry,
      nowIso: "2026-08-13T00:23:00.000Z",
      question: "what are my open PRs?",
      screen: "   \n\n  ",
      timeline: [],
    });

    expect(liveLineOf({ steps: plan!.steps })).toBe(
      "handed to a session, last heard 00:00Z — nothing reported for 23m",
    );
    expect(plan!.steps[1]!.state).toBe("running");
  });

  /**
   * The exact defect this covers (MEASURED): a screen that is ENTIRELY chrome — a bare prompt,
   * the permission-mode footer, and Claude Code's own trailing slash-command hint row — must leave
   * `liveStatusFromScreen` returning `undefined` so the `??` in this function actually falls through to
   * `stalledDetail`. Before the fix, the hint row was mistaken for informative text, `liveStatusFromScreen`
   * never returned `undefined` on this shape, and the staleness line — the direct answer to doctrine rule
   * 6's most expensive failure mode — was unreachable.
   */
  it("reaches the staleness line even when the screen is entirely chrome, including the slash-command hint row", () => {
    const entry = foldAskLifecycle({ events: [CAPTURED, CHECKLIST_POSTED] }).get(JSON.stringify(["C1", "1.1"]))!;
    const screen = [
      "$ ",
      "─".repeat(83),
      "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ← 3 agents",
      `${" ".repeat(78)}/rc`,
    ].join("\n");

    const plan = liveChecklistUpdatePlan({
      entry,
      nowIso: "2026-08-13T00:23:00.000Z",
      question: "what are my open PRs?",
      screen,
      timeline: [],
    });

    expect(liveLineOf({ steps: plan!.steps })).toBe(
      "handed to a session, last heard 00:00Z — nothing reported for 23m",
    );
  });

  it("prefers a live screen detail over the staleness line, even when the turn has been quiet for hours", () => {
    const entry = foldAskLifecycle({ events: [CAPTURED, CHECKLIST_POSTED] }).get(JSON.stringify(["C1", "1.1"]))!;

    const plan = liveChecklistUpdatePlan({
      entry,
      nowIso: "2026-08-13T03:00:00.000Z",
      question: "what are my open PRs?",
      screen: "reading the fourth of six repositories",
      timeline: [],
    });

    expect(liveLineOf({ steps: plan!.steps })).toBe("reading the fourth of six repositories");
  });

  it("plans the exact advance a fresh-visible-session sweep needs, once both a started ref and a live screen exist", () => {
    const entry = foldAskLifecycle({ events: [CAPTURED, CHECKLIST_POSTED] }).get(JSON.stringify(["C1", "1.1"]))!;

    const plan = liveChecklistUpdatePlan({
      entry,
      nowIso: FRESH_NOW,
      question: "what are my open PRs?",
      screen: "checking GitHub for open PRs",
      timeline: [],
    });

    expect(plan).toBeDefined();
    expect(plan!.posted).toEqual({ channel: "C1", ts: "1785000000.000900" });
    expect(plan!.task).toBe("answering: what are my open PRs?");
    expect(liveLineOf({ steps: plan!.steps })).toBe("checking GitHub for open PRs");
    expect(plan!.steps.find((step) => step.state === "done")).toBeDefined();
  });

  // The three-source preference. The worker's own TRANSCRIPT is the best of them — it names the tool and its
  // target — and it is available to the sweep from the moment the worker announced which session it is.
  it("prefers the worker's transcript line over a perfectly good screen scrape", () => {
    const entry = foldAskLifecycle({ events: [CAPTURED, CHECKLIST_POSTED] }).get(JSON.stringify(["C1", "1.1"]))!;

    const plan = liveChecklistUpdatePlan({
      entry,
      nowIso: FRESH_NOW,
      question: "what are my open PRs?",
      screen: "checking GitHub for open PRs",
      timeline: [],
      workerDetail: "now: Bash (started 3m ago) · 46 tool calls so far",
    });

    expect(liveLineOf({ steps: plan!.steps })).toBe("now: Bash (started 3m ago) · 46 tool calls so far");
  });

  it("falls back to the screen when the worker never announced itself", () => {
    const entry = foldAskLifecycle({ events: [CAPTURED, CHECKLIST_POSTED] }).get(JSON.stringify(["C1", "1.1"]))!;

    const plan = liveChecklistUpdatePlan({
      entry,
      nowIso: FRESH_NOW,
      question: "what are my open PRs?",
      screen: "checking GitHub for open PRs",
      timeline: [],
      workerDetail: undefined,
    });

    expect(liveLineOf({ steps: plan!.steps })).toBe("checking GitHub for open PRs");
  });

  it("uses the transcript line even when the screen is the box-drawing noise that reached a live card", () => {
    // Both halves of the defect in one case: the screen offers only Claude Code's input-box
    // rule, and the transcript has the real answer the whole time.
    const entry = foldAskLifecycle({ events: [CAPTURED, CHECKLIST_POSTED] }).get(JSON.stringify(["C1", "1.1"]))!;

    const plan = liveChecklistUpdatePlan({
      entry,
      nowIso: FRESH_NOW,
      question: "what are my open PRs?",
      screen: `${"─".repeat(120)} ─`,
      timeline: [],
      workerDetail: "now: reading the Vanta vendor record (started just now) · 12 tool calls so far",
    });

    expect(liveLineOf({ steps: plan!.steps })).toBe(
      "now: reading the Vanta vendor record (started just now) · 12 tool calls so far",
    );
  });
});

/**
 * Scenario 8 — an expired `fresh-visible-session` lease is surfaced for re-judgement, never auto-relaunched.
 * `sweepDispatchedAsks` is driven directly with plain fakes here — no live cmux binary, and its own
 * `DispatchSweepDeps` type has no launch capability to fake in the first place.
 */
describe("cardStaleSweepLine", () => {
  const ASK = { channel: "C9", messageTs: "1788324902.031449", threadTs: "1788324902.031449" };
  const STARTED = "2026-09-02T04:52:00.000Z";
  // A DISTINCT detail per write, because that is what this turn's real card carried: `now:` lines whose
  // elapsed time and tool-call count moved between writes. `changingWrites` folds a REPEATED detail into one
  // mark (a rewrite is not a change), so a constant here would silently collapse this timeline to a single
  // boundary and make every gap below meaningless.
  const cardWrite = ({ tsIso }: { tsIso: string }) => ({
    detail: `now: Bash · at ${tsIso}`,
    kind: "card-write" as const,
    stageCount: 1,
    tsIso,
  });

  // The timeline this fix was measured on: a 9.2m stall since 04:55:02.676Z, a smaller 5.1m one
  // since 05:10:33.890Z after it, and writes continuing to seconds before the sweep. Mirrors the fixture in
  // `src/__tests__/unit/live/turn/progressLog.test.ts`.
  const LIVE_CARD = {
    stages: [],
    timeline: [],
    warns: [],
    writes: [
      "2026-09-02T04:55:02.676Z",
      "2026-09-02T05:04:14.676Z",
      "2026-09-02T05:08:00.000Z",
      "2026-09-02T05:10:33.890Z",
      "2026-09-02T05:15:39.890Z",
      "2026-09-02T05:19:00.000Z",
      "2026-09-02T05:21:53.000Z",
    ].map((tsIso) => cardWrite({ tsIso })),
  };

  it("says NOTHING about a card written seven seconds ago, whatever it stalled for earlier in the turn", () => {
    expect(
      cardStaleSweepLine({ entry: ASK, log: LIVE_CARD, nowIso: "2026-09-02T05:22:00.000Z", startedIso: STARTED }),
    ).toBeUndefined();
  });

  it("reports the stretch in progress in the present tense, and names the worse closed one as past", () => {
    expect(
      cardStaleSweepLine({ entry: ASK, log: LIVE_CARD, nowIso: "2026-09-02T05:28:05.000Z", startedIso: STARTED }),
    ).toBe(
      "card-stale: C9/1788324902.031449 — the card has not changed for 6.2m " +
        "(since 2026-09-02T05:21:53.000Z) while its worker is still working; its worst stall this turn was " +
        "9.2m (since 2026-09-02T04:55:02.676Z), already closed",
    );
  });

  it("adds no past-tense clause when the stretch in progress is already the worst of the turn", () => {
    expect(
      cardStaleSweepLine({ entry: ASK, log: LIVE_CARD, nowIso: "2026-09-02T05:32:00.000Z", startedIso: STARTED }),
    ).toBe(
      "card-stale: C9/1788324902.031449 — the card has not changed for 10.1m " +
        "(since 2026-09-02T05:21:53.000Z) while its worker is still working",
    );
  });

  // The cause beside the symptom. The loop session once read `card-stale:`, ran `pgrep -fl "turn
  // watch"` twice to work out why, then composed the remedy by hand — every step after the first was
  // something the sweep already had the information to say.
  it("carries the ticker clause last, after both the present and past tense halves", () => {
    expect(
      cardStaleSweepLine({
        entry: ASK,
        log: LIVE_CARD,
        nowIso: "2026-09-02T05:32:00.000Z",
        startedIso: STARTED,
        tickerClause: tickerMissingClause({ briefPath: "/home/b.json", launcher: LAUNCHER, running: false }),
      }),
    ).toBe(
      "card-stale: C9/1788324902.031449 — the card has not changed for 10.1m " +
        "(since 2026-09-02T05:21:53.000Z) while its worker is still working" +
        "; no `turn watch` process is running for this dispatch, which is why — send the worker: " +
        `\`"${LAUNCHER}" turn watch --brief /home/b.json &\``,
    );
  });

  it("prints no ticker clause at all when one is running — the default is silence", () => {
    expect(
      cardStaleSweepLine({
        entry: ASK,
        log: LIVE_CARD,
        nowIso: "2026-09-02T05:32:00.000Z",
        startedIso: STARTED,
        tickerClause: tickerMissingClause({ briefPath: "/home/b.json", launcher: LAUNCHER, running: true }),
      }),
    ).toBe(
      "card-stale: C9/1788324902.031449 — the card has not changed for 10.1m " +
        "(since 2026-09-02T05:21:53.000Z) while its worker is still working",
    );
  });

  it("reports a card that was posted and never written at all, measured from the post", () => {
    expect(
      cardStaleSweepLine({
        entry: ASK,
        log: { stages: [], timeline: [], warns: [], writes: [] },
        nowIso: "2026-09-02T05:22:00.000Z",
        startedIso: STARTED,
      }),
    ).toBe(
      "card-stale: C9/1788324902.031449 — the card has not changed for 30m " +
        "(since 2026-09-02T04:52:00.000Z) while its worker is still working",
    );
  });
});

describe("attemptChecklistAdvance", () => {
  const PLAN = {
    posted: { channel: "C1", ts: "1.1" },
    steps: [],
    task: "t",
  } as unknown as Parameters<typeof attemptChecklistAdvance>[0]["plan"];

  it("reports advanced on success", async () => {
    const outcome = await attemptChecklistAdvance({ advanceWorking: async () => undefined, plan: PLAN });

    expect(outcome).toEqual({ kind: "advanced" });
  });

  it("turns a rejected advance into a typed failed outcome, never a thrown error", async () => {
    const outcome = await attemptChecklistAdvance({
      advanceWorking: async () => {
        throw new Error("chat.appendStream: message_not_in_streaming_state");
      },
      plan: PLAN,
    });

    expect(outcome).toEqual({ kind: "failed", reason: "chat.appendStream: message_not_in_streaming_state" });
  });
});

describe("tickerRunning — is this dispatch's own clock alive", () => {
  const row = ({ argv, pid }: { argv: string; pid: number }) => ({ argv, pid, ppid: 1 });

  it("finds the ticker for the brief it was started with", () => {
    const snapshot = {
      kind: "rows" as const,
      rows: [
        row({ argv: "node /repo/bin/slopweaver turn watch --brief /home/live/slack/briefs/C1-1.1.json", pid: 42 }),
      ],
    };
    expect(tickerRunning({ briefPath: "/home/live/slack/briefs/C1-1.1.json", snapshot })).toBe(true);
  });

  it("does NOT match a ticker running for a DIFFERENT ask — the brief path is what tells them apart", () => {
    // A machine running the loop answers several asks at once; `turn watch` alone matches all of them.
    const snapshot = {
      kind: "rows" as const,
      rows: [
        row({ argv: "node /repo/bin/slopweaver turn watch --brief /home/live/slack/briefs/C9-9.9.json", pid: 42 }),
      ],
    };
    expect(tickerRunning({ briefPath: "/home/live/slack/briefs/C1-1.1.json", snapshot })).toBe(false);
  });

  it("is false when nothing at all is running", () => {
    expect(tickerRunning({ briefPath: "/home/b.json", snapshot: { kind: "rows", rows: [] } })).toBe(false);
  });

  it("is undefined for an unreadable table — 'no ticker' is a verdict, an unread table is not", () => {
    expect(tickerRunning({ briefPath: "/home/b.json", snapshot: { kind: "unreadable", problem: "ps exploded" } })).toBe(
      undefined,
    );
  });
});

describe("tickerMissingClause", () => {
  it("names the cause and the exact command when no ticker is running", () => {
    expect(tickerMissingClause({ briefPath: "/home/b.json", launcher: LAUNCHER, running: false })).toBe(
      "; no `turn watch` process is running for this dispatch, which is why — send the worker: " +
        `\`"${LAUNCHER}" turn watch --brief /home/b.json &\``,
    );
  });

  /**
   * Finding 688. The clause used to emit the literal `${CLAUDE_PLUGIN_ROOT}/bin/slopweaver` — correct in a
   * `SKILL.md`, where the harness substitutes it, and empty in the shell of the worker the loop session
   * sends this line to. The command became `/bin/slopweaver` and the trailing `&` reported exit 0 over the
   * failure, so the remedy was inert in exactly the case it exists for.
   *
   * The `not.toContain` half is evidence because the input CARRIES a launcher the positive half also
   * checks: an empty `launcher` would fail the first assertion rather than pass this one for free.
   */
  it("emits the launcher it was handed and never an unexpanded shell variable", () => {
    const clause = tickerMissingClause({ briefPath: "/home/b.json", launcher: LAUNCHER, running: false });
    expect(clause).toContain(`"${LAUNCHER}" turn watch`);
    expect(clause).not.toContain("CLAUDE_PLUGIN_ROOT");
    expect(clause).not.toContain("${");
  });

  it("says nothing when a ticker IS running — the card is stale for some other reason", () => {
    expect(tickerMissingClause({ briefPath: "/home/b.json", launcher: LAUNCHER, running: true })).toBe("");
  });

  it("says nothing when the process table could not be read — that is not evidence", () => {
    expect(tickerMissingClause({ briefPath: "/home/b.json", launcher: LAUNCHER, running: undefined })).toBe("");
  });
});
