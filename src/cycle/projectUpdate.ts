/**
 * The project-update half: which of the owner's own projects are overdue for a status update, and the draft
 * the owner answers with one word.
 *
 * Scoped to projects the owner LEADS, deliberately. Measured on a real home — of hundreds of live projects
 * in the workspace, most had never had a single update posted. That is an organisational fact rather than the
 * owner's task, and putting it on their card would bury the handful that are.
 *
 * `projectUpdates`, `teams` and `members` are GraphQL CONNECTIONS shaped `{"nodes": [...]}`, not bare arrays.
 * Reading one as an array silently yields zero, which reads exactly like "never updated" — so the reader
 * in `./projectHistory.ts` goes through `nodes` and a test pins it.
 *
 * Pure: the caller streams the records and supplies the instant.
 */

import type { CycleIssue } from "./issue.js";
import type { CycleProject } from "./projectHistory.js";
import type { CycleProposal } from "./types.js";

/**
 * How long a project may go without an update before it is on the card.
 *
 * @internal — the threshold {@link projectUpdateProposals} applies; no caller outside this module names it.
 */
export const UPDATE_OVERDUE_DAYS = 14;

/**
 * Whether a project is still running, by its own status name.
 *
 * @returns `true` while the project is neither completed nor cancelled
 */
export function isLive({ project }: { project: CycleProject }): boolean {
  const status = project.status.toLowerCase();
  return status !== "completed" && status !== "canceled" && status !== "cancelled";
}

/** Whole days between two instants, floored at zero. */
function daysBetween({ fromIso, toIso }: { fromIso: string; toIso: string }): number {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000));
}

/**
 * The drafted update body — assembled from what actually moved, never composed from nothing.
 *
 * Two paragraphs and no more: what moved since the last update, and what is still open. A project with no
 * movement to report says so, because a status update that invents progress is worse than a missing one.
 */
function draftFor({
  project,
  moved,
  stillOpen,
}: {
  project: CycleProject;
  moved: readonly CycleIssue[];
  stillOpen: readonly CycleIssue[];
}): string {
  const movedLine =
    moved.length === 0
      ? "Nothing on this project moved since the last update."
      : `Since the last update, ${String(moved.length)} item(s) moved: ${moved.map((issue) => issue.identifier).join(", ")}.`;
  const openLine =
    stillOpen.length === 0
      ? "Nothing is open on it."
      : `${String(stillOpen.length)} item(s) still open: ${stillOpen.map((issue) => issue.identifier).join(", ")}.`;
  return `${project.name}\n\n${movedLine}\n\n${openLine}`;
}

/**
 * Every overdue-update proposal for the projects one person leads.
 *
 * @param projects the workspace's projects, already reduced to one row each
 * @param leadId the owner's Linear user id
 * @param issues the owner-visible issues, used to say what moved rather than to guess it
 * @param nowIso the instant the answer is about
 * @returns the proposals, longest-overdue first
 */
export function projectUpdateProposals({
  projects,
  leadId,
  issues,
  nowIso,
}: {
  projects: readonly CycleProject[];
  leadId: string;
  issues: readonly CycleIssue[];
  nowIso: string;
}): readonly CycleProposal[] {
  const led = projects.filter((project) => project.leadId === leadId && isLive({ project }));
  const proposals: CycleProposal[] = [];
  for (const project of led) {
    const proposal = overdueProposal({ issues, nowIso, project });
    if (proposal !== undefined) {
      proposals.push(proposal);
    }
  }
  return proposals.toSorted((a, b) => b.daysSinceMoved - a.daysSinceMoved);
}

/** When a project's update clock started: its last update, else its own creation, else nothing known. */
function overdueSinceOf({ project }: { project: CycleProject }): string | undefined {
  if (project.lastUpdateIso !== undefined) {
    return project.lastUpdateIso;
  }
  return project.createdAt;
}

/**
 * Whether an issue belongs to a project, joined on the project's id.
 *
 * Not on its name: a real corpus has titles each held by two distinct projects, so a name join
 * put one project's issues in the other's "still open" list. A row with no project id at all — captured before
 * the SDK migration and untouched since — has nothing else to join on, so it alone is matched by name.
 *
 * @param issue the issue, carrying its project id when its row recorded one
 * @param project the project, whose `id` is its record's `project:<id>` sourceId
 * @returns true when the issue is in the project
 */
export function issueInProject({ issue, project }: { issue: CycleIssue; project: CycleProject }): boolean {
  if (issue.projectId !== undefined) {
    return `project:${issue.projectId}` === project.id;
  }
  return issue.projectName === project.name;
}

/**
 * One project's overdue-update proposal, or `undefined` while its last update is still recent enough.
 *
 * @param project the project being judged, already known to be one the owner leads and still running
 * @param issues the owner-visible issues, used to say what moved rather than to guess it
 * @param nowIso the instant the answer is about
 * @returns the proposal, or undefined when nothing is overdue about it
 */
function overdueProposal({
  project,
  issues,
  nowIso,
}: {
  project: CycleProject;
  issues: readonly CycleIssue[];
  nowIso: string;
}): CycleProposal | undefined {
  const since = project.lastUpdateIso;
  // A project that has NEVER been updated is overdue by its own whole age, not by zero. Ranking it on a
  // zero put the worst case last — caught by a test rather than by review.
  const overdueSince = overdueSinceOf({ project });
  const days =
    overdueSince === undefined ? Number.MAX_SAFE_INTEGER : daysBetween({ fromIso: overdueSince, toIso: nowIso });
  if (days < UPDATE_OVERDUE_DAYS) {
    return undefined;
  }
  const mine = issues.filter((issue) => issueInProject({ issue, project }));
  const moved = since === undefined ? [] : mine.filter((issue) => issue.updatedAt > since);
  const stillOpen = mine.filter((issue) => issue.stateType !== "completed" && issue.stateType !== "canceled");
  return {
    action: "project-update",
    daysSinceMoved: days,
    draft: draftFor({ moved, project, stillOpen }),
    evidence: [
      {
        fact:
          since === undefined
            ? "this project has never had a status update posted"
            : `its last status update was ${String(days)} days ago, on ${since.slice(0, 10)}`,
        url: project.url,
      },
    ],
    headline:
      since === undefined
        ? `${project.name} has never had a status update.`
        : `${project.name} has had no status update for ${String(days)} days.`,
    oneWordReplies: ["post", "edit", "later"],
    subject: project.name,
    url: project.url,
    ...(overdueSince === undefined ? {} : { movedAtIso: overdueSince }),
  };
}
