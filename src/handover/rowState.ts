/**
 * ONE ROW'S DERIVED STATUS, read without composing the board — what a hand step's evidence retraction reads.
 *
 * `slopweaver handover row` answers the same question and costs about a second, because it composes the row's
 * whole `blockedBy` closure and its probe sweep. None of that reaches the status: `composeBoardModels` takes
 * `derived.status` straight from {@link derivedRowState} over the doc and its journal, so this reads exactly
 * those two files and nothing else. The console polls `hand list` every 20 seconds, and this runs inside it
 * once per distinct row an open step names (measured 0.25 ms per warm read, against 0.91–1.13 s
 * for `handover row`).
 *
 * **It never answers on partial evidence.** A doc that is there and will not read, and a journal with any line
 * that did not decode, are both UNREADABLE rather than read around — a status derived from half a journal
 * could miss the `closed` event that is the whole point, or find one that a later line reopened.
 */
import { err, ok, type Result } from "#lib/result.js";

import { derivedRowState } from "./derivedRowState.js";
import type { DocStatus } from "./doc.js";
import type { AskSettlement } from "./rowKind.js";
import { isSafeSlug, readRunJournal } from "./runStore.js";
import { readExactDoc } from "./store.js";

/** A row the reader could read whole, and the status the board derives for it. */
export interface ReadableDerivedRowState {
  readonly slug: string;
  readonly status: DocStatus;
  /**
   * The status the doc itself DECLARES, before any settlement or journal event derives over it — `unknown` when the
   * parser could not read it. A `filed` settlement derives `done` whatever was authored, so a reader that must not
   * act on a damaged row reads this, not {@link status}.
   */
  readonly authoredStatus: DocStatus;
  /** True when the doc was found under `archive/` — off the board, so it stands for nothing open whatever it declares. */
  readonly archived: boolean;
  /** How the row was settled, if it was — what a recipe's failure hold reads to decide whether it lifts. */
  readonly settlement: AskSettlement | undefined;
  /** The settlement's witness — for `filed`, the row the ask was filed as. */
  readonly settlementWitness: string | undefined;
}

/** No doc carries the slug, live or archived. */
interface MissingDerivedRowError {
  readonly code: "ROW_MISSING";
  readonly message: string;
  readonly slug: string;
}

/** A doc or journal is there and did not read whole, so nothing it says can be acted on. */
interface UnreadableDerivedRowError {
  readonly code: "ROW_UNREADABLE";
  readonly message: string;
  readonly slug: string;
  readonly why: string;
}

/** Every way reading one row's derived status fails. */
export type DerivedRowReadError = MissingDerivedRowError | UnreadableDerivedRowError;

/** Constructors for {@link DerivedRowReadError}. */
export const DerivedRowReadErrors = {
  missing: ({ slug }: { slug: string }): MissingDerivedRowError => ({
    code: "ROW_MISSING",
    message: `no doc carries the board row ${slug}, live or archived`,
    slug,
  }),
  unreadable: ({ slug, why }: { slug: string; why: string }): UnreadableDerivedRowError => ({
    code: "ROW_UNREADABLE",
    message: `the board row ${slug} did not read whole — ${why}`,
    slug,
    why,
  }),
} as const;

/**
 * The status the board derives for one row, from its doc and journal alone.
 *
 * @param handoverDir the top-level handovers directory
 * @param runsDir the run-journal directory
 * @param slug the row asked for
 * @returns the derived status, or why there is no trustworthy one
 */
export function readDerivedRowState({
  handoverDir,
  runsDir,
  slug,
}: {
  handoverDir: string;
  runsDir: string;
  slug: string;
}): Result<ReadableDerivedRowState, DerivedRowReadError> {
  if (!isSafeSlug({ slug })) {
    return err(DerivedRowReadErrors.unreadable({ slug, why: "the slug is not one the run store can open" }));
  }
  const found = readExactDoc({ handoverDir, slug });
  if (found.isErr()) {
    return err(DerivedRowReadErrors.unreadable({ slug, why: found.error.message }));
  }
  if (found.value === undefined) {
    return err(DerivedRowReadErrors.missing({ slug }));
  }
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    return err(DerivedRowReadErrors.unreadable({ slug, why: `its run journal: ${journal.error.message}` }));
  }
  if (journal.value.unreadable.length > 0) {
    return err(
      DerivedRowReadErrors.unreadable({
        slug,
        why: `${String(journal.value.unreadable.length)} run-journal line(s) did not decode`,
      }),
    );
  }
  const derived = derivedRowState({ doc: found.value.doc, events: journal.value.events });
  return ok({
    archived: found.value.archived,
    authoredStatus: found.value.doc.status,
    settlement: derived.settlement,
    settlementWitness: derived.settlementWitness,
    slug,
    status: derived.status,
  });
}
