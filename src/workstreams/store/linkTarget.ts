/**
 * The canonical identity each kind of workstream link names, so "which workstream is this in" is an exact match
 * rather than a fuzzy one, and a link written two ways cannot become two links.
 *
 * - `queue_card`, `alignment_card`: the board row's slug — alignment cards are board rows too.
 * - `automation`: the automation's `recipeId`.
 * - `pull_request`: `owner/repo#N`, because `#N` alone is ambiguous across repositories.
 * - `linear_project`: the Linear project's UUID, which survives a rename where its slug does not.
 * - `workstream`: another workstream's id; that it exists is checked against the register, not here.
 *
 * Pure.
 */
import type { WorkstreamLinkKind } from "./types.js";

/** A lower-kebab id: a board slug, a recipe id, a workstream id. */
export const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const PULL_REQUEST = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*$/u;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Each kind's grammar and the words that name it when a target fails it. */
const GRAMMAR: Readonly<Record<WorkstreamLinkKind, { readonly pattern: RegExp; readonly shape: string }>> = {
  alignment_card: { pattern: KEBAB_ID, shape: "a board row slug" },
  automation: { pattern: KEBAB_ID, shape: "a recipe id" },
  linear_project: { pattern: UUID, shape: "a lowercase Linear project UUID" },
  pull_request: { pattern: PULL_REQUEST, shape: "owner/repo#N" },
  queue_card: { pattern: KEBAB_ID, shape: "a board row slug" },
  workstream: { pattern: KEBAB_ID, shape: "a workstream id" },
};

/**
 * What is wrong with one link target for its kind.
 *
 * @param kind what the link points at
 * @param target the identity it names
 * @returns the problem, or `undefined` when the target is canonical for its kind
 */
export function linkTargetProblem({ kind, target }: { kind: WorkstreamLinkKind; target: string }): string | undefined {
  const grammar = GRAMMAR[kind];
  if (grammar.pattern.test(target)) {
    return undefined;
  }
  return `a ${kind} link's target is ${grammar.shape}, not ${JSON.stringify(target)}`;
}
