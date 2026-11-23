/**
 * The ref-move install decisions the `post-merge` / `post-checkout` hooks are built on: which moves are
 * worth looking at, what each one has to diff, whether the result needs an install, and the ONE line every
 * path ends in.
 *
 * Each skip case here is a git behaviour measured with lefthook 2.1.12 (see `refMoveInstall.ts`'s header),
 * so the assertions name the reason text rather than only the fact of a skip — two different git situations
 * both landing on "skip" for the wrong reason is exactly the failure a bare boolean would hide.
 */
import { describe, expect, it } from "vitest";

import {
  NULL_OID,
  postCheckoutPlan,
  postMergePlan,
  refMoveInstallDecision,
  renderRefMoveOutcome,
} from "../../../checkouts/refMoveInstall.js";

const OLD_SHA = "1111111111111111111111111111111111111111";
const NEW_SHA = "2222222222222222222222222222222222222222";

describe("postCheckoutPlan", () => {
  it("compares the two commits of an ordinary branch checkout", () => {
    const plan = postCheckoutPlan({ branchFlag: "1", newRef: NEW_SHA, previousRef: OLD_SHA });
    expect(plan).toEqual({
      act: "compare",
      comparison: { against: "commits", from: OLD_SHA, to: NEW_SHA },
    });
  });

  it("skips a file checkout, naming the flag rather than the zero oids git also passes", () => {
    const plan = postCheckoutPlan({ branchFlag: "0", newRef: NULL_OID, previousRef: NULL_OID });
    expect(plan).toEqual({ act: "skip", why: "a file checkout, which moves no ref" });
  });

  it("skips a brand-new worktree, whose previous oid is all zeroes", () => {
    const plan = postCheckoutPlan({ branchFlag: "1", newRef: NEW_SHA, previousRef: NULL_OID });
    expect(plan).toEqual({
      act: "skip",
      why: "there is no previous commit to compare against — a new worktree installs through `cmux spawn`",
    });
  });

  it("skips `git checkout -b`, which passes the same commit twice", () => {
    const plan = postCheckoutPlan({ branchFlag: "1", newRef: OLD_SHA, previousRef: OLD_SHA });
    expect(plan).toEqual({ act: "skip", why: "the ref did not move" });
  });

  it("skips when git passed fewer than three arguments", () => {
    const plan = postCheckoutPlan({ branchFlag: undefined, newRef: NEW_SHA, previousRef: OLD_SHA });
    expect(plan).toEqual({
      act: "skip",
      why: "git passed fewer than three arguments, so the move cannot be identified",
    });
  });
});

describe("postMergePlan", () => {
  it("compares ORIG_HEAD against HEAD for an ordinary merge", () => {
    const plan = postMergePlan({ head: NEW_SHA, origHead: OLD_SHA, squashFlag: "0" });
    expect(plan).toEqual({
      act: "compare",
      comparison: { against: "commits", from: OLD_SHA, to: NEW_SHA },
    });
  });

  // MEASURED: after `git merge --squash`, ORIG_HEAD and HEAD are the SAME commit and the result sits in the
  // index, so the commits arm would diff a commit against itself and report every squash merge as clean.
  it("compares the INDEX for a squash merge, where ORIG_HEAD and HEAD are the same commit", () => {
    const plan = postMergePlan({ head: OLD_SHA, origHead: OLD_SHA, squashFlag: "1" });
    expect(plan).toEqual({ act: "compare", comparison: { against: "index", from: OLD_SHA } });
  });

  it("skips when ORIG_HEAD is unreadable", () => {
    const plan = postMergePlan({ head: NEW_SHA, origHead: undefined, squashFlag: "0" });
    expect(plan).toEqual({
      act: "skip",
      why: "ORIG_HEAD is unreadable, so what the merge brought in cannot be diffed",
    });
  });

  it("skips when HEAD is unreadable and the merge was not a squash", () => {
    const plan = postMergePlan({ head: undefined, origHead: OLD_SHA, squashFlag: "0" });
    expect(plan).toEqual({
      act: "skip",
      why: "HEAD is unreadable, so what the merge brought in cannot be diffed",
    });
  });
});

describe("refMoveInstallDecision", () => {
  it("does not install when the move changed no dependency file, and says how many it did change", () => {
    const decision = refMoveInstallDecision({ changedPaths: ["src/foo.ts", "docs/bar.md"] });
    expect(decision.install).toBe(false);
    expect(decision.why).toBe("the move changed 2 file(s), none of them dependency-defining");
  });

  it("does not install when the move changed nothing at all", () => {
    const decision = refMoveInstallDecision({ changedPaths: [] });
    expect(decision.install).toBe(false);
    expect(decision.why).toBe("the move changed 0 file(s), none of them dependency-defining");
  });

  it("installs when the lockfile moved, naming it", () => {
    const decision = refMoveInstallDecision({ changedPaths: ["src/foo.ts", "yarn.lock"] });
    expect(decision.install).toBe(true);
    expect(decision.why).toBe("the move changed yarn.lock");
  });

  it("installs when only a yarn patch moved — the case a filename-only predicate loses", () => {
    const decision = refMoveInstallDecision({ changedPaths: [".yarn/patches/left-pad-npm-1.0.0.patch"] });
    expect(decision.install).toBe(true);
    expect(decision.why).toBe("the move changed .yarn/patches/left-pad-npm-1.0.0.patch");
  });

  it("installs when a nested workspace manifest moved", () => {
    const decision = refMoveInstallDecision({ changedPaths: ["packages/api/package.json"] });
    expect(decision.install).toBe(true);
    expect(decision.why).toBe("the move changed packages/api/package.json");
  });
});

describe("renderRefMoveOutcome", () => {
  it("distinguishes a move it did not look at from one it looked at and found clean", () => {
    const skipped = renderRefMoveOutcome({
      hook: "post-checkout",
      outcome: { did: "skipped", why: "the ref did not move" },
    });
    const current = renderRefMoveOutcome({
      hook: "post-checkout",
      outcome: { did: "current", why: "the move changed 2 file(s), none of them dependency-defining" },
    });
    expect(skipped).toBe("post-checkout: node_modules not checked — the ref did not move");
    expect(current).toBe(
      "post-checkout: node_modules current — the move changed 2 file(s), none of them dependency-defining",
    );
  });

  it("names the hook, the command and the unshare tally on a successful install", () => {
    const line = renderRefMoveOutcome({
      hook: "post-merge",
      outcome: {
        detail: "exec inodes: 3 native binary(ies) relinked off yarn's shared store, 27 already private",
        did: "installed",
        why: "the move changed yarn.lock",
      },
    });
    expect(line).toBe(
      "post-merge: ran `yarn install --immutable` — the move changed yarn.lock; " +
        "exec inodes: 3 native binary(ies) relinked off yarn's shared store, 27 already private",
    );
  });

  it("shouts on a failed install and carries yarn's own detail", () => {
    const line = renderRefMoveOutcome({
      hook: "post-merge",
      outcome: {
        detail: "YN0028: The lockfile would have been modified by this install",
        did: "failed",
        why: "the move changed yarn.lock",
      },
    });
    expect(line).toBe(
      "post-merge: `yarn install --immutable` FAILED — the move changed yarn.lock; " +
        "YN0028: The lockfile would have been modified by this install",
    );
  });
  it("flattens a multi-line detail, because execFileSync builds its message out of the child's stderr", () => {
    const line = renderRefMoveOutcome({
      hook: "post-merge",
      outcome: {
        detail: "Command failed: yarn install --immutable\nYN0028: lockfile would change\n  at /repo/yarn.lock\n",
        did: "failed",
        why: "the move changed yarn.lock",
      },
    });
    expect(line).toBe(
      "post-merge: `yarn install --immutable` FAILED — the move changed yarn.lock; " +
        "Command failed: yarn install --immutable · YN0028: lockfile would change · at /repo/yarn.lock",
    );
    expect(line.split("\n")).toHaveLength(1);
  });

  it("flattens a line break in the reason too, so no arm can split the line", () => {
    const line = renderRefMoveOutcome({
      hook: "post-checkout",
      outcome: { did: "skipped", why: "git could not diff the move\nfatal: bad object" },
    });
    expect(line).toBe("post-checkout: node_modules not checked — git could not diff the move · fatal: bad object");
    expect(line.split("\n")).toHaveLength(1);
  });
});
