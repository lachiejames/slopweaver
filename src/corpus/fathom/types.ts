/**
 * The repo's own shape for a Fathom meeting — the narrow slice the corpus stores, decoupled from the SDK's
 * generated model.
 *
 * ## Why a shape at all when the SDK ships one
 *
 * `docs/provider-sdks.md` says to lean on the official client's types, and this does: nothing here parses a
 * wire body, and {@link ../../live/fathom/api} is the ONLY place the generated `Meeting` is read. What this
 * interface buys is the seam that makes the projection PURE and testable with plain objects — the SDK's
 * model carries `Date` instances, nullable-vs-undefined splits and CRM/highlight/summary branches this
 * corpus deliberately never stores, and a projection written against it would have to be tested by
 * constructing a Speakeasy model.
 *
 * ## The one field that is absent on purpose
 *
 * There is no `summary`. Fathom returns `default_summary` on every meeting and it is never read anywhere in
 * this repository — a transcript summary produced by other software has no value to the owner. Leaving it off the type rather than off the projection means a later session cannot
 * store it without first changing this file, which is the visible place to argue about it.
 *
 * Pure: types only.
 */

/**
 * Who said one line, as Fathom identifies them.
 *
 * @internal — a field of {@link FathomTranscriptItem}; named so the shape is readable rather than inlined.
 */
export interface FathomSpeaker {
  /** The name Fathom shows against the line. */
  readonly displayName: string;
  /** The calendar invitee this speaker was matched to, when Fathom found an exact match. */
  readonly matchedInviteeEmail?: string;
}

/** One line of raw speech: when it was said, by whom, and the words. */
export interface FathomTranscriptItem {
  readonly speaker: FathomSpeaker;
  readonly text: string;
  /** Offset from the start of the meeting, `HH:MM:SS`, as the provider spells it. */
  readonly timestamp: string;
}

/** One person on the calendar invite. */
export interface FathomInvitee {
  readonly name?: string;
  readonly email?: string;
  /** Whether their email domain is outside this organisation, as Fathom classifies it. */
  readonly isExternal: boolean;
}

/**
 * One recorded meeting, with the raw transcript this corpus exists to store.
 *
 * `transcript` is REQUIRED and may be empty, rather than optional. An optional field would let a fetch that
 * silently failed to request transcripts look identical to a set of calls that genuinely had none, and the
 * whole lane's value is the words: an empty array is a fact the projection refuses on, an absent field is a
 * question nobody asked.
 */
export interface FathomMeeting {
  /** The provider's own id for the recording — the integer its `/calls/<id>` URL carries. */
  readonly recordingId: number;
  /** Fathom's own page for the call, which is what a citation links to. */
  readonly url: string;
  readonly title?: string;
  readonly transcript: readonly FathomTranscriptItem[];
  readonly transcriptLanguage: string;
  readonly invitees: readonly FathomInvitee[];
  /** Every invitee's display name, for the queryable `attrs` roster. */
  readonly attendees: readonly string[];
  readonly sharedWith: string;
  readonly recordingStartIso?: string;
  readonly recordingEndIso?: string;
  readonly scheduledStartIso?: string;
  /** When Fathom finished processing the call — the field the incremental cursor pages on. */
  readonly createdAtIso?: string;
  /**
   * Who recorded the call, by NAME — their Fathom display name, else their address's local part. The address
   * itself is not carried: it is Fathom's native id for a person and the corpus never keys on one.
   */
  readonly recordedByName?: string;
  readonly meetingType?: string;
  readonly meetingUrl?: string;
  readonly shareUrl?: string;
}
