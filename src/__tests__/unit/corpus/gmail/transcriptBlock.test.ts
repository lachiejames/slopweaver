/**
 * Finding the raw transcript inside a meeting-notes document, and refusing a document that has none.
 *
 * The fixtures are the two shapes measured on a real corpus: a document with a tab
 * titled `Transcript` beside a `Notes` tab (40 of 60 read documents), and a single-tab document carrying
 * its transcript under a bare `Transcript` line (1 of 60). The refusals are the third measured shape —
 * a summary and nothing else (19 of 60).
 */
import { describe, expect, it } from "vitest";

import {
  afterTranscriptMarker,
  MIN_SPEAKER_LINES,
  speakerLineCount,
  transcriptBlock,
} from "../../../../corpus/gmail/transcriptBlock.js";
import type { DocContent } from "../../../../live/gmail/docs.js";

const doc = ({ tabs }: { tabs: DocContent["tabs"] }): DocContent => ({ documentId: "d1", tabs, title: "Standup" });

const NOTES_TAB = {
  text: "Standup\nInvited\nAttachments\nSummary\nThe team aligned on the plan.",
  title: "Notes",
};

const TRANSCRIPT_TAB = {
  text: "Standup - Transcript\n00:00:00\nAna Diaz: morning all\nBo Chen: morning",
  title: "Transcript",
};

describe("speakerLineCount", () => {
  it("counts lines of the form `Name: what they said`", () => {
    expect(speakerLineCount({ text: "Ana: hello\n00:00:12\nBo: hi there" })).toBe(2);
  });

  it("does not count a line whose colon has nothing after it", () => {
    expect(speakerLineCount({ text: "Attendees:\nSummary:" })).toBe(0);
  });

  it("is zero for prose with no speaker lines at all", () => {
    expect(speakerLineCount({ text: "The team aligned on the plan.\nNo colons here" })).toBe(0);
  });
});

describe("afterTranscriptMarker", () => {
  it("returns everything below a bare `Transcript` line, dropping the marker", () => {
    const text =
      "the owner / Chai - Transcript\nAttendees\nChai Ng, Ada Owner\nTranscript\nChai Ng: yeah\nAda Owner: okay";

    expect(afterTranscriptMarker({ text })).toBe("Chai Ng: yeah\nAda Owner: okay");
  });

  it("is undefined when the tab carries no marker line, rather than returning the whole tab", () => {
    expect(afterTranscriptMarker({ text: NOTES_TAB.text })).toBe(undefined);
  });

  it("is undefined when the marker is the last line, so nothing follows it", () => {
    expect(afterTranscriptMarker({ text: "Summary\nThe team met.\nTranscript" })).toBe(undefined);
  });

  it("matches the marker case-insensitively and ignores surrounding whitespace", () => {
    expect(afterTranscriptMarker({ text: "Header\n  TRANSCRIPT  \nAna: hello" })).toBe("Ana: hello");
  });
});

describe("transcriptBlock", () => {
  it("takes the tab titled `Transcript`, whole, including its own header line", () => {
    const found = transcriptBlock({ document: doc({ tabs: [NOTES_TAB, TRANSCRIPT_TAB] }) })!;

    expect(found.text).toBe("Standup - Transcript\n00:00:00\nAna Diaz: morning all\nBo Chen: morning");
    expect(found.foundBy).toBe("tab");
    expect(found.speakerLines).toBe(2);
  });

  it("finds a transcript marked inline in a single untitled tab", () => {
    const inline = {
      text: "the owner / Chai - Transcript\nAttendees\nChai Ng, Ada Owner\nTranscript\nChai Ng: yeah\nAda Owner: okay",
      title: "Tab 1",
    };
    const found = transcriptBlock({ document: doc({ tabs: [inline] }) })!;

    expect(found.text).toBe("Chai Ng: yeah\nAda Owner: okay");
    expect(found.foundBy).toBe("inline");
  });

  it("prefers a titled tab over an inline marker in another tab", () => {
    const marked = { text: "Transcript\nCarl: stray line\nDee: another", title: "Appendix" };
    expect(transcriptBlock({ document: doc({ tabs: [marked, TRANSCRIPT_TAB] }) })!.foundBy).toBe("tab");
  });

  it("REFUSES a document whose only tab is Gemini's summary", () => {
    expect(transcriptBlock({ document: doc({ tabs: [NOTES_TAB] }) })).toBe(undefined);
  });

  it("REFUSES a tab titled `Transcript` that carries no speech, so a label cannot stand in for one", () => {
    const empty = { text: "Standup - Transcript\nNo transcript was recorded for this meeting.", title: "Transcript" };
    expect(transcriptBlock({ document: doc({ tabs: [empty] }) })).toBe(undefined);
  });

  it("REFUSES a candidate one speaker line short of the bound", () => {
    const thin = { text: "Standup - Transcript\nAna Diaz: morning all", title: "Transcript" };
    expect(speakerLineCount({ text: thin.text })).toBe(MIN_SPEAKER_LINES - 1);
    expect(transcriptBlock({ document: doc({ tabs: [thin] }) })).toBe(undefined);
  });

  it("falls through a thin titled tab to a real inline one rather than refusing the document", () => {
    const thin = { text: "Standup - Transcript", title: "Transcript" };
    const inline = { text: "Transcript\nAna Diaz: morning\nBo Chen: hi", title: "Tab 1" };

    expect(transcriptBlock({ document: doc({ tabs: [thin, inline] }) })!.foundBy).toBe("inline");
  });

  it("REFUSES a document with no tabs at all", () => {
    expect(transcriptBlock({ document: doc({ tabs: [] }) })).toBe(undefined);
  });
});
