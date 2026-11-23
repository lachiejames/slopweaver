/*
 * `isLive` — whether a project's status still counts it as running. It moved here when the project-update tests
 * were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { isLive } from "../../../../cycle/projectUpdate.js";
import { project } from "./harness.js";

describe("isLive", () => {
  it("counts a running project as live and a finished one as not", () => {
    expect(isLive({ project: project({ status: "In Progress" }) })).toBe(true);
    expect(isLive({ project: project({ status: "Completed" }) })).toBe(false);
    expect(isLive({ project: project({ status: "Canceled" }) })).toBe(false);
  });
});
