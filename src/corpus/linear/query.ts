/**
 * The LOCAL leg of a Linear query — a typed, facet-by-facet filter over the Linear records already in
 * bronze, with no network at all.
 *
 * ## Why this exists rather than another free-text search
 *
 * `slopweaver linear search` asks Linear's own search API for a TERM. That answers "what mentions X" and
 * cannot answer "what is assigned to me and still open", because assignment and state are not words in a
 * document — they are FACETS, and the corpus already holds every one of them. Measured on the owner's own
 * bronze: `attrs` on a Linear `issue` carries `assignee`, `state`, `stateType`, `team`,
 * `project`, `cycle`, `cycleNumber`, `labels`, `priority`, `priorityLabel` and `number`, and a full
 * line-by-line scan of the 661 MB Linear bronze takes 2.2 s at 199 MB RSS. So the facet query is both
 * expressible and cheap; it simply had no verb.
 *
 * ## Every predicate is EXACT, and an unknown facet value is a refusal rather than an empty result
 *
 * A near-miss that returns nothing is indistinguishable from a correct query with no matches, and the two
 * want opposite reactions from the reader. So the closed-set facets (`kind`, `stateType`, `priority`) are
 * validated against their own union at parse time — {@link ../../cli/commands/linear/queryCore} turns a bad
 * one into an {@link ./queryErrors.UnknownFilterValueError} that NAMES the accepted values — and the
 * open-set ones (`assignee`, `state`, `team`, `project`, `label`) match case-insensitively but WHOLE, never
 * as a substring. `--text` is the one deliberate substring facet, because prose is what it searches.
 *
 * Pure: every function here takes records and a filter and returns records. The scan that produces the
 * records is {@link ./queryScan}, and the live verification of what it produced is
 * {@link ../../live/linear/verify}.
 */
import { latestRecords, recordIdentity } from "../latestRecords.js";
import type { CorpusAttributeValue, CorpusKind, CorpusRecord } from "../types.js";

/** The Linear object kinds this query ranges over — the two a citation is ever made to. */
export const LINEAR_QUERY_KINDS = ["issue", "project"] as const;

/** One member of {@link LINEAR_QUERY_KINDS}. */
export type LinearQueryKind = (typeof LINEAR_QUERY_KINDS)[number];

/** Linear's own workflow-state types, as `attrs.stateType` records them on an issue. */
export const LINEAR_STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"] as const;

/** One member of {@link LINEAR_STATE_TYPES}. */
export type LinearStateType = (typeof LINEAR_STATE_TYPES)[number];

/** Linear's priority scale, as `attrs.priority` records it: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export const LINEAR_PRIORITIES = [0, 1, 2, 3, 4] as const;

/**
 * One resolved, fully-typed query. Every field is a facet the corpus already holds; an absent field means
 * that facet is not constrained. `labels` is AND — a record must carry every one.
 */
export interface LinearQueryFilter {
  readonly kind: LinearQueryKind;
  readonly assignee?: string;
  readonly state?: string;
  readonly stateType?: LinearStateType;
  readonly team?: string;
  readonly project?: string;
  readonly cycle?: number;
  readonly labels?: readonly string[];
  readonly priority?: number;
  readonly updatedSinceIso?: string;
  readonly text?: string;
}

/** Case-folded, whitespace-trimmed comparison key for an open-set facet. Pure. */
function fold({ value }: { value: string }): string {
  return value.trim().toLowerCase();
}

/** One attr read back as a string, or undefined when absent or not a string. Pure. */
function attrString({
  attrs,
  key,
}: {
  attrs: Readonly<Record<string, CorpusAttributeValue>>;
  key: string;
}): string | undefined {
  const value = attrs[key];
  return typeof value === "string" ? value : undefined;
}

/** One attr read back as a finite number, or undefined. Pure. */
function attrNumber({
  attrs,
  key,
}: {
  attrs: Readonly<Record<string, CorpusAttributeValue>>;
  key: string;
}): number | undefined {
  const value = attrs[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** One attr read back as a string list — a lone string counts as a one-member list. Pure. */
function attrList({
  attrs,
  key,
}: {
  attrs: Readonly<Record<string, CorpusAttributeValue>>;
  key: string;
}): readonly string[] {
  const value = attrs[key];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return typeof value === "string" ? [value] : [];
}

/**
 * Whether an open-set facet matches: the record's value, folded, equals the wanted value, folded.
 *
 * Whole-value rather than substring on purpose — `--team IN` must not answer with every `INS` ticket, and a
 * reader who wanted the looser reading has `--text`. Pure.
 */
function facetEquals({ actual, wanted }: { actual: string | undefined; wanted: string | undefined }): boolean {
  return wanted === undefined || (actual !== undefined && fold({ value: actual }) === fold({ value: wanted }));
}

/** Whether an open-set LIST facet contains the wanted value, whole and case-folded. Pure. */
function facetListContains({ actual, wanted }: { actual: readonly string[]; wanted: string }): boolean {
  const key = fold({ value: wanted });
  return actual.some((entry) => fold({ value: entry }) === key);
}

/** The kind a Linear record must carry to answer one {@link LinearQueryKind}. Pure. */
function corpusKindFor({ kind }: { kind: LinearQueryKind }): CorpusKind {
  return kind;
}

/**
 * The `assignee`-equivalent facet for each kind: an issue is ASSIGNED to one person, a project is LED by
 * one. Both answer "what is on my plate", which is the question, so one flag reads both. Pure.
 */
function ownerAttrKey({ kind }: { kind: LinearQueryKind }): string {
  return kind === "issue" ? "assignee" : "lead";
}

/**
 * The `team` facet for each kind: an issue carries one team key, a project carries a list of them. Pure.
 */
function teamMatches({
  attrs,
  kind,
  wanted,
}: {
  attrs: Readonly<Record<string, CorpusAttributeValue>>;
  kind: LinearQueryKind;
  wanted: string | undefined;
}): boolean {
  if (wanted === undefined) {
    return true;
  }
  if (kind === "issue") {
    return facetEquals({ actual: attrString({ attrs, key: "team" }), wanted });
  }
  return facetListContains({ actual: attrList({ attrs, key: "teams" }), wanted });
}

/**
 * The project's Linear id for each kind: an issue's `projectId` attr, a project's own id off its sourceId. Pure.
 *
 * An issue captured before the id was stored carries none, and is then reachable by name alone.
 */
function projectIdOf({ record, kind }: { record: CorpusRecord; kind: LinearQueryKind }): string | undefined {
  if (kind !== "issue") {
    return identifierOf({ kind, record });
  }
  if (record.attrs === undefined) {
    return undefined;
  }
  return attrString({ attrs: record.attrs, key: "projectId" });
}

/**
 * The `project` facet for each kind: an issue names its project, a project IS one — so for a project the
 * flag matches the record's own title, which is where the name lives.
 *
 * The wanted value matches EITHER the project's id, exactly, or its name, whole and case-folded. The id is the
 * one that cannot be wrong: a title is shared by more than one project and changes on a rename, so a reader
 * who needs one specific project passes its id. The two cannot collide — an id is a UUID and no title is. Pure.
 */
function projectMatches({
  record,
  kind,
  wanted,
}: {
  record: CorpusRecord;
  kind: LinearQueryKind;
  wanted: string | undefined;
}): boolean {
  if (wanted === undefined) {
    return true;
  }
  if (projectIdOf({ kind, record }) === wanted.trim()) {
    return true;
  }
  if (kind === "issue") {
    return facetEquals({ actual: attrString({ attrs: record.attrs ?? {}, key: "project" }), wanted });
  }
  return facetEquals({ actual: record.title, wanted });
}

/** The person facets — who it is assigned to (an issue) or led by (a project), and its workflow state. Pure. */
function matchesOwnerAndState({
  attrs,
  filter,
}: {
  attrs: Readonly<Record<string, CorpusAttributeValue>>;
  filter: LinearQueryFilter;
}): boolean {
  if (
    !facetEquals({ actual: attrString({ attrs, key: ownerAttrKey({ kind: filter.kind }) }), wanted: filter.assignee })
  ) {
    return false;
  }
  if (!facetEquals({ actual: attrString({ attrs, key: "state" }), wanted: filter.state })) {
    return false;
  }
  return filter.stateType === undefined || attrString({ attrs, key: "stateType" }) === filter.stateType;
}

/** The numeric facets and the label set, all of which are AND. Pure. */
function matchesScalarFacets({
  attrs,
  filter,
}: {
  attrs: Readonly<Record<string, CorpusAttributeValue>>;
  filter: LinearQueryFilter;
}): boolean {
  if (filter.cycle !== undefined && attrNumber({ attrs, key: "cycleNumber" }) !== filter.cycle) {
    return false;
  }
  if (filter.priority !== undefined && attrNumber({ attrs, key: "priority" }) !== filter.priority) {
    return false;
  }
  const labels = attrList({ attrs, key: "labels" });
  const wantedLabels = filter.labels;
  // An absent facet is one the filter does not constrain (see {@link LinearQueryFilter}).
  if (wantedLabels === undefined) {
    return true;
  }
  return wantedLabels.every((wanted) => facetListContains({ actual: labels, wanted }));
}

/** The recency window and the one substring facet. Pure. */
function matchesWindowAndText({ record, filter }: { record: CorpusRecord; filter: LinearQueryFilter }): boolean {
  if (filter.updatedSinceIso !== undefined && record.tsIso < filter.updatedSinceIso) {
    return false;
  }
  if (filter.text === undefined) {
    return true;
  }
  const title = record.title === undefined ? "" : `${record.title}\n`;
  return fold({ value: `${title}${record.text}` }).includes(fold({ value: filter.text }));
}

/**
 * Whether one record satisfies every constrained facet of a filter.
 *
 * @param record the corpus record under test
 * @param filter the resolved query
 * @returns true when the record is a Linear record of the wanted kind and every constrained facet matches
 */
export function matchesLinearQuery({ record, filter }: { record: CorpusRecord; filter: LinearQueryFilter }): boolean {
  if (record.source !== "linear" || record.kind !== corpusKindFor({ kind: filter.kind })) {
    return false;
  }
  const attrs = record.attrs ?? {};
  return (
    matchesOwnerAndState({ attrs, filter }) &&
    teamMatches({ attrs, kind: filter.kind, wanted: filter.team }) &&
    projectMatches({ kind: filter.kind, record, wanted: filter.project }) &&
    matchesScalarFacets({ attrs, filter }) &&
    matchesWindowAndText({ filter, record })
  );
}

/** One local hit, flattened to exactly the facets a reader and the live verifier both need. */
export interface LinearQueryHit {
  readonly kind: LinearQueryKind;
  /** `ABC-123` for an issue; the project's UUID for a project. */
  readonly identifier: string;
  readonly title: string;
  readonly url: string;
  readonly tsIso: string;
  readonly assignee: string | undefined;
  readonly state: string | undefined;
  readonly stateType: string | undefined;
  readonly team: string | undefined;
  readonly project: string | undefined;
  /** The project's Linear id — absent on an issue captured before the id was stored. */
  readonly projectId: string | undefined;
  readonly cycleNumber: number | undefined;
  readonly labels: readonly string[];
  readonly priority: number | undefined;
}

/** The `project:`/`initiative:` style prefix a non-issue Linear sourceId carries. */
const SOURCE_ID_PREFIX = /^[a-z]+:/u;

/**
 * The identifier a citation is made to: an issue's `ABC-123` sourceId verbatim, a project's UUID with its
 * `project:` prefix stripped. Pure.
 */
function identifierOf({ record, kind }: { record: CorpusRecord; kind: LinearQueryKind }): string {
  return kind === "issue" ? record.sourceId : record.sourceId.replace(SOURCE_ID_PREFIX, "");
}

/**
 * The issue title WITHOUT the identifier the bronze projection prefixes to it.
 *
 * `corpus/linear/project.ts` writes an issue's title as `` `${identifier} ${title}` `` so a retrieval hit
 * carries its ticket number in the indexed text. That is right for retrieval and wrong for both consumers
 * here: a row would render `SUP-9707  SUP-9707 DD monitor …`, and — the defect that actually matters — the
 * live verifier compares this string against Linear's own `title`, which carries no prefix, so EVERY
 * citation would report a title drift. Stripping it once, here, fixes both. Pure.
 */
function bareTitle({ title, identifier }: { title: string; identifier: string }): string {
  const prefix = `${identifier} `;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

/**
 * Flatten one matched record into the hit shape.
 *
 * @param record the matched corpus record
 * @param kind the query kind it matched
 * @returns the flattened hit
 */
export function linearQueryHit({ record, kind }: { record: CorpusRecord; kind: LinearQueryKind }): LinearQueryHit {
  const attrs = record.attrs ?? {};
  const identifier = identifierOf({ kind, record });
  return {
    assignee: attrString({ attrs, key: ownerAttrKey({ kind }) }),
    cycleNumber: attrNumber({ attrs, key: "cycleNumber" }),
    identifier,
    kind,
    labels: attrList({ attrs, key: "labels" }),
    priority: attrNumber({ attrs, key: "priority" }),
    project: kind === "issue" ? attrString({ attrs, key: "project" }) : record.title,
    projectId: projectIdOf({ kind, record }),
    state: attrString({ attrs, key: "state" }),
    stateType: attrString({ attrs, key: "stateType" }),
    team: kind === "issue" ? attrString({ attrs, key: "team" }) : attrList({ attrs, key: "teams" })[0],
    title: bareTitle({ identifier, title: record.title ?? record.sourceId }),
    tsIso: record.tsIso,
    url: record.url,
  };
}

/**
 * Fold one scanned record into the newest-capture instant per identity, when it is the queried kind.
 *
 * The scan calls this on EVERY row of the queried kind, matched or not, because whether a match is still
 * current depends on the rows that did NOT match: see {@link currentMatches}. It holds one string per
 * identity, so the scan's heap stays a property of the answer rather than of the corpus.
 *
 * @param newest the per-identity newest instant, MUTATED in place
 * @param record one parsed bronze record
 * @param kind the queried kind
 */
export function noteNewestCapture({
  newest,
  record,
  kind,
}: {
  newest: Map<string, string>;
  record: CorpusRecord;
  kind: LinearQueryKind;
}): void {
  if (record.source !== "linear" || record.kind !== corpusKindFor({ kind })) {
    return;
  }
  const identity = recordIdentity({ record });
  const seen = newest.get(identity);
  if (seen === undefined || record.tsIso > seen) {
    newest.set(identity, record.tsIso);
  }
}

/**
 * Keep only the matches that are their object's NEWEST capture.
 *
 * Bronze keeps every version, and the scan tests each one on its own, so an issue that sat in project X last
 * month and has since moved matches `--project X` through its old capture. {@link latestRecords} cannot see
 * that afterwards: it collapses among the MATCHED rows only, and the newer capture that stopped matching was
 * never retained. The same holds for every facet — an issue since closed still answers `--state "In Progress"`.
 *
 * A capture at exactly its object's newest instant is kept even if a sibling at that same instant did not
 * match; that tie is left to {@link rankLinearMatches}. Pure.
 *
 * @param records the matched records, superseded captures included
 * @param newest the per-identity newest instant over every row of the queried kind
 * @returns the matches that are still current
 */
export function currentMatches({
  records,
  newest,
}: {
  records: readonly CorpusRecord[];
  newest: ReadonlyMap<string, string>;
}): readonly CorpusRecord[] {
  return records.filter((record) => newest.get(recordIdentity({ record })) === record.tsIso);
}

/**
 * Collapse superseded captures and rank the survivors newest-first, then take the page.
 *
 * Bronze is append-only, so one issue edited three times is three lines; {@link latestRecords} is the one
 * rule every reader shares for picking the survivor, and skipping it would page the same ticket three times.
 *
 * @param records every record that matched, in scan order
 * @param kind the query kind, carried onto each hit
 * @param limit how many hits the page holds
 * @returns the page of hits plus the total distinct matches behind it
 */
export function rankLinearMatches({
  records,
  kind,
  limit,
}: {
  records: readonly CorpusRecord[];
  kind: LinearQueryKind;
  limit: number;
}): { readonly hits: readonly LinearQueryHit[]; readonly matched: number } {
  const distinct = latestRecords({ records });
  const ordered = distinct.toSorted((left, right) => right.tsIso.localeCompare(left.tsIso));
  return {
    hits: ordered.slice(0, limit).map((record) => linearQueryHit({ kind, record })),
    matched: distinct.length,
  };
}
