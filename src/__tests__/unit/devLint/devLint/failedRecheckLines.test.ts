import { describe, expect, it } from "vitest";
import { CHAIN_MAX_CHARS, classifyRawBash } from "../../../../admit/rawBash.js";
import type { LintCheckResult } from "../../../../devLint/devLint.js";
import { lintChecks } from "../../../../devLint/devLint.js";
import { failedRecheckLines } from "../../../../devLint/lintVerdict.js";

const HEADING = "dev lint: once fixed, re-check only what failed, one command per line:";

describe("failedRecheckLines", () => {
  it("names the one failed gate on the seat lane, fetching first on its own line", () => {
    const results: LintCheckResult[] = [
      { name: "jsdoc-tags", ok: true },
      { name: "no-python", ok: false, output: "finding\n" },
    ];

    expect(failedRecheckLines({ lane: "seat", results })).toEqual([
      HEADING,
      "  git fetch origin main",
      "  slopweaver dev lint --lane seat --only no-python",
    ]);
  });

  it("does not fetch on a lane with no fetch bound", () => {
    const results: LintCheckResult[] = [{ name: "secrets-registry", ok: false }];

    expect(failedRecheckLines({ lane: "local", results })).toEqual([
      HEADING,
      "  slopweaver dev lint --lane local --only secrets-registry",
    ]);
  });

  it("joins several failures in plan order and leaves every green gate out", () => {
    const results: LintCheckResult[] = [
      { name: "whole-file-json", ok: false },
      { name: "jsdoc-tags", ok: true },
      { hung: true, name: "escape-hatch", ok: false },
      { name: "hygiene", ok: true },
    ];

    expect(failedRecheckLines({ lane: "full", results })).toEqual([
      HEADING,
      "  slopweaver dev lint --lane full --only whole-file-json,escape-hatch",
    ]);
  });

  it("leaves a withheld gate out when another gate that ran failed", () => {
    const results: LintCheckResult[] = [
      { name: "no-python", ok: false },
      { name: "oxlint", ok: false, withheld: "a lap holds this machine" },
    ];

    expect(failedRecheckLines({ lane: "seat", results })).toEqual([
      HEADING,
      "  git fetch origin main",
      "  slopweaver dev lint --lane seat --only no-python",
    ]);
  });

  it("prints nothing when every gate passed", () => {
    const results: LintCheckResult[] = [
      { name: "jsdoc-tags", ok: true },
      { name: "no-python", ok: true },
    ];

    expect(failedRecheckLines({ lane: "seat", results })).toEqual([]);
  });

  it("prints nothing when the only gap is a withheld gate, which names its own re-run", () => {
    const results: LintCheckResult[] = [
      { name: "jsdoc-tags", ok: true },
      { name: "oxlint", ok: false, withheld: "a lap holds this machine" },
    ];

    expect(failedRecheckLines({ lane: "seat", results })).toEqual([]);
  });

  it("prints only commands the raw-Bash gate passes, even when every real gate failed", () => {
    const names = lintChecks({ cwd: "/repo" }).map((check) => check.name);
    const results: LintCheckResult[] = names.map((name) => ({ name, ok: false }));
    const commands = failedRecheckLines({ lane: "seat", results })
      .slice(1)
      .map((line) => line.trim());
    const chained = `${commands[0]!} && ${commands[1]!}`;

    expect(names.length).toBeGreaterThan(0);
    expect(chained.length).toBeGreaterThan(CHAIN_MAX_CHARS);
    expect(classifyRawBash({ allowBash: false, command: chained }).blocked).toBe(true);
    expect(commands.map((command) => classifyRawBash({ allowBash: false, command }).blocked)).toEqual([false, false]);
  });
});
