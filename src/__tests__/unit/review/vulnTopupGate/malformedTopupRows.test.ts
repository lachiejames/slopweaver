import { describe, expect, it } from "vitest";

import { malformedTopupRows } from "../../../../review/vulnTopupGate.js";
import { PREFIX } from "./harness.js";

describe("malformedTopupRows", () => {
  const brief = ({ repo }: { repo: string }) =>
    `Raise 1 vulnerability-fix pull request(s) in ${repo} as someone, to bring the set back to 10.`;
  const row = ({ slug, summary }: { slug: string; summary?: string }) => ({
    settlement: undefined,
    slug,
    status: "ready",
    workerGone: false,
    ...(summary === undefined ? {} : { summary }),
  });

  it("names this repository's rows that no generation instant orders, and the bare prefix, never a generation", () => {
    const rows = [
      row({ slug: `${PREFIX}-bad`, summary: brief({ repo: "owner/name" }) }),
      row({ slug: PREFIX }),
      row({ slug: `${PREFIX}-900`, summary: brief({ repo: "owner/name" }) }),
      row({ slug: "something-else" }),
    ];

    expect(malformedTopupRows({ prefix: PREFIX, repo: "owner/name", rows })).toEqual([`${PREFIX}-bad`, PREFIX]);
  });

  it("names a generation whose instant is past the safe-integer range, where two could read as one", () => {
    const rows = [
      row({ slug: `${PREFIX}-9007199254740992`, summary: brief({ repo: "owner/name" }) }),
      row({ slug: `${PREFIX}-9007199254740991`, summary: brief({ repo: "owner/name" }) }),
    ];

    expect(malformedTopupRows({ prefix: PREFIX, repo: "owner/name", rows })).toEqual([`${PREFIX}-9007199254740992`]);
  });

  it("names a generation whose instant is not in canonical form, where `-01` and `-1` read as one", () => {
    const rows = [
      row({ slug: `${PREFIX}-1`, summary: brief({ repo: "owner/name" }) }),
      row({ slug: `${PREFIX}-01`, summary: brief({ repo: "owner/name" }) }),
    ];

    expect(malformedTopupRows({ prefix: PREFIX, repo: "owner/name", rows })).toEqual([`${PREFIX}-01`]);
  });

  it("leaves a colliding repository's rows alone, judged by the repository its brief names", () => {
    const rows = [row({ slug: `${PREFIX}-x-500`, summary: brief({ repo: "owner/name-x" }) })];

    expect(malformedTopupRows({ prefix: PREFIX, repo: "owner/name", rows })).toEqual([]);
  });
});
