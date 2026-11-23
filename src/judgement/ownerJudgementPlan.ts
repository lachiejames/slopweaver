/**
 * How a memory event becomes the exact set of state transitions one owner-judgement transaction applies. Zero
 * I/O, and the planning half of the pure core: `./ownerJudgementRecords.ts` holds the stored shapes and the
 * ACTIVE projection this reads, `./ownerDirectiveStore.ts` orders the steps.
 *
 * ## A memory event is merged by the domain, then diffed into transitions
 *
 * The existing merges (`./ownerDirective.ts`) keep owning the rules — file ownership, the id spaces, the bounds —
 * over the overlay the active rows project to. The difference between that overlay and the merged one is the
 * write: every id whose version changed or vanished has its active version retired, and every changed or new one
 * gains an active version. An unchanged event is an empty transition, so nothing is written for it.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { MemoryLeaf } from "../memory/types.js";

import { type OwnerDirectiveError, OwnerDirectiveErrors } from "./ownerDirective.errors.js";
import {
  mergeOwnerCorrections,
  mergeOwnerDirectives,
  type OwnerCorrection,
  type OwnerDirective,
  type OwnerDirectiveMemoryChange,
  type OwnerDirectiveOverlay,
  type OwnerDirectiveRemoval,
  ownerDirectiveChangeFromMemory,
} from "./ownerDirective.js";
import {
  type OwnerDirectiveChanges,
  type OwnerDirectiveSyncOutcome,
  type OwnerJudgementTransition,
  overlayOfActiveRows,
  type StoredOwnerJudgement,
} from "./ownerJudgementRecords.js";

/**
 * Fold one change into the accumulator — an EXHAUSTIVE switch, deliberately.
 *
 * This used to be two `flatMap`s with a ternary each, and when the `upsert-correction` arm was added they
 * silently dropped it: the type gained a case, nothing failed to compile, and corrections would have been
 * parsed, validated and then thrown away with no error anywhere. The `never` binding in `default` is what
 * turns the next added arm into a compile error instead of a silent loss.
 */
function foldChange({
  change,
  into,
}: {
  change: OwnerDirectiveMemoryChange;
  into: { directives: OwnerDirective[]; corrections: OwnerCorrection[]; removals: OwnerDirectiveRemoval[] };
}): void {
  switch (change.kind) {
    case "ignore":
      return;
    case "remove":
      into.removals.push({ id: change.id, sourceFile: change.sourceFile });
      return;
    case "upsert":
      into.directives.push(change.directive);
      return;
    case "upsert-correction":
      into.corrections.push(change.correction);
      return;
    default: {
      const unhandled: never = change;
      throw new Error(`unhandled owner-directive change: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * Convert observed leaves, collecting every invalid explicit directive or revocation in one refusal.
 *
 * @param leaves the memory leaves one hook event observed
 * @returns the changes they ask for, or every leaf's refusal at once
 */
export function changesFromMemory({
  leaves,
}: {
  leaves: readonly MemoryLeaf[];
}): Result<OwnerDirectiveChanges, OwnerDirectiveError> {
  const into = {
    corrections: [] as OwnerCorrection[],
    directives: [] as OwnerDirective[],
    removals: [] as OwnerDirectiveRemoval[],
  };
  const causes: OwnerDirectiveError[] = [];
  for (const leaf of leaves) {
    const converted = ownerDirectiveChangeFromMemory({ leaf });
    if (converted.isErr()) {
      causes.push(converted.error);
    } else {
      foldChange({ change: converted.value, into });
    }
  }
  return causes.length > 0
    ? err(OwnerDirectiveErrors.memoryInvalid({ causes }))
    : ok({ corrections: into.corrections, directives: into.directives, removals: into.removals });
}

/**
 * Whether a memory event asks for nothing at all.
 *
 * @param changes the event's changes
 * @returns true when it carries no upsert and no removal
 */
export function noChanges({ changes }: { changes: OwnerDirectiveChanges }): boolean {
  return changes.directives.length === 0 && changes.corrections.length === 0 && changes.removals.length === 0;
}

/** Whether two directives are the same version: every field the overlay carries agrees. */
function sameDirective({ left, right }: { left: OwnerDirective; right: OwnerDirective }): boolean {
  return (
    left.text === right.text &&
    left.source.file === right.source.file &&
    left.source.contentHash === right.source.contentHash &&
    left.source.modified === right.source.modified
  );
}

/** Whether two corrections are the same version, subject URL included. */
function sameCorrection({ left, right }: { left: OwnerCorrection; right: OwnerCorrection }): boolean {
  return (
    left.text === right.text &&
    left.source.file === right.source.file &&
    left.source.contentHash === right.source.contentHash &&
    left.source.modified === right.source.modified &&
    left.subject.source === right.subject.source &&
    left.subject.container === right.subject.container &&
    left.subject.sourceId === right.subject.sourceId &&
    left.subject.url === right.subject.url
  );
}

/**
 * The retire/activate pair for one id space: an id whose version changed retires and re-activates, a vanished id
 * only retires, a new one only activates.
 *
 * @returns the ids to retire and the values to activate, each in id order
 */
function diffById<T extends { readonly id: string }>({
  before,
  after,
  same,
}: {
  before: readonly T[];
  after: readonly T[];
  same: (pair: { left: T; right: T }) => boolean;
}): { readonly retire: readonly string[]; readonly activate: readonly T[] } {
  const prior = new Map(before.map((value) => [value.id, value]));
  const next = new Map(after.map((value) => [value.id, value]));
  const retire: string[] = [];
  const activate: T[] = [];
  for (const [id, value] of prior) {
    const replacement = next.get(id);
    if (replacement === undefined || !same({ left: value, right: replacement })) {
      retire.push(id);
    }
  }
  for (const [id, value] of next) {
    const current = prior.get(id);
    if (current === undefined || !same({ left: current, right: value })) {
      activate.push(value);
    }
  }
  return { activate, retire };
}

/**
 * The transitions that turn one overlay into another.
 *
 * @param before what the active versions project to now
 * @param after the overlay a memory event merged
 * @returns the transitions, empty when the two agree
 */
export function transitionBetween({
  before,
  after,
}: {
  before: OwnerDirectiveOverlay;
  after: OwnerDirectiveOverlay;
}): OwnerJudgementTransition {
  const directives = diffById({ after: after.directives, before: before.directives, same: sameDirective });
  const corrections = diffById({ after: after.corrections, before: before.corrections, same: sameCorrection });
  return {
    activateCorrections: corrections.activate,
    activateDirectives: directives.activate,
    retireCorrections: corrections.retire,
    retireDirectives: directives.retire,
  };
}

/**
 * Whether a transition writes nothing.
 *
 * @param transition the planned transition
 * @returns true when no version retires or activates
 */
export function isEmptyTransition({ transition }: { transition: OwnerJudgementTransition }): boolean {
  return (
    transition.retireDirectives.length === 0 &&
    transition.activateDirectives.length === 0 &&
    transition.retireCorrections.length === 0 &&
    transition.activateCorrections.length === 0
  );
}

/**
 * Plan one memory event against the stored versions: project, merge with the domain's own rules, diff.
 *
 * Directives first, then corrections over the result: a removal names an id, and applying it to both id spaces in
 * one pass would let a revoked directive silently take a same-named correction with it — the merges' own order.
 *
 * @param stored both tables as read inside the writing transaction
 * @param changes the event's changes
 * @returns the transition and the outcome it reports, or the refusal (a conflict, a bound, an unreadable row)
 */
export function planMemorySync({
  stored,
  changes,
}: {
  stored: StoredOwnerJudgement;
  changes: OwnerDirectiveChanges;
}): Result<
  { readonly transition: OwnerJudgementTransition; readonly answer: OwnerDirectiveSyncOutcome },
  OwnerDirectiveError
> {
  const before = overlayOfActiveRows({ stored });
  if (before.isErr()) {
    return err(before.error);
  }
  const mergedDirectives = mergeOwnerDirectives({
    directives: changes.directives,
    overlay: before.value,
    removals: changes.removals,
  });
  if (mergedDirectives.isErr()) {
    return err(mergedDirectives.error);
  }
  const merged = mergeOwnerCorrections({
    corrections: changes.corrections,
    overlay: mergedDirectives.value,
    removals: changes.removals,
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const transition = transitionBetween({ after: merged.value, before: before.value });
  const kind = isEmptyTransition({ transition }) ? "unchanged" : "written";
  return ok({ answer: { directiveCount: merged.value.directives.length, kind }, transition });
}
