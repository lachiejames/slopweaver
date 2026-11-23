/**
 * Which atlas kind each Airtable operation feeds, and why the answer is not simply the operation's tag.
 *
 * ## The tag is Airtable's vocabulary; the kind is the reader's
 *
 * Datadog's registry takes its kind from the first meaningful path segment, and JumpCloud's from the
 * Directory API's own roots, because on those platforms the provider's noun and the reader's noun coincide.
 * On Airtable they do not, in three ways that each cost a reader an answer:
 *
 * - **A tag can be a VERB.** `collaborators` is not a thing Airtable holds; it is an action performed
 *   against a base, a workspace or an interface. Filed under one kind, "who can see this base" and "who can
 *   see this workspace" become the same question with three unrelated answers.
 * - **A tag can be a RENDERING HINT.** `doNotRender` tags two record-update operations Airtable's own
 *   reference chooses not to display. It is a fact about the docs site, not about the platform.
 * - **One operation can feed THREE kinds.** `GET /v0/meta/bases/{baseId}/tables` returns every table with
 *   its fields and its views nested inside. Those are the ops-table columns this atlas exists to hold, and
 *   a registry that could only name one of them would make two thirds of that call invisible.
 *
 * So the kind is a decision recorded here, `alsoFeeds` carries the fan-out, and the generator refuses an
 * operation this table cannot place — which is what stops a new Airtable tag from silently landing in a
 * kind nobody chose.
 */

/**
 * Every kind the Airtable atlas holds, sorted.
 *
 * Two of them map the platform rather than the organisation — `method` is the API surface and `page` the
 * browser one. The other seventeen are entities, because Airtable is the "everything reachable" side of
 * `docs/atlas-intent/06-holdings.md`'s test: nothing else this installation has holds a base, a table, a field or a
 * view, so if this atlas does not, nothing does.
 */
export const AIRTABLE_ATLAS_KINDS = [
  "base",
  "comment",
  "credential",
  "enterprise",
  "event-shape",
  "export-request",
  "extension",
  "field",
  "group",
  "interface",
  "method",
  "page",
  "person",
  "record",
  "share",
  "table",
  "view",
  "webhook",
  "workspace",
] as const;

/** One kind the Airtable atlas holds. */
export type AirtableAtlasKind = (typeof AIRTABLE_ATLAS_KINDS)[number];

/**
 * The kind each of Airtable's own tags feeds by default.
 *
 * Total over the 23 tags the pinned document declares, `workflow` included — which carries no operation at
 * all and is the finding `generated/specLock.ts` records. It is placed anyway, so that the day Airtable
 * publishes an automations endpoint the generator has somewhere to put it rather than refusing the run.
 */
const KIND_BY_TAG: Readonly<Record<string, AirtableAtlasKind>> = {
  auditLogs: "event-shape",
  auditing: "export-request",
  base: "base",
  block: "extension",
  changeEvents: "export-request",
  collaborators: "workspace",
  column: "field",
  comment: "comment",
  doNotRender: "record",
  enterprise: "enterprise",
  hyperDB: "record",
  invites: "person",
  record: "record",
  scim: "person",
  shares: "share",
  table: "table",
  user: "person",
  userManagement: "group",
  view: "view",
  webhooks: "webhook",
  whoAmI: "credential",
  workflow: "page",
  workspace: "workspace",
};

/**
 * The operations whose kind their tag gets wrong, each with the reason.
 *
 * Every entry is a case where the tag names the ACTION or the PRODUCT AREA and the reader needs the
 * RESOURCE. Kept as an explicit table rather than derived from the path, because deriving it would put a
 * second, weaker classifier beside this one and the two would eventually disagree.
 */
const KIND_BY_OPERATION: Readonly<Record<string, AirtableAtlasKind>> = {
  // The `changeEvents` tag covers both the event stream and the eDiscovery exports that read it. The
  // stream is observations; the exports are requests somebody made. See exclusions.ts's header.
  "change-events": "event-shape",
  // Deleting a base is tagged `workspace` because that is where the button lives. The resource is a base.
  "delete-base": "base",
  // A webhook is configuration; its payload backlog is the observation stream Airtable emits for it.
  "list-webhook-payloads": "event-shape",
  // Enterprise personal access tokens are credentials, and reading which of them exist with what scope is
  // a different question from anything else under the `enterprise` tag.
  "list-enterprise-personal-access-tokens": "credential",
  "revoke-enterprise-personal-access-tokens": "credential",
  // Tagged `base` because that is the resource in the path, but what it RETURNS is every table of that
  // base with its fields and views nested. The tables are the resource a reader wants, and `ALSO_FEEDS`
  // carries the other two — this is the one operation the three ops-table kinds all come from.
  "get-base-schema": "table",
  // `collaborators` is a verb. These act on a base.
  "add-base-collaborator": "base",
  "delete-base-collaborator": "base",
  "update-collaborator-base-permission": "base",
  // …and these on an interface page bundle.
  "add-interface-collaborator": "interface",
  "delete-interface-collaborator": "interface",
  "get-interface": "interface",
  "update-interface-collaborator": "interface",
  // `invites` and `scim` both split by the resource the path names.
  "delete-interface-invite": "interface",
  "delete-base-invite": "base",
  "create-scim-group": "group",
  "delete-scim-group": "group",
  "get-scim-group": "group",
  "list-scim-groups": "group",
  "patch-scim-group": "group",
  "put-scim-group": "group",
  // Moving groups is tagged `userManagement`; it moves people between enterprise accounts.
  "move-user-groups": "group",
};

/**
 * The kinds one operation feeds BEYOND its own, because its single response carries them nested.
 *
 * One member. `GET /v0/meta/bases/{baseId}/tables` is the whole schema of a base in one call — every table,
 * every field with its type and options, every view with its type — and it is the operation this atlas
 * leans on hardest, because those three kinds together are what "ops tables that live nowhere else" means.
 */
const ALSO_FEEDS: Readonly<Record<string, readonly AirtableAtlasKind[]>> = {
  "get-base-schema": ["field", "view"],
};

/** The kind an operation id names outright, else the one its tag names, else none. */
function placedKind({ operationId, tag }: { operationId: string; tag: string }): AirtableAtlasKind | undefined {
  const byOperation = KIND_BY_OPERATION[operationId];
  if (byOperation == null) {
    return KIND_BY_TAG[tag];
  }
  return byOperation;
}

/**
 * Which kind an operation feeds, and which others its response also fills.
 *
 * @param operationId Airtable's own operation id
 * @param tag the operation's first declared tag
 * @returns the primary kind and the fan-out, or `null` when this table cannot place the operation
 */
export function airtableKindFor({ operationId, tag }: { operationId: string; tag: string }): {
  readonly alsoFeeds: readonly AirtableAtlasKind[];
  readonly kind: AirtableAtlasKind;
} | null {
  const kind = placedKind({ operationId, tag });
  if (kind === undefined) {
    return null;
  }
  // `ALSO_FEEDS` names only the operations whose response fills a second kind; the rest fill their own alone.
  const alsoFeeds = ALSO_FEEDS[operationId];
  if (alsoFeeds === undefined) {
    return { alsoFeeds: [], kind };
  }
  return { alsoFeeds, kind };
}
