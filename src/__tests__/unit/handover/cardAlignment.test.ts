import { describe, expect, it } from "vitest";

import {
  cardAlignmentProblems,
  cardAlignmentVerdict,
  cardProseVerdict,
  UNALIGNED_CARD_HATCH,
} from "../../../handover/cardAlignment.js";

const PR_1085 = "https://github.com/lachiejames/slopweaver/pull/1085";

/** The refusal's lines, thrown past when the verdict recorded instead — so no assertion needs a branch. */
const refusedLines = ({ verdict }: { verdict: ReturnType<typeof cardProseVerdict> }): readonly string[] => {
  if (verdict.kind !== "refused") {
    throw new Error(`expected a refusal, got ${verdict.kind}`);
  }
  return verdict.lines;
};

describe("cardAlignmentProblems — the lead asks", () => {
  it("passes a question whose first sentence asks", () => {
    expect(cardAlignmentProblems({ question: "Push the staging branch, A or B? The branch is written." })).toEqual([]);
  });

  it("passes a question whose SECOND sentence asks — the card's heading looks at two", () => {
    expect(cardAlignmentProblems({ question: "The branch is written. Push it to staging, A or B?" })).toEqual([]);
  });

  it("refuses a lead that reports a merge and asks nothing", () => {
    const problems = cardAlignmentProblems({
      question: `The slopweaver half has LANDED — ${PR_1085} merged. Only the acme-admin base call is open. Say A or B.`,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('neither of its first 2 sentences ends in "?"');
  });

  it("refuses a question whose only `?` is in its third sentence", () => {
    const problems = cardAlignmentProblems({ question: "One. Two. Three, A or B?" });
    expect(problems).toHaveLength(1);
  });
});

describe("cardAlignmentProblems — a named pull request carries its link", () => {
  it("refuses a bare pull number with no URL, and names the spelling it found", () => {
    const problems = cardAlignmentProblems({ question: "Does #1085 still need the acme-admin half?" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('it names "#1085" with no link');
  });

  it("passes a bare pull number when the question carries its pull URL", () => {
    expect(cardAlignmentProblems({ question: `Does #1085 (${PR_1085}) still need the acme-admin half?` })).toEqual([]);
  });

  it("accepts an issue URL as the link for its number", () => {
    const question = "Close #42? https://github.com/acme/acme-admin/issues/42 is stale.";
    expect(cardAlignmentProblems({ question })).toEqual([]);
  });

  it("refuses each spelled form: PR with a number, PR with a hash, pull request with a number", () => {
    const problems = cardAlignmentProblems({ question: "Land PR 704, PR #16672 and pull request 618?" });
    expect(problems).toHaveLength(3);
  });

  // r3 review: `register` collapses its ask to one line and `ask`/`correct` do not, so a wrapped "pull\nrequest"
  // was refused by one verb and accepted by the other two — and the card drew it as an unlinked number.
  it("reads 'pull request' across a line break or a double space, as the card draws it", () => {
    expect(cardAlignmentProblems({ question: "Should we land the pull\nrequest 1234 today?" })).toEqual([
      'it names "pull\nrequest 1234" with no link — paste the pull request\'s github.com URL into the question ' +
        "itself, because the card links a pull request's number from the question and never from the shape",
    ]);
    expect(cardAlignmentProblems({ question: "Should we land the pull  request 1234 today?" })).toHaveLength(1);
  });

  it("names one number once, however many times the question repeats it", () => {
    expect(cardAlignmentProblems({ question: "Land #618? #618 is green." })).toHaveLength(1);
  });

  it("does not read a stack position, a one-digit list item, a fragment or an entity as a pull request", () => {
    const question = "Merge PR3 after option #1? See page.html#12 and it&#39;s fine.";
    expect(cardAlignmentProblems({ question })).toEqual([]);
  });
});

describe("cardAlignmentProblems — the heading says what a thing is before its code", () => {
  it("refuses the Vanta card's own words, the section numbers they could not place", () => {
    const problems = cardAlignmentProblems({
      question: "Is network segregation 2.1 and 3 what you want in Vanta? The two facts are marked.",
    });
    expect(problems).toEqual([expect.stringContaining('its heading it names "2.1 and 3" (a section-number list)')]);
  });

  it("passes the recut: the meaning first, each control code in parentheses after its name", () => {
    const question =
      "Do these two documents say what you want the ISO auditor to read about keeping production apart from test? " +
      "One covers Segregation of networks (NET-93), the other Test information (TDA-42).";
    expect(cardAlignmentProblems({ question })).toEqual([]);
  });

  it("judges the heading only, so a code in the third sentence onwards passes", () => {
    const question = "Send the held reply as drafted? It asks Jasper and Quinn two facts. It is sd-489d1ec2.";
    expect(cardAlignmentProblems({ question })).toEqual([]);
  });
});

describe("cardAlignmentProblems — the heading leads with the discussion, never a pull request", () => {
  it("refuses a heading asking the owner to approve the fix PR, however well linked", () => {
    const question = `Approve the fix PR for the gateway outage (${PR_1085})? Fixture events are dropping.`;
    expect(cardAlignmentProblems({ question })).toEqual([
      expect.stringContaining('its heading leads with a pull request ("Approve the fix") instead of the discussion'),
    ]);
  });

  it("passes the same card led by the evidence, the pull request named further in", () => {
    const question =
      "Should we raise the gateway errors with the team? The test dashboard shows every request failing since the deploy. " +
      `A fix exists as ${PR_1085} if they want it.`;
    expect(cardAlignmentProblems({ question })).toEqual([]);
  });

  it("refuses a background first sentence that hides a PR-led heading in the second, which the card heads with", () => {
    const question = `The evidence is attached. ${PR_1085} — should we merge it?`;
    expect(cardAlignmentProblems({ question })).toEqual([
      expect.stringContaining(`its heading leads with a pull request ("${PR_1085}") instead of the discussion`),
    ]);
  });
});

describe("cardAlignmentVerdict", () => {
  it("records an aligned question", () => {
    const verdict = cardAlignmentVerdict({ command: "slopweaver handover ask", env: {}, question: "Push it?" });
    expect(verdict.kind).toBe("ok");
  });

  it("refuses with the four-line hatch block, every problem, and what was not recorded", () => {
    const lines = refusedLines({
      verdict: cardAlignmentVerdict({ command: "slopweaver handover correct", env: {}, question: "We merged #1085." }),
    });
    expect(lines[0]).toContain("slopweaver handover correct blocked because the question does not line up");
    expect(lines[0]).toContain(`${UNALIGNED_CARD_HATCH}=1 slopweaver handover correct`);
    // No "?" and an unlinked bare number.
    expect(lines.filter((line) => line.startsWith("  - "))).toHaveLength(2);
    expect(lines.at(-1)).toContain("NOTHING was recorded");
  });

  it("records a refused question once the hatch is open", () => {
    const verdict = cardAlignmentVerdict({
      command: "slopweaver handover ask",
      env: { [UNALIGNED_CARD_HATCH]: "1" },
      question: "We merged #1085.",
    });
    expect(verdict.kind).toBe("ok");
  });

  // The hatch once cleared this with every other problem, though no ruling named an exception.
  it("holds a PR-led heading with the hatch open, naming the hatch it does not take", () => {
    const lines = refusedLines({
      verdict: cardAlignmentVerdict({
        command: "slopweaver handover ask",
        env: { [UNALIGNED_CARD_HATCH]: "1" },
        question: "Approve the fix PR for the gateway outage?",
      }),
    });
    expect(lines[0]).toBe(
      "slopweaver handover ask held: the card's heading leads with a pull request, and that rule has no hatch — " +
        `${UNALIGNED_CARD_HATCH} does not clear it (a card never leads with a pull request).`,
    );
    expect(lines.filter((line) => line.startsWith("  - "))).toEqual([
      expect.stringContaining('  - its heading leads with a pull request ("Approve the fix")'),
    ]);
  });

  it("holds a PR-led heading with the hatch shut, listing the hatchable problems beside it", () => {
    const lines = refusedLines({
      verdict: cardAlignmentVerdict({ command: "slopweaver handover ask", env: {}, question: "#1085 merged." }),
    });
    expect(lines[0]).toContain("slopweaver handover ask held: the card's heading leads with a pull request");
    expect(lines.filter((line) => line.startsWith("  - "))).toHaveLength(3);
  });

  it("refuses a question naming a picture file, pointing at handover shot", () => {
    const lines = refusedLines({
      verdict: cardAlignmentVerdict({
        command: "slopweaver handover ask",
        env: {},
        question: "Is the span-profiles tab empty, as span-profiles-tab.png shows?",
      }),
    });
    expect(lines.filter((line) => line.startsWith("  - "))).toEqual([
      '  - the question names the picture "span-profiles-tab.png" as text, which the card draws as a path the owner ' +
        "cannot see — attach it with slopweaver handover shot <slug> --shot <png> --box x,y,width,height=<label> so the " +
        "card shows it with a box on what to read, and say in words what it shows",
    ]);
  });
});

describe("cardProseVerdict", () => {
  const STILL_REAL = "the span-profiles tab is still empty, ~/.slopweaver/proof/tracing/span-profiles-tab.png";

  it("records prose naming no picture", () => {
    const verdict = cardProseVerdict({
      command: "slopweaver handover reconfirm",
      env: {},
      fields: [{ label: "the still-real check", text: "the span-profiles tab is still empty" }],
    });
    expect(verdict.kind).toBe("ok");
  });

  it("refuses a still-real line naming a picture, and says the card is what to reword", () => {
    const lines = refusedLines({
      verdict: cardProseVerdict({
        command: "slopweaver handover reconfirm",
        env: {},
        fields: [{ label: "the still-real check", text: STILL_REAL }],
      }),
    });
    expect(lines[0]).toContain(`${UNALIGNED_CARD_HATCH}=1 slopweaver handover reconfirm`);
    expect(lines.filter((line) => line.startsWith("  - "))).toHaveLength(1);
    expect(lines[1]).toContain(
      'the still-real check names the picture "~/.slopweaver/proof/tracing/span-profiles-tab.png"',
    );
    expect(lines.at(-1)).toBe(
      "NOTHING was recorded and the run is not paused, so reword the card and run the same command again.",
    );
  });

  it("records it once the hatch is open", () => {
    const verdict = cardProseVerdict({
      command: "slopweaver handover reconfirm",
      env: { [UNALIGNED_CARD_HATCH]: "1" },
      fields: [{ label: "the still-real check", text: STILL_REAL }],
    });
    expect(verdict.kind).toBe("ok");
  });
});

describe("cardAlignmentProblems — a command of the owner's sits on lines of its own", () => {
  const sudo = "sudo /bin/sh -c '/bin/cp ~/.slopweaver/machine/guard.plist /Library/LaunchDaemons/guard.plist'";

  it("passes the mds question as recorded: the sudo line is a paragraph the card lifts into a copy block", () => {
    const question = `Will you paste one sudo line, once, to install the guard?\n\n${sudo}\n\nIt keeps mds off.`;
    expect(cardAlignmentProblems({ question })).toEqual([]);
  });

  it("refuses the same command folded into a sentence, where the card draws it as text", () => {
    const question = `Will you paste one sudo line, once, to install the guard? Run ${sudo} in a terminal.`;
    const problems = cardAlignmentProblems({ question });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("a command only the owner's hands run — inside a sentence");
  });

  it("refuses two secrets stored in one sentence, and passes them as two lines of their own", () => {
    const buried = cardAlignmentProblems({
      question: "Will you store both values? Run slopweaver secrets set google-secops-client-id and then -secret.",
    });
    expect(buried).toHaveLength(1);
    const lifted = cardAlignmentProblems({
      question:
        "Will you store both values?\n\nslopweaver secrets set google-secops-client-id\n" +
        "slopweaver secrets set google-secops-client-secret",
    });
    expect(lifted).toEqual([]);
  });
});
