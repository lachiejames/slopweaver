import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { classifyReviewCandidate } from "../../../review/askClassification.js";
import type { AskCandidate, TextSpan } from "../../../review/evidence.js";
import { findPrLinkSpans, firstLinkStart, mentionRunsIn } from "../../../review/prLink.js";

/**
 * THE ANSWER-COVERAGE GATE — the whole fleet, judged against a human's own labelling.
 *
 * A classifier can stop lying by ceasing to answer, and unit coverage cannot see the difference: every rule
 * test below `askClassification.test.ts` can pass while the product abstains on every real pull request. So
 * this file asserts the two things those tests cannot — how OFTEN it answers, and whether it ever answers
 * WRONGLY — over a whole fleet of messages at once.
 *
 * The fixture is a WRITTEN synthetic fleet: 46 Slack messages linking 21 open pull requests in a placeholder
 * `acme/acme-admin` repository, each labelled with the verdict a reader would give it. Every message is
 * hand-written to carry one shape the classifier has to tell apart — a heading ask over a bullet list, a
 * per-line recipient, a struck-through retraction, a carbon copy, a quoted permalink, a draft in the owner's
 * own bot DM, a colleague asking the OWNER, a product call that names review only to refuse it — so the text is
 * what is under test, and none of it is a recorded conversation.
 *
 * Its own bound, stated rather than discovered: the labels are one person's reading, so this measures
 * AGREEMENT with that reading, never truth.
 */
const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  join("..", "..", "fixtures", "review-ask", "synthetic-open-prs.json"),
);

interface FixtureMessage {
  readonly n: number;
  readonly want: "ASK" | "NOT-ASK" | "UNDECIDED";
  readonly why: string;
  readonly container: string;
  readonly isDirectMessage: boolean;
  readonly author: string;
  readonly rawUser: string | null;
  readonly botProfileUser: string | null;
  readonly prs: readonly number[];
  readonly authoredText: string;
  /** Pull requests linked inside a message unfurl the text itself links to — the quoted message's own links. */
  readonly quotedPrs: readonly number[];
}

interface Fixture {
  readonly owner: string;
  readonly selfUserIds: readonly string[];
  readonly messages: readonly FixtureMessage[];
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;

/** The conversations the bot has posted in, which are the owner's own — established across the whole set. */
const ownerOnly = new Set(
  fixture.messages
    .filter((message) => message.isDirectMessage && fixture.selfUserIds.includes(message.author))
    .map((message) => message.container),
);

/** Which of the three author roles a fixture message's author takes. */
function roleOf({ isApp, message }: { isApp: boolean; message: FixtureMessage }): AskCandidate["authorRole"] {
  if (isApp) {
    return "app";
  }
  return message.author === fixture.owner ? "owner" : "other-human";
}

/** Build one candidate exactly as the effectful shell does, with every span measured against the same string. */
function candidateFor({ message, number }: { message: FixtureMessage; number: number }): AskCandidate {
  const links = findPrLinkSpans({ text: message.authoredText });
  const spansForPr: readonly TextSpan[] = links.filter((entry) => entry.ref.number === number).map((e) => e.span);
  const isApp = message.botProfileUser !== null && message.botProfileUser === message.rawUser;
  const conversationKind = ownerOnly.has(message.container) ? "owner-only" : "direct-message";
  return {
    authoredPrCount: new Set(links.map((entry) => entry.ref.number)).size,
    authoredText: message.authoredText,
    firstLinkAt: firstLinkStart({ spans: links }),
    versionsDisagree: false,
    quotedPrKeys: message.quotedPrs.map((quoted) => `acme/acme-admin#${String(quoted)}`),
    threadPrKeys: [],
    authorId: message.author,
    authorRole: roleOf({ isApp, message }),
    conversation: message.isDirectMessage ? conversationKind : "channel",
    counterpartId: "",
    linkSpans: spansForPr,
    mentions: mentionRunsIn({ text: message.authoredText }),
    prKey: `acme/acme-admin#${String(number)}`,
  };
}

/** The strongest decision a message reached across every pull request it links. */
function verdictOf({ message }: { message: FixtureMessage }): "ASK" | "NOT-ASK" | "UNDECIDED" {
  const kinds = new Set(
    message.prs.map((number) => classifyReviewCandidate({ candidate: candidateFor({ message, number }) }).kind),
  );
  if (kinds.has("ask")) {
    return "ASK";
  }
  return kinds.has("undecided") ? "UNDECIDED" : "NOT-ASK";
}

describe("the ask classifier over the whole frozen fleet", () => {
  it("never certifies an ask the reader called a non-ask", () => {
    const wrong = fixture.messages.filter((message) => message.want === "NOT-ASK" && verdictOf({ message }) === "ASK");
    expect(wrong.map((message) => `[${String(message.n)}] ${message.why}`)).toEqual([]);
  });

  it("never certifies a non-ask the reader called an ask", () => {
    const wrong = fixture.messages.filter((message) => message.want === "ASK" && verdictOf({ message }) === "NOT-ASK");
    expect(wrong.map((message) => `[${String(message.n)}] ${message.why}`)).toEqual([]);
  });

  it("agrees with the reader on 45 of the 46 messages, the one divergence an abstention", () => {
    const agreed = fixture.messages.filter((message) => verdictOf({ message }) === message.want);
    const diverged = fixture.messages.filter((message) => verdictOf({ message }) !== message.want);
    expect(agreed.length).toBe(45);
    expect(fixture.messages.length).toBe(46);
    // "one more if you have the patience" — an ask the owner wrote in words no rule here certifies.
    expect(diverged.map((message) => [message.n, verdictOf({ message })])).toEqual([[42, "UNDECIDED"]]);
  });

  it("resolves both of the owner's asks that name the pull request only through a quoted Slack message", () => {
    const quoted = fixture.messages.filter((message) => [34, 39].includes(message.n));
    expect(quoted.map((message) => verdictOf({ message }))).toEqual(["ASK", "ASK"]);
  });

  it("answers 17 of the 21 pull requests this capture reaches asked, 2 never asked and 2 undecided", () => {
    const perPr = new Map<number, Set<string>>();
    for (const message of fixture.messages) {
      for (const number of message.prs) {
        const kind = classifyReviewCandidate({ candidate: candidateFor({ message, number }) }).kind;
        const kinds = perPr.get(number);
        if (kinds === undefined) {
          perPr.set(number, new Set([kind]));
        } else {
          kinds.add(kind);
        }
      }
    }
    const answers = [...perPr.values()].map((kinds) => ({ ask: kinds.has("ask"), undecided: kinds.has("undecided") }));
    // 21, not 22: the fleet stands for an owner with 22 open pull requests, one of which is discussed only in
    // a multi-person direct message the corpus scan does not carry, so only the live search leg ever sees
    // it. That is a coverage gap rather than a wrong answer, and it is why the live leg stays load-bearing.
    expect(perPr.size).toBe(21);
    expect(answers.filter((answer) => answer.ask).length).toBe(17);
    expect(answers.filter((answer) => !answer.ask && answer.undecided).length).toBe(2);
    expect(answers.filter((answer) => !answer.ask && !answer.undecided).length).toBe(2);
  });
});

describe("the owner's three worked examples, written into the synthetic fleet", () => {
  /** Every decision the fleet reached about one pull request, newest message first. */
  function decisionsFor({
    number,
  }: {
    number: number;
  }): readonly { readonly n: number; readonly recipients: readonly string[] }[] {
    return fixture.messages
      .filter((message) => message.prs.includes(number))
      .map((message) => ({
        decision: classifyReviewCandidate({ candidate: candidateFor({ message, number }) }),
        n: message.n,
      }))
      .flatMap((entry) =>
        entry.decision.kind === "ask" ? [{ n: entry.n, recipients: entry.decision.recipients }] : [],
      );
  }

  it("a never-asked pull request has no decision, though two messages of the owner's link it", () => {
    expect(fixture.messages.filter((message) => message.prs.includes(4151)).length).toBe(3);
    expect(decisionsFor({ number: 4151 })).toEqual([]);
  });

  it("an asked pull request was asked of BOTH people the owner tagged", () => {
    expect(decisionsFor({ number: 4197 }).map((entry) => entry.recipients)).toEqual([["U0014", "U0010"]]);
  });

  it("a batched pull request was asked of the reviewer on its own line, not the first tag in the batch", () => {
    expect(decisionsFor({ number: 4518 }).map((entry) => entry.recipients)).toEqual([["U0002"]]);
  });

  it("gives each of the batch's other open rows its own line's reviewer", () => {
    expect(decisionsFor({ number: 4502 }).map((entry) => entry.recipients)).toEqual([["U0008"]]);
    expect(decisionsFor({ number: 4508 }).map((entry) => entry.recipients)).toEqual([["U0008"]]);
    expect(decisionsFor({ number: 4511 }).map((entry) => entry.recipients)).toEqual([["U0002"]]);
    expect(decisionsFor({ number: 4512 }).map((entry) => entry.recipients)).toEqual([["U0008"]]);
  });

  /**
   * The same claim keyed on nothing the fixture's own id assignment decides.
   *
   * The exact synthetic ids above move if the fixture is ever re-cut, and a test that then goes green on a
   * re-numbered set while the attribution silently broke would be worse than no test. What actually matters
   * is the PARTITION: two of the batch's five open rows belong to one reviewer and three to another, and
   * the old whole-message union gave all five to the same person.
   */
  it("partitions the batch's five open rows between two different reviewers", () => {
    const who = ({ number }: { number: number }): string => decisionsFor({ number })[0]!.recipients[0]!;
    expect(who({ number: 4511 })).toBe(who({ number: 4518 }));
    expect(who({ number: 4502 })).toBe(who({ number: 4508 }));
    expect(who({ number: 4502 })).toBe(who({ number: 4512 }));
    expect(who({ number: 4502 })).not.toBe(who({ number: 4518 }));
    expect(
      new Set([
        who({ number: 4502 }),
        who({ number: 4508 }),
        who({ number: 4511 }),
        who({ number: 4512 }),
        who({ number: 4518 }),
      ]).size,
    ).toBe(2);
  });
});
