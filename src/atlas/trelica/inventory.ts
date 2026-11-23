/**
 * The closed table of first-party calls this atlas may make, and nothing else.
 *
 * ## A caller names a CALL ID, never a URL
 *
 * Every read goes through {@link TRELICA_CALLS}, so there is no argument anywhere that reaches an endpoint
 * this table does not list. That is the property, and it is the same one `atlas/crowdstrike/inventory.ts`
 * and `atlas/onepassword/inventory.ts` hold: read-only is decided by the table rather than by a reviewer
 * checking each call site.
 *
 * ## The HTTP verb decides nothing here, which is why `whyRead` exists
 *
 * This platform's own client lists a filtered inventory by POSTing the filter, so a rule that said "only
 * GET" would be false about the surface and would exclude the atlas's central entity kind. Every admitted
 * row instead carries its own `whyRead` justification, which a reviewer checks against the table: the row
 * says what it reads and why that read changes nothing.
 *
 * ## Paging is part of the row, not the caller's business
 *
 * MEASURED: the application inventory holds more records than one default page and answers `{items, total}`,
 * so a caller that forgot to page would silently publish the first twenty and report a complete surface. A row
 * that pages declares it, and the client drives the loop.
 */

/**
 * Which channel a row belongs to. Every row here is the first-party one; the field is for the projection.
 *
 * @internal
 */
export const TRELICA_FIRST_PARTY_CHANNEL = "first-party-api" as const;

/** What every admitted call carries, whichever verb it sends. */
interface TrelicaCallRow {
  /** The stable id a caller names. Never a URL, so no tenant label reaches a log or an error. */
  readonly id: string;
  /** The path beneath the tenant origin, with no query string — paging supplies that. */
  readonly path: string;
  /** Why reading this changes nothing. Checked by a reviewer against the row, not against a call site. */
  readonly whyRead: string;
  /** Whether the response is a `{items, total}` page this client must walk to the end. */
  readonly paged: boolean;
  /** Fixed query parameters the row always sends, appended after paging's own. Part of the row, never a caller's. */
  readonly query?: Readonly<Record<string, string>>;
}

/**
 * One admitted first-party call. A GET sends no body; a POST lists by POSTing its filter, so the filter is part
 * of the row — an empty one included — and a POST row without one does not compile.
 */
export type TrelicaCall =
  | (TrelicaCallRow & { readonly httpMethod: "GET" })
  | (TrelicaCallRow & {
      readonly httpMethod: "POST";
      /** The JSON filter the platform's own client posts to list this way. */
      readonly body: Readonly<Record<string, unknown>>;
    });

/**
 * Every first-party call this atlas may make.
 *
 * The inventory is deliberately small: what makes an atlas complete here is the surface MAP over every page
 * and endpoint, and the entity kinds are the ones nothing else on this machine holds. The cost explorer's
 * usage reads page inside their body rather than their query string, so they are `aiUsage.ts`'s table.
 */
export const TRELICA_CALLS = {
  /**
   * The cost explorer's spend-spike alerts. MEASURED: a spike alert is raised against one application's own
   * spend baseline.
   */
  aiAlertsSpike: {
    httpMethod: "GET",
    id: "ai-alerts-spike",
    paged: true,
    path: "/AppsApi/AppAIAlert/History",
    query: { type: "Spike" },
    whyRead:
      "lists the spend-spike alerts the cost explorer has already raised — the same history its Alerts tab renders, filtered by type and changing nothing",
  },
  /** The cost explorer's budget-threshold alerts, from the same history as the spike alerts. */
  aiAlertsBudget: {
    httpMethod: "GET",
    id: "ai-alerts-budget",
    paged: true,
    path: "/AppsApi/AppAIAlert/History",
    query: { type: "Budget" },
    whyRead:
      "lists the budget-threshold alerts the cost explorer has already raised — the same history its Alerts tab renders, filtered by type and changing nothing",
  },
  /**
   * Every AI-spend budget, past, active and future. MEASURED: no read has yet answered one, so no
   * record shape has been seen — `sync.ts` counts them and raises a gap rather than projecting a guessed one.
   */
  aiBudgets: {
    body: {
      clauses: [
        {
          fieldIdentifierPath: [{ fieldId: "BudgetStatus", fieldType: "SingleOptionField" }],
          operator: "In",
          optionValue: ["Past", "Active", "Future"],
        },
      ],
      type: "And",
    },
    httpMethod: "POST",
    id: "ai-budgets",
    paged: true,
    path: "/AppsApi/CustomerAppBudget/FilterItems",
    whyRead:
      "lists the AI-spend budgets in every status — the POST carries the status filter because the Budgets tab lists this way, widened from its default two statuses to all three, and nothing is created or changed",
  },
  /**
   * The organisation-wide application inventory — the register the whole atlas is ranked first for, and a
   * superset of the end-user catalogue below.
   */
  appInventory: {
    body: {},
    httpMethod: "POST",
    id: "app-inventory",
    paged: true,
    path: "/AppsApi/CustomerApp/FilterItems",
    whyRead:
      "lists the applications this tenant knows about, with no filter and no mutation — the POST carries the (empty) filter because the platform's own client lists this way, and the response is the same one the inventory page renders",
  },
  /**
   * The end-user catalogue: the subset of applications offered to staff. Held because the difference
   * between it and the inventory is itself the answer to "what is actually offered here".
   */
  appCatalog: {
    body: {},
    httpMethod: "POST",
    id: "app-catalog",
    paged: true,
    path: "/AppsApi/AppCatalog/FilterItems",
    whyRead:
      "lists the applications offered in the tenant's own end-user catalogue, unfiltered and unmodified — the same list the catalogue page shows the person running this",
  },
  /** The tenant's own roles, which is what makes a visibility claim checkable rather than asserted. */
  roles: {
    httpMethod: "GET",
    id: "roles",
    paged: false,
    path: "/Id/AdminApi/Roles",
    whyRead:
      "lists the role names this tenant defines. A read of configuration, and the thing that lets a coverage cell say which roles a claim was measured under instead of asserting a ceiling",
  },
} as const satisfies Readonly<Record<string, TrelicaCall>>;

/**
 * The id of every admitted call.
 *
 * @internal
 */
export type TrelicaCallId = (typeof TRELICA_CALLS)[keyof typeof TRELICA_CALLS]["id"];

/**
 * Look one call up by the id a caller named.
 *
 * @param id the call id, closed over the table's own ids — so an id the table does not list is refused at
 * compile time, which is the whole point of the table
 * @returns the row
 *
 * @internal
 */
export function findTrelicaCall({ id }: { id: TrelicaCallId }): TrelicaCall {
  // Total: `TrelicaCallId` is derived from this very table's `id` fields, so every value it admits names a row.
  return Object.values(TRELICA_CALLS).find((call: TrelicaCall) => call.id === id)!;
}

/**
 * Every admitted call, in a stable order.
 *
 * @returns the rows, ordered by id so a published generation is stable
 *
 * @internal
 */
export function trelicaCalls(): readonly TrelicaCall[] {
  return Object.values(TRELICA_CALLS)
    .map((call: TrelicaCall) => call)
    .toSorted((left, right) => left.id.localeCompare(right.id));
}
