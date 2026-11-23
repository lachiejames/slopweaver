import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { listedFiles } from "../../../../live/github/diffOnBaseListed.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import {
  PULL_FILES_MAX,
  PULL_FILES_MAX_PAGES,
  PULL_FILES_PER_PAGE,
  PULL_FILES_ROUTE,
  withPullFiles,
} from "../../../../live/github/pullFiles.js";
import type { GithubReadRest } from "../../../../live/github/read.js";
import type { ProviderReadDocument } from "../../../../live/providerRead.js";

const BASE_RESIDUE = "only fields declared were requested";

/** The line every read of more than one page carries, since GitHub's pages are no snapshot. */
function pagedLine({ pages }: { pages: number }): string {
  return (
    `data.files was read in ${String(pages)} pages, which GitHub does not serve as one snapshot: a push to the base ` +
    "between them could shift files across a page unseen"
  );
}

/** A pull request's ordinary read, as `readGithubObject` hands it on. */
function pullDocument({ changedFiles }: { changedFiles: number | undefined }): ProviderReadDocument {
  const counted = changedFiles === undefined ? {} : { changedFiles };
  return {
    coverage: { detail: "one named object", kind: "bounded", residue: [BASE_RESIDUE] },
    data: { ...counted, number: 7, title: "A pull request" },
    readAtIso: "2026-09-29T04:00:00.000Z",
    source: "github",
    target: { address: "https://github.com/o/r/pull/7", identity: "o/r#7", kind: "pull-request" },
  };
}

/** A REST seam that answers one list and records what it was asked. */
function restAnswering({ list, asked }: { list: readonly unknown[]; asked: unknown[] }): GithubReadRest {
  return ({ route, params }) => {
    asked.push({ params, route });
    return Promise.resolve(ok({ data: list, status: 200 }));
  };
}

/** `count` distinct changed files, named in order. */
function filesNamed({ count }: { count: number }): readonly unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    additions: 1,
    deletions: 0,
    filename: `f${String(index)}.ts`,
    status: "added",
  }));
}

/**
 * A REST seam that pages a list the way GitHub does — `per_page` at a time by `page`, and an empty page past
 * {@link PULL_FILES_MAX} whatever the list holds — and records each page number it was asked for.
 */
function restPaging({ list, pagesAsked }: { list: readonly unknown[]; pagesAsked: number[] }): GithubReadRest {
  return ({ params }) => {
    const page = params["page"] as number;
    const perPage = params["per_page"] as number;
    pagesAsked.push(page);
    const visible = list.slice(0, PULL_FILES_MAX);
    return Promise.resolve(ok({ data: visible.slice((page - 1) * perPage, page * perPage), status: 200 }));
  };
}

/** The filenames a read carried at `data.files.nodes`. */
function filenamesOf({ document }: { document: ProviderReadDocument }): readonly string[] {
  const data = document.data as { files: { nodes: readonly { filename: string }[] } };
  return data.files.nodes.map((node) => node.filename);
}

const MODIFIED = { additions: 1, deletions: 1, filename: "a.ts", patch: "@@ -1 +1 @@\n-a\n+b", status: "modified" };
const BINARY = { additions: 0, deletions: 0, filename: "shot.png", status: "added" };

describe("withPullFiles", () => {
  it("asks GitHub for one full page of a small pull request's files and carries each item raw", async () => {
    const asked: unknown[] = [];

    const read = unwrap(
      await withPullFiles({
        document: pullDocument({ changedFiles: 2 }),
        rest: restAnswering({ asked, list: [MODIFIED, BINARY] }),
      }),
    );

    expect(asked).toEqual([
      {
        params: { owner: "o", page: 1, per_page: PULL_FILES_PER_PAGE, pull_number: 7, repo: "r" },
        route: PULL_FILES_ROUTE,
      },
    ]);
    expect(read.data).toEqual({
      changedFiles: 2,
      files: { nodes: [MODIFIED, BINARY], pageInfo: { endCursor: null, hasNextPage: false }, totalCount: 2 },
      number: 7,
      title: "A pull request",
    });
    expect(read.coverage.residue).toEqual([BASE_RESIDUE]);
  });

  it("reads every page of a pull request changing more files than one page carries", async () => {
    const pagesAsked: number[] = [];

    const read = unwrap(
      await withPullFiles({
        document: pullDocument({ changedFiles: 250 }),
        rest: restPaging({ list: filesNamed({ count: 250 }), pagesAsked }),
      }),
    );

    expect(pagesAsked).toEqual([1, 2, 3]);
    expect(filenamesOf({ document: read })).toEqual(filesNamed({ count: 250 }).map((_, i) => `f${String(i)}.ts`));
    expect(read.coverage.residue).toEqual([BASE_RESIDUE, pagedLine({ pages: 3 })]);
  });

  it("reads past a full page that matches the count, so a list a push grew is never cut at the stale count", async () => {
    const pagesAsked: number[] = [];

    const read = unwrap(
      await withPullFiles({
        document: pullDocument({ changedFiles: 100 }),
        rest: restPaging({ list: filesNamed({ count: 150 }), pagesAsked }),
      }),
    );

    expect(pagesAsked).toEqual([1, 2]);
    expect(filenamesOf({ document: read }).length).toBe(150);
    expect(read.coverage.residue).toEqual([
      BASE_RESIDUE,
      "data.files holds 150 files but the pull request counts 100 changed: the two reads disagree, most likely a " +
        "push between them, so re-read before relying on the list",
      pagedLine({ pages: 2 }),
    ]);
  });

  it("asks for one empty page after a count that falls on a page boundary, and reads the list whole", async () => {
    const pagesAsked: number[] = [];

    const read = unwrap(
      await withPullFiles({
        document: pullDocument({ changedFiles: 200 }),
        rest: restPaging({ list: filesNamed({ count: 200 }), pagesAsked }),
      }),
    );

    expect(pagesAsked).toEqual([1, 2, 3]);
    expect(filenamesOf({ document: read }).length).toBe(200);
    expect(read.coverage.residue).toEqual([BASE_RESIDUE, pagedLine({ pages: 3 })]);
  });

  it("names a list whose pages shifted between reads, and never calls it whole, though its count agrees", async () => {
    const all = filesNamed({ count: 150 });
    // Page 2 after a base push shifted the list one place: f99 again where f100 belonged, so f100 is never seen.
    const pages = [all.slice(0, 100), [all[99], ...all.slice(101, 150)]];
    const rest: GithubReadRest = ({ params }) =>
      Promise.resolve(ok({ data: pages[(params["page"] as number) - 1], status: 200 }));

    const read = unwrap(await withPullFiles({ document: pullDocument({ changedFiles: 150 }), rest }));

    expect(filenamesOf({ document: read }).length).toBe(150);
    expect(filenamesOf({ document: read })).not.toContain("f100.ts");
    expect(read.coverage.residue).toEqual([
      BASE_RESIDUE,
      "data.files lists 1 file(s) twice: a push shifted its pages between reads, so as many files may be missing — " +
        "re-read before relying on the list",
      pagedLine({ pages: 2 }),
    ]);
    expect(listedFiles({ data: read.data as Record<string, unknown> })!.complete).toBe(false);
  });

  it("names the cap on a list of exactly GitHub's cap, which cannot show a push that grew it", async () => {
    const pagesAsked: number[] = [];

    const read = unwrap(
      await withPullFiles({
        document: pullDocument({ changedFiles: PULL_FILES_MAX }),
        rest: restPaging({ list: filesNamed({ count: PULL_FILES_MAX + 1 }), pagesAsked }),
      }),
    );

    expect(pagesAsked.length).toBe(30);
    expect(filenamesOf({ document: read }).length).toBe(3000);
    expect(read.coverage.residue).toEqual([
      BASE_RESIDUE,
      "data.files holds 3000 files, GitHub's cap on this list, as the pull request counts: whole unless a push " +
        "between the two reads added more, which a capped list cannot show",
      pagedLine({ pages: 30 }),
    ]);
    expect(listedFiles({ data: read.data as Record<string, unknown> })!.complete).toBe(false);
  });

  it("names no cut one page under GitHub's cap", async () => {
    const read = unwrap(
      await withPullFiles({
        document: pullDocument({ changedFiles: PULL_FILES_MAX - PULL_FILES_PER_PAGE }),
        rest: restPaging({ list: filesNamed({ count: PULL_FILES_MAX - PULL_FILES_PER_PAGE }), pagesAsked: [] }),
      }),
    );

    expect(filenamesOf({ document: read }).length).toBe(2900);
    expect(read.coverage.residue).toEqual([BASE_RESIDUE, pagedLine({ pages: 30 })]);
    expect(listedFiles({ data: read.data as Record<string, unknown> })!.complete).toBe(true);
  });

  it("names GitHub's cap and how many files it left out when the pull request changes more than it lists", async () => {
    const pagesAsked: number[] = [];

    const read = unwrap(
      await withPullFiles({
        document: pullDocument({ changedFiles: 3001 }),
        rest: restPaging({ list: filesNamed({ count: 3001 }), pagesAsked }),
      }),
    );

    expect(pagesAsked).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    expect(read.data).toMatchObject({
      files: { pageInfo: { endCursor: null, hasNextPage: false }, totalCount: 3001 },
    });
    expect(filenamesOf({ document: read }).length).toBe(3000);
    expect(read.coverage.residue).toEqual([
      BASE_RESIDUE,
      "data.files holds 3000 of 3001 changed files: GitHub's pull-request file list stops at 3000, so the other 1 " +
        "cannot be read through it — read the diff from git instead",
      pagedLine({ pages: 30 }),
    ]);
  });

  it("names a list spliced across a push between its pages, even when its length matches the count", async () => {
    const atHead = ({ head, from, count }: { head: string; from: number; count: number }): readonly unknown[] =>
      Array.from({ length: count }, (_, index) => ({
        contents_url: `https://api.github.com/repos/o/r/contents/f${String(from + index)}.ts?ref=${head}`,
        filename: `f${String(from + index)}.ts`,
        status: "added",
      }));
    const rest: GithubReadRest = ({ params }) =>
      Promise.resolve(
        ok({
          data:
            params["page"] === 1
              ? atHead({ count: 100, from: 0, head: "aaaa" })
              : atHead({ count: 50, from: 100, head: "bbbb" }),
          status: 200,
        }),
      );

    const read = unwrap(await withPullFiles({ document: pullDocument({ changedFiles: 150 }), rest }));

    expect(read.coverage.residue).toEqual([
      BASE_RESIDUE,
      "data.files was read across 2 heads: a push landed between its pages, so the list mixes them — re-read " +
        "before relying on it",
      pagedLine({ pages: 2 }),
    ]);
    expect(listedFiles({ data: read.data as Record<string, unknown> })!.complete).toBe(false);
  });

  it("names a list read at another head than the pull request's own read", async () => {
    const document: ProviderReadDocument = {
      ...pullDocument({ changedFiles: 1 }),
      data: { changedFiles: 1, commits: { nodes: [{ commit: { oid: "1111111111aaaa" } }] }, number: 7 },
    };
    const entry = {
      contents_url: "https://api.github.com/repos/o/r/contents/a.ts?ref=2222222222bbbb",
      filename: "a.ts",
      status: "added",
    };

    const read = unwrap(await withPullFiles({ document, rest: restAnswering({ asked: [], list: [entry] }) }));

    expect(read.coverage.residue).toEqual([
      BASE_RESIDUE,
      "data.files was read at head 2222222222 but the pull request at 1111111111: a push landed between the two " +
        "reads, so re-read before relying on the list",
    ]);
    expect(listedFiles({ data: read.data as Record<string, unknown> })!.complete).toBe(false);
  });

  it("names nothing when every entry was diffed at the pull request's own head", async () => {
    const document: ProviderReadDocument = {
      ...pullDocument({ changedFiles: 1 }),
      data: { changedFiles: 1, commits: { nodes: [{ commit: { oid: "1111111111aaaa" } }] }, number: 7 },
    };
    const entry = {
      contents_url: "https://api.github.com/repos/o/r/contents/a.ts?ref=1111111111aaaa",
      filename: "a.ts",
      status: "added",
    };

    const read = unwrap(await withPullFiles({ document, rest: restAnswering({ asked: [], list: [entry] }) }));

    expect(read.coverage.residue).toEqual([BASE_RESIDUE]);
    expect(listedFiles({ data: read.data as Record<string, unknown> })!.complete).toBe(true);
  });

  it("names a list GitHub ended short of its own count rather than claiming another page", async () => {
    const read = unwrap(
      await withPullFiles({
        document: pullDocument({ changedFiles: 250 }),
        rest: restPaging({ list: filesNamed({ count: 140 }), pagesAsked: [] }),
      }),
    );

    expect(read.coverage.residue).toEqual([
      BASE_RESIDUE,
      "data.files holds 140 of 250 changed files: GitHub ended the list 110 short of its own count, most likely a " +
        "push between the two reads, so re-read before relying on the list",
      pagedLine({ pages: 2 }),
    ]);
  });

  it("names a list longer than the pull request's count", async () => {
    const read = unwrap(
      await withPullFiles({
        document: pullDocument({ changedFiles: 1 }),
        rest: restAnswering({ asked: [], list: [MODIFIED, BINARY] }),
      }),
    );

    expect(read.coverage.residue).toEqual([
      BASE_RESIDUE,
      "data.files holds 2 files but the pull request counts 1 changed: the two reads disagree, most likely a push " +
        "between them, so re-read before relying on the list",
    ]);
  });

  it("names the cap when a read with no changedFiles count fills every page", async () => {
    const pagesAsked: number[] = [];

    const read = unwrap(
      await withPullFiles({
        document: pullDocument({ changedFiles: undefined }),
        rest: restPaging({ list: filesNamed({ count: 3500 }), pagesAsked }),
      }),
    );

    expect(pagesAsked.length).toBe(30);
    expect(read.coverage.residue).toEqual([
      BASE_RESIDUE,
      "data.files holds 3000 files, GitHub's cap on this list, and the read carried no changedFiles count to say " +
        "whether the pull request changes more",
      pagedLine({ pages: 30 }),
    ]);
  });

  it("fails the whole read when a later page fails, rather than presenting the pages before it as the list", async () => {
    const failure = GithubLiveErrors.readFailed({ message: "GitHub said 502 on page 2" });
    const rest: GithubReadRest = ({ params }) =>
      Promise.resolve(params["page"] === 1 ? ok({ data: filesNamed({ count: 100 }), status: 200 }) : err(failure));

    const refused = unwrapErr(await withPullFiles({ document: pullDocument({ changedFiles: 150 }), rest }));

    expect(refused).toEqual(failure);
  });

  it("refuses a later page that carries no list rather than presenting the pages before it as the list", async () => {
    const rest: GithubReadRest = ({ params }) =>
      Promise.resolve(
        params["page"] === 1 ? ok({ data: filesNamed({ count: 100 }), status: 200 }) : ok({ data: {}, status: 200 }),
      );

    const refused = unwrapErr(await withPullFiles({ document: pullDocument({ changedFiles: 150 }), rest }));

    expect(refused.message).toBe("GitHub answered the file list of o/r#7 without a list");
  });

  it("still asks for the first page of a pull request that counts no files, and reads it whole", async () => {
    const pagesAsked: number[] = [];

    const read = unwrap(
      await withPullFiles({
        document: pullDocument({ changedFiles: 0 }),
        rest: restPaging({ list: [], pagesAsked }),
      }),
    );

    expect(pagesAsked).toEqual([1]);
    expect(read.data).toMatchObject({
      files: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false }, totalCount: 0 },
    });
    expect(read.coverage.residue).toEqual([BASE_RESIDUE]);
  });

  it("states a cap that is exactly the pages it walks", () => {
    expect(PULL_FILES_MAX_PAGES * PULL_FILES_PER_PAGE).toBe(PULL_FILES_MAX);
  });

  it("forwards GitHub's own failure unchanged", async () => {
    const failure = GithubLiveErrors.readFailed({ message: "GitHub said 502" });

    const refused = unwrapErr(
      await withPullFiles({
        document: pullDocument({ changedFiles: 1 }),
        rest: () => Promise.resolve(err(failure)),
      }),
    );

    expect(refused).toEqual(failure);
  });

  it("refuses an answer that carries no list rather than reading it as a pull request with no files", async () => {
    const refused = unwrapErr(
      await withPullFiles({
        document: pullDocument({ changedFiles: 1 }),
        rest: () => Promise.resolve(ok({ data: { message: "Not Found" }, status: 200 })),
      }),
    );

    expect(refused.code).toBe("READ_FAILED");
    expect(refused.message).toBe("GitHub answered the file list of o/r#7 without a list");
  });

  it("refuses an issue's document before any call", async () => {
    const asked: unknown[] = [];
    const issue: ProviderReadDocument = {
      ...pullDocument({ changedFiles: 0 }),
      target: { address: "https://github.com/o/r/issues/7", identity: "o/r#7", kind: "issue" },
    };

    const refused = unwrapErr(await withPullFiles({ document: issue, rest: restAnswering({ asked, list: [] }) }));

    expect(refused.code).toBe("INVALID_ADDRESS");
    expect(asked).toEqual([]);
  });
});
