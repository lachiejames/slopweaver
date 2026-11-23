/*
 * `issueInProject` — the join between a cycle issue and a project: by project id, or by name when the issue row
 * carries no id. It moved here when the project-update tests were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { issueInProject } from "../../../../cycle/projectUpdate.js";
import { issue, project } from "./harness.js";

describe("issueInProject", () => {
  it("joins on the project id, whatever either side is called", () => {
    expect(issueInProject({ issue: issue({ projectId: "p1", projectName: "Old name" }), project: project() })).toBe(
      true,
    );
    expect(issueInProject({ issue: issue({ projectId: "p2" }), project: project() })).toBe(false);
  });

  it("joins a row that carries no project id by name, the only key it has", () => {
    expect(issueInProject({ issue: issue({ projectId: undefined }), project: project() })).toBe(true);
    expect(
      issueInProject({ issue: issue({ projectId: undefined, projectName: "Elsewhere" }), project: project() }),
    ).toBe(false);
  });
});
