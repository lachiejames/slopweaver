/**
 * Whether an evaluator is handed program text in its arguments: the per-program spellings, and the structural
 * rule that fails closed on any option ahead of the script file.
 */
import { describe, expect, it } from "vitest";

import { evaluatesString, shellPayloadIndex } from "../../../admit/programText.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** Ask whether one command line's program is handed program text, the way `rawBashStage` asks it. */
function evaluates({ text }: { text: string }): boolean {
  const [program, ...args] = shellWords({ text }).words;
  const options = args.filter((arg) => arg.text.startsWith("-")).map((arg) => arg.text);
  return evaluatesString({ args, name: program!.text, options });
}

describe("evaluatesString", () => {
  it("fails closed on any option ahead of an evaluator's script file, whatever the option", () => {
    const leading = [
      `R --expression='writeLines("x", "out.txt")'`,
      "julia -e 'touch(\"x\")'",
      "tclsh -encoding utf-8 x.tcl",
      "bash -x scripts/setup.sh",
      "node --import tsx x.ts",
      "deno --quiet run x.ts",
    ];
    expect(leading.map((text) => evaluates({ text }))).toEqual(leading.map(() => true));
  });

  it("passes an evaluator running a script file, with or without the script's own options", () => {
    const files = [
      "R --version",
      "node --help",
      "julia scripts/fit.jl",
      "node scripts/build.js --verbose",
      "bash x.sh",
    ];
    expect(files.map((text) => evaluates({ text }))).toEqual(files.map(() => false));
  });

  it("still names a documented spelling that sits after the script file", () => {
    expect(evaluates({ text: "deno run x.ts eval" })).toBe(true);
    expect(evaluates({ text: "awk '{print $1}' f" })).toBe(true);
  });

  it("names gawk's -e or --source text even beside a -f file, and passes a -f file alone", () => {
    expect(evaluates({ text: "gawk -f /dev/null -e 'BEGIN{system(\"x\")}'" })).toBe(true);
    expect(evaluates({ text: "gawk -f x.awk --sour='BEGIN{}' f" })).toBe(true);
    expect(evaluates({ text: "awk -f x.awk f" })).toBe(false);
    expect(evaluates({ text: "awk -v x=e -f x.awk f" })).toBe(false);
  });

  it("never asks a program the evaluator table does not name", () => {
    expect(evaluates({ text: "git --no-pager log" })).toBe(false);
  });
});

describe("shellPayloadIndex", () => {
  it("finds the payload after -c, a cluster holding c, fish's -C and --command", () => {
    const [, ...args] = shellWords({ text: "fish -C 'sleep 1'" }).words;
    expect(shellPayloadIndex({ args })).toBe(1);
    expect(shellPayloadIndex({ args: shellWords({ text: "-lc x" }).words })).toBe(1);
    expect(shellPayloadIndex({ args: shellWords({ text: "--command x" }).words })).toBe(1);
    expect(shellPayloadIndex({ args: shellWords({ text: "x.sh arg" }).words })).toBeUndefined();
  });
});
