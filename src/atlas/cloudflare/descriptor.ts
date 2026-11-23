/**
 * What the Cloudflare atlas declares about itself — the row a catalogue shows, and the honest answer to
 * "how much of this platform have you actually looked at".
 *
 * ## The browser surface is declared and empty, and that is where the deep-link finding lives
 *
 * **Its reason names a RULING, not a missing mechanism, and that distinction is the point.** The surface is
 * unfilled for want of a walk, not because no browser DRIVING has shipped: the owner retired every dedicated
 * Playwright profile lane (docs/browser-route/screenshot-reading-and-retirement.md) and ruled that their own
 * real Chrome — driven through `playwright-core`'s extension relay — is the only browser for anything
 * (docs/browser-route.md, docs/browser-route/target-proof-and-playwright.md). The mechanism ships; the
 * CrowdStrike atlas walks its whole console with it. What is missing here is a walk, and a reader who is told
 * the wrong reason concludes the wrong thing about what it would take to fix.
 *
 * The retired sentence is quoted VERBATIM in `unit/atlas/cloudflare/descriptor.test.ts` and deliberately
 * not here: a board probe asserts that exact literal is absent from THIS file, so paraphrasing the old
 * wording in the very comment explaining the correction is what keeps the tripwire able to fire. Measured —
 * this file's first draft quoted it and the probe failed on the fix that was supposed to satisfy it.
 *
 * This atlas has one filled surface: the REST API through the official SDK. Porting it onto the kit
 * surfaced the fact the kit's `AtlasSource` was written to expose — **Cloudflare hands back no deep link on
 * any surface this atlas reads.** A dashboard URL is CONSTRUCTIBLE from an account id, a zone id and a
 * resource id, and constructing one would have been the easy way to fill the field; it would also have been
 * a link this code invented, recorded as though the provider had provided it. The kit's own answer to that
 * is `deepLinkStatus`, whose whole point is telling a provider-provided link apart from a browser-discovered
 * one — and the honest value here is `unverified` on every record, because nobody has looked with a browser.
 *
 * Saying that per-record means adding two fields to `cloudflareSourceSchema`, which is an on-disk layout
 * change, a schema bump, and a forced reset on every install that already has data — see `model.ts`'s own
 * note on the same schema. So it is declared ONCE, here, as `unfilledBecause` on the surface that would fix
 * it. A reader gets the fact; nobody loses a generation to get it.
 *
 * ## Excludes is the inventory's own list
 *
 * `CLOUDFLARE_EXCLUDED_SURFACES` already carried what this atlas deliberately does not hold, checked by
 * `inventory.test.ts` against what `sync.ts` actually wires. The descriptor quotes it rather than restating
 * it, so the two cannot drift into two different answers to the same question.
 */
import type { AtlasDescriptor } from "../kit/contract.js";

import { CLOUDFLARE_EXCLUDED_SURFACES } from "./inventory.js";
import { CLOUDFLARE_ATLAS_PLATFORM, CLOUDFLARE_KINDS, CLOUDFLARE_VISIBILITY_SCOPE } from "./model.js";

/** Cloudflare's atlas, as it declares itself. */
export const CLOUDFLARE_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [...CLOUDFLARE_EXCLUDED_SURFACES],
  kinds: [...CLOUDFLARE_KINDS],
  platform: CLOUDFLARE_ATLAS_PLATFORM,
  // Two days rather than the four-hour default: this atlas is meant to run daily once `cloudflare sync` is
  // public, so missing one day's run is the only slack this policy needs to allow. A four-hour window
  // borrowed from the faster atlases would report it behind between every scheduled run.
  freshnessWindow: "2d",
  question: "what edge, access and DNS configuration does this account actually have in place, and where",
  resyncCommand: "slopweaver cloudflare sync",
  surfaces: [
    {
      denominator: {
        because:
          "Cloudflare publishes no catalogue of its `rest-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "rest-api",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Cloudflare publishes no catalogue of its `dashboard` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "dashboard",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "no walk of the Cloudflare dashboard has been built for this atlas yet. The ROUTE exists — the owner's ruling retired every dedicated Playwright profile (docs/browser-route/screenshot-reading-and-retirement.md) and named their own real Chrome, reached through `playwright-core`'s extension relay, as the only browser for anything (docs/browser-route.md, docs/browser-route/target-proof-and-playwright.md); `crowdstrike walk` already runs that way. Until one runs here, every stored record's deep link is unverified: Cloudflare's REST API returns no link on any surface read here, and a dashboard URL assembled from ids would be this code's invention rather than the provider's answer. Three facts are dashboard-only and no API reader can reach them: purchased-versus-used seat capacity (access/seats answers 405 to any API token), the Access/Gateway/Shadow-IT analytics views, and Browser Isolation usage",
    },
  ],
  visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
};
