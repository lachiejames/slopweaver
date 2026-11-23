import { describe, expect, it } from "vitest";
import {
  type CursorPage,
  capReached,
  collectCursorPages,
  cursorStep,
  cursorWalkWarning,
  remainingBudget,
} from "../../../lib/paging.js";

/** A plain fake page source (no mocks): serves the queued pages in order, recording the cursors + page sizes. */
function fakePages<T>({ pages }: { pages: readonly CursorPage<T>[] }): {
  fetchPage: (args: { cursor: string | undefined; pageSize: number | undefined }) => Promise<CursorPage<T>>;
  seenCursors: (string | undefined)[];
  seenPageSizes: (number | undefined)[];
} {
  const seenCursors: (string | undefined)[] = [];
  const seenPageSizes: (number | undefined)[] = [];
  let call = 0;
  return {
    fetchPage: ({ cursor, pageSize }) => {
      seenCursors.push(cursor);
      seenPageSizes.push(pageSize);
      const page = pages[call]!;
      call += 1;
      return Promise.resolve(page);
    },
    seenCursors,
    seenPageSizes,
  };
}

describe("collectCursorPages", () => {
  it("returns a single page's items when there is no next cursor", async () => {
    const { fetchPage } = fakePages({ pages: [{ items: ["a", "b"], nextCursor: undefined }] });
    const walk = await collectCursorPages({ fetchPage });
    expect(walk.items).toEqual(["a", "b"]);
    expect(walk.end).toEqual({ kind: "exhausted" });
  });

  it("concatenates multiple pages in order and stops at a missing cursor", async () => {
    const { fetchPage } = fakePages({
      pages: [
        { items: [1, 2], nextCursor: "c1" },
        { items: [3, 4], nextCursor: undefined },
      ],
    });
    expect((await collectCursorPages({ fetchPage })).items).toEqual([1, 2, 3, 4]);
  });

  it("stops on an empty-string cursor", async () => {
    const { fetchPage } = fakePages({
      pages: [
        { items: ["x"], nextCursor: "" },
        { items: ["should-not-fetch"], nextCursor: undefined },
      ],
    });
    const walk = await collectCursorPages({ fetchPage });
    expect(walk.items).toEqual(["x"]);
    expect(walk.end).toEqual({ kind: "exhausted" });
  });

  it("passes undefined for the first fetch and the prior cursor thereafter", async () => {
    const { fetchPage, seenCursors } = fakePages({
      pages: [
        { items: [1], nextCursor: "next-1" },
        { items: [2], nextCursor: undefined },
      ],
    });
    await collectCursorPages({ fetchPage });
    expect(seenCursors).toEqual([undefined, "next-1"]);
  });

  it("starts from an explicit firstCursor", async () => {
    const { fetchPage, seenCursors } = fakePages({ pages: [{ items: [1], nextCursor: undefined }] });
    await collectCursorPages({ fetchPage, firstCursor: "seed" });
    expect(seenCursors).toEqual(["seed"]);
  });

  it("passes undefined page size when uncapped", async () => {
    const { fetchPage, seenPageSizes } = fakePages({ pages: [{ items: [1], nextCursor: undefined }] });
    await collectCursorPages({ fetchPage });
    expect(seenPageSizes).toEqual([undefined]);
  });

  it("caps total items at maxItems, trimming a page that overshoots", async () => {
    const { fetchPage } = fakePages({ pages: [{ items: [1, 2, 3, 4, 5], nextCursor: "more" }] });
    const walk = await collectCursorPages({ fetchPage, maxItems: 3 });
    expect(walk.items).toEqual([1, 2, 3]);
    expect(walk.end).toEqual({ kind: "capped", maxItems: 3 });
  });

  // The trim itself can drop items even when the CURSOR was exhausted, and calling that `exhausted` would be
  // the same silent-prefix lie in a new place: the caller did not receive the whole collection.
  it("reports capped when the final trim drops items from an exhausted walk", async () => {
    const { fetchPage } = fakePages({ pages: [{ items: [1, 2, 3, 4, 5], nextCursor: undefined }] });
    const walk = await collectCursorPages({ fetchPage, maxItems: 3 });
    expect(walk.items).toEqual([1, 2, 3]);
    expect(walk.end).toEqual({ kind: "capped", maxItems: 3 });
  });

  it("still reports exhausted when a cap is set and the trim drops nothing", async () => {
    const { fetchPage } = fakePages({ pages: [{ items: [1, 2, 3], nextCursor: undefined }] });
    const walk = await collectCursorPages({ fetchPage, maxItems: 3 });
    expect(walk.items).toEqual([1, 2, 3]);
    expect(walk.end).toEqual({ kind: "exhausted" });
  });

  // A ceiling that cannot bound the walk silently removes the only backstop against endlessly distinct
  // cursors, so it is refused rather than substituted.
  it("refuses a page ceiling that would not bound the walk", async () => {
    const { fetchPage } = fakePages({ pages: [{ items: [1], nextCursor: undefined }] });
    await expect(collectCursorPages({ fetchPage, maxPages: Number.NaN })).rejects.toThrow(
      "maxPages must be a positive safe integer",
    );
    await expect(collectCursorPages({ fetchPage, maxPages: 0 })).rejects.toThrow(
      "maxPages must be a positive safe integer",
    );
  });

  it("requests only the remaining budget as the page size", async () => {
    const { fetchPage, seenPageSizes } = fakePages({
      pages: [
        { items: [1, 2], nextCursor: "c1" },
        { items: [3, 4], nextCursor: "c2" },
      ],
    });
    await collectCursorPages({ fetchPage, maxItems: 3 });
    // first page asks for 3; after collecting 2, the second asks for the remaining 1; then the cap is hit.
    expect(seenPageSizes).toEqual([3, 1]);
  });

  it("stops fetching once the cap is reached even if a next cursor remains", async () => {
    const { fetchPage, seenCursors } = fakePages({
      pages: [
        { items: [1, 2], nextCursor: "c1" },
        { items: [99], nextCursor: undefined },
      ],
    });
    const walk = await collectCursorPages({ fetchPage, maxItems: 2 });
    expect(walk.items).toEqual([1, 2]);
    expect(walk.end).toEqual({ kind: "capped", maxItems: 2 });
    expect(seenCursors).toEqual([undefined]);
  });

  // A cap the walk never reaches must still report exhaustion, not `capped` — otherwise every capped-but-short
  // lane would warn about truncation that did not happen.
  it("reports exhausted when a cap is set but the cursor runs out first", async () => {
    const { fetchPage } = fakePages({ pages: [{ items: [1], nextCursor: undefined }] });
    const walk = await collectCursorPages({ fetchPage, maxItems: 50 });
    expect(walk.items).toEqual([1]);
    expect(walk.end).toEqual({ kind: "exhausted" });
  });

  // THE REGRESSION. An empty page whose cursor MOVED is not the end of the collection. Slack documents this
  // exact shape; the old `items.length === before` guard returned page 1 only and called it complete.
  it("follows a moved cursor past an empty page", async () => {
    const { fetchPage, seenCursors } = fakePages({
      pages: [
        { items: [1, 2], nextCursor: "c2" },
        { items: [], nextCursor: "c3" },
        { items: [3, 4], nextCursor: undefined },
      ],
    });
    const walk = await collectCursorPages({ fetchPage });
    expect(walk.items).toEqual([1, 2, 3, 4]);
    expect(walk.end).toEqual({ kind: "exhausted" });
    expect(seenCursors).toEqual([undefined, "c2", "c3"]);
  });

  it("follows several consecutive empty pages while the cursor keeps moving", async () => {
    const { fetchPage } = fakePages({
      pages: [
        { items: ["a"], nextCursor: "c1" },
        { items: [], nextCursor: "c2" },
        { items: [], nextCursor: "c3" },
        { items: ["b"], nextCursor: undefined },
      ],
    });
    expect((await collectCursorPages({ fetchPage })).items).toEqual(["a", "b"]);
  });

  // A boundary case, NOT the empty-page regression: an endpoint with nothing to give must read as a complete
  // empty collection rather than as truncation, or every empty lane would warn. It stays green under the old
  // guard by design — the regression tests above are the ones that fail without the fix.
  it("reports an empty collection as exhausted, not as truncation", async () => {
    const { fetchPage } = fakePages({ pages: [{ items: [], nextCursor: undefined }] });
    const walk = await collectCursorPages({ fetchPage });
    expect(walk.items).toEqual([]);
    expect(walk.end).toEqual({ kind: "exhausted" });
  });

  it("stops and reports stuck when an empty page repeats the cursor just used", async () => {
    const { fetchPage, seenCursors } = fakePages({
      pages: [
        { items: ["a"], nextCursor: "c1" },
        { items: [], nextCursor: "c1" },
        { items: ["should-not-fetch"], nextCursor: undefined },
      ],
    });
    const walk = await collectCursorPages({ fetchPage });
    expect(walk.items).toEqual(["a"]);
    expect(walk.end).toEqual({ cursor: "c1", kind: "stuck" });
    expect(seenCursors).toEqual([undefined, "c1"]);
  });

  // The cassette-replay shape: a re-served page carries ITEMS, so the old empty-page guard never caught it and
  // the walk spun until the item cap. The page's items are KEPT — it came back from a real cursor, and only its
  // forward pointer is stuck.
  it("keeps a re-served page's items but stops, when it repeats an earlier cursor", async () => {
    const { fetchPage, seenCursors } = fakePages({
      pages: [
        { items: ["a"], nextCursor: "c1" },
        { items: ["a"], nextCursor: "c1" },
        { items: ["should-not-fetch"], nextCursor: undefined },
      ],
    });
    const walk = await collectCursorPages({ fetchPage });
    expect(walk.items).toEqual(["a", "a"]);
    expect(walk.end).toEqual({ cursor: "c1", kind: "stuck" });
    expect(seenCursors).toEqual([undefined, "c1"]);
  });

  // A return-to-seed cycle is why the seen set must be primed with a non-empty firstCursor: comparing only
  // against the cursor just used would fetch the seed page a second time before noticing.
  it("stops when the next cursor repeats an explicit firstCursor", async () => {
    const { fetchPage, seenCursors } = fakePages({
      pages: [
        { items: ["a"], nextCursor: "seed" },
        { items: ["should-not-fetch"], nextCursor: undefined },
      ],
    });
    const walk = await collectCursorPages({ fetchPage, firstCursor: "seed" });
    expect(walk.items).toEqual(["a"]);
    expect(walk.end).toEqual({ cursor: "seed", kind: "stuck" });
    expect(seenCursors).toEqual(["seed"]);
  });

  it("stops on a longer cursor cycle that returns to an already-seen cursor", async () => {
    const { fetchPage, seenCursors } = fakePages({
      pages: [
        { items: ["a"], nextCursor: "c1" },
        { items: ["b"], nextCursor: "c2" },
        { items: ["c"], nextCursor: "c1" },
        { items: ["should-not-fetch"], nextCursor: undefined },
      ],
    });
    const walk = await collectCursorPages({ fetchPage });
    expect(walk.items).toEqual(["a", "b", "c"]);
    expect(walk.end).toEqual({ cursor: "c1", kind: "stuck" });
    expect(seenCursors).toEqual([undefined, "c1", "c2"]);
  });

  it("stops at the page ceiling and reports it, rather than following distinct cursors forever", async () => {
    // An endpoint that never exhausts and never repeats a cursor — the only shape the ceiling exists for.
    const walk = await collectCursorPages({
      fetchPage: ({ cursor }) => {
        const n = cursor === undefined ? 0 : Number(cursor);
        return Promise.resolve({ items: [n], nextCursor: String(n + 1) });
      },
      maxPages: 3,
    });
    expect(walk.items).toEqual([0, 1, 2]);
    expect(walk.end).toEqual({ kind: "ceiling", pages: 3 });
  });

  it("does not report the ceiling on a walk that exhausts its cursor first", async () => {
    const { fetchPage } = fakePages({
      pages: [
        { items: [1], nextCursor: "c1" },
        { items: [2], nextCursor: undefined },
      ],
    });
    const walk = await collectCursorPages({ fetchPage, maxPages: 10 });
    expect(walk.end).toEqual({ kind: "exhausted" });
  });

  // An empty page consumes no item budget, so `maxItems` cannot bound a walk that only ever returns empty
  // advancing pages. The ceiling is the only thing that stops it.
  it("bounds an endless stream of empty advancing pages by the ceiling, not by maxItems", async () => {
    const walk = await collectCursorPages({
      fetchPage: ({ cursor }) => {
        const n = cursor === undefined ? 0 : Number(cursor);
        return Promise.resolve({ items: [] as readonly number[], nextCursor: String(n + 1) });
      },
      maxItems: 10,
      maxPages: 4,
    });
    expect(walk.items).toEqual([]);
    expect(walk.end).toEqual({ kind: "ceiling", pages: 4 });
  });

  // A page that says "there is more" while giving no cursor is not exhaustion. Without `hasMore` carried
  // separately it arrives as an absent cursor and a known-short read reports itself complete.
  it("reports no-cursor when a page promises more and supplies no cursor", async () => {
    const { fetchPage } = fakePages({ pages: [{ hasMore: true, items: ["a"], nextCursor: undefined }] });
    const walk = await collectCursorPages({ fetchPage });
    expect(walk.items).toEqual(["a"]);
    expect(walk.end).toEqual({ kind: "no-cursor" });
  });

  it("still reports exhausted when a page supplies no cursor and claims nothing", async () => {
    const { fetchPage } = fakePages({ pages: [{ hasMore: false, items: ["a"], nextCursor: undefined }] });
    expect((await collectCursorPages({ fetchPage })).end).toEqual({ kind: "exhausted" });
  });

  // A cap the caller set outranks `stuck`: they asked for a short read, so calling it truncation would make
  // every `--fetch-cap` run warn about a truncation it requested.
  it("reports capped rather than stuck when the cap was already met", async () => {
    const { fetchPage } = fakePages({
      pages: [
        { items: ["a"], nextCursor: "c1" },
        { items: ["b"], nextCursor: "c1" },
      ],
    });
    const walk = await collectCursorPages({ fetchPage, maxItems: 2 });
    expect(walk.items).toEqual(["a", "b"]);
    expect(walk.end).toEqual({ kind: "capped", maxItems: 2 });
  });

  it("still reports stuck when the cursor repeats below the cap", async () => {
    const { fetchPage } = fakePages({
      pages: [
        { items: ["a"], nextCursor: "c1" },
        { items: ["b"], nextCursor: "c1" },
      ],
    });
    const walk = await collectCursorPages({ fetchPage, maxItems: 50 });
    expect(walk.end).toEqual({ cursor: "c1", kind: "stuck" });
  });
});

describe("capReached", () => {
  it("is false when uncapped", () => {
    expect(capReached({ collected: 99, maxItems: undefined })).toBe(false);
  });

  it("is false below the cap", () => {
    expect(capReached({ collected: 2, maxItems: 3 })).toBe(false);
  });

  it("is true at the cap and above it", () => {
    expect(capReached({ collected: 3, maxItems: 3 })).toBe(true);
    expect(capReached({ collected: 4, maxItems: 3 })).toBe(true);
  });
});

describe("cursorStep", () => {
  it("is exhausted for an absent next cursor", () => {
    expect(cursorStep({ next: undefined, seen: new Set<string>() })).toEqual({ kind: "exhausted" });
  });

  it("is exhausted for an empty-string next cursor", () => {
    expect(cursorStep({ next: "", seen: new Set(["c1"]) })).toEqual({ kind: "exhausted" });
  });

  it("advances on a cursor not yet requested", () => {
    expect(cursorStep({ next: "c2", seen: new Set(["c1"]) })).toEqual({ cursor: "c2", kind: "advance" });
  });

  it("is stuck on a cursor already requested", () => {
    expect(cursorStep({ next: "c1", seen: new Set(["c1"]) })).toEqual({ cursor: "c1", kind: "stuck" });
  });

  it("advances on the first page when nothing has been seen yet", () => {
    expect(cursorStep({ next: "c1", seen: new Set<string>() })).toEqual({ cursor: "c1", kind: "advance" });
  });
});

describe("cursorWalkWarning", () => {
  it("is undefined for an exhausted walk", () => {
    expect(cursorWalkWarning({ end: { kind: "exhausted" }, lane: "slack channels" })).toBe(undefined);
  });

  // A cap is the caller asking for a short read, so it is not a truncation to warn about.
  it("is undefined for a walk the caller capped", () => {
    expect(cursorWalkWarning({ end: { kind: "capped", maxItems: 5 }, lane: "slack channels" })).toBe(undefined);
  });

  it("names the lane and the cursor for a stuck walk", () => {
    expect(cursorWalkWarning({ end: { cursor: "c9", kind: "stuck" }, lane: "linear issues" })).toBe(
      "linear issues may be incomplete: the endpoint repeated pagination cursor c9 instead of advancing",
    );
  });

  it("names the lane for an endpoint that promised a page and gave no cursor", () => {
    expect(cursorWalkWarning({ end: { kind: "no-cursor" }, lane: "linear issue i1 history" })).toBe(
      "linear issue i1 history is incomplete: the endpoint reported another page but gave no cursor to reach it",
    );
  });

  it("names the lane and the page count for a ceiling stop", () => {
    expect(cursorWalkWarning({ end: { kind: "ceiling", pages: 5000 }, lane: "slack channels" })).toBe(
      "slack channels may be incomplete: stopped at the 5000-page ceiling with the cursor still advancing",
    );
  });
});

describe("remainingBudget", () => {
  it("is undefined when uncapped", () => {
    expect(remainingBudget({ collected: 5, maxItems: undefined })).toBe(undefined);
  });

  it("is the difference when under the cap", () => {
    expect(remainingBudget({ collected: 3, maxItems: 10 })).toBe(7);
  });

  it("is zero (never negative) when at or past the cap", () => {
    expect(remainingBudget({ collected: 12, maxItems: 10 })).toBe(0);
  });
});
