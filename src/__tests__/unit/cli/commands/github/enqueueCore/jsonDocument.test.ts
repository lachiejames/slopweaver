/* The `--json` document the enqueue door prints, and the queue entry it carries. */
import { describe, expect, it } from "vitest";

import { enqueueJsonDocument } from "../../../../../../cli/commands/github/enqueueCore.js";
import type { MergeQueuePrState } from "../../../../../../live/github/mergeQueue.js";
import { pr } from "./fixtures.js";

describe("enqueueJsonDocument", () => {
  it("keeps the entry key as null for a pull request that is not queued", () => {
    expect(enqueueJsonDocument({ lines: ["not queued"], outcome: "dry-run", pr: pr() })).toBe(
      JSON.stringify(
        { entry: null, lines: ["not queued"], outcome: "dry-run", pullRequest: "https://example.invalid/pr/9" },
        undefined,
        2,
      ),
    );
  });

  it("carries a queued pull request's entry as GitHub read it", () => {
    const entry: NonNullable<MergeQueuePrState["entry"]> = {
      estimatedSecondsToMerge: 60,
      position: 2,
      state: "QUEUED",
    };
    expect(enqueueJsonDocument({ lines: [], outcome: "queued", pr: pr({ entry }) })).toBe(
      JSON.stringify(
        { entry, lines: [], outcome: "queued", pullRequest: "https://example.invalid/pr/9" },
        undefined,
        2,
      ),
    );
  });
});
