/*
 * `projectUpdateProposals` — which projects the owner leads are due a status update, how each is ranked, and the
 * draft built from what actually moved. It moved here when the project-update tests were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import type { CycleIssue } from "../../../../cycle/issue.js";
import type { CycleProject } from "../../../../cycle/projectHistory.js";
import { projectUpdateProposals } from "../../../../cycle/projectUpdate.js";
import { issue, NOW, OWNER, project } from "./harness.js";

describe("projectUpdateProposals", () => {
  const run = ({ projects, issues = [] }: { projects: readonly CycleProject[]; issues?: readonly CycleIssue[] }) =>
    projectUpdateProposals({ issues, leadId: OWNER, nowIso: NOW, projects });

  it("proposes an update for a project that has never had one, aged from its own start", () => {
    const [proposal] = run({ projects: [project()] });
    expect(proposal!.action).toBe("project-update");
    expect(proposal!.headline).toBe("Example project has never had a status update.");
    expect(proposal!.daysSinceMoved).toBe(123);
    expect(proposal!.oneWordReplies).toEqual(["post", "edit", "later"]);
  });

  it("proposes an update once the last one is older than the threshold", () => {
    const [proposal] = run({ projects: [project({ lastUpdateIso: "2026-08-01T00:00:00.000Z" })] });
    expect(proposal!.headline).toBe("Example project has had no status update for 31 days.");
  });

  it("proposes nothing for a project updated inside the threshold", () => {
    expect(run({ projects: [project({ lastUpdateIso: "2026-08-29T00:00:00.000Z" })] })).toEqual([]);
  });

  it("proposes nothing for a project somebody else leads", () => {
    expect(run({ projects: [project({ leadId: "somebody-else" })] })).toEqual([]);
  });

  it("proposes nothing for a project that has finished", () => {
    expect(run({ projects: [project({ status: "Completed" })] })).toEqual([]);
  });

  it("drafts from what actually moved rather than composing progress", () => {
    const moved = issue({ identifier: "EXA-7", updatedAt: "2026-08-20T00:00:00.000Z" });
    const [proposal] = run({ issues: [moved], projects: [project({ lastUpdateIso: "2026-08-01T00:00:00.000Z" })] });
    expect(proposal!.draft).toBe(
      "Example project\n\nSince the last update, 1 item(s) moved: EXA-7.\n\n1 item(s) still open: EXA-7.",
    );
  });

  it("says plainly that nothing moved rather than inventing progress", () => {
    const [proposal] = run({ projects: [project({ lastUpdateIso: "2026-08-01T00:00:00.000Z" })] });
    expect(proposal!.draft).toBe(
      "Example project\n\nNothing on this project moved since the last update.\n\nNothing is open on it.",
    );
  });

  // Measured on the owner's corpus: three project titles are each held by two distinct projects, and a name join
  // put one project's tickets in the other's draft.
  it("drafts only the issues of THIS project when another project shares its title", () => {
    const ours = issue({ identifier: "EXA-7", projectId: "p1" });
    const theirs = issue({ identifier: "EXA-9", projectId: "p2" });
    const [proposal] = run({
      issues: [ours, theirs],
      projects: [project({ lastUpdateIso: "2026-08-01T00:00:00.000Z" })],
    });
    expect(proposal!.draft).toBe(
      "Example project\n\nSince the last update, 1 item(s) moved: EXA-7.\n\n1 item(s) still open: EXA-7.",
    );
  });

  it("ranks a never-updated project above a merely overdue one, by its own whole age", () => {
    const never = project({ id: "project:never", name: "Never updated" });
    const overdue = project({ id: "project:overdue", lastUpdateIso: "2026-08-01T00:00:00.000Z", name: "Overdue" });
    expect(run({ projects: [overdue, never] }).map((proposal) => proposal.subject)).toEqual([
      "Never updated",
      "Overdue",
    ]);
  });
});
