/**
 * Reading a `revised` register line (`./draftRevision.ts`) into what this version can vouch for. A closed shape: a
 * field this build does not know, or one the wrong shape, passes the line over and HIDES its row (`./draftLog.ts`
 * `foldSlackDraftLog`), so an older seat never draws revised words it cannot read as sendable. Whether the words bind
 * the row's own destination is the fold's check, since only the fold holds the row. Pure.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "../../lib/parsers.js";
import { carriesWords } from "./carriesWords.js";
import { candidateValid } from "./draftComparisonLine.js";
import { SLACK_DRAFT_SCHEMA_VERSION, type SlackDraftEvent } from "./draftRegister.js";
import {
  type DraftRevisedEvent,
  REVISION_HEARD_MAX_CHARS,
  REVISION_READING_MAX_CHARS,
  REVISION_READING_MAX_ITEMS,
} from "./draftRevision.js";
import type { ParkedDraftReceipts } from "./receiptsLine.js";

/** Every key a `revised` line carries. */
const REVISED_KEYS: ReadonlySet<string> = new Set([
  "anchor",
  "heard",
  "id",
  "kind",
  "reading",
  "restoredFrom",
  "schemaVersion",
  "tsIso",
  "version",
  "words",
]);

/**
 * A `revised` line into its event, or `undefined` when any field is the wrong shape.
 *
 * @param value the parsed line
 * @param id the row it names
 * @param tsIso when it was journalled
 * @returns the event, or `undefined`
 */
export function revisedEventOf({
  value,
  id,
  tsIso,
}: {
  value: Record<string, unknown>;
  id: string;
  tsIso: string;
}): SlackDraftEvent | undefined {
  const closed = Object.keys(value).every((key) => REVISED_KEYS.has(key));
  if (!closed || value["schemaVersion"] !== SLACK_DRAFT_SCHEMA_VERSION) {
    return undefined;
  }
  if (parseStrictIsoInstantMs({ text: tsIso }) === undefined) {
    return undefined;
  }
  const { anchor, heard, reading, restoredFrom, version } = value;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 2) {
    return undefined;
  }
  const words = wordsOf({ value: value["words"] });
  const restoreKnown =
    restoredFrom === undefined ||
    (typeof restoredFrom === "number" && Number.isInteger(restoredFrom) && restoredFrom >= 1 && restoredFrom < version);
  const heardValid = heard === undefined || wordy({ max: REVISION_HEARD_MAX_CHARS, text: heard });
  const anchorValid = anchor === undefined || wordy({ max: Number.POSITIVE_INFINITY, text: anchor });
  if (words === undefined || !restoreKnown || !heardValid || !anchorValid || !readingValid({ reading })) {
    return undefined;
  }
  const event: DraftRevisedEvent = {
    id,
    kind: "revised",
    tsIso,
    version,
    words,
    ...(typeof heard === "string" ? { heard } : {}),
    ...(Array.isArray(reading) ? { reading: reading.map(String) } : {}),
    ...(typeof anchor === "string" ? { anchor } : {}),
    ...(typeof restoredFrom === "number" ? { restoredFrom } : {}),
  };
  return event;
}

/** A revision's words, whole, or `undefined`: a candidate's fields, plus receipts the fold checks against the row. */
function wordsOf({ value }: { value: unknown }): DraftRevisedEvent["words"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { receipts, ...candidate } = value;
  if (!candidateValid(candidate)) {
    return undefined;
  }
  const { advisory, digest, form, mentions, payload } = candidate;
  if (receipts === undefined) {
    return { advisory, digest, form, mentions, payload };
  }
  // Their agreement with the message and files is the fold's `receiptsValid`, which knows the row's files.
  if (!receiptsShaped(receipts)) {
    return undefined;
  }
  return { advisory, digest, form, mentions, payload, receipts };
}

/**
 * Whether a value is one of the three receipts shapes a row parks with (`./receiptsLine.ts`), closed exactly as
 * `./draftReceipts.ts`'s `receiptsValid` closes them, so a key or a blank reason the fold would refuse hides the row
 * here rather than being ignored there.
 */
function receiptsShaped(value: unknown): value is ParkedDraftReceipts {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).toSorted().join(",");
  if (value["kind"] === "self-evident") {
    return keys === "kind,why" && filled({ value: value["why"] });
  }
  if (value["kind"] === "tried") {
    return keys === "kind,tried" && filled({ value: value["tried"] });
  }
  const { links, media, tried } = value;
  return (
    value["kind"] === "attached" &&
    (keys === "kind,links,media" || keys === "kind,links,media,tried") &&
    Array.isArray(links) &&
    links.every((link: unknown) => typeof link === "string") &&
    typeof media === "number" &&
    (tried === undefined || filled({ value: tried }))
  );
}

/** A string that is not blank — `receiptsValid`'s own test of a reason, so the two never disagree. */
function filled({ value }: { value: unknown }): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** Whether the voice's reading is absent, or one to {@link REVISION_READING_MAX_ITEMS} short lines with words. */
function readingValid({ reading }: { reading: unknown }): boolean {
  if (reading === undefined) {
    return true;
  }
  return (
    Array.isArray(reading) &&
    reading.length >= 1 &&
    reading.length <= REVISION_READING_MAX_ITEMS &&
    reading.every((line) => wordy({ max: REVISION_READING_MAX_CHARS, text: line }))
  );
}

/** Whether a value is a string carrying a visible character, no longer than `max`. */
function wordy({ max, text }: { max: number; text: unknown }): boolean {
  return typeof text === "string" && carriesWords({ text }) && text.length <= max;
}
