/**
 * One transcript line, read for the three things a compaction measurement asks of it.
 *
 * ## Why this is not `transcripts/record.ts`
 *
 * That module refuses any line whose `type` is not `user` or `assistant`, and a compaction announces itself
 * as `{"type":"system","subtype":"compact_boundary"}` — so the record every figure here rests on is
 * invisible to it, and widening its `TranscriptRole` union would ripple through `latency.ts`, `fold.ts`,
 * `peerTraffic.ts` and `supervisor/chainScan.ts`. This reader is narrow on purpose: a boundary, an
 * assistant turn, or neither.
 *
 * ## What a boundary actually carries, and why the old approximation can be retired
 *
 * Verified on a live record (`~/.claude/projects/…-291-29/a0000104-….jsonl`, Claude Code 2.1.278):
 *
 * ```json
 * {"type":"system","subtype":"compact_boundary","compactMetadata":{
 *   "trigger":"auto","preTokens":267547,"postTokens":14251,"cumulativeDroppedTokens":253296,
 *   "durationMs":133385,"preservedMessages":{"uuids":["…"],"allUuids":["…"]}}}
 * ```
 *
 * `preservedMessages.uuids` names exactly which records SURVIVED the summary. That turns "did compaction
 * throw away something the session still needed" from a guess — anything read before the boundary — into an
 * exact question: a later read whose only earlier read sat in a record NOT in that list is, precisely,
 * re-fetching what went away. {@link CompactionBoundary.preservedUuids} is what makes it askable.
 *
 * Note the first number: that boundary fired at 267,547 tokens against a 300,000-token window. Auto-compact
 * fires BELOW the configured window, which is why `./compactionWindow.ts` reports its simulated compaction
 * count as a floor rather than an estimate.
 *
 * ## One parse per line, and only on the lines that can matter
 *
 * `du -sh ~/.claude/projects` reported 4.1 GB over 2,817 files, so parsing every line is not
 * affordable. A line mentioning neither `"usage"` nor `"compact_boundary"` cannot be either kind, and costs
 * two substring searches instead of a parse — the same trick `sessions/sessionCost.ts` uses for the same reason.
 *
 * Pure: text in, typed values out. The file reading lives in `./compactionStore.ts`.
 */
import { isRecord } from "../lib/parsers.js";
import type { TurnUsage } from "./sessionCost.js";

/** A compaction, as its own record reports it. */
export interface CompactionBoundary {
  /** `auto` when the window fired it, `manual` when somebody typed `/compact`; "" when the record named none. */
  readonly trigger: string;
  /** Context size going in. Measured below the configured window — see this module's header. */
  readonly preTokens: number;
  /** Context size coming out: the summary the session carries forward. */
  readonly postTokens: number;
  /**
   * What THIS compaction dropped: `preTokens - postTokens`.
   *
   * Deliberately not the record's own `cumulativeDroppedTokens`, which is the session's RUNNING total across
   * every boundary it has had. Reading that field as a per-compaction figure reported a median drop of
   * 1.01M against a median `preTokens` of 267k — a number that cannot be true of one compaction, and the
   * first live run of `session compaction` is what surfaced it.
   */
  readonly droppedTokens: number;
  /** The session's running total across every boundary so far, as the record reports it. */
  readonly cumulativeDroppedTokens: number;
  /** How long the session spent summarising instead of working. The per-hour cost, straight off the record. */
  readonly durationMs: number;
  /** Every record uuid the summary kept. Empty when the record named none — never treated as "kept nothing". */
  readonly preservedUuids: readonly string[];
}

/** One tool call's subject, as a re-read is counted by. */
interface ReadTarget {
  /** The file path, or the `pattern|path` pair a search names. Compared verbatim across a boundary. */
  readonly target: string;
}

/** An assistant turn: what it was handed, what it cost, and what it went and read. */
export interface CompactionTurn {
  /**
   * The four counters and the model, in the shape `sessions/sessionCost.ts` already declares.
   *
   * Reused rather than restated so the per-model split this fold hands to `./modelWeight.ts` is built out
   * of the same record type every other spend figure on this machine is built out of.
   */
  readonly usage: TurnUsage;
  /** The record's own uuid, so a later read can be told apart from one a boundary preserved. */
  readonly uuid: string;
  /** Whether the line was a subagent's own turn, which is not the main thread's. */
  readonly sidechain: boolean;
  /** What the turn read, in order. */
  readonly targets: readonly ReadTarget[];
}

/**
 * Every token one turn was handed — fresh input plus both cache tiers.
 *
 * The same definition `./tokenDepth.ts` uses for a live session's depth, and the figure a candidate window
 * is compared against: what the model was handed, whatever tier served it.
 *
 * @param turn the turn to size
 * @returns the context the turn carried
 */
export function contextTokensOf({ turn }: { turn: CompactionTurn }): number {
  return turn.usage.inputTokens + turn.usage.cacheCreationTokens + turn.usage.cacheReadTokens;
}

/** What one line turned out to be. Four states, because "not one of ours" is not a fault. */
export type CompactionLine =
  | { readonly kind: "boundary"; readonly boundary: CompactionBoundary; readonly uuid: string }
  | { readonly kind: "turn"; readonly turn: CompactionTurn }
  | { readonly kind: "other" }
  | { readonly kind: "unreadable"; readonly why: string };

/** A line that can be neither kind costs two substring searches rather than a parse. */
function couldMatter({ line }: { line: string }): boolean {
  return line.includes('"usage"') || line.includes('"compact_boundary"');
}

/**
 * A finite number field, or the stated value when it is absent or the wrong type.
 *
 * Written as an `if` that returns rather than `?? 0`: the `no-silent-fallback` gate refuses the operator,
 * and the caller naming `whenAbsent` at the call site is the substitution said out loud.
 */
function numberOr({
  record,
  name,
  whenAbsent,
}: {
  record: Record<string, unknown>;
  name: string;
  whenAbsent: number;
}): number {
  const value = record[name];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return whenAbsent;
}

/** A string field, or "" when it is absent or the wrong type. */
function stringAt({ record, name }: { record: Record<string, unknown>; name: string }): string {
  const value = record[name];
  if (typeof value === "string") {
    return value;
  }
  return "";
}

/** An object field, or an empty record when it is absent or not an object. */
function objectAt({ record, name }: { record: Record<string, unknown>; name: string }): Record<string, unknown> {
  const value = record[name];
  if (isRecord(value)) {
    return value;
  }
  return {};
}

/** The uuids a compaction kept, ignoring any entry that is not a string. */
function preservedUuidsOf({ metadata }: { metadata: Record<string, unknown> }): readonly string[] {
  const preserved = objectAt({ name: "preservedMessages", record: metadata });
  const uuids = preserved["uuids"];
  if (!Array.isArray(uuids)) {
    return [];
  }
  return uuids.filter((entry: unknown): entry is string => typeof entry === "string");
}

/** The shell prefixes that name a file the way `Read` does. */
const SHELL_READ = /(?:^|[;&|]\s*)(?:cat|head|tail|sed)\s+(?:-[^\s]+\s+)*([^\s|;&<>]+)/;

/**
 * What one `tool_use` block went and read, or nothing when it read no nameable subject.
 *
 * A `Bash` call is matched lexically because its subject is inside a command string and nowhere else; the
 * pattern is deliberately narrow (the four readers that take a path first) so that a command it cannot
 * parse contributes nothing rather than a wrong target.
 */
function targetOf({ name, input }: { name: string; input: Record<string, unknown> }): string {
  if (name === "Read" || name === "Edit" || name === "Write" || name === "NotebookEdit") {
    return stringAt({ name: "file_path", record: input });
  }
  if (name === "Grep" || name === "Glob") {
    return `${stringAt({ name: "pattern", record: input })}|${stringAt({ name: "path", record: input })}`;
  }
  if (name !== "Bash") {
    return "";
  }
  const matched = SHELL_READ.exec(stringAt({ name: "command", record: input }));
  const captured = matched === null ? undefined : matched[1];
  if (captured === undefined) {
    return "";
  }
  return captured;
}

/**
 * Every nameable read subject on one assistant message, in order.
 *
 * The content array is walked here rather than through `transcripts/record.ts`'s `decodeContent`, which
 * reduces a `tool_use` block to its id, name, command and skill and drops the `input` object the file path
 * and the search pattern live in. Reaching for it would mean widening a shape four other folds narrow on,
 * to carry a field only this one reads.
 */
function targetsOf({ message }: { message: Record<string, unknown> }): readonly ReadTarget[] {
  const content = message["content"];
  if (!Array.isArray(content)) {
    return [];
  }
  const targets: ReadTarget[] = [];
  for (const block of content) {
    if (!isRecord(block) || block["type"] !== "tool_use") {
      continue;
    }
    const target = targetOf({
      input: objectAt({ name: "input", record: block }),
      name: stringAt({ name: "name", record: block }),
    });
    if (target !== "") {
      targets.push({ target });
    }
  }
  return targets;
}

/** The boundary arm, once the line is known to be one. */
function boundaryOf({ parsed }: { parsed: Record<string, unknown> }): CompactionLine {
  const metadata = objectAt({ name: "compactMetadata", record: parsed });
  const durationMs = numberOr({ name: "durationMs", record: metadata, whenAbsent: -1 });
  if (durationMs < 0) {
    // A zero median duration reads as free compaction, so a record that has lost the field is refused
    // rather than defaulted. Shape drift must be a count, never a comforting number.
    return { kind: "unreadable", why: "a compact_boundary record carries no durationMs" };
  }
  const preTokens = numberOr({ name: "preTokens", record: metadata, whenAbsent: 0 });
  const postTokens = numberOr({ name: "postTokens", record: metadata, whenAbsent: 0 });
  return {
    boundary: {
      cumulativeDroppedTokens: numberOr({ name: "cumulativeDroppedTokens", record: metadata, whenAbsent: 0 }),
      droppedTokens: preTokens - postTokens,
      durationMs,
      postTokens,
      preservedUuids: preservedUuidsOf({ metadata }),
      preTokens,
      trigger: stringAt({ name: "trigger", record: metadata }),
    },
    kind: "boundary",
    uuid: stringAt({ name: "uuid", record: parsed }),
  };
}

/** The turn arm, once the line is known to carry usage. */
function turnOf({
  parsed,
  message,
}: {
  parsed: Record<string, unknown>;
  message: Record<string, unknown>;
}): CompactionLine {
  const messageId = stringAt({ name: "id", record: message });
  if (messageId === "") {
    // Deduplication is BY this id (`sessions/sessionCost.ts` measured one line per CONTENT BLOCK, so a naive
    // fold doubles every figure). An id-less turn can be neither counted nor deduplicated.
    return {
      kind: "unreadable",
      why: "a usage line carries no message id, so it can be neither counted nor deduplicated",
    };
  }
  const usage = objectAt({ name: "usage", record: message });
  const outputTokens = numberOr({ name: "output_tokens", record: usage, whenAbsent: -1 });
  if (outputTokens < 0) {
    // `sessions/sessionCost.ts` requires this field for the same reason: a usage object without it is shape
    // drift, and folding it to zero would make spend fall while nothing had changed.
    return { kind: "unreadable", why: `the usage object for ${messageId} carries no output_tokens` };
  }
  return {
    kind: "turn",
    turn: {
      sidechain: parsed["isSidechain"] === true,
      targets: targetsOf({ message }),
      usage: {
        cacheCreationTokens: numberOr({ name: "cache_creation_input_tokens", record: usage, whenAbsent: 0 }),
        cacheReadTokens: numberOr({ name: "cache_read_input_tokens", record: usage, whenAbsent: 0 }),
        inputTokens: numberOr({ name: "input_tokens", record: usage, whenAbsent: 0 }),
        messageId,
        model: stringAt({ name: "model", record: message }),
        outputTokens,
      },
      uuid: stringAt({ name: "uuid", record: parsed }),
    },
  };
}

/**
 * Read one transcript line as a boundary, an assistant turn, or neither.
 *
 * @param line one line of the transcript, without its newline
 * @returns which of the two it is, or why it could not be read
 */
export function readCompactionLine({ line }: { line: string }): CompactionLine {
  if (!couldMatter({ line })) {
    return { kind: "other" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return { kind: "unreadable", why: "a line that could carry a boundary or usage is not readable JSON" };
  }
  if (!isRecord(parsed)) {
    return { kind: "unreadable", why: "a line that could carry a boundary or usage does not hold an object" };
  }
  if (stringAt({ name: "subtype", record: parsed }) === "compact_boundary") {
    return boundaryOf({ parsed });
  }
  const message = objectAt({ name: "message", record: parsed });
  if (!isRecord(message["usage"])) {
    return { kind: "other" };
  }
  return turnOf({ message, parsed });
}
