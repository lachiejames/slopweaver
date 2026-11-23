/**
 * Pure projection: shaped Linear items → `CorpusRecord[]`. No I/O. An issue fans out into: the issue
 * **atom** (`<TEAM-123>`) carrying its current state/assignee/labels/project folded into the text, one
 * **comment** record per comment (`<TEAM-123>:comment:<id>`), and standalone **project** records
 * (`project:<id>`). Current state is folded into the issue rather than emitted as churny status events.
 * Linear identifiers (`TEAM-123`) are preserved in titles/text so the graph + citations see the tokens.
 */

import { isRecord } from "../../lib/parsers.js";
import { classifyCurated } from "../curated/classify.js";
import { CURATED_CLASS_ATTR, CURATED_EDGES_ATTR } from "../curated/types.js";
import type { HistoryEventRow } from "../history/types.js";
import { extractRefs } from "../refs.js";
import type { CorpusAttributeValue, CorpusRecord } from "../types.js";
import { customerNeedRecord, initiativeUpdateRecord, projectMilestoneRecord, templateRecord } from "./entities.js";
import { issueHistoryDigest } from "./history.js";
import type {
  LinearDocumentItem,
  LinearInitiativeItem,
  LinearIssueItem,
  LinearProjectItem,
  LinearUpdateItem,
} from "./items.js";
import { definedAttrs, issueContainer, joinDefined, labelled, listClause, summaryLineOf } from "./recordText.js";

/**
 * The keys an issue's `raw` payload must never carry into bronze: the two activity-history streams.
 *
 * They are already dropped at the parse edge by `issueRaw`. This is the SECOND place, at the emission
 * boundary, and the duplication is the point — an adversarial review pass observed that `projectLinearRecords`
 * is exported and accepts any `LinearIssueItem`, so a caller that did not come through
 * `parseLinearIssueNode` could hand it an item whose `raw` still held complete event payloads, actors and
 * timestamps included, and they would land in bronze verbatim. The parse edge is where the stripping is
 * CHEAP; here is where it is ENFORCED. Same lesson as the connection paging: put the guarantee where the
 * records are emitted, not at one caller who happens to be well-behaved today.
 */
const RAW_KEYS_BARRED_FROM_BRONZE: ReadonlySet<string> = new Set(["history", "stateHistory"]);

/**
 * A payload REBUILT as plain JSON data, with every occurrence of a barred key omitted at any depth. Pure.
 *
 * ## Why this constructs rather than sanitises
 *
 * Four review findings in this area each defeated the version before it, and the first three were all the same
 * mistake in different clothes — taking the caller's value and removing the bad parts from it:
 *
 *  1. stripping only immediate keys let a connection nested under a retained key through (`raw.parent.history`),
 *     so the walk became recursive;
 *  2. a recursive walk that copied values through still let a `toJSON` method survive — and `JSON.stringify`,
 *     which the writer uses, CALLS it, so the guard ran and the serialiser then re-introduced what it returned;
 *  3. dropping callables from object PROPERTIES but not from array ELEMENTS left one hiding place;
 *  4. and once elements were filtered, an `Array` SUBCLASS survived — `filter`/`map` preserve the species, so a
 *     `toJSON` INHERITED by the array itself was never an own entry anything inspected.
 *
 * Removing one more thing would have been the fifth move in a game with no last move. So the rule is inverted:
 * nothing from the input is adopted. Every object becomes a fresh `{}` and every array a fresh `[]`, so the
 * result's prototypes are `Object.prototype` and `Array.prototype` by CONSTRUCTION and no inherited hook can
 * exist to be found. Only own enumerable data-valued entries are copied across.
 *
 * That is not a new restriction on real payloads: `raw` comes from `JSON.parse` of a GraphQL response, so it is
 * already plain objects, arrays and primitives. Everything this drops is something a real payload cannot hold.
 *
 * ## Where this stops, stated rather than left to be discovered
 *
 * The rule is by KEY, not by content. A payload carrying a history-shaped object under some other key — say
 * `raw.somethingElse` — is copied through, and a review pass duly demonstrated that with a getter. The getter
 * was incidental: the identical bytes come out with a plain property, which is the tell that this is about the
 * rule's SCOPE and not about hooks.
 *
 * Closing it would mean inspecting values to guess whether they look like history, and content inspection is
 * not a boundary — it fails open on anything it does not recognise and closed on anything it misreads. The
 * boundary instead rests on a fact about the producer: `HISTORY_FIELDS` and `STATE_HISTORY_FIELDS` in
 * `queries.ts` are selected under exactly the keys `history` and `stateHistory`, so no payload this connector
 * can OBTAIN carries a history event anywhere else. Reaching the gap needs code in this repository to
 * hand-build an item the API cannot return — at which point that code could write to `bronze/` directly.
 *
 * The second limit is the JavaScript runtime itself. A later pass pointed out that assigning
 * `Array.prototype.toJSON` makes `JSON.stringify` call it for every array, so a fresh `[]` literal inherits the
 * hook no matter how it was built. True, and deliberately not defended against here: mutating an intrinsic
 * changes how EVERY array in the process serialises — a GitHub record's `refs` just as much as a Linear
 * issue's — so it is a property of the runtime rather than of this connector, and a defence belongs at process
 * start (frozen intrinsics) or nowhere. Fixing it locally would imply the other stores are safe when they are
 * not.
 *
 * @param value any JSON value from a raw payload
 * @returns a freshly built plain-data equivalent with every barred key removed, at every depth
 */
function withoutBarredKeys({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    // A fresh literal, never `value.filter(...)` or `value.map(...)`: those return the SAME species, so an
    // `Array` subclass — and any hook it inherits — would survive the walk that exists to remove hooks.
    const out: unknown[] = [];
    for (const item of value) {
      if (typeof item !== "function") {
        out.push(withoutBarredKeys({ value: item }));
      }
    }
    return out;
  }
  if (!isRecord(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    // A callable is not data. It cannot appear in a parsed GraphQL response, and if one is present it can
    // rewrite the payload at serialisation time, after every check here has already passed.
    if (RAW_KEYS_BARRED_FROM_BRONZE.has(key) || typeof inner === "function") {
      continue;
    }
    out[key] = withoutBarredKeys({ value: inner });
  }
  return out;
}

/**
 * An issue's `raw` payload with the history streams removed at every depth, or undefined when nothing worth
 * storing is left.
 *
 * Returns undefined rather than `{}` for an emptied payload, so `orderedRecord`'s "omit an empty raw" rule
 * still applies and the serialised bytes of every existing record are unchanged. Pure.
 *
 * @param raw the raw payload from the shaped item
 * @returns the payload safe to store, or undefined
 */
function bronzeSafeRaw({
  raw,
}: {
  raw: Readonly<Record<string, unknown>> | undefined;
}): Readonly<Record<string, unknown>> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const stripped = withoutBarredKeys({ value: raw });
  if (!isRecord(stripped) || Object.keys(stripped).length === 0) {
    return undefined;
  }
  return stripped;
}

/**
 * The one-line facts summary folded ahead of the description.
 *
 * Everything here is in `text` rather than only `attrs` on purpose: `retrievalIndex.ts` indexes title, text and
 * refs, so a fact that lives only in `attrs` is structurally invisible to a query. The cycle and milestone are
 * the additions that matter most — sprint-level and milestone-level questions were previously unanswerable
 * even though both fields were one word away on a query already being sent.
 */
function issueSummary({ issue }: { issue: LinearIssueItem }): string {
  return summaryLineOf({
    parts: [
      labelled({ label: "State", value: issue.state }),
      labelled({ label: "Assignee", value: issue.assignee }),
      listClause({ label: "Labels", values: issue.labels }),
      labelled({ label: "Project", value: issue.project }),
      labelled({ label: "Milestone", value: issue.milestone }),
      labelled({ label: "Cycle", value: issue.cycle }),
      labelled({ label: "Priority", value: issue.priorityLabel }),
      labelled({ label: "Estimate", value: issue.estimate }),
      labelled({ label: "Due", value: issue.dueDate }),
      labelled({ label: "Parent", value: issue.parent }),
      issue.archivedAtIso !== undefined ? "Archived" : undefined,
    ],
  });
}

/**
 * Rich structured metadata for an issue — the typed, queryable subset, stored in bronze.
 *
 * Every entry has a home HERE, in `attrs`, and that is the point rather than a detail: `contentFingerprint`
 * excludes `raw`, and on a duplicate the FIRST-captured record wins, so a field whose only destination is `raw`
 * makes an enriched issue look unchanged and the thin original is the one kept. A field with no `attrs` or
 * `text` home must not be fetched at all.
 *
 * `historyEvents`/`stateSpans` are COUNTS, not payloads. The events themselves live in the sibling history
 * store; the counts let a reader see that more exists and where, instead of the store being invisible.
 */
function issueAttrs({ issue }: { issue: LinearIssueItem }): Record<string, CorpusAttributeValue> {
  const history = issue.historyRows;
  return definedAttrs({
    entries: [
      ["state", issue.state],
      ["stateType", issue.stateType],
      ["assignee", issue.assignee],
      ["team", issue.team],
      ["project", issue.project],
      ["projectId", issue.projectId],
      ["milestone", issue.milestone],
      ["cycle", issue.cycle],
      ["cycleNumber", issue.cycleNumber],
      ["parent", issue.parent],
      ["priority", issue.priority],
      ["priorityLabel", issue.priorityLabel],
      ["estimate", issue.estimate],
      ["dueDate", issue.dueDate],
      ["branchName", issue.branchName],
      ["number", issue.number],
      ["createdAt", issue.createdAtIso],
      ["startedAt", issue.startedAtIso],
      ["completedAt", issue.completedAtIso],
      ["canceledAt", issue.canceledAtIso],
      ["archivedAt", issue.archivedAtIso],
      ["triagedAt", issue.triagedAtIso],
      ["archived", issue.archivedAtIso !== undefined ? true : undefined],
      ["labels", issue.labels],
      ["subscribers", issue.subscribers],
      ["reactions", issue.reactions],
      ["files", issue.attachments],
      ["relationEvents", issue.relationEvents],
      [CURATED_EDGES_ATTR, issue.edgeRefs],
      ["historyEvents", countStream({ history, stream: "history" })],
      ["stateSpans", countStream({ history, stream: "state" })],
    ],
  });
}

/**
 * How many rows of one stream this issue carries, or undefined when none (so no zero-valued attr). An item
 * built without `historyRows` (optional on `LinearIssueItem`) carries none either. Pure.
 */
function countStream({
  history,
  stream,
}: {
  history: readonly HistoryEventRow[] | undefined;
  stream: HistoryEventRow["stream"];
}): number | undefined {
  const count = history?.filter((row) => row.stream === stream).length;
  return count !== undefined && count > 0 ? count : undefined;
}

/**
 * The issue atom record (the issue itself). Pure.
 *
 * Text order is load-bearing: facts line, then the AUTHORED description, then the derived activity digest. The
 * digest goes last and carries its own hard character cap, so when a very long issue hits a limit it is the
 * derived text that clips and never what a human wrote.
 */
function issueAtom({ issue, container }: { issue: LinearIssueItem; container: string }): CorpusRecord {
  // Read in the order the text is laid out: summary, then the authored description, then the history.
  const summary = issueSummary({ issue });
  const { description, historyRows } = issue;
  // An item built without `historyRows` has no digest to append, exactly as one whose history says nothing.
  const digest = historyRows === undefined ? undefined : issueHistoryDigest({ rows: historyRows });
  const text = joinDefined({ parts: [summary, description, digest] });
  const attrs = issueAttrs({ issue });
  const raw = bronzeSafeRaw({ raw: issue.raw });
  return {
    container,
    kind: "issue",
    refs: extractRefs({ text: joinDefined({ parts: [issue.identifier, issue.title, issue.description] }) }),
    source: "linear",
    sourceId: issue.identifier,
    text: text.length > 0 ? text : issue.title,
    title: `${issue.identifier} ${issue.title}`,
    tsIso: issue.tsIso,
    url: issue.url,
    ...(issue.author !== undefined ? { author: issue.author } : {}),
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(raw !== undefined ? { raw } : {}),
  };
}

/** One comment record under an issue. Pure. */
function commentRecord({
  issue,
  comment,
  container,
}: {
  issue: LinearIssueItem;
  comment: LinearIssueItem["comments"][number];
  container: string;
}): CorpusRecord {
  const attrs = definedAttrs({
    entries: [
      ["issue", issue.identifier],
      ["team", issue.team],
      // The reply parent. A flat comment list could not express threading at all, so a discussion's shape —
      // who answered whom — was unrecoverable from bronze however many comments it held.
      ["parentComment", comment.parentId],
      ["reactions", comment.reactions],
      ["editedAt", comment.editedAtIso],
      ["resolvedAt", comment.resolvedAtIso],
      ["quotedText", comment.quotedText],
    ],
  });
  return {
    container,
    kind: "comment",
    refs: extractRefs({ text: `${issue.identifier} ${comment.body}` }),
    source: "linear",
    sourceId: `${issue.identifier}:comment:${comment.id}`,
    text: comment.body,
    tsIso: comment.tsIso,
    url: comment.url.length > 0 ? comment.url : issue.url,
    ...(comment.author !== undefined ? { author: comment.author } : {}),
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(comment.raw !== undefined ? { raw: comment.raw } : {}),
  };
}

/** The issue atom + a comment record per non-blank comment. */
function issueRecords({ issue }: { issue: LinearIssueItem }): CorpusRecord[] {
  const container = issueContainer({ team: issue.team });
  const records: CorpusRecord[] = [issueAtom({ container, issue })];
  for (const comment of issue.comments) {
    if (comment.body.trim().length === 0) {
      continue;
    }
    records.push(commentRecord({ comment, container, issue }));
  }
  return records;
}

/** Add a classification attr when the heuristic fires, else the bare attrs. Pure. */
function withClassification({
  attrs,
  kind,
  title,
  text,
}: {
  attrs: Record<string, CorpusAttributeValue>;
  kind: CorpusRecord["kind"];
  title?: string;
  text: string;
}): Record<string, CorpusAttributeValue> {
  const classification = classifyCurated({ kind, text, ...(title !== undefined ? { title } : {}) });
  return classification !== undefined ? { ...attrs, [CURATED_CLASS_ATTR]: classification } : attrs;
}

/** The project's facts line, folded ahead of its brief. Pure. */
function projectSummary({ project }: { project: LinearProjectItem }): string {
  return summaryLineOf({
    parts: [
      labelled({ label: "State", value: project.state }),
      labelled({ label: "Health", value: project.health }),
      labelled({ label: "Lead", value: project.lead }),
      listClause({ label: "Teams", values: project.teams }),
      labelled({ label: "Start", value: project.startDate }),
      labelled({ label: "Target", value: project.targetDate }),
      listClause({ label: "Initiatives", values: project.initiatives }),
      project.archivedAtIso !== undefined ? "Archived" : undefined,
    ],
  });
}

/**
 * A standalone project record.
 *
 * `content` — the project's full brief — now reaches `text`, which is the single largest content recovery in
 * this change: previously only the one-paragraph `description` was captured, so the corpus held every project's
 * name and none of its plan.
 */
function projectRecord({ project }: { project: LinearProjectItem }): CorpusRecord {
  const searchable = joinDefined({ parts: [project.name, project.description, project.content] });
  const text = joinDefined({ parts: [projectSummary({ project }), project.description, project.content] });
  const attrs = withClassification({
    attrs: definedAttrs({
      entries: [
        ["state", project.state],
        ["health", project.health],
        ["lead", project.lead],
        ["startDate", project.startDate],
        ["targetDate", project.targetDate],
        ["createdAt", project.createdAtIso],
        ["completedAt", project.completedAtIso],
        ["canceledAt", project.canceledAtIso],
        ["archivedAt", project.archivedAtIso],
        ["archived", project.archivedAtIso !== undefined ? true : undefined],
        ["teams", project.teams],
        ["members", project.members],
        ["labels", project.labels],
        ["initiatives", project.initiatives],
        ["links", project.links],
      ],
    }),
    kind: "project",
    text: searchable,
    title: project.name,
  });
  return {
    container: "linear",
    kind: "project",
    refs: extractRefs({ text: searchable }),
    source: "linear",
    sourceId: `project:${project.id}`,
    text: text.length > 0 ? text : project.name,
    title: project.name,
    tsIso: project.tsIso,
    url: project.url,
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(project.raw !== undefined ? { raw: project.raw } : {}),
  };
}

/** One project-update record (`update` kind — the weekly status narrative, classified `status`). Pure. */
function updateRecord({ update, project }: { update: LinearUpdateItem; project: LinearProjectItem }): CorpusRecord {
  const attrs = withClassification({
    attrs: definedAttrs({
      entries: [
        ["project", project.name],
        ["reactions", update.reactions],
        ["editedAt", update.editedAtIso],
      ],
    }),
    kind: "update",
    text: update.body,
  });
  return {
    container: "linear",
    kind: "update",
    refs: extractRefs({ text: update.body }),
    source: "linear",
    sourceId: `projectUpdate:${update.id}`,
    text: update.body.length > 0 ? update.body : `Update on ${project.name}`,
    title: `Update: ${project.name}${update.health !== undefined ? ` (${update.health})` : ""}`,
    tsIso: update.tsIso,
    url: update.url.length > 0 ? update.url : project.url,
    ...(update.author !== undefined ? { author: update.author } : {}),
    attrs: { ...attrs, ...(update.health !== undefined ? { health: update.health } : {}) },
    ...(update.raw !== undefined ? { raw: update.raw } : {}),
  };
}

/** The project record + one update record per status update. Pure. */
function projectRecords({ project }: { project: LinearProjectItem }): CorpusRecord[] {
  const own = projectRecord({ project });
  // The parser omits `updates` on a project nobody has posted a status update on, so it yields its own record only.
  const { updates } = project;
  return updates === undefined ? [own] : [own, ...updates.map((update) => updateRecord({ project, update }))];
}

/** One initiative record (`initiative` kind — a strategy artefact), now carrying its full brief. Pure. */
function initiativeRecord({ initiative }: { initiative: LinearInitiativeItem }): CorpusRecord {
  const searchable = joinDefined({ parts: [initiative.name, initiative.description, initiative.content] });
  const summary = summaryLineOf({
    parts: [
      labelled({ label: "Status", value: initiative.status }),
      labelled({ label: "Health", value: initiative.health }),
      labelled({ label: "Owner", value: initiative.owner }),
      labelled({ label: "Target", value: initiative.targetDate }),
      listClause({ label: "Projects", values: initiative.projects }),
      initiative.archivedAtIso !== undefined ? "Archived" : undefined,
    ],
  });
  const text = joinDefined({ parts: [summary, initiative.description, initiative.content] });
  return {
    attrs: withClassification({
      attrs: definedAttrs({
        entries: [
          // The `project-item` edges are what stop an initiative being an orphan in the curated graph: the
          // strategy layer existed as records with nothing connecting it to the work underneath.
          [CURATED_EDGES_ATTR, initiative.projectEdges],
          ["status", initiative.status],
          ["health", initiative.health],
          ["owner", initiative.owner],
          ["targetDate", initiative.targetDate],
          ["createdAt", initiative.createdAtIso],
          ["archivedAt", initiative.archivedAtIso],
          ["archived", initiative.archivedAtIso !== undefined ? true : undefined],
          ["projects", initiative.projects],
          ["links", initiative.links],
        ],
      }),
      kind: "initiative",
      text: searchable,
      title: initiative.name,
    }),
    container: "linear",
    kind: "initiative",
    refs: extractRefs({ text: searchable }),
    source: "linear",
    sourceId: `initiative:${initiative.id}`,
    text: text.length > 0 ? text : initiative.name,
    title: initiative.name,
    tsIso: initiative.tsIso,
    url: initiative.url,
    ...(initiative.raw !== undefined ? { raw: initiative.raw } : {}),
  };
}

/**
 * One document record (`document` kind — a deliberately-authored spec/doc).
 *
 * The parent bindings go into the searchable TEXT as well as `attrs`. That is the difference between storing
 * them and being able to use them: `retrievalIndex.ts` indexes title/text/refs only, so a document whose
 * project binding lived in `attrs` alone would still be unfindable by the name of the project it specifies.
 * Pure.
 */
function documentRecord({ document }: { document: LinearDocumentItem }): CorpusRecord {
  const context = summaryLineOf({
    parts: [
      labelled({ label: "Project", value: document.project }),
      labelled({ label: "Initiative", value: document.initiative }),
      labelled({ label: "Issue", value: document.issue }),
      labelled({ label: "Team", value: document.team }),
      labelled({ label: "Owner", value: document.owner }),
      document.archivedAtIso !== undefined ? "Archived" : undefined,
    ],
  });
  const text = joinDefined({ parts: [context, document.content] });
  const searchable = joinDefined({ parts: [document.title, context, document.content] });
  return {
    attrs: withClassification({
      attrs: definedAttrs({
        entries: [
          ["project", document.project],
          ["initiative", document.initiative],
          ["issue", document.issue],
          ["team", document.team],
          ["creator", document.creator],
          ["owner", document.owner],
          ["createdAt", document.createdAtIso],
          ["archivedAt", document.archivedAtIso],
          ["archived", document.archivedAtIso !== undefined ? true : undefined],
        ],
      }),
      kind: "document",
      text: searchable,
      title: document.title,
    }),
    container: "linear",
    kind: "document",
    refs: extractRefs({ text: searchable }),
    source: "linear",
    sourceId: `document:${document.id}`,
    text: text.length > 0 ? text : document.title,
    title: document.title,
    tsIso: document.tsIso,
    url: document.url,
    ...(document.raw !== undefined ? { raw: document.raw } : {}),
  };
}

/** The raw node lists for the bulk entities that become searchable records. */
interface LinearEntityNodes {
  readonly customerNeeds?: readonly unknown[];
  readonly projectMilestones?: readonly unknown[];
  readonly initiativeUpdates?: readonly unknown[];
  readonly templates?: readonly unknown[];
}

/**
 * The bulk-entity records, each projected by its own pure function in {@link ./entities}. A node that cannot be
 * projected is DROPPED rather than emitted half-formed. Every list is present: {@link projectLinearRecords}'s
 * own parameter defaults turn an omitted lane into an empty one before it gets here. Pure.
 */
function entityRecords({ nodes }: { nodes: Required<LinearEntityNodes> }): readonly CorpusRecord[] {
  const projections = [
    { list: nodes.customerNeeds, project: customerNeedRecord },
    { list: nodes.projectMilestones, project: projectMilestoneRecord },
    { list: nodes.initiativeUpdates, project: initiativeUpdateRecord },
    { list: nodes.templates, project: templateRecord },
  ];
  return projections.flatMap(({ list, project }) =>
    list.map((node) => project({ node })).filter((record): record is CorpusRecord => record !== undefined),
  );
}

/**
 * Project every fetched Linear thing into corpus records: issues (+ comments), projects (+ updates),
 * initiatives, documents, and the four bulk entities that became searchable.
 *
 * @param issues the fetched issues
 * @param projects the fetched projects (with their status updates)
 * @param initiatives the fetched initiatives (strategy artefacts; empty when the lane is unavailable)
 * @param documents the fetched documents (empty when the lane is unavailable)
 * @param customerNeeds raw customer-need nodes → `need` records
 * @param projectMilestones raw milestone nodes → `milestone` records
 * @param initiativeUpdates raw initiative-update nodes → `update` records
 * @param templates raw template nodes → `document` records
 * @returns the flattened corpus records
 */
export function projectLinearRecords({
  issues,
  projects,
  initiatives = [],
  documents = [],
  customerNeeds = [],
  projectMilestones = [],
  initiativeUpdates = [],
  templates = [],
}: {
  issues: readonly LinearIssueItem[];
  projects: readonly LinearProjectItem[];
  initiatives?: readonly LinearInitiativeItem[];
  documents?: readonly LinearDocumentItem[];
} & LinearEntityNodes): readonly CorpusRecord[] {
  const records: CorpusRecord[] = [];
  for (const issue of issues) {
    records.push(...issueRecords({ issue }));
  }
  for (const project of projects) {
    records.push(...projectRecords({ project }));
  }
  for (const initiative of initiatives) {
    records.push(initiativeRecord({ initiative }));
  }
  for (const document of documents) {
    records.push(documentRecord({ document }));
  }
  records.push(...entityRecords({ nodes: { customerNeeds, initiativeUpdates, projectMilestones, templates } }));
  return records;
}
