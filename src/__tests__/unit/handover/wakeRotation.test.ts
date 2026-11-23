/**
 * The rotation behind every capped pass of `handover wake`: the instant a park has been due since, and the order
 * least recently served first that its checks reads, finish asks and reseats each take.
 */
import { describe, expect, it } from "vitest";

import { dueSinceIso, leastRecentlyTried, longestDueFirst } from "../../../handover/wakeOrder.js";

describe("dueSinceIso", () => {
  it("is a clock wake's own instant when it falls after the park", () => {
    expect(
      dueSinceIso({ parkedAtIso: "2026-11-05T01:00:00.000Z", wake: { atIso: "2026-11-05T02:00:00Z", kind: "at" } }),
    ).toBe("2026-11-05T02:00:00.000Z");
  });

  it("is the park itself when a clock wake's instant had already passed", () => {
    expect(
      dueSinceIso({ parkedAtIso: "2026-11-05T03:00:00Z", wake: { atIso: "2026-11-05T02:00:00Z", kind: "at" } }),
    ).toBe("2026-11-05T03:00:00.000Z");
  });

  it("is the park for a checks wake, which carries no instant of its own", () => {
    expect(
      dueSinceIso({ parkedAtIso: "2026-11-05T04:00:00.000Z", wake: { kind: "checks", number: 7, repo: "o/r" } }),
    ).toBe("2026-11-05T04:00:00.000Z");
  });
});

describe("longestDueFirst", () => {
  it("orders by the instant due, earliest first, whatever the slugs say", () => {
    const due = [
      { dueSinceIso: "2026-11-05T03:00:00.000Z", slug: "alpha" },
      { dueSinceIso: "2026-11-05T01:00:00.000Z", slug: "zulu" },
      { dueSinceIso: "2026-11-05T02:00:00.000Z", slug: "mike" },
    ];
    expect(longestDueFirst({ due }).map((row) => row.slug)).toEqual(["zulu", "mike", "alpha"]);
  });

  it("breaks a tie on the slug, so the order is total", () => {
    const due = [
      { dueSinceIso: "2026-11-05T01:00:00.000Z", slug: "b" },
      { dueSinceIso: "2026-11-05T01:00:00.000Z", slug: "a" },
    ];
    expect(longestDueFirst({ due }).map((row) => row.slug)).toEqual(["a", "b"]);
  });

  it("leaves its input in place", () => {
    const due = [
      { dueSinceIso: "2026-11-05T02:00:00.000Z", slug: "late" },
      { dueSinceIso: "2026-11-05T01:00:00.000Z", slug: "early" },
    ];
    longestDueFirst({ due });
    expect(due.map((row) => row.slug)).toEqual(["late", "early"]);
  });

  it("answers an empty list with an empty list", () => {
    expect(longestDueFirst({ due: [] })).toEqual([]);
  });
});

describe("leastRecentlyTried", () => {
  const due = [
    { dueSinceIso: "2026-11-05T01:00:00.000Z", key: "k-old", slug: "old" },
    { dueSinceIso: "2026-11-05T02:00:00.000Z", key: "k-mid", slug: "mid" },
    { dueSinceIso: "2026-11-05T03:00:00.000Z", key: "k-new", slug: "new" },
  ];

  it("is longest-due first when no park was ever tried", () => {
    expect(leastRecentlyTried({ due, lastTried: new Map() }).map((row) => row.slug)).toEqual(["old", "mid", "new"]);
  });

  it("puts a park that became due before the others' turns ahead of them, and those least recently tried first", () => {
    const lastTried = new Map([
      ["k-old", "2026-11-05T05:10:00.000Z"],
      ["k-mid", "2026-11-05T05:00:00.000Z"],
    ]);
    expect(leastRecentlyTried({ due, lastTried }).map((row) => row.slug)).toEqual(["new", "mid", "old"]);
  });

  it("keeps a park tried long ago ahead of parks that became due after its turn, however many arrive", () => {
    const tried = { dueSinceIso: "2026-11-05T01:00:00.000Z", key: "k-tried", slug: "tried" };
    const fresh = ["a", "b", "c"].map((slug) => ({ dueSinceIso: "2026-11-05T06:00:00.000Z", key: `k-${slug}`, slug }));
    const lastTried = new Map([["k-tried", "2026-11-05T05:00:00.000Z"]]);
    expect(leastRecentlyTried({ due: [...fresh, tried], lastTried }).map((row) => row.slug)).toEqual([
      "tried",
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps longest-due order among parks tried at the same instant", () => {
    const at = "2026-11-05T05:00:00.000Z";
    const lastTried = new Map([
      ["k-new", at],
      ["k-old", at],
      ["k-mid", at],
    ]);
    expect(leastRecentlyTried({ due, lastTried }).map((row) => row.slug)).toEqual(["old", "mid", "new"]);
  });
});
