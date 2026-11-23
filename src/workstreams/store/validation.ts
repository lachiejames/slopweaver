/**
 * Every rule of a workstream aggregate that the store's CHECKs and foreign keys cannot see, judged before any write
 * and again on every read.
 *
 * A workstream's own milestones run in the order the owner describes them, some side by
 * side, some waiting on others, and the LAST is its definition of done; a milestone is done only when a dated entry
 * links the proof. So, beyond the shape of each field:
 *
 * - the milestone graph is acyclic and every edge stays inside the workstream (`../milestoneStructure.ts`);
 * - every milestone other than the last is upstream of the last — the definition of done waits on everything;
 * - an entry finishing a milestone carries its proof link, and comes after an entry finishing each milestone it waits on;
 * - a link names its kind's canonical identity (`./linkTarget.ts`), once, and a `workstream` link names another
 *   workstream the register holds;
 * - every position fits the store's `integer` and every string is one the store holds as written (`./storable.ts`).
 *
 * Pure.
 */

import { milestoneStructureProblems, transitivePredecessorIds } from "../milestoneStructure.js";
import { dateSchema, hrefSchema } from "../schema.js";

import { KEBAB_ID, linkTargetProblem } from "./linkTarget.js";
import { isStorableDate, isStorablePosition, STORE_INTEGER_MAX, unstorableStrings } from "./storable.js";
import type { WorkstreamAggregate, WorkstreamEntry, WorkstreamLink, WorkstreamMilestone } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * The milestone that is the definition of done: the one with the greatest position.
 *
 * @returns it, or `undefined` for a workstream with no milestones
 */
export function definitionOfDone({
  milestones,
}: {
  milestones: readonly WorkstreamMilestone[];
}): WorkstreamMilestone | undefined {
  return milestones.reduce<WorkstreamMilestone | undefined>(
    (last, one) => (last === undefined || one.position > last.position ? one : last),
    undefined,
  );
}

/**
 * Each value that appears more than once.
 *
 * @returns the repeated values, once each, in first-repeat order
 */
function repeats({ values }: { values: readonly (string | number)[] }): readonly (string | number)[] {
  const seen = new Set<string | number>();
  const repeated = new Set<string | number>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated];
}

/**
 * What is wrong with the workstream's own columns, beside its detail and children.
 *
 * @returns one problem per broken rule
 */
function rowProblems({ aggregate }: { aggregate: WorkstreamAggregate }): readonly string[] {
  const { id, kind, name, outcome, status } = aggregate;
  const problems: string[] = [];
  if (!KEBAB_ID.test(id)) {
    problems.push(`workstream id ${JSON.stringify(id)} is not lower kebab-case`);
  }
  if (name.trim() === "") {
    problems.push(`${id} has no name`);
  }
  const ownsOutcome = kind === "outcome" || kind === "standing";
  if (ownsOutcome && (outcome === null || status === null)) {
    problems.push(`${id} is ${kind}, so it states its outcome and its status`);
  }
  if (kind === "linked" && (outcome === null || status !== null)) {
    problems.push(`${id} is linked, so it states its outcome and no status of the owner's`);
  }
  if (kind === "local" && (outcome !== null || status !== null)) {
    problems.push(`${id} is local, so it states no outcome and no status`);
  }
  if (kind === "closing" && status !== null) {
    problems.push(`${id} is closing, so it carries no status`);
  }
  return problems;
}

/**
 * What is wrong with one milestone's own fields, the strings the store cannot hold aside (`./storable.ts`).
 *
 * @param one the milestone
 * @param owner the workstream it belongs to, for the problem text
 * @returns one problem per broken rule
 */
export function oneMilestoneProblems({ one, owner }: { one: WorkstreamMilestone; owner: string }): readonly string[] {
  const problems: string[] = [];
  if (!KEBAB_ID.test(one.id)) {
    problems.push(`${owner} milestone id ${JSON.stringify(one.id)} is not lower kebab-case`);
  }
  if (one.name.trim() === "" || one.anchor.trim() === "") {
    problems.push(`${owner} milestone ${one.id} needs a name and the anchor where the owner named it`);
  }
  if (!isStorablePosition({ position: one.position })) {
    problems.push(
      `${owner} milestone ${one.id} has position ${one.position}, not a whole number from 0 to ${STORE_INTEGER_MAX}`,
    );
  }
  for (const repeated of repeats({ values: one.after })) {
    problems.push(`${owner} milestone ${one.id} comes after ${repeated} twice`);
  }
  return problems;
}

/**
 * What is wrong with the milestones: their fields, their count for the kind, the graph, and the definition of done.
 *
 * @returns one problem per broken rule
 */
function milestoneProblems({ aggregate }: { aggregate: WorkstreamAggregate }): readonly string[] {
  const { id, kind, milestones } = aggregate;
  const carries = kind === "outcome" || kind === "standing" || kind === "linked";
  const problems: string[] = [];
  if (carries && milestones.length === 0) {
    problems.push(`${id} is ${kind}, so it carries its own milestones, the last its definition of done`);
  }
  if (!carries && milestones.length > 0) {
    problems.push(`${id} is ${kind}, so it carries no milestones`);
  }
  problems.push(...milestones.flatMap((one) => oneMilestoneProblems({ one, owner: id })));
  for (const position of repeats({ values: milestones.map((one) => one.position) })) {
    problems.push(`${id} has two milestones at position ${position}`);
  }
  const structure = milestoneStructureProblems({ milestones, owner: id });
  const done = definitionOfDone({ milestones });
  if (structure.length > 0 || done === undefined) {
    return [...problems, ...structure];
  }
  const upstream = transitivePredecessorIds({ milestoneId: done.id, milestones });
  const stray = milestones.filter((one) => one.id !== done.id && !upstream.has(one.id)).map((one) => one.id);
  if (stray.length > 0) {
    problems.push(`${id} milestone(s) ${stray.join(", ")} never lead to ${done.id}, its definition of done`);
  }
  return problems;
}

/**
 * What is wrong with the entries: their fields, their order, and a milestone finished before what it waits on.
 *
 * @returns one problem per broken rule
 */
function entryProblems({ aggregate }: { aggregate: WorkstreamAggregate }): readonly string[] {
  const { entries, id, milestones } = aggregate;
  const byId = new Map(milestones.map((one) => [one.id, one]));
  const problems: string[] = [];
  for (const repeated of repeats({ values: entries.map((entry) => entry.id) })) {
    problems.push(`${id} has two entries with id ${repeated}`);
  }
  for (const position of repeats({ values: entries.map((entry) => entry.position) })) {
    problems.push(`${id} has two entries at position ${position}`);
  }
  for (const entry of entries) {
    problems.push(...oneEntryProblems({ byId, entry, owner: id }));
  }
  const finished = new Set<string>();
  for (const entry of entries.toSorted((a, b) => a.position - b.position)) {
    if (!entry.done || entry.milestoneId === null) {
      continue;
    }
    const milestone = byId.get(entry.milestoneId);
    const waiting = milestone === undefined ? [] : milestone.after.filter((before) => !finished.has(before));
    if (waiting.length > 0) {
      problems.push(`${id} finishes ${entry.milestoneId} on ${entry.date} before ${waiting.join(", ")} is done`);
    }
    finished.add(entry.milestoneId);
  }
  return problems;
}

/**
 * What is wrong with one entry's own fields.
 *
 * @param byId the workstream's milestones by id
 * @returns one problem per broken rule
 */
function oneEntryProblems({
  byId,
  entry,
  owner,
}: {
  byId: ReadonlyMap<string, WorkstreamMilestone>;
  entry: WorkstreamEntry;
  owner: string;
}): readonly string[] {
  const problems: string[] = [];
  const where = `${owner} entry ${entry.id}`;
  if (!UUID.test(entry.id)) {
    problems.push(`${where}: its id is not a lowercase UUID`);
  }
  if (!dateSchema.safeParse(entry.date).success || !isStorableDate({ date: entry.date })) {
    problems.push(`${where}: ${JSON.stringify(entry.date)} is not a calendar date YYYY-MM-DD`);
  }
  if (entry.text.trim() === "") {
    problems.push(`${where}: it says nothing`);
  }
  if (!isStorablePosition({ position: entry.position })) {
    problems.push(`${where}: position ${entry.position} is not a whole number from 0 to ${STORE_INTEGER_MAX}`);
  }
  if (entry.href !== null && !hrefSchema.safeParse(entry.href).success) {
    problems.push(`${where}: its link is https:// or a console path starting with /`);
  }
  if (entry.milestoneId !== null && !byId.has(entry.milestoneId)) {
    problems.push(`${where}: it tags milestone ${entry.milestoneId}, which ${owner} does not declare`);
  }
  if (entry.done && (entry.milestoneId === null || entry.href === null)) {
    problems.push(`${where}: an entry that finishes a milestone names it and carries the link that proves it`);
  }
  return problems;
}

/**
 * What is wrong with the links: identity, target grammar, uniqueness, milestone, and a `workstream` target.
 *
 * @param knownWorkstreamIds every workstream id the register will hold once this write lands
 * @returns one problem per broken rule
 */
function linkProblems({
  aggregate,
  knownWorkstreamIds,
}: {
  aggregate: WorkstreamAggregate;
  knownWorkstreamIds: ReadonlySet<string>;
}): readonly string[] {
  const { id, links, milestones } = aggregate;
  const declared = new Set(milestones.map((one) => one.id));
  const problems: string[] = [];
  for (const repeated of repeats({ values: links.map((link) => link.id) })) {
    problems.push(`${id} has two links with id ${repeated}`);
  }
  for (const repeated of repeats({ values: links.map((link) => `${link.kind} ${link.target}`) })) {
    problems.push(`${id} links ${repeated} twice`);
  }
  for (const link of links) {
    problems.push(...oneLinkProblems({ declared, knownWorkstreamIds, link, owner: id }));
  }
  return problems;
}

/**
 * What is wrong with one link's own fields.
 *
 * @param declared the workstream's milestone ids
 * @param knownWorkstreamIds every workstream id the register will hold
 * @returns one problem per broken rule
 */
function oneLinkProblems({
  declared,
  knownWorkstreamIds,
  link,
  owner,
}: {
  declared: ReadonlySet<string>;
  knownWorkstreamIds: ReadonlySet<string>;
  link: WorkstreamLink;
  owner: string;
}): readonly string[] {
  const problems: string[] = [];
  const where = `${owner} link ${link.id}`;
  if (!UUID.test(link.id)) {
    problems.push(`${where}: its id is not a lowercase UUID`);
  }
  const grammar = linkTargetProblem({ kind: link.kind, target: link.target });
  if (grammar !== undefined) {
    problems.push(`${where}: ${grammar}`);
  }
  if (link.label?.trim() === "") {
    problems.push(`${where}: an empty label says nothing; leave it null`);
  }
  if (link.milestoneId !== null && !declared.has(link.milestoneId)) {
    problems.push(`${where}: it serves milestone ${link.milestoneId}, which ${owner} does not declare`);
  }
  if (link.kind === "workstream" && link.target === owner) {
    problems.push(`${where}: a workstream does not link to itself`);
  }
  if (link.kind === "workstream" && link.target !== owner && !knownWorkstreamIds.has(link.target)) {
    problems.push(`${where}: it links workstream ${link.target}, which the register does not hold`);
  }
  return problems;
}

/**
 * Every problem with one workstream aggregate, its detail document aside (`./decode.ts` judges that).
 *
 * @param aggregate the workstream as proposed or as read
 * @param knownWorkstreamIds every workstream id the register holds, this one included
 * @returns every problem, empty when the aggregate may be stored
 */
export function aggregateProblems({
  aggregate,
  knownWorkstreamIds,
}: {
  aggregate: WorkstreamAggregate;
  knownWorkstreamIds: ReadonlySet<string>;
}): readonly string[] {
  return [
    ...rowProblems({ aggregate }),
    ...milestoneProblems({ aggregate }),
    ...entryProblems({ aggregate }),
    ...linkProblems({ aggregate, knownWorkstreamIds }),
    ...unstorableStrings({ path: aggregate.id, value: aggregate }).map(
      (path) => `${path} carries U+0000 or a lone surrogate, which the store cannot hold as written`,
    ),
  ];
}
