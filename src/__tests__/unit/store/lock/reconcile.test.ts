/**
 * The lock's order and its convergence, over the fake cluster in `./lockWorld.ts`. Plain fakes passed in as deps —
 * no mocks. The real cluster is proven by the throwaway-stack run.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";

import { StoreLockErrors } from "../../../../store/lock/errors.js";
import { passwordFrom } from "../../../../store/lock/login.js";
import { reconcileLock } from "../../../../store/lock/reconcile.js";
import { depsOver, HOME, lock, SHIPPED, STACK, world } from "./lockWorld.js";

describe("reconcileLock", () => {
  it("on a fresh stack: backs up, creates the login, writes it, closes the door, ends the stray session, revokes", async () => {
    const state = world();
    const report = unwrap(await lock({ state }));
    expect(report.password).toBe("create");
    expect(report.backup).toEqual({ database: "postgres", kind: "empty" });
    expect(state.backups).toBe(1);
    expect(state.roleScripts).toEqual(["create"]);
    expect(state.storeUrl).toBe(`postgresql://slopweaver_login:${state.rolePassword!}@127.0.0.1:55322/postgres`);
    expect(state.pending).toBe(null);
    expect(report.storeUrlWritten).toBe(true);
    expect(report.hbaRewritten).toBe(true);
    expect(report.evicted).toBe(1);
    expect(state.grants).toEqual([]);
    expect(report.proofs).toHaveLength(4);
    expect(state.released).toBe(true);
  });

  it("re-run over its own result changes nothing and takes no backup", async () => {
    const state = world();
    unwrap(await lock({ state }));
    const url = state.storeUrl;
    const report = unwrap(await lock({ state }));
    expect(report.password).toBe("keep");
    expect(report.backup).toBe(null);
    expect(report.storeUrlWritten).toBe(false);
    expect(report.hbaRewritten).toBe(false);
    expect(state.storeUrl).toBe(url);
    expect(state.backups).toBe(1);
  });

  it("a plain re-run leaves the login's own sessions open, and a rotation ends them", async () => {
    const state = world();
    unwrap(await lock({ state }));
    state.loginSessions = 2;
    unwrap(await lock({ state }));
    expect(state.loginSessions).toBe(2);
    const rotated = unwrap(await lock({ rotate: true, state }));
    expect(rotated.password).toBe("rotate");
    expect(rotated.evicted).toBe(2);
    expect(state.loginSessions).toBe(0);
  });

  it("a parked password the store-url already names rewrites store-url before dropping the parked copy", async () => {
    const state = world();
    unwrap(await lock({ state }));
    const writes = state.storeUrlWrites;
    state.pending = state.rolePassword;
    state.loginSessions = 1;
    const report = unwrap(await lock({ state }));
    expect(report.password).toBe("keep");
    expect(report.storeUrlWritten).toBe(true);
    expect(state.storeUrlWrites).toBe(writes + 1);
    expect(state.pending).toBe(null);
    expect(state.loginSessions).toBe(0);
  });

  it("keeps a parked password that does not log in, so a role change that commits late is adopted next run", async () => {
    const state = world();
    unwrap(await lock({ state }));
    const kept = state.rolePassword;
    const orphan = unwrap(passwordFrom({ random: new Uint8Array(32).fill(99) }));
    state.pending = orphan;
    const report = unwrap(await lock({ state }));
    expect(report.password).toBe("keep");
    expect(report.storeUrlWritten).toBe(false);
    expect(state.pending).toBe(orphan);
    expect(state.rolePassword).toBe(kept);
    state.rolePassword = orphan;
    const adopted = unwrap(await lock({ state }));
    expect(adopted.password).toBe("adopt-pending");
    expect(state.storeUrl).toBe(`postgresql://slopweaver_login:${orphan}@127.0.0.1:55322/postgres`);
    expect(state.pending).toBe(null);
  });

  it("after a recreate restores the shipped rules, puts the block back and keeps the password", async () => {
    const state = world();
    unwrap(await lock({ state }));
    state.hba = SHIPPED;
    state.loadedHba = SHIPPED;
    state.strays = 2;
    const report = unwrap(await lock({ state }));
    expect(report.password).toBe("keep");
    expect(report.hbaRewritten).toBe(true);
    expect(report.evicted).toBe(2);
  });

  it("adopts the password an interrupted run parked before it changed the role", async () => {
    const state = world();
    unwrap(await lock({ state }));
    const parked = state.rolePassword;
    state.pending = parked;
    state.storeUrl = null;
    state.hba = SHIPPED;
    state.loadedHba = SHIPPED;
    const report = unwrap(await lock({ state }));
    expect(report.password).toBe("adopt-pending");
    expect(state.roleScripts).toEqual(["create"]);
    expect(state.storeUrl).toBe(`postgresql://slopweaver_login:${parked!}@127.0.0.1:55322/postgres`);
    expect(state.pending).toBe(null);
  });

  it("from a second home refuses to replace the password, writing nothing, and still releases the stack lock", async () => {
    const state = world();
    unwrap(await lock({ state }));
    const first = state.rolePassword;
    state.storeUrl = null;
    state.released = false;
    const error = unwrapErr(await lock({ state }));
    expect(error.code).toBe("PROOF_FAILED");
    expect(error.message).toContain("Pass --rotate");
    expect(state.rolePassword).toBe(first);
    expect(state.storeUrl).toBe(null);
    expect(state.released).toBe(true);
  });

  it("with --rotate gives the second home a new password and no backup", async () => {
    const state = world();
    unwrap(await lock({ state }));
    const first = state.rolePassword;
    state.storeUrl = null;
    const report = unwrap(await lock({ rotate: true, state }));
    expect(report.password).toBe("rotate");
    expect(state.roleScripts).toEqual(["create", "rotate"]);
    expect(state.rolePassword).not.toBe(first);
    expect(state.backups).toBe(1);
  });

  it("with --rotate over a role made by hand, backs up and marks it before changing its password", async () => {
    const state = world({ roleExists: true, rolePassword: "hand-made" });
    const report = unwrap(await lock({ rotate: true, state }));
    expect(report.password).toBe("rotate");
    expect(report.backup).toEqual({ database: "postgres", kind: "empty" });
    expect(state.backups).toBe(1);
    expect(state.roleMarked).toBe(true);
    expect(state.roleScripts).toEqual(["rotate"]);
  });

  it("with --rotate over a role made by hand, a failed backup leaves its password alone", async () => {
    const state = world({ backupFails: true, roleExists: true, rolePassword: "hand-made" });
    const error = unwrapErr(await lock({ rotate: true, state }));
    expect(error.code).toBe("BACKUP_GATE_FAILED");
    expect(state.rolePassword).toBe("hand-made");
    expect(state.pending).toBe(null);
    expect(state.roleMarked).toBe(false);
    expect(state.hba).toBe(SHIPPED);
  });

  it("never adopts or clears a password parked for another stack sharing the home", async () => {
    const otherParked = unwrap(passwordFrom({ random: new Uint8Array(32).fill(9) }));
    const state = world({ otherStacksPending: { "acme-other": otherParked } });
    unwrap(await lock({ state }));
    expect(state.rolePassword).not.toBe(otherParked);
    expect(state.pendingSyncs).toEqual([]);
    expect(state.otherStacksPending).toEqual({ "acme-other": otherParked });
    expect(state.pending).toBe(null);
  });

  it("a rotation reusing a parked password syncs it in place before the role changes, never rewriting it", async () => {
    const state = world();
    unwrap(await lock({ state }));
    const parked = unwrap(passwordFrom({ random: new Uint8Array(32).fill(5) }));
    state.pending = parked;
    let rewrites = 0;
    const report = unwrap(
      await reconcileLock({
        deps: {
          ...depsOver(state),
          writePending: () => {
            rewrites += 1;
            return ok(undefined);
          },
        },
        request: { home: HOME, rotate: true, selection: { origin: "secret", url: state.storeUrl! }, stack: STACK },
      }),
    );
    expect(report.password).toBe("rotate");
    expect(rewrites).toBe(0);
    expect(state.pendingSyncs).toEqual([1]);
    expect(state.roleScripts).toEqual(["create", "rotate"]);
    expect(state.rolePassword).toBe(parked);
  });

  it("a rotation whose parked password cannot be synced leaves the role untouched", async () => {
    const state = world();
    unwrap(await lock({ state }));
    const before = state.rolePassword;
    state.pending = unwrap(passwordFrom({ random: new Uint8Array(32).fill(5) }));
    const failed = await reconcileLock({
      deps: {
        ...depsOver(state),
        syncPending: () =>
          err(StoreLockErrors.secretWriteFailed({ reasons: ["syncing store-lock/pending-login: EIO"] })),
      },
      request: { home: HOME, rotate: true, selection: { origin: "secret", url: state.storeUrl! }, stack: STACK },
    });
    expect(unwrapErr(failed).code).toBe("SECRET_WRITE_FAILED");
    expect(state.roleScripts).toEqual(["create"]);
    expect(state.rolePassword).toBe(before);
  });

  it("re-running --rotate after a rotation interrupted before store-url adopts the parked password, never mints over it", async () => {
    const state = world();
    unwrap(await lock({ state }));
    state.storeUrl = null;
    unwrap(await lock({ rotate: true, state }));
    const rotated = state.rolePassword;
    state.pending = rotated;
    state.storeUrl = null;
    const report = unwrap(await lock({ rotate: true, state }));
    expect(report.password).toBe("adopt-pending");
    expect(state.rolePassword).toBe(rotated);
    expect(state.roleScripts).toEqual(["create", "rotate"]);
    expect(state.storeUrl).toBe(`postgresql://slopweaver_login:${rotated!}@127.0.0.1:55322/postgres`);
  });

  it("behind a trust rule, keeps no stored password that only 'logs in', and changes nothing", async () => {
    const stale = "postgresql://slopweaver_login:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB@127.0.0.1:55322/postgres";
    const state = world({
      roleExists: true,
      roleMarked: true,
      rolePassword: "actual",
      storeUrl: stale,
      trusting: true,
    });
    const error = unwrapErr(await lock({ state }));
    expect(error.code).toBe("PROOF_FAILED");
    expect(error.message).toContain("Pass --rotate");
    expect(state.rolePassword).toBe("actual");
    expect(state.storeUrl).toBe(stale);
    expect(state.hba).toBe(SHIPPED);
  });

  it("behind a trust rule, --rotate sets a password it knows and writes exactly that", async () => {
    const stale = "postgresql://slopweaver_login:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB@127.0.0.1:55322/postgres";
    const state = world({
      roleExists: true,
      roleMarked: true,
      rolePassword: "actual",
      storeUrl: stale,
      trusting: true,
    });
    const report = unwrap(await lock({ rotate: true, state }));
    expect(report.password).toBe("rotate");
    expect(state.storeUrl).toBe(`postgresql://slopweaver_login:${state.rolePassword!}@127.0.0.1:55322/postgres`);
    expect(state.rolePassword).not.toBe("actual");
  });

  it("behind a trust rule, --rotate rotates TO the parked password rather than overwriting it", async () => {
    const parked = unwrap(passwordFrom({ random: new Uint8Array(32).fill(3) }));
    const stale = "postgresql://slopweaver_login:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB@127.0.0.1:55322/postgres";
    const state = world({
      pending: parked,
      roleExists: true,
      roleMarked: true,
      rolePassword: parked,
      storeUrl: stale,
      trusting: true,
    });
    const report = unwrap(await lock({ rotate: true, state }));
    expect(report.password).toBe("rotate");
    expect(state.rolePassword).toBe(parked);
    expect(state.storeUrl).toBe(`postgresql://slopweaver_login:${parked}@127.0.0.1:55322/postgres`);
  });

  it("stops before touching the role when the backup gate fails", async () => {
    const state = world({ backupFails: true });
    const error = unwrapErr(await lock({ state }));
    expect(error.code).toBe("BACKUP_GATE_FAILED");
    expect(state.roleExists).toBe(false);
    expect(state.pending).toBe(null);
    expect(state.hba).toBe(SHIPPED);
  });

  it("refuses a container publishing another port, before taking the stack lock", async () => {
    const state = world({ publications: [{ hostIp: "127.0.0.1", port: 5432 }] });
    const error = unwrapErr(
      await reconcileLock({
        deps: depsOver(state),
        request: { home: HOME, rotate: false, selection: null, stack: STACK },
      }),
    );
    expect(error.code).toBe("NOT_LOCAL_STACK");
    expect(error.message).toContain("publishes 5432, the config names 55322");
    expect(state.held).toBe(0);
  });

  it("refuses Docker Desktop's default binding before the gateway read, the stack lock or any write", async () => {
    const state = world({
      publications: [
        { hostIp: "0.0.0.0", port: STACK.dbPort },
        { hostIp: "::", port: STACK.dbPort },
      ],
    });
    const error = unwrapErr(await lock({ state }));

    expect(error).toEqual(StoreLockErrors.portExposed({ exposures: ["every interface"] }));
    expect(error.message).toContain('Port binding behavior "Localhost only"');
    expect(error.message).not.toContain("0.0.0.0");
    expect(state.gatewayReads).toBe(0);
    expect(state.held).toBe(0);
    expect(state.backups).toBe(0);
    expect(state.roleScripts).toEqual([]);
    expect(state.pending).toBe(null);
    expect(state.storeUrlWrites).toBe(0);
    expect(state.hba).toBe(SHIPPED);
    expect(state.loadedHba).toBe(SHIPPED);
  });

  it("refuses one loopback and one LAN publication, naming only the LAN one's kind", async () => {
    const state = world({
      publications: [
        { hostIp: "127.0.0.1", port: STACK.dbPort },
        { hostIp: "192.0.2.10", port: STACK.dbPort },
      ],
    });
    const error = unwrapErr(await lock({ state }));

    expect(error).toEqual(StoreLockErrors.portExposed({ exposures: ["a non-loopback address"] }));
    expect(error.message).not.toContain("192.0.2.10");
    expect(state.held).toBe(0);
  });

  it("locks a stack published on loopback in both families", async () => {
    const state = world();
    const report = unwrap(await lock({ state }));

    expect(report.hbaRewritten).toBe(true);
    expect(state.held).toBe(1);
    expect(state.gatewayReads).toBe(1);
  });
});
