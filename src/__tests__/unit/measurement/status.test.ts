/**
 * The pane's rendering rules. Pure input → exact lines, so every claim below is falsifiable.
 *
 * The property that matters most here is the ABSENCE of absent rows: a fact nobody could measure must print its
 * reason, because a missing row reads as "fine". Several tests below assert on the literal string `NOT MEASURED`
 * for exactly that reason.
 */
import { describe, expect, it } from "vitest";
import type { RunClaim } from "../../../measurement/overlap.js";
import {
  type GitFacts,
  measured,
  type PrFacts,
  renderAge,
  renderFleetStatus,
  renderWorkstream,
  unmeasurable,
  type WorkstreamStatus,
} from "../../../measurement/status.js";

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

const PR: PrFacts = { failing: [], isDraft: true, number: 42, rollup: "green" };

/** A fully-measured row, spread over in each test so only the field under test varies. */
function row(over: Partial<WorkstreamStatus> = {}): WorkstreamStatus {
  return {
    agent: measured({ value: null }),
    authoredStatus: "in-progress",
    claim: CLAIM,
    consistency: { kind: "consistent", reason: "declared in-progress, matching an open or waiting run" },
    git: measured({ value: GIT }),
    lastTransition: measured({ value: { ageMs: 720_000, kind: "started" } }),
    openQuestion: undefined,
    phase: "open",
    pr: measured({ value: PR }),
    probes: { failed: 1, passed: 2, unchecked: 0 },
    slug: "a-doc",
    statusSummary: undefined,
    ...over,
  };
}

describe("renderAge", () => {
  it("renders sub-second ages as `just now`", () => {
    expect(renderAge({ ageMs: 400 })).toBe("just now");
  });

  it("renders whole seconds", () => {
    expect(renderAge({ ageMs: 45_000 })).toBe("45s");
  });

  it("renders whole minutes, floored", () => {
    expect(renderAge({ ageMs: 119_000 })).toBe("1m");
  });

  it("renders hours once an hour has passed", () => {
    expect(renderAge({ ageMs: 3_600_000 })).toBe("1h");
  });

  it("renders days for a stale workstream", () => {
    expect(renderAge({ ageMs: 3 * 86_400_000 })).toBe("3d");
  });

  it("says so rather than clamping when the journal holds a future timestamp", () => {
    expect(renderAge({ ageMs: -5_000 })).toBe("-5s (IN THE FUTURE — the clock or the journal is wrong)");
  });
});

describe("renderWorkstream prints a reason wherever it has no fact", () => {
  it("names the tree its git numbers came from, so a branch name is never ambiguous", () => {
    expect(renderWorkstream({ status: row() }).join("\n")).toContain("tree /tmp/wt");
  });

  it("prints the git row's measured values", () => {
    expect(renderWorkstream({ status: row() })[4]).toBe(
      "    branch    feat/x · 3 commit(s) ahead · clean · on the remote\n              tree /tmp/wt",
    );
  });

  it("prints NOT MEASURED with the reason instead of omitting the git row", () => {
    const lines = renderWorkstream({ status: row({ git: unmeasurable({ why: "/tmp/wt is not a checkout" }) }) });

    expect(lines[4]).toBe("    branch    NOT MEASURED — /tmp/wt is not a checkout");
  });

  it("distinguishes `there is no pull request` from `nothing could ask`", () => {
    const none = renderWorkstream({ status: row({ pr: measured({ value: null }) }) })[5];
    const blind = renderWorkstream({ status: row({ pr: unmeasurable({ why: "gh is not authenticated" }) }) })[5];

    expect(none).toBe("    pr        none open for this branch");
    expect(blind).toBe("    pr        NOT MEASURED — gh is not authenticated");
  });

  it("names the failing checks rather than counting them", () => {
    const status = row({ pr: measured({ value: { ...PR, failing: ["build", "lint"], rollup: "failing" } }) });

    expect(renderWorkstream({ status })[5]).toBe("    pr        #42 (draft) · checks failing — failing: build, lint");
  });

  it("calls out a pull request that is no longer a draft", () => {
    const status = row({ pr: measured({ value: { ...PR, isDraft: false } }) });

    expect(renderWorkstream({ status })[5]).toContain("NOT a draft");
  });

  it("prints the agent's session, its liveness and the log path", () => {
    const status = row({
      agent: measured({
        value: { liveness: measured({ value: true }), logPath: "/tmp/a.log", pid: 4242, sessionId: "abc-123" },
      }),
    });

    expect(renderWorkstream({ status })[6]).toBe(
      "    agent     session abc-123 — ALIVE · journal recorded pid 4242\n              log /tmp/a.log",
    );
  });

  it("says a doc with no probes cannot be computed rather than showing zeroes", () => {
    const status = row({ probes: { failed: 0, passed: 0, unchecked: 0 } });

    expect(renderWorkstream({ status })[3]).toBe(
      "    probes    no `doneWhen:` probes — this doc's state cannot be computed from the repository",
    );
  });

  it("reports never-examined probes apart from failing ones", () => {
    const status = row({ probes: { failed: 1, passed: 2, unchecked: 3 } });

    expect(renderWorkstream({ status })[3]).toBe("    probes    2/6 passing, 1 failing, 3 never examined");
  });

  it("prints the authored status plainly, beside the derived phase, when there is no summary", () => {
    const status = row({ authoredStatus: "ready", statusSummary: undefined });

    expect(renderWorkstream({ status })[2]).toBe("    status    ready");
  });

  it("appends the doc's own statusSummary to the authored-status line", () => {
    const status = row({ authoredStatus: "cancelled", statusSummary: "superseded by the composed board model" });

    expect(renderWorkstream({ status })[2]).toBe("    status    cancelled — superseded by the composed board model");
  });

  it("stays silent about consistency when the authored status and the run journal agree", () => {
    const status = row({ consistency: { kind: "consistent", reason: "declared ready, with no live run in the way" } });

    expect(renderWorkstream({ status }).some((line) => line.includes("CONTRADICTION"))).toBe(false);
  });

  it("surfaces a genuine contradiction between the authored status and the run journal", () => {
    const status = row({
      consistency: {
        kind: "contradiction",
        reason: "declared done, but a run is currently open or waiting on the owner",
      },
    });

    expect(renderWorkstream({ status }).at(-1)).toBe(
      "    CONTRADICTION  declared done, but a run is currently open or waiting on the owner",
    );
  });

  it("prints a recorded question in full, because it is the artifact the owner wanted", () => {
    const status = row({ openQuestion: "which base branch?", phase: "waiting-on-owner" });

    expect(renderWorkstream({ status }).at(-1)).toBe("    QUESTION  which base branch?");
  });

  it("prints the contradiction before the question when both apply", () => {
    const status = row({
      consistency: {
        kind: "contradiction",
        reason: "declared done, but a run is currently open or waiting on the owner",
      },
      openQuestion: "which base branch?",
      phase: "waiting-on-owner",
    });

    const lines = renderWorkstream({ status });
    expect(lines.at(-2)).toBe("    CONTRADICTION  declared done, but a run is currently open or waiting on the owner");
    expect(lines.at(-1)).toBe("    QUESTION  which base branch?");
  });
});

describe("renderFleetStatus", () => {
  it("states when and against what everything was measured", () => {
    const lines = renderFleetStatus({ base: "main", nowIso: "2026-08-05T00:00:00.000Z", workstreams: [row()] });

    expect(lines[0]).toBe("FLEET — 1 workstream(s), every field measured at 2026-08-05T00:00:00.000Z against main.");
  });

  it("names each repository's own trunk when no single base was given", () => {
    const lines = renderFleetStatus({ base: undefined, nowIso: "2026-08-05T00:00:00.000Z", workstreams: [row()] });

    expect(lines[0]).toBe(
      "FLEET — 1 workstream(s), every field measured at 2026-08-05T00:00:00.000Z against each repository's own trunk.",
    );
  });

  it("says the pane is not cached, since that is the whole property being sold", () => {
    const lines = renderFleetStatus({ base: "main", nowIso: "2026-08-05T00:00:00.000Z", workstreams: [row()] });

    expect(lines[1]).toBe("Nothing below is cached or hand-written. A row saying NOT MEASURED means exactly that.");
  });

  it("says plainly that there is nothing to report rather than printing an empty frame", () => {
    const lines = renderFleetStatus({ base: "main", nowIso: "2026-08-05T00:00:00.000Z", workstreams: [] });

    expect(lines[0]).toBe("FLEET — nothing to report.");
  });

  it("renders every workstream it was given", () => {
    const lines = renderFleetStatus({
      base: "main",
      nowIso: "2026-08-05T00:00:00.000Z",
      workstreams: [row({ slug: "one" }), row({ slug: "two" })],
    });

    expect(lines.filter((line) => line === "  one" || line === "  two")).toEqual(["  one", "  two"]);
  });
});
