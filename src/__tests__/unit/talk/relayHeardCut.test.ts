import { describe, expect, it } from "vitest";

import { heardEdges } from "../../../talk/relayHeardCut.js";

describe("heardEdges", () => {
  it("reads each end from its own stored fact, never collapsing the two", () => {
    const facts = [true, false, undefined] as const;
    const read = facts.flatMap((heardTruncated) =>
      facts.map((heardTailCut) => {
        const edges = heardEdges({
          turn: {
            ...(heardTruncated === undefined ? {} : { heardTruncated }),
            ...(heardTailCut === undefined ? {} : { heardTailCut }),
            typed: false,
          },
        });
        return `${String(heardTruncated)}/${String(heardTailCut)} → ${edges.start}/${edges.end}`;
      }),
    );
    expect(read).toStrictEqual([
      "true/true → lost/lost",
      "true/false → lost/kept",
      "true/undefined → lost/unknown",
      "false/true → kept/lost",
      "false/false → kept/kept",
      "false/undefined → kept/unknown",
      "undefined/true → unknown/lost",
      "undefined/false → unknown/kept",
      "undefined/undefined → unknown/unknown",
    ]);
  });

  it("reads a typed steer's unsaid end as kept, since typed words are whole by construction, but never its start", () => {
    expect(heardEdges({ turn: { typed: true } })).toStrictEqual({ end: "kept", start: "unknown" });
  });
});
