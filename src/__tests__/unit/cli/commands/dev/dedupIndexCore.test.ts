/**
 * `slopweaver dev dedup-index` is the verb that keeps `DEDUP_INDEX_BYTES_PER_RECORD` honest, so what it must
 * never do is report a measurement as covered when it is not — a partial index divided by the rows it managed
 * is a lower bound, and treating it as the cost would ratchet the writer's guard down on a number that never
 * saw the whole source.
 */
import { describe, expect, it } from "vitest";
import { runDevDedupIndexWithDeps } from "../../../../../cli/commands/dev/dedupIndex.js";
import {
  DEV_DEDUP_INDEX_FLAG_NAMES,
  DEV_DEDUP_INDEX_USAGE,
  type DedupIndexSample,
  dedupConstantHolds,
  deriveDedupIndexCost,
  parseDedupSource,
  renderDedupIndexCost,
} from "../../../../../cli/commands/dev/dedupIndexCore.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { DEDUP_INDEX_BYTES_PER_RECORD } from "../../../../../corpus/bronzeDedupIndex.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const sample = (over: Partial<DedupIndexSample> = {}): DedupIndexSample => ({
  diskBytes: 6_810_000_000,
  elapsedMs: 18_400,
  fileCount: 20,
  heldBytes: 597_000_000,
  ids: 1_695_583,
  limitBytes: 4_496_293_888,
  refused: false,
  rows: 1_768_486,
  source: "slack",
  startBytes: 71_000_000,
  unreadable: [],
  ...over,
});

describe("parseDedupSource", () => {
  it("requires a source rather than defaulting to one", () => {
    expect(unwrapErr(parseDedupSource({ value: undefined }))[0]).toContain("--source is required");
  });

  it("accepts a known bronze source", () => {
    expect(unwrap(parseDedupSource({ value: "slack" }))).toBe("slack");
  });

  it("rejects a source that is not one", () => {
    expect(unwrapErr(parseDedupSource({ value: "jira" }))[0]).toContain("--source must be one of");
  });
});

describe("deriveDedupIndexCost", () => {
  it("divides retained live heap by the rows it absorbed", () => {
    const cost = deriveDedupIndexCost({
      sample: sample({ heldBytes: 471_000_000, rows: 1_000_000, startBytes: 71_000_000 }),
    });

    expect(cost.bytesPerRecord).toBe(400);
    expect(cost.shipped).toBe(DEDUP_INDEX_BYTES_PER_RECORD);
    expect(cost.covers).toBe(true);
  });

  it("reports a cost past the shipped constant as NOT covered", () => {
    const cost = deriveDedupIndexCost({
      sample: sample({ heldBytes: 571_000_000, rows: 1_000_000, startBytes: 71_000_000 }),
    });

    expect(cost.bytesPerRecord).toBe(500);
    expect(cost.covers).toBe(false);
  });

  it("clamps a build that settled below where it started to zero, not to a negative cost", () => {
    const cost = deriveDedupIndexCost({ sample: sample({ heldBytes: 10, rows: 100, startBytes: 1000 }) });

    expect(cost.bytesPerRecord).toBe(0);
    expect(cost.bytesPerDiskByte).toBe(0);
  });

  it("reads an empty source as zero rather than dividing by nothing", () => {
    const cost = deriveDedupIndexCost({
      sample: sample({ diskBytes: 0, heldBytes: 71_000_000, rows: 0, startBytes: 71_000_000 }),
    });

    expect(cost.bytesPerRecord).toBe(0);
    expect(cost.bytesPerDiskByte).toBe(0);
  });
});

describe("dedupConstantHolds", () => {
  it("holds when the whole source was indexed and the constant covers it", () => {
    expect(dedupConstantHolds({ cost: deriveDedupIndexCost({ sample: sample() }) })).toBe(true);
  });

  it("does NOT hold on a refused build, however cheap the partial index looked", () => {
    expect(dedupConstantHolds({ cost: deriveDedupIndexCost({ sample: sample({ refused: true }) }) })).toBe(false);
  });

  it("does NOT hold when a stored path could not be read", () => {
    expect(
      dedupConstantHolds({ cost: deriveDedupIndexCost({ sample: sample({ unreadable: ["/tmp/blocked.jsonl"] }) }) }),
    ).toBe(false);
  });
});

describe("renderDedupIndexCost", () => {
  it("states the measured cost against the shipped constant", () => {
    const lines = renderDedupIndexCost({ cost: deriveDedupIndexCost({ sample: sample() }) });

    expect(lines[0]).toContain("1768486 row(s) indexed");
    expect(lines[3]).toContain("shipped constant 400 covers it");
  });

  it("says a refused build is a LOWER BOUND, so nobody ratchets the constant onto it", () => {
    const lines = renderDedupIndexCost({ cost: deriveDedupIndexCost({ sample: sample({ refused: true }) }) });

    expect(lines.at(-1)).toContain("lower bound");
  });
});

describe("runDevDedupIndexWithDeps", () => {
  it("prints its usage and exits OK on --help", () => {
    const out: string[] = [];
    const code = runDevDedupIndexWithDeps({
      argv: ["node", "slopweaver", "dev", "dedup-index", "--help"],
      log: { error: () => undefined, out: ({ line }) => out.push(line) },
    });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([DEV_DEDUP_INDEX_USAGE]);
  });

  it("exits USAGE when no --source is named", () => {
    const errors: string[] = [];
    const code = runDevDedupIndexWithDeps({
      argv: ["node", "slopweaver", "dev", "dedup-index"],
      log: { error: ({ msg }) => errors.push(msg), out: () => undefined },
    });

    expect(code).toBe(EXIT_USAGE);
    expect(errors[0]).toContain("--source is required");
  });
});

describe("DEV_DEDUP_INDEX_FLAG_NAMES", () => {
  it("lists exactly the flags the parser accepts", () => {
    expect(DEV_DEDUP_INDEX_FLAG_NAMES).toEqual(["--home", "--json", "--source"]);
  });
});
