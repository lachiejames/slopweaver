import { describe, expect, it } from "vitest";

import { shellWords } from "../../../admit/shellLexing.js";
import { commandSegments } from "../../../admit/shellSegments.js";
import { shellStdinScripts } from "../../../admit/shellStdinScripts.js";

const BODY = "open -a Safari https://example.test";

/** The scripts a shell with these arguments reads from a heredoc carrying {@link BODY}. */
function scriptsFor({ program }: { program: readonly string[] }): readonly string[] {
  const segment = commandSegments({ command: `${program.join(" ")} <<'EOF'\n${BODY}\nEOF` })[0]!;
  return shellStdinScripts({ programs: [program], segment, words: shellWords({ text: segment.command }).words });
}

describe("shellStdinScripts", () => {
  it("reads the heredoc a bare shell, an -s shell or one with valued options runs", () => {
    const programs = [
      ["bash"],
      ["BASH"],
      ["sh", "-s", "arg"],
      ["bash", "-o", "errexit"],
      ["bash", "-euo", "pipefail"],
      ["bash", "+o", "posix", "-O", "extglob"],
      ["bash", "--rcfile", "x.rc"],
      ["bash", "--"],
    ];
    expect(programs.map((program) => scriptsFor({ program }).length)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(scriptsFor({ program: ["bash"] })).toEqual([BODY]);
  });

  it("reads nothing from a shell running -c, a script operand, or a program that is no shell", () => {
    const programs = [
      ["bash", "-c", "true"],
      ["bash", "-lc", "true"],
      ["bash", "script.sh"],
      ["bash", "-o", "pipefail", "script.sh"],
      ["bash", "--rcfile", "x.rc", "script.sh"],
      ["cat"],
    ];
    expect(programs.map((program) => scriptsFor({ program }).length)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("reads only the heredoc stdin ends up on, the last one, or none when a later redirection replaces it", () => {
    const read = ({ command }: { command: string }): readonly string[] => {
      const segment = commandSegments({ command })[0]!;
      return shellStdinScripts({
        programs: [["bash"]],
        segment,
        words: shellWords({ text: segment.command }).words,
      });
    };
    expect(read({ command: `bash <<'A' <<'B'\n${BODY}\nA\necho ok\nB` })).toEqual(["echo ok"]);
    expect(read({ command: `bash <<'A' </dev/null\n${BODY}\nA` })).toEqual([]);
  });
});
