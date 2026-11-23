/*
 * Why a hand card that names its board row has not left, from `hand list --json` to the card.
 *
 * A step posted with `--row` leaves the owner's queue on evidence once that row finishes. When the row cannot be read,
 * `hand list` says so on stderr — which the console discards on a successful verb — and in the step's own
 * `rowProblem` field, which is the only place the card can learn it. A card a settle KEPT after the owner answered
 * carries why in `keptReason` the same way. Driven through the real reader and row builder.
 */

import { describe, expect, it } from "vitest";

import { readHandSteps } from "../../components/live/read";
import type { StepCard } from "../../lib/queueCard";
import { rowsOf } from "../../lib/queueRows";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

/** A step naming its row, shaped as `hand list --json` prints one whose row could not be read. */
const STEP = {
  id: "trajectory-tasks-on-read-page",
  postedBy: "unnamed-session",
  postedIso: "2026-09-27T02:00:00.000Z",
  row: "datadog-hmi-for-trajectory-task-replay",
  rowProblem: "no doc carries the board row datadog-hmi-for-trajectory-task-replay, live or archived",
  unblocks: "board row datadog-hmi-for-trajectory-task-replay, which waits on your pick",
  what: "Read the page on what 4,745 classified tasks say about your month",
  witness: 'slopweaver hand done trajectory-tasks-on-read-page --did "read it"',
};

/** The step card the queue draws for one step, refusing a card of any other kind. */
function stepCardFor({ step }: { step: Record<string, unknown> }): StepCard {
  const rows = rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: LOADING,
    board: LOADING,
    drafts: LOADING,
    hands: {
      fixture: undefined,
      observedAtIso: "2026-09-27T02:10:00.000Z",
      phase: "ready",
      stampedByRoute: false,
      value: readHandSteps([step])!,
    },
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviews: LOADING,
    imports: LOADING,
  });
  const { card } = rows.find((row) => row.key === `hand:${String(step["id"])}`)!;
  if (card.kind !== "step") {
    throw new Error(`hand:${String(step["id"])} drew a ${card.kind} card`);
  }
  return card;
}

describe("a hand step's row problem reaches its card", () => {
  it("draws the problem byte for byte as the card's still-here row", () => {
    expect(stepCardFor({ step: STEP }).rows.find((row) => row.label === "still here because")!.value).toBe(
      STEP.rowProblem,
    );
  });

  it("draws no still-here row on a step whose row read cleanly", () => {
    const { rowProblem: _dropped, ...clean } = STEP;
    expect(stepCardFor({ step: clean }).rows.map((row) => row.label)).not.toContain("still here because");
  });

  it("draws the step as unreadable, naming rowProblem, rather than blanking the list", () => {
    expect(readHandSteps([{ ...STEP, rowProblem: 7 }])![0].unreadable).toBe("rowProblem");
  });
});

describe("a kept card's reason reaches its card", () => {
  const { rowProblem: _dropped, ...clean } = STEP;
  const kept = { ...clean, keptReason: "the owner asked what it means, not to close it" };

  it("draws the reason byte for byte as the card's kept-because row", () => {
    expect(stepCardFor({ step: kept }).rows.find((row) => row.label === "kept because")!.value).toBe(kept.keptReason);
  });

  it("draws no kept-because row on a step no settle kept", () => {
    expect(stepCardFor({ step: clean }).rows.map((row) => row.label)).not.toContain("kept because");
  });

  it("draws the step as unreadable, naming keptReason, rather than blanking the list", () => {
    expect(readHandSteps([{ ...clean, keptReason: 7 }])![0].unreadable).toBe("keptReason");
  });
});
