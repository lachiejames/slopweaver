/*
 * `closeAnsweredDispatchWorkspace`: after an answered completion it closes exactly the dispatched workspace, it
 * leaves a direct, withheld or failed one alone, and it reports a close failure the seam returned.
 */
import { describe, expect, it } from "vitest";

import { closeAnsweredDispatchWorkspace } from "../../../../../../cli/commands/turn/answerCleanup.js";
import { askIdentityOf } from "../../../../../../live/ask/identity.js";
import type { TurnCompletion } from "../../../../../../live/turn/envelope.js";
import { BRIEF } from "./harness.js";

const ANSWERED_COMPLETION: TurnCompletion = {
  askIdentity: askIdentityOf({ source: BRIEF }),
  primary: { answerTs: "1.3", kind: "answered" },
  provenance: { modelId: "test-model" },
  secondaryFailures: [],
  turnId: "turn-1",
  workingTs: "1.2",
};

describe("closeAnsweredDispatchWorkspace", () => {
  it("closes exactly the dispatched workspace, by id, after an answered completion", async () => {
    const closed: string[] = [];

    const failure = await closeAnsweredDispatchWorkspace({
      close: ({ workspaceId }) => {
        closed.push(workspaceId);
        return Promise.resolve(undefined);
      },
      completion: ANSWERED_COMPLETION,
      workspaceId: "id-workspace-42",
    });

    expect(failure).toBe(undefined);
    expect(closed).toEqual(["id-workspace-42"]);
  });

  it("leaves direct, withheld and failed workspaces alone", async () => {
    const closed: string[] = [];
    const close = ({ workspaceId }: { workspaceId: string }): Promise<string | undefined> => {
      closed.push(workspaceId);
      return Promise.resolve(undefined);
    };

    const direct = await closeAnsweredDispatchWorkspace({
      close,
      completion: ANSWERED_COMPLETION,
      workspaceId: undefined,
    });
    const withheld = await closeAnsweredDispatchWorkspace({
      close,
      completion: {
        ...ANSWERED_COMPLETION,
        primary: {
          held: { code: "held", id: "queue-1", reason: "review" },
          kind: "withheld",
          noticeTs: "1.3",
        },
      },
      workspaceId: "id-workspace-withheld",
    });
    const failed = await closeAnsweredDispatchWorkspace({
      close,
      completion: {
        ...ANSWERED_COMPLETION,
        primary: { kind: "failed", noticeTs: "1.3", reason: "failed" },
      },
      workspaceId: "id-workspace-failed",
    });

    expect([direct, withheld, failed]).toEqual([undefined, undefined, undefined]);
    expect(closed).toEqual([]);
  });

  it("reports the close failure the seam returned", async () => {
    const failure = await closeAnsweredDispatchWorkspace({
      close: () => Promise.resolve("cmux close failed"),
      completion: ANSWERED_COMPLETION,
      workspaceId: "id-workspace-42",
    });

    expect(failure).toBe("cmux close failed");
  });
});
