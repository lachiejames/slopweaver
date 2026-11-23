/**
 * What a failed `verb-run` firing said about WHY, cut down to what fits on its slot record.
 *
 * A `verb-run` row runs its verb in a child of the same CLI (`./verbRun.ts`), and the verb's reason for exiting 1
 * goes to stderr, whose closing stretch the parent keeps. The slot record keeps more than `exit 1`. MEASURED: `store-restore-rehearsal-monthly`
 * settled `failed` with the detail `recipe store-restore-rehearsal-monthly · ran · slopweaver
 * store rehearse · exit 1`, the verb's own `last.json` was overwritten by a passing hand run two hours later,
 * and the cause was gone — nothing was left to dispatch a fix for. Repro: `grep -h '"detail"'
 * $SLOPWEAVER_HOME/live/recipe/slot-attempts/*.json`.
 *
 * The LAST lines are the ones kept, because a verb states its failure as it stops: an early progress line is
 * what it was doing, the closing one is why it gave up.
 */
import { stripVTControlCharacters } from "node:util";

/** How many of the verb's closing stderr lines the record keeps. */
const KEPT_LINES = 3;

/** The longest one kept line may be before it is cut, so one runaway line cannot crowd out the others. */
const MAX_LINE_CHARS = 240;

/**
 * One over-long line cut to {@link MAX_LINE_CHARS} keeping its HEAD: a refusal leads with its remedy and the
 * opening words of its cause, and `src/__tests__/unit/atlas/jam/errors.test.ts` pins that composition through this reducer.
 */
function cutLine({ line }: { line: string }): string {
  // Counted and cut by code point, so a cut never splits an emoji's surrogate pair into two unpaired halves.
  const chars = Array.from(line);
  if (chars.length <= MAX_LINE_CHARS) {
    return line;
  }
  return `${chars.slice(0, MAX_LINE_CHARS - 1).join("")}…`;
}

/**
 * The closing lines of a failed verb's stderr, joined into one bounded clause for its slot record.
 *
 * @param text everything the verb wrote to stderr while it ran, or the tail of it
 * @returns the last few non-blank lines joined with ` / `, or `null` when the verb wrote nothing readable
 */
export function verbFailureWhy({ text }: { text: string }): string | null {
  const lines = stripVTControlCharacters(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }
  return lines
    .slice(-KEPT_LINES)
    .map((line) => cutLine({ line }))
    .join(" / ");
}

/**
 * A failed STEP's outcome line with its own closing stderr appended as `· why: …`, so the cause rides the line
 * onto the slot record and the failure finding's ask. A leg's reason is its stderr, kept by the runner that ran it
 * (a child's by its parent, a collected leg's by a tee), and nothing else keeps it; a multi-leg row appends only the FAILING leg's tail, never a
 * leg that succeeded before it. Call it only on a step that did NOT do its work — judged failed, or DEFERRED
 * (`EXIT_DEFERRED`), whose closing line says what it was waiting on: a succeeding verb's progress is not a cause.
 * MEASURED: a `worktree prune --apply` deferred on a cmux timeout would otherwise settle its slot
 * with no word of why.
 *
 * @param line the outcome line the runner already composed for the failed or deferred step
 * @param diagnostics what that one step wrote to stderr while it ran, or the tail of it
 * @returns the line with the step's cause appended, or the line unchanged when the step wrote nothing readable
 */
export function appendVerbFailureWhy({ line, diagnostics }: { line: string; diagnostics: string }): string {
  const why = verbFailureWhy({ text: diagnostics });
  return why === null ? line : `${line} · why: ${why}`;
}
