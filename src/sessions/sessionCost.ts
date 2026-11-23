/**
 * What a Claude session has spent, folded out of its own transcript.
 *
 * ## No API, no vendor, no export — the numbers are already on this machine
 *
 * Every assistant turn in `~/.claude/projects/<project>/<session>.jsonl` carries a `message.usage` object
 * with `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` and the
 * model. Cost attribution is therefore a fold over files that already exist, keyed by session — no second
 * source, nothing to authenticate against, and nothing that can be unreachable.
 *
 * ## Tokens, not dollars, and that is a decision rather than an omission
 *
 * The fold gives tokens exactly. Dollars need a rate card this repository does not have, and a wrong dollar
 * figure on a page whose entire job is to be believed is worse than an honest token count. So the four
 * counters are carried separately and printed separately; nothing here blends them into a headline.
 *
 * Measured across 5,103 sessions on this machine: output 189,489,038 · cache read 51,091,613,266 ·
 * cache creation 2,691,912,426 · **fresh input 4,611,857**. The 95% cache-hit rate inverts the obvious
 * assumption — "wasted tokens re-deriving context" is not an input-side problem — which is exactly why the
 * counters must stay apart. A single blended number would have hidden that.
 *
 * ## One line per turn is a LIE, and believing it doubles every figure
 *
 * Measured on three live transcripts: 36 usage-bearing lines carried only 18 distinct
 * `message.id`s, 33 carried 21, 27 carried 14. Claude Code writes one line per CONTENT BLOCK — a `thinking`
 * block and the `tool_use` block that follows it are two lines quoting the SAME cumulative usage. A naive
 * sum over usage-bearing lines therefore overstates spend by roughly a factor of two, silently, in the one
 * direction that makes a cost panel look alarming.
 *
 * So {@link advanceCursor} deduplicates by `message.id` and COUNTS what it skipped. A turn whose line carries
 * no id is refused rather than counted, because deduplicating a missing id would collapse every such turn
 * into one and undercount instead.
 *
 * Pure: text in, numbers out. The file reading lives with each caller, `src/sessions/transcriptUsageStore.ts`
 * among them.
 */
import { absentAsNumber } from "#lib/absent.js";
import { isRecord } from "../lib/parsers.js";

/** The four counters, kept apart. Never summed into one figure — see this file's header for why. */
export interface UsageTotals {
  /** How many distinct assistant turns were counted. The denominator for every figure below. */
  readonly turns: number;
  /** Tokens the model wrote. The dearest counter, and the one that moves with what an agent actually does. */
  readonly outputTokens: number;
  /** Tokens served from the prompt cache. 95% of all traffic on this machine, measured. */
  readonly cacheReadTokens: number;
  /** Tokens written INTO the prompt cache. */
  readonly cacheCreationTokens: number;
  /** Tokens sent uncached. Tiny in practice — 4.6M against 51.1B of cache reads. */
  readonly inputTokens: number;
}

/** A total that has counted nothing yet. */
export const ZERO_USAGE: UsageTotals = {
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  turns: 0,
};

/** One assistant turn's usage, as one transcript line reports it. */
export interface TurnUsage {
  /** `message.id` — the deduplication key, because one turn is written across several lines. */
  readonly messageId: string;
  /** The model that served the turn, e.g. `claude-opus-5`. */
  readonly model: string;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly inputTokens: number;
}

/** What one transcript line turned out to be. Three states, because "not a usage line" is not a fault. */
export type UsageLine =
  | { readonly kind: "usage"; readonly turn: TurnUsage }
  | { readonly kind: "other" }
  | { readonly kind: "unreadable"; readonly why: string };

/** A number field, or `undefined` when it is absent or not a finite number. */
function numberAt({ record, name }: { record: Record<string, unknown>; name: string }): number | undefined {
  const value = record[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A string field, or the empty string when it is absent or the wrong type. */
function stringAt({ record, name }: { record: Record<string, unknown>; name: string }): string {
  const value = record[name];
  return typeof value === "string" ? value : "";
}

/** An object field, or `undefined` when it is absent or not an object. */
function objectAt({
  record,
  name,
}: {
  record: Record<string, unknown>;
  name: string;
}): Record<string, unknown> | undefined {
  const value = record[name];
  return isRecord(value) ? value : undefined;
}

/**
 * Read one transcript line.
 *
 * A line that never mentions `usage` is `other` and costs one substring search rather than a parse — which
 * is what makes folding a 42 MB transcript (the largest on this machine, measured) affordable at all.
 *
 * @param line one line of the transcript, without its newline
 * @returns the turn it reports, the fact that it reports none, or why it could not be read
 */
export function readUsageLine({ line }: { line: string }): UsageLine {
  if (!line.includes('"usage"')) {
    return { kind: "other" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return { kind: "unreadable", why: "a line mentioning usage is not readable JSON" };
  }
  if (!isRecord(parsed)) {
    return { kind: "unreadable", why: "a line mentioning usage does not hold an object" };
  }
  return usageOfRecord({ record: parsed });
}

/**
 * Read one already-decoded transcript record, for a caller that needs another field of the same line — the fleet
 * burn reads its `timestamp` — without decoding it twice.
 *
 * @param record the decoded line
 * @returns the turn it reports, the fact that it reports none, or why it could not be read
 */
export function usageOfRecord({ record }: { record: Record<string, unknown> }): UsageLine {
  const message = objectAt({ name: "message", record });
  const usage = message === undefined ? undefined : objectAt({ name: "usage", record: message });
  if (message === undefined || usage === undefined) {
    return { kind: "other" };
  }
  return turnOf({ message, usage });
}

/**
 * Turn a decoded `message` plus its `usage` into a countable turn, or say why it is not one.
 *
 * `output_tokens` is REQUIRED rather than defaulted: a usage object without it is shape drift, and a shape
 * change that silently folded to zero would make spend fall while nothing had changed.
 */
function turnOf({ message, usage }: { message: Record<string, unknown>; usage: Record<string, unknown> }): UsageLine {
  const messageId = stringAt({ name: "id", record: message });
  if (messageId === "") {
    // Deduplication is BY this id. Counting an id-less turn would double it when its sibling block arrives;
    // deduplicating on the empty string would collapse every such turn into one. Refused, and reported.
    return {
      kind: "unreadable",
      why: "a usage line carries no message id, so it can be neither counted nor deduplicated",
    };
  }
  const outputTokens = numberAt({ name: "output_tokens", record: usage });
  if (outputTokens === undefined) {
    return { kind: "unreadable", why: `the usage object for ${messageId} carries no output_tokens` };
  }
  return {
    kind: "usage",
    turn: {
      cacheCreationTokens: absentAsNumber({
        value: numberAt({ name: "cache_creation_input_tokens", record: usage }),
        whenAbsent: 0,
      }),
      cacheReadTokens: absentAsNumber({
        value: numberAt({ name: "cache_read_input_tokens", record: usage }),
        whenAbsent: 0,
      }),
      inputTokens: absentAsNumber({ value: numberAt({ name: "input_tokens", record: usage }), whenAbsent: 0 }),
      messageId,
      model: stringAt({ name: "model", record: message }),
      outputTokens,
    },
  };
}

/**
 * Add one turn to a running total.
 *
 * @param totals the total so far
 * @param turn the turn to add
 * @returns the new total
 */
export function addUsage({ totals, turn }: { totals: UsageTotals; turn: TurnUsage }): UsageTotals {
  return {
    cacheCreationTokens: totals.cacheCreationTokens + turn.cacheCreationTokens,
    cacheReadTokens: totals.cacheReadTokens + turn.cacheReadTokens,
    inputTokens: totals.inputTokens + turn.inputTokens,
    outputTokens: totals.outputTokens + turn.outputTokens,
    turns: totals.turns + 1,
  };
}

/**
 * Add two totals together, for the machine-wide figure under the roster.
 *
 * @param left one total
 * @param right the other
 * @returns their sum, turn counts included
 */
export function sumUsage({ left, right }: { left: UsageTotals; right: UsageTotals }): UsageTotals {
  return {
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    turns: left.turns + right.turns,
  };
}

/**
 * How far into one transcript the fold has got, and what it found.
 *
 * Held between reads so a watch-driven recompute folds only the bytes appended since last time. The
 * alternative — re-reading every live session's transcript on every file event — was measured at up to 42 MB
 * per session per event, which would make the pushed roster the slowest thing on the page.
 */
export interface CostCursor {
  /** How many bytes have been folded. Always lands on a newline, never mid-line. */
  readonly offsetBytes: number;
  readonly totals: UsageTotals;
  /** Every `message.id` already counted, so a sibling content block cannot count twice. */
  readonly counted: ReadonlySet<string>;
  /** Every model seen, sorted. Named on the row because Opus and Sonnet are not the same spend. */
  readonly models: readonly string[];
  /**
   * The same totals again, split by the model that served each turn.
   *
   * A SPLIT rather than a second fold: it accumulates inside {@link advanceCursor}'s existing duplicate
   * check, so it cannot disagree with {@link CostCursor.totals} about which turns were counted. Splitting
   * them apart afterwards would need a second pass over the transcript and a second copy of the
   * `message.id` rule, which is exactly how two counters drift.
   *
   * It exists because a token is not a token across models: MEASURED across the fleet, Fable
   * took 30.8% of notional spend on 15.9% of the tokens, so a token-only figure understates it by about
   * 2x. `sessions/modelWeight.ts` is what turns this split into a comparable number.
   */
  readonly usageByModel: ReadonlyMap<string, UsageTotals>;
  /** How many lines were skipped as already-counted. Printed, because it is ~50% and looks wrong unexplained. */
  readonly duplicates: number;
  /** How many lines mentioned usage and could not be read. Never silent — a dropped turn is missing spend. */
  readonly unreadable: number;
}

/** A cursor that has read nothing. */
export const EMPTY_CURSOR: CostCursor = {
  counted: new Set<string>(),
  duplicates: 0,
  models: [],
  offsetBytes: 0,
  totals: ZERO_USAGE,
  unreadable: 0,
  usageByModel: new Map<string, UsageTotals>(),
};

/** The usage folded so far for one model, zero before that model's first turn. */
function modelUsage({
  usageByModel,
  model,
}: {
  usageByModel: ReadonlyMap<string, UsageTotals>;
  model: string;
}): UsageTotals {
  const folded = usageByModel.get(model);
  if (folded === undefined) {
    return ZERO_USAGE;
  }
  return folded;
}

/**
 * Fold a chunk of newly appended transcript onto a cursor.
 *
 * Only COMPLETE lines are folded and the offset advances only past them, so a chunk that caught the writer
 * mid-line leaves the partial line for the next read instead of dropping it. Dropping it would be a silent
 * undercount, which is the failure this whole page exists to prevent.
 *
 * @param cursor where the fold had got to
 * @param chunk the bytes appended since, decoded as text
 * @returns the advanced cursor
 */
export function advanceCursor({ cursor, chunk }: { cursor: CostCursor; chunk: string }): CostCursor {
  const end = chunk.lastIndexOf("\n");
  if (end < 0) {
    return cursor;
  }
  const counted = new Set(cursor.counted);
  const models = new Set(cursor.models);
  const usageByModel = new Map(cursor.usageByModel);
  let totals = cursor.totals;
  let duplicates = cursor.duplicates;
  let unreadable = cursor.unreadable;
  for (const line of chunk.slice(0, end).split("\n")) {
    const read = readUsageLine({ line });
    if (read.kind === "unreadable") {
      unreadable += 1;
    } else if (read.kind === "usage" && counted.has(read.turn.messageId)) {
      duplicates += 1;
    } else if (read.kind === "usage") {
      counted.add(read.turn.messageId);
      models.add(read.turn.model);
      totals = addUsage({ totals, turn: read.turn });
      usageByModel.set(
        read.turn.model,
        addUsage({ totals: modelUsage({ model: read.turn.model, usageByModel }), turn: read.turn }),
      );
    }
  }
  return {
    counted,
    duplicates,
    models: [...models].filter((model) => model !== "").toSorted(),
    offsetBytes: cursor.offsetBytes + Buffer.byteLength(chunk.slice(0, end + 1), "utf8"),
    totals,
    unreadable,
    usageByModel,
  };
}

/** One model's share of a session's counted turns. */
export interface ModelUsageTotals {
  /** The model id exactly as the transcript reported it, e.g. `claude-opus-5`. */
  readonly model: string;
  readonly totals: UsageTotals;
}

/**
 * A cursor's per-model split, sorted by model id so two reports of the same session agree line for line.
 *
 * The unnamed model — a usage line that carried no `message.model` — is dropped here rather than bucketed
 * under the empty string, exactly as {@link CostCursor.models} drops it: a turn nobody can price is a
 * coverage fact for `sessions/modelWeight.ts` to report, not a row to render.
 *
 * @param cursor the fold to split
 * @returns one entry per named model
 */
export function modelUsageTotals({ cursor }: { cursor: CostCursor }): readonly ModelUsageTotals[] {
  return [...cursor.usageByModel.entries()]
    .filter(([model]) => model !== "")
    .map(([model, totals]) => ({ model, totals }))
    .toSorted((left, right) => left.model.localeCompare(right.model));
}

/** Groups digits so a nine-figure token count is readable at a glance. Fixed locale, so it never varies. */
const GROUPED = new Intl.NumberFormat("en-US");

/**
 * A token count with digit grouping, for the collapsed detail where the exact number is the point.
 *
 * @param count the token count
 * @returns the count with thousands separators
 */
export function groupedTokens({ count }: { count: number }): string {
  return GROUPED.format(count);
}

/**
 * A token count shortened for the one-line row, where the exact digits do not fit.
 *
 * @param count the token count
 * @returns `812`, `12.4k`, `3.15M` or `51.1B`
 */
export function compactTokens({ count }: { count: number }): string {
  const units: readonly { readonly at: number; readonly suffix: string }[] = [
    { at: 1e9, suffix: "B" },
    { at: 1e6, suffix: "M" },
    { at: 1e3, suffix: "k" },
  ];
  const unit = units.find((entry) => Math.abs(count) >= entry.at);
  if (unit === undefined) {
    return String(count);
  }
  const scaled = count / unit.at;
  return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(scaled >= 10 ? 1 : 2)}${unit.suffix}`;
}
