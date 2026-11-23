/**
 * What the Calendar write guard judges in one event body, and the strict verdict over it. Pure: a declared policy, no
 * home, no transport.
 */
import { describe, expect, it } from "vitest";

import { FORBIDDEN_IDENTIFIER_RULES } from "../../../../hygiene/forbiddenIdentifiers.js";
import { parsePrivateTerms } from "../../../../hygiene/privateTerms.js";
import { unwrap } from "../../../../lib/result.js";
import {
  CALENDAR_DESTINATION,
  calendarWriteFindings,
  calendarWriteLeaves,
} from "../../../../outbound/calendar/writePrivacyPayload.js";
import type { PrivacyPolicy } from "../../../../outbound/privacyCheck.js";

const POLICY: PrivacyPolicy = {
  denylist: [],
  identifierRules: FORBIDDEN_IDENTIFIER_RULES,
  privateTerms: unwrap(
    parsePrivateTerms({ text: "class\tflags\tpattern\tsource\nperson\ti\tquillfeather\tsynthetic\n" }),
  ),
};

describe("calendarWriteLeaves", () => {
  it("walks every string of an event body in order, attendee emails and nested values included", () => {
    const leaves = calendarWriteLeaves({
      body: {
        attendees: [{ comment: "running late", displayName: "Zorvane", email: "zorvane@acme.test" }],
        attachments: [{ fileUrl: "https://drive.example/f/1", title: "agenda" }],
        description: "the quarterly sync",
        extendedProperties: { private: { origin: "door" } },
        location: "room 4",
        reminders: { overrides: [{ method: "popup", minutes: 10 }], useDefault: false },
        summary: "acme sync",
      },
      operation: "calendar.events.insert",
    });
    expect(leaves).toStrictEqual([
      { locus: "calendar calendar.events.insert attendees[0].comment", text: "running late" },
      { locus: "calendar calendar.events.insert attendees[0].displayName", text: "Zorvane" },
      { locus: "calendar calendar.events.insert attendees[0].email", text: "zorvane@acme.test" },
      { locus: "calendar calendar.events.insert attachments[0].fileUrl", text: "https://drive.example/f/1" },
      { locus: "calendar calendar.events.insert attachments[0].title", text: "agenda" },
      { locus: "calendar calendar.events.insert description", text: "the quarterly sync" },
      { locus: "calendar calendar.events.insert extendedProperties.private.origin", text: "door" },
      { locus: "calendar calendar.events.insert location", text: "room 4" },
      { locus: "calendar calendar.events.insert reminders.overrides[0].method", text: "popup" },
      { locus: "calendar calendar.events.insert summary", text: "acme sync" },
    ]);
  });

  it("skips a door-minted top-level id and only that one: a nested id is authored and judged", () => {
    const leaves = calendarWriteLeaves({
      body: { extendedProperties: { private: { id: "quillfeather" } }, id: "550e8400e29b41d4a716446655440000" },
      operation: "calendar.events.insert",
    });
    expect(leaves).toStrictEqual([
      { locus: "calendar calendar.events.insert extendedProperties.private.id", text: "quillfeather" },
    ]);
  });

  it.each([["quillfeather"], ["550e8400-e29b-41d4-a716-446655440000"], ["550E8400E29B41D4A716446655440000"]])(
    "judges a top-level id %s that does not have the door-minted shape, as an edited intent file could carry",
    (id) => {
      expect(calendarWriteLeaves({ body: { id }, operation: "calendar.events.insert" })).toStrictEqual([
        { locus: "calendar calendar.events.insert id", text: id },
      ]);
    },
  );

  it("has nothing to judge in a delete", () => {
    expect(calendarWriteLeaves({ body: undefined, operation: "calendar.events.delete" })).toStrictEqual([]);
  });
});

describe("calendarWriteFindings", () => {
  it("is judged strictly: no repository, no installation identifiers, no workspace forgiveness", () => {
    expect(CALENDAR_DESTINATION).toStrictEqual({
      identifierAudience: "strict",
      installationIdentifiers: undefined,
      ownRepository: undefined,
    });
  });

  it.each([
    ["summary", { summary: "lunch with Quillfeather" }],
    ["description", { description: "ask quillfeather about the plan" }],
    ["location", { location: "Quillfeather's office" }],
    ["attendees[0].email", { attendees: [{ email: "quillfeather@acme.test" }] }],
  ])("refuses a private term in %s, naming the locus and the class and never the term", (path, body) => {
    const findings = calendarWriteFindings({
      leaves: calendarWriteLeaves({ body, operation: "calendar.events.insert" }),
      policy: POLICY,
    });
    expect(findings.map((finding) => finding.message)).toStrictEqual([
      `calendar calendar.events.insert ${path} line 1: a private person term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row`,
    ]);
  });

  it("finds nothing in a clean body", () => {
    const findings = calendarWriteFindings({
      leaves: calendarWriteLeaves({ body: { summary: "acme sync" }, operation: "calendar.events.insert" }),
      policy: POLICY,
    });
    expect(findings).toStrictEqual([]);
  });
});
