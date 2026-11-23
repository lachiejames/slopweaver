/**
 * Reading the as-me draft register's LINES: which ones are events this version can vouch for, and which it passes
 * over by name.
 *
 * Split from `./draftRegister.ts`, which owns the row shape, its digest and the fold, so the question "what does
 * this line say" has one home; whether a park is whole is `./draftParkedLine.ts`. Everything here is pure; the file
 * edge is `../../admit/slackDraftStore.ts`.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "../../lib/parsers.js";
import { parseRelayAnchor } from "../../talk/relayDraft.js";
import { carriesWords } from "./carriesWords.js";
import { comparisonEventOf } from "./draftComparisonLine.js";
import { foldSlackDrafts } from "./draftFold.js";
import { approvalValid, isOptionalString, isParkedDraft } from "./draftParkedLine.js";
import {
  DRAFT_HOLD_REASONS,
  DRAFT_STEER_HEARD_MAX_CHARS,
  type ParkedSlackDraft,
  type SlackDraftChannel,
  type SlackDraftEvent,
  type SlackDraftItem,
} from "./draftRegister.js";
import { revisedEventOf } from "./draftRevisionLine.js";

/** A `released` line into its event, or `undefined` when a field is the wrong shape. */
function releasedEventOf({
  value,
  id,
  tsIso,
}: {
  value: Record<string, unknown>;
  id: string;
  tsIso: string;
}): SlackDraftEvent | undefined {
  const { channel, digest, ts, threadTs, permalink, threadMovedClearedTs: cleared, thanksInstead } = value;
  if (typeof channel !== "string" || typeof ts !== "string" || !isOptionalString(digest)) {
    return undefined;
  }
  if (!isOptionalString(threadTs) || !isOptionalString(permalink) || !isOptionalString(thanksInstead)) {
    return undefined;
  }
  const clearedValid =
    cleared === undefined || (Array.isArray(cleared) && cleared.every((entry) => typeof entry === "string"));
  if (!clearedValid) {
    return undefined;
  }
  return {
    channel,
    id,
    kind: "released",
    ts,
    tsIso,
    ...(threadTs === undefined ? {} : { threadTs }),
    ...(permalink === undefined ? {} : { permalink }),
    ...(digest === undefined ? {} : { digest }),
    ...(cleared === undefined ? {} : { threadMovedClearedTs: cleared.map(String) }),
    ...(thanksInstead === undefined ? {} : { thanksInstead }),
  };
}

/**
 * A `parked` line into its event. A park carrying an approval or a declared change of meaning is a judgement too, and
 * the gate dates it by the line's instant, so one whose instant does not parse does not read; a bare park reads as
 * every older line did.
 */
function parkedEventOf({
  draft,
  id,
  tsIso,
  value,
}: {
  draft: ParkedSlackDraft;
  id: string;
  tsIso: string;
  value: Record<string, unknown>;
}): SlackDraftEvent | undefined {
  const judged = draft.approval !== undefined || draft.meaningChanged !== undefined;
  const undated =
    parseStrictIsoInstantMs({ text: tsIso }) === undefined ||
    parseStrictIsoInstantMs({ text: draft.tsIso }) === undefined;
  if (judged && undated) {
    return undefined;
  }
  return { draft, id, kind: "parked", tsIso, ...(judged ? landingsCounted({ value }) : {}) };
}

/**
 * A `deleted` line into its event. Its instant must parse strictly, as `slack delete` stamps it: a reader dating every
 * event (`talk slack-send-outcome`) would otherwise call the whole register undated over one hand-written line, so the
 * line is passed over instead, naming its row.
 */
function deletedEventOf({
  id,
  tsIso,
  value,
}: {
  id: string;
  tsIso: string;
  value: Record<string, unknown>;
}): SlackDraftEvent | undefined {
  const { channel, ts } = value;
  if (typeof channel !== "string" || typeof ts !== "string" || parseStrictIsoInstantMs({ text: tsIso }) === undefined) {
    return undefined;
  }
  return { channel, id, kind: "deleted", ts, tsIso };
}

/** Read one line into an event, or answer `undefined` so the caller can name the line number. */
function eventOf({ value }: { value: unknown }): SlackDraftEvent | undefined {
  if (!isRecord(value) || typeof value["id"] !== "string" || typeof value["tsIso"] !== "string") {
    return undefined;
  }
  const id = value["id"];
  const tsIso = value["tsIso"];
  if (value["kind"] === "parked" && isParkedDraft(value["draft"])) {
    return parkedEventOf({ draft: value["draft"], id, tsIso, value });
  }
  if (value["kind"] === "released") {
    return releasedEventOf({ id, tsIso, value });
  }
  if (value["kind"] === "deleted") {
    return deletedEventOf({ id, tsIso, value });
  }
  if (value["kind"] === "dropped" && typeof value["note"] === "string") {
    return { id, kind: "dropped", note: value["note"], tsIso, ...landingsCounted({ value }) };
  }
  if (value["kind"] === "compared" || value["kind"] === "picked") {
    return comparisonEventOf({ id, tsIso, value });
  }
  if (value["kind"] === "steered") {
    return steeredEventOf({ id, tsIso, value });
  }
  if (value["kind"] === "revised") {
    return revisedEventOf({ id, tsIso, value });
  }
  return judgementEventOf({ id, tsIso, value });
}

/**
 * A `steered` line into its event, or `undefined` when any field is the wrong shape — then the line is passed over
 * naming its row, so the fold hides that row and no release of it can go out unread (fail closed).
 */
function steeredEventOf({
  id,
  tsIso,
  value,
}: {
  id: string;
  tsIso: string;
  value: Record<string, unknown>;
}): SlackDraftEvent | undefined {
  const { anchor, channels, from, heard } = value;
  if (!namedText(id) || parseStrictIsoInstantMs({ text: tsIso }) === undefined) {
    return undefined;
  }
  // Exactly the anchor a relay writes, `talk:<v4 turn id>` as `parseRelayAnchor` normalises it.
  if (typeof anchor !== "string" || parseRelayAnchor({ text: anchor }) !== anchor) {
    return undefined;
  }
  if (typeof heard !== "string" || !carriesWords({ text: heard }) || heard.length > DRAFT_STEER_HEARD_MAX_CHARS) {
    return undefined;
  }
  const named = steerChannelsOf({ channels });
  if (named === undefined || !isRecord(from)) {
    return undefined;
  }
  const fromId = from["id"];
  const fromName = from["name"];
  if (!namedText(fromId) || (fromName !== undefined && !namedText(fromName))) {
    return undefined;
  }
  return {
    anchor,
    channels: named,
    from: { id: fromId, ...(fromName === undefined ? {} : { name: fromName }) },
    heard,
    id,
    kind: "steered",
    tsIso,
  };
}

/** A steer's channel list, when it is one or more distinct, fully named channels. */
function steerChannelsOf({ channels }: { channels: unknown }): readonly SlackDraftChannel[] | undefined {
  if (!Array.isArray(channels) || channels.length === 0) {
    return undefined;
  }
  const read: SlackDraftChannel[] = [];
  for (const entry of channels) {
    if (!isRecord(entry)) {
      return undefined;
    }
    const id = entry["id"];
    const name = entry["name"];
    if (!namedText(id) || !namedText(name) || read.some((channel) => channel.id === id)) {
      return undefined;
    }
    read.push({ id, name });
  }
  return read;
}

/** Whether a value is a string carrying at least one visible character. */
function namedText(text: unknown): text is string {
  // Visible characters, not just non-whitespace: a lone U+200B survives `trim()`.
  return typeof text === "string" && carriesWords({ text });
}

/** A line's `landingsRead`, when it is a non-negative whole count; a judgement or drop without one compares instants. */
function landingsCounted({ value }: { value: Record<string, unknown> }): { readonly landingsRead?: number } {
  const read = value["landingsRead"];
  return typeof read === "number" && Number.isInteger(read) && read >= 0 ? { landingsRead: read } : {};
}

/**
 * An `approved` or `held` line into its event, or `undefined` when it is neither or a field is the wrong shape. A hold
 * with a reason outside the closed set, or a blank why, does not read: the Queue card would draw a reason nobody gave.
 * Nor does either with an instant that does not parse, since the gate dates the row's judgement by it.
 */
function judgementEventOf({
  value,
  id,
  tsIso,
}: {
  value: Record<string, unknown>;
  id: string;
  tsIso: string;
}): SlackDraftEvent | undefined {
  const { approval, kind, reason, why } = value;
  if (parseStrictIsoInstantMs({ text: tsIso }) === undefined) {
    return undefined;
  }
  if (kind === "approved" && isRecord(approval) && approvalValid({ approval, meaningChanged: undefined })) {
    const { anchor, atIso, heard, inheritedFrom } = approval;
    if (
      typeof anchor === "string" &&
      typeof atIso === "string" &&
      typeof heard === "string" &&
      inheritedFrom === undefined
    ) {
      return { approval: { anchor, atIso, heard }, id, kind, tsIso, ...landingsCounted({ value }) };
    }
    return undefined;
  }
  const reasonKnown = DRAFT_HOLD_REASONS.find((known) => known === reason);
  if (kind === "held" && reasonKnown !== undefined && typeof why === "string" && carriesWords({ text: why })) {
    return { id, kind, reason: reasonKnown, tsIso, why, ...landingsCounted({ value }) };
  }
  return undefined;
}

/** One line this version could not read, named so a reader can say which row it touches. */
export interface SkippedSlackDraftLine {
  /** The 1-based line, so a reader can open the file at it. */
  readonly line: number;
  /** The row the line names, when it is a record carrying one; absent when nothing on the line can be trusted. */
  readonly id: string | undefined;
  /** The event kind the line declares, when it declares one. */
  readonly kind: string | undefined;
}

/** The register as this version reads it: every event it knows, and every line it passed over. */
export interface SlackDraftLog {
  readonly events: readonly SlackDraftEvent[];
  readonly skipped: readonly SkippedSlackDraftLine[];
}

/** What an unread line says about itself: the row and kind it names, when it is a record that names them. */
function skippedLineOf({ value, line }: { value: unknown; line: number }): SkippedSlackDraftLine {
  if (!isRecord(value)) {
    return { id: undefined, kind: undefined, line };
  }
  const { id, kind } = value;
  return { id: typeof id === "string" ? id : undefined, kind: typeof kind === "string" ? kind : undefined, line };
}

/** A top-level `"id":"sd-…"` key as the writer spells it; one inside a JSON string is escaped and never matches. */
const DRAFT_ID_KEY = /"id":"(sd-[\da-z-]+)"/g;

/**
 * What a line that is not JSON still says: the one draft id it carries, so a release cut off mid-write hides the
 * row it spent rather than leaving it drawn held. Two different ids, or none, name no draft.
 */
function brokenLineOf({ line, text }: { line: number; text: string }): SkippedSlackDraftLine {
  const ids = new Set(Array.from(text.matchAll(DRAFT_ID_KEY), (match) => match[1]!));
  const [id] = ids;
  if (ids.size !== 1 || id === undefined) {
    return { id: undefined, kind: undefined, line };
  }
  return { id, kind: undefined, line };
}

/**
 * Parse the register's lines into events, passing over every line this version cannot read.
 *
 * Never a refusal of the whole register: one thread-shaped draft another session parked
 * turned every queue card naming ANY draft into an error tile, so the drafts that could be read were hidden with
 * the one that could not. A passed-over line is counted and named, never silent, because a draft the owner cannot see is
 * one they cannot stop — and {@link foldSlackDraftLog} and the release are what keep a skip from making a spent
 * draft look sendable.
 *
 * @param lines the register's lines in file order, or none when it has never been written
 * @returns every event in file order, and every line passed over
 */
export function parseSlackDraftLog({ lines }: { lines: readonly string[] }): SlackDraftLog {
  const events: SlackDraftEvent[] = [];
  const skipped: SkippedSlackDraftLine[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped.push(brokenLineOf({ line: index + 1, text: line }));
      continue;
    }
    const event = eventOf({ value: parsed });
    if (event === undefined) {
      skipped.push(skippedLineOf({ line: index + 1, value: parsed }));
      continue;
    }
    events.push(event);
  }
  return { events, skipped };
}

/**
 * Fold a parsed register into its rows, leaving out every row a passed-over line names: that line may be the
 * release or drop that spent it, so this version cannot say whether it is still held, and a row drawn held is one
 * a reader would send.
 *
 * @param log the register as {@link parseSlackDraftLog} read it
 * @returns one item per parked draft this version can vouch for, newest first
 */
export function foldSlackDraftLog({ log }: { log: SlackDraftLog }): readonly SlackDraftItem[] {
  const unsure = new Set(log.skipped.map((line) => line.id));
  return foldSlackDrafts({ events: log.events }).filter((item) => !unsure.has(item.id));
}

/**
 * The passed-over lines that might touch one row: every line naming it, and every line naming no row at all,
 * which could be anything — so a release of that row cannot know it was not spent.
 *
 * @param log the register as {@link parseSlackDraftLog} read it
 * @param id the row about to be acted on
 * @returns the lines, in file order; empty when the row is certain
 */
export function skippedLinesTouching({
  log,
  id,
}: {
  log: SlackDraftLog;
  id: string;
}): readonly SkippedSlackDraftLine[] {
  return log.skipped.filter((line) => line.id === undefined || line.id === id);
}

/** One passed-over line as a reader reads it. */
function skippedLineLabel({ line }: { line: SkippedSlackDraftLine }): string {
  const at = `line ${String(line.line)}`;
  if (line.id === undefined) {
    return `${at} (names no draft)`;
  }
  if (line.kind === undefined) {
    return `${at} (${line.id})`;
  }
  return `${at} (${line.kind} ${line.id})`;
}

/**
 * What a reader is told about the lines a parse passed over — one sentence, or nothing when there were none.
 *
 * @param skipped the lines {@link parseSlackDraftLog} passed over
 * @returns the sentence, or `undefined` when nothing was skipped
 */
export function skippedDraftNote({ skipped }: { skipped: readonly SkippedSlackDraftLine[] }): string | undefined {
  if (skipped.length === 0) {
    return undefined;
  }
  const named = skipped.map((line) => skippedLineLabel({ line })).join(", ");
  const count = skipped.length === 1 ? "1 line" : `${String(skipped.length)} lines`;
  return `${count} of the as-me draft register this version cannot read passed over, with every draft they name: ${named}`;
}
