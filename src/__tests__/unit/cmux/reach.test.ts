/**
 * `reachSession` — the ORDER of a reach, driven against a hand-built fake client and injected waits.
 *
 * There is no clock and no socket here: `ReachWaits` is a seam the caller passes in, so a test asserts the
 * exact sequence of calls a reach made rather than how long it took. Two properties are pinned, from two
 * incidents:
 *
 * - The first — a line delivered to a session parked mid-turn is REPORTED as queued, and
 *   `--interrupt` stops the turn BEFORE the line goes in rather than after.
 * - The second — a line that TYPED into the composer and never submitted is seen, pressed through
 *   with one bare Enter, and reported `resubmitted` or `stranded` rather than `submitted`.
 *
 * The grids are the REAL frozen `terminal.replay` captures under `src/__tests__/fixtures/composer/`, not
 * hand-built spans: what makes the strand check sound is the FAINT attribute Claude Code draws its own text
 * in, and a hand-built grid would assert the check against a shape the terminal never produced.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CmuxClient } from "../../../cmux/client.js";
import { type CmuxError, CmuxErrors } from "../../../cmux/errors.js";
import { type ReachWaits, reachSession } from "../../../cmux/reach.js";
import { type CmuxRenderGrid, parseRenderGrid } from "../../../cmux/renderGrid.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

/** Every call a reach can make on the client, in the order it made them. */
type Recorded =
  | { readonly op: "interruptTurn" }
  | { readonly op: "readScreen" }
  | { readonly op: "readScreenGrid" }
  | { readonly op: "sendLine" }
  | { readonly op: "submitComposer" };

const FIXTURES = join(import.meta.dirname, "../../fixtures/composer");

/** One frozen `terminal.replay` capture, parsed by the real parser. */
function grid({ shape }: { shape: string }): CmuxRenderGrid {
  const value: unknown = JSON.parse(readFileSync(join(FIXTURES, `${shape}.json`), "utf8"));
  return unwrap(parseRenderGrid({ value }));
}

/** A composer with nothing in it at all — what a screen shows once a submit has taken. */
const EMPTY_GRID: CmuxRenderGrid = {
  columns: 40,
  cursor: { column: 2, row: 0, visible: true },
  rows: 1,
  spans: [{ column: 0, row: 0, styleId: 1, text: "❯ " }],
  styles: [{ bold: false, faint: false, foreground: "#ffffff", id: 1, italic: false }],
};

const IDLE_SCREEN = ["❯ ", "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents"].join("\n");
const RUNNING_SCREEN = ["❯ ", "  ⏵⏵ bypass permissions on · esc to interrupt · ← 3 agents"].join("\n");
const QUEUED_SCREEN = [
  "❯ Press up to edit queued messages",
  "  ⏵⏵ bypass permissions on · esc to interrupt · ← 3 agents",
].join("\n");

/** Waits that record nothing and take no time — the reach's ordering is what matters, never its duration. */
const INSTANT_WAITS: ReachWaits = {
  interruptPoll: () => Promise.resolve(),
  settle: () => Promise.resolve(),
};

/**
 * A fake client answering `readScreen` and `readScreenGrid` from scripted lists, each repeating its last
 * entry once exhausted.
 *
 * @param screens what each successive plain screen read returns, in order
 * @param grids what each successive styled grid read returns, in order — an empty composer by default, which
 *   is the shape of a send that submitted cleanly
 * @param sendFails whether `sendLine` should fail
 * @param submitFailure what `submitComposer` fails with, when it should fail at all
 * @returns the fake client and the call log
 */
function fakeClient({
  screens,
  grids = [EMPTY_GRID],
  sendFails = false,
  submitFailure,
}: {
  screens: readonly (string | undefined)[];
  grids?: readonly CmuxRenderGrid[];
  sendFails?: boolean;
  submitFailure?: CmuxError;
}): { readonly client: CmuxClient; readonly calls: Recorded[] } {
  const calls: Recorded[] = [];
  let read = 0;
  let gridRead = 0;
  const client = {
    close: () => undefined,
    closeWorkspace: () => Promise.resolve(ok(undefined)),
    createWorkspace: () =>
      Promise.resolve(ok({ surfaceId: "s", surfaceRef: "surface:1", workspaceId: "w", workspaceRef: "workspace:1" })),
    identify: () =>
      Promise.resolve(
        ok({ surfaceId: undefined, surfaceRef: undefined, workspaceId: undefined, workspaceRef: undefined }),
      ),
    interruptTurn: () => {
      calls.push({ op: "interruptTurn" });
      return Promise.resolve(ok(undefined));
    },
    listWorkspaces: () => Promise.resolve(ok([])),
    processTree: () => Promise.resolve(ok([])),
    workspaceTop: () => Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [] })),
    readResumeBinding: () => Promise.resolve(ok(undefined)),
    readScreen: () => {
      calls.push({ op: "readScreen" });
      const screen = screens[Math.min(read, screens.length - 1)];
      read += 1;
      return Promise.resolve(
        screen === undefined
          ? err(CmuxErrors.terminalTextUnreadable({ detail: "still settling", method: "surface.read_text" }))
          : ok(screen),
      );
    },
    readScreenGrid: () => {
      calls.push({ op: "readScreenGrid" });
      const value = grids[Math.min(gridRead, grids.length - 1)]!;
      gridRead += 1;
      return Promise.resolve(ok(value));
    },
    pinWorkspace: () => Promise.resolve(ok(undefined)),
    renameWorkspace: () => Promise.resolve(ok(undefined)),
    resolveWorkspace: () =>
      Promise.resolve(err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "n/a", method: "workspace.list" }))),
    sendLine: () => {
      calls.push({ op: "sendLine" });
      return sendFails
        ? Promise.resolve(
            err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "gone", method: "surface.send_text" })),
          )
        : Promise.resolve(ok(undefined));
    },
    submitComposer: () => {
      calls.push({ op: "submitComposer" });
      return Promise.resolve(submitFailure === undefined ? ok(undefined) : err(submitFailure));
    },
    unpinWorkspace: () => Promise.resolve(ok(undefined)),
    listWorkspacesStrict: () => Promise.resolve(ok([])),
    topologyStrict: () => Promise.resolve(ok({ surfacePids: [], workspaceRefs: [] })),
    workspaceSurface: () =>
      Promise.resolve(err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "n/a", method: "pane.list" }))),
  } satisfies CmuxClient;
  return { calls, client };
}

const TARGET = { workspaceId: "id-workspace-1" } as const;

describe("reachSession without --interrupt", () => {
  it("reports a line held behind a running turn as queued, and never reads the composer for it", async () => {
    const { calls, client } = fakeClient({ screens: [QUEUED_SCREEN] });
    const outcome = unwrap(
      await reachSession({ client, interrupt: false, target: TARGET, text: "reach", waits: INSTANT_WAITS }),
    );
    expect(outcome).toEqual({ disposition: "queued", interrupted: false });
    expect(calls).toEqual([{ op: "sendLine" }, { op: "readScreen" }]);
  });

  it("reports a line an idle session accepted as submitted, with the composer empty", async () => {
    const { calls, client } = fakeClient({ screens: [IDLE_SCREEN] });
    const outcome = unwrap(
      await reachSession({ client, interrupt: false, target: TARGET, text: "reach", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("submitted");
    expect(outcome.composer).toEqual({ kind: "empty" });
    expect(calls).toEqual([{ op: "sendLine" }, { op: "readScreen" }, { op: "readScreenGrid" }]);
  });

  it("re-reads once when the first screen read is unreadable, then decides", async () => {
    const { calls, client } = fakeClient({ screens: [undefined, QUEUED_SCREEN] });
    const outcome = unwrap(
      await reachSession({ client, interrupt: false, target: TARGET, text: "reach", waits: INSTANT_WAITS }),
    );
    expect(outcome).toEqual({ disposition: "queued", interrupted: false });
    expect(calls).toEqual([{ op: "sendLine" }, { op: "readScreen" }, { op: "readScreen" }]);
  });

  it("stops at the bounded read count and answers unknown rather than guessing", async () => {
    const { calls, client } = fakeClient({ screens: [undefined] });
    const outcome = unwrap(
      await reachSession({ client, interrupt: false, target: TARGET, text: "reach", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("unknown");
    expect(calls).toEqual([{ op: "sendLine" }, { op: "readScreen" }, { op: "readScreen" }, { op: "readScreenGrid" }]);
  });

  it("surfaces the send's own failure rather than a disposition", async () => {
    const { calls, client } = fakeClient({ screens: [IDLE_SCREEN], sendFails: true });
    const failure = unwrapErr(
      await reachSession({ client, interrupt: false, target: TARGET, text: "reach", waits: INSTANT_WAITS }),
    );
    expect(failure.code).toBe("CALL_FAILED");
    expect(calls).toEqual([{ op: "sendLine" }]);
  });
});

describe("reachSession on a line that never left the composer", () => {
  it("presses ONE bare Enter on a typed composer and reports resubmitted once the box clears", async () => {
    const { calls, client } = fakeClient({
      grids: [grid({ shape: "typed" }), EMPTY_GRID],
      screens: [IDLE_SCREEN],
    });
    const outcome = unwrap(
      await reachSession({ client, interrupt: false, target: TARGET, text: "approved, land it", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("resubmitted");
    expect(outcome.composer).toEqual({ kind: "empty" });
    expect(calls).toEqual([
      { op: "sendLine" },
      { op: "readScreen" },
      { op: "readScreenGrid" },
      { op: "submitComposer" },
      { op: "readScreenGrid" },
    ]);
  });

  it("reports stranded, and does NOT press a second Enter, when the box is still typed after the rescue", async () => {
    const { calls, client } = fakeClient({ grids: [grid({ shape: "typed" })], screens: [IDLE_SCREEN] });
    const outcome = unwrap(
      await reachSession({ client, interrupt: false, target: TARGET, text: "approved, land it", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("stranded");
    expect(outcome.composer).toEqual({ kind: "typed", text: "approved, land it" });
    expect(calls.filter((call) => call.op === "submitComposer")).toHaveLength(1);
    expect(calls).toEqual([
      { op: "sendLine" },
      { op: "readScreen" },
      { op: "readScreenGrid" },
      { op: "submitComposer" },
      { op: "readScreenGrid" },
    ]);
  });

  it("reports stranded without re-reading when the Enter itself is refused", async () => {
    const { calls, client } = fakeClient({
      grids: [grid({ shape: "typed" })],
      screens: [IDLE_SCREEN],
      submitFailure: CmuxErrors.callFailed({
        cmuxCode: "internal_error",
        message: "key refused",
        method: "surface.send_key",
      }),
    });
    const outcome = unwrap(
      await reachSession({ client, interrupt: false, target: TARGET, text: "approved, land it", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("stranded");
    expect(outcome.composer).toEqual({
      kind: "unreadable",
      reason: "the composer could not be submitted: cmux surface.send_key failed (internal_error): key refused",
    });
    expect(calls).toEqual([
      { op: "sendLine" },
      { op: "readScreen" },
      { op: "readScreenGrid" },
      { op: "submitComposer" },
    ]);
  });

  it("reports unknown, never stranded, when the Enter's reply was lost and cmux may have submitted the line", async () => {
    const { calls, client } = fakeClient({
      grids: [grid({ shape: "typed" })],
      screens: [IDLE_SCREEN],
      submitFailure: CmuxErrors.socketUnavailable({ detail: "connection reset", socketPath: "/tmp/cmux.sock" }),
    });
    const outcome = unwrap(
      await reachSession({ client, interrupt: false, target: TARGET, text: "approved, land it", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("unknown");
    expect(outcome.composer).toEqual({
      kind: "unreadable",
      reason:
        "the composer could not be submitted: cmux control socket unavailable at /tmp/cmux.sock: connection reset",
    });
    expect(calls).toEqual([
      { op: "sendLine" },
      { op: "readScreen" },
      { op: "readScreenGrid" },
      { op: "submitComposer" },
    ]);
  });

  it("reports unknown when the Enter timed out", async () => {
    const { client } = fakeClient({
      grids: [grid({ shape: "typed" })],
      screens: [IDLE_SCREEN],
      submitFailure: CmuxErrors.timedOut({ method: "surface.send_key", timeoutMs: 5000 }),
    });
    const outcome = unwrap(
      await reachSession({ client, interrupt: false, target: TARGET, text: "approved, land it", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("unknown");
  });

  it("never presses Enter on a SUGGESTION Claude Code wrote itself", async () => {
    const { calls, client } = fakeClient({ grids: [grid({ shape: "suggestion" })], screens: [IDLE_SCREEN] });
    const outcome = unwrap(
      await reachSession({ client, interrupt: false, target: TARGET, text: "reach", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("submitted");
    expect(outcome.composer?.kind).toBe("suggestion");
    expect(calls).toEqual([{ op: "sendLine" }, { op: "readScreen" }, { op: "readScreenGrid" }]);
  });

  it("never presses Enter on the empty-session PLACEHOLDER", async () => {
    const { calls, client } = fakeClient({ grids: [grid({ shape: "placeholder" })], screens: [IDLE_SCREEN] });
    const outcome = unwrap(
      await reachSession({ client, interrupt: false, target: TARGET, text: "reach", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("submitted");
    expect(outcome.composer?.kind).toBe("placeholder");
    expect(calls).toEqual([{ op: "sendLine" }, { op: "readScreen" }, { op: "readScreenGrid" }]);
  });
});

describe("reachSession with --interrupt", () => {
  it("interrupts a running turn BEFORE sending, then reports the line submitted", async () => {
    const { calls, client } = fakeClient({ screens: [RUNNING_SCREEN, IDLE_SCREEN, IDLE_SCREEN] });
    const outcome = unwrap(
      await reachSession({ client, interrupt: true, target: TARGET, text: "reach", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("submitted");
    expect(outcome.interrupted).toBe(true);
    expect(calls).toEqual([
      { op: "readScreen" },
      { op: "interruptTurn" },
      { op: "readScreen" },
      { op: "sendLine" },
      { op: "readScreen" },
      { op: "readScreenGrid" },
    ]);
  });

  it("interrupts nothing when no turn is running", async () => {
    const { calls, client } = fakeClient({ screens: [IDLE_SCREEN] });
    const outcome = unwrap(
      await reachSession({ client, interrupt: true, target: TARGET, text: "reach", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("submitted");
    expect(outcome.interrupted).toBe(false);
    expect(calls).toEqual([{ op: "readScreen" }, { op: "sendLine" }, { op: "readScreen" }, { op: "readScreenGrid" }]);
  });

  it("interrupts nothing on an unreadable screen, so no mid-step work is discarded on a guess", async () => {
    const { calls, client } = fakeClient({ screens: [undefined] });
    const outcome = unwrap(
      await reachSession({ client, interrupt: true, target: TARGET, text: "reach", waits: INSTANT_WAITS }),
    );
    expect(outcome.disposition).toBe("unknown");
    expect(outcome.interrupted).toBe(false);
    expect(calls).toEqual([
      { op: "readScreen" },
      { op: "sendLine" },
      { op: "readScreen" },
      { op: "readScreen" },
      { op: "readScreenGrid" },
    ]);
  });

  it("delivers anyway when the turn never visibly stops, after a bounded five polls", async () => {
    // One pre-send check plus five settle polls all still busy, then the line lands behind that same turn.
    const { calls, client } = fakeClient({
      screens: [...Array.from({ length: 6 }, () => RUNNING_SCREEN), QUEUED_SCREEN],
    });
    const outcome = unwrap(
      await reachSession({ client, interrupt: true, target: TARGET, text: "reach", waits: INSTANT_WAITS }),
    );
    expect(outcome).toEqual({ disposition: "queued", interrupted: true });
    expect(calls).toEqual([
      { op: "readScreen" },
      { op: "interruptTurn" },
      ...Array.from({ length: 5 }, () => ({ op: "readScreen" })),
      { op: "sendLine" },
      { op: "readScreen" },
    ]);
  });
});
