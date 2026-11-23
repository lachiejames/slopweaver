/**
 * `github pr reviewers` over plain recording edges: the whole file list read page by page, CODEOWNERS read from
 * the BASE branch at the first place GitHub looks that has one, a pick resolved through the roster to its
 * confirmed login, the printed table, a partial file list refused, and `--apply` refused before any read, since a
 * C3 description publishes no reviewer table.
 */
import { describe, expect, it } from "vitest";

import {
  githubPrReviewersReportOf,
  parseGithubPrReviewersArgs,
  REVIEWERS_APPLY_RETIRED,
} from "../../../../../cli/commands/github/prReviewersCore.js";
import { type GithubPrReviewersDeps, runGithubPrReviewers } from "../../../../../cli/commands/github/prReviewersRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { safeJsonParse } from "../../../../../lib/safeJson.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { GithubReadRest } from "../../../../../live/github/read.js";
import type { ReviewerResolution } from "../../../../../outbound/github/reviewerIndex.js";
import { deriveReviewerTable, type ReviewerRow } from "../../../../../outbound/github/reviewerTable.js";
import { IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";

const PR = "https://github.com/acme/acme-admin/pull/18200";

const CODEOWNERS = ["* @acme/acme-eng", "/packages/infra/ @acme/platform", "/apps/helpbot/ @lionelb"].join("\n");

/** The head every read answers unless a test moves it, and the one a push moves it to. */
const HEAD = "a".repeat(40);
const PUSHED = "b".repeat(40);

/**
 * A REST seam answering one pull request, the first `listed` of its files from compare or in pages of 100, and CODEOWNERS at
 * `.github/`. Each read of the pull request answers the next of `heads`, the last one repeating.
 */
function github({
  files,
  body = "",
  listed = files.length,
  heads = [HEAD],
  baseShas = ["cccccccccccc"],
  errorLines = [],
  errorsFail = false,
}: {
  files: readonly string[];
  body?: string;
  listed?: number;
  heads?: readonly string[];
  baseShas?: readonly string[];
  /** The CODEOWNERS lines GitHub's errors endpoint reports. */
  errorLines?: readonly number[];
  /** Whether that read fails instead. */
  errorsFail?: boolean;
}): { rest: GithubReadRest; asked: string[] } {
  const asked: string[] = [];
  let reads = 0;
  const rest: GithubReadRest = async ({ route, params }) => {
    asked.push(`${route} ${JSON.stringify(params)}`);
    if (route === "GET /repos/{owner}/{repo}/pulls/{pull_number}") {
      const sha = heads[Math.min(reads, heads.length - 1)]!;
      reads += 1;
      return ok({
        data: {
          base: { ref: "staging", sha: baseShas[Math.min(reads - 1, baseShas.length - 1)]! },
          body,
          changed_files: files.length,
          head: { sha },
          state: "open",
          user: { login: "ada" },
        },
      });
    }
    if (route === "GET /repos/{owner}/{repo}/compare/{basehead}") {
      return ok({ data: { files: files.slice(0, listed).map((filename) => ({ filename })) } });
    }
    if (route === "GET /repos/{owner}/{repo}/pulls/{pull_number}/files") {
      const page = Number(params["page"]);
      const slice = files.slice(0, listed).slice((page - 1) * 100, page * 100);
      return ok({ data: slice.map((filename) => ({ filename })) });
    }
    if (route === "GET /repos/{owner}/{repo}/codeowners/errors" && !errorsFail) {
      return ok({ data: { errors: errorLines.map((line) => ({ line, path: ".github/CODEOWNERS" })) } });
    }
    if (params["path"] === ".github/CODEOWNERS") {
      return ok({ data: { content: Buffer.from(CODEOWNERS).toString("base64"), encoding: "base64" } });
    }
    return err(GithubLiveErrors.readFailed({ message: "404 Not Found" }));
  };
  return { asked, rest };
}

/** A resolution the roster confirmed, to `login`. */
function confirmed({ login }: { login: string }): ReviewerResolution {
  const roster = {
    addressableKeys: 1,
    collisions: [],
    derivedPeople: 1,
    freshness: { kind: "fresh" },
    heldPeople: 0,
  } as const;
  return { held: false, roster, target: { login, origin: "override" } };
}

/** Plain recording edges over a REST seam; the roster confirms every login as itself. */
function edges({ rest }: { rest: GithubReadRest }): {
  deps: GithubPrReviewersDeps;
  out: string[];
  diag: string[];
  resolved: (readonly string[])[];
} {
  const out: string[] = [];
  const diag: string[] = [];
  const resolved: (readonly string[])[] = [];
  return {
    deps: {
      out: ({ line }) => out.push(line),
      resolveLogins: async ({ logins }) => {
        resolved.push(logins);
        return ok(logins.map((login) => confirmed({ login: login.toLowerCase() })));
      },
      rest: () => rest,
      writeDiagnostic: ({ line }) => diag.push(line),
    },
    diag,
    out,
    resolved,
  };
}

/** The `--json` report a run printed first, decoded. */
function reportOf({ out }: { out: readonly string[] }): unknown {
  return safeJsonParse({ label: "the reviewers report", text: out[0]! });
}

const FILES = ["apps/helpbot/a.ts", "packages/infra/x.ts", "src/main.ts"];

/** The rows FILES derive to, with `@Quinn` picked for platform. */
const ROWS: readonly ReviewerRow[] = [
  { look: { files: ["apps/helpbot/a.ts"], kind: "files" }, standsInFor: [], who: ["@lionelb"] },
  { look: { files: ["packages/infra/x.ts"], kind: "files" }, standsInFor: ["@acme/platform"], who: ["@quinn"] },
  { look: { kind: "rest" }, standsInFor: [], who: ["@acme/acme-eng"] },
];

/** The rows FILES derive to with no pick: one file each, so the tie goes to the reviewer token's order. */
const UNPICKED: readonly ReviewerRow[] = [
  { look: { files: ["packages/infra/x.ts"], kind: "files" }, standsInFor: [], who: ["@acme/platform"] },
  ROWS[0]!,
  ROWS[2]!,
];

describe("parseGithubPrReviewersArgs", () => {
  it("collects repeated picks in both spellings", () => {
    const args = unwrap(parseGithubPrReviewersArgs({ rest: [PR, "--pick", "@a/b=@c", "--pick=@d=@e"] }));
    expect(args.picks).toEqual([
      { owner: "@a/b", person: "@c" },
      { owner: "@d", person: "@e" },
    ]);
  });

  it("refuses a malformed pick, a token picked twice, and a missing address, all at once", () => {
    const parsed = parseGithubPrReviewersArgs({ rest: ["--pick", "a=@b", "--pick", "@t=@x", "--pick", "@T=@y"] });
    expect(unwrapErr(parsed)).toEqual([
      '--pick takes @owner=@person, a CODEOWNERS token and the one login standing in for it; got "a=@b"',
      "--pick names @t twice; one person stands in for a token",
      "exactly one pull-request address is required; got 0",
    ]);
  });
});

describe("githubPrReviewersReportOf", () => {
  it("refuses a table while CODEOWNERS owns a changed file by email", () => {
    const report = githubPrReviewersReportOf({
      changedFiles: 3,
      codeownersPath: ".github/CODEOWNERS@staging",
      derived: deriveReviewerTable({
        authorLogin: "author",
        codeowners: "* @org/eng\n*.js reviewer@example.com\n/web/ @org/web",
        erroredLines: [],
        paths: ["src/a.js", "web/b.ts", "src/c.ts"],
        picks: [],
      }),
      url: PR,
    });
    expect(report.refusal).toBe(
      "CODEOWNERS names the owner of src/a.js by email, which a row cannot tag; name them by @login there",
    );
    // The report carries no edit and no deep links: a C3 description publishes no reviewer table to write.
    expect(Object.keys(report).toSorted()).toEqual(["changedFiles", "codeownersPath", "derived", "refusal", "url"]);
  });
});

/** The derived table's `--json` shape over FILES: every list beside the rows empty. */
function tableReport({ rows }: { rows: readonly ReviewerRow[] }): unknown {
  return {
    changedFiles: 3,
    codeownersPath: ".github/CODEOWNERS@staging",
    derived: { emailOwned: [], erroredRule: [], kind: "table", rows, unowned: [], unusedPicks: [] },
    url: PR,
  };
}

describe("runGithubPrReviewers", () => {
  it("derives the table from the base branch's CODEOWNERS, a pick resolved through the roster", async () => {
    const { asked, rest } = github({ files: FILES });
    const run = edges({ rest });
    const code = await runGithubPrReviewers({
      deps: run.deps,
      rest: [PR, "--pick", "@acme/platform=@Quinn", "--json"],
    });
    expect(code).toBe(EXIT_OK);
    expect(reportOf({ out: run.out })).toStrictEqual(tableReport({ rows: ROWS }));
    expect(asked.filter((line) => line.includes("contents"))).toEqual([
      'GET /repos/{owner}/{repo}/contents/{path} {"owner":"acme","path":".github/CODEOWNERS","ref":"staging","repo":"acme-admin"}',
    ]);
    expect(run.resolved).toEqual([["Quinn"]]);
  });

  it("derives one row per reviewer with no pick, consulting no roster", async () => {
    const run = edges({ rest: github({ files: FILES }).rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR, "--json"] })).toBe(EXIT_OK);
    expect(reportOf({ out: run.out })).toStrictEqual(tableReport({ rows: UNPICKED }));
    expect(run.resolved).toEqual([]);
  });

  it("prints the table as a reader of the terminal reads it, and no command that writes it", async () => {
    const run = edges({ rest: github({ files: FILES }).rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR] })).toBe(EXIT_OK);
    expect(run.out[0]).toBe(`${PR}: 3 changed files against .github/CODEOWNERS@staging`);
    expect(run.out.some((line) => line.includes("github pr update"))).toBe(false);
    expect(run.out).toEqual([
      `${PR}: 3 changed files against .github/CODEOWNERS@staging`,
      "  @acme/platform: packages/infra/x.ts",
      "  @lionelb: apps/helpbot/a.ts",
      "  @acme/acme-eng: everything else",
    ]);
  });

  it("prints a picked person on the row of the team they stand in for", async () => {
    const run = edges({ rest: github({ files: FILES }).rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR, "--pick", "@acme/platform=@Quinn"] })).toBe(EXIT_OK);
    expect(run.out).toEqual([
      `${PR}: 3 changed files against .github/CODEOWNERS@staging`,
      "  @lionelb: apps/helpbot/a.ts",
      "  @quinn (for @acme/platform): packages/infra/x.ts",
      "  @acme/acme-eng: everything else",
    ]);
  });

  it("reads the file list from the compare of the two commits the pull request reported, never its own list", async () => {
    const { asked, rest } = github({ files: FILES });
    const run = edges({ rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR] })).toBe(EXIT_OK);
    expect(asked.filter((line) => line.includes("/compare/") || line.includes("/files"))).toEqual([
      `GET /repos/{owner}/{repo}/compare/{basehead} {"basehead":"cccccccccccc...${HEAD}","owner":"acme","page":1,"per_page":1,"repo":"acme-admin"}`,
    ]);
  });

  it("reads every page of the pull request's own list past compare's 300 files", async () => {
    const many = Array.from({ length: 300 }, (_, index) => `src/f${String(index)}.ts`);
    const { asked, rest } = github({ files: [...many, "apps/helpbot/a.ts"] });
    const run = edges({ rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR] })).toBe(EXIT_OK);
    expect(asked.filter((line) => line.includes("/files")).length).toBe(4);
    expect(asked.filter((line) => line.includes("/compare/"))).toEqual([]);
  });

  it("refuses a file list GitHub did not answer whole, and reads no roster", async () => {
    const run = edges({ rest: github({ files: FILES, listed: 2 }).rest });
    const pick = ["--pick", "@acme/platform=@Quinn"];
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR, ...pick] })).toBe(EXIT_ERROR);
    expect(run.diag).toEqual([
      "GitHub listed 2 of the 3 changed files, and a table over part of a diff misleads every row",
    ]);
    expect(run.resolved).toEqual([]);
    expect(run.out).toEqual([]);
  });

  it("refuses --apply as usage before any read, naming where a review ask goes instead", async () => {
    const { asked, rest } = github({ files: FILES });
    const run = edges({ rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR, "--apply"] })).toBe(EXIT_USAGE);
    expect(run.diag).toEqual([`refused: ${REVIEWERS_APPLY_RETIRED}`]);
    expect(asked).toEqual([]);
    expect(run.out).toEqual([]);
  });

  it("is expected-empty with no table to derive", async () => {
    const run = edges({ rest: github({ files: ["src/a.ts"] }).rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.out[1]).toBe(
      "one reviewer covers every owned file (@acme/acme-eng), which GitHub already says, so there is no table",
    );
  });

  it("refuses a pick whose token owns no changed file", async () => {
    const run = edges({ rest: github({ files: FILES }).rest });
    const code = await runGithubPrReviewers({ deps: run.deps, rest: [PR, "--pick", "@acme/sql=@smith"] });
    expect(code).toBe(EXIT_ERROR);
    expect(run.out.at(-1)).toBe(
      "refused: --pick @acme/sql=@smith stands in for nothing: that token owns no changed file, or the person is the author",
    );
  });

  it("refuses a pick when the roster store cannot say who the token names", async () => {
    const run = edges({ rest: github({ files: FILES }).rest });
    const storeDown = IdentityRosterErrors.storeUnavailable({ doing: "read the roster", reason: "disk full" });
    const deps: GithubPrReviewersDeps = { ...run.deps, resolveLogins: async () => err(storeDown) };
    const code = await runGithubPrReviewers({ deps, rest: [PR, "--pick", "@acme/platform=@Quinn"] });
    expect(code).toBe(EXIT_ERROR);
    expect(run.diag).toEqual([storeDown.message]);
    expect(run.out).toEqual([]);
  });

  it("refuses the table when GitHub reports an error on the line deciding a changed file", async () => {
    const run = edges({ rest: github({ errorLines: [2], files: FILES }).rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR, "--json"] })).toBe(EXIT_ERROR);
    expect(reportOf({ out: run.out })).toStrictEqual({
      changedFiles: 3,
      codeownersPath: ".github/CODEOWNERS@staging",
      derived: {
        emailOwned: [],
        erroredRule: [{ line: 2, path: "packages/infra/x.ts" }],
        kind: "table",
        rows: UNPICKED,
        unowned: [],
        unusedPicks: [],
      },
      refusal:
        "GitHub reports an error on the CODEOWNERS line deciding packages/infra/x.ts (line 2), so it may not ask who that line names; fix the line and re-run",
      url: PR,
    });
  });

  it("refuses rather than derives when GitHub's CODEOWNERS errors cannot be read", async () => {
    const run = edges({ rest: github({ errorsFail: true, files: FILES }).rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR] })).toBe(EXIT_ERROR);
    expect(run.diag).toEqual(["404 Not Found"]);
    expect(run.out).toEqual([]);
  });

  it("prints no table without --apply when the head moved, so no printed row is of another head", async () => {
    const run = edges({ rest: github({ files: FILES, heads: [HEAD, PUSHED] }).rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR] })).toBe(EXIT_ERROR);
    expect(run.out).toEqual([]);
    expect(run.diag).toEqual([
      `${PR} moved while the table was derived (head aaaaaaaaa read first), so nothing was printed or written. Run it again`,
    ]);
  });

  it("prints no table when the base moved after CODEOWNERS was read", async () => {
    const run = edges({ rest: github({ baseShas: ["cccccccccccc", "dddddddddddd"], files: FILES }).rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: [PR] })).toBe(EXIT_ERROR);
    expect(run.out).toEqual([]);
    expect(run.diag).toEqual([
      `${PR} moved while the table was derived (head aaaaaaaaa read first), so nothing was printed or written. Run it again`,
    ]);
  });

  it("refuses an issue address as usage, before any read", async () => {
    const { asked, rest } = github({ files: FILES });
    const run = edges({ rest });
    expect(await runGithubPrReviewers({ deps: run.deps, rest: ["https://github.com/acme/acme-admin/issues/7"] })).toBe(
      EXIT_USAGE,
    );
    expect(asked).toEqual([]);
  });
});
