/*
 * The pure readers of git's filter listings, pinned against literal listings: which drivers carry a command, which
 * filter records name a driver, and which asked paths are attributed.
 */
import { describe, expect, it } from "vitest";

import { commandDrivers, filterAttributed, filterDriversIn } from "../../../../worktree/pruneFilterListing.js";

describe("commandDrivers", () => {
  it("names each driver with a clean or a process command, keeping its case and any dot in it", () => {
    const listing = "core.bare\nfalse\0filter.lfs.process\ngit-lfs filter-process\0filter.My.Drop.clean\ncat\0";

    expect([...commandDrivers({ listing })]).toEqual(["lfs", "My.Drop"]);
  });

  it("ignores a smudge command and every other key, which a status read never runs", () => {
    expect(commandDrivers({ listing: "filter.lfs.smudge\ngit-lfs smudge\0filter.lfs.required\0" }).size).toBe(0);
    expect(commandDrivers({ listing: "" }).size).toBe(0);
  });
});

describe("filterDriversIn", () => {
  it("collects every filter record's value, set and unset kept as names", () => {
    const listing = "a\0filter\0lfs\0b\0text\0set\0c\0filter\0unset\0d\0filter\0lfs\0";

    expect([...filterDriversIn({ listing })]).toEqual(["lfs", "unset"]);
  });
});

describe("filterAttributed", () => {
  it("counts every path --all lists a filter record for, a driver NAMED unspecified or unset included", () => {
    const listing = "a\0filter\0unspecified\0b\0text\0set\0c\0filter\0unset\0d\0filter\0lfs\0";

    expect(filterAttributed({ asked: ["a", "b", "c", "d", "e"], listing })).toEqual(["a", "c", "d"]);
  });

  it("is empty when no path carries any attribute", () => {
    expect(filterAttributed({ asked: ["a", "b"], listing: "" })).toEqual([]);
  });

  it("is null when git names a path nobody asked about, as a trimmed first name would be", () => {
    expect(filterAttributed({ asked: [" lead"], listing: "lead\0filter\0lfs\0" })).toBe(null);
  });

  it("is null when the output is not whole records", () => {
    expect(filterAttributed({ asked: ["a"], listing: "a\0filter\0" })).toBe(null);
  });
});
