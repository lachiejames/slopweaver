/** Seat recovery's pure half: the two wall detectors, which screens are read, and how each walled seat is placed. */
import { describe, expect, it } from "vitest";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import {
  detectSeatWall,
  type NonRespawnableSeat,
  planSeatRecovery,
  type RespawnableSeat,
  renderSeatRecoveryOutcome,
  renderSeatRecoverySummary,
  SEAT_WALL_TAIL_LINES,
  type SeatWall,
  screenShowsLoggedOut,
  seatRecoveryScreenTargets,
} from "../../../sessions/seatRecovery.js";
import type { SessionItem } from "../../../sessions/session.js";

/** The banner measured on `workspace:9`, under Claude Code's prompt box. */
const LOGGED_OUT_SCREEN = [
  "╭────────────────────────────────────────╮",
  "│ >                                      │",
  "╰────────────────────────────────────────╯",
  "  Not logged in · Please run /login",
].join("\n");

/**
 * The banner as Claude Code 2.1.289 drew it, read off a seat booted with an empty `CLAUDE_CONFIG_DIR`:
 * right-aligned on the mode row under the prompt, rather than a line of its own.
 */
const RIGHT_ALIGNED_SCREEN = [
  "───────────────────────────────────────────────────────────────────────────────────────────────────",
  "❯ ",
  "───────────────────────────────────────────────────────────────────────────────────────────────────",
  "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents                  Not logged in · Run /login",
].join("\n");

/** The same banner on its own row above the prompt box, as a walled chair drew it. */
const ABOVE_RULE_SCREEN = [
  "⏺ Understood. I will wait for the reoriented instruction and run exactly that command with its",
  "  attempt id.",
  "                                                                       Not logged in · Run /login",
  "───────────────────────────────────────────────────────────────────────────────────────────────────",
  "❯ ",
  "───────────────────────────────────────────────────────────────────────────────────────────────────",
  "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents",
].join("\n");

/** The retry line two bot workers rendered byte for byte (`claude/limitBanner.ts`). */
const LIMIT_LINE = "✻ Weekly limit reached · Retrying in 5h (Sep 13 at 8am) · attempt 1/300";

/** A limit-walled seat: the spinner line above the prompt box. */
const LIMIT_SCREEN = [
  LIMIT_LINE,
  "",
  "╭────────────────────────────────────────╮",
  "│ >                                      │",
  "╰────────────────────────────────────────╯",
  "  ? for shortcuts",
].join("\n");

const LOGGED_OUT_WALL: SeatWall = { kind: "logged-out" };
const LIMIT_WALL: SeatWall = { banner: LIMIT_LINE, kind: "limit-retrying" };

/** One live workspace as `cmux list` reports it. */
function workspace(over: Partial<CmuxWorkspaceSummary> = {}): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/w/.claude/worktrees/a-doc",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: "a doc",
    windowId: "window:1",
    workspaceId: "id-1",
    workspaceRef: "workspace:1",
    ...over,
  };
}

/** One open, slug-backed ledger row pinned to opus. */
function row(over: Partial<SessionItem> = {}): SessionItem {
  return {
    bootModel: { kind: "pinned", model: "opus" },
    cwd: "/w/.claude/worktrees/a-doc",
    lastEventIso: "2026-09-19T09:00:00.000Z",
    sessionKey: "a-doc",
    slug: "a-doc",
    spawnedIso: "2026-09-19T09:00:00.000Z",
    status: "open",
    workspaceRef: "workspace:1010",
    ...over,
  };
}

/** The plan for one walled workspace `id-9`, renumbered to `workspace:9`, over one row. */
function planOne({
  wall,
  over = {},
}: {
  wall: SeatWall;
  over?: Partial<SessionItem>;
}): ReturnType<typeof planSeatRecovery> {
  return planSeatRecovery({
    rows: [row(over)],
    wallsByWorkspaceId: new Map([["id-9", wall]]),
    workspaces: [workspace({ workspaceId: "id-9", workspaceRef: "workspace:9" })],
  });
}

describe("screenShowsLoggedOut", () => {
  it("reads the measured banner as logged out", () => {
    expect(screenShowsLoggedOut({ screen: LOGGED_OUT_SCREEN })).toBe(true);
  });

  it("rejoins a login banner a narrow pane hard-wrapped onto the next row", () => {
    const screen = [
      "╭────────────────╮",
      "│ >              │",
      "╰────────────────╯",
      "  Not logged in ·",
      "Please run /login",
    ];
    expect(screenShowsLoggedOut({ screen: screen.join("\n") })).toBe(true);
  });

  it("rejoins a login banner wrapped across three rows by a narrower pane", () => {
    const screen = ["╭──────────╮", "│ >        │", "╰──────────╯", "  Not logged", "in · Please", "run /login"];
    expect(screenShowsLoggedOut({ screen: screen.join("\n") })).toBe(true);
  });

  it("does not read a signed-in prompt as logged out", () => {
    expect(screenShowsLoggedOut({ screen: "│ > \n  ? for shortcuts" })).toBe(false);
  });

  it("reads the banner Claude Code 2.1.289 right-aligns on the mode row as logged out", () => {
    expect(screenShowsLoggedOut({ screen: RIGHT_ALIGNED_SCREEN })).toBe(true);
  });

  it("does not read a mode row that mentions the banner mid-row, with no padding before it", () => {
    const screen = ["─────", "❯ ", "─────", "  ⏵⏵ auto mode on · Not logged in · Run /login is the old wall"];
    expect(screenShowsLoggedOut({ screen: screen.join("\n") })).toBe(false);
  });

  it("reads the banner 2.1.289 moves onto its own row above the prompt box when the mode row is full", () => {
    expect(screenShowsLoggedOut({ screen: ABOVE_RULE_SCREEN })).toBe(true);
  });

  it("does not read an indented transcript quote of the banner, standing alone above the prompt box", () => {
    const rule = "────────────────────";
    const screen = [
      "⏺ The exact banner text was:",
      "        Not logged in · Run /login",
      rule,
      "❯ ",
      rule,
      "  ⏵⏵ auto mode on",
    ];
    expect(screenShowsLoggedOut({ screen: screen.join("\n") })).toBe(false);
  });

  it("does not read a transcript row quoting the banner above the prompt box", () => {
    const screen = [
      "  Not logged in · Run /login is what the seat showed",
      "─────",
      "❯ ",
      "─────",
      "  ⏵⏵ auto mode on",
    ];
    expect(screenShowsLoggedOut({ screen: screen.join("\n") })).toBe(false);
  });
});

describe("detectSeatWall", () => {
  it("reads the measured login banner as a logged-out wall", () => {
    expect(detectSeatWall({ screen: LOGGED_OUT_SCREEN })).toStrictEqual({ kind: "logged-out" });
  });

  it("reads the measured weekly-limit retry line as a limit wall, carrying the line exactly", () => {
    expect(detectSeatWall({ screen: LIMIT_SCREEN })).toStrictEqual({ banner: LIMIT_LINE, kind: "limit-retrying" });
  });

  it("reads a healthy working screen as no wall", () => {
    expect(detectSeatWall({ screen: "⏺ Reading src/sessions/seatRecovery.ts\n│ > \n  ? for shortcuts" })).toBe(
      undefined,
    );
  });

  it("reads an unreadable screen as no wall — the shell reports the read failure itself", () => {
    expect(detectSeatWall({ screen: undefined })).toBe(undefined);
  });

  it("names the login wall when a screen somehow shows both", () => {
    expect(detectSeatWall({ screen: `${LIMIT_SCREEN}\n  Not logged in · Please run /login` })).toStrictEqual({
      kind: "logged-out",
    });
  });

  it("ignores the login banner quoted far above the prompt, in a transcript that is discussing it", () => {
    const quoted = [
      "⏺ the seat showed: Not logged in · Please run /login",
      ...Array.from({ length: SEAT_WALL_TAIL_LINES }, (_, index) => `line ${String(index)}`),
    ].join("\n");
    expect(detectSeatWall({ screen: quoted })).toBe(undefined);
  });

  it("ignores the limit line quoted far above the prompt, in a transcript that is discussing it", () => {
    const quoted = [
      `⏺ two seats sat on: ${LIMIT_LINE}`,
      ...Array.from({ length: SEAT_WALL_TAIL_LINES }, (_, index) => `line ${String(index)}`),
    ].join("\n");
    expect(detectSeatWall({ screen: quoted })).toBe(undefined);
  });

  it("ignores the login banner quoted just ABOVE the live prompt, inside the tail", () => {
    const quoted = [
      "⏺ The previous report quoted:",
      "  Not logged in · Please run /login",
      "╭────────────────────────╮",
      "│ >                      │",
      "╰────────────────────────╯",
      "  ? for shortcuts",
    ].join("\n");
    expect(detectSeatWall({ screen: quoted })).toBe(undefined);
  });

  it("ignores the limit line quoted just above the live prompt, bulleted or indented", () => {
    const quoted = [`⏺ ${LIMIT_LINE}`, `  ${LIMIT_LINE}`, "│ >                      │", "  ? for shortcuts"].join("\n");
    expect(detectSeatWall({ screen: quoted })).toBe(undefined);
  });

  it("reads no login wall when transcript lines stand below the prompt — not the measured shape", () => {
    expect(detectSeatWall({ screen: "│ > │\n⏺ Quoted banner:\n  Not logged in · Please run /login" })).toBe(undefined);
  });

  it("reads no login wall on a screen with no prompt line — whatever it is, it is not a Claude Code prompt", () => {
    expect(detectSeatWall({ screen: "  Not logged in · Please run /login" })).toBe(undefined);
  });

  it("reads the spinner under an echoed pickup prompt and above the live one, as a spawned seat draws it", () => {
    const screen = ["❯ slopweaver handover resume a-doc", LIMIT_LINE, "────────", "❯ ", "────────", "  ⏵⏵ bypass"].join(
      "\n",
    );
    expect(detectSeatWall({ screen })).toStrictEqual({ banner: LIMIT_LINE, kind: "limit-retrying" });
  });

  it("reads no limit wall from a column-0 quote that is not a spinner glyph", () => {
    const screen = [
      "# Weekly limit reached · Retrying in 5h (quoted example)",
      "╭────────────────────╮",
      "│ >                  │",
      "╰────────────────────╯",
      "  ? for shortcuts",
    ].join("\n");
    expect(detectSeatWall({ screen })).toBe(undefined);
  });

  it("reads no limit wall from a `* ` bullet quoting the banner without the retry counter", () => {
    const screen = ["* Weekly limit reached · Retrying in 5h (quoted example)", "────────", "❯ ", "────────"].join(
      "\n",
    );
    expect(detectSeatWall({ screen })).toBe(undefined);
  });

  it("reads no limit wall from a spinner that transcript has since been drawn beneath", () => {
    const screen = [LIMIT_LINE, "⏺ Picked the turn back up.", "────────", "❯ ", "────────"].join("\n");
    expect(detectSeatWall({ screen })).toBe(undefined);
  });

  it("rejoins a spinner a narrow pane hard-wrapped, its retry counter on the next row", () => {
    const screen = [
      "✻ Weekly limit reached · Retrying in 5h (Sep",
      "  13 at 8am) · attempt 1/300",
      "  ⎿  Tip: /usage shows your limits",
      "────────",
      "❯ ",
      "────────",
    ].join("\n");
    expect(detectSeatWall({ screen })).toStrictEqual({ banner: LIMIT_LINE, kind: "limit-retrying" });
  });

  it("reads the spinner through the tip Claude Code indents beneath it", () => {
    const screen = [LIMIT_LINE, "  ⎿  Tip: /usage shows your limits", "", "────────", "❯ ", "────────"].join("\n");
    expect(detectSeatWall({ screen })).toStrictEqual({ banner: LIMIT_LINE, kind: "limit-retrying" });
  });

  it("reads no limit wall from a spinner line BELOW the live prompt, where Claude Code never draws one", () => {
    expect(detectSeatWall({ screen: `│ >                  │\n${LIMIT_LINE}` })).toBe(undefined);
  });
});

describe("seatRecoveryScreenTargets", () => {
  it("never reads a pinned workspace or the caller's own, and keeps every other one in inventory order", () => {
    const targets = seatRecoveryScreenTargets({
      chairWorkspaceId: undefined,
      ownWorkspaceId: "mine",
      workspaces: [
        workspace({ workspaceId: "busy" }),
        workspace({ pinned: true, workspaceId: "chair" }),
        workspace({ workspaceId: "mine" }),
        workspace({ workspaceId: "seat" }),
      ],
    });
    expect(targets.map((target) => target.workspaceId)).toEqual(["busy", "seat"]);
  });

  it("never reads the RECORDED chair even when cmux's row for it omits the pin", () => {
    const targets = seatRecoveryScreenTargets({
      chairWorkspaceId: "chair",
      ownWorkspaceId: undefined,
      workspaces: [workspace({ workspaceId: "chair" }), workspace({ workspaceId: "seat" })],
    });
    expect(targets.map((target) => target.workspaceId)).toEqual(["seat"]);
  });
});

describe("planSeatRecovery", () => {
  it("re-seats a logged-out workspace cmux renumbered, pairing its row by worktree, on the row's own model", () => {
    const plan = planOne({ wall: LOGGED_OUT_WALL });
    expect(plan.map((item) => [item.kind, item.wall.kind, item.workspace.workspaceRef])).toEqual([
      ["respawn", "logged-out", "workspace:9"],
    ]);
    expect(plan[0]).toMatchObject({ model: "opus", slug: "a-doc" });
  });

  it("re-seats a limit-walled workspace the same way, carrying its banner", () => {
    const plan = planOne({ wall: LIMIT_WALL });
    expect(plan.map((item) => [item.kind, item.wall, item.workspace.workspaceRef])).toEqual([
      ["respawn", LIMIT_WALL, "workspace:9"],
    ]);
    expect(plan[0]).toMatchObject({ model: "opus", slug: "a-doc" });
  });

  it("leaves an unwalled workspace out of the plan entirely", () => {
    const plan = planSeatRecovery({ rows: [row()], wallsByWorkspaceId: new Map(), workspaces: [workspace()] });
    expect(plan).toEqual([]);
  });

  it("reports a walled workspace no open doc row claims, and never re-seats it", () => {
    const plan = planSeatRecovery({
      rows: [row({ status: "closed" })],
      wallsByWorkspaceId: new Map([["id-1", LIMIT_WALL]]),
      workspaces: [workspace()],
    });
    expect(plan.map((item) => [item.kind, "reason" in item ? item.reason : ""])).toEqual([
      ["not-respawnable", "no-slug-row"],
    ]);
  });

  it("reports a row whose boot model was inherited, because cmux spawn refuses a boot with no --model", () => {
    const plan = planSeatRecovery({
      rows: [row({ bootModel: { kind: "inherited" } })],
      wallsByWorkspaceId: new Map([["id-1", LOGGED_OUT_WALL]]),
      workspaces: [workspace()],
    });
    expect(plan.map((item) => [item.kind, "reason" in item ? item.reason : ""])).toEqual([
      ["not-respawnable", "no-pinned-model"],
    ]);
  });
});

describe("renderSeatRecoveryOutcome", () => {
  const loggedOut = planOne({ wall: LOGGED_OUT_WALL })[0] as RespawnableSeat;
  const limited = planOne({ wall: LIMIT_WALL })[0] as RespawnableSeat;

  it("names the wall and the re-run when the spawn failed after the close", () => {
    expect(renderSeatRecoveryOutcome({ outcome: { exitCode: 1, item: loggedOut, kind: "spawn-failed" } })).toBe(
      "spawn failed\tworkspace:9 (a doc)\tlogged-out\tclosed, but cmux spawn a-doc exited 1; re-run: slopweaver cmux spawn a-doc --model opus",
    );
  });

  it("names a limit wall on a re-seated line", () => {
    expect(renderSeatRecoveryOutcome({ outcome: { item: limited, kind: "respawned" } })).toBe(
      "respawned\tworkspace:9 (a doc)\tlimit-retrying\ta-doc re-seated on --model opus",
    );
  });

  it("gives an inherited-model row the one hand step that re-seats it", () => {
    const reported = planOne({ over: { bootModel: { kind: "inherited" } }, wall: LIMIT_WALL })[0] as NonRespawnableSeat;
    expect(renderSeatRecoveryOutcome({ outcome: { item: reported, kind: "reported" } })).toBe(
      "reported\tworkspace:9 (a doc)\tlimit-retrying\ta-doc recorded no pinned model — re-seat by hand: slopweaver cmux close workspace:9, then slopweaver cmux spawn a-doc --model <opus|sonnet>",
    );
  });

  it("summarises every kind and both walls in one line", () => {
    expect(
      renderSeatRecoverySummary({
        dryRun: false,
        outcomes: [
          { item: loggedOut, kind: "respawned" },
          { item: limited, kind: "held" },
        ],
        unreadScreens: 0,
      }),
    ).toBe(
      "session re-seat: 2 walled seat(s) — 1 logged-out, 1 limit-retrying — 1 respawned, 1 held on capacity, 0 failed, 0 reported",
    );
  });

  it("says so plainly when no seat is walled", () => {
    expect(renderSeatRecoverySummary({ dryRun: true, outcomes: [], unreadScreens: 0 })).toBe(
      "session re-seat: no read seat is logged out or limit-retrying",
    );
  });

  it("never lets an unread screen pass for a clear one", () => {
    expect(renderSeatRecoverySummary({ dryRun: true, outcomes: [], unreadScreens: 2 })).toBe(
      "session re-seat: no read seat is logged out or limit-retrying; 2 screen(s) could not be read, so a wall there is unknown",
    );
  });
});
