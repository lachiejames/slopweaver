import { describe, expect, it } from "vitest";

import { readCodeOwnerSlice } from "../../../cli/commands/sessionStart/codeOwnerSliceRead.js";
import { err, ok } from "../../../lib/result.js";
import { GithubLiveErrors } from "../../../live/github/errors.js";
import type { GithubReadRest } from "../../../live/github/read.js";

const CODEOWNERS = ["* @acme/acme-eng", "/apps/ops/datadog/notificationChannels.ts @jonahy-acme @octocat"].join("\n");

const pull = ({
  changed = 3,
  head = "head-one",
  state = "open",
}: { changed?: number; head?: string; state?: string } = {}) => ({
  data: {
    base: { ref: "staging", sha: "base-one" },
    body: null,
    changed_files: changed,
    head: { sha: head },
    state,
    user: { login: "sethb-acme" },
  },
});

/** The commit the base branch points at, which every CODEOWNERS read must name rather than the branch. */
const TIP = "0123456789abcdef0123456789abcdef01234567";

const FILES = [
  { additions: 1, deletions: 1, filename: "apps/ops/datadog/notificationChannels.ts" },
  { additions: 60, deletions: 0, filename: "apps/ops/datadog/monitors.ts" },
  { additions: 40, deletions: 2, filename: "apps/jobs/src/spanHelpers.ts" },
];

/**
 * A REST seam answering each route from a table, recording every route it was asked for in order. The second read
 * of the pull request answers `second`, so a push between the reads can be staged.
 */
const restOf = ({
  codeowners = CODEOWNERS,
  noCodeowners = false,
  answeredPath = ".github/CODEOWNERS",
  listedType = "file",
  errors = [],
  files = FILES,
  second = pull(),
}: {
  codeowners?: string;
  noCodeowners?: boolean;
  answeredPath?: string;
  listedType?: string;
  errors?: readonly { line: number; path: string }[];
  files?: readonly unknown[];
  second?: unknown;
} = {}) => {
  const routes: string[] = [];
  let pulls = 0;
  const contents = ({ path }: { path: unknown }): Awaited<ReturnType<GithubReadRest>> => {
    if (path === ".github") {
      return ok({ data: [{ name: "CODEOWNERS", path: ".github/CODEOWNERS", type: listedType }] });
    }
    if (noCodeowners || path !== ".github/CODEOWNERS") {
      return err(GithubLiveErrors.readFailed({ message: "Not Found" }));
    }
    return ok({
      data: { content: Buffer.from(codeowners).toString("base64"), encoding: "base64", path: answeredPath },
    });
  };
  const answers: Readonly<
    Record<string, (params: Readonly<Record<string, unknown>>) => Awaited<ReturnType<GithubReadRest>>>
  > = {
    "GET /repos/{owner}/{repo}/branches/{branch}": (params) =>
      ok({ data: { commit: { sha: TIP }, name: params["branch"] } }),
    "GET /repos/{owner}/{repo}/codeowners/errors": () => ok({ data: { errors: errors.map((one) => ({ ...one })) } }),
    // The compare must be pinned to the base tip CODEOWNERS is read at, never the base the pull request reported.
    "GET /repos/{owner}/{repo}/compare/{basehead}": (params) =>
      params["basehead"] === `${TIP}...head-one`
        ? ok({ data: { files } })
        : err(GithubLiveErrors.readFailed({ message: `compared ${String(params["basehead"])}, not the tip` })),
    "GET /repos/{owner}/{repo}/contents/{path}": (params) => contents({ path: params["path"] }),
    "GET /repos/{owner}/{repo}/pulls/{pull_number}": () => {
      pulls += 1;
      return ok(pulls === 1 ? pull() : second);
    },
  };
  const rest: GithubReadRest = async ({ route, params }) => {
    routes.push(route);
    // Every read naming a ref must name the tip COMMIT, never the branch.
    if ("ref" in params && params["ref"] !== TIP) {
      return err(GithubLiveErrors.readFailed({ message: `read at ${String(params["ref"])}, not the tip` }));
    }
    const answer = answers[route];
    return answer === undefined
      ? err(GithubLiveErrors.readFailed({ message: `unexpected route ${route}` }))
      : answer(params);
  };
  return { rest, routes };
};

const READ = { maxReads: 40, number: 18_649, repo: "acme/acme-admin", viewerLogin: "octocat" };

describe("readCodeOwnerSlice", () => {
  it("reads the one file the owner's login owns at the base tip commit, and counts all eight reads it made", async () => {
    const { rest, routes } = restOf();
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({
      kind: "read",
      reads: 8,
      slice: {
        additions: 1,
        deletions: 1,
        omittedPaths: 0,
        ownedFiles: 1,
        shownPaths: ["apps/ops/datadog/notificationChannels.ts"],
        totalFiles: 3,
      },
    });
    expect(routes).toStrictEqual([
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      "GET /repos/{owner}/{repo}/branches/{branch}",
      "GET /repos/{owner}/{repo}/compare/{basehead}",
      "GET /repos/{owner}/{repo}/contents/{path}",
      "GET /repos/{owner}/{repo}/contents/{path}",
      "GET /repos/{owner}/{repo}/codeowners/errors",
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      "GET /repos/{owner}/{repo}/branches/{branch}",
    ]);
  });

  it("answers a repository with no CODEOWNERS as none of its files, never as a failure", async () => {
    const { rest } = restOf({ noCodeowners: true });
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({
      kind: "read",
      reads: 8,
      slice: { additions: 0, deletions: 0, omittedPaths: 0, ownedFiles: 0, shownPaths: [], totalFiles: 3 },
    });
  });

  it("refuses a file list GitHub did not give whole, rather than printing none of the files", async () => {
    const { rest } = restOf({ files: FILES.slice(0, 2) });
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 3,
      reason: "GitHub listed 2 of the 3 changed files, and a table over part of a diff misleads every row",
    });
  });

  it("refuses a file list padded to the right count with a repeated path, which leaves the owner's file out", async () => {
    const { rest } = restOf({ files: [FILES[1]!, FILES[1]!, FILES[2]!] });
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 3,
      reason:
        "GitHub listed 2 distinct paths in 3 entries for 3 changed files, so one file is repeated and another is missing",
    });
  });

  it("refuses a file list with an entry missing its line counts", async () => {
    const { rest } = restOf({ files: [...FILES.slice(0, 2), { filename: "apps/jobs/src/spanHelpers.ts" }] });
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({ kind: "notChecked", reads: 3, reason: "the compare of head-one is not a file list" });
  });

  it("refuses when GitHub reports an error on the line deciding a changed file", async () => {
    const { rest } = restOf({ errors: [{ line: 2, path: ".github/CODEOWNERS" }] });
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 6,
      reason:
        "GitHub reports an error on the CODEOWNERS line deciding apps/ops/datadog/notificationChannels.ts (CODEOWNERS line 2), so whose those files are is unknown",
    });
  });

  it("refuses an error list naming a line that is not a whole number, which could miss the deciding line", async () => {
    const { rest } = restOf({ errors: [{ line: 1.5, path: ".github/CODEOWNERS" }] });
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 6,
      reason: "GitHub's CODEOWNERS errors did not read as a list",
    });
  });

  it("refuses a CODEOWNERS GitHub answered from another path, which is how a symlink reads", async () => {
    const { rest } = restOf({ answeredPath: "config/owners" });
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 4,
      reason:
        ".github/CODEOWNERS on 0123456789abcdef0123456789abcdef01234567 is a link to config/owners, and whether GitHub applies a linked CODEOWNERS is unknown",
    });
  });

  it("refuses a CODEOWNERS its directory lists as a symlink, though GitHub answered it at its own path", async () => {
    const { rest, routes } = restOf({ listedType: "symlink" });
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 5,
      reason:
        ".github/CODEOWNERS on 0123456789abcdef0123456789abcdef01234567 is listed as a symlink, and whether GitHub applies a linked CODEOWNERS is unknown",
    });
    expect(routes.includes("GET /repos/{owner}/{repo}/codeowners/errors")).toBe(false);
  });

  it("refuses when the base branch does not read as a branch, before any file or CODEOWNERS read", async () => {
    const { rest, routes } = restOf();
    const noTip: GithubReadRest = async (args) =>
      args.route === "GET /repos/{owner}/{repo}/branches/{branch}" ? ok({ data: { name: "staging" } }) : rest(args);
    const read = await readCodeOwnerSlice({ ...READ, rest: noTip });
    expect(read).toStrictEqual({ kind: "notChecked", reads: 2, reason: "staging did not read as a branch" });
    expect(routes).toStrictEqual(["GET /repos/{owner}/{repo}/pulls/{pull_number}"]);
  });

  it("refuses a pull request at 300 files without reading them, since a compare cut at 300 would match its count", async () => {
    const { rest, routes } = restOf();
    const big: GithubReadRest = async (args) =>
      args.route === "GET /repos/{owner}/{repo}/pulls/{pull_number}" ? ok(pull({ changed: 300 })) : rest(args);
    const read = await readCodeOwnerSlice({ ...READ, rest: big });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 1,
      reason:
        "https://github.com/acme/acme-admin/pull/18649 changes 300 files, at or past the 300 GitHub lists pinned to one commit",
    });
    expect(routes).toStrictEqual([]);
  });

  it("refuses a pull request that moved while its files were read", async () => {
    const { rest } = restOf({ second: pull({ head: "head-two" }) });
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 7,
      reason:
        "https://github.com/acme/acme-admin/pull/18649 moved, closed, or could not be re-read, while its files were read",
    });
  });

  it("refuses a pull request closed while its files were read, at the same commits", async () => {
    const { rest } = restOf({ second: pull({ state: "closed" }) });
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 7,
      reason:
        "https://github.com/acme/acme-admin/pull/18649 moved, closed, or could not be re-read, while its files were read",
    });
  });

  it("refuses a pull request whose changed-file count moved while its files were read, at the same commits", async () => {
    const { rest } = restOf({ second: pull({ changed: 4 }) });
    const read = await readCodeOwnerSlice({ ...READ, rest });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 7,
      reason:
        "https://github.com/acme/acme-admin/pull/18649 moved, closed, or could not be re-read, while its files were read",
    });
  });

  it("refuses when the base branch tip moved between its CODEOWNERS read and the last read", async () => {
    const { rest } = restOf();
    let tips = 0;
    const moved: GithubReadRest = async (args) => {
      if (args.route !== "GET /repos/{owner}/{repo}/branches/{branch}") {
        return rest(args);
      }
      tips += 1;
      return tips === 1 ? rest(args) : ok({ data: { commit: { sha: "f".repeat(40) }, name: "staging" } });
    };
    const read = await readCodeOwnerSlice({ ...READ, rest: moved });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 8,
      reason: "staging moved, or could not be re-read, while its CODEOWNERS was read",
    });
  });

  it("refuses a pull request already closed when first read, without reading its files", async () => {
    const { rest, routes } = restOf();
    const closed: GithubReadRest = async (args) =>
      args.route === "GET /repos/{owner}/{repo}/pulls/{pull_number}" ? ok(pull({ state: "closed" })) : rest(args);
    const read = await readCodeOwnerSlice({ ...READ, rest: closed });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 1,
      reason: "https://github.com/acme/acme-admin/pull/18649 is no longer open",
    });
    expect(routes).toStrictEqual([]);
  });

  it("makes no request past its bound, and says the bound ran out", async () => {
    const { rest, routes } = restOf();
    const read = await readCodeOwnerSlice({ ...READ, maxReads: 2, rest });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 2,
      reason: "the live check's bound of reads ran out after 2",
    });
    expect(routes.length).toBe(2);
  });

  it("refuses a repository that is not an owner/name slug without a request", async () => {
    const { rest, routes } = restOf();
    const read = await readCodeOwnerSlice({ ...READ, repo: "acme-admin", rest });
    expect(read).toStrictEqual({
      kind: "notChecked",
      reads: 0,
      reason: "acme-admin is not an owner/name repository slug",
    });
    expect(routes).toStrictEqual([]);
  });
});
