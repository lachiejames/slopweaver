/**
 * A parked seat the owner's standing-session ruling keeps open, as `handover reconcile` reads it: ready to reseat at the
 * seam the fill reads (`src/supervisor/outcomes/coverage.ts`), and never seated twice while its workspace lives.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boardHolds, rankedRows, workedFromCmux } from "../../../cli/commands/handover/reconcileRows.js";
import { standingSessionNeedsReseat } from "../../../cli/commands/handover/reconcileStanding.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "reconcile-standing-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

const nowIso = "2026-11-04T03:00:00.000Z";
const AT = "2026-11-04T00:34:48.998Z";
// A park reads as a checkpoint only when it names the seat holding the run (`../../../handover/parked.ts`).
const started: RunEvent = { atIso: "2026-11-04T00:40:00.000Z", branch: "owner-seat", docHash: "h", kind: "started" };
const launched: RunEvent = {
  atIso: "2026-11-04T00:41:00.000Z",
  kind: "launched",
  pid: undefined,
  sessionId: "s-1",
  worktree: "/wt/owner-seat",
};
const parked: RunEvent = {
  atIso: "2026-11-04T01:42:00.000Z",
  branch: "owner-seat",
  kind: "parked",
  screenTail: "❯ ",
  sessionId: "s-1",
  workspaceRef: "workspace:1",
  worktree: "/wt/owner-seat",
};

/** The owner's standing-session ruling, bounded or not. */
function standing({ untilIso }: { untilIso?: string } = {}): RunEvent {
  return {
    anchor: "talk:p9",
    atIso: AT,
    decidedIso: AT,
    kind: "ruling",
    ruling: "keep that session open for me",
    standingSession: untilIso === undefined ? {} : { untilIso },
  };
}

/** One in-flight doc naming a repo, whose journal holds the events given. */
function modelOf({ events, slug = "owner-seat" }: { events: readonly RunEvent[]; slug?: string }): BoardModel {
  const text = [
    "---",
    `slug: ${slug}`,
    "summary: the owner's dedicated session",
    "status: in-progress",
    "priority: p1",
    "repo: /w/repo",
    "probeWaiver: the whole outcome is a live seat",
    "---",
    "",
    "body",
  ].join("\n");
  const docs = [parseHandoverDoc({ path: `/h/${slug}.md`, text })];
  const journals = new Map([[slug, { events, unreadableLines: [] }]]);
  return composeBoardModels({ journals, probeStates: new Map(), resolutionDocs: docs, roots: docs })[0]!;
}

describe("a parked seat the owner's standing-session ruling keeps open", () => {
  it("reseats a parked standing seat, and leaves an open seat, an unruled park and an expired one alone", () => {
    expect([
      standingSessionNeedsReseat({ model: modelOf({ events: [started, launched, standing(), parked] }), nowIso }),
      standingSessionNeedsReseat({ model: modelOf({ events: [started, launched, standing()] }), nowIso }),
      standingSessionNeedsReseat({ model: modelOf({ events: [started, launched, parked] }), nowIso }),
      standingSessionNeedsReseat({
        model: modelOf({ events: [started, launched, standing({ untilIso: nowIso }), parked] }),
        nowIso,
      }),
    ]).toEqual([true, false, false, false]);
  });

  it("reaches the ranked row as ready, at the seam the fill reads", () => {
    const models = [modelOf({ events: [started, launched, standing(), parked] })];
    const rows = rankedRows({
      deferred: new Map(),
      disconnected: new Set(),
      home,
      models,
      nowIso,
      priorities: [],
      supersession: { superseded: new Set(), unresolved: undefined },
      trunkMoved: new Set(),
    });
    expect(rows.find((row) => row.id === "owner-seat")!.ready).toBe(true);
  });

  it("lifts a parked standing seat past the trunk-moved hold, since the reseated seat is the one that rechecks it", () => {
    const rows = rankedRows({
      deferred: new Map(),
      disconnected: new Set(),
      home,
      models: [modelOf({ events: [started, launched, standing(), parked] })],
      nowIso,
      priorities: [],
      supersession: { superseded: new Set(), unresolved: undefined },
      trunkMoved: new Set(["/h/owner-seat.md"]),
    });
    expect(rows.find((row) => row.id === "owner-seat")!.ready).toBe(true);
  });

  it("holds a lifted seat that needs an integration this install is not connected to, as a composed RUN NOW row is (disconnected)", () => {
    const needsFathom: RunEvent = {
      atIso: AT,
      drop: [],
      kind: "tagged",
      set: [{ key: "needs", value: "fathom" }],
      why: "its first read is a recorded call",
    };
    const models = [modelOf({ events: [started, launched, needsFathom, standing(), parked] })];
    const holds = boardHolds({
      docs: models.map((model) => model.doc),
      home,
      models,
      nowIso,
      sessions: [],
      workspaces: [],
    });
    const rows = rankedRows({
      deferred: new Map(),
      disconnected: new Set(holds.disconnected.held.keys()),
      home,
      models,
      nowIso,
      priorities: [],
      supersession: { superseded: new Set(), unresolved: undefined },
      trunkMoved: new Set(),
    });
    const seat = rows.find((row) => row.id === "owner-seat")!;
    expect([models[0]!.section, [...holds.disconnected.held.keys()], seat.standing, seat.ready]).toEqual([
      "IN FLIGHT",
      ["/h/owner-seat.md"],
      "blocked",
      false,
    ]);
  });

  it("counts a seat whose shell moved into a subdirectory named after another row as occupying its own", () => {
    const rows = rankedRows({
      deferred: new Map(),
      disconnected: new Set(),
      home,
      models: [modelOf({ events: [started, launched, standing(), parked] }), modelOf({ events: [], slug: "handover" })],
      nowIso,
      priorities: [],
      supersession: { superseded: new Set(), unresolved: undefined },
      trunkMoved: new Set(),
    });
    const seat = {
      currentDirectory: "/w/repo/.claude/worktrees.noindex/owner-seat/src/handover",
      description: undefined,
      latestConversationMessage: undefined,
      latestSubmittedAtIso: undefined,
      latestSubmittedMessage: undefined,
      pinned: false,
      selected: false,
      title: undefined,
      windowId: "window:1",
      workspaceId: "id-1",
      workspaceRef: "workspace:1",
    };
    const nested = {
      ...seat,
      currentDirectory: "/w/repo/.claude/worktrees.noindex/owner-seat/tmp/.claude/worktrees/handover",
      workspaceId: "id-2",
      workspaceRef: "workspace:2",
    };
    expect(workedFromCmux({ rows, sessions: [], workspaces: [seat, nested] })).toEqual([
      { rowId: "owner-seat", session: "workspace:1" },
      { rowId: "owner-seat", session: "workspace:2" },
    ]);
  });
});
