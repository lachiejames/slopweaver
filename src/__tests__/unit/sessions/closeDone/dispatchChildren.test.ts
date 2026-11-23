/**
 * Which dispatch children every captured ask names, and when a terminal event on the lifecycle log is the
 * ending of the current dispatch generation rather than an earlier one (R8). Pure; every input is inline.
 */
import { describe, expect, it } from "vitest";

import type { AskLifecycleEvent } from "../../../../live/ask/lifecycle.js";
import { dispatchChildrenBySessionKey, terminalPrecedesDispatch } from "../../../../sessions/dispatchChildren.js";
import { dispatchDoneEvidence } from "../../../../sessions/dispatchDoneEvidence.js";
import { ASK, captured, dispatched, NO_REVIEW, NOW, REVIEW_KEY, REVIEW_NAME, WORKER_KEY } from "../dispatchFixtures.js";

describe("dispatchChildrenBySessionKey", () => {
  it("names both roles of every captured ask, forward from dispatchSessionName", () => {
    const children = dispatchChildrenBySessionKey({ askEvents: [captured()] });
    expect([...children.keys()].toSorted()).toEqual([WORKER_KEY, REVIEW_KEY].toSorted());
    expect(children.get(REVIEW_KEY)![0]!.role).toBe("review");
    expect(children.get(REVIEW_KEY)![0]!.workspaceName).toBe(REVIEW_NAME);
    expect(children.get(REVIEW_KEY)![0]!.terminal).toBeUndefined();
  });

  it("carries a terminal event that a later recapture has moved the fold's state off", () => {
    const answered: AskLifecycleEvent = {
      ...ASK,
      answerTs: "1789046999.1",
      kind: "answered",
      tsIso: "2026-09-03T08:00:00.000Z",
    };
    const children = dispatchChildrenBySessionKey({
      askEvents: [captured(), answered, { ...captured(), tsIso: "2026-09-03T09:00:00.000Z" }],
    });
    const child = children.get(REVIEW_KEY)![0]!;
    expect(child.lifecycle.state).toBe("captured");
    expect(child.terminal!.kind).toBe("answered");
  });

  it("maps a key two asks derive alike to both of them", () => {
    const other = { channel: ASK.channel, messageTs: ASK.messageTs, threadTs: "1789000000.000001" };
    const children = dispatchChildrenBySessionKey({ askEvents: [captured(), captured(other)] });
    // Same channel and same messageTs is the same fold key, so the SECOND capture re-opens the first entry
    // rather than adding one — one child, not an ambiguity.
    expect(children.get(REVIEW_KEY)).toHaveLength(1);
  });
});

describe("a terminal from an EARLIER generation (R8)", () => {
  const childOf = ({ askEvents }: { askEvents: readonly AskLifecycleEvent[] }) =>
    dispatchChildrenBySessionKey({ askEvents }).get(WORKER_KEY)![0]!;
  const answered: AskLifecycleEvent = {
    ...ASK,
    answerTs: "1789046999.1",
    kind: "answered",
    tsIso: "2026-09-03T08:00:00.000Z",
  };
  const gen2: AskLifecycleEvent = {
    ...dispatched({ leaseExpiresAt: "2026-09-03T11:00:00.000Z" }),
    tsIso: "2026-09-03T09:00:00.000Z",
  };
  const recapture: AskLifecycleEvent = { ...captured(), tsIso: "2026-09-03T08:59:00.000Z" };

  it("is not the ending of a re-dispatch that began after it", () => {
    const askEvents = [
      captured(),
      dispatched({ leaseExpiresAt: "2026-09-03T09:00:00.000Z" }),
      answered,
      recapture,
      gen2,
    ];

    expect(childOf({ askEvents }).terminal).toBeUndefined();
    expect(
      dispatchDoneEvidence({ child: childOf({ askEvents }), nowIso: NOW, review: NO_REVIEW, workerWorkspace: "live" }),
    ).toBeUndefined();
  });

  it("is the pair: without the re-dispatch, the same answer still ends the worker", () => {
    const askEvents = [captured(), dispatched({ leaseExpiresAt: "2026-09-03T09:00:00.000Z" }), answered, recapture];

    expect(
      dispatchDoneEvidence({ child: childOf({ askEvents }), nowIso: NOW, review: NO_REVIEW, workerWorkspace: "live" }),
    ).toEqual({ kind: "turn-finalised", role: "ask", terminal: "answered" });
  });

  it("stays not-this-generation's ending after a lease expiry clears the running dispatch", () => {
    const leaseExpired: AskLifecycleEvent = { ...ASK, kind: "lease-expired", tsIso: "2026-09-03T11:01:00.000Z" };
    const askEvents = [
      captured(),
      dispatched({ leaseExpiresAt: "2026-09-03T09:00:00.000Z" }),
      answered,
      recapture,
      gen2,
      leaseExpired,
    ];

    expect(childOf({ askEvents }).lifecycle.activeDispatch).toBeUndefined();
    expect(childOf({ askEvents }).terminal).toBeUndefined();
  });

  it("compares the two instants strictly and keeps the terminal on anything it cannot read", () => {
    const terminal = { tsIso: "2026-10-02T07:34:58.645Z" };

    expect(terminalPrecedesDispatch({ latestDispatch: { tsIso: "2026-10-02T07:37:56.000Z" }, terminal })).toBe(true);
    expect(terminalPrecedesDispatch({ latestDispatch: { tsIso: "2026-10-02T06:59:55.295Z" }, terminal })).toBe(false);
    expect(terminalPrecedesDispatch({ latestDispatch: { tsIso: terminal.tsIso }, terminal })).toBe(false);
    expect(terminalPrecedesDispatch({ latestDispatch: undefined, terminal })).toBe(false);
    expect(terminalPrecedesDispatch({ latestDispatch: { tsIso: "garbage" }, terminal })).toBe(false);
  });
});
