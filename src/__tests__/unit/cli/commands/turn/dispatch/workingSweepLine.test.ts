/**
 * `slopweaver turn dispatch` — `workingSweepLine`, the line a sweep prints for an ask whose worker is still working.
 *
 * The `fresh-visible-session` tier itself calls the REAL `productionSpawnDeps()`/`readScreen` — hardwired,
 * not injected, deliberately: that lane is proven by the owner's own watched live run, never an automated
 * fixture faking a terminal. See `AGENTS.md`'s own doctrine on this.
 */
import { afterEach, describe, expect, it } from "vitest";

import { workingSweepLine } from "../../../../../../cli/commands/turn/sweepLines.js";
import { removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

/**
 * The containment boundary a rejected Slack append must never cross — a single failed checklist push must
 * never abort the rest of a sweep. Exercised directly against the seam, no real transport anywhere near it.
 */
describe("workingSweepLine", () => {
  const ASK = { channel: "C1", messageTs: "1787720788.183959", threadTs: "1787720788.183959" };
  const WORKER = {
    host: "claude-code" as const,
    sessionName: "ask-C1-1787720788.183959",
    surfaceId: "s-id",
    surfaceRef: "surface:236",
    workspaceId: "w-id",
    workspaceRef: "workspace:218",
  };

  it("names the worker by the address ListAgents shows, so nobody resolves it by start time", () => {
    expect(workingSweepLine({ entry: ASK, reviewer: undefined, reviewerDone: false, worker: WORKER })).toBe(
      "still working: C1/1787720788.183959 — worker ask-C1-1787720788.183959 (workspace:218); no reviewer open",
    );
  });

  it("names an open reviewer too, and says outright that it must not be messaged", () => {
    const line = workingSweepLine({
      entry: ASK,
      reviewer: { ...WORKER, sessionName: "review-C1-1787720788.183959", workspaceRef: "workspace:229" },
      reviewerDone: false,
      worker: WORKER,
    });

    expect(line).toBe(
      "still working: C1/1787720788.183959 — worker ask-C1-1787720788.183959 (workspace:218); " +
        "reviewer review-C1-1787720788.183959 (workspace:229) — mid-verdict, never message it",
    );
  });

  it("surfaces a reviewer that has already written its verdict and is still holding a workspace", () => {
    const line = workingSweepLine({
      entry: ASK,
      reviewer: { ...WORKER, sessionName: "review-C1-1787720788.183959", workspaceRef: "workspace:229" },
      reviewerDone: true,
      worker: WORKER,
    });

    expect(line).toBe(
      "still working: C1/1787720788.183959 — worker ask-C1-1787720788.183959 (workspace:218); " +
        "reviewer review-C1-1787720788.183959 (workspace:229) — verdict WRITTEN and its workspace still open; " +
        "release it with slopweaver turn review --close",
    );
  });

  it("says a pre-naming record has no name rather than inventing one nothing answers to", () => {
    const line = workingSweepLine({
      entry: ASK,
      reviewer: undefined,
      reviewerDone: false,
      worker: { ...WORKER, sessionName: undefined },
    });

    expect(line).toBe(
      "still working: C1/1787720788.183959 — worker (unnamed — this record predates named workers) " +
        "(workspace:218); no reviewer open",
    );
  });
});
