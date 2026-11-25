"use client";

import { type ReactElement, useMemo, useState } from "react";

import { doctrineGlanceOf, doctrineInputOf } from "../../lib/fleetDoctrineInput";
import { fleetGlanceOf } from "../../lib/fleetGlance";
import { badgeReadAtOf } from "../../lib/fleetHistory";
import { fleetStateOf } from "../../lib/fleetState";
import { openOrderOf } from "../../lib/fleetViews";
import { nowSeatsOf } from "../../lib/nowSeats";
import { provenNowOf } from "../../lib/pageEmpty";
import { parkedWaitsOf } from "../../lib/parkedWaits";
import { fleetUsageOf, type UsageRead } from "../../lib/planMeters";
import { raiseHeldOf } from "../../lib/planUsageLimit";
import { quotesBySlug } from "../../lib/steerStanding";
import { unreadReadingsOf } from "../../lib/unreadReadings";
import { workingSessionsOf } from "../../lib/workingSessions";
import { PageEmpty } from "../console/PageEmpty";
import { useNow } from "../console/QueueSections";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { StaleMark } from "../console/StaleMark";
import { FleetDoctrinePanel } from "./FleetDoctrinePanel";
import { StaleReadings } from "./LiveMarks";
import { MachineHealthLine } from "./MachineHealth";
import { BoardGap } from "./NowBoardGap";
import { NowLiveMachine } from "./NowLiveMachine";
import { type ParkedBandState, StateBand } from "./NowStateBand";
import { type Board, readBoard } from "./read";
import { readFleetBurnReading } from "./readFleetBurn";
import { readFleetHistory } from "./readFleetHistory";
import { type FleetWhy, readFleetWhyReading, readSeatCeilingReading, whyOfTick } from "./readGlance";
import type { BoardRowQuote } from "./readHisWords";
import { isReadingNotRecorded, type Reading, type RecordedReading } from "./reading";
import { readCapacityReading, readSeatsReading, type Seats } from "./readNow";
import { readWakeReading, type WakeCiReading } from "./readWakeReading";
import { type Reconcile, readReconcileReading } from "./readWorkstreams";
import { TILE_LIST, TILES, Tile } from "./Tile";
import { useFleetOpeningRefresh } from "./useFleetOpeningRefresh";
import { type LiveState, readyValueOf, useLive } from "./useLive";
import { WorkingSessions } from "./WorkingSessions";

/**
 * The fast lane's poll interval, the same twenty seconds the console uses.
 *
 * Every reading here but one comes off the readings ledger, never the verb: `reading last` is a file read. The
 * documents it carries were taken by the supervisor tick, or — for the seats and the burn — by this page's own
 * opening refresh through the sync route (`useFleetOpeningRefresh.ts`), once per opening and never on this poll
 * (`liveVerbs.ts` says why a drain must not run on a page's timer). Twenty seconds is therefore a cadence for noticing
 * a NEW reading, not a cost the machine pays. The live machine and the `machine series` sample Now keeps asking for
 * are `NowLiveMachine`'s own.
 */
const FAST_POLL_MS = 20_000;

/**
 * How often the history fold re-reads `fleet history`, so its newest span follows the badge to the next tick rather
 * than staying at the one the page opened on. Five minutes: the supervisor ticks every quarter hour or so, and one
 * read is a cold CLI start plus a backward read of a day of the tick ledger, 4.6s on a 250 MB ledger (`time slopweaver
 * fleet history --hours 24 --json`) — a cost a page left open should not pay every twenty seconds.
 */
const HISTORY_POLL_MS = 300_000;

/** The owner's words, with the anchor they were said at, by board row slug — what the glance judges alignment by. */
type Words = ReadonlyMap<string, BoardRowQuote>;

/**
 * A channel as the usage block reads it: in flight, failed with the route's reason, or the part of its value the
 * block draws — so a figure off a reading not yet in hand is a spinner or a staleness mark, never a sentence.
 *
 * @param pick the part of a ready reading the block draws
 * @returns the read
 */
function usageReadOf<T, V>({ state, pick }: { state: LiveState<T>; pick: (value: T) => V }): UsageRead<V> {
  if (state.phase === "ready") {
    return { phase: "ready", value: pick(state.value) };
  }
  if (state.phase === "loading") {
    return { phase: "loading" };
  }
  return { phase: "not-measured", why: state.why };
}

/**
 * The fleet's state over every open seat, joined to the board the same tick reconciled, then the working sessions as
 * cards, with the drain's own diagnostics under them.
 *
 * @param seatParam the `?seat=<workspace id>` a link arrived with, opening that session's panel on load
 * @returns the tile
 */
function SeatsTile({
  fixture,
  seatParam,
}: {
  fixture: string | undefined;
  seatParam: string | undefined;
}): ReactElement {
  const [openedId, setOpenedId] = useState<string | undefined>(seatParam);
  // The capacity readings this page pressed a raise from: one raise per reading, held here rather than in a button,
  // which a press can unmount (`lib/planUsageLimit.ts` § RaiseRecord).
  const [pressedFrom, setPressedFrom] = useState<ReadonlySet<string>>(() => new Set());
  const state = useLive<RecordedReading<Seats>>({
    everyMs: FAST_POLL_MS,
    fixture,
    read: readSeatsReading,
    slug: "watch-reading",
  });
  const liveBoard = useLive<Reading<Reconcile>>({
    everyMs: FAST_POLL_MS,
    read: readReconcileReading,
    slug: "reconcile-reading",
  });
  // A fixture freezes the seats, and no board capture is committed beside them — so a frozen seat list is
  // never joined to this machine's live board, and the gap line says why. The seats state's own marker is
  // checked as well as the URL, because a channel keeps its last frozen value for a render after the query
  // is gone.
  const seatsFrozen = fixture !== undefined || (state.phase === "ready" && state.fixture !== undefined);
  let reconcile: LiveState<Reading<Reconcile>> = liveBoard;
  if (seatsFrozen) {
    reconcile = { phase: "not-measured", why: "no board capture is committed beside a fixture's seats" };
  }
  // The owner's words behind each seat's row, off the board channel the voice already polls on every page — what the glance
  // judges whether the fleet is on the owner's steers by — and the rows parked on CI or a clock, which the working count omits.
  const boardState = useLive<Board>({ read: readBoard, slug: "board" });
  const boardRows = readyValueOf({ state: boardState })?.rows;
  // The page's own clock, so "in 25m" keeps counting down on a page left open between board reads.
  const nowMs = useNow({ everyMs: FAST_POLL_MS });
  // What each CI park's pull request WAS when the tick's wake read it, so "on CI" is split into still running, finished,
  // merged and closed rather than taken off the board's word for it (measured: 57 on CI while only twenty were open).
  const wakeState = useLive<Reading<WakeCiReading>>({
    everyMs: FAST_POLL_MS,
    read: readWakeReading,
    slug: "wake-reading",
  });
  const wakeReading = readyValueOf({ state: wakeState });
  let parked: ParkedBandState = { kind: "loading" };
  if (seatsFrozen || boardState.phase === "not-measured") {
    parked = { kind: "unread" };
  } else if (boardState.phase === "ready") {
    parked = {
      kind: "ready",
      readAtIso: boardState.observedAtIso,
      value: parkedWaitsOf({ nowMs, rows: boardState.value.rows, wakeCi: wakeReading?.value }),
      wakeReadAtIso: wakeReading?.value.observedAtIso,
    };
  }
  const quotes = useMemo((): Words | undefined => {
    if (boardRows === undefined) {
      return undefined;
    }
    return quotesBySlug({ rows: boardRows });
  }, [boardRows]);
  // The two readings the glance adds: the machine's hold and the plans' ceilings, and the working seats the plans'
  // week carries. Both are the tick's own recording, so the glance judges the instant the supervisor did. A fixture
  // freezes both with the seats; one with no capture of its own reads as not measured rather than as today's.
  const capacityState = useLive({
    everyMs: FAST_POLL_MS,
    fixture,
    read: readCapacityReading,
    slug: "capacity-reading",
  });
  const ceilingState = useLive({
    everyMs: FAST_POLL_MS,
    fixture,
    read: readSeatCeilingReading,
    slug: "ceiling-reading",
  });
  // Each host's 24-hour burn and the Codex sessions drawing now. No fixture capture is committed for it, so a
  // fixture page draws the burn as not measured rather than as this machine's live one.
  const burnState = useLive({
    everyMs: FAST_POLL_MS,
    fixture,
    read: readFleetBurnReading,
    slug: "burn-reading",
  });
  // Opening the page takes its own seat and burn readings when the ones shown are missing or ten minutes old.
  useFleetOpeningRefresh({ burn: burnState, seats: state });
  // Why the fleet is not running more, as the same tick judged it. No fixture capture is committed for it either.
  const whyState = useLive({
    everyMs: FAST_POLL_MS,
    fixture,
    read: readFleetWhyReading,
    slug: "why-reading",
  });
  // The state's history, read when the page opens and again on its own slow cadence. A fixture page passes its name,
  // so it reads the fixture's own history capture — none is committed — and draws the fold as not read, never this
  // machine's live ticks.
  const historyState = useLive({
    everyMs: HISTORY_POLL_MS,
    fixture,
    read: readFleetHistory,
    slug: "fleet-history",
  });
  const capacity = readyValueOf({ state: capacityState });
  const ceiling = readyValueOf({ state: ceilingState });
  const whyReading = readyValueOf({ state: whyState });
  let why: FleetWhy | undefined;
  if (whyReading !== undefined && capacity !== undefined) {
    why = whyOfTick({ capacity, why: whyReading });
  }
  return (
    <>
      <NowLiveMachine
        boardRows={seatsFrozen ? undefined : boardRows}
        fixture={fixture}
        onOpen={(card) => {
          setOpenedId(card.key);
        }}
        reconcile={reconcile}
        seats={state}
      />
      <Tile title="Agents" state={state}>
        {(recorded) => {
          // No session check recorded yet is an answer, drawn as the page's designed empty state, never a failure.
          // A reading kept over a failed read proves nothing now, so neither empty state draws over one.
          const latestReadCurrent = provenNowOf({ state });
          if (isReadingNotRecorded(recorded) && !latestReadCurrent) {
            return <p className="sw-tile-note">no session check was recorded as of the last reading that answered</p>;
          }
          if (isReadingNotRecorded(recorded)) {
            return (
              <PageEmpty
                title="Fleet activity will appear here."
                appearsWhen="It appears after the supervisor records its first check of the working sessions."
                action={{ kind: "plans" }}
                surface="fleet-activity"
              />
            );
          }
          const reading = recorded;
          const seats = reading.value;
          const reconcileReading = readyValueOf({ state: reconcile });
          const view = nowSeatsOf({ reconcileReading, seatReading: reading });
          // A frozen capture's seats are never joined to this machine's live board, the same rule the reconcile keeps.
          let sessionBoardRows: typeof boardRows;
          if (!seatsFrozen) {
            sessionBoardRows = boardRows;
          }
          const sessions = workingSessionsOf({ boardRows: sessionBoardRows, reconcileReading, seatReading: reading });
          let order: ReturnType<typeof openOrderOf> | undefined;
          if (reconcileReading !== undefined) {
            order = openOrderOf({ reconcile: reconcileReading.value });
          }
          let nowIso = reading.observedAtIso;
          if (capacity !== undefined) {
            nowIso = capacity.observedAtIso;
          }
          const glance = fleetGlanceOf({
            capacity: capacity?.value,
            ceiling: ceiling?.value,
            nowIso,
            order,
            quotes,
            seats: seats.rows,
            view,
          });
          const fleetState = fleetStateOf({
            capacity: capacity?.value,
            glance,
            order,
            readAtIso: capacity?.observedAtIso,
            view,
          });
          // "Not measured" off a reading not in hand is a spinner or a staleness mark in the badge's place; the words stay
          // only when every reading the judgement stands on answered and it still could not judge.
          const inputs = unreadReadingsOf({
            readings: [
              { state: capacityState, subject: "the machine capacity reading" },
              { state: ceilingState, subject: "the plans' seat ceiling reading" },
              { state: reconcile, subject: "the board reconcile the seats are joined to" },
            ],
          });
          let unread: ReactElement | null = null;
          if (fleetState.kind === "not-measured" && inputs.loading.length > 0) {
            unread = <ReadingIndicator label="Reading what the fleet's state is judged from" />;
          } else if (fleetState.kind === "not-measured" && inputs.failed.length > 0) {
            unread = <StaleMark facts={inputs.failed} />;
          }
          return (
            <>
              <StaleReadings
                readings={[
                  { state: reconcile, subject: "the board reconcile the seats are joined to" },
                  { state: boardState, subject: "the board rows your words and the parked rows are read from" },
                  // A failed refresh keeps the last wake's split on the page, so it is marked like every input it rests on.
                  { state: wakeState, subject: "the wake reading the parked pull requests' states are read from" },
                  { state: capacityState, subject: "the machine capacity reading" },
                  { state: ceilingState, subject: "the plans' seat ceiling reading" },
                  { state: burnState, subject: "the fleet burn reading" },
                  { state: whyState, subject: "why the fleet is not running more" },
                ]}
                row
              />
              <StateBand
                badgeReadAtIso={badgeReadAtOf({
                  otherReadAtIsos: [capacity?.observedAtIso, ceiling?.observedAtIso, reconcileReading?.observedAtIso],
                  seatsReadAtIso: reading.observedAtIso,
                })}
                history={historyState}
                parked={parked}
                raises={{
                  onRaised: (readAtIso) => {
                    setPressedFrom((prior) => new Set([...prior, readAtIso]));
                  },
                  pressedFrom,
                  readAtIso: capacity?.observedAtIso,
                }}
                state={fleetState}
                usage={fleetUsageOf({
                  burn: usageReadOf({ pick: (burnReading) => burnReading.value, state: burnState }),
                  nowIso,
                  plans: usageReadOf({ pick: (capacityReading) => capacityReading.value.plans, state: capacityState }),
                  raiseHeld: raiseHeldOf({ fixture, state: capacityState }),
                  seats: seats.rows,
                })}
                unread={unread}
                usageReadAtIso={capacity?.observedAtIso}
                why={why}
              />
              {sessions.joinGap !== undefined && <BoardGap board={reconcile} reason={sessions.joinGap} />}
              <WorkingSessions
                onClose={() => {
                  setOpenedId(undefined);
                }}
                onOpen={(card) => {
                  setOpenedId(card.key);
                }}
                latestReadCurrent={latestReadCurrent}
                observedAtIso={reading.observedAtIso}
                openedKey={openedId}
                view={sessions}
              />
              {/* Under the sessions, one closed line: how many doctrine lines are red or amber, the five inside it. */}
              <FleetDoctrinePanel
                board={boardState}
                frozen={seatsFrozen}
                glance={doctrineGlanceOf({ capacity: capacityState, ceiling: ceilingState, glance })}
                reconcile={reconcile}
                // The tile's own narrowed reading, the one the glance above counts, so the two are never different readings.
                seats={doctrineInputOf({ pick: () => seats, state, subject: "session watch" })}
              />
              {seats.diagnostics.length > 0 && (
                <ul className={TILE_LIST}>
                  {seats.diagnostics.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </Tile>
    </>
  );
}

/**
 * The Fleet page's Now view: the machine read live every two seconds, then the fleet's state and what each working
 * session is on — one card each, the supervisor pinned first — with the one health line: the listener's grade and the
 * machine's capacity verdict.
 *
 * `?fixture=<name>` freezes the seats and the health line to a capture. No reconcile capture is committed,
 * so a fixture page titles its cards from cmux and says the board was not joined — which is the fallback
 * working as designed, not a gap in the fixture.
 *
 * @param fixture the capture `?fixture=` names, freezing the seats and the health line
 * @param seat the `?seat=<workspace id>` a link arrived with, opening that session's panel on load
 * @returns the view
 */
export function NowView({ fixture, seat }: { fixture: string | undefined; seat: string | undefined }): ReactElement {
  return (
    <div className={TILES}>
      <SeatsTile fixture={fixture} seatParam={seat} />
      <MachineHealthLine fixture={fixture} />
    </div>
  );
}
