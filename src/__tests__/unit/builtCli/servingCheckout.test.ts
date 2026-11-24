import { describe, expect, it } from "vitest";

import type { BuiltState } from "../../../builtCli/builtState.js";
import {
  judgeServingCheckoutBuild,
  ServingCheckoutErrors,
  walkChecksServingBuild,
} from "../../../builtCli/servingCheckout.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const CHECKOUT = "/dev/slopweaver/.claude/worktrees.noindex/seat";

describe("walkChecksServingBuild — only a named linked worktree's built CLI is checked", () => {
  it("checks a named worktree, and leaves the resolved or named main checkout to its own post-merge rebuild", () => {
    expect([
      walkChecksServingBuild({ checkoutWasNamed: false, mainWorktree: true }),
      walkChecksServingBuild({ checkoutWasNamed: true, mainWorktree: true }),
      walkChecksServingBuild({ checkoutWasNamed: true, mainWorktree: false }),
    ]).toEqual([false, false, true]);
  });
});

describe("judgeServingCheckoutBuild", () => {
  it("serves every standing that costs no rebuild wait: unbuilt runs source, unjudgeable refuses at once, fresh is fine", () => {
    const states: readonly BuiltState[] = [
      { kind: "unbuilt" },
      { kind: "unjudgeable" },
      { kind: "fresh", manifestText: "manifest-1" },
    ];
    expect(states.map((state) => unwrap(judgeServingCheckoutBuild({ checkout: CHECKOUT, state })))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("refuses a stale build, naming the checkout, the first file that moved and `slopweaver dev build`", () => {
    const judged = judgeServingCheckoutBuild({
      checkout: CHECKOUT,
      state: { evidence: "src/a.ts is 21 bytes, 20 at build time", kind: "stale", manifestText: "manifest-1" },
    });
    expect(unwrapErr(judged)).toEqual(
      ServingCheckoutErrors.staleBuiltCli({ checkout: CHECKOUT, evidence: "src/a.ts is 21 bytes, 20 at build time" }),
    );
  });
});

describe("ServingCheckoutErrors.staleBuiltCli", () => {
  it("says what was refused, why the pages would be slow, and the one command that fixes it", () => {
    expect(ServingCheckoutErrors.staleBuiltCli({ checkout: CHECKOUT, evidence: "src/a.ts moved" })).toEqual({
      checkout: CHECKOUT,
      code: "STALE_BUILT_CLI",
      evidence: "src/a.ts moved",
      message:
        "refusing to serve or walk the console from /dev/slopweaver/.claude/worktrees.noindex/seat: its built CLI is " +
        "stale (src/a.ts moved), so every console page would wait 30s for a rebuild nothing here starts — run " +
        "`slopweaver dev build` in that checkout",
    });
  });
});
