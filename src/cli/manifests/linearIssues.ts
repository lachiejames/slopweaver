/**
 * The `linear issues` verb's manifest entry, declared apart from `./linear.ts` and spread into it, so that file
 * stays under the file-size cap — the split `./linearLabel.ts` makes for `labels`.
 *
 * `issues` lists every issue a team or project holds, live and complete, where `query` answers from the local
 * corpus and so can never prove a set is whole (moving the fleet's filings out of a team the owner left, say).
 */
import { LINEAR_ISSUES_USAGE } from "../commands/linear/issuesUsage.js";
import { LINEAR_MOVE_ISSUES_USAGE } from "../commands/linear/moveIssuesUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

export const linearIssuesManifest: Readonly<Record<string, VerbManifestEntry>> = {
  issues: lazy({
    load: () => import("../commands/linear/issuesRun.js").then((m) => m.linearIssuesCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver linear issues --team ENG --creator me --json",
      parseRejectIsIoFree: true,
      summary: "List every issue one team or project holds, live — complete or refused, never a first page",
      usage: LINEAR_ISSUES_USAGE,
    },
  }),
  "move-issues": lazy({
    load: () => import("../commands/linear/moveIssuesRun.js").then((m) => m.linearMoveIssuesCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver linear move-issues --to RRRR --identifier SUP-9241,SUP-9242",
      parseRejectIsIoFree: true,
      summary:
        "Move named issues into another team, state kept by name and type, refused per issue where a move would lose more",
      usage: LINEAR_MOVE_ISSUES_USAGE,
    },
  }),
};
