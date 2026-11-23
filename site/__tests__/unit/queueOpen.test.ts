/*
 * Which row a `?open=` key opens: its own key first, then a row answering to it as an alias — how a decision hand
 * step's note, which opens the ask it joined, lands on the hand row instead of the "no such row" panel.
 */

import { describe, expect, it } from "vitest";

import { closedBySwitch, keptSnapshot, opensAs, rowForOpen, rowOpensAs } from "../../lib/queueOpen";
import type { QueueRow } from "../../lib/queueRows";

/** Only the two fields the resolver reads; the rest of a row is irrelevant to which one a key opens. */
function row({ key, aliases }: { key: string; aliases?: readonly string[] }): QueueRow {
  return { key, ...(aliases === undefined ? {} : { aliases }) } as QueueRow;
}

const HAND = row({ aliases: ["ask:post-16676"], key: "hand:steer-16676-post" });
const ASK = row({ key: "ask:post-16676" });
const OTHER = row({ aliases: ["ask:elsewhere"], key: "hand:other" });

describe("rowForOpen", () => {
  it("opens the row answering to an ask key no row carries", () => {
    expect(rowForOpen({ open: "ask:post-16676", rows: [OTHER, HAND] })!.key).toBe("hand:steer-16676-post");
  });

  it("opens the exact key ahead of an alias, whatever the order", () => {
    expect(rowForOpen({ open: "ask:post-16676", rows: [HAND, ASK] })!.key).toBe("ask:post-16676");
  });

  it("still opens a hand row by its own key", () => {
    expect(rowForOpen({ open: "hand:steer-16676-post", rows: [OTHER, HAND] })!.key).toBe("hand:steer-16676-post");
  });

  it("opens nothing for a key no row carries or answers to", () => {
    expect(rowForOpen({ open: "ask:nobody", rows: [OTHER, HAND, ASK] })).toBe(undefined);
  });
});

describe("rowOpensAs and opensAs", () => {
  it("answer for a row's own key and its aliases, and for nothing else", () => {
    expect(
      ["hand:steer-16676-post", "ask:post-16676", "ask:elsewhere"].map((open) => rowOpensAs({ open, row: HAND })),
    ).toEqual([true, true, false]);
  });

  it("open nothing with no panel open or no row snapshotted", () => {
    expect([opensAs({ open: null, row: HAND }), opensAs({ open: "ask:post-16676", row: undefined })]).toEqual([
      false,
      false,
    ]);
  });
});

describe("keptSnapshot — an open panel's snapshot outlives its row only in the context that draws it", () => {
  const OLD = row({ key: "ask:a" });
  const MOVED = row({ key: "ask:a" });
  const shows = (candidate: QueueRow): boolean => candidate !== MOVED;

  // Only the owner's close dismisses an open card — a row settled by another process is the same reading as one
  // the owner's own press removed.
  it("keeps a snapshot whose row a press, or another process settling it, removed from every register", () => {
    expect(keptSnapshot({ every: [], open: "ask:a", shows, snapshot: OLD })).toBe(OLD);
  });

  it("drops a snapshot whose row a refresh moved to the other workspace", () => {
    expect(keptSnapshot({ every: [MOVED], open: "ask:a", shows, snapshot: OLD })).toBe(undefined);
  });

  it("drops a snapshot this context does not show, after a switch of the selector", () => {
    expect(keptSnapshot({ every: [], open: "ask:a", shows, snapshot: MOVED })).toBe(undefined);
  });
});

describe("closedBySwitch — a switch of the selector closes a panel the new context does not draw", () => {
  const ACME = row({ key: "ask:acme" });
  const SLOPWEAVER = row({ key: "ask:slopweaver" });
  const shows = (candidate: QueueRow): boolean => candidate !== ACME;

  it("closes the panel of a row the context switched to does not show", () => {
    expect(closedBySwitch({ every: [ACME, SLOPWEAVER], open: "ask:acme", shows })).toBe("ask:acme");
  });

  it("leaves a panel the new context shows, one no register holds, and no panel at all", () => {
    expect(closedBySwitch({ every: [ACME, SLOPWEAVER], open: "ask:slopweaver", shows })).toBe(undefined);
    expect(closedBySwitch({ every: [SLOPWEAVER], open: "ask:gone", shows })).toBe(undefined);
    expect(closedBySwitch({ every: [ACME], open: null, shows })).toBe(undefined);
  });
});
