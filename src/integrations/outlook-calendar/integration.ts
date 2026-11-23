/**
 * The Outlook calendar integration's manifest — strings and `import()` thunks only. It has no `connection` of
 * its own: it reads over the Outlook mail integration's one Microsoft grant, so connecting is `outlook connect`.
 */
import type { IntegrationManifest } from "../manifest.js";

/** The outlook-calendar row of the integration registry. */
export const OUTLOOK_CALENDAR_INTEGRATION = {
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
