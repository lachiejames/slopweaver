/*
 * The per-head required-context gate on its own: one base's shared set judged against each head's checks and
 * its settled mergeability, and a base this run never keyed reading as unread rather than as requiring nothing.
 * The whole-run case with two heads on one base stays with the verb's own suite.
 */
import { describe, expect, it } from "vitest";

import { baseKey, gateFor } from "../../../../../cli/commands/github/reviewStateRequiredContexts.js";
import type { RequiredSetRead } from "../../../../../live/github/requiredContexts.js";
import { pr } from "./landingRun/fixtures.js";

const LINT = { kind: "check-run", name: "lint", state: "passed", url: undefined } as const;

describe("baseKey", () => {
  it("joins the repository slug and the base branch with a hash", () => {
    expect(baseKey({ pr: pr({ baseRefName: "main", repoSlug: "acme/widgets" }) })).toBe("acme/widgets#main");
  });
});

describe("gateFor", () => {
  const sets: ReadonlyMap<string, RequiredSetRead> = new Map<string, RequiredSetRead>([
    ["acme/widgets#staging", { kind: "read", required: ["build", "lint"] }],
  ]);

  it("judges the shared set against this head's own checks and its top-level mergeability", () => {
    const head = pr({
      checks: { ...pr().checks, mergeable: "UNKNOWN" },
      mergeable: "CONFLICTING",
    });
    expect(gateFor({ pr: head, sets })).toEqual({
      branch: "staging",
      kind: "read",
      mergeable: "CONFLICTING",
      missing: ["lint"],
      required: ["build", "lint"],
      unproven: [],
    });
  });

  it("gives a second head on the same base its own answer", () => {
    const head = pr({ checks: { ...pr().checks, checks: [...pr().checks.checks, LINT] }, number: 16379 });
    expect(gateFor({ pr: head, sets })).toEqual({
      branch: "staging",
      kind: "read",
      mergeable: "MERGEABLE",
      missing: [],
      required: ["build", "lint"],
      unproven: [],
    });
  });

  it("reports an absent name as unproven when the head's checks were truncated", () => {
    const head = pr({ checks: { ...pr().checks, truncated: true } });
    expect(gateFor({ pr: head, sets })).toEqual({
      branch: "staging",
      kind: "read",
      mergeable: "MERGEABLE",
      missing: [],
      required: ["build", "lint"],
      unproven: ["lint"],
    });
  });

  it("reads a base this run never keyed as unread, never as requiring nothing", () => {
    expect(gateFor({ pr: pr({ repoSlug: "" }), sets })).toEqual({
      kind: "unreadable",
      reason: "the base branch's protection and rulesets were not read on this run",
    });
  });

  it("carries an unreadable set's own reason through", () => {
    const unreadable = new Map<string, RequiredSetRead>([
      ["acme/widgets#staging", { kind: "unreadable", reason: "rulesets answered 403" }],
    ]);
    expect(gateFor({ pr: pr(), sets: unreadable })).toEqual({ kind: "unreadable", reason: "rulesets answered 403" });
  });
});
