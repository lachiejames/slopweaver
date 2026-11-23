/**
 * The machine's one delete lease, over a real operation lock under a throwaway root: held, busy only while a live
 * holder has it, released, and unavailable — never busy — when it cannot be taken for any other reason.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { operationLockDir } from "../../../admit/operationLockPath.js";
import {
  claimDeleteLease,
  DELETE_LEASE_ROOT_VAR,
  deleteLeaseRoot,
  withDeleteLease,
} from "../../../worktree/deleteLease.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "delete-lease-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** A sleep that only counts, so a wait costs no wall time. */
const counting = (): { sleep: (input: { ms: number }) => void; slept: number[] } => {
  const slept: number[] = [];
  return {
    sleep: ({ ms }) => {
      slept.push(ms);
    },
    slept,
  };
};

describe("deleteLeaseRoot", () => {
  it("is this test lane's sandbox, never the operator's real lease", () => {
    expect(deleteLeaseRoot()).toBe(process.env[DELETE_LEASE_ROOT_VAR]);
    expect(deleteLeaseRoot().startsWith("/tmp/slopweaver-delete-lease-")).toBe(false);
  });
});

describe("claimDeleteLease", () => {
  it("is busy while held, and free again once released", () => {
    const first = claimDeleteLease({ root: dir });
    expect(first.kind).toBe("held");
    expect(claimDeleteLease({ root: dir }).kind).toBe("busy");

    (first as { release: () => void }).release();
    const again = claimDeleteLease({ root: dir });
    expect(again.kind).toBe("held");
    (again as { release: () => void }).release();
  });

  it("is unavailable, never busy, when its root cannot be created", () => {
    const file = join(dir, "a-file");
    writeFileSync(file, "");

    expect(claimDeleteLease({ root: join(file, "lease") }).kind).toBe("unavailable");
  });

  it("stays busy for a live holder past the default fifteen-minute stale age, never handing its lease over", () => {
    const held = claimDeleteLease({ root: dir });
    const locks = operationLockDir({ home: dir });
    const [lock] = readdirSync(locks);
    const [token] = readdirSync(join(locks, lock!));
    const record = join(locks, lock!, token!);
    const contents = JSON.parse(readFileSync(record, "utf8")) as Record<string, unknown>;
    writeFileSync(record, JSON.stringify({ ...contents, acquiredAtIso: "2026-01-01T00:00:00.000Z" }));

    expect(claimDeleteLease({ root: dir }).kind).toBe("busy");
    (held as { release: () => void }).release();
  });

  it("is unavailable, never busy, when the lock it finds is corrupt rather than held", () => {
    const held = claimDeleteLease({ root: dir });
    const locks = operationLockDir({ home: dir });
    const [lock] = readdirSync(locks);
    const [token] = readdirSync(join(locks, lock!));
    writeFileSync(join(locks, lock!, token!), "not a lock record");

    const corrupt = claimDeleteLease({ root: dir });
    expect(corrupt).toEqual({
      kind: "unavailable",
      why: `a lock already exists at ${join(locks, lock!)} and could not be read to check its age`,
    });
    (held as { release: () => void }).release();
  });
});

describe("withDeleteLease", () => {
  it("runs the delete holding the lease, and releases it after", () => {
    const { sleep } = counting();
    let busyInside = "";

    const ran = withDeleteLease({
      act: () => {
        busyInside = claimDeleteLease({ root: dir }).kind;
        return "removed";
      },
      root: dir,
      sleep,
      waitMs: 0,
    });
    expect(ran).toEqual({ kind: "ran", value: "removed" });
    expect(busyInside).toBe("busy");
    const after = claimDeleteLease({ root: dir });
    expect(after.kind).toBe("held");
    (after as { release: () => void }).release();
  });

  it("gives up as busy after waiting, never running the delete, while another holder keeps the lease", () => {
    const held = claimDeleteLease({ root: dir });
    const { sleep, slept } = counting();
    let ran = false;

    const outcome = withDeleteLease({
      act: () => {
        ran = true;
      },
      root: dir,
      sleep,
      waitMs: 500,
    });
    expect(outcome).toEqual({ kind: "busy" });
    expect(ran).toBe(false);
    expect(slept).toEqual([250, 250]);
    (held as { release: () => void }).release();
  });

  it("never runs an unbounded delete without the lease, answering unavailable at once rather than waiting", () => {
    const file = join(dir, "a-file");
    writeFileSync(file, "");
    const { sleep, slept } = counting();
    let ran = false;

    const outcome = withDeleteLease({
      act: () => {
        ran = true;
      },
      root: join(file, "lease"),
      sleep,
      waitMs: 500,
    });
    expect(outcome.kind).toBe("unavailable");
    expect(ran).toBe(false);
    expect(slept).toEqual([]);
  });
});
