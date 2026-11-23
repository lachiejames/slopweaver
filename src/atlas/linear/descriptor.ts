/**
 * What the Linear atlas declares about itself — the row a catalogue shows.
 *
 * ## Both surfaces are `authoritative`, for different facts
 *
 * The tempting shape is `api: authoritative, browser: corroborating`, and it is wrong for the same reason
 * the Slack atlas rejected it: each surface is the source of record for its own question. The GraphQL
 * schema is authoritative on what this credential may ask for; only the browser can establish which
 * settings pages this signed-in member can actually open and what the first-party client asks for while
 * they render. Grading the browser `corroborating` would say its unique findings "may never satisfy an
 * authoritative obligation alone" — the API-only posture that gave stupid answers about things plainly
 * visible in the browser.
 *
 * ## The browser surface's status is a fact about this build, not a wish
 *
 * `status` is static in source, which is the trap: a surface declared `filled` here is filled on every
 * install, including one where the walk has never run. So it stays `declared-unfilled` until a walk has
 * actually reached pages on this machine, and `unfilledBecause` names the exact thing in the way. The
 * JumpCloud descriptor is the precedent and its reasoning is the reasoning here.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { LINEAR_ATLAS_KINDS, LINEAR_ATLAS_PLATFORM, LINEAR_ATLAS_VISIBILITY_SCOPE } from "./model.js";
import { API_SURFACE, BROWSER_SURFACE } from "./projectionKit.js";

/** Linear's atlas, as it declares itself. */
export const LINEAR_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "read-before-write",
  excludes: [
    {
      because:
        "every entity the world model's corpus already holds — issues, projects, project updates, comments, documents, initiatives, cycles, attachments, customers and their needs, releases and release notes, notifications, favourites, and every person. The owner's per-platform ruling is that a platform whose entities the corpus holds gets a SURFACE MAP; `rootFieldCensus.ts` classifies EVERY root field so an exclusion is a decision on the record rather than a hole",
      ground: "held-elsewhere",
      holder: "`src/corpus/linear`, which holds every Linear entity the world model needs",
    },
    {
      because:
        "every mutation, on both surfaces. The API half calls none, and the browser half navigates without clicking anything that writes — `rootFieldCensus.ts` classifies all 375 of them `mutation-not-called`",
      ground: "never-acted",
    },
    {
      because:
        "GraphQL DIRECTIVE definitions. Introspection returns them and they are genuinely part of the schema surface; they are not stored because no kind here holds a non-type declaration, and this line is the declaration of that omission rather than its absence",
      ground: "not-fetched",
      wouldBeClosedBy:
        "a kind that holds a non-type GraphQL declaration, so introspected directives have somewhere to go",
    },
    {
      because:
        "the EXECUTION of any subscription. All 82 subscription root fields are catalogued in the `operation` kind because the schema declares them, and no subscription is ever opened: their transport is unverified on this installation, and a declaration catalogued is not a capability measured",
      ground: "never-acted",
    },
    {
      because:
        "audit-log entries and webhook failure events. Voluminous event telemetry, which is the owner's own stated boundary for what an atlas holds",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "audit-log entries and webhook failure events are emitted by Linear as things happen rather than created by a person",
        wouldBeMeasuredBy: "the `auditEntries` connection paged over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "session, credential and invitation state — authentication sessions, user sessions and organisation invites. A map of what exists does not need to hold who is signed in from where",
      ground: "not-fetched",
      wouldBeClosedBy:
        "reading authentication sessions, user sessions and organisation invites, none of which anything else here holds",
    },
    {
      because:
        "the VALUES of a webhook signing secret, a team or member calendar URL, and a workspace's SAML, SCIM, auth, security or AI-provider configuration blobs. `settingSurfaces.ts` never selects them and `sensitivity.ts` re-checks the class at publish time; the fields' existence is still visible through the `type` kind",
      ground: "secret-material",
    },
    {
      because:
        "any promise that a page SCREENSHOT is free of workspace content: it is a photograph of a real signed-in client, and a settings page renders team names, member names and label names inside its own chrome. So artifacts live only under `$SLOPWEAVER_HOME` and are never committed",
      ground: "claim-not-made",
    },
    {
      because:
        "any claim that the walked page list is COMPLETE. Linear publishes no sitemap for its settings surface, so the denominator is the route table declared in `routes.ts` — a permanently open `page-inventory-is-declared` gap says so, and a route that is missing from that table cannot be detected from inside the walk",
      ground: "claim-not-made",
    },
  ],
  kinds: [...LINEAR_ATLAS_KINDS],
  platform: LINEAR_ATLAS_PLATFORM,
  question:
    "what can be asked of Linear through its GraphQL API, what this workspace and its teams are actually configured to do, which settings pages this member can open, and where the two surfaces disagree",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas linear sync",
  surfaces: [
    {
      denominator: {
        because:
          "Linear publishes no catalogue of its `API_SURFACE` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: API_SURFACE,
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Linear publishes no catalogue of its `BROWSER_SURFACE` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: BROWSER_SURFACE,
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "the walk, the page inventory, the artifact writing and the GraphQL document reduction have all landed and are proven by unit tests over a fake transport; what has not happened is a real walk. Measured, `attachToOwnerChrome` times out against the owner's real Chrome — the Playwright Extension relay never completes its handshake — so no page has been reached and no screenshot held. This flips to filled in the commit that lands a witnessed walk, never before it",
    },
  ],
  visibilityScope: LINEAR_ATLAS_VISIBILITY_SCOPE,
};
