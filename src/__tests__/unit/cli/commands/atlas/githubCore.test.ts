/**
 * The GitHub atlas verbs' pure half: list splitting, coordinate checks, the sync and walk parses, the sync's
 * exit judgement, and the human-readable lines both verbs print.
 */
import { describe, expect, it } from "vitest";

import type { GithubSyncSummary } from "../../../../../atlas/github/sync.js";
import type { WebSurfaceOutcome } from "../../../../../atlas/github/webSurface.js";
import {
  exitCodeForGithubSync,
  parseGithubSyncOptions,
  parseGithubWalkOptions,
  renderGithubSync,
  renderGithubWalk,
  repositoryCoordinateProblems,
  splitList,
} from "../../../../../cli/commands/atlas/githubCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SYNC_USAGE =
  "usage: slopweaver atlas github sync [--orgs <login,...>] [--repos <owner/repo,...>] [--json] [--home <dir>]";
const WALK_USAGE =
  "usage: slopweaver atlas github walk [--orgs <login,...>] [--repos <owner/repo,...>] [--rounds <n>] [--json] [--home <dir>]";

/** A finished sync's summary with nothing uncovered, overridable per test. */
function summary({ over = {} }: { over?: Partial<GithubSyncSummary> } = {}): GithubSyncSummary {
  return { at: "2026-10-13T00:00:00.000Z", counts: {}, failures: [], uncovered: [], written: [], ...over };
}

describe("splitList", () => {
  it("trims entries, keeps their order and drops empty ones", () => {
    expect(splitList({ value: " beta , ,alpha,, gamma " })).toEqual(["beta", "alpha", "gamma"]);
  });

  it("answers an empty list for an absent flag", () => {
    expect(splitList({ value: undefined })).toEqual([]);
  });
});

describe("repositoryCoordinateProblems", () => {
  it("accepts owner/repo and refuses a bare name, a missing owner, a missing repo and a third segment", () => {
    expect(
      repositoryCoordinateProblems({ repositories: ["owner/repo", "repo", "/repo", "owner/", "owner/repo/extra"] }),
    ).toEqual([
      '--repos takes owner/repo entries, not "repo"',
      '--repos takes owner/repo entries, not "/repo"',
      '--repos takes owner/repo entries, not "owner/"',
      '--repos takes owner/repo entries, not "owner/repo/extra"',
    ]);
  });
});

describe("parseGithubSyncOptions", () => {
  it("resolves an explicit home, JSON and both scope lists", () => {
    const parsed = parseGithubSyncOptions({
      defaultHome: "/default-home",
      rest: ["--home", "/given-home", "--json", "--orgs", "acme, widgets", "--repos", "acme/api,widgets/web"],
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({
      home: "/given-home",
      json: true,
      organisations: ["acme", "widgets"],
      repositories: ["acme/api", "widgets/web"],
    });
  });

  it("takes the default home and empty scopes when no flag is passed", () => {
    expect(unwrap(parseGithubSyncOptions({ defaultHome: "/default-home", rest: [] }))).toEqual({
      home: "/default-home",
      json: false,
      organisations: [],
      repositories: [],
    });
  });

  it("refuses a bare repository name with the problem line followed by the sync usage line", () => {
    const parsed = parseGithubSyncOptions({ defaultHome: "/default-home", rest: ["--repos", "acme/api,web"] });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(['--repos takes owner/repo entries, not "web"', SYNC_USAGE]);
  });
});

describe("parseGithubWalkOptions", () => {
  it("accepts --rounds 1 and refuses --rounds 0 with the problem line and the walk usage line", () => {
    const accepted = parseGithubWalkOptions({ defaultHome: "/default-home", rest: ["--rounds", "1"] });
    const refused = parseGithubWalkOptions({ defaultHome: "/default-home", rest: ["--rounds", "0"] });
    expect(unwrap(accepted)).toEqual({
      home: "/default-home",
      json: false,
      organisations: [],
      repositories: [],
      rounds: 1,
    });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused)).toEqual(['--rounds takes a positive integer, not "0"', WALK_USAGE]);
  });

  it("carries rounds as null when the flag is absent", () => {
    expect(unwrap(parseGithubWalkOptions({ defaultHome: "/default-home", rest: ["--json"] })).rounds).toBe(null);
  });

  it("reads --rounds 2x as its leading integer 2 and refuses --rounds x, which has no numeric prefix", () => {
    const prefixed = parseGithubWalkOptions({ defaultHome: "/default-home", rest: ["--rounds", "2x"] });
    const unprefixed = parseGithubWalkOptions({ defaultHome: "/default-home", rest: ["--rounds", "x"] });
    expect(unwrap(prefixed).rounds).toBe(2);
    expect(unwrapErr(unprefixed)).toEqual(['--rounds takes a positive integer, not "x"', WALK_USAGE]);
  });

  it("reports a coordinate problem and a rounds problem together, before one usage line", () => {
    const parsed = parseGithubWalkOptions({ defaultHome: "/default-home", rest: ["--repos", "web", "--rounds", "-1"] });
    expect(unwrapErr(parsed)).toEqual([
      '--repos takes owner/repo entries, not "web"',
      '--rounds takes a positive integer, not "-1"',
      WALK_USAGE,
    ]);
  });
});

describe("exitCodeForGithubSync", () => {
  it("answers 0 with nothing uncovered and 1 with one uncovered kind", () => {
    expect(exitCodeForGithubSync({ summary: summary() })).toBe(0);
    expect(exitCodeForGithubSync({ summary: summary({ over: { uncovered: ["ruleset"] } }) })).toBe(1);
  });
});

describe("renderGithubSync", () => {
  it("prints counts sorted by kind, then each refusal, then the uncovered kinds", () => {
    const lines = renderGithubSync({
      summary: summary({
        over: {
          counts: { webhook: 3, "actions-policy": 1, ruleset: 0 },
          failures: [{ reason: "HTTP 403: resource not accessible", route: "GET /orgs/acme/hooks" }],
          uncovered: ["webhook", "ruleset"],
        },
      }),
    });
    expect(lines).toEqual([
      "github atlas synced at 2026-10-13T00:00:00.000Z",
      "  actions-policy: 1",
      "  ruleset: 0",
      "  webhook: 3",
      "  REFUSED GET /orgs/acme/hooks: HTTP 403: resource not accessible",
      "  UNCOVERED: webhook, ruleset — a mandatory kind that is neither read nor honestly absent",
    ]);
  });

  it("prints no UNCOVERED line when nothing is uncovered", () => {
    expect(renderGithubSync({ summary: summary({ over: { counts: { webhook: 2 } } }) })).toEqual([
      "github atlas synced at 2026-10-13T00:00:00.000Z",
      "  webhook: 2",
    ]);
  });
});

describe("renderGithubWalk", () => {
  it("prints the page and endpoint totals, then one line per written path", () => {
    const outcome: WebSurfaceOutcome = {
      landedCount: 4,
      pageCount: 5,
      photographedCount: 3,
      requestCount: 12,
      undeclaredRequestCount: 2,
      written: ["admin-page.json", "web-request.json"],
    };
    expect(renderGithubWalk({ outcome })).toEqual([
      "github admin walk: 5 page(s) attempted, 4 landed, 3 photographed",
      "  12 distinct endpoint(s) observed, 2 of them not declared in GitHub's own published description",
      "  wrote admin-page.json",
      "  wrote web-request.json",
    ]);
  });
});
