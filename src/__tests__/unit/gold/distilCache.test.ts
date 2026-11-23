import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { distilCachePath } from "../../../corpus/corpusPaths.js";
import type { BatchDigest } from "../../../gold/distil.js";
import { loadDistilCache, saveDistilCache } from "../../../gold/distilCache.js";
import { writeJsonFile } from "../../../lib/jsonFile.js";

const digest: BatchDigest = {
  container: "o/r",
  points: [{ citations: ["u"], point: "p" }],
  source: "github",
  summary: "s",
};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-cache-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("distilCache", () => {
  it("round-trips digests through save + load", () => {
    saveDistilCache({ cache: new Map([["h1", digest]]), home });
    const loaded = loadDistilCache({ home });
    expect(loaded.get("h1")).toEqual(digest);
  });

  it("loads an empty cache when there is no file", () => {
    expect(loadDistilCache({ home }).size).toBe(0);
  });

  it("drops a cached entry whose source is not a real CorpusSource", () => {
    writeJsonFile({
      path: distilCachePath({ home }),
      value: { h1: { ...digest, source: "not-a-real-source" } },
    });
    expect(loadDistilCache({ home }).size).toBe(0);
  });
});
