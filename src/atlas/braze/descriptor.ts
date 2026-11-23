/**
 * What this atlas declares about itself, including the two surfaces it cannot fill and why.
 *
 * ## Four surfaces, two of them filled, and the two filled ones are BOTH published documents
 *
 * A descriptor's `status` is static, which is the trap `jumpcloud/descriptor.ts` names: a surface declared
 * `filled` in source is filled on every install, including one where the acquisition has never run. So each
 * flag below is a claim this build can actually make, and `surfaceFill.ts` derives the two compiled ones from
 * the manifest rather than trusting the literal.
 *
 * - `endpoint-reference` is Braze's own documentation catalogue. Filled by `atlas braze sync`, no credential.
 * - `postman-collection` is the official collection Braze links from that reference. Also filled by `sync`.
 *   It is `corroborating` rather than `authoritative` on purpose — where the two disagree the reference is
 *   the vendor describing its product and the collection is a convenience artefact that has been allowed to
 *   drift, which the four News Feed and Live Activity operations only it carries demonstrate in both
 *   directions at once.
 * - `rest-api` is `declared-unfilled`: no workspace API key exists, so nothing of this workspace has been read.
 * - `dashboard` is `declared-unfilled`: this installation has no Braze account at all.
 *
 * ## Why this atlas holds entities and its Slack and Notion siblings do not
 *
 * `docs/atlas-intent/06-holdings.md` is a test, not a preference: does something better suited already hold this
 * platform's entities? For Slack the corpus does, so its atlas maps the interface alone. Here nothing does.
 * The corpus holds a great deal ABOUT Braze — the tickets, the pull requests and the Slack threads of the
 * team that integrates with it — and not one campaign, canvas, segment, catalogue or subscription group of
 * Braze's own. So the answer is everything reachable, entities included, minus the highly voluminous.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { BRAZE_ATLAS_PLATFORM, BRAZE_KINDS, BRAZE_VISIBILITY_SCOPE } from "./model.js";

/** This atlas, as it declares itself. */
export const BRAZE_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "the ROWS of every voluminous family — every `*_data_series` and `*_series` analytics stream, the canvas " +
        "data summary, the segment and global-control-group user exports, and the email, unsubscribe and " +
        "invalid-phone-number registers. Each of those operations IS held, with the rule that classified it and " +
        "the reason in English; what is never held is a row per record. That is a disposition rather than an " +
        "exclusion, and `dispositions.ts` applies it per operation rather than per family",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "every `*_data_series` and `*_series` stream is a per-instant analytics observation the platform emits, and the export registers grow with every send",
        wouldBeMeasuredBy:
          "`GET /sends/data_series` and `GET /email/hard_bounces` over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "every mutation. 81 of the 150 operations across both published channels change something, and this atlas " +
        "will call none of them: no user is tracked or deleted, no message is sent, no catalogue item is " +
        "written, no SCIM user is provisioned. Each is still recorded as a row, because an atlas that omitted " +
        "them would answer `Braze offers no way to do that`, which is false",
      ground: "never-acted",
    },
    {
      because:
        "any response VALUE, on any surface. Both filled channels read published documents and call nothing, so " +
        "every field they hold is a NAME — a method, a path shape, a parameter, a header, a response field. " +
        "When a live REST channel lands it will need a field-denial boundary its JumpCloud and 1Password " +
        "siblings have, because Braze's SCIM and SDK-authentication endpoints return key material",
      ground: "names-not-values",
    },
    {
      because:
        "Braze's Currents event-stream product, which delivers engagement events to a data warehouse rather than " +
        "over this REST API. It is out of scope for a map of the REST and dashboard surfaces, and it is named " +
        "here so its absence is a stated boundary rather than an oversight",
      ground: "out-of-platform",
    },
    {
      because:
        "the dashboard's real route inventory. Eight destinations are declared and only three of them have a URL " +
        "Braze published; the rest of the dashboard certainly exists and is carried as the standing " +
        "`browser-route-inventory-undiscovered` gap rather than as invented addresses",
      ground: "not-fetched",
      wouldBeClosedBy:
        "a signed-in dashboard walk that discovers the real route inventory, closing the standing `browser-route-inventory-undiscovered` gap",
    },
    {
      because:
        "which Braze cluster this organisation is on. It is INFERRED as AU-01 from the organisation's own " +
        "ap-southeast-2 Amazon SES DNS records and is labelled an inference everywhere it appears; only an " +
        "account can settle it",
      ground: "not-fetched",
      wouldBeClosedBy: "an account read that settles the cluster instead of inferring it from DNS",
    },
  ],
  kinds: [...BRAZE_KINDS],
  platform: BRAZE_ATLAS_PLATFORM,
  question:
    "what can be asked of Braze and where does it live — every documented REST operation with its " +
    "parameters and response fields, every operation the official collection ships, where those two " +
    "published sources disagree, which families are too voluminous to keep, and which of it this " +
    "installation can currently reach at all",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas braze sync",
  surfaces: [
    {
      denominator: {
        because:
          "Braze's endpoint reference is a documentation page rather than a machine-readable catalogue, so the operations compiled from it are this atlas's own reading of it and not a count Braze publishes",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "endpoint-reference",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "the published Postman collection is a selection Braze chose to demonstrate, never a claim to be exhaustive",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "postman-collection",
      role: "corroborating",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because: "no live call has been made against this account, so there is nothing measured to divide by",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "rest-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no Braze workspace API key is configured, so nothing of this workspace has been read. A key is " +
        "issued from the dashboard's own Settings > API Keys page, which needs an account this installation " +
        "does not have — so this surface is blocked behind the same invite the dashboard surface is. " +
        "This flips to filled in the commit that lands a client and " +
        "proves it against the workspace, never before it",
    },
    {
      denominator: {
        because: "the Braze dashboard publishes no route manifest and no sitemap",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "dashboard",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "this installation has no Braze account. MEASURED: dashboard.braze.com redirects to " +
        "/sign_in and serves an identifier-first form with no session; every .braze.com cookie this " +
        "machine holds is marketing-site instrumentation; the owner's mailbox has never received a " +
        "message from braze.com, so no invitation was ever issued; and no single sign-on from the " +
        "identity provider to Braze has been wired. Eight routes are DECLARED so the emptiness is measurable rather " +
        "than invisible. A surface is filled by pages actually reached, never by a transport that could " +
        "reach them",
    },
  ],
  visibilityScope: BRAZE_VISIBILITY_SCOPE,
};
