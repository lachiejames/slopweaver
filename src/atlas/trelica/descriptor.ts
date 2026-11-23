/**
 * What the Trelica atlas declares about itself — the row a catalogue shows, and the honest answer to "how
 * much of this platform have you actually looked at".
 *
 * ## It holds EVERYTHING REACHABLE, and that is the ruling rather than an appetite
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? Here nothing does. This is the organisation's own SaaS-discovery
 * product, so its application inventory — wider than both the end-user catalogue and the managed vendors in
 * the compliance platform, which each hold only a subset of it — exists in no other store on this machine. So the entity kinds are the deliverable and the surface map sits beside them.
 *
 * ## Three surfaces, and only two of them have a key
 *
 * MEASURED and stated here because it is the atlas's central finding rather than a limitation
 * being apologised for: the vendor publishes OpenAPI documents that any signed-in browser can fetch, and
 * the API they describe answers `403` to the session cookie that authorises every first-party call. So the
 * published surface is MAPPED in full and INGESTED from not at all, and the two claims are kept apart —
 * `published-api` is `filled` because the map is complete, and its data cell says `not-configured` naming
 * the API client this installation does not hold.
 *
 * ## `excludes` is long because the provider's own records are wide
 *
 * One inventory record carries far more top-level fields than an atlas question reads, including per-person licence assignments and the
 * vendor's own staff. `projection.ts` reads a closed list, so a field the vendor adds next month is dropped
 * at the boundary rather than stored because nobody thought to exclude it — the 1Password posture, for the
 * same reason.
 */
import type { AtlasDescriptor } from "../kit/contract.js";
import { DAILY_ATLAS_FRESHNESS_WINDOW } from "../kit/freshnessWindow.js";

import { TRELICA_ATLAS_KINDS, TRELICA_ATLAS_PLATFORM } from "./model.js";

/** Trelica's atlas, as it declares itself. */
export const TRELICA_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "refuse-every-write",
  excludes: [
    {
      because:
        "every mutation on every surface. This atlas only ever reads: no application is edited, no access is granted or revoked, no request is approved, and no person is provisioned or deprovisioned. `inventory.ts` is a closed table of GET and list-shaped calls, so a write is unreachable rather than merely unused",
      ground: "never-acted",
    },
    {
      because:
        "the vendor's own staff recorded against an application — `vendorContacts` names individuals at a third party who have no relationship with this organisation, and holding them buys nothing an atlas is asked for. The organisation's OWN owners are held, because 'who owns this app' is a question this atlas exists to answer",
      ground: "not-fetched",
      wouldBeClosedBy:
        "reading `vendorContacts`, if an atlas is ever asked a question the organisation's own owners cannot answer",
    },
    {
      because:
        "per-person licence assignments, seat lists and per-account usage rows. An application's licence PLANS and its account COUNT are held; who holds which seat is a person-by-application matrix that grows with both, and none of it answers a question the counts do not",
      ground: "not-fetched",
      wouldBeClosedBy:
        "reading per-person licence assignments and seat lists, which no other store in this installation holds",
    },
    {
      because:
        "spend TRANSACTIONS. They are time-series observations emitted by a feed rather than configuration somebody authored, so they take the voluminous disposition (`docs/atlas-intent/06-holdings.md`): the surface is reached and recorded, and the trailing-year total per application is held, but a row per transaction is not stored. Their existence is atlas content; their every row is not",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "spend transactions arrive from a feed as they occur rather than being configuration somebody authored",
        wouldBeMeasuredBy: "the spend-transaction listing for one application paged over a fixed window",
      },
    },
    {
      because:
        "audit activity, for the same reason and by the same test — an unbounded stream identified by an instant rather than by a name somebody chose",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "audit activity is an unbounded stream identified by an instant rather than by a name somebody chose",
        wouldBeMeasuredBy: "the audit-activity listing paged over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "AI-consumption API keys spending under `TRELICA_AI_KEY_SPEND_FLOOR` (a code constant) over the cost explorer's window. Every key at or above the floor is held as an `ai-usage` row; the tail is per-run evaluation keys, so it is a coverage cell — its count, its largest key and the most it could sum to — rather than one row per evaluation run",
      ground: "shape-index",
      volume: {
        basis: "measured",
        establishedBy:
          "slopweaver atlas trelica sync, then read the `ai-usage:api-key-tail` coverage cell on the `ai-usage` kind",
        magnitude:
          "the live API-key-tail count, largest-key spend and upper-bound sum the coverage cell records for the `TRELICA_AI_WINDOW_DAYS` window",
        unboundedBecause:
          "an evaluation harness mints a key per run, so the key count grows with how often evaluations run rather than with anything somebody configured",
      },
    },
    {
      because:
        "the session cookie and the antiforgery token that authorise the first-party channel. `session.ts` returns neither to a caller, stores neither, and prints neither; a refusal names the browser profile, never a value",
      ground: "secret-material",
    },
    {
      because:
        "the request material inside workflows and their runs. A workflow step's `credentials`, `headers`, `url`, `method`, `body`, `messageBody` and `fixedPassword`; a run's `baseScope.variables` (a run's variables can carry a password, a variable named `<id>_password` being the shape); and every run step's `apiRequestLog`, `eventLog`, `integrationLogMessages`, `outputs` and `scope`, which record what each call sent and received. Each is declared at the boundary so a new key is refused, and no projection reads one. Provider-authored text that IS held — a step's failure message, a run's fired error or blocked reason, an integration's last error — is held only as a closed value — a measured `flow_…` code or `Awaiting…` state, or a status line whose reason is the standard phrase for its status — and withheld otherwise (`providerText.ts`)",
      ground: "secret-material",
    },
    {
      because:
        "an integration connection's `parameters`, `clients`, `pipelineInputParameters` and `postConnectFormData` — the configuration a connection was set up with, which is where an API key or a client secret would live. Who authorised the connection, its sync health and which lifecycle actions it supports are held",
      ground: "secret-material",
    },
    {
      because:
        "a contract's `documents`, which are download links to the signed paper. The contract's terms, dates, value, renewal decision and owners are held",
      ground: "not-fetched",
      wouldBeClosedBy: "fetching a contract's documents, if an atlas is ever asked about a contract's wording",
    },
    {
      because:
        "a person's or a device source's `externalId` — the id a provider gives the account, which identifies the account to that provider and to nobody reading this atlas. The source, its status and its suspension and deletion state are held",
      ground: "not-fetched",
      wouldBeClosedBy: "reading `externalId`, if a cross-atlas join on a provider's own account id is ever needed",
    },
    {
      because:
        "the integration providers this tenant has not connected. The catalogue answers every provider Trelica offers, which is Trelica's product list rather than this organisation's configuration; the CONNECTIONS this tenant holds are the `integration` entities, and the catalogue's size is a count in the sync's coverage reason",
      ground: "not-fetched",
      wouldBeClosedBy:
        "holding the provider catalogue as its own kind, if an atlas is asked what Trelica could connect to",
    },
    {
      because:
        "response VALUES from the browser walk. What the walk stores is the method, the path shape with every value segment already replaced, and the field NAMES a response carried — the entity kinds are ingested through the API channel instead, which is the browser-is-the-fallback ruling (`docs/atlas-intent/07-browser-fallback.md`) applied rather than restated",
      ground: "names-not-values",
    },
  ],
  kinds: [...TRELICA_ATLAS_KINDS],
  platform: TRELICA_ATLAS_PLATFORM,
  question:
    "which SaaS applications does this organisation actually have, who supplies each one, how was it discovered, who inside the organisation owns it, how many accounts exist on it and what does it cost; what this organisation spends on AI, by application, team, cost centre, model, API key and person, and which spend spikes the cost explorer has flagged; who works here, in which team, and which account each person holds at every source; what each workflow — onboarding, offboarding and the rest — is configured to do and what every run of it actually did, step by step; which integrations are connected and how healthy their syncs are; every contract, device, access review and assessment — and, beside that, every page, endpoint, method, parameter and response field this platform exposes and which of them this account can reach",
  freshnessWindow: DAILY_ATLAS_FRESHNESS_WINDOW,
  resyncCommand: "slopweaver atlas trelica refresh",
  surfaces: [
    {
      denominator: {
        because:
          "Trelica's published surface is compiled from documentation rather than from a machine-readable catalogue",
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
          "a first-party API observed in the client is undocumented by definition, so nothing declares how many operations it has",
        known: false,
      },
      acquisition: "api",
      documented: false,
      name: "first-party-api",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      denominator: {
        because: "the Trelica web app publishes no route manifest",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "web-app",
      role: "corroborating",
      status: "filled",
      unfilledBecause: null,
    },
  ],
  visibilityScope:
    "the first-party and browser channels see exactly what the signed-in person's own roles open, and no more — a page this account cannot open is a declared gap rather than a silence; the published-api channel sees only what its OpenAPI documents declare, because this installation holds no API client for it, so 'complete' there means complete as a MAP and says nothing about data",
};
