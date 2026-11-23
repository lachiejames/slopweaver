/**
 * The banners `handover list` prints around the board.
 *
 * Every one of these was a `print*` that wrote through `logger` and returned nothing, so asserting on a
 * truncation caveat meant capturing stdout — which is why none of them had a test. Splitting the file under
 * the ratchet turned them into functions over their own inputs, and these are the cases that were
 * previously unreachable: what the banner SAYS, not merely that something was written.
 */
import { describe, expect, it } from "vitest";

import { NO_DETACHED_FINDINGS } from "../../../../../cli/commands/handover/listJson.js";
import {
  completenessWarningLines,
  detachedAskLines,
  emptyBoardLines,
  stuckBlockerLines,
  truncationBannerLines,
} from "../../../../../cli/commands/handover/listPresentation.js";
import { composeBoardModels } from "../../../../../handover/boardState.js";
import { type BoardModel } from "../../../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../../../handover/doc.js";
import { EMPTY_TAG_FILTER } from "../../../../../handover/tagFilter.js";

function doc({ slug, blockedBy = [] }: { slug: string; blockedBy?: readonly string[] }): HandoverDoc {
  return {
    anchor: undefined,
    artifact: undefined,
    askedIso: undefined,
    baseBranch: undefined,
    blockedBy,
    branch: undefined,
    doneWhen: [],
    evidence: [],
    kind: "doc",
    notDoneReason: undefined,
    observedBy: undefined,
    registeredBy: undefined,
    registeredRun: undefined,
    origin: undefined,
    outputs: [],
    path: `/h/${slug}.md`,
    pausedOn: undefined,
    pausedSince: undefined,
    risk: undefined,
    blastRadius: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    priority: undefined,
    probeWaiver: undefined,
    lean: undefined,
    examples: [],
    exampleGap: undefined,
    options: [],
    problem: undefined,
    problems: [],
    repo: "/w/repo",
    role: undefined,
    ruling: undefined,
    rulingAnchor: undefined,
    hisWords: { kind: "absent" },
    hisWordsSteers: [],
    settlement: undefined,
    settlementReason: undefined,
    settlementWitness: undefined,
    slug,
    status: "ready",
    statusSummary: undefined,
    summary: `what ${slug} does`,
    supervisorState: undefined,
  };
}

function modelsFor({ docs }: { docs: readonly HandoverDoc[] }): readonly BoardModel[] {
  return composeBoardModels({
    journals: new Map(),
    probeStates: new Map(),
    resolutionDocs: docs,
    roots: docs,
  });
}

describe("truncationBannerLines", () => {
  it("names the budget, the unresolved count and the flag that lifts it", () => {
    const lines = truncationBannerLines({ budget: 60, sweep: { total: 40, unresolved: 7 } });

    expect(lines[0]).toBe(
      "⚠ TRUNCATED — the 60s probe deadline expired with 7 of 40 probe-carrying doc(s) unresolved.",
    );
    expect(lines[1]).toContain("--deadline 0");
    expect(lines[2]).toBe("");
  });

  it("says nothing when the sweep resolved every doc", () => {
    expect(truncationBannerLines({ budget: 60, sweep: { total: 40, unresolved: 0 } })).toEqual([]);
  });
});

describe("completenessWarningLines", () => {
  it("names every scanned doc the board failed to place, with both counts", () => {
    const placed = doc({ slug: "placed" });
    const lines = completenessWarningLines({
      docs: [placed, doc({ slug: "dropped" })],
      models: modelsFor({ docs: [placed] }),
    });

    expect(lines[0]).toBe("⚠ INCOMPLETE — scanned 2 doc(s) but the board placed only 1. Missing: dropped");
    expect(lines[1]).toBe("");
  });

  it("says nothing when every scanned doc was placed", () => {
    const docs = [doc({ slug: "one" }), doc({ slug: "two" })];

    expect(completenessWarningLines({ docs, models: modelsFor({ docs }) })).toEqual([]);
  });
});

describe("stuckBlockerLines", () => {
  it("counts the docs whose blockedBy names a slug that does not exist", () => {
    const lines = stuckBlockerLines({ models: modelsFor({ docs: [doc({ blockedBy: ["ghost"], slug: "waiting" })] }) });

    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("1 doc(s) name a blockedBy slug that does not exist — a typo blocks forever.");
  });

  it("says nothing when every named dependency resolves", () => {
    const docs = [doc({ slug: "first" }), doc({ blockedBy: ["first"], slug: "second" })];

    expect(stuckBlockerLines({ models: modelsFor({ docs }) })).toEqual([]);
  });
});

describe("emptyBoardLines", () => {
  it("tells a reader where it looked and how to write one", () => {
    const lines = emptyBoardLines({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      json: false,
      scanStartedIso: "2026-09-27T06:00:00.000Z",
      unreadable: [],
    });

    expect(lines[0]).toBe("No orchestration docs in /h.");
    expect(lines[1]).toBe("Write one with /slopweaver:handover, or point --dir at where yours live.");
  });

  it("emits a rowless DOCUMENT under --json, so a caller can tell empty from failed", () => {
    const lines = emptyBoardLines({
      detached: NO_DETACHED_FINDINGS,
      filter: EMPTY_TAG_FILTER,
      handoverDir: "/h",
      json: true,
      scanStartedIso: "2026-09-27T06:00:00.000Z",
      unreadable: ["/h/bad.md"],
    });

    expect(lines.length).toBe(1);
    const parsed: unknown = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({
      detachedAsks: [],
      handoverDir: "/h",
      rows: [],
      unreadJournals: [],
      unreadable: ["/h/bad.md"],
      unresolved: 0,
    });
  });
});

describe("detachedAskLines", () => {
  const ask = {
    askedIso: "2026-10-08T01:00:00.000Z",
    journal: "/home/runs/gone.jsonl",
    question: "Ship it?",
    slug: "gone",
  };

  it("offers abandon only for a doc proven gone", () => {
    const lines = detachedAskLines({
      detached: { detachedAsks: [{ ...ask, doc: { kind: "missing" } }], unreadJournals: [] },
    });

    expect(lines).toEqual([
      "",
      "WAITING ON OWNER, NO DOC ON THE BOARD (1)",
      "  gone — asked 2026-10-08T01:00:00.000Z",
      "    Ship it?",
      "    journal: /home/runs/gone.jsonl",
      "    its doc is in neither handovers/ nor handovers/archive/: restore it, or end the run with",
      '    slopweaver handover abandon gone --why "<why>"',
    ]);
  });

  it("says repair, never abandon, for a doc that would not read", () => {
    const lines = detachedAskLines({
      detached: { detachedAsks: [{ ...ask, doc: { kind: "unreadable", why: "bad yaml" } }], unreadJournals: [] },
    });

    expect(lines.slice(5)).toEqual([
      "    its doc could not be read: bad yaml",
      "    repair it and re-run handover list",
    ]);
    expect(lines.some((line) => line.includes("abandon"))).toBe(false);
  });

  it("names every journal it could not read", () => {
    const lines = detachedAskLines({
      detached: { detachedAsks: [], unreadJournals: [{ journal: "/home/runs/x.jsonl", why: "line 2 undecodable" }] },
    });

    expect(lines).toEqual([
      "",
      "⚠ 1 journal(s) no board doc claims would not read, so a question one holds is on no surface:",
      "  /home/runs/x.jsonl: line 2 undecodable",
    ]);
  });

  it("prints nothing when the sweep found nothing", () => {
    expect(detachedAskLines({ detached: NO_DETACHED_FINDINGS })).toEqual([]);
  });
});
