/**
 * `runnerInvocation.ts`: which script a package-manager front end runs, where, and what it is handed.
 */
import { describe, expect, it } from "vitest";

import { runnerScripts } from "../../../admit/runnerInvocation.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** Every reading of one literal front-end line from `/repo`, as plain strings. */
function readings({ text }: { text: string }): { cwd: string | undefined; scriptArgs: string[]; words: string[] }[] {
  const [program, ...args] = shellWords({ text }).words;
  return runnerScripts({ args, cwd: "/repo", program: program!.text }).map((run) => ({
    cwd: run.cwd,
    scriptArgs: run.scriptArgs.map((word) => word.text),
    words: run.words.map((word) => word.text),
  }));
}

/** The one reading of a line whose options this module knows. */
function resolve({ text }: { text: string }): { cwd: string | undefined; scriptArgs: string[]; words: string[] } {
  const all = readings({ text });
  expect(all.length).toBe(1);
  return all[0]!;
}

describe("runnerScripts", () => {
  it("follows yarn's --cwd and hands the script every word after it", () => {
    expect(resolve({ text: "yarn --cwd desktop lint --only x" })).toEqual({
      cwd: "/repo/desktop",
      scriptArgs: ["--only", "x"],
      words: ["lint", "--only", "x"],
    });
  });

  it("reads npm's options after the script, and hands it only the words after --", () => {
    expect(resolve({ text: "npm run lint --prefix desktop --only x -- --lane local" })).toEqual({
      cwd: "/repo/desktop",
      scriptArgs: ["--lane", "local"],
      words: ["lint", "--prefix", "desktop", "--only", "x", "--", "--lane", "local"],
    });
  });

  it("hands an npm script nothing without --", () => {
    expect(resolve({ text: "npm run-script lint --only x" }).scriptArgs).toEqual([]);
  });

  it("skips a value flag's value", () => {
    expect(resolve({ text: "pnpm --filter app -C sub typecheck" })).toEqual({
      cwd: "/repo/sub",
      scriptArgs: [],
      words: ["typecheck"],
    });
  });

  it("names nothing for a bare front end", () => {
    expect(readings({ text: "yarn --cwd desktop" })).toEqual([]);
  });

  it("reads an unknown spaced option both ways, valueless and taking the next word", () => {
    expect(readings({ text: "npm --loglevel silent exec -- tsc -p ." }).map((run) => run.words[0])).toEqual([
      "silent",
      "tsc",
    ]);
  });

  it("never lets an unknown option swallow a verb, another option or --", () => {
    expect(readings({ text: "yarn --silent run typecheck" }).map((run) => run.words)).toEqual([["typecheck"]]);
  });

  it("names nothing for a workspaces foreach dry run", () => {
    expect(readings({ text: "yarn workspaces foreach -A --dry-run run typecheck" })).toEqual([]);
    expect(readings({ text: "yarn workspaces foreach -n run typecheck" })).toEqual([]);
  });
});
