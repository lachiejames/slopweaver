import { describe, expect, it } from "vitest";

import type { Item } from "../../../sessionStart/item.js";
import {
  applyResolutions,
  foldLockInLedger,
  type LockInRow,
  lockInLine,
  parseLockInRows,
  resolutionFor,
  resolutionHolds,
  suppression,
} from "../../../sessionStart/lockIn.js";
import type { RankInput } from "../../../sessionStart/rank.js";

const NOW = "2026-08-30T12:00:00.000Z";

const row = (over: Partial<LockInRow> = {}): LockInRow => ({
  againstWhenIso: "2026-08-20T00:00:00.000Z",
  identity: "linear:AAA-1",
  outcome: "dropped",
  proposed: "close it, the work shipped",
  tsIso: "2026-08-29T00:00:00.000Z",
  verb: "skip",
  ...over,
});

const item = (over: Partial<Item> = {}): Item => ({
  background: "what this thing is, for a reader holding no context",
  doneWhen: "close it, the work shipped",
  nativeId: "AAA-1",
  source: "linear",
  whenIso: "2026-08-20T00:00:00.000Z",
  where: "https://linear.app/w/issue/AAA-1",
  who: "your own cycle",
  ...over,
});

const input = (over: Partial<Item> = {}): RankInput => ({
  finishesInFlight: true,
  item: item(over),
  readings: { age: 0, directness: 3, distanceToDone: 3, drift: 4, explicitPriority: 0, stoppedOnOwner: 0 },
  ruleZero: { reason: "your move", silentHours: 0, verdict: "show" },
  trace: { carried: [], reason: "traced, and still open where it came from", verdict: "rank" },
  unverified: false,
});

describe("lockInLine", () => {
  it("renders a fixed key order, so two runs writing one row produce identical bytes", () => {
    expect(lockInLine({ row: row() })).toBe(
      '{"againstWhenIso":"2026-08-20T00:00:00.000Z","identity":"linear:AAA-1","outcome":"dropped","proposed":"close it, the work shipped","schemaVersion":1,"tsIso":"2026-08-29T00:00:00.000Z","verb":"skip"}',
    );
  });

  it("carries an optional reason, note and deferral only when they are there", () => {
    const line = lockInLine({
      row: row({
        deferredUntilIso: "2026-09-05T00:00:00.000Z",
        note: "after the launch",
        outcome: "deferred",
        reason: "not-now",
        verb: "defer",
      }),
    });
    expect(line).toContain('"deferredUntilIso":"2026-09-05T00:00:00.000Z"');
    expect(line).toContain('"note":"after the launch"');
    expect(line).toContain('"reason":"not-now"');
  });
});

describe("parseLockInRows", () => {
  it("round-trips a rendered row", () => {
    expect(parseLockInRows({ text: lockInLine({ row: row() }) })).toStrictEqual([row()]);
  });

  it("skips a truncated final line rather than losing the whole ledger", () => {
    const text = `${lockInLine({ row: row() })}\n{"identity":"linear:AAA-2","outc`;
    expect(parseLockInRows({ text })).toHaveLength(1);
  });

  it("skips a row whose verb this version does not know, rather than inventing one", () => {
    expect(
      parseLockInRows({
        text: '{"identity":"x","verb":"teleport","outcome":"dropped","tsIso":"t","againstWhenIso":"a","proposed":"p"}',
      }),
    ).toStrictEqual([]);
  });

  it("skips a row whose outcome this version does not know", () => {
    expect(
      parseLockInRows({
        text: '{"identity":"x","verb":"do","outcome":"maybe","tsIso":"t","againstWhenIso":"a","proposed":"p"}',
      }),
    ).toStrictEqual([]);
  });

  it("drops a reason tag it does not know instead of refusing the whole row", () => {
    // Built as an object rather than by patching the rendered line: string surgery on JSON is the
    // incomplete-escaping class CodeQL flags, and it would break the first time a row gained a nested field.
    const text = JSON.stringify({ ...JSON.parse(lockInLine({ row: row() })), reason: "vibes" });
    const parsed = parseLockInRows({ text });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.reason).toBeUndefined();
  });
});

describe("foldLockInLedger", () => {
  it("takes the most recent resolution as the item's state", () => {
    const states = foldLockInLedger({
      rows: [row(), row({ outcome: "approved-as-proposed", tsIso: "2026-08-29T06:00:00.000Z", verb: "do" })],
    });
    expect(states.get("linear:AAA-1")!.outcome).toBe("approved-as-proposed");
  });

  it("counts every resolution the owner has given the item, across each state it was in", () => {
    const states = foldLockInLedger({ rows: [row(), row({ tsIso: "2026-08-29T06:00:00.000Z" })] });
    expect(states.get("linear:AAA-1")!.resolutions).toBe(2);
  });

  it("counts a first resolution as one, per item, however the rows interleave", () => {
    const states = foldLockInLedger({ rows: [row(), row({ identity: "handover:a-run" }), row()] });
    expect(states.get("linear:AAA-1")!.resolutions).toBe(2);
    expect(states.get("handover:a-run")!.resolutions).toBe(1);
  });

  it("keeps items apart", () => {
    const states = foldLockInLedger({ rows: [row(), row({ identity: "handover:a-run" })] });
    expect([...states.keys()].toSorted()).toStrictEqual(["handover:a-run", "linear:AAA-1"]);
  });
});

describe("resolutionHolds", () => {
  const state = foldLockInLedger({ rows: [row()] }).get("linear:AAA-1")!;

  it("holds while the item has not moved since the owner answered", () => {
    expect(resolutionHolds({ nowIso: NOW, state, whenIso: "2026-08-20T00:00:00.000Z" })).toBe(true);
  });

  it("lapses the moment the item moves, so nothing is hidden forever", () => {
    expect(resolutionHolds({ nowIso: NOW, state, whenIso: "2026-08-21T00:00:00.000Z" })).toBe(false);
  });

  it("lapses when a deferral runs out", () => {
    const deferred = foldLockInLedger({
      rows: [row({ deferredUntilIso: "2026-08-25T00:00:00.000Z", outcome: "deferred", verb: "defer" })],
    }).get("linear:AAA-1")!;
    expect(resolutionHolds({ nowIso: NOW, state: deferred, whenIso: "2026-08-20T00:00:00.000Z" })).toBe(false);
  });

  it("still holds inside the deferral window", () => {
    const deferred = foldLockInLedger({
      rows: [row({ deferredUntilIso: "2026-09-05T00:00:00.000Z", outcome: "deferred", verb: "defer" })],
    }).get("linear:AAA-1")!;
    expect(resolutionHolds({ nowIso: NOW, state: deferred, whenIso: "2026-08-20T00:00:00.000Z" })).toBe(true);
  });
});

describe("suppression", () => {
  const stateFor = ({ over }: { over: Partial<LockInRow> }) =>
    foldLockInLedger({ rows: [row(over)] }).get("linear:AAA-1")!;

  it("hides what the owner dropped, naming the day and the tag", () => {
    expect(suppression({ state: stateFor({ over: { reason: "not-mine" } }) })).toBe(
      "you dropped this on 2026-08-29 (not-mine), and it has not moved since",
    );
  });

  it("hides what the owner rejected", () => {
    expect(suppression({ state: stateFor({ over: { outcome: "rejected", reason: "already-done" } }) })).toBe(
      "you rejected this on 2026-08-29 (already-done), and it has not moved since",
    );
  });

  it("hides a deferral until its own date", () => {
    expect(
      suppression({
        state: stateFor({ over: { deferredUntilIso: "2026-09-05T00:00:00.000Z", outcome: "deferred", verb: "defer" } }),
      }),
    ).toBe("you deferred this until 2026-09-05T00:00:00.000Z, and it has not moved since");
  });

  it("does NOT hide what the owner agreed to do, because agreeing is not the source confirming", () => {
    expect(suppression({ state: stateFor({ over: { outcome: "approved-as-proposed", verb: "do" } }) })).toBeUndefined();
  });

  it("does not hide an edited action either", () => {
    expect(
      suppression({ state: stateFor({ over: { outcome: "edited", reason: "wrong-action", verb: "do" } }) }),
    ).toBeUndefined();
  });

  it("does not hide a row the owner merely commented on", () => {
    expect(suppression({ state: stateFor({ over: { outcome: "noted", verb: "note" } }) })).toBeUndefined();
  });
});

describe("applyResolutions", () => {
  it("leaves an item alone when the ledger has never seen it", () => {
    const applied = applyResolutions({ inputs: [input()], nowIso: NOW, states: new Map() });
    expect(applied[0]!.suppressedBecause).toBeUndefined();
  });

  it("holds back an item the owner dropped and says why", () => {
    const applied = applyResolutions({
      inputs: [input()],
      nowIso: NOW,
      states: foldLockInLedger({ rows: [row()] }),
    });
    expect(applied[0]!.suppressedBecause).toBe("you dropped this on 2026-08-29, and it has not moved since");
  });

  it("shows it again the moment it moves", () => {
    const applied = applyResolutions({
      inputs: [input({ whenIso: "2026-08-28T00:00:00.000Z" })],
      nowIso: NOW,
      states: foldLockInLedger({ rows: [row()] }),
    });
    expect(applied[0]!.suppressedBecause).toBeUndefined();
  });

  it("matches on identity, so a resolution about one item never touches another", () => {
    const applied = applyResolutions({
      inputs: [input({ nativeId: "AAA-2" })],
      nowIso: NOW,
      states: foldLockInLedger({ rows: [row()] }),
    });
    expect(applied[0]!.suppressedBecause).toBeUndefined();
  });
});

describe("resolutionFor", () => {
  it("finds a ruling by the item's identity", () => {
    const states = foldLockInLedger({ rows: [row()] });
    expect(resolutionFor({ item: item(), states })!.identity).toBe("linear:AAA-1");
  });

  it("finds a ruling recorded against the item's anchor URL, which is what a supervisor holds", () => {
    const states = foldLockInLedger({ rows: [row({ identity: "https://linear.app/w/issue/AAA-1" })] });
    expect(resolutionFor({ item: item(), states })!.identity).toBe("https://linear.app/w/issue/AAA-1");
  });

  it("prefers the identity when both were recorded", () => {
    const states = foldLockInLedger({
      rows: [row({ identity: "https://linear.app/w/issue/AAA-1", outcome: "noted" }), row()],
    });
    expect(resolutionFor({ item: item(), states })!.outcome).toBe("dropped");
  });

  it("finds nothing for an item the ledger never named either way", () => {
    expect(
      resolutionFor({
        item: item({ nativeId: "BBB-2", where: "https://x/BBB-2" }),
        states: foldLockInLedger({ rows: [row()] }),
      }),
    ).toBe(undefined);
  });
});

describe("applyResolutions by anchor URL", () => {
  it("holds back an item the owner ruled on by its link, exactly as one ruled on by identity", () => {
    const states = foldLockInLedger({ rows: [row({ identity: "https://linear.app/w/issue/AAA-1" })] });
    const [resolved] = applyResolutions({ inputs: [input()], nowIso: NOW, states });
    expect(resolved!.suppressedBecause).toBe("you dropped this on 2026-08-29, and it has not moved since");
  });
});
