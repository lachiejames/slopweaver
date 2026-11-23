/**
 * The `github` verbs for code scanning (CodeQL), split out of `./github.ts` when adding `code-scanning` took
 * that manifest past its size ratchet — the same seam and the same reason as `./githubCi.ts`.
 *
 * They are one family: `alert` is the finding CodeQL raised, `code-scanning` is the switch that makes it
 * run. Neither had a door before its verb, so each was a human's own click or the raw API call rule 3 in
 * AGENTS.md forbids.
 *
 * `alert` has the same `list`/one-write shape as `thread`. `list` reads every alert (optionally scoped to one
 * pull request's head ref and one state) — a pure read, so it never reaches the door. `dismiss` re-reads the
 * exact alert first, refuses a reason outside GitHub's own three-member enum and a dismissal with no comment,
 * then sends the write once through the door; the PATCH response IS the read-back.
 *
 * `code-scanning` reads a repository's default setup — CodeQL with no workflow file — and the org security
 * configuration attached to it, and switches default setup on or off through the door. The switch can be
 * controlled from above, so both writes refuse under an enforced configuration and judge every outcome by a
 * read-back rather than by GitHub's acknowledgement (`../commands/github/codeScanningCore.ts`). `enable`
 * previews by default and sends only on `--approve` quoting the preview's digest
 * (`../commands/github/codeScanningEnablePlan.ts`).
 */

import { GITHUB_ALERT_USAGE } from "../commands/github/alertUsage.js";
import { GITHUB_CODE_SCANNING_USAGE } from "../commands/github/codeScanningUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The two code-scanning verbs, spread into `githubManifest` in `./github.ts`. */
export const githubCodeScanningManifest: Readonly<Record<string, VerbManifestEntry>> = {
  alert: lazy({
    load: () => import("../commands/github/alertRun.js").then((m) => m.githubAlertCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github alert list --repo owner/name --state open",
      parseRejectIsIoFree: true,
      summary:
        "List code-scanning alerts and dismiss one with a reason GitHub's own enum accepts, through the " +
        "door — the way to clear a false positive without a human's own click",
      usage: GITHUB_ALERT_USAGE,
    },
  }),
  "code-scanning": lazy({
    load: () => import("../commands/github/codeScanningRun.js").then((m) => m.githubCodeScanningCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github code-scanning enable --repo owner/name",
      parseRejectIsIoFree: true,
      summary:
        "Read a repository's CodeQL default setup and the org security configuration enforcing it, and switch " +
        "default setup on (previewed, sent on --approve) or off through the door, confirmed by read-back",
      usage: GITHUB_CODE_SCANNING_USAGE,
    },
  }),
};
