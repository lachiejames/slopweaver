import { describe, expect, it } from "vitest";
import { reachLabel, slackCoverageLines } from "../../../../../cli/commands/refresh/slackCoverage.js";
import type { ChannelReach } from "../../../../../corpus/slack/reach.js";

/** One reach row, defaults overridden per case — the same shape `classifyChannelReach` emits. */
function row(over: Partial<ChannelReach> = {}): ChannelReach {
  return { archived: false, backfilled: false, id: "C1", kind: "public", member: true, name: "alpha", ...over };
}

describe("reachLabel", () => {
  it("prefers the channel name", () => {
    expect(reachLabel({ row: row({ name: "dev" }) })).toBe("#dev");
  });

  it("falls back to the id for a DM, which has no name to print", () => {
    expect(reachLabel({ row: { archived: false, backfilled: false, id: "D1", kind: "dm", member: false } })).toBe("D1");
  });
});

describe("slackCoverageLines", () => {
  it("declares coverage complete only when every reachable conversation is backfilled", () => {
    const lines = slackCoverageLines({ rows: [row({ backfilled: true }), row({ backfilled: true, id: "C2" })] });
    expect(lines[0]).toBe("slack reach: 2 conversation(s) the read token can list, 2 backfilled, 0 never crawled");
    expect(lines.at(-1)).toBe("slack coverage: complete — every reachable conversation has been backfilled");
  });

  it("names each never-crawled conversation with why it stands out, and refuses to call coverage complete", () => {
    const lines = slackCoverageLines({
      rows: [
        row({ backfilled: true }),
        row({ id: "C2", member: false, name: "sales" }),
        row({ archived: true, id: "C3", member: false, name: "old-project" }),
      ],
    });
    expect(lines[0]).toBe("slack reach: 3 conversation(s) the read token can list, 1 backfilled, 2 never crawled");
    expect(lines).toContain("  #sales · public · not a member");
    expect(lines).toContain("  #old-project · public · archived · not a member");
    expect(lines.at(-1)).toBe(
      "slack coverage: INCOMPLETE — 2 reachable conversation(s) have never been crawled; " +
        "run `slopweaver refresh --source slack` to backfill them",
    );
  });

  it("counts the archived lane separately, since discovery used to exclude it outright", () => {
    const lines = slackCoverageLines({
      rows: [row({ archived: true, backfilled: true }), row({ archived: true, id: "C2" })],
    });
    expect(lines).toContain("  archived  1 of 2 archived conversation(s) never crawled");
  });

  it("tallies each kind, including one with nothing in it", () => {
    const lines = slackCoverageLines({ rows: [row({ backfilled: true }), row({ id: "D1", kind: "dm" })] });
    expect(lines).toContain("  public    1/1 backfilled");
    expect(lines).toContain("  group-dm  0/0 backfilled");
    expect(lines).toContain("  dm        0/1 backfilled");
  });

  it("summarises the tail rather than printing 300 names", () => {
    const rows = Array.from({ length: 45 }, (_, index) => row({ id: `C${String(index)}`, name: `c${String(index)}` }));
    const lines = slackCoverageLines({ rows });
    expect(lines).toContain("  … and 5 more");
    expect(lines.filter((line) => line.startsWith("  #c")).length).toBe(40);
  });
});
