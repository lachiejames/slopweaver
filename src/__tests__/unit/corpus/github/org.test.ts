import { describe, expect, it } from "vitest";
import { type GithubOrgError, GithubOrgErrors } from "../../../../corpus/github/errors.js";
import {
  enumerateOrgRepos,
  fetchGithubStructures,
  globToRegExp,
  selectRepoNames,
} from "../../../../corpus/github/org.js";
import {
  DEFAULT_GITHUB_PAGE_CAP,
  type GithubOrgApi,
  type PagedList,
  pageCeilingWarning,
  pageToCeiling,
} from "../../../../corpus/github/orgApi.js";
import { projectOrgRow, projectRepoRow, projectTeamRow } from "../../../../corpus/github/orgRows.js";
import { err, ok, type Result, unwrap } from "../../../../lib/result.js";

const AT = "2026-07-20T00:00:00.000Z";

describe("globToRegExp", () => {
  it("matches a `*` glob as any run and stays anchored", () => {
    expect(globToRegExp({ glob: "app-*" }).test("app-web")).toBe(true);
    expect(globToRegExp({ glob: "app-*" }).test("lib-app-web")).toBe(false);
  });
});

describe("selectRepoNames", () => {
  it("keeps includes, drops excludes, and applies the cap with a warning", () => {
    const selection = selectRepoNames({
      cap: 2,
      exclude: ["*-archive"],
      include: ["app-*"],
      names: ["app-web", "app-api", "app-old-archive", "app-cli", "infra"],
    });
    expect(selection.selected).toEqual(["app-api", "app-cli"]);
    expect(selection.excluded).toEqual(["app-old-archive"]);
    expect(selection.cappedCount).toBe(1);
    // Every skip is logged — include filter, exclude globs, and cap (no silent truncation).
    expect(selection.warnings).toEqual([
      "github: 1 repo(s) filtered out by --include-repo (4 matched)",
      "github: 1 repo(s) skipped by --exclude-repo",
      "github: repo cap 2 applied — 1 of 3 repo(s) skipped",
    ]);
  });

  it("keeps everything with no include/exclude/cap", () => {
    expect(selectRepoNames({ cap: undefined, exclude: [], include: [], names: ["b", "a"] }).selected).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("projectOrgRow / projectRepoRow / projectTeamRow", () => {
  it("projects an org row", () => {
    const row = projectOrgRow({
      fetchedAtIso: AT,
      raw: { html_url: "https://github.com/acme", login: "acme", public_repos: 12 },
    })!;
    expect(row.kind).toBe("org");
    expect(row.sourceId).toBe("acme");
    expect(row.attrs["publicRepos"]).toBe(12);
  });

  it("projects a repo row with visibility/archived attrs", () => {
    const row = projectRepoRow({
      fetchedAtIso: AT,
      raw: {
        archived: true,
        default_branch: "main",
        full_name: "acme/app",
        language: "TypeScript",
        name: "app",
        private: true,
      },
    })!;
    expect(row.sourceId).toBe("acme/app");
    expect(row.attrs).toEqual({
      archived: true,
      defaultBranch: "main",
      fork: false,
      language: "TypeScript",
      private: true,
    });
  });

  it("projects a team row with member + repo-permission relations", () => {
    const row = projectTeamRow({
      fetchedAtIso: AT,
      members: [{ login: "octocat" }, { login: "hubber" }],
      raw: { name: "Platform", slug: "platform" },
      repos: [{ full_name: "acme/app", permission: "admin" }],
    })!;
    expect(row.relations).toEqual([
      { targetId: "github:octocat", targetKind: "person", targetSource: "person", type: "member" },
      { targetId: "github:hubber", targetKind: "person", targetSource: "person", type: "member" },
      {
        attrs: { permission: "admin" },
        targetId: "acme/app",
        targetKind: "repo",
        targetSource: "github",
        type: "permission",
      },
    ]);
  });
});

/** A fake org seam over seeded pages. `teamsResult` controls the read:org degrade path. */
function fakeApi({
  repos = [
    { full_name: "acme/app", name: "app" },
    { full_name: "acme/lib", name: "lib" },
  ],
  teamsResult = ok({ items: [{ name: "Platform", slug: "platform" }], pageCap: 20, truncated: false }),
  org = { login: "acme" },
  members = { items: [{ login: "octocat" }], pageCap: 20, truncated: false },
  teamRepos = { items: [{ full_name: "acme/app", permission: "push" }], pageCap: 20, truncated: false },
}: {
  repos?: readonly unknown[];
  teamsResult?: Result<PagedList, GithubOrgError>;
  org?: unknown;
  members?: PagedList;
  teamRepos?: PagedList;
} = {}): GithubOrgApi {
  return {
    getOrg: async () => org,
    listRepos: async ({ page }) => (page === 1 ? repos : []),
    listTeamMembers: async () => members,
    listTeamRepos: async () => teamRepos,
    listTeams: async () => teamsResult,
  };
}

/** One FULL page of `PER_PAGE` (100) distinct repos — a short page is the only thing that ends a walk. */
function fullRepoPage({ page }: { page: number }): readonly unknown[] {
  return Array.from({ length: 100 }, (_unused, index) => ({
    full_name: `acme/r${String(page)}-${String(index)}`,
    name: `r${String(page)}-${String(index)}`,
  }));
}

/** A seam whose repo list NEVER runs short — every page is full, so only the ceiling can stop the walk. */
function endlessReposApi(): GithubOrgApi {
  return { ...fakeApi({}), listRepos: async ({ page }) => fullRepoPage({ page }) };
}

describe("pageToCeiling", () => {
  it("walks to exhaustion on a SHORT page and reports it whole", async () => {
    const walked = await pageToCeiling({
      fetch: async (page) => (page === 1 ? fullRepoPage({ page }) : fullRepoPage({ page }).slice(0, 7)),
      pageCap: 20,
    });
    expect(walked.items.length).toBe(107);
    expect(walked.truncated).toBe(false);
    expect(walked.pageCap).toBe(20);
  });

  it("stops at the ceiling with a FULL last page and reports the walk TRUNCATED", async () => {
    const walked = await pageToCeiling({ fetch: async (page) => fullRepoPage({ page }), pageCap: 3 });
    expect(walked.items.length).toBe(300);
    expect(walked.truncated).toBe(true);
    expect(walked.pageCap).toBe(3);
  });

  it("reports an EMPTY first page whole (zero is a short page, not a ceiling)", async () => {
    const walked = await pageToCeiling({ fetch: async () => [], pageCap: 20 });
    expect(walked.items).toEqual([]);
    expect(walked.truncated).toBe(false);
  });
});

describe("pageCeilingWarning", () => {
  it("names the ceiling the walk stopped at, the count reached and the flag that raises it", () => {
    const listed = { items: fullRepoPage({ page: 1 }), pageCap: 20, truncated: true };
    expect(pageCeilingWarning({ listed, what: "org repo" })).toBe(
      "github: org repo enumeration stopped at the 20-page ceiling with 100 listed and more may exist — " +
        "raise it with --github-page-cap",
    );
  });
});

describe("DEFAULT_GITHUB_PAGE_CAP", () => {
  it("is the 20 pages (2,000 items) the org lanes have always walked", () => {
    expect(DEFAULT_GITHUB_PAGE_CAP).toBe(20);
  });
});

describe("enumerateOrgRepos", () => {
  it("returns the selected repo coordinates", async () => {
    const result = unwrap(
      await enumerateOrgRepos({
        api: fakeApi({}),
        cap: undefined,
        exclude: ["lib"],
        include: [],
        org: "acme",
        pageCap: DEFAULT_GITHUB_PAGE_CAP,
      }),
    );
    expect(result.repos).toEqual([{ owner: "acme", repo: "app" }]);
    // The exclude glob warns; a walk that ended on a SHORT page adds nothing beside it.
    expect(result.warnings).toEqual(["github: 1 repo(s) skipped by --exclude-repo"]);
  });

  it("WARNS — never truncates silently — when the org outruns the page ceiling", async () => {
    const result = unwrap(
      await enumerateOrgRepos({
        api: endlessReposApi(),
        cap: undefined,
        exclude: [],
        include: [],
        org: "acme",
        pageCap: 2,
      }),
    );
    expect(result.repos.length).toBe(200);
    expect(result.warnings).toEqual([
      "github: org repo enumeration stopped at the 2-page ceiling with 200 listed and more may exist — " +
        "raise it with --github-page-cap",
    ]);
  });

  it("raises the ceiling with the flag, so a bigger org enumerates whole and warns about nothing", async () => {
    const api: GithubOrgApi = {
      ...fakeApi({}),
      listRepos: async ({ page }) => (page <= 3 ? fullRepoPage({ page }) : []),
    };
    const result = unwrap(
      await enumerateOrgRepos({ api, cap: undefined, exclude: [], include: [], org: "acme", pageCap: 4 }),
    );
    expect(result.repos.length).toBe(300);
    expect(result.warnings).toEqual([]);
  });
});

describe("fetchGithubStructures", () => {
  it("captures org + repo + team rows (+ relations) from the seam", async () => {
    const result = unwrap(
      await fetchGithubStructures({
        api: fakeApi({}),
        cap: undefined,
        exclude: [],
        fetchedAtIso: AT,
        include: [],
        org: "acme",
        pageCap: DEFAULT_GITHUB_PAGE_CAP,
      }),
    );
    const kinds = result.rows.map((r) => r.kind).toSorted();
    expect(kinds).toEqual(["org", "repo", "repo", "team"]);
    expect(result.repos).toEqual([
      { owner: "acme", repo: "app" },
      { owner: "acme", repo: "lib" },
    ]);
  });

  it("DEGRADES to a warning (no team rows) when teams need read:org", async () => {
    const result = unwrap(
      await fetchGithubStructures({
        api: fakeApi({
          teamsResult: err(GithubOrgErrors.teamsUnavailable({ reason: "403" })),
        }),
        cap: undefined,
        exclude: [],
        fetchedAtIso: AT,
        include: [],
        org: "acme",
        pageCap: DEFAULT_GITHUB_PAGE_CAP,
      }),
    );
    expect(result.rows.some((r) => r.kind === "team")).toBe(false);
    expect(result.warnings).toContain("github: teams unavailable (403) — needs an org-admin token with read:org");
  });

  it("DEGRADES a per-team members failure to a warning (team row still lands, no crash)", async () => {
    const flakyApi: GithubOrgApi = {
      ...fakeApi({}),
      listTeamMembers: async () => {
        throw new Error("403 forbidden");
      },
    };
    const result = unwrap(
      await fetchGithubStructures({
        api: flakyApi,
        cap: undefined,
        exclude: [],
        fetchedAtIso: AT,
        include: [],
        org: "acme",
        pageCap: DEFAULT_GITHUB_PAGE_CAP,
      }),
    );
    expect(result.rows.some((r) => r.kind === "team")).toBe(true);
    expect(result.warnings).toContain("github team platform members unavailable: 403 forbidden");
  });

  it("WARNS on a repo walk that hit the ceiling, before the selection warnings", async () => {
    const result = unwrap(
      await fetchGithubStructures({
        api: endlessReposApi(),
        cap: 5,
        exclude: [],
        fetchedAtIso: AT,
        include: [],
        org: "acme",
        pageCap: 2,
      }),
    );
    expect(result.warnings[0]).toBe(
      "github: org repo enumeration stopped at the 2-page ceiling with 200 listed and more may exist — " +
        "raise it with --github-page-cap",
    );
  });

  it("WARNS per truncated team list (teams, its members, its repos) naming the ceiling EACH walk hit", async () => {
    // The seam's lists carry their own ceiling (7): the warning names that one, not the repo walk's (20).
    const result = unwrap(
      await fetchGithubStructures({
        api: fakeApi({
          members: { items: [{ login: "octocat" }], pageCap: 7, truncated: true },
          teamRepos: { items: [{ full_name: "acme/app", permission: "push" }], pageCap: 7, truncated: true },
          teamsResult: ok({ items: [{ name: "Platform", slug: "platform" }], pageCap: 7, truncated: true }),
        }),
        cap: undefined,
        exclude: [],
        fetchedAtIso: AT,
        include: [],
        org: "acme",
        pageCap: DEFAULT_GITHUB_PAGE_CAP,
      }),
    );
    expect(result.warnings).toEqual([
      "github: org team enumeration stopped at the 7-page ceiling with 1 listed and more may exist — " +
        "raise it with --github-page-cap",
      "github: team platform members enumeration stopped at the 7-page ceiling with 1 listed and more may " +
        "exist — raise it with --github-page-cap",
      "github: team platform repos enumeration stopped at the 7-page ceiling with 1 listed and more may exist — " +
        "raise it with --github-page-cap",
    ]);
  });

  it("skips the org row + warns when org info is unavailable", async () => {
    const noOrgApi: GithubOrgApi = { ...fakeApi({}), getOrg: async () => undefined };
    const result = unwrap(
      await fetchGithubStructures({
        api: noOrgApi,
        cap: undefined,
        exclude: [],
        fetchedAtIso: AT,
        include: [],
        org: "acme",
        pageCap: DEFAULT_GITHUB_PAGE_CAP,
      }),
    );
    expect(result.rows.some((r) => r.kind === "org")).toBe(false);
    expect(result.warnings).toContain("github: org info unavailable (orgs.get) — org row skipped");
  });
});
