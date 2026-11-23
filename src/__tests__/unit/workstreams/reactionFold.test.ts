import { describe, expect, it } from "vitest";

import { type ReactionRow, reactionRowSchema } from "../../../workstreams/candidates.js";
import { latestReactions, standingState } from "../../../workstreams/reactionFold.js";

/** One valid reaction row for c-002, at a minute past 13:00 so the rows read in order. */
function row({
  minute,
  reaction,
  coveredBy = null,
  milestoneOf = null,
  sameAs = null,
}: {
  minute: number;
  reaction: "abandoned" | "milestone-of" | "no" | "same-as" | "yes";
  coveredBy?: string | null;
  milestoneOf?: string | null;
  sameAs?: string | null;
}): ReactionRow {
  const ruled = reaction === "abandoned" || reaction === "milestone-of";
  return reactionRowSchema.parse({
    anchor: reaction === "abandoned" ? "talk-call:fixture#turn_1" : null,
    bySession: "work-console",
    candidate: "c-002",
    coveredBy,
    iso: `2026-10-02T13:${String(minute).padStart(2, "0")}:00.000Z`,
    milestoneOf,
    name: "Merge gate",
    promotedAs: null,
    reaction,
    reason: ruled ? "we dropped it" : null,
    sameAs,
    via: "console",
  });
}

/** The standing state of c-002 over these rows, as `heldAs` is handed it. */
function standing({ rows }: { rows: readonly ReactionRow[] }): ReturnType<typeof standingState> {
  return standingState({ candidateId: "c-002", held: rows, states: latestReactions({ rows }) });
}

const SAID_SAME = row({ minute: 1, reaction: "same-as", sameAs: "merge-gate" });

describe("standingState", () => {
  it("carries a standing same-as through every yes said on top of it", () => {
    const rows = [SAID_SAME, row({ minute: 2, reaction: "yes" })];
    expect(standing({ rows })!.sameAs).toBe("merge-gate");
    expect(standing({ rows: [...rows, row({ minute: 3, reaction: "yes" })] })!.sameAs).toBe("merge-gate");
    expect(standing({ rows })!.reaction).toBe("yes");
  });

  it("carries a standing same-as through an ending and a plain no, which place it nowhere else", () => {
    expect(standing({ rows: [SAID_SAME, row({ minute: 2, reaction: "abandoned" })] })!.sameAs).toBe("merge-gate");
    expect(standing({ rows: [SAID_SAME, row({ minute: 2, reaction: "no" })] })!.sameAs).toBe("merge-gate");
  });

  it("carries nothing once a later word placed it against another workstream", () => {
    const filed = [SAID_SAME, row({ milestoneOf: "acme-onboarding", minute: 2, reaction: "milestone-of" })];
    expect(standing({ rows: [...filed, row({ minute: 3, reaction: "yes" })] })!.sameAs).toBe(null);
    const covered = [SAID_SAME, row({ coveredBy: "acme-onboarding", minute: 2, reaction: "no" })];
    expect(standing({ rows: [...covered, row({ minute: 3, reaction: "yes" })] })!.sameAs).toBe(null);
  });

  it("leaves a yes with nothing beneath it, and an unanswered candidate, as the fold has them", () => {
    expect(standing({ rows: [row({ minute: 1, reaction: "yes" })] })!.sameAs).toBe(null);
    expect(standing({ rows: [] })).toBe(undefined);
  });
});
