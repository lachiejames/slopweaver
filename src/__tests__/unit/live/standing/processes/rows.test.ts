/*
 * The process-table line parsers — pure, over listings written the way `ps` prints them: the lenient one that
 * drops a line it cannot read, and the whole-table one that joins a wrapped argv back rather than losing a row.
 * It was split out when the process-snapshot suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { parseProcessRows, parseProcessRowsWhole } from "../../../../../live/standing/processes.js";
import { ProcessTableErrors } from "../../../../../live/standing/processTableErrors.js";
import { CLAUDE_ARGV, LISTENER_ARGV } from "./harness.js";

describe("parseProcessRows", () => {
  it("decodes pid, ppid and the whole remaining argv", () => {
    expect(parseProcessRows({ text: "  61202 61048 /node --follow\n" })).toEqual([
      { argv: "/node --follow", pid: 61202, ppid: 61048 },
    ]);
  });

  it("keeps an argv containing spaces and JSON whole", () => {
    const rows = parseProcessRows({ text: `42246 1 ${CLAUDE_ARGV}` });

    expect(rows[0]?.argv).toBe(CLAUDE_ARGV);
  });

  it("drops a line that does not start with two integers rather than failing the read", () => {
    const rows = parseProcessRows({ text: `not a row\n42246 1 ${LISTENER_ARGV}\n` });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.pid).toBe(42246);
  });

  it("returns nothing for empty output", () => {
    expect(parseProcessRows({ text: "" })).toEqual([]);
  });
});

// The cold-seat read must lose no row, so a wrapped argv is joined back rather than dropped.
describe("parseProcessRowsWhole", () => {
  it("joins a line that is not a row back onto the previous row's argv, and keeps an empty argv to join onto", () => {
    expect(
      unwrap(
        parseProcessRowsWhole({
          text: "100 0 ?? Ss /cmux\n10 100 ttys003 S -zsh\n11 10 ttys003 S+ \nvim\n42 1 ?? S /claude --settings {\n}\n",
        }),
      ),
    ).toEqual([
      { argv: "/cmux", pid: 100, ppid: 0, state: "Ss", tty: "??" },
      { argv: "-zsh", pid: 10, ppid: 100, state: "S", tty: "ttys003" },
      { argv: "\nvim", pid: 11, ppid: 10, state: "S+", tty: "ttys003" },
      { argv: "/claude --settings {\n}", pid: 42, ppid: 1, state: "S", tty: "??" },
    ]);
  });

  it("reads each row's tty and state, and a line short of them as a continuation", () => {
    expect(unwrap(parseProcessRowsWhole({ text: "10 100 ttys003 S -zsh\n11 10\n" }))).toEqual([
      { argv: "-zsh\n11 10", pid: 10, ppid: 100, state: "S", tty: "ttys003" },
    ]);
    expect(unwrap(parseProcessRowsWhole({ text: "10 100 ttys003 T -zsh\n11 10 ttys003\n" }))).toEqual([
      { argv: "-zsh\n11 10 ttys003", pid: 10, ppid: 100, state: "T", tty: "ttys003" },
    ]);
  });

  // MEASURED on macOS: a newline inside an argument prints as `\012` on the row's own line, so an argv
  // shaped like a second row stays one row's argv.
  it("reads a newline an argument carries, printed as its octal escape, as part of that row's argv", () => {
    expect(unwrap(parseProcessRowsWhole({ text: "10 100 ttys005 S+ /bin/zsh \\01220 999 ?? S fake\n" }))).toEqual([
      { argv: "/bin/zsh \\01220 999 ?? S fake", pid: 10, ppid: 100, state: "S+", tty: "ttys005" },
    ]);
  });

  it("refuses a line that is not a row and follows none, naming it", () => {
    expect(unwrapErr(parseProcessRowsWhole({ text: `not a row\n42246 1 ?? S ${LISTENER_ARGV}\n` }))).toEqual(
      ProcessTableErrors.lineUnplaceable({ line: "not a row", lineNumber: 1 }),
    );
    expect(ProcessTableErrors.lineUnplaceable({ line: "not a row", lineNumber: 1 }).message).toBe(
      'line 1 of the process table is not a row and follows none: "not a row"',
    );
    expect(ProcessTableErrors.unreadable({ cause: new Error("ps: timed out") })).toEqual({
      cause: "ps: timed out",
      code: "TABLE_UNREADABLE",
      message: "the process table could not be read (ps: timed out)",
    });
  });

  it("returns nothing for empty output", () => {
    expect(unwrap(parseProcessRowsWhole({ text: "" }))).toEqual([]);
  });
});
