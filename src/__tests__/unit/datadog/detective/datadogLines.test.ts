import { describe, expect, it } from "vitest";

import {
  collapseLine,
  datadogAroundModeOf,
  excerptAround,
  isDatadogSource,
  missingLines,
  scopeLine,
} from "../../../../cli/commands/store/datadogCore.js";
import { filterByRegex } from "../../../../cli/commands/store/datadogRun.js";
import { storeCommandErrorLines } from "../../../../cli/commands/store/errors.js";
import type { DatadogRecord } from "../../../../datadog/detective/record.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const WINDOW = { fromMs: 1_789_326_548_803, toMs: 1_789_330_148_803 };

/** One record, minimal but complete. */
function record({ text }: { text: string }): DatadogRecord {
  return {
    attributes: {},
    env: "production",
    family: "log",
    id: `dd:log:${text}`,
    link: "",
    occurredAtIso: "2026-09-13T20:09:04.503Z",
    service: "checkout-api",
    status: "info",
    text,
  };
}

describe("isDatadogSource", () => {
  it("routes on the exact source name", () => {
    expect(isDatadogSource({ source: "datadog" })).toBe(true);
  });

  it("does not route another source", () => {
    expect(isDatadogSource({ source: "slack" })).toBe(false);
  });

  it("does not route an absent source", () => {
    expect(isDatadogSource({ source: undefined })).toBe(false);
  });
});

describe("scopeLine — every Datadog report states its window", () => {
  it("says every environment when nothing narrowed it", () => {
    expect(scopeLine({ envs: [], window: WINDOW })).toContain("every environment");
  });

  it("names the environments when something did", () => {
    expect(scopeLine({ envs: ["staging"], window: WINDOW })).toContain("env staging");
  });
});

describe("collapseLine — reported only when a rung genuinely cuts", () => {
  it("says nothing when the rungs land within a factor of two, as they do on the message index", () => {
    const report = {
      elapsedMs: 1,
      envs: [],
      rungs: [
        { lines: 63_924, query: "k", rung: "term" as const },
        { lines: 67_137, query: "*:*k*", rung: "all-fields-wild" as const },
      ],
      term: "k",
      window: WINDOW,
    };
    expect(collapseLine({ report })).toEqual([]);
  });

  it("names the factor and the rung to read first when one does cut", () => {
    const report = {
      elapsedMs: 1,
      envs: [],
      rungs: [
        { lines: 527, query: "k", rung: "term" as const },
        { lines: 63_427, query: "*:*k*", rung: "all-fields-wild" as const },
      ],
      term: "k",
      window: WINDOW,
    };
    expect(collapseLine({ report })[0]).toContain("read term first");
  });

  it("says nothing when every rung found nothing", () => {
    const report = {
      elapsedMs: 1,
      envs: [],
      rungs: [{ lines: 0, query: "k", rung: "term" as const }],
      term: "k",
      window: WINDOW,
    };
    expect(collapseLine({ report })).toEqual([]);
  });
});

describe("missingLines — a cache miss is a permanent answer and has to say so", () => {
  it("says nothing when every id was found", () => {
    expect(missingLines({ missing: [] })).toEqual([]);
  });

  it("names the ids and why they cannot simply be re-fetched", () => {
    const lines = missingLines({ missing: ["dd:log:a"] });
    expect(lines[0]).toContain("dd:log:a");
    expect(lines[1]).toContain("no get-by-id route");
  });
});

describe("excerptAround", () => {
  it("centres the window on the match", () => {
    expect(excerptAround({ chars: 16, match: "needle", text: "aaaaaneedleaaaaa" })).toContain("needle");
  });

  it("falls back to the head when the match is absent", () => {
    expect(excerptAround({ chars: 5, match: "zzz", text: "abcdefgh" })).toBe("abcde");
  });

  it("falls back to the head when no match was asked for", () => {
    expect(excerptAround({ chars: 3, match: undefined, text: "abcdefgh" })).toBe("abc");
  });

  it("flattens newlines so one record is one line", () => {
    expect(excerptAround({ chars: 20, match: undefined, text: "a\nb" })).toBe("a b");
  });
});

describe("filterByRegex — Datadog has none, so it is applied HERE", () => {
  it("returns the page untouched when no pattern was given", () => {
    const page = [record({ text: "a" })];
    expect(unwrap(filterByRegex({ pattern: undefined, records: page }))).toEqual(page);
  });

  it("keeps only the matching records", () => {
    const page = [record({ text: "[job] ran" }), record({ text: "[web] served" })];
    expect(unwrap(filterByRegex({ pattern: "^\\[job\\]", records: page })).length).toBe(1);
  });

  it("matches case-insensitively", () => {
    const page = [record({ text: "KNOCK" })];
    expect(unwrap(filterByRegex({ pattern: "knock", records: page })).length).toBe(1);
  });

  it("refuses a pattern that is not a regular expression", () => {
    expect(storeCommandErrorLines({ error: unwrapErr(filterByRegex({ pattern: "([", records: [] })) })[0]).toContain(
      "not a regular expression",
    );
  });
});

describe("datadogAroundModeOf", () => {
  it("defaults to the trace", () => {
    expect(unwrap(datadogAroundModeOf({ values: {} }))).toBe("trace");
  });

  it("reads the IP correlation the owner asked for by name", () => {
    expect(unwrap(datadogAroundModeOf({ values: { mode: "ip" } }))).toBe("ip");
  });

  it("refuses a mode Datadog has no correlation for", () => {
    expect(
      storeCommandErrorLines({ error: unwrapErr(datadogAroundModeOf({ values: { mode: "container" } })) })[0],
    ).toContain("trace, request");
  });
});
