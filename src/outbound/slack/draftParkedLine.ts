/**
 * Whether a register line's `draft` is a {@link ParkedSlackDraft} this version can vouch for, field by field. Split
 * out of `./draftLog.ts`, which reads lines into events, along that seam: this answers only "is this park whole".
 * Pure.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "../../lib/parsers.js";
import { carriesWords } from "./carriesWords.js";
import { parkedComparisonValid } from "./draftComparisonLine.js";
import { receiptsValid } from "./draftReceipts.js";
import { PARKED_DRAFT_ACTS, type ParkedSlackDraft, type ParkedSlackDraftMedia, SLACK_TS } from "./draftRegister.js";

/** A lowercase-hex SHA-256, the only shape a stored attachment is named by. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Whether a parsed value is one well-formed {@link ParkedSlackDraftMedia}: a non-empty basename (no path
 * separator, never `.` or `..`), a lowercase-hex SHA-256, and a positive safe-integer byte count.
 *
 * @returns true only for an entry a release could fetch from the store by hash
 */
function isParkedDraftMedia(value: unknown): value is ParkedSlackDraftMedia {
  if (!isRecord(value)) {
    return false;
  }
  const { name, sha256, bytes } = value;
  return (
    typeof name === "string" &&
    name.trim() !== "" &&
    !/[/\\]/.test(name) &&
    name !== "." &&
    name !== ".." &&
    typeof sha256 === "string" &&
    SHA256_HEX.test(sha256) &&
    typeof bytes === "number" &&
    Number.isSafeInteger(bytes) &&
    bytes > 0
  );
}

/** Whether a row's `media` field is absent, or a list every entry of which is well-formed. */
function mediaFieldValid({ media }: { media: unknown }): boolean {
  return media === undefined || (Array.isArray(media) && media.every((entry) => isParkedDraftMedia(entry)));
}

/**
 * Whether a row's shape and thread agree: `top-level` with no `threadTs` and no parent, or `thread` with a
 * well-formed root. A thread row whose root is missing is exactly the row that would release top-level, so it
 * does not read.
 */
function placementValid({ parent, shape, threadTs }: { parent: unknown; shape: unknown; threadTs: unknown }): boolean {
  if (shape === "top-level") {
    return threadTs === undefined && parent === undefined;
  }
  return shape === "thread" && typeof threadTs === "string" && SLACK_TS.test(threadTs);
}

/** Whether a row's `threadParent` is absent, or a text with an optional string author. */
function threadParentValid({ parent }: { parent: unknown }): boolean {
  if (parent === undefined) {
    return true;
  }
  if (!isRecord(parent)) {
    return false;
  }
  const { text, userId, permalink } = parent;
  return (
    typeof text === "string" &&
    (userId === undefined || typeof userId === "string") &&
    (permalink === undefined || (typeof permalink === "string" && permalink.startsWith("https://")))
  );
}

/**
 * Whether a row's `readThrough` is absent, or a watermark `ts` with a list of seen messages each carrying a `ts` and
 * an optional edit stamp. A malformed one does not read: a release judging freshness against garbage would either
 * stop every send or none.
 */
function readThroughValid({ readThrough }: { readThrough: unknown }): boolean {
  if (readThrough === undefined) {
    return true;
  }
  if (
    !isRecord(readThrough) ||
    typeof readThrough["throughTs"] !== "string" ||
    !SLACK_TS.test(readThrough["throughTs"])
  ) {
    return false;
  }
  const seen = readThrough["seen"];
  return (
    Array.isArray(seen) &&
    seen.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry["ts"] === "string" &&
        SLACK_TS.test(entry["ts"]) &&
        isOptionalString(entry["editedTs"]),
    )
  );
}

/** Whether a parsed value is one kept message of an earlier exchange: a Slack `ts`, its text, an optional author. */
function priorMessageValid({ message }: { message: unknown }): boolean {
  return (
    isRecord(message) &&
    typeof message["ts"] === "string" &&
    SLACK_TS.test(message["ts"]) &&
    typeof message["text"] === "string" &&
    isOptionalString(message["userId"])
  );
}

/**
 * Whether a row's `priorAsk` is absent, `none`, or an earlier ask whose every field is the shape it declares. A
 * malformed one does not read: a card drawing a re-ask without its earlier exchange is the card the owner ruled out, and a
 * release could not re-read a prior it cannot name.
 */
function priorAskValid({ priorAsk }: { priorAsk: unknown }): boolean {
  if (priorAsk === undefined) {
    return true;
  }
  if (!isRecord(priorAsk)) {
    return false;
  }
  if (priorAsk["kind"] === "none") {
    return Object.keys(priorAsk).length === 1;
  }
  const { answerCount, answers, changed, notAnswered, ours, permalink, proof, readThroughTs } = priorAsk;
  return (
    priorAsk["kind"] === "prior" &&
    typeof permalink === "string" &&
    permalink.startsWith("https://") &&
    priorMessageValid({ message: ours }) &&
    Array.isArray(answers) &&
    answers.every((message) => priorMessageValid({ message })) &&
    typeof answerCount === "number" &&
    Number.isSafeInteger(answerCount) &&
    answerCount >= answers.length &&
    typeof readThroughTs === "string" &&
    SLACK_TS.test(readThroughTs) &&
    isOptionalString(changed) &&
    isOptionalString(notAnswered) &&
    mediaFieldValid({ media: proof })
  );
}

/**
 * Whether a row's identity fields are absent or hold a value this version knows. An unknown `actor` is a row this
 * reader cannot say whose name it posts under, so it does not read rather than being taken for the owner's; an unknown `act`
 * is a later vocabulary this build cannot badge, and does not read either rather than being drawn as a wrong one.
 * A `row` is a board slug and a `followupOf` a draft id, so anything but a non-empty string is a malformed line.
 */
function identityValid({ value }: { value: Record<string, unknown> }): boolean {
  const { actor, kind, botCannotPost, act, row, followupOf } = value;
  return (
    (actor === undefined || actor === "bot") &&
    (kind === undefined || kind === "finding" || kind === "message") &&
    (botCannotPost === undefined || botCannotPost === "not-in-channel") &&
    (act === undefined || PARKED_DRAFT_ACTS.some((known) => known === act)) &&
    (row === undefined || (typeof row === "string" && row !== "")) &&
    (followupOf === undefined || (typeof followupOf === "string" && followupOf !== ""))
  );
}

/**
 * Whether a parsed value carries every field a {@link ParkedSlackDraft} declares.
 *
 * @returns true only for a park every field of which this version can vouch for
 */
export function isParkedDraft(value: unknown): value is ParkedSlackDraft {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["id"] === "string" &&
    typeof value["tsIso"] === "string" &&
    typeof value["channel"] === "string" &&
    // Only a literal `true` is a group-DM stamp: any other value would exempt a row from the first-message bar
    // (`./firstMessageProof.ts`) on a guess, so it makes the line unreadable instead.
    (value["groupDm"] === undefined || value["groupDm"] === true) &&
    placementValid({ parent: value["threadParent"], shape: value["shape"], threadTs: value["threadTs"] }) &&
    threadParentValid({ parent: value["threadParent"] }) &&
    typeof value["form"] === "string" &&
    typeof value["digest"] === "string" &&
    typeof value["why"] === "string" &&
    isRecord(value["payload"]) &&
    Array.isArray(value["mentions"]) &&
    Array.isArray(value["advisory"]) &&
    mediaFieldValid({ media: value["media"] }) &&
    readThroughValid({ readThrough: value["readThrough"] }) &&
    priorAskValid({ priorAsk: value["priorAsk"] }) &&
    identityValid({ value }) &&
    parkedComparisonValid({ value }) &&
    recutsValid({ recuts: value["recuts"] }) &&
    approvalValid({ approval: value["approval"], meaningChanged: value["meaningChanged"] }) &&
    receiptsValid({
      media: mediaCount({ media: value["media"] }),
      payload: value["payload"],
      receipts: value["receipts"],
    })
  );
}

/** How many files a row carries: its media list's length, none when the row carries no list. */
function mediaCount({ media }: { media: unknown }): number {
  if (!Array.isArray(media)) {
    return 0;
  }
  return media.length;
}

/** Whether a row's re-cut list is absent or a list of row ids. */
function recutsValid({ recuts }: { recuts: unknown }): boolean {
  return (
    recuts === undefined ||
    (Array.isArray(recuts) && recuts.every((id: unknown) => typeof id === "string" && id !== ""))
  );
}

/**
 * Whether a row's approval is absent or whole, and never beside a declared change of meaning. A malformed one does not
 * read: a row drawn approved is one the next chair pass sends, so a guessed approval is the one wrong reading here.
 *
 * @param approval the line's `approval` field, unchecked
 * @param meaningChanged the line's `meaningChanged` field, unchecked — an approval beside one does not read
 * @returns true when the approval is absent or every field of it is well-formed
 */
export function approvalValid({ approval, meaningChanged }: { approval: unknown; meaningChanged: unknown }): boolean {
  if (meaningChanged !== undefined && (typeof meaningChanged !== "string" || !carriesWords({ text: meaningChanged }))) {
    return false;
  }
  if (approval === undefined) {
    return true;
  }
  if (!isRecord(approval) || meaningChanged !== undefined) {
    return false;
  }
  const { anchor, atIso, heard, inheritedFrom } = approval;
  return (
    typeof anchor === "string" &&
    carriesWords({ text: anchor }) &&
    typeof heard === "string" &&
    carriesWords({ text: heard }) &&
    typeof atIso === "string" &&
    parseStrictIsoInstantMs({ text: atIso }) !== undefined &&
    isOptionalString(inheritedFrom) &&
    carriedJudgementValid({ approval })
  );
}

/** The hold reasons that keep an approval, the only ones an inherited approval can carry across a re-cut. */
const APPROVAL_KEEPING_REASONS: ReadonlySet<unknown> = new Set(["thread-moved", "no-fleet-slot", "slack-refused"]);

/**
 * Whether an approval's carried judgement is absent or whole: a judgement instant that parses, a whole landing count,
 * and a hold that keeps an approval with a why carrying words. A guessed boundary would let a re-cut answer a landing
 * no session judged, and a guessed hold would clear a send the owner is owed.
 */
function carriedJudgementValid({ approval }: { approval: Record<string, unknown> }): boolean {
  const { hold, judgedIso, judgedLandings } = approval;
  const dated =
    judgedIso === undefined ||
    (typeof judgedIso === "string" && parseStrictIsoInstantMs({ text: judgedIso }) !== undefined);
  const counted =
    judgedLandings === undefined ||
    (typeof judgedLandings === "number" && Number.isInteger(judgedLandings) && judgedLandings >= 0);
  return dated && counted && (hold === undefined || carriedHoldValid({ hold }));
}

/** Whether a carried hold names a reason that keeps the approval, a why carrying words, and an instant that parses. */
function carriedHoldValid({ hold }: { hold: unknown }): boolean {
  if (!isRecord(hold)) {
    return false;
  }
  const { atIso, reason, why } = hold;
  return (
    APPROVAL_KEEPING_REASONS.has(reason) &&
    typeof why === "string" &&
    carriesWords({ text: why }) &&
    typeof atIso === "string" &&
    parseStrictIsoInstantMs({ text: atIso }) !== undefined
  );
}

/**
 * Whether a field is absent or a string.
 *
 * @returns true for `undefined` or any string
 */
export function isOptionalString(field: unknown): field is string | undefined {
  return field === undefined || typeof field === "string";
}
