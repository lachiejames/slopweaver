import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  type CodeOwnerChangedFile,
  type CodeOwnerSlice,
  codeOwnerSlice,
  codeOwnerSliceLine,
  codeOwnerSliceRuns,
} from "../../../review/codeOwnerSlice.js";
import { reviewErrorLines } from "../../../review/errors.js";

/** The shape of acme-admin's own CODEOWNERS where it decided a thirty-file pull request: a team default, one named file. */
const CODEOWNERS = [
  "* @acme/acme-eng",
  "/apps/jobs/src/functions/webhooks/ @acme/growth-eng",
  "/apps/ops/datadog/notificationChannels.ts @jonahy-acme @octocat",
].join("\n");

const file = ({ path, additions = 1, deletions = 0 }: { path: string; additions?: number; deletions?: number }) =>
  ({ additions, deletions, path }) satisfies CodeOwnerChangedFile;

/** The thirty-file pull request's shape: one file the owner's by name, every other one a team's. */
const THIRTY: readonly CodeOwnerChangedFile[] = [
  file({ additions: 1, deletions: 1, path: "apps/ops/datadog/notificationChannels.ts" }),
  file({ additions: 40, path: "apps/jobs/src/functions/webhooks/stripe/spanHelpers.ts" }),
  ...Array.from({ length: 28 }, (_, index) =>
    file({ additions: 60, path: `apps/ops/datadog/monitor${String(index)}.ts` }),
  ),
];

const slice = (over: Partial<CodeOwnerSlice>): CodeOwnerSlice => ({
  additions: 0,
  deletions: 0,
  omittedPaths: 0,
  ownedFiles: 0,
  shownPaths: [],
  totalFiles: 0,
  ...over,
});

describe("codeOwnerSlice", () => {
  it("reads the thirty-file pull request as the one file and one changed line that are the owner's", () => {
    const result = codeOwnerSlice({
      codeowners: CODEOWNERS,
      erroredLines: [],
      files: THIRTY,
      viewerLogin: "octocat",
    });
    expect(unwrap(result)).toEqual({
      additions: 1,
      deletions: 1,
      omittedPaths: 0,
      ownedFiles: 1,
      shownPaths: ["apps/ops/datadog/notificationChannels.ts"],
      totalFiles: 30,
    });
  });

  it("matches the owner's login case-insensitively, as GitHub does", () => {
    const result = codeOwnerSlice({
      codeowners: CODEOWNERS,
      erroredLines: [],
      files: THIRTY,
      viewerLogin: "OctoCat",
    });
    expect(unwrap(result).ownedFiles).toBe(1);
  });

  it("never claims a team-owned file, because the owner's team memberships are never read", () => {
    const result = codeOwnerSlice({
      codeowners: "* @acme/acme-eng",
      erroredLines: [],
      files: THIRTY,
      viewerLogin: "octocat",
    });
    expect(unwrap(result)).toEqual(slice({ totalFiles: 30 }));
  });

  it("applies the LAST matching line, so a later line naming someone else takes a file off the owner", () => {
    const result = codeOwnerSlice({
      codeowners: "/apps/ @octocat\n/apps/web/ @someone-else",
      erroredLines: [],
      files: [file({ path: "apps/web/page.ts" }), file({ path: "apps/server/route.ts" })],
      viewerLogin: "octocat",
    });
    expect(unwrap(result).shownPaths).toEqual(["apps/server/route.ts"]);
  });

  it("reads a pattern with no owners as REMOVING ownership, never as falling back to an earlier line", () => {
    const result = codeOwnerSlice({
      codeowners: "* @octocat\n/index.ts",
      erroredLines: [],
      files: [file({ path: "index.ts" })],
      viewerLogin: "octocat",
    });
    expect(unwrap(result).ownedFiles).toBe(0);
  });

  it("answers a repository with no CODEOWNERS as none of its files", () => {
    const result = codeOwnerSlice({
      codeowners: "",
      erroredLines: [],
      files: THIRTY,
      viewerLogin: "octocat",
    });
    expect(unwrap(result)).toEqual(slice({ totalFiles: 30 }));
  });

  it("answers a pull request with no files as none of none", () => {
    const result = codeOwnerSlice({
      codeowners: CODEOWNERS,
      erroredLines: [],
      files: [],
      viewerLogin: "octocat",
    });
    expect(unwrap(result)).toEqual(slice({}));
  });

  it("names at most three of the owner's paths, sorted, and counts every one of them in the totals", () => {
    const files = ["d.ts", "b.ts", "a.ts", "c.ts", "e.ts"].map((path) => file({ additions: 2, deletions: 1, path }));
    const result = codeOwnerSlice({
      codeowners: "* @octocat",
      erroredLines: [],
      files,
      viewerLogin: "octocat",
    });
    expect(unwrap(result)).toEqual({
      additions: 10,
      deletions: 5,
      omittedPaths: 2,
      ownedFiles: 5,
      shownPaths: ["a.ts", "b.ts", "c.ts"],
      totalFiles: 5,
    });
  });

  it("refuses when a line GitHub reports as an error decides a changed file, rather than guessing either way", () => {
    const result = codeOwnerSlice({
      codeowners: CODEOWNERS,
      erroredLines: [3],
      files: THIRTY,
      viewerLogin: "octocat",
    });
    expect(reviewErrorLines({ error: unwrapErr(result) })).toEqual([
      "GitHub reports an error on the CODEOWNERS line deciding apps/ops/datadog/notificationChannels.ts (CODEOWNERS line 3), so whose those files are is unknown",
    ]);
  });

  it("refuses a file renamed out of a path that is the owner's, since which path GitHub routes a review by is undocumented", () => {
    const result = codeOwnerSlice({
      codeowners: "/secure/** @octocat\n/public/** @someone-else\n",
      erroredLines: [],
      files: [{ additions: 2, deletions: 1, path: "public/key.ts", previousPath: "secure/key.ts" }],
      viewerLogin: "octocat",
    });
    expect(reviewErrorLines({ error: unwrapErr(result) })).toEqual([
      "secure/key.ts to public/key.ts renamed a file between a path that is the owner's and one that is not, and which path GitHub routes a review by is undocumented, so whether it is the owner's is unknown",
    ]);
  });

  it("counts a file renamed between two paths that are both the owner's", () => {
    const result = codeOwnerSlice({
      codeowners: "/secure/** @octocat\n",
      erroredLines: [],
      files: [{ additions: 2, deletions: 1, path: "secure/b.ts", previousPath: "secure/a.ts" }],
      viewerLogin: "octocat",
    });
    expect(unwrap(result)).toStrictEqual(
      slice({ additions: 2, deletions: 1, ownedFiles: 1, shownPaths: ["secure/b.ts"], totalFiles: 1 }),
    );
  });

  it("refuses line counts totalling past exact integers, rather than printing a rounded count", () => {
    const result = codeOwnerSlice({
      codeowners: "* @octocat\n",
      erroredLines: [],
      files: [file({ additions: Number.MAX_SAFE_INTEGER, path: "a.ts" }), file({ additions: 2, path: "b.ts" })],
      viewerLogin: "octocat",
    });
    expect(reviewErrorLines({ error: unwrapErr(result) })).toEqual([
      "the owner's files' line counts total past what is counted exactly",
    ]);
  });

  it("refuses when the deciding line names an email owner and not the owner's login, since that email may be the owner's", () => {
    const result = codeOwnerSlice({
      codeowners: "*.go octocat@example.com",
      erroredLines: [],
      files: [file({ path: "main.go" })],
      viewerLogin: "octocat",
    });
    expect(reviewErrorLines({ error: unwrapErr(result) })).toEqual([
      "the CODEOWNERS line deciding main.go (CODEOWNERS line 1) names an email owner, and whose account that email is was not read, so whether those files are the owner's is unknown",
    ]);
  });

  it("counts an email-owned line that also names the owner's login, because that login alone settles it", () => {
    const result = codeOwnerSlice({
      codeowners: "*.go someone@example.com @octocat",
      erroredLines: [],
      files: [file({ path: "main.go" })],
      viewerLogin: "octocat",
    });
    expect(unwrap(result).shownPaths).toEqual(["main.go"]);
  });

  it("refuses a CODEOWNERS escaping any character, because how GitHub reads a backslash is undocumented", () => {
    const result = codeOwnerSlice({
      codeowners: "* @other\n\\*.js @alice\n/docs/My\\ File.md @alice",
      erroredLines: [],
      files: [file({ path: "*.js" })],
      viewerLogin: "alice",
    });
    expect(reviewErrorLines({ error: unwrapErr(result) })).toEqual([
      "CODEOWNERS line 2, 3 escapes a character with a backslash, and how GitHub reads that is undocumented, so which files are the owner's is unknown",
    ]);
  });

  it("refuses an escape on a line the parser drops, since GitHub may read that line differently", () => {
    const result = codeOwnerSlice({
      codeowners: "* @alice\n/src/[ab]\\*.ts @bob",
      erroredLines: [],
      files: [file({ path: "src/a/x.ts" })],
      viewerLogin: "alice",
    });
    expect(reviewErrorLines({ error: unwrapErr(result) })).toEqual([
      "CODEOWNERS line 2 escapes a character with a backslash, and how GitHub reads that is undocumented, so which files are the owner's is unknown",
    ]);
  });

  it("ignores a reported error on a line that decides none of the changed files", () => {
    const result = codeOwnerSlice({
      codeowners: CODEOWNERS,
      erroredLines: [2],
      files: [THIRTY[0]!],
      viewerLogin: "octocat",
    });
    expect(unwrap(result).ownedFiles).toBe(1);
  });
});

describe("codeOwnerSliceLine", () => {
  it("says the thirty-file pull request is one file and one line the owner's", () => {
    const line = codeOwnerSliceLine({
      slice: slice({
        additions: 1,
        deletions: 1,
        ownedFiles: 1,
        shownPaths: ["apps/ops/datadog/notificationChannels.ts"],
        totalFiles: 30,
      }),
    });
    expect(line).toBe(
      "Yours as code owner, by login: 1 of 30 files, +1 -1 lines, in apps/ops/datadog/notificationChannels.ts",
    );
  });

  it("says none when no file names the owner", () => {
    expect(codeOwnerSliceLine({ slice: slice({ totalFiles: 30 }) })).toBe(
      "Yours as code owner, by login: none of the 30 files",
    );
  });

  it("joins two paths with and", () => {
    const line = codeOwnerSliceLine({
      slice: slice({ additions: 3, ownedFiles: 2, shownPaths: ["a.ts", "b.ts"], totalFiles: 9 }),
    });
    expect(line).toBe("Yours as code owner, by login: 2 of 9 files, +3 -0 lines, in a.ts and b.ts");
  });

  it("says how many more it does not name", () => {
    const line = codeOwnerSliceLine({
      slice: slice({
        additions: 5,
        omittedPaths: 2,
        ownedFiles: 5,
        shownPaths: ["a.ts", "b.ts", "c.ts"],
        totalFiles: 9,
      }),
    });
    expect(line).toBe("Yours as code owner, by login: 5 of 9 files, +5 -0 lines, in a.ts, b.ts, c.ts and 2 more");
  });
});

describe("codeOwnerSliceRuns", () => {
  it("marks every path as code and no prose as code", () => {
    const runs = codeOwnerSliceRuns({
      slice: slice({ ownedFiles: 2, shownPaths: ["docs/#123.md", "b.ts"], totalFiles: 2 }),
    });
    expect(runs.filter((run) => run.code).map((run) => run.text)).toEqual(["docs/#123.md", "b.ts"]);
  });
});
