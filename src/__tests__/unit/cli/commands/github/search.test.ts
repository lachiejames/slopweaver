import { describe, expect, it } from "vitest";
import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import { parseGithubSearchArgs } from "../../../../../cli/commands/github/searchCore.js";
import {
  completeRefusalLine,
  type GithubSearchDeps,
  runGithubSearch,
} from "../../../../../cli/commands/github/searchRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import type { GithubSearchDocument } from "../../../../../live/github/search.js";

describe("parseGithubSearchArgs", () => {
  it("joins a multi-word term and defaults limit, repo and home", () => {
    expect(unwrap(parseGithubSearchArgs({ rest: ["fix", "the", "login", "bug"] }))).toEqual({
      complete: false,
      home: undefined,
      json: false,
      limit: 10,
      repo: undefined,
      term: "fix the login bug",
    });
  });

  it("parses every flag when given", () => {
    expect(
      unwrap(
        parseGithubSearchArgs({
          rest: ["a-term", "--repo", "acme/widget", "--limit", "5", "--json", "--home", "/h", "--complete"],
        }),
      ),
    ).toEqual({ complete: true, home: "/h", json: true, limit: 5, repo: "acme/widget", term: "a-term" });
  });

  it("requests the whole page under --complete when no --limit was typed", () => {
    expect(unwrap(parseGithubSearchArgs({ rest: ["is:pr is:open", "--complete"] })).limit).toBe(100);
  });

  it("keeps a typed --limit under --complete", () => {
    expect(unwrap(parseGithubSearchArgs({ rest: ["is:pr is:open", "--complete", "--limit", "25"] })).limit).toBe(25);
  });

  it("refuses a missing term before any flag is read", () => {
    expect(githubVerbErrorLines({ error: unwrapErr(parseGithubSearchArgs({ rest: [] })) })).toEqual([
      "a search term is required",
    ]);
  });

  it("refuses a limit outside 1..100", () => {
    expect(
      githubVerbErrorLines({ error: unwrapErr(parseGithubSearchArgs({ rest: ["a-term", "--limit", "101"] })) }),
    ).toEqual(["--limit must be an integer from 1 to 100"]);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    expect(
      githubVerbErrorLines({ error: unwrapErr(parseGithubSearchArgs({ rest: ["a-term", "--kind", "page"] })) }),
    ).toEqual(["unknown flag: --kind"]);
  });
});

const REPO = { owner: "acme", repo: "widget" };

function depsFor({
  out,
  diagnostic,
  document,
}: {
  out: string[];
  diagnostic: string[];
  document: GithubSearchDocument;
}): GithubSearchDeps {
  return {
    resolveRepo: ({ explicit }) => (explicit === undefined ? ok(REPO) : ok({ owner: "explicit", repo: explicit })),
    search: () => Promise.resolve(ok(document)),
    writeDiagnostic: (line) => diagnostic.push(line),
    writeOut: (line) => out.push(line),
  };
}

const MATCH_DOCUMENT: GithubSearchDocument = {
  coverage: { detail: "all 1 match(es) on one page (--limit 10)", kind: "complete", residue: [] },
  matches: [
    {
      identity: "acme/widget#3",
      kind: "issue",
      number: 3,
      state: "open",
      title: "A bug",
      updatedAt: "2026-08-01T00:00:00Z",
      url: "https://github.com/acme/widget/issues/3",
    },
  ],
  repo: "acme/widget",
  searchedAtIso: "2026-08-10T12:00:00.000Z",
  source: "github",
  term: "a bug",
  totalCount: 1,
};

const EMPTY_DOCUMENT: GithubSearchDocument = { ...MATCH_DOCUMENT, matches: [], totalCount: 0 };

const BOUNDED_DOCUMENT: GithubSearchDocument = {
  ...MATCH_DOCUMENT,
  coverage: {
    detail: "1 of 13 match(es) — 12 withheld by the page bound (--limit 1)",
    kind: "bounded",
    residue: [],
  },
  term: "is:pr is:open",
  totalCount: 13,
};

describe("runGithubSearch", () => {
  it("exits EXIT_EXPECTED_EMPTY for zero matches in human mode too, and names the repo on its first line", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    const code = await runGithubSearch({
      deps: depsFor({ diagnostic, document: EMPTY_DOCUMENT, out }),
      rest: ["nothing matches"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(diagnostic).toEqual([]);
    expect(out[0]!.split("\n")[0]).toBe('github search "a bug" in acme/widget');
    expect(out[0]!.split("\n").at(-1)).toBe("no match found");
  });

  it("decides one exit code per document, whichever renderer runs", async () => {
    const codes: number[] = [];
    for (const document of [EMPTY_DOCUMENT, MATCH_DOCUMENT]) {
      const human = await runGithubSearch({ deps: depsFor({ diagnostic: [], document, out: [] }), rest: ["t"] });
      const json = await runGithubSearch({
        deps: depsFor({ diagnostic: [], document, out: [] }),
        rest: ["t", "--json"],
      });
      codes.push(human, json);
    }

    expect(codes).toEqual([EXIT_EXPECTED_EMPTY, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_OK]);
  });

  it("hands --home to repo resolution, so the refusal reads the same profile the search does", async () => {
    const seen: { explicit: string | undefined; home: string | undefined }[] = [];

    const code = await runGithubSearch({
      deps: {
        resolveRepo: (args) => {
          seen.push(args);
          return ok(REPO);
        },
        search: () => Promise.resolve(ok(MATCH_DOCUMENT)),
        writeDiagnostic: () => undefined,
        writeOut: () => undefined,
      },
      rest: ["a bug", "--home", "/h"],
    });

    expect(code).toBe(EXIT_OK);
    expect(seen).toEqual([{ explicit: undefined, home: "/h" }]);
  });

  it("emits one JSON document and exits EXIT_OK when a match is found", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    const code = await runGithubSearch({
      deps: depsFor({ diagnostic, document: MATCH_DOCUMENT, out }),
      rest: ["a bug", "--json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(diagnostic).toEqual([]);
    expect(out).toEqual([JSON.stringify(MATCH_DOCUMENT, undefined, 2)]);
  });

  it("exits EXIT_EXPECTED_EMPTY, not an error, when nothing matched", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    const code = await runGithubSearch({
      deps: depsFor({ diagnostic, document: EMPTY_DOCUMENT, out }),
      rest: ["nothing matches", "--json"],
    });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(diagnostic).toEqual([]);
    expect(out).toEqual([JSON.stringify(EMPTY_DOCUMENT, undefined, 2)]);
  });

  it("under --complete, refuses a bounded page with EXIT_ERROR and nothing on stdout", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    const code = await runGithubSearch({
      deps: depsFor({ diagnostic, document: BOUNDED_DOCUMENT, out }),
      rest: ["is:pr is:open", "--complete", "--json"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(diagnostic).toEqual([
      'github search --complete refused for "is:pr is:open" in acme/widget: 1 of 13 match(es) — 12 withheld by ' +
        "the page bound (--limit 1). The set is UNKNOWN, not a list; nothing was written to stdout.",
    ]);
    expect(completeRefusalLine({ document: BOUNDED_DOCUMENT })).toBe(diagnostic[0]);
  });

  it("under --complete, a complete page is emitted exactly as without the flag", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    const code = await runGithubSearch({
      deps: depsFor({ diagnostic, document: MATCH_DOCUMENT, out }),
      rest: ["a bug", "--complete", "--json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(diagnostic).toEqual([]);
    expect(out).toEqual([JSON.stringify(MATCH_DOCUMENT, undefined, 2)]);
  });

  it("without --complete, a bounded page is still handed back, coverage and all", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    const code = await runGithubSearch({
      deps: depsFor({ diagnostic, document: BOUNDED_DOCUMENT, out }),
      rest: ["is:pr is:open", "--json"],
    });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([JSON.stringify(BOUNDED_DOCUMENT, undefined, 2)]);
  });

  it("refuses a missing term with usage, before repo resolution or search run", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    let resolveRepoCalled = false;
    let searchCalled = false;

    const code = await runGithubSearch({
      deps: {
        resolveRepo: () => {
          resolveRepoCalled = true;
          return ok(REPO);
        },
        search: () => {
          searchCalled = true;
          return Promise.resolve(ok(MATCH_DOCUMENT));
        },
        writeDiagnostic: (line) => diagnostic.push(line),
        writeOut: (line) => out.push(line),
      },
      rest: [],
    });

    expect(code).toBe(EXIT_USAGE);
    expect(resolveRepoCalled).toBe(false);
    expect(searchCalled).toBe(false);
    expect(diagnostic[0]).toBe("a search term is required");
  });

  it("surfaces a repo-resolution failure without calling search", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];
    let searchCalled = false;

    const code = await runGithubSearch({
      deps: {
        resolveRepo: () => err(["no `origin` git remote found — pass --repo owner/repo, or run inside a git checkout"]),
        search: () => {
          searchCalled = true;
          return Promise.resolve(ok(MATCH_DOCUMENT));
        },
        writeDiagnostic: (line) => diagnostic.push(line),
        writeOut: (line) => out.push(line),
      },
      rest: ["a term"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(searchCalled).toBe(false);
    expect(diagnostic).toEqual(["no `origin` git remote found — pass --repo owner/repo, or run inside a git checkout"]);
  });

  it("surfaces a search failure as EXIT_ERROR", async () => {
    const out: string[] = [];
    const diagnostic: string[] = [];

    const code = await runGithubSearch({
      deps: {
        resolveRepo: () => ok(REPO),
        search: () => Promise.resolve(err(GithubLiveErrors.searchFailed({ message: "github search failed" }))),
        writeDiagnostic: (line) => diagnostic.push(line),
        writeOut: (line) => out.push(line),
      },
      rest: ["a term"],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(diagnostic).toEqual(["github search failed"]);
    expect(out).toEqual([]);
  });
});
