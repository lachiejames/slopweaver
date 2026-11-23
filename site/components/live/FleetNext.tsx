"use client";

/*
 * The Fleet page's Next view: what the owner would wake up to, then what the fleet works on next in the board's own order,
 * then where each owner steer stands. The forecast is `./FleetForecast.tsx`, the order `../../lib/fleetViews.ts`'s
 * `nextUpOf`; this file reads the two channels and the clock once and draws the tiles. Read-only — no row here can be
 * moved, and the owner asked for none: the owner re-ranks by telling the supervisor.
 */

import { type ReactElement, useMemo } from "react";

import { FLEET_SHOWN, type FleetBoardRead, type NextUpRow, nextUpOf, waitedWords } from "../../lib/fleetViews";
import { type SteerRow, type SteersView, steerStandingOf, steerStateWords } from "../../lib/steerStanding";
import { CitationChip } from "../console/CitationChip";
import { useNow } from "../console/QueueSections";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { SourceBlock } from "../console/SourceBlock";
import { StaleMark } from "../console/StaleMark";
import { ForecastTile } from "./FleetForecast";
import { FleetMore } from "./FleetMore";
import { quoteOf, SourceOf } from "./FleetSource";
import { ReadMark } from "./LiveMarks";
import { COUNT, Field, ROW_NEXT, Row } from "./Row";
import { type Board, readBoard } from "./read";
import type { Reading } from "./reading";
import { type Reconcile, readReconcileReading } from "./readWorkstreams";
import { TILES, Tile } from "./Tile";
import { type LiveState, useLive } from "./useLive";

/**
 * One minute, the Workstreams page's cadence for the same reading: the reconcile document runs past two
 * megabytes and the tick that writes it laps in minutes, so a faster poll parses one reading several times.
 */
const RECONCILE_POLL_MS = 60_000;

/**
 * The board channel as the projection holds it, keeping still-loading and unmeasured apart from empty.
 *
 * @returns the board read
 */
function boardReadOf({ state }: { state: LiveState<Board> }): FleetBoardRead {
  if (state.phase === "loading") {
    return { kind: "loading" };
  }
  if (state.phase === "not-measured") {
    return { kind: "not-measured", why: state.why };
  }
  return { kind: "ready", rows: state.value.rows };
}

/**
 * The tag before a row: its place in the list, its band, and whether the band is a default nobody chose.
 *
 * @returns the tag
 */
function tagOf({ row }: { row: NextUpRow }): string {
  let band = row.priority;
  if (row.defaultPriority) {
    band = `${row.priority} default`;
  }
  return `${String(row.position)} · ${band}`;
}

/**
 * The outcomes a row serves, or the absence said plainly.
 *
 * @returns the line's value
 */
function outcomesOf({ row }: { row: NextUpRow }): string {
  if (row.outcomeTitles.length === 0) {
    return "none of your kept outcomes";
  }
  return row.outcomeTitles.join(" · ");
}

/**
 * How many ready rows a live seat is already on, said as a sentence rather than a bare count.
 *
 * @returns the clause
 */
function seatedWords({ seated }: { seated: number }): string {
  if (seated === 1) {
    return "1 more ready row already has a seat";
  }
  return `${String(seated)} more ready rows already have a seat`;
}

/** One row the fleet works on next: one line, the owner's words under it, and where it came from behind the fold. */
function NextLine({ row }: { row: NextUpRow }): ReactElement {
  return (
    <Row lead={row.label} quote={quoteOf({ source: row.source })} tag={tagOf({ row })}>
      <SourceOf source={row.source} />
      <Field label="serves" value={outcomesOf({ row })} />
      <Field label="waiting" value={waitedWords({ hours: row.waitingHours })} />
      <Field label="kind" value={row.kind} />
      <Field
        label="board row"
        value={<CitationChip reference={{ kind: "board-row", slug: row.id }}>{row.id}</CitationChip>}
      />
    </Row>
  );
}

/** The ordered list, the rows past the cut behind one fold that says how many. */
function NextList({ reconcile, board }: { reconcile: Reconcile; board: FleetBoardRead }): ReactElement {
  const view = useMemo(() => nextUpOf({ board, reconcile, shown: FLEET_SHOWN }), [board, reconcile]);
  if (view.kind === "unavailable") {
    return <StaleMark facts={[{ subject: "what the fleet works on next", why: view.why }]} block />;
  }
  const total = view.rows.shown.length + view.rows.folded.length;
  if (total === 0) {
    return <p className="sw-tile-note">nothing on the board is ready that a seat is not already on</p>;
  }
  return (
    <>
      <p className="m-0 text-[0.8rem] text-muted-foreground">
        {String(total)} ready with nobody on them · {seatedWords({ seated: view.seated })}
      </p>
      <div>
        {view.rows.shown.map((row) => (
          <NextLine key={row.id} row={row} />
        ))}
      </div>
      <FleetMore
        label={`and ${String(view.rows.folded.length)} more, positions ${String(FLEET_SHOWN + 1)} to ${String(total)}`}
        rows={view.rows.folded}
        render={(row) => <NextLine key={row.id} row={row} />}
      />
    </>
  );
}

/** One owner steer: its words as the line, where it stands as the tag, the rest behind the fold. */
function SteerLine({ steer }: { steer: SteerRow }): ReactElement {
  const words = steerStateWords({ state: steer.state });
  const { cut } = steer.quote;
  return (
    <Row
      lead={
        <span className="italic">
          “{cut === "start" && <span className="text-muted-foreground not-italic">… </span>}
          {steer.quote.words}
          {cut === "end" && <span className="text-muted-foreground not-italic"> …</span>}”
        </span>
      }
      tag={words.tag}
    >
      <p className={ROW_NEXT}>{words.line}</p>
      <Field label="the work" value={steer.label} />
      <SourceBlock source={steer.source} />
      <Field
        label="board row"
        value={<CitationChip reference={{ kind: "board-row", slug: steer.id }}>{steer.id}</CitationChip>}
      />
    </Row>
  );
}

/** A ready steers view. */
type ReadySteers = Extract<SteersView, { kind: "ready" }>;

/**
 * The count line over the owner's steers: how many are being worked and queued, and how many seats are on other work.
 *
 * @returns the line
 */
function steerCountLine({ view }: { view: ReadySteers }): string {
  const queued = view.queued.shown.length + view.queued.folded.length;
  return [
    `${String(view.total)} of your steers on the board`,
    `${String(view.working.length)} being worked`,
    `${String(queued)} queued`,
    `${String(view.seatedElsewhere)} seats on work with none of your words behind it`,
  ].join(" · ");
}

/** A group heading inside the tile, its count beside it. */
function GroupHead({ title, n }: { title: string; n: number }): ReactElement {
  return (
    <h4 className="mt-[0.8rem] mb-0 text-[0.82rem] font-semibold">
      {title} <span className={COUNT}>{String(n)}</span>
    </h4>
  );
}

/**
 * One steer's key — its row and when the owner said it, so the same slug on two board rows still draws twice.
 *
 * @returns the key
 */
function steerKey({ steer }: { steer: SteerRow }): string {
  return `${steer.id}@${steer.quote.atIso}`;
}

/** Steers being worked, then queued in their order, then every other state behind its own fold. */
function SteerGroups({ view }: { view: ReadySteers }): ReactElement {
  const queued = view.queued.shown.length + view.queued.folded.length;
  return (
    <>
      <GroupHead n={view.working.length} title="Being worked" />
      {view.working.length === 0 && <p className="sw-tile-note">no seat is on a steer of yours</p>}
      <div>
        {view.working.map((steer) => (
          <SteerLine key={steerKey({ steer })} steer={steer} />
        ))}
      </div>
      <GroupHead n={queued} title="Queued" />
      {queued === 0 && <p className="sw-tile-note">no steer of yours is ready with nobody on it</p>}
      <div>
        {view.queued.shown.map((steer) => (
          <SteerLine key={steerKey({ steer })} steer={steer} />
        ))}
      </div>
      <FleetMore
        label="and the rest of the queue"
        rows={view.queued.folded}
        render={(steer) => <SteerLine key={steerKey({ steer })} steer={steer} />}
      />
      <FleetMore
        label="Held: waiting on you, blocked, paused, or started with nobody on it"
        rows={view.held}
        render={(steer) => <SteerLine key={steerKey({ steer })} steer={steer} />}
      />
      <FleetMore
        label="Outside the ranking"
        rows={view.unranked}
        render={(steer) => <SteerLine key={steerKey({ steer })} steer={steer} />}
      />
      <FleetMore
        label="Settled"
        rows={view.settled}
        render={(steer) => <SteerLine key={steerKey({ steer })} steer={steer} />}
      />
    </>
  );
}

/** Every owner steer, grouped by where it stands — or why that cannot be read yet. */
function SteerList({ reconcile, board }: { reconcile: Reconcile; board: FleetBoardRead }): ReactElement {
  const view = useMemo(() => {
    if (board.kind !== "ready") {
      return undefined;
    }
    return steerStandingOf({ reconcile, rows: board.rows, shown: FLEET_SHOWN });
  }, [board, reconcile]);
  if (board.kind === "loading") {
    return <ReadingIndicator label="Reading the board for your words" block />;
  }
  if (board.kind === "not-measured") {
    return <StaleMark facts={[{ subject: "The board", why: board.why }]} block />;
  }
  if (view === undefined) {
    return <ReadingIndicator label="Reading the board for your words" block />;
  }
  if (view.kind === "unavailable") {
    return <StaleMark facts={[{ subject: "where your steers stand", why: view.why }]} block />;
  }
  if (view.total === 0) {
    return <p className="sw-tile-note">no board row holds words of yours</p>;
  }
  return (
    <>
      <p className="m-0 text-[0.8rem] text-muted-foreground">{steerCountLine({ view })}</p>
      <SteerGroups view={view} />
    </>
  );
}

/**
 * The Next view: what the owner would wake up to — the measured pace carried through the night, the rows it reaches, how
 * long the ready work lasts and what is parked on the owner — then what the fleet works on next and in what order, then
 * where each steer of the owner's stands.
 *
 * @returns the view
 */
export function NextView(): ReactElement {
  const reconcile = useLive<Reading<Reconcile>>({
    everyMs: RECONCILE_POLL_MS,
    read: readReconcileReading,
    slug: "reconcile-reading",
  });
  const boardState = useLive<Board>({ read: readBoard, slug: "board" });
  const board = useMemo(() => boardReadOf({ state: boardState }), [boardState]);
  // The forecast's window is days wide, so the reconcile reading's own one-minute cadence is clock enough.
  const nowMs = useNow({ everyMs: RECONCILE_POLL_MS });
  // Next up and the steers join the minute-polled reconcile to the board, which is read once, so each tile's stamp ages
  // the older of the two: a "just now" off the reconcile would vouch for rows and words the board shaped.
  const boardSource = [{ state: boardState, subject: "the board" }];
  return (
    <>
      {boardState.phase === "ready" && <ReadMark state={boardState} subject="The board" row />}
      <div className={TILES}>
        <ForecastTile boardState={boardState} reconcileState={reconcile} nowMs={nowMs} />
        <Tile title="Next up" state={reconcile} alsoFrom={boardSource}>
          {(reading) => <NextList board={board} reconcile={reading.value} />}
        </Tile>
        <Tile title="Your steers" state={reconcile} alsoFrom={boardSource}>
          {(reading) => <SteerList board={board} reconcile={reading.value} />}
        </Tile>
      </div>
    </>
  );
}
