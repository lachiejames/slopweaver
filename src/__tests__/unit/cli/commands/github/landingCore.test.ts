import { describe, expect, it } from "vitest";

import {
  fleetReadArgs,
  GITHUB_LANDING_FLAG_NAMES,
  landingRepositories,
  organisationRefusalLine,
  parseGithubLandingArgs,
  resolveRepos,
} from "../../../../../cli/commands/github/landingCore.js";
import {
  DEFAULT_OPT_OUT_LABEL,
  githubLandingUsage,
  NON_OWNER_PRESS_CAP_PER_REPO,
} from "../../../../../cli/commands/github/landingUsage.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { OrganisationErrors } from "../../../../../organisation/errors.js";
import { ACME_ORGANISATION, GLOBEX_ORGANISATION } from "../../../../organisationFixture.js";

describe("landingRepositories", () => {
  it("reads the organisation's own repositories, then this build's, whichever organisation it is", () => {
    expect(landingRepositories({ organisation: ACME_ORGANISATION })).toStrictEqual([
      "acme/acme-admin",
      "octo-self/slopweaver",
    ]);
    expect(landingRepositories({ organisation: GLOBEX_ORGANISATION })).toStrictEqual([
      "globex/web",
      "globex/api",
      "octo-self/slopweaver",
    ]);
  });

  it("names a repository once when the organisation already lists this build's own, whatever its case", () => {
    const organisation = { repositories: ["Acme/Slopweaver", "acme/acme-admin"], selfRepository: "acme/slopweaver" };
    expect(landingRepositories({ organisation })).toStrictEqual(["acme/slopweaver", "acme/acme-admin"]);
  });
});

describe("resolveRepos", () => {
  it("takes an explicit --repo list as given, without reading the organisation", async () => {
    const deps = { readOrganisation: () => Promise.reject(new Error("an explicit list reads no organisation")) };
    const repos = await resolveRepos({ args: { home: undefined, repos: ["acme/widgets"] }, deps });
    expect(unwrap(repos)).toStrictEqual(["acme/widgets"]);
  });

  it("defaults to the organisation's repositories and this build's own when no --repo is given", async () => {
    const deps = { readOrganisation: () => Promise.resolve(ok(GLOBEX_ORGANISATION)) };
    const repos = await resolveRepos({ args: { home: "/h", repos: [] }, deps });
    expect(unwrap(repos)).toStrictEqual(["globex/web", "globex/api", "octo-self/slopweaver"]);
  });

  it("refuses with the organisation's own typed error, forwarded unchanged, when none is written", async () => {
    const refusal = OrganisationErrors.notConfigured({ missing: "organisation" });
    const deps = { readOrganisation: () => Promise.resolve(err(refusal)) };
    const repos = await resolveRepos({ args: { home: "/h", repos: [] }, deps });
    expect(unwrapErr(repos)).toStrictEqual(refusal);
  });
});

describe("organisationRefusalLine", () => {
  it("names the organisation's code, its message, and the flag that gets past it", () => {
    const error = OrganisationErrors.notConfigured({ missing: "organisation" });
    expect(organisationRefusalLine({ error })).toBe(
      `ORG_NOT_CONFIGURED: ${error.message} — or pass --repo <owner/name,...>`,
    );
  });
});

describe("parseGithubLandingArgs", () => {
  it("scopes a read to the owner's own pull requests only under @me, in any case", () => {
    expect(
      [["--author", "@me"], ["--author", "@ME"], ["--author", "octocat"], []].map(
        (rest) => unwrap(parseGithubLandingArgs({ rest })).authoredByOwner,
      ),
    ).toStrictEqual([true, true, false, false]);
  });

  it("defaults to no repositories, no press, and the standing opt-out label", () => {
    const args = unwrap(parseGithubLandingArgs({ rest: [] }));
    expect(args.repos).toEqual([]);
    expect(args.press).toBe(false);
    expect(args.optOutLabels).toEqual([DEFAULT_OPT_OUT_LABEL]);
    expect(args.includeDrafts).toBe(false);
  });

  it("splits --repo on commas and trims each slug", () => {
    const args = unwrap(parseGithubLandingArgs({ rest: ["--repo", "acme/one, acme/two"] }));
    expect(args.repos).toEqual(["acme/one", "acme/two"]);
  });

  it("refuses a --repo value that is not an owner/name slug", () => {
    const parsed = parseGithubLandingArgs({ rest: ["--repo", "widgets"] });
    expect(unwrapErr(parsed)).toEqual(["--repo takes one or more comma-separated owner/name slugs"]);
  });

  // Codex review g3p4-final-landing: `--repo ",,"` parsed to an empty list and fell through to the organisation read.
  it("refuses a typed --repo that names no slug, rather than reading it as absent", () => {
    const parsed = parseGithubLandingArgs({ rest: ["--repo", ",,"] });
    expect(unwrapErr(parsed)).toEqual(["--repo takes one or more comma-separated owner/name slugs"]);
  });

  // Codex review g3p4-landing-repo-set: `--repo /` passed a bare "contains a slash" check and was read as `repo:/`,
  // and a later pass found `acme/..` passing a two-halves check — so the flag shares the organisation's own test.
  it.each(["/", "acme/", "/widgets", "acme/widgets/extra", "acme/..", "acme/.", "acme widgets/web"])(
    "refuses %s, which names no owner/name slug",
    (slug) => {
      expect(unwrapErr(parseGithubLandingArgs({ rest: ["--repo", slug] }))).toEqual([
        "--repo takes one or more comma-separated owner/name slugs",
      ]);
    },
  );

  it("lower-cases every opt-out label so one spelling cannot slip a press through", () => {
    const args = unwrap(parseGithubLandingArgs({ rest: ["--opt-out-label", "No-Auto-Merge,Discussion"] }));
    expect(args.optOutLabels).toEqual(["no-auto-merge", "discussion"]);
  });

  it("refuses --dry-run without --press, which would describe nothing", () => {
    const parsed = parseGithubLandingArgs({ rest: ["--dry-run"] });
    expect(unwrapErr(parsed)).toEqual([
      "--dry-run describes what --press or --register would do, so it needs one of them",
    ]);
  });

  it("refuses --press with --include-drafts, because a draft has no button", () => {
    const parsed = parseGithubLandingArgs({ rest: ["--press", "--include-drafts"] });
    expect(unwrapErr(parsed)).toEqual([
      "--include-drafts cannot be combined with --press: a draft has no button to press",
    ]);
  });

  it("accepts --press with --dry-run", () => {
    const args = unwrap(parseGithubLandingArgs({ rest: ["--press", "--dry-run"] }));
    expect(args.press).toBe(true);
    expect(args.dryRun).toBe(true);
  });

  it("refuses a --limit that is not a positive whole number", () => {
    expect(unwrapErr(parseGithubLandingArgs({ rest: ["--limit", "0"] }))).toEqual([
      "--limit must be a positive whole number",
    ]);
    expect(unwrapErr(parseGithubLandingArgs({ rest: ["--limit", "twelve"] }))).toEqual([
      "--limit must be a positive whole number",
    ]);
  });
});

describe("githubLandingUsage", () => {
  it("has at least one entry in GITHUB_LANDING_FLAG_NAMES, so the guards below are not vacuously green", () => {
    expect(GITHUB_LANDING_FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it("names every flag the parser accepts", () => {
    const usage = githubLandingUsage();
    for (const flag of GITHUB_LANDING_FLAG_NAMES) {
      expect(usage).toContain(flag);
    }
  });

  it("states the press cap it actually enforces, and on whom", () => {
    const usage = githubLandingUsage();
    expect(usage).toContain(`at ${String(NON_OWNER_PRESS_CAP_PER_REPO)} per repository per invocation`);
    expect(usage).toContain("every dependency bump is pressed in the one pass");
    expect(usage).not.toContain("per invocation, through the door");
  });
});

describe("fleetReadArgs", () => {
  // The number that parked a mergeable pull request for four hours. `acme/acme-admin`'s heads carry 93-94
  // check contexts, so a 60-context page dropped a REQUIRED one and `ci-green` answered `unknown` — honestly,
  // and forever, since the only caller that could ask for a larger page is this one. MEASURED: 15
  // of the owner's 27 open pull requests came back truncated and not one row in the fleet read `press`.
  it("asks for the WHOLE check page GitHub allows, not a page smaller than the heads it reads", () => {
    const args = unwrap(parseGithubLandingArgs({ rest: ["--repo", "acme/acme-admin"] }));
    expect(fleetReadArgs({ args, repos: ["acme/acme-admin"] }).checkLimit).toBe(100);
  });
});

describe("parseGithubLandingArgs --pr and --full", () => {
  it("prints the compact facts by default, the table under --full", () => {
    expect(unwrap(parseGithubLandingArgs({ rest: [] })).full).toBe(false);
    expect(unwrap(parseGithubLandingArgs({ rest: ["--full"] })).full).toBe(true);
  });

  it("reads one pull request under --pr with one --repo, and asks the fleet read for that number alone", () => {
    const args = unwrap(parseGithubLandingArgs({ rest: ["--pr", "1795", "--repo", "acme/widgets"] }));
    expect(args.pr).toBe(1795);
    expect(fleetReadArgs({ args, repos: ["acme/widgets"] }).number).toBe(1795);
  });

  it("refuses --pr without exactly one --repo", () => {
    expect(unwrapErr(parseGithubLandingArgs({ rest: ["--pr", "1795"] }))).toEqual([
      "--pr reads one pull request, so it needs exactly one --repo owner/name",
    ]);
    expect(unwrapErr(parseGithubLandingArgs({ rest: ["--pr", "1795", "--repo", "a/b,c/d"] }))).toEqual([
      "--pr reads one pull request, so it needs exactly one --repo owner/name",
    ]);
  });

  it("refuses every write route and every other output mode beside --pr, each by name", () => {
    expect(
      unwrapErr(
        parseGithubLandingArgs({ rest: ["--pr", "7", "--repo", "a/b", "--press", "--register", "--json", "--full"] }),
      ),
    ).toEqual([
      "--pr cannot be combined with --press: --pr is a read-only drill-down into one row",
      "--pr cannot be combined with --register: --pr is a read-only drill-down into one row",
      "--pr cannot be combined with --full: --pr is a read-only drill-down into one row",
      "--pr cannot be combined with --json: --pr is a read-only drill-down into one row",
    ]);
  });

  it("refuses a --pr that is not a positive whole number", () => {
    expect(unwrapErr(parseGithubLandingArgs({ rest: ["--pr", "0", "--repo", "a/b"] }))).toEqual([
      "--pr must be a positive integer",
    ]);
  });
});
