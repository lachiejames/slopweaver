/**
 * `cmux takeover` step 5 over a fake cmux that refuses an unforced close the way cmux 0.65.2 does — the refusal that
 * stopped two chairs at step 5 and left four chairs open.
 */
import { describe, expect, it } from "vitest";
import {
  closeAppTakeoverPredecessor,
  closeCmuxTakeoverPredecessor,
} from "../../../../../cli/commands/cmux/takeoverClose.js";
import type { CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { err, ok } from "../../../../../lib/result.js";
import { SessionHarnessErrors } from "../../../../../sessionHarness/errors.js";
import type { HarnessTarget, SessionHarness } from "../../../../../sessionHarness/sessionHarness.js";
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

describe("closeCmuxTakeoverPredecessor", () => {
  it("force-closes an idle chair with nothing in the background, never reading the process table", async () => {
    const { client, closed } = fakeClient({ screens: { "ws-367": NO_SHELL }, workspaces: [PREDECESSOR] });
    const table = counting({ snapshot: COVERED });

    const outcome = await closeCmuxTakeoverPredecessor({ client, processTable: table.read, workspaceId: "ws-367" });

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

    const outcome = await closeCmuxTakeoverPredecessor({ client, processTable: table.read, workspaceId: "ws-367" });

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

    const outcome = await closeCmuxTakeoverPredecessor({ client, processTable: () => SOLE, workspaceId: "ws-367" });

    expect(outcome).toEqual({
      kind: "held",
      why: "its screen is busy and it holds the only keep-alive (pid 85912); start one elsewhere with `claude watch --wait` first",
    });
    expect(closed).toEqual([]);
  });

  it("holds when the chair's process tree does not read", async () => {
    const { client, closed } = fakeClient({ screens: { "ws-367": ONE_SHELL }, workspaces: [PREDECESSOR] });

    const outcome = await closeCmuxTakeoverPredecessor({ client, processTable: () => COVERED, workspaceId: "ws-367" });

    expect(outcome).toEqual({ kind: "held", why: "its screen is busy and cmux attributed no process tree to it" });
    expect(closed).toEqual([]);
  });

  it("holds an unreadable screen without forcing", async () => {
    const { client, closed } = fakeClient({ workspaces: [PREDECESSOR] });

    const outcome = await closeCmuxTakeoverPredecessor({ client, processTable: () => COVERED, workspaceId: "ws-367" });

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

    const outcome = await closeCmuxTakeoverPredecessor({ client, processTable: () => COVERED, workspaceId: "ws-367" });

    expect(outcome.kind).toBe("failed");
    expect(outcome).toMatchObject({ reason: expect.stringContaining("cmux said no") });
  });
});

const APP_TARGET: HarnessTarget = {
  session: {
    description: undefined,
    directory: "/wt/fresh-supervisor-handoff-9368",
    groupId: "app",
    handle: "app:5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60",
    id: "5f0c2a1e-7d3b-4c8e-9a6f-1b2c3d4e5f60",
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: "fresh-supervisor-handoff-9368",
  },
};

/** An app harness whose close answers once, keeping every target it was asked to close. */
function appCloser({ answer }: { answer: Awaited<ReturnType<SessionHarness["close"]>> }): {
  harness: Pick<SessionHarness, "close">;
  asked: HarnessTarget[];
} {
  const asked: HarnessTarget[] = [];
  return {
    asked,
    harness: {
      close: async ({ target }) => {
        asked.push(target);
        return answer;
      },
    },
  };
}

describe("closeAppTakeoverPredecessor", () => {
  it("closes through the harness alone and says whether the app forced it", async () => {
    const { harness, asked } = appCloser({ answer: ok({ forced: false, kind: "closed" }) });

    expect(await closeAppTakeoverPredecessor({ harness, target: APP_TARGET })).toEqual({
      how: "unforced",
      kind: "closed",
    });
    expect(asked).toEqual([APP_TARGET]);
  });

  it("treats the app's hold as step 5 not done", async () => {
    const { harness } = appCloser({ answer: ok({ kind: "held", reason: "busy" }) });

    expect(await closeAppTakeoverPredecessor({ harness, target: APP_TARGET })).toEqual({
      kind: "held",
      why: "the desktop app held it (busy)",
    });
  });

  it("treats a typed harness failure as step 5 failed, carrying its line", async () => {
    const { harness } = appCloser({
      answer: err(
        SessionHarnessErrors.operationFailed({ causeCode: "E", message: "the app is gone", operation: "close" }),
      ),
    });

    expect(await closeAppTakeoverPredecessor({ harness, target: APP_TARGET })).toEqual({
      kind: "failed",
      reason: "the app is gone",
    });
  });
});
