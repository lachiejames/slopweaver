/**
 * What the Jam atlas declares about itself — the row a catalogue shows, and the honest answer to "how much
 * of this platform have you actually looked at".
 *
 * ## This one holds EVERYTHING REACHABLE, with a disclosure scoping rather than a volume one
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? For Slack and Notion it does — the corpus — so those atlases map
 * the interface alone. For Jam nothing does: no team, member, connected application or recording of this
 * workspace exists in any other store here.
 *
 * The one thing it does NOT hold is a jam's PAYLOAD, and that is a disclosure bound settled before any
 * ingest rather than a volume one settled after, which is not the Datadog case. A
 * jam is a screen recording of a real working session, so its frames, its console log, its network log and
 * its DOM snapshot are customer-adjacent material. `excludes` states it and the permanently open
 * `jam-payload-withheld-on-disclosure` gap carries it where a reader meets it.
 *
 * ## Five surfaces, three channels, and one of them can never be more than `discovery`
 *
 * `published-api` and `route-probe` are the compiled channel: what Jam's own documents declare, and what its
 * two hosts actually serve. `mcp-resource` is the live read that would fill this workspace's entities and
 * has no credential yet. `web-app` and `web-client-operations` are the browser channel — the application
 * walked in the owner's own Chrome, authoritative for the navigation surface and never more than `discovery`
 * for the operations it observes: seeing the first-party client call something establishes that it EXISTS,
 * and nothing about what a token may ask for.
 *
 * ## No surface's status is a literal a reader ever sees
 *
 * A descriptor's `status` is static, which is the trap this class of file most often falls into: a surface
 * declared `filled` in source is filled on every install, including one where the sync has never run. So
 * `surfaceFill.ts` derives every fillable surface from this install's own manifest, against exact
 * invariants, and substitutes them before any reader sees this object.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { JAM_ATLAS_KINDS, JAM_ATLAS_PLATFORM, JAM_VISIBILITY_SCOPE } from "./model.js";
import {
  JAM_BROWSER_UNBLOCKED_BY,
  JAM_MCP_SURFACE,
  JAM_MCP_UNBLOCKED_BY,
  JAM_ROUTE_SURFACE,
  JAM_SPEC_SURFACE,
  JAM_WEB_APP_SURFACE,
  JAM_WEB_CLIENT_SURFACE,
} from "./surfaces.js";

/** Jam's atlas, as it declares itself. */
export const JAM_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "a jam's PAYLOAD — its video frames, its console log, its network log, its DOM snapshot and its " +
        "comments. A jam is a screen recording of a real working session, so that material is " +
        "customer-adjacent, and this atlas holds a recording's EXISTENCE and metadata instead. That is why " +
        "there is no `jam` KIND at all: a kind would be a row per recording, and the row this atlas is " +
        "commissioned to hold is the page that lists them. A disclosure bound settled before any ingest, " +
        "carried as the permanently open `jam-payload-withheld-on-disclosure` gap",
      ground: "disclosure-bound",
      ruledBy:
        "a disclosure bound settled before any ingest, carried as the permanently open `jam-payload-withheld-on-disclosure` gap — a jam is a screen recording of a real working session",
    },
    {
      because:
        "every mutation, on every surface. This atlas only ever reads: no team is created, no member invited or " +
        "removed, no integration connected or disconnected, no jam deleted, and no OAuth client registered — " +
        "which is the one that needs saying, because `POST /oauth/register` is a write that looks like a " +
        "probe. Every refused operation still gets a row, because an atlas that omitted them would answer " +
        "that Jam has no way to register a client",
      ground: "never-acted",
    },
    {
      because:
        "the VALUE of any response field, on any surface. The compiled channel calls nothing, so every field it " +
        "holds is a NAME; the route probe stores a status and a content type and never a body; the browser " +
        "walk stores where a page settled, its title and its own call SHAPES, never what a call answered",
      ground: "names-not-values",
    },
    {
      because:
        "any application page whose purpose is to reveal or mint a credential — `/settings/cli`, `/settings/sdk` " +
        "and the OAuth authorisation screens. A screenshot is this atlas's proof and is KEPT, so a page " +
        "displaying an access token would put a working secret into the generation as an image, where no " +
        "field-level denial could reach it. `webRoutes.ts` computes the refusal from the path rather than " +
        "listing pages, so a settings tab Jam ships next month is refused without this repository changing",
      ground: "secret-material",
    },
    {
      because:
        "`jam.dev/v/<jamId>` and `jam.dev/c/<id>`, which are a recording and a shared conversation rather than " +
        "administrative pages. Opening one renders the payload the bullet above withholds, and on a shared " +
        "link it may also mark the recording seen — so it is the one family where merely arriving both " +
        "discloses and changes something",
      ground: "never-acted",
    },
    {
      because:
        "the third-party hosts the application calls. MEASURED: the signed-out application loads Stripe, " +
        "Intercom, Sentry, Google Tag Manager and a YouTube embed, and recording those as Jam operations " +
        "would put another company's endpoints in this atlas's surface map — which is not a tidiness problem " +
        "but the atlas asserting something false about the platform it maps",
      ground: "out-of-platform",
    },
    {
      because:
        "response fields nested more than two levels deep. The cap is stated here rather than discovered from a " +
        "field that is missing, and `tools/generateJamSurfaces.ts` is where it is applied",
      ground: "names-not-values",
    },
  ],
  kinds: [...JAM_ATLAS_KINDS],
  platform: JAM_ATLAS_PLATFORM,
  question:
    "what can be asked of Jam and where does it live — every operation, parameter and response field its " +
    "published description declares, every OAuth scope its authorisation server grants and which resource " +
    "claims each, which paths its two API hosts actually serve, every page of the web application with the " +
    "exact URL that proves it, and which integrations it publishes against which its own workspace has " +
    "installed",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas jam refresh",
  surfaces: [
    {
      denominator: {
        because:
          "Jam publishes no catalogue of its `JAM_SPEC_SURFACE` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: JAM_SPEC_SURFACE,
      role: "authoritative",
      // A LITERAL nobody reads: `surfaceFill.ts` derives this surface's status from the install's own
      // manifest and substitutes it before any reader sees the descriptor.
      status: "declared-unfilled",
      unfilledBecause: "`slopweaver atlas jam sync` has not run on this install, so nothing is published",
    },
    {
      denominator: {
        because:
          "Jam publishes no catalogue of its `JAM_ROUTE_SURFACE` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: false,
      name: JAM_ROUTE_SURFACE,
      role: "discovery",
      status: "declared-unfilled",
      unfilledBecause: "`slopweaver atlas jam sync` has not run on this install, so nothing is published",
    },
    {
      denominator: {
        because:
          "Jam publishes no catalogue of its `JAM_MCP_SURFACE` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: false,
      name: JAM_MCP_SURFACE,
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no Jam access token exists in this installation, so nothing has ever called the MCP resource and " +
        "no team, member, integration or recording of this workspace has been read. MEASURED:" +
        "`https://mcp.jam.dev/mcp` answers an unauthenticated request with " +
        '`{"error":"invalid_token"}`, and the resource is `documented: false` because the published ' +
        "description's own `servers` list names only `https://api.jam.dev` — the host serving it appears in " +
        `no document Jam publishes as an API surface. ${JAM_MCP_UNBLOCKED_BY}`,
    },
    {
      denominator: {
        because:
          "Jam publishes no catalogue of its `JAM_WEB_APP_SURFACE` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: JAM_WEB_APP_SURFACE,
      role: "authoritative",
      // Derived from the manifest by `surfaceFill.ts`, exactly as the compiled surfaces are.
      status: "declared-unfilled",
      unfilledBecause: `no page has been visited or witnessed. ${JAM_BROWSER_UNBLOCKED_BY}. A surface is filled by pages actually reached, never by a transport that could reach them`,
    },
    {
      denominator: {
        because:
          "Jam publishes no catalogue of its `JAM_WEB_CLIENT_SURFACE` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: JAM_WEB_CLIENT_SURFACE,
      role: "discovery",
      status: "declared-unfilled",
      unfilledBecause:
        "no first-party call has been observed, because no page has been walked. This surface is " +
        "`discovery` and can never be more: seeing the web client call something establishes that the " +
        "operation EXISTS and nothing about what an ordinary token may ask for",
    },
  ],
  visibilityScope: JAM_VISIBILITY_SCOPE,
};
