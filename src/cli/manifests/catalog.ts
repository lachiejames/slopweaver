/**
 * Lazy manifest for the `catalog` noun — the command-surface index. Bare-noun and `list` verb share one
 * loader; the command module loads only when dispatched.
 */
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const catalogMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver catalog --json",
  parseRejectIsIoFree: true,
  summary: "List the command surface (human, --json, or --capabilities) from the registry",
  usage: "usage: slopweaver catalog [--json] [--capabilities]",
} as const;

const treesMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver catalog trees --json",
  parseRejectIsIoFree: true,
  summary: "The codebase atlas: every top-level src/ tree, its entry verbs, its area rule and what it imports",
  usage: "usage: slopweaver catalog trees [--json]",
} as const;

const healthMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver catalog health --json",
  parseRejectIsIoFree: true,
  summary: "The codebase atlas's state: what is tested, what a rule governs, what the ratchets carry, ranked",
  usage: "usage: slopweaver catalog health [--json]",
} as const;

const loadCatalog = () => import("../commands/catalog/run.js").then((m) => m.catalogRunCommand);
const loadTrees = () => import("../commands/catalog/treesRun.js").then((m) => m.catalogTreesCommand);
const loadHealth = () => import("../commands/catalog/healthRun.js").then((m) => m.catalogHealthCommand);

export const catalogManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadCatalog, meta: catalogMeta }),
  health: lazy({ load: loadHealth, meta: healthMeta }),
  list: lazy({ load: loadCatalog, meta: catalogMeta }),
  trees: lazy({ load: loadTrees, meta: treesMeta }),
};
