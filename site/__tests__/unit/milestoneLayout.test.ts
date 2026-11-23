import { describe, expect, it } from "vitest";

import { MILESTONE_BOX, milestoneColumns, milestoneLayout } from "../../lib/milestoneLayout";
import { type LinkedView, readWorkstreamTiles } from "../../lib/workstreamTiles";

import { documentWith, linked } from "./workstreamTilesFixture";

/**
 * The fixture's ISO graph, read the way the page reads it.
 *
 * @returns the gauge's graph
 */
function isoGraph(): LinkedView["milestoneGraph"] {
  const view = readWorkstreamTiles({ payload: documentWith({ workstreams: [linked] }) })!;
  return (view.workstreams[0] as LinkedView).milestoneGraph;
}

describe("milestoneLayout", () => {
  it("stacks the two side-by-side milestones in the first column and puts the waiting one in the second", () => {
    const { boxes, width, height } = milestoneLayout({ graph: isoGraph() });
    const step = MILESTONE_BOX.width + MILESTONE_BOX.columnGap;
    expect(boxes.map((box) => [box.node.id, box.x, box.y])).toEqual([
      ["acceptance", 0, 0],
      ["evidence", 0, MILESTONE_BOX.height + MILESTONE_BOX.rowGap],
      ["done", step, 0],
    ]);
    expect(width).toBe(2 * MILESTONE_BOX.width + MILESTONE_BOX.columnGap);
    expect(height).toBe(2 * MILESTONE_BOX.height + MILESTONE_BOX.rowGap);
  });

  it("routes one edge per `after`, open while the milestone it leaves is not done and cleared once it is", () => {
    const { edges } = milestoneLayout({ graph: isoGraph() });
    const mid = MILESTONE_BOX.height / 2;
    const x1 = MILESTONE_BOX.width;
    const x2 = MILESTONE_BOX.width + MILESTONE_BOX.columnGap;
    const bend = (x1 + x2) / 2;
    const low = MILESTONE_BOX.height + MILESTONE_BOX.rowGap + mid;
    expect(edges).toEqual([
      {
        cleared: false,
        from: "acceptance",
        path: `M ${String(x1)} ${String(mid)} C ${String(bend)} ${String(mid)}, ${String(bend)} ${String(mid)}, ${String(x2)} ${String(mid)}`,
        to: "done",
      },
      {
        cleared: true,
        from: "evidence",
        path: `M ${String(x1)} ${String(low)} C ${String(bend)} ${String(low)}, ${String(bend)} ${String(mid)}, ${String(x2)} ${String(mid)}`,
        to: "done",
      },
    ]);
  });

  it("draws nothing for a workstream with no milestones of its own", () => {
    expect(milestoneLayout({ graph: { columns: 0, milestones: [] } })).toEqual({
      boxes: [],
      edges: [],
      height: 0,
      width: 0,
    });
  });
});

describe("milestoneColumns", () => {
  it("groups the milestones by column, each in register order", () => {
    expect(milestoneColumns({ graph: isoGraph() }).map((column) => column.map((node) => node.name))).toEqual([
      ["Policy acceptance", "Evidence in Vanta"],
      ["Internal audit"],
    ]);
  });
});
