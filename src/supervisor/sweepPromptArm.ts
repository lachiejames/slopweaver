/**
 * The one render both edges arm a wakeup with — `supervisor sweep-prompt` and `supervisor tick close` — naming the
 * overflow file before the render so an over-budget shift state is cut to fit rather than refused
 * (`./sweepPromptOverflow.ts` carries why). Pure: the edge keeps the file BEFORE it prints the prompt.
 */
import type { Result } from "#lib/result.js";

import type { SupervisorCoreError } from "./errors.js";
import { type RenderedSweepPrompt, renderSweepPrompt } from "./sweepPrompt.js";
import { shiftOverflowPath } from "./sweepPromptOverflow.js";

/** The whole shift state a render moved off the prompt, and the file the prompt's pointer names. */
export interface OverflowedShift {
  readonly contents: string;
  readonly path: string;
  /** Authored words only the file carries. */
  readonly words: number;
}

/** A rendered wakeup and, when its shift state ran over budget, what the edge must keep first. */
export interface ArmedSweepPrompt {
  readonly rendered: RenderedSweepPrompt;
  readonly overflow: OverflowedShift | undefined;
}

/**
 * Render the wakeup with its overflow file already named, so an over-budget shift state fits.
 *
 * @param home the `$SLOPWEAVER_HOME` the edge resolved
 * @param scope the chair's handoff for `tick close`, `sweep` for the standalone verb
 * @returns the render and what it overflowed, or why it would not render
 */
export function armSweepPrompt({
  contractPath,
  home,
  scope,
  shiftState,
}: {
  contractPath: string;
  home: string;
  scope: string;
  shiftState: string;
}): Result<ArmedSweepPrompt, SupervisorCoreError> {
  const path = shiftOverflowPath({ home, scope, shiftState });
  return renderSweepPrompt({ contractPath, overflowPath: path, shiftState }).map((rendered) => {
    let overflow: OverflowedShift | undefined;
    if (rendered.overflowed) {
      overflow = { contents: shiftState, path, words: rendered.overflowWords };
    }
    return { overflow, rendered };
  });
}
