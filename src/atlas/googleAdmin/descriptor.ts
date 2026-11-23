/**
 * What the Google Admin atlas declares about itself — the row a catalogue shows, and the honest answer to
 * "how much of this platform have you actually looked at".
 *
 * ## It holds the SURFACE MAP, and that is the owner's own ruling rather than an appetite
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? On this one the answer is yes twice over — the corpus holds the
 * people, and the Gmail, Drive and Calendar doors each hold their own half of what this account contains,
 * with their own row and their own grant. What nothing holds is the Admin CONSOLE: which pages exist, what
 * each is called, which method reaches the same fact, and which administrator scope a caller would have to
 * be granted first. So this atlas maps the interface, exactly as the Slack atlas does.
 *
 * ## Three surfaces, and only ONE of them is reachable on this machine
 *
 * MEASURED, and stated here rather than apologised for, because it is what the coverage cells
 * say and a reader should meet it in the descriptor first:
 *
 * - `discovery` is FILLED, and needs no credential at all. Google publishes a machine-readable document
 *   for every API; `generated/surfaces.ts` holds all 336 methods the eleven selected ones declare and
 *   `generated/discoveryLock.ts` pins the bytes they were read from. This is a complete MAP and says
 *   nothing about this Workspace account.
 * - `admin-api` is DECLARED-UNFILLED until this install consents. Every method here is gated by a Workspace
 *   administrator scope, and `slopweaver atlas google-admin connect --status` reports what has been granted.
 *   `connect` runs the consent round trip — readonly scopes only, so nothing it can approve may write — and
 *   `fill` then calls every published operation that grant reaches. Two things still gate a filled cell
 *   after a successful consent, and both are the CLOUD PROJECT rather than the grant: the five APIs behind
 *   these documents must each be enabled, and the consenting account must hold an admin role.
 * - `admin-console` is FILLED, and the story of how is the interesting part. The Admin console re-verifies a
 *   signed-in administrator with Google's own step-up challenge, asking for a password before it will render
 *   a console page, so a session with valid cookies can still land on `/ac/home`'s challenge. That is the
 *   console re-verifying rather than a missing session, and nothing here may pass it. **A person clears it in
 *   their own browser**, and the walk then runs there: 10 pages opened and judged loaded, 47 distinct routes seen linked.
 *
 *   Its per-kind cell is `deferred` rather than `synced` and always will be. Google publishes no route
 *   inventory for this console, so the page list is a FLOOR rather than a total, and the route into the owner's
 *   Chrome returns an image to the model rather than a file, so no page carries a screenshot
 *   (`docs/atlases/google-admin.md` records the first, `docs/browser-route/brief-profile-and-walks.md` measures
 *   the second). An atlas that graded this `synced` would be claiming a completeness the platform does not offer.
 *
 * **Both surfaces are still mandatory and the browser surface never shrinks** (an owner ruling).
 * Declaring them and leaving them unfilled is honest; not declaring them is not — `kit/contract.ts`'s
 * header carries the reasoning, and `gaps.ts` carries what would fill each.
 *
 * ## The descriptor's `status` is static, so nothing here may claim `filled` before it is
 *
 * A surface declared `filled` in source is filled on every install, including one where the sync has never
 * run. `discovery` is the one surface that legitimately claims it: it is compiled from a table committed
 * to this build, so it is filled the moment the code exists. The other two flip in the commit that lands
 * the code that fills them, not in the commit that makes filling them possible.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { GOOGLE_ADMIN_SELECTION_CRITERION } from "./apiSelection.js";
import { GOOGLE_ADMIN_ATLAS_KINDS, GOOGLE_ADMIN_ATLAS_PLATFORM } from "./model.js";

/** Google Admin's atlas, as it declares itself. */
export const GOOGLE_ADMIN_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every entity the world model and the Google doors already hold — the people the corpus holds, and the mail, files and calendar events the Gmail, Drive and Calendar doors each hold under their own grant. The owner's per-platform ruling is that a platform whose entities something better suited holds gets a SURFACE MAP, and on this platform that is the Admin console itself",
      ground: "held-elsewhere",
      holder: "the world model's corpus for people, and the Gmail, Drive and Calendar doors for mail, files and events",
    },
    {
      because:
        "every mutation, on every surface. This atlas only ever reads: no user is created, suspended or deleted, no group or org unit is changed, no device is wiped, no policy is modified and no licence is assigned. All 180 write methods are INVENTORIED with an `exclusionReason` on each row rather than omitted, so the atlas can answer what this platform can be made to do without ever doing it",
      ground: "never-acted",
    },
    {
      because:
        "the two media uploads — `chromepolicy.media.upload` and `groupsmigration.archive.insert`. They take THIS machine's content as their request body, so calling them to map them would send data to Google rather than read from it. Their declared shapes are held; their invocation is not",
      ground: "never-acted",
    },
    {
      because:
        "a row per audit event, usage report, telemetry event, Chrome fleet report, alert or browsing summary. Those 28 methods take the highly-voluminous disposition of `docs/atlas-intent/06-holdings.md` — the family is reached over a bounded window and its SHAPE recorded, never a record per event. This is a disposition and not an exclusion: `slopweaver atlas google-admin read --kind reports-activities` says what an audit activity IS",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "an audit event, a usage report, a telemetry event, a Chrome fleet report, an alert and a browsing summary are each stamped with an instant and emitted by Workspace rather than authored",
        wouldBeMeasuredBy: "`reports.activities.list` for one application over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "the VALUES of a user's security tokens, application-specific passwords and verification codes. `directory-tokens`, `directory-asps` and `directory-verification-codes` are mapped as surfaces — the methods, the parameters, the declared field names — and no channel here has ever called one, nor would store what it returned",
      ground: "secret-material",
    },
    {
      because: `every Google API the selection criterion did not select. The criterion is that ${GOOGLE_ADMIN_SELECTION_CRITERION}, applied over the whole Discovery index; \`apiSelection.ts\` names each near miss with the reason it failed, including the two whose Admin console page is therefore unmapped on the API side`,
      ground: "not-fetched",
      wouldBeClosedBy:
        "widening `apiSelection.ts` past the administrator-scope criterion, which names each near miss and the reason it failed",
    },
    {
      because:
        "any promise that a page SCREENSHOT would be free of account content: it would be a photograph of a real signed-in admin console, and a settings page renders people's names inside its own chrome. So artifacts would live only under `$SLOPWEAVER_HOME` and are never committed",
      ground: "claim-not-made",
    },
    {
      because:
        "any claim that the walked page list is COMPLETE. Google publishes no route inventory for the Admin console and no sitemap carrying one, so the walk's denominator is what the console itself linked. The `console-inventory-is-observed` gap says so permanently, and it is why the console cell is `deferred` rather than `synced`",
      ground: "claim-not-made",
    },
    {
      because:
        "any per-page SCREENSHOT. `docs/atlas-intent/05-browser-proof.md` wants the picture and the route into the owner's own Chrome cannot give one — it answers with an image to the model rather than a file a verb reads back. So a page says `reached but not photographed` rather than claiming a proof this atlas does not hold",
      ground: "never-acted",
    },
    {
      because:
        "the identifier in any console route. One page here renders a link per person in the directory, so `consoleRoute.ts` replaces every opaque path segment with a placeholder before anything is stored, and the walk verb re-normalises rather than trusting that its brief was followed",
      ground: "names-not-values",
    },
  ],
  kinds: [...GOOGLE_ADMIN_ATLAS_KINDS],
  platform: GOOGLE_ADMIN_ATLAS_PLATFORM,
  question:
    "what can be asked of this organisation's Google Workspace administration — every method, parameter, response field and declared record shape across the eleven APIs behind the Admin console, which administrator scope each one needs, and which console pages reach what no API does",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas google-admin sync",
  surfaces: [
    {
      denominator: {
        because:
          "Google Admin publishes no catalogue of its `discovery` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "discovery",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Google Admin publishes no catalogue of its `admin-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "admin-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "every method is gated by a Workspace administrator scope — `slopweaver atlas google-admin connect --status` prints what this installation has been granted. `slopweaver atlas google-admin connect` runs the consent round trip, requesting readonly scopes only, and `slopweaver atlas google-admin fill` then reads under it; nothing here grants itself an admin role",
    },
    {
      denominator: {
        because:
          "Google Admin publishes no catalogue of its `admin-console` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "admin-console",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
  ],
  visibilityScope:
    "the discovery channel sees exactly what Google publishes and needs no credential, so 'complete' there means complete as a MAP and says nothing about this Workspace account; the admin-api channel would see what the granted administrator scopes open, which is decided in the Admin console itself; the admin-console channel would see what the owner's own signed-in session renders, bounded by the admin ROLE the signed-in account holds, so a page that role cannot open is a declared gap rather than a silence",
};
