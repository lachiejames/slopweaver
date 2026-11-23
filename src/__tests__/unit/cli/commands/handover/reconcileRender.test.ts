/*
 * `handover reconcile`'s human read: one line per row with its label cut to fit, each finding capped and the rest
 * counted by default, every label whole and every finding uncapped behind `--full`. The renderer is pure, so each
 * case builds a real reconciliation over constructed rows.
 */
import { describe, expect, it } from "vitest";

import { renderReconciliationLines } from "../../../../../cli/commands/handover/reconcilePrint.js";
import { type BoardHolds } from "../../../../../cli/commands/handover/reconcileRows.js";
import {
  HANDOVER_RECONCILE_FLAG_NAMES,
  parseHandoverReconcileArgs,
} from "../../../../../cli/commands/handover/reconcileRun.js";
import { type BoardRow } from "../../../../../handover/rank.js";
import { reconcile } from "../../../../../handover/reconcile.js";

const HOLDS: BoardHolds = {
  disconnected: { held: new Map(), unread: undefined },
  duplicateRecipeFailures: [],
  repoless: [],
  repolessUrgent: [],
  sharedSlugs: [],
  supersession: { superseded: new Set(), unresolved: undefined },
  trunkMoved: { held: new Map(), pullsUnchecked: [], unread: [] },
};

const row = ({ id, label, kind = "doc" }: { id: string; label: string; kind?: BoardRow["kind"] }): BoardRow => ({
  groomed: true,
  id,
  kind,
  label,
  openedIso: kind === "ask" ? "2026-11-04T12:00:00.000Z" : undefined,
  priority: "p1",
  ready: true,
  ruled: false,
  standing: "ready",
  waitingHours: kind === "ask" ? 24 : 0,
});

const render = ({ ranked, full }: { ranked: readonly BoardRow[]; full: boolean }): readonly string[] =>
  renderReconciliationLines({
    full,
    holds: HOLDS,
    intake: { kind: "unavailable", why: "no transcript" },
    outcomes: { outcomes: [], uncovered: [] },
    ranked,
    result: reconcile({ ranked, worked: [] }),
    scopeFlags: [],
    source: "cmux",
    unanchored: [],
    voice: { kind: "unavailable", why: "no relays" },
  });

/** A 1,600-character label with a line break in it — the shape a board row's whole summary takes. */
const LONG = `First line of the summary\n${"x".repeat(1600)}`;

describe("renderReconciliationLines", () => {
  it("cuts a long label to 120 code points on one line by default", () => {
    const lines = render({ full: false, ranked: [row({ id: "long-row", label: LONG })] });
    const line = lines.find((each) => each.includes("long-row"))!;
    const label = line.split(" — ")[1]!;
    expect(Array.from(label)).toHaveLength(120);
    expect(label).toBe(`First line of the summary ${"x".repeat(93)}…`);
  });

  it("says how many labels it cut and names --full, so a cut tail is never silent", () => {
    const ranked = [row({ id: "long-row", label: LONG }), row({ id: "short-row", label: "fits" })];
    const said = render({ full: false, ranked }).filter((line) => line.includes("label(s) above cut"));
    expect(said).toEqual(["(1 label(s) above cut to 120 characters, ending in … — --full prints them whole)"]);
  });

  it("says nothing about cutting when no label was cut", () => {
    const lines = render({ full: false, ranked: [row({ id: "short-row", label: "fits" })] });
    expect(lines.filter((line) => line.includes("label(s) above cut"))).toEqual([]);
  });

  it("prints the label whole, on one line, under --full, with no cut line", () => {
    const lines = render({ full: true, ranked: [row({ id: "long-row", label: LONG })] });
    const line = lines.find((each) => each.includes("long-row"))!;
    expect(line).toBe(`    1. [p1 doc] long-row — First line of the summary ${"x".repeat(1600)}`);
    expect(lines.filter((each) => each.includes("label(s) above cut"))).toEqual([]);
  });

  it("names five of six stale asks and counts the sixth", () => {
    const ranked = Array.from({ length: 6 }, (_, index) =>
      row({ id: `ask-${String(index + 1)}`, kind: "ask", label: "say yes" }),
    );
    const stale = render({ full: false, ranked }).filter(
      (line) => line.startsWith("stale ask:") || line.startsWith("  … and"),
    );
    expect(stale).toEqual([
      ...[1, 2, 3, 4, 5].map((n) => `stale ask: ask-${String(n)} has been waiting 24h — say yes`),
      "  … and 1 more (--full or --json for all of them)",
    ]);
  });

  it("names all six stale asks under --full", () => {
    const ranked = Array.from({ length: 6 }, (_, index) =>
      row({ id: `ask-${String(index + 1)}`, kind: "ask", label: "say yes" }),
    );
    const stale = render({ full: true, ranked }).filter(
      (line) => line.startsWith("stale ask:") || line.startsWith("  … and"),
    );
    expect(stale).toEqual([1, 2, 3, 4, 5, 6].map((n) => `stale ask: ask-${String(n)} has been waiting 24h — say yes`));
  });
});

describe("handover reconcile --full", () => {
  it("is a declared flag the parser accepts", () => {
    expect(HANDOVER_RECONCILE_FLAG_NAMES).toContain("--full");
    expect(parseHandoverReconcileArgs({ rest: ["--full"] }).isOk()).toBe(true);
  });
});
