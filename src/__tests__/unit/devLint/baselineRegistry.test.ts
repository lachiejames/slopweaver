import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BASELINE_POLICY_FILES,
  flattenBaseline,
  isCommittedBumpPath,
  loosenings,
  RATCHET_BASELINES,
  type RatchetBaseline,
  strayBaselinesOf,
} from "../../../devLint/baselineRegistry.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const FILE_SIZE = RATCHET_BASELINES.find((row) => row.file === ".baselines/file-size-baseline.json")!;
const FALLBACK = RATCHET_BASELINES.find((row) => row.file === ".baselines/no-silent-fallback-baseline.json")!;
const VOCABULARY = RATCHET_BASELINES.find((row) => row.file === ".baselines/naming-vocabulary-baseline.json")!;
const UNTESTED = RATCHET_BASELINES.find((row) => row.file === ".baselines/untested-modules-baseline.json")!;
const CLONE = RATCHET_BASELINES.find((row) => row.file === ".baselines/clone-baseline.json")!;
const CI = RATCHET_BASELINES.find((row) => row.file === ".baselines/ci-job-seconds.json")!;
const EXPORTS = RATCHET_BASELINES.find((row) => row.file === ".baselines/internal-exports-baseline.json")!;
const HEAP = RATCHET_BASELINES.find((row) => row.file === ".baselines/heap-ceilings.json")!;
const APPROVED = RATCHET_BASELINES.find((row) => row.file === ".baselines/ci-job-seconds-approved.json")!;
const TRADEOFFS = RATCHET_BASELINES.find((row) => row.file === ".baselines/file-size-tradeoffs.json")!;
const NO_PYTHON = RATCHET_BASELINES.find((row) => row.file === ".baselines/no-python-baseline.json")!;
const SYNC_CHILD = RATCHET_BASELINES.find((row) => row.file === ".baselines/sync-child-timeout-baseline.json")!;
const TORN_TAIL = RATCHET_BASELINES.find((row) => row.file === ".baselines/torn-tail-append-baseline.json")!;
const WHOLE_JSON = RATCHET_BASELINES.find((row) => row.file === ".baselines/whole-file-json-baseline.json")!;

const loosened = ({ baseline, base, head }: { baseline: RatchetBaseline; base: unknown; head: unknown }) =>
  unwrap(loosenings({ base: JSON.stringify(base), baseline, head: JSON.stringify(head) }));

describe("strayBaselinesOf", () => {
  it("passes a judged baseline and a named exclusion", () => {
    const paths = [".baselines/file-size-baseline.json", ".baselines/heap-ceilings.json"];
    expect(strayBaselinesOf({ paths })).toEqual([]);
  });

  it("refuses another extension, a bump record and anything else no row names", () => {
    const paths = [
      ".baselines/file-size-baseline.yaml",
      `.baselines/bumps/${"0".repeat(64)}.json`,
      ".baselines/mystery-baseline.json",
    ];
    expect(strayBaselinesOf({ paths })).toEqual(paths);
  });
});

describe("isCommittedBumpPath", () => {
  it("names a path under the old bump directory, at any depth, and nothing beside it", () => {
    expect(isCommittedBumpPath({ path: `.baselines/bumps/${"0".repeat(64)}.json` })).toBe(true);
    expect(isCommittedBumpPath({ path: ".baselines/bumps/nested/notes.txt" })).toBe(true);
    expect(isCommittedBumpPath({ path: ".baselines/bumps-baseline.json" })).toBe(false);
  });
});

describe("the registry is bound to .baselines/ in both directions", () => {
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const dir = join(repoRoot, ".baselines");
  const committed = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(repoRoot, join(entry.parentPath, entry.name)));

  it("judges or names every file under .baselines/, whatever its extension, bar main's old bump records", () => {
    expect(committed.length).toBeGreaterThan(0);
    expect(strayBaselinesOf({ paths: committed.filter((path) => !isCommittedBumpPath({ path })) })).toEqual([]);
  });

  it("reads every committed ratchet baseline as its declared shape", () => {
    const present = RATCHET_BASELINES.filter((row) => committed.includes(row.file));
    expect(present.length).toBeGreaterThan(0);
    const unreadable = present.filter((row) =>
      flattenBaseline({ baseline: row, text: readFileText({ path: row.file }) }).isErr(),
    );
    expect(unreadable.map((row) => row.file)).toEqual([]);
  });

  it("names only policy files that exist, so a rename cannot silently drop one from the guard", () => {
    expect(BASELINE_POLICY_FILES.length).toBeGreaterThan(0);
    const repo = fileURLToPath(new URL("../../../../", import.meta.url));
    expect(BASELINE_POLICY_FILES.filter((path) => !existsSync(`${repo}${path}`))).toEqual([]);
  });
});

function readFileText({ path }: { path: string }): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), "utf8");
}

describe("loosenings", () => {
  const base = { exempt: [{ codeLines: 400, path: "a.ts" }], offenders: [{ codeLines: 350, path: "b.ts" }] };

  it("is empty when nothing grew or appeared, and a shrink is not a loosening", () => {
    expect(
      loosened({ base, baseline: FILE_SIZE, head: { exempt: [{ codeLines: 390, path: "a.ts" }], offenders: [] } }),
    ).toEqual([]);
  });

  it("reports a grown measure with both numbers", () => {
    const head = { ...base, offenders: [{ codeLines: 351, path: "b.ts" }] };
    expect(loosened({ base, baseline: FILE_SIZE, head })).toEqual([
      { entry: "offenders:b.ts", file: FILE_SIZE.file, from: 350, to: 351 },
    ]);
  });

  it("reports a new row with from null", () => {
    const head = { ...base, offenders: [...base.offenders, { codeLines: 301, path: "c.ts" }] };
    expect(loosened({ base, baseline: FILE_SIZE, head })).toEqual([
      { entry: "offenders:c.ts", file: FILE_SIZE.file, from: null, to: 301 },
    ]);
  });

  it("reports a path moving from offenders to exempt as new in exempt", () => {
    const head = { exempt: [...base.exempt, { codeLines: 350, path: "b.ts" }], offenders: [] };
    expect(loosened({ base, baseline: FILE_SIZE, head })).toEqual([
      { entry: "exempt:b.ts", file: FILE_SIZE.file, from: null, to: 350 },
    ]);
  });

  it("keys a pair identity on both fields", () => {
    const fallbackBase = { sites: [{ count: 2, operator: "??", path: "x.ts" }] };
    const head = {
      sites: [
        { count: 2, operator: "??", path: "x.ts" },
        { count: 1, operator: "||", path: "x.ts" },
      ],
    };
    expect(loosened({ base: fallbackBase, baseline: FALLBACK, head })).toEqual([
      { entry: "sites:x.ts#||", file: FALLBACK.file, from: null, to: 1 },
    ]);
  });

  it("reads a NEW signed file-size tradeoff as a loosening, and the empty register it ships with as none", () => {
    const row = { ownerApproval: "talk:abc#turn_1", path: "src/errors.ts", tradeoff: "one union, one factory" };
    const empty = unwrap(loosenings({ base: undefined, baseline: TRADEOFFS, head: '{"tradeoffs": []}' }));
    expect(empty).toEqual([]);
    expect(loosened({ base: { tradeoffs: [] }, baseline: TRADEOFFS, head: { tradeoffs: [row] } })).toEqual([
      { entry: "tradeoffs:src/errors.ts", file: ".baselines/file-size-tradeoffs.json", from: null, to: 1 },
    ]);
  });

  it("reads a naming-vocabulary count rise as a loosening and a fall as none", () => {
    const vocabularyBase = { identifiers: [{ count: 2, name: "provider", path: "x.ts" }] };
    const grown = { identifiers: [{ count: 3, name: "provider", path: "x.ts" }] };
    const shrunk = { identifiers: [{ count: 1, name: "provider", path: "x.ts" }] };
    expect([
      loosened({ base: vocabularyBase, baseline: VOCABULARY, head: grown }),
      loosened({ base: vocabularyBase, baseline: VOCABULARY, head: shrunk }),
    ]).toEqual([[{ entry: "identifiers:x.ts#provider", file: VOCABULARY.file, from: 2, to: 3 }], []]);
  });

  it("keys a no-python instruction on its path and exact line, and reads a second copy as a rise", () => {
    const row = { count: 1, matchedLine: "python3 x.py", owes: "a verb", path: "a.ts" };
    expect(
      loosened({ base: { instructions: [row] }, baseline: NO_PYTHON, head: { instructions: [{ ...row, count: 2 }] } }),
    ).toEqual([{ entry: "instructions:a.ts#python3 x.py", file: NO_PYTHON.file, from: 1, to: 2 }]);
  });

  it("reads a sync-child-timeout file's count rise and a new file as loosenings, and a fall as none", () => {
    const before = {
      files: [
        { count: 2, path: "a.ts", reason: "r" },
        { count: 1, path: "c.ts", reason: "r" },
      ],
    };
    const head = {
      files: [
        { count: 1, path: "a.ts", reason: "r" },
        { count: 1, path: "b.ts", reason: "r" },
        { count: 2, path: "c.ts", reason: "r" },
      ],
    };
    expect(loosened({ base: before, baseline: SYNC_CHILD, head })).toEqual([
      { entry: "files:b.ts", file: SYNC_CHILD.file, from: null, to: 1 },
      { entry: "files:c.ts", file: SYNC_CHILD.file, from: 1, to: 2 },
    ]);
  });

  it("keys a torn-tail append on path and shape, so a new shape in a recorded file is a new row", () => {
    const before = { appends: [{ count: 1, guard: "g", path: "a.ts", shape: "append-open" }] };
    const head = { appends: [...before.appends, { count: 1, guard: "g", path: "a.ts", shape: "append-call" }] };
    expect(loosened({ base: before, baseline: TORN_TAIL, head })).toEqual([
      { entry: "appends:a.ts#append-call", file: TORN_TAIL.file, from: null, to: 1 },
    ]);
  });

  it("reads whole-file-json as a set: only a new path and shape loosens it", () => {
    const before = { sites: [{ owes: "o", path: "a.ts", shape: "jsonl-read-whole" }] };
    const head = { sites: [...before.sites, { owes: "o", path: "b.ts", shape: "jsonl-read-whole" }] };
    expect(loosened({ base: before, baseline: WHOLE_JSON, head })).toStrictEqual([
      { entry: "sites:b.ts#jsonl-read-whole", file: WHOLE_JSON.file, from: null, to: 1 },
    ]);
  });

  it("reports only a NEW member of a measureless set", () => {
    expect(loosened({ base: { modules: ["a.ts"] }, baseline: UNTESTED, head: { modules: ["a.ts", "b.ts"] } })).toEqual([
      { entry: "modules:b.ts", file: UNTESTED.file, from: null, to: 1 },
    ]);
  });

  it("reports a new symbol in a measureless keyed array", () => {
    expect(
      loosened({ base: { symbols: [] }, baseline: EXPORTS, head: { symbols: [{ name: "f", path: "a.ts" }] } }),
    ).toEqual([{ entry: "symbols:a.ts#f", file: EXPORTS.file, from: null, to: 1 }]);
  });

  it("reports a grown scalar", () => {
    expect(loosened({ base: { filePairs: 3 }, baseline: CLONE, head: { filePairs: 4 } })).toEqual([
      { entry: "filePairs", file: CLONE.file, from: 3, to: 4 },
    ]);
  });

  it("reports a raised and a new heap ceiling under its key, and ignores the raise records beside them", () => {
    const heapBase = { ceilingsMiB: { "package-script.build": 10240 }, raises: [], schemaVersion: 1 };
    const head = {
      ceilingsMiB: { "lint-gate.x": 4096, "package-script.build": 12288 },
      raises: [{ anchor: "claimed", key: "package-script.build" }],
      schemaVersion: 1,
    };
    expect(loosened({ base: heapBase, baseline: HEAP, head })).toEqual([
      { entry: "ceilingsMiB:lint-gate.x", file: HEAP.file, from: null, to: 4096 },
      { entry: "ceilingsMiB:package-script.build", file: HEAP.file, from: 10240, to: 12288 },
    ]);
  });

  it("reports a raised and a new approved CI number with the operational file untouched", () => {
    const approval = { anchor: "talk:fixture", approvedIso: "2026-11-01T00:00:00.000Z" };
    const approvedBase = { approval, baseline: { "unit-3": 50 }, reference: {}, schemaVersion: 1 };
    const head = { approval, baseline: { lint: 200, "unit-3": 80 }, reference: {}, schemaVersion: 1 };
    expect(loosened({ base: approvedBase, baseline: APPROVED, head })).toEqual([
      { entry: "baseline:lint", file: APPROVED.file, from: null, to: 200 },
      { entry: "baseline:unit-3", file: APPROVED.file, from: 50, to: 80 },
    ]);
  });

  it("refuses heap ceilings that are not a map of names to numbers", () => {
    const refused = unwrapErr(flattenBaseline({ baseline: HEAP, text: JSON.stringify({ ceilingsMiB: [1] }) }));
    expect(refused.message).toBe(`${HEAP.file}: \`ceilingsMiB\` is not a map of names to numbers`);
  });

  it("reports a grown and a new key of a numeric map", () => {
    expect(loosened({ base: { lint: 100 }, baseline: CI, head: { lint: 120, unit: 50 } })).toEqual([
      { entry: "lint", file: CI.file, from: 100, to: 120 },
      { entry: "unit", file: CI.file, from: null, to: 50 },
    ]);
  });

  it("reports a deleted baseline as one whole-file row", () => {
    expect(unwrap(loosenings({ base: JSON.stringify(base), baseline: FILE_SIZE, head: undefined }))).toEqual([
      { entry: "*", file: FILE_SIZE.file, from: null, to: null },
    ]);
  });

  it("is empty for a file absent at both", () => {
    expect(unwrap(loosenings({ base: undefined, baseline: FILE_SIZE, head: undefined }))).toEqual([]);
  });

  it("refuses a duplicate identity rather than letting the second row hide the first", () => {
    const head = {
      exempt: [],
      offenders: [
        { codeLines: 301, path: "b.ts" },
        { codeLines: 999, path: "b.ts" },
      ],
    };
    const result = loosenings({ base: JSON.stringify(base), baseline: FILE_SIZE, head: JSON.stringify(head) });
    expect(unwrapErr(result).message).toBe(`${FILE_SIZE.file}: duplicate row offenders:b.ts`);
  });

  it("reports a row swapped for another showing the same entry as NEW, never unchanged", () => {
    const swappedFrom = { symbols: [{ name: "c", path: "src/a.ts#b.ts" }] };
    const swappedTo = { symbols: [{ name: "b.ts#c", path: "src/a.ts" }] };
    expect(loosened({ base: swappedFrom, baseline: EXPORTS, head: swappedTo })).toStrictEqual([
      { entry: "symbols:src/a.ts#b.ts#c", file: EXPORTS.file, from: null, to: 1 },
    ]);
    expect(loosened({ base: swappedTo, baseline: EXPORTS, head: swappedFrom })).toStrictEqual([
      {
        entry: "symbols:src/a.ts#b.ts#c",
        file: EXPORTS.file,
        from: null,
        identityTuple: ["symbols", "src/a.ts#b.ts", "c"],
        to: 1,
      },
    ]);
  });

  it("refuses two different rows showing the same entry in one copy, since no declaration could name either", () => {
    const both = {
      symbols: [
        { name: "c", path: "src/a.ts#b.ts" },
        { name: "b.ts#c", path: "src/a.ts" },
      ],
    };
    const result = loosenings({ base: undefined, baseline: EXPORTS, head: JSON.stringify(both) });
    expect(unwrapErr(result).message).toBe(`${EXPORTS.file}: two different rows both read as symbols:src/a.ts#b.ts#c`);
  });

  it("names a new row whose path holds # in a compound identity as a loosening, never an unreadable file", () => {
    const head = { sites: [{ owes: "x", path: "src/a#b.ts", shape: "jsonl-read-whole" }] };
    expect(loosened({ base: { sites: [] }, baseline: WHOLE_JSON, head })).toStrictEqual([
      {
        entry: "sites:src/a#b.ts#jsonl-read-whole",
        file: WHOLE_JSON.file,
        from: null,
        identityTuple: ["sites", "src/a#b.ts", "jsonl-read-whole"],
        to: 1,
      },
    ]);
  });

  it("compares a counted row whose path holds # with itself, so its growth reads as a grown count", () => {
    const row = { count: 1, operator: "??", path: "src/a#b.ts" };
    expect(
      loosened({ base: { sites: [row] }, baseline: FALLBACK, head: { sites: [{ ...row, count: 2 }] } }),
    ).toStrictEqual([
      {
        entry: "sites:src/a#b.ts#??",
        file: FALLBACK.file,
        from: 1,
        identityTuple: ["sites", "src/a#b.ts", "??"],
        to: 2,
      },
    ]);
    expect(loosened({ base: { sites: [row] }, baseline: FALLBACK, head: { sites: [row] } })).toStrictEqual([]);
  });

  it("keeps a # in a compound identity's last part, which the join cannot confuse, and carries no tuple", () => {
    expect(
      loosened({ base: { symbols: [] }, baseline: EXPORTS, head: { symbols: [{ name: "b#c", path: "a.ts" }] } }),
    ).toStrictEqual([{ entry: "symbols:a.ts#b#c", file: EXPORTS.file, from: null, to: 1 }]);
  });

  it("refuses a file that is not its declared shape", () => {
    const result = loosenings({ base: undefined, baseline: CLONE, head: JSON.stringify({ filePairs: "three" }) });
    expect(unwrapErr(result).code).toBe("BASELINE_SHAPE");
    expect(unwrapErr(result).message).toBe(`${CLONE.file}: \`filePairs\` is not a number`);
  });
});
