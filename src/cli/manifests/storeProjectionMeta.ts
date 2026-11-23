/**
 * The `store` projection verbs' manifest rows — the atlas, fleet and published-pages imports, and the owner-turn
 * dump restore.
 *
 * Split out of `./store.ts` when that manifest crossed its size ratchet on the atlas import, the same way
 * `./githubStackUsage.ts` holds one verb's help out of `./github.ts`. These four belong together for a
 * reason beyond arithmetic: each projects a local file into store tables, each is re-runnable, and each
 * carries a `--dry-run` that opens no connection, so a reader comparing them is reading one idea.
 */
import { IMPORT_FLEET_USAGE } from "../commands/store/importFleetUsage.js";
import { IMPORT_OWNER_TURN_DUMP_USAGE } from "../commands/store/importOwnerTurnDumpUsage.js";
import { PAGES_IMPORT_USAGE } from "../commands/store/pagesImportUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** `store import-atlas` — every registered atlas's published generation, into the five atlas tables. */
export const importAtlasMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store import-atlas --dry-run",
  parseRejectIsIoFree: true,
  summary:
    "Project every registered atlas's published generation into the five atlas tables — one (platform, kind) slice replaced per transaction, so a re-run converges and a killed import leaves the previous generation intact",
  usage:
    "usage: slopweaver store import-atlas [--platform <p>] [--force] [--dry-run] [--home <dir>] [--json]\n" +
    "  Re-runnable: a kind whose stored digest already matches its manifest is skipped unless --force.\n" +
    "  --dry-run plans and counts the files without opening a connection.",
} as const;

/** `store import-fleet` — the board, the run journals, the Codex passes, the owner's dictations and Codex messages, the ledgers, the owner-turn files, the Claude fallback receipts, the measurements and the authored working state, into the store. */
export const importFleetMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store import-fleet --dry-run",
  parseRejectIsIoFree: true,
  summary:
    "Project the board, the run journals, the Codex passes, the owner's speech-to-text dictations and interactive Codex messages (each with the instant it was said), the ledgers, the owner-turn files, the Claude fallback requests and receipts, the measurements (media into Storage) and the authored working-state directories into the store — re-runnable, and a door row before the ambient-home guard is imported as unattributable rather than as a real action",
  usage: IMPORT_FLEET_USAGE,
} as const;

/** `store import-owner-turn-dump` — the owner-turn record restored from a pg_dump keep, all or nothing. */
export const importOwnerTurnDumpMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store import-owner-turn-dump --from ~/keep/owner-tables.sql --dry-run",
  parseRejectIsIoFree: true,
  summary:
    "Restore the owner-turn bodies and their locations from a pg_dump keep — every body re-hashed against its row, one refused row writes nothing, and a row the store already holds is left exactly as it is",
  usage: IMPORT_OWNER_TURN_DUMP_USAGE,
} as const;

/** `store pages-import` — every published page and frozen version, each body an object in Storage. */
export const pagesImportMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store pages-import --dry-run",
  parseRejectIsIoFree: true,
  summary:
    "Carry every published page and frozen version into the store, each body byte-verified into the private published-pages bucket — both folders read and never changed, any link or bad freeze refusing the whole run, and a re-run writing only what changed",
  usage: PAGES_IMPORT_USAGE,
} as const;

/** The four projection verbs' rows, spread into `./store.ts`'s manifest in this order. */
export const projectionVerbs: Readonly<Record<string, VerbManifestEntry>> = {
  "import-atlas": lazy({
    load: () => import("../commands/store/importAtlasRun.js").then((m) => m.storeImportAtlasCommand),
    meta: importAtlasMeta,
  }),
  "import-fleet": lazy({
    load: () => import("../commands/store/importFleetRun.js").then((m) => m.storeImportFleetCommand),
    meta: importFleetMeta,
  }),
  "import-owner-turn-dump": lazy({
    load: () => import("../commands/store/importOwnerTurnDumpRun.js").then((m) => m.storeImportOwnerTurnDumpCommand),
    meta: importOwnerTurnDumpMeta,
  }),
  "pages-import": lazy({
    load: () => import("../commands/store/pagesImportRun.js").then((m) => m.storePagesImportCommand),
    meta: pagesImportMeta,
  }),
};
