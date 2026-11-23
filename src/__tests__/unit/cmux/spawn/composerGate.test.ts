/** The composer gate, judged on REAL frozen `terminal.replay` grids: no spawn returns with its pickup still typed. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_COMPOSER_CLEAR_POLLS } from "../../../../cmux/pickupComposerConfirm.js";
import { MAX_PICKUP_ENTERS, pickupEnterSpacing } from "../../../../cmux/pickupComposerGate.js";
import { MAX_CLAUDE_LIMIT_POLLS } from "../../../../cmux/pickupDelivery.js";
import { MAX_RESUBMIT_VERIFY_POLLS, MAX_SEND_VERIFY_POLLS } from "../../../../cmux/pickupWitnessWindow.js";
import { type CmuxRenderGrid, parseRenderGrid } from "../../../../cmux/renderGrid.js";
import { spawnCmuxSession } from "../../../../cmux/spawn.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { fakeClient, NO_COMPOSER_GRID, UNREADABLE } from "./fakeClient.js";
import { deps, PLAN } from "./harness.js";

const COMPOSER_FIXTURES = join(import.meta.dirname, "../../../fixtures/composer");

/**
 * One REAL frozen `terminal.replay` capture under `fixtures/composer/`, parsed by the real parser — what makes
 * the gate sound is the attribute Claude Code draws each kind of text in, and a hand-built grid would assert it
 * against a shape the terminal never produced.
 */
function composerFixture({ shape }: { shape: "typed" | "suggestion" | "placeholder" }): CmuxRenderGrid {
  const value: unknown = JSON.parse(readFileSync(join(COMPOSER_FIXTURES, `${shape}.json`), "utf8"));
  return unwrap(parseRenderGrid({ value }));
}

/** A pickup typed into the composer and never submitted. */
const TYPED_GRID: CmuxRenderGrid = composerFixture({ shape: "typed" });

/** A composer with nothing in it — what the box shows once a submit has taken. */
const EMPTY_GRID: CmuxRenderGrid = {
  columns: 40,
  cursor: { column: 2, row: 0, visible: true },
  rows: 1,
  spans: [{ column: 0, row: 0, styleId: 1, text: "❯ " }],
  styles: [{ bold: false, faint: false, foreground: "#ffffff", id: 1, italic: false }],
};

describe("the composer gate — no spawn returns with its pickup still typed in the box", () => {
  // Spawns each returned success and sat for over an hour with the pickup typed and unsubmitted. These screens are the two shapes a spawn can reach the gate in: a witness that said yes
  // (the screen shows the pickup on the prompt line), and a chain that saw nothing and already pressed Enter.
  const WITNESSED_SCREENS = ["$ ", "Claude Code v2.1.231 booting…", `❯ ${PLAN.pickupCommand}`];
  const UNWITNESSED_SCREENS = ["$ ", "Claude Code v2.1.231 booting…", "❯ "];
  /** One settle window of a box still holding the line. */
  const TYPED_WINDOW = Array<CmuxRenderGrid>(MAX_COMPOSER_CLEAR_POLLS).fill(TYPED_GRID);
  const STRANDED_REASON =
    "the pickup is still TYPED, unsubmitted in workspace:1's composer — 4 Enters were pressed with nothing " +
    "re-typed, and the line was not seen to leave it — so the seat is running nothing; press it through with " +
    "`slopweaver cmux submit --workspace workspace:1` and read the screen, never re-send the line " +
    "(composer: approved, land it)";
  /** The Enters the composer gate itself may press once a witness answered over `sendLine`'s one. */
  const GATE_ENTERS = MAX_PICKUP_ENTERS - 1;

  it("presses an Enter when a witness said yes over a box still holding the line, and reports it resubmitted by the composer", async () => {
    // Typed on every read of the settle window, so the box is genuinely holding the line; empty after the Enter.
    const grids = [...Array<CmuxRenderGrid>(MAX_COMPOSER_CLEAR_POLLS).fill(TYPED_GRID), EMPTY_GRID];
    const { calls, client } = fakeClient({ grids, screens: WITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "resubmitted", witness: { by: "composer", confirmed: true } });
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(1);
    // The line itself was typed once — the boot line, then the pickup — and the rescue typed nothing.
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(2);
  });

  // A box a booting session ignores one Enter on takes a later one (a hand submit, a chair `go`), so
  // the gate presses again after a full settle window rather than leaving that Enter to the chair.
  it("presses again after a settle window, and reports resubmitted by the composer when the third Enter takes", async () => {
    const grids = [...TYPED_WINDOW, ...TYPED_WINDOW, ...TYPED_WINDOW, EMPTY_GRID];
    const { calls, client } = fakeClient({ grids, screens: WITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "resubmitted", witness: { by: "composer", confirmed: true } });
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(3);
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(2);
  });

  it("refuses, naming the workspace and the Enters spent, when the box still holds the line after the budget", async () => {
    const { calls, client } = fakeClient({ grids: [TYPED_GRID], screens: WITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const failure = unwrapErr(await spawnCmuxSession({ deps: spawnDeps, plan: PLAN }));

    expect(failure.workspaceRef).toBe("workspace:1");
    expect(failure.reason).toBe(STRANDED_REASON);
    expect(failure.strandedInComposer).toBe(true);
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(GATE_ENTERS);
  });

  // A counterexample: a box positively read `typed`, an Enter, then a grid that will not read.
  // Not knowing is no evidence the line left, so the spawn refuses rather than claiming the box emptied.
  it("refuses when the grid stops reading after an Enter over a box last seen holding the line", async () => {
    const grids: readonly (CmuxRenderGrid | typeof UNREADABLE)[] = [...TYPED_WINDOW, UNREADABLE];
    const { calls, client } = fakeClient({ grids, screens: WITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const failure = unwrapErr(await spawnCmuxSession({ deps: spawnDeps, plan: PLAN }));

    expect(failure.reason).toBe(STRANDED_REASON);
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(GATE_ENTERS);
    expect(calls.filter((call) => call.op === "readScreenGrid").length).toBe(
      (GATE_ENTERS + 1) * MAX_COMPOSER_CLEAR_POLLS,
    );
  });

  it("still presses an Enter when a read fails between two that saw the line typed", async () => {
    const grids: readonly (CmuxRenderGrid | typeof UNREADABLE)[] = [
      TYPED_GRID,
      UNREADABLE,
      ...TYPED_WINDOW,
      EMPTY_GRID,
    ];
    const { calls, client } = fakeClient({ grids, screens: WITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "resubmitted", witness: { by: "composer", confirmed: true } });
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(1);
  });

  // Measured on cmux 0.65.2: `sendLine`'s Enter left the box typed on 4 seats of 4, and a bare Enter 2.2 s
  // later took every time. The window presses it on the second tick rather than after thirty blind ones.
  it("presses one early Enter inside the first window on a box read typed, and reports resubmitted when it empties", async () => {
    const { calls, client } = fakeClient({ grids: [TYPED_GRID, TYPED_GRID, EMPTY_GRID], screens: UNWITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "resubmitted", witness: { by: "composer", confirmed: true } });
    // The early Enter alone — no blind resubmit after a window that read the box — and the line typed once.
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(1);
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(2);
    // before + one boot tick + one readiness tick, then three window ticks, not thirty.
    expect(calls.filter((call) => call.op === "readScreen").length).toBe(3 + 3 + MAX_CLAUDE_LIMIT_POLLS);
  });

  it("reports the pickup witnessed by a running turn when the footer shows one right after the early Enter", async () => {
    const screens = [
      "$ ",
      "Claude Code v2.1.231 booting…",
      "❯ ",
      "❯ ",
      "❯ ",
      "⏵⏵ bypass permissions on · esc to interrupt",
    ];
    const { calls, client } = fakeClient({ grids: [TYPED_GRID, TYPED_GRID, EMPTY_GRID], screens });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "resubmitted", witness: { by: "running-turn", confirmed: true } });
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(1);
  });

  it("spaces each early Enter further than the last and stops at the budget, refusing with the box still typed", async () => {
    const { calls, client } = fakeClient({ grids: [TYPED_GRID], screens: UNWITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const failure = unwrapErr(await spawnCmuxSession({ deps: spawnDeps, plan: PLAN }));
    const ticksToSpend = [1, 2, 3, 4].reduce((sum, entersSpent) => sum + pickupEnterSpacing({ entersSpent }), 0);

    expect(failure.workspaceRef).toBe("workspace:1");
    expect(failure.reason).toBe(STRANDED_REASON);
    expect(failure.strandedInComposer).toBe(true);
    // `sendLine`'s, then three early ones — no blind resubmit, and the gate has none left to press.
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(MAX_PICKUP_ENTERS - 1);
    expect(calls.filter((call) => call.op === "readScreenGrid").length).toBe(ticksToSpend + MAX_COMPOSER_CLEAR_POLLS);
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(2);
  });

  it("refuses at once, naming the workspace, when cmux refuses an early Enter on a box read typed", async () => {
    const { calls, client } = fakeClient({ grids: [TYPED_GRID], screens: UNWITNESSED_SCREENS, submitFails: true });
    const { deps: spawnDeps } = deps({ client });

    const failure = unwrapErr(await spawnCmuxSession({ deps: spawnDeps, plan: PLAN }));

    expect(failure.reason).toContain(
      "workspace:1's composer — Enter 2 of 4 was refused (cmux surface.send_key failed (not_found): surface gone)",
    );
    expect(failure.strandedInComposer).toBe(true);
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(1);
  });

  // The incident's other half: the chair saw seats idle "at an EMPTY prompt" while `cmux spawn` exited 0.
  it("refuses, keeping the seat open, when nothing saw the pickup submitted and the box reads empty", async () => {
    const { calls, client } = fakeClient({ grids: [EMPTY_GRID], screens: UNWITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const failure = unwrapErr(await spawnCmuxSession({ deps: spawnDeps, plan: PLAN }));

    expect(failure.workspaceRef).toBe("workspace:1");
    expect(failure.pickupSubmissionUnproven).toBe(true);
    expect(failure.strandedInComposer).toBe(undefined);
    expect(failure.reason).toBe(
      "nothing saw the pickup submitted in workspace:1 — no prompt-submit event, no delivery record naming it, " +
        "no running turn — and its composer does not hold the line (composer: empty), so the seat may be idle " +
        "at its prompt with no pickup; read it with `slopweaver cmux read-screen --workspace workspace:1` before " +
        "anything else — a queued pickup is invisible to every witness here, so a second send on a guess is the " +
        "duplicate-pickup failure",
    );
    // The blind resubmit only; the line itself typed once and the workspace never closed.
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(1);
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(2);
    expect(calls.filter((call) => call.op === "closeWorkspace").length).toBe(0);
  });

  // A counterexample: the box first reads typed on the window's LAST tick, so its early Enter
  // ends the window and only the gate's read sees the box empty. That typed-then-empty is the witness.
  it("reports resubmitted by the composer when an early Enter on the window's last tick empties the box", async () => {
    const grids = [...Array<CmuxRenderGrid>(MAX_SEND_VERIFY_POLLS - 1).fill(EMPTY_GRID), TYPED_GRID, EMPTY_GRID];
    const { calls, client } = fakeClient({ grids, screens: UNWITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "resubmitted", witness: { by: "composer", confirmed: true } });
    // The early Enter alone: no blind resubmit after a window that pressed, and the gate pressed nothing.
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(1);
    expect(calls.filter((call) => call.op === "sendLine").length).toBe(2);
  });

  it("refuses at once, naming the workspace, when cmux refuses one of the gate's Enters", async () => {
    const { calls, client } = fakeClient({ grids: [TYPED_GRID], screens: WITNESSED_SCREENS, submitFails: true });
    const { deps: spawnDeps } = deps({ client });

    const failure = unwrapErr(await spawnCmuxSession({ deps: spawnDeps, plan: PLAN }));

    expect(failure.reason).toContain(
      "workspace:1's composer — Enter 2 of 4 was refused (cmux surface.send_key failed (not_found): surface gone)",
    );
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(1);
  });

  it("leaves a witnessed delivery untouched, pressing nothing, when the box is empty", async () => {
    const { calls, client } = fakeClient({ grids: [EMPTY_GRID], screens: WITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "witnessed", witness: { by: "screen", confirmed: true } });
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(0);
    expect(calls.filter((call) => call.op === "readScreenGrid").length).toBe(1);
  });

  it("waits out a box that empties on a later read rather than pressing Enter on a submit still taking", async () => {
    const { calls, client } = fakeClient({ grids: [TYPED_GRID, TYPED_GRID, EMPTY_GRID], screens: WITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "witnessed", witness: { by: "screen", confirmed: true } });
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(0);
  });

  it("never presses Enter on Claude Code's own faint suggestion or placeholder", async () => {
    const suggestion = fakeClient({ grids: [composerFixture({ shape: "suggestion" })], screens: WITNESSED_SCREENS });
    const placeholder = fakeClient({ grids: [composerFixture({ shape: "placeholder" })], screens: WITNESSED_SCREENS });

    const outcomes = [
      await spawnCmuxSession({ deps: deps({ client: suggestion.client }).deps, plan: PLAN }),
      await spawnCmuxSession({ deps: deps({ client: placeholder.client }).deps, plan: PLAN }),
    ];

    expect(outcomes.map((outcome) => unwrap(outcome).delivery.kind)).toEqual(["witnessed", "witnessed"]);
    expect([...suggestion.calls, ...placeholder.calls].filter((call) => call.op === "submitComposer").length).toBe(0);
  });

  it("refuses before any usage-limit banner poll — a stranded seat is not read for a banner it never reached", async () => {
    const { calls, client } = fakeClient({ grids: [TYPED_GRID], screens: UNWITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    // before + one boot tick + one readiness tick + the ticks the window spent its Enters in, and not one
    // banner read after them.
    const ticksToSpend = [1, 2, 3, 4].reduce((sum, entersSpent) => sum + pickupEnterSpacing({ entersSpent }), 0);
    expect(calls.filter((call) => call.op === "readScreen").length).toBe(3 + ticksToSpend);
    expect(calls.filter((call) => call.op === "closeWorkspace").length).toBe(0);
  });

  it("never refuses on a box it cannot read — an unwitnessed delivery stays an honest unwitnessed success", async () => {
    const { calls, client } = fakeClient({ grids: [NO_COMPOSER_GRID], screens: UNWITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    const outcome = await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(unwrap(outcome).delivery).toEqual({ kind: "unwitnessed" });
    // A box the window never read keeps the blind resubmit, and both whole windows.
    expect(calls.filter((call) => call.op === "submitComposer").length).toBe(1);
    expect(calls.filter((call) => call.op === "readScreen").length).toBe(
      3 + MAX_SEND_VERIFY_POLLS + MAX_RESUBMIT_VERIFY_POLLS + MAX_CLAUDE_LIMIT_POLLS,
    );
  });

  it("spends one bounded settle window before the first Enter and after each one, never an open-ended wait", async () => {
    const { calls, client } = fakeClient({ grids: [TYPED_GRID], screens: WITNESSED_SCREENS });
    const { deps: spawnDeps } = deps({ client });

    await spawnCmuxSession({ deps: spawnDeps, plan: PLAN });

    expect(calls.filter((call) => call.op === "readScreenGrid").length).toBe(
      (GATE_ENTERS + 1) * MAX_COMPOSER_CLEAR_POLLS,
    );
  });
});
