/**
 * Lazy manifest for the `pane` noun — the owner's own open pull requests, ranked.
 *
 * Metadata only, like every other manifest: `--help` and `catalog` read the literal `usage` below without
 * loading the command module. The help-truth ratchet is what keeps that literal honest — it pushes every
 * advertised flag through `pane pr-status`'s real parser.
 *
 * `effect: "external-read"` rather than `"none"`: the read shells `gh` once per watched repository.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const prStatusMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "external-read",
  example: "slopweaver pane pr-status --pr-repos owner/name --json",
  parseRejectIsIoFree: true,
  summary: "A one-shot JSON read of the owner's own open pull requests, ranked, with why each is blocked",
  usage: "usage: slopweaver pane pr-status [--pr-repos <value>] [--repo <dir>] --json",
} as const;

export const paneManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "pr-status": lazy({
    load: () => import("../commands/pane/prStatus.js").then((m) => m.panePrStatusCommand),
    meta: prStatusMeta,
  }),
};
