/**
 * What the board says about the row an amending memory names — the one `memory` module importing
 * `src/handover`. `judgedCorpus.ts` loads it lazily, only when some leaf declares a row, because that closure
 * carries `typescript` itself and every `memory` verb and hook would otherwise pay for it on every run.
 *
 * **A `filed` ask is followed to the row it became.** `derivedRowState` maps a `filed` settlement to `done`, but
 * filing an ask means the change moved onto ANOTHER row, still open. Judged as-is, a memory naming the ask would
 * read "canon carries the change, delete this" while the build row had not started. The witness is followed
 * instead, bounded and cycle-safe; a chain that cannot be followed whole judges nothing.
 */
import type { Result } from "#lib/result.js";
import { isTerminalDocStatus } from "../../../handover/doc.js";
import {
  type DerivedRowReadError,
  type ReadableDerivedRowState,
  readDerivedRowState,
} from "../../../handover/rowState.js";
import type { AmendsRowState } from "../../../memory/types.js";
import { stateHomePaths } from "../../../stateHome.js";

/** How many `filed` witnesses are followed before the chain is called unreadable. */
const MAX_FILED_HOPS = 5;

/** One read of one row, injected so the mapping is testable over plain fakes. */
type RowReader = (args: { slug: string }) => Result<ReadableDerivedRowState, DerivedRowReadError>;

/** The judgement for a row the reader read whole and that was not filed onward. */
function stateOfReadRow({ row }: { row: ReadableDerivedRowState }): AmendsRowState {
  if (row.status === "done") {
    return { kind: "landed" };
  }
  if (isTerminalDocStatus(row.status)) {
    return { kind: "closed-unlanded", status: row.status };
  }
  return { kind: "live", status: row.status };
}

/** The judgement for a row the reader could not read; `declared` is whether it is the row the memory names. */
function stateOfReadError({ declared, error }: { declared: boolean; error: DerivedRowReadError }): AmendsRowState {
  switch (error.code) {
    case "ROW_MISSING":
      // The declared row itself missing is the finding; a filed witness missing is a broken chain.
      return declared ? { kind: "missing" } : { kind: "unreadable", why: error.message };
    case "ROW_UNREADABLE":
      return { kind: "unreadable", why: error.message };
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/**
 * The amendment state of one row, following `filed` settlements to the row each became.
 *
 * @param row the slug the memory declares
 * @param read reads one row's derived state
 * @returns the state; `unreadable` for a chain that loops, runs past {@link MAX_FILED_HOPS}, or names no witness
 * @internal exported for its unit test
 */
export function amendsRowStateOf({ row, read }: { row: string; read: RowReader }): AmendsRowState {
  const seen = new Set<string>();
  let slug = row;
  for (let hop = 0; hop <= MAX_FILED_HOPS; hop += 1) {
    if (seen.has(slug)) {
      return { kind: "unreadable", why: `the filed chain from ${row} loops back to ${slug}` };
    }
    seen.add(slug);
    const result = read({ slug });
    if (result.isErr()) {
      return stateOfReadError({ declared: slug === row, error: result.error });
    }
    if (result.value.settlement !== "filed") {
      return stateOfReadRow({ row: result.value });
    }
    if (result.value.settlementWitness === undefined) {
      return { kind: "unreadable", why: `${slug} was settled filed with no witness naming the row it became` };
    }
    slug = result.value.settlementWitness;
  }
  return { kind: "unreadable", why: `the filed chain from ${row} runs past ${String(MAX_FILED_HOPS)} hops` };
}

/**
 * A resolver over the real board in a state home.
 *
 * @param home the `$SLOPWEAVER_HOME` to read; `undefined` for the ambient one
 * @returns the per-row resolver `withAmendsRowStates` takes
 */
export function boardRowStateResolver({
  home,
}: {
  home: string | undefined;
}): (args: { row: string }) => AmendsRowState {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  const read: RowReader = ({ slug }) =>
    readDerivedRowState({ handoverDir: paths.handovers, runsDir: paths.runs, slug });
  return ({ row }) => amendsRowStateOf({ read, row });
}
