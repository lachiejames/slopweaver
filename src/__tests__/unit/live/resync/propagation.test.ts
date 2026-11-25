import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FETCHABLE_SOURCES } from "../../../../integrations/corpusSources.js";
import { repoRootOf } from "../../../../lib/gitRepo.js";
import {
  PROPAGATION_MAP,
  propagationFor,
  propagationMapOf,
  renderPropagationMapMarkdown,
  SURFACES,
  takesLandingReading,
} from "../../../../live/resync/propagation.js";

describe("PROPAGATION_MAP", () => {
  it("declares every source the resync roster schedules exactly once, so no sync propagates by omission", () => {
    expect(PROPAGATION_MAP.length).toBeGreaterThan(0);
    expect(PROPAGATION_MAP.map((entry) => entry.source).toSorted()).toEqual([...FETCHABLE_SOURCES].toSorted());
  });

  it("gives every source one edge per surface, in the doc's order", () => {
    expect(
      PROPAGATION_MAP.filter((entry) => entry.edges.map((edge) => edge.surface).join() !== SURFACES.join()),
    ).toEqual([]);
  });

  it("re-derives the landing reading after exactly the two sources its review state reads", () => {
    expect(FETCHABLE_SOURCES.filter((source) => takesLandingReading({ source }))).toEqual(["github", "slack"]);
  });

  it("is the hand-kept map it replaced: every fetchable source in ordinal order, the landing reading for github and slack", () => {
    expect(PROPAGATION_MAP.map((entry) => [entry.source, entry.edges[0]!.mode.kind])).toEqual([
      ["github", "reading"],
      ["slack", "reading"],
      ["linear", "live"],
      ["notion", "live"],
      ["gmail", "live"],
      ["calendar", "live"],
      ["fathom", "live"],
      ["chatgpt", "live"],
      ["outlook-calendar", "live"],
      ["outlook", "live"],
    ]);
  });

  it("gives a fixture source a row of its own, with the unrelated landing edge and the shared three", () => {
    const map = propagationMapOf({ sources: [...FETCHABLE_SOURCES, "acme"] });
    expect(map.slice(0, -1)).toEqual(PROPAGATION_MAP);
    expect(map.at(-1)).toEqual({ edges: propagationFor({ source: "linear" }), source: "acme" });
  });

  it("leaves the workstreams and the briefing to the visible pass for every source — never code", () => {
    expect(
      propagationFor({ source: "linear" })
        .filter((edge) => edge.mode.kind === "judgement")
        .map((edge) => edge.surface),
    ).toEqual(["workstreams", "fleet-briefing"]);
  });
});

describe("docs/propagation-map.md", () => {
  it("is renderPropagationMapMarkdown's output byte for byte — regenerate it, never hand-edit it", () => {
    const root = repoRootOf({ importMetaUrl: import.meta.url });
    expect(readFileSync(join(root, "docs", "propagation-map.md"), "utf8")).toBe(renderPropagationMapMarkdown());
  });
});
