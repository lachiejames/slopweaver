/**
 * What `talk courier` prints for each batch pass and each request it handles. The verb itself needs the pinned chair's
 * cmux; these are its pure halves.
 */
import { describe, expect, it } from "vitest";

import {
  courierOutcomeLine,
  courierRecoveryLine,
  courierWakeLines,
} from "../../../../../cli/commands/talk/courierRun.js";

const TURN = "951b9e45-6fc9-45fd-8e25-d04ded7164c9";

describe("courierWakeLines", () => {
  const woke = {
    callId: "call-1",
    carried: [],
    delivery: {
      atIso: "2026-10-17T14:00:00.000Z",
      detail: "typed into the supervisor's chat (workspace:1) as a turn from the owner",
      kind: "typed",
      via: "courier",
    },
    kind: "woke",
    line: "batch",
    unsettled: [],
  } as const;

  it("prints nothing for a pass that typed and dropped nothing", () => {
    expect(
      courierWakeLines({
        report: {
          dropped: [],
          outcome: { kind: "holding", lastWordIso: "2026-10-17T14:00:00.000Z", untilIso: "2026-10-17T14:02:00.000Z" },
          unreadable: undefined,
        },
      }),
    ).toEqual([]);
  });

  it("says a last-wake record it could not read even on a pass that typed nothing", () => {
    expect(
      courierWakeLines({
        report: {
          dropped: [],
          outcome: { kind: "holding", lastWordIso: "2026-10-17T14:00:00.000Z", untilIso: "2026-10-17T14:02:00.000Z" },
          unreadable: "chair-wake.json is not JSON: SyntaxError",
        },
      }),
    ).toEqual(["talk courier: the last wake was read as none — chair-wake.json is not JSON: SyntaxError"]);
  });

  it("prints a dropped request even when no batch was typed", () => {
    expect(
      courierWakeLines({
        report: {
          dropped: [{ detail: "the turn already carries a delivery (typed)", kind: "skipped", turnId: TURN }],
          outcome: { kind: "nothing-unread" },
          unreadable: undefined,
        },
      }),
    ).toEqual([`talk courier: ${TURN} skipped — the turn already carries a delivery (typed)`]);
  });

  it("names the typed batch's delivery, then every relay it carried and every one left held", () => {
    expect(
      courierWakeLines({
        report: {
          dropped: [],
          outcome: {
            ...woke,
            carried: [
              { detail: "typed — on the quiet batch of 2026-10-17T13:59:59.000Z: typed", kind: "typed", turnId: TURN },
            ],
            unrecorded: undefined,
            unsettled: ["held turn x could not record the batch that carried it: EACCES"],
          },
          unreadable: undefined,
        },
      }),
    ).toEqual([
      "talk courier: quiet batch typed — typed into the supervisor's chat (workspace:1) as a turn from the owner",
      `talk courier: ${TURN} typed — typed — on the quiet batch of 2026-10-17T13:59:59.000Z: typed`,
      "talk courier: a relay stays held for the next batch — held turn x could not record the batch that carried it: EACCES",
    ]);
  });

  it("keeps why a typed batch's outcome could not be recorded", () => {
    expect(
      courierWakeLines({
        report: {
          dropped: [],
          outcome: { ...woke, unrecorded: "the call lock is held by pid 42" },
          unreadable: undefined,
        },
      }),
    ).toEqual([
      "talk courier: quiet batch typed — typed into the supervisor's chat (workspace:1) as a turn from the owner (not recorded: the call lock is held by pid 42)",
    ]);
  });
});

describe("courierOutcomeLine", () => {
  it("names the turn, what became of it and the delivery's own sentence", () => {
    const outcome = {
      detail: "typed into the supervisor's chat (workspace:1) as a turn from the owner",
      kind: "typed",
      turnId: TURN,
    } as const;
    expect(courierOutcomeLine({ outcome })).toBe(
      `talk courier: ${TURN} typed — typed into the supervisor's chat (workspace:1) as a turn from the owner`,
    );
  });
});

describe("courierRecoveryLine", () => {
  it("says a requeued request was never claimed, so nothing was typed", () => {
    expect(courierRecoveryLine({ recovery: { kind: "requeued", turnId: TURN } })).toBe(
      `talk courier: ${TURN} requeued — a stopped courier took it and never claimed its delivery`,
    );
  });

  it("says a claimed one is left untyped, since its line may already be pasted", () => {
    expect(courierRecoveryLine({ recovery: { kind: "left", turnId: TURN } })).toBe(
      `talk courier: ${TURN} left untyped — a stopped courier had claimed its delivery, which may be a line already pasted; the row is on the board`,
    );
  });
});
