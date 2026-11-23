/**
 * What the Nightfall atlas declares about itself — the row a catalogue shows, and the honest answer to
 * "how much of this platform have you actually looked at".
 *
 * ## It holds EVERYTHING REACHABLE, and that is the ruling rather than an appetite
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? Here nothing does, and nothing is close. The corpus holds what
 * people said about data loss; the CrowdStrike atlas holds the endpoint; neither holds Nightfall's own
 * view of which MCP servers, agent plugins, IDE extensions and browser extensions are running across the
 * fleet, nor which domains an administrator put in an exfiltration allowlist. So the entity kinds are the
 * deliverable and the surface map sits beside them.
 *
 * ## Three surfaces, and only ONE of them has a key on this machine
 *
 * MEASURED, and stated here rather than apologised for, because it is what the coverage cells
 * say and a reader should meet it in the descriptor first:
 *
 * - `published-api` is FILLED, and needs no credential at all. The vendor publishes six OpenAPI documents;
 *   `generated/surfaces.ts` holds all 56 operations they declare and `generated/specLock.ts` pins the bytes
 *   they were read from. This is a complete MAP and says nothing about data.
 * - `workflow-api` is DECLARED-UNFILLED. no `nightfall-*` entry exists under `$SLOPWEAVER_HOME/secrets`, so this
 *   installation holds no Nightfall credential of any kind, and every one of those 56 operations declares `bearerAuth`. What exists on this machine is an
 *   ENDPOINT-AGENT enrolment key, carried in a JumpCloud command body, which is not an API credential and
 *   is not this atlas's to use.
 * - `console` is DECLARED-UNFILLED. `slopweaver browser cookies --origin https://app.nightfall.ai` reports
 *   no cookies in the owner's own Chrome profile, and no console sign-in is provisioned for it. So
 *   the walk is blocked on a sign-in, which is the owner's to perform and never this session's.
 *
 * **Both surfaces are still mandatory and the browser surface never shrinks** (the owner's rule). Declaring
 * them and leaving them unfilled is honest; not declaring them is not — `kit/contract.ts`'s header carries
 * the reasoning, and `gaps.ts` carries what would fill each.
 *
 * ## The descriptor's `status` is static, so nothing here may claim `filled` before it is
 *
 * A surface declared `filled` in source is filled on every install, including one where the sync has never
 * run. `published-api` is the one surface that legitimately claims it: it is compiled from a table
 * committed to this build, so it is filled the moment the code exists. The other two flip in the commit
 * that lands the code that fills them, not in the commit that makes filling them possible.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { NIGHTFALL_ATLAS_KINDS, NIGHTFALL_ATLAS_PLATFORM } from "./model.js";

/** Nightfall's atlas, as it declares itself. */
export const NIGHTFALL_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every mutation on every surface. This atlas only ever reads: no collection is created or edited, no domain is added or removed, no violation is actioned and no finding is annotated. The 18 write operations are INVENTORIED with an `exclusionReason` on each row rather than omitted, so the atlas can answer what this platform can be made to do without ever doing it",
      ground: "never-acted",
    },
    {
      because:
        "the scan family — `POST /v3/scan` and the four upload operations. They take THIS machine's content as their request body, so calling them to map them would egress the data the product exists to protect, and the file scan is billed work with a result rather than an observation of existing state. Their declared shapes are held; their invocation is not",
      ground: "never-acted",
    },
    {
      because:
        "a row per detection. Violations, findings, exfiltration events, posture events and the activity feeds beside them take the highly-voluminous disposition of `docs/atlas-intent/06-holdings.md` — the family is reached over a bounded window and its SHAPE recorded, never a record per detection. This is a disposition and not an exclusion: the surface is atlas content, and `slopweaver atlas nightfall read --kind violation` says what a violation IS",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "a violation, a finding, an exfiltration event and a posture event are each emitted when a scan fires, identified by an instant",
        wouldBeMeasuredBy: "`GET /v3/violations` paged over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "the endpoint-agent enrolment key and company identifier this organisation's JumpCloud commands carry in their bodies. They are a device-provisioning credential rather than an API one, they belong to the platform-management atlas that already holds those commands, and nothing here reads, stores or prints one",
      ground: "secret-material",
    },
    {
      because:
        "response VALUES from the console walk, when it runs. What a walk will store is the page, where it settled, what it photographed, and the method and path SHAPE of the traffic it saw — never a rendered violation. The entity kinds are ingested through the API channel instead, which is the browser-is-the-fallback ruling (`docs/atlas-intent/07-browser-fallback.md`) applied rather than restated",
      ground: "names-not-values",
    },
  ],
  kinds: [...NIGHTFALL_ATLAS_KINDS],
  platform: NIGHTFALL_ATLAS_PLATFORM,
  question:
    "what can be asked of this organisation's data-loss-prevention platform and where — every published endpoint, method, parameter, response field and declared record shape across its six APIs, and beside them the inventory nothing else on this machine holds: which MCP servers, agent plugins, IDE extensions and endpoint devices Nightfall sees on the fleet, and which domains and MCP servers an administrator put in a collection",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas nightfall sync",
  surfaces: [
    {
      denominator: {
        because:
          "Nightfall's six pinned documents are compiled into this atlas's own registry, which has not yet been split into reached and unreached",
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
          "no live call has been made against this Nightfall account, so the workflow API has nothing measured to divide by",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "workflow-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "this installation holds no Nightfall credential — no `nightfall-*` entry exists under `$SLOPWEAVER_HOME/secrets`, and all 56 published operations declare `bearerAuth`. A key minted in the console under an account with API access, stored as `nightfall-api-key`, fills it",
    },
    {
      denominator: {
        because: "the Nightfall console publishes no route manifest",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "console",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        "no signed-in console session exists in the owner's own Chrome — the cookie probe reports none for app.nightfall.ai, and no console sign-in is provisioned for it. A sign-in the owner performs unblocks the walk; nothing here signs in on the owner's behalf",
    },
  ],
  visibilityScope:
    "the published-api channel sees exactly what the vendor publishes and needs no credential, so 'complete' there means complete as a MAP and says nothing about this organisation's data; the workflow-api channel would see what one bearer token's own scopes open; the console channel would see what the signed-in session's own role renders, which an SSO assignment can hold below an administrator grant, so a page that account cannot open is a declared gap rather than a silence",
};
