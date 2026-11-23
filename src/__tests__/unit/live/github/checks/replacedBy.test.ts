/**
 * `replacedBy` on a superseded check — a run that lost the newest-per-name race names its replacement only
 * when GitHub's own timestamps ordered the two, never when either side is undated.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import { parseChecksSnapshot } from "../../../../../live/github/checks.js";
import { IDENTITY, rollupData } from "./harness.js";

describe("replacedBy — losing the newest-per-name race is not being superseded", () => {
  it("leaves an UNDATED loser unreplaced, because nothing ordered it against the run that took its slot", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-09-03T05:20:00Z", workflowRun: { databaseId: 2 } },
              conclusion: "SUCCESS",
              name: "dev-gate",
              status: "COMPLETED",
            },
            {
              __typename: "CheckRun",
              checkSuite: { workflowRun: { databaseId: 1 } },
              conclusion: "FAILURE",
              name: "dev-gate",
              status: "COMPLETED",
            },
          ],
          state: "FAILURE",
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot.supersededChecks).toEqual([
      {
        completedAt: undefined,
        conclusion: "FAILURE",
        kind: "check-run",
        name: "dev-gate",
        replacedBy: undefined,
        runId: "1",
        state: "failed",
      },
    ]);
  });

  it("leaves the loser unreplaced when the WINNER is the undated one, the mirror of the same hole", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [
            {
              __typename: "CheckRun",
              checkSuite: { workflowRun: { databaseId: 2 } },
              conclusion: "SUCCESS",
              name: "dev-gate",
              status: "COMPLETED",
            },
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-09-03T05:00:00Z", workflowRun: { databaseId: 1 } },
              conclusion: "FAILURE",
              name: "dev-gate",
              status: "COMPLETED",
            },
          ],
          state: "FAILURE",
        }),
        identity: IDENTITY,
      }),
    );

    // The DATED failure wins the latest-per-name race here, so the undated SUCCESS is the discard.
    expect(snapshot.supersededChecks).toEqual([
      {
        completedAt: undefined,
        conclusion: "SUCCESS",
        kind: "check-run",
        name: "dev-gate",
        replacedBy: undefined,
        runId: "2",
        state: "passed",
      },
    ]);
  });

  it("names the winner when GitHub's own timestamps ordered the two", () => {
    const snapshot = unwrap(
      parseChecksSnapshot({
        data: rollupData({
          contexts: [
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-09-03T05:00:00Z", workflowRun: { databaseId: 1 } },
              completedAt: "2026-09-03T05:11:44Z",
              conclusion: "FAILURE",
              name: "dev-gate",
              status: "COMPLETED",
            },
            {
              __typename: "CheckRun",
              checkSuite: { createdAt: "2026-09-03T05:20:00Z", workflowRun: { databaseId: 2 } },
              completedAt: "2026-09-03T05:31:00Z",
              conclusion: "SUCCESS",
              name: "dev-gate",
              status: "COMPLETED",
            },
          ],
          state: "FAILURE",
        }),
        identity: IDENTITY,
      }),
    );

    expect(snapshot.supersededChecks[0]!.replacedBy).toEqual({
      completedAt: "2026-09-03T05:31:00Z",
      runId: "2",
      state: "passed",
    });
  });
});
