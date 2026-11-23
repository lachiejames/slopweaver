/**
 * The pull-then-install decision: when a sync must refuse, and when the install has to follow the pull.
 */
import { describe, expect, it } from "vitest";

import type { CheckoutFreshness } from "../../../checkouts/freshness.js";
import { classifyFailedFastForward, installDecision, syncPreflightRefusal } from "../../../checkouts/sync.js";

/** A syncable checkout, overridden per test. */
const checkout = (over: Partial<CheckoutFreshness> = {}): CheckoutFreshness => ({
  branch: "main",
  dirtyEntries: 0,
  drift: { ahead: 0, behind: 2 },
  fetchedAtMs: 0,
  install: "current",
  path: "/repo",
  problems: [],
  rebaseOnto: undefined,
  upstream: "origin/main",
  ...over,
});

describe("syncPreflightRefusal", () => {
  it("permits a clean checkout tracking an upstream", () => {
    expect(syncPreflightRefusal({ freshness: checkout() })).toBeUndefined();
  });

  it("refuses a checkout whose measurement recorded a problem", () => {
    expect(syncPreflightRefusal({ freshness: checkout({ problems: ["not a git checkout"] }) })).toBe(
      "/repo: not a git checkout",
    );
  });

  it("refuses a detached HEAD", () => {
    expect(syncPreflightRefusal({ freshness: checkout({ branch: undefined }) })).toBe(
      "/repo: detached HEAD — nothing to fast-forward",
    );
  });

  it("refuses a branch tracking nothing", () => {
    expect(syncPreflightRefusal({ freshness: checkout({ upstream: undefined }) })).toBe(
      "/repo: main tracks no upstream, so there is nothing to be current WITH",
    );
  });

  it("refuses a dirty main checkout", () => {
    expect(syncPreflightRefusal({ freshness: checkout({ dirtyEntries: 2 }) })).toBe(
      "/repo: 2 uncommitted change(s) — a main checkout must be clean before it is fast-forwarded",
    );
  });

  it("permits a checkout whose dirtiness could not be measured, since nothing was proven wrong", () => {
    expect(syncPreflightRefusal({ freshness: checkout({ dirtyEntries: undefined }) })).toBeUndefined();
  });
});

describe("installDecision", () => {
  it("installs when the pull changed the lockfile, naming it", () => {
    expect(installDecision({ changedPaths: ["src/a.ts", "yarn.lock"], installBefore: "current" })).toEqual({
      install: true,
      why: "the pull changed yarn.lock",
    });
  });

  it("names every dependency file the pull changed", () => {
    expect(installDecision({ changedPaths: ["package.json", "yarn.lock"], installBefore: "current" }).why).toBe(
      "the pull changed package.json, yarn.lock",
    );
  });

  it("installs a tree that was ALREADY stale, even when the pull touched no dependency file", () => {
    expect(installDecision({ changedPaths: ["src/a.ts"], installBefore: "stale" })).toEqual({
      install: true,
      why: "node_modules was already stale before this pull",
    });
  });

  it("installs a tree that was never installed at all", () => {
    expect(installDecision({ changedPaths: [], installBefore: "never-installed" }).install).toBe(true);
  });

  it("installs a tree whose state could not be measured, rather than assuming it is fine", () => {
    expect(installDecision({ changedPaths: [], installBefore: "unmeasurable" }).install).toBe(true);
  });

  it("skips the install when nothing changed and the tree already matched, and says so", () => {
    expect(installDecision({ changedPaths: ["src/a.ts"], installBefore: "current" })).toEqual({
      install: false,
      why: "the pull touched no dependency file and node_modules already matched the lockfile",
    });
  });

  it("skips the install for a pull that changed nothing at all", () => {
    expect(installDecision({ changedPaths: [], installBefore: "current" }).install).toBe(false);
  });
});

describe("classifyFailedFastForward", () => {
  it("cannot classify a re-measurement it could not read", () => {
    expect(classifyFailedFastForward({ drift: undefined })).toBe("unmeasurable");
  });

  it("reads a level branch as already holding its upstream — the observed false 'diverged'", () => {
    expect(classifyFailedFastForward({ drift: { ahead: 0, behind: 0 } })).toBe("upstream-contained");
  });

  it("never calls an ahead-only branch diverged: it has nothing left to pull", () => {
    expect(classifyFailedFastForward({ drift: { ahead: 2, behind: 0 } })).toBe("upstream-contained");
  });

  it("calls a branch diverged only when it is both ahead and behind", () => {
    expect(classifyFailedFastForward({ drift: { ahead: 1, behind: 2 } })).toBe("diverged");
  });

  it("calls a still-clean fast-forward retryable", () => {
    expect(classifyFailedFastForward({ drift: { ahead: 0, behind: 2 } })).toBe("retryable");
  });
});
