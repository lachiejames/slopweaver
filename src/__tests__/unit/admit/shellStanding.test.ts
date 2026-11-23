import { describe, expect, it } from "vitest";

import { distinct, firstOrElse, joinVisited, listEnd, mayNotMove, nextCdPaths } from "../../../admit/shellStanding.js";

describe("mayNotMove", () => {
  it.each([
    ["&&", true],
    ["||", true],
    ["|", true],
    [";", false],
    [undefined, false],
  ] as const)("reads a cd after %s as one that may not move: %s", (before, expected) => {
    expect(mayNotMove({ before })).toBe(expected);
  });
});

describe("distinct", () => {
  it("keeps each directory once, in first-seen order, an unresolved one included", () => {
    expect(distinct({ cwds: ["/a", undefined, "/b", "/a", undefined] })).toEqual(["/a", undefined, "/b"]);
  });
});

describe("firstOrElse", () => {
  it("keeps where an earlier cd of the chain already leaves the shell", () => {
    expect(firstOrElse({ orElse: ["/first"], steps: [{ orElse: "/second" }] })).toEqual(["/first"]);
  });

  it("takes every place this cd names when none is held yet, dropping a step that names none", () => {
    expect(firstOrElse({ orElse: [], steps: [{ orElse: "/a" }, { orElse: undefined }, { orElse: "/b" }] })).toEqual([
      "/a",
      "/b",
    ]);
  });
});

describe("joinVisited", () => {
  it("adds each resolved directory not already held, in first-seen order", () => {
    expect(joinVisited({ dirs: ["/b", undefined, "/a", "/c", "/b"], visited: ["/a"] })).toEqual(["/a", "/b", "/c"]);
  });

  it("returns what was visited when nothing new is named", () => {
    expect(joinVisited({ dirs: [], visited: ["/a"] })).toEqual(["/a"]);
  });
});

describe("nextCdPaths", () => {
  it("drops the CDPATH before an assignment that always runs", () => {
    expect(nextCdPaths({ before: ";", cdPaths: [{ after: "/new" }], now: ["/old"], separatorAfter: ";" })).toEqual([
      "/new",
    ]);
  });

  it.each([
    ["after && it may be skipped", "&&", ";"],
    ["before | it runs in a subshell", ";", "|"],
  ] as const)("keeps the CDPATH before an assignment that %s", (_label, before, separatorAfter) => {
    expect(nextCdPaths({ before, cdPaths: [{ after: "/new" }], now: ["/old"], separatorAfter })).toEqual([
      "/new",
      "/old",
    ]);
  });
});

describe("listEnd", () => {
  it("carries every set unchanged across an && inside a list", () => {
    expect(listEnd({ cwds: ["/a"], orElse: [], separator: "&&", skipped: ["/s"] })).toEqual({
      cwds: ["/a"],
      orElse: [],
      skipped: ["/s"],
    });
  });

  it("joins a skipped cd's directory back in when the list ends", () => {
    expect(listEnd({ cwds: ["/a"], orElse: [], separator: ";", skipped: ["/s", "/a"] })).toEqual({
      cwds: ["/a", "/s"],
      orElse: [],
      skipped: [],
    });
  });

  it("stands the shell where a cd || alternative leaves it once the alternative is done", () => {
    expect(listEnd({ cwds: ["/tmp"], orElse: ["/calls"], separator: "&&", skipped: [] })).toEqual({
      cwds: ["/calls"],
      orElse: [],
      skipped: [],
    });
  });

  it("keeps the alternative pending across a further || alternative", () => {
    expect(listEnd({ cwds: ["/tmp"], orElse: ["/calls"], separator: "||", skipped: [] })).toEqual({
      cwds: ["/tmp"],
      orElse: ["/calls"],
      skipped: [],
    });
  });
});
