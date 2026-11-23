/**
 * What a turn file or receipt line must look like to be read as a {@link TurnRecord} — the narrowing every
 * read in `relayStore.ts` goes through, split from it along the read/write seam so the store stays one file a
 * reader can hold. A record written before a field existed reads as having carried none of it.
 */
import { ok, type Result } from "../lib/result.js";

import { storedAlsoAnswersOf } from "./cardKey.js";
import {
  DELIVERY_REFUSALS,
  type Delivery,
  type DeliveryKind,
  type DeliveryRefusal,
  type DeliveryVia,
} from "./deliveryOutcome.js";
import { type DiscussFirstRecord, discussFirstRecordOf } from "./discussFirst.js";
import type { TalkError } from "./errors.js";
import { type RelayOffer, relayOfferOf } from "./relayOffer.js";
import type { NoPictureReason, RelayPicture } from "./relayPicture.js";
import type { TurnRecord } from "./relayStore.js";
import {
  FEEDBACK_VERDICTS,
  isTriageFeedback,
  isTriageLabel,
  isTriageVerdict,
  type TriageRuling,
} from "./triageVocabulary.js";

/**
 * A text field a turn written before it existed lacks: the text, `""` when absent, `undefined` when it is there and
 * not text — a damaged record must not read as an older one that carried none.
 */
function textOrAbsent({ value }: { value: unknown }): string | undefined {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/**
 * The lead a turn stored for the courier's line. A turn written before the lead was stored has none, which is what a
 * relay with no lead writes too; one that is there and not text is damaged, `undefined`.
 */
function deliveryLeadOf({ value }: { value: unknown }): { lead: string | undefined } | undefined {
  if (value === undefined || typeof value === "string") {
    return { lead: value };
  }
  return undefined;
}

/**
 * The narrowing every read goes through — an unknown parse becomes a record or nothing.
 *
 * @param value a parsed turn file or receipt line
 * @returns the record, or `undefined` when the value is not one
 */
export function asTurnRecord({ value }: { value: unknown }): TurnRecord | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const row: Record<string, unknown> = { ...value };
  const { anchor, digest, registeredAtIso, slug, stagedAtIso, state, turnId, words } = row;
  const stringsPresent =
    typeof anchor === "string" &&
    typeof digest === "string" &&
    typeof slug === "string" &&
    typeof stagedAtIso === "string" &&
    typeof turnId === "string" &&
    typeof words === "string";
  const stateIsKnown = state === "intended" || state === "registering" || state === "registered";
  const stampIsUsable = registeredAtIso === null || typeof registeredAtIso === "string";
  if (!stringsPresent || !stateIsKnown || !stampIsUsable) {
    return undefined;
  }
  const offered = storedOfferOf({ value: row["offered"] });
  const triage = storedTriageRulingOf({ value: row["triageRuling"] });
  // A turn written before a relay carried the owner's words has neither field, and reads as having attached none —
  // which is exactly what it did. One that carries either as something other than text is damaged, never older.
  const heard = textOrAbsent({ value: row["heard"] });
  const about = textOrAbsent({ value: row["about"] });
  const deliveryLead = deliveryLeadOf({ value: row["deliveryLead"] });
  const discussFirst = storedDiscussFirstOf({ value: row["discussFirst"] });
  const also = storedAlsoAnswersOf({ value: row["alsoAnswers"] });
  const damaged = discussFirst.kind === "malformed" || triage.kind === "malformed" || also.kind === "malformed";
  if (offered.isErr() || damaged || heard === undefined || about === undefined || !deliveryLead) {
    return undefined;
  }
  return {
    about,
    ...(also.kind === "stored" ? { alsoAnswers: also.keys } : {}),
    anchor,
    delivery: deliveryOf({ value: row["delivery"] }),
    ...(deliveryLead.lead === undefined ? {} : { deliveryLead: deliveryLead.lead }),
    digest,
    ...(discussFirst.kind === "stored" ? { discussFirst: discussFirst.record } : {}),
    heard,
    ...storedCutFlagsOf({ row }),
    offered: offered.value,
    picture: pictureOf({ value: row["picture"] }),
    // Nor does one written before a relay carried reads or a picture: it read nothing it named, and it
    // carried no frame — said as its own reason, never as "screen not shared", which it never checked.
    readsAfter: storedReadsAfterOf({ value: row["readsAfter"] }),
    registeredAtIso,
    slug,
    stagedAtIso,
    state,
    ...(triage.kind === "stored" ? { triageRuling: triage.ruling } : {}),
    turnId,
    // Nor does one written before the console's composer typed steers: every one of those was spoken.
    typed: row["typed"] === true,
    words,
    // Nor does one written before a refused relay was retried with the owner's words alone: it never was.
    wordsAlone: row["wordsAlone"] === true,
  };
}

/**
 * Whether a stored relay kept only the tail of the words (`heardTruncated`) and whether those words ended before the
 * speaker did (`heardTailCut`). A record written before either was stored has no field, and that stays unknown —
 * absent, never `false`.
 */
function storedCutFlagsOf({
  row,
}: {
  row: Record<string, unknown>;
}): Pick<TurnRecord, "heardTailCut" | "heardTruncated"> {
  const truncated = row["heardTruncated"];
  const tailCut = row["heardTailCut"];
  return {
    ...(typeof truncated === "boolean" ? { heardTruncated: truncated } : {}),
    ...(typeof tailCut === "boolean" ? { heardTailCut: tailCut } : {}),
  };
}

/** The reads a stored relay named, keeping only the strings; a record written before reads existed named none. */
function storedReadsAfterOf({ value }: { value: unknown }): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((source): source is string => typeof source === "string");
}

/**
 * A stored triage ruling. A record written before rulings were stored has no field, and that stays UNKNOWN — the
 * row's prose may carry a verdict this read cannot see. `null` is a relay that said it carried none. A field that is
 * present and fails its checks makes the whole record unreadable, never a relay carrying no verdict (no silent
 * fallback): read as none, a "needs more info" would pass as a yes, and a repeated steer would drop the class it
 * counts. A ruling the verb could have written is a verdict, an optional label, and feedback only beside a verdict
 * that sends the card back.
 */
function storedTriageRulingOf({
  value,
}: {
  value: unknown;
}): { kind: "absent" } | { kind: "malformed" } | { kind: "stored"; ruling: TriageRuling | null } {
  if (value === undefined) {
    return { kind: "absent" };
  }
  if (value === null) {
    return { kind: "stored", ruling: null };
  }
  if (typeof value !== "object") {
    return { kind: "malformed" };
  }
  const row: Record<string, unknown> = { ...value };
  const { feedback, verdict, label } = row;
  if (!Object.keys(row).every((key) => TRIAGE_KEYS.has(key)) || !isTriageVerdict(verdict)) {
    return { kind: "malformed" };
  }
  if (label !== undefined && !isTriageLabel(label)) {
    return { kind: "malformed" };
  }
  if (feedback === undefined) {
    return { kind: "stored", ruling: { label, verdict } };
  }
  const sendsBack = FEEDBACK_VERDICTS.some((back) => back === verdict);
  if (!isTriageFeedback(feedback) || !sendsBack) {
    return { kind: "malformed" };
  }
  return { kind: "stored", ruling: { feedback, label, verdict } };
}

/** The keys a stored triage ruling may carry. */
const TRIAGE_KEYS: ReadonlySet<string> = new Set(["feedback", "label", "verdict"]);

/** The keys a stored discuss-first record may carry. */
const DISCUSS_FIRST_KEYS: ReadonlySet<string> = new Set(["priorTurnId", "repository", "status", "thread"]);

/**
 * A stored discuss-first record, held to exactly what `talk relay`'s flags admit. A record written before it was stored
 * has no field, and that stays unknown; `null` is a relay that named no team fix. One present and failing its checks
 * makes the whole record unreadable, never a relay that named none: read as none, a forged answer's prior turn would
 * pass as a question that was put.
 */
function storedDiscussFirstOf({
  value,
}: {
  value: unknown;
}): { kind: "absent" } | { kind: "malformed" } | { kind: "stored"; record: DiscussFirstRecord | null } {
  if (value === undefined) {
    return { kind: "absent" };
  }
  if (value === null) {
    return { kind: "stored", record: null };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { kind: "malformed" };
  }
  const row: Record<string, unknown> = { ...value };
  const { priorTurnId, repository, status, thread } = row;
  const allText = [priorTurnId, repository, status, thread].every(
    (field) => field === undefined || typeof field === "string",
  );
  if (!Object.keys(row).every((key) => DISCUSS_FIRST_KEYS.has(key)) || !allText || status === undefined) {
    return { kind: "malformed" };
  }
  const parsed = discussFirstRecordOf({
    priorTurn: textOf({ value: priorTurnId }),
    repository: textOf({ value: repository }),
    status: textOf({ value: status }),
    thread: textOf({ value: thread }),
  });
  if ("problems" in parsed || parsed.record === undefined) {
    return { kind: "malformed" };
  }
  return { kind: "stored", record: parsed.record };
}

/** A field already checked to be text or absent, as the text or `undefined`. */
function textOf({ value }: { value: unknown }): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

/**
 * Why a turn file's record is not the turn it is filed under, or `undefined` when it is. A file is opened by its
 * name, and a lister prints the record's own anchor, so a record naming another turn would put its words under an
 * anchor that reads a different file. The name is compared case-blind, as the sweep reads a capitalised
 * name the case-insensitive disk wrote; the anchor must be exactly the record's own `talk:<turnId>`.
 *
 * @param record the record the file holds
 * @param turnId the id the file was opened by
 * @returns the reason, or `undefined`
 */
export function turnFiledElsewhere({ record, turnId }: { record: TurnRecord; turnId: string }): string | undefined {
  if (record.turnId.toLowerCase() !== turnId.toLowerCase() || record.anchor !== `talk:${record.turnId}`) {
    return `turn file ${turnId}.json holds turn ${record.turnId} (${record.anchor}), not its own`;
  }
  return undefined;
}

/**
 * A stored copy-tray offer. One written before a relay carried an offer has none, which is what it carried. One that
 * HAS the field and fails its checks is an error, never read as offer-less: that would drop the text the owner's words were
 * about (no silent fallback), so the whole record is unreadable instead.
 */
function storedOfferOf({ value }: { value: unknown }): Result<RelayOffer | undefined, TalkError> {
  if (value === undefined) {
    return ok(undefined);
  }
  return relayOfferOf({ value });
}

/** Every reason a turn may carry no picture. */
const NO_PICTURE_REASONS: readonly NoPictureReason[] = [
  "screen-not-shared",
  "capture-failed",
  "screen-recording-off",
  "predates-pictures",
  "not-attached",
  "not-taken-this-turn",
];

/** A stored picture; a turn with none on record, or an unreadable one, reads as having carried none. */
function pictureOf({ value }: { value: unknown }): RelayPicture {
  if (typeof value !== "object" || value === null) {
    return { kind: "none", reason: "predates-pictures" };
  }
  const row: Record<string, unknown> = { ...value };
  const { path, bytes, sha256 } = row;
  if (
    row["kind"] === "attached" &&
    typeof path === "string" &&
    typeof bytes === "number" &&
    typeof sha256 === "string"
  ) {
    return { bytes, kind: "attached", path, sha256 };
  }
  const reason = NO_PICTURE_REASONS.find((known) => known === row["reason"]);
  if (row["kind"] === "none" && reason !== undefined) {
    return { kind: "none", reason };
  }
  return { kind: "none", reason: "predates-pictures" };
}

/** Every delivery kind a turn file may carry; a kind outside it reads as no delivery at all. */
const DELIVERY_KINDS: readonly DeliveryKind[] = [
  "typed",
  "queued",
  "stranded",
  "unconfirmed",
  "skipped",
  "failed",
  "attempting",
  "held",
];

/**
 * Which process typed a stored delivery: the stored one, `direct` for a turn written before the courier existed —
 * every delivery then was the relay's own — or `undefined` for a value that is neither, which is damage.
 */
function viaOf({ value }: { value: unknown }): DeliveryVia | undefined {
  if (value === undefined) {
    return "direct";
  }
  if (value === "direct" || value === "courier") {
    return value;
  }
  return undefined;
}

/**
 * Why a stored `failed`/`skipped` delivery typed nothing: the stored class, `unclassified` for a stored turn that
 * names none, or `undefined` for a value outside the closed set, which is damage.
 */
function refusalOf({ value }: { value: unknown }): DeliveryRefusal | undefined {
  if (value === undefined) {
    return "unclassified";
  }
  return DELIVERY_REFUSALS.find((known) => known === value);
}

/** A stored delivery, or `null` for none — a turn written before delivery existed has none, which is true. */
function deliveryOf({ value }: { value: unknown }): Delivery | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const row: Record<string, unknown> = { ...value };
  const { detail, atIso } = row;
  const kind = DELIVERY_KINDS.find((known) => known === row["kind"]);
  const via = viaOf({ value: row["via"] });
  if (kind === undefined || via === undefined || typeof detail !== "string" || typeof atIso !== "string") {
    return null;
  }
  if (kind === "failed" || kind === "skipped") {
    const refusal = refusalOf({ value: row["refusal"] });
    if (refusal === undefined) {
      return null;
    }
    return { atIso, detail, kind, refusal, via };
  }
  return { atIso, detail, kind, via };
}
