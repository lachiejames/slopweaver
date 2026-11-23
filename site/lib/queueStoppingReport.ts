/**
 * The chair's report of the Queue cards that STOP the owner's work — a card blocking the owner's priorities, which the
 * owner's Queue leads with, and a stopped automation, which follows those priorities — so the chat update names them
 * in the Queue's one order (`./queueFocus.ts` `queueOrdered`), placed as `./queueStopping.ts` places them.
 *
 * The same readers, `rowsOf`, `partitionQueueRows` and `withStopping` the page runs, so a card the page leads with is a
 * card this report names — never a second copy of the predicate. `app/api/queue-stopping/route.ts` serves it,
 * `slopweaver queue stopping --json` reads it, and the supervisor tick's digest prints its leader first.
 *
 * **An unread register is never "nothing stops".** Without the hands, no marked step can be seen; without the board, no
 * ask exists; without the owner's outcomes register, no focus — so any of them unread makes the report `complete: false`, the
 * cards still listed as a lower bound. So does one hand step that did not read whole, or one board file the scan could
 * not read: neither can say it stops nothing.
 *
 * Pure: readings in, report out. The route is the effectful shell around it.
 */

import type { Result } from "neverthrow";

import { readBoard, readHandSteps } from "../components/live/read";
import type { LiveState } from "../components/live/useLive";
import type { LiveResult } from "./liveVerbRun";
import {
  ORGANISATION_SLUG,
  type PlacementOrganisation,
  type PlacementOrganisationError,
} from "./placementOrganisation";
import { queueFocuses, queueOrdered } from "./queueFocus";
import { type QueueRow, rowsOf } from "./queueRows";
import { stoppingFold, withStopping } from "./queueStopping";
import { partitionQueueRows } from "./queueWithholding";
import { placementWaits } from "./registerPlacement";
import { buildWorkspacePlacer } from "./workspacePlacement";
import { readWorkstreamsReading } from "./workstreamsReading";

/** Each register the report reads, by the allowlist slug the Queue page reads it under (`./liveVerbs.ts`). */
export const STOPPING_REGISTER_SLUGS = { board: "board", hands: "hands", workstreams: "workstreams" } as const;

/** One register the report reads. */
export type StoppingRegister = keyof typeof STOPPING_REGISTER_SLUGS;

/** The registers in the order the report names an unread one. */
const REGISTERS: readonly StoppingRegister[] = ["hands", "board", "workstreams"];

/** What the live runner answered for each register. */
export type StoppingResults = { readonly [K in StoppingRegister]: LiveResult };

/** A register the report could not read, and why. */
export interface StoppingUnread {
  readonly source: string;
  readonly why: string;
}

/** One card stopping the owner's work, as the chair names it. */
export interface StoppingCardReport {
  readonly key: string;
  readonly kind: string;
  /** The card's own question, as the owner's Queue heads it. */
  readonly question: string;
  /** A monitor marked it as stopping the owner's work, or it blocks a focus workstream's row. */
  readonly reason: "marked" | "blocks-focus";
  /** The decision drawn on its row, or `null` on a card that records none. */
  readonly problem: string | null;
  readonly options: readonly { readonly letter: string; readonly sentence: string }[];
}

/** The report `GET /api/queue-stopping` answers with. */
export interface QueueStoppingReport {
  readonly observedAtIso: string;
  /** False whenever a register went unread: the list is then a lower bound, never a zero. */
  readonly complete: boolean;
  readonly unread: readonly StoppingUnread[];
  /** Every card stopping the owner's work, in the order the owner's Queue draws them — the first is the one it leads with. */
  readonly stopping: readonly StoppingCardReport[];
}

/**
 * One register's reading as the Queue holds it, through the same reader, so a payload the page would refuse is refused
 * here too.
 *
 * @returns the ready reading, or not-measured with the reason
 */
function liveStateOf<T>({
  slug,
  result,
  read,
}: {
  slug: string;
  result: LiveResult;
  read: (payload: unknown) => T | undefined;
}): LiveState<T> {
  if (!result.ok) {
    return { phase: "not-measured", why: result.notMeasured };
  }
  const value = read(result.payload);
  if (value === undefined) {
    return { phase: "not-measured", why: `${slug} answered in a shape the Queue does not read` };
  }
  return {
    fixture: result.fixture,
    observedAtIso: result.observedAtIso,
    phase: "ready",
    stampedByRoute: result.stampedByRoute,
    value,
  };
}

/**
 * The report over the three registers' answers.
 *
 * Every card is placed by the organisation, so with no organisation read there is no card to name: the report says
 * so as an unread source, `organisation`, with the read's own sentence, and lists none — never cards placed against a
 * stand-in, and never "nothing stops".
 *
 * @param results what the runner answered for each register
 * @param observedAtIso when they were read
 * @param organisation the organisation read, or why it could not be
 * @returns the report
 */
export function queueStoppingReport({
  organisation,
  results,
  observedAtIso,
}: {
  organisation: Result<PlacementOrganisation, PlacementOrganisationError>;
  results: StoppingResults;
  observedAtIso: string;
}): QueueStoppingReport {
  const states = {
    board: liveStateOf({ read: readBoard, result: results.board, slug: STOPPING_REGISTER_SLUGS.board }),
    hands: liveStateOf({ read: readHandSteps, result: results.hands, slug: STOPPING_REGISTER_SLUGS.hands }),
    // No register yet is a READ answer — no outcome, so no focus — never an unread register (`./workstreamsReading.ts`).
    workstreams: liveStateOf({
      read: (payload) => readWorkstreamsReading({ payload }),
      result: results.workstreams,
      slug: STOPPING_REGISTER_SLUGS.workstreams,
    }),
  };
  let stopping: readonly QueueRow[] = [];
  if (organisation.isOk()) {
    const loading = { phase: "loading" } as const;
    const built = partitionQueueRows({
      rows: rowsOf({
        acts: loading,
        board: states.board,
        drafts: loading,
        hands: states.hands,
        // An import question is never a stopped automation nor a focus card, so the register is never read here.
        imports: loading,
        landing: loading,
        placer: buildWorkspacePlacer({ organisation: organisation.value }),
        posts: loading,
        reviewers: loading,
        reviews: loading,
        standing: loading,
      }),
    });
    const focuses = queueFocuses({ workstreams: states.workstreams });
    const placed = built.rows.filter((row) => !placementWaits({ board: states.board, row }));
    stopping = queueOrdered({ focuses, rows: withStopping({ board: states.board, focuses, rows: placed }) }).filter(
      (row) => row.stopping !== undefined && row.tier !== "check-in",
    );
  }
  const unread = REGISTERS.flatMap((register): StoppingUnread[] => {
    const state: LiveState<unknown> = states[register];
    if (state.phase === "ready") {
      return [];
    }
    let why = "never read";
    if (state.phase === "not-measured") {
      why = state.why;
    }
    return [{ source: STOPPING_REGISTER_SLUGS[register], why }];
  });
  // A step that did not read whole cannot say whether it stops the owner's work, so the hands were not read whole either:
  // the list is a lower bound, never "nothing stops".
  // A line the reader dropped outright — no id, sentence or posting instant — is the same unknown.
  if (states.hands.phase === "ready" && results.hands.ok && Array.isArray(results.hands.payload)) {
    const unreadable = states.hands.value.filter((step) => step.unreadable !== undefined);
    const dropped = results.hands.payload.length - states.hands.value.length;
    const reasons = [
      ...(unreadable.length > 0
        ? [
            `${String(unreadable.length)} step(s) did not read whole (${[...new Set(unreadable.map((step) => step.unreadable))].join(", ")})`,
          ]
        : []),
      ...(dropped > 0 ? [`${String(dropped)} line(s) carried no step to read`] : []),
    ];
    if (reasons.length > 0) {
      unread.push({
        source: STOPPING_REGISTER_SLUGS.hands,
        why: `${reasons.join(" and ")}, so whether they stop the owner's work is unknown`,
      });
    }
  }
  // A board file the scan could not read, or one it had not resolved by its deadline, may hold the ask that blocks the owner's
  // focus, so each is the same unknown.
  if (states.board.phase === "ready") {
    const { unreadable, unresolved } = states.board.value;
    const missed = [
      ...(unreadable.length > 0
        ? [`${String(unreadable.length)} file(s) did not read (${unreadable.join(", ")})`]
        : []),
      ...(unresolved > 0 ? [`${String(unresolved)} document(s) were not resolved before the scan's deadline`] : []),
    ];
    if (missed.length > 0) {
      unread.push({
        source: STOPPING_REGISTER_SLUGS.board,
        why: `${missed.join(" and ")}, so whether they hold a card stopping the owner's work is unknown`,
      });
    }
  }
  if (organisation.isErr()) {
    unread.push({ source: ORGANISATION_SLUG, why: organisation.error.message });
  }
  return {
    complete: unread.length === 0,
    observedAtIso,
    stopping: stopping.map((row): StoppingCardReport => {
      const fold = stoppingFold({ card: row.card });
      let reason: StoppingCardReport["reason"] = "blocks-focus";
      if (row.stopping?.reason === "marked") {
        reason = "marked";
      }
      return {
        key: row.key,
        kind: row.kind,
        options: fold === undefined ? [] : fold.options,
        problem: fold === undefined ? null : fold.problem,
        question: row.card.question,
        reason,
      };
    }),
    unread,
  };
}
