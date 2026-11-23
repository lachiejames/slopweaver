/**
 * `store import-owner-turn-dump`'s usage — a usage leaf, so the manifest (`../../manifests/storeProjectionMeta.ts`)
 * and the verb (`./importOwnerTurnDumpRun.ts`) quote one declaration.
 */

/** The usage text, quoted by the manifest and printed by the verb. */
export const IMPORT_OWNER_TURN_DUMP_USAGE =
  "usage: slopweaver store import-owner-turn-dump --from <owner-tables.sql> [--dry-run] [--home <dir>] [--json]\n" +
  "  Restores the owner-turn record from a pg_dump keep: the owner_turn and owner_turn_location COPY sections, every\n" +
  "  body re-hashed against its own row and every location checked to name a body the dump carries. One refused row\n" +
  "  writes nothing at all. Re-runnable: a body or location the store already holds is left exactly as it is.\n" +
  "  --dry-run reads and checks the whole dump without opening a connection.";
