/*
 * `parseAtlasReadArgs`: `--kind` split on commas, every optional absent by default, and a bad limit reported.
 */
import { describe, expect, it } from "vitest";

import { parseAtlasReadArgs } from "../../../../../../cli/commands/atlas/readArgs.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";

describe("parseAtlasReadArgs", () => {
  it("splits --kind on commas and drops the blanks a trailing comma leaves", () => {
    const parsed = unwrap(parseAtlasReadArgs({ rest: ["--kind", "zone, dns-record,"] }));
    expect(parsed.kinds).toEqual(["zone", "dns-record"]);
  });

  it("defaults every optional to undefined and the booleans to false", () => {
    const parsed = unwrap(parseAtlasReadArgs({ rest: [] }));
    expect(parsed.kinds).toEqual([]);
    expect(parsed.includeStale).toBe(false);
    expect(parsed.json).toBe(false);
    expect(parsed.limit).toBe(undefined);
    expect(parsed.query).toBe(undefined);
  });

  it("reports a bad limit rather than silently clamping it", () => {
    expect(unwrapErr(parseAtlasReadArgs({ rest: ["--limit", "9999"] }))).toEqual([
      "--limit must be a whole number from 1 to 1000, got: 9999",
    ]);
  });
});
