/*
 * When a `store` probe-ladder verb stops to print its usage: `--help` or `-h` anywhere in its own argv tail, and
 * nothing else — a flag merely starting with `-h`, or `help` as a positional, runs the verb.
 */
import { describe, expect, it } from "vitest";

import { wantedHelp } from "../../../../../cli/commands/store/probeShell.js";

describe("wantedHelp", () => {
  it("stops the verb on --help", () => {
    expect(wantedHelp({ rest: ["deploy", "--help"], usage: "usage: probe" })).toBe(true);
  });

  it("stops the verb on -h", () => {
    expect(wantedHelp({ rest: ["-h"], usage: "usage: probe" })).toBe(true);
  });

  it("runs the verb when neither flag is present, including a lookalike", () => {
    expect(wantedHelp({ rest: ["help", "--hits", "-hx"], usage: "usage: probe" })).toBe(false);
  });

  it("runs the verb on an empty tail", () => {
    expect(wantedHelp({ rest: [], usage: "usage: probe" })).toBe(false);
  });
});
