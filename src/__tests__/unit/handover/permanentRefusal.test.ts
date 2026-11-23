/**
 * The refusals `cmux spawn` makes that no later tick can lift, read off a real parsed doc and a journal — the
 * one predicate the spawn door and `handover wake` share, so the wake never knocks on a door that will not open.
 */
import { describe, expect, it } from "vitest";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { finishedCycleRefusal, permanentRefusalOf } from "../../../handover/permanentRefusal.js";

const STARTED: RunEvent = { atIso: "2026-10-16T01:00:00.000Z", branch: "row", docHash: "h", kind: "started" };

/** A row on the board carrying the front-matter lines named. */
function row({ front }: { front: readonly string[] }): HandoverDoc {
  return parseHandoverDoc({
    path: "/h/row.md",
    text: ["---", "slug: row", "summary: a row", ...front, "---", "", "# row", ""].join("\n"),
  });
}

/** The kind and reason of a row's permanent refusal, or `undefined` for a row spawn may open. */
function refusalOf({
  events = [STARTED],
  front,
  rerunAllowed = false,
}: {
  events?: readonly RunEvent[];
  front: readonly string[];
  rerunAllowed?: boolean;
}): readonly [string, string] | undefined {
  const refusal = permanentRefusalOf({ doc: row({ front }), events, rerunAllowed, unreadableLines: [] });
  return refusal === undefined ? undefined : [refusal.kind, refusal.reason];
}

describe("permanentRefusalOf", () => {
  it("refuses a settled ask first, even where the row would also derive terminal", () => {
    expect(
      refusalOf({ front: ["kind: ask", "status: ready", "settlement: answered", "settlementWitness: abc"] }),
    ).toEqual(["settled-ask", "the ask is settled answered"]);
  });

  it("refuses a run whose current cycle finished, ahead of the terminal status a shipment derives", () => {
    const finished: RunEvent = { atIso: "2026-10-16T02:00:00.000Z", kind: "finished", residue: [] };
    expect(refusalOf({ events: [STARTED, finished], front: ["status: in-progress"] })).toEqual([
      "finished-cycle",
      "the run already finished or shipped",
    ]);
  });

  // `cmux spawn` lets a finished run through when SLOPWEAVER_ALLOW_RERUN=1, so it is not permanent.
  it("refuses no finished cycle while the finished-run break-glass is open", () => {
    const finished: RunEvent = { atIso: "2026-10-16T02:00:00.000Z", kind: "finished", residue: [] };
    expect([
      refusalOf({ events: [STARTED, finished], front: ["status: in-progress"], rerunAllowed: true }),
      refusalOf({ events: [STARTED, finished], front: ["status: in-progress"], rerunAllowed: false }),
    ]).toEqual([undefined, ["finished-cycle", "the run already finished or shipped"]]);
  });

  it("refuses a row whose journal recorded a shipment, even with no cycle opened", () => {
    const closed: RunEvent = { atIso: "2026-10-16T02:00:00.000Z", kind: "closed", residue: [], summary: "landed" };
    expect(refusalOf({ events: [closed], front: ["status: ready"] })).toEqual([
      "finished-cycle",
      "the run already finished or shipped",
    ]);
  });

  it("refuses an authored terminal status, and one an abandoned cycle derives", () => {
    const abandoned: RunEvent = { atIso: "2026-10-16T02:00:00.000Z", kind: "abandoned", why: "dropped" };
    expect([
      refusalOf({ front: ["status: done"] }),
      refusalOf({ events: [STARTED, abandoned], front: ["status: in-progress"] }),
    ]).toEqual([
      ["terminal-status", "the row is done"],
      ["terminal-status", "the row is cancelled"],
    ]);
  });

  it("refuses nothing on a live row, a paused one included", () => {
    expect([
      refusalOf({ front: ["status: in-progress"] }),
      refusalOf({ front: ["status: paused", "pausedOn: Tobias"] }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("finishedCycleRefusal", () => {
  it("names the shipment and the break-glass in the sentence the doors print", () => {
    const closed: RunEvent = { atIso: "2026-10-16T02:00:00.000Z", kind: "closed", residue: [], summary: "landed" };
    const doc = row({ front: ["status: ready"] });
    expect(finishedCycleRefusal({ doc, events: [closed], unreadableLines: [] })).toBe(
      "row recorded that its work SHIPPED at 2026-10-16T02:00:00.000Z: landed — a closed row is not work to pick " +
        "up, whatever `status:` still says. Read what it did: `slopweaver handover resume row`. If there is " +
        "genuinely more to do, register a new row; to re-open THIS one deliberately, `SLOPWEAVER_ALLOW_RERUN=1` " +
        "on the same command.",
    );
  });
});
