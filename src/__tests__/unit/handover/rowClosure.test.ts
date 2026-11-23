/**
 * `rowClosure` — the docs one board row is composed from, found by exact lookup over `blockedBy` edges.
 */
import { describe, expect, it } from "vitest";

import { type LookedUp, type RowClosure, rowClosure } from "../../../handover/rowClosure.js";

interface Doc {
  readonly slug: string;
  readonly blockedBy: readonly string[];
}

/**
 * A lookup over a fixed table, standing in for the filesystem.
 *
 * @param live the docs on the live board
 * @param archived the docs in `archive/`
 * @returns the seam `rowClosure` walks with
 */
const lookupOver =
  ({ live, archived = [] }: { live: readonly Doc[]; archived?: readonly Doc[] }) =>
  ({ slug }: { slug: string }): LookedUp<Doc> | undefined => {
    const onBoard = live.find((doc) => doc.slug === slug);
    if (onBoard !== undefined) {
      return { archived: false, doc: onBoard };
    }
    const filed = archived.find((doc) => doc.slug === slug);
    return filed === undefined ? undefined : { archived: true, doc: filed };
  };

/**
 * The walk's closure, throwing when the slug resolved to anything else — the `unwrap` of this union.
 *
 * @param live the docs on the live board
 * @param archived the docs in `archive/`
 * @param slug the row asked for
 * @returns the closure
 */
function closureOf({
  live,
  archived = [],
  slug,
}: {
  live: readonly Doc[];
  archived?: readonly Doc[];
  slug: string;
}): RowClosure<Doc> {
  const read = rowClosure({ lookup: lookupOver({ archived, live }), slug });
  if (read.kind !== "closure") {
    throw new Error(`expected a closure for ${slug}, got ${read.kind}`);
  }
  return read;
}

const slugsOf = ({ docs }: { docs: readonly Doc[] }): readonly string[] => docs.map((doc) => doc.slug);

describe("rowClosure", () => {
  it("answers missing when the target resolves nowhere", () => {
    expect(rowClosure({ lookup: lookupOver({ live: [] }), slug: "missing" })).toEqual({ kind: "missing" });
  });

  it("answers archived for an archived TARGET, since no board row carries it", () => {
    const done = { blockedBy: [], slug: "done-thing" };
    expect(rowClosure({ lookup: lookupOver({ archived: [done], live: [] }), slug: "done-thing" })).toEqual({
      doc: done,
      kind: "archived",
    });
  });

  it("is the target alone when it waits on nothing", () => {
    const closure = closureOf({ live: [{ blockedBy: [], slug: "a" }], slug: "a" });
    expect(slugsOf({ docs: closure.roots })).toEqual(["a"]);
    expect(closure.archived).toEqual([]);
  });

  it("walks live dependencies transitively, target first, and leaves the rest of the board out", () => {
    const live: Doc[] = [
      { blockedBy: ["b"], slug: "a" },
      { blockedBy: ["c"], slug: "b" },
      { blockedBy: [], slug: "c" },
      { blockedBy: [], slug: "unrelated" },
    ];
    expect(slugsOf({ docs: closureOf({ live, slug: "a" }).roots })).toEqual(["a", "b", "c"]);
  });

  it("keeps an archived dependency out of the roots, and walks through it to the live doc beyond", () => {
    const closure = closureOf({
      archived: [{ blockedBy: ["deeper"], slug: "old" }],
      live: [
        { blockedBy: ["old"], slug: "a" },
        { blockedBy: [], slug: "deeper" },
      ],
      slug: "a",
    });
    expect(slugsOf({ docs: closure.roots })).toEqual(["a", "deeper"]);
    expect(slugsOf({ docs: closure.archived })).toEqual(["old"]);
  });

  it("loads an archived doc only when a live doc names it, as the board's archivedDependencies does", () => {
    const archived = [
      { blockedBy: ["old2"], slug: "old1" },
      { blockedBy: [], slug: "old2" },
      { blockedBy: [], slug: "old3" },
    ];
    const onlyArchivedNames = closureOf({ archived, live: [{ blockedBy: ["old1"], slug: "a" }], slug: "a" });
    expect(slugsOf({ docs: onlyArchivedNames.archived })).toEqual(["old1"]);
    const liveNamesItLater = closureOf({
      archived,
      live: [
        { blockedBy: ["old1", "b"], slug: "a" },
        { blockedBy: ["old2"], slug: "b" },
      ],
      slug: "a",
    });
    expect(slugsOf({ docs: liveNamesItLater.roots })).toEqual(["a", "b"]);
    expect(slugsOf({ docs: liveNamesItLater.archived })).toEqual(["old1", "old2"]);
  });

  it("terminates on a cycle and skips a dependency that resolves nowhere", () => {
    const live: Doc[] = [
      { blockedBy: ["b", "ghost"], slug: "a" },
      { blockedBy: ["a"], slug: "b" },
    ];
    const closure = closureOf({ live, slug: "a" });
    expect(slugsOf({ docs: closure.roots })).toEqual(["a", "b"]);
    expect(closure.archived).toEqual([]);
  });
});
