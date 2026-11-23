import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRONZE_COMPACT_BASENAME,
  bronzeCompactFile,
  bronzeDir,
  cacheDir,
  distilCachePath,
  goldDir,
  silverDigestsDir,
  silverIndexDir,
  sortBronzeEntries,
  watermarkPath,
} from "../../../corpus/corpusPaths.js";
import { stateHomePaths } from "../../../stateHome.js";

describe("corpusPaths delegate to the one home-path contract", () => {
  const home = "/tmp/sw-corpus-home";
  const contract = stateHomePaths({ home });

  it("resolves the corpus roots to the contract (no second layout vocabulary)", () => {
    expect(bronzeDir({ home })).toBe(contract.corpus.bronze);
    expect(goldDir({ home })).toBe(contract.corpus.gold);
    expect(cacheDir({ home })).toBe(contract.corpus.cache);
    expect(watermarkPath({ home })).toBe(contract.corpus.watermark);
  });

  it("builds silver leaves under the contract silver root", () => {
    expect(silverIndexDir({ home })).toBe(join(contract.corpus.silver, "index"));
    expect(silverDigestsDir({ home })).toBe(join(contract.corpus.silver, "digests"));
  });

  it("keeps the distil cache under the corpus cache root", () => {
    expect(distilCachePath({ home })).toBe(join(contract.corpus.cache, "distil", "batches.json"));
  });

  it("roots the corpus under <home>/corpus after the warehouse→corpus rename", () => {
    expect(bronzeDir({ home })).toBe("/tmp/sw-corpus-home/corpus/bronze");
  });
});

describe("sortBronzeEntries", () => {
  it("puts the canonical compacted file FIRST, ahead of every window a later refresh wrote", () => {
    const files = ["2026-08-24_2026-08-26.jsonl", BRONZE_COMPACT_BASENAME, "2026-04-01_2026-08-31.jsonl"];

    expect(sortBronzeEntries({ entries: files })).toEqual([
      BRONZE_COMPACT_BASENAME,
      "2026-04-01_2026-08-31.jsonl",
      "2026-08-24_2026-08-26.jsonl",
    ]);
  });

  it("is what a PLAIN sort gets wrong — the defect this comparator exists for", () => {
    const files = ["2026-04-01_2026-08-31.jsonl", BRONZE_COMPACT_BASENAME];

    expect(files.toSorted()).toEqual(["2026-04-01_2026-08-31.jsonl", BRONZE_COMPACT_BASENAME]);
    expect(sortBronzeEntries({ entries: files })[0]).toBe(BRONZE_COMPACT_BASENAME);
  });

  it("orders window files among themselves by code unit, so the order is total and deterministic", () => {
    expect(sortBronzeEntries({ entries: ["b.jsonl", "a.jsonl", "c.jsonl"] })).toEqual([
      "a.jsonl",
      "b.jsonl",
      "c.jsonl",
    ]);
  });

  it("keeps a repeated name stable rather than dropping either copy", () => {
    expect(sortBronzeEntries({ entries: ["a.jsonl", "a.jsonl"] })).toEqual(["a.jsonl", "a.jsonl"]);
  });

  it("names the same basename the canonical file path ends with", () => {
    expect(bronzeCompactFile({ home: "/tmp/sw-corpus-home", source: "gmail" }).endsWith(BRONZE_COMPACT_BASENAME)).toBe(
      true,
    );
  });
});
