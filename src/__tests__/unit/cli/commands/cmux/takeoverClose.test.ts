/**
 * `cmux takeover` step 5 over a fake cmux that refuses an unforced close the way cmux 0.65.2 does — the refusal that
 * stopped two chairs at step 5 and left four chairs open.
 */
import { describe, expect, it } from "vitest";
import { closeTakeoverPredecessor } from "../../../../../cli/commands/cmux/takeoverClose.js";
import type { CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import type { WatchTable } from "../../../../../sessions/keepAliveSeatClose.js";
import { CHAIR_TREE, COVERED, NO_SHELL, ONE_SHELL, SOLE } from "../../../sessions/keepAliveChairFixture.js";
import { fakeClient } from "../session/closeDoneFakeCmux.js";
import { workspace } from "../session/closeDoneHarness.js";

const PREDECESSOR: CmuxWorkspaceSummary = workspace({
  currentDirectory: "/wt/fresh-supervisor-handoff-9367",
  title: "/slopweaver:supervisor",
  workspaceId: "ws-367",
  workspaceRef: "workspace:1000031216",
});

/** A snapshot reader that counts its reads, so a case can say the table was never read. */
function counting({ snapshot }: { snapshot: WatchTable }): { read: () => WatchTable; reads: () => number } {
  let reads = 0;
  return {
    read: () => {
      reads += 1;
      return snapshot;
    },
    reads: () => reads,
  };
}

describe("closeTakeoverPredecessor", () => {
  it("force-closes an idle chair with nothing in the background, never reading the process table", async () => {
    const { client, closed } = fakeClient({ screens: { "ws-367": NO_SHELL }, workspaces: [PREDECESSOR] });
    const table = counting({ snapshot: COVERED });

    const outcome = await closeTakeoverPredecessor({ client, processTable: table.read, workspaceId: "ws-367" });

    expect(outcome).toEqual({ how: "forced, screen idle", kind: "closed" });
    expect(closed).toEqual(["ws-367"]);
    expect(table.reads()).toBe(0);
  });

  it("force-closes a chair whose one shell is a keep-alive another watch covers", async () => {
    const { client, closed } = fakeClient({
      screens: { "ws-367": ONE_SHELL },
      trees: { "ws-367": [CHAIR_TREE] },
      workspaces: [PREDECESSOR],
    });
    const table = counting({ snapshot: COVERED });

    const outcome = await closeTakeoverPredecessor({ client, processTable: table.read, workspaceId: "ws-367" });

    expect(outcome).toEqual({
      how: "forced, its keep-alive (pid 85912) retires with it; pid 67939 keeps the stores alive",
      kind: "closed",
    });
    expect(closed).toEqual(["ws-367"]);
    expect(table.reads()).toBe(1);
  });

  it("holds the chair running the only keep-alive and closes nothing", async () => {
    const { client, closed } = fakeClient({
      screens: { "ws-367": ONE_SHELL },
      trees: { "ws-367": [CHAIR_TREE] },
      workspaces: [PREDECESSOR],
    });

    const outcome = await closeTakeoverPredecessor({ client, processTable: () => SOLE, workspaceId: "ws-367" });

    expect(outcome).toEqual({
      kind: "held",
      why: "its screen is busy and it holds the only keep-alive (pid 85912); start one elsewhere with `claude watch --wait` first",
    });
    expect(closed).toEqual([]);
  });

  it("holds when the chair's process tree does not read", async () => {
    const { client, closed } = fakeClient({ screens: { "ws-367": ONE_SHELL }, workspaces: [PREDECESSOR] });

    const outcome = await closeTakeoverPredecessor({ client, processTable: () => COVERED, workspaceId: "ws-367" });

    expect(outcome).toEqual({ kind: "held", why: "its screen is busy and cmux attributed no process tree to it" });
    expect(closed).toEqual([]);
  });

  it("holds an unreadable screen without forcing", async () => {
    const { client, closed } = fakeClient({ workspaces: [PREDECESSOR] });

    const outcome = await closeTakeoverPredecessor({ client, processTable: () => COVERED, workspaceId: "ws-367" });

    expect(outcome).toEqual({ kind: "held", why: "its screen is unreadable" });
    expect(closed).toEqual([]);
  });

  it("returns cmux's own failure when the forced close fails", async () => {
    const { client } = fakeClient({
      closeFails: true,
      screens: { "ws-367": ONE_SHELL },
      trees: { "ws-367": [CHAIR_TREE] },
      workspaces: [PREDECESSOR],
    });

    const outcome = await closeTakeoverPredecessor({ client, processTable: () => COVERED, workspaceId: "ws-367" });

    expect(outcome.kind).toBe("failed");
    expect(outcome).toMatchObject({ reason: expect.stringContaining("cmux said no") });
  });
});
