import { describe, expect, it } from "vitest";

import { CmuxErrors } from "../../../../cmux/errors.js";
import { bootCmuxWorkspace, type SpawnDeps, spawnCmuxSession } from "../../../../cmux/spawn.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { CREATED, fakeClient } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

/**
 * The three shapes a control-socket write failure (`SOCKET_UNAVAILABLE`, e.g. `write EPIPE`) can leave a
 * spawn in, per `spawn.ts`'s own "A control-socket write can EPIPE" header: no workspace at all, a workspace
 * with no booted host, and a booted host with no pickup command. `realCmuxClient`'s `withSocketRetry` already
 * absorbs a transient failure before `CmuxClient` ever returns `err` (see `socket.test.ts`), so what these
 * assert is the state {@link SpawnFailure} reports once that budget IS spent — never an empty-ref hint for a
 * workspace that plainly exists, and never a claim of delivery for one that plainly does not.
 */
describe("a control-socket write failure, per partial shape", () => {
  const SOCKET_DOWN = CmuxErrors.socketUnavailable({
    detail: "write EPIPE",
    socketPath: "/tmp/cmux.sock",
  });

  it("worktree only — createWorkspace itself failed, so no workspace or surface ref exists to report", async () => {
    const { client } = fakeClient({ screens: ["$ "] });
    const { deps: spawnDeps } = deps({ client });
    const failing: SpawnDeps = {
      ...spawnDeps,
      client: { ...client, createWorkspace: () => Promise.resolve(err(SOCKET_DOWN)) },
    };

    const outcome = await bootCmuxWorkspace({ deps: failing, plan: PLAN });

    expect(outcome.isErr()).toBe(true);
    const failure = unwrapErr(outcome);
    expect(failure.workspaceRef).toBe("");
    expect(failure.surfaceRef).toBe("");
    expect(failure.reason).toContain("write EPIPE");
  });

  it("a create that timed out but made its workspace anyway is adopted and booted, not left an empty Terminal", async () => {
    const { calls, client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps } = deps({ client });
    const orphan = unwrap(await client.listWorkspaces())[0]!;
    let reads = 0;
    const timingOut: SpawnDeps = {
      ...spawnDeps,
      client: {
        ...client,
        createWorkspace: () => {
          calls.push({ op: "createWorkspace" });
          return Promise.resolve(err(CmuxErrors.timedOut({ method: "workspace.create", timeoutMs: 15_000 })));
        },
        // Absent from the snapshot, present on the first read after the timeout — as workspace:428 was. Its title
        // reads `Terminal`, because the pane overwrote the name the create seeded.
        listWorkspacesStrict: () => {
          calls.push({ op: "listWorkspacesStrict" });
          reads += 1;
          const made = { ...orphan, description: "spawned session", title: "Terminal" };
          return Promise.resolve(ok(reads === 1 ? [] : [made]));
        },
      },
    };
    calls.length = 0;

    const outcome = await bootCmuxWorkspace({ deps: timingOut, plan: PLAN });

    expect(unwrap(outcome).workspaceRef).toBe(CREATED.workspaceRef);
    expect(unwrap(outcome).surfaceId).toBe(CREATED.surfaceId);
    expect(calls.map((call) => call.op).slice(0, 5)).toEqual([
      "listWorkspacesStrict",
      "createWorkspace",
      "listWorkspacesStrict",
      "workspaceSurface",
      "readScreen",
    ]);
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(1);
  });

  it("workspace opened, no boot — the boot line's own sendLine failed after the workspace was created", async () => {
    const { client } = fakeClient({ screens: ["$ "] });
    const { deps: spawnDeps } = deps({ client });
    const failing: SpawnDeps = {
      ...spawnDeps,
      client: { ...client, sendLine: () => Promise.resolve(err(SOCKET_DOWN)) },
    };

    const outcome = await bootCmuxWorkspace({ deps: failing, plan: PLAN });

    expect(outcome.isErr()).toBe(true);
    const failure = unwrapErr(outcome);
    expect(failure.workspaceRef).toBe(CREATED.workspaceRef);
    expect(failure.surfaceRef).toBe(CREATED.surfaceRef);
    expect(failure.reason).toBe(`the boot line could not be sent: ${SOCKET_DOWN.message}`);
  });

  it("workspace booted, no pickup — the pickup line's own sendLine failed after boot was witnessed", async () => {
    const { client } = fakeClient({ screens: ["$ ", "Claude Code v2.1.231 booting…"] });
    const { deps: spawnDeps } = deps({ client });
    let bootSent = false;
    const failing: SpawnDeps = {
      ...spawnDeps,
      client: {
        ...client,
        sendLine: (args) => {
          if (!bootSent) {
            bootSent = true;
            return client.sendLine(args);
          }
          return Promise.resolve(err(SOCKET_DOWN));
        },
      },
    };

    const outcome = await spawnCmuxSession({ deps: failing, plan: PLAN });

    expect(outcome.isErr()).toBe(true);
    const failure = unwrapErr(outcome);
    expect(failure.workspaceRef).toBe(CREATED.workspaceRef);
    expect(failure.surfaceRef).toBe(CREATED.surfaceRef);
    expect(failure.reason).toBe(`the pickup command could not be sent: ${SOCKET_DOWN.message}`);
  });
});
