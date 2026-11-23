/**
 * The anchor spellings both location tables share: a fragment and a `state:`/`file:` scheme are dropped, any
 * other scheme cites no file, and every path spelling resolves to one path under the home or to none.
 */
import { describe, expect, it } from "vitest";

import { STATE_BRIEF_PREFIX } from "../../../../handover/briefPaths.js";
import { anchorToken, homeRelativeOfToken } from "../../../../store/fleet/homeAnchor.js";

const HOME = "/nonexistent-home/sw";

describe("anchorToken", () => {
  it("drops a fragment", () => {
    expect(anchorToken({ ref: "proof/1263/gold.md#card-7" })).toBe("proof/1263/gold.md");
  });

  it("drops a state: prefix and both file: spellings", () => {
    expect(anchorToken({ ref: `${STATE_BRIEF_PREFIX}proof/a.md` })).toBe("proof/a.md");
    expect(anchorToken({ ref: "file:///x/proof/a.md" })).toBe("/x/proof/a.md");
    expect(anchorToken({ ref: "file:/x/proof/a.md" })).toBe("/x/proof/a.md");
  });

  it("reads any other scheme as citing no file", () => {
    expect(anchorToken({ ref: "transcript:a0000036#7ca960f2" })).toBe(undefined);
  });
});

describe("homeRelativeOfToken", () => {
  it("reads both home prefixes and a path already under the home as one path", () => {
    expect(homeRelativeOfToken({ home: HOME, token: "~/.slopweaver/proof/a.md" })).toBe("proof/a.md");
    expect(homeRelativeOfToken({ home: HOME, token: "$SLOPWEAVER_HOME/proof/a.md" })).toBe("proof/a.md");
    expect(homeRelativeOfToken({ home: HOME, token: "proof/./a.md" })).toBe("proof/a.md");
  });

  it("reads an absolute path under the home as the path beneath it", () => {
    expect(homeRelativeOfToken({ home: HOME, token: `${HOME}/evidence/b.md` })).toBe("evidence/b.md");
  });

  it("refuses a path that leaves the home", () => {
    expect(homeRelativeOfToken({ home: HOME, token: "proof/../../etc/passwd" })).toBe(undefined);
    expect(homeRelativeOfToken({ home: HOME, token: "/nonexistent-elsewhere/proof/a.md" })).toBe(undefined);
  });
});
