/**
 * Recognising a Gemini / Google Meet meeting-notes email, and reading the meeting out of it.
 *
 * The subject and body shapes below are the ones Google actually sends, taken from a real mailbox
 * and re-typed here with invented meeting names and people — nothing from a real mailbox goes
 * into a fixture (`skills/gmail/SKILL.md`, "Never put mail content in a commit").
 */
import { describe, expect, it } from "vitest";

import {
  bracketedOwners,
  documentAttendees,
  documentLink,
  isMeetingNotesEmail,
  MAX_STORED_ATTENDEES,
  mergeAttendees,
  parseMeetingSubject,
  readMeetingNotesEmail,
  senderAddress,
} from "../../../../corpus/gmail/geminiNotes.js";
import type { ParsedGmailMessage } from "../../../../live/gmail/parse.js";

const BASE: ParsedGmailMessage = {
  attachments: [],
  body: "",
  bodyFormat: "text",
  cc: [],
  from: "Gemini <gemini-notes@google.com>",
  htmlLinks: [],
  id: "m1",
  labelIds: [],
  sentAtIso: "2026-08-25T02:08:54.000Z",
  snippet: undefined,
  subject: "Notes: 'Widget Working Group' 25 Aug 2026",
  threadId: "t1",
  to: [],
};

const message = (over: Partial<ParsedGmailMessage> = {}): ParsedGmailMessage => ({ ...BASE, ...over });

describe("senderAddress", () => {
  it("takes the address out of a display-name header, lower-cased", () => {
    expect(senderAddress({ header: "Gemini <Gemini-Notes@Google.com>" })).toBe("gemini-notes@google.com");
  });

  it("drops a comment wherever it sits, angled or bare, and reads a quoted parenthesis as text", () => {
    const addresses = [
      "Gemini <gemini-notes@google.com> (Google Meet)",
      "gemini-notes@google.com (Google Meet)",
      "(Google (Meet)) gemini-notes@google.com",
      '"Gemini (notes" <gemini-notes@google.com>',
      "gemini-notes@google.com (unclosed",
      "Gemini <gemini-notes (Google) @google.com>",
      'Gemini <"gemini-notes"@google.com>',
      "Gemini <gemini-notes@google.com> <",
      "Gemini <gemini-notes@google.com> >",
      "Gem<ini <gemini-notes@google.com>",
    ].map((header) => senderAddress({ header }));
    expect(addresses).toEqual(Array.from({ length: 10 }, () => "gemini-notes@google.com"));
  });

  it("treats a bare address as the address", () => {
    expect(senderAddress({ header: "  gemini-notes@google.com " })).toBe("gemini-notes@google.com");
  });

  it("is undefined for a header that is not there, rather than an empty string", () => {
    expect(senderAddress({ header: undefined })).toBe(undefined);
    expect(senderAddress({ header: "   " })).toBe(undefined);
  });
});

describe("isMeetingNotesEmail", () => {
  it("recognises both of Google's meeting senders", () => {
    expect(isMeetingNotesEmail({ message: message() })).toBe(true);
    expect(isMeetingNotesEmail({ message: message({ from: "Google Meet <meetings-noreply@google.com>" }) })).toBe(true);
  });

  it("does NOT recognise a lookalike subject from anyone else, which is the whole point of matching the sender", () => {
    const spoof = message({
      from: "Someone <someone@example.test>",
      subject: "Notes: 'Widget Working Group' 25 Aug 2026",
    });
    expect(isMeetingNotesEmail({ message: spoof })).toBe(false);
  });

  it("does not recognise ordinary mail from the same sender's domain", () => {
    expect(isMeetingNotesEmail({ message: message({ from: "Google <no-reply@google.com>" }) })).toBe(false);
  });
});

describe("parseMeetingSubject", () => {
  it("splits the Gemini notes subject into the meeting title and the date as written", () => {
    expect(parseMeetingSubject({ subject: "Notes: 'Widget Working Group' 25 Aug 2026" })).toEqual({
      meetingDateText: "25 Aug 2026",
      meetingTitle: "Widget Working Group",
    });
  });

  it("splits the Meet records subject the same way", () => {
    expect(parseMeetingSubject({ subject: "Meeting records: 'Ana / Bo' 17 Apr 2026" })).toEqual({
      meetingDateText: "17 Apr 2026",
      meetingTitle: "Ana / Bo",
    });
  });

  it("keeps an apostrophe inside the title, taking the LAST quote as the close", () => {
    expect(parseMeetingSubject({ subject: "Notes: 'Bo's weekly' 1 Jan 2026" }).meetingTitle).toBe("Bo's weekly");
  });

  it("yields neither field for a subject that does not carry the shape, rather than inventing a title", () => {
    expect(parseMeetingSubject({ subject: "Your meeting notes are ready" })).toEqual({
      meetingDateText: undefined,
      meetingTitle: undefined,
    });
    expect(parseMeetingSubject({ subject: undefined })).toEqual({
      meetingDateText: undefined,
      meetingTitle: undefined,
    });
  });
});

describe("bracketedOwners", () => {
  it("takes the named owner of each suggested next step, in first-seen order, deduplicated", () => {
    const body = ["[Ana Diaz] Build the indexer.", "", "[Bo Chen] Migrate the platform.", "", "[Ana Diaz] Again."].join(
      "\n",
    );
    expect(bracketedOwners({ body })).toEqual(["Ana Diaz", "Bo Chen"]);
  });

  it("drops the group placeholder, which is not a person", () => {
    expect(bracketedOwners({ body: "[The group] Automate device cleanup." })).toEqual([]);
  });

  it("only matches a bracket that OPENS a line, so a bracket mid-sentence is not a name", () => {
    expect(bracketedOwners({ body: "The team agreed [see the doc] to proceed." })).toEqual([]);
  });

  it("finds nothing in a body with no next steps", () => {
    expect(bracketedOwners({ body: "Summary\nThe team met." })).toEqual([]);
  });

  it("splits a bracket naming two people into two attendees, so no composite person is minted", () => {
    expect(bracketedOwners({ body: "[Ana Diaz, Bo Chen] Provide feedback on the draft." })).toEqual([
      "Ana Diaz",
      "Bo Chen",
    ]);
  });

  it("splits a bracket naming three people, and dedupes one already seen in an earlier bracket", () => {
    const body = ["[Ana Diaz] Build the indexer.", "", "[Bo Chen, Ana Diaz, Cai Okonkwo] Review it."].join("\n");
    expect(bracketedOwners({ body })).toEqual(["Ana Diaz", "Bo Chen", "Cai Okonkwo"]);
  });

  it("drops the group placeholder from a MIXED bracket while keeping the person beside it", () => {
    expect(bracketedOwners({ body: "[Ana Diaz, The group] Automate device cleanup." })).toEqual(["Ana Diaz"]);
  });

  it("drops an empty element, so a trailing or doubled comma contributes no nameless attendee", () => {
    expect(bracketedOwners({ body: "[Ana Diaz, , Bo Chen,] Ship it." })).toEqual(["Ana Diaz", "Bo Chen"]);
  });
});

describe("documentLink", () => {
  it("takes the Google Docs link out of the HTML link set", () => {
    const links = ["https://support.google.com/meet", "https://docs.google.com/document/d/abc123/edit?tab=t.0"];
    expect(documentLink({ links })).toBe("https://docs.google.com/document/d/abc123/edit?tab=t.0");
  });

  it("is undefined when the email linked no document", () => {
    expect(documentLink({ links: ["https://meet.google.com/xyz"] })).toBe(undefined);
    expect(documentLink({ links: [] })).toBe(undefined);
  });
});

describe("readMeetingNotesEmail", () => {
  it("reads the title, the date text, the document link, the summary and the named owners", () => {
    const read = readMeetingNotesEmail({
      message: message({
        body: "Summary\nThe team met.\n\n[Ana Diaz] Build the indexer.",
        htmlLinks: ["https://docs.google.com/document/d/abc123/edit"],
      }),
    });

    expect(read.meetingTitle).toBe("Widget Working Group");
    expect(read.meetingDateText).toBe("25 Aug 2026");
    expect(read.documentUrl).toBe("https://docs.google.com/document/d/abc123/edit");
    expect(read.attendees).toEqual(["Ana Diaz"]);
    expect(read.summary).toBe("Summary\nThe team met.\n\n[Ana Diaz] Build the indexer.");
    expect(read.messageId).toBe("m1");
  });

  it("still reads the summary and the link when the subject shape is one it does not know", () => {
    const read = readMeetingNotesEmail({
      message: message({
        body: "Summary",
        htmlLinks: ["https://docs.google.com/document/d/abc123/edit"],
        subject: "Your meeting notes",
      }),
    });

    expect(read.meetingTitle).toBe(undefined);
    expect(read.documentUrl).toBe("https://docs.google.com/document/d/abc123/edit");
  });
});

describe("documentAttendees", () => {
  it("reads the roster off the document's own attendee line", () => {
    expect(documentAttendees({ text: "Widget Working Group\nAttendees: Ana Diaz, Bo Chen, Cy Ford\nSummary" })).toEqual(
      ["Ana Diaz", "Bo Chen", "Cy Ford"],
    );
  });

  it("accepts the Participants spelling too", () => {
    expect(documentAttendees({ text: "Participants: Ana Diaz" })).toEqual(["Ana Diaz"]);
  });

  it("contributes nothing when the document names no roster, rather than guessing one", () => {
    expect(documentAttendees({ text: "Summary\nThe team met." })).toEqual([]);
  });
});

describe("mergeAttendees", () => {
  it("puts the document's roster first and appends only names the email adds", () => {
    const merged = mergeAttendees({ fromDocument: ["Ana Diaz", "Bo Chen"], fromEmail: ["Bo Chen", "Cy Ford"] });
    expect(merged.attendees).toEqual(["Ana Diaz", "Bo Chen", "Cy Ford"]);
    expect(merged.attendeeCount).toBe(3);
  });

  it("deduplicates case-insensitively, keeping the first spelling seen", () => {
    const merged = mergeAttendees({ fromDocument: ["Ana Diaz"], fromEmail: ["ANA DIAZ"] });
    expect(merged.attendees).toEqual(["Ana Diaz"]);
  });

  it("bounds the stored roster while the count keeps the real size, so a truncated list never reads as whole", () => {
    const many = Array.from({ length: MAX_STORED_ATTENDEES + 7 }, (_unused, index) => `Person ${String(index)}`);
    const merged = mergeAttendees({ fromDocument: many, fromEmail: [] });

    expect(merged.attendees.length).toBe(MAX_STORED_ATTENDEES);
    expect(merged.attendeeCount).toBe(MAX_STORED_ATTENDEES + 7);
  });
});
