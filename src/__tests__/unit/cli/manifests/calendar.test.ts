/**
 * The `calendar` noun's manifest in `cli/manifests/calendar.ts`: pins the verb set and each verb's six classification
 * fields. The six write verbs are door-routed external writes, the reads are external reads that differ in whether a
 * bare invocation is safe to dry-parse, `connect` stores a grant locally, and `prep-due` reads the calendar but is
 * `local-state`, because it writes board rows. The usage constants are private to the manifest and not copied here.
 */
import { describe, expect, it } from "vitest";

import { calendarManifest } from "../../../../cli/manifests/calendar.js";
import { classificationsOf } from "./_classification.js";

describe("calendarManifest", () => {
  it("declares exactly these verbs", () => {
    expect(Object.keys(calendarManifest).toSorted()).toEqual([
      "book",
      "calendars",
      "cancel",
      "commit",
      "connect",
      "edit",
      "free",
      "list",
      "prep-due",
      "read",
      "reschedule",
      "respond",
    ]);
  });

  it("classifies each verb by its own effect, door, work-item, diagnostic and parse fields", () => {
    expect(classificationsOf({ manifest: calendarManifest })).toEqual({
      book: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
      calendars: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      cancel: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
      commit: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
      connect: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      edit: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
      free: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      list: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      "prep-due": {
        createsWorkItem: true,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      read: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      reschedule: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
      respond: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
    });
  });
});
