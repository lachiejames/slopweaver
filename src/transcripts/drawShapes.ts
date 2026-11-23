/**
 * The draw fold's shared vocabulary: the shapes its walk builds, and the pure classifiers that read a call's head,
 * a result's stale-seat preamble and a refusal's cap. `./draw.ts` carries where every number comes from.
 */

/** Characters per token for the estimate column — the conventional English-prose figure, checked by the fold. */
export const CHARS_PER_TOKEN = 4;

/** The first line of the stale-seat advisory, as `src/cli/staleSeat.ts`'s `staleSeatLines` renders it. */
const STALE_SEAT_HEAD = /^slopweaver \S+ \S+: this seat is \d+ commit\(s\) behind /u;

/**
 * A write refused by a SHAPE rule, in the phrasings this repository's verbs print: a count set against a word or
 * character cap (`src/supervisor/sweepPrompt.ts`, `src/handover/askShape.ts`, `src/cli/commands/hand/core.ts`),
 * Zod's own `.max()` message, or a fleet word a headline or card may not carry (`src/briefing/headlineSentences.ts`).
 *
 * Matched on the text, never on `is_error`: the chair pipes most verbs through `tail`, which exits 0, so a refused
 * write comes back as an ordinary result far more often than as an error.
 */
export const CAP_REFUSAL =
  /\b\d[\d,]* (?:words?|char(?:acter)?s?) against a (?:cap|budget) of \d|\bis \d+ characters and the cap is \d|at most \d+ character\(s\)|uses the fleet word "/u;

/** The `<noun> <group>` pairs whose verbs sit one level deeper, so `supervisor tick open` is not `supervisor tick`. */
const NESTED_GROUPS: ReadonlySet<string> = new Set(["supervisor tick"]);

/**
 * How a call is grouped in the report: `slopweaver <noun> <verb>`, another command's first word, or a tool name.
 *
 * @param tool the tool the call named
 * @param command a Bash call's shell, "" for every other tool
 * @returns the head the call is grouped under
 */
export function verbHeadOf({ tool, command }: { tool: string; command: string }): string {
  if (tool !== "Bash") {
    return tool;
  }
  const tokens = stripCommandPrefix({ command })
    .split(/\s+/u)
    .filter((token) => token !== "");
  const first = tokens[0];
  if (first === undefined) {
    return "Bash";
  }
  if (!first.endsWith("slopweaver")) {
    return first;
  }
  const words: string[] = [];
  for (const token of tokens.slice(1)) {
    const depth = NESTED_GROUPS.has(words.join(" ")) ? 3 : 2;
    if (words.length >= depth || !/^[a-z][a-z0-9-]*$/u.test(token)) {
      break;
    }
    words.push(token);
  }
  return ["slopweaver", ...words].join(" ");
}

/**
 * A command with its leading `cd <dir> &&` and `NAME=value` environment assignments taken off.
 *
 * @param command a Bash call's shell
 * @returns what the shell actually runs
 */
export function stripCommandPrefix({ command }: { command: string }): string {
  let rest = command.trim();
  for (;;) {
    const cd = /^cd\s+\S+\s*&&\s*/u.exec(rest);
    if (cd !== null) {
      rest = rest.slice(cd[0].length);
      continue;
    }
    const assignment = /^[A-Z_][A-Z0-9_]*=\S*\s+/u.exec(rest);
    if (assignment !== null) {
      rest = rest.slice(assignment[0].length);
      continue;
    }
    return rest;
  }
}

/**
 * How many characters of a result are the stale-seat advisory: its head line and the indented lines under it.
 *
 * @param text the result body
 * @returns the advisory's characters, newlines included, or 0 when the result carries none
 */
export function preambleCharsOf({ text }: { text: string }): number {
  const lines = text.split("\n");
  let chars = 0;
  let inside = false;
  for (const line of lines) {
    if (STALE_SEAT_HEAD.test(line)) {
      inside = true;
      chars += line.length + 1;
      continue;
    }
    if (inside && line.startsWith("  ")) {
      chars += line.length + 1;
      continue;
    }
    inside = false;
  }
  return chars;
}

/**
 * Which cap a refusal line names, so laps group by the rule that fired rather than by the verb that relayed it —
 * `tick close` relays both the shift-state budget and the fleet-word check.
 *
 * @param refusal the refusal's cap-naming line
 * @returns the cap's name
 */
export function capClassOf({ refusal }: { refusal: string }): string {
  if (/shift state is \d+ words against a budget/u.test(refusal)) {
    return "shift-state word budget";
  }
  if (refusal.includes("uses the fleet word")) {
    return "fleet word";
  }
  if (/words? against a cap of \d/u.test(refusal)) {
    return "fold word cap";
  }
  return "character cap";
}

/** One API call the main thread made, read off its assistant record(s). */
export interface ApiCall {
  readonly messageId: string;
  /** `input + cache_creation + cache_read` — the whole prompt this call read. */
  readonly promptTokens: number;
  outputTokens: number;
  /** The run of calls between two recorded `tick close`s it sits in — unique, where a tick label may recur. */
  readonly segment: number;
  /** The walk's segment while reading, its tick once the walk ends. */
  tick: number;
}

/** One tool call the main thread made, joined to its result once that arrives. */
export interface DrawCall {
  readonly toolUseId: string;
  readonly head: string;
  readonly tool: string;
  /** The characters of the call's input — what the model wrote to make it. */
  readonly inputChars: number;
  /** What the call was aimed at — a Bash command past its prefix, or a tool's file path — cut to 120 characters. */
  readonly inputLabel: string;
  /** The tick its recorded `tick close` named; 0 for a call after the last recorded close. */
  tick: number;
  /** The walk's segment — what a retry is paired within, so a recurring tick label never joins two segments. */
  readonly segment: number;
  /** The index of the API call that issued it. */
  readonly apiIndex: number;
  resultChars: number;
  preambleChars: number;
  isError: boolean;
  capRefusal: boolean;
  /** Whether a `PreToolUse` hook refused the call before it ran — a gate, never a cap on what was written. */
  hookRefused: boolean;
  /** The refusal's cap-naming line when {@link capRefusal}, else "". */
  refusalLine: string;
  answered: boolean;
  /** The index of the first API call that read this result, or -1 while unanswered. */
  readIndex: number;
  /** Measured tokens attributed to this result from its gap's prompt growth; 0 when the gap was unmeasurable. */
  measuredTokens: number;
  measured: boolean;
}

/** One cap refusal, and whether and how expensively it was retried. */
export interface DrawRetry {
  readonly head: string;
  readonly tick: number;
  /** The refusal's first line, so a reader can see which cap fired. */
  readonly refusal: string;
  readonly retried: boolean;
  /** Output tokens of the API calls that were the rewrite — see `./drawFinish.ts`'s `retriesOf`. */
  readonly lapOutputTokens: number;
  /** How many API calls the rewrite took, and the whole prompts they read — each one re-reads the context. */
  readonly lapApiCalls: number;
  readonly lapPromptTokens: number;
  /** The refused result's own measured tokens; once windowed, its verb's mean when its gap shrank. */
  readonly refusalTokens: number;
  /** Whether the refused result's gap could be measured — when not, `summariseDraw` gives it its verb's mean. */
  readonly refusalMeasured: boolean;
  /**
   * The refused result's tokens times every API call that read it before a compaction dropped it — over the whole
   * transcript here, and over the kept ticks only once `./draw.ts`'s `summariseDraw` has windowed it.
   */
  readonly refusalCarried: number;
  /** The index of the first API call that read the refusal, or -1 — what windowing {@link refusalCarried} reads. */
  readonly refusalReadIndex: number;
  /** How many calls the model made between the refusal and the retry — a `Write` of the shift file, say. */
  readonly callsBetween: number;
}

/**
 * The measured tokens one gap's attachments of one type added to the prompt.
 *
 * @internal
 */
export interface DrawAttachment {
  /** The attachment `type` — `hook_success`, `output_style`, `total_tokens_reminder`, … */
  readonly kind: string;
  tick: number;
  readonly tokens: number;
}

/** Everything one transcript's walk produced. */
export interface DrawReading {
  readonly calls: readonly DrawCall[];
  /** What each gap's attachments added, by type — the hook and harness share of the prompt's growth. */
  readonly attachments: readonly DrawAttachment[];
  readonly apiCalls: number;
  readonly outputTokens: number;
  /** Per API call, how many later calls in the same epoch read its prompt again — used for carried tokens. */
  readonly laterReads: readonly number[];
  /** Per API call, the tick it sits in — so carried tokens count only the reads inside the kept ticks. */
  readonly apiTicks: readonly number[];
  /** The tick of every API call that opened a new epoch — a compaction, or a prompt that shrank. */
  readonly compactionTicks: readonly number[];
  readonly retries: readonly DrawRetry[];
  /** Per segment: its tick label, its API calls, their output, and the prompt tokens they read in total. */
  readonly ticks: readonly {
    readonly segment: number;
    readonly tick: number;
    readonly apiCalls: number;
    readonly outputTokens: number;
    readonly promptTokens: number;
  }[];
}

/** The walk's mutable state, kept in one place so each line handler stays small. */
export interface DrawState {
  readonly apiCalls: ApiCall[];
  readonly byMessage: Map<string, ApiCall>;
  readonly calls: DrawCall[];
  readonly byToolUse: Map<string, DrawCall>;
  /** Index of the API call each epoch starts at — a compaction opens a new one. */
  readonly epochStarts: number[];
  /** The segment being walked; every row is stamped with it, and relabelled to its tick once the walk ends. */
  segment: number;
  /** Segment to the tick number its recorded `tick close` named. */
  readonly labels: Map<number, number>;
  /** Results since the last API call, waiting for the next one to measure them. */
  pending: DrawCall[];
  /** Attachment characters since the last API call, by attachment type. */
  pendingAttachments: Map<string, number>;
  readonly attachments: DrawAttachment[];
}

/**
 * How many API calls in the kept ticks read a result before a compaction dropped it: of the one that first read it
 * and every later call in its epoch, those whose tick is kept — so a per-tick figure never charges a read made in a
 * tick its divisor does not count.
 *
 * @param readIndex the API call that first read the result, or -1 for one no call read
 * @param reading the walk's per-API-call epoch reads and ticks
 * @param kept whether a tick is inside the window being reported
 * @returns the reads, 0 for a result no call read
 */
export function readsOf({
  readIndex,
  reading,
  kept,
}: {
  readIndex: number;
  reading: Pick<DrawReading, "apiTicks" | "laterReads">;
  kept: (window: { tick: number }) => boolean;
}): number {
  if (readIndex < 0 || readIndex >= reading.laterReads.length) {
    return 0;
  }
  const end = readIndex + reading.laterReads[readIndex]! + 1;
  let reads = 0;
  for (let index = readIndex; index < end; index += 1) {
    if (kept({ tick: reading.apiTicks[index]! })) {
      reads += 1;
    }
  }
  return reads;
}
