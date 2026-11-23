import { describe, expect, it } from "vitest";

import type { Item } from "../../../sessionStart/item.js";
import type { RankedItem, Ranking } from "../../../sessionStart/rank.js";
import {
  changeBetween,
  movementTally,
  type RunSnapshot,
  reconcileRuns,
  type SnapshotItem,
  snapshotOf,
} from "../../../sessionStart/reconcile.js";

const snap = (over: Partial<SnapshotItem> = {}): SnapshotItem => ({
  closing: false,
  identity: "linear:AAA-1",
  state: "open, but the work is done",
  whenIso: "2026-08-20T00:00:00.000Z",
  ...over,
});

const run = ({
  items,
  atIso = "2026-08-29T00:00:00.000Z",
}: {
  items: readonly SnapshotItem[];
  atIso?: string;
}): RunSnapshot => ({
  atIso,
  items,
});

const item = (over: Partial<Item> = {}): Item => ({
  background: "what this thing is, for a reader holding no context",
  doneWhen: "close it, the work shipped",
  nativeId: "AAA-1",
  source: "linear",
  state: "open, but the work is done",
  whenIso: "2026-08-20T00:00:00.000Z",
  where: "https://linear.app/w/issue/AAA-1",
  who: "your own cycle",
  ...over,
});

const ranked = ({ over = {}, closing = false }: { over?: Partial<Item>; closing?: boolean } = {}): RankedItem => ({
  contributions: { age: 0, directness: 3, distanceToDone: 3, drift: 4, explicitPriority: 0, stoppedOnOwner: 0 },
  finishesInFlight: true,
  item: item(over),
  score: 10,
  trace: {
    carried: [],
    reason: closing ? "already done somewhere else" : "traced, and still open where it came from",
    verdict: closing ? "propose-close" : "rank",
  },
  unverified: false,
  why: "one reply finishes it",
});

const ranking = ({ rows }: { rows: readonly RankedItem[] }): Ranking => ({ dropped: [], ranked: rows });

describe("snapshotOf", () => {
  it("keeps only what a diff compares, keyed by identity", () => {
    const snapshot = snapshotOf({ nowIso: "2026-08-30T00:00:00.000Z", ranking: ranking({ rows: [ranked()] }) });
    expect(snapshot.atIso).toBe("2026-08-30T00:00:00.000Z");
    expect(snapshot.items).toStrictEqual([
      {
        closing: false,
        identity: "linear:AAA-1",
        state: "open, but the work is done",
        whenIso: "2026-08-20T00:00:00.000Z",
      },
    ]);
  });

  it("records a close proposal as one, because becoming a close is real movement", () => {
    const snapshot = snapshotOf({ nowIso: "n", ranking: ranking({ rows: [ranked({ closing: true })] }) });
    expect(snapshot.items[0]!.closing).toBe(true);
  });

  it("keeps only the RANKED rows, because a held-back candidate was never in front of the owner", () => {
    const withDrop: Ranking = { dropped: [{ item: item({ nativeId: "AAA-2" }), reason: "held" }], ranked: [ranked()] };
    expect(snapshotOf({ nowIso: "n", ranking: withDrop }).items.map((one) => one.identity)).toStrictEqual([
      "linear:AAA-1",
    ]);
  });
});

describe("changeBetween", () => {
  it("leads with a row becoming a close, which is work that finished elsewhere", () => {
    expect(changeBetween({ after: snap({ closing: true }), before: snap() })).toBe(
      "it is now a close proposal — the work was done somewhere else since your last run",
    );
  });

  it("reports a row that stopped being a close", () => {
    expect(changeBetween({ after: snap(), before: snap({ closing: true }) })).toBe(
      "it is no longer a close proposal, so it is work again",
    );
  });

  it("reports a moved instant with both sides, so the claim is checkable", () => {
    expect(changeBetween({ after: snap({ whenIso: "2026-08-28T00:00:00.000Z" }), before: snap() })).toBe(
      "it moved on 2026-08-28T00:00:00.000Z, having last moved on 2026-08-20T00:00:00.000Z",
    );
  });

  it("reports a changed state", () => {
    expect(changeBetween({ after: snap({ state: "needs a look" }), before: snap() })).toBe(
      'it now reads "needs a look", having read "open, but the work is done"',
    );
  });

  it("says nothing changed when nothing did", () => {
    expect(changeBetween({ after: snap(), before: snap() })).toBeUndefined();
  });
});

describe("reconcileRuns", () => {
  it("reports nothing on a first run, because there is no baseline to compare", () => {
    expect(reconcileRuns({ current: run({ items: [snap()] }), previous: undefined })).toStrictEqual([]);
  });

  it("calls an item that was not on the last list new", () => {
    const movements = reconcileRuns({
      current: run({ items: [snap(), snap({ identity: "linear:AAA-2" })] }),
      previous: run({ items: [snap()] }),
    });
    expect(movements.filter((one) => one.label === "new").map((one) => one.identity)).toStrictEqual(["linear:AAA-2"]);
  });

  it("calls an item whose instant changed moved", () => {
    const movements = reconcileRuns({
      current: run({ items: [snap({ whenIso: "2026-08-28T00:00:00.000Z" })] }),
      previous: run({ items: [snap()] }),
    });
    expect(movements[0]!.label).toBe("moved");
  });

  it("calls a departed item gone, and NEVER done", () => {
    const movements = reconcileRuns({ current: run({ items: [] }), previous: run({ items: [snap()] }) });
    expect(movements[0]!.label).toBe("gone");
    expect(movements[0]!.detail).toBe(
      "it left the list, which is not the same as it being done — check the source before assuming",
    );
  });

  it("calls an untouched item unchanged", () => {
    const movements = reconcileRuns({ current: run({ items: [snap()] }), previous: run({ items: [snap()] }) });
    expect(movements[0]!.label).toBe("unchanged");
  });

  it("orders arrivals, then shifts, then departures, then the settled remainder", () => {
    const movements = reconcileRuns({
      current: run({
        items: [
          snap(),
          snap({ identity: "linear:NEW", whenIso: "x" }),
          snap({ identity: "linear:MOVED", whenIso: "z" }),
        ],
      }),
      previous: run({ items: [snap(), snap({ identity: "linear:MOVED" }), snap({ identity: "linear:LEFT" })] }),
    });
    expect(movements.map((one) => one.label)).toStrictEqual(["new", "moved", "gone", "unchanged"]);
  });

  it("keys on identity alone, so a rank change is never movement", () => {
    const movements = reconcileRuns({
      current: run({ items: [snap({ identity: "linear:B" }), snap({ identity: "linear:A" })] }),
      previous: run({ items: [snap({ identity: "linear:A" }), snap({ identity: "linear:B" })] }),
    });
    expect(movements.every((one) => one.label === "unchanged")).toBe(true);
  });
});

describe("movementTally", () => {
  it("counts every label, zeros included, so a quiet run differs from one that never ran", () => {
    const movements = reconcileRuns({
      current: run({ items: [snap({ identity: "linear:NEW" })] }),
      previous: run({ items: [] }),
    });
    expect(movementTally({ movements })).toStrictEqual({ gone: 0, moved: 0, new: 1, unchanged: 0 });
  });
});
