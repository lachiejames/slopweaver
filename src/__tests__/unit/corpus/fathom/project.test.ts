/**
 * Unit: the pure bronze projection of a Fathom meeting. Four properties are pinned because a later reader
 * cannot recover any of them if they are wrong — the record holds the RAW words and never the provider's
 * summary, it is dated by the recording rather than by when Fathom finished processing it, it is private
 * whatever the caller asks for, and its dedup key is the recording id its own URL carries.
 */
import { describe, expect, it } from "vitest";

import {
  FATHOM_BUCKET,
  fathomSpeakers,
  fathomTranscriptBody,
  projectFathomMeeting,
  projectFathomMeetings,
  TRANSCRIPT_CHAR_CAP,
} from "../../../../corpus/fathom/project.js";
import type { FathomMeeting, FathomTranscriptItem } from "../../../../corpus/fathom/types.js";

function line({ at, who, said }: { at: string; who: string; said: string }): FathomTranscriptItem {
  return { speaker: { displayName: who }, text: said, timestamp: at };
}

const TRANSCRIPT: readonly FathomTranscriptItem[] = [
  line({ at: "00:00:04", said: "Right, shall we start with the audit findings?", who: "Felix" }),
  line({ at: "00:00:11", said: "Yes — we are at sixty percent on the score.", who: "Ada" }),
  line({ at: "00:01:02", said: "Then the first thing is the failing tests.", who: "Felix" }),
];

function meeting(over: Partial<FathomMeeting> = {}): FathomMeeting {
  return {
    attendees: ["Felix", "Ada"],
    createdAtIso: "2026-09-10T22:10:00.000Z",
    invitees: [
      { email: "felix@vendor.test", isExternal: true, name: "Felix" },
      { email: "ada@org.test", isExternal: false, name: "Ada" },
    ],
    recordedByName: "Ada",
    recordingEndIso: "2026-09-09T04:12:00.000Z",
    recordingId: 806772530,
    recordingStartIso: "2026-09-09T03:00:00.000Z",
    scheduledStartIso: "2026-09-09T03:00:00.000Z",
    sharedWith: "single_team",
    title: "Weekly Working Session",
    transcript: TRANSCRIPT,
    transcriptLanguage: "en",
    url: "https://fathom.video/calls/806772530",
    ...over,
  };
}

describe("projectFathomMeeting", () => {
  it("stores the raw words with their speaker and offset, verbatim", () => {
    const record = projectFathomMeeting({ meeting: meeting() })!;
    expect(record.text).toBe(
      "[00:00:04] Felix: Right, shall we start with the audit findings?\n" +
        "[00:00:11] Ada: Yes — we are at sixty percent on the score.\n" +
        "[00:01:02] Felix: Then the first thing is the failing tests.",
    );
  });

  it("dates the record by the recording, not by when Fathom finished processing it", () => {
    // The whole reason this lane exists: the call was created the day AFTER it happened, so a record
    // dated by `created_at` would put a Wednesday meeting on Thursday's timeline.
    const record = projectFathomMeeting({ meeting: meeting() })!;
    expect(record.tsIso).toBe("2026-09-09T03:00:00.000Z");
  });

  it("keys the record on the recording id its own URL carries", () => {
    const record = projectFathomMeeting({ meeting: meeting() })!;
    expect(record.sourceId).toBe("806772530");
    expect(record.url).toBe("https://fathom.video/calls/806772530");
    expect(record.container).toBe(FATHOM_BUCKET);
  });

  it("is private and a transcript, so no non-owner lane can ever hold it", () => {
    const record = projectFathomMeeting({ meeting: meeting() })!;
    expect(record.visibility).toBe("private");
    expect(record.kind).toBe("transcript");
    expect(record.source).toBe("fathom");
  });

  it("counts the external voices separately from the roster", () => {
    const record = projectFathomMeeting({ meeting: meeting() })!;
    expect(record.attrs!["attendeeCount"]).toBe(2);
    expect(record.attrs!["externalAttendeeCount"]).toBe(1);
    expect(record.attrs!["speakers"]).toEqual(["Felix", "Ada"]);
    expect(record.attrs!["transcriptLines"]).toBe(3);
  });

  it("refuses a meeting with no transcript rather than storing what Fathom wrote about it", () => {
    expect(projectFathomMeeting({ meeting: meeting({ transcript: [] }) })).toBe(undefined);
  });

  it("refuses a meeting with no recording start, because bronze places a record on a timeline", () => {
    const undated = meeting();
    const without: FathomMeeting = {
      attendees: undated.attendees,
      invitees: undated.invitees,
      recordingId: undated.recordingId,
      sharedWith: undated.sharedWith,
      transcript: undated.transcript,
      transcriptLanguage: undated.transcriptLanguage,
      url: undated.url,
    };
    expect(projectFathomMeeting({ meeting: without })).toBe(undefined);
  });
});

describe("fathomTranscriptBody", () => {
  it("keeps a whole transcript that fits, dropping nothing", () => {
    const body = fathomTranscriptBody({ items: TRANSCRIPT });
    expect(body.droppedChars).toBe(0);
    expect(body.text.split("\n").length).toBe(3);
  });

  it("truncates past the cap and accounts for every dropped character", () => {
    const long = Array.from({ length: 4_000 }, () => line({ at: "00:00:01", said: "x".repeat(200), who: "Speaker" }));
    // Each line is `[00:00:01] Speaker: ` (20 chars) + 200 x's, joined by 3,999 newlines.
    const rendered = 4_000 * 220 + 3_999;
    const body = fathomTranscriptBody({ items: long });
    expect(body.text.length).toBe(TRANSCRIPT_CHAR_CAP);
    expect(body.droppedChars).toBe(rendered - TRANSCRIPT_CHAR_CAP);
  });
});

describe("fathomSpeakers", () => {
  it("names each distinct speaker once, in the order they first spoke", () => {
    expect(fathomSpeakers({ items: TRANSCRIPT })).toEqual(["Felix", "Ada"]);
  });

  it("is empty for an empty transcript", () => {
    expect(fathomSpeakers({ items: [] })).toEqual([]);
  });
});

describe("projectFathomMeetings", () => {
  it("separates a still-processing call from a shape it did not expect", () => {
    const processing = meeting({ recordingId: 1, transcript: [] });
    const projection = projectFathomMeetings({ meetings: [meeting(), processing] });
    expect(projection.records.length).toBe(1);
    expect(projection.warnings.length).toBe(1);
    expect(projection.warnings[0]).toContain("carried no transcript");
  });

  it("reports nothing at all when every meeting stored", () => {
    const projection = projectFathomMeetings({ meetings: [meeting()] });
    expect(projection.warnings).toEqual([]);
    expect(projection.records.length).toBe(1);
  });
});
