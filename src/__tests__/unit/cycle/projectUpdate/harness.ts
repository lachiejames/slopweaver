/*
 * What the project-update test files share: the lead id the builders default to, the instant every proposal is
 * judged at, and a `CycleProject` and a `CycleIssue` builder whose defaults are one live project the owner leads
 * and one ticket in it. They moved here when the project-update tests were split by behaviour.
 */
import type { CycleIssue } from "../../../../cycle/issue.js";
import type { CycleProject } from "../../../../cycle/projectHistory.js";

export const OWNER = "owner";
export const NOW = "2026-09-01T00:00:00.000Z";

/**
 * One project row, defaulting to a live project the owner leads that has never had a status update.
 *
 * @returns the project, every field the test did not name at its default
 */
export const project = (over: Partial<CycleProject> = {}): CycleProject => ({
  createdAt: "2026-05-01T00:00:00.000Z",
  id: "project:p1",
  lastUpdateIso: undefined,
  leadId: OWNER,
  name: "Example project",
  recordTsIso: "2026-08-28T00:00:00.000Z",
  status: "In Progress",
  updateCount: 0,
  url: "https://linear.app/example/project/example-project",
  ...over,
});

/**
 * One cycle issue, defaulting to an in-review ticket the owner holds inside the default project.
 *
 * @returns the issue, every field the test did not name at its default
 */
export const issue = (over: Partial<CycleIssue> = {}): CycleIssue => ({
  assigneeId: OWNER,
  attachmentUrls: [],
  cycleId: "c1",
  identifier: "EXA-1",
  priority: "Medium",
  projectId: "p1",
  projectName: "Example project",
  recordTsIso: "2026-08-20T00:00:00.000Z",
  stateName: "In Review",
  stateType: "started",
  team: "EXA",
  title: "a ticket",
  updatedAt: "2026-08-20T00:00:00.000Z",
  url: "https://linear.app/example/issue/exa-1",
  ...over,
});
