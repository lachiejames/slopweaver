import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import { PULL_FILES_PER_PAGE } from "../../../../live/github/pullFiles.js";
import {
  type PullRequestFileStatuses,
  readPullRequestFileStatuses,
  testFileInPr,
} from "../../../../live/github/pullRequestFilesRead.js";
import type { GithubReadRest } from "../../../../live/github/read.js";

/** The head every case judges, and the one GitHub reports unless a case moves it. */
const HEAD = "head-1";

/**
 * A REST seam answering each file page from a list and the pull request reads with `head` and each of `bases` in
 * turn (the last one repeating), recording which pages were asked for.
 */
function pagedRest({
  pages,
  asked,
  head = HEAD,
  bases = ["base-1"],
}: {
  pages: readonly (readonly unknown[])[];
  asked: number[];
  head?: string;
  bases?: readonly string[];
}): GithubReadRest {
  let tipReads = 0;
  return ({ route, params }) => {
    if (!route.endsWith("/files")) {
      const base = bases[Math.min(tipReads, bases.length - 1)]!;
      tipReads += 1;
      return Promise.resolve(ok({ data: { base: { sha: base }, head: { sha: head } } }));
    }
    const page = Number(params["page"]);
    asked.push(page);
    return Promise.resolve(ok({ data: pages[page - 1]! }));
  };
}

/** A full page of modified filler files, so the reader asks for the next one. */
function fullPage({ prefix }: { prefix: string }): readonly unknown[] {
  return Array.from({ length: PULL_FILES_PER_PAGE }, (_, index) => ({
    filename: `${prefix}/f${String(index)}.ts`,
    status: "modified",
  }));
}

describe("readPullRequestFileStatuses", () => {
  it("walks pages until one comes back short, and calls that list complete", async () => {
    const asked: number[] = [];
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 30,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: pagedRest({
        asked,
        pages: [fullPage({ prefix: "src" }), [{ filename: "src/__tests__/new.test.ts", status: "added" }]],
      }),
    });

    const files = unwrap(read);
    expect(asked).toEqual([1, 2]);
    expect(files.complete).toBe(true);
    expect(files.statuses.size).toBe(PULL_FILES_PER_PAGE + 1);
    expect(files.statuses.get("src/__tests__/new.test.ts")).toBe("added");
  });

  it("records a rename's old path as touched, so a log naming it never reads not-in-pr", async () => {
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 30,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: pagedRest({
        asked: [],
        pages: [[{ filename: "src/new.test.ts", previous_filename: "src/old.test.ts", status: "renamed" }]],
      }),
    });

    const files = unwrap(read);
    expect(files.statuses.get("src/new.test.ts")).toBe("renamed");
    expect(files.statuses.get("src/old.test.ts")).toBe("renamed-from");
    expect(testFileInPr({ files, path: "src/old.test.ts" })).toBe("changed-existing");
  });

  it("takes a previous path only from a rename, never from another status carrying one", async () => {
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 30,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: pagedRest({
        asked: [],
        pages: [[{ filename: "src/new.test.ts", previous_filename: "src/old.test.ts", status: "added" }]],
      }),
    });

    expect(testFileInPr({ files: unwrap(read), path: "src/old.test.ts" })).toBe("not-in-pr");
  });

  it("calls a list incomplete when a rename omits its old path, so that path never reads not-in-pr", async () => {
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 30,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: pagedRest({ asked: [], pages: [[{ filename: "src/new.test.ts", status: "renamed" }]] }),
    });

    const files = unwrap(read);
    expect(files.complete).toBe(false);
    expect(testFileInPr({ files, path: "src/old.test.ts" })).toBe("unknown");
  });

  it("calls a list holding an entry it cannot read incomplete, so absence there is never not-in-pr", async () => {
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 30,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: pagedRest({
        asked: [],
        pages: [[{ filename: "src/failing.test.ts" }, { filename: "a.ts", status: "added" }]],
      }),
    });

    const files = unwrap(read);
    expect(files.complete).toBe(false);
    expect(testFileInPr({ files, path: "src/failing.test.ts" })).toBe("unknown");
  });

  it("refuses a list read while the head moved, naming both heads, so pages of two heads are never stitched", async () => {
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 30,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: pagedRest({ asked: [], head: "head-2", pages: [fullPage({ prefix: "src" }), []] }),
    });

    const refused = unwrapErr(read);
    expect(refused.code).toBe("READ_FAILED");
    expect(refused.message).toBe("acme/a#7's head moved from head-1 to head-2 while its file list was read");
  });

  it("reports a list cut at the page bound as incomplete", async () => {
    const asked: number[] = [];
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 2,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: pagedRest({ asked, pages: [fullPage({ prefix: "a" }), fullPage({ prefix: "b" }), []] }),
    });

    expect(asked).toEqual([1, 2]);
    expect(unwrap(read).complete).toBe(false);
  });

  it("refuses a list cut at the page bound whose head moved, since an ADDED status there is still a claim", async () => {
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 2,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: pagedRest({
        asked: [],
        head: "head-2",
        pages: [
          fullPage({ prefix: "a" }),
          [{ filename: "src/new.test.ts", status: "added" }, ...fullPage({ prefix: "b" }).slice(1)],
        ],
      }),
    });

    expect(unwrapErr(read).message).toBe("acme/a#7's head moved from head-1 to head-2 while its file list was read");
  });

  // The changed-file list is computed against the base, so a base push between pages shifts which file lands on
  // which page while the head stays put: a path pushed off page two would otherwise read not-in-pr.
  it("refuses a list read while the base moved under an unchanged head, so pages of two diffs are never stitched", async () => {
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 30,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: pagedRest({ asked: [], bases: ["base-1", "base-2"], pages: [fullPage({ prefix: "src" }), []] }),
    });

    expect(unwrapErr(read).message).toBe(
      "acme/a#7's base moved from base-1 to base-2 while its file list was read, so its pages may describe two diffs",
    );
  });

  it("refuses a base that moved between pages and moved back before the last one, by reading the tips after each", async () => {
    const asked: number[] = [];
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 30,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: pagedRest({ asked, bases: ["base-1", "base-2", "base-1"], pages: [fullPage({ prefix: "src" }), []] }),
    });

    expect(asked).toEqual([1]);
    expect(unwrapErr(read).message).toBe(
      "acme/a#7's base moved from base-1 to base-2 while its file list was read, so its pages may describe two diffs",
    );
  });

  it("names the tip GitHub answered the pull request without", async () => {
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 30,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: () => Promise.resolve(ok({ data: { head: { sha: HEAD } } })),
    });

    expect(unwrapErr(read).message).toBe("GitHub answered acme/a#7 without a base sha");
  });

  it("names the page GitHub answered without a list", async () => {
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 30,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: ({ route }) =>
        Promise.resolve(
          ok({
            data: route.endsWith("/files") ? { message: "Not Found" } : { base: { sha: "b" }, head: { sha: HEAD } },
          }),
        ),
    });

    expect(unwrapErr(read).message).toBe("GitHub answered page 1 of acme/a#7's file list without a list");
  });

  it("carries the seam's own failure through unchanged", async () => {
    const read = await readPullRequestFileStatuses({
      head: HEAD,
      maxPages: 30,
      number: 7,
      owner: "acme",
      repo: "a",
      rest: () => Promise.resolve(err(GithubLiveErrors.readFailed({ message: "rate limited" }))),
    });

    expect(unwrapErr(read).message).toBe("rate limited");
  });
});

describe("testFileInPr", () => {
  const complete: PullRequestFileStatuses = {
    complete: true,
    statuses: new Map([
      ["src/new.test.ts", "added"],
      ["src/old.test.ts", "modified"],
    ]),
  };

  it("says added only on GitHub's own added status", () => {
    expect(testFileInPr({ files: complete, path: "src/new.test.ts" })).toBe("added");
    expect(testFileInPr({ files: complete, path: "src/old.test.ts" })).toBe("changed-existing");
  });

  it("never calls an unchanged path changed, and never guesses a status it does not know", () => {
    const files: PullRequestFileStatuses = {
      complete: false,
      statuses: new Map([
        ["src/same.test.ts", "unchanged"],
        ["src/odd.test.ts", "transmogrified"],
      ]),
    };
    expect(testFileInPr({ files, path: "src/same.test.ts" })).toBe("unknown");
    expect(testFileInPr({ files: { ...files, complete: true }, path: "src/same.test.ts" })).toBe("not-in-pr");
    expect(testFileInPr({ files, path: "src/odd.test.ts" })).toBe("unknown");
  });

  it("says not-in-pr only when the whole list was read", () => {
    expect(testFileInPr({ files: complete, path: "src/other.test.ts" })).toBe("not-in-pr");
    expect(testFileInPr({ files: { ...complete, complete: false }, path: "src/other.test.ts" })).toBe("unknown");
  });

  it("says unknown when the list could not be read at all", () => {
    expect(testFileInPr({ files: undefined, path: "src/new.test.ts" })).toBe("unknown");
  });
});
