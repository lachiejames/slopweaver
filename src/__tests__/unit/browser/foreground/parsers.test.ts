/*
 * The parsers over what macOS and Chrome print: Chrome's window-id list, lsappinfo's bundle identifier in both
 * measured shapes, and one Chrome window id.
 */
import { describe, expect, it } from "vitest";

import { parseBundleId, parseChromeWindowId, parseChromeWindowIds } from "../../../../browser/foreground.js";

describe("parseChromeWindowIds", () => {
  it("reads Chrome's comma-separated list, front to back", () => {
    expect(parseChromeWindowIds({ output: "2109125765, 2109125256, 2109124910\n" })).toEqual([
      2109125765, 2109125256, 2109124910,
    ]);
  });

  it("reads a Chrome with no windows, or none running, as an empty list", () => {
    expect(parseChromeWindowIds({ output: "\n" })).toEqual([]);
  });

  it("refuses the whole list when any entry is not a window id", () => {
    expect(parseChromeWindowIds({ output: "2109125765, Fleet Briefing" })).toBe(null);
    expect(parseChromeWindowIds({ output: "2109125765,,2109125256" })).toBe(null);
  });
});

describe("parseBundleId", () => {
  it("reads the identifier out of lsappinfo's quoted line", () => {
    expect(parseBundleId({ output: '"CFBundleIdentifier"="com.google.Chrome"\n' })).toBe("com.google.Chrome");
  });

  it("reads the identifier out of Darwin 27's unquoted-key shape, exactly as measured", () => {
    const darwin27 = [
      "[ NULL ]  ASN:0x0-0x144144: (in front) ",
      '    bundleID="com.google.Chrome"',
      "    bundle path=[ NULL ] ",
      "    executable path=[ NULL ] ",
      " !cgsConnection !signalled type=[ NULL ]  flavor=[ NULL ]  Version=[ NULL ]  Arch=!!none",
      "",
    ].join("\n");
    expect(parseBundleId({ output: darwin27 })).toBe("com.google.Chrome");
  });

  it("answers null for an app with no bundle, and for nothing at all", () => {
    expect(parseBundleId({ output: "bundleID=[ NULL ]\n" })).toBe(null);
    expect(parseBundleId({ output: "" })).toBe(null);
  });
});

describe("parseChromeWindowId", () => {
  it("reads one whole integer", () => {
    expect(parseChromeWindowId({ output: "2109125256\n" })).toBe(2109125256);
  });

  it("refuses anything that is not exactly one non-negative integer", () => {
    expect(parseChromeWindowId({ output: "" })).toBe(null);
    expect(parseChromeWindowId({ output: "-1" })).toBe(null);
    expect(parseChromeWindowId({ output: "2109125256, Fleet Briefing" })).toBe(null);
    expect(parseChromeWindowId({ output: "99999999999999999999" })).toBe(null);
  });
});
