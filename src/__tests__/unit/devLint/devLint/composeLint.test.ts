import { describe, expect, it } from "vitest";
import type { LintCheckResult } from "../../../../devLint/devLint.js";
import { GATE_TIMEOUT_MS } from "../../../../devLint/gateRunner.js";
import { composeLint } from "../../../../devLint/lintVerdict.js";

describe("composeLint", () => {
  it("passes (exit 0) only when every check passed", () => {
    const { ok, exit } = composeLint({
      planned: ["prettier", "oxlint"],
      results: [
        { name: "prettier", ok: true },
        { name: "oxlint", ok: true },
      ],
    });
    expect(ok).toBe(true);
    expect(exit).toBe(0);
  });

  it("fails (exit 1) when any check failed", () => {
    const { ok, exit } = composeLint({
      planned: ["prettier", "oxlint"],
      results: [
        { name: "prettier", ok: true },
        { name: "oxlint", ok: false },
      ],
    });
    expect(ok).toBe(false);
    expect(exit).toBe(1);
  });

  it("fails a lap that ran no checks rather than passing it vacuously", () => {
    expect(composeLint({ planned: [], results: [] })).toEqual({ exit: 1, ok: false });
  });

  it("fails when a planned gate's outcome never arrived, even with every arrived one green", () => {
    const verdict = composeLint({ planned: ["prettier", "oxlint"], results: [{ name: "prettier", ok: true }] });
    expect(verdict).toEqual({ exit: 1, ok: false });
  });

  it("fails when a duplicated green outcome stands in for a missing gate, which a count alone accepted", () => {
    const results = [
      { name: "prettier", ok: true },
      { name: "prettier", ok: true },
    ];
    expect(composeLint({ planned: ["prettier", "oxlint"], results })).toEqual({ exit: 1, ok: false });
  });

  // A gate the lane refused to spawn passed nothing, so the lap is never green — but nothing FAILED either,
  // so it is EXIT_DEFERRED: run it again unchanged.
  it("defers (exit 4), never passes, when every gate that ran passed and one was withheld", () => {
    const results: LintCheckResult[] = [
      { name: "prettier", ok: true },
      { name: "oxlint", ok: false, withheld: "a lap holds this machine" },
    ];
    expect(composeLint({ planned: ["prettier", "oxlint"], results })).toEqual({ exit: 4, ok: false });
  });

  it("fails (exit 1) when a gate that ran failed beside a withheld one", () => {
    const results: LintCheckResult[] = [
      { name: "prettier", ok: false },
      { name: "oxlint", ok: false, withheld: "a lap holds this machine" },
    ];
    expect(composeLint({ planned: ["prettier", "oxlint"], results })).toEqual({ exit: 1, ok: false });
  });

  // A killed gate is a FAILED gate, never a skipped one — the whole point of the ceiling is that a lap
  // which could not judge a gate must not exit 0.
  it("fails when a gate was killed at the ceiling", () => {
    const results: LintCheckResult[] = [{ elapsedMs: GATE_TIMEOUT_MS, hung: true, name: "door-coverage", ok: false }];
    expect(composeLint({ planned: ["door-coverage"], results })).toEqual({ exit: 1, ok: false });
  });
});
