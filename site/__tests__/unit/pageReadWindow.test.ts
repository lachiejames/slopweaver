/*
 * `read_page` past its cut: windows of the page's serialised reading that never split a character, a read on that
 * walks to the end and rebuilds the reading exactly, and a read on refused once the page moved or crossed cut.
 */
import { describe, expect, it } from "vitest";

import { type PageReadWindow, pageReadingId, pageReadOnRefusal, pageWindowOf } from "../../lib/pageReadWindow";
import { type PageView, pageRead, pageReadOn } from "../../lib/pageVoice";

/** UTF-8 size of a string. */
const bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * The size of a first window's answer grown by the reading's next byte: past the bound, it proves the window carried
 * was the largest that fits. Every reading it is used on is ASCII, so a byte is a character.
 */
const grownBy1 = ({ read, text }: { read: PageReadWindow; text: string }) =>
  bytes(JSON.stringify({ ...read, nextFrom: read.nextFrom! + 1, shows: text.slice(0, read.nextFrom! + 1) }));

/** The refusal of a read on from a page that moved since. */
const MOVED =
  "the page moved since that read, to another page or this one drawn afresh, so read_page again from the start";

const BIG: PageView = {
  open: undefined,
  openBy: undefined,
  path: "/queue",
  shows: { body: 'the owner said "hold it" é\n'.repeat(400) },
  title: "Queue",
};

describe("pageReadingId", () => {
  it("is the length then FNV-1a and a second lane, the same for the same text and different for another", () => {
    expect(pageReadingId({ text: "" })).toBe("0-811c9dc59e3779b9");
    expect(pageReadingId({ text: "a" }).startsWith("1-e40c292c")).toBe(true);
    expect(pageReadingId({ text: "a" })).toBe(pageReadingId({ text: "a" }));
    expect(pageReadingId({ text: "b" })).not.toBe(pageReadingId({ text: "a" }));
  });

  // These two readings share one 32-bit FNV-1a, so a read on spliced them.
  it("tells apart two same-path readings whose FNV-1a alone collides", () => {
    const first = JSON.stringify(`${"A".repeat(20_000)}18831`);
    const redrawn = JSON.stringify(`${"A".repeat(20_000)}326020`);
    expect(pageReadingId({ text: first }).length).toBeGreaterThan(17);
    expect(pageReadingId({ text: first })).not.toBe(pageReadingId({ text: redrawn }));
  });
});

describe("pageWindowOf", () => {
  it("cuts back to the start of a character rather than splitting one", () => {
    expect(pageWindowOf({ from: 0, maxBytes: 2, text: "aéb" })).toEqual({ nextFrom: 1, size: 4, text: "a" });
    expect(pageWindowOf({ from: 1, maxBytes: 2, text: "aéb" })).toEqual({ nextFrom: 3, size: 4, text: "é" });
    expect(pageWindowOf({ from: 3, maxBytes: 2, text: "aéb" })).toEqual({ nextFrom: undefined, size: 4, text: "b" });
  });

  it("carries a character wider than the bound whole, so a window is never empty", () => {
    expect(pageWindowOf({ from: 1, maxBytes: 1, text: "aéb" })).toEqual({ nextFrom: 3, size: 4, text: "é" });
    expect(pageWindowOf({ from: 0, maxBytes: 0, text: "€" })).toEqual({ nextFrom: undefined, size: 3, text: "€" });
  });

  it("keeps a U+FEFF a window starts on, which a default decoder strips as a byte order mark", () => {
    expect(pageWindowOf({ from: 1, maxBytes: 3, text: "a﻿b" })).toEqual({ nextFrom: 4, size: 5, text: "﻿" });
  });
});

describe("pageReadOn", () => {
  it("walks a cut reading to its end, every read inside the bound, and the windows rebuild it exactly", () => {
    const first = pageRead({ maxBytes: 2048, view: BIG });
    expect("reading" in first).toBe(true);
    const windows: string[] = [String(first.shows)];
    let at: unknown = first;
    let reads = 1;
    while (typeof (at as { nextFrom?: unknown }).nextFrom === "number" && reads < 100) {
      const last = at as { nextFrom: number; reading: string };
      const next = pageReadOn({
        args: { from: last.nextFrom, path: "/queue", reading: last.reading },
        maxBytes: 2048,
        view: BIG,
      });
      expect(bytes(JSON.stringify(next))).toBeLessThanOrEqual(2048);
      windows.push(String((next as { shows: unknown }).shows));
      at = next;
      reads += 1;
    }
    expect(windows.join("")).toBe(JSON.stringify(BIG.shows));
    expect((at as { readOn: unknown }).readOn).toBe(undefined);
    expect(reads).toBeGreaterThan(2);
  });

  // A path near the bound left no room, and a one-character window passed it.
  it("carries no window, and offers no read on, when the page's own path, title and open card leave no room", () => {
    const path = `/${"a".repeat(1800)}`;
    const view: PageView = { ...BIG, path, title: "Long" };
    const read = pageRead({ maxBytes: 2048, view }) as { shows: unknown; nextFrom: unknown; truncated: unknown };
    expect(bytes(JSON.stringify(read))).toBeLessThanOrEqual(2048);
    expect(read.shows).toBe("");
    expect(read.nextFrom).toBe(undefined);
    expect(read.truncated).toBe(
      `no room beside this page's path, title and open card under the 2048-byte bound for any of its ${String(bytes(JSON.stringify(BIG.shows)))}-byte reading`,
    );
  });

  // A fixed 64-byte slack refused a one-character window that fit.
  it("carries the small window, and its read on, that a path near the bound still leaves room for", () => {
    const view: PageView = { ...BIG, path: `/${"a".repeat(16_057)}`, shows: { body: "x".repeat(20_000) } };
    const text = JSON.stringify(view.shows);
    const read = pageRead({ maxBytes: 16_384, view }) as PageReadWindow;
    expect(bytes(JSON.stringify(read))).toBeLessThanOrEqual(16_384);
    expect(grownBy1({ read, text })).toBeGreaterThan(16_384);
    expect([read.shows, read.nextFrom, read.readOn === undefined]).toEqual([`{"body":"${"x".repeat(57)}`, 66, false]);
  });

  // The window's two quotes were counted twice, refusing a one-character window that fit.
  it("carries the window, and its read on, when the answer with it lands just under the bound", () => {
    const view: PageView = { ...BIG, path: `/${"a".repeat(16_125)}`, shows: { body: "x".repeat(10_000) }, title: "T" };
    const text = JSON.stringify(view.shows);
    const read = pageRead({ maxBytes: 16_384, view }) as PageReadWindow;
    expect(bytes(JSON.stringify(read))).toBeLessThanOrEqual(16_384);
    expect(grownBy1({ read, text })).toBeGreaterThan(16_384);
    expect([read.shows, read.nextFrom, read.readOn === undefined]).toEqual(['{"bod', 5, false]);
  });

  // Four shrinking passes did not converge on a reading of nothing but escapes, and a
  // frame reserving the widest `nextFrom` and `size` refused the room left, so a window that fit read as no room.
  it("carries the window that fits beside a near-bound path when the reading is all escapes", () => {
    const view: PageView = {
      ...BIG,
      open: undefined,
      path: `/${"p".repeat(16_128)}`,
      shows: '"'.repeat(2000),
      title: "T",
    };
    const text = JSON.stringify(view.shows);
    const read = pageRead({ maxBytes: 16_384, view }) as PageReadWindow;
    expect(bytes(JSON.stringify(read))).toBeLessThanOrEqual(16_384);
    expect(grownBy1({ read, text })).toBeGreaterThan(16_384);
    expect([read.shows, read.nextFrom, read.readOn === undefined]).toEqual([text.slice(0, 3), 3, false]);
  });

  // The last window was refused for want of room for a read on it does not carry.
  it("reads on to the last byte when only the last window, carrying no read on, fits beside the path", () => {
    const view: PageView = { ...BIG, path: `/${"a".repeat(16_148)}`, shows: { body: "x".repeat(100) }, title: "T" };
    const text = JSON.stringify(view.shows);
    const last = pageReadOn({
      args: { from: 110, path: view.path, reading: pageReadingId({ text }) },
      maxBytes: 16_384,
      view,
    }) as PageReadWindow;
    expect(bytes(JSON.stringify(last))).toBeLessThanOrEqual(16_384);
    expect([last.shows, last.start, last.nextFrom, last.readOn]).toEqual(["}", 110, undefined, undefined]);
  });

  it("stays under the bound when the page's own path leaves no room even to say so, carrying neither path nor title", () => {
    const view: PageView = {
      ...BIG,
      path: `/${"a".repeat(16_400)}`,
      shows: { body: "x".repeat(10_000) },
      title: "Long",
    };
    const read = pageRead({ maxBytes: 16_384, view }) as PageReadWindow;
    expect(bytes(JSON.stringify(read))).toBeLessThanOrEqual(16_384);
    expect([read.path, read.page, read.shows, read.nextFrom]).toEqual(["", "", "", undefined]);
    expect(read.truncated).toBe(
      "this page's own path, title and open card leave no room under this read's bound even to say so, so none of them rides in it, nor any of its reading",
    );
  });

  // Fields that fit, but not beside the longer no-room sentence, were dropped.
  it("keeps a path just short of the bound whole, beside the shortest saying that none of its reading fits", () => {
    const view: PageView = { ...BIG, path: `/${"a".repeat(16_166)}`, shows: { body: "x".repeat(20_000) }, title: "T" };
    const read = pageRead({ maxBytes: 16_384, view }) as PageReadWindow;
    expect(bytes(JSON.stringify(read))).toBeLessThanOrEqual(16_384);
    expect([read.path, read.page, read.shows, read.nextFrom, read.truncated]).toEqual([
      view.path,
      "T",
      "",
      undefined,
      "no room under this read's bound for any of its reading",
    ]);
  });

  it("reads on through the sentence standing in for a page with no reading of its own", () => {
    const view: PageView = { ...BIG, shows: undefined, title: "T".repeat(700) };
    const first = pageRead({ maxBytes: 1200, view }) as PageReadWindow;
    expect(first.nextFrom).toBeGreaterThan(0);
    const next = pageReadOn({
      args: { from: first.nextFrom, path: "/queue", reading: first.reading },
      maxBytes: 1200,
      view,
    }) as PageReadWindow;
    expect([next.start, `${String(first.shows)}${String(next.shows)}`.startsWith('"the TTT')]).toEqual([
      first.nextFrom,
      true,
    ]);
  });

  it("reads on through the stand-in for a page whose reading never reached the voice's window", () => {
    const view: PageView = { ...BIG, carried: { kind: "unreached" }, shows: undefined, title: "T".repeat(700) };
    const first = pageRead({ maxBytes: 1200, view }) as PageReadWindow;
    expect(first.nextFrom).toBeGreaterThan(0);
    const next = pageReadOn({
      args: { from: first.nextFrom, path: "/queue", reading: first.reading },
      maxBytes: 1200,
      view,
    }) as PageReadWindow;
    expect([next.start, `${String(first.shows)}${String(next.shows)}`.startsWith('"the TTT')]).toEqual([
      first.nextFrom,
      true,
    ]);
  });

  it("refuses a read on once the page was redrawn", () => {
    const first = pageRead({ maxBytes: 2048, view: BIG }) as { nextFrom: number; reading: string };
    const redrawn: PageView = { ...BIG, shows: { body: "redrawn ".repeat(800) } };
    expect(
      pageReadOn({
        args: { from: first.nextFrom, path: "/queue", reading: first.reading },
        maxBytes: 2048,
        view: redrawn,
      }),
    ).toEqual({ refused: MOVED });
  });

  it("keeps a moved page's refusal under the bound however long its path now is", () => {
    const first = pageRead({ maxBytes: 2048, view: BIG }) as { nextFrom: number; reading: string };
    const moved: PageView = { ...BIG, path: `/${"x".repeat(20_000)}` };
    const refusal = pageReadOn({
      args: { from: first.nextFrom, path: "/queue", reading: first.reading },
      maxBytes: 16_384,
      view: moved,
    });
    expect(refusal).toEqual({ refused: MOVED });
    expect(bytes(JSON.stringify(refusal))).toBeLessThanOrEqual(16_384);
  });

  // A carried read's fields that fit, but not beside the longer sentence, were dropped.
  it("keeps a carried read's path whole beside the shortest saying when no window of what crossed fits", () => {
    const path = `/${"a".repeat(289)}`;
    const view: PageView = {
      carried: { kind: "carried", shows: "x".repeat(20_000), truncated: undefined },
      open: undefined,
      openBy: undefined,
      path,
      shows: undefined,
      title: "T",
    };
    const read = pageRead({ maxBytes: 400, view });
    expect(bytes(JSON.stringify(read))).toBeLessThanOrEqual(400);
    expect(read).toEqual({
      open: undefined,
      page: "T",
      path,
      shows: "",
      truncated: "no room under this read's bound for any of its reading",
    });
  });

  it("refuses a read on in the voice's window, where the reading crossed already cut", () => {
    const carried: PageView = { ...BIG, carried: { kind: "carried", shows: "…", truncated: "cut" }, shows: undefined };
    expect(
      pageReadOn({ args: { from: 10, path: "/queue", reading: "811c9dc5" }, maxBytes: 2048, view: carried }),
    ).toEqual({
      refused:
        "this page's reading was cut in the console window before it crossed to the voice's window, so no read here carries its rest",
    });
  });
});

describe("pageReadOnRefusal", () => {
  const now = { carried: false, path: "/queue", text: "abcdef" };
  const reading = pageReadingId({ text: "abcdef" });

  it("lets a read on from inside the same reading go ahead", () => {
    expect(pageReadOnRefusal({ from: 3, now, path: "/queue", reading })).toBe(undefined);
  });

  it("refuses arguments that do not name a window, another path, and a from outside the reading", () => {
    expect(pageReadOnRefusal({ from: 1.5, now, path: "/queue", reading })).toBe(
      "a read on names the window it continues: path, reading and from, exactly as the cut read gave them",
    );
    expect(pageReadOnRefusal({ from: 3, now, path: "/fleet", reading })).toBe(MOVED);
    expect(pageReadOnRefusal({ from: 6, now, path: "/queue", reading })).toBe(
      "from must sit inside the reading, past 0 and before its 6 bytes",
    );
  });

  it("refuses a from inside a character, and lets the first byte of the next one go ahead", () => {
    // "a€b": a is byte 0, € is bytes 1–3, b is byte 4 — so 2 and 3 open on half a character.
    const wide = { carried: false, path: "/queue", text: "a€b" };
    const wideReading = pageReadingId({ text: "a€b" });
    const halfway = "from must sit on the first byte of a character, as every nextFrom does";
    expect(pageReadOnRefusal({ from: 2, now: wide, path: "/queue", reading: wideReading })).toBe(halfway);
    expect(pageReadOnRefusal({ from: 3, now: wide, path: "/queue", reading: wideReading })).toBe(halfway);
    expect(pageReadOnRefusal({ from: 1, now: wide, path: "/queue", reading: wideReading })).toBe(undefined);
    expect(pageReadOnRefusal({ from: 4, now: wide, path: "/queue", reading: wideReading })).toBe(undefined);
  });
});
