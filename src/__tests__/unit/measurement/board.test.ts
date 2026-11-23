/**
 * The board's machine shape — the contract every surface other than the terminal reads.
 *
 * The property that matters: `problem` and `unknownSlugs` survive serialisation. A consumer that received
 * only `workstreams` could not tell "the board is empty" from "the board could not be read", and the second
 * one looking like the first is the failure this whole feature exists to prevent.
 */
import { describe, expect, it } from "vitest";

import { type BoardMeasurement, renderBoardJson } from "../../../measurement/board.js";
import type { RunClaim } from "../../../measurement/overlap.js";
import { type GitFacts, measured, unmeasurable, type WorkstreamStatus } from "../../../measurement/status.js";
import { parseOwnJson } from "../../parseOwnJson.js";

const CLAIM: RunClaim = {
  blind: [],
  branch: "feat/x",
  liveness: { live: true, why: "open, last moved 12m ago — process 4242 is alive" },
  paths: ["src/fleet/overlap.ts"],
  repo: "/tmp/repo",
  slug: "a-doc",
  writer: undefined,
};

const GIT: GitFacts = { branch: "feat/x", commitsAhead: 3, dirtyFiles: 0, onRemote: true, tree: "/tmp/wt" };

/** One measured workstream. */
function status(over: Partial<WorkstreamStatus> = {}): WorkstreamStatus {
  return {
    agent: measured({ value: null }),
    authoredStatus: "in-progress",
    claim: CLAIM,
    consistency: { kind: "consistent", reason: "declared in-progress, matching an open or waiting run" },
    git: measured({ value: GIT }),
    lastTransition: measured({ value: { ageMs: 720_000, kind: "started" } }),
    openQuestion: undefined,
    phase: "open",
    pr: measured({ value: null }),
    probes: { failed: 1, passed: 2, unchecked: 0 },
    slug: "a-doc",
    statusSummary: undefined,
    ...over,
  };
}

/** One measurement of the whole board. */
function board(over: Partial<BoardMeasurement> = {}): BoardMeasurement {
  return {
    base: "main",
    measuredAtIso: "2026-08-06T00:00:00.000Z",
    problem: undefined,
    unknown: [],
    workstreams: [status()],
    ...over,
  };
}

describe("renderBoardJson", () => {
  it("carries the instant and the base the numbers were measured against", () => {
    const decoded: unknown = JSON.parse(renderBoardJson({ board: board() }));

    expect(decoded).toMatchObject({ base: "main", measuredAtIso: "2026-08-06T00:00:00.000Z" });
  });

  it("round-trips a measured workstream field for field", () => {
    const decoded = parseOwnJson<{ workstreams: WorkstreamStatus[] }>({ text: renderBoardJson({ board: board() }) });

    expect(decoded.workstreams[0]!.git).toEqual({ known: true, value: GIT });
    expect(decoded.workstreams[0]!.probes).toEqual({ failed: 1, passed: 2, unchecked: 0 });
    expect(decoded.workstreams[0]!.slug).toBe("a-doc");
  });

  it("keeps the REASON a fact could not be measured, rather than dropping the field", () => {
    const decoded = parseOwnJson<{ workstreams: WorkstreamStatus[] }>({
      text: renderBoardJson({
        board: board({ workstreams: [status({ pr: unmeasurable({ why: "`gh` is not authenticated" }) })] }),
      }),
    });

    expect(decoded.workstreams[0]!.pr).toEqual({ known: false, why: "`gh` is not authenticated" });
  });

  it("distinguishes an unread board from an empty one", () => {
    const decoded = parseOwnJson<{ problem: string; workstreams: readonly WorkstreamStatus[] }>({
      text: renderBoardJson({ board: board({ problem: "the handover directory does not exist", workstreams: [] }) }),
    });

    expect(decoded.problem).toBe("the handover directory does not exist");
    expect(decoded.workstreams).toEqual([]);
  });

  it("reports an empty board as a null problem rather than an absent key", () => {
    const decoded = parseOwnJson<{ problem: unknown }>({
      text: renderBoardJson({ board: board({ workstreams: [] }) }),
    });

    expect(decoded.problem).toBe(null);
  });

  it("names the slugs no doc on the board claims", () => {
    const decoded = parseOwnJson<{ unknownSlugs: readonly string[] }>({
      text: renderBoardJson({ board: board({ unknown: ["ghost-doc"] }) }),
    });

    expect(decoded.unknownSlugs).toEqual(["ghost-doc"]);
  });

  it("is pretty-printed, so a reader can diff two measurements line by line", () => {
    expect(renderBoardJson({ board: board() }).split("\n").length).toBeGreaterThan(10);
  });
});
