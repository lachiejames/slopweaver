/**
 * The `outlook-calendar` noun's manifest in `cli/manifests/outlookCalendar.ts`, and the usage leaf it quotes: pins
 * the verb set, each verb's six classification fields, that every example runs its own verb, and that each verb's
 * usage IS the leaf's string for it. All three verbs are reads, and only `read` refuses on its parser alone.
 */
import { describe, expect, it } from "vitest";

import {
  OUTLOOK_CALENDAR_CALENDARS_USAGE,
  OUTLOOK_CALENDAR_LIST_USAGE,
  OUTLOOK_CALENDAR_READ_USAGE,
} from "../../../../cli/commands/outlookCalendar/outlookCalendarUsage.js";
import { outlookCalendarManifest } from "../../../../cli/manifests/outlookCalendar.js";
import { classificationsOf } from "./_classification.js";

describe("outlookCalendarManifest", () => {
  it("declares exactly these verbs", () => {
    expect(Object.keys(outlookCalendarManifest).toSorted()).toEqual(["calendars", "list", "read"]);
  });

  it("classifies every verb as an external read that refuses a malformed tail before any I/O", () => {
    const read = {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "external-read",
      parseRejectIsIoFree: true,
    } as const;

    expect(classificationsOf({ manifest: outlookCalendarManifest })).toEqual({
      calendars: read,
      list: read,
      read: { ...read, dryParseSafe: true },
    });
  });

  it("gives every verb an example that leads with that verb", () => {
    const verbs = Object.keys(outlookCalendarManifest);

    const wrong = verbs.filter(
      (verb) => !outlookCalendarManifest[verb]!.meta.example!.startsWith(`slopweaver outlook-calendar ${verb}`),
    );

    expect(verbs.length).toBe(3);
    expect(wrong).toEqual([]);
  });

  it("quotes the usage leaf's string for each verb", () => {
    expect(outlookCalendarManifest["calendars"]!.meta.usage).toBe(OUTLOOK_CALENDAR_CALENDARS_USAGE);
    expect(outlookCalendarManifest["list"]!.meta.usage).toBe(OUTLOOK_CALENDAR_LIST_USAGE);
    expect(outlookCalendarManifest["read"]!.meta.usage).toBe(OUTLOOK_CALENDAR_READ_USAGE);
    expect(OUTLOOK_CALENDAR_READ_USAGE).toBe(
      "usage: slopweaver outlook-calendar read <event-id> [--json] [--home <dir>]",
    );
  });
});
