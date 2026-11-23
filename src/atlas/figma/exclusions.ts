/**
 * What this atlas does with each Figma operation that is not simply stored — the four tables the generator
 * consults, and the reason attached to every row they decide.
 *
 * ## The HTTP verb decides ONE direction only, and Figma is a clean case of why
 *
 * A non-GET is refused unless it appears in {@link FIGMA_OBSERVATIONAL_POSTS}, which has exactly one
 * member. That direction is safe here because Figma's REST surface is REST-shaped: it reads with GET and
 * writes with POST/PUT/DELETE, and the one exception is `POST /v1/developer_logs`, which takes its filter
 * in a body because a log query does not fit a query string. The operation NAMES itself `getDeveloperLogs`
 * — Figma's own id begins with `get` on the one POST that reads — and `exclusions.test.ts` asserts that no
 * admitted non-GET's `operationId` begins with a mutating verb, the same cheap second opinion the Datadog
 * atlas put on its own hand-reviewed list after a POST that reads by shape turned out to be a create.
 *
 * The OTHER direction is not safe, and it is not safe here either: a GET is not automatically an entity.
 * Six of Figma's GETs return unbounded observation feeds, so they are shape-indexed rather than refused;
 * one answers a question about this installation rather than about the organisation, so it is stored
 * nowhere at all; and three produce an artifact or need an identifier nothing enumerates, so they are
 * inventoried and never called.
 *
 * ## The voluminous criterion CUTS THROUGH the Library Analytics family
 *
 * `docs/atlas-intent/06-holdings.md` states it: a family is voluminous when its records are time-series
 * OBSERVATIONS — emitted by the platform, unbounded, growing with the clock, and identified by an INSTANT
 * rather than by a name somebody chose. Configuration is the complement: what a person or a system CREATED,
 * and what can be listed exhaustively.
 *
 * Figma's `Library Analytics` tag is the worked example, and the two halves sit one path segment apart:
 *
 * - `GET …/component/actions` takes `start_date` and `end_date` and returns one row per asset per DAY or
 *   WEEK. Observations. Shape-indexed.
 * - `GET …/component/usages` takes no date at all and returns one row per asset, or per consuming file —
 *   the current, finite answer to "what is in this library and who uses it". Entities.
 *
 * A rule stated as a list of FAMILIES to skip would have dropped the second along with the first, which is
 * precisely the failure the criterion was sharpened to prevent. `kinds.ts` completes the split by filing
 * the three usage operations under the assets they are about rather than under a shared analytics bucket.
 *
 * ## An excluded row still EXISTS
 *
 * It is addressable by surface name for inventory and coverage, publishing its reason, because an atlas
 * that silently omitted `POST /v2/webhooks` would answer "Figma cannot create a webhook", which is false.
 * What an excluded row does not have is a callable request variant.
 */

/**
 * Every non-GET operation this atlas will call, by `operationId`.
 *
 * One member, and the reason it is a LIST rather than a boolean is that the next Figma release may add a
 * second — a search endpoint taking a filter body is the obvious shape — and a reviewer should be adding a
 * line here rather than widening a predicate.
 */
export const FIGMA_OBSERVATIONAL_POSTS: readonly string[] = ["getDeveloperLogs"];

/**
 * The operations whose records are time-series observations: called over a bounded window, shape recorded,
 * never an entry stored.
 *
 * Each carries the sentence a coverage cell prints, so a reader learns the surface EXISTS and what it holds
 * without a single row of it being fetched — which is the difference between a declared voluminous surface
 * and one nobody looked at.
 */
export const FIGMA_VOLUMINOUS_OPERATIONS: readonly {
  readonly detail: string;
  readonly operationId: string;
}[] = [
  {
    detail:
      "the organisation's activity log — every action taken across the org, emitted by Figma, identified by " +
      "its own timestamp and growing with the clock. Walked by narrowing a start_time/end_time window under " +
      "a limit. The atlas records which event types exist and what an entry's attributes look like; a " +
      "specific event is fetched live, never stored here. It is also the ONLY operation on this platform an " +
      "organisation-scoped OAuth grant can reach, which is a posture fact worth having beside the data one",
    operationId: "getActivityLogs",
  },
  {
    detail:
      "the developer log — every REST call made against this plan, with the token or OAuth app that made " +
      "it. Observations by construction: one row per request, emitted by Figma, identified by an instant. " +
      "The atlas records the entry shape, which is what lets a reader answer 'can Figma tell me which " +
      "integration read that file' without this atlas holding a request history of its own",
    operationId: "getDeveloperLogs",
  },
  {
    detail:
      "daily AI credit consumption, one row per user per DAY. A metered time series the platform emits, " +
      "identified by a date rather than by anything somebody named, so the shape is recorded and the rows " +
      "are not. Note that its rows carry a user's email, which is a second reason not to hold them",
    operationId: "getAiUsageDaily",
  },
  {
    detail:
      "one webhook's own delivery history — the requests Figma made to that endpoint and what came back. " +
      "The webhook itself is configuration and IS stored as an entity; its request stream is the " +
      "observation half and is not",
    operationId: "getWebhookRequests",
  },
  {
    detail:
      "component library actions — detaches, insertions and publishes, one row per asset per day or week " +
      "over a start_date/end_date window. The `usages` sibling one path segment away takes no date, returns " +
      "a finite current listing, and IS an entity source; that split is the voluminous criterion cutting " +
      "through this family rather than along it",
    operationId: "getLibraryAnalyticsComponentActions",
  },
  {
    detail: "style library actions over a dated window. Same criterion, same split against its `usages` sibling",
    operationId: "getLibraryAnalyticsStyleActions",
  },
  {
    detail: "variable library actions over a dated window. Same criterion, same split against its `usages` sibling",
    operationId: "getLibraryAnalyticsVariableActions",
  },
];

/**
 * The operations called to establish posture and stored nowhere.
 *
 * `GET /v1/me` answers which identity this installation's token carries and, through the scopes it was
 * granted, what it may ask for. That is a fact about the CREDENTIAL, not about the organisation, so
 * publishing it as an entity would put an installation detail in a file whose every other row is a thing
 * the organisation owns. It is still called on every authenticated sync, because a coverage cell that
 * cannot say which identity was presented cannot explain why a kind came back empty.
 */
export const FIGMA_PROBE_ONLY_OPERATIONS: readonly {
  readonly detail: string;
  readonly operationId: string;
}[] = [
  {
    detail:
      "credential posture. It answers which Figma user this token authenticates as, which is what lets a " +
      "coverage cell distinguish 'this organisation has none' from 'this token may not ask'. It is also the " +
      "whole of the `Users` tag: Figma's REST surface has exactly one user operation and it describes the " +
      "caller, so team and organisation membership are reachable in the browser and nowhere else",
    operationId: "getMe",
  },
];

/**
 * The operations whose response is a generated ARTIFACT rather than a fact about the platform.
 *
 * Both produce something to look at behind an address that stops working, and neither adds a fact the file
 * operations do not already carry. Storing either would put an expiring URL in a file whose whole purpose
 * is to still be true next month.
 */
export const FIGMA_RENDER_ONLY_OPERATIONS: readonly {
  readonly operationId: string;
  readonly reason: string;
}[] = [
  {
    operationId: "getImages",
    reason:
      "it renders the nodes you name into PNG, SVG or PDF and hands back S3 URLs Figma expires after 30 " +
      "days. The render is the product; the nodes it was made from are already reachable through " +
      "`getFileNodes`, so there is nothing here to store that stays true",
  },
  {
    operationId: "getOEmbed",
    reason:
      "it turns a Figma URL a caller already holds into an embed fragment — an `<iframe>` and a title. A " +
      "presentation helper over a link, not a source of anything about the file that `getFileMeta` does " +
      "not answer directly",
  },
];

/**
 * The operations that answer about one identifier nothing enumerates.
 *
 * One member. `GET /v1/payments` reports whether a named person has bought a named Community resource, and
 * it must be handed either a plugin payment token minted for a running plugin or the ids of a plugin,
 * widget or community file the caller owns. No operation anywhere returns the set of any of those, so there
 * is nothing for a sync to walk — and the row stays in the inventory precisely so a reader learns the
 * payments surface exists and why this atlas cannot enumerate it.
 */
export const FIGMA_NOT_ENUMERABLE_OPERATIONS: readonly {
  readonly operationId: string;
  readonly reason: string;
}[] = [
  {
    operationId: "getPayments",
    reason:
      "it answers whether one named user has purchased one named Community resource, and requires either a " +
      "plugin payment token issued to a running plugin or a plugin, widget or community-file id the caller " +
      "owns. Figma publishes no operation that lists any of those, so this endpoint has no set to walk",
  },
];

/**
 * What this atlas does with one operation that is not a plain stored entity.
 *
 * Pure, and the single place the tables above are consulted, so the generator and the tests read the same
 * decision rather than two copies of it.
 *
 * @param method the operation's HTTP method
 * @param operationId Figma's own operation id
 * @returns the disposition, the reason it is not a plain entity, and which refusal applied
 */
export function figmaDispositionOf({ method, operationId }: { method: string; operationId: string }): {
  readonly disposition: "entity" | "shape-index" | "probe-only" | "excluded";
  readonly dispositionBecause: string | null;
  readonly exclusionReason: "mutating" | "render-only" | "not-enumerable" | null;
} {
  if (method !== "GET" && !FIGMA_OBSERVATIONAL_POSTS.includes(operationId)) {
    return {
      disposition: "excluded",
      dispositionBecause: `${method} changes the tenant, and this atlas only ever reads`,
      exclusionReason: "mutating",
    };
  }
  const rendered = FIGMA_RENDER_ONLY_OPERATIONS.find((row) => row.operationId === operationId);
  if (rendered !== undefined) {
    return { disposition: "excluded", dispositionBecause: rendered.reason, exclusionReason: "render-only" };
  }
  const unwalkable = FIGMA_NOT_ENUMERABLE_OPERATIONS.find((row) => row.operationId === operationId);
  if (unwalkable !== undefined) {
    return { disposition: "excluded", dispositionBecause: unwalkable.reason, exclusionReason: "not-enumerable" };
  }
  const probe = FIGMA_PROBE_ONLY_OPERATIONS.find((row) => row.operationId === operationId);
  if (probe !== undefined) {
    return { disposition: "probe-only", dispositionBecause: probe.detail, exclusionReason: null };
  }
  const voluminous = FIGMA_VOLUMINOUS_OPERATIONS.find((row) => row.operationId === operationId);
  if (voluminous !== undefined) {
    return { disposition: "shape-index", dispositionBecause: voluminous.detail, exclusionReason: null };
  }
  return { disposition: "entity", dispositionBecause: null, exclusionReason: null };
}
