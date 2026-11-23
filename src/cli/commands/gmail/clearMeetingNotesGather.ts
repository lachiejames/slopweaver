/**
 * `gmail clear-meeting-notes`'s evidence half: prove what bronze already holds, read the document only for a
 * meeting bronze lacks, commit what projects, prove AGAIN off bronze as it now stands (never off the commit's own
 * word), make the store hold what bronze proves, and judge every mail. Nothing here archives; the run acts on the
 * dispositions this answers (`./clearMeetingNotesRun.ts`).
 */
import { isMeetingNotesEmail, parseMeetingSubject } from "../../../corpus/gmail/geminiNotes.js";
import type { MeetingDocResult } from "../../../corpus/gmail/meetingDocs.js";
import {
  type MeetingBronzeProof,
  type MeetingBronzeVerdict,
  type MeetingProofExpectation,
  meetingSourceId,
} from "../../../corpus/gmail/meetingProof.js";
import { type MeetingProjectionOutcome, meetingProjection } from "../../../corpus/gmail/project.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { MeetingNotesMail } from "../../../live/gmail/meetingNotesRead.js";
import type { ParsedGmailMessage } from "../../../live/gmail/parse.js";
import { contentFactsOf } from "../../../store/contentMatch.js";
import { type ClearMeetingNotesMode, judgeMeeting, type MeetingDisposition } from "./clearMeetingNotesCore.js";
import type { ClearMeetingNotesError } from "./clearMeetingNotesErrors.js";
import type { ClearMeetingNotesDeps } from "./clearMeetingNotesRun.js";

/** The one attribute a proven transcript is matched on beside kind, title and body: the date the mail named. */
export const MEETING_DATE_ATTR = "meetingDate";

/** What reading the documents bronze lacked produced. */
interface DocsRead {
  readonly projections: ReadonlyMap<string, MeetingProjectionOutcome>;
  readonly failures: MeetingDocResult["failures"];
}

/**
 * Prove, ingest what is missing, prove again, make the store hold it, and judge every mail.
 *
 * @param mail what the mailbox read answered
 * @param mode a real run commits and replays; a dry run and an audit only read
 * @returns one disposition per parsed mail, or the first step that could not be taken
 */
export async function gatherMeetingDispositions({
  deps,
  home,
  mail,
  mode,
}: {
  deps: ClearMeetingNotesDeps;
  home: string;
  mail: MeetingNotesMail;
  mode: ClearMeetingNotesMode;
}): Promise<Result<readonly MeetingDisposition[], ClearMeetingNotesError>> {
  const expectations = proofExpectations({ messages: mail.messages });
  const before = deps.readProofs({ expectations, home });
  if (before.isErr()) {
    return err(before.error);
  }
  const absent = mail.messages.filter((message) => before.value.get(message.id)?.verdict === "absent");
  const read = await readAbsent({ absent, deps, home });
  if (read.isErr()) {
    return err(read.error);
  }
  const after = commitProjected({ deps, expectations, home, mode, projections: read.value.projections });
  if (after.isErr()) {
    return err(after.error);
  }
  const held = await holdInStore({ deps, expectations, home, mode, proofs: after.value });
  if (held.isErr()) {
    return err(held.error);
  }
  return ok(
    mail.messages.map((message) =>
      dispositionOf({ after: after.value, before: before.value, held: held.value, message, mode, read: read.value }),
    ),
  );
}

/** What each recognised mail whose subject named a title and a date must be proven against. */
function proofExpectations({ messages }: { messages: readonly ParsedGmailMessage[] }): MeetingProofExpectation[] {
  const expectations: MeetingProofExpectation[] = [];
  for (const message of messages) {
    const subject = parseMeetingSubject({ subject: message.subject });
    const named = subject.meetingTitle !== undefined && subject.meetingDateText !== undefined;
    if (isMeetingNotesEmail({ message }) && named) {
      expectations.push({ meetingDate: subject.meetingDateText!, messageId: message.id, title: subject.meetingTitle! });
    }
  }
  return expectations;
}

/** Bronze's verdict on one mail now; a mail never asked about (no expectation) was never proven, so `absent`. */
function verdictOf({
  proofs,
  messageId,
}: {
  proofs: ReadonlyMap<string, MeetingBronzeProof>;
  messageId: string;
}): MeetingBronzeVerdict {
  const proof = proofs.get(messageId);
  if (proof === undefined) {
    return "absent";
  }
  return proof.verdict;
}

/** One mail's disposition, from everything the steps learned about it. */
function dispositionOf({
  after,
  before,
  held,
  message,
  mode,
  read,
}: {
  after: ReadonlyMap<string, MeetingBronzeProof>;
  before: ReadonlyMap<string, MeetingBronzeProof>;
  held: ReadonlySet<string>;
  message: ParsedGmailMessage;
  mode: ClearMeetingNotesMode;
  read: DocsRead;
}): MeetingDisposition {
  const subject = parseMeetingSubject({ subject: message.subject });
  const sourceId = meetingSourceId({ messageId: message.id });
  const verdict = verdictOf({ messageId: message.id, proofs: after });
  return {
    inInbox: message.labelIds.includes("INBOX"),
    meetingDate: subject.meetingDateText,
    messageId: message.id,
    outcome: judgeMeeting({
      evidence: {
        docFailure: read.failures.get(message.id),
        inStore: held.has(sourceId),
        ingestedNow: before.get(message.id)?.verdict === "absent" && verdict === "proven",
        mode,
        projection: read.projections.get(message.id),
        recognised: isMeetingNotesEmail({ message }),
        sourceId,
        subjectParsed: before.has(message.id),
        verdict,
      },
    }),
    title: subject.meetingTitle,
  };
}

/** Read the document of every mail bronze lacks, and project each. */
async function readAbsent({
  absent,
  deps,
  home,
}: {
  absent: readonly ParsedGmailMessage[];
  deps: ClearMeetingNotesDeps;
  home: string;
}): Promise<Result<DocsRead, ClearMeetingNotesError>> {
  if (absent.length === 0) {
    return ok({ failures: new Map(), projections: new Map() });
  }
  const docs = await deps.fetchDocs({ home, messages: absent });
  if (docs.isErr()) {
    return err(docs.error);
  }
  for (const warning of docs.value.warnings) {
    deps.writeDiagnostic(warning);
  }
  const projections = new Map(
    absent.map((message) => [
      message.id,
      meetingProjection({ document: docs.value.documents.get(message.id), message }),
    ]),
  );
  return ok({ failures: docs.value.failures, projections });
}

/** Commit every projected transcript (a real run only), then re-read bronze; answers the proofs as they stand. */
function commitProjected({
  deps,
  expectations,
  home,
  mode,
  projections,
}: {
  deps: ClearMeetingNotesDeps;
  expectations: readonly MeetingProofExpectation[];
  home: string;
  mode: ClearMeetingNotesMode;
  projections: ReadonlyMap<string, MeetingProjectionOutcome>;
}): Result<ReadonlyMap<string, MeetingBronzeProof>, ClearMeetingNotesError> {
  const records = [...projections.values()].flatMap((projection) =>
    projection.kind === "projected" ? [projection.record] : [],
  );
  if (mode === "run" && records.length > 0) {
    const committed = deps.commit({ home, records });
    if (committed.isErr()) {
      return err(committed.error);
    }
    const { written, deduped, excluded } = committed.value;
    deps.writeOut(
      `transcripts committed to gmail bronze: ${String(written)} written · ${String(deduped)} already held · ` +
        `${String(excluded)} excluded by the sync denylist`,
    );
  }
  return deps.readProofs({ expectations, home });
}

/**
 * The proven transcripts the store holds as bronze proved them, replaying gmail bronze once when one is missing or
 * stale (a real run).
 */
async function holdInStore({
  deps,
  expectations,
  home,
  mode,
  proofs,
}: {
  deps: ClearMeetingNotesDeps;
  expectations: readonly MeetingProofExpectation[];
  home: string;
  mode: ClearMeetingNotesMode;
  proofs: ReadonlyMap<string, MeetingBronzeProof>;
}): Promise<Result<ReadonlySet<string>, ClearMeetingNotesError>> {
  const expected = expectations.flatMap((expectation) => {
    const proof = proofs.get(expectation.messageId);
    return proof?.verdict === "proven" ? [contentFactsOf({ attrKey: MEETING_DATE_ATTR, record: proof.record! })] : [];
  });
  if (expected.length === 0) {
    return ok(new Set());
  }
  const first = await deps.storeHolds({ expected, home });
  if (first.isErr() || mode !== "run" || expected.every((facts) => first.value.has(facts.sourceId))) {
    return first;
  }
  const replayed = await deps.replayStore({ home });
  if (replayed.isErr()) {
    return err(replayed.error);
  }
  deps.writeOut(replayed.value);
  return deps.storeHolds({ expected, home });
}
