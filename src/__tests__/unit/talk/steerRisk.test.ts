/**
 * `talk steer-risk`'s pure core: the open steer notes, oldest first, each with the row's sentence and the reason the
 * note already carries — the same words the owner's screen shows, so the voice can never name a risk the note does not.
 */
import { describe, expect, it } from "vitest";

import type { SnoozeRecord } from "../../../hand/snoozeStore.js";
import type { HandStep } from "../../../hand/step.js";
import { STEER_UNBLOCKS_OPEN } from "../../../monitor/steerAtRisk.js";
import { answeredStepIds, steerRiskNoticesOf } from "../../../talk/steerRisk.js";

/** One open step, as the register holds it. */
function step({ id, postedIso, unblocks }: { id: string; postedIso: string; unblocks: string }): HandStep {
  return {
    id,
    postedBy: "handover park",
    postedIso,
    unblocks,
    what: `Your steered ${id.replace("mon-steer-", "")} is at risk`,
    witness: `slopweaver hand done ${id}`,
  };
}

const PARKED = step({
  id: "mon-steer-sup-4293-1a2b3c",
  postedIso: "2026-10-22T04:01:12.000Z",
  unblocks: `${STEER_UNBLOCKS_OPEN}its seat closed until 2026-10-22T04:50:00Z, so nobody is working it`,
});
const NAMED = step({
  id: "mon-steer-gcp-build-4d5e6f",
  postedIso: "2026-10-22T03:00:00.000Z",
  unblocks: `${STEER_UNBLOCKS_OPEN}the seat named a risk: no verb for the OAuth client`,
});
const OTHER = step({ id: "mon-health-deaths-0a1b2c", postedIso: "2026-10-22T02:00:00.000Z", unblocks: "the fleet" });

describe("steerRiskNoticesOf", () => {
  it("names each open steer note oldest first with the reason its note carries, and nothing else", () => {
    const answered = new Set<string>();
    expect(
      steerRiskNoticesOf({ answered, stepIds: new Set([PARKED.id, NAMED.id]), steps: [PARKED, OTHER, NAMED] }),
    ).toEqual({
      notices: [
        {
          stepId: "mon-steer-gcp-build-4d5e6f",
          what: "Your steered gcp-build-4d5e6f is at risk",
          why: "the seat named a risk: no verb for the OAuth client",
        },
        {
          stepId: "mon-steer-sup-4293-1a2b3c",
          what: "Your steered sup-4293-1a2b3c is at risk",
          why: "its seat closed until 2026-10-22T04:50:00Z, so nobody is working it",
        },
      ],
    });
  });

  it("says nothing when no steer note is open", () => {
    expect(steerRiskNoticesOf({ answered: new Set(), stepIds: new Set(), steps: [OTHER] })).toEqual({ notices: [] });
  });

  // Done on the note is a marker until a reconcile settles it, so the register still holds the step.
  it("never names a note the owner pressed Done on that the register has not settled yet", () => {
    const stepIds = new Set([PARKED.id, NAMED.id]);
    const notices = steerRiskNoticesOf({ answered: new Set([NAMED.id]), stepIds, steps: [PARKED, NAMED] }).notices;
    expect(notices.map((notice) => notice.stepId)).toEqual(["mon-steer-sup-4293-1a2b3c"]);
  });

  // The voice said "The fleet's still on it" over a row stopped on the owner's question.
  it("keeps the whole waiting line of a note stopped on the owner's question, so the voice says it waits on them", () => {
    const waiting = step({
      id: "mon-steer-vulnfix-7a8b9c",
      postedIso: "2026-10-22T05:00:00.000Z",
      unblocks: "waiting on you: A, B or C on the storybook line? — answer it on your Queue",
    });

    const notices = steerRiskNoticesOf({ answered: new Set(), stepIds: new Set([waiting.id]), steps: [waiting] });
    expect(notices.notices.map((notice) => notice.why)).toEqual([
      "waiting on you: A, B or C on the storybook line? — answer it on your Queue",
    ]);
  });

  it("keeps the whole line of a note whose unblocks does not open the steer way", () => {
    const odd = step({ id: "mon-steer-odd-000000", postedIso: "2026-10-22T05:00:00.000Z", unblocks: "hand-written" });

    const notices = steerRiskNoticesOf({ answered: new Set(), stepIds: new Set([odd.id]), steps: [odd] }).notices;
    expect(notices[0]!.why).toBe("hand-written");
  });
});

// A reconciled Later or Snooze leaves the step open with no marker, so the voice reads each store.
describe("answeredStepIds", () => {
  const NOW = "2026-10-22T04:30:00.000Z";
  const snooze = ({ id, untilIso }: { id: string; untilIso: string }): SnoozeRecord => ({
    choice: "1h",
    id,
    pressedIso: "2026-10-22T04:00:00.000Z",
    untilIso,
  });

  it("holds a fresh marker, a reconciled Later, a running snooze and an unreadable snooze, never a lapsed one", () => {
    const held = answeredStepIds({
      laterIds: new Set(["mon-steer-later-000002"]),
      markers: [{ answer: "done", id: "mon-steer-done-000001", path: "/markers/done" }],
      nowIso: NOW,
      snoozes: [
        snooze({ id: "mon-steer-snoozed-000003", untilIso: "2026-10-22T05:00:00.000Z" }),
        snooze({ id: "mon-steer-lapsed-000004", untilIso: "2026-10-22T04:29:59.999Z" }),
      ],
      unreadableSnoozes: ["mon-steer-unread-000005"],
    });
    expect([...held].toSorted()).toEqual([
      "mon-steer-done-000001",
      "mon-steer-later-000002",
      "mon-steer-snoozed-000003",
      "mon-steer-unread-000005",
    ]);
  });

  // A snooze press is judged by its wake instant, never by its marker standing.
  it("lets a snooze marker hold nothing by itself, and judges each step by its newest press", () => {
    const held = answeredStepIds({
      laterIds: new Set(),
      markers: [{ answer: "snooze", choice: "1h", id: "mon-steer-marker-000006", path: "/markers/snooze" }],
      nowIso: NOW,
      snoozes: [
        { ...snooze({ id: "mon-steer-repressed-000007", untilIso: "2026-10-22T07:00:00.000Z" }), choice: "3h" },
        {
          ...snooze({ id: "mon-steer-repressed-000007", untilIso: "2026-10-22T04:10:00.000Z" }),
          pressedIso: "2026-10-22T04:10:00.000Z",
        },
      ],
      unreadableSnoozes: [],
    });
    expect([...held]).toEqual([]);
  });

  it("holds nothing when the owner has answered no note", () => {
    const held = answeredStepIds({ laterIds: new Set(), markers: [], nowIso: NOW, snoozes: [], unreadableSnoozes: [] });
    expect([...held]).toEqual([]);
  });
});
