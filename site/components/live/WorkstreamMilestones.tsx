"use client";

/**
 * A workstream's OWN milestones, drawn as the dependency graph they are: the ISO milestones run in parallel rather than in a line, and some must still happen in order, so the page shows
 * which wait on which. The collapsed card carries a compact strip (one pill per milestone, columns left to right);
 * the slide-over carries the graph itself, a box per milestone and an arrow per `after` edge.
 *
 * Every state, date and column is the verb's (`src/workstreams/milestoneGraph.ts`); the pixels are
 * `../../lib/milestoneLayout.ts`. This file only draws.
 */
import { Fragment, type ReactElement } from "react";

import { MILESTONE_BOX, milestoneColumns, milestoneLayout } from "../../lib/milestoneLayout";
import { cn } from "../../lib/utils";
import {
  type MilestoneGraphView,
  type MilestoneNodeView,
  type MilestoneState,
  shortDate,
} from "../../lib/workstreamTiles";

/** State → the box's colour: done green, moving blue, ready to start in the accent, waiting dashed and quiet. */
const STATE_TONE: Readonly<Record<MilestoneState, string>> = {
  done: "border-success/60 bg-success/[0.1] text-foreground",
  moving: "border-info/60 bg-info/[0.1] text-foreground",
  ready: "border-primary/50 bg-transparent text-foreground",
  waiting: "border-dashed border-border bg-transparent text-muted-foreground",
};

/** State → its dot on the card's strip. */
const STATE_DOT: Readonly<Record<MilestoneState, string>> = {
  done: "bg-success",
  moving: "bg-info",
  ready: "bg-primary",
  waiting: "border border-solid border-muted-foreground bg-transparent",
};

/**
 * Where one milestone is, in words: done on a day, moving since a day, ready to start, or what it waits for.
 *
 * @returns the line
 */
function stateLine({ node }: { node: MilestoneNodeView }): string {
  if (node.state === "done" && node.doneOn !== null) {
    return `done ${shortDate({ date: node.doneOn })}`;
  }
  if (node.state === "moving" && node.startedOn !== null) {
    return `moving since ${shortDate({ date: node.startedOn })}`;
  }
  if (node.state === "waiting") {
    return `after ${node.waitingFor.join(" and ")}`;
  }
  return "ready to start";
}

/**
 * A milestone's hover text: its name, where it is, and where the owner named it.
 *
 * @returns the title
 */
function titleOf({ node }: { node: MilestoneNodeView }): string {
  return `${node.name} · ${stateLine({ node })} · named at ${node.anchor}`;
}

/**
 * The compact strip under a card's meter: one pill per milestone, the ones that can run side by side stacked in one
 * column, an arrow between columns. Nothing when the workstream declares none, so every other card is unchanged.
 *
 * @returns the strip, or nothing
 */
export function MilestoneStrip({ graph }: { graph: MilestoneGraphView }): ReactElement | null {
  if (graph.milestones.length === 0) {
    return null;
  }
  return (
    <span className="mt-[0.45rem] flex flex-wrap items-center gap-[0.35rem]" data-milestone-strip="">
      {milestoneColumns({ graph }).map((column, index) => (
        <Fragment key={column.map((node) => node.id).join("+")}>
          {index === 0 ? null : (
            <span className="text-[0.75rem] text-muted-foreground" aria-hidden="true">
              →
            </span>
          )}
          <span className="grid gap-[0.2rem]">
            {column.map((node) => (
              <span
                key={node.id}
                className={cn(
                  "inline-flex items-center gap-[0.3rem] rounded-full border border-solid px-[0.45rem] py-[0.08rem] text-[0.7rem] whitespace-nowrap",
                  STATE_TONE[node.state],
                )}
                title={titleOf({ node })}
                data-milestone={node.id}
                data-state={node.state}
              >
                <span className={cn("size-[7px] flex-none rounded-full", STATE_DOT[node.state])} />
                {node.name}
              </span>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * The graph inside an open card: a box per milestone, placed by column, and an arrow along every `after` edge —
 * solid once the milestone it leaves is done, dashed while it still holds the next one up.
 *
 * @returns the section, or nothing when the workstream declares none
 */
export function MilestoneGraph({ graph }: { graph: MilestoneGraphView }): ReactElement | null {
  if (graph.milestones.length === 0) {
    return null;
  }
  const layout = milestoneLayout({ graph });
  return (
    <div className="my-3 max-w-full overflow-x-auto" data-milestone-graph="">
      <div className="relative" style={{ height: layout.height, width: layout.width }}>
        <svg
          className="absolute inset-0 overflow-visible"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          <defs>
            <marker
              id="milestone-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          {layout.edges.map((edge) => (
            <path
              key={`${edge.from}->${edge.to}`}
              d={edge.path}
              className="fill-none stroke-muted-foreground"
              strokeWidth={1.5}
              strokeDasharray={edge.cleared ? undefined : "4 3"}
              markerEnd="url(#milestone-arrow)"
              data-edge={`${edge.from}->${edge.to}`}
            />
          ))}
        </svg>
        {layout.boxes.map(({ node, x, y }) => (
          <div
            key={node.id}
            className={cn(
              "absolute grid content-between rounded-[6px] border border-solid px-[0.55rem] py-[0.4rem]",
              STATE_TONE[node.state],
            )}
            style={{ height: MILESTONE_BOX.height, left: x, top: y, width: MILESTONE_BOX.width }}
            title={titleOf({ node })}
            data-milestone={node.id}
            data-state={node.state}
          >
            <span className="line-clamp-2 text-[0.8rem] leading-[1.25] font-[600]">{node.name}</span>
            <span className="flex items-center gap-[0.3rem] text-[0.7rem] text-muted-foreground">
              <span className={cn("size-[7px] flex-none rounded-full", STATE_DOT[node.state])} />
              {node.href === null ? (
                stateLine({ node })
              ) : (
                <a href={node.href} target="_blank" rel="noreferrer">
                  {stateLine({ node })}
                </a>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
