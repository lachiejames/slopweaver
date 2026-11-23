import { describe, expect, it } from "vitest";

import {
  composeRequiredContexts,
  judgeQueueSafety,
  parseGithubRequiredContextsArgs,
  requiredContextsDoorRequest,
  unobservedContextRefusal,
  unobservedHatchOpen,
} from "../../../../../cli/commands/github/requiredContextsCore.js";
import { unwrap } from "../../../../../lib/result.js";

describe("parseGithubRequiredContextsArgs", () => {
  it("reads with no change when neither --require nor --drop is typed", () => {
    const parsed = parseGithubRequiredContextsArgs({ rest: ["--repo", "o/r"] });

    expect(parsed.isOk()).toBe(true);
    const args = unwrap(parsed);
    expect(args.repo).toBe("o/r");
    expect(args.branch).toBe("main");
    expect(args.require).toEqual([]);
    expect(args.drop).toEqual([]);
    expect(args.entries).toBe(5);
    expect(args.exact).toBe(false);
  });

  it("splits a comma list, trims it and drops repeats", () => {
    const parsed = parseGithubRequiredContextsArgs({ rest: ["--require", " CodeQL , build ,CodeQL"] });

    expect(unwrap(parsed).require).toEqual(["CodeQL", "build"]);
  });

  it("leaves --repo absent so the shell can resolve the checkout", () => {
    const parsed = parseGithubRequiredContextsArgs({ rest: ["--require", "CodeQL"] });

    expect(unwrap(parsed).repo).toBeUndefined();
  });

  it("refuses --exact with nothing to require, since that gates nothing", () => {
    const parsed = parseGithubRequiredContextsArgs({ rest: ["--repo", "o/r", "--exact"] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual([
      "--exact needs --require <a,b>: a required set of nothing gates nothing",
    ]);
  });

  it("refuses a context named by both --require and --drop", () => {
    const parsed = parseGithubRequiredContextsArgs({ rest: ["--require", "a,b", "--drop", "b,c"] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual(["--require and --drop name the same context: b"]);
  });

  it("refuses an --entries window outside 1..100", () => {
    const parsed = parseGithubRequiredContextsArgs({ rest: ["--entries", "0"] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual(["--entries must be an integer 1..100"]);
  });
});

describe("composeRequiredContexts", () => {
  it("ADDS to what the branch already requires rather than replacing it", () => {
    const next = composeRequiredContexts({
      args: { drop: [], exact: false, require: ["CodeQL"] },
      current: ["build", "integration"],
    });

    expect(next).toEqual(["CodeQL", "build", "integration"]);
  });

  it("replaces the whole list only when --exact was typed", () => {
    const next = composeRequiredContexts({
      args: { drop: [], exact: true, require: ["CodeQL"] },
      current: ["build", "integration"],
    });

    expect(next).toEqual(["CodeQL"]);
  });

  it("removes what --drop names and keeps the rest sorted", () => {
    const next = composeRequiredContexts({
      args: { drop: ["integration"], exact: false, require: [] },
      current: ["integration", "build"],
    });

    expect(next).toEqual(["build"]);
  });

  it("answers an empty list when --drop names everything, so the caller can refuse it", () => {
    const next = composeRequiredContexts({
      args: { drop: ["build", "integration"], exact: false, require: [] },
      current: ["build", "integration"],
    });

    expect(next).toEqual([]);
  });
});

describe("judgeQueueSafety", () => {
  it("judges only what is being added, one verdict per name, in order", () => {
    const verdicts = judgeQueueSafety({
      adding: ["CodeQL", "typecheck"],
      observed: ["build", "typecheck", "typecheck"],
    });

    expect(verdicts).toEqual([
      { name: "CodeQL", observed: false },
      { name: "typecheck", observed: true },
    ]);
  });

  it("judges nothing when the write only ever narrows the gate", () => {
    expect(judgeQueueSafety({ adding: [], observed: ["build"] })).toEqual([]);
  });

  it("calls every addition unobserved when the window saw nothing", () => {
    expect(judgeQueueSafety({ adding: ["CodeQL"], observed: [] })).toEqual([{ name: "CodeQL", observed: false }]);
  });
});

describe("unobservedContextRefusal", () => {
  it("names the contexts, the window size and what the window did carry", () => {
    const lines = unobservedContextRefusal({
      entries: 8,
      observed: ["integration", "build"],
      unobserved: ["CodeQL", "dev-gate"],
    });

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("CodeQL, dev-gate");
    expect(lines[0]).toContain("8 merge-group entries carried: build, integration");
    expect(lines[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_UNOBSERVED_REQUIRED_CONTEXT=1 " +
        "slopweaver github required-contexts.",
    );
  });

  it("says nothing was measured rather than listing an empty window", () => {
    const lines = unobservedContextRefusal({ entries: 0, observed: [], unobserved: ["CodeQL"] });

    expect(lines[0]).toContain("no merge-group entry was found at all, so nothing was measured");
  });

  it("makes the window singular for one entry", () => {
    const lines = unobservedContextRefusal({ entries: 1, observed: ["build"], unobserved: ["CodeQL"] });

    expect(lines[0]).toContain("1 merge-group entry carried: build");
  });
});

describe("unobservedHatchOpen", () => {
  it("opens only on the exact declared value", () => {
    expect(unobservedHatchOpen({ env: { SLOPWEAVER_ALLOW_UNOBSERVED_REQUIRED_CONTEXT: "1" } })).toBe(true);
    expect(unobservedHatchOpen({ env: { SLOPWEAVER_ALLOW_UNOBSERVED_REQUIRED_CONTEXT: "true" } })).toBe(false);
    expect(unobservedHatchOpen({ env: {} })).toBe(false);
  });
});

describe("requiredContextsDoorRequest", () => {
  it("names the branch in the artifact, so two branches are two door records", () => {
    const request = requiredContextsDoorRequest({ branch: "main", home: "/tmp/home", identity: "o/r" });

    expect(request.artifact["id"]).toBe("o/r@main");
    expect(request.action).toEqual({ kind: "verb", noun: "github", verb: "required-contexts" });
    expect(request.meta.effect).toBe("external-write");
  });
});
