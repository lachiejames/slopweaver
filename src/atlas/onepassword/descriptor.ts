/**
 * What this atlas declares about itself — the row a catalogue shows, and the honest answer to "how much of
 * this platform have you actually looked at".
 *
 * ## `excludes` is doing real work here, not ceremony
 *
 * On every other atlas in this repo, `excludes` names what nobody got round to. Here it names a permanent
 * position: the item contents this atlas will never hold, whatever access it is later granted. A reader
 * deciding whether to trust this thing with an administrative credential should be able to learn that from
 * the descriptor alone, without reading `sensitivity.ts`.
 *
 * ## Two surfaces filled, one declared and empty
 *
 * The `admin-cli` and `events-api` surfaces are both API-side and both fill. The browser surface — the
 * administrative console driven directly — is declared and unfilled, which is a state this atlas SAYS about
 * itself. That matters more here than elsewhere: 1Password's console shows a per-vault access matrix and a
 * per-person activity view that no `op` verb reproduces, so the API-only picture is genuinely narrower than
 * the platform, and a reader must not mistake it for the whole one.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { ONEPASSWORD_ATLAS_PLATFORM, ONEPASSWORD_KINDS, ONEPASSWORD_VISIBILITY_SCOPE } from "./model.js";

/** This atlas, as it declares itself. */
export const ONEPASSWORD_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "any item's secret fields — passwords, one-time codes, notes, custom field values, document contents, attachment bytes. Permanent, enforced by three independent mechanisms rather than by care",
      ground: "secret-material",
    },
    {
      because:
        "item titles — a title routinely carries the secret's own subject, and neither question this atlas answers needs one; a vault's item COUNT is held instead",
      ground: "secret-material",
    },
    {
      because:
        "item-usage and sign-in-attempt events, which the Events API offers and this atlas's token deliberately does not request",
      ground: "not-fetched",
      wouldBeClosedBy: "requesting the Events API scopes this atlas's token deliberately does not ask for",
    },
    {
      because: "billing, invoices and subscription state",
      ground: "not-fetched",
      wouldBeClosedBy:
        "reading billing, invoices and subscription state, which nothing else in this installation holds",
    },
    { because: "mutations of any kind — every verb in the command allowlist is a read", ground: "never-acted" },
  ],
  kinds: [...ONEPASSWORD_KINDS],
  platform: ONEPASSWORD_ATLAS_PLATFORM,
  question:
    "who is in this 1Password account, which groups and vaults exist, who can reach which vault and with what permissions, how much each vault holds, and what administrative activity has happened",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver onepassword sync",
  surfaces: [
    {
      denominator: {
        because:
          "1Password publishes no catalogue of its `admin-cli` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "admin-cli",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "1Password publishes no catalogue of its `events-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "events-api",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "1Password publishes no catalogue of its `browser` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "browser",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "no browser driving ships for this atlas yet; the console's per-vault access matrix and per-person activity view have no `op` equivalent, so this surface is a real narrowing rather than a formality",
    },
  ],
  visibilityScope: ONEPASSWORD_VISIBILITY_SCOPE,
};
