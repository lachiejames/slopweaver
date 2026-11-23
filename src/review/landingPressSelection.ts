/**
 * Which pressable rows one `github landing --press` invocation presses, and which it leaves for the next one.
 *
 * What is ready to merge now is pressed ready to merge: that is one of the things the supervisor does. MEASURED:
 * seven approved dependency bumps were ready and it took three invocations, because one global cap of three
 * presses per invocation stopped each pass with "run it again". The owner's standing rule (`AGENTS.md`
 * rule 1) already settles those presses: every dependency bump PR and nearly every slopweaver PR is
 * auto-merged. A cap that makes the chair re-run a decision the owner made in advance is a
 * throttle on the owner's word, not a safety.
 *
 * So the cap survives only where it still protects something: a pressable row that is NOT the owner's — a colleague's
 * pull request an unscoped `--repo` read reached — is capped per REPOSITORY, so a wide read still cannot turn
 * into an unattended landing wave over other people's work. A row that is not GREEN never reaches this module
 * at all: {@link pressable} requires all six landing tests to have passed, and this module selects only from
 * its answer rather than restating it.
 *
 * Its own module rather than a function in `./landing.ts` because `./bumpSelection.ts` imports that file's
 * `LandingRow`, so `./landing.ts` cannot import {@link bumpSignalFor} back.
 *
 * Pure. No network, no clock, no filesystem.
 */

import type { DependencyBotActors } from "../organisation/dependencyBots.js";
import { bumpSignalFor } from "./bumpSelection.js";
import { type LandingRow, pressable } from "./landing.js";

/** One invocation's press set, split into what it presses and what the per-repository cap held back. */
export interface LandingPressPartition {
  /** Every row this invocation presses, in {@link pressable}'s order. */
  readonly toPress: readonly LandingRow[];
  /** Rows that are not the owner's, past their repository's cap — reported, never silently dropped. */
  readonly capped: readonly LandingRow[];
}

/**
 * Whether a pressable row is covered by the owner's standing auto-merge rule.
 *
 * The owner's when the read was scoped to the owner's own pull requests (`--author @me`), or when the row is a dependency bump
 * by ANY of `./bumpSelection.ts`'s three signals — title included, because that module is the one definition
 * of a bump and a second, narrower one here would be the drift it exists to prevent.
 *
 * @param row the pressable row
 * @param authoredByOwner whether this invocation's read was `--author @me`
 * @param bots the dependency-bot identities this install recognises
 * @returns true when the row presses uncapped
 */
export function isOwnerToPress({
  row,
  authoredByOwner,
  bots,
}: {
  row: LandingRow;
  authoredByOwner: boolean;
  bots: DependencyBotActors;
}): boolean {
  return authoredByOwner || bumpSignalFor({ bots, row }) !== undefined;
}

/**
 * Every pressable row of the owner's, plus at most `nonOwnerCapPerRepo` of anybody else's in each repository.
 *
 * A row of the owner's never spends a repository's allowance, so a bump sitting between four colleagues' rows is
 * pressed alongside three of them rather than displacing one.
 *
 * @param rows every row the read produced; {@link pressable} is applied here, never by the caller
 * @param authoredByOwner whether this invocation's read was `--author @me`
 * @param nonOwnerCapPerRepo how many rows that are not the owner's one repository may press in one invocation
 * @param bots the dependency-bot identities this install recognises, whose bumps press uncapped
 * @returns the rows to press and the rows the cap held back, each in {@link pressable}'s order
 */
export function partitionPressableRows({
  rows,
  authoredByOwner,
  nonOwnerCapPerRepo,
  bots,
}: {
  rows: readonly LandingRow[];
  authoredByOwner: boolean;
  nonOwnerCapPerRepo: number;
  bots: DependencyBotActors;
}): LandingPressPartition {
  const toPress: LandingRow[] = [];
  const capped: LandingRow[] = [];
  // One entry per press of anybody else's, by repository — a count with no absent case to default.
  const spent: string[] = [];
  for (const row of pressable({ rows })) {
    if (isOwnerToPress({ authoredByOwner, bots, row })) {
      toPress.push(row);
      continue;
    }
    // GitHub names are case-insensitive, so one repository is one allowance however the read spelled it.
    const repository = row.repoSlug.toLowerCase();
    if (spent.filter((pressed) => pressed === repository).length >= nonOwnerCapPerRepo) {
      capped.push(row);
      continue;
    }
    spent.push(repository);
    toPress.push(row);
  }
  return { capped, toPress };
}
