/**
 * Every `billing` lane or system name in this file is a synthetic one rather than the installation's own.
 */

import { describe, expect, it } from "vitest";

import { branchOf, parkedEventOf } from "../../../cli/commands/handover/parkRunJournal.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import type { RunEvent } from "../../../handover/ledger.js";
import {
  journalMovedReason,
  ParkSeatErrors,
  parkCloseMode,
  parkedWorktree,
  parkHolder,
  parkRunTree,
  parkSeatHost,
  parkSeatRefusal,
  refusalShows,
  selectParkWorkspace,
} from "../../../handover/parkPolicy.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One live workspace, idle and unpinned unless the case says otherwise. */
function workspace({ id, dir, pinned = false }: { id: string; dir: string; pinned?: boolean }): CmuxWorkspaceSummary {
  return {
    currentDirectory: dir,
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned,
    selected: false,
    title: undefined,
    windowId: "window-1",
    workspaceId: `id-${id}`,
    workspaceRef: `workspace:${id}`,
  };
}

const CHAIR = workspace({ dir: "/repo", id: "1", pinned: true });
const SEAT = workspace({ dir: "/wt/card-provenance", id: "238" });
const OTHER = workspace({ dir: "/wt/billing-drafts", id: "157" });
const ALL = [CHAIR, SEAT, OTHER];

const IDLE_SCREEN = ["⏺ Recorded the question.", "", "❯ ", "  ⏵⏵ bypass permissions on (shift+tab to cycle)"].join(
  "\n",
);
const RUNNING_SCREEN = [
  "✻ Vibing… (19s · ↓ 140 tokens)",
  "❯ ",
  "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt",
].join("\n");

describe("selectParkWorkspace", () => {
  it("takes the workspace named by ref, which picks one of two seats in the run's tree", () => {
    const twin = workspace({ dir: "/wt/card-provenance", id: "240" });
    const chosen = selectParkWorkspace({
      callerWorkspaceId: undefined,
      requested: "workspace:240",
      workspaces: [...ALL, twin],
      writerWorktree: "/wt/card-provenance",
    });
    expect(unwrap(chosen).workspaceRef).toBe("workspace:240");
  });

  // a named idle seat in another tree passed every check and was closed under this park.
  it("refuses a named workspace that does not stand in the run's worktree", () => {
    const chosen = selectParkWorkspace({
      callerWorkspaceId: undefined,
      requested: "workspace:157",
      workspaces: ALL,
      writerWorktree: "/wt/card-provenance",
    });
    expect(unwrapErr(chosen).code).toBe("SEAT_OUTSIDE_RUN");
  });

  // with no recorded worktree, any named idle seat was closed under this run's park.
  it("refuses a named workspace other than the caller's when the run recorded no worktree", () => {
    const chosen = selectParkWorkspace({
      callerWorkspaceId: SEAT.workspaceId,
      requested: "workspace:157",
      workspaces: ALL,
      writerWorktree: undefined,
    });
    expect(unwrapErr(chosen).code).toBe("SEAT_NOT_FOUND");
  });

  it("takes the caller's own seat by name when the run recorded no worktree", () => {
    const chosen = selectParkWorkspace({
      callerWorkspaceId: OTHER.workspaceId,
      requested: "workspace:157",
      workspaces: ALL,
      writerWorktree: undefined,
    });
    expect(unwrap(chosen).workspaceRef).toBe("workspace:157");
  });

  it("refuses a named ref that names nothing live", () => {
    const chosen = selectParkWorkspace({
      callerWorkspaceId: undefined,
      requested: "workspace:999",
      workspaces: ALL,
      writerWorktree: undefined,
    });
    expect(unwrapErr(chosen).code).toBe("SEAT_NOT_FOUND");
  });

  it("finds the seat by the writer's worktree, which is how the chair parks a seat it is not in", () => {
    const chosen = selectParkWorkspace({
      callerWorkspaceId: CHAIR.workspaceId,
      requested: undefined,
      workspaces: ALL,
      writerWorktree: "/wt/card-provenance",
    });
    expect(unwrap(chosen).workspaceRef).toBe("workspace:238");
  });

  it("refuses two live workspaces on the writer's worktree rather than guessing", () => {
    const twin = workspace({ dir: "/wt/card-provenance", id: "240" });
    const chosen = selectParkWorkspace({
      callerWorkspaceId: undefined,
      requested: undefined,
      workspaces: [...ALL, twin],
      writerWorktree: "/wt/card-provenance",
    });
    expect(unwrapErr(chosen).code).toBe("SEAT_AMBIGUOUS");
  });

  // an exact cwd match saw only the root seat and closed it, leaving the writer open.
  it("counts a seat opened BENEATH the worktree as standing in it, so two seats are still ambiguous", () => {
    const nested = workspace({ dir: "/wt/card-provenance/apps/web", id: "240" });
    const chosen = selectParkWorkspace({
      callerWorkspaceId: undefined,
      requested: undefined,
      workspaces: [...ALL, nested],
      writerWorktree: "/wt/card-provenance",
    });
    expect(unwrapErr(chosen)).toEqual(
      ParkSeatErrors.ambiguous({ workspaceRefs: ["workspace:238", "workspace:240"], worktree: "/wt/card-provenance" }),
    );
  });

  it("does not count a sibling tree sharing the name as a prefix", () => {
    const sibling = workspace({ dir: "/wt/card-provenance-two", id: "241" });
    const chosen = selectParkWorkspace({
      callerWorkspaceId: undefined,
      requested: undefined,
      workspaces: [...ALL, sibling],
      writerWorktree: "/wt/card-provenance",
    });
    expect(unwrap(chosen).workspaceRef).toBe("workspace:238");
  });

  it("journals the writer's tree, not the subdirectory a seat was opened in", () => {
    const nested = workspace({ dir: "/wt/card-provenance/apps/web", id: "240" });
    expect(parkedWorktree({ seat: nested, writerWorktree: "/wt/card-provenance" })).toBe("/wt/card-provenance");
    expect(parkedWorktree({ seat: OTHER, writerWorktree: "/wt/card-provenance" })).toBe("/wt/billing-drafts");
  });

  it("falls back to the caller's own workspace only when the writer recorded no worktree", () => {
    const chosen = selectParkWorkspace({
      callerWorkspaceId: OTHER.workspaceId,
      requested: undefined,
      workspaces: ALL,
      writerWorktree: undefined,
    });
    expect(unwrap(chosen).workspaceRef).toBe("workspace:157");
  });

  // with no seat left in the run's tree, the caller's unrelated seat was closed instead.
  it("refuses rather than take the caller's seat when nothing stands in the run's worktree", () => {
    const chosen = selectParkWorkspace({
      callerWorkspaceId: OTHER.workspaceId,
      requested: undefined,
      workspaces: ALL,
      writerWorktree: "/wt/somewhere-gone",
    });
    expect(unwrapErr(chosen).message).toContain("no live workspace sits in /wt/somewhere-gone");
  });

  it("refuses when no key finds a seat", () => {
    const chosen = selectParkWorkspace({
      callerWorkspaceId: undefined,
      requested: undefined,
      workspaces: ALL,
      writerWorktree: undefined,
    });
    expect(unwrapErr(chosen).code).toBe("SEAT_NOT_FOUND");
  });
});

describe("branchOf", () => {
  it("names the branch the run recorded at start", () => {
    expect(branchOf({ recorded: "demo-day" })).toBe("demo-day");
  });

  it("says so, rather than naming a branch, when the run recorded none", () => {
    expect(branchOf({ recorded: undefined })).toBe("(no branch recorded at start)");
  });
});

describe("parkedEventOf", () => {
  const WRITER = { atIso: "2026-10-25T08:00:00Z", pid: undefined, sessionId: "s-1", worktree: "/wt/card-provenance" };
  const PLAN = {
    ambiguousLines: [],
    question: undefined,
    runTree: "/wt/card-provenance",
    seatHost: undefined,
    standingHatchOpen: false,
    wake: undefined,
    writer: WRITER,
  };

  it("checkpoints a CI-parked seat with no question and no drafts, naming the run tree a reseat reopens", () => {
    const wake = { kind: "checks", number: 2597, repo: "lachiejames/slopweaver" } as const;
    expect(
      parkedEventOf({
        atIso: "2026-10-25T09:00:00.000Z",
        drafts: [],
        plan: { ...PLAN, wake },
        recordedBranch: "demo-day",
        screen: "⏺ Opened #2597.\n❯ \n\n",
        seat: SEAT,
      }),
    ).toEqual({
      atIso: "2026-10-25T09:00:00.000Z",
      branch: "demo-day",
      kind: "parked",
      screenTail: "⏺ Opened #2597.\n❯",
      sessionId: "s-1",
      wake,
      workspaceRef: "workspace:238",
      worktree: "/wt/card-provenance",
    });
  });

  it("carries the owner's question and the held drafts, and says no branch was recorded", () => {
    const drafts = [{ id: "d-1", kind: "slack-draft", text: "hello" }] as const;
    const event = parkedEventOf({
      atIso: "2026-10-25T09:00:00.000Z",
      drafts,
      plan: { ...PLAN, question: "ship it?" },
      recordedBranch: undefined,
      screen: IDLE_SCREEN,
      seat: SEAT,
    });
    expect([event.question, event.drafts, event.branch, event.wake]).toEqual([
      "ship it?",
      drafts,
      "(no branch recorded at start)",
      undefined,
    ]);
  });
});

describe("parkHolder", () => {
  const STARTED: RunEvent = { atIso: "2026-10-04T01:00:00.000Z", branch: "demo-day", docHash: "h", kind: "started" };
  const LAUNCHED: RunEvent = {
    atIso: "2026-10-04T01:00:01.000Z",
    host: "claude-code",
    kind: "launched",
    pid: 4242,
    sessionId: "s-writer",
    worktree: "/wt/demo-day",
  };
  const ASKED: RunEvent = { atIso: "2026-10-04T02:00:00.000Z", kind: "question", question: "Which shape?" };
  const PLANNED = { runTree: "/wt/demo-day", seatHost: "claude-code", sessionId: "s-writer" } as const;
  const MOVED = "the run's holder, its host or its tree changed after its seat was read — run park again";
  const PARKED: RunEvent = {
    atIso: "2026-10-04T04:25:11.254Z",
    branch: "demo-day",
    kind: "parked",
    question: "Which shape?",
    screenTail: "❯ ",
    sessionId: "s-writer",
    workspaceRef: "workspace:227",
    worktree: "/wt/demo-day",
  };
  const RESEATED: RunEvent = {
    atIso: "2026-10-04T04:39:47.197Z",
    by: "chair",
    kind: "dispatched",
    target: "workspace:289",
  };

  it("names the writer while a session holds the run", () => {
    expect(parkHolder({ events: [STARTED, LAUNCHED, ASKED] })!.sessionId).toBe("s-writer");
  });

  it("names nobody while the run is parked now, so a second park is refused", () => {
    expect(parkHolder({ events: [STARTED, LAUNCHED, ASKED, PARKED] })).toBeUndefined();
  });

  // Measured: the demo-day reseat's older build could not claim, and the seat it opened was unparkable.
  it("names the releasing session once a reseat that never claimed has ended the park, with its worktree", () => {
    const holder = parkHolder({ events: [STARTED, LAUNCHED, ASKED, PARKED, RESEATED] })!;
    expect(holder.sessionId).toBe("s-writer");
    expect(holder.worktree).toBe("/wt/demo-day");
  });

  // the released writer's historical claude-code host authorised closing the new seat.
  it("trusts no host for an unclaimed reseat's seat, though the releasing session recorded claude-code", () => {
    expect(parkHolder({ events: [STARTED, LAUNCHED, ASKED, PARKED, RESEATED] })!.host).toBe("claude-code");
    expect(parkSeatHost({ events: [STARTED, LAUNCHED, ASKED, PARKED, RESEATED] })).toBeUndefined();
  });

  // a release landing after the screen read leaves a host the re-read before the append no longer sees.
  it("trusts no host once the writer released, so park's re-read refuses a release racing it", () => {
    const released: RunEvent = {
      atIso: "2026-10-04T02:30:00.000Z",
      kind: "released",
      sessionId: "s-writer",
      why: "done",
    };
    expect(parkSeatHost({ events: [STARTED, LAUNCHED, ASKED, released] })).toBeUndefined();
  });

  it("trusts the current writer's recorded host", () => {
    expect(parkSeatHost({ events: [STARTED, LAUNCHED, ASKED] })).toBe("claude-code");
  });

  // a newer host's claim arriving undecodable hid the current writer from the pre-append re-read.
  it("refuses the append when an ownership-bearing line arrived undecodable after the seat was read", () => {
    const journal = { events: [STARTED, LAUNCHED, ASKED], unknownKind: [], unreadable: [4] };

    expect(journalMovedReason({ ambiguousLines: [], journal, planned: PLANNED })).toBe(
      "journal line(s) 4 arrived undecodable after the seat was read, so its writer cannot be proven — pull and run park again",
    );
  });

  it("lets the append through when the holder, host and tree are the ones the seat was chosen against", () => {
    const journal = { events: [STARTED, LAUNCHED, ASKED], unknownKind: [], unreadable: [4] };

    expect(journalMovedReason({ ambiguousLines: [4], journal, planned: PLANNED })).toBe(undefined);
  });

  it("refuses the append when the writer's host changed since the seat was read", () => {
    const journal = { events: [STARTED, LAUNCHED, ASKED], unknownKind: [], unreadable: [] };

    expect(journalMovedReason({ ambiguousLines: [], journal, planned: { ...PLANNED, seatHost: undefined } })).toBe(
      MOVED,
    );
  });

  // the same session reclaiming from another tree left the chosen seat outside the run.
  it("refuses the append when the same session reclaimed the run from another tree", () => {
    const reclaimed: RunEvent = {
      atIso: "2026-10-04T03:00:00.000Z",
      host: "claude-code",
      kind: "claimed",
      pid: 4343,
      sessionId: "s-writer",
      why: "moved trees",
      worktree: "/wt/elsewhere",
    };
    const journal = { events: [STARTED, LAUNCHED, ASKED, reclaimed], unknownKind: [], unreadable: [] };

    expect(journalMovedReason({ ambiguousLines: [], journal, planned: PLANNED })).toBe(MOVED);
  });

  it("names nobody on a run no session ever held", () => {
    expect(parkHolder({ events: [STARTED, ASKED] })).toBeUndefined();
  });

  it("checks seats against the cycle's launched tree when the holder resumed under a new session", () => {
    const resumed: RunEvent = {
      atIso: "2026-10-04T03:00:00.000Z",
      attempt: undefined,
      kind: "resumed",
      pid: 5151,
      sessionId: "s-new",
    };
    const events = [STARTED, LAUNCHED, ASKED, resumed];
    const holder = parkHolder({ events })!;
    expect(holder.worktree).toBeUndefined();
    expect(parkRunTree({ events, holder })).toBe("/wt/demo-day");
  });

  it("checks seats against the holder's own tree first", () => {
    const events = [STARTED, LAUNCHED, ASKED];
    expect(parkRunTree({ events, holder: parkHolder({ events })! })).toBe("/wt/demo-day");
  });
});

describe("parkCloseMode", () => {
  it("forces the caller's own seat, which is itself the running process cmux 0.65.2 asks about", () => {
    expect(parkCloseMode({ hatchForced: false, own: true })).toBe("force");
  });

  it("forces the caller's own seat whether or not the hatch also fired", () => {
    expect(parkCloseMode({ hatchForced: true, own: true })).toBe("force");
  });

  it("forces a foreign seat the park hatch already let through mid-turn", () => {
    expect(parkCloseMode({ hatchForced: true, own: false })).toBe("force");
  });

  it("bounds a foreign seat by a fresh screen proof when nothing overrode it", () => {
    expect(parkCloseMode({ hatchForced: false, own: false })).toBe("bounded");
  });
});

describe("parkSeatRefusal", () => {
  it("never parks the pinned chair", () => {
    expect(
      parkSeatRefusal({ holderHost: "claude-code", callerWorkspaceId: undefined, screen: IDLE_SCREEN, target: CHAIR }),
    ).toEqual({
      kind: "pinned",
    });
  });

  it("lets an idle foreign seat close", () => {
    expect(
      parkSeatRefusal({
        holderHost: "claude-code",
        callerWorkspaceId: CHAIR.workspaceId,
        screen: IDLE_SCREEN,
        target: SEAT,
      }),
    ).toBeUndefined();
  });

  it("refuses a foreign seat mid-turn", () => {
    expect(
      parkSeatRefusal({
        holderHost: "claude-code",
        callerWorkspaceId: CHAIR.workspaceId,
        screen: RUNNING_SCREEN,
        target: SEAT,
      }),
    ).toEqual({
      kind: "mid-turn",
      queued: false,
    });
  });

  // A seat with a background shell or Monitor running will wake — it is not parked.
  it("refuses a foreign seat at its prompt whose footer counts background work", () => {
    const shell = [
      "⏺ Waiting on the build.",
      "",
      "❯ ",
      "  ⏵⏵ bypass permissions on · 1 shell, 2 monitors · ← 3 agents",
    ].join("\n");
    const refusal = parkSeatRefusal({
      callerWorkspaceId: CHAIR.workspaceId,
      holderHost: "claude-code",
      screen: shell,
      target: SEAT,
    });
    expect(refusal).toEqual({ kind: "background-work", work: { monitors: 2, shells: 1 } });
    expect(refusalShows({ refusal: refusal! as { kind: "background-work"; work: { monitors: 2; shells: 1 } } })).toBe(
      "1 background shell(s) and 2 Monitor(s) still running, which will wake it",
    );
  });

  // a working codex seat showed no measured busy marker, so it read as idle and was closed.
  // Its `• Working (` line is measured now; `parkPolicyCodex.test.ts` holds that screen as mid-turn.
  it("refuses a foreign seat whose screen does not prove it is at rest", () => {
    const refusal = parkSeatRefusal({
      holderHost: "claude-code",
      callerWorkspaceId: CHAIR.workspaceId,
      screen: "• ok\n› ",
      target: SEAT,
    });
    expect(refusal).toEqual({ kind: "unreadable" });
    expect(refusalShows({ refusal: refusal! as { kind: "unreadable" } })).toContain("may be working");
  });

  // a stale `❯` in scrollback read as a ready prompt over a screen with no footer at all.
  it("refuses a foreign screen with a prompt but no Claude Code footer to read the running marker from", () => {
    const noFooter = "Claude Code v2.1.241\n❯ previous request\n✻ Working… (19s)";
    expect(
      parkSeatRefusal({
        holderHost: "claude-code",
        callerWorkspaceId: CHAIR.workspaceId,
        screen: noFooter,
        target: SEAT,
      }),
    ).toEqual({
      kind: "unreadable",
    });
  });

  // a footer's words printed INSIDE a codex line were read as Claude Code's own footer.
  it("refuses a codex seat whose output quotes a Claude Code footer", () => {
    const quoted = '• ok\n› investigating the literal text "? for shortcuts"';
    expect(
      parkSeatRefusal({
        holderHost: "claude-code",
        callerWorkspaceId: CHAIR.workspaceId,
        screen: quoted,
        target: SEAT,
      }),
    ).toEqual({
      kind: "unreadable",
    });
  });

  it("refuses a footer line in scrollback that is not the screen's last line", () => {
    const scrolled = ["❯ ", "  ⏵⏵ bypass permissions on (shift+tab to cycle)", "• ok", "› "].join("\n");
    expect(
      parkSeatRefusal({
        holderHost: "claude-code",
        callerWorkspaceId: CHAIR.workspaceId,
        screen: scrolled,
        target: SEAT,
      }),
    ).toEqual({
      kind: "unreadable",
    });
  });

  it("refuses a last-line footer with no Claude Code input box above it", () => {
    const bare = ["• ok", "", "  ? for shortcuts"].join("\n");
    expect(
      parkSeatRefusal({ holderHost: "claude-code", callerWorkspaceId: CHAIR.workspaceId, screen: bare, target: SEAT }),
    ).toEqual({
      kind: "unreadable",
    });
  });

  it("lets the live re-parked screen close: prompt, rule, footer, trailing blank lines", () => {
    const rule = "─".repeat(40);
    const live = ["⏺ Done.", rule, "❯ ", rule, "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents", ""].join(
      "\n",
    );
    expect(
      parkSeatRefusal({ holderHost: "claude-code", callerWorkspaceId: CHAIR.workspaceId, screen: live, target: SEAT }),
    ).toBeUndefined();
  });

  // a codex seat printed `❯` and `? for shortcuts` as its own last lines.
  it("refuses a run held by codex even when its screen ends in a Claude Code footer under a prompt", () => {
    const quotedScreen = "• ok\n• Quoted Claude screen:\n❯\n? for shortcuts";
    expect(
      parkSeatRefusal({
        callerWorkspaceId: CHAIR.workspaceId,
        holderHost: "codex",
        screen: quotedScreen,
        target: SEAT,
      }),
    ).toEqual({ kind: "unreadable" });
    expect(
      parkSeatRefusal({ callerWorkspaceId: CHAIR.workspaceId, holderHost: "codex", screen: IDLE_SCREEN, target: SEAT }),
    ).toEqual({ kind: "unreadable" });
  });

  // blank lines were dropped before the prompt's distance was counted.
  it("refuses a prompt more than three screen lines above the footer, blank lines included", () => {
    const distant = "❯\n\n\n\n\n? for shortcuts";
    expect(
      parkSeatRefusal({
        callerWorkspaceId: CHAIR.workspaceId,
        holderHost: "claude-code",
        screen: distant,
        target: SEAT,
      }),
    ).toEqual({ kind: "unreadable" });
  });

  it("refuses an idle-looking seat whose run recorded no host", () => {
    expect(
      parkSeatRefusal({
        callerWorkspaceId: CHAIR.workspaceId,
        holderHost: undefined,
        screen: IDLE_SCREEN,
        target: SEAT,
      }),
    ).toEqual({ kind: "unreadable" });
  });

  it("names a queued line as what a mid-turn screen shows", () => {
    expect(refusalShows({ refusal: { kind: "mid-turn", queued: true } })).toBe("a line queued behind a running turn");
  });

  it("lets a seat park itself although its own screen is busy running this command", () => {
    expect(
      parkSeatRefusal({
        holderHost: "claude-code",
        callerWorkspaceId: SEAT.workspaceId,
        screen: RUNNING_SCREEN,
        target: SEAT,
      }),
    ).toBeUndefined();
  });
});
