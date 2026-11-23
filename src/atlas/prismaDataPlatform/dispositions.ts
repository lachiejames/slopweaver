/**
 * What this atlas does with each Prisma Data Platform operation that is not simply stored — the three
 * tables the generator consults, and the reason attached to every row they decide.
 *
 * ## The HTTP verb decides ONE direction only
 *
 * A non-GET is refused as `mutating`, with no exception list at all, and this platform is the cleanest case
 * of that being safe: every one of the 61 non-GET operations here creates, updates, deletes, promotes,
 * rolls back, rotates, restores, leases or starts something. There is no read-by-POST anywhere on the
 * document — Figma needed a one-member allowlist for `POST /v1/developer_logs`, Prisma needs none — so
 * declaring an empty allowlist would be a vocabulary claiming a judgement nobody makes.
 *
 * The OTHER direction is not safe, and it is not safe here either: a GET is not automatically an entity.
 * Two of the 54 GETs return unbounded log streams, and one answers a question about this installation
 * rather than about the organisation.
 *
 * ## The voluminous criterion cuts THROUGH the Compute observability family
 *
 * `docs/atlas-intent/06-holdings.md` states it: a family is voluminous when its records are time-series
 * OBSERVATIONS — emitted by the platform, unbounded, growing with the clock, and identified by an INSTANT
 * rather than by a name somebody chose. Configuration is the complement: what a person or a system CREATED,
 * and what can be listed exhaustively.
 *
 * Three operations on this platform look like one family and split two ways under that test, and the split
 * is the reason the criterion is applied per operation rather than per tag:
 *
 * - `GET /v1/builds/{buildId}/logs` and `GET /v1/deployments/{deploymentId}/logs` answer
 *   `application/x-ndjson`, one record per line, cursored, and `follow=true` keeps the connection open
 *   until the build or deployment ends. Unbounded observations. Shape-indexed.
 * - `GET /v1/databases/{databaseId}/backups` looks like the same shape and is not. Its response carries
 *   `meta.backupRetentionDays` — Prisma's OWN declared bound on how far back the listing goes — and it
 *   takes a `limit` with no cursor at all, so one call exhausts it. A backup has an id, a type, a size and
 *   a status; it is a restorable resource (`POST /v1/databases/{targetDatabaseId}/restore` takes one), not
 *   a line in a feed. It is an entity, and it is the sharpest case here of the criterion cutting through a
 *   family rather than along it.
 *
 * `GET /v1/databases/{databaseId}/usage` is the third near miss and it is also an entity, for a different
 * reason worth stating rather than leaving to inference: it returns ONE aggregate object — a `period` and
 * two `metrics` totals — for a caller-chosen `startDate`/`endDate` window. It has no rows to be voluminous
 * about. What its row carries is the window it was asked for, because the value is window-relative and a
 * stored figure with no window beside it would be a number meaning nothing.
 *
 * ## An excluded row still EXISTS
 *
 * It is addressable by surface name for inventory and coverage, publishing its reason, because an atlas
 * that silently omitted `POST /v1/databases` would answer "Prisma cannot create a database", which is
 * false. What an excluded row does not have is a callable request variant.
 */

/**
 * The operations whose records are time-series observations: called over a bounded window, shape recorded,
 * never a line stored.
 *
 * Each carries the sentence a coverage cell prints, so a reader learns the surface EXISTS and what it holds
 * without a single line of it being fetched — which is the difference between a declared voluminous surface
 * and one nobody looked at.
 */
export const PRISMA_VOLUMINOUS_OPERATIONS: readonly {
  readonly detail: string;
  readonly operation: string;
}[] = [
  {
    detail:
      "the build log — every line a Prisma Compute build emitted, as newline-delimited JSON, one record " +
      "per line with its own cursor, level and source. Observations by construction: emitted by the " +
      "builder, growing while the build runs, identified by position in a stream rather than by a name " +
      "anybody chose, and `follow=true` holds the connection open until the build terminates. The atlas " +
      "records which record types the stream emits and what a line's fields are; a specific line is " +
      "fetched live, never stored here",
    operation: "GET /v1/builds/{buildId}/logs",
  },
  {
    detail:
      "the deployment log — the running service's own output, as newline-delimited JSON, and the one " +
      "operation on this platform that also answers a WebSocket upgrade (status 101) so a caller can " +
      "follow it live. Unbounded for as long as the deployment runs. The atlas records the line shape and " +
      "the two ways to walk it — `tail` for the last n, `cursor` to continue, `from_start` to rewind — " +
      "which is what lets a reader answer 'can Prisma tell me what this service printed' without the " +
      "atlas holding a byte of it",
    operation: "GET /v1/deployments/{deploymentId}/logs",
  },
];

/**
 * The operations called to establish posture and stored nowhere.
 *
 * One member, and it is here for two reasons rather than one. `GET /v1/me` answers which identity a
 * credential carries — a fact about this INSTALLATION rather than about the organisation, which is the
 * Figma precedent — and its response also carries `data.user.email`, a real person's address. Storing it
 * would put personal data in a generation whose every other row is a platform resource, to answer a
 * question the caller already knows the answer to.
 */
export const PRISMA_PROBE_ONLY_OPERATIONS: readonly {
  readonly detail: string;
  readonly operation: string;
}[] = [
  {
    detail:
      "it answers who the presented credential is — the user, the workspace and the credential's own type " +
      "(`oauth`, `service_token` or `management_token`). That is a fact about this installation rather " +
      "than about the organisation, and the response carries a person's email address, so it is called to " +
      "establish posture and stored nowhere at all",
    operation: "GET /v1/me",
  },
];

/**
 * The operations that answer about one identifier nothing enumerates.
 *
 * Two members, and both are reachable the moment a credential exists — they are `not-enumerable` because
 * no operation returns the SET of what they take, never because they are unreachable. A build id comes back
 * from `GET /v1/builds`, so `GET /v1/builds/{buildId}` is walkable and is not here; a `resourceType`/
 * `resourceId` pair and an Alchemy `fqn` have no listing anywhere.
 */
export const PRISMA_NOT_ENUMERABLE_OPERATIONS: readonly {
  readonly operation: string;
  readonly reason: string;
}[] = [
  {
    operation:
      "GET /v1/projects/{projectId}/branches/{branchId}/alchemy-state/state/stacks/{stack}/stages/{stage}/output",
    reason:
      "it returns one Alchemy stage's output blob, and the stage is addressed by a name the IaC program " +
      "chose. `…/stacks` lists stacks and `…/stages` lists stages, so this is walkable in principle — but " +
      "only underneath a branch id, and branch enumeration itself needs a project id, which makes this the " +
      "deepest walk on the platform for a value that is an opaque state blob rather than a fact about the " +
      "account. Inventoried so a reader learns the IaC state store exists and can address it directly",
  },
  {
    operation:
      "GET /v1/projects/{projectId}/branches/{branchId}/alchemy-state/state/stacks/{stack}/stages/{stage}/resources/{fqn}",
    reason:
      "it returns one Alchemy resource's stored state, addressed by a fully-qualified name the IaC program " +
      "minted. `…/resources` lists them, so the fqn is discoverable — but the value is the deploy tool's " +
      "own serialised state rather than a Prisma resource, and holding a second copy of a state store is " +
      "the kind of duplication `docs/atlas-intent/06-holdings.md`'s who-else-holds-it test exists to prevent",
  },
];

/**
 * What this atlas does with one operation that is not a plain stored entity.
 *
 * Pure, and the single place the tables above are consulted, so the generator and the tests read the same
 * decision rather than two copies of it.
 *
 * @param method the operation's HTTP method
 * @param path the document's own path template, `{brace}` parameters intact
 * @returns the disposition, the reason it is not a plain entity, and which refusal applied
 */
export function prismaDispositionOf({ method, path }: { method: string; path: string }): {
  readonly disposition: "entity" | "shape-index" | "probe-only" | "excluded";
  readonly dispositionBecause: string | null;
  readonly exclusionReason: "mutating" | "not-enumerable" | null;
} {
  if (method !== "GET") {
    return {
      disposition: "excluded",
      dispositionBecause: `${method} changes the tenant, and this atlas only ever reads`,
      exclusionReason: "mutating",
    };
  }
  const operation = `${method} ${path}`;
  const unwalkable = PRISMA_NOT_ENUMERABLE_OPERATIONS.find((row) => row.operation === operation);
  if (unwalkable !== undefined) {
    return { disposition: "excluded", dispositionBecause: unwalkable.reason, exclusionReason: "not-enumerable" };
  }
  const probe = PRISMA_PROBE_ONLY_OPERATIONS.find((row) => row.operation === operation);
  if (probe !== undefined) {
    return { disposition: "probe-only", dispositionBecause: probe.detail, exclusionReason: null };
  }
  const voluminous = PRISMA_VOLUMINOUS_OPERATIONS.find((row) => row.operation === operation);
  if (voluminous !== undefined) {
    return { disposition: "shape-index", dispositionBecause: voluminous.detail, exclusionReason: null };
  }
  return { disposition: "entity", dispositionBecause: null, exclusionReason: null };
}
