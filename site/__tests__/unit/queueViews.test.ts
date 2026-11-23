/*
 * The Queue's one selector: which cards each view holds, how many, and how the address carries it.
 */

import { describe, expect, it } from "vitest";

import { inView, type ViewCard, viewCounts, viewOf, withView } from "../../lib/queueViews";

const card = (over: Partial<ViewCard>): ViewCard => ({
  kind: "ask",
  tags: [],
  tagsRead: "whole",
  tier: "fleet-blocked",
  ...over,
});

describe("inView", () => {
  it("puts a held reply and a post under Slack drafts, and a review only under reviews", () => {
    expect(inView({ card: card({ kind: "draft" }), view: "slack" })).toBe(true);
    expect(inView({ card: card({ kind: "post" }), view: "slack" })).toBe(true);
    expect(inView({ card: card({ kind: "review" }), view: "slack" })).toBe(false);
    expect(inView({ card: card({ kind: "review" }), view: "review" })).toBe(true);
  });

  it("reads the tiers for colleague, fleet and check-in", () => {
    expect(inView({ card: card({ tier: "team-blocked" }), view: "colleague" })).toBe(true);
    expect(inView({ card: card({ tier: "team-blocked" }), view: "fleet" })).toBe(false);
    expect(inView({ card: card({ tier: "check-in" }), view: "check-in" })).toBe(true);
  });

  it("claims urgent and finding only off whole tags", () => {
    const p1 = { key: "priority", value: "p1" };
    expect(inView({ card: card({ tags: [p1] }), view: "urgent" })).toBe(true);
    expect(inView({ card: card({ tags: [{ key: "priority", value: "p2" }] }), view: "urgent" })).toBe(false);
    expect(inView({ card: card({ tags: [p1], tagsRead: "partial" }), view: "urgent" })).toBe(false);
    expect(inView({ card: card({ tags: [{ key: "origin", value: "finding" }] }), view: "finding" })).toBe(true);
  });
});

describe("viewCounts", () => {
  it("counts each view, and refuses a tag-borne count before the board reads", () => {
    const cards = [
      card({ kind: "draft", tier: "team-blocked" }),
      card({ tags: [{ key: "priority", value: "p0" }] }),
      card({ tier: "check-in" }),
    ];
    expect(
      viewCounts({ allRead: true, boardRead: false, cards, unnarrowed: cards }).map(({ view, count }) => [view, count]),
    ).toEqual([
      ["all", 3],
      ["urgent", undefined],
      ["colleague", 1],
      ["fleet", 1],
      ["slack", 1],
      ["review", 0],
      ["finding", undefined],
      ["check-in", 1],
    ]);
    expect(
      viewCounts({ allRead: true, boardRead: true, cards, unnarrowed: cards }).find((each) => each.view === "urgent")!
        .count,
    ).toBe(1);
  });

  it("refuses a tag-borne count while any card's tags read only in part, never an Urgent (0) over it", () => {
    const cards = [card({ tags: [{ key: "priority", value: "p1" }], tagsRead: "partial" }), card({})];
    const counts = viewCounts({ allRead: true, boardRead: true, cards, unnarrowed: cards });
    expect(counts.find((each) => each.view === "urgent")!.count).toBe(undefined);
    expect(counts.find((each) => each.view === "finding")!.count).toBe(undefined);
    expect(counts.find((each) => each.view === "all")!.count).toBe(2);
  });

  it("refuses a tag-borne count over a partial card a tag selection hid, never an Urgent (1) beside it", () => {
    const whole = card({
      tags: [
        { key: "area", value: "foo" },
        { key: "priority", value: "p1" },
      ],
    });
    const hidden = card({ tags: [{ key: "priority", value: "p0" }], tagsRead: "partial" });
    const counts = viewCounts({ allRead: true, boardRead: true, cards: [whole], unnarrowed: [whole, hidden] });
    expect(counts.find((each) => each.view === "urgent")!.count).toBe(undefined);
    expect(counts.find((each) => each.view === "all")!.count).toBe(1);
  });

  it("prints no count at all while a register has not read, never a zero over half the queue", () => {
    const cards = [card({ kind: "draft" })];
    const counts = viewCounts({ allRead: false, boardRead: true, cards, unnarrowed: cards });
    expect(counts.map(({ count }) => count)).toEqual(Array.from({ length: 8 }, () => undefined));
  });
});

describe("the address", () => {
  it("reads a known view and opens on everything for none or a typo", () => {
    expect(viewOf({ value: "slack" })).toBe("slack");
    expect(viewOf({ value: null })).toBe("all");
    expect(viewOf({ value: "slak" })).toBe("all");
  });

  it("sets, replaces and drops the view, keeping every other parameter", () => {
    expect(withView({ search: "?open=ask:x&tag=priority:p1", view: "fleet" })).toBe(
      "?open=ask%3Ax&tag=priority%3Ap1&view=fleet",
    );
    expect(withView({ search: "?view=fleet&open=a", view: "slack" })).toBe("?open=a&view=slack");
    expect(withView({ search: "?view=fleet", view: "all" })).toBe("");
  });
});
