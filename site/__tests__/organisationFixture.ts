/**
 * Two synthetic organisations the console's placement is tested against, the site's twin of
 * `src/__tests__/organisationFixture.ts` (which the site project does not import). Every case that names the team runs
 * against both, so a reader still holding one organisation's constant passes for Acme and fails for Globex.
 */
import type { PlacementOrganisation } from "../lib/placementOrganisation";
import { buildWorkspacePlacer, type WorkspacePlacer } from "../lib/workspacePlacement";

/** This build's own repository in both fixtures — the one that is `self`. */
export const FIXTURE_SELF_REPOSITORY = "octo-self/slopweaver";

/** An organisation with every provider: one Slack host, a Linear and a Vanta workspace. */
export const ACME_PLACEMENT: PlacementOrganisation = {
  displayName: "Acme",
  githubOwner: "acme",
  linearWorkspace: "acme",
  selfRepository: FIXTURE_SELF_REPOSITORY,
  slackHosts: ["acme.slack.com"],
  vantaWorkspace: "acme",
};

/** An organisation with two Slack hosts and neither Linear nor Vanta. */
export const GLOBEX_PLACEMENT: PlacementOrganisation = {
  displayName: "Globex",
  githubOwner: "globex",
  linearWorkspace: null,
  selfRepository: FIXTURE_SELF_REPOSITORY,
  slackHosts: ["globex.slack.com", "globex-eng.slack.com"],
  vantaWorkspace: null,
};

/** The placer every Acme case reads through. */
export const ACME_PLACER: WorkspacePlacer = buildWorkspacePlacer({ organisation: ACME_PLACEMENT });

/** The placer every Globex case reads through. */
export const GLOBEX_PLACER: WorkspacePlacer = buildWorkspacePlacer({ organisation: GLOBEX_PLACEMENT });
