/*
 * `parseBaselineJson`: the committed floor decodes at version 1 or 2, and a malformed one is refused.
 */
import { describe, expect, it } from "vitest";

import { parseBaselineJson } from "../../../../devLint/coverageFloor.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("parseBaselineJson", () => {
  it("decodes a version-2 baseline with directory floors", () => {
    const result = parseBaselineJson({
      text: JSON.stringify({
        directories: { "src/cli": { statements: 56.81 } },
        summary: { branches: 80, functions: 85, lines: 85, statements: 85 },
        version: 2,
      }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      directories: { "src/cli": { statements: 56.81 } },
      summary: { branches: 80, functions: 85, lines: 85, statements: 85 },
      version: 2,
    });
  });

  it("decodes a version-1 baseline with no directories block as having no directory floors", () => {
    // The base commit's file predates the per-directory floor; the measured half then refuses every large
    // directory as unfloored, so the absent block is loud rather than a bypass.
    const result = parseBaselineJson({
      text: JSON.stringify({ summary: { branches: 80, functions: 85, lines: 85, statements: 85 }, version: 1 }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).directories).toEqual({});
  });

  it("errors on an unexpected shape", () => {
    const result = parseBaselineJson({ text: JSON.stringify({ version: 1 }) });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe(
      "coverage baseline: unexpected shape (expected version + summary.{branches,functions,lines,statements} + directories.<dir>.statements)",
    );
  });

  it("errors on a directory floor without a statements number", () => {
    const result = parseBaselineJson({
      text: JSON.stringify({
        directories: { "src/cli": { lines: 1 } },
        summary: { branches: 80, functions: 85, lines: 85, statements: 85 },
        version: 2,
      }),
    });
    expect(unwrapErr(result).code).toBe("FLOOR_MALFORMED");
    expect(unwrapErr(result).message).toBe(
      "coverage baseline: unexpected shape (expected version + summary.{branches,functions,lines,statements} + directories.<dir>.statements)",
    );
  });
});
