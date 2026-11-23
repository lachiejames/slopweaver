import { describe, expect, it } from "vitest";

import { newestTopupRow } from "../../../../review/vulnTopupGate.js";
import { PREFIX } from "./harness.js";

describe("newestTopupRow", () => {
  const row = ({ slug }: { slug: string }) => ({ settlement: undefined, slug, status: "ready", workerGone: false });

  it("picks the largest instant suffix whatever order the rows arrive in", () => {
    const rows = [row({ slug: `${PREFIX}-900` }), row({ slug: `${PREFIX}-1000` }), row({ slug: `${PREFIX}-50` })];

    expect(newestTopupRow({ prefix: PREFIX, repo: "owner/name", rows })!.slug).toBe(`${PREFIX}-1000`);
  });

  it("ignores a row that only shares the prefix, and another repository's generations", () => {
    const rows = [
      row({ slug: `${PREFIX}-extra-5000` }),
      row({ slug: "vulnfix-topup-owner-other-9000" }),
      row({ slug: `${PREFIX}-10` }),
    ];

    expect(newestTopupRow({ prefix: PREFIX, repo: "owner/name", rows })!.slug).toBe(`${PREFIX}-10`);
  });

  it("skips a colliding repository's newer generation, judged by the repository its brief names (Codex review)", () => {
    const brief = ({ repo }: { repo: string }) =>
      `Raise 1 vulnerability-fix pull request(s) in ${repo} as someone, to bring the set back to 10.`;
    const rows = [
      { ...row({ slug: "vulnfix-topup-acme-tools-api-500" }), summary: brief({ repo: "acme-tools/api" }) },
      { ...row({ slug: "vulnfix-topup-acme-tools-api-900" }), summary: brief({ repo: "acme/tools-api" }) },
    ];

    expect(newestTopupRow({ prefix: "vulnfix-topup-acme-tools-api", repo: "acme-tools/api", rows })!.slug).toBe(
      "vulnfix-topup-acme-tools-api-500",
    );
  });

  it("answers undefined for a repository that has never had a generation", () => {
    expect(
      newestTopupRow({ prefix: PREFIX, repo: "owner/name", rows: [row({ slug: "something-else" })] }),
    ).toBeUndefined();
  });
});
