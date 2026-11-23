import { describe, expect, it } from "vitest";

import { PlacementOrganisationErrors, parsePlacementOrganisation } from "../../lib/placementOrganisation";
import { placementOrganisationOf } from "../../lib/placementOrganisationLive";
import { ACME_PLACEMENT, GLOBEX_PLACEMENT } from "../organisationFixture";

/** `org show --json`'s whole document for one fixture: the six console fields and the rest it prints beside them. */
const documentOf = ({ placement }: { placement: typeof ACME_PLACEMENT }): Record<string, unknown> => ({
  ...placement,
  dependencyBots: [],
  googleDomain: null,
  repositories: [],
  revision: 3,
  updatedAtIso: "2026-10-30T00:00:00.000Z",
});

/** The sentence the verb's stderr carries when no row is written, as the live runner hands it back. */
const ABSENT =
  "slopweaver org show --json exited 3: no organisation is configured — write it once with `slopweaver org set`";

describe("parsePlacementOrganisation", () => {
  it.each([
    ["acme", ACME_PLACEMENT],
    ["globex", GLOBEX_PLACEMENT],
  ])("reads exactly the six console fields off %s's whole document", (_name, placement) => {
    const parsed = parsePlacementOrganisation({ value: documentOf({ placement }) });
    expect(parsed._unsafeUnwrap()).toEqual(placement);
  });

  it("carries each organisation's own display name, case kept", () => {
    expect(
      parsePlacementOrganisation({ value: documentOf({ placement: ACME_PLACEMENT }) })._unsafeUnwrap().displayName,
    ).toBe("Acme");
    expect(
      parsePlacementOrganisation({ value: documentOf({ placement: GLOBEX_PLACEMENT }) })._unsafeUnwrap().displayName,
    ).toBe("Globex");
  });

  it("refuses a document with no display name, naming it", () => {
    const { displayName: _dropped, ...rest } = documentOf({ placement: ACME_PLACEMENT });
    const error = parsePlacementOrganisation({ value: rest })._unsafeUnwrapErr();
    expect(error.code).toBe("ORGANISATION_DOCUMENT_INVALID");
    expect(error.message).toContain("displayName");
  });

  it("refuses a blank display name rather than labelling the team with nothing", () => {
    const value = { ...documentOf({ placement: ACME_PLACEMENT }), displayName: "   " };
    const error = parsePlacementOrganisation({ value })._unsafeUnwrapErr();
    expect(error.code).toBe("ORGANISATION_DOCUMENT_INVALID");
    expect(error.message).toContain("displayName");
  });

  it("keeps an organisation's null Linear and Vanta null, never filled", () => {
    const parsed = parsePlacementOrganisation({ value: documentOf({ placement: GLOBEX_PLACEMENT }) })._unsafeUnwrap();
    expect(parsed.linearWorkspace).toBe(null);
    expect(parsed.vantaWorkspace).toBe(null);
  });

  it("refuses a document missing a field, naming it", () => {
    const { slackHosts: _dropped, ...rest } = documentOf({ placement: ACME_PLACEMENT });
    const error = parsePlacementOrganisation({ value: rest })._unsafeUnwrapErr();
    expect(error.code).toBe("ORGANISATION_DOCUMENT_INVALID");
    expect(error.message).toContain("slackHosts");
  });

  it("refuses an absent Linear workspace rather than reading it as none", () => {
    const { linearWorkspace: _dropped, ...rest } = documentOf({ placement: ACME_PLACEMENT });
    const error = parsePlacementOrganisation({ value: rest })._unsafeUnwrapErr();
    expect(error.code).toBe("ORGANISATION_DOCUMENT_INVALID");
    expect(error.message).toContain("linearWorkspace");
  });

  it("refuses an uppercase owner and a self repository that is not owner/repo, naming both", () => {
    const value = { ...documentOf({ placement: ACME_PLACEMENT }), githubOwner: "Acme", selfRepository: "slopweaver" };
    expect(parsePlacementOrganisation({ value })._unsafeUnwrapErr()).toEqual(
      PlacementOrganisationErrors.documentInvalid({
        issues: ["githubOwner: must be a lowercase GitHub login", "selfRepository: must be a lowercase owner/repo"],
      }),
    );
  });

  it("refuses every value the store's own grammar refuses, so this build's repository never falls to team", () => {
    const value = {
      ...documentOf({ placement: ACME_PLACEMENT }),
      githubOwner: "acme-",
      linearWorkspace: "acme/eng",
      selfRepository: "acme/slopweaver#1",
      slackHosts: ["https://acme.slack.com"],
      vantaWorkspace: "-acme",
    };
    expect(parsePlacementOrganisation({ value })._unsafeUnwrapErr()).toEqual(
      PlacementOrganisationErrors.documentInvalid({
        issues: [
          "githubOwner: must be a lowercase GitHub login",
          "linearWorkspace: must be a lowercase slug",
          "selfRepository: must be a lowercase owner/repo",
          "slackHosts.0: must be a bare lowercase host",
          "vantaWorkspace: must be a lowercase slug",
        ],
      }),
    );
  });

  it("refuses a Slack host listed twice, as the store does", () => {
    const value = { ...documentOf({ placement: ACME_PLACEMENT }), slackHosts: ["acme.slack.com", "acme.slack.com"] };
    expect(parsePlacementOrganisation({ value })._unsafeUnwrapErr()).toEqual(
      PlacementOrganisationErrors.documentInvalid({ issues: ["slackHosts: has a duplicate entry"] }),
    );
  });

  it("reads an organisation with no Slack as zero hosts, never a refusal", () => {
    const value = { ...documentOf({ placement: ACME_PLACEMENT }), slackHosts: [] };
    expect(parsePlacementOrganisation({ value })._unsafeUnwrap().slackHosts).toEqual([]);
  });

  it("refuses a document that is not an object at all", () => {
    const error = parsePlacementOrganisation({ value: "not json" })._unsafeUnwrapErr();
    expect(error.code).toBe("ORGANISATION_DOCUMENT_INVALID");
    expect(error.message).toContain("the document:");
  });
});

describe("placementOrganisationOf", () => {
  it("parses a reading that answered", () => {
    const reading = {
      observedAtIso: "2026-10-30T00:00:00.000Z",
      ok: true,
      payload: documentOf({ placement: GLOBEX_PLACEMENT }),
      stampedByRoute: true,
    } as const;
    expect(placementOrganisationOf({ reading })._unsafeUnwrap()).toEqual(GLOBEX_PLACEMENT);
  });

  it("keeps a failed read's own sentence", () => {
    const reading = { notMeasured: ABSENT, observedAtIso: "2026-10-30T00:00:00.000Z", ok: false } as const;
    const error = placementOrganisationOf({ reading })._unsafeUnwrapErr();
    expect(error.code).toBe("ORGANISATION_READ_FAILED");
    expect(error.message).toBe(ABSENT);
  });

  it("refuses an unwritten store with the verb's own sentence, `org set` repair included, never a missing field", () => {
    const reading = {
      observedAtIso: "2026-10-30T00:00:00.000Z",
      ok: true,
      payload: { code: "ORG_NOT_CONFIGURED", kind: "expected-empty", why: ABSENT },
      stampedByRoute: true,
    } as const;
    const error = placementOrganisationOf({ reading })._unsafeUnwrapErr();
    expect(error.code).toBe("ORGANISATION_READ_FAILED");
    expect(error.message).toBe(ABSENT);
  });

  it("refuses an expected-empty payload under another code as a document it cannot read", () => {
    const reading = {
      observedAtIso: "2026-10-30T00:00:00.000Z",
      ok: true,
      payload: { code: "SOMETHING_ELSE", kind: "expected-empty", why: ABSENT },
      stampedByRoute: true,
    } as const;
    expect(placementOrganisationOf({ reading })._unsafeUnwrapErr().code).toBe("ORGANISATION_DOCUMENT_INVALID");
  });
});
