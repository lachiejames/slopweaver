/**
 * The no-python gate's scanner, debt partition and injected orchestration: which file shapes carry a hit, that
 * a command held as test DATA is not one, that debt is counted exactly, and that an unread file is reported as
 * unseen rather than clean.
 */
import { describe, expect, it } from "vitest";
import {
  checkNoPython,
  isScannablePath,
  type PythonDebt,
  partitionPythonDebt,
  scanNoPython,
} from "../../../devLint/noPython.js";
import type { PythonHit } from "../../../devLint/noPythonHit.js";

/** A hit's coordinates and kind, compactly. */
function where({ path, content }: { path: string; content: string }): readonly string[] {
  return scanNoPython({ content, path }).map((hit) => `${String(hit.line)}:${String(hit.column)} ${hit.kind}`);
}

describe("scanNoPython — file shapes", () => {
  it("reports a .py file once, even when it is empty", () => {
    expect(where({ content: "", path: "src/x.py" })).toEqual(["1:0 python-file"]);
  });

  it("reports a Python shebang in an extensionless script", () => {
    expect(where({ content: "#!/usr/bin/env python3\nprint(1)\n", path: "hooks/run" })).toEqual(["1:0 python-shebang"]);
  });

  it("reads an extensionless shell script's lines as commands", () => {
    expect(where({ content: "#!/bin/bash\nset -e\npython3 -V\n", path: "hooks/run" })).toEqual(["3:0 instruction"]);
  });

  it("does not read an extensionless file with no shell shebang as shell", () => {
    expect(where({ content: "python3 -V\n", path: "hooks/notes" })).toEqual([]);
  });

  it("carries an open quote across lines, so a multi-line quoted argument is data", () => {
    expect(where({ content: "echo '\npython3 -V\n'\npython3 -V\n", path: "hooks/a.sh" })).toEqual(["4:0 instruction"]);
  });

  it("does not read a #-led continuation of a multi-line quote as a comment", () => {
    expect(where({ content: "echo '\n# python3 -V\n'\n", path: "hooks/a.sh" })).toEqual([]);
  });

  it("reads a heredoc body as data, whatever it holds", () => {
    const content = "cat > x.md <<'EOF'\npython3 -c x\nEOF\necho done\n";
    expect(where({ content, path: "hooks/a.sh" })).toEqual([]);
  });

  it("does not let an apostrophe in an inline comment hide the next line", () => {
    expect(where({ content: "echo ok # don't change this\npython3 -V\n", path: "hooks/a.sh" })).toEqual([
      "2:0 instruction",
    ]);
  });

  it("honours a heredoc delimiter that is not a bare identifier", () => {
    expect(where({ content: "cat <<'END-DATA'\npython3 -V\nEND-DATA\n", path: "hooks/a.sh" })).toEqual([]);
  });

  it("does not let a space-prefixed delimiter inside a body close it early", () => {
    expect(where({ content: "cat <<'EOF'\n EOF\npython3 -V\nEOF\n", path: "hooks/a.sh" })).toEqual([]);
  });

  it("lets <<- close on a tab-indented delimiter", () => {
    expect(where({ content: "cat <<-EOF\npython3 -V\n\tEOF\npython3 -V\n", path: "hooks/a.sh" })).toEqual([
      "4:0 instruction",
    ]);
  });

  it("reads BOTH bodies when one line opens two heredocs", () => {
    const content = "cat <<'FIRST' <<'SECOND'\nfirst body\nFIRST\npython3 -V\nSECOND\npython3 -V\n";
    expect(where({ content, path: "hooks/a.sh" })).toEqual(["6:0 instruction"]);
  });

  it("catches a Python heredoc by its command header, not its body", () => {
    const content = "python3 - <<'PY'\nimport json\nPY\n";
    expect(where({ content, path: "hooks/a.sh" })).toEqual(["1:0 instruction"]);
  });

  it("does not let an opener-shaped run inside quotes hide the next line", () => {
    expect(where({ content: "echo '<<EOF'\npython3 -V\n", path: "hooks/a.sh" })).toEqual(["2:0 instruction"]);
  });

  it("does not treat a here-string as a heredoc opener", () => {
    const content = "cat <<< x\npython3 -V\n";
    expect(where({ content, path: "hooks/a.sh" })).toEqual(["2:0 instruction"]);
  });

  it("reads a .sh comment line as instruction text", () => {
    expect(where({ content: "#!/bin/sh\n# python3 -c x\necho ok\n", path: "hooks/a.sh" })).toEqual(["2:2 instruction"]);
  });

  it("reads Markdown as instruction text, in a fence or in prose", () => {
    const content = "# Skill\n\n```bash\npython3 -c 'x'\n```\n\nNever reach for Python.\n";
    expect(where({ content, path: "skills/demo/reference/x.md" })).toEqual(["4:0 instruction"]);
  });

  it("reads a heredoc body inside a Markdown fence as data", () => {
    const content = "```bash\ncat > fixture.txt <<'EOF'\npython3 -V\nEOF\n```\n";
    expect(where({ content, path: "skills/demo/SKILL.md" })).toEqual([]);
  });

  it("does not let prose mentioning a heredoc opener silence what follows", () => {
    const content = "Prose about `cat <<EOF` in passing.\n\nRun `python3 -c x` for the count.\n";
    expect(where({ content, path: "skills/demo/SKILL.md" })).toEqual(["3:5 instruction"]);
  });

  it("ignores a file type outside the four", () => {
    expect(where({ content: "python3 -V\n", path: "src/x.json" })).toEqual([]);
  });
});

describe("scanNoPython — TypeScript launchers", () => {
  it("catches a program literal handed to an imported spawnSync", () => {
    const content = 'import { spawnSync } from "node:child_process";\nspawnSync("python3", ["-V"]);\n';
    expect(where({ content, path: "src/a.ts" })).toEqual(["2:10 process-call"]);
  });

  it("sees through a parenthesised callee", () => {
    const content = 'import { execSync } from "node:child_process";\n(execSync)("python3 -V");\n';
    expect(where({ content, path: "src/a.ts" })).toEqual(["2:11 process-call"]);
  });

  it("follows an import alias to a shell-command literal", () => {
    const content = 'import { execSync as run } from "child_process";\nrun("cat x | python3 -c y");\n';
    expect(where({ content, path: "src/a.ts" })).toEqual(["2:4 process-call"]);
  });

  it("follows a namespace import to a member call", () => {
    const content = 'import * as cp from "node:child_process";\ncp.execFile("/usr/bin/python3", []);\n';
    expect(where({ content, path: "src/a.ts" })).toEqual(["2:12 process-call"]);
  });

  it("catches execa's default import and its command form", () => {
    const content = 'import execa, { execaCommand } from "execa";\nexeca("python3");\nexecaCommand(`python3 -V`);\n';
    expect(where({ content, path: "src/a.ts" })).toEqual(["2:6 process-call", "3:13 process-call"]);
  });

  it("leaves a command held as an expected value alone", () => {
    const content = "expect(line).toBe(\"python3 - <<'PY' import json PY\");\n";
    expect(where({ content, path: "src/__tests__/unit/a.test.ts" })).toEqual([]);
  });

  it("drops a binding whose name is redeclared, because the call may reach the shadow", () => {
    const content =
      'import { execSync as run } from "node:child_process";\nfunction f(run: (v: string) => string): string {\n  return run("python3 -V");\n}\n';
    expect(where({ content, path: "src/a.ts" })).toEqual([]);
  });

  it("drops a binding a destructured parameter shadows", () => {
    const content =
      'import { execSync as run } from "node:child_process";\nfunction f({ run }: { run: (v: string) => string }): string {\n  return run("python3 -V");\n}\n';
    expect(where({ content, path: "src/a.ts" })).toEqual([]);
  });

  it("drops a binding a named function expression shadows", () => {
    const content =
      'import { execSync as run } from "node:child_process";\nconst f = function run(value: string): string {\n  return value || run("python3 -V");\n};\n';
    expect(where({ content, path: "src/a.ts" })).toEqual([]);
  });

  it("leaves a launcher-named call alone when nothing imported it", () => {
    expect(where({ content: 'spawnSync("python3", []);\n', path: "src/a.ts" })).toEqual([]);
  });

  it("leaves a non-interpreter program literal alone", () => {
    const content = 'import { spawnSync } from "node:child_process";\nspawnSync("git", ["python3"]);\n';
    expect(where({ content, path: "src/a.ts" })).toEqual([]);
  });
});

describe("scanNoPython — TypeScript comments", () => {
  it("catches a leading line comment", () => {
    expect(where({ content: "// python3 -c x\nconst a = 1;\n", path: "src/a.ts" })).toEqual(["1:3 instruction"]);
  });

  it("catches a trailing comment at its real column", () => {
    expect(where({ content: "const a = 1; // python3 -V\n", path: "src/a.ts" })).toEqual(["1:16 instruction"]);
  });

  it("catches a comment that is trivia of a closing brace", () => {
    expect(where({ content: "function f() {\n  // python3 -V\n}\n", path: "src/a.ts" })).toEqual(["2:5 instruction"]);
  });

  it("catches each line of a JSDoc block once", () => {
    const content = "/**\n * python3 -c a\n * then python3 -m b\n */\nexport const x = 1;\n";
    expect(where({ content, path: "src/a.ts" })).toEqual(["2:3 instruction", "3:8 instruction"]);
  });

  it("does not read comment-looking text inside a string or a template", () => {
    const content = 'const s = "// python3 -c x";\nconst t = `/* python3 -c x */`;\n';
    expect(where({ content, path: "src/a.ts" })).toEqual([]);
  });
});

/** A hit at a path and line text, for partition cases. */
function fakeHit({ path, matchedLine }: { path: string; matchedLine: string }): PythonHit {
  return { column: 0, kind: "instruction", line: 1, matchedLine, path };
}

/** A debt entry, defaulting the owes. */
function debt({ path, matchedLine, count }: { path: string; matchedLine: string; count: number }): PythonDebt {
  return { count, matchedLine, owes: "a jq equivalent", path };
}

describe("partitionPythonDebt", () => {
  const line = "* python3 -c x";

  it("absorbs exactly the recorded count", () => {
    const verdict = partitionPythonDebt({
      debt: [debt({ count: 2, matchedLine: line, path: "src/a.ts" })],
      hits: [fakeHit({ matchedLine: line, path: "src/a.ts" }), fakeHit({ matchedLine: line, path: "src/a.ts" })],
    });
    expect(verdict).toEqual({ fresh: [], invalid: [], stale: [] });
  });

  it("reports an occurrence beyond the count as fresh", () => {
    const verdict = partitionPythonDebt({
      debt: [debt({ count: 1, matchedLine: line, path: "src/a.ts" })],
      hits: [fakeHit({ matchedLine: line, path: "src/a.ts" }), fakeHit({ matchedLine: line, path: "src/a.ts" })],
    });
    expect(verdict.fresh).toHaveLength(1);
    expect(verdict.stale).toEqual([]);
  });

  it("does not let identical text in a different file ride on another file's entry", () => {
    const verdict = partitionPythonDebt({
      debt: [debt({ count: 1, matchedLine: line, path: "src/a.ts" })],
      hits: [fakeHit({ matchedLine: line, path: "src/a.ts" }), fakeHit({ matchedLine: line, path: "src/b.ts" })],
    });
    expect(verdict.fresh.map((fresh) => fresh.path)).toEqual(["src/b.ts"]);
  });

  it("reports an entry firing fewer times than recorded as stale, with what it observed", () => {
    const entry = debt({ count: 2, matchedLine: line, path: "src/a.ts" });
    const verdict = partitionPythonDebt({ debt: [entry], hits: [fakeHit({ matchedLine: line, path: "src/a.ts" })] });
    expect(verdict.stale).toEqual([{ entry, observed: 1 }]);
  });

  it("reports an edited line as one fresh hit and one stale entry", () => {
    const entry = debt({ count: 1, matchedLine: line, path: "src/a.ts" });
    const verdict = partitionPythonDebt({
      debt: [entry],
      hits: [fakeHit({ matchedLine: "* python3 -c y", path: "src/a.ts" })],
    });
    expect(verdict.fresh).toHaveLength(1);
    expect(verdict.stale).toEqual([{ entry, observed: 0 }]);
  });

  it("refuses malformed entries by name", () => {
    const verdict = partitionPythonDebt({
      debt: [
        debt({ count: 0, matchedLine: line, path: "src/a.ts" }),
        debt({ count: 1, matchedLine: line, path: "src/a.ts" }),
        { count: 1, matchedLine: ` ${line}`, owes: "x", path: "src/b.ts" },
      ],
      hits: [fakeHit({ matchedLine: line, path: "src/a.ts" })],
    });
    expect(verdict.invalid).toEqual([
      "src/a.ts: * python3 -c x — count 0 is not a positive integer",
      "src/a.ts: * python3 -c x — recorded twice; merge the counts into one entry",
      "src/b.ts:  * python3 -c x — needs a non-blank owes and a trimmed line",
    ]);
  });
});

/** Run the orchestration over in-memory files; a path absent from `files` is unreadable. */
function check({ files, entries }: { files: Readonly<Record<string, string>>; entries: readonly PythonDebt[] }): {
  code: number;
  out: string;
  error: string;
} {
  let out = "";
  let error = "";
  const code = checkNoPython({
    debt: entries,
    paths: Object.keys(files).concat(["src/unread.ts", "src/unread.py"].filter((path) => !(path in files))),
    readText: ({ path }) => {
      const text = files[path];
      if (text === undefined) {
        return unreadable();
      }
      return text;
    },
    writeError: (text) => {
      error += text;
    },
    writeOut: (text) => {
      out += text;
    },
  });
  return { code, error, out };
}

/** Throw the way a failed read does. */
function unreadable(): never {
  throw Object.assign(new Error("gone"), { code: "ENOENT" });
}

describe("checkNoPython", () => {
  it("exits 0 and says clean only when every file was read and nothing was refused", () => {
    let out = "";
    const code = checkNoPython({
      debt: [],
      paths: ["src/a.ts"],
      readText: () => "export const a = 1;\n",
      writeError: () => undefined,
      writeOut: (text) => {
        out += text;
      },
    });
    expect(code).toBe(0);
    expect(out).toBe("no-python: clean (1 file(s) scanned, 0 recorded in DEBT)\n");
  });

  it("reports an unreadable .py by its name, and never a stale entry for an unread file", () => {
    const result = check({
      entries: [debt({ count: 1, matchedLine: "* python3 -c x", path: "src/unread.ts" })],
      files: { "src/a.ts": "export const a = 1;\n" },
    });
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.error).toContain("src/unread.py:1:1: python-file");
    expect(result.error).toContain("src/unread.ts  (unreadable: ENOENT — NOT checked)");
    expect(result.error).not.toContain("records 1, fires 0");
  });

  it("refuses a fresh hit through the registered refusal", () => {
    let error = "";
    const code = checkNoPython({
      debt: [],
      paths: ["skills/x/SKILL.md"],
      readText: () => "`python3 -c x`\n",
      writeError: (text) => {
        error += text;
      },
      writeOut: () => undefined,
    });
    expect(code).toBe(1);
    expect(error).toContain("skills/x/SKILL.md:1:2: instruction — `python3 -c x`");
    expect(error).toContain("Passing dev lint is blocked because the `no-python` gate");
  });

  it("refuses a stale entry for a file it did read", () => {
    let error = "";
    const code = checkNoPython({
      debt: [debt({ count: 1, matchedLine: "* python3 -c x", path: "src/a.ts" })],
      paths: ["src/a.ts"],
      readText: () => "export const a = 1;\n",
      writeError: (text) => {
        error += text;
      },
      writeOut: () => undefined,
    });
    expect(code).toBe(1);
    expect(error).toContain("src/a.ts: records 1, fires 0 — * python3 -c x");
  });

  it("does not report an empty selection as clean", () => {
    let out = "";
    const code = checkNoPython({
      debt: [],
      paths: [],
      readText: unreadable,
      writeError: () => undefined,
      writeOut: (text) => {
        out += text;
      },
    });
    expect(code).toBe(1);
    expect(out).toBe("");
  });
});

describe("isScannablePath — the gate's own scope", () => {
  it.each([
    ["skills/github/SKILL.md", true],
    ["skills/supervisor/reference/verbs.md", true],
    ["hooks/handover-run.sh", true],
    ["src/devLint/noPython.ts", true],
    ["src/__tests__/unit/devLint/noPython.test.ts", true],
    ["hooks/some-script", true],
    ["src/tool.py", true],
    ["docs/hooks.md", false],
    ["skills-other/x.md", false],
    ["src/x.json", false],
  ])("%s", (path, expected) => {
    expect(isScannablePath({ path })).toBe(expected);
  });
});
