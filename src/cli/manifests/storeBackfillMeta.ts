/**
 * The `store` backfill verbs' manifest rows: `edges`, `bots` and `classify`.
 *
 * Split out of `./store.ts` when that manifest crossed its size ratchet on `store classify`, the same way
 * `./storeProjectionMeta.ts` holds the projection verbs. These three belong together for a reason beyond
 * arithmetic: each re-derives a column on rows the store already holds by the same rule intake uses, each is
 * idempotent, and each is safe to interrupt, so a half-finished pass is finished by running it again.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** `store edges` — every row's parent key, and the row it names. */
const edgesMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store edges",
  parseRejectIsIoFree: true,
  summary:
    "Derive every row's parent key and point it at the row it names, so a thread walk is an index seek — idempotent and safe to interrupt, so a half-finished pass is finished by running it again",
  usage:
    "usage: slopweaver store edges [--keys-only] [--batch <n>] [--home <dir>] [--json]\n" +
    "  Two halves, in order: derive `parent_source_id` for every row, then resolve `parent_id` for every\n" +
    "  edge whose parent this store holds. --keys-only stops after the first, for checking what a rule\n" +
    "  change would write. An edge whose parent is outside the ingested window keeps its key and resolves\n" +
    "  on the next pass after that parent lands.",
} as const;

/** `store bots` — every stored row an automation authored, flagged. */
const botsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store bots",
  parseRejectIsIoFree: true,
  summary:
    "Flag every stored row an automation authored, so the detective verbs can start human-only — idempotent and safe to interrupt, so a half-finished pass is finished by running it again",
  usage:
    "usage: slopweaver store bots [--batch <n>] [--home <dir>] [--json]\n" +
    "  Fills `content.author_is_bot` from the evidence each row already carries, by the same rule ingest\n" +
    "  uses. Run once after the column lands and again after a rule change; new rows never need it.",
} as const;

/** `store classify` — every stored row's data class, by the rules intake uses. */
const classifyMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store classify --dry-run",
  parseRejectIsIoFree: true,
  summary:
    "Sort every stored row by the data-class rules, writing an explicit class (unknown where no rule decides) and counting every table with no class column as failing closed — counts only, idempotent and safe to interrupt",
  usage:
    "usage: slopweaver store classify [--dry-run] [--sample <1..100>] [--batch <1..30000>] [--home <dir>] [--json]\n" +
    "  Re-derives data_class on content, owner_capture and owner_turn by the same rules intake uses, in both\n" +
    "  directions, and exits 1 if an applying pass leaves a row with no class. --dry-run writes nothing, not even a\n" +
    "  migration catch-up. --sample lists that many row ids per most-private class, for the owner's own check only.",
} as const;

/** The three backfill verbs' rows, spread into `./store.ts`'s manifest in this order. */
export const backfillVerbs: Readonly<Record<string, VerbManifestEntry>> = {
  edges: lazy({ load: () => import("../commands/store/edges.js").then((m) => m.storeEdgesCommand), meta: edgesMeta }),
  bots: lazy({ load: () => import("../commands/store/bots.js").then((m) => m.storeBotsCommand), meta: botsMeta }),
  classify: lazy({
    load: () => import("../commands/store/classify.js").then((m) => m.storeClassifyCommand),
    meta: classifyMeta,
  }),
};
