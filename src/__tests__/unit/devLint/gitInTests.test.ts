import { describe, expect, it } from "vitest";

import { findGitSpawns } from "../../../devLint/gitInTests.js";

/*
 * Every fixture line is ASSEMBLED rather than written out, so this file's own source never carries a line the
 * gate under test would report: `git-in-tests` scans this very file.
 */
const Q = '"';

/** One source line calling `name` with `command` as its first, quoted argument. */
function call({ name, command, quote = Q }: { name: string; command: string; quote?: string }): string {
  return `${name}(${quote}${command}${quote}, ["status"]);`;
}

const PATH = "src/__tests__/unit/x.test.ts";

describe("findGitSpawns", () => {
  it("reports each of the six spawn helpers called with git, at its 1-based line, trimmed", () => {
    const content = [
      "import x from 'y';",
      `  ${call({ command: "git", name: "execFileSync" })}`,
      call({ command: "git", name: "execSync" }),
      call({ command: "git", name: "spawnSync" }),
      `\t${call({ command: "git", name: "execFile" })}  `,
      call({ command: "git", name: "spawn" }),
      call({ command: "git", name: "exec" }),
    ].join("\n");
    expect(findGitSpawns({ content, path: PATH })).toEqual([
      { line: 2, path: PATH, text: call({ command: "git", name: "execFileSync" }) },
      { line: 3, path: PATH, text: call({ command: "git", name: "execSync" }) },
      { line: 4, path: PATH, text: call({ command: "git", name: "spawnSync" }) },
      { line: 5, path: PATH, text: call({ command: "git", name: "execFile" }) },
      { line: 6, path: PATH, text: call({ command: "git", name: "spawn" }) },
      { line: 7, path: PATH, text: call({ command: "git", name: "exec" }) },
    ]);
  });

  it("matches single quotes, backticks, inner spacing and a member call, beside the double-quoted form", () => {
    const lines = [
      call({ command: "git", name: "execFileSync", quote: "'" }),
      call({ command: "git", name: "execFileSync", quote: "`" }),
      `execFileSync ( ${Q}git${Q}, []);`,
      call({ command: "git", name: "childProcess.spawnSync" }),
    ];
    expect(findGitSpawns({ content: lines.join("\n"), path: PATH }).map((hit) => hit.line)).toEqual([1, 2, 3, 4]);
  });

  it("does not report another command, a longer word starting git, a git argument, or an unlisted helper name", () => {
    const content = [
      call({ command: "node", name: "execFileSync" }),
      call({ command: "gitx", name: "execFileSync" }),
      call({ command: "/usr/bin/git", name: "execFileSync" }),
      `execFileSync(${Q}env${Q}, [${Q}git${Q}]);`,
      call({ command: "git", name: "runGit" }),
      call({ command: "git", name: "myexec" }),
      call({ command: "git", name: "execAsync" }),
      `const label = ${Q}git status${Q};`,
    ].join("\n");
    expect(findGitSpawns({ content, path: PATH })).toEqual([]);
  });

  it("reports a matching line even when it sits behind a line comment, since the scan reads text not syntax", () => {
    const content = `// ${call({ command: "git", name: "execSync" })}`;
    expect(findGitSpawns({ content, path: PATH })).toEqual([
      { line: 1, path: PATH, text: `// ${call({ command: "git", name: "execSync" })}` },
    ]);
  });

  it("finds nothing in an empty source", () => {
    expect(findGitSpawns({ content: "", path: PATH })).toEqual([]);
  });
});
