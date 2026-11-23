/**
 * {@link runCmuxTemplates}'s argv edges — the measurement itself is `measureLaunchTemplates`, tested pure in
 * `unit/cmux/launchTemplate.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { runCmuxTemplates } from "../../../../../cli/commands/cmux/templates.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

describe("runCmuxTemplates", () => {
  it("prints its usage and succeeds on --help", () => {
    expect(runCmuxTemplates(["node", "slopweaver", "cmux", "templates", "--help"])).toBe(EXIT_OK);
  });

  it("refuses a flag it does not take", () => {
    expect(runCmuxTemplates(["node", "slopweaver", "cmux", "templates", "--model", "opus"])).toBe(EXIT_USAGE);
  });

  it("measures this checkout's always-on set and succeeds", () => {
    expect(runCmuxTemplates(["node", "slopweaver", "cmux", "templates", "--json"])).toBe(EXIT_OK);
  });
});
