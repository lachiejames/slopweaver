/**
 * The `dev slice-shape` flag parse and report rendering.
 *
 * The rendering is tested rather than left to review because the report IS the deliverable — the owner
 * prices a slice decision off these lines, and a share printed against the wrong denominator would read
 * exactly as convincingly as a right one.
 */
import { describe, expect, it } from "vitest";
import {
  count,
  DEFAULT_TOP_CONTAINERS,
  DEV_SLICE_SHAPE_FLAG_NAMES,
  humanBytes,
  parseDevSliceShapeArgs,
  parseTopContainers,
  percent,
  renderSliceShape,
} from "../../../../../cli/commands/dev/sliceShapeCore.js";
import { absorbRow, emptySliceShape, finishSliceShape, type SliceShapeRow } from "../../../../../corpus/sliceShape.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** A small but non-degenerate corpus: two Slack channels, one thread with replies, and one GitHub repo. */
function sampleShape() {
  const rows: SliceShapeRow[] = [
    { byteLength: 100, container: "slack/A", source: "slack", sourceId: "A:1.0", tsIso: "2026-09-01T00:00:00.000Z" },
    {
      byteLength: 200,
      container: "slack/A",
      source: "slack",
      sourceId: "A:1.0:reply:2.0",
      tsIso: "2026-09-02T00:00:00.000Z",
    },
    { byteLength: 300, container: "slack/B", source: "slack", sourceId: "B:1.0", tsIso: "2026-08-01T00:00:00.000Z" },
    { byteLength: 400, container: "o/r", source: "github", sourceId: "o/r#1", tsIso: "2026-07-01T00:00:00.000Z" },
  ];
  const into = emptySliceShape();
  rows.forEach((row) => {
    absorbRow({ into, row });
  });
  return finishSliceShape({ into, nowMs: Date.parse("2026-09-06T00:00:00.000Z"), top: 2 });
}

describe("parseTopContainers", () => {
  it("defaults when the flag is absent", () => {
    expect(unwrap(parseTopContainers({ value: undefined }))).toBe(DEFAULT_TOP_CONTAINERS);
  });

  it("takes a whole number", () => {
    expect(unwrap(parseTopContainers({ value: "30" }))).toBe(30);
  });

  it("takes zero, which names no container individually", () => {
    expect(unwrap(parseTopContainers({ value: "0" }))).toBe(0);
  });

  it("rejects a negative count with a message naming what it got", () => {
    const parsed = parseTopContainers({ value: "-1" });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("-1");
  });

  it("rejects a value that is not a whole number", () => {
    expect(unwrapErr(parseTopContainers({ value: "2.5" }))).toEqual([
      "--top must be a non-negative whole number, got 2.5",
    ]);
  });
});

describe("the flag surface", () => {
  it("advertises exactly the flags it parses", () => {
    expect(DEV_SLICE_SHAPE_FLAG_NAMES).toStrictEqual(["--corpus", "--home", "--json", "--top"]);
  });

  it("accepts every advertised flag through the real parser", () => {
    const parsed = parseDevSliceShapeArgs({ rest: ["--home", "/h", "--corpus", "/c", "--top", "5", "--json"] });
    expect(unwrap(parsed).values["top"]).toBe("5");
    expect(unwrap(parsed).values["json"]).toBe(true);
  });

  it("refuses a flag it does not have", () => {
    expect(unwrapErr(parseDevSliceShapeArgs({ rest: ["--nope"] }))).toEqual(["unknown flag: --nope"]);
  });
});

describe("humanBytes", () => {
  it("reads gigabytes at one decimal", () => {
    expect(humanBytes({ bytes: 8_600_000_000 })).toBe("8.6 GB");
  });

  it("reads megabytes at one decimal", () => {
    expect(humanBytes({ bytes: 77_300_000 })).toBe("77.3 MB");
  });

  it("reads kilobytes at one decimal", () => {
    expect(humanBytes({ bytes: 3_300 })).toBe("3.3 KB");
  });

  it("reads a small count as plain bytes", () => {
    expect(humanBytes({ bytes: 512 })).toBe("512 B");
  });

  it("reads zero as plain bytes", () => {
    expect(humanBytes({ bytes: 0 })).toBe("0 B");
  });
});

describe("percent and count", () => {
  it("renders a share at one decimal", () => {
    expect(percent({ share: 0.452 })).toBe("45.2%");
  });

  it("renders a whole share", () => {
    expect(percent({ share: 1 })).toBe("100.0%");
  });

  it("separates thousands", () => {
    expect(count({ value: 2_215_909 })).toBe("2,215,909");
  });

  it("rounds a prorated count before separating it", () => {
    expect(count({ value: 17_591.6 })).toBe("17,592");
  });
});

describe("renderSliceShape", () => {
  it("leads with the totals the pass actually read", () => {
    expect(renderSliceShape({ shape: sampleShape() })[0]).toBe("slice-shape: 4 records, 1.0 KB on disk");
  });

  it("names all four shapes, in the order they are priced", () => {
    const headings = renderSliceShape({ shape: sampleShape() }).filter((line) => line.startsWith("SHAPE "));
    expect(headings).toStrictEqual([
      "SHAPE 1 · window — slopweaver subset build --days N",
      "SHAPE 2 · cap — slopweaver subset build --limit N (newest N per source)",
      "SHAPE 3 · sample — whole Slack threads, no verb today",
      "SHAPE 4 · channels — a container allowlist, no verb today",
    ]);
  });

  it("prices a container cut both ways on one line", () => {
    const line = renderSliceShape({ shape: sampleShape() }).find((entry) => entry.trimStart().startsWith("top  1"))!;
    // slack/A holds 2 of 4 records and 300 of 1000 bytes; dropping it leaves the other two records.
    expect(line).toContain("keep         2 rec  50.0% /     300 B  30.0%");
    expect(line).toContain("drop →         2 rec  50.0% /     700 B  70.0%");
  });

  it("folds every container past --top into one tail row", () => {
    const line = renderSliceShape({ shape: sampleShape() }).find((entry) => entry.includes("…the rest"))!;
    expect(line).toContain("1 rec  25.0%");
  });

  it("renders the month histogram oldest first", () => {
    const months = renderSliceShape({ shape: sampleShape() })
      .filter((line) => /^ {2}\d{4}-\d{2} {2}/.test(line))
      .map((line) => line.trim().slice(0, 7));
    expect(months).toStrictEqual(["2026-07", "2026-08", "2026-09"]);
  });
});
