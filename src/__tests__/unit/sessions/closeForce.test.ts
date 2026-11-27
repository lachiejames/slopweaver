/**
 * When a close may skip cmux 0.65.2's running-process confirmation: the pure screen decision, the exact refusal
 * it answers, and `cmux close`'s bounded attempt — unforced, then at most one forced retry on an idle screen. A
 * park's bounded close through the seam is `../sessionHarness/recordingHarness.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import type { CmuxClient } from "../../../cmux/client.js";
import { type CmuxError, CmuxErrors, isWorkspaceCloseConfirmationRequired } from "../../../cmux/errors.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { closeForceDecision, closeWorkspaceWithBoundedForce } from "../../../sessions/closeForce.js";
import {
  CODEX_AFTER_INTERRUPT,
  CODEX_IDLE_AFTER_TURNS,
  CODEX_QUEUED,
  CODEX_RUNNING,
  CODEX_TRUST_MENU,
} from "../../fixtures/codexTui.js";

const IDLE = "❯ \n  ⏵⏵ bypass permissions on (shift+tab to cycle)";
const CONFIRMATION = CmuxErrors.callFailed({
  cmuxCode: "confirmation_required",
  message: "Workspace has a running process; retry with --force",
  method: "workspace.close",
});

/**
 * A client whose closes answer from a list in order (the last repeated) and whose one screen read answers
 * `screen`, recording every close's options and counting the reads. Nothing else is reachable.
 */
function fakeClient({ closes, screen }: { closes: readonly (CmuxError | undefined)[]; screen: string | undefined }): {
  readonly client: CmuxClient;
  readonly closeCalls: { workspaceId: string; force?: boolean }[];
  reads: () => number;
} {
  const closeCalls: { workspaceId: string; force?: boolean }[] = [];
  let reads = 0;
  const unreachable = (): never => {
    throw new Error("a bounded close never calls this");
  };
  const client: CmuxClient = {
    close: () => undefined,
    closeWorkspace: (options) => {
      closeCalls.push(options);
      const failure = closes[Math.min(closeCalls.length - 1, closes.length - 1)];
      return Promise.resolve(failure === undefined ? ok(undefined) : err(failure));
    },
    createWorkspace: unreachable,
    identify: unreachable,
    interruptTurn: unreachable,
    listWorkspaces: unreachable,
    listWorkspacesStrict: unreachable,
    pinWorkspace: unreachable,
    processTree: unreachable,
    readResumeBinding: unreachable,
    readScreen: () => {
      reads += 1;
      return Promise.resolve(
        screen === undefined
          ? err(CmuxErrors.malformedReply({ detail: "settling", method: "terminal.text" }))
          : ok(screen),
      );
    },
    readScreenGrid: unreachable,
    renameWorkspace: unreachable,
    resolveWorkspace: () =>
      Promise.resolve(
        ok({
          currentDirectory: "/repo",
          description: undefined,
          latestConversationMessage: undefined,
          latestSubmittedAtIso: undefined,
          latestSubmittedMessage: undefined,
          pinned: false,
          selected: false,
          title: "a seat",
          windowId: "window:1",
          workspaceId: "id-seat",
          workspaceRef: "workspace:8",
        }),
      ),
    sendLine: unreachable,
    submitComposer: unreachable,
    topologyStrict: unreachable,
    unpinWorkspace: unreachable,
    workspaceSurface: unreachable,
    workspaceTop: unreachable,
  };
  return { client, closeCalls, reads: () => reads };
}

describe("closeForceDecision", () => {
  it("forces an idle prompt", () => {
    expect(closeForceDecision({ screen: IDLE })).toEqual({ kind: "force" });
  });

  it("holds a screen with no running marker but no Claude prompt to prove it idle (clear; sleep 1000)", () => {
    const screens = ["", "$ ", "  ⏵⏵ bypass permissions on (shift+tab to cycle)\n❯ "];

    expect(screens.map((screen) => closeForceDecision({ screen }))).toEqual([
      { kind: "held", verdict: "unproven" },
      { kind: "held", verdict: "unproven" },
      { kind: "held", verdict: "unproven" },
    ]);
  });

  it("holds a running turn, a background shell, a Monitor, a queued line and an unreadable screen", () => {
    const screens = [
      "Thinking… (esc to interrupt)",
      "❯ \n  ⏵⏵ bypass permissions on · 1 shell · esc to interrupt",
      "❯ \n  ⏵⏵ bypass permissions on · 1 monitor",
      "esc to interrupt\nPress up to edit queued messages",
      undefined,
    ];

    expect(screens.map((screen) => closeForceDecision({ screen }))).toEqual([
      { kind: "held", verdict: "busy" },
      { kind: "held", verdict: "busy" },
      { kind: "held", verdict: "busy" },
      { kind: "held", verdict: "queued" },
      { kind: "held", verdict: "unreadable" },
    ]);
  });

  // A retired chair: a diff line that is only its line number, read as Codex's, held it `busy` on every tick.
  it("forces a Claude Code seat at rest whose transcript holds a bare line number, and holds the same line with no prompt", () => {
    const transcript = "⏺ Update(notes.md)\n      41  - a line\n      42 \n⏺ Done.\n";

    expect(closeForceDecision({ screen: `${transcript}${IDLE}` })).toEqual({ kind: "force" });
    expect(closeForceDecision({ screen: `${transcript}$ ` })).toEqual({ kind: "held", verdict: "busy" });
  });

  // Codex v0.157.1 — before this a Codex seat at rest could only ever be held `unproven`.
  it("forces a Codex seat at rest and holds one running, queued or holding a background terminal", () => {
    const screens = [CODEX_IDLE_AFTER_TURNS, CODEX_RUNNING, CODEX_QUEUED, CODEX_AFTER_INTERRUPT, CODEX_TRUST_MENU];

    expect(screens.map((screen) => closeForceDecision({ screen }))).toEqual([
      { kind: "force" },
      { kind: "held", verdict: "busy" },
      { kind: "held", verdict: "queued" },
      { kind: "held", verdict: "busy" },
      { kind: "held", verdict: "unproven" },
    ]);
  });
});

describe("isWorkspaceCloseConfirmationRequired", () => {
  it("matches only cmux's confirmation refusal of workspace.close", () => {
    const errors: CmuxError[] = [
      CONFIRMATION,
      CmuxErrors.callFailed({ cmuxCode: "not_found", message: "gone", method: "workspace.close" }),
      CmuxErrors.callFailed({ cmuxCode: "confirmation_required", message: "x", method: "surface.close" }),
      CmuxErrors.malformedReply({ detail: "confirmation_required", method: "workspace.close" }),
    ];

    expect(errors.map((error) => isWorkspaceCloseConfirmationRequired({ error }))).toEqual([true, false, false, false]);
  });
});

describe("closeWorkspaceWithBoundedForce", () => {
  it("closes unforced when cmux accepts it, reading no screen", async () => {
    const fake = fakeClient({ closes: [undefined], screen: IDLE });

    const closed = await closeWorkspaceWithBoundedForce({ client: fake.client, workspaceId: "id-seat" });

    expect(unwrap(closed)).toEqual({ forced: false, kind: "closed" });
    expect(fake.closeCalls).toEqual([{ workspaceId: "id-seat" }]);
    expect(fake.reads()).toBe(0);
  });

  it("forces once, after one read, when cmux wants confirmation and the screen is idle", async () => {
    const fake = fakeClient({ closes: [CONFIRMATION, undefined], screen: IDLE });

    const closed = await closeWorkspaceWithBoundedForce({ client: fake.client, workspaceId: "id-seat" });

    expect(unwrap(closed)).toEqual({ forced: true, kind: "closed" });
    expect(fake.closeCalls).toEqual([{ workspaceId: "id-seat" }, { force: true, workspaceId: "id-seat" }]);
    expect(fake.reads()).toBe(1);
  });

  it("holds a busy screen, an unreadable one and a blank one, never forcing", async () => {
    const busy = fakeClient({ closes: [CONFIRMATION], screen: "❯ \n  ⏵⏵ bypass permissions on · 1 shell" });
    const unreadable = fakeClient({ closes: [CONFIRMATION], screen: undefined });
    const blank = fakeClient({ closes: [CONFIRMATION], screen: "" });

    const held = await closeWorkspaceWithBoundedForce({ client: busy.client, workspaceId: "id-seat" });
    const blind = await closeWorkspaceWithBoundedForce({ client: unreadable.client, workspaceId: "id-seat" });
    const silent = await closeWorkspaceWithBoundedForce({ client: blank.client, workspaceId: "id-seat" });

    expect(unwrap(held)).toEqual({ kind: "held", verdict: "busy" });
    expect(unwrap(blind)).toEqual({ kind: "held", verdict: "unreadable" });
    expect(unwrap(silent)).toEqual({ kind: "held", verdict: "unproven" });
    expect([busy.closeCalls, unreadable.closeCalls, blank.closeCalls]).toEqual([
      [{ workspaceId: "id-seat" }],
      [{ workspaceId: "id-seat" }],
      [{ workspaceId: "id-seat" }],
    ]);
  });

  it("holds a queued line after one read, never forcing past what the seat has yet to run", async () => {
    const fake = fakeClient({ closes: [CONFIRMATION], screen: "esc to interrupt\nPress up to edit queued messages" });

    const closed = await closeWorkspaceWithBoundedForce({ client: fake.client, workspaceId: "id-seat" });

    expect(unwrap(closed)).toEqual({ kind: "held", verdict: "queued" });
    expect(fake.closeCalls).toEqual([{ workspaceId: "id-seat" }]);
    expect(fake.reads()).toBe(1);
  });

  it("returns any other failure unchanged, reading nothing and retrying nothing", async () => {
    const gone = CmuxErrors.callFailed({ cmuxCode: "not_found", message: "gone", method: "workspace.close" });
    const fake = fakeClient({ closes: [gone], screen: IDLE });

    const closed = await closeWorkspaceWithBoundedForce({ client: fake.client, workspaceId: "id-seat" });

    expect(unwrapErr(closed).message).toBe("cmux workspace.close failed (not_found): gone");
    expect(fake.closeCalls).toEqual([{ workspaceId: "id-seat" }]);
    expect(fake.reads()).toBe(0);
  });

  it("returns a failed forced retry as it came, never a third close", async () => {
    const fake = fakeClient({ closes: [CONFIRMATION, CONFIRMATION], screen: IDLE });

    const closed = await closeWorkspaceWithBoundedForce({ client: fake.client, workspaceId: "id-seat" });

    expect(unwrapErr(closed).message).toBe(
      "cmux workspace.close failed (confirmation_required): Workspace has a running process; retry with --force",
    );
    expect(fake.closeCalls).toEqual([{ workspaceId: "id-seat" }, { force: true, workspaceId: "id-seat" }]);
  });
});
