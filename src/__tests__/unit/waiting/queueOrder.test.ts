import { describe, expect, it } from "vitest";

import { QUEUE_BANDS, type QueueFact, rankQueue } from "../../../waiting/queueOrder.js";

/** One thing in a test list: a name to read the order by, and its fact. */
interface Item {
  readonly name: string;
  readonly fact: QueueFact;
}

const factOf = (item: Item): QueueFact => item.fact;

describe("rankQueue", () => {
  it("names the four bands in the order they lead", () => {
    expect(QUEUE_BANDS).toEqual(["blocker", "priority", "stopped", "rest"]);
  });

  it("leads with a blocker, then the owner's priorities by rank, board band and controls, then the stopped, then the rest", () => {
    const items: Item[] = [
      { fact: { band: "rest" }, name: "colleague-reply" },
      { fact: { band: "priority", controlsResolved: 3, priorityRank: 1 }, name: "vanta-3" },
      { fact: { band: "stopped" }, name: "held-automation" },
      { fact: { band: "priority", priorityRank: 1 }, name: "vanta-no-count" },
      { fact: { band: "priority", controlsResolved: 8, priorityRank: 1 }, name: "vanta-8" },
      { fact: { band: "blocker", priorityRank: 1 }, name: "blocks-vanta" },
      { fact: { band: "priority", boardBand: 0, priorityRank: 0 }, name: "nag-proposal" },
      { fact: { band: "blocker", priorityRank: 0 }, name: "blocks-nag" },
    ];
    expect(rankQueue({ factOf, items }).map((item) => item.name)).toEqual([
      "blocks-nag",
      "blocks-vanta",
      "nag-proposal",
      "vanta-8",
      "vanta-3",
      "vanta-no-count",
      "held-automation",
      "colleague-reply",
    ]);
  });

  it("keeps the caller's order where no key separates two things", () => {
    const items: Item[] = [
      { fact: { band: "rest" }, name: "oldest" },
      { fact: { band: "stopped" }, name: "stopped-a" },
      { fact: { band: "rest" }, name: "newest" },
      { fact: { band: "stopped" }, name: "stopped-b" },
    ];
    expect(rankQueue({ factOf, items }).map((item) => item.name)).toEqual([
      "stopped-a",
      "stopped-b",
      "oldest",
      "newest",
    ]);
  });

  it("returns the caller's own list when nothing moves", () => {
    const items: Item[] = [
      { fact: { band: "blocker", priorityRank: 0 }, name: "first" },
      { fact: { band: "rest" }, name: "second" },
    ];
    expect(rankQueue({ factOf, items })).toBe(items);
  });

  it("reads each thing's fact once, in the caller's order", () => {
    const asked: string[] = [];
    const items: Item[] = [
      { fact: { band: "rest" }, name: "a" },
      { fact: { band: "blocker", priorityRank: 0 }, name: "b" },
    ];
    const ranked = rankQueue({
      factOf: (item) => {
        asked.push(item.name);
        return item.fact;
      },
      items,
    });
    expect(ranked.map((item) => item.name)).toEqual(["b", "a"]);
    expect(asked).toEqual(["a", "b"]);
  });
});
