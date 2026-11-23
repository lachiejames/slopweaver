/**
 * The escape-hatch rows for LANDING a pull request — a required context never observed, a merge that
 * reverts `main`, review threads nobody has read, and a local lap run off the designated lap seat.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new merge or enqueue refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on the merge and enqueue path, in register order. */
export const GITHUB_MERGE_HATCHES = [
  {
    caught:
      "a context this write would make REQUIRED has not been observed on a merge-group ref in the window read, and a merge queue waits forever for a required check that never arrives — it does not fail the entry, it stalls it",
    command: "slopweaver github required-contexts",
    exceptions: [
      "the context is genuinely new and simply has no queue entry yet — its workflow DOES carry a `merge_group:` trigger, which you have read in the file rather than assumed",
      "the branch has no merge queue at all, so there is no entry for a missing check to stall",
      "the context is a legacy COMMIT STATUS rather than a check run — the window reads check runs and check suites, and a status carries no suite while the entry head and the commit it lands as are the SAME sha, so nothing can tell a status posted for the entry from one posted for the landing; confirm it posts on a `gh-readonly-queue/` ref yourself",
      "more than 100 check runs, check suites or `merge_group` workflow runs sit inside the window — every read takes one page, so a name past that page reads as absent",
    ],
    id: "unobserved-required-context",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNOBSERVED_REQUIRED_CONTEXT" },
    lane: "ambient",
    reader: "src/cli/commands/github/requiredContextsCore.ts",
    standing: "proposed",
  },
  {
    caught:
      "the base branch held exactly this proposed content at a named commit and holds something different at its tip, so merging restores the older version",
    command: "slopweaver github merge",
    exceptions: [
      "the restore IS the change — a deliberate revert whose pull-request body says so",
      "you read the named commit and the older version is the one that should stand",
    ],
    id: "reverts-main",
    key: { kind: "command", incantation: "slopweaver github merge --acknowledge <path>" },
    lane: "ambient",
    reader: "src/cli/commands/github/mergeCore.ts",
    standing: "ruled",
  },
  {
    caught:
      "the landing could not see every review thread on the owner's pull request, so it cannot tell whether one of the owner's walkthrough notes holds a colleague's reply collapsed under the owner's own resolve",
    command: "slopweaver github <enqueue|merge --admin>",
    exceptions: [
      "the pull request carries more review threads than one read holds, and `github thread list` shows none of the owner's notes resolved over somebody else's last word",
      "GitHub's thread read keeps failing while the rest of its API answers, and you have read the threads another way",
    ],
    id: "unseen-review-threads",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNSEEN_REVIEW_THREADS" },
    lane: "ambient",
    reader: "src/cli/commands/github/walkthroughStepDeps.ts",
    standing: "proposed",
  },
  {
    caught:
      "a lap seat is designated (`github lap-seat show`) and this session does not hold its open run, so this lap would take the machine's one lap lock out of the chair's landing order",
    command: "slopweaver github lap",
    exceptions: [
      "you ARE the lap seat, reseated under a new session that cannot claim its run because the old one is still recorded as its writer",
      "the chair has told you in this session to lap this one pull request yourself and the lap seat is idle",
    ],
    id: "off-seat-lap",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_OFF_SEAT_LAP" },
    lane: "ambient",
    reader: "src/cli/commands/github/lapRun.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
