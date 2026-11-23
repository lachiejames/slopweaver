/**
 * The screen-edge strips that draw the call's glow: the page's report parsed strictly, the strips lit only while
 * something is drawn, laid along the display without overlapping, and the colours they draw kept to the page's own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EDGE_STRIP_DEPTH,
  type EdgeGlowView,
  edgeGlowDocument,
  edgeGlowLit,
  edgeStripBounds,
  edgeStripCall,
  parseOverlayGlowReport,
  SPEAKING_RING,
} from "../../src/edgeGlow";

/** The owner's display, measured with `CGWindowListCopyWindowInfo`: the overlay window's whole bounds. */
const DISPLAY = { height: 982, width: 1512, x: 0, y: 0 };

/** A dark view: nothing reported, no share. */
const DARK: EdgeGlowView = { level: 0, pulse: null, sharing: false, state: "off" };

describe("parseOverlayGlowReport", () => {
  it("takes exactly a known state, a pulse key or null, and a level from 0 to 1", () => {
    expect([
      parseOverlayGlowReport({ value: { level: 0.4, pulse: null, state: "speaking" } }),
      parseOverlayGlowReport({ value: { level: 0, pulse: "call_abc", state: "off" } }),
      parseOverlayGlowReport({ value: { level: 1, pulse: null, state: "shared-speaking" } }),
    ]).toEqual([
      { level: 0.4, pulse: null, state: "speaking" },
      { level: 0, pulse: "call_abc", state: "off" },
      { level: 1, pulse: null, state: "shared-speaking" },
    ]);
  });

  it("refuses anything else: an extra or missing key, an unknown state, a level out of range, a bad pulse", () => {
    const values: readonly unknown[] = [
      undefined,
      [],
      { level: 0, pulse: null },
      { level: 0, pulse: null, state: "off", ring: "red" },
      { level: 0, pulse: null, state: "glowing" },
      { level: -0.01, pulse: null, state: "off" },
      { level: 1.01, pulse: null, state: "off" },
      { level: Number.NaN, pulse: null, state: "off" },
      { level: 0, pulse: "", state: "off" },
      { level: 0, pulse: "a\nb", state: "off" },
      { level: 0, pulse: `a${String.fromCodePoint(0x2028)}b`, state: "off" },
      { level: 0, pulse: `a${String.fromCodePoint(0x2029)}b`, state: "off" },
      { level: 0, pulse: "a\u007fb", state: "off" },
      { level: 0, pulse: "x".repeat(201), state: "off" },
      { level: 0, pulse: 7, state: "off" },
    ];
    expect(values.map((value) => parseOverlayGlowReport({ value }))).toEqual(values.map(() => undefined));
  });
});

describe("edgeGlowLit", () => {
  it("is dark with nothing reported and no share", () => {
    expect(edgeGlowLit({ view: DARK })).toBe(false);
  });

  it("lights for a steady state, a flash in flight, or a share main's ledger knows about", () => {
    expect([
      edgeGlowLit({ view: { ...DARK, state: "speaking" } }),
      edgeGlowLit({ view: { ...DARK, pulse: "call_1" } }),
      edgeGlowLit({ view: { ...DARK, sharing: true } }),
    ]).toEqual([true, true, true]);
  });
});

describe("edgeStripBounds", () => {
  it("lays four strips along the owner's display, the sides fitting between the top and bottom", () => {
    expect(edgeStripBounds({ depth: EDGE_STRIP_DEPTH, display: DISPLAY })).toEqual({
      bottom: { height: 96, width: 1512, x: 0, y: 886 },
      left: { height: 790, width: 96, x: 0, y: 96 },
      right: { height: 790, width: 96, x: 1416, y: 96 },
      top: { height: 96, width: 1512, x: 0, y: 0 },
    });
  });

  it("covers every edge point exactly once, so no two strips overlap", () => {
    const strips = Object.values(edgeStripBounds({ depth: EDGE_STRIP_DEPTH, display: DISPLAY }));
    const area = strips.reduce((sum, strip) => sum + strip.width * strip.height, 0);
    const inner = (DISPLAY.width - 2 * EDGE_STRIP_DEPTH) * (DISPLAY.height - 2 * EDGE_STRIP_DEPTH);
    expect(area).toBe(DISPLAY.width * DISPLAY.height - inner);
  });

  it("follows a display at a negative origin", () => {
    const strips = edgeStripBounds({ depth: 96, display: { height: 1080, width: 1920, x: -1920, y: -200 } });
    expect([strips.top.x, strips.top.y, strips.right.x, strips.bottom.y]).toEqual([-1920, -200, -96, 784]);
  });

  it("meets in the middle on a display shallower than two depths, never crossing", () => {
    const strips = edgeStripBounds({ depth: 96, display: { height: 150, width: 1000, x: 0, y: 0 } });
    expect([strips.top.height, strips.bottom.y, strips.left.height]).toEqual([75, 75, 0]);
  });
});

describe("edgeStripCall", () => {
  it("offsets the strip's box into the display, and carries the view as JSON", () => {
    const strip = edgeStripBounds({ depth: 96, display: { height: 982, width: 1512, x: 100, y: 0 } }).right;
    const view: EdgeGlowView = { level: 0.5, pulse: 'call_"x', sharing: true, state: "speaking" };
    expect(edgeStripCall({ display: { height: 982, width: 1512, x: 100, y: 0 }, strip, view })).toBe(
      'window.glow({"h":982,"level":0.5,"pulse":"call_\\"x","sharing":true,"state":"speaking","w":1512,"x":1416,"y":96})',
    );
  });
});

describe("edgeGlowDocument", () => {
  /** The strips' page, decoded. */
  const page = decodeURIComponent(edgeGlowDocument().replace("data:text/html;charset=utf-8,", ""));

  it("draws the speaking glow in the speaking orb's own ring, the colour the page's mood map gives it", () => {
    const parts = readFileSync(
      join(__dirname, "..", "..", "..", "site", "components", "voice", "orbParts.tsx"),
      "utf8",
    );
    expect(parts).toContain(`data-[mood=speaking]:[--v-ring:${SPEAKING_RING.replaceAll(" ", "_")}]`);
    expect(page).toContain(SPEAKING_RING);
  });

  it("carries the share's badge, and a reduce-motion rule that drops the flash over a steady border", () => {
    expect(page).toContain("● Sharing your screen");
    expect(page).toContain("@media (prefers-reduced-motion: reduce){#d[data-shared] .pulse{display:none}}");
  });
});
