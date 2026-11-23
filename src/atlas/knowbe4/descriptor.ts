/**
 * What the KnowBe4 atlas declares about itself — the row a catalogue shows, and the honest answer to "how much
 * of this platform have you actually looked at".
 *
 * ## Two surfaces, each with a denominator from day one
 *
 * `reporting-api-v1` is KnowBe4's Reporting API. Its `exists` is the GET census of KnowBe4's own first-party
 * OpenAPI document, {@link KNOWBE4_REPORTING_SPEC}, pinned by digest — 24 path templates, so the count is a
 * census rather than this atlas's own list — and `reached` counts the templates the sync CALLS, the closed list
 * in `src/live/knowbe4/transport.ts`. `descriptor.test.ts` holds `reached` to that list.
 *
 * `kmsat-console` is the KMSAT web console. KnowBe4 publishes no sitemap, so its denominator is
 * {@link KNOWBE4_CONSOLE_ROUTES}, the read-only routes this repository declared when the first KnowBe4 atlas
 * walked it — a DECLARED count, said so in `source`, and
 * nothing walks it today, so it is `reached: 0` and `declared-unfilled`.
 *
 * ## The status is static, so it says `filled` only once a credentialed sync has read every path
 *
 * The API surface is `filled`: the first credentialed sync read all eleven called paths against
 * this tenant and reconciled each boundary to what KnowBe4 actually answered. Reproduce:
 * `slopweaver atlas knowbe4 sync && slopweaver atlas knowbe4 coverage`.
 */
import { KNOWBE4_PATH_TEMPLATES } from "../../live/knowbe4/transport.js";
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { KNOWBE4_ATLAS_KINDS, KNOWBE4_ATLAS_PLATFORM } from "./model.js";

/**
 * The first-party document the API census is taken from, pinned by the SHA-256 of its bytes as read when
 * the census was taken. Reproduce: fetch the URL and `shasum -a 256` it; a different digest means KnowBe4 changed the
 * document and the census is re-taken, never assumed.
 */
export const KNOWBE4_REPORTING_SPEC = {
  getPathTemplates: 24,
  readOn: "2026-10-15",
  sha256: "237e6b7ed455d44eca9f463b4975818b26c9276f108597cffcdae473f6c83364",
  url: "https://developer.knowbe4.com/elvis-swagger.yml",
} as const;

/**
 * The KMSAT console routes the first KnowBe4 atlas declared, every one a page whose visit is a READ. None has
 * been confirmed on this installation; they are the console surface's declared denominator and nothing more.
 */
export const KNOWBE4_CONSOLE_ROUTES: readonly string[] = [
  "/dashboard",
  "/users",
  "/users/groups",
  "/users/archived",
  "/phishing/campaigns",
  "/phishing/tests",
  "/phishing/templates",
  "/phishing/landing_pages",
  "/training/campaigns",
  "/training/library",
  "/training/store",
  "/policies",
  "/reports",
  "/account_settings",
  "/account_settings/api",
  "/account_settings/audit_log",
];

/** The API surface's name — what an observation read through the `api` channel is attributed to. */
export const KNOWBE4_API_SURFACE = "reporting-api-v1";

/** KnowBe4's atlas, as it declares itself. */
export const KNOWBE4_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every mutation, on every surface, because the owner's rule is that nothing in KnowBe4 is changed. The Reporting API publishes GETs only, and the door's transport can only express a GET to us.api.knowbe4.com on one of eleven closed-list paths",
      ground: "never-acted",
    },
    {
      because:
        "a phishing recipient's IP, IP location, browser, browser version and OS; a user's phone numbers, manager, comment, aliases, provisioning GUID and custom fields; the account's admin identities; content descriptions and policy URLs. Each boundary DECLARES these keys so a drift is visible, and the projection stores none of their values — the use cases are who owes training and who was phished, not device telemetry",
      ground: "names-not-values",
    },
    {
      because:
        "the Reporting API token, which is read from its 0600 secret file and sent as a bearer header, never stored",
      ground: "secret-material",
    },
    {
      because:
        "an exact per-person training due date. The Reporting API publishes none — `/v1/training/enrollments` carries enrolment, start and completion dates and a status that includes Past Due, and a campaign carries its own end date or relative duration, but KnowBe4 lets an admin extend one person's deadline independently of the campaign. So the atlas stores the provider's status and the campaign timing, and never derives a due date and calls it exact",
      ground: "claim-not-made",
    },
    {
      because:
        "PhishER and KnowBe4's User Event API — separate products with separate credentials, not needed for the training and phishing questions this atlas answers",
      ground: "out-of-platform",
    },
  ],
  kinds: [...KNOWBE4_ATLAS_KINDS],
  platform: KNOWBE4_ATLAS_PLATFORM,
  question:
    "who is in this organisation's KnowBe4 account, which groups they are in, which training campaigns enrol which groups, each person's enrolment and completion status, and how each person did on each phishing test, callback phishing excepted and declared so — read only, never changed",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas knowbe4 sync",
  surfaces: [
    {
      // `reached` counts the path templates the sync CALLS, not the 24 the document publishes: the other
      // thirteen are a by-id read of a row a list already returned, or a risk-score history this use case does
      // not need.
      denominator: {
        exists: KNOWBE4_REPORTING_SPEC.getPathTemplates,
        known: true,
        reached: KNOWBE4_PATH_TEMPLATES.length,
        source: `KnowBe4's first-party Reporting API OpenAPI document (${KNOWBE4_REPORTING_SPEC.url}), read ${KNOWBE4_REPORTING_SPEC.readOn}, sha256 ${KNOWBE4_REPORTING_SPEC.sha256}: ${KNOWBE4_REPORTING_SPEC.getPathTemplates} GET path templates`,
      },
      acquisition: "api",
      documented: true,
      name: KNOWBE4_API_SURFACE,
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        exists: KNOWBE4_CONSOLE_ROUTES.length,
        known: true,
        reached: 0,
        source:
          "this repository's own declared list of read-only KMSAT console routes (`KNOWBE4_CONSOLE_ROUTES`) — KnowBe4 publishes no sitemap, so this is a declared count, not a census",
      },
      acquisition: "driven-browser",
      documented: false,
      name: "kmsat-console",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "nothing walks the console: the Reporting API answers the training and phishing questions, and a console walk is built only when a question needs a page the API does not serve",
    },
  ],
  visibilityScope:
    "the API channel sees what the Reporting API token AND the account's subscription tier open — Reporting API access needs Platinum, Diamond, SAT Foundations or SAT Advanced, and a tier that refuses a path is a declared permission gap rather than a silence; the console channel would see what the signed-in admin's role opens",
};
