import { describe, expect, it } from "vitest";

import type { HandRow } from "../../../hand/row.js";
import { clearedBy, departedWhileFiring, PUT_DOWN_SETTLE_OPENINGS } from "../../../monitor/card.js";
import { closedByOwner, passSettleOpenings, shownKeys } from "../../../monitor/heldKeys.js";
import { monitorDefinition } from "../../../monitor/registry.js";

describe("closedByOwner", () => {
  const prefix = "mon-recipe-";
  const passOpenings = ["the monitor cleared", "the subject cleared, the monitor still fires", "superseded by "];

  /** A posting of one card, carrying only the id the fold reads. */
  function posted({ id }: { id: string }): HandRow {
    return { kind: "posted", step: { id } } as unknown as HandRow;
  }

  /** A settle of one card. */
  function settled({ id, did, settledIso }: { id: string; did: string; settledIso: string }): HandRow {
    return { bySession: "console", did, id, kind: "settled", settledIso };
  }

  it("names a set whose last close was the owner's, and when", () => {
    const rows = [posted({ id: "mon-recipe-a-1" }), settled({ did: "Done", id: "mon-recipe-a-1", settledIso: "T1" })];

    expect([...closedByOwner({ passOpenings, prefix, rows })]).toEqual([["a-1", "T1"]]);
  });

  it("does not count the pass's own clear — a set that cleared and came back is news", () => {
    const rows = [
      posted({ id: "mon-recipe-a-1" }),
      settled({ did: "the monitor cleared: the row fires again", id: "mon-recipe-a-1", settledIso: "T1" }),
    ];

    expect([...closedByOwner({ passOpenings, prefix, rows })]).toEqual([]);
  });

  it("does not hold a set whose card is open again, nor another monitor's card", () => {
    const rows = [
      posted({ id: "mon-recipe-a-1" }),
      settled({ did: "Done", id: "mon-recipe-a-1", settledIso: "T1" }),
      posted({ id: "mon-recipe-a-1.2" }),
      posted({ id: "mon-corpus-b-1" }),
      settled({ did: "Done", id: "mon-corpus-b-1", settledIso: "T2" }),
    ];

    expect([...closedByOwner({ passOpenings, prefix, rows })]).toEqual([]);
  });

  it("reads the LAST settle of a key, so a pass's settle after the owner's Done un-holds it", () => {
    const rows = [
      posted({ id: "mon-recipe-a-1" }),
      settled({ did: "Done", id: "mon-recipe-a-1", settledIso: "T1" }),
      posted({ id: "mon-recipe-a-1.2" }),
      settled({ did: "superseded by mon-recipe-a-1.3", id: "mon-recipe-a-1.2", settledIso: "T2" }),
    ];

    expect([...closedByOwner({ passOpenings, prefix, rows })]).toEqual([]);
  });
});

describe("passSettleOpenings", () => {
  const definition = monitorDefinition({ monitorId: "recipe-stopped" });
  const prefix = `mon-${definition.prefix}-`;
  const id = `${prefix}a-1`;

  /** The register after one card was posted, then settled with `did`. */
  function closedWith({ did }: { did: string }): readonly HandRow[] {
    return [
      { kind: "posted", step: { id } } as unknown as HandRow,
      { bySession: "supervisor", did, id, kind: "settled", settledIso: "T1" },
    ];
  }

  it("does not read the pass's clear as the owner's close when they had snoozed the note first", () => {
    const rows = closedWith({ did: `${PUT_DOWN_SETTLE_OPENINGS.snoozed}${clearedBy({ definition })}` });

    expect([...closedByOwner({ passOpenings: passSettleOpenings({ definition }), prefix, rows })]).toEqual([]);
  });

  it("does not read the pass's departure as the owner's close when they had pressed Later first", () => {
    const departed = departedWhileFiring({ definition, replacedBy: [`${prefix}b-1`] });
    const rows = closedWith({ did: `${PUT_DOWN_SETTLE_OPENINGS.later}${departed}` });

    expect([...closedByOwner({ passOpenings: passSettleOpenings({ definition }), prefix, rows })]).toEqual([]);
  });

  it("still reads the owner's Done as their close", () => {
    const rows = closedWith({ did: "Done — read it" });

    expect([...closedByOwner({ passOpenings: passSettleOpenings({ definition }), prefix, rows })]).toEqual([
      ["a-1", "T1"],
    ]);
  });
});

describe("shownKeys", () => {
  const first = "inc98-investigating-20261004080000000";
  const second = "inc98-identified-20261004083000000";

  it("counts a key the pass departed as shown, the same as one the owner closed", () => {
    const settles = [
      { departed: true, key: first },
      { departed: false, key: second },
    ];
    expect([...shownKeys({ open: new Set(), settles })]).toEqual([first, second]);
  });

  it("does not count a key whose card is open again", () => {
    expect([...shownKeys({ open: new Set([first]), settles: [{ departed: true, key: first }] })]).toEqual([]);
  });

  it("shows nothing for a monitor that never posted", () => {
    expect([...shownKeys({ open: new Set(), settles: [] })]).toEqual([]);
  });
});
