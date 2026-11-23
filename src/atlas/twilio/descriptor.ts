/**
 * What the Twilio atlas declares about itself — the row a catalogue shows, and the honest answer to "how
 * much of this platform have you actually looked at".
 *
 * ## This one holds EVERYTHING REACHABLE, and the test is not close
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? For Slack and Notion it does — the corpus — so those atlases map
 * the interface alone. For Twilio nothing does. No phone number, messaging service, subaccount or delivery
 * status exists anywhere else in this installation, which is what the vendor-reach pass meant by naming
 * Twilio the delivery ground truth for customer comms. So the entity kinds are declared here and each says
 * for itself how far it has got.
 *
 * ## ONE of the three surfaces is blocked now, and what blocks it is not what blocked it
 *
 * MEASURED, both the console and the credential were missing and the two absences had one cause:
 * `console.twilio.com` redirected to `www.twilio.com/login` with an empty email field, and minting an API
 * key needs a console. MEASURED AGAIN, the owner signed in and the browser surface filled — a
 * walk landed and photographed the declared and navigation-discovered pages in region `us1`.
 *
 * **So the entity surface's reason had to be rewritten rather than left standing, and that is the point.**
 * It is no longer blocked behind the browser surface, because the browser surface is open. It is blocked on
 * a WRITE: minting an API key creates a durable credential in the account — and SETTLED, the
 * write bucket an undoored platform falls in is no longer an open ruling. Twilio is not in
 * `WRITE_POLICY_REGISTER`, so it is `refuse-every-write` by default and the guard refuses that mint. The
 * surface is therefore PERMANENTLY unfilled under the current ruling rather than pending anything, and
 * `sync.ts`'s {@link TWILIO_ENTITY_UNBLOCKED_BY} says so. A surface whose stated blocker has been cleared
 * while the surface stays empty is the exact shape of a cell that has stopped being true.
 *
 * ## No surface's status is a literal a reader ever sees
 *
 * A descriptor's `status` is static, which is the trap this class of file most often falls into: a surface
 * declared `filled` in source is filled on every install, including one where the sync has never run. So
 * `surfaceFill.ts` derives `spec-declared` from this install's own manifest, against an exact invariant —
 * both compiled kinds carrying a recorded success — and substitutes it before any reader sees this object.
 * The literals below are what a store that has never been synced honestly says.
 *
 * ## Why `excludes` is long
 *
 * `kit/contract.ts` requires it and says why: what an atlas deliberately does NOT hold is the fact a reader
 * needs most and the one nobody writes unless a type demands it. Every entry below is a decision with a
 * reason, not a limitation being apologised for.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { TWILIO_BROWSER_PAGES } from "./browserPages.js";
import { TWILIO_ATLAS_KINDS, TWILIO_ATLAS_PLATFORM, TWILIO_VISIBILITY_SCOPE } from "./model.js";
import { TWILIO_FIELD_DEPTH } from "./specSurface.js";

/** Twilio's atlas, as it declares itself. */
export const TWILIO_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every mutation on both surfaces. This atlas only ever reads: no message is sent, no number bought or " +
        "released, no service or flow changed, no recording deleted. `exclusions.ts` computes the refusal " +
        "from the HTTP method rather than listing endpoints, so an API Twilio publishes next month is refused " +
        "without this repository changing — and every refused operation still gets a `method` row, because an " +
        "atlas that omitted them would answer that Twilio has no way to send a message",
      ground: "never-acted",
    },
    {
      because:
        "a row per record in the message and call logs, and in every family the same criterion catches: " +
        "recordings, transcriptions, conferences, notifications, debugger alerts and monitor events, usage " +
        "records, Voice Insights summaries and metrics, Studio executions and their steps, TaskRouter events, " +
        "reservations and statistics, Verify attempts, video rooms and compositions, and bulk exports. This " +
        "is a DISPOSITION rather than an exclusion and the difference is load-bearing: every one of those " +
        "operations is still mapped, its parameters and response field names recorded, and a reader learns it " +
        "exists and how to call it. What it never does is publish a row per record. See `disposition.ts` for " +
        "the criterion, which is applied per operation because it cuts THROUGH a product area rather than " +
        "along it — `/v1/Rooms/{RoomSid}/Recordings` is observations and `/v1/Rooms/{RoomSid}/RecordingRules` " +
        "is configuration somebody authored",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "messages, calls, recordings, transcriptions, conferences, notifications, debugger alerts, usage records and TaskRouter events are all emitted per event rather than authored",
        wouldBeMeasuredBy:
          "`GET /2010-04-01/Accounts/{sid}/Messages.json` paged over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "whether one particular message landed. That is the question the ask is ultimately about and it is a " +
        "LIVE CALL rather than an atlas read: the atlas answers where delivery truth lives (the Message " +
        "resource's `status`, `error_code` and `date_sent`, the operations that filter them by date, and " +
        "which credential reaches them) and never holds the rows themselves",
      ground: "claim-not-made",
    },
    {
      because:
        "the VALUE of any response field on either surface. What is stored is the field NAME and, for the " +
        "browser channel, the path shape and status a first-party call returned — never a message body, a " +
        "recording, a phone number or a person's name. `webReduction.ts` is the committed redaction, and it " +
        "recognises both a Twilio SID and an E.164 number as path values",
      ground: "names-not-values",
    },
    {
      because:
        "a screenshot of any individual record. The declared console page list holds one page per list surface " +
        "and none per row, which is `docs/atlas-intent/06-holdings.md`'s own rule in Twilio's terms: a message log entry is " +
        "what a Slack message is, and a screenshot of every one ever sent is not expected",
      ground: "never-acted",
    },
    {
      because:
        `response fields nested more than ${String(TWILIO_FIELD_DEPTH)} levels deep, on either surface. The two ` +
        "surfaces are measured at the same depth on purpose — a divergence found between two different depths " +
        "would be an artefact of the measurement rather than a fact about Twilio, which is the opposite of " +
        "what `report.ts` exists to find",
      ground: "names-not-values",
    },
    {
      because:
        "console routes Twilio's own documentation never links to, until a walk finds them. The declared page " +
        `list is ${String(TWILIO_BROWSER_PAGES.length)} routes harvested from Twilio's docs, which makes the ` +
        "denominator checkable and makes it a FLOOR: the console certainly has more, and only a signed-in " +
        "walk can find them. `walk.ts` expands the list from the navigation each landed page renders, so this " +
        "exclusion shrinks as pages are actually reached",
      ground: "claim-not-made",
    },
  ],
  kinds: [...TWILIO_ATLAS_KINDS],
  platform: TWILIO_ATLAS_PLATFORM,
  question:
    "what can be asked of Twilio and where does it live — every published API definition, endpoint, " +
    "parameter and response field, which of the thirty-eight origins answers it and which credential " +
    "reaches it, every page of the console and the operations its own client calls — and what does this " +
    "account actually hold in accounts, numbers and services",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas twilio sync",
  surfaces: [
    {
      denominator: {
        because:
          "Twilio publishes no catalogue of its `spec-declared` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "spec-declared",
      role: "authoritative",
      // A LITERAL nobody reads: `surfaceFill.ts` derives this surface's status from the install's own
      // manifest and substitutes it before any reader sees the descriptor. The value here is what a store
      // that has never been synced honestly says.
      status: "declared-unfilled",
      unfilledBecause: "`slopweaver atlas twilio sync` has not run on this install, so nothing is published",
    },
    {
      denominator: {
        because:
          "Twilio publishes no catalogue of its `account-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "account-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no Twilio credential exists in this installation — there is no `twilio-account-sid` in the secrets " +
        "store — and MEASURED this is no longer blocked behind the browser surface, which is " +
        "signed in and filled. The only route to a credential is minting an API key, and that is a WRITE: " +
        "it creates a durable credential in the account — and under the owner's ruling an unregistered " +
        "platform is `refuse-every-write`, so the browser-door guard refuses that mint rather than allowing " +
        "it for want of a policy. So the `account` and " +
        "`resource` kinds report `not-configured` by DECISION rather than for want of access, and this " +
        "atlas holds the surface map without the entities it is supposed to hold",
    },
    {
      denominator: {
        because:
          "Twilio publishes no catalogue of its `console` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "console",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "`slopweaver atlas twilio walk` has not reached a console page on this install. A surface is filled " +
        "by pages actually reached, never by a transport that could reach them, so this literal is what a " +
        "store that has never walked honestly says — `surfaceFill.ts` substitutes the derived status before " +
        "any reader sees it. MEASURED on the owner's own install, one signed-in walk cleared it, landing and " +
        "photographing pages in region us1. A walk that finds the session gone again grades the route " +
        "`signed-out` and says so rather than reporting an empty surface",
    },
  ],
  visibilityScope: TWILIO_VISIBILITY_SCOPE,
};
