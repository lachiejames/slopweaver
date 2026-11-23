/**
 * The postmortem card's FORM — the one JSON object a seat writes once a resolved incident looks worth the owner's time — and
 * the check that refuses the first field that does not describe a whole card.
 *
 * The owner needs a briefing beforehand so they know what people are talking about, then
 * one card asking whether to send the reply that gets them into the meeting. So the card opens a published BRIEFING
 * page (`proof`), carries two or three verbatim lines from the channel (the conversation), names the meeting and who
 * runs it, and asks about exactly one parked reply (`askDraft`). There is no screenshot, root cause or `adds`: this
 * card brings the owner to a conversation, it does not hand the room a finding.
 *
 * The note form's primitives are shared (`./form.ts`, `./formEvidence.ts`, `./findingFields.ts`) and every refusal
 * they make is re-homed here, so it names this form rather than the note's.
 *
 * Pure: parsed JSON in, a checked form or the refusal naming its field out.
 */
import { checkedCites } from "../hand/cites.js";
import { DETAIL_LINE_CAP } from "../hand/details.js";
import { checkedQuotes, type HandQuote } from "../hand/quotes.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import {
  type IncidentFormInvalidError,
  type IncidentPostmortemError,
  IncidentPostmortemErrors,
  type PostmortemFormInvalidError,
} from "./errors.js";
import { checkedLean, checkedMeaning } from "./findingFields.js";
import { checkedChannel, draftId } from "./form.js";
import { checkedProof } from "./formEvidence.js";
import { line } from "./formLine.js";
import { postmortemRowSlug } from "./postmortemRow.js";

/** The fewest verbatim lines the card carries — one line is an anecdote, not the room. */
const QUOTES_MIN = 2;

/** The most people the card names, and the most links it cites. */
const LIST_MAX = 8;

/**
 * incident.io's own reference, `INC-<n>` — required here, because the headline names the incident by it. Six digits
 * at most, so the reference is at most 10 characters: `./postmortem.ts`'s headline is sized against that.
 */
const REFERENCE = /^INC-(\d{1,6})$/u;

/** An incident's homepage, the page incident.io keeps for it. */
const HOMEPAGE = /^https:\/\/app\.incident\.io\/[A-Za-z0-9-]+\/incidents\/(\d+)$/u;

/** A Slack member id — what the parked reply must tag. */
const MEMBER_ID = /^[UW][A-Z0-9]{6,}$/u;

/**
 * An ISO-8601 instant in UTC, to the minute and at finest the millisecond — an unbounded fraction would let the
 * card's `Meeting:` detail line past the cap `buildHandStep` holds it to.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/u;

/** Every key the form may carry. */
const FORM_KEYS = new Set([
  "askDraft",
  "channel",
  "cites",
  "lean",
  "meaning",
  "meeting",
  "proof",
  "quotes",
  "row",
  "stakeholders",
  "stillReal",
]);

/** Who runs the postmortem — the person the parked reply tags. */
interface PostmortemFacilitator {
  readonly name: string;
  /** Their Slack member id, which the parked reply's mentions must carry. */
  readonly slackId: string;
}

/** The meeting the owner would join: scheduled at an instant, or not yet on anyone's calendar. */
export type PostmortemMeeting =
  | { readonly state: "scheduled"; readonly atIso: string; readonly runBy: PostmortemFacilitator }
  | { readonly state: "not-yet-scheduled"; readonly runBy: PostmortemFacilitator };

/** A whole postmortem card, as the seat composes it. */
export interface IncidentPostmortemForm {
  /** The slug of the briefing page published with `slopweaver page publish` — what the Open button lands on. */
  readonly proof: string;
  /** What the incident meant for people, the card's first words ("every card payment failed for five hours"). */
  readonly meaning: string;
  readonly quotes: readonly HandQuote[];
  readonly channel: { readonly id: string; readonly name: string; readonly reference: string };
  /** The board row the card waits on — exactly `postmortem-<channel id lowered>`. */
  readonly row: string;
  readonly meeting: PostmortemMeeting;
  /** The parked reply asking to be added to the postmortem, in the incident channel, tagging whoever runs it. */
  readonly askDraft: string;
  readonly stakeholders: readonly string[];
  /** The incident's own page first, then anything else the briefing rests on. */
  readonly cites: readonly string[];
  readonly lean: string;
  readonly stillReal: string;
}

/**
 * A shared check's refusal, re-homed so it names this form.
 *
 * @returns the postmortem form's refusal for the same field and reason
 */
function rehomed({ error }: { error: IncidentFormInvalidError }): PostmortemFormInvalidError {
  return IncidentPostmortemErrors.formInvalid({ field: error.field, why: error.why });
}

/** The refusal for one field. */
function invalid({ field, why }: { field: string; why: string }): Result<never, PostmortemFormInvalidError> {
  return err(IncidentPostmortemErrors.formInvalid({ field, why }));
}

/** The form's `channel`: the note's channel check, with incident.io's `INC-<n>` required. */
function checkedPostmortemChannel({
  value,
}: {
  value: unknown;
}): Result<IncidentPostmortemForm["channel"], PostmortemFormInvalidError> {
  const channel = checkedChannel({ value }).mapErr((error) => rehomed({ error }));
  if (channel.isErr()) {
    return err(channel.error);
  }
  const { reference } = channel.value;
  if (reference === undefined || !REFERENCE.test(reference)) {
    return invalid({
      field: "channel.reference",
      why: "is incident.io's own reference, INC-<n> — the headline names the incident by it",
    });
  }
  return ok({ ...channel.value, reference });
}

/** The form's `meeting.runBy`: a name and the Slack member id the reply tags. */
function checkedFacilitator({ value }: { value: unknown }): Result<PostmortemFacilitator, PostmortemFormInvalidError> {
  if (!isRecord(value) || Object.keys(value).length !== 2) {
    return invalid({ field: "meeting.runBy", why: "is { name, slackId } — who runs the postmortem" });
  }
  const slackId = value["slackId"];
  if (typeof slackId !== "string" || !MEMBER_ID.test(slackId)) {
    return invalid({
      field: "meeting.runBy.slackId",
      why: "is a Slack member id (U…) — the parked reply must tag this person",
    });
  }
  return line({ cap: 60, field: "meeting.runBy.name", value: value["name"] })
    .mapErr((error) => rehomed({ error }))
    .map((name) => ({ name, slackId }));
}

/** The form's `meeting`: scheduled at a UTC instant, or not yet scheduled — never a guessed time. */
function checkedMeeting({ value }: { value: unknown }): Result<PostmortemMeeting, PostmortemFormInvalidError> {
  if (!isRecord(value)) {
    return invalid({
      field: "meeting",
      why: 'is { state: "scheduled", atIso, runBy } or { state: "not-yet-scheduled", runBy }',
    });
  }
  const state = value["state"];
  if (state === "not-yet-scheduled") {
    if (Object.keys(value).length !== 2) {
      return invalid({ field: "meeting", why: "carries only state and runBy while it is not yet scheduled" });
    }
    return checkedFacilitator({ value: value["runBy"] }).map((runBy) => ({ runBy, state }));
  }
  if (state !== "scheduled") {
    return invalid({ field: "meeting.state", why: 'is "scheduled" or "not-yet-scheduled"' });
  }
  const atIso = value["atIso"];
  if (Object.keys(value).length !== 3 || typeof atIso !== "string" || !ISO_INSTANT.test(atIso)) {
    return invalid({
      field: "meeting.atIso",
      why: "is the scheduled instant in UTC, read off the invite or the channel",
    });
  }
  return checkedFacilitator({ value: value["runBy"] }).map((runBy) => ({ atIso, runBy, state }));
}

/** How the card's detail line naming who will be in the room opens — `./postmortem.ts`'s `postmortemDetails`. */
export const IN_THE_ROOM = "In the room: ";

/**
 * The form's `stakeholders`: one to eight names, which together fit the one detail line they share — eight names at
 * the per-name cap would make a line `buildHandStep` refuses.
 */
function checkedStakeholders({ value }: { value: unknown }): Result<readonly string[], PostmortemFormInvalidError> {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIST_MAX) {
    return invalid({
      field: "stakeholders",
      why: `is a list of 1 to ${String(LIST_MAX)} names — who will be in the room`,
    });
  }
  const names: string[] = [];
  for (const entry of value) {
    const named = line({ cap: 60, field: "stakeholders", value: entry });
    if (named.isErr()) {
      return err(rehomed({ error: named.error }));
    }
    names.push(named.value);
  }
  const room = `${IN_THE_ROOM}${names.join(", ")}`;
  if (room.length > DETAIL_LINE_CAP) {
    return invalid({
      field: "stakeholders",
      why: `make a ${String(room.length)}-character "${IN_THE_ROOM.trim()}" line and the card's cap is ${String(DETAIL_LINE_CAP)} — name fewer, or shorter`,
    });
  }
  return ok(names);
}

/**
 * The form's `cites`: one to eight https links, the incident's own incident.io page FIRST and naming the same number
 * as the reference — the incident leads, never a pull request.
 *
 * @returns the trimmed links, or the refusal naming `cites`
 */
function checkedPostmortemCites({
  value,
  reference,
}: {
  value: unknown;
  reference: string;
}): Result<readonly string[], PostmortemFormInvalidError> {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIST_MAX) {
    return invalid({
      field: "cites",
      why: `is a list of 1 to ${String(LIST_MAX)} https links, the incident's page first`,
    });
  }
  const cites: string[] = [];
  for (const entry of value) {
    const cite = typeof entry === "string" ? entry.trim() : "";
    if (!URL.canParse(cite) || new URL(cite).protocol !== "https:") {
      return invalid({ field: "cites", why: `carries ${JSON.stringify(entry)}, which is not an https link` });
    }
    cites.push(cite);
  }
  // The card's cites go to `buildHandStep` unchanged, so its own check runs here and a form it would refuse is refused
  // at the form (a 2,050-character link passed the shape test above).
  const asHand = checkedCites({ value: cites });
  if (asHand.isErr()) {
    return invalid({ field: "cites", why: asHand.error.message.replace(/^cites /u, "") });
  }
  const homepage = HOMEPAGE.exec(cites[0]!);
  if (homepage === null) {
    return invalid({
      field: "cites",
      why: `opens on "${cites[0]!}" — the incident's own incident.io page comes first, so the card leads with the incident`,
    });
  }
  if (`INC-${homepage[1]!}` !== reference) {
    return invalid({
      field: "cites",
      why: `opens on incident ${homepage[1]!}'s page and the card is about ${reference}`,
    });
  }
  return ok(cites);
}

/** The form's shape and its proof: one object of known keys, whose briefing it can open. */
function checkedHead({
  value,
}: {
  value: unknown;
}): Result<{ form: Record<string, unknown>; proof: string }, PostmortemFormInvalidError> {
  if (!isRecord(value)) {
    return invalid({ field: "form", why: "is one JSON object" });
  }
  const stray = Object.keys(value).find((key) => !FORM_KEYS.has(key));
  if (stray !== undefined) {
    return invalid({ field: "form", why: `carries an unknown key "${stray}"` });
  }
  return checkedProof({ value: Object.hasOwn(value, "proof") ? value["proof"] : undefined })
    .mapErr(() =>
      IncidentPostmortemErrors.formInvalid({
        field: "proof",
        why: "is the slug of the briefing page published with `slopweaver page publish <slug> --page <file> --review <id>` — the card opens it first",
      }),
    )
    .map((proof) => ({ form: value, proof }));
}

/** The form's quotes: two or three verbatim lines from the channel. */
function checkedConversation({ value }: { value: unknown }): Result<readonly HandQuote[], PostmortemFormInvalidError> {
  const quotes = checkedQuotes({ value });
  if (quotes.isErr()) {
    return invalid({ field: "quotes", why: quotes.error.message.replace(/^quotes /u, "") });
  }
  const count = quotes.value === undefined ? 0 : quotes.value.length;
  if (quotes.value === undefined || count < QUOTES_MIN) {
    return invalid({
      field: "quotes",
      why: `carries ${String(count)} and the card needs ${String(QUOTES_MIN)} to 3 verbatim lines from the channel`,
    });
  }
  return ok(quotes.value);
}

/** The row the card waits on: exactly the postmortem row for this channel. */
function checkedRow({
  value,
  channelId,
}: {
  value: unknown;
  channelId: string;
}): Result<string, PostmortemFormInvalidError> {
  const expected = postmortemRowSlug({ channelId });
  if (value !== expected) {
    return invalid({
      field: "row",
      why: `is ${expected}, the postmortem row for channel ${channelId} — register it with \`slopweaver handover register\` as \`slopweaver incident postmortems\` prints`,
    });
  }
  return ok(expected);
}

/** The closing one-liners: the lean, the re-check, the meaning. */
function checkedClosing({
  form,
}: {
  form: Record<string, unknown>;
}): Result<Pick<IncidentPostmortemForm, "lean" | "meaning" | "stillReal">, PostmortemFormInvalidError> {
  return checkedLean({ value: form["lean"] })
    .andThen((lean) =>
      line({ cap: 200, field: "stillReal", value: form["stillReal"] }).andThen((stillReal) =>
        checkedMeaning({ value: form["meaning"] }).map((meaning) => ({ lean, meaning, stillReal })),
      ),
    )
    .mapErr((error) => rehomed({ error }));
}

/**
 * Check a whole postmortem card form, refusing the first field that does not describe a whole card.
 *
 * @param value the parsed JSON the seat wrote
 * @returns the form, or the refusal naming its field
 */
export function checkedPostmortemForm({
  value,
}: {
  value: unknown;
}): Result<IncidentPostmortemForm, IncidentPostmortemError> {
  const head = checkedHead({ value });
  if (head.isErr()) {
    return err(head.error);
  }
  const { form, proof } = head.value;
  return checkedConversation({ value: form["quotes"] }).andThen((quotes) =>
    checkedPostmortemChannel({ value: form["channel"] }).andThen((channel) =>
      checkedRow({ channelId: channel.id, value: form["row"] }).andThen((row) =>
        checkedMeeting({ value: form["meeting"] }).andThen((meeting) =>
          draftId({ field: "askDraft", value: form["askDraft"] })
            .mapErr((error) => rehomed({ error }))
            .andThen((askDraft) =>
              checkedStakeholders({ value: form["stakeholders"] }).andThen((stakeholders) =>
                checkedPostmortemCites({ reference: channel.reference, value: form["cites"] }).andThen((cites) =>
                  checkedClosing({ form }).map((closing): IncidentPostmortemForm => ({
                    ...closing,
                    askDraft,
                    channel,
                    cites,
                    meeting,
                    proof,
                    quotes,
                    row,
                    stakeholders,
                  })),
                ),
              ),
            ),
        ),
      ),
    ),
  );
}
