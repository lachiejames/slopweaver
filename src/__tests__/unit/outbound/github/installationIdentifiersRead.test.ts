/**
 * Which pull requests get the installation's own identifiers forgiven, and what the forgiveness is assembled from.
 * The pure assembly is tested over the synthetic organisations; the home catalog read over a throwaway home.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { LinearReferenceFacts } from "../../../../cli/linearReferenceFacts.js";
import { SOURCE_REPOSITORY } from "../../../../hygiene/ownRepository.js";
import { unwrap } from "../../../../lib/result.js";
import {
  installationIdentifiersFor,
  installationUnreadLines,
} from "../../../../outbound/github/installationIdentifiersRead.js";
import { stateCatalogTeams, writeStateCatalog } from "../../../../outbound/linear/stateCatalog.js";
import { type Profile, parseProfile } from "../../../../profile.js";
import { ACME_ORGANISATION, FIXTURE_SELF_REPOSITORY, GLOBEX_ORGANISATION } from "../../../organisationFixture.js";

const PROFILE: Profile = unwrap(
  parseProfile({
    value: { displayName: "Ada Lovelace", gitNamespace: "ada", id: "acme", schemaVersion: 1, sources: [] },
  }),
);

const PROFILE_WITH_LINEAR_KEYS: Profile = unwrap(
  parseProfile({
    value: {
      displayName: "Ada Lovelace",
      gitNamespace: "ada",
      id: "acme",
      linear: { teamKeys: ["GHI"] },
      schemaVersion: 1,
      sources: [],
    },
  }),
);

const NO_SILVER: LinearReferenceFacts = { teamKeys: [], workspaceSlug: undefined };

const ACME_SILVER: LinearReferenceFacts = { teamKeys: ["ABC", "DEF"], workspaceSlug: "acme" };

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("installationIdentifiersFor", () => {
  it("assembles team keys, the workspace label and the profile's people for an installation repository", () => {
    expect(
      installationIdentifiersFor({
        catalogTeams: [{ teamKey: "XYZ", workspace: "acme" }],
        organisation: ACME_ORGANISATION,
        profile: PROFILE,
        silver: ACME_SILVER,
        targetRepository: "Acme/Acme-Admin",
      }),
    ).toStrictEqual({
      linearTeamKeys: ["ABC", "DEF", "XYZ"],
      personNames: ["ada", "ada lovelace"],
      providerLocationLabels: ["acme"],
    });
  });

  it("takes the team keys the profile states with no catalog and no silver, so no Linear token is needed", () => {
    expect(
      installationIdentifiersFor({
        catalogTeams: [],
        organisation: ACME_ORGANISATION,
        profile: PROFILE_WITH_LINEAR_KEYS,
        silver: NO_SILVER,
        targetRepository: "acme/acme-admin",
      }),
    ).toStrictEqual({
      linearTeamKeys: ["GHI"],
      personNames: ["ada", "ada lovelace"],
      providerLocationLabels: ["acme"],
    });
  });

  it("unions the profile's stated keys with the catalog's and the silver directory's", () => {
    expect(
      installationIdentifiersFor({
        catalogTeams: [{ teamKey: "XYZ", workspace: "acme" }],
        organisation: ACME_ORGANISATION,
        profile: PROFILE_WITH_LINEAR_KEYS,
        silver: ACME_SILVER,
        targetRepository: "acme/acme-admin",
      })!.linearTeamKeys,
    ).toStrictEqual(["ABC", "DEF", "GHI", "XYZ"]);
  });

  it("takes no stated key when the organisation says it has no Linear", () => {
    expect(
      installationIdentifiersFor({
        catalogTeams: [],
        organisation: GLOBEX_ORGANISATION,
        profile: PROFILE_WITH_LINEAR_KEYS,
        silver: NO_SILVER,
        targetRepository: "globex/web",
      }),
    ).toStrictEqual({ linearTeamKeys: [], personNames: ["ada", "ada lovelace"], providerLocationLabels: [] });
  });

  it("forgives nothing on this build's own repository or on the public source address", () => {
    const base = {
      catalogTeams: [{ teamKey: "XYZ", workspace: "acme" }],
      organisation: ACME_ORGANISATION,
      profile: PROFILE_WITH_LINEAR_KEYS,
      silver: ACME_SILVER,
    };
    expect(
      [FIXTURE_SELF_REPOSITORY.toUpperCase(), SOURCE_REPOSITORY].map((targetRepository) =>
        installationIdentifiersFor({ ...base, targetRepository }),
      ),
    ).toStrictEqual([undefined, undefined]);
  });

  it("forgives nothing when the organisation could not be read, since nothing proves the target is not self", () => {
    expect(
      installationIdentifiersFor({
        catalogTeams: [{ teamKey: "XYZ", workspace: "acme" }],
        organisation: undefined,
        profile: PROFILE_WITH_LINEAR_KEYS,
        silver: ACME_SILVER,
        targetRepository: "acme/acme-admin",
      }),
    ).toBeUndefined();
  });

  it("takes no silver keys from a directory naming another workspace, nor any with no Linear workspace", () => {
    const otherSilver: LinearReferenceFacts = { teamKeys: ["ABC"], workspaceSlug: "initech" };
    expect(
      installationIdentifiersFor({
        catalogTeams: [],
        organisation: ACME_ORGANISATION,
        profile: null,
        silver: otherSilver,
        targetRepository: "acme/acme-admin",
      }),
    ).toStrictEqual({ linearTeamKeys: [], personNames: [], providerLocationLabels: ["acme"] });
    expect(
      installationIdentifiersFor({
        catalogTeams: [],
        organisation: GLOBEX_ORGANISATION,
        profile: null,
        silver: ACME_SILVER,
        targetRepository: "globex/web",
      }),
    ).toStrictEqual({ linearTeamKeys: [], personNames: [], providerLocationLabels: [] });
  });

  // The counterexample: a home reused after an installation change still holds the earlier one's catalog.
  it("takes a catalog's key only when it was recorded under the organisation's current Linear workspace", () => {
    const catalogTeams = [
      { teamKey: "ABC", workspace: "acme" },
      { teamKey: "QQA", workspace: "initech" },
      { teamKey: "OLD", workspace: undefined },
    ];
    const base = { catalogTeams, profile: null, silver: { teamKeys: [], workspaceSlug: undefined } };
    expect(
      installationIdentifiersFor({ ...base, organisation: ACME_ORGANISATION, targetRepository: "acme/acme-admin" }),
    ).toStrictEqual({ linearTeamKeys: ["ABC"], personNames: [], providerLocationLabels: ["acme"] });
    expect(
      installationIdentifiersFor({ ...base, organisation: GLOBEX_ORGANISATION, targetRepository: "globex/web" }),
    ).toStrictEqual({ linearTeamKeys: [], personNames: [], providerLocationLabels: [] });
  });
});

describe("stateCatalogTeams", () => {
  it("reads every recorded team's key and workspace, skipping a catalog whose key fell back to its id", () => {
    const home = mkdtempSync(join(tmpdir(), "installation-ids-"));
    homes.push(home);
    expect(stateCatalogTeams({ home })).toStrictEqual([]);
    const catalog = { members: [], readAtIso: "2026-11-05T00:00:00.000Z", states: [] };
    writeStateCatalog({ catalog: { ...catalog, teamId: "team-1", teamKey: "ABC", workspace: "acme" }, home });
    writeStateCatalog({ catalog: { ...catalog, teamId: "team-2", teamKey: "team-2" }, home });
    writeStateCatalog({ catalog: { ...catalog, teamId: "team-3", teamKey: "DEF" }, home });
    expect(stateCatalogTeams({ home })).toStrictEqual([
      { teamKey: "ABC", workspace: "acme" },
      { teamKey: "DEF", workspace: undefined },
    ]);
  });
});

describe("installationUnreadLines", () => {
  it("names each input that could not be read, and nothing when all were", () => {
    expect(installationUnreadLines({ read: { identifiers: undefined, unread: ["the profile (bad JSON)"] } })).toEqual([
      "note: could not read the profile (bad JSON), so the PR gate forgives none of the installation's identifiers it names",
    ]);
    expect(installationUnreadLines({ read: { identifiers: undefined, unread: [] } })).toEqual([]);
  });
});
