/**
 * Unit: the SDK→corpus boundary, run over Fathom's OWN published example payload rather than over a shape
 * this repository invented.
 *
 * This is the strongest proof available without the owner's API key, and it is a different claim to
 * `corpus/fathom/project.test.ts`: that file pins what the projection DOES with a meeting, and this one pins
 * that a real Fathom body parses into a meeting at all. A hand-written fixture would agree with whatever the
 * narrowing happens to read, which is the failure mode the vendor's own bytes rule out.
 *
 * The fixture is `src/__tests__/fixtures/fathom/listMeetingsExample.json`, taken from
 * `https://developers.fathom.ai/quickstart` with THREE additions, each of them a field the
 * vendor's OpenAPI document declares required and their own example omits: `recording_id`, `shared_with` and
 * `calendar_invitees_domains_type`. That omission is worth knowing rather than papering over — the published
 * example does not satisfy the published schema — and the `recording_id` used is the real 9-digit shape.
 *
 * Zero mocks and zero I/O beyond reading the committed fixture, which is the sanctioned round-trip.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MeetingListResponse$inboundSchema } from "fathom-typescript/sdk/models/shared";
import { describe, expect, it } from "vitest";

import { projectFathomMeeting } from "../../../../corpus/fathom/project.js";
import { narrowMeeting, nextCursorField } from "../../../../live/fathom/api.js";

const FIXTURE = join(import.meta.dirname, "../../../fixtures/fathom/listMeetingsExample.json");

/** The vendor's example body, parsed by the SDK's OWN inbound schema — never by a hand-rolled reader. */
function parsedExample(): ReturnType<typeof MeetingListResponse$inboundSchema.parse> {
  return MeetingListResponse$inboundSchema.parse(JSON.parse(readFileSync(FIXTURE, "utf8")));
}

describe("the Fathom boundary, over the vendor's own example body", () => {
  it("parses through the SDK's inbound schema and carries the cursor", () => {
    const parsed = parsedExample();
    expect(parsed.items.length).toBe(1);
    expect(parsed.nextCursor).toBe("eyJwYWdlX251bSI6Mn0=");
  });

  it("narrows to the repo's own meeting shape, preferring the CALENDAR title over Fathom's", () => {
    const meeting = narrowMeeting({ meeting: parsedExample().items[0]! });
    expect(meeting.title).toBe("QBR 2025 Q1");
    expect(meeting.recordingId).toBe(806772530);
    expect(meeting.url).toBe("https://fathom.video/xyz123");
    expect(meeting.recordingStartIso).toBe("2025-03-01T16:01:12.000Z");
    expect(meeting.createdAtIso).toBe("2025-03-01T17:01:30.000Z");
    expect(meeting.transcript.length).toBe(2);
    expect(meeting.attendees).toEqual(["Alice Johnson", "Jane Smith"]);
    expect(meeting.recordedByName).toBe("Alice Johnson");
  });

  it("names the recorder by their address's local part when Fathom sent a blank name, never the address", () => {
    const example = parsedExample().items[0]!;
    const meeting = narrowMeeting({ meeting: { ...example, recordedBy: { ...example.recordedBy, name: " " } } });
    expect(meeting.recordedByName).toBe("alice.johnson");
    expect(projectFathomMeeting({ meeting })!.author).toBe("alice.johnson");
  });

  it("titles an ad-hoc recording, whose calendar title is null, with Fathom's own title", () => {
    const meeting = narrowMeeting({ meeting: { ...parsedExample().items[0]!, meetingTitle: null } });
    expect(meeting.title).toBe("Quarterly Business Review");
  });

  it("reads a transcript Fathom left unset, undefined or null, as no lines", () => {
    const example = parsedExample().items[0]!;
    expect(narrowMeeting({ meeting: { ...example, transcript: undefined } }).transcript).toStrictEqual([]);
    expect(narrowMeeting({ meeting: { ...example, transcript: null } }).transcript).toStrictEqual([]);
  });

  it("projects to a private transcript record holding the raw words and NOT the summary", () => {
    const record = projectFathomMeeting({ meeting: narrowMeeting({ meeting: parsedExample().items[0]! }) })!;
    expect(record.text).toBe(
      "[00:05:32] Alice Johnson: Let's revisit the budget allocations.\n" +
        "[00:06:04] Jane Smith: Agreed — the renewal number moves if we do.",
    );
    // The example body carries `default_summary.markdown_formatted`. Nothing may reach the record from it.
    expect(record.text).not.toContain("We reviewed Q1 OKRs");
    expect(JSON.stringify(record)).not.toContain("markdown_formatted");
    expect(record.visibility).toBe("private");
    expect(record.attrs!["externalAttendeeCount"]).toBe(1);
  });
});

describe("nextCursorField", () => {
  // MEASURED against the owner's own key: Fathom ends a listing with an EMPTY STRING rather
  // than null, and reading that as a live cursor walked the crawl's whole 500-page bound. The unit fakes
  // could not have caught it, because they return `undefined` for "no more pages" — this repo's shape, not
  // the provider's.
  it("treats the provider's own end-of-listing empty string as NO cursor", () => {
    expect(nextCursorField({ raw: "" })).toEqual({});
    expect(nextCursorField({ raw: "   " })).toEqual({});
  });

  it("treats null and undefined as no cursor too", () => {
    expect(nextCursorField({ raw: null })).toEqual({});
    expect(nextCursorField({ raw: undefined })).toEqual({});
  });

  it("carries a real cursor through untouched", () => {
    expect(nextCursorField({ raw: "eyJwYWdlX251bSI6Mn0=" })).toEqual({ nextCursor: "eyJwYWdlX251bSI6Mn0=" });
  });
});
