/**
 * The candidate (method, path) pairs this atlas asks the running WorkOS API about, and the control it
 * proves its own oracle with.
 *
 * ## The denominator is written here; the VERDICT is the server's
 *
 * WorkOS serves no OpenAPI document — measured, `api.workos.com/openapi.json` and
 * `workos.com/docs/openapi.json` both answer 404 — so unlike the Trelica atlas there is no vendor document
 * to take the denominator from. This table is therefore a fact about this repository, and it says so rather
 * than pretending otherwise. What is NOT a fact about this repository is any row's outcome: every candidate
 * is sent to the running server and classified by what came back, so a route that has been withdrawn
 * becomes an `absent` finding with its name on it, and a route nobody here thought of is simply never
 * asked about. That second half is the honest limit of a written denominator and `gaps.ts` raises it as a
 * standing gap rather than leaving a reader to infer it.
 *
 * ## Every path is a TEMPLATE with a fake id, never a real one
 *
 * A path that takes an id is probed with an `_x`-suffixed placeholder — `/organizations/org_x`. That keeps
 * two promises at once: no real organisation, user, connection or directory id from this installation ever
 * enters this repository ([the partition](../../../docs/constraints/partition.md)), and the probe
 * cannot accidentally read a real record even if a credential were present. The placeholder still carries
 * WorkOS's own id PREFIX, because the prefix is the vendor's published convention rather than a customer
 * value, and a route that validates its prefix before its auth would otherwise misclassify.
 *
 * ## `writes` is declared, and the atlas still never calls one
 *
 * The flag says whether calling the route would change the tenant, which is what a reader wants to know.
 * It does not gate the probe: a `POST` is probed exactly like a `GET`, with no body at all, and every
 * write-shaped route in this table answered `401` or `422` before touching anything. `exclusions.ts`
 * carries why the write surface is recorded and never exercised.
 */
import type { WorkosHttpMethod } from "./model.js";

/** WorkOS's REST origin. Owned here, never passed in — no run can be pointed at a different host. */
export const WORKOS_API_ORIGIN = "https://api.workos.com";

/**
 * A second origin the vendor serves a product family from, which this atlas does NOT map.
 *
 * MEASURED: every Fine-Grained Authorization candidate under `api.workos.com/fga/v1/*` answers
 * `404`, and `fga.workos.com/v1/check` answers `302` — so FGA exists and is simply not on the origin this
 * atlas probes. That is a finding rather than an absence, and `gaps.ts` raises it under
 * `second-origin-unmapped` so the atlas states the bound instead of implying WorkOS has no FGA.
 *
 * @internal
 */
export const WORKOS_UNMAPPED_ORIGINS: readonly { readonly origin: string; readonly family: string }[] = [
  { family: "Fine-Grained Authorization", origin: "https://fga.workos.com" },
];

/**
 * A path this atlas probes ONLY to prove the oracle is still live, and never publishes as an entity.
 *
 * `testing.md` § "Assert on a falsifiable witness, never on silence" applied to a provider: the route map's
 * whole value rests on `absent` meaning something, so each run asks about a path that cannot exist and
 * refuses to publish if the server fails to call it absent. Without this, a WorkOS deployment that started
 * answering `401` to everything would fill the atlas with routes that do not exist, and nothing would
 * notice.
 *
 * @internal
 */
export const WORKOS_ORACLE_CONTROL_PATH = "/slopweaver_atlas_oracle_control";

/**
 * One route this atlas asks the running API about.
 *
 * @internal
 */
export interface WorkosRouteCandidate {
  readonly httpMethod: WorkosHttpMethod;
  /** The path, with `_x`-suffixed placeholders where a real id would go. */
  readonly path: string;
  /** The product family, as the vendor's own documentation groups it. */
  readonly family: string;
  /** Whether calling it would change the tenant. Declared; never called — see this file's header. */
  readonly writes: boolean;
}

/**
 * Every candidate, grouped by family in the order the vendor's own documentation presents them.
 *
 * The list is deliberately WIDER than what is known to exist: a candidate that turns out not to be routed
 * is the second most useful row in the file, because it is the difference between "we did not think to ask"
 * and "we asked and WorkOS does not serve it".
 */
export const WORKOS_ROUTE_CANDIDATES: readonly WorkosRouteCandidate[] = [
  { family: "Organizations", httpMethod: "GET", path: "/organizations", writes: false },
  { family: "Organizations", httpMethod: "POST", path: "/organizations", writes: true },
  { family: "Organizations", httpMethod: "GET", path: "/organizations/org_x", writes: false },
  { family: "Organizations", httpMethod: "PUT", path: "/organizations/org_x", writes: true },
  { family: "Organizations", httpMethod: "DELETE", path: "/organizations/org_x", writes: true },
  { family: "Organizations", httpMethod: "GET", path: "/organizations/org_x/roles", writes: false },
  { family: "Organization Domains", httpMethod: "GET", path: "/organization_domains/org_domain_x", writes: false },
  { family: "Organization Domains", httpMethod: "POST", path: "/organization_domains", writes: true },
  {
    family: "Organization Domains",
    httpMethod: "POST",
    path: "/organization_domains/org_domain_x/verify",
    writes: true,
  },
  { family: "SSO", httpMethod: "GET", path: "/connections", writes: false },
  { family: "SSO", httpMethod: "GET", path: "/connections/conn_x", writes: false },
  { family: "SSO", httpMethod: "DELETE", path: "/connections/conn_x", writes: true },
  { family: "SSO", httpMethod: "GET", path: "/sso/authorize", writes: false },
  { family: "SSO", httpMethod: "POST", path: "/sso/token", writes: false },
  { family: "SSO", httpMethod: "GET", path: "/sso/profile", writes: false },
  { family: "SSO", httpMethod: "GET", path: "/sso/profile/token", writes: false },
  { family: "SSO", httpMethod: "GET", path: "/sso/jwks/client_x", writes: false },
  { family: "Directory Sync", httpMethod: "GET", path: "/directories", writes: false },
  { family: "Directory Sync", httpMethod: "GET", path: "/directories/directory_x", writes: false },
  { family: "Directory Sync", httpMethod: "DELETE", path: "/directories/directory_x", writes: true },
  { family: "Directory Sync", httpMethod: "GET", path: "/directory_users", writes: false },
  { family: "Directory Sync", httpMethod: "GET", path: "/directory_users/directory_user_x", writes: false },
  { family: "Directory Sync", httpMethod: "GET", path: "/directory_groups", writes: false },
  { family: "Directory Sync", httpMethod: "GET", path: "/directory_groups/directory_group_x", writes: false },
  { family: "User Management", httpMethod: "GET", path: "/user_management/users", writes: false },
  { family: "User Management", httpMethod: "POST", path: "/user_management/users", writes: true },
  { family: "User Management", httpMethod: "GET", path: "/user_management/users/user_x", writes: false },
  { family: "User Management", httpMethod: "PUT", path: "/user_management/users/user_x", writes: true },
  { family: "User Management", httpMethod: "DELETE", path: "/user_management/users/user_x", writes: true },
  { family: "User Management", httpMethod: "POST", path: "/user_management/authenticate", writes: false },
  { family: "User Management", httpMethod: "GET", path: "/user_management/authorize", writes: false },
  { family: "User Management", httpMethod: "GET", path: "/user_management/logout", writes: false },
  { family: "User Management", httpMethod: "GET", path: "/user_management/jwks/client_x", writes: false },
  { family: "User Management", httpMethod: "GET", path: "/user_management/organization_memberships", writes: false },
  { family: "User Management", httpMethod: "POST", path: "/user_management/organization_memberships", writes: true },
  { family: "User Management", httpMethod: "GET", path: "/user_management/invitations", writes: false },
  { family: "User Management", httpMethod: "POST", path: "/user_management/invitations", writes: true },
  { family: "User Management", httpMethod: "POST", path: "/user_management/password_reset", writes: true },
  { family: "User Management", httpMethod: "POST", path: "/user_management/magic_auth", writes: true },
  {
    family: "User Management",
    httpMethod: "POST",
    path: "/user_management/email_verification/send",
    writes: true,
  },
  { family: "User Management", httpMethod: "GET", path: "/user_management/sessions/session_x", writes: false },
  {
    family: "User Management",
    httpMethod: "POST",
    path: "/user_management/sessions/session_x/revoke",
    writes: true,
  },
  { family: "User Management", httpMethod: "GET", path: "/user_management/authentication_factors", writes: false },
  { family: "Multi-Factor Auth", httpMethod: "POST", path: "/auth/factors/enroll", writes: true },
  { family: "Multi-Factor Auth", httpMethod: "POST", path: "/auth/challenges", writes: true },
  { family: "Multi-Factor Auth", httpMethod: "GET", path: "/auth/factors/auth_factor_x", writes: false },
  { family: "Multi-Factor Auth", httpMethod: "DELETE", path: "/auth/factors/auth_factor_x", writes: true },
  { family: "Passwordless", httpMethod: "GET", path: "/passwordless/sessions", writes: false },
  { family: "Passwordless", httpMethod: "POST", path: "/passwordless/sessions", writes: true },
  {
    family: "Passwordless",
    httpMethod: "POST",
    path: "/passwordless/sessions/passwordless_session_x/send",
    writes: true,
  },
  { family: "Audit Logs", httpMethod: "POST", path: "/audit_logs/events", writes: true },
  { family: "Audit Logs", httpMethod: "POST", path: "/audit_logs/exports", writes: true },
  { family: "Audit Logs", httpMethod: "GET", path: "/audit_logs/exports/audit_log_export_x", writes: false },
  { family: "Audit Logs", httpMethod: "GET", path: "/audit_logs/actions", writes: false },
  { family: "Events", httpMethod: "GET", path: "/events", writes: false },
  { family: "Admin Portal", httpMethod: "POST", path: "/portal/generate_link", writes: false },
  { family: "Widgets", httpMethod: "POST", path: "/widgets/token", writes: false },
  { family: "Roles", httpMethod: "GET", path: "/roles", writes: false },
  { family: "Fine-Grained Authorization", httpMethod: "POST", path: "/fga/v1/check", writes: false },
  { family: "Fine-Grained Authorization", httpMethod: "GET", path: "/fga/v1/resources", writes: false },
  { family: "Fine-Grained Authorization", httpMethod: "GET", path: "/fga/v1/warrants", writes: false },
  { family: "Fine-Grained Authorization", httpMethod: "POST", path: "/fga/v1/warrants", writes: true },
  { family: "Fine-Grained Authorization", httpMethod: "GET", path: "/fga/v1/schema", writes: false },
  { family: "Vault", httpMethod: "GET", path: "/vault/v1/kv", writes: false },
  { family: "Vault", httpMethod: "POST", path: "/vault/v1/kv", writes: true },
  { family: "Webhooks", httpMethod: "GET", path: "/webhooks", writes: false },
  { family: "Webhooks", httpMethod: "GET", path: "/endpoints", writes: false },
];

/**
 * The provider id one candidate is keyed by, across both channels.
 *
 * @param httpMethod the method probed
 * @param path the path probed
 * @returns `<METHOD> <path>`, the byte-exact key the two channels are matched on
 */
export function workosRouteProviderId({ httpMethod, path }: { httpMethod: WorkosHttpMethod; path: string }): string {
  return `${httpMethod} ${path}`;
}

/**
 * Every family the candidate table names, deduplicated and sorted.
 *
 * @returns the family names, sorted so a printed report is stable
 */
export function workosRouteFamilies(): readonly string[] {
  return [...new Set(WORKOS_ROUTE_CANDIDATES.map((candidate) => candidate.family))].toSorted();
}
