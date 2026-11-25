/**
 * The Outlook calendar integration's manifest — strings and `import()` thunks only. It is its own integration
 * with its own consent and grant, connected by `outlook-calendar connect`. A held mail grant that already carries
 * a calendar permission still reads the diary until a calendar grant is stored (`src/live/outlook/calendarGrantChoice.ts`),
 * but a board row's need for the calendar is judged on its own grant file alone.
 */
import type { IntegrationManifest } from "../manifest.js";

/** The outlook-calendar row of the integration registry. */
export const OUTLOOK_CALENDAR_INTEGRATION = {
  connection: {
    connectWith: "slopweaver outlook-calendar connect",
    credentialSets: [["outlook-calendar-oauth.json"]],
    ordinal: 12,
  },
  corpus: {
    allSourcesSweep: false,
    alwaysPrivate: true,
    containerScoped: false,
    identityRoster: false,
    ordinal: 10,
    progressPhase: false,
    resyncDemand: true,
    upfrontTokenGate: false,
  },
  features: {
    ingest: async () => (await import("../../corpus/outlookCalendar/ingest.js")).outlookCalendarReadCap,
    read: async () => (await import("../../live/outlookCalendar/read.js")).MAX_WINDOW_EVENTS,
  },
  id: "outlook-calendar",
  name: "Outlook Calendar",
  noun: { kind: "source-reading" },
} as const satisfies IntegrationManifest;
