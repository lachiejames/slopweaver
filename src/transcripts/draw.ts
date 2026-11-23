/**
 * What each tool call cost the session that made it, in tokens, folded out of one transcript's raw lines. Pure.
 * The walk is `./drawFold.ts`, its end of file `./drawFinish.ts`, the shapes and classifiers `./drawShapes.ts`;
 * this module is the report over the readings they produce.
 *
 * ## The question, and why it needed its own fold
 *
 * The owner asked which commands the supervisor chair runs most frequently and how many tokens each costs on
 * average, because an action that often needs to trim something after writing progress to fit a word limit can
 * cost about three times as much. `./latency.ts` already pairs a call with its
 * result, but it reads `./record.ts`'s decoded records, which carry no `message.usage` — and usage is the only
 * MEASURED token count a transcript holds. So this fold reads raw lines, once each.
 *
 * ## Where every number comes from
 *
 * - **Measured result tokens.** The harness writes one `usage` per API call on the assistant record. The prompt
 *   that call read is `input + cache_creation + cache_read`. Between two consecutive main-thread calls the prompt
 *   grows by the previous call's own output plus everything appended after it: the tool results, and whatever a
 *   hook injected beside them. So `next prompt − previous prompt − previous output` is what that gap's results
 *   cost, MEASURED, hook text included — which is right, because a per-call hook is that call's cost too. A gap
 *   holding several results splits its delta by their characters. A gap that SHRANK (a compaction, a context
 *   edit) attributes nothing and is counted, never guessed at.
 * - **Estimated result tokens.** Characters over {@link CHARS_PER_TOKEN}, beside the measured figure so a reader
 *   sees both; the fold also reports the ratio the measured gaps imply.
 * - **Carried tokens.** A result is not paid for once. It stays in the prompt and is read again by every later
 *   API call until a compaction drops it, so `measured × later calls in the same epoch` is what it really drew —
 *   at the cache-read rate, but drawn every call. Only the reads inside the kept ticks count, so a per-tick figure
 *   never charges a read made in a tick its divisor leaves out.
 * - **The preamble.** `./drawShapes.ts`'s `STALE_SEAT_HEAD` opens the advisory `src/cli/staleSeat.ts` prints
 *   ahead of a verb; its characters inside a result are reported as that verb's preamble share.
 *
 * ## A retry is a call refused and then made again
 *
 * A trim-after-write lap is structural: a `slopweaver <noun> <verb>` call comes back with text naming a cap
 * (`./drawShapes.ts`'s `CAP_REFUSAL`), and the SAME head is called again later. Its cost is the rewrite: every API
 * call between the refused result and the retry that issued nothing, or only `Write`/`Edit` or that same head — so
 * unrelated work the chair did in between is not billed to the lap. For each such call the fold keeps its output
 * tokens (the re-thinking and the rewrite) and the whole prompt it read, because every extra API call re-reads the
 * context, and that re-read is what a lap really costs. A refusal never retried is counted apart.
 *
 * ## Ticks
 *
 * A tick ENDS at the receipt `supervisor tick close: <handoff>-tick-<n> recorded`
 * (`src/cli/commands/supervisor/tickCloseCommit.ts`), and everything since the previous receipt is tick `n`.
 * `tick open`'s own number is a scratch-directory index that recurs, so it is never read. Calls after the last
 * receipt belong to no recorded tick and are tick `0`.
 */

import { CHARS_PER_TOKEN, capClassOf, type DrawCall, type DrawReading, type DrawRetry, readsOf } from "./drawShapes.js";

/**
 * One verb's row in the report.
 *
 * @internal
 */
export interface DrawVerbRow {
  readonly head: string;
  readonly calls: number;
  readonly callsPerTick: number;
  /** Mean measured tokens a result of this verb added to the prompt, over its measured calls. */
  readonly meanTokens: number;
  /** Mean characters-over-{@link CHARS_PER_TOKEN} estimate, over every answered call. */
  readonly meanEstimatedTokens: number;
  /** Measured tokens per tick, the verb's mean standing in for an unmeasured call. */
  readonly tokensPerTick: number;
  /** Measured tokens times the API calls that read them — what the results really drew, per tick. */
  readonly carriedPerTick: number;
  /** The share of this verb's result characters that were the stale-seat advisory. */
  readonly preambleShare: number;
  readonly errors: number;
}

/**
 * The retried refusals of one cap, totalled.
 *
 * @internal
 */
export interface DrawRetryGroup {
  readonly cap: string;
  /** The verbs that relayed it, in first-seen order. */
  readonly heads: readonly string[];
  readonly refusals: number;
  /** Rewrite output plus the refusals' own tokens. */
  readonly lapTokens: number;
  readonly lapCarried: number;
  readonly lapApiCalls: number;
  readonly lapPromptTokens: number;
}

/** The whole report over one or more readings. */
export interface DrawSummary {
  readonly ticks: number;
  readonly apiCalls: number;
  readonly calls: number;
  readonly outputTokensPerTick: number;
  /** Every API call's whole prompt, summed — what the tick read, nearly all of it at the cache-read rate. */
  readonly promptTokensPerTick: number;
  readonly resultTokensPerTick: number;
  readonly preambleTokensPerTick: number;
  /** Characters per measured token, over every measured gap. */
  readonly impliedCharsPerToken: number;
  readonly unmeasuredGaps: number;
  /** Epochs opened inside the kept ticks — how often the context was compacted and had to be rebuilt. */
  readonly compactions: number;
  readonly verbs: readonly DrawVerbRow[];
  readonly retries: readonly DrawRetry[];
  readonly retriedLaps: number;
  /** Rewrite output tokens plus the refusals' own tokens, over every retried lap. */
  readonly lapTokens: number;
  /** The refusals' tokens times every later call that read them. */
  readonly lapCarried: number;
  /** The API calls the rewrites took, and the whole prompts those calls read. */
  readonly lapApiCalls: number;
  readonly lapPromptTokens: number;
  /** Retried refusals grouped by the cap that fired (`./drawShapes.ts`'s `capClassOf`), the costliest re-read first. */
  readonly retriesByCap: readonly DrawRetryGroup[];
  /** Attachment tokens per tick by type, largest first. */
  readonly attachmentsPerTick: readonly { readonly kind: string; readonly tokensPerTick: number }[];
  /** Calls a `PreToolUse` hook refused, and the measured tokens their refusals added. */
  readonly hookRefusals: number;
  readonly hookRefusalTokens: number;
}

/** Retried refusals grouped by the cap that fired, the costliest re-read first. */
function retriesByCapOf({ retried }: { retried: readonly DrawRetry[] }): DrawRetryGroup[] {
  const groups = new Map<
    string,
    {
      heads: string[];
      refusals: number;
      lapTokens: number;
      lapCarried: number;
      lapApiCalls: number;
      lapPromptTokens: number;
    }
  >();
  retried.forEach((row) => {
    const cap = capClassOf({ refusal: row.refusal });
    const group = groups.get(cap);
    const lap = row.lapOutputTokens + row.refusalTokens;
    if (group === undefined) {
      groups.set(cap, {
        heads: [row.head],
        lapApiCalls: row.lapApiCalls,
        lapCarried: row.refusalCarried,
        lapPromptTokens: row.lapPromptTokens,
        lapTokens: lap,
        refusals: 1,
      });
      return;
    }
    if (!group.heads.includes(row.head)) {
      group.heads.push(row.head);
    }
    group.refusals += 1;
    group.lapTokens += lap;
    group.lapCarried += row.refusalCarried;
    group.lapApiCalls += row.lapApiCalls;
    group.lapPromptTokens += row.lapPromptTokens;
  });
  return [...groups.entries()]
    .map(([cap, group]) => ({ cap, ...group }))
    .toSorted((left, right) => right.lapPromptTokens - left.lapPromptTokens);
}

/**
 * Fold one reading per transcript into the per-verb report, per tick of the ticks they hold.
 *
 * A transcript's ticks are its kept segments: each recorded tick, and the tail after its last `tick close` (tick 0)
 * as one more, so every call in a numerator sits in a tick the denominator counts, and a session that never closed
 * a tick reports per-session figures. With nothing kept the divisor is 1, never zero.
 *
 * @param readings one per transcript walked
 * @param fromTick the first tick kept, inclusive; 0 keeps the calls after the last recorded `tick close`
 * @param toTick the last tick kept, inclusive
 * @returns the report, verbs ranked by tokens carried per tick
 */
export function summariseDraw({
  readings,
  fromTick,
  toTick,
}: {
  readings: readonly DrawReading[];
  fromTick: number;
  toTick: number;
}): DrawSummary {
  const kept = ({ tick }: { tick: number }): boolean => tick >= fromTick && tick <= toTick;
  const tickRows = readings.flatMap((reading) => reading.ticks.filter((row) => kept({ tick: row.tick })));
  // one row per kept segment of one reading, the tail after its last `tick close` (tick 0) a tick of its own
  const ticks = Math.max(1, tickRows.length);
  const verbs = verbRowsOf({ kept, readings, ticks });
  // every total over results gives one in a shrunk gap its verb's mean, exactly as the verb table does
  const meanOf = new Map(verbs.map((row) => [row.head, row.meanTokens]));
  const tokenOf = (call: DrawCall): number => (call.measured ? call.measuredTokens : meanOf.get(call.head)!);
  const retries = keptRetriesOf({ kept, meanOf, readings });
  const retried = retries.filter((row) => row.retried);
  const allCalls = readings.flatMap((reading) => reading.calls.filter((call) => kept({ tick: call.tick })));
  const measuredCalls = allCalls.filter((call) => call.measured);
  const measuredChars = measuredCalls.reduce((sum, call) => sum + call.resultChars, 0);
  const measuredTokens = measuredCalls.reduce((sum, call) => sum + call.measuredTokens, 0);
  const preambleChars = allCalls.reduce((sum, call) => sum + call.preambleChars, 0);
  const hookRefused = allCalls.filter((call) => call.hookRefused);
  return {
    lapApiCalls: retried.reduce((sum, row) => sum + row.lapApiCalls, 0),
    lapCarried: retried.reduce((sum, row) => sum + row.refusalCarried, 0),
    lapPromptTokens: retried.reduce((sum, row) => sum + row.lapPromptTokens, 0),
    retriesByCap: retriesByCapOf({ retried }),
    apiCalls: tickRows.reduce((sum, row) => sum + row.apiCalls, 0),
    attachmentsPerTick: attachmentsPerTickOf({ kept, readings, ticks }),
    hookRefusalTokens: hookRefused.reduce((sum, call) => sum + tokenOf(call), 0),
    hookRefusals: hookRefused.length,
    calls: allCalls.length,
    compactions: readings.reduce(
      (sum, reading) => sum + reading.compactionTicks.filter((tick) => kept({ tick })).length,
      0,
    ),
    impliedCharsPerToken: measuredTokens === 0 ? 0 : measuredChars / measuredTokens,
    lapTokens: retried.reduce((sum, row) => sum + row.lapOutputTokens + row.refusalTokens, 0),
    outputTokensPerTick: tickRows.reduce((sum, row) => sum + row.outputTokens, 0) / ticks,
    promptTokensPerTick: tickRows.reduce((sum, row) => sum + row.promptTokens, 0) / ticks,
    preambleTokensPerTick: preambleChars / CHARS_PER_TOKEN / ticks,
    resultTokensPerTick: verbs.reduce((sum, row) => sum + row.tokensPerTick, 0),
    retriedLaps: retried.length,
    retries,
    ticks,
    unmeasuredGaps: allCalls.filter((call) => call.answered && !call.measured && call.readIndex > 0).length,
    verbs,
  };
}

/** One row per verb over the kept ticks, ranked by tokens carried per tick. */
function verbRowsOf({
  readings,
  kept,
  ticks,
}: {
  readings: readonly DrawReading[];
  kept: (window: { tick: number }) => boolean;
  ticks: number;
}): DrawVerbRow[] {
  const groups = new Map<string, { calls: DrawCall[]; reads: number[] }>();
  readings.forEach((reading) => {
    reading.calls.forEach((call) => {
      if (!kept({ tick: call.tick })) {
        return;
      }
      const reads = readsOf({ kept, readIndex: call.readIndex, reading });
      const group = groups.get(call.head);
      if (group === undefined) {
        groups.set(call.head, { calls: [call], reads: [reads] });
        return;
      }
      group.calls.push(call);
      group.reads.push(reads);
    });
  });
  return [...groups.entries()]
    .map(([head, group]) => verbRow({ group, head, ticks }))
    .toSorted((left, right) => right.carriedPerTick - left.carriedPerTick);
}

/** Every refusal in the kept ticks, its tokens and carried reads recounted over those ticks alone. */
function keptRetriesOf({
  readings,
  kept,
  meanOf,
}: {
  readings: readonly DrawReading[];
  kept: (window: { tick: number }) => boolean;
  meanOf: ReadonlyMap<string, number>;
}): DrawRetry[] {
  return readings.flatMap((reading) =>
    reading.retries
      .filter((row) => kept({ tick: row.tick }))
      .map((row) => {
        // a refusal row keeps no call, so its own measured flag stands in for `tokenOf`'s
        const tokens = row.refusalMeasured ? row.refusalTokens : meanOf.get(row.head)!;
        const reads = readsOf({ kept, readIndex: row.refusalReadIndex, reading });
        return { ...row, refusalCarried: tokens * reads, refusalTokens: tokens };
      }),
  );
}

/** Attachment tokens per tick by type, over the kept ticks, largest first. */
function attachmentsPerTickOf({
  readings,
  kept,
  ticks,
}: {
  readings: readonly DrawReading[];
  kept: (window: { tick: number }) => boolean;
  ticks: number;
}): { kind: string; tokensPerTick: number }[] {
  const byKind = new Map<string, number>();
  readings
    .flatMap((reading) => reading.attachments.filter((row) => kept({ tick: row.tick })))
    .forEach((row) => {
      const prior = byKind.get(row.kind);
      byKind.set(row.kind, prior === undefined ? row.tokens : prior + row.tokens);
    });
  return [...byKind.entries()]
    .map(([kind, tokens]) => ({ kind, tokensPerTick: tokens / ticks }))
    .toSorted((left, right) => right.tokensPerTick - left.tokensPerTick);
}

/** One call of one verb, for the per-call listing. */
export interface DrawVerbCall {
  readonly tick: number;
  readonly label: string;
  /** Measured tokens, or -1 when its gap shrank and nothing could be measured. */
  readonly tokens: number;
  /** How many API calls read the result before a compaction dropped it. */
  readonly reads: number;
}

/**
 * Every call of one head in the kept ticks, in order — what a verb row's mean is made of, so a reader can see
 * whether a heavy verb is heavy on every call or on a few.
 *
 * @param head the head as the report names it, `Read` or `slopweaver machine capacity`
 * @param fromTick the first tick kept, inclusive
 * @param toTick the last tick kept, inclusive
 * @returns one row per call
 */
export function verbCallsOf({
  readings,
  head,
  fromTick,
  toTick,
}: {
  readings: readonly DrawReading[];
  head: string;
  fromTick: number;
  toTick: number;
}): readonly DrawVerbCall[] {
  const kept = ({ tick }: { tick: number }): boolean => tick >= fromTick && tick <= toTick;
  return readings.flatMap((reading) =>
    reading.calls
      .filter((call) => call.head === head && kept({ tick: call.tick }))
      .map((call) => ({
        label: call.inputLabel,
        reads: readsOf({ kept, readIndex: call.readIndex, reading }),
        tick: call.tick,
        tokens: call.measured ? call.measuredTokens : -1,
      })),
  );
}

/** One verb's row, from its calls and how many API calls read each result. */
function verbRow({
  head,
  group,
  ticks,
}: {
  head: string;
  group: { calls: readonly DrawCall[]; reads: readonly number[] };
  ticks: number;
}): DrawVerbRow {
  const answered = group.calls.filter((call) => call.answered);
  const measured = answered.filter((call) => call.measured);
  const meanTokens =
    measured.length === 0 ? 0 : measured.reduce((sum, call) => sum + call.measuredTokens, 0) / measured.length;
  const chars = answered.reduce((sum, call) => sum + call.resultChars, 0);
  const preamble = answered.reduce((sum, call) => sum + call.preambleChars, 0);
  const tokenOf = (call: DrawCall): number => (call.measured ? call.measuredTokens : meanTokens);
  let carried = 0;
  group.calls.forEach((call, at) => {
    if (call.answered) {
      carried += tokenOf(call) * group.reads[at]!;
    }
  });
  return {
    calls: group.calls.length,
    callsPerTick: group.calls.length / ticks,
    carriedPerTick: carried / ticks,
    errors: group.calls.filter((call) => call.isError).length,
    head,
    meanEstimatedTokens: answered.length === 0 ? 0 : chars / CHARS_PER_TOKEN / answered.length,
    meanTokens,
    preambleShare: chars === 0 ? 0 : preamble / chars,
    tokensPerTick: answered.reduce((sum, call) => sum + tokenOf(call), 0) / ticks,
  };
}
