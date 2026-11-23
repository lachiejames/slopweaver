import { describe, expect, it } from "vitest";
import { classifyProcess } from "../../../../../live/machine/classify.js";

describe("classifyProcess", () => {
  it("classifies this checkout's own claude binary as fleet", () => {
    expect(classifyProcess({ argv: "/opt/synthetic/.local/bin/claude --session-id abc" })).toBe("fleet");
  });

  it("classifies a node process running a slopweaver worktree as fleet", () => {
    expect(
      classifyProcess({ argv: "node /opt/synthetic/dev/slopweaver/.claude/worktrees/foo/bin/../src/cli/index.ts" }),
    ).toBe("fleet");
  });

  it("classifies the cmux app as fleet", () => {
    expect(classifyProcess({ argv: "/Applications/cmux.app/Contents/MacOS/cmux" })).toBe("fleet");
  });

  it("classifies an unrelated system daemon as foreign", () => {
    expect(classifyProcess({ argv: "/opt/mdm/bin/mdm-agent" })).toBe("foreign");
  });

  it("classifies a pid with no matching ps row as foreign", () => {
    expect(classifyProcess({ argv: undefined })).toBe("foreign");
  });
});
