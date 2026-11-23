/**
 * THE REPLAY — one chair's tick 288, the last of six ticks that spawned nothing on a free machine, run
 * through the gate that did not exist when it happened.
 *
 * On a CPU panel at 89% idle the fleet was not using its capacity at all. The
 * two documents under `../../fixtures/supervisor/handoff-9291-tick-288/` — a `supervisor tick-record` draft
 * and a `handover reconcile --json` — are WRITTEN synthetic documents in the exact shape that tick read and
 * recorded, not a capture of it.
 *
 * ## What the synthetic documents carry
 *
 * The draft carries a capacity `hold`/`holdSubjects`/`load1`, a gauge `nextAllModels`, and every action and
 * judgement reduced to kind, outcome and subject — the fields any of the three gates reads. The
 * reconciliation carries `ready`, the three placement lists and `outcomes`, every row reduced to id, kind,
 * priority, groomed and ready. Row ids are placeholders (`row-NNNN`) and each outcome is a placeholder
 * (`outcome-NN`, a synthetic title and anchor) — neither gate reads the register, only the document. Every
 * list keeps the order, membership and counts of the tick it stands for, so both verdicts are the ones that
 * tick earned.
 *
 * ## The one thing today's board would do differently
 *
 * All 13 p1 rows here are `fresh-supervisor-handoff-*`, retired chairs' docs. The tick predates
 * `../../../handover/supervisorSupersession.ts`, which now composes a superseded supervisor doc to `blocked`,
 * so today's reconcile would not list them as ready. The 18 p2 rows stand for planned work either way.
 *
 * ## Why the idle-capacity replay reads a DOCS-ONLY view of the reconciliation
 *
 * The gate owes asks (`../../../supervisor/idleCapacityGate.ts` § "Asks are owed exactly as
 * docs are"), and this fixture's `ready` carries 361 p0–p2 asks. They read `ready` under the board of that
 * night, which still composed an ask waiting on the owner's word to `RUN NOW`; today's board places such an ask
 * WAITING ON OWNER (`../../../handover/registeredAsk.ts`). Owing them here would replay a rule that board
 * never had over rows it would not list. So the incident this file witnesses — 31 docs on a free machine —
 * is judged over the fixture's doc rows, the fixture JSON is untouched, and the first case pins what the
 * projection drops so a rewritten fixture cannot change it silently.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isRecord } from "../../../lib/parsers.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import { judgeIdleCapacity } from "../../../supervisor/idleCapacityGate.js";
import type { OutcomeCoverage } from "../../../supervisor/outcomes/coverage.js";
import { judgeSweep } from "../../../supervisor/outcomes/sweepGate.js";

import { boardRow, emittedFields } from "./outcomes/emittedRowFixture.js";

/** Where the two fixture documents live. */
const FIXTURE = join(import.meta.dirname, "..", "..", "fixtures", "supervisor", "handoff-9291-tick-288");

/** One fixture document, as a record. */
function fixture({ name }: { name: string }): Record<string, unknown> {
  const parsed = safeJsonParse({ label: name, text: readFileSync(join(FIXTURE, name), "utf8") });
  if (!isRecord(parsed)) {
    throw new Error(`${name} is not a JSON object`);
  }
  return parsed;
}

const draft = fixture({ name: "draft.json" });
const reconciliation = fixture({ name: "reconcile.json" });

/** The fixture's ready rows, which the fixture document must carry as a list. */
const readyRows = reconciliation["ready"];
if (!Array.isArray(readyRows)) {
  throw new Error("reconcile.json carries no ready list");
}

/** The fixture's outcome coverage, which the fixture document must carry as a list. */
const coverageRows = reconciliation["outcomes"];
if (!Array.isArray(coverageRows)) {
  throw new Error("reconcile.json carries no outcomes list");
}

/** A string field the reduced fixture must carry, or a throw naming what it lacked. */
function frozenString({ on, key }: { on: unknown; key: string }): string {
  const value = isRecord(on) ? on[key] : undefined;
  if (typeof value !== "string") {
    throw new Error(`reconcile.json carries an outcome entry with no string \`${key}\``);
  }
  return value;
}

/** A list field the reduced fixture must carry, or a throw naming what it lacked. */
function frozenList({ on, key }: { on: Record<string, unknown>; key: string }): readonly unknown[] {
  const value = on[key];
  if (!Array.isArray(value)) {
    throw new Error(`reconcile.json carries an outcome row with no \`${key}\` list`);
  }
  return value;
}

/** One reduced fixture outcome rebuilt in the shape reconcile emits today, the ids and sessions it froze kept. */
function emitted({ entry }: { entry: unknown }): OutcomeCoverage {
  if (!isRecord(entry)) {
    throw new Error("reconcile.json carries an outcome row that is not a record");
  }
  const live = frozenList({ key: "live", on: entry }).map((one, index) => ({
    rank: index + 1,
    row: boardRow({
      id: frozenString({ key: "id", on: isRecord(one) ? one["row"] : one }),
      ready: false,
      standing: "in-flight",
    }),
    session: frozenString({ key: "session", on: one }),
  }));
  const unspawned = frozenList({ key: "unspawned", on: entry }).map((one) =>
    boardRow({ id: frozenString({ key: "id", on: one }) }),
  );
  const title = frozenString({ key: "title", on: entry });
  return {
    anchor: frozenString({ key: "anchor", on: entry }),
    id: frozenString({ key: "id", on: entry }),
    live,
    rows: live.length + unspawned.length,
    title,
    unspawned,
    words: title,
  };
}

/**
 * The reconciliation in today's coverage shape. The fixture predates the owner's outcomes coming off the Workstreams register
 * and was reduced to what the gates read: it declares no `outcomeSource`, `uncoveredOutcomes` or `unanchoredOutcomes`,
 * its rows carry no `words` or `rows`, its live seats no rank and its board rows only their ids. The coverage reader
 * (`../../../supervisor/outcomes/reconciledOutcomes.ts`) refuses anything short of what reconcile emits, and the gate
 * judges on none of those fields, so the outcome half is rebuilt whole by reconcile's own `outcomeFields`: the source
 * is declared as the register those rows stand for, each row's synthetic title stands in for the owner's words, each seat is
 * ranked by its order and each board row filled as a ready doc (an in-flight one under a seat) named by the id it
 * froze. The fixture JSON is untouched.
 */
const withSource = {
  ...reconciliation,
  ...emittedFields({ outcomes: coverageRows.map((entry) => emitted({ entry })) }),
};

/** The reconciliation with only its doc rows ready — the board of that night, as the module header explains. */
const docsOnly = { ...reconciliation, ready: readyRows.filter((entry) => isRecord(entry) && entry["kind"] === "doc") };

/** The 31 rows the tick left, in the reconciliation's rank order. */
const P1_ROWS = [9117, 9230, 9233, 9234, 9236, 9237, 9239, 9240, 9241, 9242, 9243, 9244, 9245].map((n) => ({
  id: `fresh-supervisor-handoff-${String(n)}`,
  priority: "p1",
}));
const P2_ROWS = Array.from({ length: 18 }, (_, index) => ({
  id: `row-${String(375 + index).padStart(4, "0")}`,
  priority: "p2",
}));

describe("handoff-9291 tick 288, replayed", () => {
  it("was PASSED by the sweep gate — the hole: every outcome it judged was covered or carried a copied rationale", () => {
    expect(
      judgeSweep({
        actions: draft["actions"],
        judgements: draft["judgements"],
        reconciliation: withSource,
        sources: draft["sources"],
      }),
    ).toStrictEqual({ kind: "clean" });
    expect(coverageRows.length).toBeGreaterThan(0);
  });

  it("keeps the fixture's 75 ready docs and drops its 401 asks, 361 of them at p0–p2", () => {
    const owedAsks = readyRows.filter(
      (entry) => isRecord(entry) && entry["kind"] === "ask" && entry["priority"] !== "p3",
    );

    expect(readyRows.length).toBe(476);
    expect(docsOnly.ready.length).toBe(75);
    expect(owedAsks.length).toBe(361);
  });

  it("is REFUSED by the idle-capacity gate, naming all 31 ready p1/p2 docs nobody was on", () => {
    expect(
      judgeIdleCapacity({
        actions: draft["actions"],
        judgements: draft["judgements"],
        reconciliation: docsOnly,
        sources: draft["sources"],
      }),
    ).toStrictEqual({
      bindingCeilingId: null,
      ceilingMeasurementProblem: null,
      ceilings: null,
      kind: "refused",
      load1: 3.77,
      rows: [...P1_ROWS, ...P2_ROWS],
      seatsOwed: null,
      workingSeatCeiling: null,
      workingSeats: null,
      workspaceSpawns: 0,
    });
  });
});
