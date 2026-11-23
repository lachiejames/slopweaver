/**
 * What `slopweaver talk unread` prints, and which batch that is — pure. A batch is measured on the SAME text it prints
 * (`src/talk/unreadBatch.ts`), so what a mark records is never more than what was printed within every host's limit;
 * a line too large for any batch prints in parts (`src/talk/unreadParts.ts`). Within it, their stretches and the relays
 * held for the chair are headed by quiet batch — split where they went quiet two minutes — each due or holding
 * (`src/talk/quietBatches.ts`).
 */
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { type AnswerContext, printableAnswer } from "../../../talk/answerContext.js";
import type { HeldRelay } from "../../../talk/chairWake.js";
import { quietBatches } from "../../../talk/quietBatches.js";
import { batchOf, lineCount, UNREAD_BATCH_BYTES, UNREAD_BATCH_LINES } from "../../../talk/unreadBatch.js";
import { type LinePartPrint, nextPart } from "../../../talk/unreadParts.js";
import { selectUnreadWords, type UnreadRead, type UnreadSelection } from "../../../talk/unreadWords.js";
import type { UnreadArgs } from "./callArgs.js";
import { quarantineJson, quarantineLines } from "./unreadQuarantine.js";
import { printedAnswerLines, reportLines } from "./unreadReportLines.js";

/** Said when a batch stopped short: a mark records only what is printed above it. */
const MORE_LINE =
  "more of their speech remains past this batch — a mark records only what is above; mark it, then run talk unread again";

/**
 * The line naming the held relays a read could not head within what every host prints. A relay stays held until the
 * chair's batch pass takes it, and a mark never records one, so the next read heads them again.
 *
 * @param count how many are held and not headed
 * @returns the line, or none when every held relay is headed
 */
function notHeadedLines({ count }: { count: number }): readonly string[] {
  if (count === 0) {
    return [];
  }
  return [
    `talk unread: ${String(count)} more relay(s) held for the chair are not headed here, to keep this read within ` +
      "what every host prints — the board and `slopweaver talk log` name each, and a mark never records a relay",
  ];
}

/** One batch as this invocation sees it, and what it selects. */
export interface ResolvedRead {
  readonly read: UnreadRead;
  readonly selection: UnreadSelection;
  readonly more: boolean;
  /** The part printed, when the first line was too large for any batch — the batch then holds no whole line. */
  readonly part: LinePartPrint | undefined;
  /** What each unread stretch answered, keyed by its pointer, read once over everything unread (`src/talk/answerContextRead.ts`). */
  readonly answers: ReadonlyMap<string, AnswerContext>;
  /** The relays held for the chair's quiet batch (`src/talk/relayCourier.ts`), headed among the stretches — the oldest that fit. */
  readonly relays: readonly HeldRelay[];
  /** How many more are held than are headed: counted, never dropped silently. A mark records no relay, so none is lost. */
  readonly relaysNotHeaded: number;
}

/** Everything one invocation prints on stdout: what goes before the mark is written, and the line after it. */
export interface UnreadOutput {
  readonly before: readonly string[];
  readonly after: string | undefined;
}

/**
 * One stretch's or part's context as the `--json` report carries it, its voice turn the quote the text prints
 * ({@link printableAnswer}). Its verdict is the next relay's over everything unread, and `verdictOf` names it so as
 * the text does — past this read when this read does not print that relay line, so a part's verdict never reads as
 * its own — and is `null` for a verdict that does not apply.
 *
 * @param answers what each unread stretch answered, keyed by its pointer
 * @param pointer the stretch, or `undefined` for a part of a line that did not parse
 * @param relayPrinted whether this read prints the relay line the verdict came from
 * @returns the context and whose verdict it is, or `null` when none was read — a key kept, never dropped
 */
function answeredJson({
  answers,
  pointer,
  relayPrinted,
}: {
  answers: ReadonlyMap<string, AnswerContext>;
  pointer: string | undefined;
  relayPrinted: boolean;
}): (AnswerContext & { verdictOf: "next relay" | "next relay, past this read" | null }) | null {
  const context = pointer === undefined ? undefined : answers.get(pointer);
  if (context === undefined) {
    return null;
  }
  let verdictOf: "next relay" | "next relay, past this read" | null = null;
  if (context.triage.kind !== "not-applicable") {
    verdictOf = relayPrinted ? "next relay" : "next relay, past this read";
  }
  return { ...printableAnswer({ context }), verdictOf };
}

/**
 * What "since" means for one read.
 *
 * @param read the read, carrying the cursor as it stood and the first-read floor
 * @param cursor the reader's name
 * @param all whether `--all` lifted the first-read floor
 * @returns the phrase
 */
function scopePhrase({ read, cursor, all }: { read: UnreadRead; cursor: string; all: boolean }): string {
  if (read.cursor !== undefined) {
    return `since the ${cursor} cursor was last marked (${read.cursor.recordedAtIso})`;
  }
  if (all) {
    return `on every call — the ${cursor} cursor has never been marked`;
  }
  return `since ${read.bootstrapFloorIso!} — the ${cursor} cursor has never been marked, so a first read shows 24 hours`;
}

/**
 * The words a first read's floor left out, said rather than dropped.
 *
 * @param resolved the read, carrying the floor and the count it left out
 * @returns the phrase
 */
export function hiddenPhrase({ resolved }: { resolved: ResolvedRead }): string {
  return `${String(resolved.selection.beforeFloor)} earlier stretch(es) of their speech, before ${resolved.read.bootstrapFloorIso!}, were never printed`;
}

/**
 * A JSON field for a value that may be absent: `null` names the absence, where `undefined` would drop the key.
 *
 * @returns the value, or `null` when there is none
 */
function nullWhenAbsent({ value }: { value: string | undefined }): string | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * The lines that print one part of a line too large for a batch. Every part of their stretch carries what it answered,
 * since each part is its own invocation and a bare "yes" is unreadable without the question before it.
 *
 * @param answers what each unread stretch answered, keyed by its pointer
 * @param part the part
 * @param more whether anything remains past it
 * @returns the lines
 */
function partLines({
  answers,
  part,
  more,
}: {
  answers: ReadonlyMap<string, AnswerContext>;
  part: LinePartPrint;
  more: boolean;
}): readonly string[] {
  let named = "a line that did not parse";
  let answered: readonly string[] = [];
  if (part.pointer !== undefined) {
    named = part.pointer;
    answered = printedAnswerLines({ context: answers.get(part.pointer), relayPrinted: false });
  }
  const next =
    part.index < part.of
      ? `mark it, then run talk unread again for part ${String(part.index + 1)}`
      : "the last part; a mark moves past every line it prints";
  const newest =
    part.passes > 1
      ? ` — the newest snapshot of the stretch, standing for the ${String(part.passes)} unread lines it prints`
      : "";
  return [
    `talk unread: ${named} — call ${part.callId}, from byte ${String(part.byteOffset)}${newest} — is too large for ` +
      `one batch, so it prints in parts: part ${String(part.index)} of ${String(part.of)}, as stored, follows`,
    ...answered,
    part.text,
    ...(more && part.index === part.of ? [MORE_LINE] : [`part ${String(part.index)} of ${String(part.of)}: ${next}`]),
  ];
}

/**
 * The `--json` report of one batch and, if one is being written, its mark.
 *
 * @param args the invocation
 * @param resolved the batch
 * @param nowIso the instant a mark is recorded at
 * @param written where the mark is written, if one is
 * @returns the one line to print
 */
function jsonReport({
  args,
  resolved,
  nowIso,
  written,
}: {
  args: UnreadArgs;
  resolved: ResolvedRead;
  nowIso: string;
  written: string | undefined;
}): string {
  const { read, selection, part } = resolved;
  return safeJsonStringify({
    label: "talk unread report",
    value: {
      beforeFloor: selection.beforeFloor,
      bootstrapFloorIso: nullWhenAbsent({ value: read.bootstrapFloorIso }),
      cursor: args.cursor,
      cursorRecordedAtIso: read.cursor === undefined ? null : read.cursor.recordedAtIso,
      marked: written === undefined ? null : { atIso: nowIso, path: written },
      more: resolved.more,
      part:
        part === undefined
          ? null
          : {
              answered: answeredJson({ answers: resolved.answers, pointer: part.pointer, relayPrinted: false }),
              byteOffset: part.byteOffset,
              callId: part.callId,
              index: part.index,
              of: part.of,
              pointer: nullWhenAbsent({ value: part.pointer }),
              text: part.text,
            },
      foreign: selection.foreign,
      // Named field by field: a held relay carries every word of its turn, and only `quietBatches` quotes them, fitted.
      heldRelays: resolved.relays.map(({ heldAtIso, slug, turnId }) => ({ heldAtIso, slug, turnId })),
      heldRelaysNotHeaded: resolved.relaysNotHeaded,
      quarantined: quarantineJson({ read }),
      quietBatches: quietBatches({ nowIso, relays: resolved.relays, words: selection.words }),
      unparseable: selection.unparseable,
      words: selection.words.map((word) => ({
        ...word,
        answered: answeredJson({
          answers: resolved.answers,
          pointer: word.pointer,
          relayPrinted: word.nextRelay !== undefined,
        }),
      })),
    },
  });
}

/**
 * The line that closes a plain-text report: the mark it recorded, or the reminder to mark once there is anything.
 *
 * @param args the invocation
 * @param resolved the batch
 * @param nowIso the instant a mark is recorded at
 * @param written where the mark is written, if one is
 * @returns the line, or `undefined` for a read with nothing to say after the report
 */
function closingLine({
  args,
  resolved,
  nowIso,
  written,
}: {
  args: UnreadArgs;
  resolved: ResolvedRead;
  nowIso: string;
  written: string | undefined;
}): string | undefined {
  const { selection, part } = resolved;
  if (written === undefined) {
    const anything =
      part !== undefined || selection.words.length + selection.unparseable.length + selection.foreign.length > 0;
    return anything ? "Once each is ruled, registered or intake-marked: slopweaver talk unread --mark" : undefined;
  }
  const adopted = selection.beforeFloor > 0 ? `, and adopted as read: ${hiddenPhrase({ resolved })}` : "";
  const more = resolved.more ? " — more remains: run slopweaver talk unread again" : "";
  const what = part === undefined ? "everything above" : `part ${String(part.index)} of ${String(part.of)} above`;
  return `talk unread: marked ${what} as read by ${args.cursor} at ${nowIso}${adopted} (${written})${more}`;
}

/**
 * Everything one invocation prints on stdout for one batch, in either shape.
 *
 * @param args the invocation
 * @param resolved the batch
 * @param nowIso the instant a mark is recorded at
 * @param written where the mark is written, if `--mark` was asked
 * @returns the lines before the write and the one after it
 */
export function unreadOutput({
  args,
  resolved,
  nowIso,
  written,
}: {
  args: UnreadArgs;
  resolved: ResolvedRead;
  nowIso: string;
  written: string | undefined;
}): UnreadOutput {
  if (args.json) {
    return { after: undefined, before: [jsonReport({ args, nowIso, resolved, written })] };
  }
  const after = closingLine({ args, nowIso, resolved, written });
  const quarantinedLines = quarantineLines({ read: resolved.read });
  if (resolved.part !== undefined) {
    const part = partLines({ answers: resolved.answers, more: resolved.more, part: resolved.part });
    return { after, before: [...part, ...notHeadedLines({ count: resolved.relaysNotHeaded }), ...quarantinedLines] };
  }
  const scope = scopePhrase({ all: args.all, cursor: args.cursor, read: resolved.read });
  const report = reportLines({
    answers: resolved.answers,
    nowIso,
    relays: resolved.relays,
    scope,
    selection: resolved.selection,
  });
  const before = [...report, ...notHeadedLines({ count: resolved.relaysNotHeaded }), ...quarantinedLines];
  if (resolved.selection.beforeFloor > 0 && !args.mark) {
    before.push(`${hiddenPhrase({ resolved })} — \`slopweaver talk unread --all\` prints them`);
  }
  if (resolved.more) {
    before.push(MORE_LINE);
  }
  return { after, before };
}

/**
 * Whether an output fits every host the chair runs on: its UTF-8 bytes and its lines, each line with its newline.
 *
 * @param output what one invocation prints
 * @returns whether it is within {@link UNREAD_BATCH_BYTES} and {@link UNREAD_BATCH_LINES}
 */
export function fitsHost({ output }: { output: UnreadOutput }): boolean {
  const lines = output.after === undefined ? output.before : [...output.before, output.after];
  const printed = lines.map((line) => `${line}\n`).join("");
  const lineBreaks = printed.split("\n").length - 1;
  return Buffer.byteLength(printed, "utf8") <= UNREAD_BATCH_BYTES && lineBreaks <= UNREAD_BATCH_LINES;
}

/**
 * The held relays a batch could ever head, oldest first: each headed relay prints its slug at least once and at least
 * one byte in either shape, so once their slugs alone, or their count, pass {@link UNREAD_BATCH_BYTES} no longer prefix
 * fits. A bound, never an estimate — it keeps a runaway queue from being rendered whole, which as `--json` refuses past
 * 100 MiB (`src/lib/safeJson.ts`), and bounds how many counts {@link mostRelaysThatFit} renders.
 *
 * @param relays the relays held for the chair's quiet batch, oldest first
 * @returns the longest prefix not provably too large
 */
function relaysWithinReach({ relays }: { relays: readonly HeldRelay[] }): readonly HeldRelay[] {
  let slugBytes = 0;
  for (const [index, relay] of relays.entries()) {
    slugBytes += Buffer.byteLength(relay.slug, "utf8");
    if (slugBytes > UNREAD_BATCH_BYTES || index >= UNREAD_BATCH_BYTES) {
      return relays.slice(0, index);
    }
  }
  return relays;
}

/**
 * The most held relays, oldest first, a batch heads beside its speech. Every count is rendered and asked, never
 * bisected: one more relay can join two quiet batches and drop a head line, so the size does not grow with the count.
 *
 * @param count how many relays are held
 * @param fits whether the batch with the first `headed` relays, rendered as it would be printed, fits
 * @returns the greatest count that fits, zero when not even one does
 */
function mostRelaysThatFit({ count, fits }: { count: number; fits: (headed: number) => boolean }): number {
  let most = 0;
  for (let headed = 1; headed <= count; headed += 1) {
    if (fits(headed)) {
      most = headed;
    }
  }
  return most;
}

/** Which candidate batch `resolveBatch` is sizing: the lines it takes, how many relays it heads, whether more remains. */
interface CandidateShape {
  readonly candidate: UnreadRead;
  readonly headed: number;
  readonly more: boolean;
}

/** One whole candidate batch: the oldest `headed` relays headed, the rest counted, never dropped. */
function candidateBatch({
  answers,
  candidate,
  headed,
  more,
  relays,
}: CandidateShape & { answers: ReadonlyMap<string, AnswerContext>; relays: readonly HeldRelay[] }): ResolvedRead {
  return {
    answers,
    more,
    part: undefined,
    read: candidate,
    relays: relays.slice(0, headed),
    relaysNotHeaded: relays.length - headed,
    selection: selectUnreadWords({ read: candidate }),
  };
}

/**
 * The batch this invocation prints: the most whole lines whose output, rendered exactly as it will be printed with
 * every held relay, fits every host ({@link fitsHost}). When every relay beside even the first line outgrows a batch,
 * their speech is batched first — a mark records it, never a relay — and the oldest relays that fit beside it are
 * headed, the rest counted ({@link ResolvedRead.relaysNotHeaded}). When even the first line alone does not fit, the
 * batch is that line's next part.
 *
 * @param answers what each unread stretch answered, keyed by its pointer
 * @param args the invocation
 * @param read everything unread
 * @param relays the relays held for the chair's quiet batch
 * @param nowIso the instant a mark is recorded at
 * @param written where a mark is written, if `--mark` was asked
 * @returns the batch
 */
export function resolveBatch({
  answers,
  args,
  read,
  relays,
  nowIso,
  written,
}: {
  answers: ReadonlyMap<string, AnswerContext>;
  args: UnreadArgs;
  read: UnreadRead;
  relays: readonly HeldRelay[];
  nowIso: string;
  written: string | undefined;
}): ResolvedRead {
  const resolve = (shape: CandidateShape): ResolvedRead => candidateBatch({ ...shape, answers, relays });
  // Every candidate is sized as it prints either way, so what it prints never grows past what was sized: the text
  // more-remains notice makes `more` the longer print there, and the JSON's `"more":false` is a byte longer than `true`.
  const fits = ({ candidate, headed }: { candidate: UnreadRead; headed: number }): boolean =>
    [true, false].every((more) =>
      fitsHost({ output: unreadOutput({ args, nowIso, resolved: resolve({ candidate, headed, more }), written }) }),
    );
  const reach = relaysWithinReach({ relays }).length;
  const everyRelay = batchOf({ fits: (candidate) => fits({ candidate, headed: reach }), read });
  if (!everyRelay.oversized) {
    return resolve({ candidate: everyRelay.read, headed: reach, more: everyRelay.more });
  }
  const speech = reach === 0 ? everyRelay : batchOf({ fits: (candidate) => fits({ candidate, headed: 0 }), read });
  if (!speech.oversized) {
    const headed = mostRelaysThatFit({
      count: reach,
      fits: (taken) => fits({ candidate: speech.read, headed: taken }),
    });
    return resolve({ candidate: speech.read, headed, more: speech.more });
  }
  const part = nextPart({ read });
  if (part === undefined) {
    // An oversized read with no line at all is one whose frame alone outgrows a host: printed as it stands, never a
    // throw, and a mark of it is refused (`./unreadRun.ts`).
    return resolve({ candidate: speech.read, headed: 0, more: false });
  }
  // The part's call is the first with any line, so whatever its last part does not pass remains, here or in another.
  const more = part.index < part.of || lineCount({ read }) > part.passes;
  // A part is sized to its own slice, never to the relays, so it heads none and counts all: the next whole batch heads them.
  return { ...resolve({ candidate: speech.read, headed: 0, more }), part };
}
