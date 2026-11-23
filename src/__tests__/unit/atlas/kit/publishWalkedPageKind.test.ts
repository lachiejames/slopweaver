/**
 * The read-merge-publish order `publishWalkedPageKind` owns, tested over injected seams rather than a
 * platform.
 *
 * The properties are the ones a copy of this section was seen to lose: only THIS surface's coverage cell is
 * replaced, the generation is read once and is what the publish derives from, and a failed merge leaves
 * nothing written.
 */
import { describe, expect, it } from "vitest";

import { type AtlasWalkedPage, publishWalkedPageKind } from "../../../../atlas/kit/walkSurface.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

interface ToyCell {
  readonly surface: string;
  readonly state: "synced" | "deferred";
}

interface ToyFile {
  readonly coverage: readonly ToyCell[];
  readonly entities: readonly string[];
  readonly gaps: readonly string[];
  readonly updatedAt: string;
}

interface ToyManifest {
  readonly generation: number;
}

const AT = "2026-09-15T00:00:00.000Z";

/** One walked page, with only the fields a test is about stated. */
function walked({ over }: { over: Partial<AtlasWalkedPage> }): AtlasWalkedPage {
  return {
    finalUrl: "https://toy.test/one",
    providerId: "one",
    reached: true,
    requestedUrl: "https://toy.test/one",
    screenshotPath: null,
    statusCode: 200,
    title: "One",
    unreachableBecause: null,
    ...over,
  };
}

/** Every seam recording what it was handed, over a store holding `manifest` and `page`. */
function harness({
  manifest,
  page,
  merge,
}: {
  manifest: ToyManifest | null;
  page: ToyFile | null;
  merge?: () => Result<readonly string[]>;
}) {
  const seen = {
    derivedFrom: [] as (ToyManifest | null)[],
    emptied: 0,
    published: [] as ToyFile[],
    stampedCounts: [] as number[],
  };
  const run = ({ pages, photographed }: { pages: readonly AtlasWalkedPage[]; photographed: number }) =>
    publishWalkedPageKind({
      at: AT,
      coverageFor: ({ counts }): ToyCell => ({
        state: counts.reachedCount === counts.declaredCount ? "synced" : "deferred",
        surface: "console-walk",
      }),
      emptyFile: () => {
        seen.emptied += 1;
        return { coverage: [], entities: [], gaps: [], updatedAt: "" };
      },
      gapsFor: ({ stored }) => [...stored.gaps, "raised-this-run"],
      manifestFor: ({ count }) => {
        seen.stampedCounts.push(count);
        return { generation: 2 };
      },
      merge: ({ observed, stored }) => {
        if (merge !== undefined) {
          return merge();
        }
        return ok([...stored, ...observed]);
      },
      observed: pages.map((walkedPage) => walkedPage.providerId),
      pages,
      photographed,
      publish: ({ derivedFrom, file }) => {
        seen.derivedFrom.push(derivedFrom);
        seen.published.push(file);
        return ok(["page.jsonl", "manifest.json"]);
      },
      read: () => ok({ files: { page }, manifest }),
      surface: "console-walk",
    });
  return { run, seen };
}

describe("publishWalkedPageKind", () => {
  it("replaces only its own surface's coverage cell and carries every other one forward", () => {
    const { run, seen } = harness({
      manifest: null,
      page: {
        coverage: [
          { state: "synced", surface: "api" },
          { state: "deferred", surface: "console-walk" },
        ],
        entities: [],
        gaps: [],
        updatedAt: "",
      },
    });
    run({ pages: [walked({ over: {} })], photographed: 1 });
    expect(seen.published[0]!.coverage).toEqual([
      { state: "synced", surface: "api" },
      { state: "synced", surface: "console-walk" },
    ]);
  });

  it("publishes with `derivedFrom` set to the manifest the ONE read returned", () => {
    const { run, seen } = harness({ manifest: { generation: 7 }, page: null });
    run({ pages: [walked({ over: {} })], photographed: 0 });
    expect(seen.derivedFrom).toEqual([{ generation: 7 }]);
  });

  it("merges onto the empty file when the store holds no page kind, and onto the stored one otherwise", () => {
    const stored = harness({
      manifest: null,
      page: { coverage: [], entities: ["existing"], gaps: ["old-gap"], updatedAt: "" },
    });
    stored.run({ pages: [walked({ over: {} })], photographed: 0 });
    const fresh = harness({ manifest: null, page: null });
    fresh.run({ pages: [walked({ over: {} })], photographed: 0 });
    expect(stored.seen.emptied).toBe(0);
    expect(stored.seen.published[0]!.entities).toEqual(["existing", "one"]);
    expect(stored.seen.published[0]!.gaps).toEqual(["old-gap", "raised-this-run"]);
    expect(fresh.seen.emptied).toBe(1);
  });

  it("stamps the manifest from the MERGED count and this run's instant", () => {
    const { run, seen } = harness({
      manifest: null,
      page: { coverage: [], entities: ["a", "b"], gaps: [], updatedAt: "" },
    });
    run({ pages: [walked({ over: {} })], photographed: 0 });
    expect(seen.stampedCounts).toEqual([3]);
    expect(seen.published[0]!.updatedAt).toBe(AT);
  });

  it("reports the four counts the document earned plus what was written", () => {
    const { run } = harness({ manifest: null, page: null });
    const outcome = unwrap(
      run({
        pages: [walked({ over: {} }), walked({ over: { providerId: "two", reached: false } })],
        photographed: 1,
      }),
    );
    expect(outcome).toEqual({
      declaredCount: 2,
      photographedCount: 1,
      reachedCount: 1,
      unreachableCount: 1,
      written: ["page.jsonl", "manifest.json"],
    });
  });

  it("writes NOTHING when the merge fails, and forwards the merge's own reason", () => {
    const { run, seen } = harness({ manifest: null, merge: () => err(["merge refused"]), page: null });
    expect(unwrapErr(run({ pages: [walked({ over: {} })], photographed: 0 }))).toEqual(["merge refused"]);
    expect(seen.published).toEqual([]);
  });

  it("writes NOTHING when the generation cannot be read, forwarding the reader's own lines", () => {
    const published: unknown[] = [];
    const outcome = publishWalkedPageKind<ToyFile, ToyManifest>({
      at: AT,
      coverageFor: () => ({ state: "synced", surface: "console-walk" }),
      emptyFile: () => ({ coverage: [], entities: [], gaps: [], updatedAt: "" }),
      gapsFor: () => [],
      manifestFor: () => ({ generation: 1 }),
      merge: ({ observed }) => ok(observed),
      observed: [],
      pages: [],
      photographed: 0,
      publish: (input) => {
        published.push(input);
        return ok([]);
      },
      read: () => err(["manifest.json: schema 9 is newer than this build reads"]),
      surface: "console-walk",
    });
    expect(unwrapErr(outcome)).toEqual(["manifest.json: schema 9 is newer than this build reads"]);
    expect(published).toEqual([]);
  });
});
