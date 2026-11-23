import { describe, expect, it } from "vitest";

import { LIVE_MARKER_PREFIX } from "../../../codex/accountLiveParse.js";
import { LIVE_READ_PROGRAM } from "../../../codex/liveReadProgram.js";

const lines = LIVE_READ_PROGRAM.split("\n");

describe("the Tcl program every live exchange runs", () => {
  // An instant under a caller's deadline, so `tclsh`'s own start-up is spent from it; a duration otherwise.
  it("reads its deadline as an instant after `@`, else as a duration from its own start", () => {
    expect(lines.slice(1, 7)).toEqual([
      "set deadlineArg [lindex $argv 0]",
      "if {[string index $deadlineArg 0] eq {@}} {",
      "  set deadlineAt [string range $deadlineArg 1 end]",
      "} else {",
      "  set deadlineAt [expr {[clock milliseconds] + $deadlineArg}]",
      "}",
    ]);
  });

  it("prints every marker it writes under the prefix the parser reads", () => {
    expect(lines.filter((line) => line.includes("\\t" + LIVE_MARKER_PREFIX)).map((line) => line.trim())).toEqual([
      `puts stdout "$index\\t${LIVE_MARKER_PREFIX}$word"`,
      `puts stdout "$index\\t${LIVE_MARKER_PREFIX}deadline"`,
      `puts stdout "$index\\t${LIVE_MARKER_PREFIX}open"`,
    ]);
  });

  it("kills each store's whole process tree, one pid per kill, before closing its pipe blocking", () => {
    expect(
      lines.filter((line) => /kill -9|-blocking 1|close \$channel/u.test(line)).map((line) => line.trim()),
    ).toEqual([
      "foreach target $tree { catch {exec kill -9 $target} }",
      "catch {fconfigure $channel -blocking 1}",
      "catch {close $channel}",
    ]);
  });

  it("ends by flushing what it printed and exiting clean", () => {
    expect(lines.slice(-4)).toEqual(["if {$pending > 0} { vwait ::finished }", "flush stdout", "exit 0", ""]);
  });
});
