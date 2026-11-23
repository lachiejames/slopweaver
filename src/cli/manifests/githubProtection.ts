/**
 * The branch-protection write verbs, spread into `githubManifest` in `./github.ts`: `push-restriction` and
 * `required-contexts`. Held apart so `./github.ts` stays under its file-size ceiling.
 */
import * as prUsage from "../commands/github/prUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** `github push-restriction` and `github required-contexts`. */
export const githubProtectionManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "push-restriction": lazy({
    load: () => import("../commands/github/pushRestrictionRun.js").then((m) => m.githubPushRestrictionCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github push-restriction --repo owner/name --branch main --allow octocat --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Read, and govern through the door, who may push to, merge into and enqueue onto a branch — its " +
        "classic rule's push restriction, written over GraphQL so nothing else on the rule moves",
      usage: prUsage.GITHUB_PUSH_RESTRICTION_USAGE,
    },
  }),
  "required-contexts": lazy({
    load: () => import("../commands/github/requiredContextsRun.js").then((m) => m.githubRequiredContextsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver github required-contexts --repo owner/name --branch main --require CodeQL --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Read, and govern through the door, which status-check contexts a branch REQUIRES — refusing a " +
        "context no merge-group entry has been seen to run",
      usage: prUsage.GITHUB_REQUIRED_CONTEXTS_USAGE,
    },
  }),
};
