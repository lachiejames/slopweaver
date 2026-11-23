/*
 * Whether a top-up generation's brief reads: a security brief whose batch its own reader parses does, while a brief
 * listing no batch, one whose stated count is not its batch, a slug without the top-up stem, and a brief naming no
 * repository do not.
 */
import { describe, expect, it } from "vitest";

import { generationBriefReads } from "../../../../sweep/supersession.js";

/** A one-member security brief in the shape `topupAsk` writes, for `owner/name`. */
const securityBrief = ({ repo, count = 1 }: { repo: string; count?: number }): string =>
  [
    `Raise ${String(count)} vulnerability-fix pull request(s) in ${repo} as bot, to bring the open set back to 10.`,
    "",
    "The batch, worst CVSS first:",
    `  - handlebars (npm, yarn.lock) — critical CVSS 9.8, GHSA-8r5x-fm3f-whwj, alert https://github.com/${repo}/security/dependabot/1089, first patched 4.7.10`,
  ].join("\n");

describe("generationBriefReads", () => {
  it("reads a security brief whose batch its own reader parses", () => {
    expect(
      generationBriefReads({
        repo: "acme/api",
        slug: "vulnerability-fix-topup-acme-api-1790000000000",
        summary: securityBrief({ repo: "acme/api" }),
      }),
    ).toBe(true);
  });

  it("refuses a brief in the convention's opening shape that lists no batch", () => {
    expect(
      generationBriefReads({
        repo: "acme/api",
        slug: "vulnerability-fix-topup-acme-api-1790000000000",
        summary: "Raise 1 unrelated pull request(s) in acme/api as bot, to bring it back.",
      }),
    ).toBe(false);
  });

  it("refuses a brief whose stated count is not the batch it lists", () => {
    expect(
      generationBriefReads({
        repo: "acme/api",
        slug: "vulnerability-fix-topup-acme-api-1790000000000",
        summary: securityBrief({ count: 2, repo: "acme/api" }),
      }),
    ).toBe(false);
  });

  it("refuses a slug without the top-up stem, and a brief naming no repository", () => {
    const summary = securityBrief({ repo: "acme/api" });
    expect(generationBriefReads({ repo: "acme/api", slug: "acme-api-1790000000000", summary })).toBe(false);
    expect(
      generationBriefReads({ repo: undefined, slug: "vulnerability-fix-topup-acme-api-1790000000000", summary }),
    ).toBe(false);
  });
});
