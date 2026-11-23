/**
 * What an open workstream card shows, by kind: its progress against its own milestones or its linked gauge, the
 * milestone graph, the labelled lines and the story.
 */
import { type ReactElement, type ReactNode } from "react";

import {
  doneShare,
  endingLine,
  type LinkedView,
  type MilestoneGraphView,
  shortDate,
  type TileView,
  type WorkstreamView,
} from "../../lib/workstreamTiles";
import { MilestoneGraph } from "./WorkstreamMilestones";
import { moveLine } from "./WorkstreamTilesCard";
import { NO_MILESTONES, Story, Timeline } from "./WorkstreamTilesStory";

/**
 * The bar inside an open card: filled to the share of the workstream's own milestones done, the verb's line beside it.
 *
 * @returns the bar
 */
function ProgressBar({ story }: { story: TileView | LinkedView }): ReactElement {
  return (
    <div className="mx-0 my-[1rem] max-w-[44rem]">
      <div className="relative h-[10px] rounded-[5px] border border-solid border-border bg-(--c-panel)">
        <div
          className="absolute top-0 bottom-0 left-0 rounded-l-[5px] bg-primary"
          style={{ width: `${String(doneShare({ progress: story.progress }) * 100)}%` }}
        />
      </div>
      <p className="mt-[0.35rem] mb-0 text-[0.84rem] text-muted-foreground tabular-nums">{story.progressLine}</p>
    </div>
  );
}

/**
 * The linked gauge inside an open card: its own scale, with the gate marked.
 *
 * @returns the gauge
 */
function GaugeBar({ linked }: { linked: LinkedView }): ReactElement {
  const share = linked.reading.share * 100;
  const gate = linked.reading.gateShare * 100;
  return (
    <div className="relative mx-0 my-[1.6rem] h-[10px] max-w-[44rem] rounded-[5px] border border-solid border-border bg-(--c-panel)">
      <div
        className="absolute top-0 bottom-0 left-0 rounded-l-[5px] bg-primary"
        style={{ width: `${String(share)}%` }}
      />
      <span
        className="absolute -top-[1.15rem] -translate-x-1/2 text-[0.66rem] text-foreground tabular-nums"
        style={{ left: `${String(share)}%` }}
      >
        {linked.gauge.value}
      </span>
      <span className="absolute -top-1 -bottom-1 w-[2px] bg-foreground" style={{ left: `${String(gate)}%` }} />
      <span
        className="absolute top-[0.85rem] -translate-x-full text-[0.66rem] whitespace-nowrap text-foreground"
        style={{ left: `${String(gate)}%` }}
      >
        {linked.gauge.gateLabel} · {linked.gauge.gate} of {linked.gauge.of}
      </span>
    </div>
  );
}

/**
 * A labelled line inside an open card, drawn only when it has words.
 *
 * @returns the paragraph, or nothing
 */
function Line({ label, children }: { label: string; children: ReactNode }): ReactElement | null {
  if (children === null) {
    return null;
  }
  return (
    <p className="my-[0.35rem] text-[0.9rem] text-muted-foreground">
      <b className="text-foreground">{label}</b> {children}
    </p>
  );
}

/**
 * The workstream's own milestones under its bar, labelled the way every other line in an open card is.
 *
 * @returns the block, or nothing when it declares none
 */
function OwnMilestones({ graph }: { graph: MilestoneGraphView }): ReactElement | null {
  if (graph.milestones.length === 0) {
    return null;
  }
  return (
    <>
      <Line label="Milestones:">
        {graph.columns > 1
          ? "side by side where they can run in parallel, an arrow where one waits on another"
          : "all can run in parallel"}
      </Line>
      <MilestoneGraph graph={graph} />
    </>
  );
}

/**
 * When a story started and last moved, in a sentence, or that no dated entry is recorded yet.
 *
 * @returns the sentence
 */
function datesLine({ one }: { one: TileView }): string {
  if (one.startedOn === null || one.lastMovedOn === null) {
    return "No dated entry yet.";
  }
  return `Started ${shortDate({ date: one.startedOn })}, last moved ${shortDate({ date: one.lastMovedOn })}.`;
}

/**
 * What an open card shows, by kind.
 *
 * @returns the body
 */
export function Body({ one }: { one: WorkstreamView }): ReactElement {
  if (one.kind === "local") {
    return (
      <>
        <p className="my-[0.35rem] text-[0.9rem] text-muted-foreground">{one.note}</p>
        {one.entries.length === 0 ? null : <Timeline entries={one.entries} graph={NO_MILESTONES} />}
      </>
    );
  }
  const ended =
    one.ending === null ? null : (
      <Line label="Ended:">
        {endingLine({ ending: one.ending })} <span className="text-[0.8rem]">({one.ending.anchor})</span>
      </Line>
    );
  if (one.kind === "closing") {
    let outcome = "not recorded yet";
    if (one.outcome !== null) {
      outcome = one.outcome;
    }
    return (
      <>
        {ended}
        <Line label="Outcome:">{outcome}</Line>
        <Line label="Closed:">
          {one.closedOn === null ? "the day is not recorded yet" : shortDate({ date: one.closedOn })}
        </Line>
        <Line label="Where it went:">{one.state}</Line>
        <Line label="Still holding?">{one.holding}</Line>
        <Timeline entries={one.entries} graph={NO_MILESTONES} />
      </>
    );
  }
  let waiting: string | null = null;
  if (one.ending === null && one.waitingOn !== null) {
    waiting = moveLine({ waiting: one.waitingOn });
  }
  if (one.kind === "linked") {
    return (
      <>
        {ended}
        <Line label="Outcome:">
          {one.outcome} Your part: {one.yourPart}
        </Line>
        <GaugeBar linked={one} />
        <ProgressBar story={one} />
        <OwnMilestones graph={one.milestoneGraph} />
        <Line label="Where it is:">
          <span className="tabular-nums">{one.reading.short}</span> short of the gate. {one.numbers} ({one.gauge.source}
          , {shortDate({ date: one.gauge.asOf })})
        </Line>
        <Line label="Waiting on:">{waiting}</Line>
        <Story entries={one.entries} feedback={one.feedback} skeptic={one.skeptic} graph={one.milestoneGraph} />
      </>
    );
  }
  const discovery = one.status === "discovery" && one.progress.doneCount === 0;
  return (
    <>
      {ended}
      <Line label="Outcome:">
        {one.outcome} <span className="text-muted-foreground">{one.agreedBy}</span>
      </Line>
      {discovery ? (
        <div className="my-3 rounded-[6px] border border-dashed border-[#a78bfa] px-[0.6rem] py-[0.4rem] text-[0.85rem] text-muted-foreground">
          Discovery: no approach agreed yet. {one.progressLine}
        </div>
      ) : (
        <ProgressBar story={one} />
      )}
      <OwnMilestones graph={one.milestoneGraph} />
      <Line label="Where it is:">
        {one.statusNote}. {one.numbers} {datesLine({ one })} {one.team}.
      </Line>
      <Line label="Waiting on:">{waiting}</Line>
      <Story entries={one.entries} feedback={one.feedback} skeptic={one.skeptic} graph={one.milestoneGraph} />
    </>
  );
}
