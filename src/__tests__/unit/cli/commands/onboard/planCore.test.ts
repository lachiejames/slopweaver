import { describe, expect, it } from "vitest";

import { OnboardErrors, onboardErrorLines } from "../../../../../cli/commands/onboard/errors.js";
import {
  ONBOARD_PLAN_FLAG_NAMES,
  type OnboardPlanOptions,
  onboardPlanOptions,
  parseOnboardPlanArgs,
  renderOnboardPlan,
  renderOnboardPlanJson,
} from "../../../../../cli/commands/onboard/planCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

function options({ rest }: { rest: readonly string[] }): OnboardPlanOptions {
  return unwrap(onboardPlanOptions({ parsed: unwrap(parseOnboardPlanArgs({ rest })) }));
}

describe("onboard plan parsing", () => {
  it("advertises exactly the flags it accepts", () => {
    expect(ONBOARD_PLAN_FLAG_NAMES).toEqual(["--backfill", "--github-org", "--json", "--repo", "--sources"]);
  });

  it("parses and deduplicates connected sources without changing first-appearance order", () => {
    expect(
      options({
        rest: ["--sources", "slack,github,slack", "--backfill", "90", "--repo", "acme/app", "--github-org", "acme"],
      }).sources,
    ).toEqual(["slack", "github"]);
  });

  it("requires GitHub's repo only when selected and defaults the org from its owner", () => {
    const parsed = unwrap(parseOnboardPlanArgs({ rest: ["--sources", "github", "--backfill", "90"] }));
    expect(onboardErrorLines({ error: unwrapErr(onboardPlanOptions({ parsed })) })).toEqual([
      "--repo must be an owner/repo slug",
    ]);
    expect(options({ rest: ["--sources", "github", "--backfill", "90", "--repo", "acme/app"] }).org).toBe("acme");

    expect(options({ rest: ["--sources", "slack", "--backfill", "90"] }).sources).toEqual(["slack"]);
  });

  it("refuses unknown source names and unsafe GitHub slugs", () => {
    const badSource = unwrap(parseOnboardPlanArgs({ rest: ["--sources", "email", "--backfill", "90"] }));
    expect(onboardErrorLines({ error: unwrapErr(onboardPlanOptions({ parsed: badSource })) })).toEqual([
      "unrecognised source: email (expected github, slack, linear, notion, gmail, outlook)",
    ]);
    const badRepo = unwrap(
      parseOnboardPlanArgs({
        rest: ["--sources", "github", "--backfill", "90", "--repo", "x;touch/y", "--github-org", "acme"],
      }),
    );
    expect(onboardErrorLines({ error: unwrapErr(onboardPlanOptions({ parsed: badRepo })) })).toEqual([
      "--repo must be an owner/repo slug",
    ]);
  });

  it("reports every refused flag at once, each unknown source and the backfill on a line of its own", () => {
    const parsed = unwrap(parseOnboardPlanArgs({ rest: ["--sources", "email,fax", "--backfill", "forever"] }));
    const refused = unwrapErr(onboardPlanOptions({ parsed }));
    expect(refused.code).toBe("PLAN_REFUSED");
    expect(onboardErrorLines({ error: refused })).toEqual([
      "unrecognised source: email (expected github, slack, linear, notion, gmail, outlook)",
      "unrecognised source: fax (expected github, slack, linear, notion, gmail, outlook)",
      'unrecognised backfill: forever (expected a day count, a YYYY-MM-DD date, or "all")',
    ]);
  });
});

describe("onboardErrorLines", () => {
  it("prints each unrecognised source on its own line, never the joined message", () => {
    const refusals = [
      OnboardErrors.sourceUnrecognised({ expected: ["github"], got: "email" }),
      OnboardErrors.sourceUnrecognised({ expected: ["github"], got: "fax" }),
    ];
    expect(onboardErrorLines({ error: OnboardErrors.sourcesUnrecognised({ refusals }) })).toEqual([
      "unrecognised source: email (expected github)",
      "unrecognised source: fax (expected github)",
    ]);
  });

  it("prints each of a refused plan's and a refused answer's reasons on its own line", () => {
    expect(onboardErrorLines({ error: OnboardErrors.planRefused({ reasons: ["first", "second"] }) })).toEqual([
      "first",
      "second",
    ]);
    expect(onboardErrorLines({ error: OnboardErrors.answerRefused({ reasons: ["one", "two"] }) })).toEqual([
      "one",
      "two",
    ]);
  });

  it("prints a single-problem refusal as its message", () => {
    expect(onboardErrorLines({ error: OnboardErrors.answersExhausted({ attempts: 3, label: "tier" }) })).toEqual([
      'gave up on "tier" after 3 invalid answers',
    ]);
  });
});

describe("onboard plan rendering", () => {
  const planned = options({
    rest: ["--sources", "github,slack", "--backfill", "2026-04-01", "--repo", "acme/app", "--github-org", "acme"],
  });

  it("renders independent human commands and explicitly says to launch them concurrently", () => {
    expect(renderOnboardPlan({ options: planned })).toEqual([
      "launch these 2 refresh command(s) concurrently:",
      "slopweaver refresh --source github --all-repos --repo acme/app --github-org acme --since 2026-04-01",
      "slopweaver refresh --source slack --since 2026-04-01",
    ]);
  });

  it("renders one machine document containing argv arrays, never shell strings", () => {
    expect(JSON.parse(renderOnboardPlanJson({ options: planned }))).toEqual({
      commands: [
        {
          argv: [
            "refresh",
            "--source",
            "github",
            "--all-repos",
            "--repo",
            "acme/app",
            "--github-org",
            "acme",
            "--since",
            "2026-04-01",
          ],
          source: "github",
        },
        { argv: ["refresh", "--source", "slack", "--since", "2026-04-01"], source: "slack" },
      ],
      concurrency: "parallel",
      schemaVersion: 1,
    });
  });
});
