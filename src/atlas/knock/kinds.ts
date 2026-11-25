/**
 * What the Knock atlas holds, one kind per file, and how an operation or a dashboard route is assigned one.
 *
 * ## This atlas holds EVERYTHING REACHABLE, so the list is long
 *
 * `docs/atlas-intent/06-holdings.md` states the test: does something better suited already hold this platform's
 * entities? Nothing in this installation ingests Knock at all — no corpus source knows that a Knock
 * workflow, guide, broadcast, channel, environment, commit or recipient exists — so the answer is no, and
 * this atlas holds them. Two of the kinds below map the SURFACE and the other thirty are entities.
 *
 * ## The kind is decided by PATH PREFIX, never by the document's own tag
 *
 * Knock tags are presentation groupings on its documentation site and they cut across resources in both
 * directions. `Preference center` tags one operation about an account-level configuration and another about
 * one recipient's preference set; `Providers` tags six operations that are really about a channel's
 * authorisation. A kind taken from the tag would file a recipient's preferences under an account
 * configuration, which is exactly the confusion the read view exists to remove. The prefix table below is
 * the atlas's own decision, and it is stated once here rather than inferred at each call site.
 *
 * ## Two APIs, one kind space
 *
 * Knock publishes two documents on two hosts — the data API on `api.knock.app` and the Management API on
 * `control.knock.app` — and they overlap. Both declare a `Workflows` tag; the first triggers one and the
 * second reads its definition. They are the same NOUN reached two ways, so `workflow` is one kind carrying
 * operations from both, and the row's own {@link ../surfaceNaming.js#KnockApi} says which document declared
 * it. Splitting them would give a reader two half-answers to "what can Knock tell me about a workflow".
 */

/**
 * Every kind the Knock atlas holds. Alphabetical, because the catalogue and the empty-generation record are
 * both written in this order and a reader diffing two generations should not have to sort them first.
 */
export const KNOCK_ATLAS_KINDS = [
  "account",
  "asset",
  "audience",
  "branch",
  "broadcast",
  "channel",
  "channel-group",
  "commit",
  "dashboard-route",
  "email-layout",
  "environment",
  "event-shape",
  "goal",
  "guide",
  "item-schema",
  "member",
  "message-type",
  "method",
  "object",
  "partial",
  "preference-category",
  "preference-center",
  "preference-set",
  "schedule",
  "source",
  "subscription",
  "tag",
  "tenant",
  "translation",
  "user",
  "variable",
  "workflow",
] as const;

/** One kind the Knock atlas holds. */
export type KnockAtlasKind = (typeof KNOCK_ATLAS_KINDS)[number];

/**
 * The prefix table, longest match first.
 *
 * Order is load-bearing and the list is written longest-first rather than sorted: `/v1/audiences/{key}/members`
 * belongs to `audience` and `/v1/users/{user_id}/subscriptions` to `subscription`, and a shorter prefix
 * would claim both. The generator asserts every declared operation matched some row, so a Knock release
 * adding a noun fails the generator rather than silently landing under a neighbour.
 */
const PATH_KINDS: readonly (readonly [string, KnockAtlasKind])[] = [
  ["/v1/objects/{collection}/{object_id}/channel_data", "channel"],
  ["/v1/objects/{collection}/{object_id}/subscriptions", "subscription"],
  ["/v1/objects/{collection}/{object_id}/preferences", "preference-set"],
  ["/v1/objects/{collection}/bulk/subscriptions", "subscription"],
  ["/v1/objects/{collection}/{id}/schedules", "schedule"],
  ["/v1/objects/{collection}/{id}/messages", "event-shape"],
  ["/v1/users/{user_id}/preference_center", "preference-center"],
  ["/v1/users/{user_id}/subscriptions", "subscription"],
  ["/v1/users/{user_id}/channel_data", "channel"],
  ["/v1/users/{user_id}/preferences", "preference-set"],
  ["/v1/users/{user_id}/schedules", "schedule"],
  ["/v1/users/{user_id}/messages", "event-shape"],
  ["/v1/users/{user_id}/guides", "guide"],
  ["/v1/users/{user_id}/feeds", "event-shape"],
  ["/v1/users/bulk/preferences", "preference-set"],
  ["/v1/audiences/{key}/members", "audience"],
  ["/v1/workflows/{workflow_key}/steps", "workflow"],
  ["/v1/workflow_recipient_runs", "event-shape"],
  ["/v1/bulk_operations", "event-shape"],
  ["/v1/source_providers", "source"],
  ["/v1/preference_categories", "preference-category"],
  ["/v1/preference_center", "preference-center"],
  ["/v1/channel_groups", "channel-group"],
  ["/v1/message_types", "message-type"],
  ["/v1/email_layouts", "email-layout"],
  ["/v1/api_keys", "account"],
  ["/v1/integrations", "channel"],
  ["/v1/translations", "translation"],
  ["/v1/environments", "environment"],
  ["/v1/broadcasts", "broadcast"],
  ["/v1/audiences", "audience"],
  ["/v1/schedules", "schedule"],
  ["/v1/variables", "variable"],
  ["/v1/workflows", "workflow"],
  ["/v1/templates", "workflow"],
  ["/v1/providers", "channel"],
  ["/v1/preferences", "preference-set"],
  ["/v1/branches", "branch"],
  ["/v1/channels", "channel"],
  ["/v1/messages", "event-shape"],
  ["/v1/partials", "partial"],
  ["/v1/billing", "account"],
  ["/v1/commits", "commit"],
  ["/v1/members", "member"],
  ["/v1/schemas", "item-schema"],
  ["/v1/sources", "source"],
  ["/v1/tenants", "tenant"],
  ["/v1/objects", "object"],
  ["/v1/assets", "asset"],
  ["/v1/guides", "guide"],
  ["/v1/goals", "goal"],
  ["/v1/users", "user"],
  ["/v1/whoami", "account"],
  ["/v1/notify", "workflow"],
  ["/v1/tags", "tag"],
] as const;

/**
 * Which kind one declared operation's own resource belongs to.
 *
 * @param path the document's own path template, `{brace}` parameters intact
 * @returns the kind, or `null` when no prefix claims it — which the generator treats as a refusal
 */
export function knockKindForPath({ path }: { path: string }): KnockAtlasKind | null {
  for (const [prefix, kind] of PATH_KINDS) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return kind;
    }
  }
  return null;
}

/**
 * Which atlas kind one dashboard route displays, or `null` when it displays something no kind covers.
 *
 * `null` is the interesting answer and the reason this function exists. A dashboard page whose subject no declared
 * operation reads is `docs/atlas-intent/02-both-surfaces.md`'s class of things reachable only via the browser, not the
 * API, arriving as a measured fact about Knock rather than as a principle — so the mapping is deliberately written to
 * return `null` rather than to reach for the nearest plausible kind. Three of those absences are worth naming here
 * because a reader will otherwise assume a mistake:
 *
 * - **`/[slug]/agents`, `/agents/skills` and `/agents/sessions/[sessionId]`** — the Agents workspace, and
 *   the first item in the dashboard's own navigation. NEITHER published document declares an Agents tag,
 *   path or schema. The whole product area is reachable only in a browser.
 * - **`/settings/api-keys`, `/[environment]/api-keys` and `/settings/service-tokens`** — no operation in
 *   either document reads an API key or a service token. The credentials that authenticate both APIs can
 *   be seen only through the one surface that needs no credential to reach.
 * - **`/settings/audit-log`** — no operation, on either API. The audit trail is browser-only, which matters
 *   more than most absences because it is the surface a compliance question reaches for.
 *
 * The routes that map to a kind are the ordinary case and carry no comment.
 *
 * @param route the route pattern exactly as the dashboard's own manifest declares it
 * @returns the kind the page displays, or `null` when no kind covers it
 */
export function knockKindForRoute({ route }: { route: string }): KnockAtlasKind | null {
  const environment = /^\/\[slug\]\/\[environment\]\/([^/]+)/.exec(route)?.[1];
  if (environment !== undefined) {
    return environmentRouteKind({ segment: environment });
  }
  const settings = /^\/\[slug\]\/settings\/(.+)$/.exec(route)?.[1];
  if (settings !== undefined) {
    // A non-empty match cannot split to an empty list, so index 0 is always there.
    const section = settings.startsWith("integrations/")
      ? settings.split("/").slice(0, 2).join("/")
      : settings.split("/")[0]!;
    return settingsRouteKind({ section });
  }
  return route === "/" || route === "/[slug]" || route === "/[slug]/settings" ? "account" : null;
}

/**
 * Whether a route segment decoded from a manifest is a key one route table declares as its OWN.
 *
 * `Object.hasOwn` rather than an index: a plain object literal answers `constructor` or `toString` with an
 * inherited function, which a bare index would have handed back as if it were a kind.
 */
function isDeclaredRouteKey<TTable extends Readonly<Record<string, KnockAtlasKind>>>(
  table: TTable,
  key: string,
): key is Extract<keyof TTable, string> {
  return Object.hasOwn(table, key);
}

/** The kind one `/[slug]/[environment]/<segment>` route displays. */
function environmentRouteKind({ segment }: { segment: string }): KnockAtlasKind | null {
  if (!isDeclaredRouteKey(ENVIRONMENT_ROUTE_KINDS, segment)) {
    // Absent by design: a segment no row declares displays something no kind covers — the answer this exists for.
    return null;
  }
  return ENVIRONMENT_ROUTE_KINDS[segment];
}

/** The kind one `/[slug]/settings/<section>` route displays. */
function settingsRouteKind({ section }: { section: string }): KnockAtlasKind | null {
  if (!isDeclaredRouteKey(SETTINGS_ROUTE_KINDS, section)) {
    // Absent by design: a settings section no row declares displays something no kind covers.
    return null;
  }
  return SETTINGS_ROUTE_KINDS[section];
}

/** The first path segment under `/[slug]/[environment]/`, and what it displays. */
const ENVIRONMENT_ROUTE_KINDS = {
  assets: "asset",
  audiences: "audience",
  broadcasts: "broadcast",
  commits: "commit",
  goals: "goal",
  guides: "guide",
  layouts: "email-layout",
  logs: "event-shape",
  "message-types": "message-type",
  messages: "event-shape",
  objects: "object",
  partials: "partial",
  preferences: "preference-center",
  runs: "event-shape",
  schedules: "schedule",
  sources: "source",
  tenants: "tenant",
  translations: "translation",
  users: "user",
  workflows: "workflow",
} as const satisfies Readonly<Record<string, KnockAtlasKind>>;

/** The first path segment under `/[slug]/settings/`, and what it displays. */
const SETTINGS_ROUTE_KINDS = {
  account: "account",
  billing: "account",
  branches: "branch",
  environments: "environment",
  "integrations/channel-groups": "channel-group",
  "integrations/channels": "channel",
  "integrations/sources": "source",
  profile: "member",
  schemas: "item-schema",
  tags: "tag",
  team: "member",
  variables: "variable",
} as const satisfies Readonly<Record<string, KnockAtlasKind>>;
