/**
 * The `github` verbs that act on one pull request, spread into `githubManifest` in `./github.ts` where `close`
 * always sat: `close`, `comment`, `enqueue`, `hold`, `label`, `lap`, `lap-seat`, `merge` and `pr`. Held apart so `./github.ts`
 * stays under its file-size ceiling; that module's header carries what each of them does.
 */
import { GITHUB_HOLD_USAGE } from "../commands/github/holdUsage.js";
import { GITHUB_LAP_SEAT_USAGE } from "../commands/github/lapSeatUsage.js";
import { GITHUB_LAP_USAGE } from "../commands/github/lapUsage.js";
import * as prUsage from "../commands/github/prUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { MERGE_USAGE, USAGE } from "./githubNounUsage.js";

/** `github close`, `comment`, `enqueue`, `hold`, `label`, `lap`, `lap-seat`, `merge` and `pr`. */
export const githubPullRequestActionsManifest: Readonly<Record<string, VerbManifestEntry>> = {
  close: lazy({
    load: () => import("../commands/github/closeRun.js").then((m) => m.githubCloseCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: false,
      effect: "external-write",
      example: 'slopweaver github close --repo owner/name --number 123 --why "superseded by the stacked replacement"',
      parseRejectIsIoFree: true,
      summary:
        "Close an open pull request through the door — refuses a merged or already-closed one by name, " +
        "and refuses a silent close unless a recent comment or --why explains it",
      usage: prUsage.GITHUB_CLOSE_USAGE,
    },
  }),
  comment: lazy({
    load: () => import("../commands/github/commentRun.js").then((m) => m.githubCommentCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github comment create --repo owner/name --number 123 --form - --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Post or edit a top-level comment on an issue or pull request through the door — the plain " +
        "activity-feed message, distinct from a review-thread reply",
      usage: prUsage.GITHUB_COMMENT_USAGE,
    },
  }),
  enqueue: lazy({
    load: () => import("../commands/github/enqueueRun.js").then((m) => m.githubEnqueueCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: false,
      effect: "external-write",
      example: "slopweaver github enqueue --pr <number> --repo owner/name --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Press GitHub's own 'Merge when ready' — queue one pull request in its base branch's native merge " +
        "queue through the door, and confirm the position it took by read-back",
      usage: prUsage.GITHUB_ENQUEUE_USAGE,
    },
  }),
  hold: lazy({
    load: () => import("../commands/github/holdRun.js").then((m) => m.githubHoldCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver github hold --pr <number> --repo owner/name --why "rebase hell — let it land first"',
      parseRejectIsIoFree: true,
      summary:
        "Give ONE pull request the merge queue — every other one is refused at `github merge` AND at " +
        "`github enqueue` until it is released, so no session can miss the hold the way it can miss a message",
      usage: GITHUB_HOLD_USAGE,
    },
  }),
  label: lazy({
    load: () => import("../commands/github/labelRun.js").then((m) => m.githubLabelCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github label --repo owner/name --number 123 --add e2e-local --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Add labels to one issue or pull request through the door, refusing a label the repository does " +
        "not already define",
      usage: prUsage.GITHUB_LABEL_USAGE,
    },
  }),
  lap: lazy({
    load: () => import("../commands/github/lapRun.js").then((m) => m.githubLapCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: false,
      effect: "external-write",
      example: "slopweaver github lap --repo owner/name --number 123 --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Run the whole CI lap on this machine over one pull request's head and post `build` and " +
        "`integration` on it through the door — the local stand-in for hosted Actions — and with --land, land it",
      usage: GITHUB_LAP_USAGE,
    },
  }),
  "lap-seat": lazy({
    load: () => import("../commands/github/lapSeatRun.js").then((m) => m.githubLapSeatCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: false,
      effect: "local-state",
      example: "slopweaver github lap-seat show",
      parseRejectIsIoFree: true,
      summary:
        "Name the one handover run whose session may run `github lap` while the chair's rota stands — every " +
        "other session's lap is refused before it reads anything, naming the seat",
      usage: GITHUB_LAP_SEAT_USAGE,
    },
  }),
  merge: lazy({
    load: () => import("../commands/github/mergeRun.js").then((m) => m.githubMergeCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: 'slopweaver github merge --repo owner/name --base main --head a-branch --description "-"',
      parseRejectIsIoFree: true,
      summary:
        "Report every reason a pull request should not merge yet — a probe regression, a squash " +
        "signature, an unmentioned deletion — and with --admin, merge it through the administrator bypass",
      usage: MERGE_USAGE,
    },
  }),
  pr: lazy({
    load: () => import("../commands/github/run.js").then((m) => m.githubPrCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github pr update --repo o/r --number 1 --edit - --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Update a pull request's description, reviewers or base from a typed form — rendered by code, " +
        "through the door. Opening one is `github stack push`",
      usage: USAGE,
    },
  }),
};
