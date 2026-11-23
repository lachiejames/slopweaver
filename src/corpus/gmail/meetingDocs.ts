/**
 * The one network step the mail connector makes outside the Gmail API: following the Google Doc link in a
 * recognised Gemini meeting-notes email.
 *
 * ## Three bounds, and each one is load-bearing
 *
 * - **Only recognised notes emails are followed.** The link comes from a message whose SENDER is one of
 *   Google's own meeting addresses, never from arbitrary mail, because this step spends the owner's own
 *   credential on a URL found in a message body and that is precisely the operation not to perform on
 *   attacker-chosen input.
 * - **One fetch per DOCUMENT, not per message.** Google re-sends the notes for a recurring meeting series
 *   and the same document id appears more than once in a wide backfill; a cache keyed on the id turns that
 *   into one call.
 * - **{@link MAX_MEETING_DOCS} caps a single pass.** A first full-history crawl of a heavily-metered
 *   mailbox could otherwise make thousands of Docs calls in one run. Reaching the cap is REPORTED as a
 *   warning naming how many were left, and it costs those meetings their RECORD — see below.
 *
 * ## A failure here is a warning, never a stop — but the meeting is not stored
 *
 * A document that will not fetch — moved, deleted, shared with someone else, a capped pass, or simply a
 * grant that never approved the Docs scope — costs the meeting its record entirely. It does NOT fall back
 * to the email's inline summary: only the raw transcript is stored, and a lane
 * that quietly substituted Gemini's prose for it would put exactly the excluded content into the corpus
 * under a kind that promises raw speech. The projection counts every such meeting and
 * {@link ../gmail/project.projectGmailMessages} reports one line per refusal KIND, so "not transcribed"
 * and "could not be fetched" stay distinguishable — and the second is recovered by fixing the access and
 * refreshing again.
 *
 * Effectful only through the injected {@link ../../live/gmail/docs.GoogleDocsApi}.
 */
import { type DocContent, docIdFromUrl, type GoogleDocsApi } from "../../live/gmail/docs.js";
import type { ParsedGmailMessage } from "../../live/gmail/parse.js";
import { documentLink, isMeetingNotesEmail } from "./geminiNotes.js";

/**
 * How many distinct documents one ingest pass will fetch.
 *
 * Measured on the owner's mailbox: 60 meeting-notes emails across its whole history
 * (`slopweaver gmail list --query "from:gemini-notes@google.com" --limit 100`), so this bound is an order
 * of magnitude above the real full-history figure and exists to stop an unexpected shape spending a
 * mailbox's worth of Docs quota, not to shape a normal run.
 */
export const MAX_MEETING_DOCS = 500;

/**
 * Why ONE carrier message's document was not read — the per-message half of the pass's warnings, so a caller
 * that has to say why a particular meeting is missing (`gmail clear-meeting-notes`) reads it rather than
 * re-deriving it from a warning string.
 */
export type MeetingDocFailure =
  | { readonly kind: "no-link"; readonly messageId: string }
  | { readonly kind: "malformed-link"; readonly messageId: string; readonly url: string }
  | { readonly kind: "no-docs-grant"; readonly messageId: string }
  | {
      readonly kind: "provider-error";
      readonly messageId: string;
      readonly documentId: string;
      readonly message: string;
    }
  | { readonly kind: "capped"; readonly messageId: string; readonly documentId: string };

/**
 * What one meeting-doc pass produced.
 *
 * @internal — the declared shape of `fetchMeetingDocs`'s return; the ingest destructures it.
 */
export interface MeetingDocResult {
  /** The document per CARRIER MESSAGE id — the key the projection looks a message up by. */
  readonly documents: ReadonlyMap<string, DocContent>;
  /** Why each recognised carrier message has no document, keyed by message id. */
  readonly failures: ReadonlyMap<string, MeetingDocFailure>;
  /** One line per document that could not be read, plus one if the pass hit its own cap. */
  readonly warnings: readonly string[];
}

/** One recognised carrier message and the document link it carried, when it carried one. */
interface RecognisedMeeting {
  readonly messageId: string;
  readonly url: string | undefined;
}

/** The carrier messages that are meeting-notes emails, each with its document link when it has one. */
function recognisedMeetings({ messages }: { messages: readonly ParsedGmailMessage[] }): readonly RecognisedMeeting[] {
  return messages.flatMap((message) =>
    isMeetingNotesEmail({ message })
      ? [{ messageId: message.id, url: documentLink({ links: message.htmlLinks }) }]
      : [],
  );
}

/**
 * Follow the Google Doc link of every recognised meeting-notes email in a batch.
 *
 * @param docsApi the injected Docs seam, or undefined when the grant carries no Docs scope
 * @param messages the crawl's parsed messages, in fetch order
 * @returns the document per carrier message id, and one warning per document that could not be read
 */
export async function fetchMeetingDocs({
  docsApi,
  messages,
}: {
  docsApi: GoogleDocsApi | undefined;
  messages: readonly ParsedGmailMessage[];
}): Promise<MeetingDocResult> {
  const meetings = recognisedMeetings({ messages });
  const failures = new Map<string, MeetingDocFailure>();
  const linked: { readonly messageId: string; readonly url: string }[] = [];
  for (const meeting of meetings) {
    if (meeting.url === undefined) {
      failures.set(meeting.messageId, { kind: "no-link", messageId: meeting.messageId });
    } else {
      linked.push({ messageId: meeting.messageId, url: meeting.url });
    }
  }
  if (docsApi === undefined) {
    for (const meeting of linked) {
      failures.set(meeting.messageId, { kind: "no-docs-grant", messageId: meeting.messageId });
    }
    return { documents: new Map(), failures, warnings: noDocsGrantWarning({ meetings: linked.length }) };
  }
  const state: FetchState = { byDocument: new Map(), byMessage: new Map(), capped: 0, failures, warnings: [] };
  for (const meeting of linked) {
    await fetchOne({ docsApi, meeting, state });
  }
  return {
    documents: state.byMessage,
    failures,
    warnings: [...state.warnings, ...cappedWarning({ capped: state.capped })],
  };
}

/** What one Docs call answered for a document: its content, or the provider's refusal. */
type DocumentAnswer = { readonly document: DocContent } | { readonly failed: string };

/** The mutable accumulator one pass threads through {@link fetchOne}. */
interface FetchState {
  /**
   * Every document already ASKED for, keyed by DOCUMENT id, with its answer — the cache that collapses a recurring
   * series, and the count the ceiling bounds. A refusal is cached too, so a series linking a document this grant
   * cannot read costs one call rather than one per carrier.
   */
  readonly byDocument: Map<string, DocumentAnswer>;
  /** The read documents keyed by CARRIER MESSAGE id, which is what the projection looks one up by. */
  readonly byMessage: Map<string, DocContent>;
  /** Why each carrier message has no document, keyed by message id. */
  readonly failures: Map<string, MeetingDocFailure>;
  /** One line per document that could not be read. */
  readonly warnings: string[];
  /** How many meetings the document ceiling cost. Mutated, so it is not `readonly`. */
  capped: number;
}

/**
 * Resolve ONE meeting's document into the pass's state — from the cache, from the API, or not at all.
 *
 * @param docsApi the injected Docs seam
 * @param meeting the carrier message id and the document URL it linked
 * @param state the pass accumulator (mutated)
 */
async function fetchOne({
  docsApi,
  meeting,
  state,
}: {
  docsApi: GoogleDocsApi;
  meeting: { readonly messageId: string; readonly url: string };
  state: FetchState;
}): Promise<void> {
  const { messageId } = meeting;
  const documentId = docIdFromUrl({ url: meeting.url });
  if (documentId === undefined) {
    state.failures.set(messageId, { kind: "malformed-link", messageId, url: meeting.url });
    return;
  }
  const cached = state.byDocument.get(documentId);
  if (cached !== undefined) {
    recordAnswer({ answer: cached, documentId, messageId, state });
    return;
  }
  if (state.byDocument.size >= MAX_MEETING_DOCS) {
    state.capped += 1;
    state.failures.set(messageId, { documentId, kind: "capped", messageId });
    return;
  }
  const fetched = await docsApi.getDocument({ documentId });
  const answer: DocumentAnswer = fetched.isErr() ? { failed: fetched.error.message } : { document: fetched.value };
  state.byDocument.set(documentId, answer);
  if ("failed" in answer) {
    state.warnings.push(`meeting document ${documentId}: not read (${answer.failed})`);
  }
  recordAnswer({ answer, documentId, messageId, state });
}

/** File one document answer against the carrier message that linked it. */
function recordAnswer({
  answer,
  documentId,
  messageId,
  state,
}: {
  answer: DocumentAnswer;
  documentId: string;
  messageId: string;
  state: FetchState;
}): void {
  if ("document" in answer) {
    state.byMessage.set(messageId, answer.document);
    return;
  }
  state.failures.set(messageId, { documentId, kind: "provider-error", message: answer.failed, messageId });
}

/**
 * The ONE line a pass with no Docs grant reports — not one per meeting, which would bury the run's own
 * notes under a warning that says the same thing sixty times.
 *
 * @param meetings how many meeting-notes emails linked a transcript this grant cannot reach
 * @returns the warning, or nothing when the batch held no meetings at all
 */
function noDocsGrantWarning({ meetings }: { meetings: number }): readonly string[] {
  if (meetings === 0) {
    return [];
  }
  return [
    `${String(meetings)} meeting-notes email(s) link a transcript this grant cannot read — ` +
      "re-run `slopweaver gmail connect` to approve the Google Docs scope, then refresh again; until then " +
      "these meetings are NOT ingested at all, because only the raw transcript is stored",
  ];
}

/**
 * The line a pass that hit its document ceiling reports, naming what it cost and how to get the rest.
 *
 * @param capped how many meetings the ceiling cost their record
 * @returns the warning, or nothing when the ceiling was never reached
 */
function cappedWarning({ capped }: { capped: number }): readonly string[] {
  if (capped === 0) {
    return [];
  }
  return [
    `this pass reached its ${String(MAX_MEETING_DOCS)}-document ceiling, so ${String(capped)} meeting(s) ` +
      "were not stored at all — narrow the window and refresh again to pick up the rest",
  ];
}
