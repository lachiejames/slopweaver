/**
 * What the Vanta atlas declares about itself — the row a catalogue shows, and the honest answer to "how
 * much of this platform have you actually looked at".
 *
 * ## FIVE surfaces, and what each of them can and cannot be
 *
 * Vanta publishes four machine-readable API documents and this atlas divides its coverage by each of
 * them. Measured, their GET path sets are DISJOINT — zero overlap between any pair —
 * so the other three were never a second view of something already counted: `manage-api` (107 GETs,
 * filled), `auditor-api` (38, and no credential for it can exist here), `build-integrations-api` (12, and an
 * app's own dataset rather than a tenant read), `webhooks` (a measured ZERO read operations beside 24
 * outbound topics), and the driven `browser` channel. Each carries its own denominator and its own reason.
 *
 * ## Both of the FILLED surfaces are filled, which is what the mandatory-both ruling actually asks for
 *
 * Vanta has two channels in its stored shape, and a channel not yet populated is a state this descriptor
 * declares honestly rather than hides. `slopweaver atlas vanta walk` fills the second, driving the owner's own Chrome over every page `browserPages.ts` declares and
 * publishing `browser-page` and `browser-operation`. It is what reaches AUDITS, which `GET /v1/audits`
 * answers HTTP 403 on, so the browser here is not corroboration of the API — for one kind it is the only
 * channel there is.
 *
 * The surface says `filled` because the walk lands on every declared page. It is the coverage CELL, not
 * this flag, that says how many: a walk reaching four of twelve publishes `deferred` with the fraction in
 * its reason, so "filled" can never be earned by one page the way the sibling Slack walk once earned it.
 *
 * ## There is no role ceiling to measure
 *
 * A claim that "anything gated to Admin or Owner roles" is out of reach would be false whatever role the
 * signed-in person holds, because a Manage API request does
 * not carry any human's role at all: it presents an OAuth application token whose reach is its own scope
 * (`vanta-api.all:read`), so no role could widen or narrow what `sync.ts` reads. What genuinely bounds the
 * API channel is that scope; what bounds the browser channel is the signed-in person's role. Those are the
 * two values of {@link VantaVisibilityScope}, and a coverage cell carries whichever one produced it.
 *
 * ## Audits and contracts are refused for two DIFFERENT reasons, and only one of them is a Manage route
 *
 * Calling them "two kinds with no Manage API surface" would be wrong. Measured against Vanta's four
 * published documents, each differs in a different direction.
 *
 * `/audits` is not in the Manage document AT ALL. It is an **Auditor API** path — a separate published
 * OpenAPI description whose 38 GET operations are disjoint from Manage's 107 — and Vanta's own reference
 * says of the credential that reaches it: _"It is not available to Vanta customers automating their own
 * tenant."_ So this organisation, as the audited party rather than a registered audit partner, can never
 * hold that credential. This is the one gap that may be genuinely impossible, and the
 * documentation settles that it is — for the Auditor REST channel.
 *
 * `/contracts` and `/contracts/{contractId}` ARE Manage routes and are in the generated table. The
 * COLLECTION answers HTTP 403, and that is not a scope this application is missing: Vanta documents
 * `vanta-api.all:read` as GET access to every Manage endpoint. It is the Customer Commitments add-on
 * entitlement, which this organisation does not hold. The DETAIL route has never been sent at all — with
 * the collection refused there is no contract id to ask it with — so its row inherits the collection's
 * refusal rather than carrying a measurement of its own, and says so. Unlike audits, neither is
 * browser-reachable either. `browserPages.ts`'s closing note carries the
 * measurement: `/contracts`, `/contracts/list` and `/vendor-contracts` each render the client's own
 * not-found page, and `/vendors/contracts` redirects to the vendor register.
 *
 * ## A policy's TEXT is held, and it came from the API
 *
 * Holding every policy only as an OBJECT and claiming the body is owed to the browser, because nine
 * content-shaped routes under `/v1/policies/{id}` answer HTTP 404, would be wrong: all nine
 * were GUESSED. `GET /v1/knowledge-base/resources` is in Vanta's own published document, answers HTTP 200,
 * and serves every policy this organisation holds as a file — so the body was reachable through the API the
 * whole time, and what stood in the way was that this atlas had no denominator to notice an endpoint nobody
 * had thought of. `policy-document` is the kind that holds them, source bytes and extracted text side by
 * side, and `generated/specLock.ts` is the denominator that makes the next such endpoint a row rather than
 * an absence.
 *
 * `payload-not-map` is the mislabel to avoid for a policy body, and it is a tempting one: a policy is a
 * rendered file. It does not apply. That ground is for a platform's own content an atlas storing it would
 * make a second copy of — an image layer, a cache artifact — and a policy is
 * not that: it is the most consequential information in the platform, and an atlas is all reachable
 * information rather than a map of where information would be.
 */
import type { AtlasDescriptor } from "../kit/contract.js";

import { VANTA_ATLAS_PLATFORM, VANTA_KINDS } from "./model.js";

/** Vanta's atlas, as it declares itself. */
export const VANTA_ATLAS_DESCRIPTOR: AtlasDescriptor = {
  writePolicy: "read-before-write",
  excludes: [
    {
      because:
        "audits and contracts, each refused for its own reason. `GET /v1/audits` is not a Manage route at all — it belongs to Vanta's separately published Auditor API, whose credential Vanta documents as unavailable to a customer automating its own tenant, so this organisation can hold one only by becoming a registered audit partner. `GET /v1/contracts` IS a Manage route and its HTTP 403 is the Customer Commitments add-on entitlement rather than a missing scope, `vanta-api.all:read` being documented as GET access to every Manage endpoint",
      ground: "not-fetched",
      wouldBeClosedBy:
        "for audits, the browser channel — the audits page is walked and is the only channel this organisation has, since the Auditor API credential is not one it may hold. For contracts, nothing this organisation can do: the add-on is unpurchased, three candidate routes in the web client render its not-found page and the fourth redirects to the vendor register, so contracts are absent from BOTH channels",
    },
    {
      because:
        "61 of the 107 GET operations Vanta's own published document declares — every trust-centre route and the deepest vendor and document sub-collections. Each is a row in `generated/getEndpoints.ts` carrying its own disposition — 39 `not-fetched`, 19 `covered-by-list` where a collection this atlas walks whole returns the same object, and 3 `entitlement-refused`, two of them measured at HTTP 403 directly and the third inherited from the collection it reads one of — so this is a numbered debt rather than a silence, and `atlas-content-coverage` refuses any increase in it. Every one has been ASKED, which is what turns the debt from a guess into a list: `yarn tsx tools/probeVantaGetEndpoints.ts` sends each documented GET on this credential, chaining identifiers out of the answers rather than synthesising them. Measured — of those that answered HTTP 200, every one still uncalled is two or more parents deep; the integration resource walk beneath the resource kinds is called. Beside them sit 30 trust-centre routes keyed by a slug no GET operation returns, and the detail reads whose own collection answered an authoritative zero",
      ground: "not-fetched",
      wouldBeClosedBy:
        "calling them. There is no ceiling on any of these: they are documented, this credential's scope covers them, and the three a ceiling DOES block are counted here rather than forgiven — `/contracts` and `/vendors/{vendorId}/findings` each measured at HTTP 403 directly, and `/contracts/{contractId}` inherited from the collection it reads one of, since a detail read whose collection returns nothing has no id to be asked with, because an endpoint nobody may call is still an endpoint nobody called. Three of the 39 are there because the claim that had forgiven them would be FALSE: `GET /documents/{documentId}`, `GET /frameworks/{frameworkId}` and `GET /integrations/{integrationId}/resource-kinds/{resourceKind}` each answer fields their own collection does not, so `covered-by-list` is not true of any of them — see `endpointDisposition.ts`",
    },
    {
      because:
        "individual events: the event log is indexed by SHAPE — every event kind and every attribute on it, with sampled entries — so this atlas can say what the log contains and cannot name the event at a given minute",
      ground: "shape-index",
      volume: {
        basis: "unmeasured",
        unboundedBecause:
          "an event-log entry is emitted by Vanta when something happens, identified by an instant rather than by a name somebody chose",
        wouldBeMeasuredBy: "the event listing paged over a fixed window, counting rows returned",
      },
    },
    {
      because:
        "financial detail on a vendor: contract amounts are a financial record, not compliance metadata, and are withheld to a companion file",
      ground: "held-elsewhere",
      holder: "a companion file outside this generation, where vendor contract amounts are withheld to",
    },
    {
      because:
        "mutations of any kind — this ATLAS only ever reads. `slopweaver write vanta deactivate` does write to Vanta, and deliberately publishes nothing here: a generation records what was observed, never what this machine changed",
      ground: "never-acted",
    },
    {
      because:
        "nothing about a vulnerability beyond the finding itself: the census stores every finding, and `slopweaver atlas vanta vulnerabilities` reads them live and filtered on top, because triage needs the current answer rather than the last synced one",
      ground: "held-elsewhere",
      holder:
        "`slopweaver atlas vanta vulnerabilities`, which reads findings live and filtered because triage needs the current answer",
    },
  ],
  kinds: [...VANTA_KINDS],
  // One control against the live posture, which is the bounded read a question about one control's current state needs:
  // a question of the form "is this control still failing" must reach Vanta before answering, while
  // a question of the form "what is the organization id" must not hold the tag on a whole sync. Seconds, one control, no walk.
  liveReadCommand: "slopweaver atlas vanta control-evidence --control <id>",
  platform: VANTA_ATLAS_PLATFORM,
  question: "what compliance posture does this account hold, and what evidence backs each part of it",
  // Both legs, named, because a resync that says only `sync` describes an API-only refresh while this
  // atlas's browser channel is filled by a second verb — and a reader following the field would take the
  // atlas for current with one channel a day stale.
  resyncCommand: "slopweaver atlas vanta sync && slopweaver atlas vanta walk",
  surfaces: [
    {
      // 107 documented GET operations: 46 synced, 19 covered by a collection this atlas walks whole, 3
      // refused by an entitlement, 39 never fetched. Every one of the 39 is named one row at a time in
      // `generated/getEndpoints.ts` and is what this atlas owes.
      // `reached` counts CALLS and nothing else. Adding the detail endpoints a
      // walked collection already covers and the ones an entitlement refuses would be wrong: those endpoints
      // have never been hit, whatever the reason, and a denominator that
      // forgives them is the self-flattering arithmetic this whole field exists to end.
      denominator: {
        exists: 107,
        known: true,
        reached: 46,
        source: "generated/specLock.ts — Vanta's own published OpenAPI document, pinned by digest",
      },
      acquisition: "api",
      documented: true,
      name: "manage-api",
      role: "authoritative",
      status: "filled",
      unfilledBecause: null,
    },
    {
      // Vanta's own published Auditor description, measured: 48 paths, 57 operations, 38 GETs,
      // `sha256 5a91c5376655279896e787a317fb3198adbb8e2b501f20189eb80664534cfc6a`. Its GET paths are
      // DISJOINT from Manage's — zero overlap — so this is a surface the Manage denominator could never have
      // counted, and `/audits` lives here rather than there.
      denominator: {
        exists: 38,
        known: true,
        reached: 0,
        source:
          "https://developer.vanta.com/reference/auditor-api.json — Vanta's own published Auditor API document, counted from the document itself",
      },
      acquisition: "api",
      documented: true,
      name: "auditor-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "no credential for it can exist here. The Auditor API is the audit FIRM's surface, and Vanta's own reference says of it: \"It is not available to Vanta customers automating their own tenant.\" This organisation is the audited party, so it could hold one only by becoming a registered Vanta audit partner. This is the one surface on this atlas that is unreachable by something other than a missing key, and the audits page in the browser channel is the channel it has instead",
    },
    {
      // 13 paths, 25 operations, 12 GETs, `sha256 8b1f9794f01122196096d25651577556d97f53fe23cf07f97f43cbb83d15dd99`,
      // measured, and also disjoint from Manage.
      denominator: {
        exists: 12,
        known: true,
        reached: 0,
        source:
          "https://developer.vanta.com/reference/build-integrations.json — Vanta's own published Build Integrations document, counted from the document itself",
      },
      acquisition: "api",
      documented: true,
      name: "build-integrations-api",
      role: "authoritative",
      status: "declared-unfilled",
      unfilledBecause:
        "this installation registers no Build application, and the bound is worth stating because it survives getting one: every GET here reads only the resources the CALLING application itself pushed, so the surface is an app's own dataset rather than a tenant read. A credential would make it reachable and would still not make it a second view of this organisation's posture",
    },
    {
      // 24 webhook topics, every one an outbound POST, and no GET at all — measured,
      // `sha256 aa3db219770d938e7c3576175006ec3e793f9f3769db22686bc0e58ae6242fc5`.
      denominator: {
        exists: 0,
        known: true,
        reached: 0,
        source:
          "https://developer.vanta.com/reference/webhooks.json — Vanta's own published webhook document, counted from the document itself: 24 topics, 0 GET operations",
      },
      acquisition: "api",
      documented: true,
      name: "webhooks",
      role: "corroborating",
      status: "declared-unfilled",
      unfilledBecause:
        'there is nothing here to pull. A webhook surface DELIVERS rather than answers: its 24 declared topics are POSTs Vanta sends to an endpoint somebody registered, so its read denominator is a measured ZERO rather than an unknown. It is declared because the topics are a real map of what Vanta considers an event worth announcing — and because an atlas that simply omitted it would be answering "Vanta has no event subscriptions", which is false. Registering one would be a WRITE, which this atlas never performs',
    },
    {
      denominator: {
        because:
          "Vanta's web client publishes no route manifest and no sitemap, so the twelve pages in `browserPages.ts` are this atlas's own claim about what the client contains rather than a count of what exists. A page Vanta adds stays invisible until somebody adds it there — which is the browser half of exactly the defect the API half now has a denominator for",
        known: false,
      },
      acquisition: "driven-browser",
      documented: false,
      name: "browser",
      role: "corroborating",
      status: "filled",
      unfilledBecause: null,
    },
  ],
  visibilityScope:
    "the Manage API channel sees what the OAuth application's own scope grants and carries no human's role; the browser channel sees what the signed-in person's role opens; the Auditor API channel is bounded by CUSTOMER TYPE rather than by any credential this organisation could request, since Vanta documents it as unavailable to a customer automating its own tenant; the Build Integrations channel would see only the resources the calling Build application itself pushed; and the webhook channel delivers outbound rather than answering, so nothing is pulled through it at all",
};
