/**
 * The merge hold's injectable edges, and the shared LOOK at the hold document every landing verb reads —
 * `github hold`, `github merge`, `github enqueue` and `github push`. A leaf: it imports nothing from
 * `./holdRun.ts`, which is the `github hold` / `github release` verb shell built on top of it.
 *
 * ## Nothing polls a hold — somebody LOOKS at it
 *
 * There is no timer here and no resident process. A hold crosses its staleness threshold silently, and the
 * warning reaches the supervisor stream the first time any surface reads the document past that point:
 * `github hold --status`, which the supervisor's own sweep runs every tick, a `github merge` or
 * `github enqueue` the hold refuses, or a `github push` whose `base-moved` refusal reads the hold to say
 * which lap to run next. {@link noteStaleHolds} is that observation, shared by all four so they can never
 * disagree about when a hold has stood too long — and it marks the hold, so the warning is published once
 * rather than once per reader.
 *
 * ## Every transition is journalled, and the journal is a RECORD rather than a lever
 *
 * `held`, `released` and `stale` each append one row to `hold-ledger.jsonl` (`outbound/github/holdLedger.ts`)
 * as well as publishing to the supervisor stream, so a hold's duration survives the release that deletes it
 * from the document. A ledger append that fails is narrated and swallowed on every path: the caller was
 * placing, releasing or refusing something, and failing THAT because an audit write did not land would be
 * strictly worse than carrying on with an incomplete record.
 */
import type { SupervisorEvent } from "../../../events/event.js";
import { publishSupervisorEvent } from "../../../events/store.js";
import { currentSessionId } from "../../../handover/runOwner.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { defaultSessionsDir, discoverSessions } from "../../../measurement/sessions.js";
import type { Measured } from "../../../measurement/status.js";
import { type HoldLedgerKind, type HoldLedgerRow, holdLedgerRow } from "../../../outbound/github/holdLedger.js";
import { appendHoldLedgerRow, readHoldLedgerRows } from "../../../outbound/github/holdLedgerStore.js";
import {
  type BaseMovedLane,
  holdFor,
  type MergeHold,
  staleHoldEvent,
  withStaleWarned,
} from "../../../outbound/github/mergeHold.js";
import { readMergeHolds, writeMergeHolds } from "../../../outbound/github/mergeHoldStore.js";
import { holderLiveness } from "./holdCore.js";

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface MergeHoldDeps {
  readonly readHolds: (args: { home: string }) => readonly MergeHold[];
  readonly writeHolds: (args: { holds: readonly MergeHold[]; home: string }) => Result<void>;
  /** Publishes to the supervisor stream, warning rather than throwing on a write failure. */
  readonly publish: (args: { event: SupervisorEvent; home: string }) => void;
  /** Appends one transition to the hold journal, warning rather than throwing on a write failure. */
  readonly appendLedgerRow: (args: { row: HoldLedgerRow; home: string }) => Result<void>;
  /** The most recent journalled transitions, oldest first. */
  readonly readLedgerRows: (args: { home: string; limit: number }) => readonly HoldLedgerRow[];
  readonly nowIso: () => string;
  /** This visible session's id, for the `holder` field. */
  readonly sessionId: () => string | undefined;
  /** Whether a holding session is still live, or why that could not be measured. */
  readonly holderLive: (args: { holder: string }) => Measured<boolean>;
  readonly out: (args: { line: string }) => void;
}

/**
 * The production edges.
 *
 * @returns the real hold document, clock, session id, stream publisher and output sink
 */
export function productionMergeHoldDeps(): MergeHoldDeps {
  return {
    appendLedgerRow: ({ row, home }) => appendHoldLedgerRow({ home, row }),
    holderLive: ({ holder }) =>
      holderLiveness({ holder, roster: discoverSessions({ sessionsDir: defaultSessionsDir() }) }),
    nowIso: () => new Date().toISOString(),
    out: ({ line }) => {
      logger.out({ line });
    },
    publish: ({ event, home }) => {
      const failure = publishSupervisorEvent({ event, home });
      if (failure !== undefined) {
        logger.warn({ msg: `supervisor stream: ${failure}` });
      }
    },
    readHolds: ({ home }) => readMergeHolds({ home }),
    readLedgerRows: ({ home, limit }) => readHoldLedgerRows({ home, limit }),
    sessionId: () => currentSessionId({ env: process.env }),
    writeHolds: ({ holds, home }) => writeMergeHolds({ holds, home }),
  };
}

/**
 * Append one transition to the hold journal, narrating rather than failing when the append does not land.
 *
 * Swallowed for the reason this file's header gives: every caller is doing something else — placing,
 * releasing, or refusing a merge — and an audit write is not worth failing that for. The warning is printed
 * so an incomplete journal is visible rather than silent.
 *
 * @param deps the injectable edges
 * @param hold the hold this transition is about
 * @param home the state home the journal lives in
 * @param kind which transition
 * @param nowIso when it happened
 * @param sha the landed commit, on a release that knows one
 */
export function journal({
  deps,
  hold,
  home,
  kind,
  nowIso,
  sha,
}: {
  deps: MergeHoldDeps;
  hold: MergeHold;
  home: string;
  kind: HoldLedgerKind;
  nowIso: string;
  sha?: string | undefined;
}): void {
  const appended = deps.appendLedgerRow({ home, row: holdLedgerRow({ hold, kind, nowIso, sha }) });
  if (appended.isErr()) {
    deps.out({ line: `warning: ${appended.error.join("; ")}` });
  }
}

/**
 * Publish a `stale` warning for every hold that has crossed its threshold without one, and mark them.
 *
 * Called by every surface that reads the document, which is what makes the warning happen at all — see this
 * file's header. A write failure is narrated and swallowed: the caller was doing something else (reporting
 * status, or refusing a merge), and failing THAT because an observability write did not land would be
 * strictly worse than carrying on.
 *
 * @param deps the injectable edges
 * @param holds the holds just read
 * @param home the state home the document lives in
 * @returns the holds as they now stand, with any newly-warned ones marked
 */
export function noteStaleHolds({
  deps,
  holds,
  home,
}: {
  deps: MergeHoldDeps;
  holds: readonly MergeHold[];
  home: string;
}): readonly MergeHold[] {
  const nowIso = deps.nowIso();
  const events = holds.map((hold) => staleHoldEvent({ hold, nowIso }));
  if (events.every((event) => event === undefined)) {
    return holds;
  }
  for (const event of events) {
    if (event !== undefined) {
      deps.publish({ event, home });
    }
  }
  for (const [index, hold] of holds.entries()) {
    if (events[index] !== undefined) {
      journal({ deps, hold, home, kind: "stale", nowIso });
    }
  }
  const marked = holds.map((hold, index) => (events[index] === undefined ? hold : withStaleWarned({ hold, nowIso })));
  const written = deps.writeHolds({ holds: marked, home });
  if (written.isErr()) {
    deps.out({ line: `warning: ${written.error.join("; ")}` });
  }
  return marked;
}

/**
 * The lane a `base-moved` refusal needs to name the lap that lands: this repository's standing hold, if any,
 * plus the clock and session the remedy is written against.
 *
 * It lives beside the hold's other edges rather than in `push`, because reading the document is a LOOK at
 * the hold — a stale one warns from here exactly as it does at `hold --status` and at `merge`, and putting
 * the read anywhere else would mean a second copy of that rule.
 *
 * @param deps injectable hold edges, so a caller with no document still gets a lane
 * @param home the state home holding the hold document
 * @param repo the `owner/name` slug whose hold decides the remedy
 * @returns the lane, with `hold` undefined when nothing stands over that repository
 */
export function readBaseMovedLane({
  deps,
  home,
  repo,
}: {
  deps: MergeHoldDeps;
  home: string;
  repo: string;
}): BaseMovedLane {
  return {
    hold: holdFor({ holds: noteStaleHolds({ deps, holds: deps.readHolds({ home }), home }), repo }),
    nowIso: deps.nowIso(),
    repo,
    sessionId: deps.sessionId(),
  };
}
