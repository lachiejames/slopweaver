"use client";

/*
 * The Fleet page's Past view: the machine's last hour, charted (kept off Now, which carries the live
 * two-second figures), what landed on main (`./FleetLanded.tsx`), what settled, newest first, and what the
 * fleet did without asking. The projection is `../../lib/fleetViews.ts`'s `pastOf`; this file reads main's history,
 * the board and the autonomy ledger, each on its own tile so one channel unmeasured never blanks another. Settled
 * here means a DONE row still on the board — the board excludes archived runs, so the history of what landed is the
 * first tile's, never this one's.
 */

import { type ReactElement, useMemo } from "react";

import { ageOf } from "../../lib/ageOf";
import { FLEET_SHOWN, pastOf, type SettledRow } from "../../lib/fleetViews";
import { CitationChip } from "../console/CitationChip";
import { InlineText } from "../console/InlineText";
import { SourceBlock } from "../console/SourceBlock";
import { LandedList } from "./FleetLanded";
import { FleetMore } from "./FleetMore";
import { MachineCharts } from "./MachineCharts";
import { Field, Row, Subject } from "./Row";
import { type Board, readBoard } from "./read";
import { type AutonomyRow, readAutonomy } from "./readAutonomy";
import { type LandedReportView, readLanded } from "./readLanded";
import { readMachineSeries } from "./readMachineSeries";
import { TILES, Tile } from "./Tile";
import { useLive } from "./useLive";

/** How often the machine charts ask for a newer sample: the verb samples at most once per thirty seconds anyway. */
const MACHINE_HISTORY_EVERY_MS = 20_000;

/** One settled row: when it last moved and what it was, and its reason and source behind the fold. */
function SettledLine({ row }: { row: SettledRow }): ReactElement {
  let lead: ReactElement = <>{row.id}</>;
  if (row.summary !== undefined) {
    lead = <InlineText text={row.summary} />;
  }
  return (
    <Row lead={lead} tag={ageOf({ iso: row.movedIso })}>
      <SourceBlock source={row.source} />
      <Field label="settled" value={<InlineText text={row.reason} />} />
      <Field
        label="board row"
        value={<CitationChip reference={{ kind: "board-row", slug: row.id }}>{row.id}</CitationChip>}
      />
    </Row>
  );
}

/** One act the fleet took without asking: what it said to the owner, and why and the proof behind the fold. */
function ActLine({ act }: { act: AutonomyRow }): ReactElement {
  let lead: ReactElement = <Subject subject={act.subject} />;
  if (act.said !== undefined) {
    lead = <InlineText text={act.said} />;
  }
  return (
    <Row lead={lead} tag={ageOf({ iso: act.doneIso })}>
      <Field label="kind" value={act.kind} />
      <Field label="why" value={<InlineText text={act.why} />} />
      <Field label="subject" value={<Subject subject={act.subject} />} />
      {act.witness !== undefined && <Field label="witness" value={<InlineText text={act.witness} />} />}
      {act.steer !== undefined && <Field label="your word" value={act.steer} />}
      {act.run !== undefined && (
        <Field
          label="board row"
          value={<CitationChip reference={{ kind: "board-row", slug: act.run }}>{act.run}</CitationChip>}
        />
      )}
    </Row>
  );
}

/** The settled half: DONE rows still on the board, newest move first. */
function SettledList({ board }: { board: Board }): ReactElement {
  // Each tile projects only its own channel, so the other half's input is empty by construction, not by fallback.
  const view = useMemo(() => pastOf({ acts: [], rows: board.rows, shown: FLEET_SHOWN }), [board]);
  const total = view.settled.shown.length + view.settled.folded.length;
  return (
    <>
      <p className="m-0 text-[0.8rem] text-muted-foreground">
        {String(total)} settled rows on the board
        {view.settledUntimed > 0 && <> · {String(view.settledUntimed)} more not placed in time</>}
      </p>
      <div>
        {view.settled.shown.map((row) => (
          <SettledLine key={row.id} row={row} />
        ))}
      </div>
      <FleetMore
        label={`and ${String(view.settled.folded.length)} more`}
        rows={view.settled.folded}
        render={(row) => <SettledLine key={row.id} row={row} />}
      />
    </>
  );
}

/** The unasked half: the autonomy ledger, newest first. */
function ActList({ acts }: { acts: readonly AutonomyRow[] }): ReactElement {
  const view = useMemo(() => pastOf({ acts, rows: [], shown: FLEET_SHOWN }), [acts]);
  if (acts.length === 0) {
    return <p className="sw-tile-note">the ledger holds no act the fleet took without asking</p>;
  }
  return (
    <>
      <div>
        {view.acts.shown.map((act) => (
          <ActLine key={act.actionId} act={act} />
        ))}
      </div>
      <FleetMore
        label={`and ${String(view.acts.folded.length)} more`}
        rows={view.acts.folded}
        render={(act) => <ActLine key={act.actionId} act={act} />}
      />
    </>
  );
}

/**
 * The Past view: the machine's last hour, what landed, what settled and what the fleet did without asking the owner, each on
 * its own tile.
 *
 * @returns the view
 */
export function PastView(): ReactElement {
  const board = useLive<Board>({ read: readBoard, slug: "board" });
  const acts = useLive<readonly AutonomyRow[]>({ read: readAutonomy, slug: "autonomy" });
  const landed = useLive<LandedReportView>({ read: readLanded, slug: "landed" });
  // The charts are history, so they ride the shared twenty-second lane; the live figures are Now's Machine tile.
  const machine = useLive({ everyMs: MACHINE_HISTORY_EVERY_MS, read: readMachineSeries, slug: "machine-series" });
  return (
    <div className={TILES}>
      <Tile title="The machine, last hour" state={machine}>
        {() => <MachineCharts state={machine} />}
      </Tile>
      <Tile title="Landed on main" state={landed}>
        {(value) => <LandedList report={value} />}
      </Tile>
      <Tile title="Settled" state={board}>
        {(value) => <SettledList board={value} />}
      </Tile>
      <Tile title="Done without asking" state={acts}>
        {(value) => <ActList acts={value} />}
      </Tile>
    </div>
  );
}
