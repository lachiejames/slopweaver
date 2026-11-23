/**
 * Whether an operation's records are stored one row each, or enumerated and declared as a shape.
 *
 * ## The one bound on "everything reachable", applied per OPERATION
 *
 * Owner's ruling, `docs/atlas-intent/06-holdings.md`: an atlas holds everything reachable "with the only exception
 * really being stuff that is like highly voluminous such as audit logs", and such a family is enumerated
 * and declared rather than stored whole. The criterion that decides it, established by the Datadog atlas
 * row:
 *
 * > A voluminous family's records are **time-series OBSERVATIONS** — emitted by the platform rather than
 * > created by a person, unbounded, growing with the clock, and identified by an INSTANT rather than by a
 * > name somebody chose. **Configuration is the complement**: what a person or a system CREATED, and what
 * > can be listed exhaustively.
 *
 * The Twilio ask names the family by hand — message and call logs — and the criterion above is what
 * decides everything the ask did not name. A message, a call, a recording, a conference, a task
 * reservation and a usage record are all identified by when they happened; a messaging service, a phone
 * number, a Studio flow and a TaskRouter workflow are all identified by a name somebody chose.
 *
 * ## The criterion cuts THROUGH a product area, and Twilio has the sharpest example yet
 *
 * `/v1/Rooms/{RoomSid}/Recordings` returns the recordings a room produced — one per participant track, per
 * room, forever. `/v1/Rooms/{RoomSid}/RecordingRules` returns the rules somebody configured to decide
 * which of them get made. Same product, same resource, adjacent nouns, opposite dispositions. A rule
 * stated as a list of product areas cannot express that, which is why {@link CONFIGURATION_FRAGMENTS} is
 * consulted FIRST and overrides an observation family it sits inside.
 *
 * MEASURED against the pinned catalogue: 259 of 1,554 operations are shape-indexed, and the
 * configuration override rescues 4 more across 2 paths that a family-only rule would have swept up.
 * Reproduce with `slopweaver atlas twilio read --kind method --json` and count
 * `"disposition": "shape-index"`.
 */

/** What an observation of one operation publishes. */
const TWILIO_DISPOSITIONS = ["entity", "shape-index"] as const;

/** Whether an operation's records are stored one row each, or only as a shape. */
export type TwilioDisposition = (typeof TWILIO_DISPOSITIONS)[number];

/**
 * Path fragments whose records are CONFIGURATION even though they sit inside an observation family.
 *
 * Consulted before {@link OBSERVATION_FRAGMENTS} and overriding it. Each is something a person authored
 * that Twilio happens to nest under a resource whose own records are a stream — the rules that decide
 * which recordings a room makes, the rules that decide which tracks a participant subscribes to, and the
 * per-resource settings pages. Every one of them can be listed exhaustively and none grows with the clock.
 *
 * @internal
 */
const CONFIGURATION_FRAGMENTS = ["/RecordingRules", "/SubscribeRules", "/RecordingSettings", "/Settings"] as const;

/**
 * Path fragments whose records are time-series observations.
 *
 * Each is a family whose rows Twilio appends as things happen: a message sent or received, a call placed,
 * a recording made, an alert raised, a task reserved, a metered unit consumed. The account accumulates
 * them for the life of the account, so the count is bounded by the clock rather than by anything a person
 * maintains — which is the criterion, not the noun.
 *
 * The two the ask named by hand are here with the rest, and so is everything the same test catches:
 * usage records and monitor events are Twilio's own audit stream, Voice Insights summaries and metrics are
 * aggregations OVER that stream, Studio executions and their steps are one row per flow run, TaskRouter
 * events, reservations and statistics are one row per routing occurrence, and BulkExports is Twilio's own
 * name for the same data offered as a file.
 *
 * @internal
 */
const OBSERVATION_FRAGMENTS = [
  // The two the ask named: delivery ground truth for customer comms, and the call log beside it.
  "/Messages",
  "/MessageInteractions",
  "/Calls",
  // What a call or a message leaves behind.
  "/Recordings",
  "/Transcriptions",
  "/Transcripts",
  "/Sentences",
  "/OperatorResults",
  "/Conferences",
  "/Annotation",
  // Twilio's own error and audit streams.
  "/Notifications",
  "/Alerts",
  "/Events",
  "/Logs",
  // Metered consumption, per unit, forever.
  "/Usage/Records",
  "/UsageRecords",
  "/DataSessions",
  "/Commands",
  // Aggregations over the streams above. An aggregate of observations is still an observation.
  "/Summaries",
  "/Metrics",
  "/Statistics",
  // One row per run, per routing decision, per verification attempt, per contact.
  "/Executions",
  "/Steps",
  "/Reservations",
  "/Attempts",
  "/Interactions",
  // Video sessions and what they produce.
  "/Rooms",
  "/Compositions",
  // Twilio's own name for the same data offered as a file.
  "/Exports",
  "/Days",
] as const;

/**
 * Whether one operation's records are stored individually or only as a shape.
 *
 * @param path the specification's own path key, `{brace}` parameters intact
 * @returns `shape-index` for a time-series observation family, `entity` for configuration
 */
export function twilioDispositionFor({ path }: { path: string }): TwilioDisposition {
  if (CONFIGURATION_FRAGMENTS.some((fragment) => path.includes(fragment))) {
    return "entity";
  }
  if (OBSERVATION_FRAGMENTS.some((fragment) => path.includes(fragment))) {
    return "shape-index";
  }
  return "entity";
}
