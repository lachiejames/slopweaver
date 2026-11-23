import { describe, expect, it } from "vitest";

import { cdPathTarget, prefixCdPath, statementCdPath } from "../../../admit/cdPath.js";

/** Read an entry as written, stripping one double-quote pair, and `undefined` for anything naming a variable. */
const read: (entry: string) => string | undefined = (entry) => {
  const text = entry.replace(/^"(.*)"$/u, "$1");
  return text.includes("$") ? undefined : text;
};

/** Where `cd target` lands from `/w` under `cdPath`, with only `dirs` existing. */
function lands({
  cdPath,
  target,
  dirs,
}: {
  cdPath: string;
  target: string;
  dirs: readonly string[];
}): string | undefined {
  return cdPathTarget({ cdPath, cwd: "/w", exists: (path) => dirs.includes(path), read, target });
}

describe("statementCdPath", () => {
  it.each([
    { tokens: ["CDPATH=/a"], value: "/a" },
    { tokens: ["X=1", "CDPATH=/a"], value: "/a" },
    { tokens: ["export", "CDPATH=/a:/b"], value: "/a:/b" },
    { tokens: ["unset", "CDPATH"], value: "" },
    { tokens: ["CDPATH=/a", "cd", "x"], value: undefined },
    { tokens: ["export", "PATH=/a"], value: undefined },
    { tokens: ["cd", "x"], value: undefined },
  ])("$tokens leaves CDPATH $value", ({ tokens, value }) => {
    expect(statementCdPath({ tokens })).toBe(value);
  });
});

describe("prefixCdPath", () => {
  it.each([
    { tokens: ["CDPATH=/a", "cd", "x"], value: "/a" },
    { tokens: ["X=1", "CDPATH=/a", "cd", "x"], value: "/a" },
    { tokens: ["cd", "CDPATH=/a"], value: undefined },
    { tokens: ["cd", "x"], value: undefined },
  ])("$tokens gives its cd $value", ({ tokens, value }) => {
    expect(prefixCdPath({ tokens })).toBe(value);
  });
});

describe("cdPathTarget", () => {
  it.each([
    { cdPath: "", dirs: ["/a/x"], label: "no CDPATH", target: "x", where: "/w/x" },
    { cdPath: "/a", dirs: ["/a/x"], label: "the entry holding it", target: "x", where: "/a/x" },
    { cdPath: "/n:/a", dirs: ["/a/x"], label: "a later entry past a miss", target: "x", where: "/a/x" },
    { cdPath: ":/a", dirs: ["/w/x", "/a/x"], label: "an empty entry, the cwd", target: "x", where: "/w/x" },
    { cdPath: '"/n:/a"', dirs: ["/a/x"], label: "a quoted list", target: "x", where: "/a/x" },
    { cdPath: "/a", dirs: [], label: "the cwd when no entry holds it", target: "x", where: "/w/x" },
    { cdPath: "/a", dirs: ["/a/x"], label: "an absolute target", target: "/x", where: "/x" },
    { cdPath: "/a", dirs: ["/a/x"], label: "a ./ target", target: "./x", where: "/w/x" },
    { cdPath: "/a", dirs: ["/a/.."], label: "a .. target", target: "..", where: "/" },
    { cdPath: "/a", dirs: ["/a/.x"], label: "a hidden name, which does consult it", target: ".x", where: "/a/.x" },
    { cdPath: "$V:/a", dirs: ["/a/x"], label: "nothing when an entry is unknowable", target: "x", where: undefined },
  ])("lands on $label", ({ cdPath, dirs, target, where }) => {
    expect(lands({ cdPath, dirs, target })).toBe(where);
  });
});
