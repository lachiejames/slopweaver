/**
 * The `github` verbs that REPORT on many pull requests at once and act on none of them, split out of
 * `./github.ts` when adding `coderabbit-yield` would have taken that manifest past its size ratchet.
 *
 * `bottleneck` groups the open backlog by where each pull request is waiting. `coderabbit-yield` looks back
 * instead: what became of every CodeRabbit finding on one author's pull requests over a window, so whether
 * the reviewer earns its noise is a number rather than an impression. Both are pure
 * reads: `effect: "external-read"` + `doorRouted: false`, like `read`/`search`/`checks`.
 */

import { githubBottleneckUsage } from "../commands/github/bottleneckUsage.js";
import { githubCoderabbitYieldUsage } from "../commands/github/coderabbitYieldUsage.js";
import { githubExposureUsage } from "../commands/github/exposureUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The reporting verbs, spread into `githubManifest` in `./github.ts`. */
export const githubReportsManifest: Readonly<Record<string, VerbManifestEntry>> = {
  bottleneck: lazy({
    load: () => import("../commands/github/bottleneckRun.js").then((m) => m.githubBottleneckCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github bottleneck --repo owner/name --json",
      parseRejectIsIoFree: true,
      summary:
        "Group every open pull request by WHERE it is waiting and on what — one cause each down a fixed " +
        "ladder, a histogram largest first, and the wait measured from when it was OPENED rather than from " +
        "an `updatedAt` a check re-run bumps — so a backlog names the mechanism to fix rather than the pull " +
        "request to nudge. Drafts are IN by default, which is the opposite of `landing`",
      usage: githubBottleneckUsage(),
    },
  }),
  "coderabbit-yield": lazy({
    load: () => import("../commands/github/coderabbitYieldRun.js").then((m) => m.githubCoderabbitYieldCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github coderabbit-yield --repo owner/a,owner/b --days 60 --json",
      parseRejectIsIoFree: true,
      summary:
        "Measure what became of every CodeRabbit finding on one author's pull requests over a window — " +
        "reported addressed, a reply citing a commit, outdated, resolved with no sign of a change, or still " +
        "open — cross-tabbed by severity, type and category, with review-body nitpicks counted apart",
      usage: githubCoderabbitYieldUsage(),
    },
  }),
  exposure: lazy({
    load: () => import("../commands/github/exposureRun.js").then((m) => m.githubExposureCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github exposure inventory --repo owner/name --json",
      parseRejectIsIoFree: true,
      summary:
        "Count what every surface of a repository holds that becomes public when it is switched public — refs, " +
        "commits and identities, file history, every comment kind, Actions, releases, discussions, Pages, wiki — " +
        "and name each surface that could not be counted, never a silent zero; `sweep` scans all that text for " +
        "secrets and identifiers, findings to the state home only. It edits nothing",
      usage: githubExposureUsage(),
    },
  }),
};
