/**
 * The read-merge-publish order `publishPageWalk` owns, tested over injected seams rather than a platform.
 *
 * The properties are the ones a copy of this section was seen to lose: the walk every seam sees is the
 * CHECKED one, the generation is read once and is what the publish derives from, and a failure anywhere
 * before the write leaves nothing written.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { screenshotArtifact } from "../../../../atlas/kit/pageScreenshot.js";
import type { PageObservation } from "../../../../atlas/kit/pageWalk.js";
import { publishPageWalk } from "../../../../atlas/kit/walkPublish.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

interface ToyFile {
  readonly kind: "method" | "page";
  readonly entities: readonly string[];
}

interface ToyManifest {
  readonly generation: number;
}

interface ToyWalk {
  readonly pages: readonly PageObservation<string>[];
  readonly sessionLost: boolean;
}

const scratch: string[] = [];

/** A throwaway directory, removed after the test that made it. */
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-publish-page-walk-"));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One observation, with only the fields a test is about stated. */
function observation({ over }: { over: Partial<PageObservation<string>> }): PageObservation<string> {
  return {
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: "https://toy.test/one",
    observedAt: "2026-09-05T00:00:00.000Z",
    redirected: false,
    requestedUrl: "https://toy.test/one",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "one",
    title: "One",
    unreachableBecause: null,
    ...over,
  };
}

/** A screenshot artifact whose bytes are really on disk under `directory`. */
function storedShot({ directory }: { directory: string }) {
  const shot = screenshotArtifact({
    artifactPathFor: ({ sha256 }) => `artifacts/pages/${sha256}.png`,
    bytes: new Uint8Array([1, 2, 3]),
  });
  mkdirSync(dirname(join(directory, shot.relativePath)), { recursive: true });
  writeFileSync(join(directory, shot.relativePath), new Uint8Array([1, 2, 3]));
  return shot;
}

/** Every seam recording what it was handed, over a store holding `manifest` and `files`. */
function harness({
  directory,
  manifest,
  files,
  mergePage,
}: {
  directory: string;
  manifest: ToyManifest | null;
  files: { method: ToyFile | null; page: ToyFile | null };
  mergePage?: () => Result<ToyFile>;
}) {
  const seen = {
    derivedFrom: [] as (ToyManifest | null)[],
    emptied: [] as ("method" | "page")[],
    mergedPageWalks: [] as ToyWalk[],
    published: [] as { method: ToyFile; page: ToyFile }[],
    stampedCounts: [] as { methodCount: number; pageCount: number }[],
  };
  const run = ({ walk }: { walk: ToyWalk }) =>
    publishPageWalk({
      declaredCount: 3,
      directory,
      emptyFile: ({ kind }) => {
        seen.emptied.push(kind);
        return { entities: [], kind };
      },
      manifestFor: ({ methodCount, pageCount }) => {
        seen.stampedCounts.push({ methodCount, pageCount });
        return { generation: 2 };
      },
      mergeMethodFile: ({ observed, stored }) => ok({ ...stored, entities: [...stored.entities, ...observed] }),
      mergePageFile: ({ walk: checked, stored }) => {
        seen.mergedPageWalks.push(checked);
        if (mergePage !== undefined) {
          return mergePage();
        }
        return ok({ ...stored, entities: checked.pages.map((page) => page.surface) });
      },
      projectMethods: ({ walk: checked }) => checked.pages.flatMap((page) => page.calls),
      publish: ({ derivedFrom, files: toWrite }) => {
        seen.derivedFrom.push(derivedFrom);
        seen.published.push(toWrite);
        return ok(["page.jsonl", "method.jsonl", "manifest.json"]);
      },
      read: () => ok({ files, manifest }),
      walk,
    });
  return { run, seen };
}

describe("publishPageWalk", () => {
  it("hands every seam the CHECKED walk, so a fabricated artifact reference is already struck off", () => {
    const directory = scratchDir();
    const fabricated = {
      ...storedShot({ directory }),
      sha256: "b".repeat(64),
      relativePath: "artifacts/pages/nope.png",
    };
    const { run, seen } = harness({ directory, files: { method: null, page: null }, manifest: null });
    run({ walk: { pages: [observation({ over: { artifacts: [fabricated] } })], sessionLost: false } });
    expect(seen.mergedPageWalks[0]!.pages[0]!.artifacts).toEqual([]);
    expect(seen.mergedPageWalks[0]!.pages[0]!.screenshotMissingBecause).toContain("absent");
  });

  it("keeps a page whose screenshot really is on disk, and counts it photographed", () => {
    const directory = scratchDir();
    const shot = storedShot({ directory });
    const { run } = harness({ directory, files: { method: null, page: null }, manifest: null });
    const outcome = unwrap(
      run({ walk: { pages: [observation({ over: { artifacts: [shot] } })], sessionLost: false } }),
    );
    expect(outcome.photographedCount).toBe(1);
    expect(outcome.reachedCount).toBe(1);
  });

  it("publishes with `derivedFrom` set to the manifest the ONE read returned", () => {
    const { run, seen } = harness({
      directory: scratchDir(),
      files: { method: null, page: null },
      manifest: { generation: 7 },
    });
    run({ walk: { pages: [observation({ over: {} })], sessionLost: false } });
    expect(seen.derivedFrom).toEqual([{ generation: 7 }]);
  });

  it("merges onto the empty file for each kind the store does not hold, and onto the stored one otherwise", () => {
    const { run, seen } = harness({
      directory: scratchDir(),
      files: { method: { entities: ["existing"], kind: "method" }, page: null },
      manifest: null,
    });
    run({ walk: { pages: [observation({ over: { calls: ["op"] } })], sessionLost: false } });
    expect(seen.emptied).toEqual(["page"]);
    expect(seen.published[0]!.method.entities).toEqual(["existing", "op"]);
  });

  it("stamps the manifest from the MERGED counts, not the walk's", () => {
    const { run, seen } = harness({
      directory: scratchDir(),
      files: { method: { entities: ["a", "b"], kind: "method" }, page: null },
      manifest: null,
    });
    run({ walk: { pages: [observation({ over: { calls: ["c"] } })], sessionLost: false } });
    expect(seen.stampedCounts).toEqual([{ methodCount: 3, pageCount: 1 }]);
  });

  it("reports the declared denominator it was given, the operations it projected, and what was written", () => {
    const { run } = harness({ directory: scratchDir(), files: { method: null, page: null }, manifest: null });
    const outcome = unwrap(
      run({ walk: { pages: [observation({ over: { calls: ["x", "y"] } })], sessionLost: false } }),
    );
    expect(outcome).toEqual({
      declaredCount: 3,
      operationCount: 2,
      photographedCount: 0,
      reachedCount: 1,
      written: ["page.jsonl", "method.jsonl", "manifest.json"],
    });
  });

  it("writes NOTHING when the page merge fails, and forwards that merge's own reason", () => {
    const { run, seen } = harness({
      directory: scratchDir(),
      files: { method: null, page: null },
      manifest: null,
      mergePage: () => err(["page merge refused"]),
    });
    const outcome = run({ walk: { pages: [observation({ over: {} })], sessionLost: false } });
    expect(unwrapErr(outcome)).toEqual(["page merge refused"]);
    expect(seen.published).toEqual([]);
  });

  it("writes NOTHING when the generation cannot be read, forwarding the reader's own lines", () => {
    const published: unknown[] = [];
    const outcome = publishPageWalk<string, ToyWalk, ToyFile, ToyManifest>({
      declaredCount: 1,
      directory: scratchDir(),
      emptyFile: ({ kind }) => ({ entities: [], kind }),
      manifestFor: () => ({ generation: 1 }),
      mergeMethodFile: ({ stored }) => ok(stored),
      mergePageFile: ({ stored }) => ok(stored),
      projectMethods: () => [],
      publish: (input) => {
        published.push(input);
        return ok([]);
      },
      read: () => err(["manifest.json: schema 9 is newer than this build reads"]),
      walk: { pages: [observation({ over: {} })], sessionLost: false },
    });
    expect(unwrapErr(outcome)).toEqual(["manifest.json: schema 9 is newer than this build reads"]);
    expect(published).toEqual([]);
  });
});
