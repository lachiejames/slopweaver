/**
 * `--read-through` is validated as a Slack timestamp before any read or reviewer boot: absent is fine, a real
 * timestamp passes through untouched, and anything else is the typed refusal rather than a silent drop.
 */
import { describe, expect, it } from "vitest";

import { readThroughTs } from "../../../../../cli/commands/turn/threadFreshnessArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("readThroughTs", () => {
  it("answers undefined when the caller named no --read-through", () => {
    const result = readThroughTs({ values: {} });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBeUndefined();
  });

  it("passes a well-formed Slack timestamp through unchanged", () => {
    const result = readThroughTs({ values: { "read-through": "1730000000.123456" } });
    expect(unwrap(result)).toBe("1730000000.123456");
  });

  it("refuses a malformed value with the boundary error naming it", () => {
    const result = readThroughTs({ values: { "read-through": "yesterday" } });
    expect(unwrapErr(result).code).toBe("BOUNDARY_NOT_A_TIMESTAMP");
    expect(unwrapErr(result).message).toBe("--read-through is not a Slack message timestamp: yesterday");
  });
});
