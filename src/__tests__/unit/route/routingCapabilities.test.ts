/**
 * `buildRoutingCapabilities` — a catalog, never a pre-picked route, and a TOTAL one.
 *
 * The conservation cases below are the falsifiable witness for a past defect: the inventory selected
 * its output with `.filter(… && truthMode === "current")`, so every declared history row vanished with nothing
 * reporting it. A test that only counted `available` rows passed throughout. These assert the DISJOINT UNION
 * — every eligible row lands in exactly one bucket — which is the property a dropped row actually breaks.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import type { AtlasRouteReading } from "../../../route/atlasReading.js";
import type { CommandRouteReading } from "../../../route/commandReading.js";
import { RESERVED_LIVE_NEED_IDS } from "../../../route/liveCapabilityPolicy.js";
import { type CapabilityProfile, parseCapabilityProfileRows, type SourceCapability } from "../../../route/profile.js";
import { buildRoutingCapabilities } from "../../../route/routingCapabilities.js";
import { GENERIC_SOURCE_CAPABILITIES } from "../../../route/sourcePlan.js";

/** One row per cell of the reachable x truthMode matrix, plus a reserved id that must appear nowhere. */
const row = ({
  availability,
  id,
  truthMode,
}: {
  availability: SourceCapability["availability"];
  id: string;
  truthMode: SourceCapability["truthMode"];
}): SourceCapability => ({
  availability,
  command: availability.kind === "available" ? ["slopweaver", "noop", id] : [],
  coverage: { detail: "fixture", kind: "bounded" },
  effect: "read",
  freshness: { detail: "fixture", kind: "snapshot" },
  id,
  owner: "fixture",
  sourceClass: "provider",
  terms: [id],
  truthMode,
  what: `the ${id} fixture`,
});

const REACHABLE = { kind: "available" } as const;
const UNREACHABLE = { kind: "unavailable", reason: "no connector" } as const;

const MATRIX: readonly SourceCapability[] = [
  row({ availability: REACHABLE, id: "reachable-current", truthMode: "current" }),
  row({ availability: REACHABLE, id: "reachable-history", truthMode: "history" }),
  row({ availability: UNREACHABLE, id: "unreachable-current", truthMode: "current" }),
  row({ availability: UNREACHABLE, id: "unreachable-history", truthMode: "history" }),
];

const ids = ({ capabilities }: { capabilities: readonly SourceCapability[] }): readonly string[] =>
  capabilities.map((capability) => capability.id);

describe("buildRoutingCapabilities — a catalog, never a pre-picked route", () => {
  it("exposes more than one available capability for a plain question, proving nothing pre-selected one", () => {
    const result = buildRoutingCapabilities({ question: "yo", slopweaverCommand: "slopweaver" });
    expect(result.available.length).toBeGreaterThan(1);
  });

  it("carries no chosen/route/plan field — only the descriptive three-way partition", () => {
    const result = buildRoutingCapabilities({ question: "yo", slopweaverCommand: "slopweaver" });
    expect(Object.keys(result).toSorted()).toEqual(["available", "historical", "unavailable"]);
  });
});

describe("buildRoutingCapabilities — the partition is total", () => {
  it("sorts the reachable x truthMode matrix into exactly the three expected sets", () => {
    const result = buildRoutingCapabilities({
      baseCapabilities: MATRIX,
      question: "yo",
      slopweaverCommand: "slopweaver",
    });
    expect(ids({ capabilities: result.available })).toEqual(["reachable-current"]);
    expect(ids({ capabilities: result.historical })).toEqual(["reachable-history"]);
    expect(ids({ capabilities: result.unavailable })).toEqual(["unreachable-current", "unreachable-history"]);
  });

  // There is no "drops a reserved id" case here because there is no reserved id to feed one:
  // `../../../route/liveCapabilityPolicy.ts` carries an EMPTY set by construction, and a case built on a
  // fixture id the filter does not actually hold would pass for the wrong reason. The guard against that
  // set growing unnoticed is the exact-emptiness assertion at the bottom of this file; the guard that the
  // filter still READS it is the conservation case directly below.

  it("loses nothing: the three sets are a partition of every non-reserved row the table declared", () => {
    const result = buildRoutingCapabilities({
      baseCapabilities: MATRIX,
      question: "yo",
      slopweaverCommand: "slopweaver",
    });
    const placed = [...result.available, ...result.historical, ...result.unavailable];
    const eligible = MATRIX.filter((capability) => !RESERVED_LIVE_NEED_IDS.has(capability.id));
    expect(ids({ capabilities: placed }).toSorted()).toEqual(ids({ capabilities: eligible }).toSorted());
    expect(placed.length).toBe(eligible.length);
  });
});

describe("buildRoutingCapabilities — the generic table's own history reaches the roster", () => {
  it("offers the built-in corpus row as HISTORY, which a current-only filter dropped silently", () => {
    const result = buildRoutingCapabilities({ question: "what did we decide?", slopweaverCommand: "slopweaver" });
    expect(ids({ capabilities: result.historical })).toContain("corpus");
  });

  it("pins the built-in history rows themselves, so deleting one cannot make the conservation case pass vacuously", () => {
    const declared = GENERIC_SOURCE_CAPABILITIES.filter((capability) => capability.truthMode === "history");
    expect(ids({ capabilities: declared })).toEqual(["knowledge-register", "session-transcripts", "corpus"]);
  });

  it("places every history row the generic table declares, never fewer", () => {
    const declared = GENERIC_SOURCE_CAPABILITIES.filter(
      (capability) => capability.truthMode === "history" && capability.availability.kind === "available",
    );
    const result = buildRoutingCapabilities({ question: "what did we decide?", slopweaverCommand: "slopweaver" });
    expect(result.historical.length).toBe(declared.length);
  });

  it("materialises the history row's argv — the launcher and the question as one whole element", () => {
    const result = buildRoutingCapabilities({
      question: "what did we decide about zero sensitive logs?",
      slopweaverCommand: "/abs/bin/slopweaver",
    });
    const history = result.historical.find((capability) => capability.id === "corpus")!;
    expect(history.command).toEqual([
      "/abs/bin/slopweaver",
      "store",
      "read",
      "what did we decide about zero sensitive logs?",
    ]);
  });

  it("keeps `audit` out of the history set — it counts records and reads none", () => {
    const result = buildRoutingCapabilities({ question: "how stale is the corpus?", slopweaverCommand: "slopweaver" });
    expect(ids({ capabilities: result.historical })).not.toContain("audit");
    expect(ids({ capabilities: result.available })).toContain("audit");
  });

  it("no longer renders `audit` as a corpus-class leg, which was the one thing that looked like history", () => {
    const audit = GENERIC_SOURCE_CAPABILITIES.find((capability) => capability.id === "audit")!;
    expect(audit.sourceClass).toBe("artifact");
    expect(audit.truthMode).toBe("current");
  });

  // The `audit` reclassification's finding, kept as the invariant rather than as the count it was measured
  // at: a session skimming the roster by CLASS for history coverage must not find a corpus-class leg
  // that turns out to be current truth. Pinned as an exact list in both directions, so adding such a leg
  // reddens here and deleting one cannot pass vacuously.
  it("leaves no corpus-CLASS leg in the generic table that is not history", () => {
    const corpusClass = GENERIC_SOURCE_CAPABILITIES.filter((capability) => capability.sourceClass === "corpus");
    expect(ids({ capabilities: corpusClass })).toEqual(["knowledge-register", "corpus"]);
    expect(corpusClass.filter((capability) => capability.truthMode !== "history")).toEqual([]);
  });
});

describe("buildRoutingCapabilities — a private overlay's history survives too", () => {
  const overlay: CapabilityProfile = {
    capabilities: [row({ availability: REACHABLE, id: "private-history", truthMode: "history" })],
    schemaVersion: 1,
  };

  it("offers a history row the overlay ADDED — the measured second casualty of the old filter", () => {
    const result = buildRoutingCapabilities({
      profile: overlay,
      question: "what did we decide?",
      slopweaverCommand: "slopweaver",
    });
    expect(ids({ capabilities: result.historical })).toEqual([
      "knowledge-register",
      "session-transcripts",
      "corpus",
      "private-history",
    ]);
  });

  it("files an overlay history row the overlay declares unreachable under unavailable, not nowhere", () => {
    const unreachable: CapabilityProfile = {
      capabilities: [row({ availability: UNREACHABLE, id: "private-history", truthMode: "history" })],
      schemaVersion: 1,
    };
    const result = buildRoutingCapabilities({
      profile: unreachable,
      question: "what did we decide?",
      slopweaverCommand: "slopweaver",
    });
    expect(ids({ capabilities: result.unavailable })).toContain("private-history");
    expect(ids({ capabilities: result.historical })).not.toContain("private-history");
  });

  it("counts an overlay row that REPLACES a generic id once, never twice", () => {
    const replacement: CapabilityProfile = {
      capabilities: [row({ availability: REACHABLE, id: "audit", truthMode: "current" })],
      schemaVersion: 1,
    };
    const result = buildRoutingCapabilities({
      profile: replacement,
      question: "how stale is the corpus?",
      slopweaverCommand: "slopweaver",
    });
    expect(ids({ capabilities: result.available }).filter((id) => id === "audit")).toEqual(["audit"]);
  });
});

describe("the built-in history id cannot be REPLACED by an overlay, and is never dropped silently", () => {
  it("skips an overlay row named `corpus` BY NAME at parse time, and keeps the rest of the overlay", () => {
    const parsed = parseCapabilityProfileRows({
      value: {
        capabilities: [
          row({ availability: REACHABLE, id: "corpus", truthMode: "history" }),
          row({ availability: REACHABLE, id: "private-history", truthMode: "history" }),
        ],
        schemaVersion: 1,
      },
    });
    const result = unwrap(parsed);
    expect(result.skipped.map((skipped) => skipped.id)).toEqual(["corpus"]);
    expect(result.profile.capabilities.map((capability) => capability.id)).toEqual(["private-history"]);
  });

  it("names the reservation in the skip reason, so the overlay's author can see why", () => {
    const parsed = parseCapabilityProfileRows({
      value: {
        capabilities: [row({ availability: REACHABLE, id: "corpus", truthMode: "history" })],
        schemaVersion: 1,
      },
    });
    expect(unwrap(parsed).skipped[0]!.reason).toContain("corpus is reserved for Slopweaver's history source");
  });

  it("keeps an overlay row named `world-model`, because a pre-rename file is read, never refused", () => {
    const parsed = parseCapabilityProfileRows({
      value: {
        capabilities: [row({ availability: REACHABLE, id: "world-model", truthMode: "history" })],
        schemaVersion: 1,
      },
    });
    const result = unwrap(parsed);
    expect(result.skipped).toEqual([]);
    expect(result.profile.capabilities.map((capability) => capability.id)).toEqual(["world-model"]);
  });

  it("offers every row a parsed overlay kept — nothing that survived the parse is filtered afterwards", () => {
    const parsed = parseCapabilityProfileRows({
      value: {
        capabilities: [
          row({ availability: REACHABLE, id: "corpus", truthMode: "history" }),
          row({ availability: REACHABLE, id: "private-history", truthMode: "history" }),
        ],
        schemaVersion: 1,
      },
    });
    const kept = unwrap(parsed);
    const result = buildRoutingCapabilities({
      baseCapabilities: [],
      profile: kept.profile,
      question: "what did we decide?",
      slopweaverCommand: "slopweaver",
    });
    const placed = [...result.available, ...result.historical, ...result.unavailable];
    expect(ids({ capabilities: placed })).toEqual(ids({ capabilities: kept.profile.capabilities }));
  });
});

describe("buildRoutingCapabilities — an atlas downgrade moves a row, never deletes it", () => {
  const atlasRow = ({ truthMode }: { truthMode: SourceCapability["truthMode"] }): SourceCapability => ({
    ...row({ availability: REACHABLE, id: "telemetry", truthMode }),
    command: ["slopweaver", "atlas", "telemetry", "read"],
    sourceClass: "atlas",
  });

  const darkReading = new Map<string, AtlasRouteReading>([
    [
      "telemetry",
      {
        because: "its generation holds no entities",
        grade: "dark",
        gapKinds: [],
        notAttemptedKinds: ["monitor"],
        permissionBlockedKinds: [],
        platform: "telemetry",
        productAbsentKinds: [],
      },
    ],
  ]);

  it("keeps a current-truth atlas row the grading downgraded visible under unavailable", () => {
    const result = buildRoutingCapabilities({
      atlasReadings: darkReading,
      baseCapabilities: [atlasRow({ truthMode: "current" })],
      question: "what are the alerts?",
      slopweaverCommand: "slopweaver",
    });
    expect(ids({ capabilities: result.available })).toEqual([]);
    expect(ids({ capabilities: result.unavailable })).toEqual(["telemetry"]);
  });

  it("files a downgraded HISTORY row under unavailable too, never quietly out of the roster", () => {
    const result = buildRoutingCapabilities({
      atlasReadings: darkReading,
      baseCapabilities: [atlasRow({ truthMode: "history" })],
      question: "what did we decide?",
      slopweaverCommand: "slopweaver",
    });
    expect(ids({ capabilities: result.historical })).toEqual([]);
    expect(ids({ capabilities: result.unavailable })).toEqual(["telemetry"]);
  });
});

describe("buildRoutingCapabilities — a row whose command cannot run is refused before it is offered", () => {
  const consoleRow = (): SourceCapability => ({
    ...row({ availability: REACHABLE, id: "telemetry", truthMode: "current" }),
    command: ["yarn", "work-console", "datadog", "reach", "--about", "{question}", "--json"],
    sourceClass: "atlas",
  });

  const missingScript = new Map<string, CommandRouteReading>([
    [
      "yarn work-console",
      {
        because: "`yarn work-console` names no script in /repo/package.json",
        executable: "yarn work-console",
        resolution: "missing",
      },
    ],
  ]);

  it("moves the row into unavailable instead of offering it as a reachable current-truth leg", () => {
    const result = buildRoutingCapabilities({
      baseCapabilities: [consoleRow()],
      commandReadings: missingScript,
      question: "what is the datadog log retention?",
      slopweaverCommand: "slopweaver",
    });
    expect(ids({ capabilities: result.available })).toEqual([]);
    expect(ids({ capabilities: result.unavailable })).toEqual(["telemetry"]);
  });

  it("clears the argv, so nothing can print the unrunnable command into a worker's brief", () => {
    const result = buildRoutingCapabilities({
      baseCapabilities: [consoleRow()],
      commandReadings: missingScript,
      question: "what is the datadog log retention?",
      slopweaverCommand: "slopweaver",
    });
    expect(result.unavailable[0]!.command).toEqual([]);
    expect(result.unavailable[0]!.coverage.detail).toBe("`yarn work-console` names no script in /repo/package.json");
  });

  it("offers the row exactly as declared when nothing graded its executable", () => {
    const result = buildRoutingCapabilities({
      baseCapabilities: [consoleRow()],
      question: "what is the datadog log retention?",
      slopweaverCommand: "slopweaver",
    });
    expect(ids({ capabilities: result.available })).toEqual(["telemetry"]);
  });
});

describe("RESERVED_LIVE_NEED_IDS — the one set, shared by the inventory and the judge", () => {
  it("does NOT reserve `corpus` — it is the id of the history row itself", () => {
    expect(RESERVED_LIVE_NEED_IDS.has("corpus")).toBe(false);
  });

  it("reserves nothing at all, so an id cannot join the set unnoticed", () => {
    expect([...RESERVED_LIVE_NEED_IDS].toSorted()).toEqual([]);
  });

  it("does NOT reserve the retired spelling either, because a pre-rename brief carries it", () => {
    expect(RESERVED_LIVE_NEED_IDS.has("world-model")).toBe(false);
  });

  it("leaves the corpus row offerable, which is the divergence that once made the roster drop history", () => {
    expect(GENERIC_SOURCE_CAPABILITIES.filter((capability) => capability.id === "corpus").length).toBe(1);
    expect(GENERIC_SOURCE_CAPABILITIES.filter((capability) => RESERVED_LIVE_NEED_IDS.has(capability.id))).toEqual([]);
  });
});
