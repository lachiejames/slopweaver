/**
 * The CLOSED inventory of Falcon calls this atlas may make, and the reason read-only is a property of the
 * code as well as of the credential.
 *
 * ## Why the HTTP verb decides nothing
 *
 * The obvious rule — "only GET" — is wrong here and would have shipped as a review property before it was
 * measured. Falcon reads batches of entities by POSTing their ids: `POST
 * /devices/combined/devices/login-history/v1` returns login history and changes nothing, and this
 * repository already models `POST /api/v2/auditevents` as an authorised read in
 * `atlas/onepassword/inventory.ts`. A GET-only rule would reject legitimate reads while admitting any write
 * that happened to be spelled as a GET.
 *
 * So read-only is carried three ways, and no single mistake defeats all three: the credential holds Read on
 * every scope and Write on none; {@link CROWDSTRIKE_CALLS} below is the ONLY source of a request in this
 * module, so no caller can supply a method or a path; and every admitted row is individually justified as a
 * read in its own `whyRead` field, which a reviewer can check against this table rather than against prose.
 *
 * Absent by construction, not by omission: containment and lift-containment, Real Time Response sessions of
 * any kind, policy and host-group edits, precedence changes, exclusion writes, IOC writes, alert updates,
 * sensor-update actions, and every `PUT`, `PATCH` and `DELETE`.
 *
 * One READ is absent too, and for a different reason worth stating: Falcon's
 * `/devices/combined/devices/network-address-history/v1` is authorised, returns 200 and was measured
 * working — and every field it returns (`ip_address`, and the gateway addresses beside it) is refused by
 * `privacy.ts`, so admitting it would mint requests whose entire response is dropped at the boundary. An
 * admitted call that can store nothing is a call nobody can justify, so the descriptor names network
 * locators as an exclusion instead and this table does not carry the row.
 */
import type { CrowdstrikeKind, CrowdstrikeScope } from "./model.js";

/**
 * How a call's results are paged. `none` is a singleton or a one-shot document.
 *
 * @internal
 */
export const CROWDSTRIKE_PAGINGS = ["none", "offset", "after-cursor", "id-batch"] as const;

type CrowdstrikePaging = (typeof CROWDSTRIKE_PAGINGS)[number];

/**
 * Where a call sits in Falcon's query-then-entity shape.
 *
 * Falcon splits most reads in two: a `queries` endpoint returning ids, then an `entities` endpoint taking
 * those ids. `standalone` covers a `combined` endpoint that does both at once, and `enrichment` a call that
 * adds fields to entities another call already produced.
 *
 * @internal
 */
export const CROWDSTRIKE_CALL_ROLES = ["query", "entity", "standalone", "enrichment", "auth"] as const;

type CrowdstrikeCallRole = (typeof CROWDSTRIKE_CALL_ROLES)[number];

/**
 * One admitted Falcon call.
 *
 * `whyRead` is required and is the field a reviewer reads: an admitted POST must say, in its own words, why
 * it does not change the tenant. A row that cannot answer that does not belong here.
 *
 * @internal
 */
export interface CrowdstrikeCall {
  readonly id: string;
  readonly kind: CrowdstrikeKind | null;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly scope: CrowdstrikeScope | null;
  readonly paging: CrowdstrikePaging;
  readonly role: CrowdstrikeCallRole;
  /** Largest number of ids this call may be given at once, or `null` when it takes none. */
  readonly idBatchLimit: number | null;
  readonly whyRead: string;
}

/**
 * Every Falcon call this atlas may make. A closed list — see this file's header.
 *
 * Read it as the answer to "what could this thing possibly do to our fleet": a closed list of reads, one token mint,
 * and nothing that changes a byte on an endpoint or in the tenant's configuration.
 */
export const CROWDSTRIKE_CALLS = [
  {
    id: "oauth-token",
    idBatchLimit: null,
    kind: null,
    method: "POST",
    paging: "none",
    path: "/oauth2/token",
    role: "auth",
    scope: null,
    whyRead: "mints a short-lived bearer for this client; creates no tenant object and changes no setting",
  },
  {
    id: "hosts-visible-ids",
    idBatchLimit: null,
    kind: "host",
    method: "GET",
    paging: "offset",
    path: "/devices/queries/devices/v1",
    role: "query",
    scope: "devices:read",
    whyRead: "returns device ids only",
  },
  {
    id: "hosts-hidden-ids",
    idBatchLimit: null,
    kind: "host",
    method: "GET",
    paging: "offset",
    path: "/devices/queries/devices-hidden/v1",
    role: "query",
    scope: "devices:read",
    whyRead: "returns the ids of hidden devices only",
  },
  {
    id: "host-entities",
    idBatchLimit: 100,
    kind: "host",
    method: "GET",
    paging: "id-batch",
    path: "/devices/entities/devices/v2",
    role: "entity",
    scope: "devices:read",
    whyRead: "returns device detail for ids already obtained",
  },
  {
    id: "host-online-state",
    idBatchLimit: 100,
    kind: "host",
    method: "GET",
    paging: "id-batch",
    path: "/devices/entities/online-state/v1",
    role: "enrichment",
    scope: "devices:read",
    whyRead: "returns the current online state of ids already obtained",
  },
  {
    id: "host-login-history",
    idBatchLimit: 100,
    kind: "host",
    method: "POST",
    paging: "id-batch",
    path: "/devices/combined/devices/login-history/v1",
    role: "enrichment",
    scope: "devices:read",
    whyRead:
      "POST carries the id batch in a body because the list is too long for a query string; it returns login history and creates nothing",
  },
  {
    id: "prevention-policy-ids",
    idBatchLimit: null,
    kind: "prevention-policy",
    method: "GET",
    paging: "offset",
    path: "/policy/queries/prevention/v1",
    role: "query",
    scope: "prevention-policies:read",
    whyRead: "returns policy ids only",
  },
  {
    id: "prevention-policy-entities",
    idBatchLimit: 100,
    kind: "prevention-policy",
    method: "GET",
    paging: "id-batch",
    path: "/policy/entities/prevention/v1",
    role: "entity",
    scope: "prevention-policies:read",
    whyRead: "returns policy detail for ids already obtained; the write path is a separate PATCH, absent here",
  },
  {
    id: "sensor-update-policy-ids",
    idBatchLimit: null,
    kind: "sensor-update-policy",
    method: "GET",
    paging: "offset",
    path: "/policy/queries/sensor-update/v1",
    role: "query",
    scope: "sensor-update-policies:read",
    whyRead: "returns policy ids only",
  },
  {
    id: "sensor-update-policy-entities",
    idBatchLimit: 100,
    kind: "sensor-update-policy",
    method: "GET",
    paging: "id-batch",
    path: "/policy/entities/sensor-update/v2",
    role: "entity",
    scope: "sensor-update-policies:read",
    whyRead: "returns policy detail for ids already obtained",
  },
  {
    id: "open-vulnerabilities",
    idBatchLimit: null,
    kind: "vulnerability",
    method: "GET",
    paging: "after-cursor",
    path: "/spotlight/combined/vulnerabilities/v1",
    role: "standalone",
    scope: "spotlight-vulnerabilities:read",
    whyRead:
      "returns findings with their facets in one read; the two-stage id path is not admitted because this costs fewer requests",
  },
  {
    id: "zta-assessment-ids",
    idBatchLimit: null,
    kind: "zero-trust-assessment",
    method: "GET",
    paging: "after-cursor",
    path: "/zero-trust-assessment/queries/assessments/v1",
    role: "query",
    scope: "zero-trust-assessment:read",
    whyRead: "returns assessed device ids only",
  },
  {
    id: "zta-assessment-entities",
    idBatchLimit: 1000,
    kind: "zero-trust-assessment",
    method: "GET",
    paging: "id-batch",
    path: "/zero-trust-assessment/entities/assessments/v1",
    role: "entity",
    scope: "zero-trust-assessment:read",
    whyRead: "returns assessment scores for ids already obtained",
  },
  {
    id: "zta-audit",
    idBatchLimit: null,
    kind: "zero-trust-audit",
    method: "GET",
    paging: "none",
    path: "/zero-trust-assessment/entities/audit/v1",
    role: "standalone",
    scope: "zero-trust-assessment:read",
    whyRead: "returns one tenant-wide summary document",
  },
  {
    id: "alert-ids",
    idBatchLimit: null,
    kind: "detection",
    method: "GET",
    paging: "after-cursor",
    path: "/alerts/queries/alerts/v2",
    role: "query",
    scope: "alerts:read",
    whyRead: "returns alert composite ids only",
  },
  {
    id: "alert-entities",
    idBatchLimit: 100,
    kind: "detection",
    method: "POST",
    paging: "id-batch",
    path: "/alerts/entities/alerts/v2",
    role: "entity",
    scope: "alerts:read",
    whyRead:
      "POST carries the composite-id batch in a body; the alert UPDATE path is a different endpoint taking an action list, which is absent here",
  },
  {
    id: "host-group-ids",
    idBatchLimit: null,
    kind: "host-group",
    method: "GET",
    paging: "offset",
    path: "/devices/queries/host-groups/v1",
    role: "query",
    scope: "host-group:read",
    whyRead: "returns host-group ids only; group MEMBERSHIP changes are a separate action endpoint, absent here",
  },
  {
    id: "host-group-entities",
    idBatchLimit: 100,
    kind: "host-group",
    method: "GET",
    paging: "id-batch",
    path: "/devices/entities/host-groups/v1",
    role: "entity",
    scope: "host-group:read",
    whyRead: "returns host-group detail for ids already obtained, so a policy can be attached to the hosts it covers",
  },
  {
    id: "console-sitemap",
    idBatchLimit: null,
    kind: "console-page",
    method: "GET",
    paging: "none",
    path: "/content/sitemap-v2/index.json",
    role: "standalone",
    scope: null,
    whyRead:
      "the console's own published navigation document, read through the browser session; it is the coverage denominator and is fetched, never posted to",
  },
] as const satisfies readonly CrowdstrikeCall[];

/**
 * Every admitted call id: the closed union a lookup is keyed on, derived from the literal rows above.
 *
 * @internal
 */
export type CrowdstrikeCallId = (typeof CROWDSTRIKE_CALLS)[number]["id"];

/**
 * Is this decoded string the id of an admitted call? The guard a caller holding a runtime string runs BEFORE
 * {@link findCrowdstrikeCall}, refusing an unknown id with its own typed error rather than looking it up.
 *
 * @param value a call id read from outside the type system
 * @returns whether the closed inventory admits it
 */
export function isCrowdstrikeCallId(value: string): value is CrowdstrikeCallId {
  return CROWDSTRIKE_CALLS.some((call) => call.id === value);
}

/**
 * Look up an admitted call by id.
 *
 * The only way to obtain a request shape in this atlas. A caller names a call; it cannot supply a method, a
 * path or a URL, so an endpoint absent from {@link CROWDSTRIKE_CALLS} is unreachable rather than merely
 * unused.
 *
 * @param id an admitted call id, narrowed by {@link isCrowdstrikeCallId} when it was read at run time
 * @returns the admitted call
 */
export function findCrowdstrikeCall({ id }: { id: CrowdstrikeCallId }): CrowdstrikeCall {
  // `id` is a member of the union derived from these very rows, so exactly one row carries it.
  return CROWDSTRIKE_CALLS.find((call) => call.id === id)!;
}

/**
 * Every call that needs one scope, so a sync can report what a refusal costs before it makes it.
 *
 * @param scope the Falcon scope to filter by
 * @returns the admitted calls requiring that scope, in inventory order
 */
export function callsRequiringScope({ scope }: { scope: CrowdstrikeScope }): readonly CrowdstrikeCall[] {
  return CROWDSTRIKE_CALLS.filter((call) => call.scope === scope);
}
