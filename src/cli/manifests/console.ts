/**
 * Lazy manifest for the `console` noun — the machinery the local console reads through.
 *
 * Metadata only, like every other manifest: `--help` and `catalog` read the usage leaf without loading the command
 * module. `effect: "local-state"` rather than `"none"`, because a verb a batch runs may write local state (`hand list`
 * reconciles before it lists); a verb that writes outside the machine is refused by the batch itself.
 */
import { CONSOLE_BATCH_USAGE } from "../commands/console/batchUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const batchMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: `echo '[["hand","list","--json"],["queue","list","--json"]]' | slopweaver console batch`,
  parseRejectIsIoFree: false,
  summary: "Run several read verbs in one process, one JSON line per verb as each finishes (the console's reads)",
  usage: CONSOLE_BATCH_USAGE,
} as const;

export const consoleManifest: Readonly<Record<string, VerbManifestEntry>> = {
  batch: lazy({
    load: () => import("../commands/console/batch.js").then((m) => m.consoleBatchCommand),
    meta: batchMeta,
  }),
};
