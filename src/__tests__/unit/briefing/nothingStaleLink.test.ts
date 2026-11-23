import { describe, expect, it } from "vitest";

import { linkRuns } from "../../../briefing/nothingStaleLink.js";

describe("linkRuns", () => {
  it("makes one link run of an address that parses", () => {
    expect(linkRuns({ text: "org/repo#1", url: "https://github.com/org/repo/pull/1" })).toStrictEqual([
      { kind: "link", text: "org/repo#1", url: "https://github.com/org/repo/pull/1" },
    ]);
  });

  it("shows an address that will not parse as text beside its name, never a link", () => {
    expect(linkRuns({ text: "org/repo#1", url: "not a url" })).toStrictEqual([
      { kind: "text", text: "org/repo#1 " },
      { kind: "code", text: "not a url" },
    ]);
  });

  it("treats an empty address as one that will not parse", () => {
    expect(linkRuns({ text: "a thread", url: "" })).toStrictEqual([
      { kind: "text", text: "a thread " },
      { kind: "code", text: "" },
    ]);
  });
});
