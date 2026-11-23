/*
 * How a pull request reads on an ask's record line. The whole URL is what the row would otherwise
 * print, and `owner/repo#number` is what the owner actually reads.
 */

import { describe, expect, it } from "vitest";

import { prDiffUrl, prLabel } from "../../lib/askLinks";

describe("prLabel", () => {
  it("reads a pull request as owner/repo#number", () => {
    expect(prLabel({ url: "https://github.com/acme/acme-admin/pull/16339" })).toBe("acme/acme-admin#16339");
  });

  it("ignores whatever the URL carries past the number", () => {
    expect(prLabel({ url: "https://github.com/acme/acme-admin/pull/16339/files#r123" })).toBe("acme/acme-admin#16339");
  });

  it("shows a URL it does not recognise whole, rather than guessing at a label for it", () => {
    expect(prLabel({ url: "https://github.com/acme/acme-admin/issues/12" })).toBe(
      "https://github.com/acme/acme-admin/issues/12",
    );
  });

  it("does not read an http pull-request URL as one, because the published field is https", () => {
    expect(prLabel({ url: "http://github.com/acme/acme-admin/pull/16339" })).toBe(
      "http://github.com/acme/acme-admin/pull/16339",
    );
  });
});

describe("prDiffUrl", () => {
  it("points at the pull request's files tab — the diff every card links", () => {
    expect(prDiffUrl({ url: "https://github.com/lachiejames/slopweaver/pull/1085" })).toBe(
      "https://github.com/lachiejames/slopweaver/pull/1085/files",
    );
  });

  it("drops whatever the URL carried past the number rather than appending to it", () => {
    expect(prDiffUrl({ url: "https://github.com/acme/acme-admin/pull/16339/files#r123" })).toBe(
      "https://github.com/acme/acme-admin/pull/16339/files",
    );
  });

  it("names no diff for a URL that is not a pull request", () => {
    expect(prDiffUrl({ url: "https://github.com/acme/acme-admin/issues/12" })).toBeUndefined();
  });
});
