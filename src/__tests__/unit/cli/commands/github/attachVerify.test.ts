import { describe, expect, it } from "vitest";
import { ATTACHMENT_OVERRIDES } from "../../../../../admit/attachmentGates.js";
import { acknowledgedEnv, reportWaivers } from "../../../../../cli/commands/github/attachVerify.js";

describe("reportWaivers", () => {
  const waived = [{ code: "attachment.sibling", correction: "c", severity: "hold" as const, summary: "s" }];

  it("prints each waived code beside the reason given", () => {
    const lines: string[] = [];
    reportWaivers({
      acknowledged: "intended",
      deps: { writeDiagnostic: (line) => lines.push(line) },
      overridden: waived,
    });
    expect(lines).toEqual(["attachment.sibling waived: intended"]);
  });

  it("prints nothing for a call that acknowledged nothing", () => {
    const lines: string[] = [];
    reportWaivers({
      acknowledged: undefined,
      deps: { writeDiagnostic: (line) => lines.push(line) },
      overridden: waived,
    });
    expect(lines).toEqual([]);
  });
});

describe("acknowledgedEnv", () => {
  it("hands the environment back unchanged when the call carries no --acknowledge", () => {
    const env = { PATH: "/bin" };
    expect(acknowledgedEnv({ acknowledge: undefined, env })).toBe(env);
  });

  it("adds the attachment override token for an acknowledged call", () => {
    expect(acknowledgedEnv({ acknowledge: "a sibling file is intended", env: { PATH: "/bin" } })).toEqual({
      PATH: "/bin",
      SLOPWEAVER_DOOR_OVERRIDE: ATTACHMENT_OVERRIDES,
    });
  });

  it("keeps an override already exported, appending the attachment token after it", () => {
    const env = { SLOPWEAVER_DOOR_OVERRIDE: "other.token" };
    expect(acknowledgedEnv({ acknowledge: "intended", env })["SLOPWEAVER_DOOR_OVERRIDE"]).toBe(
      `other.token,${ATTACHMENT_OVERRIDES}`,
    );
  });
});
