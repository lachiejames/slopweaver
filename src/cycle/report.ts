/**
 * Assemble one reconcile pass from the pieces the reader streamed. Pure, and the only place the two halves
 * meet: the close-this proposals rank above the project updates because the close-this half is mechanical,
 * and a card whose first line is a draft to review buries the four tickets that need one word.
 */

import { type CloseThisOutcome, closeThisProposals, type PullRequestState } from "./classify.js";
import { type CycleWindow, currentCycles, earliestCycleStart, teamsWithCurrentCycle } from "./currentCycle.js";
import type { CycleIssue } from "./issue.js";
import type { CycleProject } from "./projectHistory.js";
import { isLive, projectUpdateProposals } from "./projectUpdate.js";
import type { ReleaseInstants } from "./releases.js";
import type { CycleReconcileReport } from "./types.js";

/**
 * The close half, or an empty outcome when there is no current cycle to judge staleness against.
 *
 * Split out because the no-cycle case is a real state rather than an error: with no staleness boundary
 * nothing is stale, and defaulting to an epoch instead would mark every open ticket overdue.
 *
 * @param cycleStartsAt the instant the current cycle opened, or undefined when no cycle spans now
 * @param issues the owner's own issues
 * @param pullRequests how each attached pull request ended, keyed by URL
 * @param releases each repository's release instants
 * @returns the proposals and the count held back for a release
 */
function closesFor({
  currentCycleIds,
  cycleStartsAt,
  issues,
  nowIso,
  pullRequests,
  releases,
}: {
  currentCycleIds: ReadonlySet<string>;
  cycleStartsAt: string | undefined;
  issues: readonly CycleIssue[];
  nowIso: string;
  pullRequests: ReadonlyMap<string, PullRequestState>;
  releases: ReleaseInstants;
}): CloseThisOutcome {
  if (cycleStartsAt === undefined) {
    return { heldForRelease: 0, proposals: [] };
  }
  return closeThisProposals({
    cycleStartsAt,
    currentCycleIds,
    issues,
    nowIso,
    pullRequestStates: pullRequests,
    releases,
  });
}

/**
 * The `could not see` line accounting for tickets the release rule held back.
 *
 * Stated rather than dropped: a row that disappears with no account of itself is the silent-degrade
 * failure this repository has already paid for once. Pure.
 *
 * @param held how many Merged tickets were held back
 * @returns one line when any were held, and no line at all when none were
 */
function heldForReleaseNote({ held }: { held: number }): readonly string[] {
  if (held === 0) {
    return [];
  }
  return [
    `${String(held)} Merged ticket(s) are held back because their repository has not shipped since they merged: the job that moves Merged to Done runs around release time, so those are its work rather than yours`,
  ];
}

/**
 * Build the whole report.
 *
 * @param issues every issue row read from Linear bronze, already reduced to one per identifier
 * @param projects every project row, already reduced to one per id
 * @param windows every cycle row read from the structures lane
 * @param pullRequests how each attached pull request ended, keyed by URL
 * @param ownerLinearId the canonical person this pass is scoped to
 * @param nowIso the instant the answer is about
 * @param home the state home the pass read
 * @param couldNotSee what this pass could not measure, stated rather than omitted
 * @param releases each repository's release instants, the clock a Merged ticket is judged against
 * @returns the assembled report
 */
export function buildReport({
  issues,
  projects,
  windows,
  pullRequests,
  ownerLinearId,
  ownerName,
  nowIso,
  home,
  couldNotSee,
  releases,
}: {
  issues: readonly CycleIssue[];
  projects: readonly CycleProject[];
  windows: readonly CycleWindow[];
  pullRequests: ReadonlyMap<string, PullRequestState>;
  ownerLinearId: string;
  ownerName: string;
  nowIso: string;
  home: string;
  couldNotSee: readonly string[];
  releases: ReleaseInstants;
}): CycleReconcileReport {
  const cycles = currentCycles({ nowIso, windows });
  const currentCycleIds = new Set(cycles.keys());
  const mine = issues.filter((issue) => issue.assigneeId === ownerLinearId);
  const inCycle = mine.filter((issue) => issue.cycleId !== undefined && currentCycleIds.has(issue.cycleId));
  const open = inCycle.filter((issue) => issue.stateType !== "completed" && issue.stateType !== "canceled");
  // No current cycle means there is no staleness boundary, so nothing is judged stale. Answered as an
  // empty proposal set rather than defaulted to an epoch, which would mark every open ticket overdue.
  const cycleStartsAt = earliestCycleStart({ cycles });
  const closed = closesFor({ currentCycleIds, cycleStartsAt, issues: mine, nowIso, pullRequests, releases });
  const closeThis = closed.proposals;
  const updates = projectUpdateProposals({ issues: mine, leadId: ownerLinearId, nowIso, projects });
  return {
    couldNotSee: [...couldNotSee, ...heldForReleaseNote({ held: closed.heldForRelease })],
    generatedAtIso: nowIso,
    home,
    owner: ownerName,
    proposals: [...closeThis, ...updates],
    proposalsOnly: true,
    scan: {
      assignedEver: mine.length,
      liveProjectsLed: projects.filter((project) => project.leadId === ownerLinearId && isLive({ project })).length,
      openInCurrentCycle: open.length,
      staleInCurrentCycle:
        cycleStartsAt === undefined ? 0 : open.filter((issue) => issue.updatedAt < cycleStartsAt).length,
      teamsWithCurrentCycle: teamsWithCurrentCycle({ cycles }),
    },
    wrote: false,
  };
}
