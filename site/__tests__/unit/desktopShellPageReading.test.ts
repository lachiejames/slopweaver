/*
 * The page's reading carried from the console window to the voice's window. Measured: a call answered `read_page` on
 * `/queue` in the voice's window with "registers no reading of its own" while the console window's Queue registered
 * one, because only the page's path and title crossed.
 */
import { describe, expect, it } from "vitest";

import {
  carriedPageView,
  identityForShell,
  PAGE_READING_WIRE_MAX_CHARS,
  pageReadingForShell,
} from "../../lib/desktopPageReading";
import { pageIdentityOf } from "../../lib/desktopShell";
import type { PageReadWindow } from "../../lib/pageReadWindow";
import { PAGE_READ_MAX_BYTES, type PageView, pageRead } from "../../lib/pageVoice";

const QUEUE_SHOWS = { cards: [{ key: "ask:acme-1", title: "Approve the acme rollout" }], folded: 0 };

/** The console window's own view of `/queue`, as `heldPageView` builds it. */
const consoleView: PageView = {
  open: undefined,
  openBy: undefined,
  path: "/queue",
  shows: QUEUE_SHOWS,
  title: "Queue",
};

describe("the console window's page reading, as it crosses", () => {
  it("is what that window's own read_page answers, shows and cut alike", () => {
    expect(pageReadingForShell({ maxBytes: PAGE_READ_MAX_BYTES, view: consoleView })).toStrictEqual({
      shows: QUEUE_SHOWS,
      truncated: undefined,
    });
  });

  it("carries the cut when the page's reading is past the bound", () => {
    const big = { ...consoleView, shows: "x".repeat(1000) };
    const carried = pageReadingForShell({ maxBytes: 600, view: big })!;
    const own = pageRead({ maxBytes: 600, view: big }) as PageReadWindow;
    expect(carried.shows).toBe(own.shows);
    expect(own.nextFrom).toBeGreaterThan(0);
    expect(carried.truncated).toBe(
      `this read carries the first ${String(own.nextFrom)} of the page's 1002-byte reading; the rest does not cross to the voice's window`,
    );
  });

  // A window's `shows` is text, so the reading's own `drawnMore` crossed only inside it.
  it("names the whole reading's own cuts in the crossed cut, beside how much crossed", () => {
    const big = { ...consoleView, shows: { body: "x".repeat(1000), drawnMore: 3 } };
    const carried = pageReadingForShell({ maxBytes: 600, view: big })!;
    const own = pageRead({ maxBytes: 600, view: big }) as PageReadWindow;
    expect(carried.truncated).toBe(
      `this read carries the first ${String(own.nextFrom)} of the page's ${String(own.size)}-byte reading; the rest does not cross to the voice's window; the whole reading marks shows.drawnMore: 3`,
    );
  });

  it("is null when the page registers no reading", () => {
    expect(pageReadingForShell({ maxBytes: PAGE_READ_MAX_BYTES, view: { ...consoleView, shows: undefined } })).toBe(
      null,
    );
  });
});

describe("identityForShell", () => {
  const identity = {
    open: "ask:acme-1",
    path: "/queue",
    reading: { shows: QUEUE_SHOWS, truncated: undefined },
    title: "Queue",
  };

  it("sends the reading serialised, so the shell keeps it opaque", () => {
    expect(
      identityForShell({ carriesOpenCard: true, carriesOpenTitle: undefined, carriesPageReading: true, identity }),
    ).toStrictEqual({
      open: "ask:acme-1",
      path: "/queue",
      reading: JSON.stringify({ shows: QUEUE_SHOWS }),
      title: "Queue",
    });
  });

  it("sends null for a page that registers none", () => {
    const none = { ...identity, reading: null };
    expect(
      identityForShell({ carriesOpenCard: true, carriesOpenTitle: undefined, carriesPageReading: true, identity: none })
        .reading,
    ).toBe(null);
  });

  it("sends no reading to a shell that does not carry one, keeping the open card", () => {
    expect(
      identityForShell({ carriesOpenCard: true, carriesOpenTitle: undefined, carriesPageReading: undefined, identity }),
    ).toStrictEqual({
      open: "ask:acme-1",
      path: "/queue",
      title: "Queue",
    });
  });

  it("sends the open card's title to a shell that carries one, so the band names the card", () => {
    const titled = { ...identity, openTitle: "Review ABC-1" };
    expect(
      identityForShell({ carriesOpenCard: true, carriesOpenTitle: true, carriesPageReading: false, identity: titled }),
    ).toStrictEqual({ open: "ask:acme-1", openTitle: "Review ABC-1", path: "/queue", title: "Queue" });
  });

  it("drops the open card's title for a shell that does not carry it, and with the card itself", () => {
    const titled = { ...identity, openTitle: "Review ABC-1" };
    expect(
      identityForShell({ carriesOpenCard: true, carriesOpenTitle: false, carriesPageReading: false, identity: titled }),
    ).toStrictEqual({ open: "ask:acme-1", path: "/queue", title: "Queue" });
    expect(
      identityForShell({ carriesOpenCard: false, carriesOpenTitle: true, carriesPageReading: false, identity: titled }),
    ).toStrictEqual({ path: "/queue", title: "Queue" });
  });

  it("sends neither to the oldest shell, which accepts the page alone rather than dropping an identity", () => {
    expect(
      identityForShell({
        carriesOpenCard: undefined,
        carriesOpenTitle: undefined,
        carriesPageReading: undefined,
        identity,
      }),
    ).toStrictEqual({
      path: "/queue",
      title: "Queue",
    });
    expect(
      identityForShell({ carriesOpenCard: false, carriesOpenTitle: false, carriesPageReading: false, identity }),
    ).toStrictEqual({
      path: "/queue",
      title: "Queue",
    });
  });
});

describe("pageIdentityOf over a carried reading", () => {
  const wire = { path: "/queue", title: "Queue" };

  it("parses the console window's reading", () => {
    const reading = JSON.stringify({ shows: QUEUE_SHOWS, truncated: "cut" });
    expect(pageIdentityOf({ value: { ...wire, reading } })).toStrictEqual({
      ...wire,
      reading: { shows: QUEUE_SHOWS, truncated: "cut" },
    });
  });

  it("keeps null, the page's word that it registers none, apart from absent", () => {
    expect(pageIdentityOf({ value: { ...wire, reading: null } })).toStrictEqual({ ...wire, reading: null });
    expect(pageIdentityOf({ value: wire })).toStrictEqual(wire);
  });

  it("drops a reading that is not exactly one, keeping the page", () => {
    const malformed = [
      "not json",
      JSON.stringify({ truncated: "cut" }),
      JSON.stringify({ body: "x", shows: 1 }),
      JSON.stringify({ shows: 1, truncated: 2 }),
      JSON.stringify([1]),
      7,
      "x".repeat(PAGE_READING_WIRE_MAX_CHARS + 1),
    ];
    expect(malformed.map((reading) => pageIdentityOf({ value: { ...wire, reading } }))).toStrictEqual(
      malformed.map(() => wire),
    );
  });
});

describe("read_page in the voice's window", () => {
  it("answers the carried reading verbatim, path and card from the carried page", () => {
    const identity = pageIdentityOf({
      value: { open: "ask:acme-1", path: "/queue", reading: JSON.stringify({ shows: QUEUE_SHOWS }), title: "Queue" },
    })!;
    expect(pageRead({ maxBytes: PAGE_READ_MAX_BYTES, view: carriedPageView({ identity }) })).toStrictEqual({
      open: "ask:acme-1",
      page: "Queue",
      path: "/queue",
      shows: QUEUE_SHOWS,
      truncated: undefined,
    });
  });

  it("stays under the bound when the console window blanked a path that alone passes it", () => {
    const path = `/${"a".repeat(450)}`;
    const view: PageView = { ...consoleView, path, shows: { body: "x".repeat(4000) }, title: "Long" };
    const crossed = pageReadingForShell({ maxBytes: 512, view })!;
    const identity = pageIdentityOf({ value: { path, reading: JSON.stringify(crossed), title: "Long" } })!;
    const read = pageRead({ maxBytes: 512, view: carriedPageView({ identity }) });
    expect(new TextEncoder().encode(JSON.stringify(read)).length).toBeLessThanOrEqual(512);
    expect([read.path, read.page, read.shows]).toEqual(["", "", ""]);
  });

  // A longer path in the voice's window blanked the page's own fields to keep the reading.
  it("keeps a longer path whole and cuts the crossed reading to the largest start that fits beside it", () => {
    const crossed = pageReadingForShell({
      maxBytes: PAGE_READ_MAX_BYTES,
      view: { ...consoleView, shows: "x".repeat(30_000) },
    })!;
    const path = `/queue?x=${"q".repeat(1000)}`;
    const identity = pageIdentityOf({ value: { path, reading: JSON.stringify(crossed), title: "Queue" } })!;
    const read = pageRead({ maxBytes: PAGE_READ_MAX_BYTES, view: carriedPageView({ identity }) });
    const carried = String(read.shows).length;
    const bytes = (answer: unknown): number => new TextEncoder().encode(JSON.stringify(answer)).length;
    const grown = {
      ...read,
      // The crossed window opens on the serialised reading's quote, which escapes to two bytes, so grow it by one more.
      shows: `${String(read.shows)}x`,
      truncated: String(read.truncated).replace(`first ${String(carried)} `, `first ${String(carried + 1)} `),
    };
    expect([read.path, read.page, bytes(read) <= PAGE_READ_MAX_BYTES, bytes(grown) > PAGE_READ_MAX_BYTES]).toEqual([
      path,
      "Queue",
      true,
      true,
    ]);
    expect(read.truncated).toBe(
      `the voice's window carries only the first ${String(carried)} of the ${String(String(crossed.shows).length)} bytes of this page's reading that crossed to it; its own cut reads: ${String(crossed.truncated)}`,
    );
  });

  it("says the page registers none when the console window said so", () => {
    const identity = pageIdentityOf({ value: { path: "/settings", reading: null, title: "Settings" } })!;
    const read = pageRead({ maxBytes: PAGE_READ_MAX_BYTES, view: carriedPageView({ identity }) });
    expect(read.shows).toBe(
      "the Settings page registers no reading of its own; action_items has what is waiting on the owner, and code_find on " +
        "site/app can show what this page draws",
    );
  });

  it("says the reading did not reach it under an older app, never that the page has none", () => {
    const identity = pageIdentityOf({ value: { path: "/queue", title: "Queue" } })!;
    const read = pageRead({ maxBytes: PAGE_READ_MAX_BYTES, view: carriedPageView({ identity }) });
    expect(read.shows).toBe(
      "the Queue page's reading did not reach the voice's window: the desktop app or console here was built before " +
        "it crossed, so this says nothing about what the page draws; action_items has what is waiting on the owner",
    );
  });
});
