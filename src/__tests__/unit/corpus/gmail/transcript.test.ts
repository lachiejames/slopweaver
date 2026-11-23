/**
 * Projecting a Gemini meeting-notes email into a `transcript` record.
 *
 * The properties worth pinning: a meeting is projected as a MEETING and never also as a message, the
 * record holds the RAW transcript and none of Gemini's summary, a meeting with no transcript produces no
 * record at all rather than a summary wearing the transcript kind, and a mail record can never come back
 * public.
 */
import { describe, expect, it } from "vitest";

import { readMeetingNotesEmail } from "../../../../corpus/gmail/geminiNotes.js";
import {
  MAX_TRANSCRIPT_CHARS,
  meetingBody,
  meetingProjection,
  projectGmailMessages,
  projectMeetingTranscript,
} from "../../../../corpus/gmail/project.js";
import type { DocContent } from "../../../../live/gmail/docs.js";
import type { ParsedGmailMessage } from "../../../../live/gmail/parse.js";

const NOTES: ParsedGmailMessage = {
  attachments: [],
  body: "Notes from 'Widget Working Group'\n\nSummary\nThe team met.\n\n[Ana Diaz] Build the indexer.",
  bodyFormat: "text",
  cc: [],
  from: "Gemini <gemini-notes@google.com>",
  htmlLinks: ["https://docs.google.com/document/d/abc123/edit?tab=t.0"],
  id: "m1",
  labelIds: ["CATEGORY_UPDATES"],
  sentAtIso: "2026-08-25T02:08:54.000Z",
  snippet: undefined,
  subject: "Notes: 'Widget Working Group' 25 Aug 2026",
  threadId: "t1",
  to: ["me@example.test"],
};

const DOCUMENT: DocContent = {
  documentId: "abc123",
  tabs: [
    { text: "Attendees: Ana Diaz, Bo Chen\nSummary\nThe team met and agreed.", title: "Notes" },
    { text: "Widget Working Group - Transcript\n00:00:00\nAna: shall we ship it\nBo: yes", title: "Transcript" },
  ],
  title: "Widget Working Group",
};

/** The same meeting's document with the summary tab alone — the call was never transcribed. */
const SUMMARY_ONLY: DocContent = {
  documentId: "abc123",
  tabs: [{ text: "Attendees: Ana Diaz, Bo Chen\nSummary\nThe team met and agreed.", title: "Notes" }],
  title: "Widget Working Group",
};

const project = ({ document }: { document: DocContent | undefined }) =>
  projectMeetingTranscript({ document, message: NOTES, notes: readMeetingNotesEmail({ message: NOTES }) });

describe("meetingBody", () => {
  it("is the raw transcript and nothing else", () => {
    expect(meetingBody({ transcript: "Ana: shall we ship it\nBo: yes" })).toEqual({
      droppedChars: 0,
      text: "Ana: shall we ship it\nBo: yes",
    });
  });

  it("truncates past the bound and REPORTS what it dropped", () => {
    const long = "x".repeat(MAX_TRANSCRIPT_CHARS + 500);
    const body = meetingBody({ transcript: long });

    expect(body.text.length).toBe(MAX_TRANSCRIPT_CHARS);
    expect(body.droppedChars).toBe(500);
  });
});

describe("projectMeetingTranscript", () => {
  it("carries the MEETING's title and date, not the email's subject", () => {
    const record = project({ document: DOCUMENT })!;

    expect(record.kind).toBe("transcript");
    expect(record.title).toBe("Widget Working Group");
    expect(record.attrs?.["meetingDate"]).toBe("25 Aug 2026");
    expect(record.tsIso).toBe("2026-08-25T02:08:54.000Z");
  });

  it("stores the transcript alone — not the email's summary, not the notes tab", () => {
    const record = project({ document: DOCUMENT })!;

    expect(record.text).toBe("Widget Working Group - Transcript\n00:00:00\nAna: shall we ship it\nBo: yes");
    expect(record.text.includes("The team met")).toBe(false);
    expect(record.attrs?.["transcriptChars"]).toBe(record.text.length);
  });

  it("records HOW the transcript was recognised and on what evidence", () => {
    const record = project({ document: DOCUMENT })!;

    expect(record.attrs?.["transcriptFoundBy"]).toBe("tab");
    expect(record.attrs?.["transcriptSpeakerLines"]).toBe(2);
  });

  it("merges the roster from the document and the email's next-step owners", () => {
    const record = project({ document: DOCUMENT })!;

    expect(record.attrs?.["attendees"]).toEqual(["Ana Diaz", "Bo Chen"]);
    expect(record.attrs?.["attendeeCount"]).toBe(2);
  });

  it("links the document rather than the mail permalink", () => {
    expect(project({ document: DOCUMENT })!.url).toBe("https://docs.google.com/document/d/abc123/edit?tab=t.0");
  });

  it("REFUSES a document that carries only Gemini's summary, rather than storing it", () => {
    expect(project({ document: SUMMARY_ONLY })).toBe(undefined);
  });

  it("REFUSES a meeting whose document was not read, rather than falling back to the email", () => {
    expect(project({ document: undefined })).toBe(undefined);
  });

  it("stamps the record private, like every mail record", () => {
    expect(project({ document: DOCUMENT })!.visibility).toBe("private");
  });

  it("suffixes the dedup key so it can never collide with the carrier email's own record", () => {
    expect(project({ document: DOCUMENT })!.sourceId).toBe("m1:meeting");
  });

  it("declines a carrier with no send time rather than dating it from the clock", () => {
    const undated = { ...NOTES, sentAtIso: undefined };
    expect(
      projectMeetingTranscript({
        document: DOCUMENT,
        message: undated,
        notes: readMeetingNotesEmail({ message: undated }),
      }),
    ).toBe(undefined);
  });
});

describe("meetingProjection", () => {
  it("answers the record projectMeetingTranscript stores, so the two can never disagree", () => {
    expect(meetingProjection({ document: DOCUMENT, message: NOTES })).toEqual({
      kind: "projected",
      messageId: "m1",
      record: project({ document: DOCUMENT }),
    });
  });

  it("names each refusal, testing an undated carrier before its document", () => {
    const undated = { ...NOTES, sentAtIso: undefined };
    expect([
      meetingProjection({ document: SUMMARY_ONLY, message: undated }),
      meetingProjection({ document: undefined, message: NOTES }),
      meetingProjection({ document: SUMMARY_ONLY, message: NOTES }),
    ]).toEqual([
      { kind: "undated", messageId: "m1" },
      { kind: "unread", messageId: "m1" },
      { kind: "summary-only", messageId: "m1" },
    ]);
  });
});

describe("projectGmailMessages routing", () => {
  it("projects a recognised notes email as a MEETING and not also as a message", () => {
    const projected = projectGmailMessages({
      meetingDocs: new Map([["m1", DOCUMENT]]),
      messages: [NOTES],
    });

    expect(projected.records.length).toBe(1);
    expect(projected.records[0]!.kind).toBe("transcript");
    expect(projected.warnings).toEqual([]);
  });

  it("projects ordinary mail as a message, even when it links a Google Doc", () => {
    const ordinary: ParsedGmailMessage = { ...NOTES, from: "Ana <ana@example.test>", id: "m2" };
    const projected = projectGmailMessages({ messages: [ordinary] });

    expect(projected.records[0]!.kind).toBe("message");
  });

  it("stores nothing for a meeting whose document was not read, and says how many that cost", () => {
    const projected = projectGmailMessages({ meetingDocs: new Map(), messages: [NOTES] });

    expect(projected.records).toEqual([]);
    expect(projected.warnings.length).toBe(1);
    expect(projected.warnings[0]!).toContain("1 meeting(s) were not stored");
    expect(projected.warnings[0]!).toContain("could not be read");
  });

  it("names the summary-only refusal separately, since nothing but transcription recovers it", () => {
    const projected = projectGmailMessages({ meetingDocs: new Map([["m1", SUMMARY_ONLY]]), messages: [NOTES] });

    expect(projected.records).toEqual([]);
    expect(projected.warnings.length).toBe(1);
    expect(projected.warnings[0]!).toContain("summary and no transcript");
  });

  it("aggregates refusals into one line per kind rather than one per meeting", () => {
    const second: ParsedGmailMessage = { ...NOTES, id: "m2" };
    const third: ParsedGmailMessage = { ...NOTES, id: "m3" };
    const projected = projectGmailMessages({ meetingDocs: new Map(), messages: [NOTES, second, third] });

    expect(projected.warnings.length).toBe(1);
    expect(projected.warnings[0]!).toContain("3 meeting(s) were not stored");
  });
});
