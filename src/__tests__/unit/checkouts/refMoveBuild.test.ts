import { describe, expect, it } from "vitest";
import {
  BUILD_FIX_COMMAND,
  refMoveBuildDecision,
  refMoveBuildHookFrom,
  renderRefMoveBuildOutcome,
  stalesBuild,
} from "../../../checkouts/refMoveBuild.js";

describe("stalesBuild", () => {
  it("counts a source file the emit reads", () => {
    expect(stalesBuild({ path: "src/cli/main.ts" })).toBe(true);
  });

  it("counts package.json, which re-roots the emitted subpath imports", () => {
    expect(stalesBuild({ path: "package.json" })).toBe(true);
    expect(stalesBuild({ path: "yarn.lock" })).toBe(true);
  });

  it("does NOT count the test lane, which the emit excludes", () => {
    expect(stalesBuild({ path: "src/__tests__/unit/cli/main.test.ts" })).toBe(false);
  });

  it("does NOT count a doc, a workflow or a non-TypeScript file under src", () => {
    expect(stalesBuild({ path: "docs/toolchain.md" })).toBe(false);
    expect(stalesBuild({ path: ".github/workflows/ci.yml" })).toBe(false);
    expect(stalesBuild({ path: "src/atlas/fixtures/a.json" })).toBe(false);
  });

  it("does NOT count a path merely beginning with the source root's letters", () => {
    expect(stalesBuild({ path: "srcextra/a.ts" })).toBe(false);
  });
});

describe("refMoveBuildDecision", () => {
  it("rebuilds when the move brought in source, naming the first file and the rest", () => {
    const decision = refMoveBuildDecision({
      changedPaths: ["docs/a.md", "src/cli/main.ts", "src/builtCli/guard.ts"],
    });

    expect(decision.build).toBe(true);
    expect(decision.why).toBe("the move changed src/cli/main.ts and 1 other built file(s)");
  });

  it("does not rebuild when the move touched nothing built, and counts what it saw", () => {
    const decision = refMoveBuildDecision({ changedPaths: ["docs/a.md", "src/__tests__/unit/a.test.ts"] });

    expect(decision.build).toBe(false);
    expect(decision.why).toBe("the move changed 2 file(s), none of them built");
  });

  it("does not rebuild on an empty diff", () => {
    const decision = refMoveBuildDecision({ changedPaths: [] });

    expect(decision.build).toBe(false);
    expect(decision.why).toBe("the move changed 0 file(s), none of them built");
  });
});

describe("renderRefMoveBuildOutcome", () => {
  it("distinguishes not looking from looking and finding nothing to do", () => {
    expect(renderRefMoveBuildOutcome({ hook: "post-merge", outcome: { did: "skipped", why: "no dist-cli" } })).toBe(
      "post-merge: built CLI not checked — no dist-cli",
    );
    expect(renderRefMoveBuildOutcome({ hook: "post-merge", outcome: { did: "current", why: "no source moved" } })).toBe(
      "post-merge: built CLI current — no source moved",
    );
  });

  it("names the command it ran on the rebuilt arm", () => {
    const line = renderRefMoveBuildOutcome({
      hook: "post-checkout",
      outcome: { detail: "4166 file(s)", did: "rebuilt", why: "the move changed src/a.ts and 0 other built file(s)" },
    });

    expect(line).toBe(
      `post-checkout: ran \`${BUILD_FIX_COMMAND}\` — the move changed src/a.ts and 0 other built file(s); 4166 file(s)`,
    );
  });

  it("collapses a multi-line failure detail into the one line the hook promises", () => {
    const line = renderRefMoveBuildOutcome({
      hook: "post-merge",
      outcome: { detail: "esbuild failed\n  at line 2\n", did: "failed", why: "the move changed src/a.ts" },
    });

    expect(line).toBe(
      `post-merge: \`${BUILD_FIX_COMMAND}\` FAILED — the move changed src/a.ts; esbuild failed · at line 2`,
    );
  });
});

describe("refMoveBuildHookFrom", () => {
  it("accepts the two hooks lefthook invokes this under", () => {
    expect(refMoveBuildHookFrom({ name: "post-checkout" })).toBe("post-checkout");
    expect(refMoveBuildHookFrom({ name: "post-merge" })).toBe("post-merge");
  });

  it("refuses any other name, so a mis-wired hook says so rather than guessing", () => {
    expect(refMoveBuildHookFrom({ name: "pre-push" })).toBeUndefined();
    expect(refMoveBuildHookFrom({ name: "" })).toBeUndefined();
  });

  it("refuses an absent argument, which is an invocation carrying no hook name at all", () => {
    expect(refMoveBuildHookFrom({ name: undefined })).toBeUndefined();
  });
});
