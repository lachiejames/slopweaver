/**
 * The `github` verbs about WHO reviews an open pull request, split out of `./github.ts` when adding
 * `reviewer` would have taken that manifest past its size ratchet.
 *
 * `review-state` answers seven questions per pull request from GitHub and Slack. `reviewer` reads no provider
 * at all for `list`: it joins the last recorded `github landing` reading with the reviewer register, and `pick`
 * records the owner's verdict on a suggested reviewer. An approving `pick` then parks the ask to that person through
 * `slack draft record`'s own path, which is `local-state` for the same reason: its Slack calls are reads and it
 * posts nothing. `read` makes the one Slack read `slack read-thread` makes, classified the same way. None sends
 * anything — hence `local-state`, not `external-write`.
 *
 * `review-draft` is the other side: the owner's review of somebody else's pull request, parked as draft line comments
 * on a card, and posted only through the door once `--approve` names the digest of exactly that review.
 */

import { githubReviewStateUsage } from "../commands/github/reportUsage.js";
import { githubReviewDraftUsage } from "../commands/github/reviewDraftUsage.js";
import { githubReviewerUsage } from "../commands/github/reviewerUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** The review verbs, spread into `githubManifest` in `./github.ts`. */
export const githubReviewersManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "review-draft": lazy({
    load: () => import("../commands/github/reviewDraftRun.js").then((m) => m.githubReviewDraftCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github review-draft list --json",
      parseRejectIsIoFree: true,
      summary:
        "The owner's review of somebody else's pull request, parked as draft line comments on a card with the hunk each " +
        "sits on — `record` sends nothing, and `post` submits it once through the door only with the owner's approval digest",
      usage: githubReviewDraftUsage(),
    },
  }),
  reviewer: lazy({
    load: () => import("../commands/github/reviewerRun.js").then((m) => m.githubReviewerCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver github reviewer list --json",
      parseRejectIsIoFree: true,
      summary:
        "Who each open pull request is on the hook with, and a suggested reviewer when nobody usefully is — " +
        "joined from the last landing reading and the reviewer register; `pick` records the owner's verdict, an approve " +
        "parking the ask for the owner's yes, `read` a visible session's quoted reading of an unsettled message, and " +
        "`backfill` the asks the corpus holds on pull requests no reading saw, none of them sending anything",
      usage: githubReviewerUsage(),
    },
  }),
  "review-state": lazy({
    load: () => import("../commands/github/reviewStateRun.js").then((m) => m.githubReviewStateCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver github review-state --repo owner/name --author someone --json",
      parseRejectIsIoFree: true,
      summary:
        "Answer seven questions about every open pull request — CI, CodeRabbit, draft, the codeowner-required " +
        "approver, and whether Slack has been told, asked, or needs a bump — with `unknown` where an absence " +
        "cannot be bounded",
      usage: githubReviewStateUsage(),
    },
  }),
};
