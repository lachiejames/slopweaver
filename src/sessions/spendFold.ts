/**
 * One transcript folded into what the token pass needs from it: which kind of seat it was, its usage split by
 * UTC day and model, and how many of its tool calls a gate refused, by class.
 *
 * ## Why the seat kind is read off the transcript
 *
 * The owner's question was where the fleet's tokens go BY SEAT KIND, and no record outside the
 * transcript names one for every session: a subagent has no board row, a bot turn has no spawn record, and a
 * chair outlives the spawn that seated it. The transcript does carry the three facts that tell them apart —
 * its path (`<session>/subagents/` for a subagent), its working directory, and the first thing it was asked.
 * The match is a heuristic, so an unrecognised seat is `other` and the report prints that share: a classifier
 * that drifts shows up as a growing `other`, never as a quietly wrong split.
 *
 * ## The doubling defence
 *
 * Usage goes through `sessions/sessionCost.ts`'s {@link readUsageLine} and is counted once per `message.id`,
 * exactly as every other fold here does — one turn is written across several content-block lines.
 *
 * Pure: lines in, one record out. The file walk lives in `./spendStore.ts`.
 */
import { isRecord } from "#lib/parsers.js";
import { addUsage, readUsageLine, type UsageTotals, ZERO_USAGE } from "./sessionCost.js";

/** The kinds of seat the pass splits the fleet's draw across. */
export const SEAT_KINDS = [
  "handover-seat",
  "chair",
  "subagent",
  "bot",
  "fallback-reviewer",
  "recipe-seat",
  "other",
] as const;

/** One kind of seat. */
export type SeatKind = (typeof SEAT_KINDS)[number];

/** The classes of gate refusal the pass counts, each matched on the refusal's own wording. */
export const REFUSAL_CLASSES = [
  "python",
  "poll-gate",
  "shell-script",
  "raw-side-effect",
  "whole-tree",
  "other",
] as const;

/** One class of gate refusal. */
export type RefusalClass = (typeof REFUSAL_CLASSES)[number];

/**
 * One UTC day's usage on one model, inside one transcript.
 *
 * @internal — reachable through {@link TranscriptSpend}; nothing imports it by name.
 */
export interface DayModelUsage {
  /** `YYYY-MM-DD`, read off the turn's own ISO timestamp, so it is the UTC day. */
  readonly day: string;
  readonly model: string;
  readonly totals: UsageTotals;
}

/** What one transcript contributed to the pass. */
export interface TranscriptSpend {
  readonly path: string;
  /**
   * The working directory its first line recorded, empty when none did — the seat's worktree, which is how a cost
   * is joined back to the board row whose seat ran there (`../value/sample.ts`).
   */
  readonly cwd: string;
  readonly seat: SeatKind;
  readonly usage: readonly DayModelUsage[];
  readonly refusals: Readonly<Record<RefusalClass, number>>;
  /**
   * The smallest context any of its turns re-read, `null` with no turn: what it opened on. A forked subagent
   * inherits its parent's whole conversation here, so this is where one shows.
   */
  readonly contextFloor: number | null;
  /** Lines that mentioned usage and could not be read — spend missing from the totals, so it is counted. */
  readonly unreadable: number;
}

/**
 * Which kind of seat a transcript was.
 *
 * @param path the transcript's path — a subagent's sits under `<session>/subagents/`
 * @param cwd the working directory its first line recorded, empty when none did
 * @param firstPrompt the text of its first user message, empty when it had none
 * @param botHandles the install's own bot handles (`profile.json`'s `slackBot.selfHandles`): a seat whose
 *   working directory is named for one is the bot's
 * @returns the seat kind, `other` when nothing matched
 */
export function classifySeat({
  path,
  cwd,
  firstPrompt,
  botHandles,
}: {
  path: string;
  cwd: string;
  firstPrompt: string;
  botHandles: readonly string[];
}): SeatKind {
  if (path.includes("/subagents/")) {
    return "subagent";
  }
  if (cwd.includes("supervisor") || firstPrompt.includes("/slopweaver:supervisor")) {
    return "chair";
  }
  if (/review-fallback|plan-fallback/.test(firstPrompt)) {
    return "fallback-reviewer";
  }
  if (
    /loop-bot|turn dispatch|bot turn/.test(firstPrompt) ||
    // A live loop's seat, its successor's (`successor-to-live-…-bot-loop-…`) included, or a turn's.
    /(?:^|\/)(?:successor-to-)?live-(?:[\p{L}\p{N}_.]+-)*bot-loop(?![\p{L}\p{N}_])/iu.test(cwd) ||
    cwd.includes("/turn-") ||
    botHandles.some((handle) => handle !== "" && cwd.toLowerCase().includes(handle.toLowerCase()))
  ) {
    return "bot";
  }
  if (/handover (start|resume)/.test(firstPrompt)) {
    return "handover-seat";
  }
  // `recipe seat` and `scheduled ask` are the seat's wording before the rename, still in every older transcript
  // this folds.
  if (/(?:recipe|automation) seat|scheduled ask|automation\(s\) that need a session/.test(firstPrompt)) {
    return "recipe-seat";
  }
  return "other";
}

/** The refusal wording each class is matched on, first match wins. */
const REFUSAL_PATTERNS: readonly (readonly [RefusalClass, RegExp])[] = [
  ["poll-gate", /poll-gate: refused/],
  ["python", /runs a Python interpreter/],
  ["shell-script", /is a shell script rather than one command/],
  ["raw-side-effect", /blocks raw side effects/],
  ["whole-tree", /re-proves the whole tree|over the whole tree|walks the whole filesystem/],
];

/**
 * Which class of gate refusal a tool result is, or `undefined` when it is not one.
 *
 * A refusal is a PreToolUse hook error: the harness prefixes the hook's own text with `PreToolUse:<Tool> hook
 * error`, and every Slopweaver refusal carries either `blocked because` or the poll gate's own prefix.
 *
 * @param text the raw transcript line holding a tool result
 * @returns the class, or `undefined` for a tool result no gate refused
 */
export function refusalClassOf({ text }: { text: string }): RefusalClass | undefined {
  if (!/PreToolUse:\w+ hook error/.test(text)) {
    return undefined;
  }
  const matched = REFUSAL_PATTERNS.find(([, pattern]) => pattern.test(text));
  if (matched !== undefined) {
    return matched[0];
  }
  if (text.includes("blocked because")) {
    return "other";
  }
  return undefined;
}

/**
 * A refusal tally with every class at zero.
 *
 * @returns the tally
 */
export function zeroRefusals(): Record<RefusalClass, number> {
  return { other: 0, "poll-gate": 0, python: 0, "raw-side-effect": 0, "shell-script": 0, "whole-tree": 0 };
}

/** The `YYYY-MM-DD` a line's own `timestamp` field names, or `undefined` when it carries none. */
function dayOf({ line }: { line: string }): string | undefined {
  return /"timestamp":"(\d{4}-\d{2}-\d{2})T/.exec(line)?.[1];
}

/** The text of a user message's content — a plain string, or the first text block of an array. */
function promptText({ content }: { content: unknown }): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const block: unknown = content.find((entry: unknown) => isRecord(entry) && entry["type"] === "text");
  if (isRecord(block) && typeof block["text"] === "string") {
    return block["text"];
  }
  return "";
}

/** The mutable state one transcript's fold accumulates. */
export interface SpendFold {
  cwd: string;
  firstPrompt: string;
  readonly counted: Set<string>;
  readonly usage: Map<string, DayModelUsage>;
  readonly refusals: Record<RefusalClass, number>;
  floor: number | null;
  unreadable: number;
}

/**
 * A fold that has read nothing.
 *
 * @returns the empty fold
 */
export function emptySpendFold(): SpendFold {
  return {
    counted: new Set(),
    cwd: "",
    firstPrompt: "",
    floor: null,
    refusals: zeroRefusals(),
    unreadable: 0,
    usage: new Map(),
  };
}

/** Record the working directory and first prompt, which only the first few lines carry. */
function readOpening({ fold, line }: { fold: SpendFold; line: string }): void {
  if (fold.cwd !== "" && fold.firstPrompt !== "") {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return;
  }
  if (!isRecord(parsed)) {
    return;
  }
  if (fold.cwd === "" && typeof parsed["cwd"] === "string") {
    fold.cwd = parsed["cwd"];
  }
  const message = parsed["message"];
  if (fold.firstPrompt === "" && parsed["type"] === "user" && isRecord(message)) {
    fold.firstPrompt = promptText({ content: message["content"] });
  }
}

/**
 * Fold one transcript line.
 *
 * @param fold the fold in progress, mutated in place
 * @param line one line of the transcript, without its newline
 */
export function advanceSpendFold({ fold, line }: { fold: SpendFold; line: string }): void {
  readOpening({ fold, line });
  const read = readUsageLine({ line });
  if (read.kind === "unreadable") {
    fold.unreadable += 1;
    return;
  }
  if (read.kind === "other") {
    // Only an ERRORED tool result can be a refusal: a successful one that merely quotes a refusal — a grep
    // over transcripts, say — is output, not a refused call.
    const refusal =
      line.includes('"tool_result"') && line.includes('"is_error":true') ? refusalClassOf({ text: line }) : undefined;
    if (refusal !== undefined) {
      fold.refusals[refusal] += 1;
    }
    return;
  }
  if (fold.counted.has(read.turn.messageId)) {
    return;
  }
  fold.counted.add(read.turn.messageId);
  const context = read.turn.inputTokens + read.turn.cacheReadTokens + read.turn.cacheCreationTokens;
  if (fold.floor === null || context < fold.floor) {
    fold.floor = context;
  }
  const day = dayOf({ line });
  if (day === undefined) {
    fold.unreadable += 1;
    return;
  }
  const key = `${day}|${read.turn.model}`;
  const before = fold.usage.get(key);
  const totals = before === undefined ? ZERO_USAGE : before.totals;
  fold.usage.set(key, { day, model: read.turn.model, totals: addUsage({ totals, turn: read.turn }) });
}

/**
 * Close a fold into the record the report reads.
 *
 * @param fold the fold to close
 * @param path the transcript it read, which decides a subagent
 * @param botHandles the install's own bot handles, which mark a bot seat by its directory
 * @returns the transcript's contribution
 */
export function finishSpendFold({
  fold,
  path,
  botHandles,
}: {
  fold: SpendFold;
  path: string;
  botHandles: readonly string[];
}): TranscriptSpend {
  return {
    contextFloor: fold.floor,
    cwd: fold.cwd,
    path,
    refusals: { ...fold.refusals },
    seat: classifySeat({ botHandles, cwd: fold.cwd, firstPrompt: fold.firstPrompt, path }),
    unreadable: fold.unreadable,
    usage: [...fold.usage.values()].toSorted(
      (left, right) => left.day.localeCompare(right.day) || left.model.localeCompare(right.model),
    ),
  };
}

/**
 * Fold a whole transcript held as lines — the shape a test and a small fixture use. It declares no bot handles,
 * so a seat is the bot's only by its prompt or its loop or turn directory.
 *
 * @param lines the transcript's lines, in order
 * @param path the transcript's path
 * @returns the transcript's contribution
 */
export function foldTranscriptSpend({ lines, path }: { lines: Iterable<string>; path: string }): TranscriptSpend {
  const fold = emptySpendFold();
  for (const line of lines) {
    advanceSpendFold({ fold, line });
  }
  return finishSpendFold({ botHandles: [], fold, path });
}
