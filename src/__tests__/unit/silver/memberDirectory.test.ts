/**
 * The member directory's effectful edge, over an explicit temp home: the declared org domains read from
 * `org-domains.txt` (absent ⇒ none; comments stripped, normalised, deduped and sorted), an empty home settling
 * NO domains and saying why rather than guessing, a configured file winning outright, and the per-home memo
 * that holds until it is reset.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadConfiguredOrgDomains,
  memberDirectory,
  resetMemberDirectoryCache,
} from "../../../silver/memberDirectory.js";

const NO_DOMAIN_WARNING =
  "no member email carries a domain, so the org's own domains cannot be inferred — run `slopweaver refresh --all-sources` to hydrate members, or declare them in $SLOPWEAVER_HOME/org-domains.txt";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "member-directory-"));
  resetMemberDirectoryCache();
});

afterEach(() => {
  resetMemberDirectoryCache();
  rmSync(home, { force: true, recursive: true });
});

describe("loadConfiguredOrgDomains", () => {
  it("is empty when the home declares no org-domains.txt", () => {
    expect(loadConfiguredOrgDomains({ home })).toEqual([]);
  });

  it("strips comments and blanks, lowercases, drops a leading @, dedupes and sorts", () => {
    writeFileSync(
      join(home, "org-domains.txt"),
      "# the org's own domains\nzeta.example\n@Example.COM\n\nexample.com  # again\n",
    );

    expect(loadConfiguredOrgDomains({ home })).toEqual(["example.com", "zeta.example"]);
  });
});

describe("memberDirectory", () => {
  it("settles no domains on a home with no members and no declaration, saying why", () => {
    expect(memberDirectory({ home })).toEqual({
      basis: "unsettled",
      orgDomains: [],
      rows: [],
      warnings: [NO_DOMAIN_WARNING],
    });
  });

  it("takes a declared domain set outright, naming it as configured", () => {
    writeFileSync(join(home, "org-domains.txt"), "example.com\n");

    expect(memberDirectory({ home })).toEqual({
      basis: "configured: example.com",
      orgDomains: ["example.com"],
      rows: [],
      warnings: [],
    });
  });

  it("serves the first read from memory until the cache is reset", () => {
    expect(memberDirectory({ home }).basis).toBe("unsettled");
    writeFileSync(join(home, "org-domains.txt"), "example.com\n");

    expect(memberDirectory({ home }).basis).toBe("unsettled");

    resetMemberDirectoryCache();
    expect(memberDirectory({ home }).basis).toBe("configured: example.com");
  });
});
