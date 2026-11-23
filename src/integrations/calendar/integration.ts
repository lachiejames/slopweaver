/** The Google Calendar integration's manifest — strings, its atlas row and `import()` thunks only. */
import type { IntegrationManifest } from "../manifest.js";

/** The calendar row of the integration registry. */
export const CALENDAR_INTEGRATION = {
  connection: { connectWith: "slopweaver calendar connect", credentialSets: [["calendar-oauth.json"]], ordinal: 1 },
  corpus: {
    allSourcesSweep: false,
    alwaysPrivate: true,
    containerScoped: false,
    identityRoster: false,
    ordinal: 7,
    progressPhase: false,
    resyncDemand: true,
    upfrontTokenGate: false,
  },
  features: {
    ingest: async () => (await import("../../corpus/calendar/ingest.js")).readCap,
    read: async () => (await import("../../live/calendar/read.js")).MAX_EVENT_PAGE,
    write: async () => (await import("../../live/calendar/write.js")).assertWriteTargetIsOwnPrimary,
  },
  id: "calendar",
  name: "Google Calendar",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        command: ["slopweaver", "calendar", "calendars"],
        coverage: {
          detail:
            "every calendar this grant can see, with the id `calendar list` takes. The EVENTS are the separate act — `slopweaver calendar list` over a window, `calendar read <id>` for one event in full, `calendar free` for the open stretches across the people named",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from Google Calendar when the planned command runs", kind: "live" },
        id: "calendar",
        owner: "slopweaver",
        sourceClass: "provider",
        terms: ["calendar", "meeting", "meetings", "event", "events", "attendees", "availability"],
        truthMode: "current",
        what: "what is on the owner's calendar, and when they and the people they name are free",
      },
      ordinal: 13,
    },
  ],
} as const satisfies IntegrationManifest;
