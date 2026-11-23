/**
 * `parseAtlasFreshnessArgs` / `renderAtlasFreshness` / `atlasFreshnessJson` — what `atlas freshness` accepts
 * and what it says, with no home directory in sight.
 */
import { describe, expect, it } from "vitest";

import type { AtlasFreshnessVerdict } from "../../../../../atlas/kit/freshnessWindow.js";
import {
  ATLAS_FRESHNESS_FLAG_NAMES,
  ATLAS_FRESHNESS_USAGE,
  atlasFreshnessJson,
  parseAtlasFreshnessArgs,
  renderAtlasFreshness,
} from "../../../../../cli/commands/atlas/freshnessCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const HOUR_MS = 60 * 60 * 1000;

/** One verdict, overridable field by field. */
function verdict(over: Partial<AtlasFreshnessVerdict> = {}): AtlasFreshnessVerdict {
  return {
    action: "current",
    ageMs: HOUR_MS,
    behind: false,
    line: "atlas demo · current · generation is 1.0h old, inside 4h",
    platform: "demo",
    remedy: null,
    updatedAt: "2026-09-08T11:00:00.000Z",
    windowMs: 4 * HOUR_MS,
    ...over,
  };
}

describe("ATLAS_FRESHNESS_FLAG_NAMES", () => {
  it("names no flag the verb does not accept", () => {
    expect(ATLAS_FRESHNESS_FLAG_NAMES).toEqual(["--behind-only", "--home", "--json", "--window"]);
  });

  it("is named in full by the usage, so --help cannot advertise less than the parser takes", () => {
    expect(ATLAS_FRESHNESS_FLAG_NAMES.filter((flag) => !ATLAS_FRESHNESS_USAGE.includes(flag))).toEqual([]);
  });
});

describe("parseAtlasFreshnessArgs", () => {
  it("defaults to sweeping every atlas against its own window", () => {
    const options = unwrap(parseAtlasFreshnessArgs({ rest: [] }));
    expect(options.platform).toBeUndefined();
    expect(options.behindOnly).toBe(false);
    expect(options.windowMsOverride).toBeUndefined();
  });

  it("reads a bare positional as the platform", () => {
    expect(unwrap(parseAtlasFreshnessArgs({ rest: ["vanta"] })).platform).toBe("vanta");
  });

  it("parses a window override into milliseconds", () => {
    expect(unwrap(parseAtlasFreshnessArgs({ rest: ["--window", "30m"] })).windowMsOverride).toBe(30 * 60 * 1000);
  });

  it("refuses a bare number as a window rather than guessing its unit", () => {
    expect(unwrapErr(parseAtlasFreshnessArgs({ rest: ["--window", "4"] }))[0]).toContain("--window must be a duration");
  });

  it("refuses more than one platform", () => {
    expect(unwrapErr(parseAtlasFreshnessArgs({ rest: ["vanta", "slack"] }))[0]).toContain("name at most one platform");
  });
});

describe("renderAtlasFreshness", () => {
  it("prints every judged atlas, current ones included, then the summary", () => {
    const lines = renderAtlasFreshness({
      behindOnly: false,
      report: {
        nowIso: "2026-09-08T12:00:00.000Z",
        problems: [],
        verdicts: [verdict(), verdict({ behind: true, line: "atlas two · BEHIND · x", platform: "two" })],
      },
    });
    expect(lines).toEqual([
      "atlas demo · current · generation is 1.0h old, inside 4h",
      "atlas two · BEHIND · x",
      "atlas freshness · 1 of 2 behind — 0 answerable by a bounded live read, 1 needing a resync",
    ]);
  });

  it("says so out loud when nothing is behind", () => {
    const lines = renderAtlasFreshness({
      behindOnly: false,
      report: { nowIso: "2026-09-08T12:00:00.000Z", problems: [], verdicts: [verdict()] },
    });
    expect(lines.at(-1)).toBe("atlas freshness · every judged atlas is inside its window (1 judged)");
  });

  it("narrows the listing but never the summary under --behind-only", () => {
    const lines = renderAtlasFreshness({
      behindOnly: true,
      report: {
        nowIso: "2026-09-08T12:00:00.000Z",
        problems: [],
        verdicts: [
          verdict(),
          verdict({ action: "live-read", behind: true, line: "atlas two · BEHIND · x", platform: "two" }),
        ],
      },
    });
    expect(lines).toEqual([
      "atlas two · BEHIND · x",
      "atlas freshness · 1 of 2 behind — 1 answerable by a bounded live read, 0 needing a resync",
    ]);
  });

  it("prints a malformed window declaration ahead of the verdicts", () => {
    const lines = renderAtlasFreshness({
      behindOnly: false,
      report: { nowIso: "2026-09-08T12:00:00.000Z", problems: ["demo declares freshnessWindow `4`"], verdicts: [] },
    });
    expect(lines[0]).toBe("demo declares freshnessWindow `4`");
  });
});

describe("atlasFreshnessJson", () => {
  it("renders each window the way a caller would type it, and counts the behind ones", () => {
    const payload = atlasFreshnessJson({
      report: {
        nowIso: "2026-09-08T12:00:00.000Z",
        problems: [],
        verdicts: [
          verdict(),
          verdict({
            action: "resync",
            behind: true,
            platform: "two",
            remedy: "slopweaver atlas two sync",
            windowMs: 2 * 24 * HOUR_MS,
          }),
        ],
      },
    });
    expect(payload.judged).toBe(2);
    expect(payload.behind).toBe(1);
    expect(payload.atlases[0]!.window).toBe("4h");
    expect(payload.atlases[1]!.window).toBe("2d");
    expect(payload.atlases[1]!.remedy).toBe("slopweaver atlas two sync");
  });
});
