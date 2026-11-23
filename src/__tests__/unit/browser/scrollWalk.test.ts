import { describe, expect, it } from "vitest";

import {
  PAGE_OVERLAP,
  pageDelta,
  parseScrollPosition,
  SCROLL_POSITION_SOURCE,
  type ScrollPageStep,
  type ScrollPosition,
  screenAt,
  screenCount,
  scrollPicturePath,
  scrollWalkLines,
} from "../../../browser/scrollWalk.js";

const STEM = "/tmp/session/scroll-2026-09-16T00-00-00.000Z";

const at = (over: Partial<ScrollPosition> = {}): ScrollPosition => ({
  documentHeight: 10419,
  viewportHeight: 900,
  y: 0,
  ...over,
});

const step = (over: Partial<ScrollPageStep> = {}): ScrollPageStep => ({
  at: at(),
  moved: true,
  page: 1,
  picturePath: `${STEM}-1.png`,
  ...over,
});

const evalReply = ({ value }: { value: unknown }): string =>
  `### Ran Playwright code\n### Result\n${JSON.stringify(value, null, 2)}\n`;

describe("how far one screen of a walk moves", () => {
  it("moves most of a viewport rather than all of it, so nothing falls on the seam between two pictures", () => {
    expect(PAGE_OVERLAP).toBeLessThan(1);
    expect(pageDelta({ position: at({ viewportHeight: 1000 }), up: false })).toBe(850);
  });

  it("moves the other way when the walk is going up", () => {
    expect(pageDelta({ position: at({ viewportHeight: 1000 }), up: true })).toBe(-850);
  });

  it("reads the delta off the LIVE viewport, so a tall display and a laptop move different amounts", () => {
    expect(pageDelta({ position: at({ viewportHeight: 1800 }), up: false })).toBe(1530);
    expect(pageDelta({ position: at({ viewportHeight: 600 }), up: false })).toBe(510);
  });

  it("moves at least one pixel when the page reports no viewport at all, rather than wheeling nothing", () => {
    expect(pageDelta({ position: at({ viewportHeight: 0 }), up: false })).toBe(1);
  });
});

describe("where in the document one screen is", () => {
  it("counts the screens a document takes, rounding a part-screen up", () => {
    expect(screenCount({ position: at({ documentHeight: 10419, viewportHeight: 900 }) })).toBe(12);
  });

  it("counts a document shorter than the viewport as one screen", () => {
    expect(screenCount({ position: at({ documentHeight: 400, viewportHeight: 900 }) })).toBe(1);
  });

  it("answers one screen rather than dividing by a viewport the page reports as nothing", () => {
    expect(screenCount({ position: at({ viewportHeight: 0 }) })).toBe(1);
  });

  it("numbers the top of the document as screen one", () => {
    expect(screenAt({ position: at({ y: 0 }) })).toBe(1);
  });

  it("numbers the screen a scroll position lands on", () => {
    expect(screenAt({ position: at({ viewportHeight: 900, y: 2611 }) })).toBe(3);
  });

  it("never numbers a screen past the count, on a page that scrolled past its own reported height", () => {
    expect(screenAt({ position: at({ documentHeight: 1000, viewportHeight: 900, y: 9000 }) })).toBe(2);
  });
});

describe("where each screen's picture goes", () => {
  it("names every picture of one walk from the same stem", () => {
    expect(scrollPicturePath({ page: 2, stem: STEM })).toBe(`${STEM}-2.png`);
  });
});

describe("asking the page where it is", () => {
  it("takes no element, so the client evaluates it against the page itself", () => {
    expect(SCROLL_POSITION_SOURCE.startsWith("() =>")).toBe(true);
  });

  it("carries no interpolation, so no caller data can become part of it", () => {
    expect(SCROLL_POSITION_SOURCE.includes("${")).toBe(false);
  });

  it("reads a position off a reply", () => {
    const stdout = evalReply({ value: { documentHeight: 10419, viewportHeight: 900, y: 2611 } });
    expect(parseScrollPosition({ stdout })).toEqual({ documentHeight: 10419, viewportHeight: 900, y: 2611 });
  });

  it("answers null when the reply carries no Result section at all", () => {
    expect(parseScrollPosition({ stdout: "### Ran Playwright code\n" })).toBe(null);
  });

  it("answers null when a field is missing, rather than defaulting one nobody measured", () => {
    expect(parseScrollPosition({ stdout: evalReply({ value: { viewportHeight: 900, y: 0 } }) })).toBe(null);
  });

  it("answers null when a field is a string, rather than coercing it", () => {
    const stdout = evalReply({ value: { documentHeight: "10419", viewportHeight: 900, y: 0 } });
    expect(parseScrollPosition({ stdout })).toBe(null);
  });
});

describe("what a walk prints", () => {
  it("says where each screen is in the document, which a viewport picture cannot say for itself", () => {
    const lines = scrollWalkLines({ steps: [step({ at: at({ y: 765 }) })], up: false });
    expect(lines).toEqual([`  ${STEM}-1.png — screen 1 of ~12, y 765 of 10419`]);
  });

  it("prints one line per screen, in the order they were photographed", () => {
    const lines = scrollWalkLines({
      steps: [
        step({ at: at({ y: 765 }), page: 1, picturePath: `${STEM}-1.png` }),
        step({ at: at({ y: 1530 }), page: 2, picturePath: `${STEM}-2.png` }),
      ],
      up: false,
    });
    expect(lines).toEqual([
      `  ${STEM}-1.png — screen 1 of ~12, y 765 of 10419`,
      `  ${STEM}-2.png — screen 2 of ~12, y 1530 of 10419`,
    ]);
  });

  it("says the page did not move, so N identical pictures are never reported as N screens", () => {
    const lines = scrollWalkLines({ steps: [step({ at: at({ y: 9519 }), moved: false })], up: false });
    expect(lines[0]).toBe(
      `  ${STEM}-1.png — screen 11 of ~12, y 9519 of 10419 — the page did not move, so this is the bottom of what the wheel can reach here`,
    );
  });

  it("names the TOP as the edge when the walk was going up", () => {
    const lines = scrollWalkLines({ steps: [step({ at: at({ y: 0 }), moved: false })], up: true });
    expect(lines[0]).toContain("this is the top of what the wheel can reach here");
  });

  it("prints nothing at all for a walk that photographed no screens", () => {
    expect(scrollWalkLines({ steps: [], up: false })).toEqual([]);
  });
});
