/*
 * The text colours the components draw, found in their sources and held to the registries: the wallpaper, every
 * literal and data-driven foreground, the code renderers' themes, and a measure for each kind of foreground.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CODE_COLOUR_REPLACEMENTS,
  CODE_ELEMENTS,
  CODE_THEMES,
  DROPPED_SCOPE,
  withoutCodeOverrides,
} from "../../../lib/codeThemes";
import { srgbContrastRatio } from "../../../lib/colorContrast";
import { THEME_PALETTES } from "../../../lib/themePalettes";
import { ALL_KINDS, AVATAR_FILL, CHIP_TINT, codeTheme, DATA_TEXT, FOREGROUND_MEASURES } from "./foregroundHarness";
import { PAIRS, ratio, srgb, WALLPAPER_GLOWS } from "./paletteHarness";
import { packageVersion, sourceFiles } from "./sourceHarness";

/** One glow back as the CSS `console-tw.css` writes it, so the model and the stylesheet cannot drift apart. */
function glowCss({ glow }: { glow: (typeof WALLPAPER_GLOWS)[number] }): string {
  let colour = "var(--c-primary)";
  if (glow.hueShift !== 0) {
    const sign = glow.hueShift > 0 ? "+" : "-";
    colour = `oklch(from var(--c-primary) l c calc(h ${sign} ${Math.abs(glow.hueShift)}))`;
  }
  return `radial-gradient(${glow.size[0]}vmax ${glow.size[1]}vmax at ${glow.at[0]}% ${glow.at[1]}%, color-mix(in oklch, ${colour} ${glow.alpha}%, transparent), transparent ${glow.stop}%)`;
}

/**
 * Every text colour a component writes as a literal instead of a token, with every ground it is drawn on. The
 * themes cannot move a literal, so each is measured here on its own fixed fill, and "measures every literal text
 * colour" holds this list to the components both ways.
 */
const LITERAL_TEXT = [
  { file: "console/SlackThread.tsx", on: ["oklch(0.5 0.15 290)"], text: "oklch(0.99 0 0)" },
  { file: "console/SlackThread.tsx", on: ["oklch(0.13 0.008 250)"], text: "oklch(0.9 0.005 250)" },
  { file: "console/SlackThread.tsx", on: ["oklch(0.13 0.008 250)"], text: "oklch(0.7 0.005 250)" },
  {
    file: "console/queueKinds.tsx",
    on: [
      "oklch(0.5 0.13 185)",
      "oklch(0.5 0.15 265)",
      "oklch(0.5 0.15 330)",
      "oklch(0.5 0.14 60)",
      "oklch(0.5 0.12 145)",
      "oklch(0.32 0.02 250)",
    ],
    text: "oklch(0.98 0 0)",
  },
  { file: "console/workContextState.tsx", on: ["oklch(0.78 0.13 75)"], text: "oklch(0.2 0.04 75)" },
  { file: "live/PrCard.tsx", on: ["oklch(0.5 0.14 45)"], text: "oklch(0.98 0 0)" },
  { file: "voice/CallCardControls.tsx", on: ["oklch(0.72 0.17 25)"], text: "oklch(0.16 0.03 25)" },
] as const;

describe("contrast on the opaque planes", () => {
  it("renders the wallpaper this file measures: every glow it models is one `body` draws, and `body` draws no other", () => {
    const css = readFileSync(join(import.meta.dirname, "../../../app/console-tw.css"), "utf8")
      .replaceAll(/\s+/gu, " ")
      .replaceAll(/\( /gu, "(")
      .replaceAll(/ \)/gu, ")");
    expect(WALLPAPER_GLOWS.length).toBe(3);
    for (const glow of WALLPAPER_GLOWS) {
      expect(css).toContain(glowCss({ glow }));
    }
    expect(css.match(/radial-gradient\(/gu)!.length).toBe(WALLPAPER_GLOWS.length);
  });

  it("fills every surface with an opaque palette token, so nothing behind a plane shows through it", () => {
    const css = readFileSync(join(import.meta.dirname, "../../../app/console-tw.css"), "utf8").replaceAll(/\s+/gu, " ");
    expect(css).not.toContain("--sw-glass-opacity");
    expect(css).not.toContain("backdrop-filter:");
    expect(css).toContain("background: var(--sw-glass-fill, var(--c-card));");
    expect(css).toContain(".sw-glass-sidebar { --sw-glass-fill: var(--c-sidebar);");
    expect(css).toContain(".sw-glass-page { background: var(--c-bg); }");
    // Every glass class's fill, read from the classes themselves: each a palette token, none a mix toward `transparent`.
    const glass = css.slice(css.indexOf(".sw-glass, .sw-glass-plane {"), css.indexOf(".sw-slack {"));
    const fills = [...glass.matchAll(/(?:--sw-glass-fill|background): ([^;]+);/gu)].map((match) => match[1]);
    expect(fills).toEqual([
      "var(--sw-glass-fill, var(--c-card))",
      "var(--c-sidebar)",
      "var(--c-panel)",
      "var(--c-bg)",
      "var(--c-bg)",
      "var(--c-bg)",
    ]);
  });

  it("measures every literal text colour the components draw, at 4.5:1 or better on every ground it is drawn on", () => {
    const root = join(import.meta.dirname, "../../../components");
    const found = sourceFiles({ dir: root }).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/text-\[((?:oklch|color-mix|rgb|hsl|#)[^\]]*)\]/gu)].map(
        (match) => `${file.slice(root.length + 1)} ${match[1].replaceAll("_", " ")}`,
      ),
    );
    expect(LITERAL_TEXT.length).toBe(7);
    expect([...new Set(found)].toSorted()).toEqual(LITERAL_TEXT.map(({ file, text }) => `${file} ${text}`).toSorted());
    const failing: string[] = [];
    for (const { file, on, text } of LITERAL_TEXT) {
      for (const ground of on) {
        if (ratio({ background: ground, foreground: text }) < 4.5) {
          failing.push(`${file} ${text} on ${ground}`);
        }
      }
    }
    expect(failing).toEqual([]);
  });

  it("measures every fixed and data-driven text colour the components draw", () => {
    const root = join(import.meta.dirname, "../../../components");
    // The console's components; `diagrams/` is the docs site's figures, which the next test keeps out of it.
    const found = sourceFiles({ dir: root })
      .filter((file) => !file.startsWith(join(root, "diagrams")))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        const where = file.slice(root.length + 1);
        return [
          ...[...source.matchAll(/(?<![\w:-])(?:dark:)?text-(?:white|black)(?![\w/-])/gu)].map(
            (match) => `${where} ${match[0]}`,
          ),
          ...[...source.matchAll(/(?<![\w-])color: (.*?)\s*\}?,?$/gmu)].map(
            (match) => `${where} ${match[1].replaceAll(/\$\{([\w.]+)\}/gu, "<$1>")}`,
          ),
          // Transparent text shows whatever is clipped to it, so it is a foreground of its own.
          ...[
            ...source.matchAll(
              /(?<![\w-])(?:[^\s"'`]+:)?text-transparent(?![\w-])|background-clip: text|backgroundClip: "text"|WebkitTextFillColor/gu,
            ),
          ].map((match) => `${where} ${match[0]}`),
          // An SVG `<text>` paints with `fill`, and one without inherits black.
          ...[...source.matchAll(/<text\b[^>]*>/gu)].map((match) => {
            const fill = /\bfill=(?:"[^"]*"|\{[^}]*\})/u.exec(match[0]);
            if (fill === null) {
              return `${where} <text> with no fill`;
            }
            return `${where} ${fill[0]}`;
          }),
        ];
      });
    expect(DATA_TEXT.length).toBe(14);
    // The shimmer's base is muted and its highlight is ink, the two its measure blends between.
    const shimmer = readFileSync(join(root, "ai-elements/shimmer.tsx"), "utf8");
    expect(shimmer).toContain("linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))");
    expect(shimmer).toContain("#0000_calc(50%-var(--spread)),var(--color-foreground),#0000_calc(50%+var(--spread))");
    expect(readFileSync(join(root, "console/ShellCount.tsx"), "utf8")).toContain(
      "group-data-[sidebar=icons]/console:text-[0px] group-data-[sidebar=icons]/console:text-transparent",
    );
    expect(found.toSorted()).toEqual(DATA_TEXT.map(({ file, text }) => `${file} ${text}`).toSorted());
    for (const file of ["console/Avatar.tsx", "console/SlackDraft.tsx"]) {
      expect(readFileSync(join(root, file), "utf8")).toContain(
        `oklch(${AVATAR_FILL.lightness} ${AVATAR_FILL.chroma} \${String(avatarHue({ name }))})`,
      );
    }
    for (const file of ["console/CitationChip.tsx", "console/PersonChip.tsx", "console/PullPersonChip.tsx"]) {
      expect(readFileSync(join(root, file), "utf8")).toContain(`${CHIP_TINT * 100}%, transparent)`);
    }
    // HandShot's number sits on a tag filled with the SVG's own colour, the danger verdict.
    expect(readFileSync(join(root, "console/HandShot.tsx"), "utf8")).toContain("h-full w-full text-danger");
    // Read as one line with no trailing commas and no break after an open paren, so the formatter's choice of
    // layout cannot fail the match.
    const codeBlock = readFileSync(join(root, "ai-elements/code-block.tsx"), "utf8")
      .replaceAll(/,\s*\}/gu, " }")
      .replaceAll(/\(\s+/gu, "(")
      .replaceAll(/\s+/gu, " ");
    // Both code renderers draw with the measured `CODE_THEMES` and no theme of their own.
    expect(codeBlock).toContain('import { CODE_THEMES } from "@/lib/codeThemes";');
    expect(codeBlock).toContain("themes: [CODE_THEMES.light, CODE_THEMES.dark]");
    expect(codeBlock).toContain("codeToTokens(code, { lang: langToUse, themes: CODE_THEMES });");
    // The ground a token is measured on is the theme's own: the `<pre>` wears it in each mode, and the `<code>`
    // inside clears the console's global `code` panel tint, which would otherwise sit between the two.
    expect(codeBlock).toContain("backgroundColor: tokenized.bg,");
    expect(codeBlock).toContain('cn("dark:!bg-[var(--shiki-dark-bg)]');
    expect(codeBlock).toContain('<code className={cn("bg-transparent font-mono text-sm"');
    // The themes measured here are the release the console draws with: the root's pin, `site/`'s own, and
    // `site/`'s `shiki`.
    const themesRelease = packageVersion({ field: "dependencies", file: join(root, "../package.json"), name: "shiki" });
    expect(
      packageVersion({ field: "devDependencies", file: join(root, "../../package.json"), name: "@shikijs/themes" }),
    ).toBe(themesRelease);
    expect(
      packageVersion({ field: "dependencies", file: join(root, "../package.json"), name: "@shikijs/themes" }),
    ).toBe(themesRelease);
  });

  it("draws every Markdown code block with the measured themes, the global code tint cleared and line numbers unfaded", () => {
    const components = join(import.meta.dirname, "../../../components");
    const sources = sourceFiles({ dir: components }).map((file) => ({
      file: file.slice(components.length + 1),
      source: readFileSync(file, "utf8"),
    }));
    // A JSX use, never a mention in a comment's backticks.
    const streamdowns = sources.filter(({ source }) => /(?<!`)<Streamdown\b/u.test(source));
    expect(streamdowns.map(({ file }) => file).toSorted()).toEqual([
      "ai-elements/message.tsx",
      "ai-elements/reasoning.tsx",
    ]);
    for (const { source } of streamdowns) {
      expect(source).toContain('import { streamdownPlugins, streamdownShikiTheme } from "./streamdownPlugins";');
      expect(source.match(/plugins=\{[^}]*\}/gu)).toEqual(["plugins={streamdownPlugins}"]);
      // Streamdown's own `shikiTheme` wins over a plugin's themes, so each passes the measured pair there too.
      expect(source.match(/shikiTheme=\{[^}]*\}/gu)).toEqual(["shikiTheme={streamdownShikiTheme}"]);
    }
    // The one wrapper that forwards a caller's props sets the code theme, plugins and renderer overrides AFTER them,
    // and its props type offers neither of the first two, so no caller can name another theme or code renderer.
    const message = readFileSync(join(components, "ai-elements/message.tsx"), "utf8").replaceAll(/\s+/gu, " ");
    expect(message).toContain(
      'export type MessageResponseProps = Omit<ComponentProps<typeof Streamdown>, "plugins" | "shikiTheme">;',
    );
    expect(message).toContain(
      "{...props} components={withoutCodeOverrides({ components })} disallowedElements={NO_REMOTE_MEDIA} plugins={streamdownPlugins} shikiTheme={streamdownShikiTheme} />",
    );
    // The other forwards nothing to its `<Streamdown>`: its caller's props go to the collapsible around it.
    expect(readFileSync(join(components, "ai-elements/reasoning.tsx"), "utf8").replaceAll(/\s+/gu, " ")).toContain(
      "<Streamdown disallowedElements={NO_REMOTE_MEDIA} plugins={streamdownPlugins} shikiTheme={streamdownShikiTheme}> {children} </Streamdown>",
    );
    const link = (): null => null;
    const block = (): null => null;
    expect(withoutCodeOverrides({ components: { a: link, code: block, pre: block } })).toEqual({ a: link });
    expect(withoutCodeOverrides({ components: undefined })).toEqual({});
    expect([...CODE_ELEMENTS]).toEqual(["code", "pre"]);
    // Nor through a class: a descendant variant aimed at a code block may shape it, never colour or fade it, since
    // `[&_pre]:!bg-black` would repaint the ground the `highlighter` measure reads.
    const aimedAtCode = /\[&[^\s"'`]*(?:pre|code|streamdown)[^\s"'`]*\]:(!?[a-z[][^\s"'`]*)/gu;
    /** Whether a utility aimed at a code block could move a colour: any arbitrary property or value counts. */
    const recolours = (utility: string): boolean => {
      if (utility.includes("[")) {
        return true;
      }
      const last = utility.split(":").at(-1)!.replaceAll(/^!|!$/gu, "");
      return (
        /^(?:bg|text|fill|stroke|opacity|from|via|to|decoration|caret|accent|shadow|ring|border|outline|brightness|contrast|saturate|hue-rotate|invert|sepia|grayscale|mix-blend|backdrop)(?:-|$)/u.test(
          last,
        ) && !/^text-(?:xs|sm|base|lg|\d?xl|left|center|right|wrap|nowrap|ellipsis|clip)$/u.test(last)
      );
    };
    const witnesses = [
      ..."[&_pre]:!bg-black [&_code]:text-white [&_pre]:[background:white] [&_code]:hover:text-white".matchAll(
        aimedAtCode,
      ),
    ].map((match) => match[1]);
    expect(witnesses).toEqual(["!bg-black", "text-white", "[background:white]", "hover:text-white"]);
    expect(witnesses.filter((utility) => !recolours(utility))).toEqual([]);
    expect(
      ["w-0", "min-w-full", "overflow-x-auto", "max-h-none!", "wrap-anywhere", "text-sm"].filter(recolours),
    ).toEqual([]);
    const codeVariants = sources.flatMap(({ file, source }) =>
      [...source.matchAll(aimedAtCode)].map((match) => ({ file, utility: match[1] })),
    );
    expect(codeVariants.length).toBeGreaterThan(0);
    expect(codeVariants.filter(({ utility }) => recolours(utility))).toEqual([]);
    // `@streamdown/code`'s preconfigured `code` draws the plain GitHub pair; only the shared plugin is built.
    expect(sources.filter(({ source }) => source.includes('from "@streamdown/code"')).map(({ file }) => file)).toEqual([
      "ai-elements/streamdownPlugins.ts",
    ]);
    expect(readFileSync(join(components, "ai-elements/streamdownPlugins.ts"), "utf8")).toContain(
      "createCodePlugin({ themes: [CODE_THEMES.light, CODE_THEMES.dark] })",
    );
    // Streamdown puts its line numbers in `muted-foreground/50` and its `<code>` takes the global panel tint; the
    // console's CSS overrides both, so the `highlighter` measure's ground and muted ink are what it draws.
    const css = readFileSync(join(import.meta.dirname, "../../../app/console-tw.css"), "utf8").replaceAll(/\s+/gu, " ");
    expect(css).toContain('[data-streamdown="code-block-body"] pre > code { background: transparent; }');
    expect(css).toContain(
      '[data-streamdown="code-block-body"] pre > code > span::before { color: var(--color-muted-foreground); }',
    );
  });

  it("bakes the colour fixes into the dark theme and drops the carriage-return marker from both", async () => {
    const raw = (await import("@shikijs/themes/github-dark-high-contrast")).default;
    const rawText = JSON.stringify(raw.tokenColors).toLowerCase();
    const bakedText = JSON.stringify(CODE_THEMES.dark.tokenColors).toLowerCase();
    expect(CODE_THEMES.dark.colors).toBe(raw.colors);
    for (const [from, to] of Object.entries(CODE_COLOUR_REPLACEMENTS.dark)) {
      expect(rawText).toContain(`"${from}"`);
      expect(bakedText).not.toContain(`"${from}"`);
      expect(bakedText).toContain(`"${to}"`);
    }
    expect(rawText).toContain(`"scope":"${DROPPED_SCOPE}"`);
    expect(bakedText).not.toContain(`"scope":"${DROPPED_SCOPE}"`);
    expect(JSON.stringify(CODE_THEMES.light.tokenColors)).not.toContain(`"scope":"${DROPPED_SCOPE}"`);
    expect(Object.keys(CODE_COLOUR_REPLACEMENTS.light)).toEqual([]);
  });

  it("draws a code block that has not highlighted yet, or never will, in the console's own measured ink and ground", () => {
    // Before the highlighter resolves (or if it fails) a block's tokens are raw: no ground of their own and every colour
    // inherited, so the words draw in the container's `text-foreground` on its opaque `bg-background` — `--c-ink` on
    // `--c-bg`, the pair every palette is measured on above.
    const source = readFileSync(
      join(import.meta.dirname, "../../../components/ai-elements/code-block.tsx"),
      "utf8",
    ).replaceAll(/\s+/gu, " ");
    expect(source).toContain(
      'const createRawTokens = (code: string): TokenizedCode => ({ bg: "transparent", fg: "inherit", tokens:',
    );
    expect(source).toContain('color: "inherit", content: line,');
    expect(source).toContain('"group relative w-full overflow-hidden rounded-md border bg-background text-foreground"');
    const css = readFileSync(join(import.meta.dirname, "../../../app/console-tw.css"), "utf8");
    expect(css).toContain("--background: var(--c-bg);\n  --foreground: var(--c-ink);");
    const palettes = Object.entries(THEME_PALETTES).flatMap(([family, modes]) =>
      Object.entries(modes).map(([mode, { bg, ink }]) => ({
        measured: srgbContrastRatio({
          background: srgb({ rendering: "srgb", value: bg }),
          foreground: srgb({ rendering: "srgb", value: ink }),
        }),
        name: `${family} ${mode}`,
      })),
    );
    expect(palettes.length).toBe(18);
    expect(palettes.filter(({ measured }) => measured < 4.5)).toEqual([]);
  });

  it("never draws a docs-site diagram in the console, whose own SVG text the registry above does not scan", () => {
    const components = join(import.meta.dirname, "../../../components");
    const files = [
      ...sourceFiles({ dir: components }).filter((file) => !file.startsWith(join(components, "diagrams"))),
      ...sourceFiles({ dir: join(import.meta.dirname, "../../../app/(console)") }),
      ...sourceFiles({ dir: join(import.meta.dirname, "../../../app/(overlay)") }),
    ];
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => /from\s+["'][^"']*diagrams\//u.test(readFileSync(file, "utf8")))).toEqual([]);
  });

  for (const [name, measure] of Object.entries(FOREGROUND_MEASURES)) {
    it(`reads every ${name} foreground at 4.5:1 or better on every ground it is drawn on`, () => {
      expect(ALL_KINDS.length).toBeGreaterThan(0);
      expect(PAIRS.length).toBe(18);
      expect(measure()).toEqual([]);
    });
  }

  it("needs the high-contrast highlighter: GitHub's plain dark theme draws a comment under 4.5:1", async () => {
    const { foregrounds } = codeTheme({ theme: (await import("@shikijs/themes/github-dark")).default });
    const comment = foregrounds.find(({ name }) => name === "comment,punctuation.definition.comment,string.comment")!;
    const measured = srgbContrastRatio({ background: comment.on, foreground: comment.colour });
    expect(Number(measured.toFixed(2))).toBe(3.05);
  });
});
