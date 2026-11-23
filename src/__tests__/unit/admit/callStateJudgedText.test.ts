import { describe, expect, it } from "vitest";

import { judgedText } from "../../../admit/callStateJudgedText.js";

describe("judgedText", () => {
  it.each([
    { command: "rm a", want: "rm a" },
    { command: "true # ; rm x", want: "true " },
    { command: "# rm x\nls", want: "\nls" },
    { command: "echo '#' x", want: "echo '#' x" },
    { command: "echo x >| f", want: "echo x >  f" },
    { command: "echo '>|' f", want: "echo '>|' f" },
    { command: "cd d \\\n&& rm x", want: "cd d && rm x" },
    { command: "rm a\\ b", want: "rm a\\ b" },
  ])("reads $command as $want", ({ command, want }) => {
    expect(judgedText({ command })).toBe(want);
  });

  it("drops a heredoc body, keeping the command that reads it", () => {
    expect(judgedText({ command: "cat <<'EOF'\nrm x\nEOF\nls" }).includes("rm x")).toBe(false);
  });
});
