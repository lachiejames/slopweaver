/**
 * Whether gmail bronze holds the transcript a Gemini meeting-notes mail announced — proven by the meeting's TITLE
 * and DATE as well as by the record's identity, never by the mail alone.
 *
 * The only point of those mails is to say the system
 * has ingested the transcript and taken it on board, so the owner archives them only on confidence that every transcript
 * is pulled as it comes. The identity `<messageId>:meeting` binds a record to the mail that announced it
 * (`./project.ts`'s `projectMeetingTranscript`); the subject's title and date are what make a match mean "this
 * meeting" rather than "some row with that key". Both are compared as the bronze committer STORED them — through
 * the same redaction (`../redactRecord.ts`) — so a title that happens to carry a token-shaped string is not kept
 * unprovable forever.
 *
 * The read streams gmail bronze and parses only lines carrying a wanted identity, so its memory is the size of the
 * question, not of the mailbox. A wanted line that will not parse is a failure, never an absence: reading it as
 * absent would ingest again and keep the mail for a reason that is not true.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { OwnerProtectionResolver } from "../bronzeProtection.js";
import { listBronzeFiles } from "../bronzeStorage.js";
import { parseRow } from "../corpusRowCore.js";
import { readJsonlLines } from "../corpusStore.js";
import { latestWins } from "../latestRecords.js";
import { redactText } from "../redact.js";
import type { CorpusRecord } from "../types.js";

/** The container every gmail meeting transcript is filed under (`./project.ts`'s meeting bucket). */
const MEETING_CONTAINER = "mail/meetings";

/** What a Gemini notes mail says its transcript must look like in bronze. */
export interface MeetingProofExpectation {
  readonly messageId: string;
  /** The meeting title the subject named, as written. */
  readonly title: string;
  /** The meeting date the subject named, as written (`D Mon YYYY`). */
  readonly meetingDate: string;
}

/** Why bronze does or does not prove one meeting. */
export type MeetingBronzeVerdict = "proven" | "absent" | "wrong-kind" | "empty-text" | "wrong-title" | "wrong-date";

/** One mail's bronze proof. */
export interface MeetingBronzeProof {
  readonly messageId: string;
  readonly sourceId: string;
  readonly verdict: MeetingBronzeVerdict;
  /** The latest bronze row under the identity, when one exists. */
  readonly record: CorpusRecord | undefined;
}

/** A gmail bronze file could not be read at all. */
interface BronzeUnreadableError {
  readonly code: "BRONZE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A gmail bronze line carrying a wanted identity will not parse. */
interface BronzeMalformedError {
  readonly code: "BRONZE_MALFORMED";
  readonly message: string;
  readonly path: string;
  readonly line: number;
}

/** The owner's protect list refuses gmail bronze, or cannot be read, so no file of it was opened. */
interface BronzeProtectedError {
  readonly code: "BRONZE_PROTECTED";
  readonly message: string;
}

/** Why the proof read could not answer. */
export type MeetingProofError = BronzeUnreadableError | BronzeMalformedError | BronzeProtectedError;

/** The {@link MeetingProofError} factories. */
const MeetingProofErrors = {
  bronzeProtected: ({ message }: { message: string }): BronzeProtectedError => ({ code: "BRONZE_PROTECTED", message }),
  malformed: ({ path, line, reason }: { path: string; line: number; reason: string }): BronzeMalformedError => ({
    code: "BRONZE_MALFORMED",
    line,
    message: `gmail bronze ${path} line ${String(line + 1)} carries a meeting transcript and will not parse: ${reason}`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): BronzeUnreadableError => ({
    code: "BRONZE_UNREADABLE",
    message: `gmail bronze ${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
} as const;

/**
 * The identity a mail's transcript is stored under. Pure.
 *
 * @param messageId the carrier Gmail message id
 * @returns the bronze `sourceId`
 */
export function meetingSourceId({ messageId }: { messageId: string }): string {
  return `${messageId}:meeting`;
}

/**
 * Judge one bronze row against what its mail announced. Pure.
 *
 * @param record the latest gmail row under the mail's identity, when there is one
 * @param expectation the title and date the mail's subject named
 * @returns the verdict, first failing check first
 */
export function provesMeetingTranscript({
  record,
  expectation,
}: {
  record: CorpusRecord | undefined;
  expectation: MeetingProofExpectation;
}): MeetingBronzeProof {
  const sourceId = meetingSourceId({ messageId: expectation.messageId });
  const proof = ({ verdict }: { verdict: MeetingBronzeVerdict }): MeetingBronzeProof => ({
    messageId: expectation.messageId,
    record,
    sourceId,
    verdict,
  });
  if (record === undefined) {
    return proof({ verdict: "absent" });
  }
  if (record.kind !== "transcript" || record.container !== MEETING_CONTAINER) {
    return proof({ verdict: "wrong-kind" });
  }
  if (record.text.trim().length === 0) {
    return proof({ verdict: "empty-text" });
  }
  if (record.title !== redactText({ text: expectation.title }).text) {
    return proof({ verdict: "wrong-title" });
  }
  if (record.attrs?.["meetingDate"] !== redactText({ text: expectation.meetingDate }).text) {
    return proof({ verdict: "wrong-date" });
  }
  return proof({ verdict: "proven" });
}

/**
 * Read gmail bronze for each expected transcript and judge it.
 *
 * @param home the Slopweaver home whose bronze is read
 * @param expectations one per mail, each naming the title and date its subject carried
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns one proof per expectation, keyed by message id, or why bronze could not be read
 */
export function readMeetingTranscriptProofs({
  home,
  expectations,
  protection,
}: {
  home: string;
  expectations: readonly MeetingProofExpectation[];
  protection?: OwnerProtectionResolver | undefined;
}): Result<ReadonlyMap<string, MeetingBronzeProof>, MeetingProofError> {
  const wanted = new Set(expectations.map((expectation) => meetingSourceId({ messageId: expectation.messageId })));
  const latest = new Map<string, CorpusRecord>();
  if (wanted.size > 0) {
    const read = readWanted({ home, latest, protection, wanted });
    if (read.isErr()) {
      return err(read.error);
    }
  }
  return ok(
    new Map(
      expectations.map((expectation) => [
        expectation.messageId,
        provesMeetingTranscript({
          expectation,
          record: latest.get(meetingSourceId({ messageId: expectation.messageId })),
        }),
      ]),
    ),
  );
}

/** Stream every gmail bronze file, keeping the latest row for each wanted identity in `latest` (mutated). */
function readWanted({
  home,
  latest,
  protection,
  wanted,
}: {
  home: string;
  latest: Map<string, CorpusRecord>;
  protection: OwnerProtectionResolver | undefined;
  wanted: ReadonlySet<string>;
}): Result<void, MeetingProofError> {
  const needles = [...wanted].map((sourceId) => `"${sourceId}"`);
  const files = listBronzeFiles({ home, protection, source: "gmail", strict: true });
  if (files.isErr()) {
    if (files.error.code === "BRONZE_LIST_PROTECTED") {
      return err(MeetingProofErrors.bronzeProtected({ message: files.error.message }));
    }
    return err(MeetingProofErrors.unreadable({ cause: files.error.message, path: files.error.path }));
  }
  for (const file of files.value) {
    let malformed: MeetingProofError | undefined;
    try {
      readJsonlLines({
        onLine: ({ line, index }) => {
          if (malformed !== undefined || !needles.some((needle) => line.includes(needle))) {
            return;
          }
          const parsed = parseRow({ line });
          if ("error" in parsed) {
            malformed = MeetingProofErrors.malformed({ line: index, path: file.path, reason: parsed.error });
            return;
          }
          keepLatest({ latest, record: parsed.record, wanted });
        },
        path: file.path,
      });
    } catch (cause: unknown) {
      return err(MeetingProofErrors.unreadable({ cause, path: file.path }));
    }
    if (malformed !== undefined) {
      return err(malformed);
    }
  }
  return ok(undefined);
}

/** Hold `record` when it is a wanted gmail identity and later than the one held (`latest` is mutated). */
function keepLatest({
  latest,
  record,
  wanted,
}: {
  latest: Map<string, CorpusRecord>;
  record: CorpusRecord;
  wanted: ReadonlySet<string>;
}): void {
  if (record.source !== "gmail" || !wanted.has(record.sourceId)) {
    return;
  }
  const incumbent = latest.get(record.sourceId);
  if (incumbent === undefined || latestWins({ candidate: record, incumbent })) {
    latest.set(record.sourceId, record);
  }
}
