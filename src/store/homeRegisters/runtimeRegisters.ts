/**
 * The runtime home registers: the small singleton registers, the Codex sign-in observations, the retired cmux
 * state files, and the fleet and org-health registers — import-only files whose store rows are the authority.
 *
 * Spread second into `HOME_REGISTERS` (`../homeRegisters.ts`); a new row of this category goes here.
 */
import type { HomeRegister } from "../homeRegisters.js";

/** The runtime registers, in the order `HOME_REGISTERS` reports them. */
export const RUNTIME_REGISTERS: readonly HomeRegister[] = [
  // The small registers share `singleton_register` with the identity roster (`./coreRegisters.ts`), one row each
  // keyed by `id`; each file is imported once and then inert (`src/store/singletonRegister.ts`), still measured
  // while on disk.
  {
    kind: "gmail triage rules",
    measure: "walk",
    pathKey: "gmailTriageRulesJson",
    relativePath: "gmail-triage-rules.json",
    rowFilter: { column: "id", value: "gmail-triage-rules" },
    shape: "file",
    table: "singleton_register",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "recorded browser profile",
    measure: "walk",
    pathKey: "browserJson",
    relativePath: "browser.json",
    rowFilter: { column: "id", value: "browser-profile" },
    shape: "file",
    table: "singleton_register",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "stale-seat notices",
    measure: "walk",
    pathKey: "staleSeatNoticesJson",
    relativePath: "stale-seat-notices.json",
    rowFilter: { column: "id", value: "stale-seat-notices" },
    shape: "file",
    table: "singleton_register",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // The store rows are the authority; a file here is only what a row is imported from once, and is never
    // written (`src/codex/signInRecordStore.ts`), still measured because an install that predates the store holds it.
    kind: "Codex sign-in observations",
    measure: "walk",
    pathKey: "codexSignInDir",
    relativePath: "codex-signin",
    shape: "directory",
    table: "codex_sign_in_observation",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // Retired: nothing writes it. The first read on a home with no row imports it, with the cursor file
    // below, into the `session-watch` row (`src/cmux/eventState/`); still measured while it is on disk.
    kind: "cmux session-watch fold",
    measure: "walk",
    pathKey: "cmuxSessionActivityJson",
    relativePath: "cmux-session-activity.json",
    rowFilter: { column: "consumer", value: "session-watch" },
    shape: "file",
    table: "cmux_event_state",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // Retired the same way. It once served both verbs; each now imports it into its own row, so the
    // `cmux events` row is the one counted here and the fold above claims the other.
    kind: "cmux event cursor",
    measure: "walk",
    pathKey: "cmuxEventCursorJson",
    relativePath: "cmux-event-cursor.json",
    rowFilter: { column: "consumer", value: "cmux-events" },
    shape: "file",
    table: "cmux_event_state",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // The three fleet registers are IMPORT-ONLY files: the store rows are the authority from the first read on, and
    // nothing projects back (`src/fleet/port.ts`). Still measured, because a home that predates the store holds them.
    kind: "fleet capacity",
    measure: "walk",
    pathKey: "fleetConfigJson",
    relativePath: "fleet/config.json",
    shape: "file",
    table: "fleet_config",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "fleet recovery journal",
    measure: "walk",
    pathKey: "fleetResumeJsonl",
    relativePath: "fleet/resume.jsonl",
    rowFilter: { column: "journal", value: "resume" },
    shape: "jsonl",
    table: "fleet_journal_event",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "cmux revive journal",
    measure: "walk",
    pathKey: "cmuxReviveJsonl",
    relativePath: "fleet/cmux-revive.jsonl",
    rowFilter: { column: "journal", value: "cmux-revive" },
    shape: "jsonl",
    table: "fleet_journal_event",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // The three org-health registers are IMPORT-ONLY files, as the fleet's are: the store rows are the authority from
    // the first read on, and nothing projects back (`src/orgHealth/port.ts`).
    kind: "incident snapshot",
    measure: "walk",
    pathKey: "orgHealthIncidentsJson",
    relativePath: "org-health/incidents.json",
    shape: "file",
    table: "org_health_incident",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "incident sightings",
    measure: "walk",
    pathKey: "orgHealthSightingsJson",
    relativePath: "org-health/sightings.json",
    shape: "file",
    table: "org_health_sighting",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    // The import marker shares the table, so only the presses are counted against the file's lines.
    kind: "incident acknowledgements",
    measure: "walk",
    pathKey: "orgHealthAcknowledgementsJsonl",
    relativePath: "org-health/acknowledgements.jsonl",
    rowFilter: { column: "kind", value: "acknowledgement" },
    shape: "jsonl",
    table: "org_health_acknowledgement",
    tier: "durable",
    unmirroredBecause: undefined,
  },
];
