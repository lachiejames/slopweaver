/**
 * The dependency-bot actors: every spelling of the generic Renovate and Dependabot Apps plus the organisation's own,
 * and how an organisation read becomes them — configured, not configured at all, or not readable.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { dependencyBotActors, dependencyBotsOf } from "../../../organisation/dependencyBots.js";
import { OrganisationErrors } from "../../../organisation/errors.js";
import { StoreErrors } from "../../../store/errors.js";
import { ACME_ORGANISATION, GLOBEX_ORGANISATION } from "../../organisationFixture.js";

/** The generic two alone, as every reader spells them. */
const GENERIC = {
  bumpGraphqlAppLogins: ["dependabot", "renovate"],
  bumpRestLogins: ["dependabot[bot]", "renovate[bot]"],
  renovateGraphqlAppLogins: ["renovate"],
  renovateRestLogins: ["renovate[bot]"],
  renovateSearchAuthors: ["app/renovate"],
};

describe("dependencyBotActors", () => {
  it("names the generic Renovate and Dependabot alone when the organisation has no bot of its own", () => {
    expect(dependencyBotActors({ dependencyBots: [] })).toEqual(GENERIC);
  });

  it("spells a configured bare App login three ways and counts it as Renovate", () => {
    expect(dependencyBotActors({ dependencyBots: ["acme-renovate"] })).toEqual({
      bumpGraphqlAppLogins: ["dependabot", "renovate", "acme-renovate"],
      bumpRestLogins: ["dependabot[bot]", "renovate[bot]", "acme-renovate[bot]"],
      renovateGraphqlAppLogins: ["renovate", "acme-renovate"],
      renovateRestLogins: ["renovate[bot]", "acme-renovate[bot]"],
      renovateSearchAuthors: ["app/renovate", "app/acme-renovate"],
    });
  });

  it("never lists one identity twice, when a configured login repeats a generic one", () => {
    expect(dependencyBotActors({ dependencyBots: ["renovate", "acme-renovate"] })).toEqual({
      bumpGraphqlAppLogins: ["dependabot", "renovate", "acme-renovate"],
      bumpRestLogins: ["dependabot[bot]", "renovate[bot]", "acme-renovate[bot]"],
      renovateGraphqlAppLogins: ["renovate", "acme-renovate"],
      renovateRestLogins: ["renovate[bot]", "acme-renovate[bot]"],
      renovateSearchAuthors: ["app/renovate", "app/acme-renovate"],
    });
  });

  it("never counts the public Dependabot as Renovate, even when the organisation names it again", () => {
    expect(dependencyBotActors({ dependencyBots: ["dependabot", "acme-renovate"] })).toEqual({
      bumpGraphqlAppLogins: ["dependabot", "renovate", "acme-renovate"],
      bumpRestLogins: ["dependabot[bot]", "renovate[bot]", "acme-renovate[bot]"],
      renovateGraphqlAppLogins: ["renovate", "acme-renovate"],
      renovateRestLogins: ["renovate[bot]", "acme-renovate[bot]"],
      renovateSearchAuthors: ["app/renovate", "app/acme-renovate"],
    });
  });
});

describe("dependencyBotsOf", () => {
  it("takes the organisation's own bots, with no note, when it reads", () => {
    const resolved = unwrap(
      dependencyBotsOf({ organisation: ok({ ...ACME_ORGANISATION, dependencyBots: ["acme-renovate"] }) }),
    );
    expect([resolved.bots.renovateRestLogins, resolved.note]).toEqual([
      ["renovate[bot]", "acme-renovate[bot]"],
      undefined,
    ]);
  });

  it("takes the generic two, with no note, from an organisation that states it has no bot of its own", () => {
    expect(unwrap(dependencyBotsOf({ organisation: ok(GLOBEX_ORGANISATION) }))).toEqual({
      bots: GENERIC,
      note: undefined,
    });
  });

  it("runs on the generic two and says why when no organisation is configured", () => {
    const resolved = unwrap(
      dependencyBotsOf({ organisation: err(OrganisationErrors.notConfigured({ missing: "organisation" })) }),
    );
    expect(resolved).toEqual({
      bots: GENERIC,
      note:
        "only the generic Renovate (renovate[bot]) and Dependabot (dependabot[bot]) are recognised as dependency bots " +
        "— no organisation is configured in the store — write it once with `slopweaver org set`",
    });
  });

  it("reads a home with no store selected as nothing configured, which is what CI's throwaway home is", () => {
    const cause = StoreErrors.urlMissing({ envVar: "FIXTURE_STORE_URL", secretName: "fixture-store-url" });
    const resolved = unwrap(dependencyBotsOf({ organisation: err(OrganisationErrors.queryFailed({ cause })) }));
    expect(resolved.bots).toEqual(GENERIC);
    expect(resolved.note).toContain("refusing to reach the store: no database is selected");
  });

  it("refuses a selected store that cannot be reached, rather than reading it as no bot of its own", () => {
    const cause = StoreErrors.unreachable({ reason: "connection refused" });
    const refused = unwrapErr(dependencyBotsOf({ organisation: err(OrganisationErrors.queryFailed({ cause })) }));
    expect(refused.code).toBe("ORG_QUERY_FAILED");
  });

  it("refuses a row that exists but lacks dependencyBots, rather than reading it as no bot of its own", () => {
    const refused = unwrapErr(
      dependencyBotsOf({ organisation: err(OrganisationErrors.notConfigured({ missing: "dependencyBots" })) }),
    );
    expect([refused.code, refused.message]).toEqual([
      "ORG_NOT_CONFIGURED",
      OrganisationErrors.notConfigured({ missing: "dependencyBots" }).message,
    ]);
  });

  it("refuses, never reading as empty, an organisation row that will not read", () => {
    const refused = unwrapErr(
      dependencyBotsOf({
        organisation: err(OrganisationErrors.invalid({ issues: ["dependencyBots: has a duplicate entry"] })),
      }),
    );
    expect([refused.code, refused.message]).toEqual([
      "ORG_INVALID",
      "the organisation does not read: dependencyBots: has a duplicate entry",
    ]);
  });

  it("refuses a self repository that cannot be resolved, rather than dropping the organisation's bots", () => {
    const refused = unwrapErr(
      dependencyBotsOf({ organisation: err(OrganisationErrors.selfUnresolved({ reasons: ["no origin"] })) }),
    );
    expect(refused.code).toBe("SELF_REPOSITORY_UNRESOLVED");
  });
});
