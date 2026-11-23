/*
 * MAY this correction delete the answer it declares it supersedes — the whole decision, as data.
 *
 * Every case is built by overriding ONE field of a set of inputs that otherwise passes, so each assertion
 * names the check it is about: an input that would have failed for two reasons proves nothing about either.
 * The first test pins the passing baseline, which is what makes every refusal below falsifiable.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { AnsweredPredecessor } from "../../../../../live/turn/supersession/completionReader.js";
import {
  type SupersessionReview,
  type SupersessionWarrant,
  supersessionEligibility,
} from "../../../../../live/turn/supersession/eligibility.js";
import type { ReadSlackMessage } from "../../../../../outbound/slack/lifecycleGuards.js";

const CHANNEL = "C_THREAD";
const THREAD = "1790048427.171609";
const TARGET = "1790054484.916599";
const POSTED = "1790056000.111111";
const POSTED_DIGEST = `sha256:${"c".repeat(64)}`;

/** The ask the CORRECTION is answering — a new tag, its own messageTs, in the thread the answer stands in. */
const ASK = { channel: CHANNEL, messageTs: "1790055900.000100", threadTs: THREAD };

/** The reviewer looked at the target and said the delete is warranted. */
const REVIEW: SupersessionReview = {
  reason: "the new answer replaces the affected-version claim the old one led on",
  targetTs: TARGET,
  warranted: true,
};

/** The verdict's provenance: an independent reviewer, bound to the digest of the answer that went out. */
const WARRANT: SupersessionWarrant = {
  answerDigest: POSTED_DIGEST,
  authorSession: "worker",
  reviewerSession: "reviewer",
};

/** This install's own record of having posted the target — answering an EARLIER tag in the same thread. */
const PREDECESSOR: AnsweredPredecessor = {
  answerTs: TARGET,
  askIdentity: { channel: CHANNEL, messageTs: "1790049834.166409", threadTs: THREAD },
  recordedIso: "2026-09-22T05:21:30.000Z",
  turnId: "turn-1790049846181",
};

/** Slack's own read-back: in this thread, never edited. */
const LIVE: ReadSlackMessage = {
  botId: "B_SELF",
  fileIds: [],
  metadataEventType: "slopweaver_assistant_answer_v2",
  renderer: "slack-assistant-answer-v2",
  threadTs: THREAD,
  ts: TARGET,
  userId: "U_SELF",
};

/** The inputs that pass, with any one of them swapped. */
function inputs(
  over: Partial<Parameters<typeof supersessionEligibility>[0]> = {},
): Parameters<typeof supersessionEligibility>[0] {
  return {
    askIdentity: ASK,
    declaredTs: TARGET,
    live: LIVE,
    postedAnswerDigest: POSTED_DIGEST,
    postedAnswerTs: POSTED,
    predecessor: PREDECESSOR,
    review: REVIEW,
    warrant: WARRANT,
    ...over,
  };
}

describe("supersessionEligibility — the passing shape", () => {
  it("admits a correction whose composer, reviewer, own record and Slack all agree", () => {
    const decision = supersessionEligibility(inputs());

    expect(decision.isOk()).toBe(true);
    expect(unwrap(decision)).toEqual({
      askIdentity: ASK,
      reason: REVIEW.reason,
      // Carried out so the DELETE's own read compares against the same instant this decision used.
      recordedIso: PREDECESSOR.recordedIso,
      supersededTurnId: "turn-1790049846181",
      targetTs: TARGET,
    });
  });

  it("admits it even though the correction answers a DIFFERENT ask in the same thread", () => {
    // The shape the mechanism exists for: a new tag replying where an earlier tag was answered. The
    // predecessor's `messageTs` differs from the correction's and that must not refuse it.
    expect(PREDECESSOR.askIdentity.messageTs).not.toBe(ASK.messageTs);
    expect(supersessionEligibility(inputs()).isOk()).toBe(true);
  });
});

describe("supersessionEligibility — the composer's own declaration", () => {
  it("does nothing at all when the answer declared no supersedes", () => {
    expect(unwrapErr(supersessionEligibility(inputs({ declaredTs: undefined }))).code).toBe("NOTHING_DECLARED");
  });

  it("refuses an answer that names itself", () => {
    const refused = unwrapErr(supersessionEligibility(inputs({ declaredTs: POSTED })));
    expect(refused.code).toBe("SELF_TARGET");
    expect(refused.message).toContain(POSTED);
  });
});

describe("supersessionEligibility — the reviewer's half", () => {
  it("refuses when no verdict judged a supersession at all", () => {
    const refused = unwrapErr(supersessionEligibility(inputs({ review: undefined })));
    expect(refused.code).toBe("UNREVIEWED");
    expect(refused.message).toContain(TARGET);
  });

  it("refuses when the reviewer judged a DIFFERENT message, naming the one it judged", () => {
    const elsewhere: SupersessionReview = { ...REVIEW, targetTs: "1790050000.000200" };
    const refused = unwrapErr(supersessionEligibility(inputs({ review: elsewhere })));
    expect(refused.code).toBe("VERDICT_TARGET_MISMATCH");
    expect(refused.message).toContain("1790050000.000200");
  });

  it("refuses when the reviewer looked and said the follow-up is additive, carrying its words", () => {
    const additive: SupersessionReview = { reason: "the follow-up adds a caveat", targetTs: TARGET, warranted: false };
    const refused = unwrapErr(supersessionEligibility(inputs({ review: additive })));
    expect(refused.code).toBe("NOT_WARRANTED");
    expect(refused.message).toContain("the follow-up adds a caveat");
  });
});

/*
 * The warrant's own provenance. Both of these are ALSO answer-quality gate findings, and both are waivable
 * there by a `answer.quality:v1` door override — measured by a pre-mortem
 * that deleted the predecessor under that override with a verdict bound to sixty-four zeroes and again
 * with a verdict whose reviewer was its own author. Waiving the SEND is not waiving the DELETE.
 */
describe("supersessionEligibility — whose verdict it is, and which answer it read", () => {
  it("refuses a warrant whose reviewer is the session that composed the answer, naming that session", () => {
    const itself: SupersessionWarrant = { ...WARRANT, reviewerSession: WARRANT.authorSession };
    const refused = unwrapErr(supersessionEligibility(inputs({ warrant: itself })));
    expect(refused.code).toBe("SELF_REVIEWED");
    expect(refused.message).toContain("worker");
  });

  it("refuses a warrant bound to a DIFFERENT answer than the one that posted, naming both digests", () => {
    const abandoned = `sha256:${"0".repeat(64)}`;
    const stale: SupersessionWarrant = { ...WARRANT, answerDigest: abandoned };
    const refused = unwrapErr(supersessionEligibility(inputs({ warrant: stale })));
    expect(refused.code).toBe("STALE_WARRANT");
    expect(refused.message).toContain(abandoned);
    expect(refused.message).toContain(POSTED_DIGEST);
  });

  it("refuses on UNREVIEWED when a review arrived with no warrant beside it", () => {
    const refused = unwrapErr(supersessionEligibility(inputs({ warrant: undefined })));
    expect(refused.code).toBe("UNREVIEWED");
    expect(refused.message).toContain(TARGET);
  });
});

describe("supersessionEligibility — this install's own record", () => {
  it("refuses a target no completion of ours ever named", () => {
    const refused = unwrapErr(supersessionEligibility(inputs({ predecessor: undefined })));
    expect(refused.code).toBe("NO_SUCH_ANSWER");
  });

  it("refuses an answer our record puts in another thread, naming both places", () => {
    const elsewhere: AnsweredPredecessor = {
      ...PREDECESSOR,
      askIdentity: { channel: CHANNEL, messageTs: "1790049834.166409", threadTs: "1790000000.000900" },
    };
    const refused = unwrapErr(supersessionEligibility(inputs({ predecessor: elsewhere })));
    expect(refused.code).toBe("FOREIGN_THREAD");
    expect(refused.message).toContain("1790000000.000900");
    expect(refused.message).toContain(THREAD);
  });

  it("refuses an answer our record puts in another CHANNEL of the same thread timestamp", () => {
    const elsewhere: AnsweredPredecessor = {
      ...PREDECESSOR,
      askIdentity: { channel: "C_OTHER", messageTs: "1790049834.166409", threadTs: THREAD },
    };
    const refused = unwrapErr(supersessionEligibility(inputs({ predecessor: elsewhere })));
    expect(refused.code).toBe("FOREIGN_THREAD");
    expect(refused.message).toContain("C_OTHER");
  });
});

describe("supersessionEligibility — what Slack itself says", () => {
  it("refuses when the read found nothing at that timestamp", () => {
    expect(unwrapErr(supersessionEligibility(inputs({ live: undefined }))).code).toBe("NO_SUCH_ANSWER");
  });

  it("refuses when the LIVE message hangs in a different thread than our record claims", () => {
    const moved: ReadSlackMessage = { ...LIVE, threadTs: "1790000000.000900" };
    const refused = unwrapErr(supersessionEligibility(inputs({ live: moved })));
    expect(refused.code).toBe("LIVE_THREAD_MISMATCH");
    expect(refused.message).toContain("1790000000.000900");
  });

  it("refuses a channel-root message, and says that is what it is", () => {
    const { threadTs: _dropped, ...atRoot } = LIVE;
    const refused = unwrapErr(supersessionEligibility(inputs({ live: atRoot })));
    expect(refused.code).toBe("LIVE_THREAD_MISMATCH");
    expect(refused.message).toContain("no thread at all");
  });

  it("refuses a message edited AFTER the completion that recorded it", () => {
    // The completion recorded it at 1790054490; this edit is 1790054600, which `slopweaver slack when` puts
    // 110 seconds later — nearly two minutes.
    const repaired: ReadSlackMessage = { ...LIVE, editedTs: "1790054600.000000" };
    const refused = unwrapErr(supersessionEligibility(inputs({ live: repaired })));
    expect(refused.code).toBe("EDITED_SINCE");
    expect(refused.message).toContain("1790054600.000000");
  });

  it("refuses an edit at the EXACT instant of the completion, where the ordering is unknowable", () => {
    // 1790054490.000000 is the completion's own instant (`slopweaver slack when`).
    // The guard is `>=`; with nothing asserting the boundary, `>` passed every test in this change.
    const simultaneous: ReadSlackMessage = { ...LIVE, editedTs: "1790054490.000000" };
    expect(unwrapErr(supersessionEligibility(inputs({ live: simultaneous }))).code).toBe("EDITED_SINCE");
  });

  it("admits a message whose only edit predates the completion that recorded it", () => {
    // 1790054400 is 90 seconds before the 1790054490 completion (`slopweaver slack when`) — the card’s own
    // working-frame edit on the way to becoming an answer.
    const earlier: ReadSlackMessage = { ...LIVE, editedTs: "1790054400.000000" };
    expect(supersessionEligibility(inputs({ live: earlier })).isOk()).toBe(true);
  });

  it("refuses an edit marker it cannot place in time rather than ignoring it", () => {
    const unreadable: ReadSlackMessage = { ...LIVE, editedTs: "yesterday" };
    expect(unwrapErr(supersessionEligibility(inputs({ live: unreadable }))).code).toBe("EDITED_SINCE");
  });
});
