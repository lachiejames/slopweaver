import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { installFromRecycled, recycledLines } from "../../../worktree/provisionRecycle.js";
import type { RecycleClaim } from "../../../worktree/recyclePool.js";

const CLAIMED: RecycleClaim = { from: "/pool/0/old-seat-1", kind: "claimed" };
const EMPTY: RecycleClaim = { detail: "the recycle pool is empty", kind: "skipped", reason: "pool-empty" };

/** An install that answers each call's scripted outcome in turn, recording every step taken. */
const scripted = ({
  claim,
  installs,
  discard,
  mark,
}: {
  claim: RecycleClaim;
  installs: readonly (string | undefined)[];
  discard: string | undefined;
  mark?: string;
}): { calls: string[]; run: () => ReturnType<typeof installFromRecycled> } => {
  const calls: string[] = [];
  let next = 0;
  const run = (): ReturnType<typeof installFromRecycled> =>
    installFromRecycled({
      claim: () => {
        calls.push("claim");
        return claim;
      },
      discard: () => {
        calls.push("discard");
        return discard;
      },
      install: () => {
        calls.push("install");
        const outcome = installs[next];
        next += 1;
        return outcome;
      },
      mark: () => {
        calls.push("mark");
        return mark;
      },
    });
  return { calls, run };
};

describe("installFromRecycled", () => {
  it("installs once over a claimed tree and reports the claim", () => {
    const { calls, run } = scripted({ claim: CLAIMED, discard: undefined, installs: [undefined] });
    expect(unwrap(run())).toEqual(CLAIMED);
    expect(calls).toEqual(["claim", "install", "mark"]);
  });

  it("fails INSTALL_FAILED when the install succeeded but its mark could not be written", () => {
    const { calls, run } = scripted({ claim: CLAIMED, discard: undefined, installs: [undefined], mark: "EROFS" });
    const error = unwrapErr(run());
    expect(error.code).toBe("INSTALL_FAILED");
    expect(error.message).toContain("verified-install mark could not be written: EROFS");
    expect(calls).toEqual(["claim", "install", "mark"]);
  });

  it("reports an empty-pool install failure as INSTALL_FAILED without discarding anything", () => {
    const { calls, run } = scripted({ claim: EMPTY, discard: undefined, installs: ["lockfile broke"] });
    const error = unwrapErr(run());
    expect(error.code).toBe("INSTALL_FAILED");
    expect(error.message).toContain("lockfile broke");
    expect(calls).toEqual(["claim", "install"]);
  });

  it("discards a claimed tree an install failed over and reinstalls from empty", () => {
    const { calls, run } = scripted({ claim: CLAIMED, discard: undefined, installs: ["bad tree", undefined] });
    expect(unwrap(run())).toEqual({ from: "/pool/0/old-seat-1", kind: "fresh-after-discard" });
    expect(calls).toEqual(["claim", "install", "discard", "install", "mark"]);
  });

  it("never reinstalls over a claimed tree that could not be discarded", () => {
    const { calls, run } = scripted({ claim: CLAIMED, discard: "EACCES", installs: ["bad tree"] });
    const error = unwrapErr(run());
    expect(error.code).toBe("RECYCLE_FAILED");
    expect(error.message).toContain("could not be moved aside for a clean install (EACCES)");
    expect(calls).toEqual(["claim", "install", "discard"]);
  });

  it("reports the retry's failure with the first one beside it", () => {
    const { run } = scripted({ claim: CLAIMED, discard: undefined, installs: ["bad tree", "lockfile broke"] });
    const error = unwrapErr(run());
    expect(error.code).toBe("INSTALL_FAILED");
    expect(error.message).toContain("lockfile broke\n(and first over the recycled tree /pool/0/old-seat-1: bad tree)");
  });
});

describe("recycledLines", () => {
  it("prints nothing when this worktree's own tree was not installed", () => {
    expect(recycledLines({ recycled: undefined })).toEqual([]);
  });

  it("names the tree a claim started from", () => {
    expect(recycledLines({ recycled: CLAIMED })).toEqual([
      "  recycled: started from /pool/0/old-seat-1, reconciled by yarn",
    ]);
  });

  it("says a failed install over a claimed tree was rerun empty", () => {
    expect(recycledLines({ recycled: { from: "/pool/0/old-seat-1", kind: "fresh-after-discard" } })).toEqual([
      "  recycled: the install over /pool/0/old-seat-1 failed, so it was discarded and the install rerun empty",
    ]);
  });

  it("names why nothing was claimed", () => {
    expect(recycledLines({ recycled: EMPTY })).toEqual([
      "  recycled: none (pool-empty), installed from empty — the recycle pool is empty",
    ]);
  });
});
