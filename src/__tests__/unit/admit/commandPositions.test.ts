/**
 * `commandPositions.ts`: which words of one command list stand where a command starts.
 */
import { describe, expect, it } from "vitest";

import { commandStarts } from "../../../admit/commandPositions.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** The words at every command start of one literal command list. */
function startWords({ text }: { text: string }): readonly string[] {
  const { words } = shellWords({ text });
  return commandStarts({ words }).map((at) => words[at]!.text);
}

describe("commandStarts", () => {
  it.each([
    ["yarn typecheck", ["yarn"]],
    ["if yarn lint", ["if", "yarn"]],
    ["time -p tsc", ["time", "-p", "tsc"]],
    ["xargs -0 yarn lint", ["xargs", "-0", "yarn"]],
    ["stdbuf -o 0 yarn typecheck", ["stdbuf", "-o", "yarn"]],
    ["sudo -u root -E yarn lint", ["sudo", "-u", "-E", "yarn"]],
    ["arch -arm64 yarn typecheck", ["arch", "-arm64", "yarn"]],
    ["timeout -s KILL 60 yarn lint", ["timeout", "yarn"]],
    ["taskset -c 0 yarn lint", ["taskset", "yarn"]],
    ["case x in a) yarn typecheck", ["case", "yarn"]],
    ["find . -name x -exec yarn typecheck", ["find", "yarn"]],
    ["(yarn typecheck", ["(yarn"]],
    ["echo x (tsc", ["echo", "(tsc"]],
  ])("finds the starts of `%s`", (line, expected) => {
    expect(startWords({ text: line })).toEqual(expected);
  });

  it.each([
    ["echo then yarn lint", ["echo"]],
    ["grep do tsc notes.txt", ["grep"]],
    ["grep foo{ tsc notes.txt", ["grep"]],
    ["arch -arm64 grep tsc notes.txt", ["arch", "-arm64", "grep"]],
    ["watch -x echo yarn typecheck", ["watch", "-x", "echo"]],
    ["nice -5 grep yarn typecheck x", ["nice", "-5", "grep"]],
    ["taskset -p 0x1 1234", ["taskset"]],
    ["pgrep -f tsgolint", ["pgrep"]],
    ["echo 'if' tsc", ["echo"]],
  ])("reads a keyword or program name in argument position as data: `%s`", (line, expected) => {
    expect(startWords({ text: line })).toEqual(expected);
  });

  it("starts nothing in an empty list", () => {
    expect(commandStarts({ words: [] })).toEqual([]);
  });
});
