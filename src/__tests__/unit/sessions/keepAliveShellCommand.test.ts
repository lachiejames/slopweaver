/**
 * Which keep-alive shell commands `parseKeepAliveShellCommand` admits, and the filters it reads off each. The
 * measured argv shapes are `./keepAliveChairFixture.ts`'s.
 */
import { describe, expect, it } from "vitest";
import { commandName, filterRunsAs, parseKeepAliveShellCommand } from "../../../sessions/keepAliveShellCommand.js";
import { BARE_KEEP_ALIVE, bashToolArgv, PIPED_KEEP_ALIVE } from "./keepAliveChairFixture.js";

describe("parseKeepAliveShellCommand", () => {
  it("admits canon's bare keep-alive inside Claude Code 2.1.323's Bash-tool shell, with no filters", () => {
    expect(parseKeepAliveShellCommand({ argv: bashToolArgv({ command: BARE_KEEP_ALIVE }) })).toEqual({ filters: [] });
  });

  it("admits the same keep-alive inside the Bash-tool shell earlier releases wrote", () => {
    expect(parseKeepAliveShellCommand({ argv: bashToolArgv({ command: BARE_KEEP_ALIVE, legacy: true }) })).toEqual({
      filters: [],
    });
  });

  it("admits a plain shell running the unqueued watch, trailing `ps` padding ignored", () => {
    expect(parseKeepAliveShellCommand({ argv: "/bin/zsh -c /m/bin/slopweaver claude watch   " })).toEqual({
      filters: [],
    });
  });

  it("admits the boot chain's piped keep-alive, its escaped quote decoded, reading one grep", () => {
    expect(parseKeepAliveShellCommand({ argv: bashToolArgv({ command: PIPED_KEEP_ALIVE }) })).toEqual({
      filters: ["grep"],
    });
  });

  it("reads every filter stage, in order", () => {
    const argv = bashToolArgv({ command: `${PIPED_KEEP_ALIVE} | tail -20 | head -n 5` });
    expect(parseKeepAliveShellCommand({ argv })).toEqual({ filters: ["grep", "tail", "head"] });
  });

  it("admits every line-count spelling and a grep's match-mode flags", () => {
    const argv = bashToolArgv({
      command: `${BARE_KEEP_ALIVE} 2>&1 | ugrep -iE --line-buffered x | tail -n +3 | head -n20 | tail --lines=4 | head`,
    });
    expect(parseKeepAliveShellCommand({ argv })).toEqual({ filters: ["ugrep", "tail", "head", "tail", "head"] });
  });

  it.each([
    { command: `${BARE_KEEP_ALIVE} | tail -f`, shape: "a tail that follows" },
    { command: `${BARE_KEEP_ALIVE} | tail -nF 5`, shape: "a tail whose short-option cluster follows" },
    { command: `${BARE_KEEP_ALIVE} | tail --follow=name`, shape: "a tail with --follow=" },
    { command: `${BARE_KEEP_ALIVE} | tail --retry`, shape: "a tail with --retry" },
    { command: `${BARE_KEEP_ALIVE} | ugrep --save-config=x -v y`, shape: "a ugrep that writes a config" },
    {
      command: `${BARE_KEEP_ALIVE} 2>&1 | ugrep '"'"'--filter=txt:touch /tmp/pwned'"'"' x x.txt -`,
      shape: "a ugrep that runs a utility per file (Codex r1's counterexample)",
    },
    { command: `${BARE_KEEP_ALIVE} | grep x notes.txt`, shape: "a grep with a file operand" },
    { command: `${BARE_KEEP_ALIVE} | grep -r x`, shape: "a recursive grep" },
    { command: `${BARE_KEEP_ALIVE} | grep -v`, shape: "a grep with no pattern" },
    { command: `${BARE_KEEP_ALIVE} | grep '"'"'-f'"'"'`, shape: "a quoted pattern the grep reads as an option" },
    { command: `${BARE_KEEP_ALIVE} | tail -n 20 out.log`, shape: "a tail with a file operand" },
    { command: `${BARE_KEEP_ALIVE} | head -c 5`, shape: "a head counting bytes" },
    {
      command: `NODE_OPTIONS=--require=/x.js ${BARE_KEEP_ALIVE}`,
      shape: "an assignment that loads code into the watch",
    },
    {
      command: "SLOPWEAVER_CLI_DIR=/tmp/evil /m/bin/slopweaver claude watch --wait 2>&1 | grep -v x",
      shape: "a CLI dir outside the program's own tree (Codex r2's counterexample)",
    },
    { command: `SLOPWEAVER_HOME=/tmp/x ${BARE_KEEP_ALIVE}`, shape: "an assignment the boot chain never writes" },
    { command: `${BARE_KEEP_ALIVE} x2>&1 | grep x`, shape: "a word fused to the stderr join" },
    { command: `${BARE_KEEP_ALIVE} | grep '"'"'x`, shape: "an unclosed quote" },
    { command: `${BARE_KEEP_ALIVE}; sleep 600`, shape: "a command after the watch" },
    { command: `${BARE_KEEP_ALIVE} & sleep 600`, shape: "the watch backgrounded beside other work" },
    { command: `${BARE_KEEP_ALIVE} | sh`, shape: "a pipe into a shell" },
    { command: `${BARE_KEEP_ALIVE} > out.log`, shape: "a redirect to a file" },
    { command: `${BARE_KEEP_ALIVE} 2>&1`, shape: "stderr joined with no pipe after it" },
    { command: `${BARE_KEEP_ALIVE} | grep x > out.log`, shape: "a redirect after a filter" },
    { command: `${BARE_KEEP_ALIVE} | grep $(id)`, shape: "a command substitution" },
    { command: `${BARE_KEEP_ALIVE} | grep "x"`, shape: "a double-quoted word" },
    { command: `${BARE_KEEP_ALIVE} || grep x`, shape: "an or-list" },
    { command: `${BARE_KEEP_ALIVE} | | grep x`, shape: "an empty stage" },
    { command: `${BARE_KEEP_ALIVE} | A=1 grep x`, shape: "an assignment before a filter" },
    { command: "claude watch --wait", shape: "a watch not run through slopweaver" },
    { command: "/m/bin/slopweaver claude gauge", shape: "another verb of the same binary" },
    { command: "/m/bin/slopweaver claude watch '--wait'", shape: "a quoted verb word" },
  ])("refuses $shape", ({ command }) => {
    expect(parseKeepAliveShellCommand({ argv: bashToolArgv({ command }) })).toBe(undefined);
  });

  it("refuses a command that is only environment assignments", () => {
    expect(parseKeepAliveShellCommand({ argv: "/bin/zsh -c A=1 B=2" })).toBe(undefined);
  });

  it("refuses an unescaped quote inside the Bash-tool shell's eval", () => {
    expect(parseKeepAliveShellCommand({ argv: bashToolArgv({ command: `${BARE_KEEP_ALIVE} | grep -v 'x'` }) })).toBe(
      undefined,
    );
  });

  it("refuses a shell that is neither the Bash tool's nor a plain one", () => {
    expect(
      parseKeepAliveShellCommand({ argv: "/bin/zsh -c zmodload zsh/zselect; claude watch & zselect -t 60000" }),
    ).toBe(undefined);
  });
});

describe("filterRunsAs", () => {
  it("lets a written grep run as Claude Code's bundled ugrep, and nothing lets tail run as grep", () => {
    expect([
      filterRunsAs({ filter: "grep", name: "ugrep" }),
      filterRunsAs({ filter: "grep", name: "grep" }),
      filterRunsAs({ filter: "ugrep", name: "grep" }),
      filterRunsAs({ filter: "tail", name: "grep" }),
    ]).toEqual([true, true, false, false]);
  });
});

describe("commandName", () => {
  it("reads the base name of a row's first token", () => {
    expect(commandName({ argv: "/usr/bin/tail -20" })).toBe("tail");
  });
});
