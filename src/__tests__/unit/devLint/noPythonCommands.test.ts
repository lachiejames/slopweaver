/**
 * The no-python recognisers: where an interpreter word sits at command position, when prose carries enough
 * evidence to be an instruction, and which shebangs run Python. Every row of the false-positive contract the
 * Codex plan for this gate named is a case here.
 */
import { describe, expect, it } from "vitest";
import {
  isPythonInterpreter,
  isPythonShebang,
  pythonCommandColumns,
  quoteAfter,
  shebangProgram,
} from "../../../devLint/noPythonCommands.js";

/** Columns for a line read as a command. */
function shell({ line }: { line: string }): readonly number[] {
  return pythonCommandColumns({ line, mode: "shell" });
}

/** Columns for a line read as prose or a comment. */
function instruction({ line }: { line: string }): readonly number[] {
  return pythonCommandColumns({ line, mode: "instruction" });
}

describe("pythonCommandColumns — shell mode catches a direct invocation", () => {
  it.each([
    ["python3 -V", [0]],
    ["python -c 'print(1)'", [0]],
    ["/usr/bin/python3.12 -c 'print(1)'", [0]],
    ["'python3' -V", [0]],
    ["python3 <<'PY'", [0]],
    ["python3", [0]],
    ["command python3 -V", [8]],
    ["exec python3 -V", [5]],
    ["sudo python3 x.py", [5]],
    ["uv run python3 x.py", [7]],
    ["poetry run python -V", [11]],
    ["FOO=1 python3 -V", [6]],
    ["if python3 -V; then true; fi", [3]],
    ["while python3 -V; do break; done", [6]],
    ["for f in a b; do python3 -c x; done", [17]],
    ["cat x | python3 -c y", [8]],
    ["x|python3 -V", [2]],
    ['echo "$(python3 -V)"', [8]],
    ["python3 -V; python3 -V", [0, 12]],
  ])("%s", (line, expected) => {
    expect(shell({ line })).toEqual(expected);
  });
});

describe("pythonCommandColumns — shell mode leaves data alone", () => {
  it.each([
    [`echo 'python3 -c "print(1)"'`],
    ["grep -nE '\\bpython3?\\b' file"],
    ["git commit -m 'remove python3; use TypeScript'"],
    ["yarn run python-report"],
    ["node-gyp rebuild"],
    ["PYTHON=/usr/bin/python3 node-gyp rebuild"],
    [`echo "text; 'python3' -V"`],
    [`echo "a | python3 -V"`],
    ["cat report.py"],
    ["git add report.py"],
    ["ls .python-version"],
    ["my_python3 -V"],
    ["python3x -V"],
    ["Python3 -V"],
  ])("%s", (line) => {
    expect(shell({ line })).toEqual([]);
  });
});

describe("pythonCommandColumns — instruction mode needs position AND evidence", () => {
  it.each([
    [' * python3 -c "import json"', [3]],
    ["// python3 -m http.server", [3]],
    ["Run `python3 script.py` to see it", [5]],
    ["`python3 - <<'PY'`", [1]],
    ['`curl -sS u | python3 -c "y"`', [14]],
    ["* `for f in *.md; do python3 -c 'x' \"$f\"; done`", [21]],
    ["doesn't `python3 -m http.server`", [9]],
    ["# python3 -c x", [2]],
    ["python3</dev/null", [0]],
    ["python3 <<'PY'", [0]],
  ])("%s", (line, expected) => {
    expect(instruction({ line })).toEqual(expected);
  });

  it.each([
    ["a heredoc or a multi-line python block would otherwise"],
    [" *   - `node`, `python3`, `npx`, `deno` — general-purpose interpreters."],
    ["(repro: `python3` over the owner's own turns)"],
    ["v2-systeminsights-list-python-packages"],
    ["the Python interpreter is never the tool"],
    ["check if python3 -c works"],
    ["python3 alone at the start of prose"],
    ["`python3`"],
    ["a bot turn's `python3 -` heredoc read the multi-gigabyte Slack `compact.jsonl` whole"],
    ["* its shell, and the `python3 -` heredoc that read the file"],
  ])("%s", (line) => {
    expect(instruction({ line })).toEqual([]);
  });
});

describe("quoteAfter and an inherited quote", () => {
  it.each([
    ["echo '", undefined, "'"],
    ["still inside", "'", "'"],
    ["closes' here", "'", undefined],
    ['say "a \\" b"', undefined, undefined],
  ] as const)("%s from %s", (text, open, expected) => {
    expect(quoteAfter({ open, text })).toBe(expected);
  });

  it("treats a shell line that starts inside a quote as data", () => {
    expect(pythonCommandColumns({ line: "python3 -V", mode: "shell", open: "'" })).toEqual([]);
  });

  it("does not let a quote inherited by a shell line reach an instruction line", () => {
    expect(pythonCommandColumns({ line: "python3 -c x", mode: "instruction", open: "'" })).toEqual([0]);
  });
});

describe("isPythonInterpreter", () => {
  it.each([
    ["python", true],
    ["python3", true],
    ["python3.12", true],
    ["/usr/local/bin/python3", true],
    ["python3x", false],
    ["Python", false],
    ["pythonw", false],
  ])("%s", (word, expected) => {
    expect(isPythonInterpreter({ word })).toBe(expected);
  });
});

describe("isPythonShebang and shebangProgram", () => {
  it.each([
    ["#!/usr/bin/python3", true],
    ["#!/usr/bin/env python3", true],
    ["#!/usr/bin/env -S python3 -u", true],
    ["#!/usr/bin/env FOO=1 python", true],
    ["#!/bin/bash", false],
    ["# python3 -c x", false],
    ["#!", false],
  ])("%s", (firstLine, expected) => {
    expect(isPythonShebang({ firstLine })).toBe(expected);
  });

  it("steps over env to the program it runs", () => {
    expect(shebangProgram({ firstLine: "#!/usr/bin/env -S bash -e" })).toBe("bash");
  });

  it("names nothing for a line that is not a shebang", () => {
    expect(shebangProgram({ firstLine: "echo hi" })).toBeUndefined();
  });
});
