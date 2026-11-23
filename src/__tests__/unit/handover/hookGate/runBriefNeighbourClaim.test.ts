/*
 * `runBriefLines` for a foreign run's path claim: which paths a live neighbour is building, what its claim does NOT
 * cover, and silence about an expired claim.
 */
import { describe, expect, it } from "vitest";

import { runBriefLines } from "../../../../handover/hookGate.js";
import type { RunClaim } from "../../../../measurement/overlap.js";
import { MINE, OTHER_WRITER, run } from "./harness.js";

/** A claim that still stands, so the brief has something to report about a neighbour. */
const LIVE_CLAIM: RunClaim = {
  blind: [],
  branch: "feat/a",
  liveness: { live: true, why: "open, last moved 16m ago — process 4242 is alive" },
  paths: ["src/fleet/overlap.ts"],
  repo: "/repo",
  slug: "held",
  writer: OTHER_WRITER,
};

describe("runBriefLines", () => {
  /**
   * Naming the run was measurably not enough. Once two unfamiliar door verbs were correctly reported as
   * another session's work, and a doc was launched over that exact scope twenty-four minutes later. So the brief
   * says WHAT the neighbour is building, not only that a neighbour exists.
   */
  it("says which paths a foreign run is building, and tells the reader to leave them alone", () => {
    const runs = [
      run({
        claim: LIVE_CLAIM,
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        slug: "held",
      }),
    ];

    expect(runBriefLines({ flagSuffix: "", readerIdentified: true, runs })).toContain(
      "   It is building: src/fleet/overlap.ts. Do not start work on those paths.",
    );
  });

  it("states what a foreign claim does NOT cover, so a partial claim never reads as an inventory", () => {
    const runs = [
      run({
        claim: { ...LIVE_CLAIM, blind: ["doneWhen[1] is a `command:` probe, so it names no path to claim"] },
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        slug: "held",
      }),
    ];

    expect(runBriefLines({ flagSuffix: "", readerIdentified: true, runs }).join("\n")).toContain(
      "It does NOT cover: doneWhen[1] is a `command:` probe, so it names no path to claim, so assume it claims more.",
    );
  });

  it("says nothing about an EXPIRED claim — warning about files nobody holds trains the reader to ignore it", () => {
    const runs = [
      run({
        claim: { ...LIVE_CLAIM, liveness: { live: false, why: "the driving process 4242 is gone" } },
        ownership: { kind: "elsewhere", thisSession: MINE, writer: OTHER_WRITER },
        slug: "held",
      }),
    ];

    expect(runBriefLines({ flagSuffix: "", readerIdentified: true, runs }).join("\n")).not.toContain("It is building");
  });
});
