/**
 * Settling the password one lock run ends with, read straight off `settlePassword` over the fake cluster in
 * `./lockWorld.ts` — what it plans, whether it backs up first, and what it says about the parked copy.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { lockStart } from "../../../../store/lock/localStack.js";
import { settlePassword } from "../../../../store/lock/settle.js";
import { depsOver, HOME, lock, STACK, START, type World, world } from "./lockWorld.js";

/**
 * Settle over a world, the way the lock would after taking the stack lock.
 *
 * @param state the world
 * @param rotate whether `--rotate` was passed
 * @returns the settled password, or the refusal
 */
const settle = async ({ state, rotate = false }: { state: World; rotate?: boolean }) => {
  const selection = state.storeUrl === null ? null : ({ origin: "secret", url: state.storeUrl } as const);
  return settlePassword({
    deps: depsOver(state),
    request: { home: HOME, rotate, selection, stack: STACK },
    socketStart: START,
    start: unwrap(lockStart({ selection, stack: STACK })),
  });
};

describe("settlePassword", () => {
  it("on a fresh stack backs up, then creates the role on a minted password it parks first", async () => {
    const state = world();
    const settled = unwrap(await settle({ state }));
    expect(settled.plan).toEqual({ kind: "create" });
    expect(settled.backup).toEqual({ database: "postgres", kind: "empty" });
    expect(settled.superseded).toBe(false);
    expect(settled.keepParked).toBe(false);
    expect(state.pending).toBe(settled.password);
    expect(state.rolePassword).toBe(settled.password);
  });

  it("keeps the selection's own password on a locked stack, taking no backup", async () => {
    const state = world();
    unwrap(await lock({ state }));
    const settled = unwrap(await settle({ state }));
    expect(settled.plan).toEqual({ kind: "keep" });
    expect(settled.backup).toBe(null);
    expect(settled.password).toBe(state.rolePassword);
    expect(settled.superseded).toBe(false);
  });

  it("keeping a password that is also the parked one reads as superseded, so store-url is written again", async () => {
    const state = world();
    unwrap(await lock({ state }));
    state.pending = state.rolePassword;
    const settled = unwrap(await settle({ state }));
    expect(settled.plan).toEqual({ kind: "keep" });
    expect(settled.superseded).toBe(true);
    expect(settled.keepParked).toBe(false);
  });

  it("behind a trust rule refuses short of --rotate and leaves the role alone", async () => {
    const stale = "postgresql://slopweaver_login:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB@127.0.0.1:55322/postgres";
    const state = world({
      roleExists: true,
      roleMarked: true,
      rolePassword: "actual",
      storeUrl: stale,
      trusting: true,
    });
    const error = unwrapErr(await settle({ state }));
    expect(error.code).toBe("PROOF_FAILED");
    expect(state.rolePassword).toBe("actual");
    expect(state.roleScripts).toEqual([]);
  });
});
