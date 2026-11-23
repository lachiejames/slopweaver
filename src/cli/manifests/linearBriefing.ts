/**
 * The `linear briefing` verb's manifest entry, declared apart from `./linear.ts` and spread into it, so that file
 * stays under the file-size cap — the split `./linearLabel.ts` makes for `labels` and `label`.
 *
 * `briefing build` validates one end-of-day Linear briefing and writes its bundle under `--out`: each proposed
 * write as the form its own verb sends, the command that sends it, the doc's `## On the owner's word` section and the
 * page fragment. It reaches no provider at all, so it is `local-state` and not door-routed: every write it
 * proposes goes through its own door later, only on the owner's yes.
 */
import { LINEAR_BRIEFING_USAGE } from "../commands/linear/briefingUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const linearBriefingManifest: Readonly<Record<string, VerbManifestEntry>> = {
  briefing: lazy({
    load: () => import("../commands/linear/briefingRun.js").then((m) => m.linearBriefingCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver linear briefing build --form - --out ~/.slopweaver/linear-briefing/2026-10-26",
      parseRejectIsIoFree: true,
      summary: "Validate one end-of-day Linear briefing and write its forms, apply commands and page — no Linear write",
      usage: LINEAR_BRIEFING_USAGE,
    },
  }),
};
