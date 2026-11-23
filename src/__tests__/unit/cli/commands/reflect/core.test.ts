/**
 * The pure core of `slopweaver reflect telemetry`: flag parsing, the per-tool tally, and the rendering
 * that carries the residue into the terminal. No clock, no network, no fs.
 */
import { describe, expect, it } from "vitest";

import {
  isMeasurement,
  parseReflectTelemetryOptions,
  REFLECT_TELEMETRY_DEFAULT_LIMIT,
  renderReading,
  TELEMETRY_DEFAULT_FROM,
  tallyByTool,
} from "../../../../../cli/commands/reflect/core.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { ToolExecutionError, ToolExecutionErrorReading } from "../../../../../reflect/telemetry.js";

/** One projected failure, with only the fields the tally and the rendering read varying. */
function failure({ toolName }: { toolName: string }): ToolExecutionError {
  return {
    durationMs: 58,
    errorType: "ShellError",
    message: "Shell command failed",
    toolName,
    toolUseId: `toolu_${toolName}`,
    traceId: "42e1b0e9f23a61272429ab34e64ca3ef",
    tsIso: "2026-08-27T19:42:06.712Z",
  };
}

const READING: ToolExecutionErrorReading = {
  coverage: "live",
  errors: [failure({ toolName: "Bash" }), failure({ toolName: "Read" }), failure({ toolName: "Bash" })],
  fromMs: 1_787_774_555_383,
  pagesRead: 2,
  query: "service:claude-code @event.name:tool_result @success:false",
  residue: ["the window is entirely inside the 15-15d log retention", "no prompt text"],
  toMs: 1_787_860_955_383,
  truncated: false,
  unreadableEvents: 0,
};

describe("parseReflectTelemetryOptions", () => {
  it("defaults the window to the loop's own cadence and the cap to the verb's", () => {
    const options = unwrap(parseReflectTelemetryOptions({ defaultLimit: REFLECT_TELEMETRY_DEFAULT_LIMIT, rest: [] }));
    expect(options.from).toBe(TELEMETRY_DEFAULT_FROM);
    expect(options.to).toBe("now");
    expect(options.limit).toBe(REFLECT_TELEMETRY_DEFAULT_LIMIT);
    expect(options.json).toBe(false);
  });

  it("takes every flag it accepts", () => {
    const options = unwrap(
      parseReflectTelemetryOptions({
        defaultLimit: REFLECT_TELEMETRY_DEFAULT_LIMIT,
        rest: ["--from", "7d", "--to", "1d", "--limit", "25", "--json"],
      }),
    );
    expect(options.from).toBe("7d");
    expect(options.to).toBe("1d");
    expect(options.limit).toBe(25);
    expect(options.json).toBe(true);
  });

  it("refuses a --limit that is not a positive integer", () => {
    const parsed = parseReflectTelemetryOptions({ defaultLimit: 500, rest: ["--limit", "-3"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" | ")).toContain("--limit");
  });

  it("refuses a flag it does not know", () => {
    expect(unwrapErr(parseReflectTelemetryOptions({ defaultLimit: 500, rest: ["--since", "1d"] }))).toEqual([
      "unknown flag: --since",
      "unexpected argument: 1d",
    ]);
  });
});

describe("tallyByTool", () => {
  it("counts each tool's failures, most-failed first", () => {
    expect(tallyByTool({ reading: READING })).toStrictEqual([
      { count: 2, toolName: "Bash" },
      { count: 1, toolName: "Read" },
    ]);
  });

  it("breaks a tie by name, so the same reading always renders the same way", () => {
    const reading = { ...READING, errors: [failure({ toolName: "Read" }), failure({ toolName: "Bash" })] };
    expect(tallyByTool({ reading }).map((row) => row.toolName)).toStrictEqual(["Bash", "Read"]);
  });

  it("tallies an empty reading to nothing", () => {
    expect(tallyByTool({ reading: { ...READING, errors: [] } })).toStrictEqual([]);
  });
});

describe("renderReading", () => {
  const lines = renderReading({ link: "https://example.invalid/logs", reading: READING });

  it("leads with the count and the coverage, so neither can be read without the other", () => {
    expect(lines[0]).toBe("reflect telemetry: 3 failed tool call(s), coverage live");
  });

  it("prints every residue line under a heading that says what they are", () => {
    expect(lines).toContain("  could NOT see:");
    expect(lines).toContain("    - the window is entirely inside the 15-15d log retention");
    expect(lines).toContain("    - no prompt text");
  });

  it("ends with the link that reproduces the claim", () => {
    expect(lines.at(-1)).toBe("  link: https://example.invalid/logs");
  });

  it("appends matched-but-unreadable events to the headline", () => {
    const reading = { ...READING, errors: [], unreadableEvents: 3 };
    expect(renderReading({ link: "https://example.invalid/logs", reading })[0]).toBe(
      "reflect telemetry: 0 failed tool call(s), coverage live, 3 matched but unreadable",
    );
  });
});

describe("isMeasurement", () => {
  it("believes a live window, an honest zero included", () => {
    expect(isMeasurement({ reading: READING })).toBe(true);
    expect(isMeasurement({ reading: { ...READING, errors: [] } })).toBe(true);
  });

  it("believes a partial window, because a floor is still a number", () => {
    expect(isMeasurement({ reading: { ...READING, coverage: "partial", errors: [] } })).toBe(true);
  });

  it("never believes an aged-out window, whose zero means the data is gone", () => {
    expect(isMeasurement({ reading: { ...READING, coverage: "aged-out", errors: [] } })).toBe(false);
  });

  it("believes an unknown horizon only when it found something", () => {
    expect(isMeasurement({ reading: { ...READING, coverage: "unknown" } })).toBe(true);
    expect(isMeasurement({ reading: { ...READING, coverage: "unknown", errors: [] } })).toBe(false);
  });

  it("does not believe an empty reading when matched events went unread", () => {
    expect(isMeasurement({ reading: { ...READING, errors: [], unreadableEvents: 932 } })).toBe(false);
  });

  it("still believes a non-empty reading while naming additional unreadable events", () => {
    expect(isMeasurement({ reading: { ...READING, unreadableEvents: 2 } })).toBe(true);
  });
});
