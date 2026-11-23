/**
 * What the Canva atlas declares about itself — the row a catalogue shows, and the honest answer to "how much
 * of this platform have you actually looked at".
 *
 * ## It holds the SURFACE MAP, and §6's test is why rather than a preference
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? Nothing here does, so the test's answer is "everything reachable,
 * entities included" — and what is REACHABLE today is the published surface and nothing else, because this
 * installation has no Canva integration at all. So the atlas holds the map, declares the two channels that
 * would carry entities, and mints no kind for records nothing can fetch. That is §6 applied honestly rather
 * than §6 overruled: the shape changes in the commit that lands a credential, not in this one.
 *
 * ## Three surfaces, and only ONE of them is filled — for two different reasons
 *
 * MEASURED, and stated here rather than apologised for, because it is what the coverage cells say
 * and a reader should meet it in the descriptor first:
 *
 * - `published-api` is FILLED, and needs no credential at all. `generated/surfaces.ts` holds all 59
 *   operations and all 18 declared OAuth scopes, and `generated/specLock.ts` pins the bytes they were read
 *   from. This is a complete MAP and says nothing about anybody's designs.
 * - `connect-api` is DECLARED-UNFILLED. No `canva-*` entry exists under `$SLOPWEAVER_HOME/secrets`, and 53 of
 *   the 59 operations declare `oauthAuthCode` — an authorisation-code grant only a registered integration
 *   can obtain. Nine of them need more than a scope even then: `eligibility.ts` measures seven requiring a
 *   Canva Enterprise organisation and two a premium plan.
 * - `web-app` is DECLARED-UNFILLED, and it is the one unfilled surface here that waits on NOBODY.
 *   `slopweaver browser cookies --origin https://www.canva.com` reports the cookies the owner's own Chrome
 *   profile holds for that origin, so a signed-in session already exists — what is missing is the walk itself. Saying "no session"
 *   here, the way the Nightfall descriptor truthfully does for its console, would send a reader to perform a
 *   sign-in that has already happened.
 *
 * **Both surfaces are still mandatory and the browser surface never shrinks**. Declaring
 * them and leaving them unfilled is honest; not declaring them is not — `kit/contract.ts`'s header carries
 * the reasoning, and `gaps.ts` carries what would fill each.
 *
 * ## The descriptor's `status` is static, so nothing here may claim `filled` before it is
 *
 * A surface declared `filled` in source is filled on every install, including one where the sync has never
 * run. `published-api` is the one surface that legitimately claims it: it is compiled from a table committed
 * to this build, so it is filled the moment the code exists. The other two flip in the commit that lands the
 * code that fills them, not in the commit that makes filling them possible.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { CANVA_ATLAS_KINDS, CANVA_ATLAS_PLATFORM } from "./model.js";

/** Canva's atlas, as it declares itself. */
export const CANVA_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every mutation on every surface. This atlas only ever reads: no design is created, resized, merged or imported, no folder is moved or deleted, no asset is uploaded or removed, no comment is posted and no OAuth token is minted or revoked. The 23 non-reading operations are INVENTORIED with an `effectBecause` on each row rather than omitted, so the atlas can answer what this platform can be made to do without ever doing it",
      ground: "never-acted",
    },
    {
      because:
        "the export and print-partner-export families as ACTS. `createDesignExportJob` and `createPrintPartnerDesignExportJob` render a file and, for print, place a real order; they change no stored design and are still work Canva performs rather than state it holds, so they carry the `side-effecting` effect and are mapped, never issued",
      ground: "never-acted",
    },
    {
      because:
        "design CONTENT of every kind. Nothing here holds a design, a page, an asset's bytes, a comment's text or a viewer's identity. An `operation` entity carries a method, a path template and parameter and response field NAMES; a `scope` entity carries a scope string and the operations that name it. Neither is a record",
      ground: "payload-not-map",
    },
    {
      because:
        "a row per analytics observation. The five analytics reads return view counts and viewer breakdowns over a window — time-series observations the platform emitted, which is the highly-voluminous disposition of `docs/atlas-intent/06-holdings.md`. Their SHAPE is atlas content and their rows would not be, and in any case no credential here can call them: they additionally require a Canva Enterprise organisation",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "the five analytics reads return view counts and viewer breakdowns per window — observations the platform emitted rather than anything a person created",
        wouldBeMeasuredBy:
          "a Canva Enterprise credential calling the design-insights read over a fixed window; no credential here can call one at all",
      },
    },
    {
      because:
        "the owner's Canva session cookies, and any use of them to authenticate an API call. The web-app walk, when it is built, drives the owner's real Chrome under `docs/browser-route.md`; it never lifts a cookie into a request the Connect API would otherwise refuse",
      ground: "secret-material",
    },
  ],
  kinds: [...CANVA_ATLAS_KINDS],
  platform: CANVA_ATLAS_PLATFORM,
  question:
    "what can be asked of Canva and where — every published Connect API operation with its method, path, parameters, response fields, paging, per-user rate limit and OAuth scopes; what each one would DO if issued; and the two things no machine-readable field carries: which operations are previews whose breaking changes produce no new API version, and which need the acting user to be on a premium plan or in a Canva Enterprise organisation before any scope grant matters",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas canva sync",
  surfaces: [
    {
      denominator: {
        because:
          "Canva's published operations are compiled into this atlas's own registry, and that registry has not yet been split into reached and unreached",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "published-api",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "no live call has been made against this Canva account, so the Connect API surface has nothing measured to divide by",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "connect-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "this installation has no Canva integration — no `canva-*` entry exists under `$SLOPWEAVER_HOME/secrets`, and 53 of the 59 published operations declare `oauthAuthCode`, whose authorisation-code grant only a registered integration can obtain. An integration registered at canva.com/developers, its grant completed as the acting user and its token stored as `canva-access-token`, fills it — for the 50 operations that need no further entitlement",
    },
    {
      denominator: {
        because: "the Canva web app publishes no route manifest",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "web-app",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "no walk of canva.com has been written or run. Unlike every other unfilled surface in this build it is blocked on nothing external: the cookie probe (`slopweaver browser cookies --origin https://www.canva.com`) reports the cookies the owner's own Chrome profile holds for www.canva.com, so the session is already there. What it would land is every page's existence, screenshots of the settings pages, and the methods the first-party web client calls — including whatever reaches the `brands` area the published description declares and gives no operation for",
    },
  ],
  visibilityScope:
    "the published-api channel sees exactly what the vendor publishes and needs no credential, so 'complete' there means complete as a MAP and says nothing about anybody's designs; the connect-api channel would see what one integration's granted scopes open AND what the acting user's own plan entitles, which are two different ceilings and the second is invisible to every machine-readable field in the description; the web-app channel would see what the owner's own signed-in personal account renders, so an organisation-administration page that account cannot open is a declared gap rather than a silence",
};
