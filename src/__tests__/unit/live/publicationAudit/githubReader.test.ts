/**
 * The publication audit's GitHub door reads every thread on one repository through a seam a test fakes with plain
 * functions: each object's texts carry a coordinate key and its canonical address, and any gap makes the door
 * partial, never clean. Synthetic repository only.
 */
import { describe, expect, it } from "vitest";

import { err, ok, type Result } from "../../../../lib/result.js";
import type { GithubExposureSeam } from "../../../../live/github/exposureListing.js";
import type { GithubExposureCallId, GithubExposureReadFailure } from "../../../../live/github/exposureModel.js";
import { githubListingGapLabels, readGithubPublications } from "../../../../live/publicationAudit/githubReader.js";

const REPO = "https://github.com/acme/widgets";

/** What each call answers on page 1; any later page is empty. A call absent here answers an empty page. */
type Pages = Partial<Record<GithubExposureCallId, unknown[] | "fail">>;

/**
 * A seam answering from a fixed table, recording each call it was asked.
 *
 * @param pages what each call answers
 * @param reviews what `pull-reviews` answers per pull number
 * @returns the seam and its call log
 */
function fakeSeam({ pages, reviews = {} }: { pages: Pages; reviews?: Record<number, unknown[] | "fail"> }): {
  seam: GithubExposureSeam;
  calls: string[];
} {
  const calls: string[] = [];
  const failure: GithubExposureReadFailure = { message: "synthetic outage", status: 502 };
  const answer = ({ value }: { value: unknown[] | "fail" | undefined }): Result<unknown, GithubExposureReadFailure> => {
    if (value === "fail") {
      return err(failure);
    }
    if (value === undefined) {
      return ok([]);
    }
    return ok(value);
  };
  return {
    calls,
    seam: {
      get: ({ call, params }) => {
        calls.push(`${call} page ${String(params["page"])}`);
        if (params["page"] !== 1) {
          return Promise.resolve(ok([]));
        }
        if (call === "pull-reviews") {
          return Promise.resolve(answer({ value: reviews[Number(params["pull_number"])] }));
        }
        return Promise.resolve(answer({ value: pages[call] }));
      },
      graphql: () => Promise.resolve(err(failure)),
    },
  };
}

const PULL = { body: "pull body text", html_url: `${REPO}/pull/46`, number: 46, title: "a pull title" };
const ISSUE = { body: "issue body text", html_url: `${REPO}/issues/7`, number: 7, title: "an issue title" };
const COMMENT = { body: "a comment", html_url: `${REPO}/pull/46#issuecomment-1001`, id: 1001 };

describe("readGithubPublications", () => {
  it("keys each object by coordinate and links it to its canonical address, reading reviews per pull request", async () => {
    const { seam, calls } = fakeSeam({
      pages: { "issue-comments": [COMMENT], issues: [ISSUE, { ...PULL, pull_request: {} }], pulls: [PULL] },
      reviews: { 46: [{ body: "a review", html_url: `${REPO}/pull/46#pullrequestreview-9`, id: 9 }] },
    });
    const read = await readGithubPublications({ owner: "acme", repo: "widgets", seam });
    expect(read.texts.map((text) => [text.objectKey, text.field, text.link, text.text])).toEqual([
      ["pull 46", "title", `${REPO}/pull/46`, "a pull title"],
      ["pull 46", "body", `${REPO}/pull/46`, "pull body text"],
      ["issue 7", "title", `${REPO}/issues/7`, "an issue title"],
      ["issue 7", "body", `${REPO}/issues/7`, "issue body text"],
      ["issue-comment 1001", "body", `${REPO}/pull/46#issuecomment-1001`, "a comment"],
      ["review 9", "body", `${REPO}/pull/46#pullrequestreview-9`, "a review"],
    ]);
    expect(read.texts.filter((text) => !text.linkCarriesNoText)).toEqual([]);
    expect(read.coverage).toEqual({
      attachmentsNotSwept: 0,
      door: "github",
      gaps: [],
      objects: 4,
      state: "complete",
      texts: 6,
    });
    expect(calls).toEqual([
      "pulls page 1",
      "issues page 1",
      "issue-comments page 1",
      "review-comments page 1",
      "pull-reviews page 1",
    ]);
  });

  it("is partial on a failed listing, naming the listing with a fixed label and never the provider message", async () => {
    const { seam } = fakeSeam({ pages: { issues: "fail", pulls: [PULL] }, reviews: { 46: "fail" } });
    const read = await readGithubPublications({ owner: "acme", repo: "widgets", seam });
    expect(read.coverage.state).toBe("partial");
    expect(read.coverage.gaps).toEqual(["issues: read failed", "pull-reviews: 1 pull request(s) not fully read"]);
    expect(JSON.stringify(read.coverage)).not.toContain("synthetic outage");
  });

  it("stands the repository address in for an address off the repository's shape, and counts it as a gap", async () => {
    const { seam } = fakeSeam({ pages: { pulls: [{ ...PULL, html_url: "https://example.com/elsewhere" }] } });
    const read = await readGithubPublications({ owner: "acme", repo: "widgets", seam });
    expect(read.texts.map((text) => text.link)).toEqual([REPO, REPO]);
    expect(read.coverage.gaps).toEqual(["1 object(s) without a canonical address"]);
    expect(read.coverage.state).toBe("partial");
  });

  it("is partial for a textless item with no canonical address, so a malformed page can never read complete", async () => {
    const { seam } = fakeSeam({ pages: { pulls: [{ body: null, number: 46, title: null }] } });
    const read = await readGithubPublications({ owner: "acme", repo: "widgets", seam });
    expect(read.texts).toEqual([]);
    expect(read.coverage.gaps).toEqual(["1 object(s) without a canonical address"]);
    expect(read.coverage.state).toBe("partial");
  });

  it("counts an uploaded file as not swept rather than clean", async () => {
    const upload = "https://github.com/user-attachments/assets/01234567-89ab-cdef-0123-456789abcdef";
    const { seam } = fakeSeam({ pages: { pulls: [{ ...PULL, body: `see ${upload}` }] } });
    const read = await readGithubPublications({ owner: "acme", repo: "widgets", seam });
    expect(read.coverage.attachmentsNotSwept).toBe(1);
    expect([read.coverage.state, read.coverage.gaps]).toEqual(["partial", ["1 uploaded file(s) not read"]]);
  });

  it("reports a page ceiling as a gap", async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({ ...COMMENT, id: index + 1 }));
    const { seam } = fakeSeam({ pages: { "issue-comments": full } });
    const read = await readGithubPublications({ maxPages: 1, owner: "acme", repo: "widgets", seam });
    expect(read.coverage.gaps).toEqual(["issue-comments: page ceiling"]);
    expect(read.coverage.objects).toBe(100);
  });

  it("is complete and empty on a repository with nothing published", async () => {
    const { seam } = fakeSeam({ pages: {} });
    const read = await readGithubPublications({ owner: "acme", repo: "widgets", seam });
    expect([read.texts, read.coverage.state, read.coverage.objects]).toEqual([[], "complete", 0]);
  });
});

describe("githubListingGapLabels", () => {
  it("labels a total larger than what was listed, and nothing for a complete listing", () => {
    expect(
      githubListingGapLabels({ label: "pulls", listing: { items: [1], outcome: "complete", totalCount: 2 } }),
    ).toEqual(["pulls: fewer listed than GitHub reports"]);
    expect(
      githubListingGapLabels({ label: "pulls", listing: { items: [1], outcome: "complete", totalCount: 1 } }),
    ).toEqual([]);
  });
});
