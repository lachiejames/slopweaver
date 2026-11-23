/**
 * What the board says about an amending memory's row — the pure mapping over plain fake readers, then one
 * round-trip over a real state home, and the closure property that makes the lazy import worth having.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { amendsRowStateOf, boardRowStateResolver } from "../../../../../cli/commands/memory/boardRowState.js";
import { resolveAmendsRows } from "../../../../../cli/commands/memory/judgedCorpus.js";
import { staticClosureOf } from "../../../../../devLint/staticImportClosure.js";
import type { DocStatus } from "../../../../../handover/doc.js";
import {
  type DerivedRowReadError,
  DerivedRowReadErrors,
  type ReadableDerivedRowState,
} from "../../../../../handover/rowState.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { buildMemoryCorpus } from "../../../../../memory/corpus.js";

/** One row the fake board holds. */
interface FakeRow {
  readonly status: DocStatus;
  readonly filedAs?: string;
}

/** A reader over a fixed board, where a row absent from it is missing. */
function board({
  rows,
}: {
  rows: Readonly<Record<string, FakeRow | "unreadable">>;
}): (args: { slug: string }) => Result<ReadableDerivedRowState, DerivedRowReadError> {
  return ({ slug }) => {
    const row = rows[slug];
    if (row === undefined) {
      return err(DerivedRowReadErrors.missing({ slug }));
    }
    if (row === "unreadable") {
      return err(DerivedRowReadErrors.unreadable({ slug, why: "a journal line did not decode" }));
    }
    return ok({
      archived: false,
      authoredStatus: row.status,
      settlement: row.filedAs === undefined ? undefined : "filed",
      settlementWitness: row.filedAs,
      slug,
      status: row.status,
    });
  };
}

describe("amendsRowStateOf", () => {
  it.each([
    ["ready", { kind: "live", status: "ready" }],
    ["in-progress", { kind: "live", status: "in-progress" }],
    ["done", { kind: "landed" }],
    ["cancelled", { kind: "closed-unlanded", status: "cancelled" }],
    ["rejected", { kind: "closed-unlanded", status: "rejected" }],
  ] as const)("maps a %s row", (status, expected) => {
    expect(amendsRowStateOf({ read: board({ rows: { a: { status } } }), row: "a" })).toEqual(expected);
  });

  it("is missing when no doc carries the declared row", () => {
    expect(amendsRowStateOf({ read: board({ rows: {} }), row: "a" })).toEqual({ kind: "missing" });
  });

  it("is unreadable when the row did not read whole", () => {
    expect(amendsRowStateOf({ read: board({ rows: { a: "unreadable" } }), row: "a" })).toEqual({
      kind: "unreadable",
      why: "the board row a did not read whole — a journal line did not decode",
    });
  });

  it("follows a filed ask to the row it became, rather than reading the ask's own done", () => {
    const read = board({ rows: { ask: { filedAs: "build", status: "done" }, build: { status: "ready" } } });

    expect(amendsRowStateOf({ read, row: "ask" })).toEqual({ kind: "live", status: "ready" });
  });

  it("judges nothing on a filed chain that loops", () => {
    const read = board({ rows: { a: { filedAs: "b", status: "done" }, b: { filedAs: "a", status: "done" } } });

    expect(amendsRowStateOf({ read, row: "a" })).toEqual({
      kind: "unreadable",
      why: "the filed chain from a loops back to a",
    });
  });

  it("judges nothing when the row a filed ask became is missing", () => {
    const read = board({ rows: { a: { filedAs: "gone", status: "done" } } });

    expect(amendsRowStateOf({ read, row: "a" })).toEqual({
      kind: "unreadable",
      why: "no doc carries the board row gone, live or archived",
    });
  });

  it("judges nothing on a filed chain longer than the hop limit", () => {
    const rows: Record<string, FakeRow> = {};
    for (let i = 0; i < 7; i += 1) {
      rows[`r${String(i)}`] = { filedAs: `r${String(i + 1)}`, status: "done" };
    }

    expect(amendsRowStateOf({ read: board({ rows }), row: "r0" })).toEqual({
      kind: "unreadable",
      why: "the filed chain from r0 runs past 5 hops",
    });
  });
});

describe("boardRowStateResolver over a real state home", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "amends-home-"));
    mkdirSync(join(home, "handovers", "archive"), { recursive: true });
    mkdirSync(join(home, "runs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads a done row as landed and an absent one as missing", () => {
    writeFileSync(join(home, "handovers", "a-row.md"), "---\nslug: a-row\nstatus: done\n---\n# doc\n");
    const stateOf = boardRowStateResolver({ home });

    expect([stateOf({ row: "a-row" }), stateOf({ row: "no-row" })]).toEqual([{ kind: "landed" }, { kind: "missing" }]);
  });

  it("puts the resolved state on the leaf through the verbs' one door", async () => {
    writeFileSync(join(home, "handovers", "a-row.md"), "---\nslug: a-row\nstatus: done\n---\n# doc\n");
    const text =
      "---\nname: thing\ndescription: a thing\nmetadata:\n  slopweaver:\n    amendsCanon:\n" +
      "      target: AGENTS.md\n      row: a-row\n---\n";
    const corpus = await resolveAmendsRows({
      corpus: buildMemoryCorpus({ files: [{ file: "thing.md", text }] }),
      home,
    });

    expect(corpus.leaves[0]!.amendsCanon).toEqual({ row: "a-row", rowState: { kind: "landed" }, target: "AGENTS.md" });
  });
});

describe("the board reader stays off every memory verb's static load path", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
  const closure = staticClosureOf({
    readText: (path) => readFileSync(join(repoRoot, path), "utf8"),
    roots: ["src/cli/commands/memory/run.ts"],
  });

  it("walks the memory verb's closure (the walk is not empty)", () => {
    expect(closure.files).toContain("src/cli/commands/memory/judgedCorpus.ts");
  });

  it("does not reach the handover row reader, which the lazy import loads only when a memory declares a row", () => {
    expect(closure.files.filter((file) => file.startsWith("src/handover/"))).toEqual([]);
  });
});
