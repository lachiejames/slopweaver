/**
 * The sentence a voice tool's failed verb is reported to the model by — the talk route's own reading of a
 * `spawnVerb` failure, kept apart from `spawnVerb`'s `notMeasured` on purpose.
 *
 * `notMeasured` keeps the last THREE stderr lines, which suits a tile saying why it is empty. A policy refusal
 * is four lines (`.claude/rules/error-handling.md`) and its useful half is the FIRST: a voice
 * refused `app.datadoghq.com` by the Datadog site guard and handed only the three lines about an override
 * tells the owner it could not set one — while the line naming the right host, the one that would let it
 * retry on its own, has been cut. So the model is handed enough
 * lines to hold a whole refusal, bounded so a chatty verb cannot flood it. Every other route keeps
 * `notMeasured`, unchanged.
 */
import type { SpawnOutcome } from "./spawnVerb";

/** The most stderr lines handed back: a four-line refusal and the two lines a verb may print above it. */
const FAILURE_LINES = 6;

/** The most characters of stderr handed back, so the tool answer stays one small line. */
const FAILURE_CHARS = 1500;

/**
 * What one failed voice tool is reported as.
 *
 * A verb that exited non-zero is reported by its own last {@link FAILURE_LINES} stderr lines, sharing
 * {@link FAILURE_CHARS} between them; one that timed out or never launched carries no exit code, and its `notMeasured`
 * sentence is already the whole story.
 *
 * @param outcome the failed run
 * @param title the verb line, as `talkToolsList.ts` titles it
 * @returns the sentence the model reads
 */
export function talkToolFailureDetail({
  outcome,
  title,
}: {
  outcome: Extract<SpawnOutcome, { readonly ok: false }>;
  title: string;
}): string {
  if (outcome.exitCode === undefined) {
    return outcome.notMeasured;
  }
  const lines = outcome.err
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(-FAILURE_LINES);
  const said = `${title} exited ${String(outcome.exitCode)}`;
  if (lines.length === 0) {
    return said;
  }
  return `${said}: ${linesWithin({ lines, maxChars: FAILURE_CHARS })}`;
}

/** The fewest characters an OLDER line keeps, so a flood above a refusal still shows its head and tail. */
const OLDER_LINE_FLOOR = 80;

/**
 * Every line, each cut to fit a budget — never a line dropped, and the NEWEST lines first. A refusal is the last
 * thing a verb prints and its useful half is its FIRST line, so no rule keeping whole lines from either end
 * holds both (a long line above a refusal can leave nothing of it, and an
 * even share of the budget still cuts the middle out of its first line). So lines are funded from the end: each
 * keeps all it has while {@link OLDER_LINE_FLOOR} is still left for every line above it, and a line over its
 * allowance keeps its head and its tail.
 *
 * @param lines the non-blank stderr lines, oldest first
 * @param maxChars the budget for the joined text, at least the floor for every line
 * @returns the lines joined with ` · `, each over its allowance cut in the middle with `…`
 */
function linesWithin({ lines, maxChars }: { lines: readonly string[]; maxChars: number }): string {
  const kept: string[] = [];
  let left = maxChars - SEPARATOR.length * (lines.length - 1);
  lines.toReversed().forEach((line, fromEnd) => {
    const above = lines.length - 1 - fromEnd;
    const allowance = Math.min(line.length, left - OLDER_LINE_FLOOR * above);
    kept.unshift(cutMiddle({ line, maxChars: allowance }));
    left -= allowance;
  });
  return kept.join(SEPARATOR);
}

/** What the kept lines are joined with. */
const SEPARATOR = " · ";

/**
 * One line cut to a length by its middle, keeping its head and its tail.
 *
 * @param line the line to fit
 * @param maxChars the most characters it may keep, the `…` included
 * @returns the line, or its head and tail around `…`
 */
function cutMiddle({ line, maxChars }: { line: string; maxChars: number }): string {
  if (line.length <= maxChars) {
    return line;
  }
  const head = Math.ceil((maxChars - 1) / 2);
  const tail = maxChars - 1 - head;
  return `${line.slice(0, head)}…${line.slice(line.length - tail)}`;
}
