/**
 * Which `github lap` flag combinations a `--dry-run` refuses before any credential or network: a pure function
 * over the parsed flags, so every case is one call.
 */
import { describe, expect, it } from "vitest";
import { lapDryRunProblems } from "../../../../../cli/commands/github/lapDryRunArgs.js";

const LAND_ONLY_CONTRADICTION =
  "--land-only and --dry-run contradict each other: a dry run posts nothing, so it has nothing to land on";
const BATCH_PREFLIGHT =
  "--land --dry-run checks ONE pull request's landing before its lap; a batch's landings are not checked ahead yet, so lap the members one at a time";

describe("lapDryRunProblems", () => {
  it("refuses --land-only with --dry-run, since a dry run posts nothing to land on", () => {
    expect(lapDryRunProblems({ dryRun: true, land: true, landOnly: true, memberCount: 1 })).toEqual([
      LAND_ONLY_CONTRADICTION,
    ]);
  });

  it("refuses --land --dry-run over a batch, whose landings are not checked ahead", () => {
    expect(lapDryRunProblems({ dryRun: true, land: true, landOnly: false, memberCount: 2 })).toEqual([BATCH_PREFLIGHT]);
  });

  it("names only the contradiction when --land-only --dry-run also names a batch", () => {
    expect(lapDryRunProblems({ dryRun: true, land: true, landOnly: true, memberCount: 3 })).toEqual([
      LAND_ONLY_CONTRADICTION,
    ]);
  });

  it("accepts --land --dry-run on ONE pull request: that is the landing preflight", () => {
    expect(lapDryRunProblems({ dryRun: true, land: true, landOnly: false, memberCount: 1 })).toEqual([]);
  });

  it("accepts a plain --dry-run over a batch, which lands nothing", () => {
    expect(lapDryRunProblems({ dryRun: true, land: false, landOnly: false, memberCount: 4 })).toEqual([]);
  });

  it("raises nothing without --dry-run, whatever else was given", () => {
    expect(lapDryRunProblems({ dryRun: false, land: true, landOnly: true, memberCount: 4 })).toEqual([]);
  });
});
