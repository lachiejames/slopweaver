import { describe, expect, it } from "vitest";
import { lintChecks } from "../../../../devLint/devLint.js";

describe("lintChecks", () => {
  it("names every planned check once, which composeLint's exactly-once verdict relies on", () => {
    const names = lintChecks({ cwd: "/repo" }).map((c) => c.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  it("plans every check in run order, resolving local bins under the cwd", () => {
    const checks = lintChecks({ cwd: "/repo" });
    expect(checks.map((c) => c.name)).toEqual([
      "biome-imports",
      "prettier",
      "oxlint",
      "knip",
      "constraints",
      "hygiene",
      "forbidden-identifiers",
      "corpus-hygiene",
      "resilience-residue",
      "boundary-residue",
      "scheduler-bypass",
      "outbound-privacy-closure",
      "no-headless",
      "operation-labels",
      "stdout-data-channel",
      "running-checkout-root",
      "console-verb-binary",
      "sync-child-timeout",
      "max-function-lines",
      "named-object-params",
      "unbounded-spread",
      "control-bytes",
      "no-proof-path",
      "git-in-tests",
      "outbound-form-strict",
      "boundary-schema",
      "jsdoc-tags",
      "whole-file-json",
      "cognitive-complexity",
      "house-rules",
      "testing-discipline",
      "unnamed-failure-assertion",
      "hand-rolled-result",
      "error-shape-threshold",
      "no-nested-ternaries",
      "authored-separator",
      "app-copy-voice",
      "transient-references",
      "no-silent-fallback",
      "no-python",
      "legacy-vocabulary",
      "unexpanded-plugin-root",
      "console-loading-prose",
      "atlas-manifest-clock",
      "atlas-content-coverage",
      "no-private-browser-profile",
      "claude-email-not-identity",
      "linear-sdk-documents",
      "epoch-arithmetic",
      "cli-command-boundary",
      "torn-tail-append",
      "session-harness-lifecycle",
      "drizzle-migrations",
      "store-journal-anchor",
      "primitive-ratchet",
      "home-safety",
      "redos-check",
      "typescript-import-seam",
      "runtime-dependencies",
      "duplicate-windows",
      "file-size-ratchet",
      "internal-exports",
      "untested-modules",
      "test-enshittification",
      "baseline-against-main",
      "doc-counts",
      "agent-doc-size",
      "doc-links",
      "own-hand-residue",
      "host-wording",
      "retired-claude-transport",
      "command-trigger",
      "naming-doctrine",
      "register-hygiene",
      "secrets-registry",
      "command-meta-residue",
      "manifest-loader-tests",
      "gate-registration",
      "register-bindings",
      "ci-offload-contract",
      "ambient-heap-ceiling",
      "ci-trigger-contract",
      "tsc-heap-contract",
      "heap-ceiling-ratchet",
      "typescript-pin",
      "hook-bounded",
      "help-flag-opt-out",
      "coverage-ratchet",
      "door-coverage",
      "derived-card-voice",
      "escape-hatch",
      "hatch-release",
    ]);
    // Every linter escalates warnings to failures — no ignorable middle ground.
    expect(checks.find((c) => c.name === "biome-imports")!.args).toEqual(["check", "--max-diagnostics=20", "."]);
    expect(checks.find((c) => c.name === "prettier")!.args).toEqual([
      "--experimental-cli",
      "--no-cache",
      "--parallel-workers",
      "4",
      "--check",
      ".",
    ]);
    expect(checks.find((c) => c.name === "oxlint")!.args).toEqual([
      "--type-aware",
      "--tsconfig",
      "./config/typescript/tsconfig.lint.json",
      "--deny-warnings",
      ".",
    ]);
  });

  it("runs constraints via yarn and hygiene via bash (not local bins)", () => {
    expect(lintChecks({ cwd: "/repo" }).find((c) => c.name === "constraints")!.cmd).toBe("yarn");
    expect(lintChecks({ cwd: "/repo" }).find((c) => c.name === "hygiene")!.cmd).toBe("bash");
  });

  it("flags exactly the five gates whose subject CI cannot see, and nothing else", () => {
    // The pin is the point: the local lane is an opt-in, so a gate joins `pre-push`
    // only by claiming CI cannot reach its state — the private denylist, the bronze corpus, the secrets
    // store, the handover register, the operator's profile.json. A sixth name appearing here is a gate
    // that has to justify itself; a name LEAVING here is a check that now runs nowhere at all.
    const offRepo = lintChecks({ cwd: "/repo" }).filter((c) => c.offRepoState === true);
    expect(offRepo.map((c) => c.name)).toEqual([
      "hygiene",
      "corpus-hygiene",
      "register-hygiene",
      "secrets-registry",
      "derived-card-voice",
    ]);
  });

  it("leaves the forbidden-identifier gate to CI, whose subject is the tree and whose rules are committed", () => {
    const gate = lintChecks({ cwd: "/repo" }).find((c) => c.name === "forbidden-identifiers")!;
    expect([gate.cmd, gate.args, gate.offRepoState]).toEqual([
      "/repo/node_modules/.bin/tsx",
      ["src/devLint/forbiddenIdentifiers.entry.ts"],
      undefined,
    ]);
  });

  it("leaves the whole-repo ts.Program gate to CI, flagged by nothing", () => {
    expect(lintChecks({ cwd: "/repo" }).find((c) => c.name === "named-object-params")!.offRepoState).toBe(undefined);
  });

  it("passes --expose-gc and a raised ceiling to the Program gate, so its budget is measured rather than OOMed", () => {
    // The ceiling is not the budget: measured, the live set is 4,079 MiB against V8's ~4,096
    // default, so without `--max-old-space-size` the process died before its own 4,200 check could report.
    const gate = lintChecks({ cwd: "/repo" }).find((c) => c.name === "named-object-params")!;
    expect(gate.args).toEqual(["--expose-gc", "--max-old-space-size=8192", "src/devLint/namedObjectParams.entry.ts"]);
  });

  it("runs the four bespoke gates that replace ESLint's job through tsx (eslint-oom-crash-blocks-validate)", () => {
    const checks = lintChecks({ cwd: "/repo" });
    const expected = [
      ["cognitive-complexity", "cognitiveComplexity"],
      ["house-rules", "houseRules"],
      ["testing-discipline", "testingDiscipline"],
      ["redos-check", "redosCheck"],
    ];
    for (const [name, entryStem] of expected) {
      const check = checks.find((c) => c.name === name)!;
      expect(check.cmd).toBe("/repo/node_modules/.bin/tsx");
      expect(check.args).toEqual([`src/devLint/${entryStem}.entry.ts`]);
    }
  });
});
