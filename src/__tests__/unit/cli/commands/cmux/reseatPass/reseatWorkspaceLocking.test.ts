/**
 * `cmux reseat`'s pass over a fake client: the order is the design — route, pace, stop, and only then type —
 * so each case reads one journal of every effect in the order it happened. This file: the lock and the wall re-read.
 */
import { describe, expect, it } from "vitest";

import { OperationLockAcquireErrors } from "../../../../../../admit/operationLockHeld.js";
import { reseatWorkspace } from "../../../../../../cli/commands/cmux/reseatPass.js";
import { err, ok, unwrap } from "../../../../../../lib/result.js";
import { ReseatErrors } from "../../../../../../sessions/reseatErrors.js";
import { LOGGED_OUT, SEAT_ID, unwrapRefusal, workspace } from "./fixtures.js";
import { world } from "./harness.js";

describe("reseatWorkspace", () => {
  it("routes, paces on boots in flight, stops the old claude, THEN types the resume line, and reads the plan back", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", LOGGED_OUT]]) });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal).toEqual([
      "route ws-seat",
      "boot-slot",
      "stop 393",
      "send ws-seat: CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 CLAUDE_SECURESTORAGE_CONFIG_DIR=/home/unbound/seat " +
        `3</home/plan-one/setup-token claude --plugin-dir /wt/ws-seat --model opus --effort high --resume ${SEAT_ID}`,
    ]);
    expect(outcome).toEqual(
      expect.objectContaining({ kind: "reseated", seat: `claude seat: ON plan-one (${SEAT_ID})` }),
    );
  });

  it("holds the workspace's reseat lock from before the first read until after the read-back", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, lockJournal: journal, screens: new Map([["ws-seat", LOGGED_OUT]]) });

    await reseatWorkspace({
      deps: { ...deps, client },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(journal.at(0)).toBe("lock ws-seat");
    expect(journal.at(-1)).toBe("release ws-seat");
    expect(journal.filter((line) => line.startsWith("lock") || line.startsWith("release"))).toEqual([
      "lock ws-seat",
      "release ws-seat",
    ]);
  });

  it("refuses RESEAT_CONTENDED while another reseat holds the tab, having routed, stopped and typed nothing", async () => {
    const journal: string[] = [];
    const lockJournal: string[] = [];
    const { client, deps } = world({
      journal,
      lockJournal,
      lockedBy: new Set(["ws-seat"]),
      screens: new Map([["ws-seat", LOGGED_OUT]]),
    });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(outcome).toEqual({
      error: ReseatErrors.contended({
        holder: "held by pid 4242 since 2026-10-30T00:00:00.000Z",
        workspaceRef: "workspace:4",
      }),
      kind: "refused",
      workspaceRef: "workspace:4",
    });
    expect(journal).toEqual([]);
    expect(lockJournal).toEqual(["lock-contended ws-seat"]);
  });

  it("refuses RESEAT_LOCK_FAILED, never running unserialised, when the lock cannot be taken at all", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", LOGGED_OUT]]) });

    const outcome = await reseatWorkspace({
      deps: {
        ...deps,
        acquireReseatLock: () => err(OperationLockAcquireErrors.refused({ message: "the lock directory is a file" })),
        client,
      },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(unwrapRefusal({ outcome }).code).toBe("RESEAT_LOCK_FAILED");
    expect(unwrapRefusal({ outcome }).message).toContain("the lock directory is a file");
    expect(journal).toEqual([]);
  });

  it("releases the lock once when the relaunch is refused after its stop", async () => {
    const lockJournal: string[] = [];
    const { client, deps } = world({
      journal: [],
      lockJournal,
      screens: new Map([["ws-seat", LOGGED_OUT]]),
      stops: false,
    });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(unwrapRefusal({ outcome }).code).toBe("KILL_TIMEOUT");
    expect(lockJournal).toEqual(["lock ws-seat", "release ws-seat"]);
  });

  // The caller read the wall before the lock, and a reseat that ran in between brought the seat back.
  it("re-reads a wall passed from before the lock, refusing WALL_CLEARED rather than stopping a seat brought back since", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", "⏺ Reading a file"]]) });
    const busy = unwrap(deps.readRegistry()).map((session) => ({ ...session, status: "busy" as const }));

    const outcome = await reseatWorkspace({
      deps: { ...deps, client, readRegistry: () => ok(busy) },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(unwrapRefusal({ outcome })).toEqual({
      code: "WALL_CLEARED",
      message:
        "workspace:4 was picked for its logged-out wall, and under its reseat lock it shows none — another reseat or a sign-in brought it back, so nothing was stopped or typed; run `slopweaver cmux reseat workspace:4` to relaunch it anyway",
    });
    expect(journal.filter((line) => line.startsWith("stop") || line.startsWith("send"))).toEqual([]);
  });

  // `--all --force` picked the tab walled, another reseat brought it back idle, then this one took the
  // free lock — and `--force`, or an idle session, would have planned a stop of the session just brought back.
  it("refuses WALL_CLEARED under --force too, for an idle session brought back since the tab was picked", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map([["ws-seat", "❯ "]]) });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client, force: true },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(unwrapRefusal({ outcome }).code).toBe("WALL_CLEARED");
    expect(journal.filter((line) => !line.startsWith("boot "))).toEqual([]);
  });

  it("refuses CMUX_READ_FAILED, stopping nothing, when the wall passed in cannot be read again under the lock", async () => {
    const journal: string[] = [];
    const { client, deps } = world({ journal, screens: new Map() });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(unwrapRefusal({ outcome }).code).toBe("CMUX_READ_FAILED");
    expect(journal).toEqual([]);
  });

  it("takes no lock on a dry run, which types nothing", async () => {
    const lockJournal: string[] = [];
    const { client, deps } = world({ journal: [], lockJournal, screens: new Map([["ws-seat", LOGGED_OUT]]) });

    const outcome = await reseatWorkspace({
      deps: { ...deps, client, dryRun: true },
      wall: { kind: "logged-out" },
      workspace: workspace({ id: "ws-seat", ref: "workspace:4" }),
    });

    expect(outcome.kind).toBe("would-reseat");
    expect(lockJournal).toEqual([]);
  });
});
