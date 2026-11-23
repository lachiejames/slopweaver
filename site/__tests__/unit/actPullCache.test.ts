/*
 * The queue's by-branch lookup cache: one read in flight per branch however many cards and prefetches ask, a
 * ready answer kept for the next opening and over a failed re-read, and a failure never kept — so a card never opens
 * on a stale failure.
 */

import { describe, expect, it } from "vitest";

import { actPullCache, branchesToPrefetch, drawnActPull, type SettledActPull } from "../../lib/actPullCache";

const BRANCH = "the-bot-s-own-posts-into-the-ada";

function readyOf({ branch }: { branch: string }): SettledActPull {
  return { branch, phase: "ready", pulls: [], unchecked: 0 };
}

/** A lookup the test settles by hand, counting how many reads it was asked for. */
function heldLookup(): {
  asked: string[];
  settle: (answer: SettledActPull) => void;
  lookup: (branch: string) => Promise<SettledActPull>;
} {
  const asked: string[] = [];
  const waiting: ((answer: SettledActPull) => void)[] = [];
  const lookup: (branch: string) => Promise<SettledActPull> = (branch) => {
    asked.push(branch);
    return new Promise((resolve) => {
      waiting.push(resolve);
    });
  };
  const settle: (answer: SettledActPull) => void = (answer) => {
    waiting.shift()!(answer);
  };
  return { asked, lookup, settle };
}

describe("actPullCache", () => {
  it("rides a read already in flight rather than starting a second", async () => {
    const held = heldLookup();
    const cache = actPullCache({ lookup: held.lookup });
    const first = cache.read(BRANCH);
    const second = cache.read(BRANCH);
    expect(held.asked).toEqual([BRANCH]);
    expect(cache.reading(BRANCH)).toBe(true);
    held.settle(readyOf({ branch: BRANCH }));
    expect(await first).toEqual(readyOf({ branch: BRANCH }));
    expect(await second).toEqual(readyOf({ branch: BRANCH }));
    expect(cache.reading(BRANCH)).toBe(false);
  });

  it("keeps a ready answer, and reads the branch again when asked", async () => {
    const held = heldLookup();
    const cache = actPullCache({ lookup: held.lookup });
    const read = cache.read(BRANCH);
    held.settle(readyOf({ branch: BRANCH }));
    await read;
    expect(cache.kept(BRANCH)).toEqual(readyOf({ branch: BRANCH }));
    void cache.read(BRANCH);
    expect(held.asked).toEqual([BRANCH, BRANCH]);
    expect(cache.kept(BRANCH)).toEqual(readyOf({ branch: BRANCH }));
  });

  it("never keeps a failure, and keeps the ready answer a re-read failed over, so the card draws it marked stale", async () => {
    const held = heldLookup();
    const cache = actPullCache({ lookup: held.lookup });
    const first = cache.read(BRANCH);
    held.settle(readyOf({ branch: BRANCH }));
    await first;
    const again = cache.read(BRANCH);
    held.settle({ branch: BRANCH, phase: "not-measured", why: "github search exited 1" });
    expect(await again).toEqual({ branch: BRANCH, phase: "not-measured", why: "github search exited 1" });
    expect(cache.kept(BRANCH)).toEqual(readyOf({ branch: BRANCH }));
  });

  it("keeps nothing when the first read fails", async () => {
    const held = heldLookup();
    const cache = actPullCache({ lookup: held.lookup });
    const first = cache.read(BRANCH);
    held.settle({ branch: BRANCH, phase: "not-measured", why: "github search exited 1" });
    await first;
    expect(cache.kept(BRANCH)).toBe(undefined);
  });

  it("holds nothing before a read", () => {
    const cache = actPullCache({ lookup: heldLookup().lookup });
    expect(cache.kept(BRANCH)).toBe(undefined);
    expect(cache.reading(BRANCH)).toBe(false);
  });
});

describe("branchesToPrefetch", () => {
  it("reads each drawn branch once, in order, skipping acts with none", () => {
    const cache = actPullCache({ lookup: heldLookup().lookup });
    expect(branchesToPrefetch({ branches: ["b", undefined, "a", "b"], cache })).toEqual(["b", "a"]);
  });

  it("skips a branch already answered or in flight", async () => {
    const held = heldLookup();
    const cache = actPullCache({ lookup: held.lookup });
    const answered = cache.read("answered");
    held.settle(readyOf({ branch: "answered" }));
    await answered;
    void cache.read("flying");
    expect(branchesToPrefetch({ branches: ["answered", "flying", "new"], cache })).toEqual(["new"]);
  });

  it("reads nothing when no act is drawn", () => {
    const cache = actPullCache({ lookup: heldLookup().lookup });
    expect(branchesToPrefetch({ branches: [], cache })).toEqual([]);
  });
});

describe("actPullCache — the prefetch walk", () => {
  const RUNNING = (): boolean => false;

  it("reads one branch at a time, and a changed ask mid-read redirects the walk rather than starting a second", async () => {
    // Counterexample: ["a","b"] pending on "a", then ["a","b","c"] — "b" must not start beside "a".
    const held = heldLookup();
    const cache = actPullCache({ lookup: held.lookup });
    cache.prefetch({ branches: ["a", "b"], paused: RUNNING });
    cache.prefetch({ branches: ["a", "b", "c"], paused: RUNNING });
    expect(held.asked).toEqual(["a"]);
    const a = cache.read("a");
    held.settle(readyOf({ branch: "a" }));
    await a;
    expect(held.asked).toEqual(["a", "b"]);
  });

  it("stops after the read in hand when the ask is emptied", async () => {
    const held = heldLookup();
    const cache = actPullCache({ lookup: held.lookup });
    cache.prefetch({ branches: ["a", "b"], paused: RUNNING });
    cache.prefetch({ branches: [], paused: RUNNING });
    const a = cache.read("a");
    held.settle(readyOf({ branch: "a" }));
    await a;
    expect(held.asked).toEqual(["a"]);
  });

  it("reads nothing while paused", () => {
    const held = heldLookup();
    const cache = actPullCache({ lookup: held.lookup });
    cache.prefetch({ branches: ["a"], paused: () => true });
    expect(held.asked).toEqual([]);
  });

  it("never reads a failed branch again, and moves on to the next", async () => {
    const held = heldLookup();
    const cache = actPullCache({ lookup: held.lookup });
    cache.prefetch({ branches: ["a", "b"], paused: RUNNING });
    const a = cache.read("a");
    held.settle({ branch: "a", phase: "not-measured", why: "github search exited 1" });
    await a;
    const b = cache.read("b");
    held.settle(readyOf({ branch: "b" }));
    await b;
    cache.prefetch({ branches: ["a", "b"], paused: RUNNING });
    expect(held.asked).toEqual(["a", "b"]);
  });
});

describe("drawnActPull", () => {
  it("draws a failed re-read over a kept ready answer as that answer, stale, and any other answer as it came", () => {
    const failed: SettledActPull = { branch: BRANCH, phase: "not-measured", why: "the route is down" };
    const ready = readyOf({ branch: BRANCH });
    expect(drawnActPull({ answer: failed, kept: ready })).toEqual({ ...ready, stale: { why: "the route is down" } });
    expect(drawnActPull({ answer: failed, kept: undefined })).toEqual(failed);
    expect(drawnActPull({ answer: ready, kept: ready })).toEqual(ready);
  });
});
