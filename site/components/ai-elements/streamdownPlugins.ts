import { createCodePlugin } from "@streamdown/code";
import type { StreamdownProps } from "streamdown";

import { CODE_THEMES } from "../../lib/codeThemes";

/**
 * The plugins every `<Streamdown>` in the console renders with: code highlighted in the console's one measured
 * pair (`lib/codeThemes.ts`), never `@streamdown/code`'s preconfigured `code`, whose plain GitHub themes draw a dark
 * comment at about 3:1. `contrastSources.test.ts` holds every `<Streamdown>` to this object.
 */
export const streamdownPlugins = {
  code: createCodePlugin({ themes: [CODE_THEMES.light, CODE_THEMES.dark] }),
};

/**
 * The same pair as Streamdown's own `shikiTheme`, which wins over a plugin's themes: every `<Streamdown>` passes it
 * after a caller's props, so no caller can name another theme.
 */
export const streamdownShikiTheme: NonNullable<StreamdownProps["shikiTheme"]> = [CODE_THEMES.light, CODE_THEMES.dark];
