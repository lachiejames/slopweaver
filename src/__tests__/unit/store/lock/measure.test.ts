/**
 * `store verify`'s read-only measurement of the lock, over the fake cluster in `./lockWorld.ts`: every check held
 * on a locked stack, every open door on one never locked, and a selection the lock does not recognise judged by
 * whether it reaches this stack's server anyway.
 */
import { describe, expect, it } from "vitest";

import { err, unwrap, unwrapErr } from "#lib/result.js";

import { StoreLockErrors } from "../../../../store/lock/errors.js";
import type { LoginAttempt } from "../../../../store/lock/macLogin.js";
import {
  ENVIRONMENT_REACHES_STACK,
  measureLock,
  SECRET_REACHES_STACK_ELSEWHERE,
} from "../../../../store/lock/measure.js";
import { depsOver, lock, STACK, world } from "./lockWorld.js";

describe("measureLock", () => {
  const CLOSED = {
    open: false,
    refusal: "slopweaver store verify blocked because the local-store-elsewhere refusal",
  } as const;
  const OPEN = { open: true } as const;
  const otherServer: LoginAttempt = {
    currentUser: "postgres",
    kind: "accepted",
    postmasterStart: "2026-01-01 00:00:00+00",
    sessionUser: "postgres",
  };

  it("holds every check on a locked stack", async () => {
    const state = world();
    unwrap(await lock({ state }));
    const measured = unwrap(
      await measureLock({
        localElsewhere: CLOSED,
        deps: depsOver(state),
        selection: { origin: "secret", url: state.storeUrl! },
        stack: STACK,
      }),
    );
    expect(measured.findings).toEqual([]);
    expect(measured.held).toEqual([
      "the store URL logs in as slopweaver_login on this stack",
      "pg_hba.conf admits only slopweaver_login from the Mac",
      "postgres:postgres is refused at 127.0.0.1",
      "postgres:postgres is refused at [::1]",
      "the API roles hold no right on the store's tables",
    ]);
  });

  it("reports every open door on a stack that was never locked", async () => {
    const measured = unwrap(
      await measureLock({ localElsewhere: CLOSED, deps: depsOver(world()), selection: null, stack: STACK }),
    );
    expect(measured.held).toEqual([]);
    expect(measured.findings).toEqual([
      "the store URL is not the lock's login: logged in as postgres, running as postgres, not slopweaver_login running as postgres",
      "the first loaded rule for 172.18.0.1 (line 2) admits all by scram-sha-256, not only slopweaver_login by scram-sha-256",
      "no loaded rule refuses every other role from 172.18.0.1 directly after the login's rule",
      "postgres:postgres is NOT refused by the rule at 127.0.0.1",
      "postgres:postgres is NOT refused by the rule at [::1]",
      "1 session(s) from the Mac are open as a role other than slopweaver_login",
      "the API roles hold 1 table right(s) on 1 store table(s): TRUNCATE to anon",
      "new tables in public would grant the API roles: postgres TRUNCATE anon",
    ]);
  });

  it("reports an exported URL naming this stack's own address", async () => {
    const measured = unwrap(
      await measureLock({
        localElsewhere: CLOSED,
        deps: depsOver(world()),
        selection: { origin: "environment", url: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" },
        stack: STACK,
      }),
    );
    expect(measured).toEqual({ findings: [ENVIRONMENT_REACHES_STACK], held: [] });
  });

  it("reports an exported URL that reaches this stack through a forward on another port", async () => {
    const measured = unwrap(
      await measureLock({
        localElsewhere: CLOSED,
        deps: depsOver(world()),
        selection: { origin: "environment", url: "postgresql://postgres:postgres@127.0.0.1:55444/postgres" },
        stack: STACK,
      }),
    );
    expect(measured).toEqual({ findings: [ENVIRONMENT_REACHES_STACK], held: [] });
  });

  it("reports a stored URL that reaches this stack through a hostname alias", async () => {
    const measured = unwrap(
      await measureLock({
        localElsewhere: CLOSED,
        deps: depsOver(world()),
        selection: { origin: "secret", url: "postgresql://postgres:postgres@store.acme.test:55322/postgres" },
        stack: STACK,
      }),
    );
    expect(measured).toEqual({ findings: [SECRET_REACHES_STACK_ELSEWHERE], held: [] });
  });

  it("reports an exported URL that logs in but whose server will not say when it started", async () => {
    const unidentified: LoginAttempt = { kind: "unidentified", why: "permission denied for function" };
    const measured = unwrap(
      await measureLock({
        localElsewhere: CLOSED,
        deps: { ...depsOver(world()), tryLogin: async () => unidentified },
        selection: { origin: "environment", url: "postgresql://acme@127.0.0.1:55444/postgres" },
        stack: STACK,
      }),
    );
    expect(measured.held).toEqual([]);
    expect(measured.findings).toEqual([
      "SLOPWEAVER_STORE_URL logs in, but whether it reaches this checkout's own stack around the lock's login cannot be told: its server would not say when it started (permission denied for function)",
    ]);
  });

  it("reports an exported URL on this Mac that logs in while Docker cannot be asked for the stack's start", async () => {
    const dockerDown = err(StoreLockErrors.stepFailed({ detail: "cannot connect", step: "reading the start" }));
    const measured = unwrap(
      await measureLock({
        localElsewhere: CLOSED,
        deps: { ...depsOver(world()), postmasterStartOverSocket: () => dockerDown },
        selection: { origin: "environment", url: "postgresql://postgres:postgres@127.0.0.1:55444/postgres" },
        stack: STACK,
      }),
    );
    expect(measured).toEqual({
      findings: [
        "SLOPWEAVER_STORE_URL logs in, but whether it reaches this checkout's own stack around the lock's login cannot be told: it logs in on this Mac and Docker could not be asked for this stack's start time (reading the start failed: cannot connect)",
      ],
      held: [],
    });
  });

  it("leaves an exported URL on another host unmeasured while Docker cannot be asked", async () => {
    const dockerDown = err(StoreLockErrors.stepFailed({ detail: "cannot connect", step: "reading the start" }));
    const measured = await measureLock({
      localElsewhere: CLOSED,
      deps: { ...depsOver(world()), hostIsLocal: async () => false, postmasterStartOverSocket: () => dockerDown },
      selection: { origin: "environment", url: "postgresql://acme@db.acme.example:5432/acme" },
      stack: STACK,
    });
    expect(unwrapErr(measured).code).toBe("NOT_LOCAL_STACK");
  });

  it("leaves an exported URL whose server refuses the login unmeasured", async () => {
    const refused: LoginAttempt = { byRule: false, kind: "refused", why: "password authentication failed" };
    const measured = await measureLock({
      localElsewhere: CLOSED,
      deps: { ...depsOver(world()), tryLogin: async () => refused },
      selection: { origin: "environment", url: "postgresql://acme@127.0.0.1:55444/postgres" },
      stack: STACK,
    });
    expect(unwrapErr(measured).code).toBe("NOT_LOCAL_STACK");
  });

  it("leaves an exported URL that reaches a server on another host unmeasured", async () => {
    const measured = await measureLock({
      localElsewhere: CLOSED,
      deps: { ...depsOver(world()), hostIsLocal: async () => false, tryLogin: async () => otherServer },
      selection: { origin: "environment", url: "postgresql://acme@db.acme.example:5432/acme" },
      stack: STACK,
    });
    expect(unwrapErr(measured).code).toBe("NOT_LOCAL_STACK");
  });

  it("fails closed on a URL that logs in on this Mac whose server only claims to be another", async () => {
    const measured = unwrap(
      await measureLock({
        deps: { ...depsOver(world()), tryLogin: async () => otherServer },
        localElsewhere: CLOSED,
        selection: { origin: "environment", url: "postgresql://postgres:postgres@127.0.0.1:55444/postgres" },
        stack: STACK,
      }),
    );
    expect(measured).toEqual({ findings: [CLOSED.refusal], held: [] });
  });

  it("with the local-store-elsewhere hatch open, leaves that same URL unmeasured", async () => {
    const measured = await measureLock({
      deps: { ...depsOver(world()), tryLogin: async () => otherServer },
      localElsewhere: OPEN,
      selection: { origin: "environment", url: "postgresql://postgres:postgres@127.0.0.1:55444/postgres" },
      stack: STACK,
    });
    expect(unwrapErr(measured).code).toBe("NOT_LOCAL_STACK");
  });
});
