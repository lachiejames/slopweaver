/**
 * Two synthetic organisations every placement test reads, built as `../organisation/read.ts` hands one to a reader.
 *
 * The SECOND one is the point. A reader still carrying a constant passes every test written against one fixture whose
 * values match that constant; it fails the moment the same assertion runs against an organisation with other names.
 * So a placement test states its verdict for both — and Globex, unlike Acme, has no Google, Linear or Vanta.
 */
import type { Organisation } from "../organisation/core.js";

/** This build's own repository in both fixtures — derived off a checkout's origin, never stored. */
export const FIXTURE_SELF_REPOSITORY = "octo-self/slopweaver";

/** The synthetic organisation every example in this repository names. */
export const ACME_ORGANISATION: Organisation = {
  dependencyBots: ["acme-bot"],
  displayName: "Acme",
  githubOwner: "acme",
  googleDomain: "acme.com",
  linearWorkspace: "acme",
  repositories: ["acme/acme-admin"],
  revision: 1,
  selfRepository: FIXTURE_SELF_REPOSITORY,
  slackHosts: ["acme.slack.com"],
  updatedAtIso: "2026-10-30T00:00:00.000Z",
  vantaWorkspace: "acme",
};

/** A second organisation with other names everywhere, and none of the optional providers. */
export const GLOBEX_ORGANISATION: Organisation = {
  dependencyBots: [],
  displayName: "Globex",
  githubOwner: "globex",
  googleDomain: null,
  linearWorkspace: null,
  repositories: ["globex/web", "globex/api"],
  revision: 3,
  selfRepository: FIXTURE_SELF_REPOSITORY,
  slackHosts: ["globex.slack.com", "globex-eng.slack.com"],
  updatedAtIso: "2026-10-30T00:00:00.000Z",
  vantaWorkspace: null,
};
