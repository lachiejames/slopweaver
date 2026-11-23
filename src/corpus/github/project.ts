/**
 * Pure projection: raw GitHub items (+ their optional enriched activity) → `CorpusRecord[]`. No I/O, no
 * network — every network effect already happened in `fetch.ts`. One item fans out into: the PR/issue
 * **atom** (`#<n>`), one **review** record per review (`#<n>:review:<i>`), one **comment** record per
 * comment (`#<n>:comment:<i>`), and — when the timeline says so — one **state** record (`#<n>:state`)
 * carrying the latest lifecycle event. Child ids are index-stable across re-fetches (reviews/comments
 * are append-only), so dedup collapses re-ingested children onto the same lines.
 *
 * Redaction is NOT done here (the writer redacts before persisting); this stays a deterministic map so
 * the same input always yields the same records — a property dedup relies on.
 */

import { extractRefs } from "../refs.js";
import type { CorpusAttributeValue, CorpusKind, CorpusRecord } from "../types.js";
import type { ActivityComment, ActivityReview, GithubActivity } from "./activity.js";

type GithubItemKind = "pr" | "issue";

/** A fetched GitHub item, before projection. `activity` is present iff enrichment ran for it. */
export interface GithubExportItem {
  readonly number: number;
  readonly kind: GithubItemKind;
  readonly title: string;
  readonly url: string;
  readonly tsIso: string;
  readonly author?: string;
  readonly body?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
  readonly activity?: GithubActivity;
}

/** A one-line status gate summary prepended to a PR's text, from the enriched activity. */
function gateSummary({ activity }: { activity: GithubActivity }): string {
  const parts: string[] = [];
  if (activity.reviewDecision !== undefined) {
    parts.push(`Review: ${activity.reviewDecision}`);
  }
  if (activity.mergeable !== undefined) {
    parts.push(`Mergeable: ${activity.mergeable}`);
  }
  if (activity.checks !== undefined) {
    parts.push(`Checks: ${activity.checks}`);
  }
  if (activity.isDraft === true) {
    parts.push("Draft");
  }
  return parts.join(" · ");
}

/**
 * Rich structured metadata for a PR/issue atom — stored in bronze, kept OUT of the embedded text.
 *
 * **`truncated` names the saturated connections and deliberately does NOT set the corpus-wide
 * `CAPTURE_ATTR` marker beside it, which is the obvious thing to reach for.** MEASURED while trying it:
 * `latestRecords.supersedes` gives a same-instant, same-`text` tie to the row that does NOT declare itself
 * partial, and every pre-refetch GitHub atom is unmarked — not because it was complete, but because this
 * connector had never written the marker. So marking the refetched row made the THINNER predecessor win on
 * exactly the giant pull requests the widening was for: the enriched atom carrying `headRef`, `baseRef`,
 * `mergedBy` and the diff size lost to the four-field one, and declaring the truncation was what cost it.
 * Tightening that shared rule was tried and reverted: the pair it was written for (Notion, 14,613 groups)
 * differs in more than the marker — its repaired row updates `chunkCount` too — so "byte-identical apart
 * from the marker" is not the discriminator either. The marker belongs with the PAGING fix that gives
 * GitHub a genuine repaired row to prefer, and that is its own row; until then `truncated` is the witness
 * and it is inert to `supersedes`.
 */
function atomAttrs({ activity }: { activity: GithubActivity | undefined }): Record<string, CorpusAttributeValue> {
  const attrs: Record<string, CorpusAttributeValue> = {};
  if (activity === undefined) {
    return attrs;
  }
  if (activity.state.length > 0) {
    attrs["state"] = activity.state;
  }
  if (activity.reviewDecision !== undefined) {
    attrs["reviewDecision"] = activity.reviewDecision;
  }
  if (activity.mergeable !== undefined) {
    attrs["mergeable"] = activity.mergeable;
  }
  if (activity.checks !== undefined) {
    attrs["checks"] = activity.checks;
  }
  if (activity.isDraft !== undefined) {
    attrs["draft"] = activity.isDraft;
  }
  if (activity.truncated.length > 0) {
    attrs["truncated"] = activity.truncated;
  }
  return { ...attrs, ...branchAttrs({ activity }) };
}

/**
 * The PR's branch, merge and diff-size attrs. Promoted rather than left in `raw` because these are what a
 * question filters or joins on — which branch this came from, who merged it, how big it was — and a column
 * answers that where a substring over the body cannot.
 */
function branchAttrs({ activity }: { activity: GithubActivity }): Record<string, CorpusAttributeValue> {
  const attrs: Record<string, CorpusAttributeValue> = {};
  const scalars: readonly (readonly [string, CorpusAttributeValue | undefined])[] = [
    ["headRef", activity.headRefName],
    ["headSha", activity.headRefOid],
    ["baseRef", activity.baseRefName],
    ["baseSha", activity.baseRefOid],
    ["headRepo", activity.headRepository],
    ["mergedBy", activity.mergedBy],
    ["mergedAt", activity.mergedAtIso],
    ["mergeCommit", activity.mergeCommitOid],
    ["additions", activity.additions],
    ["deletions", activity.deletions],
    ["changedFiles", activity.changedFiles],
  ];
  for (const [key, value] of scalars) {
    if (value !== undefined) {
      attrs[key] = value;
    }
  }
  return attrs;
}

/**
 * The atom's `raw`. The REST **search** hit is the verbatim payload the atom was projected from, and stays
 * exactly that; the GraphQL item node's own fields go BESIDE it under `activity` rather than merged into
 * it, because the two describe the same object in different vocabularies — REST's `state` is `"open"`
 * where GraphQL's is `"OPEN"` — and a merge would silently pick a winner. Nested, both are readable and
 * neither is a lie.
 */
function atomRaw({ item }: { item: GithubExportItem }): Readonly<Record<string, unknown>> | undefined {
  const activityRaw = item.activity?.raw;
  if (item.raw === undefined) {
    return activityRaw !== undefined ? { activity: activityRaw } : undefined;
  }
  return activityRaw !== undefined ? { ...item.raw, activity: activityRaw } : item.raw;
}

/** The PR/issue atom. State-prefixed title + (for PRs) a gate summary ahead of the body. */
function toAtom({ item, container }: { item: GithubExportItem; container: string }): CorpusRecord {
  const { activity } = item;
  const summary = activity !== undefined ? gateSummary({ activity }) : "";
  const text = [summary, item.body].filter((part) => part !== undefined && part.length > 0).join("\n\n");
  const state = activity?.state;
  const title = state !== undefined && state.length > 0 ? `[${state}] ${item.title}` : item.title;
  const attrs = atomAttrs({ activity });
  const raw = atomRaw({ item });
  return {
    container,
    kind: item.kind,
    source: "github",
    sourceId: `#${String(item.number)}`,
    tsIso:
      activity?.updatedAtIso !== undefined && activity.updatedAtIso.length > 0 ? activity.updatedAtIso : item.tsIso,
    url: item.url,
    ...(item.author !== undefined ? { author: item.author } : {}),
    refs: extractRefs({
      text: [item.title, item.body].filter((part) => part !== undefined && part.length > 0).join("\n"),
    }),
    text: text.length > 0 ? text : item.title,
    title,
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(raw !== undefined ? { raw } : {}),
  };
}

/** A review's promoted metadata: its verdict, and the commit that verdict was given on. */
function reviewAttrs({ review }: { review: ActivityReview }): Record<string, CorpusAttributeValue> {
  const attrs: Record<string, CorpusAttributeValue> = {};
  if (review.state.length > 0) {
    attrs["state"] = review.state;
  }
  if (review.commitOid !== undefined) {
    attrs["commit"] = review.commitOid;
  }
  return attrs;
}

/**
 * A comment's promoted metadata. `file` and `line` are the whole point of the wider selection set: without
 * them a review comment reading "this will break under load" cannot say what "this" was. `outdated` is
 * what tells a reader whether `line` is the live line or the one the comment was originally written on.
 */
function commentAttrs({ comment }: { comment: ActivityComment }): Record<string, CorpusAttributeValue> {
  const attrs: Record<string, CorpusAttributeValue> = {};
  if (comment.path !== undefined) {
    attrs["file"] = comment.path;
  }
  if (comment.line !== undefined) {
    attrs["line"] = comment.line;
  }
  if (comment.outdated !== undefined) {
    attrs["outdated"] = comment.outdated;
  }
  if (comment.resolved !== undefined) {
    attrs["resolved"] = comment.resolved;
  }
  if (comment.commitOid !== undefined) {
    attrs["commit"] = comment.commitOid;
  }
  return attrs;
}

function reviewRecords({ item, container }: { item: GithubExportItem; container: string }): CorpusRecord[] {
  // An item crawled without enrichment carries no activity, so it has no reviews to project.
  if (item.activity === undefined) {
    return [];
  }
  return item.activity.reviews.map((review, index): CorpusRecord => {
    const text = review.body.trim().length > 0 ? review.body : `Review ${review.state}`;
    const attrs = reviewAttrs({ review });
    return {
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      container,
      kind: "review",
      source: "github",
      sourceId: `#${String(item.number)}:review:${String(index)}`,
      tsIso: review.tsIso.length > 0 ? review.tsIso : item.tsIso,
      url: review.url.length > 0 ? review.url : item.url,
      ...(review.author !== undefined ? { author: review.author } : {}),
      refs: extractRefs({ text: review.body }),
      text,
      ...(review.raw !== undefined ? { raw: review.raw } : {}),
    };
  });
}

function commentRecords({ item, container }: { item: GithubExportItem; container: string }): CorpusRecord[] {
  // An item crawled without enrichment carries no activity, so it has no comments to project.
  if (item.activity === undefined) {
    return [];
  }
  const records: CorpusRecord[] = [];
  item.activity.comments.forEach((comment, index) => {
    if (comment.body.trim().length === 0) {
      return; // an empty comment carries nothing
    }
    const text = comment.resolved === true ? `[resolved] ${comment.body}` : comment.body;
    const attrs = commentAttrs({ comment });
    records.push({
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      container,
      kind: "comment",
      source: "github",
      sourceId: `#${String(item.number)}:comment:${String(index)}`,
      tsIso: comment.tsIso.length > 0 ? comment.tsIso : item.tsIso,
      url: comment.url.length > 0 ? comment.url : item.url,
      ...(comment.author !== undefined ? { author: comment.author } : {}),
      refs: extractRefs({ text: comment.body }),
      text,
      ...(comment.raw !== undefined ? { raw: comment.raw } : {}),
    });
  });
  return records;
}

/** One `#<n>:state` record from the most-recent timeline event, when there is one. */
function stateRecord({ item, container }: { item: GithubExportItem; container: string }): CorpusRecord | undefined {
  // An unenriched item has no timeline, and an enriched one may have none yet: either way, no state record.
  const activity = item.activity;
  if (activity === undefined || activity.timeline.length === 0) {
    return undefined;
  }
  const latest = activity.timeline.reduce((a, b) => (b.tsIso > a.tsIso ? b : a));
  const kind: CorpusKind = item.kind;
  const actor = latest.actor !== undefined ? ` by ${latest.actor}` : "";
  return {
    container,
    kind,
    refs: [],
    source: "github",
    sourceId: `#${String(item.number)}:state`,
    text: `${latest.type}${actor} · state: ${activity.state}`,
    tsIso: latest.tsIso.length > 0 ? latest.tsIso : item.tsIso,
    url: item.url,
    ...(latest.raw !== undefined ? { raw: latest.raw } : {}),
  };
}

/**
 * Project every item into its atom + review/comment/state records.
 *
 * @param items the fetched items
 * @param repo the `owner/repo` container string
 * @returns the flattened corpus records
 */
export function projectGithubRecords({
  items,
  repo,
}: {
  items: readonly GithubExportItem[];
  repo: string;
}): readonly CorpusRecord[] {
  const records: CorpusRecord[] = [];
  for (const item of items) {
    records.push(toAtom({ container: repo, item }));
    records.push(...reviewRecords({ container: repo, item }));
    records.push(...commentRecords({ container: repo, item }));
    const state = stateRecord({ container: repo, item });
    if (state !== undefined) {
      records.push(state);
    }
  }
  return records;
}
