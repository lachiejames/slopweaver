/*
 * Nothing fades text: every partial opacity, filter and mask in the components and stylesheets is on something that
 * is not text, placeholders draw in full muted ink, the page column has a ground, and every scrim is accounted for.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compositeSrgb, type OklchColor, parseOklch, srgbContrastRatio } from "../../../lib/colorContrast";
import { type THEME_MODES, THEME_PALETTES } from "../../../lib/themePalettes";
import { drawn, srgb, WALLPAPER_GLOWS } from "./paletteHarness";
import { sourceFiles } from "./sourceHarness";

/**
 * A stylesheet's `@keyframes` blocks, by name, and everything else: an animation's fade is judged by what runs it,
 * the rest of the sheet by its own rules.
 */
function splitKeyframes({ css }: { css: string }): { keyframes: Map<string, string>; rest: string } {
  const keyframes = new Map<string, string>();
  let rest = "";
  let from = 0;
  for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/gu)) {
    if (match.index < from) {
      continue;
    }
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth > 0 && end < css.length) {
      if (css[end] === "{") {
        depth += 1;
      } else if (css[end] === "}") {
        depth -= 1;
      }
      end += 1;
    }
    rest += css.slice(from, match.index);
    keyframes.set(match[1], css.slice(match.index, end));
    from = end;
  }
  return { keyframes, rest: rest + css.slice(from) };
}

/**
 * The components that run an animation fading or filtering what it covers, none of it on text: the window's edge
 * glow, the orb wherever it is dragged — its moods, and a mood badge's icon glyph (`aria-hidden`), which pops on to full opacity and,
 * relaying, flies off — and the dim round a lifted region of the owner's screen, which fades in and carries no text.
 */
const ORB_ANIMATION_RUNNERS = ["voice/EdgeGlow.tsx", "voice/OrbControls.tsx", "voice/ScreenFocus.tsx"];

/** One wallpaper glow's colour: the accent with its hue turned, as `oklch(from var(--c-primary) l c calc(h ± n))`. */
function glowColour({ primary, hueShift }: { primary: string; hueShift: number }): OklchColor {
  const accent = parseOklch({ value: primary });
  return { ...accent, hue: (accent.hue + hueShift + 360) % 360 };
}

/**
 * The black scrims a modal surface floats over, per mode, as a percentage. The modal's own planes are opaque, so a
 * scrim never sits under a word; "draws every scrim this file knows" holds each class to its file and finds no
 * `bg-black/` anywhere else, so a dim added with text on it cannot arrive unnoticed.
 */
const SCRIMS: readonly { file: string; alpha: Readonly<Record<(typeof THEME_MODES)[number], number>> }[] = [
  { file: "live/SlideOver.tsx", alpha: { dark: 45, light: 20 } },
  { file: "ui/dialog.tsx", alpha: { dark: 60, light: 20 } },
  // Light on purpose: Settings is a modal so the owner can see what a look does to the app behind it (`SettingsModal.tsx`).
  { file: "console/SettingsModal.tsx", alpha: { dark: 30, light: 15 } },
  // Dark in both modes on purpose: a picture or briefing previews the way Slack's does, the page darkened behind it
  // (`PreviewModal.tsx`).
  { file: "console/PreviewModal.tsx", alpha: { dark: 70, light: 70 } },
];

/**
 * The black dims no glass and no text is ever drawn on, so no contrast here reads them: the four panels round a
 * lifted region of the owner's screen, which dim the apps beneath the voice's window and carry only an `aria-label`.
 */
const TEXTLESS_DIMS: readonly { file: string; className: string }[] = [
  { className: "bg-black/55", file: "voice/ScreenFocus.tsx" },
];

/** The class a scrim's file carries for its two alphas: one class when the modes agree, a `dark:` override when not. */
function scrimClass({ scrim }: { scrim: (typeof SCRIMS)[number] }): string {
  if (scrim.alpha.light === scrim.alpha.dark) {
    return `bg-black/${scrim.alpha.dark}`;
  }
  return `bg-black/${scrim.alpha.light} dark:bg-black/${scrim.alpha.dark}`;
}

/**
 * Every opacity utility or inline `opacity` a component sets below full and above none, outside a `disabled`
 * state (WCAG 1.4.3 exempts an inactive control). Opacity fades text the contrast tests do not see, so each one is
 * on something that is not text — a bar, a status dot, the dialog's close glyph, the select's chevron, the orb's
 * layers — and "fades no text" holds this list to the components both ways. A word drawn as a badge is text: the
 * Queue's kind badge (`queueKinds.tsx`'s `Icon`) is measured at full strength and never faded.
 */
const NON_TEXT_OPACITY = [
  // The weekly chart's reviewed-drafts bars (Slack steers), an SVG `rect` drawn under the lines.
  "console/WeeklyChart.tsx opacity-15",
  "ui/dialog.tsx opacity-70",
  "ui/select.tsx opacity-50",
  'voice/EdgeGlow.tsx opacity: "calc(0.25 + var(--edge-lvl) * 0.75)"',
  "voice/VoiceWidget.tsx group-data-[phase=off]/voice:opacity-80",
] as const;

/**
 * Any mask a component or the stylesheet could put over text: every mask property as a declaration — the `mask`
 * and `-webkit-mask` shorthands and every `mask-*`/`-webkit-mask-*` longhand, in CSS, an arbitrary `[mask…:…]` or a
 * React style key — React's `maskImage`/`WebkitMask*`, Tailwind's mask utilities (`mask-t-from-*`,
 * `mask-linear-*`, …) and an arbitrary `mask-[…]`.
 */
const FADING_MASK =
  /(?<![\w-])(?:-webkit-)?mask(?:-[a-z-]+)?\s*:|maskImage|WebkitMask\w*|(?<![\w-])(?:[^\s"'`[]+:)?mask-[^\s"'`]+/gu;

describe("contrast on the opaque planes", () => {
  it("fades no text: every partial opacity in the components is on a mark, an icon or the orb, or a disabled control", () => {
    const root = join(import.meta.dirname, "../../../components");
    const found = sourceFiles({ dir: root })
      .filter((file) => !file.startsWith(join(root, "diagrams")))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        const where = file.slice(root.length + 1);
        return [
          ...[...source.matchAll(/(?<![\w-])(?:[^\s"'`]+:)?opacity-(\d+)(?![\w-])/gu)]
            .filter((match) => !match[0].includes("disabled") && match[1] !== "0" && match[1] !== "100")
            .map((match) => `${where} ${match[0]}`),
          ...[...source.matchAll(/(?<![\w-])opacity: ("[^"]*"|[\d.]+)/gu)].map((match) => `${where} ${match[0]}`),
          ...[...source.matchAll(/(?<![\w-])(?:[^\s"'`]+:)?text-[\w-]+\/(?:\d+|\[[^\]]+\])/gu)]
            .filter((match) => !match[0].includes("disabled"))
            .map((match) => `${where} ${match[0]}`),
          // A colour filter moves the text and its tint AFTER they were measured: a chip's hover `brightness-125`
          // took citation ink to about 4.1:1 on a light panel.
          ...[
            ...source.matchAll(
              /(?<![\w-])(?:[^\s"'`]+:)?(?:(?:brightness|contrast|saturate|hue-rotate)-(?:\d+|\[[^\]]+\])|(?:invert|sepia|grayscale)(?:-\d+)?)(?![\w-])/gu,
            ),
          ].map((match) => `${where} ${match[0]}`),
          // A mask fades whatever it covers, text included: the voice history's top edge once faded turns to 1:1.
          ...[...source.matchAll(FADING_MASK)].map((match) => `${where} ${match[0]}`),
        ];
      });
    expect(found.toSorted()).toEqual([...NON_TEXT_OPACITY].toSorted());
    // Every stylesheet the console loads: its own and each local one it imports. Outside an animation none fades
    // anything — an atlas count at `opacity: 0.55` was about 3.45:1 on graphite light.
    const app = join(import.meta.dirname, "../../../app");
    const own = readFileSync(join(app, "console-tw.css"), "utf8");
    const imported = [...own.matchAll(/@import "\.\/([\w-]+\.css)"/gu)].map((match) => match[1]);
    expect(imported).toEqual(["diagram.css"]);
    const fading: string[] = [];
    const animations = new Set<string>();
    for (const name of ["console-tw.css", ...imported]) {
      const { keyframes, rest } = splitKeyframes({ css: readFileSync(join(app, name), "utf8") });
      fading.push(
        ...[...rest.matchAll(/(?<![\w-])opacity:\s*([\d.]+%?)/gu)]
          .filter((match) => match[1] !== "0" && match[1] !== "1")
          .map((match) => `${name} ${match[0]}`),
        ...[...rest.matchAll(/(?<![\w-])filter:[^;]*/gu)].map((match) => `${name} ${match[0]}`),
        ...[...rest.matchAll(FADING_MASK)].map((match) => `${name} ${match[0]}`),
      );
      for (const [animation, body] of keyframes) {
        // Any opacity at all: an animation from 0 to 1 passes through every fade between.
        if (/(?<![\w-])(?:opacity|filter):/u.test(body)) {
          animations.add(animation);
        }
      }
    }
    expect(fading).toEqual([]);
    // An animation that fades or filters runs only on the orb, the window's edge and the screen dim, never on text.
    expect([...animations].toSorted()).toEqual(["sw-edge-pulse", "sw-focus-in", "sw-orb-pop"]);
    // A component runs one by its keyframes' name or by the Tailwind `animate-*` utility a `--animate-*` maps onto it.
    const utilities = [...own.matchAll(/--(animate-[\w-]+):\s*([\w-]+)/gu)]
      .filter((match) => animations.has(match[2]))
      .map((match) => match[1]);
    expect(utilities.toSorted()).toEqual(["animate-focus-in", "animate-orb-pop"]);
    const runners = sourceFiles({ dir: root })
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return [...animations, ...utilities].some((name) =>
          new RegExp(`(?<![\\w-])${name}(?![\\w-])`, "u").test(source),
        );
      })
      .map((file) => file.slice(root.length + 1))
      .toSorted();
    expect(runners).toEqual(ORB_ANIMATION_RUNNERS);
    // The splitter, witnessed: a fade inside an animation is set aside, one outside it is not.
    const witness = splitKeyframes({
      css: "@keyframes a { from { opacity: 0.5; } to { opacity: 1; } } .b { opacity: 0.55; }",
    });
    expect([...witness.keyframes.keys()]).toEqual(["a"]);
    expect(witness.rest).toContain(".b { opacity: 0.55; }");
    expect(witness.rest).not.toContain("opacity: 0.5;");
    // The mask matcher, witnessed on the shapes it must catch.
    for (const shape of [
      "[mask-image:linear-gradient(to_bottom,transparent,black_2.5rem)]",
      "mask-t-from-50%",
      "mask-linear-to-b",
      "md:mask-radial-at-center",
      "mask-[url(#fade)]",
      'style={{ maskImage: "linear-gradient(black, transparent)" }}',
      "-webkit-mask-image: linear-gradient(black, transparent);",
      'style={{ mask: "linear-gradient(black, transparent)" }}',
      ".some-text { -webkit-mask: linear-gradient(black, transparent); }",
      ".some-text { mask: linear-gradient(black, transparent); }",
      "[mask:linear-gradient(black,transparent)]",
      "mask-composite: exclude;",
    ]) {
      expect([...shape.matchAll(FADING_MASK)].length).toBe(1);
    }
  });

  it("draws every placeholder in full muted ink: Tailwind's preflight half-ink falls under 4.5:1 even opaque", () => {
    const components = join(import.meta.dirname, "../../../components");
    const css = readFileSync(join(import.meta.dirname, "../../../app/console-tw.css"), "utf8").replaceAll(/\s+/gu, " ");
    expect(css).toContain("::placeholder { color: var(--color-muted-foreground); opacity: 1; }");
    // No component redraws a placeholder in a colour of its own, which no measure here reads.
    expect(
      sourceFiles({ dir: components }).filter((file) => /(?<![\w-])placeholder:/u.test(readFileSync(file, "utf8"))),
    ).toEqual([]);
    const { bg, ink, muted } = THEME_PALETTES.teal.light;
    const ground = srgb({ rendering: "srgb", value: bg });
    const halfInk = compositeSrgb({
      alpha: 0.5,
      background: ground,
      foreground: srgb({ rendering: "srgb", value: ink }),
    });
    expect(srgbContrastRatio({ background: ground, foreground: halfInk })).toBeLessThan(4.5);
    expect(
      srgbContrastRatio({ background: ground, foreground: srgb({ rendering: "srgb", value: muted }) }),
    ).toBeGreaterThan(4.5);
  });

  it("puts a ground under the page column: muted text straight on the wallpaper's top-left glow falls under 4.5:1", () => {
    const components = join(import.meta.dirname, "../../../components");
    const css = readFileSync(join(import.meta.dirname, "../../../app/console-tw.css"), "utf8").replaceAll(/\s+/gu, " ");
    expect(readFileSync(join(components, "console/Shell.tsx"), "utf8")).toContain(
      '<main className="sw-glass-page min-w-0">',
    );
    expect(css).toContain(".sw-glass-page { background: var(--c-bg); }");
    const { bg, muted, primary } = THEME_PALETTES.teal.dark;
    const glow = compositeSrgb({
      alpha: WALLPAPER_GLOWS[0].alpha / 100,
      background: srgb({ rendering: "srgb", value: bg }),
      foreground: drawn({ color: glowColour({ hueShift: 0, primary }), rendering: "srgb" }),
    });
    const measured = srgbContrastRatio({ background: glow, foreground: srgb({ rendering: "srgb", value: muted }) });
    expect(measured).toBeLessThan(4.5);
  });

  it("draws every scrim this file measures, each in its own file, and no other but a dim with no text on it", () => {
    const root = join(import.meta.dirname, "../../../components");
    expect(SCRIMS.length).toBe(4);
    for (const scrim of SCRIMS) {
      expect(readFileSync(join(root, scrim.file), "utf8")).toContain(scrimClass({ scrim }));
    }
    for (const dim of TEXTLESS_DIMS) {
      expect(readFileSync(join(root, dim.file), "utf8")).toContain(dim.className);
    }
    const found = sourceFiles({ dir: root }).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/(?<![\w:-])(?:dark:)?bg-black\/\d+/gu)].map((match) => match[0]),
    );
    expect(found.toSorted()).toEqual(
      [
        ...SCRIMS.flatMap((scrim) => scrimClass({ scrim }).split(" ")),
        ...TEXTLESS_DIMS.map((dim) => dim.className),
      ].toSorted(),
    );
  });
});
