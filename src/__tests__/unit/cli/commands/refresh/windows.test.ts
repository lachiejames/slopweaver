/**
 * Unit: `refresh`'s window planner. Split out of `core.test.ts` alongside the source split, so the tests
 * mirror the tree the unit lane selects by directory.
 */
import { describe, expect, it } from "vitest";
import {
  buildRefreshWindows,
  explicitWindowOverride,
  refreshWindowLogLine,
} from "../../../../../cli/commands/refresh/windows.js";

describe("buildRefreshWindows", () => {
  const readNone = (): undefined => undefined;

  it("uses the GitHub 7-day default and non-GitHub 90-day default", () => {
    const windows = buildRefreshWindows({
      all: false,
      home: "/h",
      lookbackDays: undefined,
      readWatermark: readNone,
      sinceFlag: undefined,
      sources: ["github", "slack"],
      today: "2026-07-19",
      until: "2026-07-20",
    });
    expect(windows[0]).toEqual({
      cursorOverridden: false,
      source: "github",
      window: { since: "2026-07-13", until: "2026-07-20" },
    });
    expect(windows[1]).toEqual({
      cursorOverridden: false,
      source: "slack",
      window: { since: "2026-04-21", until: "2026-07-20" },
    });
  });

  it("uses the epoch since for --all", () => {
    const windows = buildRefreshWindows({
      all: true,
      home: "/h",
      lookbackDays: undefined,
      readWatermark: readNone,
      sinceFlag: undefined,
      sources: ["github"],
      today: "2026-07-19",
      until: "2026-07-20",
    });
    expect(windows[0]!.window.since).toBe("1970-01-01");
  });

  it("lets an explicit --since win over the watermark", () => {
    const windows = buildRefreshWindows({
      all: false,
      home: "/h",
      lookbackDays: undefined,
      readWatermark: () => "2020-01-01T00:00:00Z",
      sinceFlag: "2026-06-01",
      sources: ["github"],
      today: "2026-07-19",
      until: "2026-07-20",
    });
    expect(windows[0]!.window.since).toBe("2026-06-01");
  });

  it("uses the watermark cursor when there is no --since", () => {
    const windows = buildRefreshWindows({
      all: false,
      home: "/h",
      lookbackDays: undefined,
      readWatermark: () => "2026-05-05T12:00:00Z",
      sinceFlag: undefined,
      sources: ["github"],
      today: "2026-07-19",
      until: "2026-07-20",
    });
    expect(windows[0]!.window.since).toBe("2026-05-05");
  });

  // The repair half of a two-sided shape, in the exact shape measured on the operator's home:
  // the fathom cursor held a date a day ahead of the clock's, so `since === until` and the
  // provider filter collapsed to `created_after == created_before`. `since !== until` IS the defect's
  // signature, so it is asserted alongside the exact value.
  it("caps a stored cursor at today, so a cursor banked from until cannot plan an EMPTY window", () => {
    const windows = buildRefreshWindows({
      all: false,
      home: "/h",
      lookbackDays: undefined,
      readWatermark: () => "2026-09-18",
      sinceFlag: undefined,
      sources: ["fathom"],
      today: "2026-09-17",
      until: "2026-09-18",
    });
    expect(windows[0]!.window.since).toBe("2026-09-17");
    expect(windows[0]!.window.since).not.toBe(windows[0]!.window.until);
  });

  it("leaves a stored cursor behind today alone — the cap is a ceiling, not a rewrite", () => {
    const windows = buildRefreshWindows({
      all: false,
      home: "/h",
      lookbackDays: undefined,
      readWatermark: () => "2026-09-16T08:00:00Z",
      sinceFlag: undefined,
      sources: ["fathom"],
      today: "2026-09-17",
      until: "2026-09-18",
    });
    expect(windows[0]!.window.since).toBe("2026-09-16");
  });

  // Deliberate asymmetry: an explicit --since into the future is the caller asking about the future, and
  // rewriting it would recreate the PR5.4 defect of reporting one window and fetching another.
  it("does NOT cap an explicit --since ahead of today", () => {
    const windows = buildRefreshWindows({
      all: false,
      home: "/h",
      lookbackDays: undefined,
      readWatermark: () => "2026-09-18",
      sinceFlag: "2027-01-01",
      sources: ["fathom"],
      today: "2026-09-17",
      until: "2026-09-18",
    });
    expect(windows[0]!.window.since).toBe("2027-01-01");
  });

  // The combination table that did NOT exist before PR5.4. Every widening flag was silently discarded
  // whenever a cursor was stored, because no case here crossed `cursor present` with `--all` /
  // `--lookback-days`. Each row asserts the EXACT resolved `since`, so a regression cannot pass.
  const CURSOR = "2026-07-18T09:00:00Z";
  const WIDENING_TABLE: readonly {
    readonly name: string;
    readonly cursor: string | undefined;
    readonly all: boolean;
    readonly lookbackDays: number | undefined;
    readonly sinceFlag: string | undefined;
    readonly since: string;
    readonly overridden: boolean;
  }[] = [
    {
      all: false,
      cursor: undefined,
      lookbackDays: undefined,
      name: "no cursor, no flags ⇒ 7-day default",
      overridden: false,
      since: "2026-07-13",
      sinceFlag: undefined,
    },
    {
      all: false,
      cursor: CURSOR,
      lookbackDays: undefined,
      name: "cursor, no flags ⇒ resume from cursor",
      overridden: false,
      since: "2026-07-18",
      sinceFlag: undefined,
    },
    {
      all: true,
      cursor: undefined,
      lookbackDays: undefined,
      name: "no cursor, --all ⇒ epoch",
      overridden: true,
      since: "1970-01-01",
      sinceFlag: undefined,
    },
    {
      all: true,
      cursor: CURSOR,
      lookbackDays: undefined,
      name: "cursor, --all ⇒ epoch WINS (was: cursor)",
      overridden: true,
      since: "1970-01-01",
      sinceFlag: undefined,
    },
    {
      all: false,
      cursor: CURSOR,
      lookbackDays: 90,
      name: "cursor, --lookback-days ⇒ lookback WINS (was: cursor)",
      overridden: true,
      since: "2026-04-21",
      sinceFlag: undefined,
    },
    {
      all: false,
      cursor: undefined,
      lookbackDays: 90,
      name: "no cursor, --lookback-days ⇒ lookback",
      overridden: true,
      since: "2026-04-21",
      sinceFlag: undefined,
    },
    {
      all: false,
      cursor: CURSOR,
      lookbackDays: undefined,
      name: "cursor, --since ⇒ since wins",
      overridden: true,
      since: "2026-04-01",
      sinceFlag: "2026-04-01",
    },
    {
      all: true,
      cursor: CURSOR,
      lookbackDays: 30,
      name: "--since beats --all and --lookback-days together",
      overridden: true,
      since: "2026-04-01",
      sinceFlag: "2026-04-01",
    },
  ];

  it.each(WIDENING_TABLE)("$name", ({ cursor, all, lookbackDays, sinceFlag, since, overridden }) => {
    const windows = buildRefreshWindows({
      all,
      home: "/h",
      lookbackDays,
      readWatermark: () => cursor,
      sinceFlag,
      sources: ["github"],
      today: "2026-07-19",
      until: "2026-07-20",
    });
    expect(windows[0]!.window.since).toBe(since);
    expect(windows[0]!.cursorOverridden).toBe(overridden);
  });

  it("overrides the cursor for EVERY selected source, not just github", () => {
    const windows = buildRefreshWindows({
      all: false,
      home: "/h",
      lookbackDays: undefined,
      readWatermark: () => CURSOR,
      sinceFlag: "2026-01-01",
      sources: ["github", "slack", "linear", "notion"],
      today: "2026-07-19",
      until: "2026-07-20",
    });
    expect(windows.map((w) => w.window.since)).toEqual(["2026-01-01", "2026-01-01", "2026-01-01", "2026-01-01"]);
    expect(windows.every((w) => w.cursorOverridden)).toBe(true);
  });
});

describe("explicitWindowOverride", () => {
  it("is true for any widening flag and false for a bare incremental run", () => {
    expect(explicitWindowOverride({ all: false, lookbackDays: undefined, sinceFlag: undefined })).toBe(false);
    expect(explicitWindowOverride({ all: true, lookbackDays: undefined, sinceFlag: undefined })).toBe(true);
    expect(explicitWindowOverride({ all: false, lookbackDays: 90, sinceFlag: undefined })).toBe(true);
    expect(explicitWindowOverride({ all: false, lookbackDays: undefined, sinceFlag: "2026-01-01" })).toBe(true);
  });
});

describe("refreshWindowLogLine", () => {
  it("clamps the shown end back to today (never the future)", () => {
    const line = refreshWindowLogLine({
      source: "github",
      today: "2026-07-19",
      window: { since: "2026-07-12", until: "2026-07-20" },
    });
    expect(line).toBe("refresh github · window 2026-07-12..2026-07-19");
  });

  it("shows the window end when it precedes today", () => {
    const line = refreshWindowLogLine({
      source: "slack",
      today: "2026-07-19",
      window: { since: "2026-01-01", until: "2026-05-01" },
    });
    expect(line).toBe("refresh slack · window 2026-01-01..2026-05-01");
  });
});

describe("buildRefreshWindows (PR4.2 org mode)", () => {
  it("IGNORES the per-source github watermark in org mode (per-repo watermark governs; base = lookback)", () => {
    const windows = buildRefreshWindows({
      all: false,
      home: "/tmp/x",
      lookbackDays: undefined,
      orgMode: true,
      readWatermark: () => "2026-07-20T00:00:00.000Z",
      sinceFlag: undefined,
      sources: ["github"],
      today: "2026-07-23",
      until: "2026-07-24",
    });
    // The 7-day github lookback floor, NOT the recent source cursor.
    expect(windows[0]!.window.since).toBe("2026-07-17");
  });

  it("still uses the github watermark cursor in single-repo mode (unchanged)", () => {
    const windows = buildRefreshWindows({
      all: false,
      home: "/tmp/x",
      lookbackDays: undefined,
      orgMode: false,
      readWatermark: () => "2026-07-20T00:00:00.000Z",
      sinceFlag: undefined,
      sources: ["github"],
      today: "2026-07-23",
      until: "2026-07-24",
    });
    expect(windows[0]!.window.since).toBe("2026-07-20");
  });
});

describe("buildRefreshWindows (a cursorless snapshot source)", () => {
  it("plans chatgpt from the epoch and never reads a watermark, even a bogus one", () => {
    const asked: string[] = [];
    const windows = buildRefreshWindows({
      all: false,
      home: "/h",
      lookbackDays: undefined,
      readWatermark: ({ source }) => {
        asked.push(source);
        return "2026-07-01T00:00:00Z";
      },
      sinceFlag: undefined,
      sources: ["chatgpt", "slack"],
      today: "2026-07-19",
      until: "2026-07-20",
    });
    expect(windows.map((one) => [one.source, one.window.since, one.cursorOverridden])).toEqual([
      ["chatgpt", "1970-01-01", false],
      ["slack", "2026-07-01", false],
    ]);
    // Asked for slack's cursor, never chatgpt's.
    expect(asked).toEqual(["slack"]);
  });

  it("says a snapshot source has no cursor rather than printing an epoch window", () => {
    const line = refreshWindowLogLine({
      source: "chatgpt",
      today: "2026-07-19",
      window: { since: "1970-01-01", until: "2026-07-20" },
    });
    expect(line).toBe("refresh chatgpt · whole snapshot, no cursor");
  });
});
