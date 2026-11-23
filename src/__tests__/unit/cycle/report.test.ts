import { describe, expect, it } from "vitest";

import type { PullRequestState } from "../../../cycle/classify.js";
import type { CycleWindow } from "../../../cycle/currentCycle.js";
import type { CycleIssue } from "../../../cycle/issue.js";
import type { CycleProject } from "../../../cycle/projectHistory.js";
import type { ReleaseInstants } from "../../../cycle/releases.js";
import { buildReport } from "../../../cycle/report.js";

const NOW = "2026-10-13T00:00:00.000Z";
const OWNER = "u-owner";
const HOME = "/fixture/home";
const NO_PULL_REQUESTS: ReadonlyMap<string, PullRequestState> = new Map();
const NO_RELEASES: ReleaseInstants = new Map();

/** A cycle that has already ended by {@link NOW}. */
const PAST_CYCLE: CycleWindow = {
  endsAt: "2026-09-20T00:00:00.000Z",
  id: "c-past",
  name: "Cycle 1",
  startsAt: "2026-09-06T00:00:00.000Z",
  teamId: "team-1",
};

/** Three cycles spanning {@link NOW}, two of them on the same team; the earliest opens first. */
const CURRENT_CYCLES: readonly CycleWindow[] = [
  {
    endsAt: "2026-10-20T00:00:00.000Z",
    id: "c1",
    name: "Cycle 2",
    startsAt: "2026-10-06T00:00:00.000Z",
    teamId: "team-1",
  },
  {
    endsAt: "2026-10-22T00:00:00.000Z",
    id: "c2",
    name: "Cycle 2",
    startsAt: "2026-10-08T00:00:00.000Z",
    teamId: "team-2",
  },
  {
    endsAt: "2026-10-21T00:00:00.000Z",
    id: "c3",
    name: "Cycle 3",
    startsAt: "2026-10-07T00:00:00.000Z",
    teamId: "team-1",
  },
];

/** One issue with every field set, overridable per case. */
function issue({ over }: { over: Partial<CycleIssue> & { identifier: string } }): CycleIssue {
  return {
    assigneeId: OWNER,
    attachmentUrls: [],
    cycleId: "c1",
    priority: "High",
    projectId: undefined,
    projectName: undefined,
    recordTsIso: "2026-10-12T00:00:00.000Z",
    stateName: "In Progress",
    stateType: "started",
    team: "ENG",
    title: `Title of ${over.identifier}`,
    updatedAt: "2026-10-10T00:00:00.000Z",
    url: `https://linear.app/acme/issue/${over.identifier}`,
    ...over,
  };
}

/** A live project the owner leads, last updated 30 days before {@link NOW}. */
const OVERDUE_PROJECT: CycleProject = {
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "project:p1",
  lastUpdateIso: "2026-09-13T00:00:00.000Z",
  leadId: OWNER,
  name: "Platform",
  recordTsIso: "2026-10-12T00:00:00.000Z",
  status: "Started",
  updateCount: 1,
  url: "https://linear.app/acme/project/platform",
};

/** Projects that must not count as live-and-led: one completed, one led by someone else. */
const NOT_LED_PROJECTS: readonly CycleProject[] = [
  { ...OVERDUE_PROJECT, id: "project:p2", name: "Done thing", status: "Completed" },
  { ...OVERDUE_PROJECT, id: "project:p3", leadId: "u-other", name: "Someone else's" },
];

describe("buildReport with no current cycle", () => {
  it("reports zero current-cycle counts and no close proposal, while still proposing the overdue project update", () => {
    const report = buildReport({
      couldNotSee: ["github bronze is absent"],
      home: HOME,
      issues: [issue({ over: { identifier: "A-1", updatedAt: "2026-09-01T00:00:00.000Z" } })],
      nowIso: NOW,
      ownerLinearId: OWNER,
      ownerName: "Owner Name",
      projects: [OVERDUE_PROJECT, ...NOT_LED_PROJECTS],
      pullRequests: NO_PULL_REQUESTS,
      releases: NO_RELEASES,
      windows: [PAST_CYCLE],
    });

    expect(report).toEqual({
      couldNotSee: ["github bronze is absent"],
      generatedAtIso: NOW,
      home: HOME,
      owner: "Owner Name",
      proposals: [
        {
          action: "project-update",
          daysSinceMoved: 30,
          draft: "Platform\n\nNothing on this project moved since the last update.\n\nNothing is open on it.",
          evidence: [
            {
              fact: "its last status update was 30 days ago, on 2026-09-13",
              url: "https://linear.app/acme/project/platform",
            },
          ],
          headline: "Platform has had no status update for 30 days.",
          movedAtIso: "2026-09-13T00:00:00.000Z",
          oneWordReplies: ["post", "edit", "later"],
          subject: "Platform",
          url: "https://linear.app/acme/project/platform",
        },
      ],
      proposalsOnly: true,
      scan: {
        assignedEver: 1,
        liveProjectsLed: 1,
        openInCurrentCycle: 0,
        staleInCurrentCycle: 0,
        teamsWithCurrentCycle: 0,
      },
      wrote: false,
    });
  });
});

describe("buildReport with current cycles", () => {
  it("scopes to the owner, excludes completed and canceled from open, and judges staleness on both sides of the earliest cycle start", () => {
    const issues = [
      // Stale: one second before the earliest current cycle opened, and nothing attached.
      issue({ over: { identifier: "A-1", updatedAt: "2026-10-05T23:59:59.000Z" } }),
      // Not stale: moved exactly at the boundary.
      issue({ over: { cycleId: "c2", identifier: "A-2", updatedAt: "2026-10-06T00:00:00.000Z" } }),
      issue({
        over: { identifier: "A-3", stateName: "Done", stateType: "completed", updatedAt: "2026-09-01T00:00:00.000Z" },
      }),
      issue({
        over: {
          identifier: "A-4",
          stateName: "Canceled",
          stateType: "canceled",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      }),
      // Someone else's stale ticket in a current cycle: no count, no proposal.
      issue({ over: { assigneeId: "u-other", identifier: "B-1", updatedAt: "2026-09-01T00:00:00.000Z" } }),
      // The owner's, but in a cycle that is not current.
      issue({ over: { cycleId: "c-past", identifier: "A-6", updatedAt: "2026-09-01T00:00:00.000Z" } }),
    ];
    const report = buildReport({
      couldNotSee: [],
      home: HOME,
      issues,
      nowIso: NOW,
      ownerLinearId: OWNER,
      ownerName: "Owner Name",
      projects: NOT_LED_PROJECTS,
      pullRequests: NO_PULL_REQUESTS,
      releases: NO_RELEASES,
      windows: [PAST_CYCLE, ...CURRENT_CYCLES],
    });

    expect(report).toEqual({
      couldNotSee: [],
      generatedAtIso: NOW,
      home: HOME,
      owner: "Owner Name",
      proposals: [
        {
          action: "trace",
          daysSinceMoved: 7,
          evidence: [
            {
              fact: "nothing is attached to it and it has not moved for 7 days, so where it came from is the only way to know whether it is still real",
              url: "https://linear.app/acme/issue/A-1",
            },
          ],
          headline: "A-1 has not moved for 7 days and has no pull request attached.",
          movedAtIso: "2026-10-05T23:59:59.000Z",
          oneWordReplies: ["close", "keep", "later"],
          priority: "High",
          subject: "A-1",
          title: "Title of A-1",
          url: "https://linear.app/acme/issue/A-1",
        },
      ],
      proposalsOnly: true,
      scan: {
        assignedEver: 5,
        liveProjectsLed: 0,
        openInCurrentCycle: 2,
        staleInCurrentCycle: 1,
        teamsWithCurrentCycle: 2,
      },
      wrote: false,
    });
  });

  it("places the close proposal before a project update that has gone unmoved for longer", () => {
    const pullRequest = "https://github.com/acme/app/pull/12";
    const report = buildReport({
      couldNotSee: [],
      home: HOME,
      issues: [
        issue({
          over: {
            attachmentUrls: [pullRequest],
            identifier: "A-1",
            projectId: "p1",
            updatedAt: "2026-10-05T23:59:59.000Z",
          },
        }),
      ],
      nowIso: NOW,
      ownerLinearId: OWNER,
      ownerName: "Owner Name",
      projects: [OVERDUE_PROJECT],
      pullRequests: new Map<string, PullRequestState>([[pullRequest, "MERGED"]]),
      releases: NO_RELEASES,
      windows: CURRENT_CYCLES,
    });

    expect(report.proposals).toEqual([
      {
        action: "close-with-comment",
        daysSinceMoved: 7,
        evidence: [
          {
            fact: "the pull request attached to this ticket is merged, so the work it asks for has shipped",
            url: pullRequest,
          },
          { fact: "the ticket has not moved for 7 days", url: "https://linear.app/acme/issue/A-1" },
        ],
        headline: "A-1 has a merged pull request and is still open.",
        movedAtIso: "2026-10-05T23:59:59.000Z",
        oneWordReplies: ["close", "keep", "later"],
        priority: "High",
        subject: "A-1",
        title: "Title of A-1",
        url: "https://linear.app/acme/issue/A-1",
      },
      {
        action: "project-update",
        daysSinceMoved: 30,
        draft: "Platform\n\nSince the last update, 1 item(s) moved: A-1.\n\n1 item(s) still open: A-1.",
        evidence: [
          {
            fact: "its last status update was 30 days ago, on 2026-09-13",
            url: "https://linear.app/acme/project/platform",
          },
        ],
        headline: "Platform has had no status update for 30 days.",
        movedAtIso: "2026-09-13T00:00:00.000Z",
        oneWordReplies: ["post", "edit", "later"],
        subject: "Platform",
        url: "https://linear.app/acme/project/platform",
      },
    ]);
  });

  it("appends the held-for-release line after the caller's own lines and shows no proposal for the held ticket", () => {
    const report = buildReport({
      couldNotSee: ["github bronze is absent"],
      home: HOME,
      issues: [
        issue({
          over: {
            attachmentUrls: ["https://github.com/acme/app/pull/40"],
            identifier: "A-9",
            stateName: "Merged",
            updatedAt: "2026-10-09T00:00:00.000Z",
          },
        }),
      ],
      nowIso: NOW,
      ownerLinearId: OWNER,
      ownerName: "Owner Name",
      projects: [],
      pullRequests: NO_PULL_REQUESTS,
      releases: new Map([["acme/app", ["2026-09-01T00:00:00.000Z"]]]),
      windows: CURRENT_CYCLES,
    });

    expect(report.proposals).toEqual([]);
    expect(report.couldNotSee).toEqual([
      "github bronze is absent",
      "1 Merged ticket(s) are held back because their repository has not shipped since they merged: the job that moves Merged to Done runs around release time, so those are its work rather than yours",
    ]);
  });
});
