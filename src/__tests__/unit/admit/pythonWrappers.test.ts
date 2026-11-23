import { describe, expect, it } from "vitest";

import {
  type ProgramResolution,
  programName,
  resolveProgram,
  resolvePrograms,
  standsAlone,
} from "../../../admit/pythonWrappers.js";
import { type ShellWord, shellWords } from "../../../admit/shellLexing.js";

/** A command line cut into the lexer's own words. */
function words({ text }: { text: string }): readonly ShellWord[] {
  return shellWords({ text }).words;
}

/** A resolution with every word reduced to its text, so a whole result compares as plain data. */
function textual({ resolution }: { resolution: ProgramResolution }): unknown {
  if (resolution.kind === "program") return { kind: "program", words: resolution.words.map((word) => word.text) };
  if (resolution.kind === "unknown-option") {
    return {
      kind: "unknown-option",
      readings: resolution.readings.map((reading) => reading.map((word) => word.text)),
      via: resolution.via,
    };
  }
  return resolution;
}

/** Resolve one line and reduce it to text. */
function resolved({ text }: { text: string }): unknown {
  return textual({ resolution: resolveProgram({ words: words({ text }) }) });
}

describe("programName", () => {
  it("keeps a plain name and drops a path", () => {
    expect(programName({ text: "python3" })).toBe("python3");
    expect(programName({ text: "/usr/bin/env" })).toBe("env");
  });

  it("drops the GNU g prefix only for the closed GNU-name set", () => {
    expect(programName({ text: "gtimeout" })).toBe("timeout");
    expect(programName({ text: "/opt/homebrew/bin/gsort" })).toBe("sort");
    expect(programName({ text: "grep" })).toBe("grep");
    expect(programName({ text: "gpython" })).toBe("gpython");
  });
});

describe("standsAlone", () => {
  it("is true for a declared boolean option and a declared lookup option", () => {
    expect(standsAlone({ option: "-i", wrapper: "env" })).toBe(true);
    expect(standsAlone({ option: "--version", wrapper: "env" })).toBe(true);
  });

  it("is false for a value-taking option, an undeclared wrapper and no wrapper", () => {
    expect(standsAlone({ option: "-u", wrapper: "env" })).toBe(false);
    expect(standsAlone({ option: "-i", wrapper: "python3" })).toBe(false);
    expect(standsAlone({ option: "-i", wrapper: undefined })).toBe(false);
  });
});

describe("resolveProgram", () => {
  it("skips a spaced value option and the value it consumes", () => {
    expect(resolved({ text: "env -u FOO python3 x.py" })).toEqual({ kind: "program", words: ["python3", "x.py"] });
  });

  it("skips an attached long and an attached short value option as one word each", () => {
    expect(resolved({ text: "env --unset=FOO python3" })).toEqual({ kind: "program", words: ["python3"] });
    expect(resolved({ text: "env -uFOO python3" })).toEqual({ kind: "program", words: ["python3"] });
  });

  it("ends the option walk at --", () => {
    expect(resolved({ text: "env -- python3" })).toEqual({ kind: "program", words: ["python3"] });
  });

  it("consumes timeout's duration operand after its options", () => {
    expect(resolved({ text: "timeout 5 python3 run.py" })).toEqual({ kind: "program", words: ["python3", "run.py"] });
    expect(resolved({ text: "timeout -s KILL 5 python3" })).toEqual({ kind: "program", words: ["python3"] });
  });

  it("reads nice's bare numeric option as standing alone", () => {
    expect(resolved({ text: "nice -5 python3" })).toEqual({ kind: "program", words: ["python3"] });
  });

  it("answers none for a lookup option", () => {
    expect(resolved({ text: "command -v python3" })).toEqual({ kind: "none" });
  });

  it("answers python-option for a runner's -m and reaches the program after a plain runner", () => {
    expect(resolved({ text: "uv run -m pytest" })).toEqual({ kind: "python-option", via: "uv run -m" });
    expect(resolved({ text: "uv run python3 x.py" })).toEqual({ kind: "program", words: ["python3", "x.py"] });
  });

  it("peels statement keywords and assignments", () => {
    expect(resolved({ text: "if FOO=1 python3" })).toEqual({ kind: "program", words: ["python3"] });
  });

  it("answers none when only keywords remain", () => {
    expect(resolved({ text: "then" })).toEqual({ kind: "none" });
  });

  it("peels an unquoted subshell paren but keeps a quoted one", () => {
    expect(resolved({ text: "(python3 x.py" })).toEqual({ kind: "program", words: ["python3", "x.py"] });
    expect(resolved({ text: '"(python3" x.py' })).toEqual({ kind: "program", words: ["(python3", "x.py"] });
  });

  it("reads a dynamic option word as the program rather than an option", () => {
    expect(resolved({ text: "env -$X python3" })).toEqual({ kind: "program", words: ["-$X", "python3"] });
  });

  it("reports an unlisted option with both readings, the wrapper at each head", () => {
    expect(resolved({ text: "env -P /bin python3" })).toEqual({
      kind: "unknown-option",
      readings: [
        ["env", "/bin", "python3"],
        ["env", "python3"],
      ],
      via: "env",
    });
  });

  it("gives an unlisted --name=value option only the standing-alone reading", () => {
    expect(resolved({ text: "env --pp=x python3" })).toEqual({
      kind: "unknown-option",
      readings: [["env", "python3"]],
      via: "env",
    });
  });
});

describe("resolvePrograms", () => {
  it("settles both readings of an unlisted option, in the order first reached", () => {
    const settled = resolvePrograms({ words: words({ text: "env -P /bin python3" }) });
    expect(settled.map((resolution) => textual({ resolution }))).toEqual([
      { kind: "program", words: ["/bin", "python3"] },
      { kind: "program", words: ["python3"] },
    ]);
  });

  it("settles an unlisted --name=value option to one reading", () => {
    const settled = resolvePrograms({ words: words({ text: "env --pp=x python3" }) });
    expect(settled.map((resolution) => textual({ resolution }))).toEqual([{ kind: "program", words: ["python3"] }]);
  });

  it("deduplicates two readings that settle to the same program", () => {
    const settled = resolvePrograms({ words: words({ text: "env -P -i python3" }) });
    expect(settled.map((resolution) => textual({ resolution }))).toEqual([{ kind: "program", words: ["python3"] }]);
  });
});
