/*
 * `foldAskLifecycle`'s `activeDispatch`: the dispatched event survives an observation appended over it, is
 * replaced by a re-dispatch, and is cleared by every event that ends the dispatch. It was split out when the
 * ask-lifecycle suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { type AskLifecycleEvent, askLifecycleKey, foldAskLifecycle } from "../../../../../live/ask/lifecycle.js";
import { A_DECISION, BASE, CAPTURED, SATISFIED } from "./harness.js";

/**
 * `activeDispatch` — the fold field that answers "is a worker holding this ask", which is a DIFFERENT
 * question from `state`'s "what happened most recently". Measured: a recovery re-capture
 * appended `checklist-posted` over a live `dispatched` event and took the ask out of the dispatch sweep.
 */
describe("foldAskLifecycle — activeDispatch", () => {
  const DISPATCHED: AskLifecycleEvent = {
    ...BASE,
    decision: A_DECISION,
    kind: "dispatched",
    leaseExpiresAt: "2026-08-05T15:26:00.000Z",
    tier: "fresh-visible-session",
    tsIso: "2026-08-05T13:27:00.000Z",
  };
  const foldOf = ({ events }: { events: readonly AskLifecycleEvent[] }) =>
    foldAskLifecycle({ events }).get(askLifecycleKey({ askIdentity: CAPTURED }))!;

  it("is absent for an ask that was never dispatched", () => {
    expect(foldOf({ events: [CAPTURED] }).activeDispatch).toBe(undefined);
  });

  it("carries the dispatched event while nothing has superseded it", () => {
    expect(foldOf({ events: [CAPTURED, DISPATCHED] }).activeDispatch).toEqual(DISPATCHED);
  });

  it("survives a checklist-posted appended over a live dispatch, while state does not", () => {
    const checklist: AskLifecycleEvent = {
      ...BASE,
      kind: "checklist-posted",
      tsIso: "2026-08-05T13:54:00.000Z",
      turnId: "turn-1787730880761",
      workingTs: "1787730881.140649",
    };
    const entry = foldOf({ events: [CAPTURED, DISPATCHED, checklist] });

    expect(entry.state).toBe("checklist-posted");
    expect(entry.activeDispatch).toEqual(DISPATCHED);
  });

  it("survives a duplicate captured appended over a live dispatch", () => {
    const entry = foldOf({ events: [CAPTURED, DISPATCHED, { ...CAPTURED, tsIso: "2026-08-05T13:54:00.000Z" }] });

    expect(entry.state).toBe("captured");
    expect(entry.activeDispatch).toEqual(DISPATCHED);
  });

  it("is replaced, not cleared, by a re-dispatch", () => {
    const again: AskLifecycleEvent = { ...DISPATCHED, leaseExpiresAt: "2026-08-05T17:00:00.000Z", tier: "inline" };

    expect(foldOf({ events: [CAPTURED, DISPATCHED, again] }).activeDispatch).toEqual(again);
  });

  it.each([
    { event: { ...BASE, answerTs: "1785000030.000100", kind: "answered" } as AskLifecycleEvent, what: "answered" },
    { event: { ...BASE, kind: "failed", reason: "the turn broke" } as AskLifecycleEvent, what: "failed" },
    { event: { ...BASE, kind: "answer-lost", reason: "the send threw" } as AskLifecycleEvent, what: "answer-lost" },
    { event: { ...BASE, kind: "dispatch-failed", reason: "no session" } as AskLifecycleEvent, what: "dispatch-failed" },
    { event: { ...BASE, kind: "lease-expired" } as AskLifecycleEvent, what: "lease-expired" },
    {
      event: { ...BASE, kind: "triaged-no-response", reason: "a greeting" } as AskLifecycleEvent,
      what: "triaged-no-response",
    },
    {
      event: { ...BASE, kind: "triage-cleanup-intended", reason: "a greeting" } as AskLifecycleEvent,
      what: "triage-cleanup-intended",
    },
    {
      event: { ...BASE, code: "n/a", kind: "withheld", queueId: "q1", reason: "held" } as AskLifecycleEvent,
      what: "withheld",
    },
    { event: SATISFIED, what: "satisfied-elsewhere" },
  ])("is cleared by $what", ({ event }) => {
    expect(foldOf({ events: [CAPTURED, DISPATCHED, event] }).activeDispatch).toBe(undefined);
  });

  it("stays cleared when an observation lands after the event that ended the dispatch", () => {
    const answered: AskLifecycleEvent = { ...BASE, answerTs: "1785000030.000100", kind: "answered" };
    const checklist: AskLifecycleEvent = {
      ...BASE,
      kind: "checklist-posted",
      tsIso: "2026-08-05T14:00:00.000Z",
      turnId: "turn-2",
      workingTs: "1785000060.000100",
    };

    expect(foldOf({ events: [CAPTURED, DISPATCHED, answered, checklist] }).activeDispatch).toBe(undefined);
  });
});
