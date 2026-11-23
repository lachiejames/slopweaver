/**
 * The closed inventory of calls this atlas may make, and the closed list of routes it walks.
 *
 * ## A caller names a CALL, never a URL
 *
 * The same shape as `atlas/crowdstrike/inventory.ts` and for the same reason: there is no argument anywhere
 * in this atlas that reaches an endpoint this table does not list, so "read-only" is a property a reviewer
 * checks against one file rather than a claim to trust. Every row carries its own `whyRead`.
 *
 * Read-only is carried twice more. Every row is a GET — Nx Cloud's own mutations are React Router ACTIONS,
 * which are POSTs to the same paths, and nothing here can issue one. And the credential is a signed-in
 * browser session, bounded by that person's Nx Cloud role: a workspace MEMBER role is answered 403 on the
 * workspace settings page, so a member session cannot change the tenant's configuration at all.
 *
 * ## Why the paths are undocumented, and why that is fine
 *
 * Nx Cloud publishes no REST API this installation can reach: `/api/v1/...` answers 404 and the documented
 * surface wants a personal access token or the workspace CI token, neither of which this install holds.
 * What it does have is the first-party web client's own transport — React Router loader routes (`<path>.data`,
 * returning a `text/x-script` turbo-stream) and the JSON resource routes beside them. `docs/atlas-intent/02-both-surfaces.md`
 * §2's ruling settles the question: an undocumented endpoint is a usable source as long as it works,
 * and reach is judged by whether a call returns.
 *
 * ## The voluminous rows are marked, not omitted
 *
 * A row's `disposition` is `entity` when the call's records are configuration somebody authored and are
 * held in full, and `family` when they are time-series observations — unbounded, growing with the clock,
 * identified by an instant. A `family` call is still MADE, over a bounded window, and what is stored is its
 * shape and its count. That is `docs/atlas-intent/06-holdings.md`'s disposition rather than an exclusion.
 */

/**
 * Whether a call's records are held in full, or enumerated and declared.
 *
 * @internal
 */
export type NxCloudCallDisposition = "entity" | "family";

/**
 * One call this atlas may make.
 *
 * @internal
 */
export interface NxCloudCall {
  /** The stable id a caller names. */
  readonly id: string;
  /** The path template, with `:orgId`, `:workspaceId` and `:cipeId` as the only substitutions. */
  readonly pathTemplate: string;
  /** Query parameters this atlas sends, names and values both fixed here. */
  readonly query: Readonly<Record<string, string>>;
  /** Whether this call's records are held in full or declared as a family. */
  readonly disposition: NxCloudCallDisposition;
  /** Why an atlas that changes nothing reads this. A reviewer checks this column against the path. */
  readonly whyRead: string;
}

/** The origin every call and every walked page is addressed at. */
export const NX_CLOUD_ORIGIN = "https://cloud.nx.app";

/**
 * Every call this atlas may make, in the order a sync makes them.
 *
 * `orgs` is first because it is the only one that needs no scope, and its result is the finding this
 * atlas's first run produced: an account can be a workspace member and still list ZERO organisations,
 * because the list is built from VCS account links rather than from membership.
 */
export const NX_CLOUD_CALLS = [
  {
    disposition: "entity",
    id: "organizations",
    pathTemplate: "/orgs.data",
    query: {},
    whyRead:
      "the organisations this session can list at all — the account-level entity, and the denominator a" +
      " reader needs before any workspace id means anything",
  },
  {
    disposition: "entity",
    id: "org-workspaces",
    pathTemplate: "/orgs/:orgId/workspaces.data",
    query: {},
    whyRead:
      "every workspace under one organisation, with each one's own configuration — the default branch, the" +
      " cache isolation setting, the self-healing and agent feature markers. The call that makes this atlas" +
      " hold the whole organisation rather than only the workspace it was pointed at",
  },
  {
    disposition: "entity",
    id: "workspace-overview",
    pathTemplate: "/orgs/:orgId/workspaces/:workspaceId/overview.data",
    query: {},
    whyRead:
      "the organisation's plan and the workspace's own configuration — the access levels, the VCS provider" +
      " and the plan limits that decide what CI is allowed to do",
  },
  {
    disposition: "family",
    id: "workspace-runs",
    pathTemplate: "/orgs/:orgId/workspaces/:workspaceId/runs.data",
    query: {},
    whyRead:
      "one bounded page of run history, to record the family's SHAPE and how many records a page carries." +
      " Runs are time-series observations and no row of this is stored",
  },
  {
    disposition: "family",
    id: "workspace-insights",
    pathTemplate: "/orgs/:orgId/workspaces/:workspaceId/analytics/insights.data",
    query: { dayCount: "7" },
    whyRead:
      "the platform's own totals over a bounded window — pipeline count, cache hit rate, time saved. The" +
      " one call that reports how BIG the voluminous families are without enumerating them",
  },
] as const satisfies readonly NxCloudCall[];

/**
 * The routes the browser walk visits, as path templates.
 *
 * ## The denominator is the client's OWN route table, and this list is the seed for reaching it
 *
 * Nx Cloud's client uses React Router's lazy route discovery, so `window.__reactRouterManifest` holds only
 * the routes matched so far and there is no build-time manifest of the rest. MEASURED: the route table a
 * walk of the pages below accumulates grows with every page it opens, and a walk of fewer pages accumulates
 * fewer. So the walk
 * VISITS this list and DISCOVERS the route table, and coverage reports both numbers — a route the client
 * declared and the walk never opened is a recorded row rather than an absence.
 *
 * Two of these are expected to fail and are here for exactly that reason. The workspace settings page
 * answers 403 to a member, and the organisation settings path does not exist at all; declaring both means
 * the atlas SAYS which pages its credential cannot reach instead of quietly not listing them.
 */
export const NX_CLOUD_WALK_ROUTES: readonly string[] = [
  "/orgs",
  "/profile/edit",
  "/profile/notifications",
  "/profile/tokens",
  "/profile/vcs-integrations",
  "/orgs/:orgId",
  "/orgs/:orgId/add-ons",
  "/orgs/:orgId/settings",
  "/orgs/:orgId/workspaces",
  "/orgs/:orgId/workspaces/:workspaceId/overview",
  "/orgs/:orgId/workspaces/:workspaceId/runs",
  "/orgs/:orgId/workspaces/:workspaceId/compare-tasks",
  "/orgs/:orgId/workspaces/:workspaceId/settings",
  "/orgs/:orgId/workspaces/:workspaceId/analytics/cipes",
  "/orgs/:orgId/workspaces/:workspaceId/analytics/runs",
  "/orgs/:orgId/workspaces/:workspaceId/analytics/tasks",
  "/orgs/:orgId/workspaces/:workspaceId/analytics/flaky-tasks",
  "/orgs/:orgId/workspaces/:workspaceId/analytics/time-saved",
  "/orgs/:orgId/workspaces/:workspaceId/analytics/time-to-green",
  "/orgs/:orgId/workspaces/:workspaceId/analytics/sandbox-violations",
] as const;

/**
 * Substitute a template's parameters.
 *
 * @param template a path template from this file
 * @param orgId the organisation id, when the template names one
 * @param workspaceId the workspace id, when the template names one
 * @returns the concrete path
 */
export function nxCloudPath({
  template,
  orgId,
  workspaceId,
}: {
  template: string;
  orgId: string;
  workspaceId: string;
}): string {
  return template.replaceAll(":orgId", orgId).replaceAll(":workspaceId", workspaceId);
}

/**
 * One call's path template rendered in the same placeholder vocabulary the BROWSER channel uses.
 *
 * ## Why the two channels have to agree on this, and once did not
 *
 * An endpoint entity's `providerId` is what the two channels are matched on, byte-exactly. The direct read
 * knows its path as a template (`:orgId`), and the browser only ever sees a concrete URL, which
 * `browserReduction.ts` reduces through this atlas's own segment classifier (`<id>`). Left alone, the two
 * spellings can never match — MEASURED, a generation with both surfaces filled reported ZERO
 * operations held by both and only one-sided rows, several of which were plainly the same endpoint.
 *
 * So a template is rendered into the classifier's vocabulary before it becomes an identity. The mapping is
 * exact rather than a general rule: `:runId` is a run id and everything else here is an object id, which is
 * what the classifier itself distinguishes.
 *
 * @param template the path template from this file
 * @returns the pattern both channels key on
 */
export function canonicalEndpointPattern({ template }: { template: string }): string {
  return template.replaceAll(":runId", "<rid>").replaceAll(/:[A-Za-z]+/g, "<id>");
}

/**
 * Every call id this build declares: the closed union a lookup is keyed on, derived from the rows above.
 *
 * @internal
 */
export type NxCloudCallId = (typeof NX_CLOUD_CALLS)[number]["id"];

/**
 * Is this decoded string the id of a declared call? The guard a caller holding a runtime string runs BEFORE
 * {@link nxCloudCall}, refusing an unknown id with its own typed error rather than looking it up.
 *
 * @param value a call id read from outside the type system
 * @returns whether this build declares it
 */
export function isNxCloudCallId(value: string): value is NxCloudCallId {
  return NX_CLOUD_CALLS.some((call) => call.id === value);
}

/**
 * The one call with a given, declared id.
 *
 * @param id a declared call id, narrowed by {@link isNxCloudCallId} when it was read at run time
 * @returns the row
 */
export function nxCloudCall({ id }: { id: NxCloudCallId }): NxCloudCall {
  // `id` is a member of the union derived from these very rows, so exactly one row carries it.
  return NX_CLOUD_CALLS.find((call) => call.id === id)!;
}

/**
 * The one call with a given id, for a reader holding an id it decoded from a stored outcome.
 *
 * @param id the call a caller named
 * @returns the row, or `null` when this build has no such call
 */
export function findNxCloudCall({ id }: { id: string }): NxCloudCall | null {
  if (!isNxCloudCallId(id)) {
    // Absence by design: an id this build does not declare names no row, and the reader decides what that means.
    return null;
  }
  return nxCloudCall({ id });
}
