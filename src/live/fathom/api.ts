/**
 * The Fathom door's one impure edge: the official SDK client, and the two calls this installation makes.
 *
 * ## Why the SDK, and the three metadata checks it FAILS
 *
 * `docs/provider-sdks.md` says to reach a provider through its official TypeScript client and to establish
 * "official" on registry evidence rather than on the package name. `fathom-typescript` passes the check
 * that matters most and fails three of the metadata ones, so both halves are recorded here rather than in
 * nobody's head:
 *
 * - **PASSES — the vendor's own documentation names it.** `https://developers.fathom.ai/sdks/typescript-installation`
 *   — the same site that serves the OpenAPI document this lane's shapes come from — says
 *   `npm install fathom-typescript`, and the npm description reads "Fathom's official TypeScript SDK".
 * - **FAILS — no `repository` field** on the registry document or in the published `package.json`.
 * - **FAILS — the GitHub repository the docs link (`github.com/fathom/fathom-typescript`) is not readable**;
 *   `slopweaver github repo --repo fathom/fathom-typescript --description "x" --dry-run` answers Not Found.
 * - **FAILS — no `dist.attestations`**, so the npm→vendor link is asserted rather than cryptographic. One
 *   maintainer account (`fathomai`), `author: "Speakeasy"` (the generator), 17 versions
 *   and 181,612 downloads in the measured month.
 *
 * Reproduce the whole picture in one command:
 * `SLOPWEAVER_ALLOW_RAW=1 curl -sS https://registry.npmjs.org/fathom-typescript | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('repository'),[m['name'] for m in d['maintainers']],len(d['time'])-2)"`
 *
 * The call is to use it anyway: the vendor's own docs site pointing at the package is the strongest
 * evidence available for any SDK, and hand-rolling transport against the same OpenAPI document would trade
 * an asserted supply-chain link for a guaranteed re-implementation of pagination, retry and rate-limit
 * backoff. The trade is named here so a later session weighs it rather than rediscovering it.
 *
 * ## What is deliberately unreachable from here
 *
 * The SDK exposes `getRecordingSummary`, `createRecordingDownload`, `createWebhook` and `deleteWebhook`.
 * None is called anywhere in this repository and none is re-exported from this module: summaries are ruled
 * out (see `../../corpus/fathom/project.ts`), a download pulls the audio or video of a private conversation
 * onto this machine, and a webhook is a WRITE to the provider that would need a door of its own. The narrow
 * surface here is the whole of what `fathom` means in this program.
 */
import { Fathom } from "fathom-typescript";
import type { Invitee, Meeting, TranscriptItem } from "fathom-typescript/sdk/models/shared";

import type { FathomInvitee, FathomMeeting, FathomTranscriptItem } from "../../corpus/fathom/types.js";
import { personName } from "../../corpus/personName.js";
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { Result } from "../../lib/result.js";

/**
 * How many meetings one page asks for. Fathom's own default, stated rather than inherited silently.
 *
 * @internal — named so `../../corpus/fathom/fetch.ts`'s page-bound reasoning can cite a value rather than a
 *   number somebody typed twice.
 */
export const FATHOM_PAGE_SIZE = 10;

/**
 * One page of meetings, and the cursor that reaches the next one.
 *
 * `nextCursor === undefined` means this was the last page — distinct from an EMPTY page, which a filtered
 * window can legitimately produce while more pages follow.
 */
export interface FathomMeetingPage {
  readonly meetings: readonly FathomMeeting[];
  readonly nextCursor?: string;
}

/** The seam a crawl reads meetings through. Injected so the crawl is testable with no account and no network. */
export interface FathomApi {
  readonly listMeetings: (input: {
    createdAfter?: string;
    createdBefore?: string;
    cursor?: string;
  }) => Promise<Result<FathomMeetingPage, IngestError>>;
}

/** An ISO instant from a value the SDK typed as a `Date`, or nothing when it carried none. */
function isoOf({ at }: { at: Date | null | undefined }): string | undefined {
  return at == null ? undefined : at.toISOString();
}

/**
 * Narrow one SDK transcript item to the repo's own shape.
 *
 * @param item the generated model's item
 * @returns the narrowed line
 */
function narrowItem({ item }: { item: TranscriptItem }): FathomTranscriptItem {
  return {
    speaker: {
      displayName: item.speaker.displayName,
      ...(item.speaker.matchedCalendarInviteeEmail == null
        ? {}
        : { matchedInviteeEmail: item.speaker.matchedCalendarInviteeEmail }),
    },
    text: item.text,
    timestamp: item.timestamp,
  };
}

/**
 * Narrow one SDK invitee to the repo's own shape.
 *
 * @param invitee the generated model's invitee
 * @returns the narrowed invitee
 */
function narrowInvitee({ invitee }: { invitee: Invitee }): FathomInvitee {
  return {
    isExternal: invitee.isExternal,
    ...(invitee.email == null ? {} : { email: invitee.email }),
    ...(invitee.name == null ? {} : { name: invitee.name }),
  };
}

/**
 * The transcript lines one listed meeting carries. Every request asks for them, but a recording Fathom has
 * not finished processing has none to send, so `transcript` arrives unset (omitted, or `null`); that reads as
 * no lines, which the corpus projection counts and refuses rather than storing.
 */
function transcriptLines({ meeting }: { meeting: Meeting }): readonly TranscriptItem[] {
  const { transcript } = meeting;
  if (transcript == null) {
    return [];
  }
  return transcript;
}

/**
 * Narrow one SDK meeting to the repo's own shape — the ONE place the generated model is read.
 *
 * `meetingTitle` (the calendar event's own title) is preferred over `title` (Fathom's, which for an ad-hoc
 * recording is a generated string), falling back to it, so a record's title is what a person wrote wherever
 * a person wrote one.
 *
 * @param meeting the generated model
 * @returns the narrowed meeting, transcript included
 *
 * @internal — exported for the boundary test that pins this mapping; nothing outside this module calls it.
 */
export function narrowMeeting({ meeting }: { meeting: Meeting }): FathomMeeting {
  const title = meeting.meetingTitle ?? meeting.title;
  const recordedByName = personName({ address: meeting.recordedBy.email, displayName: meeting.recordedBy.name });
  return {
    attendees: meeting.calendarInvitees.map((invitee) => invitee.name).filter((name): name is string => name != null),
    invitees: meeting.calendarInvitees.map((invitee) => narrowInvitee({ invitee })),
    recordingId: meeting.recordingId,
    sharedWith: meeting.sharedWith,
    transcript: transcriptLines({ meeting }).map((item) => narrowItem({ item })),
    transcriptLanguage: meeting.transcriptLanguage,
    url: meeting.url,
    ...(title === "" ? {} : { title }),
    ...(meeting.meetingType == null ? {} : { meetingType: meeting.meetingType }),
    ...(meeting.meetingUrl == null ? {} : { meetingUrl: meeting.meetingUrl }),
    ...(recordedByName === undefined ? {} : { recordedByName }),
    ...(meeting.shareUrl === "" ? {} : { shareUrl: meeting.shareUrl }),
    ...optionalIso({ at: meeting.createdAt, field: "createdAtIso" }),
    ...optionalIso({ at: meeting.recordingEndTime, field: "recordingEndIso" }),
    ...optionalIso({ at: meeting.recordingStartTime, field: "recordingStartIso" }),
    ...optionalIso({ at: meeting.scheduledStartTime, field: "scheduledStartIso" }),
  };
}

/**
 * One optional ISO field, present only when the provider carried a date for it.
 *
 * `exactOptionalPropertyTypes` is why this exists rather than a `field: iso` assignment: an absent instant
 * must leave the key OFF, not set it to `undefined`, and spreading a computed single-key record is the one
 * spelling that does that at four call sites without four `if`s.
 *
 * @param at the instant the SDK carried, which may be absent
 * @param field the narrowed shape's field name
 * @returns a one-entry record, or an empty one
 */
function optionalIso({ at, field }: { at: Date | null | undefined; field: string }): Readonly<Record<string, string>> {
  const iso = isoOf({ at });
  return iso === undefined ? {} : { [field]: iso };
}

/**
 * The real Fathom API, authenticated with the owner's own key.
 *
 * Every call goes through {@link safeProviderCall}, so Fathom's published quotas (`fathom` in
 * `src/lib/rateLimitsMailAndWork.ts`) pace it and a 429 blocks every other caller rather than only the one that earned
 * it. `retryMode: "transient"` is safe on both operations because both are GETs.
 *
 * @param apiKey the owner's Fathom API key
 * @returns the seam a crawl reads through
 */
export function makeFathomApi({ apiKey }: { apiKey: string }): FathomApi {
  const client = new Fathom({ security: { apiKeyAuth: apiKey } });
  return {
    listMeetings: async ({ createdAfter, createdBefore, cursor }) =>
      safeProviderCall({
        execute: async () => {
          const page = await client.listMeetings({
            // The transcript rides the LIST response, so one heavy request covers a whole page rather than
            // one per recording — which matters because Fathom meters `include_transcript` under its heavy
            // class (30/min, and as low as 5/min under load) while the list itself is an ordinary call.
            includeTranscript: true,
            ...(createdAfter !== undefined ? { createdAfter } : {}),
            ...(createdBefore !== undefined ? { createdBefore } : {}),
            ...(cursor !== undefined ? { cursor } : {}),
          });
          const result = page.result;
          return {
            meetings: result.items.map((meeting) => narrowMeeting({ meeting })),
            ...nextCursorField({ raw: result.nextCursor }),
          } satisfies FathomMeetingPage;
        },
        operation: "fathom.meetings.list",
        provider: "fathom",
        retryMode: "transient",
        scopeId: "fathom",
      }),
  };
}

/**
 * The `nextCursor` field, present only when the provider handed back a cursor that means something.
 *
 * MEASURED on the owner's own key, and it is why this is a function rather than a null check:
 * Fathom ends a listing with `"next_cursor": ""`, an EMPTY STRING, not `null`. The SDK types the field
 * `string | null` and passes the empty string straight through, so a `== null` test reads it as a live
 * cursor. The crawl then re-requests page one with `cursor=""` forever, and because it is a heavy-classed
 * call it does so slowly: the first live run walked its whole 500-page bound and printed `(stalled)`
 * twenty-five times over roughly twenty-four minutes rather than returning one meeting.
 *
 * The unit fakes could not have caught it. They return `undefined` for "no more pages", which is the shape
 * this repo uses and not the shape the provider sends. Reproduce against a live key:
 * `curl -sS https://api.fathom.ai/external/v1/meetings -H "X-Api-Key: $KEY" | python3 -c "import sys,json;print(repr(json.load(sys.stdin)['next_cursor']))"`
 *
 * @param raw the cursor as the SDK typed it
 * @returns a one-entry record when there is a real cursor, an empty one otherwise
 * @internal
 */
export function nextCursorField({ raw }: { raw: string | null | undefined }): { nextCursor?: string } {
  return raw == null || raw.trim() === "" ? {} : { nextCursor: raw };
}

/**
 * Whether a boundary error is Fathom refusing the key rather than the wire failing.
 *
 * `status` first, because the boundary extracts it from the SDK's own error and it is the unambiguous
 * signal. The message is the FALLBACK rather than the test: an SDK error whose status the boundary could
 * not read still spells the code in its message, and reporting "the network failed" for a revoked key
 * would send the owner to the wrong fix — the two refusals name completely different next actions.
 *
 * 403 is deliberately NOT here. Fathom answers 403 for a permission the key genuinely lacks (the users
 * endpoint for a non-admin, a limited-access share), which is a real answer about scope rather than a key
 * to re-mint.
 *
 * @param error the typed boundary error
 * @returns whether the lane should report a revoked key rather than a transport failure
 */
export function isUnauthorised({ error }: { error: IngestError }): boolean {
  return error.status === 401 || /\b401\b|\bunauthorized\b/i.test(error.message);
}
