/**
 * `freshScreenTruth` — reading LIVE terminal truth off a fresh workspace's current screen, never a cached
 * completion field. Pure: every case is a plain call against literal screen text.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { DispatchedEvent } from "../../../../live/ask/lifecycle.js";
import {
  askIdentityFromDispatchId,
  dispatchIdOf,
  type FreshDispatchRecord,
  freshScreenTruth,
  freshSessionPickupPrompt,
  parseFreshDispatchRecord,
  sameSlackWorkspace,
  sweepDecision,
  TURN_FAILED_MARKER,
  TURN_READY_MARKER,
  terminalSweepAction,
} from "../../../../live/turn/dispatch.js";
import type { ReviewPosture } from "../../../../live/turn/leaseJudgement.js";

const DISPATCH_ID = "dispatch-1";

const RECORD: FreshDispatchRecord = {
  askPermalink: "https://example.slack.com/archives/C1/p1785000000000100",
  briefPath: "/tmp/brief.json",
  channel: "C1",
  decision: {
    confidence: "high",
    needs: [],
    rationale: "a live investigation is needed",
    response: "respond",
    truthMode: "none",
    schemaVersion: 1,
    tier: "fresh-visible-session",
  },
  dispatchId: DISPATCH_ID,
  execution: { mode: "continuous-drain", supervisorHost: "claude-code" },
  leaseExpiresAt: "2026-08-12T02:00:00.000Z",
  messageTs: "1785000000.000100",
  schemaVersion: 3,
  session: {
    host: "claude-code",
    surfaceId: "id-surface:1",
    surfaceRef: "surface:1",
    workspaceId: "id-workspace:1",
    workspaceRef: "workspace:1",
  },
  threadTs: "1785000000.000100",
};

describe("parseFreshDispatchRecord", () => {
  it("accepts a well-formed record", () => {
    const result = parseFreshDispatchRecord({ value: RECORD });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual(RECORD);
  });

  it("refuses a V1 record — the schema bump requires re-dispatch, never silent reinterpretation", () => {
    const result = parseFreshDispatchRecord({ value: { ...RECORD, askPermalink: undefined, schemaVersion: 1 } });
    expect(unwrapErr(result)).toEqual([
      "Invalid input: expected string, received undefined",
      "Invalid input: expected 3",
    ]);
  });

  it("refuses a record whose decision is a no-response — only a respond decision is ever dispatched", () => {
    const result = parseFreshDispatchRecord({
      value: {
        ...RECORD,
        decision: { confidence: "high", rationale: "no request here", response: "no-response", schemaVersion: 1 },
      },
    });
    expect(unwrapErr(result)).toEqual([
      "Invalid input: expected array, received undefined",
      'Invalid input: expected "respond"',
      'Invalid option: expected one of "inline"|"read-only-subagent"|"fresh-visible-session"',
      'Invalid option: expected one of "current"|"history"|"none"',
    ]);
  });

  it("refuses a record with an unknown extra field", () => {
    const result = parseFreshDispatchRecord({ value: { ...RECORD, extra: "field" } });
    expect(unwrapErr(result)).toEqual(['Unrecognized key: "extra"']);
  });

  it("refuses a bare string", () => {
    const result = parseFreshDispatchRecord({ value: "not an object" });
    expect(unwrapErr(result)).toEqual(["Invalid input: expected object, received string"]);
  });

  it("refuses a record whose askPermalink names a different channel than the record's own identity", () => {
    const result = parseFreshDispatchRecord({
      value: { ...RECORD, askPermalink: "https://example.slack.com/archives/C999/p1785000000000100" },
    });
    expect(unwrapErr(result)).toEqual(["askPermalink channel C999 does not match the record's own channel C1"]);
  });

  it("refuses a record whose askPermalink's thread root disagrees with the record's own threadTs", () => {
    const result = parseFreshDispatchRecord({
      value: {
        ...RECORD,
        askPermalink: "https://example.slack.com/archives/C1/p1785000000000100?thread_ts=1785000000.999999&cid=C1",
      },
    });
    expect(unwrapErr(result)).toEqual([
      "askPermalink thread root 1785000000.999999 does not match the record's own threadTs 1785000000.000100",
    ]);
  });

  it("refuses a record whose askPermalink is not a valid Slack permalink at all", () => {
    const result = parseFreshDispatchRecord({ value: { ...RECORD, askPermalink: "not a url" } });
    expect(unwrapErr(result)).toEqual(["askPermalink is not a valid Slack permalink: not a URL: not a url"]);
  });

  it("accepts a reply ask's permalink, whose addressed ts and thread root both match the record", () => {
    const replyRecord: FreshDispatchRecord = {
      ...RECORD,
      askPermalink: "https://example.slack.com/archives/C1/p1785000001000200?thread_ts=1785000000.000100&cid=C1",
      messageTs: "1785000001.000200",
    };
    const result = parseFreshDispatchRecord({ value: replyRecord });
    expect(result.isOk()).toBe(true);
  });
});

describe("sameSlackWorkspace", () => {
  it("is true when both identities carry the same team id", () => {
    expect(sameSlackWorkspace({ botIdentity: { teamId: "T1" }, readIdentity: { teamId: "T1" } })).toBe(true);
  });

  it("is false when the team ids disagree", () => {
    expect(sameSlackWorkspace({ botIdentity: { teamId: "T1" }, readIdentity: { teamId: "T2" } })).toBe(false);
  });

  it("is false when the bot identity carries no team id — could not tell never reads as a match", () => {
    expect(sameSlackWorkspace({ botIdentity: {}, readIdentity: { teamId: "T1" } })).toBe(false);
  });

  it("is false when the read identity carries no team id", () => {
    expect(sameSlackWorkspace({ botIdentity: { teamId: "T1" }, readIdentity: {} })).toBe(false);
  });
});

describe("freshScreenTruth", () => {
  it("reports unreachable for an empty screen", () => {
    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen: "" })).toEqual({
      kind: "unreachable",
      reason: "the workspace surface returned no visible text",
    });
  });

  it("reports unreachable for a whitespace-only screen", () => {
    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen: "   \n  \n" })).toEqual({
      kind: "unreachable",
      reason: "the workspace surface returned no visible text",
    });
  });

  it("reports working when the screen shows real content but no marker yet", () => {
    const screen = "$ turn resume --dispatch dispatch-1\nreading the thread…";
    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen })).toEqual({ kind: "working" });
  });

  it("reports ready when the screen's last line is a matching TURN_READY marker", () => {
    const screen = [
      "$ turn resume --dispatch dispatch-1",
      "composing the answer…",
      `${TURN_READY_MARKER} ${JSON.stringify({ answerPath: "/tmp/answer.json", dispatchId: DISPATCH_ID })}`,
    ].join("\n");

    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen })).toEqual({
      answerPath: "/tmp/answer.json",
      dispatchId: DISPATCH_ID,
      kind: "ready",
    });
  });

  it("reports ready when Codex decorates command stdout with its measured tool-result prefix", () => {
    const screen = [
      "• Ran ./bin/slopweaver turn resume --answer /tmp/answer.json",
      `  └ ${TURN_READY_MARKER} ${JSON.stringify({ answerPath: "/tmp/answer.json", dispatchId: DISPATCH_ID })}`,
    ].join("\n");

    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen })).toEqual({
      answerPath: "/tmp/answer.json",
      dispatchId: DISPATCH_ID,
      kind: "ready",
    });
  });

  it("does NOT accept the marker as assistant prose with a different visible-host prefix", () => {
    const screen = `• ${TURN_READY_MARKER} ${JSON.stringify({ answerPath: "/tmp/answer.json", dispatchId: DISPATCH_ID })}`;

    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen })).toEqual({ kind: "working" });
  });

  it("reports failed when the screen's last line is a matching TURN_FAILED marker", () => {
    const screen = `${TURN_FAILED_MARKER} ${JSON.stringify({ dispatchId: DISPATCH_ID, reason: "no credential for this source" })}`;

    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen })).toEqual({
      dispatchId: DISPATCH_ID,
      kind: "failed",
      reason: "no credential for this source",
    });
  });

  /**
   * The exact trap this module exists to avoid: a workspace reused (or a screen still showing) a DIFFERENT
   * ask's own completion marker must never be read as proof THIS ask is done.
   */
  it("does NOT accept a ready marker naming a different dispatch id", () => {
    const screen = `${TURN_READY_MARKER} ${JSON.stringify({ answerPath: "/tmp/answer.json", dispatchId: "some-other-dispatch" })}`;

    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen })).toEqual({ kind: "working" });
  });

  it("does NOT accept a failed marker naming a different dispatch id", () => {
    const screen = `${TURN_FAILED_MARKER} ${JSON.stringify({ dispatchId: "some-other-dispatch", reason: "x" })}`;

    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen })).toEqual({ kind: "working" });
  });

  it("prefers the LAST marker when a retry leaves an earlier one still visible above it", () => {
    const screen = [
      `${TURN_FAILED_MARKER} ${JSON.stringify({ dispatchId: DISPATCH_ID, reason: "first attempt broke" })}`,
      "retrying…",
      `${TURN_READY_MARKER} ${JSON.stringify({ answerPath: "/tmp/answer.json", dispatchId: DISPATCH_ID })}`,
    ].join("\n");

    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen })).toEqual({
      answerPath: "/tmp/answer.json",
      dispatchId: DISPATCH_ID,
      kind: "ready",
    });
  });

  it("treats a marker line with malformed JSON as no marker at all, falling back to working", () => {
    const screen = `${TURN_READY_MARKER} {not valid json`;
    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen })).toEqual({ kind: "working" });
  });

  it("treats a ready marker missing answerPath as no marker at all", () => {
    const screen = `${TURN_READY_MARKER} ${JSON.stringify({ dispatchId: DISPATCH_ID })}`;
    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen })).toEqual({ kind: "working" });
  });

  /**
   * The confirmed bug this module cannot fix by itself: Claude Code's own TUI collapses a successful bash
   * tool call's stdout into this one-line summary and does not expand it by default, so a marker that was
   * genuinely printed is genuinely never visible on the scraped screen. `freshScreenTruth` stays pure and
   * screen-only on purpose — the durable fallback lives at its CALLER (`liveScreenRead`, checked first via
   * `turnMarkerStore.ts`), never inside this function.
   */
  it("reports working for a screen showing only Claude Code's collapsed tool-call summary — the marker is invisible", () => {
    const screen = ["$ turn resume --dispatch dispatch-1 --answer /tmp/answer.json", "Ran 1 shell command(s)"].join(
      "\n",
    );

    expect(freshScreenTruth({ dispatchId: DISPATCH_ID, screen })).toEqual({ kind: "working" });
  });
});

const ASK = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

describe("dispatchIdOf / askIdentityFromDispatchId", () => {
  it("round-trips an ask identity through the encoded id exactly", () => {
    expect(askIdentityFromDispatchId({ dispatchId: dispatchIdOf({ askIdentity: ASK }) })).toEqual(ASK);
  });

  it("gives two different asks two different ids", () => {
    expect(dispatchIdOf({ askIdentity: ASK })).not.toBe(dispatchIdOf({ askIdentity: { ...ASK, messageTs: "2.2" } }));
  });

  it("refuses a token that is not JSON", () => {
    expect(askIdentityFromDispatchId({ dispatchId: "not json" })).toBeUndefined();
  });

  it("refuses a token that decodes to the wrong shape", () => {
    expect(askIdentityFromDispatchId({ dispatchId: JSON.stringify(["only", "two"]) })).toBeUndefined();
  });

  it("refuses a token whose elements are not all strings", () => {
    expect(askIdentityFromDispatchId({ dispatchId: JSON.stringify(["C1", 2, "1.1"]) })).toBeUndefined();
  });
});

/** No review has ever been opened for the ask — the posture that grants no hold at all. */
const NO_REVIEW: ReviewPosture = { hasUsableVerdict: false, inFlight: false, recordOpen: false, spawnedAt: undefined };

describe("sweepDecision", () => {
  const DISPATCHED: DispatchedEvent = {
    ...ASK,
    decision: RECORD.decision,
    kind: "dispatched",
    leaseExpiresAt: "2026-08-12T02:00:00.000Z",
    tier: "fresh-visible-session",
    tsIso: "2026-08-12T00:00:00.000Z",
  };

  /** The dispatch's own workspace, polled and found to be holding no session at all. */
  const PHANTOM = { kind: "phantom", reason: "nothing behind the green light", workspaceId: "ws-dead" } as const;

  it("reports phantom over a review ROUND hold — an empty workspace refutes a claim about a live worker", () => {
    // Widening the hold to cover the between-rounds window would otherwise hide a dead worker
    // for up to MAX_REVIEW_HOLD_HOURS, which is the class `phantom` exists for.
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      review: { hasUsableVerdict: false, inFlight: false, recordOpen: true, spawnedAt: "2026-08-12T02:30:00.000Z" },
      screenTruth: PHANTOM,
    });
    expect(action).toEqual({ ask: ASK, kind: "phantom", reason: "nothing behind the green light" });
  });

  it("reports phantom over a mid-verdict hold too, for the same reason", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      review: { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt: "2026-08-12T02:30:00.000Z" },
      screenTruth: PHANTOM,
    });
    expect(action).toEqual({ ask: ASK, kind: "phantom", reason: "nothing behind the green light" });
  });

  it("keeps a VERIFIED answer over a phantom screen — the one hold that outranks live screen truth", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      review: { hasUsableVerdict: true, inFlight: false, recordOpen: true, spawnedAt: "2026-08-12T02:30:00.000Z" },
      screenTruth: PHANTOM,
    });
    expect(action).toEqual({
      ask: ASK,
      because: "a clean verdict for this exact answer is already written — the work is done and the answer is postable",
      kind: "lease-held",
    });
  });

  it("holds the clock between rounds when the screen shows a live worker", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      review: { hasUsableVerdict: false, inFlight: false, recordOpen: true, spawnedAt: "2026-08-12T02:30:00.000Z" },
      screenTruth: { kind: "working" },
    });
    expect(action).toEqual({
      ask: ASK,
      because:
        "a review round has returned but the review is not released — the worker is inside the fix-and-re-review loop a broken verdict opens",
      kind: "lease-held",
    });
  });

  /** This ask's own ready marker — validated by its worker, not yet through the door. */
  const READY = {
    answerPath: "/tmp/answer.json",
    dispatchId: dispatchIdOf({ askIdentity: ASK }),
    kind: "ready",
  } as const;

  it("reports ready when the screen says ready for THIS ask's own dispatch id, inside the lease", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T01:59:59.999Z",
      review: NO_REVIEW,
      screenTruth: READY,
    });
    expect(action).toEqual({ answerPath: "/tmp/answer.json", ask: ASK, kind: "ready" });
  });

  it("reports lease-expired over a ready marker once the lease has passed and nothing holds it", () => {
    // D0SYN000001/1789422881.103369: a paused turn's ready marker outranked the lease for good,
    // so the sweep printed `0 lease-expired` and `session respawn loop` refused on it indefinitely.
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:40:00.000Z",
      review: NO_REVIEW,
      screenTruth: READY,
    });
    expect(action).toEqual({ ask: ASK, kind: "lease-expired" });
  });

  it("keeps a ready answer past an unheld lease while its worker is alive — it closed a broken round to fix the answer", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:40:00.000Z",
      readyWorkerAlive: true,
      review: NO_REVIEW,
      screenTruth: READY,
    });
    expect(action).toEqual({ answerPath: "/tmp/answer.json", ask: ASK, kind: "ready" });
  });

  it("stops the live-worker reprieve once the hold cap past the lease has run out — an idle open tab is not a worker", () => {
    // With MAX_REVIEW_HOLD_HOURS at 2, the edge is two hours past the lease and a paused session left open ends here.
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T04:00:00.000Z",
      readyWorkerAlive: true,
      review: NO_REVIEW,
      screenTruth: READY,
    });
    expect(action).toEqual({ ask: ASK, kind: "lease-expired" });
  });

  it("a live worker is no reprieve for a working screen past its lease — only a ready answer is weighed", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:40:00.000Z",
      readyWorkerAlive: true,
      review: NO_REVIEW,
      screenTruth: { kind: "working" },
    });
    expect(action).toEqual({ ask: ASK, kind: "lease-expired" });
  });

  it("keeps a ready answer past the lease when a clean verdict for it is written — a verified answer is never discarded", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:40:00.000Z",
      review: { hasUsableVerdict: true, inFlight: false, recordOpen: false, spawnedAt: "2026-08-12T01:30:00.000Z" },
      screenTruth: READY,
    });
    expect(action).toEqual({ answerPath: "/tmp/answer.json", ask: ASK, kind: "ready" });
  });

  it("keeps a ready answer past the lease while its reviewer is mid-verdict inside the hold", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      review: { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt: "2026-08-12T02:30:00.000Z" },
      screenTruth: READY,
    });
    expect(action).toEqual({ answerPath: "/tmp/answer.json", ask: ASK, kind: "ready" });
  });

  it("expires a ready answer whose reviewer has outlived the hold cap", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T05:00:00.000Z",
      review: { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt: "2026-08-12T02:30:00.000Z" },
      screenTruth: READY,
    });
    expect(action).toEqual({ ask: ASK, kind: "lease-expired" });
  });

  it("never reports ready from a screenTruth carrying a DIFFERENT dispatch's id, lease-expired instead", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      review: NO_REVIEW,
      screenTruth: { answerPath: "/tmp/other-answer.json", dispatchId: "some-other-dispatch", kind: "ready" },
    });
    expect(action).toEqual({ ask: ASK, kind: "lease-expired" });
  });

  it("reports worker-failed when the screen carries THIS ask's failed marker, even past the lease edge", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      review: NO_REVIEW,
      screenTruth: {
        dispatchId: dispatchIdOf({ askIdentity: ASK }),
        kind: "failed",
        reason: "no login for the portal",
      },
    });
    expect(action).toEqual({ ask: ASK, kind: "worker-failed", reason: "no login for the portal" });
  });

  it("never reports worker-failed from a failed marker naming a DIFFERENT dispatch — still working inside the lease", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T01:00:00.000Z",
      review: NO_REVIEW,
      screenTruth: { dispatchId: "some-other-dispatch", kind: "failed", reason: "not this ask's" },
    });
    expect(action).toEqual({ ask: ASK, kind: "still-working" });
  });

  it("a validate refusal is not terminal — only a worker's own failed marker moves this to worker-failed", () => {
    // `turn resume --answer` writes no marker at all when its own validate step refuses an answer (see
    // `resume.ts`'s `refuseComposeTime`) — the screen still reads `working`, exactly as it does before any
    // marker exists. sweepDecision must keep reading that as still-working, never as worker-failed, because
    // only `--failed` (the worker's OWN terminal report) ever produces a `failed` screenTruth.
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T01:00:00.000Z",
      review: NO_REVIEW,
      screenTruth: { kind: "working" },
    });
    expect(action).toEqual({ ask: ASK, kind: "still-working" });
  });

  it("reports still-working when the lease has not expired and the screen is not ready", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T01:00:00.000Z",
      review: NO_REVIEW,
      screenTruth: { kind: "working" },
    });
    expect(action).toEqual({ ask: ASK, kind: "still-working" });
  });

  it("reports lease-expired once the lease has passed and the screen is not ready", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      review: NO_REVIEW,
      screenTruth: { kind: "working" },
    });
    expect(action).toEqual({ ask: ASK, kind: "lease-expired" });
  });

  it("checks the lease alone when there is no screen to poll — an inline/subagent dispatch", () => {
    const stillWorking = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T01:00:00.000Z",
      review: NO_REVIEW,
      screenTruth: undefined,
    });
    const expired = sweepDecision({
      ask: ASK,
      dispatched: DISPATCHED,
      nowIso: "2026-08-12T03:00:00.000Z",
      review: NO_REVIEW,
      screenTruth: undefined,
    });
    expect(stillWorking).toEqual({ ask: ASK, kind: "still-working" });
    expect(expired).toEqual({ ask: ASK, kind: "lease-expired" });
  });
});

describe("freshSessionPickupPrompt", () => {
  it("names the exact dispatch id in the load command the worker runs first", () => {
    const prompt = freshSessionPickupPrompt({ dispatchId: "dispatch-1" });
    expect(prompt).toContain("`slopweaver turn resume --dispatch dispatch-1`");
  });

  it("tells the worker it owns the ask to its terminal outcome — resume, review, and post itself", () => {
    const prompt = freshSessionPickupPrompt({ dispatchId: DISPATCH_ID });
    expect(prompt).toContain(`slopweaver turn resume --dispatch ${DISPATCH_ID}`);
    expect(prompt).toContain("get it reviewed by an independent reviewer (`turn review`)");
    expect(prompt).toContain("post it yourself through the door (`turn answer --dispatch … --verdict …`)");
    expect(prompt).toContain("`turn resume --failed`");
    expect(prompt).not.toContain("\n");
  });
});

describe("terminalSweepAction", () => {
  const INLINE: DispatchedEvent = {
    ...ASK,
    decision: RECORD.decision,
    kind: "dispatched",
    leaseExpiresAt: "2026-09-13T18:08:23.366Z",
    tier: "inline",
    tsIso: "2026-09-13T16:08:23.369Z",
  };

  it("does not end an inline ask whose reviewer is mid-verdict — the lease-held arm that reaped three reviewers", () => {
    const action = sweepDecision({
      ask: ASK,
      dispatched: INLINE,
      nowIso: "2026-09-13T16:12:55.000Z",
      review: { hasUsableVerdict: false, inFlight: true, recordOpen: true, spawnedAt: "2026-09-13T16:09:22.000Z" },
      screenTruth: undefined,
    });
    expect(action.kind).toBe("lease-held");
    expect(terminalSweepAction({ action })).toBeUndefined();
  });

  it("narrows exactly the three arms that end an ask, and none of the other three", () => {
    const terminal = [
      { ask: ASK, kind: "worker-failed", reason: "no login" },
      { ask: ASK, kind: "lease-expired" },
      { ask: ASK, kind: "phantom", reason: "nothing behind the green light" },
    ] as const;
    const working = [
      { ask: ASK, kind: "still-working" },
      { answerPath: "/tmp/answer.json", ask: ASK, kind: "ready" },
      { ask: ASK, because: "a clean verdict for this exact answer is already written", kind: "lease-held" },
    ] as const;
    expect(terminal.map((action) => terminalSweepAction({ action }))).toEqual(terminal);
    expect(working.map((action) => terminalSweepAction({ action }))).toEqual([undefined, undefined, undefined]);
  });
});
