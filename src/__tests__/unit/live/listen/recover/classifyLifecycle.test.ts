/**
 * FILTERED dropped-tag recovery — what the ask-lifecycle log and the thread itself already say about a candidate.
 *
 * Pure, so every case is a plain call with no Slack in sight: a resolved, in-flight, blocked or already-worked ask
 * is excluded by its own lifecycle entry, a stranded one is picked up once, and a bot card already in the ask's
 * interval reports as `answered-in-thread`. The identity, place and registry exclusions are in
 * `classifyCandidate.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { type AskLifecycle, askLifecycleKey } from "../../../../../live/ask/lifecycle.js";
import type { ThreadMark } from "../../../../../live/listen/answeredInThread.js";
import { CARD_EVENT_TYPE, classify, DISPATCHED_EVENT, EXACT_ANSWER, SINCE, UNANSWERED } from "./fixtures.js";

describe("classifyCandidate", () => {
  /** Wrap one lifecycle entry into the single-entry map `classifyCandidate` reads it through. */
  const lifecyclesWith = ({ lifecycle }: { lifecycle: AskLifecycle }): ReadonlyMap<string, AskLifecycle> =>
    new Map([[askLifecycleKey({ askIdentity: lifecycle }), lifecycle]]);

  /**
   * A deliberate no-response resolution posts NOTHING — scenario 4's whole point — so `already-answered`
   * (which matches a real posted message's metadata) can never catch it. Without a lifecycle-aware check, a
   * genuinely resolved ask would be resurfaced by every future recovery pass forever.
   */
  it("excludes a candidate the ask-lifecycle log already resolved as triaged-no-response", () => {
    const lifecycle: AskLifecycle = {
      capturedIso: SINCE,
      channel: UNANSWERED.channel,
      lastEvent: { ...UNANSWERED, kind: "triaged-no-response", reason: "casual greeting", tsIso: SINCE },
      messageTs: UNANSWERED.messageTs,
      state: "triaged-no-response",
      surface: "channel",
      threadTs: UNANSWERED.threadTs,
      userId: UNANSWERED.userId,
    };
    expect(classify({ lifecycles: lifecyclesWith({ lifecycle }) }).exclusions).toEqual(["already-resolved"]);
  });

  it("excludes a candidate the ask-lifecycle log already resolved as withheld", () => {
    const lifecycle: AskLifecycle = {
      capturedIso: SINCE,
      channel: UNANSWERED.channel,
      lastEvent: { ...UNANSWERED, code: "n/a", kind: "withheld", queueId: "q1", reason: "n/a", tsIso: SINCE },
      messageTs: UNANSWERED.messageTs,
      state: "withheld",
      surface: "channel",
      threadTs: UNANSWERED.threadTs,
      userId: UNANSWERED.userId,
    };
    expect(classify({ lifecycles: lifecyclesWith({ lifecycle }) }).exclusions).toEqual(["already-resolved"]);
  });

  /**
   * `triage-cleanup-intended` is deliberately NOT terminal — a sweep or recovery pass is exactly what is
   * supposed to find it still pending, per `../ask/lifecycle.ts`'s own doc comment on that event.
   */
  it("does NOT exclude a candidate stuck at the non-terminal triage-cleanup-intended", () => {
    const lifecycle: AskLifecycle = {
      capturedIso: SINCE,
      channel: UNANSWERED.channel,
      lastEvent: { ...UNANSWERED, kind: "triage-cleanup-intended", reason: "casual greeting", tsIso: SINCE },
      messageTs: UNANSWERED.messageTs,
      state: "triage-cleanup-intended",
      surface: "channel",
      threadTs: UNANSWERED.threadTs,
      userId: UNANSWERED.userId,
    };
    expect(classify({ lifecycles: lifecyclesWith({ lifecycle }) }).exclusions).toEqual([]);
  });

  /**
   * The scheduled-recovery incident, as a unit: message `1787720846.032529` was `dispatched` to a live
   * `fresh-visible-session` worker when a scheduled recovery pass re-captured it, posting a second working
   * card the worker would never finalise.
   */
  it("excludes a candidate a live worker is holding — dispatched", () => {
    const lifecycle: AskLifecycle = {
      activeDispatch: DISPATCHED_EVENT,
      capturedIso: SINCE,
      channel: UNANSWERED.channel,
      lastEvent: DISPATCHED_EVENT,
      messageTs: UNANSWERED.messageTs,
      state: "dispatched",
      surface: "channel",
      threadTs: UNANSWERED.threadTs,
      userId: UNANSWERED.userId,
    };
    const verdict = classify({ lifecycles: lifecyclesWith({ lifecycle }) });

    expect(verdict.exclusions).toEqual(["in-flight"]);
    expect(verdict.why[0]).toContain("a turn is holding this ask right now (dispatched)");
    expect(verdict.mention).toBe(undefined);
  });

  it("excludes a candidate waiting on the owner — not dropped, and not done", () => {
    const blocked = {
      ...UNANSWERED,
      kind: "blocked-on-human",
      need: "sign-in",
      stepText: "Waiting on the owner: sign in to Google Cloud locally",
      tsIso: SINCE,
      what: "sign in to Google Cloud locally",
    } as const;
    const lifecycle: AskLifecycle = {
      blockedOnHuman: blocked,
      capturedIso: SINCE,
      channel: UNANSWERED.channel,
      lastEvent: blocked,
      messageTs: UNANSWERED.messageTs,
      state: "blocked-on-human",
      surface: "channel",
      threadTs: UNANSWERED.threadTs,
      userId: UNANSWERED.userId,
    };
    const verdict = classify({ lifecycles: lifecyclesWith({ lifecycle }) });
    expect(verdict.exclusions).toEqual(["blocked-on-human"]);
    expect(verdict.why[0]).toContain("sign in to Google Cloud locally");
    expect(verdict.mention).toBe(undefined);
  });

  it("excludes a candidate the owner has already cleared, which is owed a resume rather than a re-capture", () => {
    const unblocked = {
      ...UNANSWERED,
      kind: "unblocked",
      lifted: { need: "sign-in", what: "sign in to Google Cloud locally" },
      note: "signed in",
      tsIso: SINCE,
    } as const;
    const lifecycle: AskLifecycle = {
      capturedIso: SINCE,
      channel: UNANSWERED.channel,
      lastEvent: unblocked,
      messageTs: UNANSWERED.messageTs,
      state: "unblocked",
      surface: "channel",
      threadTs: UNANSWERED.threadTs,
      userId: UNANSWERED.userId,
    };
    const verdict = classify({ lifecycles: lifecyclesWith({ lifecycle }) });
    expect(verdict.exclusions).toEqual(["blocked-on-human"]);
    expect(verdict.why[0]).toContain("owes it one `turn dispatch`");
  });

  it("excludes a candidate whose capture checklist is already posted", () => {
    const lifecycle: AskLifecycle = {
      capturedIso: SINCE,
      channel: UNANSWERED.channel,
      lastEvent: { ...UNANSWERED, kind: "checklist-posted", tsIso: SINCE, turnId: "turn-1", workingTs: "2.2" },
      messageTs: UNANSWERED.messageTs,
      started: { turnId: "turn-1", workingTs: "2.2" },
      state: "checklist-posted",
      surface: "channel",
      threadTs: UNANSWERED.threadTs,
      userId: UNANSWERED.userId,
    };
    expect(classify({ lifecycles: lifecyclesWith({ lifecycle }) }).exclusions).toEqual(["in-flight"]);
  });

  it("excludes a candidate the listener has already captured and nothing else has touched", () => {
    const lifecycle: AskLifecycle = {
      capturedIso: SINCE,
      channel: UNANSWERED.channel,
      lastEvent: { ...UNANSWERED, kind: "captured", surface: "channel", tsIso: SINCE, userId: UNANSWERED.userId },
      messageTs: UNANSWERED.messageTs,
      state: "captured",
      surface: "channel",
      threadTs: UNANSWERED.threadTs,
      userId: UNANSWERED.userId,
    };
    expect(classify({ lifecycles: lifecyclesWith({ lifecycle }) }).exclusions).toEqual(["in-flight"]);
  });

  /**
   * The other half of the same pass: `1787720788.183959` had `failed` 37 minutes earlier, and re-capturing it
   * queued a dead ask as a live burst candidate.
   *
   * The owner's one-re-dispatch ruling is what makes this the FIRST pick-up rather than an exclusion: a stranded
   * ask with no spend record on its fold is a survivor a running visible session picks up once. The
   * exclusion that used to fire here is the one directly below, and it fires from the second time onward.
   */
  it.each([
    { reason: "reviewer pickup broke", state: "failed" as const },
    { reason: "no session in the workspace", state: "dispatch-failed" as const },
    { reason: "its lease ran out", state: "lease-expired" as const },
  ])("recovers a candidate stranded at $state whose one re-dispatch is unspent", ({ reason, state }) => {
    const lifecycle: AskLifecycle = {
      capturedIso: SINCE,
      channel: UNANSWERED.channel,
      lastEvent: { ...UNANSWERED, kind: state, reason, tsIso: SINCE },
      messageTs: UNANSWERED.messageTs,
      state,
      surface: "channel",
      threadTs: UNANSWERED.threadTs,
      userId: UNANSWERED.userId,
    };
    expect(classify({ lifecycles: lifecyclesWith({ lifecycle }), strandedLane: true }).exclusions).toEqual([]);
    // Without the opt-in, the ordinary window scan still refuses it — one path to a stranded ask, never two.
    expect(classify({ lifecycles: lifecyclesWith({ lifecycle }) }).exclusions).toEqual(["already-worked"]);
  });

  it.each([
    { reason: "reviewer pickup broke", state: "failed" as const },
    { reason: "no session in the workspace", state: "dispatch-failed" as const },
    { reason: "its lease ran out", state: "lease-expired" as const },
  ])("excludes a candidate stranded at $state that already spent its re-dispatch", ({ reason, state }) => {
    const lifecycle: AskLifecycle = {
      capturedIso: SINCE,
      channel: UNANSWERED.channel,
      lastEvent: { ...UNANSWERED, kind: state, reason, tsIso: SINCE },
      messageTs: UNANSWERED.messageTs,
      redispatched: {
        ...UNANSWERED,
        kind: "redispatched",
        reason: "picked up once already",
        strandedAs: state,
        tsIso: SINCE,
      },
      state,
      surface: "channel",
      threadTs: UNANSWERED.threadTs,
      userId: UNANSWERED.userId,
    };
    const verdict = classify({ lifecycles: lifecyclesWith({ lifecycle }), strandedLane: true });

    expect(verdict.exclusions).toEqual(["already-worked"]);
    expect(verdict.why[0]).toContain("its one re-dispatch");
  });

  /**
   * `answer-lost` is stranded by neither set: an answer that was composed and then lost is not a turn that
   * failed to produce one, so it is excluded permanently and no spend record can exempt it.
   */
  it("excludes a candidate whose answer was lost, with no re-dispatch available to it", () => {
    const lifecycle: AskLifecycle = {
      capturedIso: SINCE,
      channel: UNANSWERED.channel,
      lastEvent: { ...UNANSWERED, kind: "answer-lost", reason: "the message vanished", tsIso: SINCE },
      messageTs: UNANSWERED.messageTs,
      state: "answer-lost",
      surface: "channel",
      threadTs: UNANSWERED.threadTs,
      userId: UNANSWERED.userId,
    };
    expect(classify({ lifecycles: lifecyclesWith({ lifecycle }), strandedLane: true }).exclusions).toEqual([
      "already-worked",
    ]);
  });

  it("never marks a dispatched ask in-flight when the dispatch belongs to a DIFFERENT message", () => {
    const other = { ...UNANSWERED, messageTs: "9999999999.000000" };
    const lifecycle: AskLifecycle = {
      capturedIso: SINCE,
      channel: other.channel,
      lastEvent: { ...DISPATCHED_EVENT, messageTs: other.messageTs },
      messageTs: other.messageTs,
      state: "dispatched",
      surface: "channel",
      threadTs: other.threadTs,
      userId: other.userId,
    };
    expect(classify({ lifecycles: lifecyclesWith({ lifecycle }) }).exclusions).toEqual([]);
  });

  it("never excludes a DIFFERENT ask that merely shares the resolved one's channel", () => {
    const other = { ...UNANSWERED, messageTs: "9999999999.000000" };
    const lifecycle: AskLifecycle = {
      capturedIso: SINCE,
      channel: other.channel,
      lastEvent: { ...other, kind: "triaged-no-response", reason: "n/a", tsIso: SINCE },
      messageTs: other.messageTs,
      state: "triaged-no-response",
      surface: "channel",
      threadTs: other.threadTs,
      userId: other.userId,
    };
    expect(classify({ lifecycles: lifecyclesWith({ lifecycle }) }).exclusions).toEqual([]);
  });

  /**
   * `answered-in-thread` — the WIRING only. The interval, the two traps and the stranded lane are the
   * mechanism, and they are proved directly against `answeredInThread` in `answeredInThread.test.ts`; what
   * these two cases hold down is that `classifyCandidate` reaches it and reports it as its own exclusion.
   */
  describe("answered-in-thread", () => {
    const CARD: ThreadMark = {
      hasSubtype: false,
      metadataEventType: CARD_EVENT_TYPE,
      selfAuthoredReason: "confirmed-match",
      text: "the answer",
      ts: "1785000100.000200",
      userId: "B_SELF",
    };

    it("excludes a candidate whose own interval carries a bot card this install posted", () => {
      const verdict = classify({ over: { threadMarks: [CARD] } });

      expect(verdict.exclusions).toEqual(["answered-in-thread"]);
      expect(verdict.why.join("\n")).toContain("already posted a bot card at 1785000100.000200");
    });

    it("reports beside `already-answered` rather than folded into it — the two claims differ in strength", () => {
      expect(classify({ over: { threadAnswers: [EXACT_ANSWER], threadMarks: [CARD] } }).exclusions).toEqual([
        "already-answered",
        "answered-in-thread",
      ]);
    });
  });
});
