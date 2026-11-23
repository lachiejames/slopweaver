import { describe, expect, it } from "vitest";

import { classifyPythonCommand } from "../../../admit/pythonInvocation.js";

/** Whether a command is refused with both hatches shut. */
function blocked({ command }: { command: string }): boolean {
  return classifyPythonCommand({ allowPython: false, command }).blocked;
}

/** Whether a command is refused when a reader can open the scripts it names. */
function blockedReading({ command, files }: { command: string; files: Readonly<Record<string, string>> }): boolean {
  return classifyPythonCommand({ allowPython: false, command, readScript: ({ path }) => files[path] }).blocked;
}

/** The refusal message, or a thrown error — keeps the assertions unconditional. */
function refusal({ command }: { command: string }): string {
  const verdict = classifyPythonCommand({ allowPython: false, command });
  if (!verdict.blocked) {
    throw new Error(`expected a refusal for: ${command}`);
  }
  return verdict.message;
}

describe("classifyPythonCommand — a direct invocation", () => {
  it("refuses an interpreter whatever it does, by name, path, version or quoting", () => {
    expect(blocked({ command: "python3 -V" })).toBe(true);
    expect(blocked({ command: "/usr/bin/python3.12 -c 'print(1)'" })).toBe(true);
    expect(blocked({ command: "'python3' -V" })).toBe(true);
    expect(blocked({ command: "python -m http.server" })).toBe(true);
    expect(blocked({ command: "pypy3 script" })).toBe(true);
    expect(blocked({ command: "ipython" })).toBe(true);
  });

  it("refuses one behind a keyword, a loop condition, a subshell or an assignment prefix", () => {
    expect(blocked({ command: "if python3 -V; then true; fi" })).toBe(true);
    expect(blocked({ command: "while python3 -V; do break; done" })).toBe(true);
    expect(blocked({ command: "(python3 -V)" })).toBe(true);
    expect(blocked({ command: "FOO=bar python3 -V" })).toBe(true);
    expect(blocked({ command: "echo hi && python3 -V" })).toBe(true);
    expect(blocked({ command: "cat data | python3 -" })).toBe(true);
  });

  it("refuses one behind a wrapper that really does run it", () => {
    expect(blocked({ command: "command python3 -V" })).toBe(true);
    expect(blocked({ command: "command -- python3 -V" })).toBe(true);
    expect(blocked({ command: "exec python3 -V" })).toBe(true);
    expect(blocked({ command: "nohup python3 serve.py" })).toBe(true);
    expect(blocked({ command: "sudo -u someone -- python3 -V" })).toBe(true);
    expect(blocked({ command: "nice -n 5 python3 -V" })).toBe(true);
    expect(blocked({ command: "timeout -s TERM 5 python3 -V" })).toBe(true);
    expect(blocked({ command: "xargs -n 1 python3" })).toBe(true);
    expect(blocked({ command: "env FOO=bar python3 -V" })).toBe(true);
    expect(blocked({ command: "/usr/bin/env python3 -V" })).toBe(true);
  });

  it("refuses one behind a wrapper option no table lists, whether that option stands alone or takes a value", () => {
    expect(blocked({ command: "env -P /bin python3 -V" })).toBe(true);
    expect(blocked({ command: "env --some-flag python3 -V" })).toBe(true);
    expect(blocked({ command: "nice -X -n 5 python3 -V" })).toBe(true);
    expect(blocked({ command: "sudo -Z someone python3 -V" })).toBe(true);
    expect(blocked({ command: "uv run --new-flag python -V" })).toBe(true);
    expect(blocked({ command: "env -P /bin sh -c 'python3 -V'" })).toBe(true);
    expect(refusal({ command: "env -P /bin python3 -V" })).toContain("python3 -V");
  });

  it("keeps reading the same wrapper's grammar past an unlisted option, operands and attached values included", () => {
    expect(blocked({ command: "timeout -Z 5 python3 -V" })).toBe(true);
    expect(blocked({ command: "timeout -Z zz 5 python3 -V" })).toBe(true);
    expect(blocked({ command: "env --opt=x python3 -V" })).toBe(true);
    expect(blocked({ command: "env -P /bin nice -X python3 -V" })).toBe(true);
    expect(blocked({ command: `env ${"-Q ".repeat(200)}python3 -V` })).toBe(true);
    expect(blocked({ command: `env ${"-Q ".repeat(200)}ls` })).toBe(false);
    expect(blocked({ command: "env -P -- python3 -V" })).toBe(true);
    expect(blocked({ command: "uv run --new-flag --python 3.12 python -V" })).toBe(true);
    expect(blocked({ command: "env -P /bin sudo -Z someone python3 -V" })).toBe(true);
    expect(blocked({ command: "env -P /bin sudo -Z someone ls" })).toBe(false);
  });

  it("resolves unlisted options interleaved with DISTINCT known ones in bounded time, not one pass per subsequence", () => {
    // Keeping the parsed options made each reading a distinct subsequence: ~3x per two pairs, so 40 never ends.
    const known = Array.from({ length: 40 }, (_, index) => `--user=u${index}`);
    const pairs = known.flatMap((option) => ["-Z", option]).join(" ");
    expect(known.length).toBe(40);
    expect(blocked({ command: `sudo ${pairs} python3 -V` })).toBe(true);
    expect(blocked({ command: `sudo ${pairs} ls` })).toBe(false);
  });

  it("refuses the accepted false positive, a Python name as an unlisted option's value, and the hatch opens it", () => {
    expect(blocked({ command: "env -P python3 ls" })).toBe(true);
    expect(blocked({ command: "SLOPWEAVER_ALLOW_PYTHON=1 env -P python3 ls" })).toBe(false);
    expect(blocked({ command: "SLOPWEAVER_ALLOW_PYTHON=1 env -P /bin python3 -V" })).toBe(false);
  });

  it("refuses a redirection-prefixed invocation, whose operand is data", () => {
    expect(blocked({ command: ">/tmp/out python3 -V" })).toBe(true);
    expect(blocked({ command: "python3 -V > python3" })).toBe(true);
  });

  it("refuses a package runner that runs Python, by program or by option", () => {
    expect(blocked({ command: "uv run python -V" })).toBe(true);
    expect(blocked({ command: "uv run --python 3.12 python -V" })).toBe(true);
    expect(blocked({ command: "uv run -m http.server" })).toBe(true);
    expect(blocked({ command: "poetry run python -V" })).toBe(true);
  });
});

describe("classifyPythonCommand — data is not an invocation", () => {
  it("allows the name inside an argument, a pattern or a message", () => {
    expect(blocked({ command: `echo 'python3 -c "print(1)"'` })).toBe(false);
    expect(blocked({ command: String.raw`grep -nE '\bpython3?\b' file` })).toBe(false);
    expect(blocked({ command: "git commit -m 'remove python3; use TypeScript'" })).toBe(false);
    expect(blocked({ command: `gh pr view 1 --json body --jq '.body | contains("python3 -V")'` })).toBe(false);
    expect(blocked({ command: "echo '$(python3 -V)'" })).toBe(false);
  });

  it("allows a heredoc BODY written as data, and refuses the same body fed to a shell", () => {
    expect(blocked({ command: "cat > x.md <<'EOF'\npython3 -V\nEOF" })).toBe(false);
    expect(blocked({ command: "cat <<123\npython3 -V\n123" })).toBe(false);
    expect(blocked({ command: "echo $((1 << 2))\ncat <<EOF\npython3 -V\nEOF" })).toBe(false);
    expect(blocked({ command: "tee x.md <<-'EOF'\n\tpython3 -V\n\tEOF" })).toBe(false);
    expect(blocked({ command: "bash <<'EOF'\npython3 -V\nEOF" })).toBe(true);
  });

  it("allows a name inside a comment, including one carrying a separator", () => {
    expect(blocked({ command: "true # ; python3 -V" })).toBe(false);
    expect(blocked({ command: "ls # run python3 -V here" })).toBe(false);
  });

  it("allows a file ARGUMENT, a package-script name and a configuration value", () => {
    expect(blocked({ command: "cat report.py" })).toBe(false);
    expect(blocked({ command: "git add report.py" })).toBe(false);
    expect(blocked({ command: "yarn test" })).toBe(false);
    expect(blocked({ command: "yarn run python-report" })).toBe(false);
    expect(blocked({ command: "node-gyp rebuild" })).toBe(false);
    expect(blocked({ command: "PYTHON=/usr/bin/python3 node-gyp rebuild" })).toBe(false);
  });

  it("allows a lookup, a replacement marker, a find PREDICATE and a shell `$0`", () => {
    expect(blocked({ command: "command -v python3" })).toBe(false);
    expect(blocked({ command: "xargs -I python3 echo python3" })).toBe(false);
    expect(blocked({ command: "find . -name python3" })).toBe(false);
    expect(blocked({ command: "bash -c 'echo ok' python3" })).toBe(false);
    expect(blocked({ command: "bash -n suspicious.sh" })).toBe(false);
  });

  it("allows a program word it cannot resolve statically, rather than guessing", () => {
    expect(blocked({ command: "$(which python3) -V" })).toBe(false);
    expect(blocked({ command: "$PY -V" })).toBe(false);
  });

  it("allows a wrapper option no table lists when neither reading of it reaches Python", () => {
    expect(blocked({ command: "env -P /bin ls" })).toBe(false);
    expect(blocked({ command: "env --some-flag git status" })).toBe(false);
    expect(blocked({ command: "env -P" })).toBe(false);
  });
});

describe("classifyPythonCommand — what a shell really executes", () => {
  it("opens a `-c` payload, and takes exactly the payload word", () => {
    expect(blocked({ command: "bash -c 'python3 -V'" })).toBe(true);
    expect(blocked({ command: 'bash -lc "python3 -V"' })).toBe(true);
    expect(blocked({ command: "sh -c 'echo hi'" })).toBe(false);
  });

  it("decodes a $'…' word as bash does, as the program, the payload or a split half of either", () => {
    expect([
      blocked({ command: "$'\\x70ython3' -V" }),
      blocked({ command: "$'\\160ython3' -V" }),
      blocked({ command: "bash -c $'\\x70ython3 -V'" }),
      blocked({ command: "bash -c 'py'$'\\x74hon3 -V'" }),
      blocked({ command: "eval $'\\x70ython3 -V'" }),
      blocked({ command: "find . -exec $'\\x70ython3' {} \\;" }),
      // The decoded payload is `echopython3`, which is not an interpreter.
      blocked({ command: "sh -c 'echo'$'\\x70ython3'" }),
    ]).toEqual([true, true, true, true, true, true, false]);
  });

  it("reads the LAST descriptor-0 redirection, so a second heredoc and a later `<` both win", () => {
    expect(blocked({ command: "bash <<'A' <<'B'\npython3 -V\nA\ntrue\nB" })).toBe(false);
    expect(blocked({ command: "bash <<'A' <<'B'\ntrue\nA\npython3 -V\nB" })).toBe(true);
    expect(blocked({ command: "bash <<'A' </dev/null\npython3 -V\nA" })).toBe(false);
    // No space: both redirections are ONE whitespace word.
    expect(blocked({ command: "bash <<'A'</dev/null\npython3 -V\nA" })).toBe(false);
    // An output operator on descriptor 0 rebinds stdin too.
    expect(blocked({ command: "bash <<'A' 0>/dev/null\npython3 -V\nA" })).toBe(false);
    expect(blocked({ command: "bash <<'A' 2>&1\npython3 -V\nA" })).toBe(true);
    expect(blocked({ command: "bash 3<<'A'\npython3 -V\nA" })).toBe(false);
  });

  it("walks what an UNQUOTED body expands, whoever reads it, and nothing in a quoted one", () => {
    expect(blocked({ command: "cat <<EOF\n$(python3 -V)\nEOF" })).toBe(true);
    expect(blocked({ command: "cat <<'EOF'\n$(python3 -V)\nEOF" })).toBe(false);
  });

  it("walks a substitution in every executable position", () => {
    expect(blocked({ command: "echo $(python3 -V)" })).toBe(true);
    expect(blocked({ command: 'echo "$(python3 -V)"' })).toBe(true);
    expect(blocked({ command: "echo `python3 -V`" })).toBe(true);
    expect(blocked({ command: "diff <(python3 -V) other" })).toBe(true);
  });

  it("walks `eval` and every `find -exec` form", () => {
    expect(blocked({ command: "eval python3 -V" })).toBe(true);
    expect(blocked({ command: "find . -exec python3 -V \\;" })).toBe(true);
    expect(blocked({ command: "find . -execdir python3 -V +" })).toBe(true);
    expect(blocked({ command: "find . -name x -exec echo {} \\; -exec python3 -V \\;" })).toBe(true);
  });

  it("opens three nested sources and stops, rather than recursing forever", () => {
    expect(blocked({ command: `bash -c "bash -c 'python3 -V'"` })).toBe(true);
    expect(blocked({ command: `bash -c "bash -c 'bash -c \\"python3 -V\\"'"` })).toBe(true);
    expect(blocked({ command: `bash -c "bash -c 'bash -c \\"bash -c python3\\"'"` })).toBe(false);
  });
});

describe("classifyPythonCommand — scripts, through the injected reader", () => {
  it("refuses a `#!` naming Python, directly or through `env -S`", () => {
    expect(blockedReading({ command: "./run", files: { "./run": "#!/usr/bin/env python3\nprint(1)\n" } })).toBe(true);
    expect(blockedReading({ command: "./run", files: { "./run": "#!/usr/bin/env -S python3 -u\nprint(1)\n" } })).toBe(
      true,
    );
    expect(blockedReading({ command: "./run", files: { "./run": "#!/usr/bin/python3\nprint(1)\n" } })).toBe(true);
  });

  it("walks a SHELL script's own lines, one level", () => {
    expect(blockedReading({ command: "./run.sh", files: { "./run.sh": "#!/bin/bash\npython3 -V\n" } })).toBe(true);
    expect(blockedReading({ command: "./run.sh", files: { "./run.sh": "#!/bin/bash\necho hi\n" } })).toBe(false);
    expect(blockedReading({ command: "bash ./run.sh", files: { "./run.sh": "python3 -V\n" } })).toBe(true);
  });

  it("treats a file a SHELL is given as shell source, whatever its name says", () => {
    expect(blockedReading({ command: "bash ./x.py", files: { "./x.py": "#!/usr/bin/env python3\nprint(1)\n" } })).toBe(
      false,
    );
  });

  it("falls back to the `.py` extension only when the file cannot be opened", () => {
    expect(blocked({ command: "./report.py" })).toBe(true);
    expect(blockedReading({ command: "./report.py", files: {} })).toBe(true);
    expect(blockedReading({ command: "./report", files: {} })).toBe(false);
  });
});

describe("classifyPythonCommand — the hatch", () => {
  it("is opened for the segment that carries it, and no other", () => {
    expect(blocked({ command: "SLOPWEAVER_ALLOW_PYTHON=1 python3 -V" })).toBe(false);
    // Only the exact token arms a hatch; the shared resolver must not widen what the raw hatch accepts.
    expect(blocked({ command: 'SLOPWEAVER_ALLOW_PYTHON="1" python3 -V' })).toBe(true);
    expect(blocked({ command: "SLOPWEAVER_ALLOW_PYTHON=0 python3 -V" })).toBe(true);
    expect(blocked({ command: "SLOPWEAVER_ALLOW_PYTHON=1 echo a && python3 -V" })).toBe(true);
  });

  it("is closed again by a command-local reassignment or unset, even after an export", () => {
    expect(blocked({ command: "export SLOPWEAVER_ALLOW_PYTHON=1\npython3 -V" })).toBe(false);
    expect(blocked({ command: "export SLOPWEAVER_ALLOW_PYTHON=1\nSLOPWEAVER_ALLOW_PYTHON=0 python3 -V" })).toBe(true);
    expect(blocked({ command: "export SLOPWEAVER_ALLOW_PYTHON=1\nenv -u SLOPWEAVER_ALLOW_PYTHON python3 -V" })).toBe(
      true,
    );
    expect(blocked({ command: "SLOPWEAVER_ALLOW_PYTHON=1 SLOPWEAVER_ALLOW_PYTHON=0 python3 -V" })).toBe(true);
  });

  it("is inherited into what the covered segment itself opens, in both directions", () => {
    expect(blocked({ command: "SLOPWEAVER_ALLOW_PYTHON=1 bash -c 'python3 -V'" })).toBe(false);
    expect(blocked({ command: "bash -c 'SLOPWEAVER_ALLOW_PYTHON=1 python3 -V'" })).toBe(false);
    expect(blocked({ command: "bash -c 'echo a; python3 -V'" })).toBe(true);
  });

  it("is opened wholesale by the ambient variable", () => {
    expect(classifyPythonCommand({ allowPython: true, command: "python3 -V" })).toEqual({ blocked: false });
  });

  it("names the invocation and the exact incantation in the refusal", () => {
    const message = refusal({ command: "python3 -c 'print(1)'" });
    expect(message).toContain("SLOPWEAVER_ALLOW_PYTHON=1");
    expect(message).toContain("python3 -c print(1)");
    expect(message).toContain("Legitimate exceptions may include");
    expect(message).toContain("to read JSON, use the verb's own flags or the Read tool (jq is banned too)");
    expect(classifyPythonCommand({ allowPython: false, command: "python3 -V" })).toEqual({
      blocked: true,
      invocation: "python3 -V",
      message: refusal({ command: "python3 -V" }),
    });
  });
});
