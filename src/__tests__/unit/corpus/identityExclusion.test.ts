/**
 * The identity denylist — what it excludes, what it refuses, and the one thing it must never do.
 *
 * The case that matters most is "leaves both halves of a composite name alone". The list this mechanism was
 * built for holds `"Ada Owner, Tobias Wren"`, which is not a person, while `"Ada Owner"` and
 * `"Tobias Wren"` are real people standing in the very same roster. A substring match would remove all
 * three and say nothing — so that case feeds the excluded name IN and asserts both halves survive beside
 * its removal, which is the falsifiable witness that the comparison is still whole-string.
 */
import { describe, expect, it } from "vitest";

import {
  emptyIdentityExclusion,
  excludeIdentities,
  type IdentityExclusion,
  isExcludedIdentity,
  loadIdentityExclusion,
  normaliseIdentityName,
  parseIdentityExclusionLines,
} from "../../../corpus/identityExclusion.js";
import { unwrap } from "../../../lib/result.js";

/** A denylist holding exactly these names. */
function denying({ names }: { names: readonly string[] }): IdentityExclusion {
  return {
    names: new Set(names.map((name) => normaliseIdentityName({ name }))),
    path: "/fixture/identity-exclusion.txt",
  };
}

describe("normaliseIdentityName", () => {
  it("lowercases, trims and collapses inner whitespace", () => {
    expect(normaliseIdentityName({ name: "  Tobias   Wren\n" })).toBe("tobias wren");
  });

  it("keeps the comma that makes a composite entry identifiable", () => {
    expect(normaliseIdentityName({ name: "Tobias Wren, Rosa Lindqvist" })).toBe("tobias wren, rosa lindqvist");
  });
});

describe("isExcludedIdentity", () => {
  const exclusion = denying({ names: ["Tobias Wren, Rosa Lindqvist"] });

  it("matches the excluded name regardless of case and spacing", () => {
    expect(isExcludedIdentity({ exclusion, name: "tobias wren,  ROSA lindqvist" })).toBe(true);
  });

  it("does not match either half of it", () => {
    expect(isExcludedIdentity({ exclusion, name: "Tobias Wren" })).toBe(false);
    expect(isExcludedIdentity({ exclusion, name: "Rosa Lindqvist" })).toBe(false);
  });

  it("does not match a longer name that CONTAINS it", () => {
    expect(isExcludedIdentity({ exclusion, name: "Tobias Wren, Rosa Lindqvist, Seth Tanner" })).toBe(false);
  });

  it("excludes nobody when the list is empty", () => {
    expect(isExcludedIdentity({ exclusion: emptyIdentityExclusion(), name: "Tobias Wren, Rosa Lindqvist" })).toBe(
      false,
    );
  });
});

describe("excludeIdentities", () => {
  it("leaves both halves of a composite name alone while removing the composite", () => {
    const roster = ["Ada Owner", "Seth Tanner", "Tobias Wren", "Tobias Wren, Rosa Lindqvist", "Rosa Lindqvist"];
    const result = excludeIdentities({ exclusion: denying({ names: ["Tobias Wren, Rosa Lindqvist"] }), names: roster });
    expect(result.names).toEqual(["Ada Owner", "Seth Tanner", "Tobias Wren", "Rosa Lindqvist"]);
    expect(result.removed).toBe(1);
  });

  it("removes every excluded name in one pass and counts them", () => {
    const result = excludeIdentities({
      exclusion: denying({ names: ["Tobias Wren, Ada Owner", "Tobias Wren, Seth Tanner"] }),
      names: ["Tobias Wren", "Tobias Wren, Ada Owner", "Tobias Wren, Seth Tanner", "Seth Tanner"],
    });
    expect(result.names).toEqual(["Tobias Wren", "Seth Tanner"]);
    expect(result.removed).toBe(2);
  });

  it("returns an empty roster unchanged", () => {
    const result = excludeIdentities({ exclusion: denying({ names: ["Ada, D1"] }), names: [] });
    expect(result.names).toEqual([]);
    expect(result.removed).toBe(0);
  });
});

describe("parseIdentityExclusionLines", () => {
  it("normalises every entry it keeps", () => {
    const parsed = unwrap(
      parseIdentityExclusionLines({ lines: ["Tobias Wren, Rosa Lindqvist", "Ada, D1"], path: "/fixture" }),
    );
    expect([...parsed.names].toSorted()).toEqual(["ada, d1", "tobias wren, rosa lindqvist"]);
    expect(parsed.path).toBe("/fixture");
  });

  it("refuses an entry that normalises to nothing, naming the line", () => {
    const parsed = parseIdentityExclusionLines({ lines: ["Real Name", "   "], path: "/fixture" });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("normalises to an empty name");
  });
});

describe("loadIdentityExclusion", () => {
  it("excludes nobody when the file is absent, and still names where it looked", () => {
    const loaded = unwrap(
      loadIdentityExclusion({
        home: "/fixture/home",
        readText: () => {
          throw Object.assign(new Error("nope"), { code: "ENOENT" });
        },
      }),
    );
    expect(loaded.names.size).toBe(0);
    expect(loaded.path).toBe("/fixture/home/identity-exclusion.txt");
  });

  it("refuses an unreadable file rather than indexing with an empty list", () => {
    const loaded = loadIdentityExclusion({
      home: "/fixture/home",
      readText: () => {
        throw Object.assign(new Error("nope"), { code: "EACCES" });
      },
    });
    expect(loaded.isErr()).toBe(true);
    expect(loaded._unsafeUnwrapErr()[0]).toContain("Refusing to index with an empty list");
  });

  it("reads whole names and skips comments and blanks", () => {
    const loaded = unwrap(
      loadIdentityExclusion({
        home: "/fixture/home",
        readText: () => "# the phantoms\nTobias Wren, Rosa Lindqvist\n\nAda, D1\n",
      }),
    );
    expect([...loaded.names].toSorted()).toEqual(["ada, d1", "tobias wren, rosa lindqvist"]);
  });
});
