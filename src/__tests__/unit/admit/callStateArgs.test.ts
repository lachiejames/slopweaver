import { describe, expect, it } from "vitest";

import {
  commandPieces,
  isOption,
  programName,
  splitArgs,
  unhatchedPieces,
  unreadableProgram,
} from "../../../admit/callStateArgs.js";
import { shellWords, splitOperators } from "../../../admit/shellLexing.js";

/** The split of one argument list, as texts. */
function split({ text }: { text: string }): { options: readonly string[]; operands: readonly string[] } {
  const { options, operands } = splitArgs({ args: shellWords({ text }).words });
  return { operands: operands.map((word) => word.text), options };
}

describe("splitArgs", () => {
  it.each([
    { operands: ["a", "b"], options: ["-f"], text: "-f a b" },
    { operands: ["a", "-r"], options: ["-f"], text: "-f a -- -r" },
    { operands: ["a", "b"], options: ["--"], text: "'--' a b" },
    { operands: ["-"], options: [], text: "-" },
    { operands: [], options: [], text: "" },
  ])("splits $text", ({ text, options, operands }) => {
    expect(split({ text })).toEqual({ operands, options });
  });
});

describe("unreadableProgram", () => {
  it.each([
    { text: "r{m,m}", want: true },
    { text: "{rm,}", want: true },
    { text: "r?", want: true },
    { text: "/bin/r*", want: true },
    { text: "[r]m", want: true },
    { text: "$RM", want: true },
    { text: '"${RM:-rm}"', want: true },
    { text: "rm", want: false },
    { text: "'r{m,m}'", want: false },
    { text: "[", want: false },
    { text: "[[", want: false },
  ])("reads $text as unreadable: $want", ({ text, want }) => {
    expect(unreadableProgram({ word: shellWords({ text }).words[0]! })).toBe(want);
  });
});

describe("commandPieces", () => {
  it.each([
    { pieces: [["true"], ["rm", "a"]], text: "true & rm a" },
    { pieces: [["true"], ["rm", "a"]], text: "true&rm a" },
    { pieces: [["sleep", "1"]], text: "sleep 1 &" },
    { pieces: [["cat", "a", "2>&1"]], text: "cat a 2>&1" },
    { pieces: [["true", "&>", "a"]], text: "true &> a" },
    { pieces: [["echo", "&"]], text: "echo '&'" },
    { pieces: [["a"], ["b"], ["c"]], text: "a & b & c" },
    { pieces: [], text: "" },
    { pieces: [["rm", "a"]], text: "(rm a)" },
    { pieces: [["rm", "a"]], text: "( rm a )" },
    {
      pieces: [
        ["true", "&&"],
        ["rm", "a"],
      ],
      text: "true && (rm a)",
    },
    { pieces: [["f()", "{", "rm", "a"]], text: "f() { rm a" },
    { pieces: [["((x++))"]], text: "((x++))" },
    { pieces: [["echo", "(a)"]], text: "echo '(a)'" },
  ])("splits $text", ({ text, pieces }) => {
    const words = splitOperators({ words: shellWords({ text }).words });
    expect(commandPieces({ words }).map((piece) => piece.map((word) => word.text))).toEqual(pieces);
  });
});

describe("unhatchedPieces", () => {
  /** The pieces of `text` a hatch named `H` leaves to judge, as texts. */
  function left({ text, hatched }: { text: string; hatched: boolean }): readonly (readonly string[])[] {
    const pieces = commandPieces({ words: splitOperators({ words: shellWords({ text }).words }) });
    return unhatchedPieces({ hatched, name: "H", pieces }).map((piece) => piece.map((word) => word.text));
  }

  it.each([
    { hatched: false, left: [["rm", "a"]], text: "H=1 true & rm a" },
    { hatched: false, left: [["true"]], text: "true & H=1 rm a" },
    { hatched: false, left: [["echo", "H=1", "rm", "a"]], text: "echo H=1 rm a" },
    { hatched: true, left: [], text: "H=1 rm a" },
    { hatched: true, left: [["rm", "a"]], text: "H=1 true & rm a" },
    { hatched: true, left: [["rm", "a"]], text: "env X=2 H=1 true & rm a" },
    { hatched: true, left: [["true"]], text: "true & H=1 rm a" },
    { hatched: true, left: [["rm", "H=1"]], text: "H=1 true & rm H=1" },
    {
      hatched: true,
      left: [
        ["H=0", "true"],
        ["rm", "a"],
      ],
      text: "H=0 true & rm a",
    },
  ])("leaves $left of $text, hatched: $hatched", ({ text, hatched, left: expected }) => {
    expect(left({ hatched, text })).toEqual(expected);
  });
});

describe("programName", () => {
  it("folds a program's case, a path's directory dropped", () => {
    expect(["/bin/RM", "Truncate", "rm", "/usr/bin/Env"].map((text) => programName({ text }))).toEqual([
      "rm",
      "truncate",
      "rm",
      "env",
    ]);
  });
});

describe("isOption", () => {
  it("reads a lone dash as an operand", () => {
    expect(isOption({ word: shellWords({ text: "-" }).words[0]! })).toBe(false);
    expect(isOption({ word: shellWords({ text: "-rf" }).words[0]! })).toBe(true);
  });
});
