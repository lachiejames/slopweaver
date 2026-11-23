/**
 * Lazy manifest for the `ruling` noun — the owner's register of standing rulings by category,
 * `$SLOPWEAVER_HOME/rulings.jsonl`. `record` and `seed` are its only writers and append only; `list` reads it and
 * `view` publishes its one read-only page into the local store. The rulings live in the state home and never in
 * the repository.
 */
import {
  RULING_LIST_USAGE,
  RULING_RECORD_USAGE,
  RULING_SEED_USAGE,
  RULING_VIEW_USAGE,
} from "../commands/ruling/rulingUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

const load = () => import("../commands/ruling/run.js").then((m) => m.rulingCommand);

const rulingRecordMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example:
    'slopweaver ruling record --category landing --words "two review passes, no third" --decided-on 2026-01-05 --alongside',
  parseRejectIsIoFree: true,
  summary:
    "File one ruling in the owner's words under a category — refused while a current ruling there stands undisposed",
  usage: RULING_RECORD_USAGE,
} as const;

const rulingListMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver ruling list --category landing",
  parseRejectIsIoFree: true,
  summary: "List the owner's current rulings by category, or every ruling and what replaced it with --all",
  usage: RULING_LIST_USAGE,
} as const;

const rulingSeedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver ruling seed --from ~/.slopweaver/supervisor/state.md --plan",
  parseRejectIsIoFree: true,
  summary: "File the rulings already written in the supervisor state documents' RULINGS sections, words unchanged",
  usage: RULING_SEED_USAGE,
} as const;

const rulingViewMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver ruling view",
  parseRejectIsIoFree: true,
  summary: "Publish the register's one read-only page into the local store and print its console address",
  usage: RULING_VIEW_USAGE,
} as const;

export const rulingManifest: Readonly<Record<string, VerbManifestEntry>> = {
  list: lazy({ load, meta: rulingListMeta }),
  record: lazy({ load, meta: rulingRecordMeta }),
  seed: lazy({ load, meta: rulingSeedMeta }),
  view: lazy({ load, meta: rulingViewMeta }),
};
