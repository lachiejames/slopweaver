/**
 * A shift state over its word budget is RENDERED within the cap rather than refused: the prompt carries the
 * longest sentence-bounded head that fits, and a pointer to a file holding the whole state. Pure; the CLI edges
 * write the file.
 *
 * ## Why the budget stopped being a refusal
 *
 * MEASURED with `slopweaver transcripts draw --session <chair session id>
 * --from-tick 14 --to-tick 44` (one chair, 30 ticks): 57 of the chair's 75 shape refusals were THIS
 * budget, relayed by `supervisor sweep-prompt` and `supervisor tick close`, the authored state 632 to 714 words
 * against 631, most under twenty over. 55 were retried inside their own tick, at 3.1 extra API calls a tick, each
 * re-reading the whole context — 531,928 prompt tokens a tick, about a tenth of everything the chair read. `sweep-prompt
 * --budget` had printed the number BEFORE the write and the laps did not stop, so a pre-write check
 * is measured to be insufficient. The owner's ruling is the other shape: the verb takes
 * the long form and renders within the cap itself.
 *
 * What the cap guarded against was standing procedure re-typed into the prompt, and the marker and option checks
 * in `./sweepPrompt.ts` still refuse that, over the WHOLE authored state, before any of this runs. A long state
 * that passes them is long per-tick state, and the next tick reads all of it — the head in the prompt, the rest
 * from the file the pointer names.
 *
 * ## The file
 *
 * Named by the full SHA-256 of the exact authored bytes, so two different states can never share a path and a
 * rewrite of one path can only ever write the bytes already there. It lives under the chair's own
 * `$SLOPWEAVER_HOME/supervisor-scratch/<scope>/`, which `home reclaim` never enters (`skills/home/SKILL.md`) and
 * `scratch carry` never copies to a successor. Nothing prunes it: a long shift state leaves one small file per
 * distinct state, and the edges print the count of words they moved so that growth is visible.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

import { splitSentences } from "../briefing/sentences.js";
import { stateHomePaths } from "../stateHome.js";

/** The words a fit kept in the prompt and the words it moved to the file. */
export interface ShiftOverflowFit {
  /** What the prompt's shift slot carries: the head, then the pointer. */
  readonly shiftLine: string;
  /** Authored words the prompt does NOT carry — only the file has them. */
  readonly overflowWords: number;
}

/**
 * Where an over-budget shift state is kept whole.
 *
 * @param home the `$SLOPWEAVER_HOME` the edge resolved
 * @param scope the chair's handoff for `tick close`, `sweep` for the standalone verb
 * @param shiftState the exact authored state, whose digest names the file
 * @returns the absolute path
 */
export function shiftOverflowPath({
  home,
  scope,
  shiftState,
}: {
  home: string;
  scope: string;
  shiftState: string;
}): string {
  const digest = createHash("sha256").update(shiftState, "utf8").digest("hex");
  return join(stateHomePaths({ home }).supervisorScratch, scope, `shift-overflow-${digest}.txt`);
}

/**
 * The pointer that ends an overflowed shift slot — an imperative, so the next tick reads the file.
 *
 * @param omittedWords the authored words only the file carries
 * @param path the file holding the whole state
 * @returns the pointer text
 */
export function overflowPointer({ omittedWords, path }: { omittedWords: number; path: string }): string {
  return `[… ${String(omittedWords)} more words — the whole shift state is ${path}; read it beside the contract this tick]`;
}

/** Words the way `./sweepPrompt.ts` counts them — whitespace-separated, empties dropped. */
function words({ text }: { text: string }): readonly string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

/**
 * Fit a shift state into its budget: the longest run of whole sentences that leaves room for the pointer, or the
 * longest run of words when even the first sentence does not fit.
 *
 * @param budgetWords the shift state's whole budget, pointer included
 * @param overflowPath the file the pointer names
 * @param shiftState the authored state, already trimmed
 * @returns the fit, or `undefined` when the pointer alone exceeds the budget — no prompt can then both name the
 *   file and stay under the cap
 */
export function fitShiftOverflow({
  budgetWords,
  overflowPath,
  shiftState,
}: {
  budgetWords: number;
  overflowPath: string;
  shiftState: string;
}): ShiftOverflowFit | undefined {
  const pointerWords = words({ text: overflowPointer({ omittedWords: 0, path: overflowPath }) }).length;
  const room = budgetWords - pointerWords;
  if (room < 0) {
    return undefined;
  }
  const authored = words({ text: shiftState }).length;
  const kept: string[] = [];
  let keptWords = 0;
  for (const sentence of splitSentences({ text: shiftState })) {
    const count = words({ text: sentence }).length;
    if (keptWords + count > room) {
      break;
    }
    kept.push(sentence);
    keptWords += count;
  }
  if (kept.length === 0) {
    kept.push(...words({ text: shiftState }).slice(0, room));
    keptWords = kept.length;
  }
  const pointer = overflowPointer({ omittedWords: authored - keptWords, path: overflowPath });
  return {
    overflowWords: authored - keptWords,
    shiftLine: kept.length === 0 ? pointer : `${kept.join(" ")} ${pointer}`,
  };
}
