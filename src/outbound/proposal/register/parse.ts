/**
 * Encoding and decoding one register journal line. Pure: no filesystem, no clock.
 *
 * Mirrors `../../../handover/ledger.ts`'s `parseLedger`/`ledgerLine`/`byKind` shape: an unknown or malformed
 * line is reported as UNREADABLE rather than repaired or dropped silently, so a reader can tell "nothing
 * happened here" apart from "something happened that this build cannot decode".
 */
import { isRecord } from "../../../lib/parsers.js";
import { notionPageAddress, type ProposalAddress, parseProposalAddress } from "../address.js";
import {
  isRegisterDecisionOutcome,
  isRegisterFeedbackKind,
  isSettableRegisterStatus,
  type RegisterDecisionOutcome,
  type RegisterEvent,
  type RegisterSource,
} from "./events.js";

/** A journal read back: the events it decoded, plus the 1-indexed line numbers that could not be decoded. */
export interface ParsedRegisterJournal {
  readonly events: readonly RegisterEvent[];
  readonly unreadable: readonly number[];
}

/** A required string field, or `undefined` when it is missing or not a string. */
function text({ payload, key }: { payload: Readonly<Record<string, unknown>>; key: string }): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

/** An optional string field — present only when it is a non-empty string. */
function optionalText({
  payload,
  key,
}: {
  payload: Readonly<Record<string, unknown>>;
  key: string;
}): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Whether a string is one of the two register sources this build knows. */
function isRegisterSource(value: unknown): value is RegisterSource {
  return value === "publish" || value === "sync";
}

/** The fields `byKind`'s callees all read from. */
type EventPayload = Readonly<Record<string, unknown>>;

/**
 * The address a `created` or link line carries, choosing the wire version by which keys are present.
 *
 * A line with an `address` key is read strictly from it; carrying a legacy page key beside it is ambiguous,
 * and a malformed address is never rescued from legacy keys — both make the line unreadable. A line with no
 * `address` predates the provider-tagged shape, when every register row was a Notion page, so it needs the
 * legacy `pageId` AND `pageUrl` exactly as the old decoder did.
 */
function decodeAddress({ payload }: { payload: EventPayload }): ProposalAddress | undefined {
  const pageId = text({ key: "pageId", payload });
  const pageUrl = text({ key: "pageUrl", payload });
  if (Object.hasOwn(payload, "address")) {
    if (Object.hasOwn(payload, "pageId") || Object.hasOwn(payload, "pageUrl")) {
      return undefined;
    }
    const address = parseProposalAddress({ raw: payload["address"] });
    return address.isOk() ? address.value : undefined;
  }
  if (pageId === undefined || pageUrl === undefined) {
    return undefined;
  }
  return notionPageAddress({ pageId, pageUrl });
}

/** Decode a `created` line, or `undefined` when a required field is missing or the wrong shape. */
function decodeCreated({ atIso, payload }: { atIso: string; payload: EventPayload }): RegisterEvent | undefined {
  const title = text({ key: "title", payload });
  const address = decodeAddress({ payload });
  const source = payload["source"];
  if (title === undefined || address === undefined || !isRegisterSource(source)) {
    return undefined;
  }
  return {
    address,
    atIso,
    intakeId: optionalText({ key: "intakeId", payload }),
    kind: "created",
    source,
    title,
  };
}

/** Decode a `destination-linked` line (or a legacy `page-linked` one), or `undefined` when a field is missing. */
function decodeDestinationLinked({
  atIso,
  payload,
}: {
  atIso: string;
  payload: EventPayload;
}): RegisterEvent | undefined {
  const title = text({ key: "title", payload });
  const address = decodeAddress({ payload });
  return title === undefined || address === undefined
    ? undefined
    : { address, atIso, kind: "destination-linked", title };
}

/** Decode a `status-changed` line, refusing a status this version does not accept from a generic status change. */
function decodeStatusChanged({ atIso, payload }: { atIso: string; payload: EventPayload }): RegisterEvent | undefined {
  const status = payload["status"];
  const why = text({ key: "why", payload });
  return typeof status !== "string" || !isSettableRegisterStatus(status) || why === undefined
    ? undefined
    : { atIso, kind: "status-changed", occurredIso: optionalText({ key: "occurredIso", payload }), status, why };
}

/**
 * A `decided` line's outcome, or `undefined` when the line carries one this build does not know.
 *
 * A line with NO `outcome` decodes as `approved`. That is not a lenient default — every `decided` event
 * written before the outcome field existed was recorded by `proposal decide`, which had no way to express a
 * rejection at all, so `approved` is what those lines meant rather than what this decoder hopes they meant.
 * An `outcome` that is present but not one of the two known values is refused like any other bad field.
 */
function decodeOutcome({ payload }: { payload: EventPayload }): RegisterDecisionOutcome | undefined {
  const rawOutcome = payload["outcome"];
  if (rawOutcome === undefined) {
    return "approved";
  }
  return typeof rawOutcome === "string" && isRegisterDecisionOutcome(rawOutcome) ? rawOutcome : undefined;
}

/** Decode a `decided` line, or `undefined` when a required field is missing or its outcome is unknown. */
function decodeDecided({ atIso, payload }: { atIso: string; payload: EventPayload }): RegisterEvent | undefined {
  const decision = text({ key: "decision", payload });
  const decider = text({ key: "decider", payload });
  const decidedIso = text({ key: "decidedIso", payload });
  const why = text({ key: "why", payload });
  const outcome = decodeOutcome({ payload });
  if (outcome === undefined) {
    return undefined;
  }
  return decision === undefined || decider === undefined || decidedIso === undefined || why === undefined
    ? undefined
    : { atIso, decidedIso, decider, decision, kind: "decided", outcome, why };
}

/** Decode a `superseded` line, or `undefined` when a required field is missing. */
function decodeSuperseded({ atIso, payload }: { atIso: string; payload: EventPayload }): RegisterEvent | undefined {
  const by = text({ key: "by", payload });
  const why = text({ key: "why", payload });
  return by === undefined || why === undefined
    ? undefined
    : { atIso, by, kind: "superseded", occurredIso: optionalText({ key: "occurredIso", payload }), why };
}

/** Decode a `slack-linked` line, or `undefined` when a required field is missing. */
function decodeSlackLinked({ atIso, payload }: { atIso: string; payload: EventPayload }): RegisterEvent | undefined {
  const permalink = text({ key: "permalink", payload });
  return permalink === undefined ? undefined : { atIso, kind: "slack-linked", permalink };
}

/** Decode a `follow-up-added` line, or `undefined` when a required field is missing. */
function decodeFollowUpAdded({ atIso, payload }: { atIso: string; payload: EventPayload }): RegisterEvent | undefined {
  const ref = text({ key: "ref", payload });
  return ref === undefined
    ? undefined
    : {
        atIso,
        kind: "follow-up-added",
        label: optionalText({ key: "label", payload }),
        occurredIso: optionalText({ key: "occurredIso", payload }),
        ref,
      };
}

/** Decode a `feedback-recorded` line, or `undefined` when a required field is missing or the kind is unknown. */
function decodeFeedbackRecorded({
  atIso,
  payload,
}: {
  atIso: string;
  payload: EventPayload;
}): RegisterEvent | undefined {
  const id = text({ key: "id", payload });
  const feedbackKind = payload["feedbackKind"];
  const who = text({ key: "who", payload });
  const what = text({ key: "what", payload });
  if (
    id === undefined ||
    who === undefined ||
    what === undefined ||
    typeof feedbackKind !== "string" ||
    !isRegisterFeedbackKind(feedbackKind)
  ) {
    return undefined;
  }
  return {
    atIso,
    feedbackKind,
    id,
    kind: "feedback-recorded",
    occurredIso: optionalText({ key: "occurredIso", payload }),
    what,
    where: optionalText({ key: "where", payload }),
    who,
  };
}

/** Decode a `feedback-answered` line, or `undefined` when a required field is missing. */
function decodeFeedbackAnswered({
  atIso,
  payload,
}: {
  atIso: string;
  payload: EventPayload;
}): RegisterEvent | undefined {
  const id = text({ key: "id", payload });
  const how = text({ key: "how", payload });
  return id === undefined || how === undefined ? undefined : { atIso, how, id, kind: "feedback-answered" };
}

/** Decode an `audience-set` line, or `undefined` when a required field is missing. */
function decodeAudienceSet({ atIso, payload }: { atIso: string; payload: EventPayload }): RegisterEvent | undefined {
  const audience = text({ key: "audience", payload });
  return audience === undefined ? undefined : { atIso, audience, kind: "audience-set" };
}

/** Build the event for one recognised kind, or `undefined` for a kind/shape this version does not know. */
function byKind({
  kind,
  atIso,
  payload,
}: {
  kind: string;
  atIso: string;
  payload: EventPayload;
}): RegisterEvent | undefined {
  switch (kind) {
    case "created":
      return decodeCreated({ atIso, payload });
    case "destination-linked":
    case "page-linked":
      return decodeDestinationLinked({ atIso, payload });
    case "status-changed":
      return decodeStatusChanged({ atIso, payload });
    case "decided":
      return decodeDecided({ atIso, payload });
    case "superseded":
      return decodeSuperseded({ atIso, payload });
    case "slack-linked":
      return decodeSlackLinked({ atIso, payload });
    case "follow-up-added":
      return decodeFollowUpAdded({ atIso, payload });
    case "audience-set":
      return decodeAudienceSet({ atIso, payload });
    case "feedback-recorded":
      return decodeFeedbackRecorded({ atIso, payload });
    case "feedback-answered":
      return decodeFeedbackAnswered({ atIso, payload });
    default:
      return undefined;
  }
}

/** Decode one journal line into an event, or `undefined` when it is not valid JSON or not a recognised event. */
function decodeEvent({ line }: { line: string }): RegisterEvent | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(payload) || typeof payload["kind"] !== "string" || typeof payload["atIso"] !== "string") {
    return undefined;
  }
  return byKind({ atIso: payload["atIso"], kind: payload["kind"], payload });
}

/**
 * Read a whole register journal.
 *
 * @param text the journal file's contents, one JSON object per line
 * @returns the events in order, plus the 1-indexed line numbers that could not be decoded
 */
export function parseRegisterJournal({ text: contents }: { text: string }): ParsedRegisterJournal {
  const events: RegisterEvent[] = [];
  const unreadable: number[] = [];
  contents.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    const event = decodeEvent({ line });
    if (event === undefined) {
      unreadable.push(index + 1);
      return;
    }
    events.push(event);
  });
  return { events, unreadable };
}

/**
 * Serialise one event as a journal line, newline included.
 *
 * @param event the event to record
 * @returns one JSON line, newline-terminated so appends cannot run together
 */
export function registerJournalLine({ event }: { event: RegisterEvent }): string {
  return `${JSON.stringify(event)}\n`;
}
