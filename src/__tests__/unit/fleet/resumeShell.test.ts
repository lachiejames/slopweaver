/**
 * When a `fleet resume` tab closes: its own journalled end, and the finish line, process tree and journal that let
 * `session close-done` close one left behind. Pure.
 */
import { describe, expect, it } from "vitest";

import type { CmuxProcess, CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { isBareShellTree } from "../../../cmux/liveness.js";
import type { FleetJournalEvent, FleetJournalRead } from "../../../fleet/journal.js";
import {
  type ResumeFinish,
  type ResumeShellCloseReason,
  resumeFinishFromScreen,
  resumeFinishLine,
  resumeShellCloseReason,
  screenShowsFinish,
  shouldCloseOwnShell,
} from "../../../fleet/resumeShell.js";
import { resumeShellCandidates } from "../../../sessions/closeDoneShells.js";
import type { SessionItem } from "../../../sessions/session.js";

const ATTEMPT = "1db70ded-0000-4000-8000-000000000001";
const LATER = "1db70ded-0000-4000-8000-000000000002";
const LINE = resumeFinishLine({ finish: { attemptId: ATTEMPT, outcome: "healthy" } });
const PROMPT = "ada@mac slopweaver % ";

describe("resumeFinishLine", () => {
  it("prints the exact line the pass has always ended on", () => {
    expect(LINE).toBe(`fleet resume: attempt ${ATTEMPT} ended healthy — \`slopweaver fleet health\` shows the page`);
  });
});

describe("shouldCloseOwnShell", () => {
  const done = {
    episodeNamed: true,
    finishJournalled: true,
    ownWorkspaceId: "ws-1",
    pinned: false,
  };

  // A tab kept open on a failed end stranded a bare tab the chair closed by hand; the journal already holds every refusal the tab printed.
  it("closes a journalled, desktop-launched pass in an unpinned cmux tab, however it ended", () => {
    expect(shouldCloseOwnShell(done)).toBe(true);
  });

  it("keeps the tab when any one fact is missing", () => {
    expect(shouldCloseOwnShell({ ...done, episodeNamed: false })).toBe(false);
    expect(shouldCloseOwnShell({ ...done, finishJournalled: false })).toBe(false);
    expect(shouldCloseOwnShell({ ...done, ownWorkspaceId: undefined })).toBe(false);
    expect(shouldCloseOwnShell({ ...done, pinned: true })).toBe(false);
  });
});

describe("screenShowsFinish", () => {
  const finish = { attemptId: ATTEMPT, outcome: "healthy" } as const;

  it("ties a tab to the pass whose own finish line it shows, its command row still in view", () => {
    const screen = `${PROMPT}bin/slopweaver fleet resume --episode e1\nfleet resume: 1 seat resumed\n${LINE}\n`;
    expect(screenShowsFinish({ finish, screen })).toBe(true);
  });

  it("reads the line however the terminal wrapped it", () => {
    const screen = `${LINE.slice(0, 40)}\n${LINE.slice(40)}\n`;
    expect(screenShowsFinish({ finish, screen })).toBe(true);
  });

  // A pass run in tab A under an inherited CMUX_WORKSPACE_ID naming B must not close B.
  it("refuses a tab showing another attempt's line, or this attempt ending otherwise", () => {
    const other = resumeFinishLine({ finish: { attemptId: LATER, outcome: "healthy" } });
    const failed = resumeFinishLine({ finish: { attemptId: ATTEMPT, outcome: "failed" } });
    expect(screenShowsFinish({ finish, screen: `${other}\n${PROMPT}` })).toBe(false);
    expect(screenShowsFinish({ finish, screen: `${failed}\n${PROMPT}` })).toBe(false);
    expect(screenShowsFinish({ finish, screen: "" })).toBe(false);
  });
});

describe("resumeFinishFromScreen", () => {
  it("reads the finish line above the prompt", () => {
    const screen = ["console\talready serving on :4000", LINE, PROMPT, "", ""].join("\n");
    expect(resumeFinishFromScreen({ screen })).toEqual({ attemptId: ATTEMPT, outcome: "healthy" });
  });

  it("reads a line a narrow terminal wrapped after its outcome", () => {
    const screen = [
      `fleet resume: attempt ${ATTEMPT} ended failed — \`slopweaver`,
      "fleet health` shows the page",
      PROMPT,
    ].join("\n");
    expect(resumeFinishFromScreen({ screen })).toEqual({ attemptId: ATTEMPT, outcome: "failed" });
  });

  it("refuses a tab where a command was typed and answered after the line, even once it finished", () => {
    const reused = [LINE, `${PROMPT}pwd`, "/Users/ada", PROMPT].join("\n");
    const pressedEnter = [LINE, PROMPT, PROMPT].join("\n");
    expect(resumeFinishFromScreen({ screen: reused })).toBeUndefined();
    expect(resumeFinishFromScreen({ screen: pressedEnter })).toBeUndefined();
  });

  it("refuses a tab with a command typed at its prompt and not yet run", () => {
    const drafts = [
      `${PROMPT}git status --short`,
      `${PROMPT}echo 50 %`,
      "bash-3.2$ ",
      "%echo %",
      "user> %",
      `${PROMPT}   `,
      "host % ",
      "host %\t",
    ];
    expect(drafts.map((draft) => resumeFinishFromScreen({ screen: [LINE, draft].join("\n") }))).toEqual(
      drafts.map(() => undefined),
    );
    expect(drafts.length).toBe(8);
    expect(["% ", "host %"].map((prompt) => resumeFinishFromScreen({ screen: [LINE, prompt].join("\n") }))).toEqual([
      { attemptId: ATTEMPT, outcome: "healthy" },
      { attemptId: ATTEMPT, outcome: "healthy" },
    ]);
  });

  it("refuses the line replayed by a command the owner ran, its own copy under it or the verb's above it", () => {
    const both = [LINE, `${PROMPT}echo "$FINISH"`, LINE, PROMPT].join("\n");
    const replayOnly = ["a", "b", `${PROMPT}echo "$FINISH"`, LINE, PROMPT].join("\n");
    const twoHeads = [LINE, LINE, PROMPT].join("\n");
    const glued = ["a", `bash-3.2$ echo "$FINISH"`, LINE, PROMPT].join("\n");
    expect([both, replayOnly, twoHeads, glued].map((screen) => resumeFinishFromScreen({ screen }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("refuses a prompt wrapped onto its own row above the line, its command on the next", () => {
    const wrapped = ["ada@very-long-host /very/long/path %", 'echo "$FINISH"', LINE, PROMPT].join("\n");
    expect(resumeFinishFromScreen({ screen: wrapped })).toBeUndefined();
  });

  it("refuses a replay whose prompt has no space before its input, the terminator first or mid-token", () => {
    const leading = ["four", "five", '%echo "$FINISH"', LINE, "%"].join("\n");
    const inside = ["four", "five", 'ada@host:~$echo "$FINISH"', LINE, PROMPT].join("\n");
    expect([leading, inside].map((screen) => resumeFinishFromScreen({ screen }))).toEqual([undefined, undefined]);
  });

  it("counts a second head wrapped between its words", () => {
    const other = resumeFinishLine({ finish: { attemptId: LATER, outcome: "failed" } });
    const screen = ["fleet resume:", other.slice("fleet resume: ".length), LINE, PROMPT].join("\n");
    expect(resumeFinishFromScreen({ screen })).toBeUndefined();
  });

  it("refuses the whole line with text run on after it, its prompt scrolled out of the tail", () => {
    const suffixed = ["a", "b", `${LINE} diagnostic`, PROMPT].join("\n");
    const wrappedSuffix = [
      "a",
      "fleet resume: attempt",
      `${ATTEMPT} ended healthy —`,
      "`slopweaver fleet health` shows the page x",
      PROMPT,
    ].join("\n");
    expect([suffixed, wrappedSuffix].map((screen) => resumeFinishFromScreen({ screen }))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("reads a live tab, the pass's rows above its finish and the untouched zsh prompt under it", () => {
    const failed = resumeFinishLine({ finish: { attemptId: ATTEMPT, outcome: "failed" } });
    const screen = [
      "workspace:7     not yet — an earlier relaunch failed after its stop, so this one waits for the next attempt",
      "supervisor      waiting up to 600s for it to say it is caught up",
      "supervisor      caught up",
      failed,
      "ada.owner@adaowner-MacBook-Pro slopweaver % ",
    ].join("\n");
    expect(resumeFinishFromScreen({ screen })).toEqual({ attemptId: ATTEMPT, outcome: "failed" });
  });

  it("reads a line wrapped over four rows above the prompt, and not one whose head fell out of the tail", () => {
    const rows = ["fleet resume: attempt", `${ATTEMPT} ended healthy —`, "`slopweaver fleet", "health` shows the page"];
    const four = [...rows, PROMPT].join("\n");
    const cut = ["fleet resume:", "attempt", ...rows.slice(1), PROMPT].join("\n");
    expect(resumeFinishFromScreen({ screen: four })).toEqual({ attemptId: ATTEMPT, outcome: "healthy" });
    expect(resumeFinishFromScreen({ screen: cut })).toBeUndefined();
  });

  it("refuses a line that is not exactly the verb's own", () => {
    const refused = [
      `fleet resume: attempt not-a-uuid ended healthy — \`slopweaver fleet health\` shows the page`,
      `fleet resume: attempt ${ATTEMPT} ended sideways — \`slopweaver fleet health\` shows the page`,
      `fleet resume: attempt ${ATTEMPT} ended healthy and then some`,
      `  quoted: ${LINE}`,
      `fleet resume: attempt ${ATTEMPT} ended healthy`,
      `fleet resume: attempt ${ATTEMPT} ended healthy — \`slopweaver`,
    ];
    expect(refused.map((line) => resumeFinishFromScreen({ screen: [line, PROMPT].join("\n") }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("reads a line a terminal wrapped inside its attempt id", () => {
    const screen = [
      "fleet resume: attempt 1db70ded-0000-",
      "4000-8000-000000000001 ended healthy — `slopweaver fleet health` shows the page",
      PROMPT,
    ].join("\n");
    expect(resumeFinishFromScreen({ screen })).toEqual({ attemptId: ATTEMPT, outcome: "healthy" });
  });

  it("refuses an indented copy of the whole line", () => {
    expect(resumeFinishFromScreen({ screen: [`    ${LINE}`, PROMPT].join("\n") })).toBeUndefined();
  });

  it("reads a line wrapped exactly after its outcome, whole on the next row", () => {
    const screen = [
      `fleet resume: attempt ${ATTEMPT} ended healthy`,
      "— `slopweaver fleet health` shows the page",
      PROMPT,
    ].join("\n");
    expect(resumeFinishFromScreen({ screen })).toEqual({ attemptId: ATTEMPT, outcome: "healthy" });
  });

  it("does not read a Claude session that printed the line, since its composer sits below it", () => {
    const screen = [
      LINE,
      "",
      "╭────────────╮",
      "│ >          │",
      "╰────────────╯",
      "  ? for shortcuts",
      "  Opus 5.5",
    ].join("\n");
    expect(resumeFinishFromScreen({ screen })).toBeUndefined();
  });
});

/** One finished-attempt line. */
function finished({ attemptId, outcome }: { attemptId: string; outcome: "healthy" | "failed" }): FleetJournalEvent {
  return { atIso: "2026-10-09T03:50:02.375Z", attemptId, kind: "attempt-finished", outcome, schemaVersion: 1 };
}

/** A read where every line decoded, or where lines failed after the given counts of decoded events. */
function read({
  events,
  unreadableAt = [],
}: {
  events: readonly FleetJournalEvent[];
  unreadableAt?: readonly number[];
}): FleetJournalRead {
  return { events, unreadable: unreadableAt.length, unreadableAt };
}

/** The close reason for a tab over a journal every line of which decoded. */
function reasonOver({
  events,
  finish,
}: {
  events: readonly FleetJournalEvent[];
  finish: ResumeFinish;
}): ResumeShellCloseReason | undefined {
  return resumeShellCloseReason({ finish, journal: read({ events }) });
}

describe("resumeShellCloseReason", () => {
  it("closes a healthy tab with no journal at all", () => {
    expect(reasonOver({ events: [], finish: { attemptId: ATTEMPT, outcome: "healthy" } })).toBe("healthy");
  });

  it("holds a failed tab while it is the newest finished attempt", () => {
    const events = [finished({ attemptId: ATTEMPT, outcome: "failed" })];
    expect(reasonOver({ events, finish: { attemptId: ATTEMPT, outcome: "failed" } })).toBeUndefined();
  });

  it("closes a failed tab once a different attempt finished after it", () => {
    const events = [
      finished({ attemptId: ATTEMPT, outcome: "failed" }),
      finished({ attemptId: LATER, outcome: "healthy" }),
    ];
    expect(reasonOver({ events, finish: { attemptId: ATTEMPT, outcome: "failed" } })).toBe("superseded");
  });

  it("does not count an attempt that finished BEFORE it, nor its own second line", () => {
    const before = [
      finished({ attemptId: LATER, outcome: "healthy" }),
      finished({ attemptId: ATTEMPT, outcome: "failed" }),
    ];
    const twice = [
      finished({ attemptId: ATTEMPT, outcome: "failed" }),
      finished({ attemptId: ATTEMPT, outcome: "failed" }),
    ];
    expect(reasonOver({ events: before, finish: { attemptId: ATTEMPT, outcome: "failed" } })).toBeUndefined();
    expect(reasonOver({ events: twice, finish: { attemptId: ATTEMPT, outcome: "failed" } })).toBeUndefined();
  });

  it("judges from the attempt's LAST finish, so a repeat after another attempt keeps it newest", () => {
    const events = [
      finished({ attemptId: ATTEMPT, outcome: "failed" }),
      finished({ attemptId: LATER, outcome: "healthy" }),
      finished({ attemptId: ATTEMPT, outcome: "failed" }),
    ];
    expect(reasonOver({ events, finish: { attemptId: ATTEMPT, outcome: "failed" } })).toBeUndefined();
  });

  it("holds a tab whose attempt the journal never saw finish", () => {
    const events = [finished({ attemptId: LATER, outcome: "healthy" })];
    expect(reasonOver({ events, finish: { attemptId: ATTEMPT, outcome: "deferred" } })).toBeUndefined();
  });

  describe("once every seat it refused is journalled gone", () => {
    const failed = { attemptId: ATTEMPT, outcome: "failed" as const };
    const base = { attemptId: ATTEMPT, schemaVersion: 1 as const };
    const started: FleetJournalEvent = {
      ...base,
      atIso: "2026-10-09T03:40:00.000Z",
      episodeId: "ep",
      kind: "attempt-started",
      pid: 7,
    };

    /** One seat line, a worker's unless named. */
    function seat({
      workspaceRef,
      phase,
      role = "worker",
    }: {
      workspaceRef: string;
      phase: "reseated" | "refused";
      role?: "supervisor" | "worker";
    }): FleetJournalEvent {
      return { ...base, atIso: "2026-10-09T03:45:00.000Z", kind: "seat", phase, role, workspaceRef };
    }

    /** The line close-done journals for a ref. */
    function gone({ workspaceRef }: { workspaceRef: string }): FleetJournalEvent {
      return { ...base, atIso: "2026-10-09T04:00:00.000Z", kind: "seat-gone", workspaceRef };
    }

    const attempt = [
      started,
      seat({ phase: "reseated", workspaceRef: "workspace:2" }),
      seat({ phase: "refused", workspaceRef: "workspace:5" }),
      finished(failed),
    ];

    it("closes the newest attempt's failed tab once its one refused seat is gone", () => {
      const events = [...attempt, gone({ workspaceRef: "workspace:5" })];
      expect(reasonOver({ events, finish: failed })).toBe("seats-gone");
    });

    it("holds it when a line from the attempt's start on would not decode, since it may be a seat still standing", () => {
      const events = [...attempt, gone({ workspaceRef: "workspace:5" })];
      expect(resumeShellCloseReason({ finish: failed, journal: read({ events, unreadableAt: [2] }) })).toBeUndefined();
      expect(resumeShellCloseReason({ finish: failed, journal: read({ events, unreadableAt: [0] }) })).toBe(
        "seats-gone",
      );
    });

    it("holds it while the supervisor's seat stands refused, which is never judged gone", () => {
      const events = [
        started,
        seat({ phase: "refused", role: "supervisor", workspaceRef: "workspace:1" }),
        ...attempt.slice(1),
        gone({ workspaceRef: "workspace:5" }),
      ];
      expect(reasonOver({ events, finish: failed })).toBeUndefined();
    });

    it("holds it while any refused seat still stands", () => {
      const events = [
        ...attempt.slice(0, -1),
        seat({ phase: "refused", workspaceRef: "workspace:6" }),
        finished(failed),
        gone({ workspaceRef: "workspace:5" }),
      ];
      expect(reasonOver({ events, finish: failed })).toBeUndefined();
    });

    it("holds one whose attempt finished on a refusal of its own, or whose seats all reseated with no gone line", () => {
      const refusedFinish: FleetJournalEvent = {
        ...base,
        atIso: "2026-10-09T03:50:02.375Z",
        kind: "attempt-finished",
        outcome: "failed",
        refusal: { code: "UNKNOWN", message: "the pass could not finish", originalCode: "SOMETHING" },
      };
      const ownRefusal = [...attempt.slice(0, -1), refusedFinish, gone({ workspaceRef: "workspace:5" })];
      const allReseated = [started, seat({ phase: "reseated", workspaceRef: "workspace:2" }), finished(failed)];
      expect(reasonOver({ events: ownRefusal, finish: failed })).toBeUndefined();
      expect(reasonOver({ events: allReseated, finish: failed })).toBeUndefined();
    });

    it("holds an older attempt's tab whose seats are gone while a newer attempt has started and not finished", () => {
      const newer: FleetJournalEvent = { ...started, atIso: "2026-10-09T04:10:00.000Z", attemptId: LATER };
      const events = [...attempt, gone({ workspaceRef: "workspace:5" }), newer];
      expect(reasonOver({ events, finish: failed })).toBeUndefined();
    });
  });
});

/** One process with no children unless given. */
function proc({ name, children = [] }: { name: string; children?: readonly CmuxProcess[] }): CmuxProcess {
  return { children, name, pid: 1 };
}

describe("isBareShellTree", () => {
  it("reads an idle login shell beside cmux's keepalive as bare", () => {
    expect(isBareShellTree({ processes: [proc({ name: "-zsh" }), proc({ name: "sleep" })] })).toBe(true);
  });

  it("never reads an empty tree, or a keepalive alone, as bare", () => {
    expect(isBareShellTree({ processes: [] })).toBe(false);
    expect(isBareShellTree({ processes: [proc({ name: "sleep" })] })).toBe(false);
  });

  it("reads anything working, at the root or under the shell, as not bare", () => {
    expect(isBareShellTree({ processes: [proc({ children: [proc({ name: "node" })], name: "zsh" })] })).toBe(false);
    expect(isBareShellTree({ processes: [proc({ name: "zsh" }), proc({ name: "2.1.241" })] })).toBe(false);
  });
});

/** One live workspace. */
function workspace(over: Partial<CmuxWorkspaceSummary>): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/w",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: "/w",
    windowId: "window:1",
    workspaceId: "id-1",
    workspaceRef: "workspace:1",
    ...over,
  };
}

/** One ledger row on a workspace. */
function row({
  status,
  workspaceRef,
  cwd,
}: {
  status: "open" | "closed";
  workspaceRef: string;
  cwd: string;
}): SessionItem {
  return {
    cwd,
    lastEventIso: "2026-10-09T03:00:00.000Z",
    sessionKey: `k-${workspaceRef}`,
    slug: `s-${workspaceRef}`,
    status,
    workspaceRef,
  };
}

describe("resumeShellCandidates", () => {
  const bare = workspace({ workspaceId: "bare", workspaceRef: "workspace:1" });
  const seat = workspace({ currentDirectory: "/w/seat", workspaceId: "seat", workspaceRef: "workspace:2" });
  const pinned = workspace({ pinned: true, workspaceId: "chair", workspaceRef: "workspace:3" });
  const own = workspace({ workspaceId: "own", workspaceRef: "workspace:4" });
  const retired = workspace({ currentDirectory: "/w/old", workspaceId: "old", workspaceRef: "workspace:5" });

  it("keeps only what no open row pairs to, bar the pinned and the caller's own", () => {
    const rows = [
      row({ cwd: "/w/seat", status: "open", workspaceRef: "workspace:2" }),
      row({ cwd: "/w/old", status: "closed", workspaceRef: "workspace:5" }),
    ];
    const candidates = resumeShellCandidates({
      ownWorkspaceId: "own",
      rows,
      workspaces: [bare, seat, pinned, own, retired],
    });
    expect(candidates.map((candidate) => candidate.workspaceId)).toEqual(["bare", "old"]);
  });
});
