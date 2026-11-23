/**
 * Lazy manifest for the `compact` noun (bronze retention/compaction; see `cli/manifest.ts`).
 *
 * The bare-noun and `run` verb resolve to the SAME handler, so both share one loader (one module fetch).
 */
import { BRONZE_SOURCES } from "../../integrations/corpusSources.js";
import { COMPACT_HEAL_REFS_USAGE } from "../commands/compact/healRefsUsage.js";
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

/** Shared meta for the bare-noun + `run` verb; both resolve to the same compact handler. */
const compactMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // A bare run compacts the corpus, so it acts rather than printing usage.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver compact",
  parseRejectIsIoFree: true,
  summary: "Compact bronze: merge each source's overlapping window files into one deduped canonical file",
  usage: `usage: slopweaver compact [--source ${BRONZE_SOURCES.join("|")}] [--older-than <N|Nd>] [--json] [--home <dir>]`,
} as const;

/** Lazy loader for the shared compact handler — one module fetch, reused across the bare-noun + `run` verb. */
const loadCompact = () => import("../commands/compact/run.js").then((m) => m.compactRunCommand);

/** Meta for `compact heal-refs` — the offline repair of Notion refs redact's digit pass carved up. */
const healRefsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  // A bare run scans the content stores for carved-up refs and reports them, so it acts rather than printing usage.
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver compact heal-refs",
  parseRejectIsIoFree: true,
  summary:
    "Rewrite Notion attachment and body refs redact's digit pass carved up, from the content stores that still hold the bytes — dry-run unless --apply",
  usage: COMPACT_HEAL_REFS_USAGE,
} as const;

/** The `compact` noun's verbs as lazy manifest entries. */
export const compactManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadCompact, meta: compactMeta }),
  "heal-refs": lazy({
    load: () => import("../commands/compact/healRefs.js").then((m) => m.compactHealRefsCommand),
    meta: healRefsMeta,
  }),
  run: lazy({ load: loadCompact, meta: compactMeta }),
};
