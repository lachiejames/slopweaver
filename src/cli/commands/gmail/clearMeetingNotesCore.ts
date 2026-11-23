/**
 * `gmail clear-meeting-notes`'s pure half: the argv and the one decision per mail. The Queue card a kept mail gets
 * is `./clearMeetingNotesCard.ts`; the lines the run prints and its exit code are `./clearMeetingNotesReport.ts`.
 *
 * ## The rule this verb holds
 *
 * Archive the Gemini meeting-notes mail only when the transcripts are being pulled as they come: always archive
 * those emails, but always download the transcript; and if there is no transcript, archive it anyway.
 * So a mail is archived on one of two facts. Its transcript is PROVEN — in gmail bronze under the
 * mail's own identity, carrying the title and date its subject named (`../../../corpus/gmail/meetingProof.ts`),
 * AND in the store retrieval reads. Or its notes document was READ and holds no transcript at all, so there is
 * nothing to download (Gemini's summary is never stored). Anything else keeps the mail,
 * and the report says which check it failed.
 *
 * ## A kept mail is either a hand step or the next pass's
 *
 * A reason only the owner can act on — a document that cannot be read, a subject Google changed the shape of — is ONE Queue
 * card per mail, so the mail is never a silent skip. A reason the next pass repairs on its own — the store not yet
 * holding a row bronze holds, the document ceiling — is not carded: it fails the run (exit 1) instead, which is
 * what a scheduled row is watched by.
 */
import type { MeetingDocFailure } from "../../../corpus/gmail/meetingDocs.js";
import type { MeetingBronzeVerdict } from "../../../corpus/gmail/meetingProof.js";
import type { MeetingProjectionOutcome } from "../../../corpus/gmail/project.js";
import { err, ok, type Result } from "../../../lib/result.js";
import {
  DEFAULT_CLEAR_MEETING_NOTES_LIMIT,
  MAX_CLEAR_MEETING_NOTES_LIMIT,
} from "../../../live/gmail/meetingNotesRead.js";
import { parseFlagTail } from "../../optionParsers.js";
import { GMAIL_CLEAR_MEETING_NOTES_USAGE } from "./clearMeetingNotesUsage.js";
import { type GmailArgsError, GmailArgsErrors } from "./errors.js";

/** What one `clear-meeting-notes` invocation asked for. */
export interface ClearMeetingNotesArgs {
  /** Read the whole mailbox and report; change nothing. */
  readonly audit: boolean;
  /** Read the inbox and report what a run would do; change nothing. */
  readonly dryRun: boolean;
  readonly limit: number;
  readonly home: string | undefined;
}

/** A real run, a dry run of the inbox, or an audit of the whole mailbox. */
export type ClearMeetingNotesMode = "run" | "dry-run" | "audit";

/**
 * Parse the argv tail. Pure.
 *
 * @param rest the argv after the verb
 * @returns the options, or the typed refusal
 */
export function parseClearMeetingNotesArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<ClearMeetingNotesArgs, GmailArgsError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["audit", "dry-run"], value: ["home", "limit"] } });
  if (parsed.isErr()) {
    return err(GmailArgsErrors.flagsInvalid({ reasons: parsed.error, usage: GMAIL_CLEAR_MEETING_NOTES_USAGE }));
  }
  const { values, flags } = parsed.value;
  const rawLimit = values["limit"];
  let limit = DEFAULT_CLEAR_MEETING_NOTES_LIMIT;
  if (rawLimit !== undefined) {
    limit = Number(rawLimit);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CLEAR_MEETING_NOTES_LIMIT) {
    return err(
      GmailArgsErrors.limitOutOfRange({
        got: String(rawLimit),
        max: MAX_CLEAR_MEETING_NOTES_LIMIT,
        usage: GMAIL_CLEAR_MEETING_NOTES_USAGE,
      }),
    );
  }
  const audit = flags.has("audit");
  const dryRun = flags.has("dry-run");
  if (audit && dryRun) {
    return err(
      GmailArgsErrors.flagsInvalid({
        reasons: ["--audit already changes nothing; give --audit or --dry-run, not both"],
        usage: GMAIL_CLEAR_MEETING_NOTES_USAGE,
      }),
    );
  }
  return ok({ audit, dryRun, home: values["home"], limit });
}

/**
 * The mode the parsed flags name. Pure.
 *
 * @param args the parsed options
 * @returns `audit`, `dry-run`, or a real `run`
 */
export function clearMeetingNotesMode({ args }: { args: ClearMeetingNotesArgs }): ClearMeetingNotesMode {
  if (args.audit) {
    return "audit";
  }
  if (args.dryRun) {
    return "dry-run";
  }
  return "run";
}

/** Why a mail stayed where it is. */
export type KeptMeetingReason =
  /** The subject did not carry a quoted title and a date, so there is nothing to prove a row against. */
  | { readonly kind: "subject-unparsed" }
  /** The mail matched the query but is not from a recognised Google meeting sender. */
  | { readonly kind: "not-a-meeting-mail" }
  /** The mail has no send time, so the transcript has no instant to be filed under. */
  | { readonly kind: "undated" }
  | { readonly kind: "no-link" }
  | { readonly kind: "malformed-link" }
  | { readonly kind: "no-docs-grant" }
  | { readonly kind: "provider-error"; readonly message: string }
  /** The pass reached its document ceiling before this meeting. */
  | { readonly kind: "capped" }
  /** Bronze holds a row under the mail's identity that does not prove this meeting. */
  | { readonly kind: "bronze-mismatch"; readonly verdict: Exclude<MeetingBronzeVerdict, "proven" | "absent"> }
  /** A commit wrote without error and bronze still does not prove it — the install's sync denylist, most likely. */
  | { readonly kind: "not-held-after-commit" }
  /** Bronze proves it and the store still does not hold it after a replay. */
  | { readonly kind: "not-in-store" }
  /** `--dry-run`/`--audit`: the transcript is readable and a run would ingest it. */
  | { readonly kind: "would-ingest" };

/** What happened to one mail. */
export type MeetingOutcome =
  | {
      readonly kind: "proven";
      readonly sourceId: string;
      /** Whether THIS run wrote the transcript to bronze. */
      readonly ingestedNow: boolean;
    }
  /** The notes document was read and holds Gemini's summary and no transcript, so there is nothing to download. */
  | { readonly kind: "no-transcript" }
  | { readonly kind: "kept"; readonly reason: KeptMeetingReason };

/**
 * Whether an outcome lets the mail leave the inbox: its transcript is proven held, or it never had one. Pure.
 *
 * @param outcome what the run judged of the mail
 * @returns true when a run archives the mail
 */
export function outcomeArchives({ outcome }: { outcome: MeetingOutcome }): boolean {
  return outcome.kind === "proven" || outcome.kind === "no-transcript";
}

/** The sentence a `no-transcript` mail's line carries. */
export const NO_TRANSCRIPT_TEXT =
  "the notes document holds Gemini's summary and no transcript — the call was not transcribed, so there is nothing to download";

/** One mail and what happened to it. */
export interface MeetingDisposition {
  readonly messageId: string;
  readonly title: string | undefined;
  readonly meetingDate: string | undefined;
  readonly inInbox: boolean;
  readonly outcome: MeetingOutcome;
}

/**
 * Whether a kept reason is a step only the OWNER can take — a Queue card — rather than one the next pass repairs. Pure.
 *
 * @param reason why the mail stayed
 * @returns true when the mail earns a card
 */
export function keptReasonNeedsOwner({ reason }: { reason: KeptMeetingReason }): boolean {
  switch (reason.kind) {
    case "subject-unparsed":
    case "undated":
    case "no-link":
    case "malformed-link":
    case "no-docs-grant":
    case "provider-error":
    case "bronze-mismatch":
    case "not-held-after-commit":
      return true;
    case "not-a-meeting-mail":
    case "capped":
    case "not-in-store":
    case "would-ingest":
      return false;
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

/**
 * One sentence saying why a mail stayed. Pure.
 *
 * @param reason why the mail stayed
 * @returns the sentence
 */
export function keptReasonText({ reason }: { reason: KeptMeetingReason }): string {
  switch (reason.kind) {
    case "subject-unparsed":
      return "the subject carries no quoted meeting title and date, so no transcript row can be proven against it";
    case "not-a-meeting-mail":
      return "the sender is not one of Google's meeting addresses, so its link is never followed";
    case "undated":
      return "the mail carries no send time, so the transcript has no instant to be stored under";
    case "no-link":
      return "the mail links no notes document, so there is no transcript to read";
    case "malformed-link":
      return "the mail's notes link names no document id";
    case "no-docs-grant":
      return "the Gmail grant does not carry the Google Docs scope, so the notes document cannot be read";
    case "provider-error":
      return `the notes document could not be read: ${reason.message}`;
    case "capped":
      return "this pass reached its document ceiling before this meeting; the next pass reads it";
    case "bronze-mismatch":
      return `gmail bronze holds a row under this mail's identity that does not prove it (${reason.verdict})`;
    case "not-held-after-commit":
      return "the transcript was committed and bronze still does not hold it — the sync denylist may exclude it";
    case "not-in-store":
      return "bronze holds the transcript and the store does not hold it as bronze does, even after a replay; the next pass retries";
    case "would-ingest":
      return "the transcript is readable and not yet in the corpus; a run would ingest it, then archive";
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

/**
 * `'<title>' <date>`, or `an untitled meeting (message <id>)` when the subject named neither — the id after the
 * words, because a card heading naming a bare hex id is refused (`src/briefing/untranslatedCode.ts`) and a real
 * Gmail message id is lowercase hex. Pure.
 *
 * @param disposition the mail to name
 * @returns the label a line or a card names the meeting by
 */
export function meetingLabel({ disposition }: { disposition: MeetingDisposition }): string {
  if (disposition.title === undefined) {
    return `an untitled meeting (message ${disposition.messageId})`;
  }
  const date = disposition.meetingDate === undefined ? "" : ` ${disposition.meetingDate}`;
  return `'${disposition.title}'${date}`;
}

/** Everything the run learned about one mail, in the order it learned it. */
export interface MeetingEvidence {
  /** Whether the sender is one of Google's meeting addresses. */
  readonly recognised: boolean;
  /** Whether the subject carried both a quoted title and a date. */
  readonly subjectParsed: boolean;
  /** The bronze identity the transcript is stored under. */
  readonly sourceId: string;
  /** Bronze's verdict as it stands NOW — after this run's commit, when it made one. */
  readonly verdict: MeetingBronzeVerdict;
  /** Whether bronze was `absent` before this run and `proven` after it. */
  readonly ingestedNow: boolean;
  /** The projection, when bronze lacked the transcript and the document was asked for. */
  readonly projection: MeetingProjectionOutcome | undefined;
  /** Why the document was not read, when it was not. */
  readonly docFailure: MeetingDocFailure | undefined;
  /** Whether the store holds the transcript's row. */
  readonly inStore: boolean;
  readonly mode: ClearMeetingNotesMode;
}

/**
 * Judge one mail: proven (bronze AND the store), never transcribed, or kept and why. Pure.
 *
 * @param evidence what the run learned about the mail
 * @returns the outcome
 */
export function judgeMeeting({ evidence }: { evidence: MeetingEvidence }): MeetingOutcome {
  if (!evidence.recognised) {
    return kept({ reason: { kind: "not-a-meeting-mail" } });
  }
  if (!evidence.subjectParsed) {
    return kept({ reason: { kind: "subject-unparsed" } });
  }
  const { verdict } = evidence;
  if (verdict === "proven") {
    if (!evidence.inStore) {
      return kept({ reason: { kind: "not-in-store" } });
    }
    return { ingestedNow: evidence.ingestedNow, kind: "proven", sourceId: evidence.sourceId };
  }
  if (verdict !== "absent") {
    return kept({ reason: { kind: "bronze-mismatch", verdict } });
  }
  return absentOutcome({ evidence });
}

/** What becomes of a mail bronze does not hold: never transcribed, or kept and why. */
function absentOutcome({ evidence }: { evidence: MeetingEvidence }): MeetingOutcome {
  const { projection } = evidence;
  if (projection === undefined || projection.kind === "unread") {
    return kept({ reason: docFailureReason({ failure: evidence.docFailure }) });
  }
  if (projection.kind === "undated") {
    return kept({ reason: { kind: "undated" } });
  }
  if (projection.kind === "summary-only") {
    return { kind: "no-transcript" };
  }
  return kept({ reason: evidence.mode === "run" ? { kind: "not-held-after-commit" } : { kind: "would-ingest" } });
}

/** The kept reason a document failure maps to. */
function docFailureReason({ failure }: { failure: MeetingDocFailure | undefined }): KeptMeetingReason {
  if (failure === undefined) {
    return { kind: "provider-error", message: "no answer was recorded for its document" };
  }
  switch (failure.kind) {
    case "no-link":
      return { kind: "no-link" };
    case "malformed-link":
      return { kind: "malformed-link" };
    case "no-docs-grant":
      return { kind: "no-docs-grant" };
    case "provider-error":
      return { kind: "provider-error", message: failure.message };
    case "capped":
      return { kind: "capped" };
    default: {
      const unreachable: never = failure;
      return unreachable;
    }
  }
}

/** A kept outcome. */
function kept({ reason }: { reason: KeptMeetingReason }): MeetingOutcome {
  return { kind: "kept", reason };
}
