/**
 * The publication audit's Linear inventory: every object the fleet's own `linear` write verbs recorded creating,
 * resolved to the address `./linearReader.ts` reads it back from.
 *
 * ## Why the ledgers, not a workspace sweep
 *
 * Under a personal API key Linear attributes every write to the human who owns the key
 * (`../../outbound/linear/issueLedger.ts` says why), so nothing on a Linear object can say the fleet wrote it. The
 * local reservation ledgers under `$SLOPWEAVER_HOME/ledgers/` are the only inventory of what the fleet published, so
 * they are what this door reads — through `../../outbound/linear/ledgerListing.ts`'s fallible listing, never the
 * `[]`-on-failure id listers, because an unreadable ledger read as empty would report a door clean that was never swept.
 *
 * ## Exact addresses
 *
 * An issue is addressed by its confirmed identifier, because a bare UUID does not resolve through
 * `../linear/read.ts`'s `parseLinearReadAddress` (it is neither an identifier nor a URL, so it refuses
 * `INVALID_ADDRESS`); a document or project by the URL its ledger row recorded. A comment or a project update is read
 * through its parent, so it resolves to the parent's address.
 *
 * ## What the inventory alone already shows
 *
 * An unconfirmed reservation is `inventory row unresolved` (the write may have landed); a family this build reads no
 * text of is `<family> not swept`. `linear attach upload` keeps no per-object ledger, so `attachment writes not
 * inventoried` stands on every run and the door is never `complete` until it does. Relations and initiative links
 * carry no authored text and are skipped without a gap.
 */
import type { Result } from "#lib/result.js";

import { type AppendRecord, listAppendRecords } from "../../outbound/linear/commentLedger.js";
import { type DocumentRecord, listDocumentRecords } from "../../outbound/linear/documentLedger.js";
import { type IssueRecord, listIssueRecords } from "../../outbound/linear/issueLedger.js";
import type { LedgerListing, LedgerUnreadableError } from "../../outbound/linear/ledgerListing.js";
import { listObjectRecords, type ProjectRecord } from "../../outbound/linear/projectLedger.js";

import { LINEAR_PUBLICATION_GAPS } from "./linearSeam.js";

/** A bare issue identifier, the shape `parseLinearReadAddress` reads as an issue with no URL. */
const ISSUE_IDENTIFIER = /^[A-Z][A-Z0-9]+-\d+$/u;

/** A linear.app project URL, the one address `readLinearProjectUpdates` accepts. */
const PROJECT_URL = /^https:\/\/linear\.app\/\S*\/project\/\S+$/u;

/** One ledger family's listing, or why it could not be listed — a failed family is a gap, never an abort. */
export type LinearInventoryFamily<T> = Result<LedgerListing<T>, LedgerUnreadableError>;

/** Everything the fleet's Linear write verbs recorded, family by family. */
export interface LinearInventory {
  readonly issues: LinearInventoryFamily<IssueRecord>;
  readonly documents: LinearInventoryFamily<DocumentRecord>;
  readonly projects: LinearInventoryFamily<ProjectRecord>;
  readonly comments: LinearInventoryFamily<AppendRecord>;
  readonly projectUpdates: LinearInventoryFamily<AppendRecord>;
  readonly labels: LinearInventoryFamily<AppendRecord>;
  readonly initiatives: LinearInventoryFamily<ProjectRecord>;
  readonly initiativeUpdates: LinearInventoryFamily<AppendRecord>;
  readonly milestones: LinearInventoryFamily<ProjectRecord>;
}

/**
 * Every Linear ledger family under one state home, each listed on its own so a failed family becomes a gap.
 * Relations and initiative links are not listed: they carry no authored text.
 *
 * @param home the state home whose `ledgers/` holds the reservations
 * @returns the inventory, one listing result per family
 */
export function readLinearInventory({ home }: { home: string }): LinearInventory {
  return {
    comments: listAppendRecords({ home, kind: "linear-comments" }),
    documents: listDocumentRecords({ home }),
    initiativeUpdates: listAppendRecords({ home, kind: "linear-initiative-updates" }),
    initiatives: listObjectRecords({ home, kind: "linear-initiatives" }),
    issues: listIssueRecords({ home }),
    labels: listAppendRecords({ home, kind: "linear-labels" }),
    milestones: listObjectRecords({ home, kind: "linear-milestones" }),
    projectUpdates: listAppendRecords({ home, kind: "linear-project-updates" }),
    projects: listObjectRecords({ home, kind: "linear-projects" }),
  };
}

/** The object kinds a read addresses, each with the fields of its own text the reader judges. */
export type ParentKind = "issue" | "document" | "project";

/** Where an object is read from: its own address, or its parent's for a comment or a project update. */
export interface ParentRef {
  readonly kind: ParentKind;
  readonly address: string;
}

/** One object the inventory resolved to an address, keyed by non-secret coordinates. */
export interface PlannedObject {
  readonly role: "own" | "comment" | "project-update";
  readonly objectKey: string;
  /** The object's own id: the ledger's for an own object, the comment or update id an exact match needs. */
  readonly id: string;
  readonly parent: ParentRef;
}

/** What the inventory resolved to: the objects to read, and every gap it already knows. */
interface LinearPlan {
  readonly objects: readonly PlannedObject[];
  readonly gaps: readonly string[];
}

/** The records of a listed family, recording the family's own gaps; none for a family that would not list. */
function recordsOf<T>({ family, gaps }: { family: LinearInventoryFamily<T>; gaps: string[] }): readonly T[] {
  if (family.isErr()) {
    gaps.push(LINEAR_PUBLICATION_GAPS.inventoryUnreadable);
    return [];
  }
  if (family.value.unreadableRows > 0) {
    gaps.push(LINEAR_PUBLICATION_GAPS.inventoryRowUnreadable);
  }
  return family.value.records;
}

/** An own object's plan from a confirmed address, or the unresolved gap for a row that carries none. */
function ownObject({
  kind,
  id,
  confirmedIso,
  address,
  gaps,
}: {
  kind: ParentKind;
  id: string;
  confirmedIso: string | undefined;
  address: string | undefined;
  gaps: string[];
}): readonly PlannedObject[] {
  if (confirmedIso === undefined || address === undefined) {
    gaps.push(LINEAR_PUBLICATION_GAPS.inventoryRowUnresolved);
    return [];
  }
  return [{ id, objectKey: `${kind} ${id}`, parent: { address, kind }, role: "own" }];
}

/**
 * Where a confirmed comment landed, from its ledger `subject`: an identifier is an issue; a UUID is an issue or a
 * document only when this fleet's own ledger names it, since `subject` records the id and never the kind.
 */
function commentParent({
  subject,
  issues,
  documents,
}: {
  subject: string;
  issues: readonly IssueRecord[];
  documents: readonly DocumentRecord[];
}): ParentRef | undefined {
  if (ISSUE_IDENTIFIER.test(subject)) {
    return { address: subject, kind: "issue" };
  }
  const issue = issues.find((record) => record.id === subject && record.confirmedIso !== undefined);
  if (issue?.identifier !== undefined) {
    return { address: issue.identifier, kind: "issue" };
  }
  const document = documents.find((record) => record.id === subject && record.confirmedIso !== undefined);
  if (document?.url !== undefined) {
    return { address: document.url, kind: "document" };
  }
  return undefined;
}

/** The project a confirmed update landed on: a project URL as given, or a project this fleet's ledger recorded. */
function updateParent({
  subject,
  projects,
}: {
  subject: string;
  projects: readonly ProjectRecord[];
}): ParentRef | undefined {
  if (PROJECT_URL.test(subject)) {
    return { address: subject, kind: "project" };
  }
  const project = projects.find((record) => record.id === subject && record.confirmedIso !== undefined);
  if (project?.url !== undefined) {
    return { address: project.url, kind: "project" };
  }
  return undefined;
}

/** The appended objects of one family, each resolved to its parent, or the gap saying why it could not be. */
function appendedObjects({
  records,
  role,
  resolve,
  unresolvedGap,
  gaps,
}: {
  records: readonly AppendRecord[];
  role: "comment" | "project-update";
  resolve: (args: { readonly subject: string }) => ParentRef | undefined;
  unresolvedGap: string;
  gaps: string[];
}): readonly PlannedObject[] {
  return records.flatMap((record) => {
    if (record.confirmedIso === undefined) {
      gaps.push(LINEAR_PUBLICATION_GAPS.inventoryRowUnresolved);
      return [];
    }
    const parent = record.subject === undefined ? undefined : resolve({ subject: record.subject });
    if (parent === undefined) {
      gaps.push(unresolvedGap);
      return [];
    }
    return [{ id: record.id, objectKey: `${role} ${record.id}`, parent, role }];
  });
}

/** Families this build reads no text of: a gap naming each one that holds a row. */
function notSweptGaps({ inventory, gaps }: { inventory: LinearInventory; gaps: string[] }): void {
  const families = [
    { gap: LINEAR_PUBLICATION_GAPS.labelsNotSwept, rows: recordsOf({ family: inventory.labels, gaps }).length },
    {
      gap: LINEAR_PUBLICATION_GAPS.initiativesNotSwept,
      rows: recordsOf({ family: inventory.initiatives, gaps }).length,
    },
    {
      gap: LINEAR_PUBLICATION_GAPS.initiativeUpdatesNotSwept,
      rows: recordsOf({ family: inventory.initiativeUpdates, gaps }).length,
    },
    { gap: LINEAR_PUBLICATION_GAPS.milestonesNotSwept, rows: recordsOf({ family: inventory.milestones, gaps }).length },
  ];
  for (const { gap, rows } of families) {
    if (rows > 0) {
      gaps.push(gap);
    }
  }
}

/** Two object keys in code-unit order, so a plan sorts identically on every machine. */
function compareKeys({ left, right }: { left: PlannedObject; right: PlannedObject }): number {
  if (left.objectKey < right.objectKey) {
    return -1;
  }
  if (left.objectKey > right.objectKey) {
    return 1;
  }
  return 0;
}

/**
 * Resolve the inventory to the objects to read, sorted by key and capped.
 *
 * @param objectLimit objects planned before `object ceiling reached` is reported
 * @returns the objects within the ceiling and every gap the inventory alone already shows
 */
export function planLinearPublications({
  inventory,
  objectLimit,
}: {
  inventory: LinearInventory;
  objectLimit: number;
}): LinearPlan {
  const gaps: string[] = [LINEAR_PUBLICATION_GAPS.attachmentWritesNotInventoried];
  const issues = recordsOf({ family: inventory.issues, gaps });
  const documents = recordsOf({ family: inventory.documents, gaps });
  const projects = recordsOf({ family: inventory.projects, gaps });
  const planned: PlannedObject[] = [
    ...issues.flatMap((record) =>
      ownObject({ address: record.identifier, confirmedIso: record.confirmedIso, gaps, id: record.id, kind: "issue" }),
    ),
    ...documents.flatMap((record) =>
      ownObject({ address: record.url, confirmedIso: record.confirmedIso, gaps, id: record.id, kind: "document" }),
    ),
    ...projects.flatMap((record) =>
      ownObject({ address: record.url, confirmedIso: record.confirmedIso, gaps, id: record.id, kind: "project" }),
    ),
    ...appendedObjects({
      gaps,
      records: recordsOf({ family: inventory.comments, gaps }),
      resolve: ({ subject }) => commentParent({ documents, issues, subject }),
      role: "comment",
      unresolvedGap: LINEAR_PUBLICATION_GAPS.commentDestinationUnknown,
    }),
    ...appendedObjects({
      gaps,
      records: recordsOf({ family: inventory.projectUpdates, gaps }),
      resolve: ({ subject }) => updateParent({ projects, subject }),
      role: "project-update",
      unresolvedGap: LINEAR_PUBLICATION_GAPS.objectNotAddressable,
    }),
  ];
  notSweptGaps({ gaps, inventory });
  const sorted = planned.toSorted((left, right) => compareKeys({ left, right }));
  if (sorted.length > objectLimit) {
    gaps.push(LINEAR_PUBLICATION_GAPS.objectCeiling);
  }
  return { gaps, objects: sorted.slice(0, objectLimit) };
}
