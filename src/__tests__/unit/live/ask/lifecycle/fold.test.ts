/*
 * `foldAskLifecycle`: append-only events fold into one entry per captured ask, advancing state while keeping the
 * original capture instant and the `started` checklist pair, ignoring an event for a never-captured key, and
 * holding each cleanup intent as its own non-terminal state. It was split out when the ask-lifecycle suite
 * became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import {
  type AskLifecycleEvent,
  askLifecycleKey,
  type CapturedEvent,
  foldAskLifecycle,
  terminalAskLifecycleEvent,
} from "../../../../../live/ask/lifecycle.js";
import { A_CHECKLIST, A_DECISION, BASE, CAPTURED } from "./harness.js";

describe("foldAskLifecycle", () => {
  it("folds a captured event alone to state captured", () => {
    const fold = foldAskLifecycle({ events: [CAPTURED] });

    expect(fold.get(askLifecycleKey({ askIdentity: CAPTURED }))).toEqual({
      capturedIso: CAPTURED.tsIso,
      channel: CAPTURED.channel,
      lastEvent: CAPTURED,
      messageTs: CAPTURED.messageTs,
      state: "captured",
      surface: CAPTURED.surface,
      threadTs: CAPTURED.threadTs,
      userId: CAPTURED.userId,
    });
  });

  it("advances state on a later event for the same key, keeping the original capturedIso", () => {
    const dispatched: AskLifecycleEvent = {
      ...BASE,
      decision: A_DECISION,
      kind: "dispatched",
      leaseExpiresAt: "2026-08-05T13:31:00.000Z",
      tier: "fresh-visible-session",
    };
    const answered: AskLifecycleEvent = { ...BASE, answerTs: "1785000030.000100", kind: "answered" };

    const fold = foldAskLifecycle({ events: [CAPTURED, dispatched, answered] });
    const entry = fold.get(askLifecycleKey({ askIdentity: CAPTURED }))!;

    expect(entry.state).toBe("answered");
    expect(entry.capturedIso).toBe(CAPTURED.tsIso);
    expect(entry.lastEvent).toEqual(answered);
  });

  it("ignores an event for a key that was never captured", () => {
    const orphan: AskLifecycleEvent = { ...BASE, answerTs: "x", channel: "C_NEVER_CAPTURED", kind: "answered" };

    const fold = foldAskLifecycle({ events: [orphan] });

    expect(fold.size).toBe(0);
  });

  /**
   * A colon-delimited `${channel}:${messageTs}` key would collide here: `("C:A", "1")` and `("C", "A:1")`
   * both join to `"C:A:1"`. An orphan event for the SECOND, never-captured tuple must not be mistaken for
   * an update to the FIRST tuple's genuinely captured entry.
   */
  it("does not let an orphan event for one tuple update a captured entry for a different, colliding-if-joined tuple", () => {
    const captured: CapturedEvent = {
      ...BASE,
      channel: "C:A",
      kind: "captured",
      messageTs: "1",
      surface: "channel",
      userId: "U1",
    };
    const orphanAnswer: AskLifecycleEvent = {
      ...BASE,
      answerTs: "2",
      channel: "C",
      kind: "answered",
      messageTs: "A:1",
    };

    const fold = foldAskLifecycle({ events: [captured, orphanAnswer] });
    const entry = fold.get(askLifecycleKey({ askIdentity: captured }))!;

    expect(fold.size).toBe(1);
    expect(entry.state).toBe("captured");
  });

  it("keeps two asks sharing a thread as separate fold entries", () => {
    const second: CapturedEvent = { ...CAPTURED, messageTs: "1785000000.000200" };

    const fold = foldAskLifecycle({ events: [CAPTURED, second] });

    expect(fold.size).toBe(2);
  });

  it("folds to triaged-no-response as a genuine terminal state, not a failure", () => {
    const triaged: AskLifecycleEvent = { ...BASE, kind: "triaged-no-response", reason: "already resolved elsewhere" };

    const fold = foldAskLifecycle({ events: [CAPTURED, triaged] });
    const entry = fold.get(askLifecycleKey({ askIdentity: CAPTURED }))!;

    expect(entry.state).toBe("triaged-no-response");
    expect(entry.lastEvent).toEqual(triaged);
  });

  it("folds a checklist-posted event into `started`, alongside its own state", () => {
    const posted: AskLifecycleEvent = {
      ...BASE,
      kind: "checklist-posted",
      turnId: "turn-1",
      workingTs: "1785000000.000900",
    };

    const fold = foldAskLifecycle({ events: [CAPTURED, posted] });
    const entry = fold.get(askLifecycleKey({ askIdentity: CAPTURED }))!;

    expect(entry.state).toBe("checklist-posted");
    expect(entry.started).toEqual({ turnId: "turn-1", workingTs: "1785000000.000900" });
  });

  it("keeps `started` once a LATER event advances state past checklist-posted", () => {
    const posted: AskLifecycleEvent = {
      ...BASE,
      kind: "checklist-posted",
      turnId: "turn-1",
      workingTs: "1785000000.000900",
    };
    const dispatched: AskLifecycleEvent = {
      ...BASE,
      decision: A_DECISION,
      kind: "dispatched",
      leaseExpiresAt: "2026-08-05T13:31:00.000Z",
      tier: "inline",
    };

    const fold = foldAskLifecycle({ events: [CAPTURED, posted, dispatched] });
    const entry = fold.get(askLifecycleKey({ askIdentity: CAPTURED }))!;

    expect(entry.state).toBe("dispatched");
    expect(entry.started).toEqual({ turnId: "turn-1", workingTs: "1785000000.000900" });
  });

  /**
   * A duplicate `captured` (a redelivered Slack event, a retried capture) used to
   * rebuild the fold entry from scratch, discarding `started` even though the underlying `checklist-posted`
   * event was still in the log. `startedRefForAsk` returning `undefined` for an ask that genuinely HAD a
   * durably recorded checklist would silently re-open the false-terminal risk `handleNoResponse`'s
   * delete-target fix exists to close.
   */
  it("preserves `started` across a DUPLICATE captured event for the same ask", () => {
    const posted: AskLifecycleEvent = {
      ...BASE,
      kind: "checklist-posted",
      turnId: "turn-real",
      workingTs: "1785000000.000900",
    };
    const recaptured: CapturedEvent = { ...CAPTURED, tsIso: "1785000010.000000" };

    const fold = foldAskLifecycle({ events: [CAPTURED, posted, recaptured] });
    const entry = fold.get(askLifecycleKey({ askIdentity: CAPTURED }))!;

    expect(entry.state).toBe("captured");
    expect(entry.started).toEqual({ turnId: "turn-real", workingTs: "1785000000.000900" });
  });

  it("has no `started` at all when no checklist-posted event was ever folded in", () => {
    const fold = foldAskLifecycle({ events: [CAPTURED] });
    const entry = fold.get(askLifecycleKey({ askIdentity: CAPTURED }))!;

    expect(entry.started).toBe(undefined);
  });

  it("ignores a checklist-posted event for a key that was never captured", () => {
    const orphanPosted: AskLifecycleEvent = {
      ...BASE,
      channel: "C_NEVER_CAPTURED",
      kind: "checklist-posted",
      turnId: A_CHECKLIST.turnId,
      workingTs: A_CHECKLIST.workingTs,
    };

    const fold = foldAskLifecycle({ events: [orphanPosted] });

    expect(fold.size).toBe(0);
  });

  it("keeps the started pair once attached, through every later terminal event", () => {
    const posted: AskLifecycleEvent = {
      ...BASE,
      kind: "checklist-posted",
      turnId: A_CHECKLIST.turnId,
      workingTs: A_CHECKLIST.workingTs,
    };
    const answered: AskLifecycleEvent = { ...BASE, answerTs: "1785000030.000100", kind: "answered" };

    const fold = foldAskLifecycle({ events: [CAPTURED, posted, answered] });
    const entry = fold.get(askLifecycleKey({ askIdentity: CAPTURED }))!;

    expect(entry.state).toBe("answered");
    expect(entry.started).toEqual(A_CHECKLIST);
  });

  it("folds triage-cleanup-intended as its own real, non-terminal state, preserving the exact delete target", () => {
    const posted: AskLifecycleEvent = {
      ...BASE,
      kind: "checklist-posted",
      turnId: A_CHECKLIST.turnId,
      workingTs: A_CHECKLIST.workingTs,
    };
    const intended: AskLifecycleEvent = {
      ...BASE,
      checklistDelete: A_CHECKLIST,
      kind: "triage-cleanup-intended",
      reason: "casual greeting, no reply owed",
    };

    const fold = foldAskLifecycle({ events: [CAPTURED, posted, intended] });
    const entry = fold.get(askLifecycleKey({ askIdentity: CAPTURED }))!;

    expect(entry.state).toBe("triage-cleanup-intended");
    expect(entry.lastEvent).toEqual(intended);
    expect(entry.started).toEqual(A_CHECKLIST);
  });

  it("advances from triage-cleanup-intended to the terminal triaged-no-response once cleanup is confirmed", () => {
    const intended: AskLifecycleEvent = {
      ...BASE,
      checklistDelete: A_CHECKLIST,
      kind: "triage-cleanup-intended",
      reason: "casual greeting, no reply owed",
    };
    const triaged: AskLifecycleEvent = {
      ...BASE,
      kind: "triaged-no-response",
      reason: "casual greeting, no reply owed",
    };

    const fold = foldAskLifecycle({ events: [CAPTURED, intended, triaged] });
    const entry = fold.get(askLifecycleKey({ askIdentity: CAPTURED }))!;

    expect(entry.state).toBe("triaged-no-response");
  });

  it("holds handover-cleanup-intended as a non-terminal state, then advances to left-for-a-human", () => {
    const intended: AskLifecycleEvent = {
      ...BASE,
      checklistDelete: A_CHECKLIST,
      kind: "handover-cleanup-intended",
      reason: "a lockout is IT's to answer",
    };
    const left: AskLifecycleEvent = { ...BASE, kind: "left-for-a-human", reason: "a lockout is IT's to answer" };

    const stalled = foldAskLifecycle({ events: [CAPTURED, intended] }).get(askLifecycleKey({ askIdentity: CAPTURED }))!;
    const settled = foldAskLifecycle({ events: [CAPTURED, intended, left] }).get(
      askLifecycleKey({ askIdentity: CAPTURED }),
    )!;

    expect(stalled.state).toBe("handover-cleanup-intended");
    expect(terminalAskLifecycleEvent({ event: intended })).toBeUndefined();
    expect(settled.state).toBe("left-for-a-human");
    expect(settled.lastEvent).toEqual(left);
  });

  it("re-dispatches after a lease-expired event rather than staying stuck", () => {
    const expired: AskLifecycleEvent = { ...BASE, kind: "lease-expired" };
    const redispatched: AskLifecycleEvent = {
      ...BASE,
      decision: A_DECISION,
      kind: "dispatched",
      leaseExpiresAt: "2026-08-05T14:00:00.000Z",
      tier: "inline",
    };

    const fold = foldAskLifecycle({ events: [CAPTURED, expired, redispatched] });
    const entry = fold.get(askLifecycleKey({ askIdentity: CAPTURED }))!;

    expect(entry.state).toBe("dispatched");
  });
});
