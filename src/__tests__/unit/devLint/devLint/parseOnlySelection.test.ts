import { describe, expect, it } from "vitest";
import { NO_FLAG_VALUE, parseOnlySelection } from "../../../../devLint/devLint.js";

describe("parseOnlySelection", () => {
  it("reads no selection when --only is absent, so the whole plan runs", () => {
    expect(parseOnlySelection({ rest: [] })).toEqual({ only: undefined, unknown: undefined });
  });

  it("reads one gate name", () => {
    expect(parseOnlySelection({ rest: ["--only", "jsdoc-tags"] })).toEqual({
      only: ["jsdoc-tags"],
      unknown: undefined,
    });
  });

  it("reads a comma-separated list, trimming the spaces a shell quote lets through", () => {
    expect(parseOnlySelection({ rest: ["--only", "jsdoc-tags, house-rules ,redos-check"] })).toEqual({
      only: ["jsdoc-tags", "house-rules", "redos-check"],
      unknown: undefined,
    });
  });

  it("reads --only alongside --lane, in either order", () => {
    expect(parseOnlySelection({ rest: ["--lane", "local", "--only", "prettier"] })).toEqual({
      only: ["prettier"],
      unknown: undefined,
    });
    expect(parseOnlySelection({ rest: ["--only", "prettier", "--lane", "local"] })).toEqual({
      only: ["prettier"],
      unknown: undefined,
    });
  });

  it("reports a named placeholder when --only ends the tail with no value", () => {
    expect(parseOnlySelection({ rest: ["--only"] })).toEqual({ only: undefined, unknown: NO_FLAG_VALUE });
  });

  it("reports a named placeholder when --only names nothing but separators", () => {
    expect(parseOnlySelection({ rest: ["--only", " , "] })).toEqual({ only: undefined, unknown: NO_FLAG_VALUE });
  });
});
