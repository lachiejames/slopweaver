/**
 * Which of the four dispositions each Google Admin operation takes, and the rules that decide it.
 *
 * ## The read/write rule, and why the obvious computable one is WRONG
 *
 * The tempting rule on this platform is "an operation that declares a `.readonly` scope is a read", and it
 * is vendor-declared, computable, and unsound. MEASURED across the eleven pinned documents, it
 * classifies **nine** non-GET methods as reads and is wrong about six of them:
 *
 * - `directory.users.watch`, `directory.users.aliases.watch` and `reports.activities.watch` register a
 *   push-notification channel against a URL the caller supplies, and each declares a `.readonly` scope.
 * - `admin.channels.stop` DELETES such a channel, under `admin.directory.user.readonly` among others.
 * - `chromemanagement.customers.telemetry.notificationConfigs.create` and `.delete` create and delete a
 *   stored configuration while declaring **only** `chrome.management.telemetry.readonly`. That is the
 *   vendor granting a write under a scope whose name says otherwise, and `gaps.ts` raises it as a finding
 *   rather than swallowing it — it is exactly the kind of thing an atlas exists to reveal.
 *
 * So the rule is: **GET is a read; every other method is a write unless it is named in
 * {@link NON_GET_READ_VERDICTS}.** That table has three rows, all of them Google's own read verbs
 * expressed as POST, and each carries its reason. Inverting the burden this way is what makes the six
 * cases above impossible to get wrong by accident — a new write cannot become a read by declaring a
 * misleading scope, it can only become one by somebody adding a row.
 *
 * ## The voluminous rule, applied per operation rather than per family
 *
 * `docs/atlas-intent/06-holdings.md`: a family is highly voluminous when its records are **time-series
 * OBSERVATIONS** — emitted by the platform rather than created by a person, unbounded, growing with the
 * clock, and identified by an INSTANT rather than by a name somebody chose. Configuration is the
 * complement.
 *
 * That page also says the criterion "cuts THROUGH a family rather than along it", and this platform is
 * the sharpest example yet. `chrome-management-security-insights` holds seven operations: two enable and
 * disable the feature, one reports whether it is on — all configuration — and four are
 * `queryUrlVisits`/`queryContentTransfers` summaries over an unbounded browsing stream. A rule stated as
 * a list of KINDS cannot express that, so {@link OBSERVATIONAL_OPERATIONS} names those four individually
 * and the kind stays configuration.
 */
import type { GoogleAdminAtlasKind } from "./model.js";
import type { GoogleAdminDisposition, GoogleAdminExclusionReason } from "./surfaceRow.js";

/**
 * What the disposition rule decided for one operation, and why.
 * @internal
 */
export interface GoogleAdminDispositionVerdict {
  readonly disposition: GoogleAdminDisposition;
  /** Why this is not a plain `entity`. `null` only when it is one. */
  readonly dispositionBecause: string | null;
  /** Which refusal applied. `null` unless the disposition is `excluded`. */
  readonly exclusionReason: GoogleAdminExclusionReason | null;
}

/**
 * Every non-GET method that nonetheless only reads, with what it reads.
 *
 * Keyed on the vendor's own method `id`. All three are Google's own read verbs expressed as POST because
 * their request needs a body — a filter, a policy-schema selector, a search query — which is the shape
 * Google's API Improvement Proposals prescribe for a read that cannot fit in a query string.
 */
const NON_GET_READ_VERDICTS: Readonly<Record<string, string>> = {
  "chromepolicy.customers.policies.groups.listGroupPriorityOrdering":
    "it lists the priority ordering of a policy's groups; the POST carries the policy-schema selector",
  "chromepolicy.customers.policies.resolve":
    "it resolves the effective value of a policy schema; the POST carries the schema filter and the target",
  "vault.matters.count": "it counts the accounts and items a query would match, without exporting anything",
};

/**
 * Every kind whose records are time-series observations.
 *
 * A LIST of kinds rather than a predicate over paths, because the criterion is about what a record IS and
 * Google's own resource nouns already say it: an audit activity, a usage report, a telemetry event, a
 * Chrome fleet report, an alert. Asserted total against the registry by the generator, so a kind renamed
 * out from under this list fails the run instead of silently becoming an entity.
 *
 * `alertcenter-alerts-feedback` is deliberately NOT here, and the omission is the criterion doing its
 * job: feedback on an alert is written by a person and identified by an id they were given, so it is
 * configuration in the sense that matters — enumerable, and not growing with the clock on its own.
 */
const OBSERVATIONAL_KINDS: readonly GoogleAdminAtlasKind[] = [
  "alertcenter-alerts",
  "chrome-management-events",
  "chrome-management-reports",
  "reports-activities",
  "reports-customer-usage-reports",
  "reports-entity-usage-reports",
  "reports-user-usage-report",
];

/**
 * Individual operations that return observations inside a kind that is otherwise configuration.
 *
 * The four Chrome security-insight summaries. Their kind also holds `enable`, `disable` and
 * `checkEnablementStatus`, which are settings somebody changed — see this file's header for why that
 * makes a kind-level rule insufficient here.
 */
const OBSERVATIONAL_OPERATIONS: readonly string[] = [
  "chromemanagement.customers.enterprise.securityInsights.queryContentTransfers",
  "chromemanagement.customers.enterprise.securityInsights.queryContentTransfersBreakdowns",
  "chromemanagement.customers.enterprise.securityInsights.queryUrlVisits",
  "chromemanagement.customers.enterprise.securityInsights.queryUrlVisitsBreakdowns",
];

/** What to say about each exclusion reason, so a row explains itself without a reader opening this file. */
const EXCLUSION_PROSE: Readonly<Record<GoogleAdminExclusionReason, string>> = {
  egressing:
    "issuing it would upload this machine's own content to Google as the request body — Google marks it `supportsMediaUpload`, and an atlas cannot send data to map a platform",
  mutating: "it changes the Workspace account, and this atlas only ever reads",
  "side-effecting":
    "it registers a push-notification channel against a URL the caller supplies — an outward subscription Google then delivers to, rather than an observation of state that already exists",
};

/**
 * Why the observational disposition applied, in one sentence a row carries.
 * @internal
 */
export const GOOGLE_ADMIN_OBSERVATIONAL_PROSE =
  "its records are time-series observations Google emitted, unbounded and identified by an instant — the highly-voluminous disposition of docs/atlas-intent/06-holdings.md, so the family is reached over a bounded window and its shape stored, never a row per record";

/**
 * Decide what this atlas does with one operation.
 *
 * @param id the vendor's own method id, which both verdict tables are keyed on
 * @param kind the atlas kind the operation contributes to
 * @param method the document's own HTTP method
 * @param supportsMediaUpload whether Google marks it as accepting an upload, which is what makes it egressing
 * @returns the disposition and the reason it is not a plain entity
 */
export function googleAdminDispositionFor({
  id,
  kind,
  method,
  supportsMediaUpload,
}: {
  id: string;
  kind: string;
  method: string;
  supportsMediaUpload: boolean;
}): GoogleAdminDispositionVerdict {
  const readBecause = NON_GET_READ_VERDICTS[id];
  const isRead = method === "GET" || readBecause !== undefined;
  if (!isRead) {
    const reason = exclusionReasonFor({ id, supportsMediaUpload });
    return { disposition: "excluded", dispositionBecause: EXCLUSION_PROSE[reason], exclusionReason: reason };
  }
  const observational =
    OBSERVATIONAL_KINDS.some((candidate) => candidate === kind) ||
    OBSERVATIONAL_OPERATIONS.some((candidate) => candidate === id);
  if (observational) {
    return {
      disposition: "shape-index",
      dispositionBecause: GOOGLE_ADMIN_OBSERVATIONAL_PROSE,
      exclusionReason: null,
    };
  }
  if (readBecause === undefined) {
    // A plain GET read: no verdict row names it, because only a non-GET read needs a reason.
    return { disposition: "entity", dispositionBecause: null, exclusionReason: null };
  }
  return { disposition: "entity", dispositionBecause: readBecause, exclusionReason: null };
}

/**
 * Which refusal a write earns.
 *
 * @param id the vendor's own method id
 * @param supportsMediaUpload whether Google marks it as accepting an upload
 * @returns the reason this write is never called
 */
function exclusionReasonFor({
  id,
  supportsMediaUpload,
}: {
  id: string;
  supportsMediaUpload: boolean;
}): GoogleAdminExclusionReason {
  if (supportsMediaUpload) {
    return "egressing";
  }
  if (id.endsWith(".watch")) {
    return "side-effecting";
  }
  return "mutating";
}

/**
 * Every kind the observational rule names, for the generator to assert it left none of them behind.
 *
 * @returns the observational kind names
 */
export function googleAdminObservationalKinds(): readonly GoogleAdminAtlasKind[] {
  return OBSERVATIONAL_KINDS;
}

/**
 * Every operation the observational rule names individually.
 *
 * @returns the vendor method ids
 */
export function googleAdminObservationalOperations(): readonly string[] {
  return OBSERVATIONAL_OPERATIONS;
}

/**
 * Every non-GET method this atlas judged a read.
 *
 * @returns the vendor method ids
 */
export function googleAdminNonGetReads(): readonly string[] {
  return Object.keys(NON_GET_READ_VERDICTS).toSorted();
}
