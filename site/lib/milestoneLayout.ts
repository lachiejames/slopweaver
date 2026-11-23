/**
 * Where each of a workstream's own milestones sits in the slide-over's graph, and the path of every `after` edge.
 *
 * The verb already decided the columns (`src/workstreams/milestoneGraph.ts`: a milestone's column is the longest chain
 * of predecessors before it), so milestones that can run side by side stack in one column and every edge runs left
 * to right. This file only turns columns into pixels, so the drawing is a pure function of the document and an SVG
 * can sit under the boxes without measuring the DOM.
 */
import type { MilestoneGraphView, MilestoneNodeView } from "./workstreamTiles";

/** The size of one milestone box and the gaps between them, in CSS pixels. */
export const MILESTONE_BOX = { columnGap: 44, height: 74, rowGap: 12, width: 196 } as const;

/** One box, placed. */
export interface PlacedMilestone {
  readonly node: MilestoneNodeView;
  readonly x: number;
  readonly y: number;
}

/** One `after` edge: from the milestone that must come first to the one that waits on it. */
export interface MilestoneEdge {
  readonly from: string;
  readonly to: string;
  /** Whether the milestone it leaves is done, so the page draws a cleared dependency solid and an open one dashed. */
  readonly cleared: boolean;
  /** An SVG path from the right middle of the first box to the left middle of the second. */
  readonly path: string;
}

/** The whole graph, placed. */
export interface MilestoneLayout {
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly PlacedMilestone[];
  readonly edges: readonly MilestoneEdge[];
}

/**
 * Place every milestone in its column, stacked in register order, and route every edge between them.
 *
 * @param graph the workstream's milestone graph as the verb derived it
 * @returns the boxes, the edges and the size the drawing needs
 */
export function milestoneLayout({ graph }: { graph: MilestoneGraphView }): MilestoneLayout {
  const { columnGap, height, rowGap, width } = MILESTONE_BOX;
  const columns = milestoneColumns({ graph });
  const boxes = columns.flatMap((stack) =>
    stack.map((node, row): PlacedMilestone => ({
      node,
      x: node.column * (width + columnGap),
      y: row * (height + rowGap),
    })),
  );
  const byId = new Map(boxes.map((box) => [box.node.id, box]));
  const edges = boxes.flatMap((box) =>
    box.node.after.flatMap((before): MilestoneEdge[] => {
      const from = byId.get(before);
      if (from === undefined) {
        return [];
      }
      const x1 = from.x + width;
      const y1 = from.y + height / 2;
      const x2 = box.x;
      const y2 = box.y + height / 2;
      const bend = (x1 + x2) / 2;
      return [
        {
          cleared: from.node.state === "done",
          from: before,
          path: `M ${String(x1)} ${String(y1)} C ${String(bend)} ${String(y1)}, ${String(bend)} ${String(y2)}, ${String(x2)} ${String(y2)}`,
          to: box.node.id,
        },
      ];
    }),
  );
  const deepest = Math.max(0, ...columns.map((stack) => stack.length));
  return {
    boxes,
    edges,
    height: deepest === 0 ? 0 : deepest * height + (deepest - 1) * rowGap,
    width: graph.columns === 0 ? 0 : graph.columns * width + (graph.columns - 1) * columnGap,
  };
}

/**
 * The milestones in one column, grouped for the card's compact strip, columns left to right.
 *
 * @param graph the workstream's milestone graph as the verb derived it
 * @returns one list per column, each in register order
 */
export function milestoneColumns({ graph }: { graph: MilestoneGraphView }): readonly (readonly MilestoneNodeView[])[] {
  return Array.from({ length: graph.columns }, (_, column) =>
    graph.milestones.filter((node) => node.column === column),
  );
}
