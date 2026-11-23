/**
 * What the WorkOS atlas declares about itself.
 *
 * ## This atlas holds EVERYTHING REACHABLE, and the criterion is not a preference
 *
 * `docs/atlas-intent/06-holdings.md`: the test is whether something better suited already holds this platform's
 * entities. For Slack the answer is yes — the corpus holds its channels, people and messages — so that
 * atlas maps the interface alone. For WorkOS the answer is no. The JumpCloud atlas holds an account record
 * saying a person has a WorkOS login, which is a fact about JumpCloud; nothing anywhere holds a WorkOS
 * organisation, user, SSO connection or SCIM directory. So those are kinds here rather than
 * `held-elsewhere` cells pointing at a better store that does not exist.
 *
 * ## Four surfaces, because each half of each channel is a different kind of claim
 *
 * A descriptor's `status` is static, which is the trap the JumpCloud atlas names: a surface declared
 * `filled` in source is filled on every install, including one where nothing has ever run. So only what has
 * actually been proven claims it.
 *
 * `api-route-map` is `filled`, and the evidence is a live run rather than a belief. MEASURED 2026
 * against `api.workos.com` with NO credential: 68 candidate (method, path) pairs probed, 51 proved present
 * by the server's own answer and 17 proved not routed under that method. That surface needs no key at all,
 * which is exactly why it is a separate surface from the content it describes — collapsing the two would
 * have forced one status to lie about the other.
 *
 * `api-content` is `declared-unfilled` and says what it needs. `dashboard-page-map` is `compiled` and
 * `filled`: every dashboard address is published as a `page` entity, which is the half of
 * `docs/atlas-intent/05-browser-proof.md` that needs no browser at all. `dashboard-walk` is the browser surface proper, and it
 * flips only when pages have actually been reached and photographed — never when a transport that could
 * reach them merely exists.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { WORKOS_EXCLUSIONS } from "./exclusions.js";
import { WORKOS_ATLAS_KINDS, WORKOS_ATLAS_PLATFORM } from "./model.js";

/** WorkOS's atlas, as it declares itself. */
export const WORKOS_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [...WORKOS_EXCLUSIONS],
  kinds: [...WORKOS_ATLAS_KINDS],
  platform: WORKOS_ATLAS_PLATFORM,
  question:
    "which routes WorkOS's REST API actually serves and which of them take a credential, which " +
    "organisations, users, SSO connections and SCIM directories an environment holds, and the exact " +
    "dashboard URL that proves each",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas workos refresh",
  surfaces: [
    {
      denominator: {
        because:
          "WorkOS publishes no catalogue of its `api-route-map` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: false,
      name: "api-route-map",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "WorkOS publishes no catalogue of its `api-content` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "api-content",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no WorkOS API key is configured, and dashboard access through an identity provider's " +
        "SaaS-management account record mints none. A key is per-ENVIRONMENT, so configuring one also " +
        "decides which environment this half sees — `slopweaver secrets set workos-api-key` then " +
        "`slopweaver atlas workos sync` fills it",
    },
    {
      denominator: {
        because:
          "WorkOS publishes no catalogue of its `dashboard-page-map` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: false,
      name: "dashboard-page-map",
      role: "discovery",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "WorkOS publishes no catalogue of its `dashboard-walk` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "dashboard-walk",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "no browser has been driven, so not one declared address is witnessed and none carries a " +
        "screenshot. `slopweaver atlas workos walk` prints the brief a signed-in session carries out. " +
        "MEASURED, the one signal available without driving one is weak in a KNOWN direction: " +
        "`slopweaver browser cookies --origin https://dashboard.workos.com` can report only " +
        "`wos_sso_csrf_token`, which is a CSRF token rather than a session — but a cookie probe reads " +
        "names and cannot see a session held in localStorage, and reading its silence as proof is the " +
        "measured false negative other signed-in origins produce under the same probe. So " +
        "the walk may simply work; the brief asks it to check, and refuses a document that says it did not",
    },
  ],
  visibilityScope:
    "three unrelated ceilings, and only the first needs nothing. The route map sees what an ANONYMOUS " +
    "caller is told about `api.workos.com`, so it is the same on every install; the content channel sees " +
    "exactly the ONE environment its secret key was minted for and is blind to every sibling; and the " +
    "dashboard channel sees exactly what the signed-in person's team role opens across all of them. None " +
    "implies another, so a route, an organisation or a page missing from one is never evidence about the " +
    "others",
};
