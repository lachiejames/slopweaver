import { describe, expect, it } from "vitest";

import { readBoard } from "../../../components/live/read";
import { type RankedRow, type Reconcile } from "../../../components/live/readWorkstreams";
import { boardInContext, reconcileInContext } from "../../../lib/workstreamsContext";
import { ACME_PLACER } from "../../organisationFixture";
import { ACME_ADMIN_PR, BOARD_ROW, board, SLOPWEAVER_PR } from "./fixtures";

/** One ranked row off `handover reconcile --json`, carrying only its id. */
function ranked({ id }: { id: string }): RankedRow {
  return {
    groomed: true,
    id,
    kind: "doc",
    label: `the row ${id}`,
    openedIso: undefined,
    priority: "p1",
    ready: true,
    standing: "ready",
    waitingHours: 3,
  };
}

describe("workstreams — the reconcile tiles, placed by joining each ranked id to the board", () => {
  const RECONCILE: Reconcile = {
    aligned: [{ rank: 1, row: ranked({ id: "iso-least-privilege" }), session: "seat-a" }],
    fleet: "observed",
    headline: "two rows ready",
    held: [],
    holds: { kind: "absent" },
    intake: { clause: "not read", kind: "unavailable", why: "fixture" },
    misaligned: [],
    outcomes: [
      {
        anchor: "transcript:a#b",
        id: "o-1",
        live: [{ rank: 1, row: ranked({ id: "iso-least-privilege" }), session: "seat-a" }],
        rows: 3,
        title: "an outcome spanning both workspaces",
        unspawned: [ranked({ id: "acme-console-pages-react-27-sep" }), ranked({ id: "not-on-the-board" })],
      },
    ],
    rankedCount: 4,
    ready: [
      ranked({ id: "iso-least-privilege" }),
      ranked({ id: "acme-console-pages-react-27-sep" }),
      ranked({ id: "not-on-the-board" }),
      ranked({ id: "no-evidence" }),
    ],
    source: "cmux",
    staleAsks: [],
    starving: [],
    top: [],
    uncoveredOutcomes: [],
    ungroomed: 0,
    unprioritised: [],
    unregistered: ["seat-z"],
  };

  it("keeps only the rows and seats this workspace owns, and counts the other workspace's and the findings apart", () => {
    const narrowed = reconcileInContext({
      board: board(),
      context: "slopweaver",
      placer: ACME_PLACER,
      reconcile: RECONCILE,
    });
    expect(narrowed.reconcile.ready.map((row) => row.id)).toEqual([
      "acme-console-pages-react-27-sep",
      "not-on-the-board",
      "no-evidence",
    ]);
    expect(narrowed.reconcile.aligned).toEqual([]);
    expect(narrowed.reconcile.unregistered).toEqual(["seat-z"]);
    expect(narrowed.hidden).toBe(1);
    expect(narrowed.findings).toBe(1);
  });

  it("keeps an id no board row carries in self by the default rule, and in team not at all", () => {
    const acme = reconcileInContext({ board: board(), context: "work", placer: ACME_PLACER, reconcile: RECONCILE });
    const slopweaver = reconcileInContext({
      board: board(),
      context: "slopweaver",
      placer: ACME_PLACER,
      reconcile: RECONCILE,
    });
    expect(acme.offBoard).toEqual([]);
    expect(slopweaver.offBoard).toEqual(["not-on-the-board"]);
    expect(acme.reconcile.ready.map((row) => row.id)).not.toContain("not-on-the-board");
    expect(slopweaver.reconcile.ready.map((row) => row.id)).toContain("not-on-the-board");
  });

  it("keeps in self an id whose board rows are each placed but in different ones, since the board lists neither under its findings", () => {
    const split = readBoard({
      rows: [
        { ...BOARD_ROW, prUrls: [ACME_ADMIN_PR], slug: "shared" },
        { ...BOARD_ROW, prUrls: [SLOPWEAVER_PR], slug: "shared" },
      ],
      unresolved: 0,
    })!;
    const reconcile: Reconcile = { ...RECONCILE, ready: [ranked({ id: "shared" })] };
    const acme = reconcileInContext({ board: split, context: "work", placer: ACME_PLACER, reconcile });
    const slopweaver = reconcileInContext({ board: split, context: "slopweaver", placer: ACME_PLACER, reconcile });
    expect(boardInContext({ board: split, context: "slopweaver", placer: ACME_PLACER }).findings).toEqual([]);
    expect([acme.reconcile.ready.map((row) => row.id), slopweaver.reconcile.ready.map((row) => row.id)]).toEqual([
      [],
      ["shared"],
    ]);
    expect([acme.joinedConflicts, slopweaver.joinedConflicts, slopweaver.findings]).toEqual([[], ["shared"], 0]);
    expect(acme.placements.get("shared")!.kind).toBe("conflict");
  });

  it("keeps that joined conflict in self when a third row sharing its slug is unplaced, which the findings draw apart", () => {
    const split = readBoard({
      rows: [
        { ...BOARD_ROW, slug: "shared" },
        { ...BOARD_ROW, prUrls: [ACME_ADMIN_PR], slug: "shared" },
        { ...BOARD_ROW, prUrls: [SLOPWEAVER_PR], slug: "shared" },
      ],
      unresolved: 0,
    })!;
    const reconcile: Reconcile = { ...RECONCILE, ready: [ranked({ id: "shared" })] };
    const acme = reconcileInContext({ board: split, context: "work", placer: ACME_PLACER, reconcile });
    const slopweaver = reconcileInContext({ board: split, context: "slopweaver", placer: ACME_PLACER, reconcile });
    expect(
      boardInContext({ board: split, context: "slopweaver", placer: ACME_PLACER }).findings.map((row) => row.slug),
    ).toEqual(["shared"]);
    expect([acme.reconcile.ready.map((row) => row.id), slopweaver.reconcile.ready.map((row) => row.id)]).toEqual([
      [],
      ["shared"],
    ]);
    expect([acme.joinedConflicts, slopweaver.joinedConflicts, slopweaver.findings]).toEqual([[], ["shared"], 0]);
  });

  it("lists an id whose board row is a finding in self by the default rule, under its mark, and not in team", () => {
    const own = reconcileInContext({
      board: board(),
      context: "slopweaver",
      placer: ACME_PLACER,
      reconcile: RECONCILE,
    });
    const team = reconcileInContext({ board: board(), context: "work", placer: ACME_PLACER, reconcile: RECONCILE });
    expect(own.reconcile.ready.map((row) => row.id)).toContain("no-evidence");
    expect(team.reconcile.ready.map((row) => row.id)).not.toContain("no-evidence");
    expect([own.findings, team.findings]).toEqual([1, 0]);
    expect(own.placements.get("no-evidence")!.kind).toBe("unplaced");
    expect(
      boardInContext({ board: board(), context: "slopweaver", placer: ACME_PLACER }).findings.map((row) => row.slug),
    ).toEqual(["no-evidence"]);
  });

  it("narrows an outcome's live and unspawned rows too, keeping the outcome and its whole-board count", () => {
    const [outcome] = reconcileInContext({
      board: board(),
      context: "slopweaver",
      placer: ACME_PLACER,
      reconcile: RECONCILE,
    }).reconcile.outcomes;
    expect(outcome.live).toEqual([]);
    expect(outcome.unspawned.map((row) => row.id)).toEqual(["acme-console-pages-react-27-sep", "not-on-the-board"]);
    expect(outcome.rows).toBe(3);
  });

  it("carries the verb's whole-board totals through untouched", () => {
    const narrowed = reconcileInContext({ board: board(), context: "work", placer: ACME_PLACER, reconcile: RECONCILE });
    expect(narrowed.reconcile.rankedCount).toBe(4);
    expect(narrowed.reconcile.headline).toBe("two rows ready");
    expect(narrowed.reconcile.ready.map((row) => row.id)).toEqual(["iso-least-privilege"]);
    expect(narrowed.reconcile.aligned.map((seat) => seat.session)).toEqual(["seat-a"]);
  });
});
