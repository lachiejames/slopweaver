/**
 * The `subset` verb's pure core: the flag grammar (including the two things it refuses to guess at) and both
 * renderings.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBSET_DAYS,
  parseSubsetBuildOptions,
  parseSubsetStatusOptions,
  subsetBuildLines,
  subsetJson,
} from "../../../../../cli/commands/subset/core.js";
import { buildSubsetManifest, LIMIT_ONLY_DAYS, type SubsetManifest } from "../../../../../corpus/subset.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const manifest = (over: Partial<SubsetManifest> = {}): SubsetManifest =>
  buildSubsetManifest({
    builtAtIso: "2026-08-24T16:00:00.000Z",
    days: 7,
    sinceIso: "2026-08-17T16:00:00.000Z",
    sourceHome: "/corpus/full",
    sources: [
      { kept: 3, newestIso: "2026-08-20T00:00:00.000Z", scanned: 10, source: "github", undated: 0 },
      { kept: 0, scanned: 5, source: "self", undated: 0 },
    ],
    untilIso: "2026-08-24T16:00:00.000Z",
    ...over,
  });

describe("parseSubsetBuildOptions", () => {
  it("defaults to the bottom rung of the ladder", () => {
    const parsed = unwrap(parseSubsetBuildOptions({ defaultHome: "/corpus/full", rest: ["--out", "/tmp/7d"] }));
    expect(parsed.days).toBe(DEFAULT_SUBSET_DAYS);
    expect(parsed.days).toBe(7);
  });

  it("graduates on --days alone", () => {
    const parsed = unwrap(
      parseSubsetBuildOptions({ defaultHome: "/corpus/full", rest: ["--out", "/tmp/x", "--days", "30"] }),
    );
    expect(parsed.days).toBe(30);
  });

  it("defaults the source home and takes --home when given", () => {
    expect(unwrap(parseSubsetBuildOptions({ defaultHome: "/corpus/full", rest: ["--out", "/tmp/x"] })).home).toBe(
      "/corpus/full",
    );
    expect(
      unwrap(parseSubsetBuildOptions({ defaultHome: "/corpus/full", rest: ["--out", "/tmp/x", "--home", "/other"] }))
        .home,
    ).toBe("/other");
  });

  it("REFUSES a build with no --out, because a subset is never a mutation of its source", () => {
    expect(unwrapErr(parseSubsetBuildOptions({ defaultHome: "/corpus/full", rest: [] }))[0]).toContain(
      "--out <dir> is required",
    );
  });

  it("widens the window to LIMIT_ONLY_DAYS when --limit is given alone", () => {
    const parsed = unwrap(parseSubsetBuildOptions({ defaultHome: "/h", rest: ["--out", "/tmp/x", "--limit", "500"] }));
    expect(parsed.limit).toBe(500);
    expect(parsed.days).toBe(LIMIT_ONLY_DAYS);
  });

  it("lets an explicit --days win, so the two compose as newest-N-of-this-week", () => {
    const parsed = unwrap(
      parseSubsetBuildOptions({ defaultHome: "/h", rest: ["--out", "/tmp/x", "--limit", "500", "--days", "7"] }),
    );
    expect(parsed.days).toBe(7);
    expect(parsed.limit).toBe(500);
  });

  it("is uncapped when no --limit is given", () => {
    expect(unwrap(parseSubsetBuildOptions({ defaultHome: "/h", rest: ["--out", "/tmp/x"] })).limit).toBeUndefined();
  });

  it("refuses a --limit that is not a positive whole number", () => {
    expect(
      unwrapErr(parseSubsetBuildOptions({ defaultHome: "/h", rest: ["--out", "/tmp/x", "--limit", "-1"] })).length,
    ).toBe(1);
  });

  it("refuses a --days that is not a positive whole number", () => {
    expect(
      unwrapErr(parseSubsetBuildOptions({ defaultHome: "/corpus/full", rest: ["--out", "/tmp/x", "--days", "0"] }))
        .length,
    ).toBe(1);
  });
});

describe("parseSubsetStatusOptions", () => {
  it("reads the default home when --home is absent", () => {
    expect(unwrap(parseSubsetStatusOptions({ defaultHome: "/corpus/full", rest: [] }))).toEqual({
      home: "/corpus/full",
      json: false,
    });
  });

  it("carries --json", () => {
    expect(unwrap(parseSubsetStatusOptions({ defaultHome: "/h", rest: ["--json"] })).json).toBe(true);
  });
});

describe("subsetJson", () => {
  it("projects the same manifest the human lines render", () => {
    const json = subsetJson({ home: "/tmp/7d", manifest: manifest() });
    expect(json["keptRecords"]).toBe(3);
    expect(json["scannedRecords"]).toBe(15);
    expect(json["emptySources"]).toEqual(["self"]);
    expect(json["days"]).toBe(7);
  });

  it("reports an uncapped build's limit as null and a capped one's as its cap", () => {
    expect(subsetJson({ home: "/tmp/7d", manifest: manifest() })["limit"]).toBeNull();
    expect(subsetJson({ home: "/tmp/7d", manifest: manifest({ limit: 100 }) })["limit"]).toBe(100);
  });
});

describe("subsetBuildLines", () => {
  it("ends with the exact next commands, each pinned to the home just built", () => {
    const lines = subsetBuildLines({ elapsedSeconds: 24.04, manifest: manifest(), out: "/tmp/7d" });
    expect(lines[0]).toContain("SUBSET — this world model holds only the last 7 day(s)");
    expect(lines.at(-4)).toBe("sliced in 24.0s → /tmp/7d");
    expect(lines.at(-3)).toBe("next, against this home and nothing else:");
    expect(lines.at(-2)).toBe("  slopweaver derive --home /tmp/7d");
    expect(lines.at(-1)).toBe('  slopweaver store read "<question>" --home /tmp/7d');
  });
});
