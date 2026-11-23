/**
 * {@link withReseatLock}: one live reseat per workspace. The lock is an in-memory fake (`memoryReseatLock`), so this
 * proves the wrapper's contract — refuse before the body on contention or a refusal, release exactly once however the
 * body ends, and take no lock on a dry run — without touching the operation lock's directory.
 */
import { describe, expect, it } from "vitest";

import { OperationLockAcquireErrors } from "../../../../../admit/operationLockHeld.js";
import { reseatLockKey, withReseatLock } from "../../../../../cli/commands/cmux/reseatOperation.js";
import { err, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { ReseatErrors } from "../../../../../sessions/reseatErrors.js";
import { memoryReseatLock, workspace } from "../fleet/fleetKit.js";

const SEAT = workspace({ id: "ws-seat" });

describe("reseatLockKey", () => {
  it("keys on the workspace's cmux id, which a renumbered ref does not change", () => {
    expect(reseatLockKey({ workspaceId: "8f1c-uuid" })).toBe("cmux-reseat:8f1c-uuid");
  });
});

describe("withReseatLock", () => {
  it("runs the body between the take and the release, returning its value", async () => {
    const journal: string[] = [];
    const deps = { acquireReseatLock: memoryReseatLock({ journal }), dryRun: false };

    const held = await withReseatLock({
      body: () => {
        journal.push("body");
        return Promise.resolve("reseated");
      },
      deps,
      workspace: SEAT,
    });

    expect(unwrap(held)).toBe("reseated");
    expect(journal).toEqual(["lock ws-seat", "body", "release ws-seat"]);
  });

  it("refuses RESEAT_CONTENDED naming the holder, the body never run", async () => {
    const journal: string[] = [];
    const deps = { acquireReseatLock: memoryReseatLock({ heldBy: new Set(["ws-seat"]), journal }), dryRun: false };

    const held = await withReseatLock({
      body: () => {
        journal.push("body");
        return Promise.resolve("reseated");
      },
      deps,
      workspace: SEAT,
    });

    expect(unwrapErr(held)).toEqual(
      ReseatErrors.contended({
        holder: "held by pid 4242 since 2026-10-30T00:00:00.000Z",
        workspaceRef: "workspace:ws-seat",
      }),
    );
    expect(journal).toEqual(["lock-contended ws-seat"]);
  });

  it("refuses RESEAT_LOCK_FAILED on a lock no rerun is known to clear, the body never run", async () => {
    const journal: string[] = [];
    const deps = {
      acquireReseatLock: () => err(OperationLockAcquireErrors.refused({ message: "staging failed: EACCES" })),
      dryRun: false,
    };

    const held = await withReseatLock({
      body: () => {
        journal.push("body");
        return Promise.resolve("reseated");
      },
      deps,
      workspace: SEAT,
    });

    expect(unwrapErr(held)).toEqual(
      ReseatErrors.lockFailed({ cause: "staging failed: EACCES", workspaceRef: "workspace:ws-seat" }),
    );
    expect(journal).toEqual([]);
  });

  it("releases once when the body throws, so a crashed relaunch never wedges the tab", async () => {
    const journal: string[] = [];
    const deps = { acquireReseatLock: memoryReseatLock({ journal }), dryRun: false };

    await expect(
      withReseatLock({ body: () => Promise.reject(new Error("socket died")), deps, workspace: SEAT }),
    ).rejects.toThrow("socket died");
    expect(journal).toEqual(["lock ws-seat", "release ws-seat"]);
  });

  it("takes no lock on a dry run, even over a held tab, since it types nothing", async () => {
    const journal: string[] = [];
    const deps = { acquireReseatLock: memoryReseatLock({ heldBy: new Set(["ws-seat"]), journal }), dryRun: true };

    const held = await withReseatLock({ body: () => Promise.resolve("would-reseat"), deps, workspace: SEAT });

    expect(unwrap(held)).toBe("would-reseat");
    expect(journal).toEqual([]);
  });
});
