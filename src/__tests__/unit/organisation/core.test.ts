/**
 * The organisation's pure half: what a stored row must say, how a missing field and a wrong one read apart, the
 * `org show --json` document read back whole, and the self repository joined on beside the row rather than stored.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  isRepositorySlug,
  ORGANISATION_FIELDS,
  type OrganisationRecord,
  organisationLines,
  parseOrganisation,
  parseOrganisationRecord,
  parseStoredMeta,
} from "../../../organisation/core.js";
import { OrganisationErrors } from "../../../organisation/errors.js";
import { organisationOf } from "../../../organisation/read.js";
import { ACME_ORGANISATION, FIXTURE_SELF_REPOSITORY, GLOBEX_ORGANISATION } from "../../organisationFixture.js";

const { revision: _revision, selfRepository: _self, updatedAtIso: _updated, ...ACME_RECORD } = ACME_ORGANISATION;
const RECORD: OrganisationRecord = ACME_RECORD;

describe("isRepositorySlug", () => {
  it("accepts an exact owner/repo in any case, and refuses a path, a URL or a dot-only name", () => {
    const slugs = ["acme/widgets", "Acme/Widgets.js", "acme/..", "acme/.", "acme/a/b", "/widgets", "https://x/y"];
    expect(slugs.map((slug) => isRepositorySlug({ slug }))).toStrictEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("parseOrganisationRecord", () => {
  it("reads a whole record back unchanged, and one stating no Google, Linear or Vanta as null", () => {
    const { revision: _r, selfRepository: _s, updatedAtIso: _u, ...globex } = GLOBEX_ORGANISATION;
    expect([
      unwrap(parseOrganisationRecord({ value: RECORD })),
      unwrap(parseOrganisationRecord({ value: globex })),
    ]).toEqual([RECORD, globex]);
  });

  it("reads a record stating no Slack as zero hosts, since Slack is never a requirement", () => {
    const noSlack = { ...RECORD, slackHosts: [] };
    expect(unwrap(parseOrganisationRecord({ value: noSlack })).slackHosts).toEqual([]);
  });

  it("refuses a record a writer never finished as NOT CONFIGURED, naming the first field nobody stated", () => {
    const { linearWorkspace: _linear, ...unstated } = RECORD;
    const refused = unwrapErr(parseOrganisationRecord({ value: unstated }));
    expect([refused.code, refused.message]).toEqual([
      "ORG_NOT_CONFIGURED",
      "the organisation in the store has no linearWorkspace — write it again with `slopweaver org set`",
    ]);
  });

  it("refuses a field present and wrong as INVALID, naming every problem rather than the first", () => {
    const refused = unwrapErr(
      parseOrganisationRecord({
        value: {
          ...RECORD,
          githubOwner: "Acme",
          repositories: ["https://github.com/acme/acme-admin"],
          slackHosts: ["acme.slack.com", "acme.slack.com"],
        },
      }),
    );
    expect(refused).toEqual(
      OrganisationErrors.invalid({
        issues: [
          "githubOwner: must be a lowercase GitHub login",
          "slackHosts: has a duplicate entry",
          "repositories.0: must be a lowercase owner/repo",
        ],
      }),
    );
  });

  it("refuses a dot-only repository name, which is a path and never a repository", () => {
    expect(
      unwrapErr(parseOrganisationRecord({ value: { ...RECORD, repositories: ["acme/..", "acme/.", "acme/.github"] } })),
    ).toEqual(
      OrganisationErrors.invalid({
        issues: ["repositories.0: must be a lowercase owner/repo", "repositories.1: must be a lowercase owner/repo"],
      }),
    );
  });

  it("refuses a field it does not know, so a mistyped one is never stored and silently ignored", () => {
    const refused = unwrapErr(parseOrganisationRecord({ value: { ...RECORD, linearSlug: "acme" } }));
    expect(refused.code).toBe("ORG_INVALID");
    expect(refused.message).toContain("linearSlug");
  });

  it("names every field the writer states, in the order it prints them", () => {
    expect(ORGANISATION_FIELDS).toEqual([
      "displayName",
      "githubOwner",
      "googleDomain",
      "slackHosts",
      "linearWorkspace",
      "vantaWorkspace",
      "repositories",
      "dependencyBots",
    ]);
  });
});

describe("parseStoredMeta", () => {
  const WRITTEN = new Date("2026-10-30T00:00:00.000Z");

  it("passes the revision and instant a writer could have stored, the instant as ISO", () => {
    expect(unwrap(parseStoredMeta({ revision: 7, updatedAt: WRITTEN }))).toEqual({
      revision: 7,
      updatedAtIso: "2026-10-30T00:00:00.000Z",
    });
  });

  it("refuses a hand-edited zero or negative revision as invalid, naming it", () => {
    expect(unwrapErr(parseStoredMeta({ revision: 0, updatedAt: WRITTEN }))).toEqual(
      OrganisationErrors.invalid({ issues: ["revision: must be a positive integer, got 0"] }),
    );
    expect(unwrapErr(parseStoredMeta({ revision: -3, updatedAt: WRITTEN })).code).toBe("ORG_INVALID");
  });

  it("refuses a NULL instant and a non-numeric revision a dropped constraint let in, rather than throwing on them", () => {
    expect(unwrapErr(parseStoredMeta({ revision: "1", updatedAt: null }))).toEqual(
      OrganisationErrors.invalid({
        issues: [
          "revision: must be a positive integer, got a value of type string",
          "updatedAt: must be a real instant",
        ],
      }),
    );
    expect(unwrapErr(parseStoredMeta({ revision: null, updatedAt: "2026-10-30T00:00:00.000Z" }))).toEqual(
      OrganisationErrors.invalid({
        issues: ["revision: must be a positive integer, got null", "updatedAt: must be a real instant"],
      }),
    );
  });

  it("refuses a revision with no prototype, which `String()` throws on, still as a refusal", () => {
    expect(unwrapErr(parseStoredMeta({ revision: Object.create(null), updatedAt: new Date(0) }))).toEqual(
      OrganisationErrors.invalid({ issues: ["revision: must be a positive integer, got a value of type object"] }),
    );
  });

  it("refuses an `infinity` instant, which the driver reads as an invalid Date, rather than throwing on it", () => {
    expect(unwrapErr(parseStoredMeta({ revision: 0, updatedAt: new Date(Number.NaN) }))).toEqual(
      OrganisationErrors.invalid({
        issues: ["revision: must be a positive integer, got 0", "updatedAt: must be a real instant"],
      }),
    );
  });
});

describe("organisationOf", () => {
  it("joins the derived self repository and the row's revision onto the stored record", () => {
    expect(
      organisationOf({
        selfRepository: FIXTURE_SELF_REPOSITORY,
        stored: { record: RECORD, revision: 1, updatedAtIso: "2026-10-30T00:00:00.000Z" },
      }),
    ).toEqual(ACME_ORGANISATION);
  });
});

describe("parseOrganisation", () => {
  it("reads the `org show --json` document back whole", () => {
    expect(unwrap(parseOrganisation({ value: JSON.parse(JSON.stringify(GLOBEX_ORGANISATION)) }))).toEqual(
      GLOBEX_ORGANISATION,
    );
  });

  it("reads an organisation with no Slack back whole from its printed document", () => {
    const noSlack = { ...GLOBEX_ORGANISATION, slackHosts: [] };
    expect(unwrap(parseOrganisation({ value: JSON.parse(JSON.stringify(noSlack)) }))).toEqual(noSlack);
  });

  it("refuses a document lacking its self repository, which no reader may guess", () => {
    const { selfRepository: _dropped, ...headless } = ACME_ORGANISATION;
    expect(unwrapErr(parseOrganisation({ value: headless })).message).toContain("selfRepository");
  });
});

describe("organisationLines", () => {
  it("prints every field, saying an absent provider is absent and where the self repository came from", () => {
    expect(organisationLines({ organisation: GLOBEX_ORGANISATION })).toEqual([
      "organisation Globex (revision 3, 2026-10-30T00:00:00.000Z)",
      "  github owner      globex",
      "  google domain     (none — the organisation has no Google Workspace)",
      "  slack hosts       globex.slack.com, globex-eng.slack.com",
      "  linear workspace  (none — the organisation has no Linear)",
      "  vanta workspace   (none — the organisation has no Vanta)",
      "  repositories      globex/web, globex/api",
      "  dependency bots   (none beyond the generic Renovate and Dependabot)",
      `  self repository   ${FIXTURE_SELF_REPOSITORY} (derived from this build's checkout origin, never stored)`,
    ]);
  });

  it("says an organisation with no Slack has none, rather than printing an empty host list", () => {
    const lines = organisationLines({ organisation: { ...GLOBEX_ORGANISATION, slackHosts: [] } });
    expect(lines[3]).toBe("  slack hosts       (none — the organisation has no Slack)");
  });
});
