/**
 * How `handover reconcile` builds its two lists — and, in particular, the one row it must NOT call ready.
 *
 * `ready` is the field `src/supervisor/outcomes/coverage.ts` filters `unspawned` on, so it is the field a
 * fill reads as available work. The supersession exclusion is asserted here at that exact seam rather than
 * only over the pure predicate, because the predicate being right and the flag never reaching the row would
 * look identical from `supervisorSupersession.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  rankedRows,
  supersessionLine,
  workedFromCmux,
  workedFromOpenRuns,
} from "../../../cli/commands/handover/reconcileRows.js";
import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import type { BoardRow } from "../../../handover/rank.js";
import { chairDoc, ordinaryDoc, rowFor } from "./reconcileRowsFixture.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "reconcile-rows-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The board for two chair docs that have never run, both of which sit in `RUN NOW`. */
function twoChairModels(): readonly BoardModel[] {
  const docs = [chairDoc({ slug: "chair-old" }), chairDoc({ slug: "chair-new" })];
  return composeBoardModels({
    journals: new Map(),
    probeStates: new Map(),
    resolutionDocs: docs,
    roots: docs,
  });
}

describe("rankedRows", () => {
  const nowIso = "2026-09-21T00:00:00.000Z";

  it("still ranks both chairs, and calls neither superseded one NOT ready", () => {
    const rows = rankedRows({
      home,
      deferred: new Map(),
      disconnected: new Set(),
      priorities: [],
      models: twoChairModels(),
      nowIso,
      supersession: { superseded: new Set(), unresolved: undefined },
      trunkMoved: new Set(),
    });
    expect(rowFor({ id: "chair-old", rows }).ready).toBe(true);
    expect(rowFor({ id: "chair-new", rows }).ready).toBe(true);
  });

  it("drops `ready` on the superseded chair ALONE, leaving the row itself on the board", () => {
    const rows = rankedRows({
      home,
      deferred: new Map(),
      disconnected: new Set(),
      priorities: [],
      models: twoChairModels(),
      nowIso,
      supersession: { superseded: new Set(["chair-old"]), unresolved: undefined },
      trunkMoved: new Set(),
    });
    expect(rowFor({ id: "chair-old", rows }).ready).toBe(false);
    expect(rowFor({ id: "chair-new", rows }).ready).toBe(true);
  });

  // An UNRESOLVED read is not a no. Found by an adversarial review pass: on a tick where cmux failed, a
  // chair a later one had already replaced reached BOTH the top band and `starving` — offered as the single
  // most urgent startable row on the board, which is what spawned a second chair once already. Holding every
  // chair costs one row's availability for that tick; the other direction costs a duplicate chair.
  it("holds EVERY chair when the read could not be made, since which one is retired is unknown", () => {
    const rows = rankedRows({
      home,
      deferred: new Map(),
      disconnected: new Set(),
      priorities: [],
      models: twoChairModels(),
      nowIso,
      supersession: { superseded: new Set(), unresolved: "cmux could not be read, so the pinned chair is unknown" },
      trunkMoved: new Set(),
    });
    expect(rowFor({ id: "chair-old", rows }).ready).toBe(false);
    expect(rowFor({ id: "chair-new", rows }).ready).toBe(false);
  });

  it("holds only the CHAIRS on an unresolved read, leaving an ordinary row ready", () => {
    const models = composeBoardModels({
      journals: new Map(),
      probeStates: new Map(),
      resolutionDocs: [ordinaryDoc({ slug: "atlas-resync" })],
      roots: [ordinaryDoc({ slug: "atlas-resync" })],
    });
    const rows = rankedRows({
      home,
      deferred: new Map(),
      disconnected: new Set(),
      priorities: [],
      models,
      nowIso,
      supersession: { superseded: new Set(), unresolved: "cmux could not be read, so the pinned chair is unknown" },
      trunkMoved: new Set(),
    });

    expect(rowFor({ id: "atlas-resync", rows }).ready).toBe(true);
  });
});

describe("supersessionLine", () => {
  it("says nothing when a clean read found no retired chair", () => {
    expect(supersessionLine({ supersession: { superseded: new Set(), unresolved: undefined } })).toBeUndefined();
  });

  it("counts the chairs a clean read excluded", () => {
    expect(supersessionLine({ supersession: { superseded: new Set(["a", "b"]), unresolved: undefined } })).toBe(
      "(2 retired supervisor chair doc(s) excluded from ready — a later chair holds the pin.)",
    );
  });

  it("says every chair was held, and why, rather than reporting a silent zero", () => {
    expect(supersessionLine({ supersession: { superseded: new Set(), unresolved: "cmux could not be read" } })).toBe(
      "(EVERY supervisor chair doc is held rather than ready — cmux could not be read, so which of them a later chair retired cannot be judged.)",
    );
  });
});

/** One cmux workspace listing entry, defaulting to an ordinary unpinned workstream row. */
function workspace(over: Partial<CmuxWorkspaceSummary> = {}): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/w/.claude/worktrees.noindex/chair-new",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned: false,
    selected: false,
    title: "chair-new",
    windowId: "window:1",
    workspaceId: "ws-1",
    workspaceRef: "workspace:9",
    ...over,
  };
}

describe("workedFromCmux", () => {
  const rows: readonly BoardRow[] = [
    {
      groomed: true,
      id: "chair-new",
      kind: "doc",
      label: "the next chair",
      openedIso: undefined,
      priority: "p1",
      ready: true,
      ruled: false,
      standing: "ready",
      waitingHours: 0,
    },
  ];

  it("maps a workspace to the row its directory basename names", () => {
    expect(workedFromCmux({ rows, sessions: [], workspaces: [workspace()] })).toEqual([
      { rowId: "chair-new", session: "workspace:9" },
    ]);
  });

  it("names no row for a workspace standing somewhere the board does not know", () => {
    expect(
      workedFromCmux({ rows, sessions: [], workspaces: [workspace({ currentDirectory: "/w/somewhere-else" })] }),
    ).toEqual([{ rowId: undefined, session: "workspace:9" }]);
  });

  it("answers undefined — not an empty fleet — when cmux could not be read", () => {
    expect(workedFromCmux({ rows, sessions: [], workspaces: undefined })).toBeUndefined();
  });
});

describe("workedFromOpenRuns", () => {
  it("reports nothing in flight for a board whose rows have never run", () => {
    expect(workedFromOpenRuns({ models: twoChairModels() })).toEqual([]);
  });
});

/**
 * A registered ask carrying its whole shape and no run is the owner's decision, never a seat's work — so the fill must not
 * read it as ready. Measured: four such rows were ranked starving while the owner could not find them.
 */
describe("a registered ask carrying its whole shape, with no run", () => {
  it("stands waiting-on-owner and is NOT ready, beside an unshaped ask that is", () => {
    const unshaped = {
      ...ordinaryDoc({ slug: "unshaped" }),
      askedIso: "2026-09-24T00:00:00.000Z",
      kind: "ask" as const,
    };
    const shaped = {
      ...unshaped,
      lean: "medium",
      options: [
        { letter: "A", option: "medium", tradeoff: "faster" },
        { letter: "B", option: "high", tradeoff: "slower" },
      ],
      path: "/h/shaped.md",
      problem: "a lookup is slow",
      slug: "shaped",
    };
    const docs = [unshaped, shaped];
    const rows = rankedRows({
      home,
      deferred: new Map(),
      disconnected: new Set(),
      priorities: [],
      models: composeBoardModels({ journals: new Map(), probeStates: new Map(), resolutionDocs: docs, roots: docs }),
      nowIso: "2026-09-30T00:00:00.000Z",
      supersession: { superseded: new Set(), unresolved: undefined },
      trunkMoved: new Set(),
    });

    expect([rowFor({ id: "shaped", rows }).standing, rowFor({ id: "shaped", rows }).ready]).toEqual([
      "waiting-on-owner",
      false,
    ]);
    expect(rowFor({ id: "unshaped", rows }).ready).toBe(true);
  });
});
