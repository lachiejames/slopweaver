/**
 * {@link awaitClaudeComposer} — the polling shell that decides a `claude` boot on its composer. The decision matrix is
 * `composerProbe.test.ts`'s; this asserts only what the loop reads, when it stops, and what it hands the decision.
 *
 * A hand-written scripted client, never `vi.fn`: each read answers from a sequence that repeats its last entry, and
 * every call is counted so a test asserts exactly how far the loop went.
 */
import { describe, expect, it } from "vitest";

import { EXIT_SIGHTINGS_TO_FAIL } from "../../../cmux/bootSignal.js";
import { awaitClaudeComposer, MAX_COMPOSER_BOOT_POLLS } from "../../../cmux/claudeBootComposer.js";
import type { CmuxClient } from "../../../cmux/client.js";
import { CmuxErrors } from "../../../cmux/errors.js";
import type { CmuxRenderGrid } from "../../../cmux/renderGrid.js";
import { err, ok } from "../../../lib/result.js";

/** A scripted read cmux refuses. */
const REFUSED = Symbol("REFUSED");

/** Claude Code's empty composer: the chevron and a non-breaking space, the cursor after it. */
const EMPTY_COMPOSER: CmuxRenderGrid = {
  columns: 40,
  cursor: { column: 2, row: 0, visible: true },
  rows: 1,
  spans: [{ column: 0, row: 0, styleId: 1, text: "❯ " }],
  styles: [{ bold: false, faint: false, foreground: "#ffffff", id: 1, italic: false }],
};

/** A grid that read and holds no composer — what a zsh prompt left behind draws. */
const NO_COMPOSER: CmuxRenderGrid = { columns: 0, cursor: undefined, rows: 0, spans: [], styles: [] };

const MISSING = "No conversation found with session ID: 0f0f0f0f-0000-4000-8000-000000000001";

const WORKSPACE = { surfaceId: "id-surface-1", workspaceId: "id-workspace-1" } as const;

/**
 * A client answering each screen and grid read from its sequence, repeating the last, and counting every call.
 *
 * @param screens what each plain-text read answers
 * @param grids what each styled-grid read answers
 * @returns the client and its call counts
 */
function scripted({
  screens,
  grids,
}: {
  screens: readonly (string | typeof REFUSED)[];
  grids: readonly (CmuxRenderGrid | typeof REFUSED)[];
}): { client: Pick<CmuxClient, "readScreen" | "readScreenGrid">; counts: { screens: number; grids: number } } {
  const counts = { grids: 0, screens: 0 };
  return {
    client: {
      readScreen: () => {
        const screen = screens[Math.min(counts.screens, screens.length - 1)]!;
        counts.screens += 1;
        return Promise.resolve(
          screen === REFUSED
            ? err(CmuxErrors.terminalTextUnreadable({ detail: "settling", method: "surface.read_text" }))
            : ok(screen),
        );
      },
      readScreenGrid: () => {
        const grid = grids[Math.min(counts.grids, grids.length - 1)]!;
        counts.grids += 1;
        return Promise.resolve(
          grid === REFUSED
            ? err(CmuxErrors.terminalTextUnreadable({ detail: "busy", method: "surface.read_render_grid" }))
            : ok(grid),
        );
      },
    },
    counts,
  };
}

/** A pacing tick that only counts. */
function ticks(): { wait: () => Promise<void>; waited: () => number } {
  let waited = 0;
  return {
    wait: () => {
      waited += 1;
      return Promise.resolve();
    },
    waited: () => waited,
  };
}

describe("awaitClaudeComposer", () => {
  it("answers the composer the first read shows, spending no tick", async () => {
    const { client, counts } = scripted({ grids: [EMPTY_COMPOSER], screens: ["❯ "] });
    const pacing = ticks();

    const decision = await awaitClaudeComposer({
      before: "$ ",
      bootWitnessed: false,
      client,
      wait: pacing.wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "composer", reading: { kind: "empty" } });
    expect({ grids: counts.grids, waited: pacing.waited() }).toEqual({ grids: 1, waited: 0 });
  });

  it("finds a composer that is drawn late, after reads that showed none", async () => {
    const { client, counts } = scripted({ grids: [NO_COMPOSER, NO_COMPOSER, EMPTY_COMPOSER], screens: ["$ "] });

    const decision = await awaitClaudeComposer({
      before: "$ ",
      bootWitnessed: false,
      client,
      wait: ticks().wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "composer", reading: { kind: "empty" } });
    expect(counts.grids).toBe(3);
  });

  it("keeps a witnessed boot whose every grid read failed an unwitnessed success, after the whole bound", async () => {
    const { client, counts } = scripted({ grids: [REFUSED], screens: [REFUSED] });

    const decision = await awaitClaudeComposer({
      before: undefined,
      bootWitnessed: true,
      client,
      wait: ticks().wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "unwitnessed" });
    expect(counts.grids).toBe(MAX_COMPOSER_BOOT_POLLS);
  });

  it("fails a boot no grid read reached and nothing else vouched for", async () => {
    const { client } = scripted({ grids: [REFUSED], screens: ["$ "] });

    const decision = await awaitClaudeComposer({
      before: "$ ",
      bootWitnessed: false,
      client,
      wait: ticks().wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "failed", reason: "never-read" });
  });

  it("fails a surface that read with no composer for the whole bound, even with SessionStart fired", async () => {
    const { client, counts } = scripted({ grids: [NO_COMPOSER], screens: ["$ "] });
    const pacing = ticks();

    const decision = await awaitClaudeComposer({
      before: "$ ",
      bootWitnessed: true,
      client,
      wait: pacing.wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "failed", reason: "readable-without-composer" });
    expect({ grids: counts.grids, waited: pacing.waited() }).toEqual({
      grids: MAX_COMPOSER_BOOT_POLLS,
      waited: MAX_COMPOSER_BOOT_POLLS,
    });
  });

  it("fails on a NEW missing-conversation exit once it stands on two reads with no composer, a tick apart", async () => {
    const { client, counts } = scripted({ grids: [NO_COMPOSER], screens: [`$ claude --resume x\n${MISSING}\n$ `] });
    const pacing = ticks();

    const decision = await awaitClaudeComposer({
      before: "$ ",
      bootWitnessed: true,
      client,
      wait: pacing.wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "failed", reason: "missing-conversation" });
    expect({ grids: counts.grids, screens: counts.screens, waited: pacing.waited() }).toEqual({
      grids: EXIT_SIGHTINGS_TO_FAIL,
      screens: EXIT_SIGHTINGS_TO_FAIL,
      waited: EXIT_SIGHTINGS_TO_FAIL - 1,
    });
  });

  it("boots on the composer the grid shows even while the screen's text reads a column-0 quote as an exit", async () => {
    // The quote is drawn the frame before Claude's chrome, and the grid already holds its composer.
    const { client } = scripted({ grids: [EMPTY_COMPOSER], screens: [`${MISSING}\n⏺ Restoring conversation…`] });

    const decision = await awaitClaudeComposer({
      before: "$ ",
      bootWitnessed: true,
      client,
      wait: ticks().wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "composer", reading: { kind: "empty" } });
  });

  it("never fails on a column-0 quote that reads as an exit for one frame, then gains Claude's chrome", async () => {
    const rule = "─".repeat(40);
    const { client } = scripted({
      grids: [NO_COMPOSER, NO_COMPOSER, EMPTY_COMPOSER],
      screens: [`${MISSING}\n⏺ Restoring conversation…`, `${MISSING}\n${rule}\n❯ \n${rule}`],
    });

    const decision = await awaitClaudeComposer({
      before: "$ ",
      bootWitnessed: true,
      client,
      wait: ticks().wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "composer", reading: { kind: "empty" } });
  });

  it("never fails on two different quotes that each read as an exit for one frame", async () => {
    // Neither line stands across two reads, so the two sightings never add up to an exit.
    const quoted = ({ id }: { id: string }): string => `No conversation found with session ID: ${id}\n⏺ Restoring…`;
    const { client } = scripted({
      grids: [NO_COMPOSER, NO_COMPOSER, NO_COMPOSER, EMPTY_COMPOSER],
      screens: [quoted({ id: "quoted-A" }), quoted({ id: "quoted-B" }), quoted({ id: "quoted-A" })],
    });

    const decision = await awaitClaudeComposer({
      before: "$ ",
      bootWitnessed: true,
      client,
      wait: ticks().wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "composer", reading: { kind: "empty" } });
  });

  it("never counts an exit beside a grid that would not read, which may hold a live composer", async () => {
    // The text shows an exit on every read while every grid read fails.
    const { client, counts } = scripted({ grids: [REFUSED], screens: [`${MISSING}\n⏺ Restoring…`] });

    const decision = await awaitClaudeComposer({
      before: "$ ",
      bootWitnessed: true,
      client,
      wait: ticks().wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "unwitnessed" });
    expect({ grids: counts.grids, screens: counts.screens }).toEqual({ grids: MAX_COMPOSER_BOOT_POLLS, screens: 0 });
  });

  it("never fails on an identical quote printed again below the first", async () => {
    // The second read's lowest line has the first's text, but it is a new line, not one standing.
    const quote = `${MISSING}\n⏺ first quote`;
    const { client } = scripted({
      grids: [NO_COMPOSER, NO_COMPOSER, EMPTY_COMPOSER],
      screens: [quote, `${quote}\n${MISSING}\n⏺ second quote`],
    });

    const decision = await awaitClaudeComposer({
      before: "$ ",
      bootWitnessed: true,
      client,
      wait: ticks().wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "composer", reading: { kind: "empty" } });
  });

  it("never fails on a missing-conversation line when the screen before the boot did not read, leaving it to the grid", async () => {
    const { client, counts } = scripted({ grids: [NO_COMPOSER], screens: [`${MISSING}\n$ `] });

    const decision = await awaitClaudeComposer({
      before: undefined,
      bootWitnessed: true,
      client,
      wait: ticks().wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "failed", reason: "readable-without-composer" });
    expect({ grids: counts.grids, screens: counts.screens }).toEqual({ grids: MAX_COMPOSER_BOOT_POLLS, screens: 0 });
  });

  it("does not count a missing-conversation line already on screen before the boot as this boot's", async () => {
    const { client } = scripted({ grids: [EMPTY_COMPOSER], screens: [`${MISSING}\n❯ `] });

    const decision = await awaitClaudeComposer({
      before: `${MISSING}\n$ `,
      bootWitnessed: false,
      client,
      wait: ticks().wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "composer", reading: { kind: "empty" } });
  });

  it("boots a live session that renders the phrase inside its own transcript, reading its composer", async () => {
    const rule = "─".repeat(40);
    const live = `$ claude\nClaude Code v2.1.287\n${MISSING}\n${rule}\n❯ \n${rule}`;
    const { client } = scripted({ grids: [EMPTY_COMPOSER], screens: [live] });

    const decision = await awaitClaudeComposer({
      before: "$ ",
      bootWitnessed: true,
      client,
      wait: ticks().wait,
      workspace: WORKSPACE,
    });

    expect(decision).toEqual({ kind: "composer", reading: { kind: "empty" } });
  });
});
