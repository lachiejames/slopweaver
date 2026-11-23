/**
 * The fleet-word check `tick close` applies to the new "done since you last looked" note, asked at `tick fill`
 * instead — so the chair rewrites a fold before close refuses it, not after.
 *
 * MEASURED across two chairs (`slopweaver transcripts draw --session <id>`):
 * twelve fleet-word refusals, ten of them `tick close` refusing `recent.0.detail` — a path the chair never typed —
 * each re-run after two to four more calls, 0.3 to 0.4 extra API calls a tick reading 45,456 to 60,008 prompt
 * tokens. Fill already reported the headline and the fold summary; the folds were judged only at close.
 *
 * The note is built by close's own builder and judged by close's own projection, so nothing is restated. Alone it
 * has fewer cells a gloss may come from than beside the older recent notes, so this can warn about a word close
 * would accept and never the reverse — which is why it is a fill READINESS line and never a close refusal.
 *
 * Pure: the authored fields in, report lines out.
 */
import { shellCommandLine } from "#lib/shellCommandLine.js";

import { recutText } from "../briefing/fleetJargon.js";
import { recentBlock, type SweepBlockInput } from "../briefing/sweepBlock.js";
import { recentNoteSectionIssues } from "../outbound/briefing/sectionQuality.js";

/** Where close's projection puts the new note's fold — the one level the authored `folds` own. */
const DETAIL_PATH = "recent.0.detail";

/** The most digits fill's `--fold-at` parser accepts, so a rewrite is offered only at an index fill can address. */
export const FOLD_AT_MAX_DIGITS = 3;

/**
 * The fleet-word refusals the new note's fold level carries.
 *
 * @param recent the headline sentences, folds and fold summary the sweep authored
 * @returns each refusal's message, in the order close would report them
 */
function detailJargon({ recent }: { recent: SweepBlockInput["recent"] }): readonly string[] {
  return recentNoteSectionIssues({ note: recentBlock({ input: recent }) })
    .filter((issue) => issue.rule === "fleet-jargon" && issue.path.join(".") === DETAIL_PATH)
    .map((issue) => issue.message);
}

/**
 * The `--fold-at`/`--fold` flags that put one rewritten fold in place, quoted so a shell passes the text exactly
 * as it was judged — a `$` or a quote in a fold must not change what close later reads.
 *
 * @returns the flags as the chair would paste them
 */
function rewriteFlags({ index, text }: { index: number; text: string }): string {
  return shellCommandLine({ command: ["--fold-at", String(index), "--fold", text] });
}

/**
 * What close would refuse in the authored folds' wording, with the plain-words rewrites that clear it.
 *
 * The level reports only its FIRST unglossed fleet word, and that message names the first phrase of it, so a
 * rewrite that turns "gold anchor" plain while "gold proof" stays would change the message without clearing
 * anything. A rewrite set is therefore offered only when, applied, it leaves the fold level with no fleet-word
 * refusal at all — then trimmed of every rewrite that level stays clean without, so a fold recut changed in
 * passing is never offered as the fix. One rewrite prints alone; more print as one set, labelled so. Nothing is
 * offered when even every rewrite together leaves a refusal: `recutText` has no substitution for some words
 * (`seam`, `waiver`), and printing a fold close would still refuse as the fix would be false.
 *
 * @param recent the headline sentences, folds and fold summary the sweep authored
 * @returns one `folds:` line per refusal, then the rewrite lines that clear the level, when a set does
 */
export function foldWordingIssues({ recent }: { recent: SweepBlockInput["recent"] }): readonly string[] {
  const refused = detailJargon({ recent });
  if (refused.length === 0) {
    return [];
  }
  const lines = refused.map((message) => `folds: ${message}`);
  const changed = recent.folds.flatMap((fold, index) => {
    const text = recutText({ text: fold }).text;
    return text === fold ? [] : [{ index, text }];
  });
  const clears = ({ changes }: { changes: readonly { index: number; text: string }[] }): boolean => {
    const folds = recent.folds.map((fold, index) => {
      const change = changes.find((candidate) => candidate.index === index);
      return change === undefined ? fold : change.text;
    });
    return detailJargon({ recent: { ...recent, folds } }).length === 0;
  };
  if (changed.length === 0 || !clears({ changes: changed })) {
    return lines;
  }
  const needed = changed.reduce((kept, change) => {
    const without = kept.filter((other) => other !== change);
    return clears({ changes: without }) ? without : kept;
  }, changed);
  // A rewrite is offered only if it reaches fill as the text judged here: no argv carries a NUL, fill's flag
  // parser reads a value opening `--` as a missing value, and `--fold-at` addresses no index past its digit cap.
  const unreachable = needed.some(
    (change) =>
      change.text.includes("\u0000") ||
      change.text.startsWith("--") ||
      String(change.index).length > FOLD_AT_MAX_DIGITS,
  );
  if (unreachable) {
    return lines;
  }
  if (needed.length === 1) {
    return [...lines, `  in plain words: ${rewriteFlags(needed[0]!)}`];
  }
  return [...lines, "  in plain words, applied together:", ...needed.map((change) => `    ${rewriteFlags(change)}`)];
}
