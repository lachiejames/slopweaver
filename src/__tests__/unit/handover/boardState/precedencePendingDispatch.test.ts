/*
 * `composeBoardModels` over a dispatch nothing has started: a seat `cmux spawn` delivered a pickup to, whose
 * `handover start` never landed. Delivery is not a start, so a row that would print `RUN NOW` with "declared ready"
 * says so in its reason instead. The SECTION never moves, so every reader keyed on one sees what it saw.
 */
import { describe, expect, it } from "vitest";

import { PENDING_DISPATCH_REASON } from "../../../../handover/boardEvidence.js";
import type { HandoverDoc } from "../../../../handover/doc.js";
import type { RunEvent } from "../../../../handover/ledger.js";
import { compose, doc, journal, NOW, probe } from "./harness.js";

const DISPATCHED: RunEvent = { atIso: NOW, by: "cmux spawn", kind: "dispatched", target: "workspace:7" };
const STARTED: RunEvent = { atIso: NOW, branch: "a", docHash: "h", kind: "started" };
const LAUNCHED: RunEvent = { atIso: NOW, kind: "launched", pid: 9, sessionId: "seat-1", worktree: "/wt/a" };
const ABANDONED: RunEvent = { atIso: NOW, kind: "abandoned", why: "no-show" };

const QUESTION = "Which effort should a lookup use by default?";

/** The fields `handover register` writes on an ask carrying its whole shape, with no run behind it. */
const REGISTERED_ASK: Partial<HandoverDoc> = {
  askedIso: "2026-08-19T00:00:00.000Z",
  kind: "ask",
  lean: "medium",
  options: [
    { letter: "A", option: "medium", tradeoff: "median 9.7s" },
    { letter: "B", option: "keep high", tradeoff: "median 17.9s" },
  ],
  problem: "a lookup at high has median 17.9s",
  summary: QUESTION,
};

/** The one row `a` composed over this journal, with its doc overridden and its probe state when one is given. */
function placed({
  events,
  over = {},
  computed,
}: {
  events: readonly RunEvent[];
  over?: Partial<HandoverDoc>;
  computed?: "landed";
}): { section: string; reason: string } {
  const probeStates = computed === undefined ? undefined : new Map([["/h/a.md", probe({ computed })]]);
  const models = compose({
    journals: new Map([["a", journal({ events })]]),
    roots: [doc({ slug: "a", status: "ready", ...over })],
    ...(probeStates === undefined ? {} : { probeStates }),
  });
  const model = models[0]!;
  return { reason: model.reason, section: model.section };
}

describe("composeBoardModels — a dispatch with no start after it", () => {
  it("pins the exact reason the row prints", () => {
    expect(PENDING_DISPATCH_REASON).toBe(
      "the last dispatch has no started row; pickup delivery is not proof that handover start succeeded",
    );
  });

  it("keeps a dispatch-only journal in RUN NOW, replacing only its reason", () => {
    expect(placed({ events: [DISPATCHED] })).toEqual({ reason: PENDING_DISPATCH_REASON, section: "RUN NOW" });
  });

  it("prints the ordinary reason on the same row before anything was dispatched", () => {
    expect(placed({ events: [] })).toEqual({ reason: "declared ready", section: "RUN NOW" });
  });

  it("restores today's open-run placement and reason once the seat starts", () => {
    expect(placed({ events: [DISPATCHED, STARTED, LAUNCHED] })).toEqual({
      reason: "a run is currently open",
      section: "IN FLIGHT",
    });
  });

  it("keeps an open run's own reason when a reseat dispatches at it, since its resume writes no start", () => {
    expect(placed({ events: [STARTED, LAUNCHED, DISPATCHED] })).toEqual({
      reason: "a run is currently open",
      section: "IN FLIGHT",
    });
  });

  it("clears once the dispatch is abandoned, back to today's runnable row", () => {
    expect(placed({ events: [DISPATCHED, ABANDONED] })).toEqual({ reason: "declared ready", section: "RUN NOW" });
  });

  it("leaves an abandoned run's closure in place when a re-dispatch follows it, since closure outranks ready", () => {
    expect(placed({ events: [STARTED, ABANDONED, DISPATCHED] })).toEqual({
      reason: "no-show",
      section: "CLOSED — NOT SHIPPED",
    });
  });

  it("leaves a blocked dispatch-only row in NOT YET with exactly today's reason", () => {
    const blocked = { blockedBy: ["ghost"] };
    const dispatched = placed({ events: [DISPATCHED], over: blocked });

    expect(dispatched.section).toBe("NOT YET");
    expect(dispatched).toEqual(placed({ events: [], over: blocked }));
  });

  it("leaves a dispatched registered ask in WAITING ON OWNER, saying what it asks", () => {
    expect(placed({ events: [DISPATCHED], over: REGISTERED_ASK })).toEqual({
      reason: `waiting on the owner: ${QUESTION}`,
      section: "WAITING ON OWNER",
    });
  });

  it("leaves a dispatched draft in NOT YET as a draft", () => {
    expect(placed({ events: [DISPATCHED], over: { status: "draft" } })).toEqual({
      reason: "declared draft",
      section: "NOT YET",
    });
  });

  it("leaves a row whose probes all pass under LOOKS SHIPPED, which outranks a pending dispatch", () => {
    expect(placed({ computed: "landed", events: [DISPATCHED] })).toEqual({
      reason: "every declared probe passes, with no run recorded as finished",
      section: "LOOKS SHIPPED",
    });
  });
});
