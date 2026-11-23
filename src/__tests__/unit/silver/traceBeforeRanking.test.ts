import { describe, expect, it } from "vitest";
import type { TraceEvidence } from "../../../silver/traceBeforeRanking.js";
import { gradeAuthoredEvidence, isRankable, traceBeforeRanking } from "../../../silver/traceBeforeRanking.js";

/** The merged sibling pull request that finished `EEEE-589`'s one-line change 33 minutes after it was raised. */
const MERGED_SIBLING: TraceEvidence = {
  grade: "provider-fact",
  showsResolved: true,
  source: "github:acme/app#14673",
  what: "the one-line change this asks for merged on a sibling ticket",
};

/** The same trace's pull request, raised against the ticket itself and closed without merging. */
const CLOSED_UNMERGED: TraceEvidence = {
  grade: "provider-fact",
  showsResolved: false,
  source: "github:acme/app#14690",
  what: "the pull request raised against this ticket was closed, never merged",
};

/** The thread message naming the root fix — posted by an app, which is why it cannot carry the decision. */
const APP_POSTED_CONFIRMATION: TraceEvidence = {
  grade: "machine-account",
  showsResolved: true,
  source: "slack:p1785402708777439",
  what: "a thread message says the root fix already shipped",
};

describe("gradeAuthoredEvidence", () => {
  it("grades a person's prose as a human account", () => {
    expect(gradeAuthoredEvidence({ actor: "human" })).toBe("human-account");
  });

  it("grades a bot's prose as a machine account", () => {
    expect(gradeAuthoredEvidence({ actor: "machine" })).toBe("machine-account");
  });

  it("grades the as-me lane as a machine account, not a person's", () => {
    expect(gradeAuthoredEvidence({ actor: "machine-as-person" })).toBe("machine-account");
  });

  it("grades an actor it cannot place as a machine account rather than a person", () => {
    expect(gradeAuthoredEvidence({ actor: "unattributed" })).toBe("machine-account");
  });
});

describe("traceBeforeRanking", () => {
  it("proposes a close when a provider fact shows the work already done", () => {
    const decision = traceBeforeRanking({ evidence: [MERGED_SIBLING, CLOSED_UNMERGED] });
    expect(decision.verdict).toBe("propose-close");
    expect(decision.reason).toBe("the work this asks for was already done somewhere else — close it, do not do it");
    expect(decision.carried).toEqual([MERGED_SIBLING]);
  });

  it("carries the machine-written confirmation alongside the provider fact, but only alongside it", () => {
    const decision = traceBeforeRanking({ evidence: [APP_POSTED_CONFIRMATION, MERGED_SIBLING] });
    expect(decision.verdict).toBe("propose-close");
    expect(decision.carried).toEqual([MERGED_SIBLING, APP_POSTED_CONFIRMATION]);
  });

  it("refuses to close on a machine-written confirmation alone — the EEEE-589 trap", () => {
    const decision = traceBeforeRanking({ evidence: [APP_POSTED_CONFIRMATION] });
    expect(decision.verdict).toBe("re-read-live");
    expect(decision.reason).toBe(
      "something says this is already done, but nothing the provider owns confirms it — read it live",
    );
    expect(decision.carried).toEqual([]);
  });

  it("refuses to close on a person's account alone", () => {
    const decision = traceBeforeRanking({
      evidence: [
        {
          grade: "human-account",
          showsResolved: true,
          source: "slack:p1787000000000000",
          what: "a teammate says this was handled last week",
        },
      ],
    });
    expect(decision.verdict).toBe("re-read-live");
    expect(decision.carried).toEqual([]);
  });

  it("holds an item whose only evidence is a board doc's own summary — the struck listener row", () => {
    const decision = traceBeforeRanking({
      evidence: [
        {
          grade: "machine-account",
          showsResolved: false,
          source: "handover:slack-huddle-transcript-source",
          what: "the board doc's summary says the listener is down",
        },
      ],
    });
    expect(decision.verdict).toBe("re-read-live");
    expect(decision.reason).toBe("nothing was traced back to a source the provider owns — read it live");
  });

  it("ranks an item whose provider facts all show it still open", () => {
    const decision = traceBeforeRanking({ evidence: [CLOSED_UNMERGED] });
    expect(decision.verdict).toBe("rank");
    expect(decision.reason).toBe("traced, and still open where it came from");
    expect(decision.carried).toEqual([CLOSED_UNMERGED]);
  });

  it("holds an item nothing was traced for at all", () => {
    const decision = traceBeforeRanking({ evidence: [] });
    expect(decision.verdict).toBe("re-read-live");
    expect(decision.reason).toBe("nothing was traced back to a source the provider owns — read it live");
    expect(decision.carried).toEqual([]);
  });
});

describe("isRankable", () => {
  it("puts a close proposal on the list, because it is the owner's to answer", () => {
    expect(isRankable({ decision: traceBeforeRanking({ evidence: [MERGED_SIBLING] }) })).toBe(true);
  });

  it("puts ordinary outstanding work on the list", () => {
    expect(isRankable({ decision: traceBeforeRanking({ evidence: [CLOSED_UNMERGED] }) })).toBe(true);
  });

  it("keeps an untraced item off the list entirely", () => {
    expect(isRankable({ decision: traceBeforeRanking({ evidence: [] }) })).toBe(false);
  });
});
