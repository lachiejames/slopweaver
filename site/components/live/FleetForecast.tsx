"use client";

/*
 * The Next view's first tile: what the owner would wake up to if the fleet were left running now: a good idea of what
 * the fleet will be working on over the next few hours or days, read through with progressive disclosure, very
 * readable, every element wanted.
 *
 * So the tile reads top to bottom as one answer: one sentence (how many rows the measured pace reaches by morning),
 * four figures (that count, the ready work nobody is on, how long it lasts, what waits on the owner), then the rows
 * themselves one line each with the owner's words behind each fold, and what waits on the owner behind one more. The arithmetic is
 * `../../lib/fleetForecast.ts`; this file only draws it. The tile stands on the BOARD, so a reconcile reading that is
 * loading or refused costs the rows and the runway, never the pace.
 */

import { type ReactElement, type ReactNode, useMemo } from "react";

import {
  FORECAST_HOURS,
  type Forecast,
  type ForecastOrder,
  type ForecastPace,
  type ForecastReconcile,
  type ForecastRow,
  forecastOf,
  type HeldRow,
  PACE_WINDOW_HOURS,
  runwayWords,
} from "../../lib/fleetForecast";
import { FLEET_SHOWN, foldAt } from "../../lib/fleetViews";
import { CitationChip } from "../console/CitationChip";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { StaleMark } from "../console/StaleMark";
import { FleetMore } from "./FleetMore";
import { quoteOf, SourceOf } from "./FleetSource";
import { Field, Row } from "./Row";
import type { Board } from "./read";
import type { Reading } from "./reading";
import type { Reconcile } from "./readWorkstreams";
import { STAT, STAT_ROW, Tile } from "./Tile";
import type { LiveState } from "./useLive";

/** The window the pace is read over, in the days a sentence says. */
const WINDOW_DAYS = PACE_WINDOW_HOURS / 24;

/**
 * The reconcile channel as the forecast receives it.
 *
 * @returns the reading, or why it is not here yet
 */
function forecastReconcileOf({ state }: { state: LiveState<Reading<Reconcile>> }): ForecastReconcile {
  if (state.phase === "loading") {
    return { kind: "loading" };
  }
  if (state.phase === "not-measured") {
    return { kind: "not-measured", why: state.why };
  }
  return { kind: "ready", value: state.value.value };
}

/**
 * A count with its noun, singular at one.
 *
 * @returns the phrase
 */
function rowsWords({ n }: { n: number }): string {
  if (n === 1) {
    return "1 row";
  }
  return `${String(n)} rows`;
}

/**
 * The trend, as the clause after the basis.
 *
 * @returns the clause
 */
function trendWords({ pace }: { pace: Extract<ForecastPace, { kind: "measured" }> }): string {
  const lastDay = `${rowsWords({ n: pace.lastDay })} in the last day`;
  if (pace.trend === "up") {
    return `${lastDay}, faster than the ${String(WINDOW_DAYS)}-day average`;
  }
  if (pace.trend === "down") {
    return `${lastDay}, slower than the ${String(WINDOW_DAYS)}-day average`;
  }
  return `${lastDay}, about the ${String(WINDOW_DAYS)}-day average`;
}

/** The sentence the tile opens on, and the basis under it. */
function Headline({ forecast }: { forecast: Forecast }): ReactElement {
  const { pace, hours } = forecast;
  if (pace.kind === "not-measured") {
    return (
      <p className="text-[0.92rem]">
        No board row settled in the last {String(WINDOW_DAYS)} days, so there is no pace to say what lands overnight.
      </p>
    );
  }
  // A pace too slow to reach one row in the horizon says so, never "about 0 rows settle".
  let reach: ReactNode = (
    <>
      about <strong>{rowsWords({ n: pace.projected })}</strong> settle
    </>
  );
  if (pace.projected === 0) {
    reach = (
      <>
        <strong>fewer than one row</strong> settles
      </>
    );
  }
  return (
    <div className="grid gap-[0.2rem]">
      <p className="m-0 text-[0.92rem]">
        At the last {String(WINDOW_DAYS)} days&apos; pace, {reach} in the next {String(hours)} hours.
      </p>
      <p className="m-0 text-[0.76rem] text-muted-foreground">
        {rowsWords({ n: pace.settled })} settled in the last {String(WINDOW_DAYS)} days · {trendWords({ pace })}
      </p>
    </div>
  );
}

/** One headline figure. */
function Stat({ value, label }: { value: string; label: string }): ReactElement {
  return (
    <div className={STAT}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/** The four figures: what lands, what is there to take, how long it lasts, what waits on the owner. */
function Figures({ forecast }: { forecast: Forecast }): ReactElement | null {
  const { pace, order, held, hours } = forecast;
  if (pace.kind === "not-measured") {
    return (
      <div className={STAT_ROW}>
        <Stat value={String(held.length)} label="waiting on you" />
      </div>
    );
  }
  let open: ReactNode = null;
  let runway: ReactNode = null;
  if (order.kind === "ready") {
    open = <Stat value={String(order.openReady)} label="ready, nobody on them" />;
  }
  // Nothing ready has nothing to run out of: the list's own note says the fleet runs dry, never "about 0 hours".
  if (order.kind === "ready" && order.openReady > 0) {
    runway = (
      <Stat value={runwayWords({ hours: order.runwayHours })} label="until those run out, if nothing new arrives" />
    );
  }
  return (
    <div className={STAT_ROW}>
      <Stat value={String(pace.projected)} label={`settle in the next ${String(hours)}h`} />
      {open}
      {runway}
      <Stat value={String(held.length)} label="waiting on you" />
    </div>
  );
}

/** The tag before an expected row: whether a seat is already on it, and its band. */
function stageTag({ row }: { row: ForecastRow }): string {
  if (row.stage === "being-worked") {
    return `being worked · ${row.priority}`;
  }
  return `next up · ${row.priority}`;
}

/** One row the pace reaches: one line, the owner's words under it, where it came from behind the fold. */
function ExpectedLine({ row }: { row: ForecastRow }): ReactElement {
  return (
    <Row lead={row.label} quote={quoteOf({ source: row.source })} tag={stageTag({ row })}>
      <SourceOf source={row.source} />
      <Field
        label="board row"
        value={<CitationChip reference={{ kind: "board-row", slug: row.id }}>{row.id}</CitationChip>}
      />
    </Row>
  );
}

/** The rows the pace reaches, or why they cannot be named. */
function Expected({ order, pace }: { order: ForecastOrder; pace: ForecastPace }): ReactElement | null {
  if (order.kind === "no-pace") {
    return null;
  }
  if (order.kind === "loading") {
    return <ReadingIndicator label="Reading which rows the fleet is on" block />;
  }
  if (order.kind === "unavailable") {
    return <StaleMark facts={[{ subject: "which rows land overnight", why: order.why }]} block />;
  }
  if (order.expected.length === 0) {
    return <p className="sw-tile-note">the pace reaches no row in that time</p>;
  }
  const rows = foldAt({ rows: order.expected, shown: FLEET_SHOWN });
  let short: ReactNode = null;
  if (pace.kind === "measured" && order.candidates < pace.projected) {
    short = (
      <p className="sw-tile-note">
        the board holds only {rowsWords({ n: order.candidates })} to work, so at this pace the fleet runs out of work
        before morning
      </p>
    );
  }
  return (
    <>
      <h4 className="mt-[0.4rem] mb-0 text-[0.82rem] font-semibold">Likeliest to land</h4>
      {short}
      <div>
        {rows.shown.map((row) => (
          <ExpectedLine key={row.id} row={row} />
        ))}
      </div>
      <FleetMore
        label="and the rest the pace reaches"
        rows={rows.folded}
        render={(row) => <ExpectedLine key={row.id} row={row} />}
      />
    </>
  );
}

/** One row parked on the owner. */
function HeldLine({ row }: { row: HeldRow }): ReactElement {
  return (
    <Row lead={row.label} quote={quoteOf({ source: row.source })} tag="waiting on you">
      <SourceOf source={row.source} />
      <Field
        label="board row"
        value={<CitationChip reference={{ kind: "board-row", slug: row.id }}>{row.id}</CitationChip>}
      />
    </Row>
  );
}

/**
 * The forecast tile: the measured pace carried through the night, the rows it reaches, how long the ready work lasts,
 * and what is parked on the owner.
 *
 * @param boardState the board channel, which the pace and the held rows stand on
 * @param reconcileState the reconcile channel, for the seats and the open order
 * @param nowMs the instant the forecast is drawn at, read by the caller's clock
 * @returns the tile
 */
export function ForecastTile({
  boardState,
  reconcileState,
  nowMs,
}: {
  boardState: LiveState<Board>;
  reconcileState: LiveState<Reading<Reconcile>>;
  nowMs: number;
}): ReactElement {
  const reconcile = useMemo(() => forecastReconcileOf({ state: reconcileState }), [reconcileState]);
  const forecast = useMemo(() => {
    if (boardState.phase !== "ready") {
      return undefined;
    }
    return forecastOf({ hours: FORECAST_HOURS, nowMs, reconcile, rows: boardState.value.rows });
  }, [boardState, nowMs, reconcile]);
  return (
    <Tile
      title="What you'll wake up to"
      state={boardState}
      alsoFrom={[{ state: reconcileState, subject: "the board reconcile" }]}
    >
      {() => {
        if (forecast === undefined) {
          return <ReadingIndicator label="Reading the board" block />;
        }
        return (
          <>
            <Headline forecast={forecast} />
            <Figures forecast={forecast} />
            <Expected order={forecast.order} pace={forecast.pace} />
            <FleetMore
              label="Waiting on you. These do not move overnight"
              rows={forecast.held}
              render={(row) => <HeldLine key={row.id} row={row} />}
            />
          </>
        );
      }}
    </Tile>
  );
}
