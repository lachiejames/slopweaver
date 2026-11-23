import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { buildRefreshCommands, DEFAULT_BACKFILL_DAYS, parseBackfillChoice } from "../../../onboard/plan.js";

describe("parseBackfillChoice", () => {
  it("parses a day count into a rolling window", () => {
    expect(unwrap(parseBackfillChoice({ value: "30" }))).toEqual({ days: 30, kind: "days" });
    expect(unwrap(parseBackfillChoice({ value: "180" }))).toEqual({ days: 180, kind: "days" });
  });

  it("parses the default 90-day depth", () => {
    expect(unwrap(parseBackfillChoice({ value: String(DEFAULT_BACKFILL_DAYS) }))).toEqual({ days: 90, kind: "days" });
  });

  it("parses `all` into a full-history backfill", () => {
    expect(unwrap(parseBackfillChoice({ value: "all" }))).toEqual({ kind: "all" });
  });

  it("parses a YYYY-MM-DD into an explicit since", () => {
    expect(unwrap(parseBackfillChoice({ value: "2026-04-01" }))).toEqual({ kind: "since", since: "2026-04-01" });
  });

  it("rejects a nonsense value", () => {
    expect(unwrapErr(parseBackfillChoice({ value: "lots" }))[0]).toContain("unrecognised backfill");
  });

  it("rejects an impossible date that only looks like YYYY-MM-DD", () => {
    expect(unwrapErr(parseBackfillChoice({ value: "2026-02-30" }))[0]).toContain("unrecognised backfill");
  });
});

describe("buildRefreshCommands", () => {
  it("builds one independently resumable command per source, in launch order", () => {
    expect(
      buildRefreshCommands({
        backfill: { days: 90, kind: "days" },
        org: "acme",
        repo: "acme/app",
        sources: ["github", "slack", "linear", "notion"],
      }),
    ).toEqual([
      {
        argv: [
          "refresh",
          "--source",
          "github",
          "--all-repos",
          "--repo",
          "acme/app",
          "--github-org",
          "acme",
          "--lookback-days",
          "90",
        ],
        source: "github",
      },
      { argv: ["refresh", "--source", "slack", "--lookback-days", "90"], source: "slack" },
      { argv: ["refresh", "--source", "linear", "--lookback-days", "90"], source: "linear" },
      { argv: ["refresh", "--source", "notion", "--lookback-days", "90"], source: "notion" },
    ]);
  });

  it("threads a full backfill to --all with its required explicit acknowledgement", () => {
    const [command] = buildRefreshCommands({
      backfill: { kind: "all" },
      org: "acme",
      repo: "acme/app",
      sources: ["slack"],
    });
    expect(command?.argv).toEqual(["refresh", "--source", "slack", "--all", "--accept-full-history"]);
  });

  it("threads an explicit since to --since YYYY-MM-DD", () => {
    const [command] = buildRefreshCommands({
      backfill: { kind: "since", since: "2026-04-01" },
      org: "acme",
      repo: "acme/app",
      sources: ["notion"],
    });
    expect(command?.argv.slice(-2)).toEqual(["--since", "2026-04-01"]);
  });
});
