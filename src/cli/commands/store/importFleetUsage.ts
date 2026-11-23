/**
 * `store import-fleet`'s leg list, flags and usage — a usage leaf, so the manifest (`../../manifests/storeProjectionMeta.ts`)
 * and the verb (`./importFleetArgs.ts`) quote one declaration rather than two that drift.
 */

/** Which legs the verb may be asked for, in the order the schema-review page sequences them. */
export const FLEET_LEGS = [
  "board",
  "runs",
  "codex",
  "dictations",
  "codex-messages",
  "door",
  "autonomy",
  "grants",
  "owner-turns",
  "codex-fallback",
  "measurements",
  "authored",
] as const;

/** One leg of the import. */
export type FleetLeg = (typeof FLEET_LEGS)[number];

/** The flag that adopts unmatched door lines — named once, so the parser, the refusals and the usage agree. */
export const ADOPT_FLAG = "--adopt-unmatched-door-lines";

/**
 * The flag naming the folder of speech-to-text recordings for the `dictations` leg. Named for what the folder holds,
 * never for one app (other people use different speech-to-text software); the one layout read today is Superwhisper's.
 */
export const DICTATIONS_FLAG = "--dictations";

/** The flag naming the Codex home for the `codex-messages` leg. */
export const CODEX_HOME_FLAG = "--codex-home";

/** The usage text, quoted by the manifest and printed by the verb. */
export const IMPORT_FLEET_USAGE =
  `usage: slopweaver store import-fleet [--only ${FLEET_LEGS.join("|")}] [--dry-run] [--home <dir>] [--json]\n` +
  `         [${DICTATIONS_FLAG} <dir>] [${CODEX_HOME_FLAG} <dir>]\n` +
  `       slopweaver store import-fleet --only door ${ADOPT_FLAG} [--home <dir>] [--json]\n` +
  "  Projects the board, the run journals, the Codex passes, the owner's speech-to-text dictations and interactive\n" +
  "  Codex messages (each with the instant it was said), the ledgers, the owner-turn files, the Claude fallback requests and\n" +
  "  receipts, the measurements (bakeoff, datadog-shots, evidence, proof) and the authored working-state\n" +
  "  directories into the store; a measurement a text column cannot hold is uploaded to the Storage bucket\n" +
  "  first, which needs the local stack running; its key is read off it, never stored.\n" +
  "  Re-runnable: a board document is re-projected whole; a ledger line, dictation, Codex message, owner-turn\n" +
  "  body, fallback receipt, measurement body or authored file once.\n" +
  `  ${DICTATIONS_FLAG} / ${CODEX_HOME_FLAG}: where those two sources are. A dictations folder holds one\n` +
  "  <epoch seconds>/meta.json per recording (Superwhisper's layout, the one read today). Without a flag, each is\n" +
  "  read from its app's own default (~/Documents/superwhisper/recordings, $CODEX_HOME or ~/.codex) only for the\n" +
  "  default home ~/.slopweaver; for any other --home it is not read at all.\n" +
  "  --dry-run projects and counts without opening a connection.\n" +
  `  ${ADOPT_FLAG} (with --only door, never --dry-run): once the door import is marked, insert the file lines\n` +
  "  that have no row, but only when every other comparison is clean; nothing stored is ever overwritten.";
