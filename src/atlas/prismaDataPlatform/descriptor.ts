/**
 * What the Prisma Data Platform atlas declares about itself — the row a catalogue shows, and the honest
 * answer to "how much of this platform have you actually looked at".
 *
 * ## It holds EVERYTHING REACHABLE, and right now it reaches three surface maps
 *
 * `docs/atlas-intent/06-holdings.md`'s test comes out the same way here as on Figma: nothing in this installation
 * holds a Prisma workspace, project, database, connection string, backup, bucket, service token
 * or Compute service, so if this atlas does not, nothing does. `kinds.ts` therefore declares twenty-three
 * entity kinds beside the three surface-map ones.
 *
 * Every one of those twenty-three is currently EMPTY, and the reason is a credential rather than Prisma:
 * MEASURED, the secrets store under `$SLOPWEAVER_HOME` carries no Prisma value, and no Prisma value is set
 * in the environment. That is deliberately a claim about what this INSTALLATION has been given, and nothing
 * more — this atlas has not established what any Prisma account can see, and saying it had would be the
 * kind of confident lie the whole design exists to prevent.
 *
 * ## The API surface is COMPLETE, and that is unusual enough to state
 *
 * `management-api-spec` is `filled` and, for once, corroborated end to end. The platform serves its own
 * OpenAPI 3.1.0 document unauthenticated at `api.prisma.io/v1/doc`; all 115 operations are compiled from it
 * with their parameters, scopes, paging shape, stability and disposition; and all 54 declared GETs were
 * separately confirmed to EXIST by an unauthenticated probe against three controls that answer 404, with
 * none absent. No sibling atlas here has had both halves.
 *
 * `authorization-server` is `filled` too, and its useful half is the negatives: `auth.prisma.io` publishes
 * an RFC 8414 metadata document naming a JWKS and a dynamic-registration endpoint that no Prisma
 * documentation mentions, and it answers 404 for the OIDC discovery document and for `/userinfo` — so this
 * platform is OAuth 2.0 without an identity layer, and a reader learns that from the atlas rather than from
 * a failed integration.
 *
 * ## The BROWSER half is the side that cannot be mapped, which is the reverse of the usual shape
 *
 * On most platforms the browser catches a settings page the API forgot. Here the API is complete and the
 * console is the blind wall: MEASURED, every path on `console.prisma.io` — `/settings`, `/workspaces`,
 * `/admin`, `/robots.txt`, and an invented control — answers the identical sign-in redirect, and the
 * application's own signed-out route manifest declares four entries with two addressable paths. So
 * `console-routes` publishes the three routes that could be established and reports `unreadable` rather than
 * claiming an inventory, and `console-walk` is `declared-unfilled` naming exactly what would fill it.
 *
 * That is not the browser surface shrinking. It is the browser surface saying, with evidence, that it needs
 * a signed-in walk — and a signed-out console is graded signed-out and becomes a card for the owner, never a
 * credential a session types.
 *
 * ## The single biggest fact this atlas holds
 *
 * Seventy of the 115 declared operations have no documentation page at all, and the partition is exact: the
 * 45 documented operations are precisely the 45 carrying no `x-prisma-stability` extension. What is
 * undocumented is the whole Prisma Compute product. A reader working from `www.prisma.io/docs` would
 * conclude this is a Postgres management API; it is not.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { PINNED_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { PRISMA_DATA_PLATFORM_ATLAS_KINDS } from "./kinds.js";
import { PRISMA_DATA_PLATFORM_ATLAS_PLATFORM } from "./model.js";

/** The Prisma Data Platform's atlas, as it declares itself. */
export const PRISMA_DATA_PLATFORM_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "the build and deployment log streams, as lines. Both answer `application/x-ndjson`, one record per" +
        " line, cursored, and `follow=true` holds the connection open until the build or deployment ends —" +
        " time-series observations emitted by the platform, unbounded, identified by position rather than by" +
        " a name somebody chose. They are shape-indexed rather than stored: enumerated, their record shape" +
        " recorded, and never a line. The two siblings that LOOK like the same family are entities and the" +
        " difference is the criterion cutting through rather than along —" +
        " `GET /v1/databases/{databaseId}/backups` carries Prisma's own `meta.backupRetentionDays` bound and" +
        " takes a limit with no cursor, so one call exhausts it, and `…/usage` returns a single aggregate" +
        " over a caller-chosen window rather than a listing at all",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "both log streams answer `application/x-ndjson` one record per line, cursored, with `follow=true` holding the connection open until the build ends — position-identified emissions rather than authored configuration",
        wouldBeMeasuredBy: "`GET /v1/builds/{id}/logs` read to the end of one build, counting lines",
      },
    },
    {
      because:
        "every write. All 61 mutating operations are inventoried with their reason and have no callable request" +
        " variant. This atlas only ever reads, which is also why the unauthenticated probe that confirmed the" +
        " read surface never touched them — an anonymous DELETE sent to find out whether a route exists is a" +
        " write attempt whatever it returns",
      ground: "never-acted",
    },
    {
      because:
        "two Alchemy infrastructure-state reads addressed by a name the deploy tool minted rather than by" +
        " anything Prisma enumerates. Inventoried so a reader learns the state store exists and can address" +
        " it directly; not walked, because holding a second copy of another tool's serialised state is the" +
        " duplication `docs/atlas-intent/06-holdings.md`'s who-else-holds-it test exists to prevent",
      ground: "not-fetched",
      wouldBeClosedBy:
        "walking the two Alchemy infrastructure-state reads, or recording why a second copy of another tool's serialised state is the wrong thing to hold",
    },
    {
      because:
        "the value of any environment variable — and this one is Prisma's decision rather than this atlas's." +
        " `GET /v1/environment-variables` returns each variable's `key` and a `valueKid` and never the value," +
        " so the atlas can hold every variable's NAME and no secret. The same holds for a connection string:" +
        " `connectionString` appears in six responses and not one of them is a GET",
      ground: "secret-material",
    },
    {
      because:
        "the direct-connection password and an integration contact's email address, the only two" +
        " credential-or-personal fields on the whole read surface. Named by PATH in `sensitiveFields.ts`" +
        " rather than by bare name, because on this platform `url` is the public self-link of 101 response" +
        " properties and `key` is an environment variable's own name — a rule matching credential-shaped" +
        " NAMES would withhold the most useful field on the surface",
      ground: "secret-material",
    },
    {
      because:
        "who this installation's credential authenticates as. `GET /v1/me` is called to establish posture and" +
        " stored nowhere at all: it answers a fact about the installation rather than about the organisation," +
        " and its response carries a person's email address",
      ground: "names-not-values",
    },
    {
      because:
        "a screenshot of any console page showing the organisation's own project or database data. The" +
        " owner's ruling names settings and admin pages as what a walk photographs; a resource listing is an" +
        " entity this atlas intends to hold, and photographing it as well would be holding the same thing" +
        " twice",
      ground: "never-acted",
    },
  ],
  kinds: [...PRISMA_DATA_PLATFORM_ATLAS_KINDS],
  platform: PRISMA_DATA_PLATFORM_ATLAS_PLATFORM,
  question:
    "what can be reached in the Prisma Data Platform — every management-API operation with its parameters," +
    " scopes, paging shape, stability, documentation page and what an unauthenticated probe established" +
    " about it; the whole authorization server including the two endpoints only its own metadata document" +
    " names and the three that are confirmed absent; every console route that could be established without" +
    " signing in; and, once this installation holds a credential, every workspace, project, database," +
    " connection, backup, bucket, service token, integration, Compute service, deployment, build, branch," +
    " custom domain and environment variable the platform holds, because nothing else in this installation" +
    " holds any of them",
  freshnessWindow: PINNED_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas prisma-data-platform sync",
  surfaces: [
    {
      denominator: {
        because:
          "Prisma Data Platform publishes no catalogue of its `management-api-spec` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: true,
      name: "management-api-spec",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Prisma Data Platform publishes no catalogue of its `authorization-server` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: false,
      name: "authorization-server",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Prisma Data Platform publishes no catalogue of its `console-routes` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "compiled",
      documented: false,
      name: "console-routes",
      role: "discovery",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because:
          "Prisma Data Platform publishes no catalogue of its `management-api` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "api",
      documented: true,
      name: "management-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "this installation holds no Prisma credential — MEASURED: no Prisma value in the secrets store" +
        " under $SLOPWEAVER_HOME, and nothing in the environment. A service token created" +
        " in the console under Settings → Service Tokens and stored with" +
        " `slopweaver secrets set prisma-data-platform-token` fills this. The credential TYPE matters as" +
        " much as the scopes: a service token never expires, an OAuth access token lasts an hour, and the" +
        " platform declares only two scopes in total — `workspace:admin` and `offline_access` — so there is" +
        " no read-only grant to ask for",
    },
    {
      denominator: {
        because:
          "Prisma Data Platform publishes no catalogue of its `console-walk` surface that this atlas has wired in, so this surface's coverage is divided by this atlas's own list of what it calls rather than by what exists",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "console-walk",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no walk has run, and on this platform a walk is the ONLY way the console's route tree can be" +
        " learned at all: every path answers one sign-in redirect to a signed-out request, and the" +
        " application serves its route manifest to an authenticated client and to nobody else. Signing the" +
        " owner's browser in to console.prisma.io is the owner's step, so this is a card for the owner rather than" +
        " a credential a session types. It is the surface that would hold the workspace settings, the" +
        " members list, the service-token and billing pages, the usage views and the integrations tab",
    },
  ],
  visibilityScope:
    "the API channel sees exactly what its credential's TYPE allows — the platform issues three (`oauth`," +
    " `service_token`, `management_token`, per `GET /v1/me`) and declares only two scopes, so a credential" +
    " that can read anything can write everything; the browser channel sees exactly what the signed-in" +
    " person's own workspace role opens. Neither implies the other. TODAY the API channel is empty for one" +
    " reason that is about this installation rather than about Prisma or about any account: no" +
    " Prisma credential has been given to it. So 'complete' currently means complete for three surface maps" +
    " compiled from public artifacts and corroborated by unauthenticated probes, and for nothing else",
};
