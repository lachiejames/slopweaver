/*
 * The voice stage's inks measured on every point of its gradient ground: the gradient is bounded stretch by
 * stretch, in either interpolation space, and the bound is witnessed against sampled points.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyRows,
  compositeSrgb,
  encodeUnbounded,
  LINEAR_P3_FROM_SRGB,
  LINEAR_SRGB_FROM_LMS,
  LINEAR_SRGB_FROM_P3,
  LMS_FROM_OKLAB,
  type OklchColor,
  oklchToSrgb,
  parseOklch,
  type Rows,
  relativeLuminance,
  type SrgbColor,
  srgbContrastRatio,
} from "../../../lib/colorContrast";
import { ORB_MOODS } from "../../../lib/orbMood";
import { THEME_PALETTES } from "../../../lib/themePalettes";
import { type ColourBox, drawn, luminanceRatio, mixOklab, PAIRS, RENDERINGS, srgb } from "./paletteHarness";

/** `color-mix(in oklch, a share%, b)`: lightness and chroma by share, hue the shorter way round. */
function mixOklch({ a, b, share }: { a: OklchColor; b: OklchColor; share: number }): OklchColor {
  let delta = b.hue - a.hue;
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  return {
    chroma: a.chroma * share + b.chroma * (1 - share),
    hue: (a.hue + delta * (1 - share) + 360) % 360,
    lightness: a.lightness * share + b.lightness * (1 - share),
  };
}

/** The worst ratio a text luminance meets anywhere in a spread: 1 when the spread reaches the text's own luminance. */
function worstRatio({
  text,
  spread,
}: {
  text: number;
  spread: { readonly low: number; readonly high: number };
}): number {
  if (text >= spread.low && text <= spread.high) {
    return 1;
  }
  return Math.min(luminanceRatio({ one: text, two: spread.low }), luminanceRatio({ one: text, two: spread.high }));
}

/** How many stretches each segment of the voice stage's gradient is bounded over; more only tightens the bound. */
const STAGE_STRETCHES = 128;

/** A vector known only to lie, channel by channel, between two others. */
interface VectorBox {
  readonly low: readonly [number, number, number];
  readonly high: readonly [number, number, number];
}

/** A matrix over a box of vectors, bounded exactly: each output takes each input at whichever end its sign favours. */
function rowsOverBox({ rows, box }: { rows: Rows; box: VectorBox }): VectorBox {
  const end = ({ row, pick }: { row: Rows[number]; pick: "low" | "high" }): number =>
    row.reduce((sum, weight, index) => {
      const rises = weight >= 0;
      const takeHigh = (pick === "high") === rises;
      return sum + weight * (takeHigh ? box.high[index] : box.low[index]);
    }, 0);
  return {
    high: [
      end({ pick: "high", row: rows[0] }),
      end({ pick: "high", row: rows[1] }),
      end({ pick: "high", row: rows[2] }),
    ],
    low: [end({ pick: "low", row: rows[0] }), end({ pick: "low", row: rows[1] }), end({ pick: "low", row: rows[2] })],
  };
}

/** A box clamped into [0, 1] channel by channel — the gamut clip, which keeps the order of every pair. */
function clampBox({ box }: { box: VectorBox }): VectorBox {
  const clamp = ({ value }: { value: number }): number => Math.min(1, Math.max(0, value));
  return {
    high: [clamp({ value: box.high[0] }), clamp({ value: box.high[1] }), clamp({ value: box.high[2] })],
    low: [clamp({ value: box.low[0] }), clamp({ value: box.low[1] }), clamp({ value: box.low[2] })],
  };
}

/** A box of linear sRGB channels as a box of drawn, gamma-encoded colours; encoding rises with its input. */
function encodedBox({ box }: { box: VectorBox }): ColourBox {
  const encode = ({ vector }: { vector: readonly [number, number, number] }): SrgbColor => ({
    blue: encodeUnbounded({ linear: vector[2] }),
    green: encodeUnbounded({ linear: vector[1] }),
    red: encodeUnbounded({ linear: vector[0] }),
  });
  return { high: encode({ vector: box.high }), low: encode({ vector: box.low }) };
}

/**
 * Every colour one rendering draws for a gradient between `from` (t = 0) and `to` (t = 1) over t in [t0, t1],
 * interpolated in oklab, as CSS interpolates between non-legacy colours. A bound, not a sample: oklab is linear in t,
 * so each of `l`, `m`, `s` before the cube is linear and after it monotone, and its range over the interval is its
 * two end values; every later step is a matrix (bounded by `rowsOverBox`), a clip or the gamma encoding, each
 * order-preserving channel by channel.
 *
 * @returns the box every drawn colour on that stretch lies in
 */
function oklabStretch({
  from,
  to,
  t0,
  t1,
  rendering,
}: {
  from: OklchColor;
  to: OklchColor;
  t0: number;
  t1: number;
  rendering: (typeof RENDERINGS)[number];
}): ColourBox {
  const lab = ({ color }: { color: OklchColor }): [number, number, number] => [
    color.lightness,
    color.chroma * Math.cos((color.hue * Math.PI) / 180),
    color.chroma * Math.sin((color.hue * Math.PI) / 180),
  ];
  const one = lab({ color: from });
  const two = lab({ color: to });
  const at = ({ t }: { t: number }): [number, number, number] =>
    applyRows({
      rows: LMS_FROM_OKLAB,
      vector: [one[0] + (two[0] - one[0]) * t, one[1] + (two[1] - one[1]) * t, one[2] + (two[2] - one[2]) * t],
    });
  const start = at({ t: t0 });
  const end = at({ t: t1 });
  const cube = ({ value }: { value: number }): number => value ** 3;
  const lms: VectorBox = {
    high: [
      cube({ value: Math.max(start[0], end[0]) }),
      cube({ value: Math.max(start[1], end[1]) }),
      cube({ value: Math.max(start[2], end[2]) }),
    ],
    low: [
      cube({ value: Math.min(start[0], end[0]) }),
      cube({ value: Math.min(start[1], end[1]) }),
      cube({ value: Math.min(start[2], end[2]) }),
    ],
  };
  const linear = rowsOverBox({ box: lms, rows: LINEAR_SRGB_FROM_LMS });
  if (rendering === "srgb") {
    return encodedBox({ box: clampBox({ box: linear }) });
  }
  const p3 = clampBox({ box: rowsOverBox({ box: linear, rows: LINEAR_P3_FROM_SRGB }) });
  return encodedBox({ box: rowsOverBox({ box: p3, rows: LINEAR_SRGB_FROM_P3 }) });
}

/**
 * The same stretch interpolated in gamma-encoded sRGB between the two drawn ends instead — the older default, held
 * as well so the bound does not rest on which space a browser picks. Each channel is linear in t, so its ends bound it.
 *
 * @returns the box every drawn colour on that stretch lies in
 */
function srgbStretch({
  from,
  to,
  t0,
  t1,
  rendering,
}: {
  from: OklchColor;
  to: OklchColor;
  t0: number;
  t1: number;
  rendering: (typeof RENDERINGS)[number];
}): ColourBox {
  const one = drawn({ color: from, rendering });
  const two = drawn({ color: to, rendering });
  const at = ({ t }: { t: number }): SrgbColor => compositeSrgb({ alpha: t, background: one, foreground: two });
  const start = at({ t: t0 });
  const end = at({ t: t1 });
  return {
    high: {
      blue: Math.max(start.blue, end.blue),
      green: Math.max(start.green, end.green),
      red: Math.max(start.red, end.red),
    },
    low: {
      blue: Math.min(start.blue, end.blue),
      green: Math.min(start.green, end.green),
      red: Math.min(start.red, end.red),
    },
  };
}

describe("contrast on the opaque planes", () => {
  it("measures every ink the voice stage draws, on every point of its gradient ground and in its opaque frames", () => {
    const voice = join(import.meta.dirname, "../../../components/voice");
    const stage = readFileSync(join(voice, "VoiceStage.tsx"), "utf8");
    // The model below is this gradient, read from the component so the two cannot drift apart.
    expect(stage).toContain(
      "[--stage-edge:color-mix(in_oklch,var(--c-bg)_70%,white)] dark:[--stage-edge:color-mix(in_oklch,var(--c-bg)_70%,black)] bg-[radial-gradient(ellipse_at_28%_45%,color-mix(in_oklch,var(--c-bg)_86%,var(--v-ring))_0%,var(--c-bg)_55%,var(--stage-edge)_100%)]",
    );
    expect(readFileSync(join(voice, "StageSide.tsx"), "utf8")).toContain("border-border bg-(--c-card) px-[0.7rem]");
    const history = readFileSync(join(voice, "StageHistory.tsx"), "utf8");
    expect(history).toContain("bg-(--c-panel)");
    expect(history).not.toContain("transparent)]");
    expect(history).toContain("data-[who=owner]:bg-[color-mix(in_oklch,var(--c-primary)_22%,var(--c-panel))]");
    // A turn still being said has no fill, so its words are ink on the bare stage ground, measured below.
    expect(history).toContain(
      "const SAYING = `${TURN} border-dashed border-border bg-transparent font-light text-foreground`;",
    );
    // A typed turn's label inherits the bubble's ink: muted on the owner's bubble falls under 4.5:1 in three palettes.
    expect(history).toContain('const TYPED_LABEL = "mr-[0.4rem] text-[0.7rem] uppercase tracking-wide";');
    expect(history.split("<span className={TYPED_LABEL}>typed</span>").length - 1).toBe(2);
    // A tapped bubble's time line inherits the bubble's ink too, for the same reason: its classes set no colour, and
    // the one line drawn is drawn with them alone.
    const saidAt = /^const SAID_AT = "([^"]+)";$/mu.exec(history)![1].split(" ");
    expect(saidAt).toEqual(["mt-[0.2rem]", "block", "text-[0.7rem]", "leading-[1.4]"]);
    expect(history.split("className={SAID_AT}").length - 1).toBe(1);
    // Every mood's ring, read from the one class that sets them; `var(--c-primary)` is the idle and off moods'.
    const orbParts = readFileSync(join(voice, "orbParts.tsx"), "utf8");
    const rings = [...orbParts.matchAll(/\[--v-ring:(oklch\([^\]]+\)|var\(--c-primary\))\]/gu)].map((match) =>
      match[1].replaceAll("_", " "),
    );
    expect(rings.length).toBe(ORB_MOODS.length);
    // Each ring is its own class: two run together are one token Tailwind cannot read, and both moods lose colour.
    const ringClasses = /export const MOOD_RING =\s*"([^"]+)"/u.exec(orbParts)![1].split(" ");
    expect(ringClasses.length).toBe(ORB_MOODS.length);
    expect(ringClasses.filter((token) => !/^(?:data-\[mood=[a-z]+\]:)?\[--v-ring:[^\]\s]+\]$/u.test(token))).toEqual(
      [],
    );
    const failing: string[] = [];
    for (const { family, mode, palette } of PAIRS) {
      const bg = parseOklch({ value: palette.bg });
      // `color-mix(in oklch, bg 70%, white|black)`: white and black carry no hue, so the ground's hue stays.
      let edge = { ...bg, chroma: bg.chroma * 0.7, lightness: bg.lightness * 0.7 };
      if (mode === "light") {
        edge = { ...edge, lightness: bg.lightness * 0.7 + 0.3 };
      }
      const primary = parseOklch({ value: palette.primary });
      const ink = parseOklch({ value: palette.ink });
      const inks = {
        ink,
        muted: parseOklch({ value: palette.muted }),
        primary,
      };
      const panel = parseOklch({ value: palette.panel });
      for (const ring of rings) {
        let tint = primary;
        if (ring !== "var(--c-primary)") {
          tint = parseOklch({ value: ring });
        }
        const centre = mixOklch({ a: bg, b: tint, share: 0.86 });
        // Two segments, each cut into stretches; every stretch is BOUNDED (`oklabStretch`, `srgbStretch`), so no
        // point between two cuts goes unmeasured. Both interpolation spaces are held.
        const path = [centre, bg, edge] as const;
        for (const [from, to] of [
          [path[0], path[1]],
          [path[1], path[2]],
        ] as const) {
          for (let cut = 0; cut < STAGE_STRETCHES; cut += 1) {
            const t0 = cut / STAGE_STRETCHES;
            const t1 = (cut + 1) / STAGE_STRETCHES;
            for (const rendering of RENDERINGS) {
              for (const stretch of [oklabStretch, srgbStretch]) {
                const under = stretch({ from, rendering, t0, t1, to });
                // A frame is opaque, so the gradient under it shows through nowhere: its ground is its own fill.
                const solid = ({ fill }: { fill: SrgbColor }): ColourBox => ({ high: fill, low: fill });
                const grounds = {
                  bare: under,
                  card: solid({ fill: srgb({ rendering, value: palette.card }) }),
                  panel: solid({ fill: drawn({ color: panel, rendering }) }),
                };
                const drawnOn: readonly [keyof typeof grounds, keyof typeof inks][] = [
                  ["bare", "ink"],
                  ["bare", "muted"],
                  ["bare", "primary"],
                  ["card", "ink"],
                  ["card", "muted"],
                  ["panel", "ink"],
                ];
                for (const [where, which] of drawnOn) {
                  const box = grounds[where];
                  const measured = worstRatio({
                    spread: {
                      high: relativeLuminance({ color: box.high }),
                      low: relativeLuminance({ color: box.low }),
                    },
                    text: relativeLuminance({ color: drawn({ color: inks[which], rendering }) }),
                  });
                  if (measured < 4.5) {
                    failing.push(`${family}/${mode} ${which} on the stage's ${where} ground (${ring}, ${rendering})`);
                  }
                }
              }
            }
          }
        }
      }
      // The owner's own turn: an opaque bubble of the accent mixed into the panel, its words and a typed turn's label in ink.
      const ownerBubble = mixOklch({ a: primary, b: panel, share: 0.22 });
      for (const rendering of RENDERINGS) {
        if (
          srgbContrastRatio({
            background: drawn({ color: ownerBubble, rendering }),
            foreground: drawn({ color: ink, rendering }),
          }) < 4.5
        ) {
          failing.push(`${family}/${mode} ink on the owner's own turn (${rendering})`);
        }
      }
    }
    expect([...new Set(failing.map((line) => line.replace(/ \(.*\)$/u, "")))]).toEqual([]);
  });

  it("bounds every colour a gradient stretch draws: each point on it, in either space, lies inside its box", () => {
    // The witness for the stage's bound: a stretch's box holds every sampled point on it, and a box over a single
    // point is that point. The pairs span light and dark grounds, a saturated ring and a P3-only colour.
    const pairs = [
      [parseOklch({ value: THEME_PALETTES.teal.light.bg }), parseOklch({ value: "oklch(0.62 0.19 340)" })],
      [parseOklch({ value: THEME_PALETTES.purple.dark.bg }), parseOklch({ value: "oklch(0.86 0.16 95)" })],
      [parseOklch({ value: "oklch(0.7 0.3 145)" }), parseOklch({ value: "oklch(0.2 0.02 250)" })],
    ] as const;
    const inside = ({ box, color }: { box: ColourBox; color: SrgbColor }): boolean =>
      (["red", "green", "blue"] as const).every(
        (channel) => color[channel] >= box.low[channel] - 1e-9 && color[channel] <= box.high[channel] + 1e-9,
      );
    const outside: string[] = [];
    for (const [from, to] of pairs) {
      for (const rendering of RENDERINGS) {
        const t0 = 0.25;
        const t1 = 0.5;
        const oklab = oklabStretch({ from, rendering, t0, t1, to });
        const encoded = srgbStretch({ from, rendering, t0, t1, to });
        for (let step = 0; step <= 50; step += 1) {
          const t = t0 + ((t1 - t0) * step) / 50;
          if (!inside({ box: oklab, color: drawn({ color: mixOklab({ a: to, b: from, share: t }), rendering }) })) {
            outside.push(`oklab ${rendering} ${String(t)}`);
          }
          const one = drawn({ color: from, rendering });
          const two = drawn({ color: to, rendering });
          if (!inside({ box: encoded, color: compositeSrgb({ alpha: t, background: one, foreground: two }) })) {
            outside.push(`srgb ${rendering} ${String(t)}`);
          }
        }
        const point = drawn({ color: mixOklab({ a: to, b: from, share: 0.4 }), rendering });
        const degenerate = oklabStretch({ from, rendering, t0: 0.4, t1: 0.4, to });
        expect(Math.abs(degenerate.low.green - point.green)).toBeLessThan(1e-9);
        expect(Math.abs(degenerate.high.green - point.green)).toBeLessThan(1e-9);
      }
    }
    expect(outside).toEqual([]);
  });

  it("darkening the stage's edge in light mode, as it once did, puts its muted text under 4.5:1", () => {
    // The witness for the edge's direction: teal light's ground darkened 30% to black, under its own muted ink.
    const teal = THEME_PALETTES.teal.light;
    const bg = parseOklch({ value: teal.bg });
    const darkened = { ...bg, chroma: bg.chroma * 0.7, lightness: bg.lightness * 0.7 };
    const measured = srgbContrastRatio({
      background: oklchToSrgb({ color: darkened }),
      foreground: oklchToSrgb({ color: parseOklch({ value: teal.muted }) }),
    });
    expect(measured).toBeLessThan(4.5);
  });
});
