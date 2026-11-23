/**
 * The repository re-cut verbs, spread into `githubManifest` in `./github.ts`: `push-root`, the register of the one
 * root each re-cut repository accepts, and `repoint-plan`, the dry-run inventory of what its switch changes. Both
 * are keyed by a GitHub `owner/name` and touch only local state. Held apart so `./github.ts` stays under its
 * file-size ceiling.
 */
import { GITHUB_PUSH_ROOT_USAGE, GITHUB_REPOINT_PLAN_USAGE } from "../commands/github/repositoryRecutUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** `github push-root` and `github repoint-plan`. */
export const githubRecutManifest: Readonly<Record<string, VerbManifestEntry>> = {
  "push-root": lazy({
    load: () => import("../commands/github/pushRootRun.js").then((m) => m.githubPushRootCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver github push-root record --repo owner/name --root <40-hex> --dry-run",
      parseRejectIsIoFree: true,
      summary:
        "Record the one root a re-cut repository accepts, or list the bindings — every push to a bound repository " +
        "then refuses a commit whose history has any other root",
      usage: GITHUB_PUSH_ROOT_USAGE,
    },
  }),
  "repoint-plan": lazy({
    load: () => import("../commands/github/repointPlanRun.js").then((m) => m.githubRepointPlanCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: true,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver github repoint-plan --repo owner/name --archive-name name-archive --new-checkout /abs/clone",
      parseRejectIsIoFree: true,
      summary:
        "Dry run: every local place that names a repository and what its re-cut switch changes it to — remotes, " +
        "worktrees, profile, desktop, plugin, launch agents and state-home links — writing nothing",
      usage: GITHUB_REPOINT_PLAN_USAGE,
    },
  }),
};
