/**
 * The voice record read as a few `slopweaver console batch` processes rather than one child per verb: which slugs share
 * a process, how a batch's JSON lines become each slug's reading, and what a slug with no line is answered as.
 *
 * The CLI half is `src/cli/commands/console/batch.ts`; `site/` never imports `src/`, so the wire line is restated and
 * validated here, field by field, as any other verb's output is.
 */
import { isBag } from "./bag";
import { type LiveResult, liveResultOf } from "./liveVerbRun";
import type { LiveVerb } from "./liveVerbs";
import { closedReason, type SpawnOutcome } from "./spawnVerb";
import { VOICE_RECORD_SERVER_DEADLINE_MS, VOICE_RECORD_SLUGS } from "./voiceRecordRead";

/**
 * Which slugs share one process, each group's slugs in the order it runs them. A group of several is one
 * `console batch`; a group of ONE is that verb's own child, exactly as a page reads it, since a batch of one buys
 * nothing. MEASURED CPU per verb run in one process on the owner's machine (load 14.3, 10 cores): board 1.33 s,
 * talk-cards 1.34 s, autonomy 0.72 s, reviewers 0.29 s, drafts 0.23 s, slack-drafts 0.19 s, every other under
 * 0.13 s; one process's own boot costs about 0.5 s more. Under load every runnable process gets a share of the
 * cores, so the read lasts as long as its heaviest process: a few balanced processes keep that at about one of the
 * old children while the read's whole cost falls from fifteen boots to four, and the runnables it adds from fifteen
 * to four. `review-drafts` runs alone because `github review-draft` is declared external-write as a verb (its `post`
 * submits a review), which a batch refuses to run whatever the subcommand. Static on purpose: a verb's `lane` and
 * `timeoutMs` encode how often a page polls it, not what it costs. The heaviest member of each group runs first, so
 * a batch killed at the deadline has answered its costliest reading. Reproduce: pipe each group's argv list
 * (`liveVerbFor` of each slug) to `/usr/bin/time -p slopweaver console batch` and read user + sys, against
 * `/usr/bin/time -p slopweaver <argv>` for each verb on its own.
 */
export const VOICE_RECORD_GROUPS: readonly (readonly string[])[] = [
  [VOICE_RECORD_SLUGS.board],
  [VOICE_RECORD_SLUGS.reviews],
  [VOICE_RECORD_SLUGS.spoken, VOICE_RECORD_SLUGS.acts],
  [
    VOICE_RECORD_SLUGS.reviewers,
    VOICE_RECORD_SLUGS.drafts,
    VOICE_RECORD_SLUGS.posts,
    VOICE_RECORD_SLUGS.workstreams,
    VOICE_RECORD_SLUGS.hands,
    VOICE_RECORD_SLUGS.imports,
    VOICE_RECORD_SLUGS.standing,
    VOICE_RECORD_SLUGS.steers,
    VOICE_RECORD_SLUGS.currency,
    VOICE_RECORD_SLUGS.deferrals,
    VOICE_RECORD_SLUGS.landing,
  ],
];

/** The argv the route runs each batch with; its items arrive on stdin. */
export const VOICE_RECORD_BATCH_ARGV: readonly string[] = ["console", "batch"];

/** One item's line as `console batch` prints it. */
export interface ConsoleBatchWireLine {
  readonly index: number;
  readonly exitCode: number;
  readonly out: string;
  readonly err: string;
  readonly tookMs: number;
}

/** A batch's lines by item index, and why a complete line was not one, when one was not. */
export interface ParsedBatchLines {
  readonly lines: readonly (ConsoleBatchWireLine | undefined)[];
  readonly problem: string | undefined;
}

/**
 * One line as a wire line, or why it is not one.
 *
 * @param text one complete line
 * @param count how many items the batch was given, so an index past them is a fault
 * @returns the line, or the sentence naming what is wrong with it
 */
function wireLineOf({ text, count }: { text: string; count: number }): ConsoleBatchWireLine | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return `a line that is not JSON, beginning \`${text.slice(0, 80)}\``;
  }
  if (!isBag(value)) {
    return "a line that is not an object";
  }
  const { index, exitCode, out, err, tookMs } = value;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= count) {
    return `a line whose index ${String(index)} is not one of its ${String(count)} items`;
  }
  if (typeof exitCode !== "number" || !Number.isInteger(exitCode)) {
    return `item ${String(index)}'s line with no integer exitCode`;
  }
  if (typeof out !== "string" || typeof err !== "string") {
    return `item ${String(index)}'s line with no string out and err`;
  }
  if (typeof tookMs !== "number" || !Number.isFinite(tookMs) || tookMs < 0) {
    return `item ${String(index)}'s line with no non-negative tookMs`;
  }
  return { err, exitCode, index, out, tookMs };
}

/**
 * Read a batch's stdout into its lines by item index. Only a NEWLINE-ENDED line counts: a batch killed mid-write
 * leaves a fragment, which is dropped rather than misread. A line that is not one, or a second line for an index,
 * stops the parse and is named, so a malformed line is never read as a missing one, nor a later line as an earlier.
 *
 * @param out everything the batch printed, whole or cut by its kill
 * @param count how many items the batch was given
 * @returns each index's line, `undefined` where none arrived, and the problem that stopped the parse
 */
export function parseBatchLines({ out, count }: { out: string; count: number }): ParsedBatchLines {
  const lines: (ConsoleBatchWireLine | undefined)[] = Array.from({ length: count }, () => undefined);
  const complete = out.split("\n").slice(0, -1);
  for (const text of complete) {
    if (text.trim() === "") {
      continue;
    }
    const line = wireLineOf({ count, text });
    if (typeof line === "string") {
      return { lines, problem: `the batch printed ${line}` };
    }
    if (lines[line.index] !== undefined) {
      return { lines, problem: `the batch printed a second line for item ${String(line.index)}` };
    }
    lines[line.index] = line;
  }
  return { lines, problem: undefined };
}

/**
 * One item's line as the outcome its own child would have ended in: its stdout on exit 0, else the same sentence a
 * child closing non-zero is named by, its stdout and stderr kept — so `liveResultOf` reads it, a declared
 * expected-empty exit included, exactly as it reads a child.
 *
 * @param line the item's line
 * @param verb the allowlist row the item ran
 * @returns the outcome
 */
export function batchOutcomeOf({ line, verb }: { line: ConsoleBatchWireLine; verb: LiveVerb }): SpawnOutcome {
  if (line.exitCode === 0) {
    return { err: line.err, ok: true, out: line.out, tookMs: line.tookMs };
  }
  return {
    err: line.err,
    exitCode: line.exitCode,
    notMeasured: closedReason({ code: line.exitCode, err: line.err, signal: null, title: verb.title }),
    ok: false,
    out: line.out,
    tookMs: line.tookMs,
  };
}

/**
 * What became of one batch process: never launched, or how it ended — and whether it was the read's deadline that
 * ended it, which the outcome alone cannot say, since a kill and a failed launch both carry no exit code.
 */
export type BatchRun =
  | { readonly launched: false; readonly why: string }
  | { readonly launched: true; readonly outcome: SpawnOutcome; readonly killedAtDeadline: boolean };

/**
 * What a batch is sent on stdin: the argv of every slug the allowlist carries, in order. A slug it does not carry is
 * not sent, so item `i` is the `i`-th known slug, which is how `batchReadings` reads the lines back.
 *
 * @param verbs each slug's allowlist row, `undefined` for a slug the allowlist does not carry
 * @returns the items, each the argv after `slopweaver`
 */
export function batchItems({ verbs }: { verbs: readonly (LiveVerb | undefined)[] }): readonly (readonly string[])[] {
  return verbs.flatMap((verb) => (verb === undefined ? [] : [verb.argv]));
}

/**
 * Whether a batch ended because the read's deadline killed it. `spawnVerb` reports a kill at its bound and a launch
 * that failed the same way — no exit code — so the clock tells them apart: a failed launch fails at once, a kill only
 * at the deadline. A batch a signal ended early (the console's own rebuild) carries no exit code either, and it is
 * before the deadline, so it is named by its own reason instead.
 *
 * @param outcome how the batch process ended
 * @param deadlineAtMs the monotonic instant the read's batches are killed at
 * @param nowMs the monotonic instant the outcome arrived at, on the same clock
 * @returns true when the deadline is what ended it
 */
export function batchKilledAtDeadline({
  outcome,
  deadlineAtMs,
  nowMs,
}: {
  outcome: SpawnOutcome;
  deadlineAtMs: number;
  nowMs: number;
}): boolean {
  return !outcome.ok && outcome.exitCode === undefined && nowMs >= deadlineAtMs;
}

/**
 * Every slug of one batch as a reading: its line through `liveResultOf`, or why there is none. A slug the batch
 * never reached is named by how the batch ended — killed at the deadline, or failed — never read as empty.
 *
 * @param slugs the batch's slugs, in the order its items were sent
 * @param verbs each slug's allowlist row, `undefined` for a slug the allowlist does not carry
 * @param run what became of the batch process
 * @param receivedAtIso when the route received the batch's output, the stamp for every reading not stamped by its verb
 * @returns each slug and its reading
 */
export function batchReadings({
  slugs,
  verbs,
  run,
  receivedAtIso,
}: {
  slugs: readonly string[];
  verbs: readonly (LiveVerb | undefined)[];
  run: BatchRun;
  receivedAtIso: string;
}): readonly (readonly [string, LiveResult])[] {
  const failed = (notMeasured: string): LiveResult => ({ notMeasured, observedAtIso: receivedAtIso, ok: false });
  if (!run.launched) {
    return slugs.map((slug) => [slug, failed(`${slug} was not started: ${run.why}`)]);
  }
  const { outcome } = run;
  const sent = batchItems({ verbs });
  const parsed = parseBatchLines({ count: sent.length, out: outcome.out });
  let item = -1;
  return slugs.map((slug, index): readonly [string, LiveResult] => {
    const verb = verbs[index];
    if (verb === undefined) {
      return [slug, failed(`no live verb named ${slug}`)];
    }
    item += 1;
    const line = parsed.lines[item];
    if (line !== undefined) {
      return [slug, liveResultOf({ outcome: batchOutcomeOf({ line, verb }), receivedAtIso, verb })];
    }
    if (parsed.problem !== undefined) {
      return [slug, failed(`${slug} was not read: ${parsed.problem}`)];
    }
    if (run.killedAtDeadline) {
      return [
        slug,
        failed(
          `${slug} did not answer within the ${String(VOICE_RECORD_SERVER_DEADLINE_MS / 1000)} s the voice record read has`,
        ),
      ];
    }
    const ended = outcome.ok ? "the batch it ran in finished without answering it" : outcome.notMeasured;
    return [slug, failed(`${slug} was not read: ${ended}`)];
  });
}
