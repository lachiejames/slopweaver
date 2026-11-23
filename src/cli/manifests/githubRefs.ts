/**
 * The remote-ref write verbs, spread into `githubManifest` in `./github.ts` where `push` always sat:
 * `branch delete`, `push` and `tag create`. Held apart so `./github.ts` stays under its file-size ceiling.
 */
import { GITHUB_BRANCH_USAGE, GITHUB_TAG_USAGE } from "../commands/github/refsUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { PUSH_USAGE } from "./githubNounUsage.js";

/** `github branch`, `github push` and `github tag`. */
export const githubRefsManifest: Readonly<Record<string, VerbManifestEntry>> = {
  branch: lazy({
    load: () => import("../commands/github/branchDeleteRun.js").then((m) => m.githubBranchCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: false,
      effect: "external-write",
      example:
        "slopweaver github branch delete --repo owner/name --branch old-work --keep-as-tag archive/old-work --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Delete a branch on the remote through the door, dry-run first — refuses the default branch and one " +
        "an open pull request names, and --keep-as-tag tags the live tip first so the branch stays recoverable",
      usage: GITHUB_BRANCH_USAGE,
    },
  }),
  push: lazy({
    load: () => import("../commands/github/pushRun.js").then((m) => m.githubPushCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: false,
      effect: "external-write",
      example: "slopweaver github push --dry-run",
      parseRejectIsIoFree: true,
      summary: "Push the checked-out PR branch through the door, with exact-lease and remote-SHA verification",
      usage: PUSH_USAGE,
    },
  }),
  tag: lazy({
    load: () => import("../commands/github/tagCreateRun.js").then((m) => m.githubTagCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: false,
      effect: "external-write",
      example: "slopweaver github tag create --repo owner/name --tag archive/x --sha <40-hex> --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Create a tag on the remote at a commit it already holds, through the door — no objects pushed, and a " +
        "tag already at another commit is refused by name",
      usage: GITHUB_TAG_USAGE,
    },
  }),
};
