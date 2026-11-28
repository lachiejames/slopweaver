import { describe, expect, it } from "vitest";

import {
  codexPassScratchOverrides,
  PASS_TEMP_DIRNAME,
  passTempDirectory,
  passTempEnvironment,
} from "../../../codex/passWorkspace.js";

describe("a pass's shell temp", () => {
  it("lives in `.tmp` inside the scratch", () => {
    expect(PASS_TEMP_DIRNAME).toBe(".tmp");
    expect(passTempDirectory({ workingDirectory: "/o/p1.scratch" })).toBe("/o/p1.scratch/.tmp");
  });

  it("points TMPDIR and zsh's TMPPREFIX there, absolute", () => {
    expect(passTempEnvironment({ workingDirectory: "/o/p1.scratch" })).toEqual({
      TMPDIR: "/o/p1.scratch/.tmp",
      TMPPREFIX: "/o/p1.scratch/.tmp/zsh",
    });
  });

  it("escapes a path into a TOML basic string, so a quote or backslash cannot end the value", () => {
    expect(codexPassScratchOverrides({ workingDirectory: '/o/a"b\\c' })).toEqual([
      'shell_environment_policy.set.TMPDIR="/o/a\\"b\\\\c/.tmp"',
      'shell_environment_policy.set.TMPPREFIX="/o/a\\"b\\\\c/.tmp/zsh"',
    ]);
  });
});
