/**
 * Lazy manifest for the `refresh` noun. Like `doctor`, the bare-noun and the `run` verb resolve to the
 * same handler through one lazy loader, so enumeration stays import-free and the (octokit-heavy) command
 * module loads only when `refresh` is actually dispatched.
 */
import { REFRESH_USAGE } from "../commands/refresh/flags.js";
import { DEFAULT_VERB, lazy, type VerbManifestEntry } from "../manifest.js";

const refreshMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: false,
  effect: "local-state",
  example: "slopweaver refresh --all-sources --since 2026-04-01",
  parseRejectIsIoFree: false,
  summary: "Ingest recent GitHub/Slack/Linear/Notion activity — and, when named, Gmail or Calendar — into bronze",
  usage: REFRESH_USAGE,
} as const;

const loadRefresh = () => import("../commands/refresh/run.js").then((m) => m.refreshRunCommand);

export const refreshManifest: Readonly<Record<string, VerbManifestEntry>> = {
  [DEFAULT_VERB]: lazy({ load: loadRefresh, meta: refreshMeta }),
  run: lazy({ load: loadRefresh, meta: refreshMeta }),
};
