/**
 * The PURE projection of one Fathom meeting into a bronze {@link CorpusRecord}.
 *
 * ## The raw words, and ONLY the raw words
 *
 * Fathom returns two things about a call: a `default_summary` it wrote, and a `transcript` of what was
 * actually said. The rule: a transcript summary produced by other software has no value to the owner, so the
 * summary is never read and never stored, exactly as the mail door's meeting lane
 * refuses a notes document carrying only Gemini's summary
 * ({@link ../gmail/transcriptBlock}). A meeting whose transcript is absent or empty produces NO record
 * rather than a record of its summary: the kind's whole promise is that it holds raw speech, and a lane
 * that quietly fell back would make the kind a lie.
 *
 * That refusal is not theoretical here. Fathom's own summary of one of these calls was already pasted into
 * Slack by the other party and is already in this corpus — so a summary lane would ingest a second copy of
 * the one thing the owner asked not to keep, while the words the owner asked for stayed missing.
 *
 * ## `kind: "transcript"`, reusing the covering mechanism
 *
 * A Fathom call is the same UNIT as a Meet call whose notes arrive by mail — a recorded conversation
 * between named people — so it takes the kind that already exists rather than minting a parallel one.
 * {@link ../visibility.isAlwaysPrivateKind} already names `transcript`, and its own header says why in
 * advance: "the kind is marked anyway so the same record projected from any future source cannot arrive
 * public". This is that future source.
 *
 * ## One record per call, whole
 *
 * The transcript is stored as one record rather than chunked. A Fathom call is bounded by the meeting that
 * produced it — the longest in this account's own history is 72 minutes — and chunking would split a
 * question from its answer at an arbitrary byte. {@link TRANSCRIPT_CHAR_CAP} is the bound that keeps that
 * decision safe rather than hopeful, and a truncated record SAYS it was truncated in `attrs`.
 *
 * Pure: no I/O, no clock.
 */
import { extractRefs } from "../refs.js";
import type { CorpusAttributeValue, CorpusRecord } from "../types.js";
import { stampVisibility } from "../visibility.js";
import type { FathomMeeting, FathomTranscriptItem } from "./types.js";

/**
 * The most transcript text one record carries.
 *
 * Sized off this account's own history rather than a round number: at ordinary speech rates a 72-minute
 * call — the longest Fathom recording this installation has seen — lands near 90,000 characters, so 400,000
 * is roughly four times the worst real case and cannot be reached by anything that is still a meeting.
 * Reproduce the longest call's duration from the corpus:
 * `grep -rho 'PROCESSING DELAYED[^"]*' ~/.slopweaver/corpus/bronze/slack | head`.
 *
 * The cap exists so a record's size is bounded by CONSTRUCTION rather than by the provider behaving; a
 * transcript past it is truncated and says so, never dropped.
 */
export const TRANSCRIPT_CHAR_CAP = 400_000;

/** How one line of a transcript reads: when, who, and what they said. */
function transcriptLine({ item }: { item: FathomTranscriptItem }): string {
  return `[${item.timestamp}] ${item.speaker.displayName}: ${item.text}`;
}

/** The transcript body, and how much of it did not fit. */
export interface FathomBody {
  readonly text: string;
  readonly droppedChars: number;
}

/**
 * Render a transcript into the record's text, bounded by {@link TRANSCRIPT_CHAR_CAP}.
 *
 * The `[HH:MM:SS] Speaker: words` shape is Fathom's own three fields joined and nothing else — no
 * paraphrase, no re-ordering, no collapsing of consecutive lines by the same speaker. A reader asking
 * "what did Felix actually say about the audit" needs the words, and a reader citing them needs the
 * offset to jump to in the recording.
 *
 * @param items the transcript as the provider returned it, in provider order
 * @returns the body text, and how many characters were dropped to stay under the cap
 */
export function fathomTranscriptBody({ items }: { items: readonly FathomTranscriptItem[] }): FathomBody {
  const full = items.map((item) => transcriptLine({ item })).join("\n");
  if (full.length <= TRANSCRIPT_CHAR_CAP) {
    return { droppedChars: 0, text: full };
  }
  return { droppedChars: full.length - TRANSCRIPT_CHAR_CAP, text: full.slice(0, TRANSCRIPT_CHAR_CAP) };
}

/**
 * The distinct speakers a transcript names, in first-appearance order.
 *
 * Derived from the TRANSCRIPT rather than from the calendar invitee list, because the two answer different
 * questions: an invitee list says who was asked, and this says who talked. A record carrying both lets a
 * reader see the difference.
 *
 * @param items the transcript items
 * @returns each distinct speaker display name, once, in the order they first spoke
 */
export function fathomSpeakers({ items }: { items: readonly FathomTranscriptItem[] }): readonly string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const item of items) {
    const name = item.speaker.displayName;
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }
  return order;
}

/** The typed, queryable facts a later feature reads without re-fetching. */
function meetingAttrs({
  meeting,
  body,
  items,
}: {
  meeting: FathomMeeting;
  body: FathomBody;
  items: readonly FathomTranscriptItem[];
}): Readonly<Record<string, CorpusAttributeValue>> {
  const external = meeting.invitees.filter((invitee) => invitee.isExternal);
  return {
    attendeeCount: meeting.invitees.length,
    externalAttendeeCount: external.length,
    recordingId: meeting.recordingId,
    // Whether the call was shared beyond its recorder, in Fathom's own vocabulary. A `no_teams` call is one
    // only its host can see, which is the difference between "the team has this" and "the owner alone does".
    sharedWith: meeting.sharedWith,
    speakers: fathomSpeakers({ items }),
    transcriptChars: body.text.length,
    transcriptLanguage: meeting.transcriptLanguage,
    transcriptLines: items.length,
    ...(meeting.attendees.length > 0 ? { attendees: meeting.attendees } : {}),
    ...(meeting.meetingType !== undefined ? { meetingType: meeting.meetingType } : {}),
    ...(meeting.meetingUrl !== undefined ? { conferenceUrl: meeting.meetingUrl } : {}),
    ...(meeting.scheduledStartIso !== undefined ? { scheduledStartIso: meeting.scheduledStartIso } : {}),
    ...(meeting.recordingEndIso !== undefined ? { recordingEndIso: meeting.recordingEndIso } : {}),
    ...(meeting.shareUrl !== undefined ? { shareUrl: meeting.shareUrl } : {}),
    ...(body.droppedChars > 0 ? { transcriptCharsDropped: body.droppedChars } : {}),
  };
}

/**
 * The bronze `container` every Fathom record sits in.
 *
 * One bucket rather than a per-meeting-type or per-company one, for the reason the mail door's meeting
 * bucket is one: the container is what a reader filters on to mean "recorded calls", and splitting it by a
 * facet that also rides in `attrs` would make that filter unusable while adding nothing a query cannot do.
 */
export const FATHOM_BUCKET = "fathom/meetings";

/**
 * Project one meeting into a bronze record.
 *
 * Dated by the RECORDING's own start rather than by `created_at`: Fathom creates the meeting row when
 * processing finishes, which for a delayed call is the following day — and a record dated by that would
 * place a Wednesday meeting on Thursday's timeline, which is exactly the class of error a corpus must not
 * introduce. `created_at` is what the CURSOR pages on, and rides in `attrs` so the difference is visible.
 *
 * @param meeting the meeting as the provider returned it, with its transcript attached
 * @returns the record, or `undefined` when the meeting carries no raw transcript to store
 */
export function projectFathomMeeting({ meeting }: { meeting: FathomMeeting }): CorpusRecord | undefined {
  const items = meeting.transcript;
  if (items.length === 0 || meeting.recordingStartIso === undefined) {
    return undefined;
  }
  const body = fathomTranscriptBody({ items });
  const record: CorpusRecord = {
    attrs: meetingAttrs({ body, items, meeting }),
    container: FATHOM_BUCKET,
    kind: "transcript",
    refs: extractRefs({ text: body.text }),
    source: "fathom",
    // The recording id is the provider's own stable identity for the call and is what its URL carries, so a
    // re-crawl of an overlapping window dedups on it rather than minting a second copy of the same meeting.
    sourceId: String(meeting.recordingId),
    text: body.text,
    tsIso: meeting.recordingStartIso,
    url: meeting.url,
    ...(meeting.recordedByName !== undefined ? { author: meeting.recordedByName } : {}),
    ...(meeting.title !== undefined ? { title: meeting.title } : {}),
  };
  // Redundant with both `isAlwaysPrivateSource` and `isAlwaysPrivateKind`, and the redundancy is the point:
  // the default is PUBLIC, so one projection path that forgot to stamp would put an external customer call
  // into a non-owner's lane with nothing to show it had happened.
  return stampVisibility({ record, visibility: "private" });
}

/** What one projection pass produced, and what it refused. */
export interface FathomProjection {
  readonly records: readonly CorpusRecord[];
  readonly warnings: readonly string[];
}

/**
 * Project every crawled meeting, counting what could not be stored rather than dropping it silently.
 *
 * The two refusals are reported separately because they mean different things to a reader deciding whether
 * to act: a meeting with no transcript is usually one Fathom has not finished processing (and a later
 * refresh picks it up), while a meeting with no recording start is a shape this projection did not expect.
 *
 * @param meetings the crawled meetings, in provider order
 * @returns the records, and one warning per non-zero refusal kind
 */
export function projectFathomMeetings({ meetings }: { meetings: readonly FathomMeeting[] }): FathomProjection {
  const records: CorpusRecord[] = [];
  let noTranscript = 0;
  let undated = 0;
  for (const meeting of meetings) {
    if (meeting.recordingStartIso === undefined) {
      undated += 1;
      continue;
    }
    const record = projectFathomMeeting({ meeting });
    if (record === undefined) {
      noTranscript += 1;
      continue;
    }
    records.push(record);
  }
  const warnings: string[] = [];
  if (noTranscript > 0) {
    warnings.push(
      `${String(noTranscript)} meeting(s) carried no transcript and were not stored — Fathom had not ` +
        "finished processing them, and a later refresh over the same window picks them up (the summary " +
        "they DO carry is deliberately never stored)",
    );
  }
  if (undated > 0) {
    warnings.push(
      `${String(undated)} meeting(s) carried no recording start time and were not stored — bronze places a ` +
        "record on a timeline, and a call with nowhere to sit would be unfindable rather than wrong",
    );
  }
  return { records, warnings };
}
