import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEPS_MODE,
  type DepsFacts,
  depsAreTrustworthy,
  depsStatus,
  renderDepsStatus,
  sharedDepsRefusal,
} from "../../../worktree/deps.js";

/** A worktree with its own tree, installed after both manifests were written. */
const OWN: DepsFacts = {
  installStateMs: 3_000,
  verifiedAtMs: undefined,
  linkTarget: undefined,
  lockfileMs: 2_000,
  lockfileText: "lock-a",
  manifestMs: 1_000,
  present: true,
  sharedLockfileText: "lock-a",
};

describe("depsStatus", () => {
  it("reads a real directory installed after its manifests as an own, current tree", () => {
    const status = depsStatus({ facts: OWN });

    expect(status.link).toBe("own");
    expect(status.freshness).toBe("current");
    expect(status.lockfile).toBe("match");
    expect(status.linkTarget).toBe(undefined);
  });

  it("reads a symlink as shared, and keeps the target it points at", () => {
    const status = depsStatus({ facts: { ...OWN, linkTarget: "/shared/node_modules" } });

    expect(status.link).toBe("shared");
    expect(status.linkTarget).toBe("/shared/node_modules");
  });

  it("reads nothing at node_modules as absent", () => {
    const status = depsStatus({ facts: { ...OWN, installStateMs: undefined, present: false } });

    expect(status.link).toBe("absent");
    expect(status.freshness).toBe("never-installed");
  });

  it("reads an install older than the lockfile as stale", () => {
    const status = depsStatus({ facts: { ...OWN, installStateMs: 1_500 } });

    expect(status.freshness).toBe("stale");
  });

  it("calls the lockfiles different when their bytes differ", () => {
    const status = depsStatus({ facts: { ...OWN, sharedLockfileText: "lock-b" } });

    expect(status.lockfile).toBe("differs");
  });

  it("calls the comparison unknown when either lockfile could not be read", () => {
    const missingShared = depsStatus({ facts: { ...OWN, sharedLockfileText: undefined } });
    const missingOwn = depsStatus({ facts: { ...OWN, lockfileText: undefined } });

    expect(missingShared.lockfile).toBe("unknown");
    expect(missingOwn.lockfile).toBe("unknown");
  });
});

describe("sharedDepsRefusal", () => {
  it("allows sharing only when the two lockfiles are byte-identical", () => {
    expect(sharedDepsRefusal({ status: depsStatus({ facts: OWN }) })).toBe(undefined);
  });

  it("refuses a lockfile that differs, naming which comparison failed", () => {
    const refusal = sharedDepsRefusal({ status: depsStatus({ facts: { ...OWN, sharedLockfileText: "lock-b" } }) });

    expect(refusal).toBe("this worktree's yarn.lock differs from the shared tree's");
  });

  it("refuses a comparison it could not make, rather than treating it as a pass", () => {
    const refusal = sharedDepsRefusal({
      status: depsStatus({ facts: { ...OWN, sharedLockfileText: undefined } }),
    });

    expect(refusal).toBe("this worktree's yarn.lock could not be compared with the shared tree's");
  });
});

describe("depsAreTrustworthy", () => {
  it("trusts an own, current tree", () => {
    expect(depsAreTrustworthy({ status: depsStatus({ facts: OWN }) })).toBe(true);
  });

  it("never trusts a shared tree, however well its lockfile matches", () => {
    const status = depsStatus({ facts: { ...OWN, linkTarget: "/shared/node_modules" } });

    expect(status.lockfile).toBe("match");
    expect(depsAreTrustworthy({ status })).toBe(false);
  });

  it("does not trust an own tree older than its lockfile", () => {
    expect(depsAreTrustworthy({ status: depsStatus({ facts: { ...OWN, installStateMs: 1_500 } }) })).toBe(false);
  });
});

describe("renderDepsStatus", () => {
  it("names the shared target and the lockfile verdict for a symlinked tree", () => {
    const line = renderDepsStatus({
      status: depsStatus({ facts: { ...OWN, linkTarget: "/shared/node_modules", sharedLockfileText: "lock-b" } }),
    });

    expect(line).toContain("/shared/node_modules");
    expect(line).toContain("lockfile differs");
  });

  it("names the freshness for an own tree", () => {
    expect(renderDepsStatus({ status: depsStatus({ facts: OWN }) })).toContain("own tree, current");
  });

  it("tells a caller with nothing installed what to run", () => {
    const line = renderDepsStatus({
      status: depsStatus({ facts: { ...OWN, installStateMs: undefined, present: false } }),
    });

    expect(line).toContain("slopweaver worktree create");
  });
});

describe("the default mode", () => {
  it("is the owner's v1 rule — a worktree's own tree, never a shared one", () => {
    expect(DEFAULT_DEPS_MODE).toBe("own");
  });
});
