/*
 * The code highlighter's two themes, ONE pair for every code block the console draws: `code-block.tsx` (tool and
 * session output) and Streamdown's code plugin (`streamdownPlugins`, every Markdown message and reasoning block).
 * `contrastSources.test.ts` measures these exact objects, so a renderer that drew any other theme would draw something
 * unmeasured — which is why neither names a theme of its own.
 *
 * GitHub's high-contrast pair, because the plain `github-light`/`github-dark` do not read (a dark comment is about
 * 3:1), with two changes baked into the theme objects rather than passed as a renderer option, so that both
 * renderers — which run different Shiki releases — draw the same colours: the dark theme's deleted- and
 * changed-line backgrounds are deepened, and the `carriage-return` marker rule, white on a pink no ground carries,
 * is dropped, so a stray `\r` draws in the editor's own ink.
 */

import githubDarkHighContrast from "@shikijs/themes/github-dark-high-contrast";
import githubLightHighContrast from "@shikijs/themes/github-light-high-contrast";

/** One highlighter theme registration, as `@shikijs/themes` ships it. */
type CodeTheme = typeof githubDarkHighContrast;

/** The token scope whose rule is dropped from both themes. */
export const DROPPED_SCOPE = "carriage-return";

/**
 * Each mode's colour replacements, applied to every token rule in that theme: the dark theme's deleted- and
 * changed-line backgrounds, deepened so the words on them read at 4.5:1 or better. The theme's editor `colors`
 * are left alone: a highlighter draws only `editor.background` and `editor.foreground` from them, neither replaced.
 */
export const CODE_COLOUR_REPLACEMENTS: Readonly<Record<"dark" | "light", Readonly<Record<string, string>>>> = {
  dark: { "#a74c00": "#7a3800", "#ad0116": "#8f0012" },
  light: {},
};

/**
 * A theme with `replacements` applied to every token rule's colours and the `carriage-return` rule dropped.
 *
 * @param replacements lowercase `#rrggbb` to its replacement
 * @returns a new registration under the same name
 */
function adjusted({
  replacements,
  theme,
}: {
  replacements: Readonly<Record<string, string>>;
  theme: CodeTheme;
}): CodeTheme {
  const swap = ({ value }: { value: string }): string => {
    const key = value.toLowerCase();
    if (Object.hasOwn(replacements, key)) {
      return replacements[key];
    }
    return value;
  };
  if (theme.tokenColors === undefined) {
    throw new Error(`highlighter theme ${String(theme.name)} has no token rules`);
  }
  return {
    ...theme,
    tokenColors: theme.tokenColors
      .filter((rule) => rule.scope !== DROPPED_SCOPE)
      .map((rule) => {
        const { background, foreground } = rule.settings;
        return {
          ...rule,
          settings: {
            ...rule.settings,
            ...(background === undefined ? {} : { background: swap({ value: background }) }),
            ...(foreground === undefined ? {} : { foreground: swap({ value: foreground }) }),
          },
        };
      }),
  };
}

/** The Markdown elements whose renderer draws a code block: a caller's override of either would draw unmeasured. */
export const CODE_ELEMENTS: ReadonlySet<string> = new Set(["code", "pre"]);

/**
 * A caller's Markdown renderer overrides with the code-block ones removed, so a link or table override still
 * applies while every code block keeps the highlighter that draws `CODE_THEMES`.
 *
 * @param components the caller's overrides by element name, when it passed any
 * @returns the same overrides without `code` or `pre`; none when it passed none
 */
export function withoutCodeOverrides<T extends object>({ components }: { components: T | undefined }): Partial<T> {
  if (components === undefined) {
    return {};
  }
  const kept: Partial<T> = { ...components };
  for (const name of CODE_ELEMENTS) {
    Reflect.deleteProperty(kept, name);
  }
  return kept;
}

/** The pair every code block draws with, by mode. */
export const CODE_THEMES: Readonly<Record<"dark" | "light", CodeTheme>> = {
  dark: adjusted({ replacements: CODE_COLOUR_REPLACEMENTS.dark, theme: githubDarkHighContrast }),
  light: adjusted({ replacements: CODE_COLOUR_REPLACEMENTS.light, theme: githubLightHighContrast }),
};
