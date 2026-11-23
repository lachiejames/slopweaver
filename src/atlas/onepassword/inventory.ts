/**
 * The CLOSED inventory of 1Password surfaces this atlas covers, and — the part that matters most on this
 * platform — the closed list of provider calls it is allowed to make.
 *
 * ## The command allowlist is the first sensitivity mechanism
 *
 * `op` can read a password. This atlas must never do so, and the way that is guaranteed is not care: it is
 * that {@link ONEPASSWORD_OP_COMMANDS} is the ONLY source of an `op` argv in this module, `opCli.ts` will
 * not run an argv that did not come from it, and the verbs that return an item's contents — `op item get`,
 * `op document get`, `op read`, `op run`, `op inject` — are not in it. There is no flag, no mode and no
 * caller that can reach one. The one `op` call outside it is `opCli.ts`'s fixed `op signin`, which reads
 * nothing: it mints the session these surfaces run as.
 *
 * `op vault get` is what supplies a vault's item COUNT, and it is why `op item list` is absent rather than
 * merely discouraged: the count is a field on the vault itself, so listing a vault's items to count them
 * would be reading more than the question needs.
 *
 * ## Both surfaces, and the one that is honestly empty
 *
 * The owner's ruling is that an atlas spans the API surface AND the browser surface, because they diverge.
 * The browser surface is declared here and in `descriptor.ts` and is unfilled, which is a state this atlas
 * SAYS about itself rather than a silence a reader has to notice.
 */
import type { OnepasswordChannel, OnepasswordEvidenceRole, OnepasswordKind } from "./model.js";

/**
 * One surface this atlas is required to cover, for one kind, through one channel.
 *
 * @internal
 */
export interface OnepasswordRequiredSurface {
  readonly kind: OnepasswordKind;
  readonly channel: OnepasswordChannel;
  readonly surface: string;
  readonly role: OnepasswordEvidenceRole;
  readonly description: string;
}

/**
 * One allowed `op` invocation: the argv after the binary name, minus the `--format=json` every call adds.
 *
 * `template` may carry exactly one `{{id}}` placeholder, substituted by `opCli.ts` with a provider id that
 * has already been validated as an opaque identifier. Nothing else is interpolated, so no caller-supplied
 * string ever becomes an argv element.
 *
 * @internal
 */
export interface OnepasswordOpCommand {
  readonly surface: string;
  readonly template: readonly string[];
  /** Whether this call is made once, or once per parent entity. */
  readonly cardinality: "once" | "per-parent";
}

/**
 * Every `op` argv this atlas may run. A closed list — see this file's header.
 *
 * Read it as the answer to "what could this thing possibly do to my account": six read verbs, no write
 * verb, and no verb that returns an item's contents.
 */
export const ONEPASSWORD_OP_COMMANDS: readonly OnepasswordOpCommand[] = [
  { cardinality: "once", surface: "account-whoami", template: ["whoami"] },
  { cardinality: "once", surface: "users-list", template: ["user", "list"] },
  { cardinality: "once", surface: "groups-list", template: ["group", "list"] },
  { cardinality: "once", surface: "vaults-list", template: ["vault", "list"] },
  { cardinality: "per-parent", surface: "vault-detail", template: ["vault", "get", "{{id}}"] },
  { cardinality: "per-parent", surface: "group-members", template: ["user", "list", "--group", "{{id}}"] },
  { cardinality: "per-parent", surface: "vault-groups", template: ["vault", "group", "list", "{{id}}"] },
  { cardinality: "per-parent", surface: "vault-users", template: ["vault", "user", "list", "{{id}}"] },
  { cardinality: "once", surface: "connect-servers", template: ["connect", "server", "list"] },
] as const;

/**
 * The allowed `op` argv for one surface.
 *
 * @param surface the surface name
 * @returns the command, or `null` when this surface has no `op` invocation (every `events-api` and
 *   `browser` surface)
 */
export function onepasswordOpCommandFor({ surface }: { surface: string }): OnepasswordOpCommand | null {
  const command = ONEPASSWORD_OP_COMMANDS.find((candidate) => candidate.surface === surface);
  if (command === undefined) {
    return null;
  }
  return command;
}

/**
 * The `op` verbs this atlas will never call, named so their absence is a stated position rather than an
 * accident of what nobody needed yet. Consulted by a test that asserts none of them appears in
 * {@link ONEPASSWORD_OP_COMMANDS}, so adding one to the allowlist fails CI.
 */
export const ONEPASSWORD_FORBIDDEN_OP_VERBS: readonly string[] = ["document", "inject", "item", "read", "run"] as const;

/**
 * One Events API endpoint, as the single source of truth for its path and the feature a token needs for it.
 *
 * @internal
 */
export interface OnepasswordEventsEndpoint {
  readonly method: "POST" | "GET";
  readonly path: string;
  /** The Events API feature name a token must carry to reach this — what `auth/introspect` reports. */
  readonly feature: string | null;
}

/**
 * Every Events API endpoint this atlas may call, keyed by surface name.
 *
 * `itemusages` and `signinattempts` are deliberately absent from the sync even though the Events API offers
 * them: neither is needed to answer what this atlas is for, and every feature left off the token is one
 * less thing the token can see. They are named in {@link ONEPASSWORD_OUT_OF_SCOPE_GROUPS} instead, so the
 * omission is declared.
 *
 * @internal
 */
export const ONEPASSWORD_EVENTS_ENDPOINTS: Readonly<Record<string, OnepasswordEventsEndpoint>> = {
  "events-audit": { feature: "auditevents", method: "POST", path: "/api/v2/auditevents" },
};

/**
 * The Events API endpoint for one surface.
 *
 * @param surface the surface name
 * @returns the endpoint, or `null` when this surface has no Events API call
 */
export function onepasswordEventsEndpointFor({ surface }: { surface: string }): OnepasswordEventsEndpoint | null {
  const endpoint = ONEPASSWORD_EVENTS_ENDPOINTS[surface];
  if (endpoint === undefined) {
    return null;
  }
  return endpoint;
}

/**
 * Every surface this atlas is required to cover. Not exhaustive of everything 1Password exposes — see
 * {@link ONEPASSWORD_OUT_OF_SCOPE_GROUPS} for what is named as out of scope instead.
 *
 * @internal
 */
export const ONEPASSWORD_REQUIRED_SURFACES = [
  {
    channel: "admin-cli",
    description: "every team member the administrative credential can see",
    kind: "user",
    role: "authoritative",
    surface: "users-list",
  },
  {
    channel: "browser",
    description: "the People page of the administrative console — no browser driving ships yet",
    kind: "user",
    role: "corroborating",
    surface: "people-console",
  },
  {
    channel: "admin-cli",
    description: "every group",
    kind: "group",
    role: "authoritative",
    surface: "groups-list",
  },
  {
    channel: "browser",
    description: "the Groups page of the administrative console — no browser driving ships yet",
    kind: "group",
    role: "corroborating",
    surface: "groups-console",
  },
  {
    channel: "admin-cli",
    description: "each group's membership, one call per group",
    kind: "group-member",
    role: "authoritative",
    surface: "group-members",
  },
  {
    channel: "admin-cli",
    description: "every vault, name and identity only",
    kind: "vault",
    role: "authoritative",
    surface: "vaults-list",
  },
  {
    channel: "admin-cli",
    description: "each vault's own record, which is where the item COUNT comes from",
    kind: "vault",
    role: "authoritative",
    surface: "vault-detail",
  },
  {
    channel: "browser",
    description: "the Vaults page of the administrative console — no browser driving ships yet",
    kind: "vault",
    role: "corroborating",
    surface: "vaults-console",
  },
  {
    channel: "admin-cli",
    description: "which groups can reach each vault, and with which permissions",
    kind: "vault-grant",
    role: "authoritative",
    surface: "vault-groups",
  },
  {
    channel: "admin-cli",
    description: "which people can reach each vault directly, and with which permissions",
    kind: "vault-grant",
    role: "authoritative",
    surface: "vault-users",
  },
  {
    channel: "admin-cli",
    description: "Connect servers attached to the account, as metadata",
    kind: "integration",
    role: "authoritative",
    surface: "connect-servers",
  },
  {
    channel: "events-api",
    description: "audit events — actions taken on vaults, groups and people",
    kind: "event",
    role: "authoritative",
    surface: "events-audit",
  },
] as const satisfies readonly OnepasswordRequiredSurface[];

/**
 * One surface name the required-surface table declares — closed, so a misspelled surface fails to compile.
 *
 * @internal
 */
export type OnepasswordRequiredSurfaceName = (typeof ONEPASSWORD_REQUIRED_SURFACES)[number]["surface"];

/**
 * What this atlas does NOT cover, named so its absence is declared rather than silent. Two of these are
 * deliberate sensitivity decisions rather than unfinished work, and both say so.
 */
export const ONEPASSWORD_OUT_OF_SCOPE_GROUPS: readonly string[] = [
  "item contents of any kind — the permanent hard line this atlas exists to hold",
  "item titles — a title routinely carries the secret's own subject; the vault's item COUNT is held instead",
  "item usage events (Events API `itemusages`) — metadata only, but not needed for what this atlas answers",
  "sign-in attempts (Events API `signinattempts`) — same",
  "billing, invoices and subscription state",
  "device and app inventory",
  "SCIM provisioning state",
  "the Watchtower / breach-report surface",
  "Events API integrations — `op events-api` exposes only `create`, so there is no list verb to read",
  "service accounts — `op service-account` exposes only `create` and `ratelimit`, same reason",
] as const;
