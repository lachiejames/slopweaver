/**
 * Lazy manifest for the `hatch` noun — taking and reading a journalled escape hatch.
 *
 * `effect: "local-state"` and `doorRouted: false` are load-bearing rather than descriptive: this verb writes
 * one line under `$SLOPWEAVER_HOME` and reaches nothing external, and routing the ESCAPE through the same
 * door whose refusals it opens would be the wedge `../commands/hatch/run.ts` explains it must never be.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const openMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: 'slopweaver hatch open wall --reason "the task needs exactly this sequence"',
  parseRejectIsIoFree: true,
  requiresApproval: false,
  summary: "Take a 30-minute grant for ONE journalled escape hatch, in this session, with a written reason",
  usage: 'usage: slopweaver hatch open <id> --reason "<why>" [--home <dir>]',
} as const;

const listMeta = {
  createsWorkItem: false,
  diagnostic: true,
  doorRouted: false,
  // A bare run reads the hatch registry and this session's grants, so it acts rather than printing usage.
  dryParseSafe: false,
  effect: "none",
  example: "slopweaver hatch list",
  parseRejectIsIoFree: true,
  requiresApproval: false,
  summary: "Every journalled escape hatch, and which of them this session currently holds a grant for",
  usage: "usage: slopweaver hatch list [--home <dir>]",
} as const;

const loadHatch = () => import("../commands/hatch/run.js").then((m) => m.hatchCommand);

export const hatchManifest: Readonly<Record<string, VerbManifestEntry>> = {
  list: lazy({ load: loadHatch, meta: listMeta }),
  open: lazy({ load: loadHatch, meta: openMeta }),
};
