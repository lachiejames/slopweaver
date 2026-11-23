/**
 * The shapes `slack read-thread` returns. Deliberately NOT `CorpusRecord`: nothing here is ingested, and
 * nothing here is redacted. This is provider-current content on its way to the model.
 *
 * The projection keeps `blocks` and `attachments` as raw JSON rather than flattening them to text. That is
 * the whole point: slopweaver's own cards carry their visible content in `attachments[].blocks` with an
 * EMPTY top-level `text`, so a text-only read reports this repo's own messages as blank. Any Block Kit
 * body that changes without its fallback text changing is invisible to a `text`-only projection.
 */

/** An attachment as Slack describes it. Bytes are fetched separately; this is the metadata. */
export interface VisibleSlackFile {
  readonly id: string;
  readonly name?: string;
  readonly title?: string;
  readonly mimetype?: string;
  readonly filetype?: string;
  /** Slack's storage mode. `tombstone` means the file was DELETED and no bytes exist any more. */
  readonly mode?: string;
  readonly size?: number;
  readonly permalink?: string;
  /** Externally hosted (Google Drive and friends) — there are no Slack bytes to fetch. */
  readonly isExternal: boolean;
  readonly externalType?: string;
  /** Slack's own access marker; anything other than `visible` means the token cannot read the bytes. */
  readonly fileAccess?: string;
  /** The authenticated download URL, when Slack supplied one. Never emitted in output. */
  readonly urlPrivateDownload?: string;
  /**
   * Slack's own 480px and 360px renditions of a picture — `thumb_480`, `thumb_360` — authenticated exactly as the
   * download URL is, and present only on a file Slack made a preview of. What the console's channel window draws
   * (`./channelView.ts`), since Slack desktop draws the preview too, never the original. Never emitted in output.
   */
  readonly thumb480Url?: string;
  readonly thumb360Url?: string;
}

/** One emoji reaction and who left it. */
export interface VisibleSlackReaction {
  readonly name: string;
  readonly count: number;
  readonly userIds: readonly string[];
}

/** Who wrote a message. Kept as raw ids: this verb never resolves them to display names. */
export interface VisibleSlackAuthor {
  readonly userId?: string;
  readonly botId?: string;
  readonly username?: string;
}

/** One message in the thread, with everything a reader can see. */
export interface VisibleSlackMessage {
  readonly ts: string;
  /**
   * The instant {@link ts} names, derived through `lib/slackTs.ts` and never by hand.
   *
   * It sits BESIDE `ts` rather than replacing it because the two answer different questions: `ts` is the
   * message's identity (what `conversations.replies`, `slack reply` and every permalink are keyed on) and
   * this is when it was posted. A consumer that needs the instant used to compute it, and MEASURED one
   * got it 80 minutes wrong and propagated that into a board row, two cron schedules and two
   * deadman deadlines. Second resolution, for the reason `lib/slackTs.ts`'s header gives.
   */
  readonly tsIso: string;
  readonly threadTs: string;
  readonly relation: "parent" | "reply";
  readonly permalink: string;
  readonly author: VisibleSlackAuthor;
  readonly subtype?: string;
  /** The top-level text. Often EMPTY on app/bot messages whose content lives in blocks. */
  readonly text: string;
  /** Set when Slack reports the message was edited. */
  readonly editedTs?: string;
  /** The instant {@link editedTs} names, present exactly when it is. */
  readonly editedTsIso?: string;
  /** Block Kit content, verbatim. */
  readonly blocks: readonly unknown[];
  /** Legacy attachments (which themselves may carry blocks), verbatim. */
  readonly attachments: readonly unknown[];
  readonly reactions: readonly VisibleSlackReaction[];
  readonly files: readonly VisibleSlackFile[];
  /**
   * File ids referenced ONLY from inside Block Kit (`slack_file: { id }`) and absent from `files`.
   *
   * MEASURED: a handful of such ids across well over a hundred thousand real messages, and NONE of them appeared in their message's
   * top-level `files`. So this is a genuine second channel for an attachment, not a duplicate of the
   * first — an image the reader can see and this verb would otherwise never mention. The block carries an
   * id but no `url_private_download`, so each id is resolved through `files.info` (see `blockFiles.ts`) and
   * then planned by exactly the same rules as a top-level attachment.
   */
  readonly blockFileRefs: readonly string[];
}

/** A fully projected thread: the parent first, then replies in Slack's order. */
export interface ProjectedSlackThread {
  readonly messages: readonly VisibleSlackMessage[];
  readonly replyCount: number;
}

/** Why an attachment's bytes were not retrieved. Every one of these is REPORTED, never silent. */
export type FileSkipReason =
  | "external-no-bytes"
  | "access-denied"
  | "not-model-readable"
  | "over-size-cap"
  | "no-download-url"
  | "canvas-not-downloadable"
  /**
   * A Block Kit `slack_file` id whose `files.info` lookup failed — a missing scope, a file the token cannot
   * see, a provider error. The provider's own words travel in `detail`.
   */
  | "block-lookup-failed"
  /**
   * A Block Kit `slack_file` id that reached the plan with NOTHING said about it in either resolution lane.
   * A backstop rather than an expected outcome: it can only happen if the resolution step is skipped or
   * incomplete, and reporting it is what stops such an id from vanishing from every lane at once.
   */
  | "block-referenced-only"
  | "deleted-from-slack";

/** An attachment whose bytes were fetched to disk. */
export interface RetrievedFile {
  readonly fileId: string;
  readonly messageTs: string;
  readonly localPath: string;
  readonly bytes: number;
  readonly name?: string;
  readonly mimetype?: string;
  /**
   * The attachment's own words, when this read could get them. A PDF's text layer, extracted — the local
   * path alone is what a session summarising the thread cannot use.
   */
  readonly text?: string;
  /** Present when the bytes were a PDF, whatever mimetype the uploader's client sent. */
  readonly pdf?: { readonly pages: number; readonly pagesRead: number; readonly glyphless: boolean };
}

/** An attachment deliberately not fetched, with the reason stated. */
export interface SkippedFile {
  readonly fileId: string;
  readonly messageTs: string;
  readonly reason: FileSkipReason;
  readonly name?: string;
  readonly mimetype?: string;
  readonly size?: number;
  /**
   * The provider's own words, when the reason came from a failed call rather than from a rule of ours.
   * `reason` says which class it is; this says what actually happened, which is the difference between a
   * missing scope the operator can fix and a file Slack has genuinely lost.
   */
  readonly detail?: string;
}
