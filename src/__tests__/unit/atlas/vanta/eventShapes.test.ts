import { describe, expect, it } from "vitest";

import type { VantaEventLogDto } from "../../../../atlas/vanta/censusApiSchemas.js";
import { indexVantaEventShapes, VANTA_EVENT_SHAPE_SAMPLE_LIMIT } from "../../../../atlas/vanta/eventShapes.js";

const entry = ({
  action,
  date,
  id,
  actorType = "user",
  targetTypes = ["policy"],
}: {
  action: string;
  date: string;
  id: string;
  actorType?: string;
  targetTypes?: readonly string[];
}): VantaEventLogDto => ({
  action,
  actor: { id: `actor-${id}`, type: actorType },
  date,
  id,
  targets: targetTypes.map((type, index) => ({ id: `target-${id}-${String(index)}`, type })),
});

describe("indexVantaEventShapes", () => {
  it("returns one shape per distinct action, ordered by action", () => {
    const shapes = indexVantaEventShapes({
      entries: [
        entry({ action: "policy.updated", date: "2026-09-01T00:00:00Z", id: "1" }),
        entry({ action: "device.enrolled", date: "2026-09-02T00:00:00Z", id: "2" }),
        entry({ action: "policy.updated", date: "2026-09-03T00:00:00Z", id: "3" }),
      ],
    });
    expect(shapes.map((shape) => shape.action)).toEqual(["device.enrolled", "policy.updated"]);
    expect(shapes[1]!.observedCount).toBe(2);
    expect(shapes[0]!.observedCount).toBe(1);
  });

  it("records the observation window from the earliest and latest entry, whatever order they arrive in", () => {
    const shapes = indexVantaEventShapes({
      entries: [
        entry({ action: "a", date: "2026-09-03T00:00:00Z", id: "1" }),
        entry({ action: "a", date: "2026-09-01T00:00:00Z", id: "2" }),
        entry({ action: "a", date: "2026-09-02T00:00:00Z", id: "3" }),
      ],
    });
    expect(shapes[0]!.firstSeenDate).toBe("2026-09-01T00:00:00Z");
    expect(shapes[0]!.lastSeenDate).toBe("2026-09-03T00:00:00Z");
  });

  it("records every attribute path found on an entry, reaching inside actor and targets", () => {
    const shapes = indexVantaEventShapes({ entries: [entry({ action: "a", date: "2026-09-01T00:00:00Z", id: "1" })] });
    expect(shapes[0]!.attributes.map((attribute) => attribute.path)).toEqual([
      "action",
      "actor",
      "actor.id",
      "actor.type",
      "date",
      "id",
      "targets",
      "targets[]",
      "targets[].id",
      "targets[].type",
    ]);
    expect(shapes[0]!.attributes.find((attribute) => attribute.path === "targets")!.types).toEqual(["array"]);
    expect(shapes[0]!.attributes.find((attribute) => attribute.path === "actor.id")!.types).toEqual(["string"]);
  });

  it("unions every actor and target type seen across entries of one action", () => {
    const shapes = indexVantaEventShapes({
      entries: [
        entry({ action: "a", actorType: "user", date: "2026-09-01T00:00:00Z", id: "1", targetTypes: ["policy"] }),
        entry({
          action: "a",
          actorType: "system",
          date: "2026-09-02T00:00:00Z",
          id: "2",
          targetTypes: ["device", "policy"],
        }),
      ],
    });
    expect(shapes[0]!.actorTypes).toEqual(["system", "user"]);
    expect(shapes[0]!.targetTypes).toEqual(["device", "policy"]);
  });

  it("keeps at most the sample limit of entries per action, however many arrive", () => {
    const shapes = indexVantaEventShapes({
      entries: Array.from({ length: 25 }, (_unused, index) =>
        entry({ action: "a", date: "2026-09-01T00:00:00Z", id: String(index) }),
      ),
    });
    expect(shapes[0]!.samples.length).toBe(VANTA_EVENT_SHAPE_SAMPLE_LIMIT);
    expect(shapes[0]!.observedCount).toBe(25);
  });

  it("indexes nothing from an empty walk rather than inventing a shape", () => {
    expect(indexVantaEventShapes({ entries: [] })).toEqual([]);
  });

  it("records an empty targets array as a path with no member paths beneath it", () => {
    const shapes = indexVantaEventShapes({
      entries: [entry({ action: "a", date: "2026-09-01T00:00:00Z", id: "1", targetTypes: [] })],
    });
    expect(shapes[0]!.attributes.map((attribute) => attribute.path)).toEqual([
      "action",
      "actor",
      "actor.id",
      "actor.type",
      "date",
      "id",
      "targets",
    ]);
    expect(shapes[0]!.targetTypes).toEqual([]);
  });
});
