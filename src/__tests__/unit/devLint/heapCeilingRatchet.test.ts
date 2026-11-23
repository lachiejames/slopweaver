import { describe, expect, it } from "vitest";

import {
  type HeapRaise,
  judgeAgainstBase,
  judgeHeadPins,
  predecessorCeiling,
  readHeapPins,
} from "../../../devLint/heapCeilingRatchet.js";

/** One well-formed raise of the build script from 10,240 to 12,288 MiB. */
const RAISE: HeapRaise = {
  anchor: "talk:00000000-0000-0000-0000-000000000000",
  approvedIso: "2026-11-02T01:00:00Z",
  fromMiB: 10240,
  key: "package-script.build",
  recordedIso: "2026-11-02T01:05:00Z",
  toMiB: 12288,
};

/** The ceilings a base commit holds. */
const BASE = new Map([
  ["package-script.build", 10240],
  ["named-object-params.budget", 6543],
]);

/** A tree holding no subject without a ceiling. */
const NONE: ReadonlySet<string> = new Set();

/**
 * A pins file's text.
 *
 * @param ceilingsMiB the pinned ceilings
 * @param raises the raise records
 * @returns the JSON text
 */
function pinsText({
  ceilingsMiB,
  raises,
}: {
  ceilingsMiB: Record<string, unknown>;
  raises: readonly unknown[];
}): string {
  return JSON.stringify({ ceilingsMiB, raises, schemaVersion: 1 });
}

describe("readHeapPins", () => {
  it("reads ceilings and raises", () => {
    const reading = readHeapPins({
      text: pinsText({ ceilingsMiB: { "package-script.build": 12288 }, raises: [RAISE] }),
    });
    expect(reading).toEqual({
      kind: "pins",
      pins: { ceilingsMiB: new Map([["package-script.build", 12288]]), raises: [RAISE] },
    });
  });

  it("refuses a raise with no anchor", () => {
    const text = pinsText({ ceilingsMiB: {}, raises: [{ ...RAISE, anchor: "  " }] });
    expect(readHeapPins({ text })).toEqual({
      kind: "unread",
      why: ".baselines/heap-ceilings.json raises[0] carries no anchor for the owner's word",
    });
  });

  it("refuses an approval instant carrying an offset rather than Z", () => {
    const text = pinsText({ ceilingsMiB: {}, raises: [{ ...RAISE, approvedIso: "2026-11-02T01:00:00+10:00" }] });
    expect(readHeapPins({ text })).toEqual({
      kind: "unread",
      why: ".baselines/heap-ceilings.json raises[0] `approvedIso` is not one UTC instant ending in Z",
    });
  });

  it("refuses a record written before the approval it records", () => {
    const text = pinsText({ ceilingsMiB: {}, raises: [{ ...RAISE, recordedIso: "2026-11-01T00:00:00Z" }] });
    expect(readHeapPins({ text })).toEqual({
      kind: "unread",
      why: ".baselines/heap-ceilings.json raises[0] was recorded before the approval it records",
    });
  });

  it("refuses a pin that is not a positive whole MiB", () => {
    expect(readHeapPins({ text: pinsText({ ceilingsMiB: { a: 1.5 }, raises: [] }) })).toEqual({
      kind: "unread",
      why: ".baselines/heap-ceilings.json pins `a` at something other than a positive whole MiB",
    });
  });

  it("refuses a file of another schema version", () => {
    expect(readHeapPins({ text: JSON.stringify({ ceilingsMiB: {}, raises: [], schemaVersion: 2 }) })).toEqual({
      kind: "unread",
      why: ".baselines/heap-ceilings.json is not a schemaVersion 1 object",
    });
  });
});

describe("judgeHeadPins", () => {
  it("passes when every ceiling is pinned exactly", () => {
    expect(judgeHeadPins({ ceilings: BASE, pinned: BASE })).toEqual([]);
  });

  it("names a ceiling with no pin, a disagreeing pin and a pin naming nothing", () => {
    const ceilings = new Map([
      ["package-script.build", 12288],
      ["package-script.typecheck", 4096],
    ]);
    const pinned = new Map([
      ["package-script.build", 10240],
      ["gone", 1],
    ]);
    expect(judgeHeadPins({ ceilings, pinned })).toEqual([
      "`package-script.build` is 12288 MiB in the tree and .baselines/heap-ceilings.json pins it at 10240",
      "`package-script.typecheck` is 4096 MiB in the tree and .baselines/heap-ceilings.json does not pin it",
      ".baselines/heap-ceilings.json pins `gone`, which no file this gate reads still holds — delete the pin",
    ]);
  });
});

describe("judgeAgainstBase", () => {
  it("refuses a raise with no appended record", () => {
    const head = new Map([...BASE, ["package-script.build", 12288]]);
    expect(
      judgeAgainstBase({ base: { ceilings: BASE, raises: [] }, head: { ceilings: head, raises: [], uncapped: NONE } }),
    ).toEqual([
      "`package-script.build` rises to 12288 MiB (10240 MiB at the base) with no raise record appended for the owner's word",
    ]);
  });

  it("passes a raise witnessed by a record this change appended", () => {
    const head = new Map([...BASE, ["package-script.build", 12288]]);
    const judged = judgeAgainstBase({
      base: { ceilings: BASE, raises: [] },
      head: { ceilings: head, raises: [RAISE], uncapped: NONE },
    });
    expect(judged).toEqual([]);
  });

  it("refuses a raise whose only record was already spent at the base", () => {
    const base = new Map([...BASE, ["package-script.build", 12288]]);
    const second = { ...RAISE, fromMiB: 12288, toMiB: 16384 };
    const raised = new Map([...base, ["package-script.build", 16384]]);
    const spent = judgeAgainstBase({
      base: { ceilings: base, raises: [RAISE] },
      head: { ceilings: raised, raises: [RAISE], uncapped: NONE },
    });
    expect(spent).toEqual([
      "`package-script.build` rises to 16384 MiB (12288 MiB at the base) with no raise record appended for the owner's word",
    ]);
    const witnessed = judgeAgainstBase({
      base: { ceilings: base, raises: [RAISE] },
      head: { ceilings: raised, raises: [RAISE, second], uncapped: NONE },
    });
    expect(witnessed).toEqual([]);
  });

  it("refuses a record whose numbers do not match the raise made", () => {
    const head = new Map([...BASE, ["package-script.build", 16384]]);
    const judged = judgeAgainstBase({
      base: { ceilings: BASE, raises: [] },
      head: { ceilings: head, raises: [RAISE], uncapped: NONE },
    });
    expect(judged).toEqual([
      "`package-script.build` rises to 16384 MiB (10240 MiB at the base) with no raise record appended for the owner's word",
      ".baselines/heap-ceilings.json appends a raise of `package-script.build` to 12288 MiB that this change does not make — a record witnesses exactly one raise",
    ]);
  });

  it("passes a lowered ceiling with nothing appended", () => {
    const head = new Map([...BASE, ["package-script.build", 6144]]);
    expect(
      judgeAgainstBase({ base: { ceilings: BASE, raises: [] }, head: { ceilings: head, raises: [], uncapped: NONE } }),
    ).toEqual([]);
  });

  it("refuses a ceiling dropped from a script that still runs, and passes one whose script is gone", () => {
    const head = new Map([["named-object-params.budget", 6543]]);
    const dropped = judgeAgainstBase({
      base: { ceilings: BASE, raises: [] },
      head: { ceilings: head, raises: [], uncapped: new Set(["package-script.build"]) },
    });
    expect(dropped).toEqual([
      "`package-script.build` drops its 10240 MiB ceiling, so it runs at V8's own default, which no pin bounds — spell the lower number on its argv instead of deleting the flag",
    ]);
    const gone = judgeAgainstBase({
      base: { ceilings: BASE, raises: [] },
      head: { ceilings: head, raises: [], uncapped: NONE },
    });
    expect(gone).toEqual([]);
  });

  it("passes a NEW ceiling at the rule's 4 GiB and refuses one above it", () => {
    const at = new Map([...BASE, ["lint-gate.new", 4096]]);
    const above = new Map([...BASE, ["lint-gate.new", 4097]]);
    expect(
      judgeAgainstBase({ base: { ceilings: BASE, raises: [] }, head: { ceilings: at, raises: [], uncapped: NONE } }),
    ).toEqual([]);
    expect(
      judgeAgainstBase({ base: { ceilings: BASE, raises: [] }, head: { ceilings: above, raises: [], uncapped: NONE } }),
    ).toEqual([
      "`lint-gate.new` rises to 4097 MiB (new, above the 4096 MiB the owner's rule allows) with no raise record appended for the owner's word",
    ]);
  });

  it("refuses an edit to a record the base already held", () => {
    const edited = { ...RAISE, anchor: "talk:somewhere-else" };
    const judged = judgeAgainstBase({
      base: { ceilings: BASE, raises: [RAISE] },
      head: { ceilings: BASE, raises: [edited], uncapped: NONE },
    });
    expect(judged).toEqual([
      ".baselines/heap-ceilings.json's `raises` is append-only, and this change edits or deletes a record the base held",
    ]);
  });

  it("refuses a deleted record", () => {
    const judged = judgeAgainstBase({
      base: { ceilings: BASE, raises: [RAISE] },
      head: { ceilings: BASE, raises: [], uncapped: NONE },
    });
    expect(judged).toEqual([
      ".baselines/heap-ceilings.json's `raises` is append-only, and this change edits or deletes a record the base held",
    ]);
  });
});

describe("predecessorCeiling", () => {
  it("names the V8 heap ceiling an RSS key replaces", () => {
    expect(predecessorCeiling({ base: BASE, key: "package-script.build.process-tree-rss" })).toBe(10240);
  });

  it("gives a V8 key no predecessor, so an RSS ceiling never licenses a heap one", () => {
    const base = new Map([["package-script.build.process-tree-rss", 10240]]);
    expect(predecessorCeiling({ base, key: "package-script.build" })).toBeUndefined();
  });

  it("gives a lint gate renamed with the RSS suffix no predecessor, so it is judged as new", () => {
    const base = new Map([["lint-gate.named-object-params", 8192]]);
    expect(predecessorCeiling({ base, key: "lint-gate.named-object-params.process-tree-rss" })).toBeUndefined();
    const head = {
      ceilings: new Map([["lint-gate.named-object-params.process-tree-rss", 8192]]),
      raises: [],
      uncapped: NONE,
    };
    expect(judgeAgainstBase({ base: { ceilings: base, raises: [] }, head })).toEqual([
      "`lint-gate.named-object-params.process-tree-rss` rises to 8192 MiB (new, above the 4096 MiB the owner's rule allows) with no raise record appended for the owner's word",
    ]);
  });

  it("names the desktop script's V8 ceiling as its RSS key's predecessor", () => {
    const base = new Map([["desktop.package-script.build", 4096]]);
    expect(predecessorCeiling({ base, key: "desktop.package-script.build.process-tree-rss" })).toBe(4096);
  });

  it("gives an RSS key whose script held no heap ceiling no predecessor", () => {
    expect(predecessorCeiling({ base: BASE, key: "desktop.package-script.build.process-tree-rss" })).toBeUndefined();
  });
});

describe("judgeAgainstBase, across the heap-to-RSS move", () => {
  /** The flip's head: the V8 key gone, its script now bounded by the owner. */
  const flipped = ({ mib }: { mib: number }): ReadonlyMap<string, number> =>
    new Map([
      ["package-script.build.process-tree-rss", mib],
      ["named-object-params.budget", 6543],
    ]);

  it("passes an RSS ceiling equal to the heap ceiling it replaces", () => {
    const head = { ceilings: flipped({ mib: 10240 }), raises: [], uncapped: NONE };
    expect(judgeAgainstBase({ base: { ceilings: BASE, raises: [] }, head })).toEqual([]);
  });

  it("refuses an RSS ceiling one MiB above the heap ceiling it replaces", () => {
    const head = { ceilings: flipped({ mib: 10241 }), raises: [], uncapped: NONE };
    expect(judgeAgainstBase({ base: { ceilings: BASE, raises: [] }, head })).toEqual([
      "`package-script.build.process-tree-rss` rises to 10241 MiB (10240 MiB at the base) with no raise record appended for the owner's word",
    ]);
  });

  it("refuses a heap ceiling above the rule where the base held only an RSS one", () => {
    const base = new Map([["package-script.build.process-tree-rss", 10240]]);
    const head = { ceilings: new Map([["package-script.build", 10240]]), raises: [], uncapped: NONE };
    expect(judgeAgainstBase({ base: { ceilings: base, raises: [] }, head })).toEqual([
      "`package-script.build` rises to 10240 MiB (new, above the 4096 MiB the owner's rule allows) with no raise record appended for the owner's word",
    ]);
  });

  it("refuses dropping an RSS ceiling from a script that still runs", () => {
    const base = new Map([["package-script.build.process-tree-rss", 10240]]);
    const uncapped = new Set(["package-script.build", "package-script.build.process-tree-rss"]);
    const head = { ceilings: new Map<string, number>(), raises: [], uncapped };
    expect(judgeAgainstBase({ base: { ceilings: base, raises: [] }, head })).toEqual([
      "`package-script.build.process-tree-rss` drops its 10240 MiB ceiling, so nothing bounds its process tree's memory — spell the lower number on its `--rss-ceiling-mib` instead of removing the owner",
    ]);
  });
});
