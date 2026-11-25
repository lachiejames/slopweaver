/**
 * `walkthroughAfterReport`: a walkthrough reaches every pull request the write produced, an update's included, even
 * when a carry or a stack registration failed after the write; the run still fails on that report, and a refused
 * walkthrough fails a run that otherwise succeeded. A write that never reached a pull request posts nothing.
 */
import { describe, expect, it } from "vitest";

import type { PrOutcome } from "../../../../../cli/commands/github/core.js";
import {
  type SucceededWrite,
  succeededWrite,
  walkthroughAfterReport,
} from "../../../../../cli/commands/github/stackPushReport.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";

const UPDATED: PrOutcome = { kind: "updated", number: 42, url: "https://example.invalid/pr/42" };

/** A walkthrough seam that records which pull request it was asked to post on, and answers `answer`. */
function recordingWalk({ answer }: { answer: number }): {
  readonly posted: number[];
  readonly walk: (input: { outcome: SucceededWrite }) => Promise<number>;
} {
  const posted: number[] = [];
  return {
    posted,
    walk: ({ outcome }) => {
      posted.push(outcome.number);
      return Promise.resolve(answer);
    },
  };
}

describe("walkthroughAfterReport", () => {
  it("posts on the updated pull request and answers the walkthrough's exit when the report succeeded", async () => {
    const { posted, walk } = recordingWalk({ answer: EXIT_OK });
    expect(await walkthroughAfterReport({ outcome: UPDATED, reported: EXIT_OK, walk })).toBe(EXIT_OK);
    expect(posted).toEqual([42]);
  });

  it("still posts on the updated pull request when the carry after it failed, and keeps the failure", async () => {
    const { posted, walk } = recordingWalk({ answer: EXIT_OK });
    expect(await walkthroughAfterReport({ outcome: UPDATED, reported: EXIT_ERROR, walk })).toBe(EXIT_ERROR);
    expect(posted).toEqual([42]);
  });

  it("fails a run whose report succeeded when the walkthrough is refused", async () => {
    const { posted, walk } = recordingWalk({ answer: EXIT_ERROR });
    expect(await walkthroughAfterReport({ outcome: UPDATED, reported: EXIT_OK, walk })).toBe(EXIT_ERROR);
    expect(posted).toEqual([42]);
  });

  it("posts nothing when the door did not perform the write", async () => {
    const { posted, walk } = recordingWalk({ answer: EXIT_OK });
    expect(await walkthroughAfterReport({ outcome: undefined, reported: EXIT_ERROR, walk })).toBe(EXIT_ERROR);
    expect(posted).toEqual([]);
  });

  it("posts nothing when the write was refused", async () => {
    const { posted, walk } = recordingWalk({ answer: EXIT_OK });
    const refused: PrOutcome = { kind: "refused", reason: "the description changed" };
    expect(await walkthroughAfterReport({ outcome: refused, reported: EXIT_ERROR, walk })).toBe(EXIT_ERROR);
    expect(posted).toEqual([]);
  });
});

describe("succeededWrite", () => {
  it("keeps a create, an update and an unchanged write", () => {
    const written: readonly PrOutcome[] = [
      { kind: "created", number: 7, url: "https://example.invalid/pr/7" },
      UPDATED,
      { kind: "unchanged", number: 42, url: "https://example.invalid/pr/42" },
    ];
    expect(written.map((outcome) => succeededWrite({ outcome }))).toStrictEqual(written);
  });

  it("drops a duplicate, a refusal and an unconfirmed write", () => {
    const failed: readonly PrOutcome[] = [
      { existing: 42, kind: "duplicate", locus: "o/r:top", repo: "o/r" },
      { kind: "refused", reason: "no" },
      { detail: "the create's response was lost", kind: "unconfirmed", locus: "o/r:top" },
    ];
    expect(failed.map((outcome) => succeededWrite({ outcome }))).toStrictEqual([undefined, undefined, undefined]);
  });
});
