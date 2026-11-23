/**
 * A `workspace.create` whose outcome is unknown — timed out, or its connection failed under it:
 * {@link reconcileWorkspaceCreate}'s identity rule, and {@link createOrAdoptWorkspace}'s every branch — adopt, nothing
 * appeared, ambiguous, an unreadable inventory, an unresolvable surface, and an answered failure that must not be
 * reconciled at all.
 *
 * A hand-written recording fake, never `vi.fn` — it scripts each inventory read in order and records every call,
 * so a test asserts exactly how many reads and waits a branch spent.
 */
import { describe, expect, it } from "vitest";

import type { CmuxClient, CmuxWorkspace, CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { type CmuxError, CmuxErrors } from "../../../cmux/errors.js";
import {
  createOrAdoptWorkspace,
  type HoldWorkspaceCreate,
  MAX_WORKSPACE_CREATE_RECONCILE_POLLS,
  reconcileWorkspaceCreate,
  workspaceCreateLockKey,
} from "../../../cmux/workspaceCreateRecovery.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";

const CWD = "/repo/.claude/worktrees.noindex/a-doc";
const DESCRIPTION = "spawned session";

/** One inventory row; a new orphan by default, titled `Terminal` as workspace:428 was. */
function row(over: Partial<CmuxWorkspaceSummary> = {}): CmuxWorkspaceSummary {
  return {
    currentDirectory: CWD,
    description: DESCRIPTION,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: "Terminal",
    windowId: "W1",
    workspaceId: "NEW",
    workspaceRef: "workspace:428",
    ...over,
  };
}

/** A row that was standing before the create was sent. */
const STANDING = row({ title: "✳ some other seat", workspaceId: "OLD", workspaceRef: "workspace:3" });

const TIMED_OUT = CmuxErrors.timedOut({ method: "workspace.create", timeoutMs: 15_000 });

const RESOLVED: CmuxWorkspace = {
  surfaceId: "S-NEW",
  surfaceRef: "surface:440",
  workspaceId: "NEW",
  workspaceRef: "workspace:428",
};

/**
 * A fake client: `inventories[0]` answers the pre-create snapshot, each later entry one read after the timeout,
 * the last repeating once exhausted.
 */
function fakeClient({
  inventories,
  created = err(TIMED_OUT),
  surface = ok(RESOLVED),
}: {
  inventories: readonly Result<readonly CmuxWorkspaceSummary[], CmuxError>[];
  created?: Result<CmuxWorkspace, CmuxError>;
  surface?: Result<CmuxWorkspace, CmuxError>;
}): {
  calls: string[];
  client: Pick<CmuxClient, "createWorkspace" | "listWorkspacesStrict" | "workspaceSurface">;
} {
  const calls: string[] = [];
  let read = 0;
  return {
    calls,
    client: {
      createWorkspace: () => {
        calls.push("create");
        return Promise.resolve(created);
      },
      listWorkspacesStrict: () => {
        calls.push("list");
        const answer = inventories[Math.min(read, inventories.length - 1)]!;
        read += 1;
        return Promise.resolve(answer);
      },
      workspaceSurface: ({ workspaceId }) => {
        calls.push(`surface ${workspaceId}`);
        return Promise.resolve(surface);
      },
    },
  };
}

/** A create lock that is always free and releases into nothing — every test not about the lock itself. */
const FREE: HoldWorkspaceCreate = () => ok({ claimed: new Set<string>(), release: () => undefined });

/**
 * A create lock journalling its take and release into `calls`, so a test reads them in order with the client's, and
 * handing back `claimed` as the workspaces earlier creates made.
 */
function journalledHold({
  calls,
  claimed = [],
}: {
  calls: string[];
  claimed?: readonly string[];
}): HoldWorkspaceCreate {
  return ({ fingerprint }) => {
    calls.push(`hold ${workspaceCreateLockKey({ fingerprint })}`);
    return ok({
      claimed: new Set(claimed),
      release: ({ made }) => calls.push(`release ${String(made)}`),
    });
  };
}

/** Run {@link createOrAdoptWorkspace} over a fake, counting the waits it spent. */
async function run({
  client,
  hold = FREE,
}: {
  client: ReturnType<typeof fakeClient>["client"];
  hold?: HoldWorkspaceCreate;
}): Promise<{
  outcome: Awaited<ReturnType<typeof createOrAdoptWorkspace>>;
  waits: number;
}> {
  let waits = 0;
  const wait = (): Promise<void> => {
    waits += 1;
    return Promise.resolve();
  };
  const deps = { client, holdWorkspaceCreate: hold, wait };
  const outcome = await createOrAdoptWorkspace({ cwd: CWD, deps, description: DESCRIPTION, name: "a-doc handover" });
  return { outcome, waits };
}

describe("reconcileWorkspaceCreate", () => {
  const expected = { currentDirectory: CWD, description: DESCRIPTION };

  it("adopts the one new row matching directory and description, whatever its pane retitled it to", () => {
    const decision = reconcileWorkspaceCreate({
      expected,
      snapshotWorkspaceIds: new Set(["OLD"]),
      workspaces: [STANDING, row()],
    });

    expect(decision).toEqual({ kind: "adopt", workspace: row() });
  });

  it("never adopts a row that stood before the create, even one matching exactly", () => {
    const decision = reconcileWorkspaceCreate({
      expected,
      snapshotWorkspaceIds: new Set(["NEW"]),
      workspaces: [row()],
    });

    expect(decision).toEqual({ kind: "none" });
  });

  it("ignores a new row in another directory", () => {
    const decision = reconcileWorkspaceCreate({
      expected,
      snapshotWorkspaceIds: new Set(),
      workspaces: [row({ currentDirectory: "/repo/.claude/worktrees.noindex/b-doc" })],
    });

    expect(decision).toEqual({ kind: "none" });
  });

  it("ignores a new row in the same directory with another description, as an ask sharing the checkout has", () => {
    const decision = reconcileWorkspaceCreate({
      expected,
      snapshotWorkspaceIds: new Set(),
      workspaces: [row({ description: "spawned session · ask-C1-2.2" })],
    });

    expect(decision).toEqual({ kind: "none" });
  });

  it("matches an absent description only against an absent one", () => {
    const decision = reconcileWorkspaceCreate({
      expected: { currentDirectory: CWD, description: undefined },
      snapshotWorkspaceIds: new Set(),
      workspaces: [row(), row({ description: undefined, workspaceId: "BARE" })],
    });

    expect(decision).toEqual({ kind: "adopt", workspace: row({ description: undefined, workspaceId: "BARE" }) });
  });

  it("reports every match, in inventory order, when more than one new row fits", () => {
    const second = row({ workspaceId: "NEW-2", workspaceRef: "workspace:429" });
    const decision = reconcileWorkspaceCreate({
      expected,
      snapshotWorkspaceIds: new Set(),
      workspaces: [row(), second],
    });

    expect(decision).toEqual({ kind: "ambiguous", workspaces: [row(), second] });
  });
});

describe("workspaceCreateLockKey", () => {
  it("keys on the directory and the description, telling an absent description from an empty one", () => {
    const keys = [
      workspaceCreateLockKey({ fingerprint: { currentDirectory: CWD, description: DESCRIPTION } }),
      workspaceCreateLockKey({ fingerprint: { currentDirectory: CWD, description: undefined } }),
      workspaceCreateLockKey({ fingerprint: { currentDirectory: CWD, description: "" } }),
      workspaceCreateLockKey({ fingerprint: { currentDirectory: `${CWD}/x`, description: DESCRIPTION } }),
    ];

    expect(keys[0]).toBe(`cmux-create:${CWD}\u0000+${DESCRIPTION}`);
    expect(new Set(keys).size).toBe(4);
  });
});

describe("createOrAdoptWorkspace's create lock", () => {
  // Unserialised, a concurrent spawn's create landing while this one's reply was lost was the one new
  // matching row, and this adopted it.
  it("holds the fingerprint's lock from before the snapshot until after the last reconciliation read", async () => {
    const { calls, client } = fakeClient({ inventories: [ok([STANDING]), ok([STANDING]), ok([STANDING, row()])] });

    const { outcome } = await run({ client, hold: journalledHold({ calls }) });

    expect(unwrap(outcome)).toEqual(RESOLVED);
    expect(calls).toEqual([
      `hold cmux-create:${CWD}\u0000+${DESCRIPTION}`,
      "list",
      "create",
      "list",
      "list",
      "surface NEW",
      "release NEW",
    ]);
  });

  it("releases the lock naming nothing once a reconciliation that found nothing gives up", async () => {
    const { calls, client } = fakeClient({ inventories: [ok([STANDING])] });

    const { outcome } = await run({ client, hold: journalledHold({ calls }) });

    expect(unwrapErr(outcome).reason).toContain("appeared within");
    expect(calls.filter((call) => call.startsWith("release"))).toEqual(["release undefined"]);
    expect(calls.at(-1)).toBe("release undefined");
  });

  it("releases a create that answered naming the workspace it made, so the next create never adopts it", async () => {
    const { calls, client } = fakeClient({ created: ok(RESOLVED), inventories: [ok([STANDING])] });

    await run({ client, hold: journalledHold({ calls }) });

    expect(calls.at(-1)).toBe("release NEW");
  });

  // An earlier create answered with A and released; this one's snapshot missed A — read mid-move between
  // windows, or not yet visible — and its own reply was lost, so A read as the one new matching row.
  it("never adopts a workspace an earlier create claimed, even when the snapshot missed it", async () => {
    const { calls, client } = fakeClient({ inventories: [ok([STANDING]), ok([STANDING, row()])] });

    const { outcome } = await run({ client, hold: journalledHold({ calls, claimed: ["NEW"] }) });

    expect(unwrapErr(outcome).reason).toContain("appeared within");
    expect(calls.filter((call) => call.startsWith("surface"))).toEqual([]);
    expect(calls.at(-1)).toBe("release undefined");
  });

  it("creates nothing and reads nothing when another create holds the fingerprint", async () => {
    const { calls, client } = fakeClient({ created: ok(RESOLVED), inventories: [ok([])] });
    const held: HoldWorkspaceCreate = () => err("another spawn is creating it (held by pid 4242)");

    const { outcome } = await run({ client, hold: held });

    expect(unwrapErr(outcome)).toEqual({
      reason: `no workspace was created in ${CWD} described ${DESCRIPTION}: another spawn is creating it (held by pid 4242) — a second create under the same directory and description could not be told from this one's if either reply were lost`,
      workspaceRef: "",
    });
    expect(calls).toEqual([]);
  });
});

describe("createOrAdoptWorkspace", () => {
  it("returns a create that answered, untouched, and reads the inventory only once", async () => {
    const { calls, client } = fakeClient({ created: ok(RESOLVED), inventories: [ok([STANDING])] });

    const { outcome, waits } = await run({ client });

    expect(unwrap(outcome)).toEqual(RESOLVED);
    expect(calls).toEqual(["list", "create"]);
    expect(waits).toBe(0);
  });

  it("hands back exactly the four addresses, whatever else the reply object carried", async () => {
    const { client } = fakeClient({ created: ok({ ...RESOLVED, marker: "leaked" }), inventories: [ok([])] });

    const { outcome } = await run({ client });

    expect(Object.keys(unwrap(outcome)).toSorted()).toEqual(["surfaceId", "surfaceRef", "workspaceId", "workspaceRef"]);
  });

  it("does not let an unreadable snapshot spoil a create that answered", async () => {
    const down = CmuxErrors.socketUnavailable({ detail: "write EPIPE", socketPath: "/tmp/cmux.sock" });
    const { client } = fakeClient({ created: ok(RESOLVED), inventories: [err(down)] });

    const { outcome } = await run({ client });

    expect(unwrap(outcome)).toEqual(RESOLVED);
  });

  it("adopts the workspace a timed-out create made once it appears, resolving its surface", async () => {
    const { calls, client } = fakeClient({ inventories: [ok([STANDING]), ok([STANDING]), ok([STANDING, row()])] });

    const { outcome, waits } = await run({ client });

    expect(unwrap(outcome)).toEqual(RESOLVED);
    expect(calls).toEqual(["list", "create", "list", "list", "surface NEW"]);
    expect(waits).toBe(1);
  });

  it("adopts the workspace a create made whose connection failed under it, as it would a timed-out one", async () => {
    const down = CmuxErrors.socketUnavailable({ detail: "the connection closed", socketPath: "/tmp/cmux.sock" });
    const { calls, client } = fakeClient({ created: err(down), inventories: [ok([STANDING]), ok([STANDING, row()])] });

    const { outcome } = await run({ client });

    expect(unwrap(outcome)).toEqual(RESOLVED);
    expect(calls).toEqual(["list", "create", "list", "surface NEW"]);
  });

  it("spends the bound after a failed connection when nothing appears, and says a late workspace may still land", async () => {
    const down = CmuxErrors.socketUnavailable({ detail: "write EPIPE", socketPath: "/tmp/cmux.sock" });
    const { calls, client } = fakeClient({ created: err(down), inventories: [ok([STANDING])] });

    const { outcome } = await run({ client });

    expect(unwrapErr(outcome).reason).toContain(`${down.message}; no new workspace in ${CWD}`);
    expect(calls.filter((call) => call === "list").length).toBe(1 + MAX_WORKSPACE_CREATE_RECONCILE_POLLS);
  });

  it("returns an access refusal exactly as it came, with no reconciliation: cmux never admitted the create", async () => {
    const denied = CmuxErrors.accessDenied({
      refusal: "Access denied - only processes started inside cmux can connect",
      socketPath: "/tmp/cmux.sock",
    });
    const { calls, client } = fakeClient({ created: err(denied), inventories: [ok([STANDING]), ok([row()])] });

    const { outcome } = await run({ client });

    expect(unwrapErr(outcome)).toEqual({ reason: denied.message, workspaceRef: "" });
    expect(calls).toEqual(["list", "create"]);
  });

  it("returns a non-timeout failure exactly as before, with no reconciliation at all", async () => {
    const refused = CmuxErrors.callFailed({
      cmuxCode: "invalid_params",
      message: "bad cwd",
      method: "workspace.create",
    });
    const { calls, client } = fakeClient({ created: err(refused), inventories: [ok([STANDING]), ok([row()])] });

    const { outcome, waits } = await run({ client });

    expect(unwrapErr(outcome)).toEqual({ reason: refused.message, workspaceRef: "" });
    expect(calls).toEqual(["list", "create"]);
    expect(waits).toBe(0);
  });

  it("spends exactly the bound when nothing appears, and says a late workspace may still land", async () => {
    const { calls, client } = fakeClient({ inventories: [ok([STANDING])] });

    const { outcome, waits } = await run({ client });

    const failure = unwrapErr(outcome);
    expect(failure.workspaceRef).toBe("");
    expect(failure.reason).toContain(TIMED_OUT.message);
    expect(failure.reason).toContain(`within ${String(MAX_WORKSPACE_CREATE_RECONCILE_POLLS)} inventory reads`);
    expect(failure.reason).toContain("the create may still complete later");
    expect(calls.filter((call) => call === "list").length).toBe(1 + MAX_WORKSPACE_CREATE_RECONCILE_POLLS);
    expect(waits).toBe(MAX_WORKSPACE_CREATE_RECONCILE_POLLS - 1);
  });

  it("adopts nothing and closes nothing when two new workspaces fit, naming both", async () => {
    const second = row({ workspaceId: "NEW-2", workspaceRef: "workspace:429" });
    const { calls, client } = fakeClient({ inventories: [ok([]), ok([row(), second])] });

    const { outcome } = await run({ client });

    const failure = unwrapErr(outcome);
    expect(failure.reason).toContain("2 new workspaces match");
    expect(failure.reason).toContain("workspace:428 (NEW, titled Terminal");
    expect(failure.reason).toContain("workspace:429 (NEW-2, titled Terminal");
    expect(calls).toEqual(["list", "create", "list"]);
  });

  it("stops on an unreadable inventory after the timeout rather than reading it as nothing appeared", async () => {
    const down = CmuxErrors.socketUnavailable({ detail: "write EPIPE", socketPath: "/tmp/cmux.sock" });
    const { calls, client } = fakeClient({ inventories: [ok([]), err(down)] });

    const { outcome, waits } = await run({ client });

    const failure = unwrapErr(outcome);
    expect(failure.reason).toContain(
      `the inventory read looking for the workspace it may have made failed (${down.message})`,
    );
    expect(calls).toEqual(["list", "create", "list"]);
    expect(waits).toBe(0);
  });

  it("has nothing to diff against when the snapshot failed, and says both facts", async () => {
    const down = CmuxErrors.socketUnavailable({ detail: "write EPIPE", socketPath: "/tmp/cmux.sock" });
    const { calls, client } = fakeClient({ inventories: [err(down), ok([row()])] });

    const { outcome } = await run({ client });

    const failure = unwrapErr(outcome);
    expect(failure.reason).toContain(TIMED_OUT.message);
    expect(failure.reason).toContain(`the inventory read before the create failed (${down.message})`);
    expect(failure.reason).toContain("the create may still complete later");
    expect(calls).toEqual(["list", "create"]);
  });

  it("names the workspace it found when that workspace's surface cannot be resolved", async () => {
    const malformed = CmuxErrors.malformedReply({ detail: "no pane", method: "pane.list" });
    const { calls, client } = fakeClient({ inventories: [ok([]), ok([row()])], surface: err(malformed) });

    const { outcome } = await run({ client });

    const failure = unwrapErr(outcome);
    expect(failure.workspaceRef).toBe("workspace:428");
    expect(failure.workspaceId).toBe("NEW");
    expect(failure.reason).toContain("it did make workspace:428 (NEW, titled Terminal");
    expect(failure.reason).toContain(malformed.message);
    expect(calls).toEqual(["list", "create", "list", "surface NEW"]);
  });

  it("types nothing when pane.list keeps the id but names another workspace ref than the inventory did", async () => {
    const contradicting = ok({ ...RESOLVED, workspaceRef: "workspace:999" });
    const { calls, client } = fakeClient({ inventories: [ok([]), ok([row()])], surface: contradicting });

    const { outcome } = await run({ client });

    const failure = unwrapErr(outcome);
    expect(failure.workspaceRef).toBe("workspace:428");
    expect(failure.workspaceId).toBe("NEW");
    expect(failure.reason).toContain("but pane.list named it workspace:999, so nothing was typed into it");
    expect(calls).toEqual(["list", "create", "list", "surface NEW"]);
  });
});
