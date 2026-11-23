import { describe, expect, it } from "vitest";
import { changedFilesOf, comparedFilesOf } from "../../../../../cli/commands/github/prChangedFiles.js";

describe("changedFilesOf", () => {
  it("reads each entry's path and line counts, carrying a rename's base-side path", () => {
    const response = {
      data: [
        { additions: 1, deletions: 0, filename: ".github/CODEOWNERS" },
        { additions: 3, deletions: 2, filename: "monitors/new.tf", previous_filename: "monitors/old.tf" },
      ],
    };
    expect(changedFilesOf({ response })).toEqual([
      { additions: 1, deletions: 0, path: ".github/CODEOWNERS" },
      { additions: 3, deletions: 2, path: "monitors/new.tf", previousPath: "monitors/old.tf" },
    ]);
  });

  it("refuses the whole page when one entry is missing a line count", () => {
    const response = {
      data: [
        { additions: 1, deletions: 0, filename: "a.ts" },
        { additions: 1, filename: "b.ts" },
      ],
    };
    expect(changedFilesOf({ response })).toBeUndefined();
  });

  it("refuses an empty path, a negative count and an unreadable base-side path", () => {
    expect(changedFilesOf({ response: { data: [{ additions: 0, deletions: 0, filename: "" }] } })).toBeUndefined();
    expect(changedFilesOf({ response: { data: [{ additions: -1, deletions: 0, filename: "a" }] } })).toBeUndefined();
    const renamed = { additions: 0, deletions: 0, filename: "a", previous_filename: "" };
    expect(changedFilesOf({ response: { data: [renamed] } })).toBeUndefined();
  });

  it("answers an empty list for an empty page, and undefined for a response that is not a list", () => {
    expect(changedFilesOf({ response: { data: [] } })).toEqual([]);
    expect(changedFilesOf({ response: { data: {} } })).toBeUndefined();
  });
});

describe("comparedFilesOf", () => {
  it("reads the compare response's files the same way", () => {
    const response = { data: { files: [{ additions: 4, deletions: 1, filename: "x.ts" }] } };
    expect(comparedFilesOf({ response })).toEqual([{ additions: 4, deletions: 1, path: "x.ts" }]);
  });

  it("answers undefined when the compare response carries no file list", () => {
    expect(comparedFilesOf({ response: { data: {} } })).toBeUndefined();
  });
});
