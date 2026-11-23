/**
 * `handover park`'s seat choice over a plain fake cmux client: the run's seat is found by its tree, a foreign seat
 * mid-turn is refused unless the park hatch is open, and a failed list is a cmux failure nothing was journalled for.
 */
import { describe, expect, it } from "vitest";

import { chooseSeat, judgeSeat } from "../../../../../cli/commands/handover/parkChooseSeat.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { fakeClient } from "../session/closeDoneFakeCmux.js";
import { workspace } from "../session/closeDoneHarness.js";

const TREE = "/w/.claude/worktrees/a-doc";
const SEAT = workspace({ currentDirectory: TREE, workspaceId: "id-7", workspaceRef: "workspace:7" });
const RUNNING = ["✻ Vibing… (19s · ↓ 140 tokens)", "❯ ", "  ⏵⏵ bypass permissions on · esc to interrupt"].join("\n");
const PLAN = { runTree: TREE, seatHost: "claude-code" as const };

describe("chooseSeat", () => {
  it("picks the seat standing in the run's tree and carries the screen it read", async () => {
    const { client } = fakeClient({ screens: { "id-7": RUNNING }, workspaces: [SEAT] });
    const chosen = await chooseSeat({
      callerWorkspaceId: "id-7",
      client,
      plan: PLAN,
      requested: undefined,
      runningSeatHatchOpen: () => false,
    });
    expect(unwrap(chosen)).toEqual({ forced: false, screen: RUNNING, seat: SEAT });
  });

  it("is a cmux failure, not journalled, when the workspace list fails", async () => {
    const { client } = fakeClient({ listFailsAfter: 1, workspaces: [SEAT] });
    const chosen = await chooseSeat({
      callerWorkspaceId: undefined,
      client,
      plan: PLAN,
      requested: undefined,
      runningSeatHatchOpen: () => false,
    });
    expect(unwrapErr(chosen)).toMatchObject({ journalled: false, kind: "cmux" });
  });
});

describe("judgeSeat", () => {
  it("refuses a foreign seat mid-turn while the park hatch is closed", async () => {
    const { client } = fakeClient({ screens: { "id-7": RUNNING }, workspaces: [SEAT] });
    const judged = await judgeSeat({
      callerWorkspaceId: undefined,
      client,
      plan: PLAN,
      runningSeatHatchOpen: () => false,
      seat: SEAT,
    });
    expect(unwrapErr(judged)).toMatchObject({ kind: "mid-turn", workspaceRef: "workspace:7" });
  });

  it("lets the open park hatch close a foreign seat mid-turn, and says it was forced", async () => {
    const { client } = fakeClient({ screens: { "id-7": RUNNING }, workspaces: [SEAT] });
    const judged = await judgeSeat({
      callerWorkspaceId: undefined,
      client,
      plan: PLAN,
      runningSeatHatchOpen: () => true,
      seat: SEAT,
    });
    expect(unwrap(judged).forced).toBe(true);
  });

  it("asks the park hatch only after the screen read resolves, never before it", async () => {
    const { client } = fakeClient({ screens: { "id-7": RUNNING }, workspaces: [SEAT] });
    let screenRead = false;
    const watched: typeof client = {
      ...client,
      readScreen: async (args) => {
        const screen = await client.readScreen(args);
        screenRead = true;
        return screen;
      },
    };
    const judged = await judgeSeat({
      callerWorkspaceId: undefined,
      client: watched,
      plan: PLAN,
      runningSeatHatchOpen: () => screenRead,
      seat: SEAT,
    });
    expect(unwrap(judged).forced).toBe(true);
  });

  it("refuses the pinned chair even with the park hatch open", async () => {
    const pinned = { ...SEAT, pinned: true };
    const { client } = fakeClient({ screens: { "id-7": RUNNING }, workspaces: [pinned] });
    const judged = await judgeSeat({
      callerWorkspaceId: undefined,
      client,
      plan: PLAN,
      runningSeatHatchOpen: () => true,
      seat: pinned,
    });
    expect(unwrapErr(judged)).toEqual({ kind: "pinned", workspaceRef: "workspace:7" });
  });
});
