/*
 * Which authors a pass treats as dependency bots comes from the organisation, read once; with none configured
 * it says so and runs on the generic bots, and with one that will not read it acts on nothing.
 */
import { describe, expect, it } from "vitest";

import { runGithubBumpDrive } from "../../../../../../cli/commands/github/bumpDriveRun.js";
import { err, ok } from "../../../../../../lib/result.js";
import { safeJsonParse } from "../../../../../../lib/safeJson.js";
import type { Organisation } from "../../../../../../organisation/core.js";
import { OrganisationErrors } from "../../../../../../organisation/errors.js";
import { ACME_ORGANISATION } from "../../../../../organisationFixture.js";
import { ACME_WITH_RENOVATE, bump } from "./fixtures.js";
import { harness } from "./harness.js";

describe("runGithubBumpDrive", () => {
  it("reads which App is a bump bot from the organisation, so one naming no bot of its own selects by branch", async () => {
    const documentUnder = async ({ organisation }: { organisation: Organisation }): Promise<unknown> => {
      const run = harness({ organisation: ok(organisation), prs: [bump()] });
      await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets", "--dry-run", "--json"] });
      return safeJsonParse({ label: "the document under test", text: run.out[0]! });
    };

    expect(await documentUnder({ organisation: ACME_WITH_RENOVATE })).toMatchObject({
      outcomes: [{ number: 661, signal: "bot-author" }],
    });
    expect(await documentUnder({ organisation: { ...ACME_ORGANISATION, dependencyBots: [] } })).toMatchObject({
      outcomes: [{ number: 661, signal: "branch-prefix" }],
    });
  });

  it("runs on the generic Renovate and Dependabot alone where no organisation is configured, and says so", async () => {
    const run = harness({
      organisation: err(OrganisationErrors.notConfigured({ missing: "organisation" })),
      prs: [bump({ authorLogin: "renovate[bot]" })],
    });

    const code = await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets", "--dry-run", "--json"] });

    expect(code).toBe(0);
    const document: unknown = safeJsonParse({ label: "the document under test", text: run.out[0]! });
    expect(document).toMatchObject({
      notes: [
        "only the generic Renovate (renovate[bot]) and Dependabot (dependabot[bot]) are recognised as dependency bots " +
          "— no organisation is configured in the store — write it once with `slopweaver org set`",
        "acme/widgets: 0 open bump(s) of the owner's, 0 changing only dependency files, of 0 open pull request(s) read whole; 0 superseded",
      ],
    });
  });

  it("refuses the whole pass, acting on nothing, when the organisation will not read", async () => {
    const run = harness({
      organisation: err(OrganisationErrors.invalid({ issues: ["dependencyBots: has a duplicate entry"] })),
      prs: [bump()],
    });

    const code = await runGithubBumpDrive({ deps: run.deps, rest: ["--repo", "acme/widgets"] });

    expect(code).toBe(1);
    expect(run.pressed).toEqual([]);
    expect(run.closed).toEqual([]);
    expect(run.diagnostics).toEqual([
      "github bump-drive: which authors are dependency bots could not be read — " +
        "the organisation does not read: dependencyBots: has a duplicate entry",
    ]);
  });
});
