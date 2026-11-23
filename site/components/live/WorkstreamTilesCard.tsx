/**
 * One workstream as a collapsed card: the lane chip naming whose move it is, the meter under its title, and its stats.
 */
import { type ReactElement, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import {
  closedWords,
  doneShare,
  endingLine,
  endingOf,
  shortDate,
  type WaitingView,
  type WorkstreamsView,
  type WorkstreamView,
} from "../../lib/workstreamTiles";
import { CHIP } from "../console/controls";
import { MilestoneStrip } from "./WorkstreamMilestones";

/**
 * Lane → the chip's colour: the owner's call solid amber, a chase amber outline, stalled red, moving blue, done green,
 * discovery a violet outline around body text (no violet ink reads on every family's glass), and an
 * abandoned one the quietest of all, a dashed grey outline with no fill.
 */
const LANE_TONE: Readonly<Partial<Record<string, string>>> = {
  abandoned: "border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground",
  chase: "border-warning/60 bg-warning/[0.12] text-warning",
  discovery: "border-[#a78bfa]/60 bg-[#a78bfa]/[0.12] text-foreground",
  done: "border-success/50 bg-success/[0.1] text-success",
  "kept-here": "border-border bg-muted/40 text-muted-foreground",
  moving: "border-info/50 bg-info/[0.1] text-info",
  stalled: "border-danger/50 bg-danger/[0.1] text-danger",
  "your-call": "border-warning bg-warning text-background",
};

/**
 * Whose move it is, in words: the hold's own sentence, or the lane's rule when nothing names one.
 *
 * @returns the sentence
 */
export function moveLine({ waiting }: { waiting: WaitingView }): string {
  if (waiting.on === "you") {
    return `Your call: ${waiting.what}`;
  }
  return `Chase ${waiting.who}: ${waiting.what}`;
}

/**
 * The lane chip on a card's left: its colour and label, with the rule and the hold on hover.
 *
 * @returns the chip
 */
export function LaneChip({ one, view }: { one: WorkstreamView; view: WorkstreamsView }): ReactElement {
  // readWorkstreamTiles refuses a document carrying a lane it does not declare, so this always finds one.
  const lane = view.lanes.find((each) => each.id === one.lane)!;
  let title = lane.rule;
  const ending = endingOf({ one });
  if (ending !== null) {
    title = endingLine({ ending });
  } else if ((one.kind === "outcome" || one.kind === "standing" || one.kind === "linked") && one.waitingOn !== null) {
    title = moveLine({ waiting: one.waitingOn });
  }
  return (
    <span
      className={cn(
        "mt-[0.1rem] inline-flex w-[6.4rem] flex-none justify-center rounded-md border border-solid px-2 py-[0.2rem] text-[0.72rem] font-semibold whitespace-nowrap",
        LANE_TONE[one.lane],
      )}
      title={title}
      data-lane={one.lane}
    >
      {lane.label}
    </span>
  );
}

/**
 * The thin meter under a card's title: the share of its own milestones done, or a linked gauge's share and gate.
 *
 * @returns the meter, or nothing for a kind with no milestones
 */
function Meter({ one }: { one: WorkstreamView }): ReactElement | null {
  if (one.kind === "outcome" || one.kind === "standing") {
    return (
      <span
        className="relative mt-[0.35rem] block h-[6px] w-full max-w-[28rem] rounded-full bg-(--c-panel)"
        title={one.progressLine}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${String(doneShare({ progress: one.progress }) * 100)}%` }}
        />
      </span>
    );
  }
  if (one.kind === "linked") {
    return (
      <span className="relative mt-[0.35rem] block h-[6px] w-full max-w-[28rem] rounded-full bg-(--c-panel)">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${String(one.reading.share * 100)}%` }}
        />
        <span
          className="absolute -inset-y-[3px] w-[2px] bg-foreground"
          style={{ left: `${String(one.reading.gateShare * 100)}%` }}
        />
      </span>
    );
  }
  return null;
}

/**
 * The few stats and tags a collapsed card carries, as `key value` pills.
 *
 * @returns the pills
 */
export function Stats({ one, view }: { one: WorkstreamView; view: WorkstreamsView }): ReactElement {
  const pills: { key: string; text: ReactNode; title?: string }[] = [];
  const ending = endingOf({ one });
  if (ending !== null) {
    pills.push({ key: "ended", text: `abandoned ${shortDate({ date: ending.on })}`, title: ending.reason });
  }
  if (one.kind === "outcome" || one.kind === "standing" || one.kind === "linked") {
    pills.push({ key: "progress", text: one.progressLine });
  }
  if (one.kind !== "local" && one.lastMovedOn !== null) {
    pills.push({ key: "moved", text: `moved ${shortDate({ date: one.lastMovedOn })}` });
  }
  if (one.kind === "linked") {
    pills.push({ key: "gauge", text: `${String(one.gauge.value)} of ${String(one.gauge.of)}` });
    pills.push({ key: "leads", text: `${one.leads} leads` });
  }
  if (one.kind === "outcome" || one.kind === "standing" || one.kind === "linked") {
    // An ended workstream is nobody's move any more, so a hold it kept is not drawn as one.
    if (ending === null && one.waitingOn?.on === "someone") {
      pills.push({ key: "who", text: `waiting on ${one.waitingOn.who}`, title: one.waitingOn.what });
    }
    if (one.priority === null) {
      pills.push({ key: "priority", text: "priority not stated" });
    } else {
      pills.push({ key: "priority", text: `priority ${one.priority.level}`, title: one.priority.because });
    }
    const initiative = view.initiatives.find((each) => each.id === one.initiative);
    if (initiative !== undefined) {
      pills.push({ key: "initiative", text: initiative.name });
    }
    for (const tag of one.tags) {
      pills.push({ key: `tag:${tag}`, text: tag });
    }
  }
  // A completion says when it closed; an ended closing entry's own words are its ending. Its state sentence stays in
  // the slide-over either way, beside the evidence.
  if (one.kind === "closing" && ending === null) {
    pills.push({ key: "closed", text: closedWords({ closedOn: one.closedOn }), title: one.state });
  }
  return (
    <span className="mt-[0.4rem] flex flex-wrap gap-[0.3rem]">
      {pills.map((pill) => (
        <span key={pill.key} className={CHIP} title={pill.title}>
          {pill.text}
        </span>
      ))}
    </span>
  );
}

/**
 * One workstream as a collapsed card: the lane chip, the title with its meter under it, and its stats. Clicking it
 * opens its slide-over, the way a Queue card does.
 *
 * @returns the card
 */
export function Card({
  one,
  view,
  open,
}: {
  one: WorkstreamView;
  view: WorkstreamsView;
  open: (id: string) => void;
}): ReactElement {
  const ending = endingOf({ one });
  return (
    <button
      type="button"
      className="grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-[0.8rem] border-0 border-b border-solid border-b-border/70 bg-transparent px-[1.1rem] py-[0.85rem] text-left text-foreground last:border-b-0 hover:bg-muted/55"
      data-workstream={one.id}
      data-ended={ending === null ? undefined : ending.kind}
      onClick={() => {
        open(one.id);
      }}
    >
      <LaneChip one={one} view={view} />
      <span className={cn("grid min-w-0", ending === null ? null : "text-muted-foreground")}>
        <span className="text-[0.95rem] leading-[1.4] font-[600]">{one.name}</span>
        {ending === null ? null : <span className="text-[0.84rem] italic">{endingLine({ ending })}</span>}
        {/* An ended card dims its words to muted ink, never by opacity or a filter: milestone names are still text to
            read, 40% opacity put them at 2.3:1 on graphite/light glass, and a filter moves ink after it was measured.
            Muted ink is measured at 4.5:1 on every plane. */}
        <span className={ending === null ? "contents" : "block [&_*]:text-muted-foreground"}>
          <Meter one={one} />
          {one.kind === "local" || one.kind === "closing" ? null : <MilestoneStrip graph={one.milestoneGraph} />}
        </span>
        <Stats one={one} view={view} />
      </span>
    </button>
  );
}
