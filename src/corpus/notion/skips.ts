/**
 * Why a Notion node could not be read — the typed skip channel, and the classifier that fills it.
 *
 * This module exists because of a measured defect. A Notion integration cannot see a page until that page
 * is shared with it, and a page REACHABLE from a shared page is not necessarily shared itself: a
 * `child_page` block can point into a teamspace the integration was never connected to. Measured against
 * the real workspace, 50 of 98 `child_page` blocks were invisible to `search` and reachable
 * only by that recursion — so the recursion is load-bearing, and an unreadable target inside it is NORMAL
 * and PERMANENT rather than exceptional.
 *
 * The shipped behaviour was the opposite. `blocks.children.list` was safe-wrapped, then immediately
 * `orThrow`n, so the typed failure became a throw that escaped every frame up to `fetchNotionActivity`'s
 * catch-all and returned `err`. One unreadable nested block therefore killed the whole run: exit 1, zero
 * records persisted, no watermark. The fix is not a wider try/catch — it is a REASON, carried.
 *
 * ## Why the reason has to be typed rather than a warning string
 *
 * An auth failure, a rate limit and an unshared page are three different facts with three different
 * correct responses, and a `readonly string[]` of warnings cannot express the difference:
 *
 *  - **`unshared` / `restricted`** — permanent by POLICY. The owner has deliberately not shared that page
 *    and may never do so. This must NOT withhold the watermark: a cursor held back for a permanently
 *    unreadable page wedges the lane forever, and a gate that can never go green is worth no more than one
 *    that always is (see {@link ../ingestJob.CoverageGap}).
 *  - **`rate-limit` / `network`** — transient, and already retried by the provider door before reaching
 *    here. Surviving that budget means the window was genuinely not covered, so these DO withhold the
 *    cursor and the next refresh re-scans.
 *  - **`depth-cap`** — our own bound, not Notion's. A body truncated by the block-depth cap used to return
 *    empty text silently, which is the quiet-degradation this repo refuses; it is now a named skip.
 *  - **`item-deadline` / `item-time-cap`** — our own per-item bounds, kept APART because they answer
 *    different questions about a lifted re-pull: the first says an item did a pathological amount of work,
 *    the second says it took a pathological amount of time, and only the first gets cheaper when the request
 *    budget is raised. See `caps.ts`.
 *  - **`auth`** — token-level, and therefore never a per-page condition. It is reported as fatal, because
 *    continuing would report a near-empty corpus as a successful one.
 *
 * Pure module — no I/O. The classifier reads an already-typed {@link IngestError}, so nothing has to
 * re-parse a thrown value.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";

/**
 * Why one Notion node could not be read.
 *
 * `unshared` and `restricted` are kept apart on purpose even though both are permanent: `object_not_found`
 * means the integration cannot see the object AT ALL (the ordinary teamspace case), while
 * `restricted_resource` means it can see it and was refused — which is a sharing setting the owner can
 * actually act on. Collapsing them would hide the actionable one inside the expected one.
 */
export type NotionSkipReason =
  | "unshared"
  | "restricted"
  | "auth"
  | "rate-limit"
  | "network"
  | "depth-cap"
  | "result-limit"
  | "item-deadline"
  | "item-time-cap"
  | "unknown";

/** One unreadable (or truncated) Notion node, with the reason it could not be read. */
export interface NotionSkip {
  readonly reason: NotionSkipReason;
  /** The boundary operation, e.g. `notion.blocks.children.list`. */
  readonly operation: string;
  /**
   * What was being read, as a NON-IDENTIFYING label — a block/page kind, never a title, id or url. This is
   * a public repo and a skip line is the kind of output that gets pasted into a PR.
   */
  readonly subject: string;
}

/** The reasons that mean "transient — the window was NOT covered", so the watermark must be held back. */
const RETRYABLE_REASONS: ReadonlySet<NotionSkipReason> = new Set<NotionSkipReason>(["rate-limit", "network"]);

/** Notion API error codes that mean the integration simply cannot see the object. */
const UNSHARED_CODES: ReadonlySet<string> = new Set(["object_not_found", "notionhq_client_invalid_path_parameter"]);

/**
 * The order reasons are REPORTED in — most actionable first, expected-and-permanent last.
 *
 * Explicit rather than taken from the wording map's key order, which is alphabetical and therefore put
 * `auth` at the top and `unshared` at the bottom by coincidence. That is backwards: `unshared` is the
 * ordinary state of a Notion workspace and will usually be the largest count, so leading with it buries the
 * two lines the owner can actually do something about. A declared order is also what makes two runs
 * diffable — an alphabetical accident holds only until a reason is renamed.
 */
const REASON_ORDER: readonly NotionSkipReason[] = [
  "auth",
  "rate-limit",
  "network",
  "result-limit",
  "item-deadline",
  "item-time-cap",
  "restricted",
  "unknown",
  "depth-cap",
  "unshared",
];

/** Human wording per reason, for the summary line. Kept beside the type so a new reason cannot go unworded. */
const REASON_WORDING: Readonly<Record<NotionSkipReason, string>> = {
  auth: "the token was rejected",
  "depth-cap": "nested deeper than the block-depth cap, so the body is TRUNCATED",
  "item-deadline": "exceeded its own per-item request budget — body/comments TRUNCATED at the cutoff, not read in full",
  "item-time-cap":
    "exceeded its own per-item TIME budget — the bound that still ends an item whose request budget was lifted",
  network: "a network failure outlasted the retry budget",
  "rate-limit": "rate-limited past the retry budget",
  restricted: "shared but access-restricted — a sharing setting you can change",
  "result-limit":
    "Notion reported its own result set INCOMPLETE (query_result_limit_reached) — this window is not fully covered",
  unknown: "an unclassified failure",
  unshared: "not shared with the integration",
};

/**
 * Classify a typed boundary failure into the reason a Notion node was skipped. Pure.
 *
 * Order matters: the CODE is consulted before the status, because Notion's `restricted_resource` and a
 * plain `unauthorized` are both 4xx and only the code separates "share this page" from "your token is
 * wrong". A `rate-limit` kind is trusted directly — it has already been through
 * {@link ../../lib/ingestError.toIngestError}, which knows the SDK codes that carry no HTTP status.
 *
 * @param error the typed boundary failure
 * @returns the skip reason; an unrecognised failure classifies as `unknown` rather than being assumed benign
 */
export function classifyNotionSkip({ error }: { error: IngestError }): NotionSkipReason {
  if (error.kind === "rate-limit") {
    return "rate-limit";
  }
  if (error.kind === "network") {
    return "network";
  }
  const code = error.code;
  if (code !== undefined && UNSHARED_CODES.has(code)) {
    return "unshared";
  }
  if (code === "restricted_resource") {
    return "restricted";
  }
  if (code === "unauthorized" || error.status === 401) {
    return "auth";
  }
  if (error.status === 404) {
    return "unshared";
  }
  if (error.status === 403) {
    return "restricted";
  }
  return "unknown";
}

/**
 * Whether a skip means the window was not covered, so the source's watermark must be held back. Pure.
 *
 * `result-limit` deliberately does NOT hold the cursor even though it is a genuine coverage gap. Notion
 * returns the same truncated result set for the same query however many times it is asked, so re-scanning
 * cannot clear it — holding the cursor would wedge the lane permanently instead of fixing anything. For a
 * truncated data-source query the remedy is to narrow it (a tighter `--since`, which that query carries as
 * `sorts` + a timestamp filter — `liveApiDatabases.ts`); a truncated database SEARCH takes no cutoff, so
 * `--since` cannot narrow it and it stays reported; an attachment over its byte ceiling
 * (`attachmentFetch.ts`'s `too-large`) is reported under this reason too, and no narrower query shrinks it.
 * Either way the reason is reported loudly and left to the owner rather than converted into a false gate.
 *
 * @param reason the skip reason
 * @returns true only for a TRANSIENT reason — a permanently unreadable node must never wedge the cursor
 */
export function skipWithholdsCursor({ reason }: { reason: NotionSkipReason }): boolean {
  return RETRYABLE_REASONS.has(reason);
}

/**
 * Whether a skip is token-level and therefore fatal rather than per-page. Pure.
 *
 * @param reason the skip reason
 * @returns true for `auth` only — every other reason is a property of one node, not of the run
 */
export function skipIsFatal({ reason }: { reason: NotionSkipReason }): boolean {
  return reason === "auth";
}

/**
 * Count skips per reason, in the fixed reason order so two runs are diffable. Pure.
 *
 * @param skips the collected skips
 * @returns one entry per reason that actually occurred, with its count
 */
export function countSkipsByReason({
  skips,
}: {
  skips: readonly NotionSkip[];
}): readonly { reason: NotionSkipReason; count: number }[] {
  const counts = new Map<NotionSkipReason, number>();
  for (const skip of skips) {
    counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  }
  // The filter keeps only reasons the tally above holds, so each `get` below reads a present count.
  return REASON_ORDER.filter((reason) => counts.has(reason)).map((reason) => ({
    count: counts.get(reason)!,
    reason,
  }));
}

/**
 * The human summary of what could not be read — ALWAYS at least one line, including for zero skips. Pure.
 *
 * A reported zero has to be a real zero, so the no-skip case gets an explicit line rather than silence:
 * an absent line is indistinguishable from a lane that never checked, which is the defect class this repo
 * cares most about.
 *
 * @param skips the collected skips
 * @returns the summary lines — a single "read everything" line when empty, else a total plus a per-reason
 *   breakdown naming what each reason means
 */
export function summariseNotionSkips({ skips }: { skips: readonly NotionSkip[] }): readonly string[] {
  if (skips.length === 0) {
    return ["unreadable: 0 page(s) — every node reached was readable in full"];
  }
  const byReason = countSkipsByReason({ skips });
  return [
    `unreadable: ${String(skips.length)} node(s) skipped across ${String(byReason.length)} reason(s)`,
    ...byReason.map(({ reason, count }) => `  ${reason}: ${String(count)} — ${REASON_WORDING[reason]}`),
  ];
}

/**
 * The coverage gaps a skip list implies — one per TRANSIENT reason, collapsed to a count. Pure.
 *
 * Collapsed rather than one gap per node because a gap's only job is to withhold the cursor, and a
 * thousand identical gap strings would bury the summary they are meant to explain.
 *
 * @param skips the collected skips
 * @returns one gap string per transient reason present (empty when nothing transient happened)
 */
export function notionCoverageGaps({ skips }: { skips: readonly NotionSkip[] }): readonly string[] {
  return countSkipsByReason({ skips })
    .filter(({ reason }) => skipWithholdsCursor({ reason }))
    .map(
      ({ reason, count }) =>
        `notion: ${String(count)} node(s) unread (${reason}) — cursor held back so the next refresh re-scans`,
    );
}

/**
 * The skip Notion's own `request_status` implies, or undefined when it reported a complete result. Pure.
 *
 * `search` and `dataSources.query` both return `request_status: { type: "complete" | "incomplete" }`, and
 * the connector discarded it. That is the worst possible thing to drop for this use case: it is Notion
 * stating outright that the result set was cut short, on a run that then reported success. A query returning
 * fewer results than exist is exactly the blindness that shows up later as fewer citations and no reason.
 *
 * @param requestStatus the raw `request_status` field, of unvalidated shape
 * @param operation the boundary operation the status came from, recorded on the skip
 * @returns the `result-limit` skip when Notion said the result was incomplete, else undefined
 */
export function requestStatusSkip({
  requestStatus,
  operation,
}: {
  requestStatus: unknown;
  operation: string;
}): NotionSkip | undefined {
  if (!isRecord(requestStatus) || requestStatus["type"] !== "incomplete") {
    return undefined;
  }
  const why = requestStatus["incomplete_reason"];
  return {
    operation,
    reason: "result-limit",
    subject: typeof why === "string" && why.length > 0 ? why : "incomplete result",
  };
}

/**
 * The two reasons a re-fetch could never improve on: the integration cannot SEE the node, so a later crawl
 * gets exactly the same nothing. Everything else is either transient or a bound of ours.
 *
 * `restricted` carries the second half of the argument. An integration without the read-comments
 * capability fails EVERY page that way, so counting it as truncation would mark an entire workspace's
 * captures incomplete and turn the unchanged-skip off permanently for everyone in that configuration —
 * a large, silent cost bought with no possibility of a better capture.
 */
const UNIMPROVABLE_REASONS: ReadonlySet<NotionSkipReason> = new Set<NotionSkipReason>(["unshared", "restricted"]);

/**
 * Whether this item's capture is INCOMPLETE in a way a later re-fetch could still fix. Pure.
 *
 * This is the question `seenIndex.ts` needs, and it is deliberately not "was anything skipped": the marker
 * exists to stop a truncated capture from authorising the skip that would repair it, so the test is
 * whether repair is possible at all. Every reason qualifies except the two in {@link UNIMPROVABLE_REASONS}
 * — a depth cap or either per-item budget is a bound of ours, and a network, rate-limit or unclassified
 * failure is transient, so in all of those a later crawl can genuinely return more.
 *
 * Drawn narrower than this once, to exclude comment-paging failures wholesale, and an adversarial review
 * pass produced the counterexample: a `comments.list` page that failed on the network left a truncated,
 * UNMARKED capture that the index then skipped forever. Reasons are enumerated here rather than operations
 * for that reason — an operation list silently omits whatever it did not think of.
 *
 * @param skips the skips collected for ONE page or row
 * @returns true when the item's capture is incomplete and a later crawl could improve it
 */
export function captureWasTruncated({ skips }: { skips: readonly NotionSkip[] }): boolean {
  return skips.some((skip) => !UNIMPROVABLE_REASONS.has(skip.reason));
}

/** The boundary operations that ENUMERATE the workspace, as opposed to reading one already-found node. */
const ENUMERATION_OPERATIONS: ReadonlySet<string> = new Set([
  "notion.search.pages",
  "notion.search.databases",
  "notion.dataSources.query",
]);

/**
 * Whether this crawl failed to ENUMERATE part of the workspace, as opposed to failing to read one node in
 * full. Pure.
 *
 * The two are different claims and only one of them is recoverable per-item. A page that was found and
 * then truncated carries its own `capture: "partial"` marker, so `seenIndex.ts` already refuses to trust
 * it. A data source whose `query` failed, or a `search` page that never came back, produced no items to
 * mark at all — the rows under it are simply absent, and the pages lane's own shadow of such a row gets
 * written looking perfectly complete. A crawl in that state must not record capture coverage, because
 * coverage is precisely the claim that everything from `since` onward WAS re-captured.
 *
 * The unimprovable reasons are excluded for the same reason they are in {@link captureWasTruncated}: a
 * data source this integration may never query would otherwise block coverage from ever being recorded.
 *
 * @param skips every skip the crawl collected
 * @returns true when some part of the workspace was never enumerated, and coverage must not advance
 */
export function enumerationWasIncomplete({ skips }: { skips: readonly NotionSkip[] }): boolean {
  return skips.some((skip) => ENUMERATION_OPERATIONS.has(skip.operation) && !UNIMPROVABLE_REASONS.has(skip.reason));
}
