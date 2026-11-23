/**
 * Closing the other doors once the login is written, read straight off `closeDoors` over the fake cluster in
 * `./lockWorld.ts`: the rule installed and reloaded, the default door proven refused, strays ended, rights revoked.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { closeDoors } from "../../../../store/lock/doors.js";
import { depsOver, STACK, world } from "./lockWorld.js";

const DOORS = { database: "postgres", gateway: "172.18.0.1", port: STACK.dbPort, projectId: STACK.projectId };

describe("closeDoors", () => {
  it("on a stack never locked installs the rule, ends the stray session and revokes, with a proof per door", async () => {
    const state = world();
    const closed = unwrap(await closeDoors({ ...DOORS, deps: depsOver(state), superseded: false }));
    expect(closed.hbaRewritten).toBe(true);
    expect(closed.evicted).toBe(1);
    expect(closed.proofs).toEqual([
      "postgres:postgres is refused by the rule at 127.0.0.1",
      "postgres:postgres is refused by the rule at [::1]",
      "the API roles hold no right on the store's tables, now or by default",
    ]);
    expect(state.grants).toEqual([]);
    expect(state.strays).toBe(0);
  });

  it("leaves the login's own sessions open unless its password was superseded", async () => {
    const kept = world({ loginSessions: 2 });
    unwrap(await closeDoors({ ...DOORS, deps: depsOver(kept), superseded: false }));
    expect(kept.loginSessions).toBe(2);
    const replaced = world({ loginSessions: 2 });
    const closed = unwrap(await closeDoors({ ...DOORS, deps: depsOver(replaced), superseded: true }));
    expect(closed.evicted).toBe(3);
    expect(replaced.loginSessions).toBe(0);
  });

  it("refuses when the default door still logs in after the reload, before ending any session", async () => {
    const state = world();
    const deps = {
      ...depsOver(state),
      loginUntilRefused: async () =>
        ({ currentUser: "postgres", kind: "accepted", postmasterStart: "x", sessionUser: "postgres" }) as const,
    };
    const error = unwrapErr(await closeDoors({ ...DOORS, deps, superseded: false }));
    expect(error.message).toBe("the default door at 127.0.0.1: postgres:postgres logged in at 127.0.0.1");
    expect(state.strays).toBe(1);
  });
});
