import { describe, expect, it } from "vitest";

import { inPageOrder, LANES, standingOf } from "../../../workstreams/lanes.js";
import type { WorkstreamAggregate } from "../../../workstreams/store/types.js";
import { acmeLinked, acmeLocal, acmeOutcome, OWN_DETAIL } from "../../workstreamStoreFixtures.js";

const ENDING = { anchor: "talk-call:x#turn_y", kind: "abandoned", on: "2026-10-02", reason: "the tool was dropped" };

const URGENT = { anchor: "talk:fixture#p", because: "a launch depends on it", level: "urgent" };

/**
 * One workstream of each lane the store can hold, in id order as the store reads them.
 *
 * @returns the aggregates
 */
function register(): WorkstreamAggregate[] {
  return [
    acmeOutcome({
      detail: { ...OWN_DETAIL, waitingOn: { on: "someone", what: "a sign-off", who: "acme legal" } },
      id: "acme-chase",
    }),
    {
      detail: { closedOn: "2026-10-01", ending: null, holding: "still holding", people: [], state: "handed over" },
      entries: [],
      id: "acme-closed",
      kind: "closing",
      links: [],
      milestones: [],
      name: "Acme closed",
      outcome: null,
      status: null,
      workspace: "self",
    },
    acmeOutcome({ id: "acme-discovery", status: "discovery" }),
    acmeLinked({
      detail: { ...acmeLinked().detail, waitingOn: { on: "you", what: "pick a gate" } },
      id: "acme-linked",
    }),
    acmeLocal({ id: "acme-scratch" }),
    acmeOutcome({ id: "acme-stalled", status: "stalled" }),
  ];
}

/**
 * The register with an ending on the workstream named, which otherwise keeps every hold and status word it had.
 *
 * @returns the aggregates
 */
function withEnding({ id }: { id: string }): WorkstreamAggregate[] {
  return register().map((one) => (one.id === id ? { ...one, detail: { ...one.detail, ending: ENDING } } : one));
}

/** Each aggregate stamped with its standing, in the order given. */
function standing({ workstreams = register() }: { workstreams?: readonly WorkstreamAggregate[] } = {}) {
  return workstreams.map((one) => ({ ...one, ...standingOf({ one }) }));
}

describe("an ending", () => {
  it("puts a held workstream in the abandoned lane, never at risk", () => {
    const ended = standing({ workstreams: withEnding({ id: "acme-chase" }) }).find((one) => one.id === "acme-chase")!;
    expect([ended.lane, ended.atRisk]).toEqual(["abandoned", false]);
  });

  it("puts a linked gauge held on the owner's call in the abandoned lane too", () => {
    const ended = standing({ workstreams: withEnding({ id: "acme-linked" }) }).find((one) => one.id === "acme-linked")!;
    expect([ended.lane, ended.atRisk]).toEqual(["abandoned", false]);
  });

  it("sorts after done, whatever the owner's priority", () => {
    const urgent = withEnding({ id: "acme-chase" }).map((one) =>
      one.id === "acme-chase" ? { ...one, detail: { ...one.detail, priority: URGENT } } : one,
    );
    expect(inPageOrder({ workstreams: standing({ workstreams: urgent }) }).map((one) => one.id)).toEqual([
      "acme-linked",
      "acme-stalled",
      "acme-discovery",
      "acme-scratch",
      "acme-closed",
      "acme-chase",
    ]);
  });

  it("is its own lane, apart from done", () => {
    expect(LANES.map((one) => one.id).slice(-3)).toEqual(["done", "kept-here", "abandoned"]);
  });
});

describe("standingOf", () => {
  it("names whose move each workstream is, and marks only the owner's call, a chase and stalled at risk", () => {
    expect(Object.fromEntries(standing().map((one) => [one.id, [one.lane, one.atRisk]]))).toEqual({
      "acme-chase": ["chase", true],
      "acme-closed": ["done", false],
      "acme-discovery": ["discovery", false],
      "acme-linked": ["your-call", true],
      "acme-scratch": ["kept-here", false],
      "acme-stalled": ["stalled", true],
    });
  });

  it("reads a linked workstream with nothing holding it as moving", () => {
    expect(standingOf({ one: acmeLinked() })).toEqual({ atRisk: false, lane: "moving" });
  });

  it("declares exactly three lanes at risk", () => {
    expect(LANES.filter((one) => one.atRisk).map((one) => one.id)).toEqual(["your-call", "chase", "stalled"]);
  });
});

describe("inPageOrder", () => {
  it("lists at risk first whatever order the store holds them in", () => {
    expect(inPageOrder({ workstreams: standing().toReversed() }).map((one) => one.id)).toEqual([
      "acme-linked",
      "acme-chase",
      "acme-stalled",
      "acme-discovery",
      "acme-scratch",
      "acme-closed",
    ]);
  });

  it("puts the owner's urgent priority ahead of a not-stated one inside a lane", () => {
    const two = [
      acmeOutcome({ id: "acme-a", status: "discovery" }),
      acmeOutcome({ detail: { ...OWN_DETAIL, priority: URGENT }, id: "acme-b", status: "discovery" }),
    ];
    expect(inPageOrder({ workstreams: standing({ workstreams: two }) }).map((one) => one.id)).toEqual([
      "acme-b",
      "acme-a",
    ]);
  });

  it("returns a new array and leaves its input as it was", () => {
    const input = standing().toReversed();
    const before = input.map((one) => one.id);
    expect(inPageOrder({ workstreams: input })).not.toBe(input);
    expect(input.map((one) => one.id)).toEqual(before);
  });
});
