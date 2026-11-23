/**
 * How `github stack adopt --register-only` spells the pull-request facts it compares and reports, one string
 * per field.
 *
 * Several of those facts are legitimately absent, and each absence is a state the reader is told by name
 * rather than a blank: a pull request in no native stack, a head repository GitHub no longer reports (a
 * deleted fork), an author GitHub reports none for (a deleted account), and a chain with no open parent at
 * all. Split out of `./stackAdoptRegistrationCore.ts` when that file reached the size ratchet.
 */
import type { WrittenPr } from "../../../corpus/github/write.js";

/** One named field and its spelled value, in the order a freshness check reports the first that moved. */
type ComparableField = readonly [string, string];

/**
 * A pull request's native stack membership: its stack number, or "none" when it is in no stack.
 *
 * @param pr the pull request as GitHub reports it
 * @returns the stack number as text, or "none"
 */
export function stackMembershipField({ pr }: { pr: WrittenPr }): string {
  const stack = pr.stack;
  if (stack === undefined) {
    return "none";
  }
  return String(stack.number);
}

/**
 * A pull request's head repository: its `owner/name`, or "none" once GitHub reports none (a deleted fork).
 *
 * @param pr the pull request as GitHub reports it
 * @returns the head repository as GitHub spells it, or "none"
 */
export function headRepositoryField({ pr }: { pr: WrittenPr }): string {
  const headRepository = pr.head.repoFullName;
  if (headRepository === undefined) {
    return "none";
  }
  return headRepository;
}

/** A pull request's author id, or "none" when GitHub reports no author (a deleted account). */
function authorField({ pr }: { pr: WrittenPr }): string {
  const authorId = pr.authorId;
  if (authorId === undefined) {
    return "none";
  }
  return String(authorId);
}

/** The parent's six fields, each read off the parent — or every one "none" when the chain has no open parent. */
const PARENT_FIELDS: readonly (readonly [string, (parent: WrittenPr) => string])[] = [
  ["the parent pull request", (parent) => String(parent.number)],
  ["the parent's open/closed state", (parent) => parent.state],
  ["the parent's head repository", (parent) => headRepositoryField({ pr: parent }).toLowerCase()],
  ["the parent's head branch", (parent) => parent.head.ref],
  ["the parent's author", (parent) => authorField({ pr: parent })],
  ["the parent's native stack membership", (parent) => stackMembershipField({ pr: parent })],
];

/**
 * What the pull request below the parent is, for the read-back's before-and-after comparison.
 *
 * Its NUMBER alone is not enough: another client
 * removing that pull request from the stack changes the relation from healthy to `parent-unstacked` without
 * changing which pull request it is. Membership is half of what "below the parent" means here, so the key
 * carries both.
 *
 * @param pr the pull request below the parent, or `undefined` when none has that head
 * @returns a value equal for two reads iff the relation below the parent is the same one
 */
export function belowKey({ pr }: { pr: WrittenPr | undefined }): string {
  if (pr === undefined) {
    return "none";
  }
  const stack = pr.stack;
  if (stack === undefined) {
    return `${String(pr.number)}@unstacked`;
  }
  return `${String(pr.number)}@${String(stack.number)}`;
}

/**
 * Every comparable field of the facts the register-only decision actually depends on, in a fixed order.
 *
 * @param facts the repository, the child, its open parent if any, and the pull request below that parent
 * @returns one named, spelled value per field
 */
export function comparableFields({
  facts,
}: {
  facts: {
    readonly owner: string;
    readonly repo: string;
    readonly defaultBranch: string;
    readonly child: WrittenPr;
    readonly parent: WrittenPr | undefined;
    readonly grandparent: WrittenPr | undefined;
  };
}): readonly ComparableField[] {
  const { child, parent } = facts;
  return [
    ["the repository", `${facts.owner}/${facts.repo}`.toLowerCase()],
    ["the repository default branch", facts.defaultBranch],
    ["the pull-request number", String(child.number)],
    ["the author", authorField({ pr: child })],
    ["the open/closed state", child.state],
    ["the base repository", child.baseRepoFullName.toLowerCase()],
    ["the base branch", child.baseRef],
    ["the head repository", headRepositoryField({ pr: child }).toLowerCase()],
    ["the head branch", child.head.ref],
    ["the native stack membership", stackMembershipField({ pr: child })],
    ...PARENT_FIELDS.map(([name, read]): ComparableField => [name, parent === undefined ? "none" : read(parent)]),
    ["the pull request below the parent", belowKey({ pr: facts.grandparent })],
  ];
}
