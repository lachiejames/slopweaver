import { describe, expect, it } from "vitest";

import { classifyReviewCandidate } from "../../../review/askClassification.js";
import type { AskCandidate, AskDecision } from "../../../review/evidence.js";
import { findPrLinkSpans, firstLinkStart, mentionRunsIn } from "../../../review/prLink.js";

/**
 * Build a candidate the way the effectful shell does — spans measured against the authored text itself, so a
 * test can paste a real message verbatim instead of hand-counting offsets and getting them wrong.
 */
function candidateOf({
  text,
  number = 16378,
  authorRole = "owner",
  conversation = "channel",
  counterpartId = "",
  authorId = "U0SYN000001",
}: {
  text: string;
  number?: number;
  authorRole?: AskCandidate["authorRole"];
  conversation?: AskCandidate["conversation"];
  counterpartId?: string;
  authorId?: string;
}): AskCandidate {
  const links = findPrLinkSpans({ text });
  return {
    authoredPrCount: new Set(links.map((entry) => entry.ref.number)).size,
    authoredText: text,
    firstLinkAt: firstLinkStart({ spans: links }),
    versionsDisagree: false,
    quotedPrKeys: [],
    threadPrKeys: [],
    authorId,
    authorRole,
    conversation,
    counterpartId,
    linkSpans: links.filter((entry) => entry.ref.number === number).map((entry) => entry.span),
    mentions: mentionRunsIn({ text }),
    prKey: `acme/acme-admin#${String(number)}`,
  };
}

/** The ask arm of a decision, THROWING on any other — so an assertion on its recipients carries no conditional. */
function askOf({ decision }: { decision: AskDecision }): Extract<AskDecision, { kind: "ask" }> {
  if (decision.kind !== "ask") {
    throw new Error(`expected an ask, got ${decision.kind} (${decision.ruleId})`);
  }
  return decision;
}

/** An `#dev-team` ask in the shape of a real corpus message — one of the three worked examples. */
const ASK_16378 =
  "<@U0SYN000012> <@U0SYN000023> pls review <https://github.com/acme/acme-admin/pull/16378|#16378> when " +
  "you get a chance.\n\nit only adds test coverage, no product change.";

/** An `#dev-alerts` batch — one reviewer per LINE, ten pull requests in one message. */
const BATCH =
  "fresh batch of vulnerability-fix PRs for your review:\n" +
  "• <@U0SYN000004> <https://github.com/acme/acme-admin/pull/16996|#16996> bump relay-operation-optimizer\n" +
  "• <@U0SYN000002> <https://github.com/acme/acme-admin/pull/17001|#17001> bump simple-git\n" +
  "• <@U0SYN000006> <https://github.com/acme/acme-admin/pull/17005|#17005> bump lodash\n" +
  "• <@U0SYN000035> <https://github.com/acme/acme-admin/pull/17010|#17010> bump browserslist\n" +
  "• <@U0SYN000006> <https://github.com/acme/acme-admin/pull/17012|#17012> bump fast-xml-parser";

/** An `#dev-team` FYI naming a pull request twice, and not an ask. */
const FYI_16338 =
  "FYI nightly export failures should drop once\n" +
  "• Client retries are enforced (gated on PR review of the backoff change)\n" +
  "• Export job rewrite completes (gated on PR review, top of stack is " +
  "<https://github.com/acme/acme-admin/pull/16338|github.com/acme/acme-admin/pull/16338>)";

describe("classifyReviewCandidate — the owner's three worked examples", () => {
  it("reads the channel ask as an ask addressed to BOTH people the owner tagged", () => {
    const decision = classifyReviewCandidate({ candidate: candidateOf({ text: ASK_16378 }) });
    expect(decision.kind).toBe("ask");
    expect(askOf({ decision }).recipients).toEqual(["U0SYN000012", "U0SYN000023"]);
    expect(decision.ruleId).toBe("addressed-request:review");
  });

  it("quotes the words that made it an ask, so a reader can check the claim", () => {
    const decision = classifyReviewCandidate({ candidate: candidateOf({ text: ASK_16378 }) });
    expect(askOf({ decision }).request.text).toBe("review");
  });

  it("attributes the batch message's last pull request to the reviewer on ITS OWN line, never the first tag", () => {
    const decision = classifyReviewCandidate({ candidate: candidateOf({ number: 17012, text: BATCH }) });
    expect(decision.kind).toBe("ask");
    expect(askOf({ decision }).recipients).toEqual(["U0SYN000006"]);
  });

  it("attributes each other line of the same batch to its own reviewer", () => {
    const forPr = ({ number }: { number: number }): readonly string[] =>
      askOf({ decision: classifyReviewCandidate({ candidate: candidateOf({ number, text: BATCH }) }) }).recipients;
    expect(forPr({ number: 16996 })).toEqual(["U0SYN000004"]);
    expect(forPr({ number: 17001 })).toEqual(["U0SYN000002"]);
    expect(forPr({ number: 17005 })).toEqual(["U0SYN000006"]);
    expect(forPr({ number: 17010 })).toEqual(["U0SYN000035"]);
  });

  it("reads the FYI as a certified non-ask, though it says `gated on PR review` twice", () => {
    const decision = classifyReviewCandidate({ candidate: candidateOf({ number: 16338, text: FYI_16338 }) });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("addresses-nobody");
  });

  it("reads a bump of that FYI as a non-ask, its link reaching the owner only through the quote", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        number: 16338,
        text: "Also, bumping this\n<https://acme.slack.com/archives/C0SYN000002/p1788272454588679>",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("addresses-nobody");
  });
});

describe("classifyReviewCandidate — the vetoes, each measured on a real message", () => {
  it("refuses the conversation between the owner and their own bot, whoever posted", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        conversation: "owner-only",
        text: "<@U0SYN000008> could I pls get a tick on <https://github.com/acme/acme-admin/pull/16378>",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("owner-only-conversation");
  });

  it("refuses an app's own digest, which reports rather than asks", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        authorRole: "app",
        text: "<@U0SYN000012> pls review <https://github.com/acme/acme-admin/pull/16378>",
      }),
    });
    expect(decision.ruleId).toBe("app-posted-as-itself");
  });

  it("refuses somebody else asking the OWNER, which is the opposite of the owner asking them", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        authorRole: "other-human",
        text: "i see a few comments from Arlo for this <https://github.com/acme/acme-admin/pull/16378|one> <@U0SYN000001>, thoughts on addressing those before i take a look?",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("somebody-else-wrote-it");
  });

  it("refuses an ask the owner struck out, even though the body they KEPT still links it and says review", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        number: 16415,
        text:
          "~<@U0SYN000011>~ ~<@U0SYN000016> since you are both in the E2E code this morning, pls review " +
          "<https://github.com/acme/acme-admin/pull/16415>~\nEDIT: not yet\n\nThis morning's pain is the " +
          "class the stack closes, and the review of it will show that: " +
          "<https://github.com/acme/acme-admin/issues/16415>",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("addresses-nobody");
  });

  it("refuses a message that says in its own words it is not a code review", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text: "<@U0SYN000012> bringing this one to you as a product call rather than a code review. <https://github.com/acme/acme-admin/pull/16378>",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("rather-than-review");
  });

  it("refuses a dry run that states nothing was sent", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text: "<@U0SYN000008> Dry-run of the review ask. Nothing has been sent to the team. <https://github.com/acme/acme-admin/pull/16378>",
      }),
    });
    expect(decision.ruleId).toBe("nothing-was-sent");
  });

  it("refuses a `cc` in passing, which copies somebody in rather than asking them", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text: "Same goes for the Acme staging deploys, once I get a platform tick (CC <@U0SYN000002> :eyebrows: ) <https://github.com/acme/acme-admin/pull/16378>",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("addresses-nobody");
  });
});

describe("classifyReviewCandidate — the three counterexamples a Codex review built", () => {
  it("refuses `no review is needed`, where an isolated keyword stood in for a request", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text: "<@U0SYN000012> No review is needed for <https://github.com/acme/acme-admin/pull/16378>.",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("no-review-needed");
  });

  it("still counts the owner's real ask that says the pull request has had NO HUMAN REVIEW at all", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text:
          "<@U0SYN000007> <@U0SYN000002> following up on this one. " +
          "<https://github.com/acme/acme-admin/pull/16378> is ready for a look.\n\nRequired CI is green " +
          "and CodeRabbit has approved it, but it has had no human review at all. I am not approving my own " +
          "team-facing change onto staging, so it needs one of you.",
      }),
    });
    expect(decision.kind).toBe("ask");
    expect(askOf({ decision }).recipients).toEqual(["U0SYN000007", "U0SYN000002"]);
  });

  it("refuses `Review is not needed`, the other spelling of the same denial", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text: "<@U0SYN000012> Review is not needed for <https://github.com/acme/acme-admin/pull/16378>.",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("review-not-needed");
  });

  it("does not hand a direct message's counterpart a pull request the owner scoped to somebody else's line", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        number: 17002,
        conversation: "direct-message",
        counterpartId: "U0SYN000022",
        text:
          "pls review\n<https://github.com/acme/acme-admin/pull/16996> <@U0SYN000004>\n" +
          "<https://github.com/acme/acme-admin/pull/17002>",
      }),
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("direct-message-scoped-past-this-pull-request");
  });

  it("never leaks an earlier pull request's line reviewer into a later one through the heading fallback", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        number: 17002,
        text:
          "pls review\n<https://github.com/acme/acme-admin/pull/16996> <@U0SYN000004>\n" +
          "<https://github.com/acme/acme-admin/pull/17002>",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("addresses-nobody");
  });
});

describe("classifyReviewCandidate — what it abstains on rather than guessing", () => {
  it("abstains when the request reaches the pull request only through a quote", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        number: 16331,
        text: "<@U0SYN000004> Speaking of which, pls review my E2E speed boost\n<https://acme.slack.com/archives/C0SYN000002/p1788735639410069>",
      }),
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("reaches-the-pull-request-through-nothing-this-read-saw");
  });

  it("abstains when the owner addressed somebody and asked for nothing this read recognises", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        number: 16339,
        text: "<@U0SYN000006> one more if you have the patience: <https://github.com/acme/acme-admin/pull/16339|#16339>. Top of the E2E stack, CI green at 17/17.",
      }),
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("addressed-without-a-request");
  });

  it("refuses a quoted link with no request at all, which asks nothing of anyone", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        number: 16360,
        text: "<@U0SYN000007> just closing the loop on this, I have a PR up for the 7-day-backtest stuff\n<https://acme.slack.com/archives/C0SYN000002/p1788272454588679>",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("quoted-link-no-request");
  });
});

describe("classifyReviewCandidate — a direct message names its own audience", () => {
  it("takes the counterpart as the recipient when nobody is tagged, because nobody tags who they are talking to", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        conversation: "direct-message",
        counterpartId: "U0SYN000008",
        text: "could I pls get a tick on <https://github.com/acme/acme-admin/pull/16378>",
      }),
    });
    expect(decision.kind).toBe("ask");
    expect(askOf({ decision }).recipients).toEqual(["U0SYN000008"]);
    expect(decision.ruleId).toBe("direct-message-request:tick");
  });

  it("still refuses a direct message that asks for nothing, so a status remark is not an ask", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        number: 16339,
        conversation: "direct-message",
        counterpartId: "U0SYN000022",
        text: "i'm folding it into the blocking job so it gets a real exit code: <https://github.com/acme/acme-admin/pull/16339|#16339>",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("no-request");
  });
});

describe("classifyReviewCandidate — one link takes every tag, several links take their own line", () => {
  it("gives a single-link message every person it tagged", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text: "<@U0SYN000004> <@U0SYN000022> <@U0SYN000006> could one of you review <https://github.com/acme/acme-admin/pull/16378|#16378>?",
      }),
    });
    expect(askOf({ decision }).recipients).toEqual(["U0SYN000004", "U0SYN000022", "U0SYN000006"]);
  });

  it("falls back to the heading's tags when a multi-link message names nobody per line", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        number: 16370,
        text:
          "<@U0SYN000008> <@U0SYN000007> cleared my own wall out of this thread. one ask, all of it here.\n" +
          "<https://github.com/acme/acme-admin/pull/16369|16369> task-comment resolver\n" +
          "<https://github.com/acme/acme-admin/pull/16370|16370> date-time selection guard",
      }),
    });
    expect(decision.kind).toBe("ask");
    expect(askOf({ decision }).recipients).toEqual(["U0SYN000008", "U0SYN000007"]);
  });
});

describe("classifyReviewCandidate — the counterexamples a fallback review built", () => {
  it("never reads a request word inside a channel label as the owner's request", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text: "<@U0SYN000004> FYI <https://github.com/acme/acme-admin/pull/16378|#16378> is up, details in <#C9|code-review>",
      }),
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("addressed-without-a-request");
  });

  it("never reads a user group's label as a request, so tagging a codeowners group is not an ask by itself", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text: "<!subteam^S0123|@platform-codeowners> <https://github.com/acme/acme-admin/pull/16378|#16378>",
      }),
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("addressed-without-a-request");
  });

  it("still reads a request the owner wrote as a link's own label", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text: "<@U0SYN000004> <https://github.com/acme/acme-admin/pull/16378|pls review>",
      }),
    });
    expect(askOf({ decision }).request.text).toBe("review");
    expect(askOf({ decision }).recipients).toEqual(["U0SYN000004"]);
  });

  it("never takes a mention on the FIRST pull request's line as a heading for a later one", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        number: 17002,
        text:
          "<@U0SYN000004> pls review <https://github.com/acme/acme-admin/pull/16996>\n" +
          "<https://github.com/acme/acme-admin/pull/17002>",
      }),
    });
    expect(decision.kind).toBe("non-ask");
    expect(decision.ruleId).toBe("addresses-nobody");
  });
});

describe("classifyReviewCandidate — copies that disagree", () => {
  it("abstains before any other rung when the corpus copies of a message disagree with nothing to order them", () => {
    const decision = classifyReviewCandidate({
      candidate: { ...candidateOf({ text: ASK_16378 }), versionsDisagree: true },
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("versions-disagree");
  });
});

describe("classifyReviewCandidate — a request that names its pull request only through a quote", () => {
  const QUOTING =
    "<@U0SYN000004> Speaking of which, pls review my E2E speed boost\n<https://x.slack.com/archives/C1/p1>";

  it("is the ask, of everybody tagged, when the quoted message links exactly this pull request", () => {
    const decision = classifyReviewCandidate({
      candidate: { ...candidateOf({ text: QUOTING }), quotedPrKeys: ["acme/acme-admin#16378"] },
    });
    expect(askOf({ decision }).recipients).toEqual(["U0SYN000004"]);
    expect(decision.ruleId).toBe("addressed-request-via-quote:review");
  });

  it("stays undecided when the quote links another pull request too", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({ text: QUOTING }),
        quotedPrKeys: ["acme/acme-admin#16378", "acme/acme-admin#16379"],
      },
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("request-reaches-the-pull-request-through-a-quote");
  });

  it("stays undecided when nothing it quotes could be read, as on the live leg", () => {
    const decision = classifyReviewCandidate({ candidate: candidateOf({ text: QUOTING }) });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("reaches-the-pull-request-through-nothing-this-read-saw");
  });
});

describe("classifyReviewCandidate — following up", () => {
  it("reads 'as a follow up' as a noun, not a request", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text: "<@U0SYN000004> <https://github.com/acme/acme-admin/pull/16378> is up; CI deploys as a follow up",
      }),
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("addressed-without-a-request");
  });

  it("still reads 'following up on this one' as a bump", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({
        text: "<@U0SYN000004> following up on this one <https://github.com/acme/acme-admin/pull/16378>",
      }),
    });
    expect(decision.ruleId).toBe("addressed-request:following-up");
  });
});

describe("classifyReviewCandidate — a reply that names its pull request only through its thread's root", () => {
  const REPLY = "<@U0SYN000004> please review this";

  it("is the ask when the root links exactly this pull request", () => {
    const decision = classifyReviewCandidate({
      candidate: { ...candidateOf({ text: REPLY }), threadPrKeys: ["acme/acme-admin#16378"] },
    });
    expect(askOf({ decision }).recipients).toEqual(["U0SYN000004"]);
    expect(decision.ruleId).toBe("addressed-request-via-thread:review");
  });

  it("stays undecided when the root links two pull requests, so `this` could be either", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({ text: REPLY }),
        threadPrKeys: ["acme/acme-admin#16378", "acme/acme-admin#16379"],
      },
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("request-reaches-the-pull-request-through-its-thread");
  });

  it("lets a quote decide before the thread", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({ text: REPLY }),
        quotedPrKeys: ["acme/acme-admin#16999"],
        threadPrKeys: ["acme/acme-admin#16378"],
      },
    });
    expect(decision.ruleId).toBe("request-reaches-the-pull-request-through-a-quote");
  });

  it("is a non-ask when a colleague's reply in the owner's thread asks something of them", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({ authorId: "U0SYN000023", authorRole: "other-human", text: "can you review my fix first?" }),
        threadPrKeys: ["acme/acme-admin#16378"],
      },
    });
    expect(decision.ruleId).toBe("somebody-else-wrote-it");
  });
});

describe("classifyReviewCandidate — a thread reply that names a need rather than an act", () => {
  it("stays undecided on an explanation of a block", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({
          number: 16331,
          text: "I've been trying man since the Acme cutover, but stays blocked on <!subteam^S0SYN000012> codeowner tick",
        }),
        threadPrKeys: ["acme/acme-admin#16331"],
      },
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("thread-reply-reports-rather-than-asks");
  });

  it("still certifies a bump in the same position", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({ number: 16415, text: "Bumpity bump <@U0SYN000012> :pray:" }),
        threadPrKeys: ["acme/acme-admin#16415"],
      },
    });
    expect(askOf({ decision }).recipients).toEqual(["U0SYN000012"]);
    expect(decision.ruleId).toBe("addressed-request-via-thread:bump");
  });
});

describe("classifyReviewCandidate — a need-word anywhere in a thread reply", () => {
  it("stays undecided when an act word precedes the need it explains", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({
          text: "I've been bumping this since the Acme cutover, but stays blocked on <!subteam^S0SYN000012> codeowner tick",
        }),
        threadPrKeys: ["acme/acme-admin#16378"],
      },
    });
    expect(decision.ruleId).toBe("thread-reply-names-a-need");
  });
});

describe("classifyReviewCandidate — a need named through the group a thread reply tags", () => {
  it("stays undecided when the only need-word is the user group's label", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({
          text: "I've been bumping this since the Acme cutover, but stays blocked on <!subteam^S0SYN000012|@platform-codeowners>",
        }),
        threadPrKeys: ["acme/acme-admin#16378"],
      },
    });
    expect(decision.ruleId).toBe("thread-reply-names-a-need");
  });
});

describe("classifyReviewCandidate — every need signal withholds a thread reply's certification", () => {
  const NEEDS = [
    "still waiting on the ticks <@U9>, bumping",
    "bumping, blocked on <@U9> approval",
    "bumping for a sign-off from <@U9>",
    "bumping, <@U9> is the code-owner",
    "bumping <!subteam^S1|@platform_codeowners>",
  ];

  it("reads each as undecided rather than an ask", () => {
    const rules = NEEDS.map(
      (text) =>
        classifyReviewCandidate({
          candidate: { ...candidateOf({ text }), threadPrKeys: ["acme/acme-admin#16378"] },
        }).ruleId,
    );
    expect(NEEDS.length).toBeGreaterThan(0);
    expect(rules).toEqual(NEEDS.map(() => "thread-reply-names-a-need"));
  });
});

describe("classifyReviewCandidate — a thread reply reporting what the owner did themselves", () => {
  const REPORTS = [
    "reviewed, left some Qs <@U9>",
    "Reviewing now <@U9>!",
    "taking a look now <@U9>",
    "had a look at the code you linked <@U9>",
    "Haven't had a look yet <@U9>",
  ];

  it("reads each of five real replies as undecided rather than an ask of the person tagged", () => {
    const rules = REPORTS.map(
      (text) =>
        classifyReviewCandidate({
          candidate: { ...candidateOf({ text }), threadPrKeys: ["acme/acme-admin#16378"] },
        }).ruleId,
    );
    expect(REPORTS.length).toBeGreaterThan(0);
    expect(rules).toEqual(REPORTS.map(() => "thread-reply-reports-rather-than-asks"));
  });

  it("still certifies a plain please, and a bump, in the same position", () => {
    const asked = ["<@U9> please review this", "Bumpity bump <@U9> :pray:"].map(
      (text) =>
        classifyReviewCandidate({
          candidate: { ...candidateOf({ text }), threadPrKeys: ["acme/acme-admin#16378"] },
        }).kind,
    );
    expect(asked).toEqual(["ask", "ask"]);
  });
});

describe("classifyReviewCandidate — a thread reply quoting somebody else's request", () => {
  it("reads the quote as their words, not the owner's, so answering an ask is not making one", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({
          text: "&gt; <@U0SYN000001> please review this when you get a chance\nsure <@U0SYN000019>, will look after standup",
        }),
        threadPrKeys: ["acme/acme-admin#16378"],
      },
    });
    expect(decision.ruleId).toBe("request-only-in-a-quote");
  });
});

describe("classifyReviewCandidate — the owner's own re-asks in a thread", () => {
  const ASKS: readonly { readonly text: string; readonly who: readonly string[] }[] = [
    { text: "thanks <@U0SYN000002>. both points are in. re-review when you get a sec?", who: ["U0SYN000002"] },
    {
      text: "<@U0SYN000004> this is ready for your codeowner review now. I folded the SDS cost work in.",
      who: ["U0SYN000004"],
    },
    {
      text: "ready for your tick when one of you has 2 min, <@U0SYN000002> <@U0SYN000033>",
      who: ["U0SYN000002", "U0SYN000033"],
    },
    {
      text: "<@U0SYN000019> mind taking this one when you get a sec? it's green, just needs your codeowner pass",
      who: ["U0SYN000019"],
    },
    { text: "Ready whenever you get a chance to take another look.", who: [] },
  ];

  it("certifies each as an ask of the people it names, a direct ask outranking the need it asks for", () => {
    const asked = ASKS.map(({ text }) =>
      classifyReviewCandidate({
        candidate: {
          ...candidateOf({ conversation: "direct-message", counterpartId: "U0SYN000019", text }),
          threadPrKeys: ["acme/acme-admin#16378"],
        },
      }),
    );
    expect(ASKS.length).toBeGreaterThan(0);
    expect(asked.map((decision) => decision.kind)).toEqual(ASKS.map(() => "ask"));
    expect(asked.map((decision) => (decision.kind === "ask" ? decision.recipients : []))).toEqual(
      ASKS.map(({ who }) => (who.length === 0 ? ["U0SYN000019"] : who)),
    );
  });
});

describe("classifyReviewCandidate — an inheriting reply asking in words the lexicon has no word for", () => {
  it("abstains rather than certifying a real 'ready for round 2' as a non-ask", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({ text: "Thanks <@U0SYN000007>, ready for round 2 :pray:" }),
        threadPrKeys: ["acme/acme-admin#16378"],
      },
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("asks-in-a-form-this-read-has-no-word-for");
  });

  it("still certifies ordinary thread banter as a non-ask", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({ text: "<@U9> ha, good thing the other Abel is not in this channel" }),
        threadPrKeys: ["acme/acme-admin#16378"],
      },
    });
    expect(decision.ruleId).toBe("quoted-link-no-request");
  });
});

describe("classifyReviewCandidate — the quote route runs the same gates as the thread route", () => {
  const QUOTED = ["acme/acme-admin#16378"];

  it("withholds a real report quoting a colleague's chase, which certified an ask of them", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({
          text: "<@U0SYN000023> yes! couple fixes have gone out already, this one is just waiting on review",
        }),
        quotedPrKeys: QUOTED,
      },
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("thread-reply-reports-rather-than-asks");
  });

  it("still certifies two real asks that name their pull request only through a quote", () => {
    const kinds = [
      "<@U0SYN000004> could you pls review this one?",
      "<@U0SYN000004> Speaking of which, pls review my E2E speed boost",
    ].map((text) => classifyReviewCandidate({ candidate: { ...candidateOf({ text }), quotedPrKeys: QUOTED } }).kind);
    expect(kinds).toEqual(["ask", "ask"]);
  });
});

describe("classifyReviewCandidate — a direct message reaching pull requests through an unfurl", () => {
  it("abstains rather than answering never-asked on a handover to a codeowner", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({
          conversation: "direct-message",
          counterpartId: "U0SYN000019",
          text: "in the meantime, got a big Acme stack for you",
        }),
        quotedPrKeys: ["acme/acme-admin#16378"],
      },
    });
    expect(decision.kind).toBe("undecided");
    expect(decision.ruleId).toBe("direct-message-reaches-it-indirectly-without-a-request");
  });

  it("abstains on the corpus leg too, where no record ever names the other party", () => {
    const decision = classifyReviewCandidate({
      candidate: {
        ...candidateOf({ conversation: "direct-message", text: "in the meantime, got a big Acme stack for you" }),
        quotedPrKeys: ["acme/acme-admin#16378"],
      },
    });
    expect(decision.ruleId).toBe("direct-message-reaches-it-indirectly-without-a-request");
  });

  it("still answers non-ask when nothing names the pull request but the message's own silence", () => {
    const decision = classifyReviewCandidate({
      candidate: candidateOf({ conversation: "direct-message", counterpartId: "U0SYN000019", text: "morning!" }),
    });
    expect(decision.ruleId).toBe("quoted-link-no-request");
  });
});
