/*
 * The console's queue card, which is the only place on the console where a sentence the owner reads is BUILT
 * rather than quoted whole from a verb. Nothing in `next build` can catch a wording regression, so this
 * file is the whole ratchet: every property the owner asked for — no ellipsis, no invented
 * lean, the fold carrying the whole text — is asserted here or it is asserted nowhere. It sits under
 * `site/__tests__/unit/` because a file under `src/` may not import one outside it (TS6059, the CI
 * `compile` job); the unit lane reaches both roots.
 */

import { describe, expect, it } from "vitest";

import { postCard } from "../../lib/postCard";
import { proseParts } from "../../lib/proseParts";
import {
  asQuestion,
  foldedText,
  kindWords,
  localPagesIn,
  overCap,
  QUESTION_MAX_WORDS,
  readable,
  sentencesOf,
  subjectLabel,
  WHAT_MAX_SENTENCES,
  WHAT_MAX_WORDS,
  withHomeShortened,
  withoutLocalPaths,
  wordsOf,
} from "../../lib/queueCard";
import { actCard, steerDraft } from "../../lib/queueCardAct";
import { askCard, cappedLead, leadQuestion, reasonBeyondQuestion } from "../../lib/queueCardAsk";
import { cardNumber, queueCounts } from "../../lib/queueCardCounts";
import { draftCard } from "../../lib/queueCardDraft";
import { nameTheReviewerCard, prCard } from "../../lib/queueCardPull";

/** The autonomy ledger row the queue page showed the owner as a raw `<dl>`, verbatim from `autonomy list --json`. */
const REAL_ACT = {
  kind: "open-internal-finding-pull-request",
  said: "I opened a pull request on my own repository: the fleet briefing was making a fresh copy of itself every time it ran, 48 of them, and I fixed the thing that let it. Nobody outside this machine sees the change.",
  subject: "https://github.com/lachiejames/slopweaver/pull/1063",
  why: "A fleet finding on THIS repository, not a team-facing surface: 33 ticks of the fleet briefing forked into 48 directories because a sed rewrote the artifact id, and the fix is a store-level refusal plus the canon change that makes the id state. Rule 10 and the owner's ruling put a slopweaver-repo PR from a fleet-found bug on the session's judgement with a ledger row.",
} as const;

describe("wordsOf", () => {
  it("counts whitespace-separated runs", () => {
    expect(wordsOf({ text: "one two  three" })).toBe(3);
  });

  it("answers zero for text that is only whitespace", () => {
    expect(wordsOf({ text: "   \n " })).toBe(0);
  });
});

describe("sentencesOf", () => {
  it("keeps each terminator with the sentence it ends", () => {
    expect(sentencesOf({ text: "One. Two! Three?" })).toEqual(["One.", "Two!", "Three?"]);
  });

  it("answers one sentence for prose with no terminator", () => {
    expect(sentencesOf({ text: "no full stop here" })).toEqual(["no full stop here"]);
  });

  it("answers nothing for empty text", () => {
    expect(sentencesOf({ text: "" })).toEqual([]);
  });
});

describe("foldedText", () => {
  it("shows the whole of a short body and folds nothing", () => {
    const folded = foldedText({ text: "Short enough. Two sentences." });
    expect(folded.aboveFold).toBe("Short enough. Two sentences.");
    expect(folded.folded).toBe(false);
    expect(folded.whole).toBe("Short enough. Two sentences.");
  });

  it("stops at the sentence cap and folds the rest", () => {
    const text = "One. Two. Three. Four. Five.";
    const folded = foldedText({ text });
    expect(folded.aboveFold).toBe("One. Two. Three. Four.");
    expect(sentencesOf({ text: folded.aboveFold }).length).toBe(WHAT_MAX_SENTENCES);
    expect(folded.folded).toBe(true);
  });

  it("carries the WHOLE text in the fold, never only the remainder", () => {
    const text = "One. Two. Three. Four. Five.";
    expect(foldedText({ text }).whole).toBe(text);
  });

  it("never cuts a sentence, so the fold's first words are a sentence's own", () => {
    const folded = foldedText({ text: REAL_ACT.why });
    expect(folded.aboveFold.endsWith(".")).toBe(true);
    expect(folded.folded).toBe(true);
  });

  it("writes no ellipsis anywhere — the page never truncates", () => {
    const folded = foldedText({ text: REAL_ACT.why });
    expect(folded.aboveFold.includes("…")).toBe(false);
    expect(folded.aboveFold.includes("...")).toBe(false);
  });

  it("shows a first sentence that alone exceeds the word cap WHOLE rather than cutting it", () => {
    const long = `${Array.from({ length: WHAT_MAX_WORDS + 20 }, () => "word").join(" ")}. And a second one.`;
    const folded = foldedText({ text: long });
    expect(wordsOf({ text: folded.aboveFold })).toBe(WHAT_MAX_WORDS + 20);
    expect(folded.folded).toBe(true);
  });

  it("stops at the word cap when the sentence cap has not been reached", () => {
    const first = `${Array.from({ length: 40 }, () => "a").join(" ")}.`;
    const second = `${Array.from({ length: 40 }, () => "b").join(" ")}.`;
    const folded = foldedText({ text: `${first} ${second}` });
    expect(folded.aboveFold).toBe(first);
    expect(folded.folded).toBe(true);
  });
});

describe("overCap", () => {
  it("reports a field over its cap", () => {
    expect(overCap({ max: 2, text: "one two three" })).toBe(true);
  });

  it("does not report a field exactly at its cap", () => {
    expect(overCap({ max: 3, text: "one two three" })).toBe(false);
  });
});

describe("asQuestion", () => {
  it("leaves a question mark alone", () => {
    expect(asQuestion({ text: "Is it right?" })).toBe("Is it right?");
  });

  it("replaces a full stop rather than doubling the punctuation", () => {
    expect(asQuestion({ text: "Is it right." })).toBe("Is it right?");
  });

  it("adds one to prose that ends in none", () => {
    expect(asQuestion({ text: "Is it right" })).toBe("Is it right?");
  });
});

describe("kindWords", () => {
  it("turns a hyphenated ledger kind into words", () => {
    expect(kindWords({ kind: "press-merge-when-ready" })).toBe("press merge when ready");
  });

  it("turns a dotted ledger kind into words", () => {
    expect(kindWords({ kind: "config.claude-permissions-deny" })).toBe("config claude permissions deny");
  });

  it("leaves a kind it has never seen exactly as the ledger wrote it", () => {
    expect(kindWords({ kind: "somethingnobodyhasnamedyet" })).toBe("somethingnobodyhasnamedyet");
  });
});

describe("subjectLabel", () => {
  it("shortens a pull-request URL to owner/repo#number", () => {
    expect(subjectLabel({ subject: "https://github.com/lachiejames/slopweaver/pull/1063" })).toBe(
      "lachiejames/slopweaver#1063",
    );
  });

  it("names the channel a Slack archive link is in", () => {
    expect(subjectLabel({ subject: "https://acme.slack.com/archives/C0SYN000001/p1789946458018139" })).toBe(
      "Slack C0SYN000001",
    );
  });

  it("drops only the scheme from a URL it does not recognise", () => {
    expect(subjectLabel({ subject: "https://example.test/a/b" })).toBe("example.test/a/b");
  });

  it("leaves a subject that is not a URL exactly as recorded", () => {
    expect(subjectLabel({ subject: "the-board-row-slug" })).toBe("the-board-row-slug");
  });
});

describe("actCard", () => {
  it("asks about the ledger's own kind and subject, never an invented verb phrase", () => {
    expect(actCard({ act: REAL_ACT, pulls: [] }).question).toBe(
      "Was open internal finding pull request on lachiejames/slopweaver#1063 the right call?",
    );
  });

  it("opens on the line written for the owner, never on the fleet's own note", () => {
    const card = actCard({ act: REAL_ACT, pulls: [] });
    expect(card.what!.aboveFold).toBe(REAL_ACT.said);
    // The phrases the owner found unparsable, asserted absent against an input that CARRIES them: the
    // fixture's `why` says "Rule 10" and "the owner's ruling", so this reddens the moment the fold flips back.
    expect(card.what!.aboveFold).not.toContain("Rule 10");
    expect(card.what!.aboveFold).not.toContain("the owner's ruling");
  });

  // The fleet's note is not dropped: `Queue.tsx` draws it as a `recordLine` in the record disclosure,
  // where `./recordLines.ts`'s cap holds it. It simply is not what the card opens with any more.
  it("keeps the fleet's note out of the what entirely", () => {
    const card = actCard({ act: REAL_ACT, pulls: [] });
    expect(card.what!.whole).toBe(REAL_ACT.said);
  });

  // Neither a sentence explaining the gap nor the fleet's note (whose `why` carries "Rule 10") stands in for it.
  it("draws no what at all on a row recorded before the plain-words line existed", () => {
    const card = actCard({ act: { ...REAL_ACT, said: undefined }, pulls: [] });
    expect(card.what).toBe(undefined);
  });

  it("opens on the pull request's title alone when the row has no plain-words line", () => {
    const card = actCard({ act: { ...FINDING_1353, said: undefined }, pulls: [PULL_1353] });
    expect(card.what!.whole).toBe(`${PULL_1353.title}.`);
  });

  it("draws no what from a pull request whose title is only blanks and full stops", () => {
    const card = actCard({ act: { ...FINDING_1353, said: undefined }, pulls: [{ ...PULL_1353, title: " . " }] });
    expect(card.what).toBe(undefined);
  });

  it("carries no problem, stakes or lean, because the ledger records none of them", () => {
    const card = actCard({ act: REAL_ACT, pulls: [] });
    expect([card.problem, card.stakes, card.lean]).toEqual([undefined, undefined, undefined]);
  });

  it("offers three options: Approve and Deny pressed on this panel, and the owner's own word said in the call", () => {
    const options = actCard({ act: REAL_ACT, pulls: [] }).options;
    expect(options.map((option) => [option.letter, option.how])).toEqual([
      ["A", { button: "Approve", kind: "press" }],
      ["B", { button: "More → Deny", kind: "press" }],
      ["C", { command: undefined, kind: "elsewhere", where: "the call's chat, with this card open" }],
    ]);
  });

  it("says the row stays unsteered if the owner says nothing", () => {
    expect(actCard({ act: REAL_ACT, pulls: [] }).ifSilent).toContain("stays unsteered");
  });
});

/** The finding act behind a card the owner skipped, as the gate recorded it: named by its slug alone. */
const FINDING_1353 = {
  kind: "open-internal-finding-pull-request",
  said: "I opened a pull request for a problem the fleet found itself, rather than one you asked about.",
  subject: "codex-seats-spawn-the-chatgpt-app-s-computer",
  why: "codex-seats-spawn-the-chatgpt-app-s-computer is an unruled fleet finding whose work reaches nobody but the owner.",
} as const;

/** The owner's open pull request, as the landing reading carries it. */
const PULL_1353 = {
  boardRowSlug: undefined,
  headRefName: "codex-seats-spawn-the-chatgpt-app-s-computer",
  number: 1353,
  repoSlug: "lachiejames/slopweaver",
  title:
    "No Codex Slopweaver starts can launch the ChatGPT app's browser, and a seat or pass on a home that still would is refused",
  url: "https://github.com/lachiejames/slopweaver/pull/1353",
} as const;

describe("actCard over the open pull request the act joined", () => {
  it("names the pull request in its subject and question", () => {
    const card = actCard({ act: FINDING_1353, pulls: [PULL_1353] });
    expect([card.subject, card.question]).toEqual([
      "lachiejames/slopweaver#1353",
      "Was open internal finding pull request on lachiejames/slopweaver#1353 the right call?",
    ]);
  });

  it("opens on the pull request's own title, then the ledger's line", () => {
    const card = actCard({ act: FINDING_1353, pulls: [PULL_1353] });
    expect(card.what!.whole).toBe(`${PULL_1353.title}. ${FINDING_1353.said}`);
  });

  it("keeps the ledger's subject when no pull request joined", () => {
    const card = actCard({ act: FINDING_1353, pulls: [] });
    expect([card.subject, card.what!.whole]).toEqual([FINDING_1353.subject, FINDING_1353.said]);
  });

  it("picks neither of two joined pull requests", () => {
    const other = { ...PULL_1353, number: 1360, url: "https://github.com/lachiejames/slopweaver/pull/1360" };
    const card = actCard({ act: FINDING_1353, pulls: [PULL_1353, other] });
    expect([card.subject, card.what!.whole]).toEqual([FINDING_1353.subject, FINDING_1353.said]);
  });
});

describe("steerDraft", () => {
  it("records fixed words for A and B and leaves C to the owner, said in the call", () => {
    expect(steerDraft({ letter: "A" })).toBe("right call");
    expect(steerDraft({ letter: "B" })).toBe("wrong call");
    expect(steerDraft({ letter: "C" })).toBe("");
  });
});

describe("askCard", () => {
  // Options are never boilerplate. An ask that recorded none draws none — the reaction field is how the owner
  // answers it — rather than "answer it / leave it", which says nothing the owner does not already know.
  it("draws no made-up options on an ask that recorded none", () => {
    const card = askCard({
      row: {
        priority: "p1",
        lean: undefined,
        options: [],
        problem: undefined,
        question: "Open the PR on this?",
        reason: "waiting on the owner",
        artifactPage: undefined,
        slug: "a-turn-routed-under-a-sibling",
        summary: "The abandoned-turn card told the channel the ask had been dropped.",
        commands: [],
        offered: undefined,
        threadUrl: undefined,
        risk: undefined,
        blastRadius: undefined,
        stillReal: undefined,
        stillRealIso: undefined,
        examples: [],
        exampleGap: undefined,
      },
    });
    expect(card.options).toEqual([]);
    expect(card.lean).toBe(undefined);
  });

  it("draws no thread option either — the thread is already on the panel", () => {
    const card = askCard({
      row: {
        priority: undefined,
        lean: undefined,
        options: [],
        problem: undefined,
        question: "Which grouping do you want?",
        reason: "waiting on the owner",
        artifactPage: undefined,
        slug: "a-few-candidate-groupings",
        summary: undefined,
        commands: [],
        offered: undefined,
        threadUrl: "https://acme.slack.com/archives/C0SYN000001/p1789946458018139",
        risk: undefined,
        blastRadius: undefined,
        stillReal: undefined,
        stillRealIso: undefined,
        examples: [],
        exampleGap: undefined,
      },
    });
    expect(card.options).toEqual([]);
  });

  it("draws no problem, lean or stakes whose recorded text is only blanks", () => {
    const card = askCard({
      row: {
        priority: undefined,
        lean: "  ",
        options: [],
        problem: " ",
        question: "Which grouping do you want?",
        reason: "waiting on the owner",
        artifactPage: undefined,
        slug: "a-few-candidate-groupings",
        summary: undefined,
        commands: [],
        offered: undefined,
        threadUrl: undefined,
        risk: "A wrong choice causes rework",
        blastRadius: "   ",
        stillReal: "The issue still reproduces",
        stillRealIso: undefined,
        examples: [],
        exampleGap: undefined,
      },
    });
    expect([card.problem, card.lean, card.stakes]).toEqual([undefined, undefined, undefined]);
  });
});

describe("draftCard", () => {
  it("leans on the door's own stated reason for holding the reply", () => {
    const card = draftCard({
      draft: {
        askedBy: "U0123",
        channel: "C0SYN000001",
        id: "draft-7",
        question: "Can you confirm the rollout window?",
        reason: "the answer names a date no verb measured",
      },
    });
    expect(card.lean).toBe("The door held it because the answer names a date no verb measured.");
    expect([card.problem, card.stakes]).toEqual([undefined, undefined]);
    expect(card.ifSilent).toContain("gets no answer");
  });

  it("drops who asked where when either is blank, keeping what the door did", () => {
    const card = draftCard({
      draft: { askedBy: " ", channel: "C0SYN000001", id: "draft-7", question: "When?", reason: "it names a date" },
    });
    expect(card.what!.whole).toBe(
      "The bot composed a reply and the outbound door held it rather than sending: it names a date.",
    );
  });

  it("draws no lean, and no dangling reason in its what, when the door recorded only blanks", () => {
    const card = draftCard({
      draft: { askedBy: "U0123", channel: "C0SYN000001", id: "draft-7", question: "When?", reason: "   " },
    });
    expect(card.lean).toBe(undefined);
    expect(card.what!.whole).toBe(
      "U0123 asked this in C0SYN000001. The bot composed a reply and the outbound door held it rather than sending.",
    );
  });
});

describe("prCard", () => {
  it("leans on github landing's own next act", () => {
    const card = prCard({
      row: {
        action: "conflicting",
        actionDetail: "a local merge into staging could not resolve one file",
        blockedOn: ["@acme/acme-eng"],
        ci: "green",
        ciFailure: { kind: "not-red" },
        dispatchWhy: "the verb refused to hand a conflict resolution to a session",
        number: 17564,
        repoSlug: "acme/acme-admin",
        title: "fix(EEEE-840): let the prebooking suite assert the real booking transition",
      },
    });
    expect(card.lean).toBe("github landing says conflicting: a local merge into staging could not resolve one file");
    expect(card.subject).toBe("acme/acme-admin#17564");
    expect(card.what!.whole).toContain("Blocked on @acme/acme-eng.");
  });

  it("adds nothing to the what when the reading carries no why, rather than a sentence saying so", () => {
    const card = prCard({
      row: {
        action: "press",
        actionDetail: "every test passed",
        blockedOn: [],
        ci: "green",
        ciFailure: { kind: "not-red" },
        dispatchWhy: undefined,
        number: 1,
        repoSlug: "lachiejames/slopweaver",
        title: "a title",
      },
    });
    expect(card.what!.whole).toBe("CI is green.");
  });

  it("brackets the title, so its own punctuation and quotes survive beside the action", () => {
    const row = {
      action: "press",
      actionDetail: "every check passed",
      blockedOn: [],
      ci: "green",
      ciFailure: { kind: "not-red" },
      dispatchWhy: undefined,
      number: 1,
      repoSlug: "lachiejames/slopweaver",
    } as const;
    expect(prCard({ row: { ...row, title: "Should we ship?" } }).question).toBe("#1 (Should we ship?): press?");
    expect(prCard({ row: { ...row, title: "a title" } }).question).toBe("#1 (a title): press?");
    expect(prCard({ row: { ...row, title: "Release —" } }).question).toBe("#1 (Release —): press?");
    expect(prCard({ row: { ...row, title: 'Fix "Update now"' } }).question).toBe('#1 (Fix "Update now"): press?');
    expect(prCard({ row: { ...row, title: "Fix “Update now”" } }).question).toBe("#1 (Fix “Update now”): press?");
    expect(prCard({ row: { ...row, title: "fix(console): a" } }).question).toBe("#1 (fix(console): a): press?");
  });

  it("draws no what when the rollup gave no word and every other value is blank", () => {
    const card = prCard({
      row: {
        action: "press",
        actionDetail: "every test passed",
        blockedOn: ["  "],
        ci: "   ",
        ciFailure: { kind: "not-red" },
        dispatchWhy: " ",
        number: 1,
        repoSlug: "lachiejames/slopweaver",
        title: "a title",
      },
    });
    expect(card.what).toBe(undefined);
  });

  it("draws no lean when the reading gives its action no detail", () => {
    const card = prCard({
      row: {
        action: "press",
        actionDetail: " ",
        blockedOn: [],
        ci: "green",
        ciFailure: { kind: "not-red" },
        dispatchWhy: undefined,
        number: 1,
        repoSlug: "lachiejames/slopweaver",
        title: "a title",
      },
    });
    expect(card.lean).toBe(undefined);
  });

  it("says what a red build is red on, and never reads an unknown requirement as advisory", () => {
    const opening = ([true, false, undefined] as const).map(
      (required) =>
        prCard({
          row: {
            action: "spawn-ci",
            actionDetail: "a check failed",
            blockedOn: [],
            ci: "red",
            ciFailure: { kind: "red", required },
            dispatchWhy: "yours",
            number: 1,
            repoSlug: "acme/acme-admin",
            title: "a title",
          },
        }).what!.whole.split(". ")[0],
    );
    expect(opening).toStrictEqual([
      "CI is red on a required check",
      "CI is red on advisory checks only",
      "CI is red, and the reading could not tell whether a failing check is required",
    ]);
  });
});

describe("queueCounts", () => {
  it("counts what blocks a colleague or the fleet apart from the check-ins", () => {
    const counts = queueCounts({
      rows: [
        { tier: "team-blocked" },
        { tier: "team-blocked" },
        { tier: "fleet-blocked" },
        { tier: "check-in" },
        { tier: "check-in" },
        { tier: "check-in" },
      ],
    });
    expect(counts.waiting).toBe(3);
    expect(counts.toReview).toBe(3);
  });

  it("answers two measured zeros for an empty queue", () => {
    expect(queueCounts({ rows: [] })).toEqual({ toReview: 0, waiting: 0 });
  });
});

describe("withoutLocalPaths", () => {
  it("replaces a local page address with the page's own name", () => {
    expect(
      withoutLocalPaths({
        text: "Two need your word, both on file:///Users/someone/.slopweaver/pages/alerts-where-the-bot-posts/index.html — (A) do we read the metric?",
      }),
    ).toBe("Two need your word, both on the alerts-where-the-bot-posts page — (A) do we read the metric?");
  });

  it("leaves prose that names no page exactly as the record wrote it", () => {
    expect(withoutLocalPaths({ text: "CI is green. Nothing else." })).toBe("CI is green. Nothing else.");
    expect(
      withoutLocalPaths({
        text: "see file:///u/.slopweaver/pages/alpha/index.html?tab=a#x and file:///u/.slopweaver/pages/alpha/index.html.",
      }),
    ).toBe("see the alpha page and the alpha page.");
  });
});

describe("localPagesIn", () => {
  it("hands the panel the address the prose no longer prints", () => {
    const pages = localPagesIn({
      text: "see file:///Users/someone/.slopweaver/pages/before-after-proof-architectures/index.html for the four",
    });
    expect(pages.length).toBe(1);
    expect(pages[0].slug).toBe("before-after-proof-architectures");
    expect(pages[0].url).toBe("file:///Users/someone/.slopweaver/pages/before-after-proof-architectures/index.html");
  });

  it("keeps a query and fragment, and leaves sentence punctuation behind", () => {
    const pages = localPagesIn({
      text: "open file:///Users/someone/.slopweaver/pages/alpha/index.html?tab=a#finding. Then (file:///Users/someone/.slopweaver/pages/beta/index.html).",
    });
    expect(pages.map((page) => page.url)).toEqual([
      "file:///Users/someone/.slopweaver/pages/alpha/index.html?tab=a#finding",
      "file:///Users/someone/.slopweaver/pages/beta/index.html",
    ]);
    expect(
      localPagesIn({
        text: "see file:///u/.slopweaver/pages/alpha/index.html?q=O'Reilly now, or 'file:///u/.slopweaver/pages/beta/index.html'.",
      }).map((page) => page.url),
    ).toEqual([
      "file:///u/.slopweaver/pages/alpha/index.html?q=O'Reilly",
      "file:///u/.slopweaver/pages/beta/index.html",
    ]);
  });

  it("never reads an address across a double quote, an angle bracket or a backtick", () => {
    expect(
      localPagesIn({
        text: 'see file:///tmp/a"/pages/alpha/index.html, file:///tmp/b>/pages/beta/index.html and file:///tmp/c`/pages/gamma/index.html',
      }),
    ).toEqual([]);
  });

  it("names one page once however many times the prose repeats it", () => {
    const url = "file:///Users/someone/.slopweaver/pages/one/index.html";
    expect(localPagesIn({ text: `${url} and again ${url}` }).length).toBe(1);
  });
});

describe("leadQuestion", () => {
  it("takes the sentence that actually asks, not the whole paragraph", () => {
    expect(
      leadQuestion({
        text: "Open the PR on this? The abandoned-turn card told the channel that the ask had been dropped while a leased worker was answering it. undispatchedSweepAction judges only the ask's own messageTs.",
      }),
    ).toBe("Open the PR on this?");
  });

  it("never manufactures a question mark the register did not write", () => {
    const lead = leadQuestion({
      text: "Breakdown, the steer-vs-shipped gap and two example posts are done. Two need your word.",
    });
    expect(lead).toBe("Breakdown, the steer-vs-shipped gap and two example posts are done.");
  });

  it("ignores a question mark buried past the opening sentences", () => {
    expect(leadQuestion({ text: "One. Two. Three is where the real question sits? Four." })).toBe("One.");
  });

  it("answers the empty string on empty prose rather than throwing", () => {
    expect(leadQuestion({ text: "   " })).toBe("");
  });
});

describe("askCard", () => {
  it("leads with the asked sentence and folds the rest of the paragraph away", () => {
    const card = askCard({
      row: {
        priority: "p1",
        lean: undefined,
        options: [],
        problem: undefined,
        question:
          "Open the PR on this? The abandoned-turn card told the channel that the ask had been dropped while a leased worker was answering it, and the page is file:///Users/someone/.slopweaver/pages/abandoned-card-sibling-ts/index.html with a six-row timeline.",
        reason: "waiting on a ruling",
        artifactPage: undefined,
        slug: "a-turn-declined-two-atlases-that-are-published",
        summary: undefined,
        commands: [],
        offered: undefined,
        threadUrl: undefined,
        risk: undefined,
        blastRadius: undefined,
        stillReal: undefined,
        stillRealIso: undefined,
        examples: [],
        exampleGap: undefined,
      },
    });
    expect(card.question).toBe("Open the PR on this?");
    expect(card.what!.aboveFold.startsWith("Open the PR on this?")).toBe(false);
    expect(card.what!.whole).toContain("the abandoned-card-sibling-ts page");
    expect(card.what!.whole).toContain("The run is parked: waiting on a ruling.");
    expect(card.pages.length).toBe(1);
    expect(card.pages[0].slug).toBe("abandoned-card-sibling-ts");
  });
});

describe("withHomeShortened", () => {
  it("shortens an absolute home path rather than dropping it", () => {
    expect(
      withHomeShortened({
        text: "Observed from /Users/someone/.slopweaver/supervisor-scratch/handoff-9291/publish-291-tail.sh",
      }),
    ).toBe("Observed from ~/.slopweaver/supervisor-scratch/handoff-9291/publish-291-tail.sh");
  });

  it("shortens a linux home the same way", () => {
    expect(withHomeShortened({ text: "at /home/runner/work/out.log" })).toBe("at ~/work/out.log");
  });

  it("leaves a path that is not under a home alone", () => {
    expect(withHomeShortened({ text: "at /var/log/system.log" })).toBe("at /var/log/system.log");
  });
});

describe("readable", () => {
  it("drops a page address and shortens what is left, in that order", () => {
    expect(
      readable({
        text: "Page: file:///Users/someone/.slopweaver/pages/alerts/index.html — written to /Users/someone/scratch/notes.md",
      }),
    ).toBe("Page: the alerts page — written to ~/scratch/notes.md");
  });
});

describe("actCard", () => {
  it("carries no absolute home path into what the owner reads", () => {
    const card = actCard({
      act: {
        kind: "open-internal-finding-pull-request",
        said: "I fixed it from /Users/someone/.slopweaver/supervisor-scratch/handoff-9291/publish-291-tail.sh.",
        subject: "https://github.com/lachiejames/slopweaver/pull/1063",
        why: "Observed by a session from /Users/someone/.slopweaver/supervisor-scratch/handoff-9291/publish-291-tail.sh and again from /Users/someone/.slopweaver/supervisor-scratch/handoff-9291/publish-292-tail.sh.",
      },
      pulls: [],
    });
    expect(card.what!.aboveFold).toBe(
      "I fixed it from ~/.slopweaver/supervisor-scratch/handoff-9291/publish-291-tail.sh.",
    );
    // The input CARRIES the absolute path, so this reddens if the shortening is ever dropped.
    expect(card.what!.aboveFold).not.toContain("/Users/");
  });
});

describe("proseParts", () => {
  it("returns one text run for prose carrying no address", () => {
    expect(proseParts({ text: "asked: unknown — 4 message(s) this read cannot settle" })).toEqual([
      { kind: "text", text: "asked: unknown — 4 message(s) this read cannot settle" },
    ]);
  });

  it("draws each Slack permalink as its own channel label, so four of them stop being one wall", () => {
    const text =
      "asked: unknown — https://acme.slack.com/archives/C0SYN000002p1788491238904859 " +
      "https://acme.slack.com/archives/C0SYN000022/p1788309498747489";
    expect(proseParts({ text })).toEqual([
      { kind: "text", text: "asked: unknown — " },
      {
        kind: "link",
        label: "Slack C0SYN000002",
        url: "https://acme.slack.com/archives/C0SYN000002p1788491238904859",
      },
      { kind: "text", text: " " },
      {
        kind: "link",
        label: "Slack C0SYN000022",
        url: "https://acme.slack.com/archives/C0SYN000022/p1788309498747489",
      },
    ]);
  });

  it("labels a GitHub pull request address as owner/repo#number", () => {
    expect(proseParts({ text: "see https://github.com/acme/acme-admin/pull/16367 first" })).toEqual([
      { kind: "text", text: "see " },
      {
        kind: "link",
        label: "acme/acme-admin#16367",
        url: "https://github.com/acme/acme-admin/pull/16367",
      },
      { kind: "text", text: " first" },
    ]);
  });

  it("leaves a trailing full stop on the text run rather than inside the address", () => {
    expect(proseParts({ text: "at https://example.com/a." })).toEqual([
      { kind: "text", text: "at " },
      { kind: "link", label: "example.com/a", url: "https://example.com/a" },
      { kind: "text", text: "." },
    ]);
  });

  it("returns nothing at all for the empty string", () => {
    expect(proseParts({ text: "" })).toEqual([]);
  });

  it("returns a single link run when the whole value is one address", () => {
    expect(proseParts({ text: "https://github.com/lachiejames/slopweaver/pull/1065" })).toEqual([
      {
        kind: "link",
        label: "lachiejames/slopweaver#1065",
        url: "https://github.com/lachiejames/slopweaver/pull/1065",
      },
    ]);
  });
});

describe("cappedLead", () => {
  it("leaves a sentence inside the cap exactly as written", () => {
    expect(cappedLead({ text: "Open the PR on this?" })).toBe("Open the PR on this?");
  });

  it("cuts a sentence past the cap at the em dash the prose already pauses on", () => {
    const text =
      "Before/after proof — four architectures on one page: the before-after-proof-architectures page — " +
      "A generalise the capture, B the declared side, C the harness stays team-facing, D proof as a typed record";
    expect(cappedLead({ text })).toBe(
      "Before/after proof — four architectures on one page: the before-after-proof-architectures page",
    );
  });

  it("cuts at the later of two pauses sharing a space", () => {
    const tail = Array.from({ length: 30 }, (_, at) => `word${String(at)}`).join(" ");
    expect(cappedLead({ text: `one — — ${tail}` })).toBe("one —");
  });

  it("cuts at the word cap when no pause sits inside it", () => {
    const text = Array.from({ length: 40 }, (_, at) => `word${String(at)}`).join(" ");
    expect(cappedLead({ text }).split(" ")).toHaveLength(QUESTION_MAX_WORDS);
  });

  it("returns the empty string unchanged", () => {
    expect(cappedLead({ text: "" })).toBe("");
  });
});

describe("leadQuestion past the cap", () => {
  it("caps a long STATEMENT lead", () => {
    const text =
      "Before/after proof — four architectures on one page: the before-after-proof-architectures page — " +
      "A generalise the capture, B the declared side, C the harness stays team-facing, D proof as a typed record.";
    expect(leadQuestion({ text })).toBe(
      "Before/after proof — four architectures on one page: the before-after-proof-architectures page",
    );
  });

  it("never cuts a real question, because cutting one loses both the ask and its mark", () => {
    const text =
      "Two need your word, both on the alerts-where-the-bot-posts page — do we read the metric for a " +
      "metric-threshold monitor the way we read a log query, which unsticks impact, or do we not?";
    expect(leadQuestion({ text })).toBe(text);
  });
});

describe("cardNumber", () => {
  it("numbers a drawn row by its place in the list, from one", () => {
    expect(cardNumber({ drawnKeys: ["hand:a", "ask:b", "act:c"], key: "ask:b" })).toBe(2);
  });

  it("gives a row the drawn list does not hold NO number, rather than a zero", () => {
    expect(cardNumber({ drawnKeys: ["hand:a", "ask:b"], key: "act:gone" })).toBeUndefined();
  });

  it("gives nothing on an empty list, where an index arithmetic would have answered 0", () => {
    expect(cardNumber({ drawnKeys: [], key: "hand:a" })).toBeUndefined();
  });
});

/**
 * A synthetic recorded ask, `ask:search-reindex-review`, in the shape `slopweaver handover list --json` publishes.
 * Its `reason` is `waiting on the owner: ` followed by this whole string again, which doubles the body under
 * "the rest of what the record says". MEASURED on a board: 38 of the 43 rows carrying a question have the whole
 * question inside their own reason. Repro: `slopweaver handover list --json` and compare `reason.includes(question)`.
 */
const SYNTHETIC_ASK =
  "The search reindex PR passes on every preview deploy and still has no reviewer. Two weeks now, and the nightly import keeps rewriting the rows the reindex drops.\n\nABC-1 no longer blocks it: the backfill fills the column the slow query reads, so the query recovers on its own, and the ticket has sat in Backlog since the last sprint.";

describe("reasonBeyondQuestion", () => {
  it("answers what the reason says BEYOND the question it already quoted", () => {
    expect(
      reasonBeyondQuestion({ question: "Open the PR on this?", reason: "waiting on the owner: Open the PR on this?" }),
    ).toBe("waiting on the owner");
  });

  it("empties a reason that is the question and nothing else, so no sentence is drawn at all", () => {
    expect(reasonBeyondQuestion({ question: "Open the PR on this?", reason: "Open the PR on this?" })).toBe("");
  });

  it("KEEPS the pre-approved-stop line the board wraps around the question", () => {
    expect(
      reasonBeyondQuestion({
        question: "May I re-record the cassette?",
        reason:
          "recording a cassette is pre-approved and needs no permission. The recorded question: May I re-record the cassette?",
      }),
    ).toBe("recording a cassette is pre-approved and needs no permission. The recorded question");
  });

  it("answers the reason unchanged when the question is not inside it", () => {
    expect(reasonBeyondQuestion({ question: "Open the PR on this?", reason: "waiting on a ruling" })).toBe(
      "waiting on a ruling",
    );
  });

  it("answers the reason unchanged for a row carrying no question", () => {
    expect(reasonBeyondQuestion({ question: "   ", reason: "waiting on a ruling" })).toBe("waiting on a ruling");
  });

  // Both found by review pass r2 (subtraction-drops-nothing-new) as latent, neither reachable on the
  // board as it stands — which is exactly why they are pinned here rather than left to the data.
  it("removes EVERY copy of the question, not just the first", () => {
    expect(
      reasonBeyondQuestion({
        question: "Open the PR on this?",
        reason: "waiting on the owner: Open the PR on this? and again Open the PR on this?",
      }),
    ).toBe("waiting on the owner: and again");
  });

  it("strips a trailing full stop, because the card writes the sentence\u2019s own", () => {
    expect(
      reasonBeyondQuestion({ question: "Open the PR on this?", reason: "waiting on the owner. Open the PR on this?" }),
    ).toBe("waiting on the owner");
  });

  it("strips the whole multi-paragraph ask out of its reason, leaving the four words that were new", () => {
    expect(reasonBeyondQuestion({ question: SYNTHETIC_ASK, reason: `waiting on the owner: ${SYNTHETIC_ASK}` })).toBe(
      "waiting on the owner",
    );
  });
});

describe("askCard over a row the owner reacted to", () => {
  it("no longer prints the record body twice", () => {
    const card = askCard({
      row: {
        lean: undefined,
        options: [],
        problem: undefined,
        priority: "p3",
        question: SYNTHETIC_ASK,
        reason: `waiting on the owner: ${SYNTHETIC_ASK}`,
        artifactPage: undefined,
        slug: "search-reindex-review",
        summary: undefined,
        commands: [],
        offered: undefined,
        threadUrl: undefined,
        risk: undefined,
        blastRadius: undefined,
        stillReal: undefined,
        stillRealIso: undefined,
        examples: [],
        exampleGap: undefined,
      },
    });
    // The defect, named exactly: the body used to end with the whole question again behind this prefix.
    expect(card.what!.whole).not.toContain(
      "The run is parked: waiting on the owner: The search reindex PR passes on every preview deploy",
    );
    expect(card.what!.whole).toContain("The run is parked: waiting on the owner.");
    // Its lead asks nothing: an old row to reword, headed by its lead as written and never a label bolted on.
    expect(card.question).toBe("The search reindex PR passes on every preview deploy and still has no reviewer.");
  });

  it("keeps a reason that says something the question did not — the over-firing guard", () => {
    const card = askCard({
      row: {
        lean: undefined,
        options: [],
        problem: undefined,
        priority: "p1",
        question: "Open the PR on this?",
        reason: "waiting on a ruling",
        artifactPage: undefined,
        slug: "a-turn-declined-two-atlases-that-are-published",
        summary: undefined,
        commands: [],
        offered: undefined,
        threadUrl: undefined,
        risk: undefined,
        blastRadius: undefined,
        stillReal: undefined,
        stillRealIso: undefined,
        examples: [],
        exampleGap: undefined,
      },
    });
    expect(card.what!.whole).toContain("The run is parked: waiting on a ruling.");
  });
});

describe("a card from a register that is not an ask", () => {
  it("carries no problem statement rather than inventing one, or a sentence saying it has none", () => {
    const card = actCard({
      act: {
        kind: "pr-comment-cleared",
        said: "Took CodeRabbit's rename on #1081.",
        subject: "lachiejames/slopweaver#1081",
        why: "CodeRabbit asked for a rename and the fleet took it.",
      },
      pulls: [],
    });
    expect([card.problem, card.stakes]).toEqual([undefined, undefined]);
  });

  it("carries no trade-off on any of its options, because the console would have to author one", () => {
    const card = actCard({
      act: {
        kind: "pr-comment-cleared",
        said: "Took CodeRabbit's rename on #1081.",
        subject: "lachiejames/slopweaver#1081",
        why: "CodeRabbit asked for a rename and the fleet took it.",
      },
      pulls: [],
    });
    expect(card.options.length).toBeGreaterThan(0);
    expect(card.options.filter((option) => option.tradeoff !== undefined)).toEqual([]);
  });
});

describe("postCard — the one card whose subject would go out as the owner", () => {
  /** A parked draft's card fields, as `rowsOf` hands them over. */
  const parked = {
    act: undefined,
    row: undefined,
    addressed: "to Ari in #iso-27001",
    advisory: ["the opener is longer than the owner's measured median"],
    context: "in #iso-27001",
    digest: "3f2a9c11d4e5b6a7",
    people: [{ id: "U0SYN000003", label: "Ari" }],
    id: "sd-1a2b3c4d",
    mentions: ["@security", "@ada"],
    parent: undefined,
    receiptsLine: "Receipts: 1 link",
    release: {
      command: "slopweaver slack post --as me --draft sd-1a2b3c4d --approve 3f2a9c11d4e5b6a7",
      kind: "send",
    } as const,
    text: "Four groups, one question.",
    why: "the entry-group question the four-group thread left open",
  };

  /** The same draft parked as a reply under Jonah's thread — the shape `sd-5e79b37a` should have had. */
  const reply = {
    ...parked,
    addressed: "in a thread in #proj-monitoring",
    parent: 'under Jonah\'s message: "staging pool exhausted"',
    release: {
      command: "slopweaver slack reply --as me --draft sd-1a2b3c4d --approve 3f2a9c11d4e5b6a7",
      kind: "send",
    } as const,
  };

  it("offers a thread reply's release through slack reply, the verb the register chose", () => {
    expect(postCard({ post: reply }).options[0]).toEqual({
      how: {
        command: "slopweaver slack reply --as me --draft sd-1a2b3c4d --approve 3f2a9c11d4e5b6a7",
        kind: "elsewhere",
        where: "a session, through the door",
      },
      letter: "A",
      sentence: "Send it as it stands: the reply goes into the thread under your own name.",
    });
  });

  it("asks about a reply as a reply, and opens its what on the message it goes under", () => {
    const card = postCard({ post: reply });
    expect(card.question).toBe("Reply with this as you?");
    expect(
      card.what!.whole.startsWith('Receipts: 1 link. It replies under Jonah\'s message: "staging pool exhausted".'),
    ).toBe(true);
  });

  it("offers no send for a top-level row whose why says thread reply, only the re-record", () => {
    const why = "parked top-level, but its why says thread reply — the release refuses it.";
    const card = postCard({ post: { ...parked, release: { kind: "re-record", why } } });
    expect(card.options[0]).toEqual({
      how: {
        command: 'slopweaver slack draft drop sd-1a2b3c4d --note "re-recorded: <the new row\'s id>"',
        kind: "elsewhere",
        where: "a session, after re-recording it as the reason says",
      },
      letter: "A",
      sentence: `Re-record it, then drop this row: ${why}`,
    });
    expect(card.what!.whole).toContain(`It cannot be sent as parked: ${why}`);
  });

  it("asks about a bot row as the bot's post, and says so on its send", () => {
    const bot = {
      ...parked,
      actor: "bot" as const,
      release: {
        command: "slopweaver slack post --as bot --draft sd-1a2b3c4d --approve 3f2a9c11d4e5b6a7",
        kind: "send",
      } as const,
    };
    const card = postCard({ post: bot });
    expect([card.question.endsWith("as the bot?"), card.options[0].sentence]).toEqual([
      true,
      "Send it as it stands: the message posts as the bot.",
    ]);
  });

  it("offers no press at all: every option is a command a session runs through the door", () => {
    const card = postCard({ post: parked });
    expect(card.options.map((option) => option.how.kind)).toEqual(["elsewhere", "elsewhere", "silence"]);
    expect(card.options[0].how).toEqual({
      command: "slopweaver slack post --as me --draft sd-1a2b3c4d --approve 3f2a9c11d4e5b6a7",
      kind: "elsewhere",
      where: "a session, through the door",
    });
    expect(card.options[1].how).toEqual({
      command: 'slopweaver slack draft drop sd-1a2b3c4d --note "<why>"',
      kind: "elsewhere",
      where: "a session",
    });
  });

  it("states no lean, because no verb has one on a message that would carry the owner's name", () => {
    const card = postCard({ post: parked });
    expect(card.lean).toBe(undefined);
  });

  it("names who it would tag, with the count the owner would otherwise have to take off the list", () => {
    const card = postCard({ post: parked });
    expect(card.what!.whole).toContain("It tags 2: @security, @ada.");
  });

  it("says it tags nobody rather than printing an empty list", () => {
    const card = postCard({ post: { ...parked, mentions: [] } });
    expect(card.what!.whole).toContain("It tags nobody.");
    expect(postCard({ post: { ...parked, mentions: ["   "] } }).what!.whole).toContain("It tags nobody.");
  });

  it("goes from its receipts straight to who it tags when the recorder stated no why, with no blank between", () => {
    const card = postCard({ post: { ...parked, mentions: [], why: "   " } });
    expect(card.what!.whole).toBe(
      "Receipts: 1 link. It tags nobody. Nothing has been sent: the recorder parked it here.",
    );
  });

  it("leads with its receipts, closing the line once however the recorder ended it", () => {
    const lead = (receiptsLine: string): string =>
      postCard({ post: { ...parked, mentions: [], receiptsLine, why: "   " } }).what!.whole.split(" It tags")[0];
    expect([
      lead("No receipts named"),
      lead("No receipt needed: the DM is the question itself."),
      lead("No receipt. Tried: Datadog refused the share link"),
    ]).toEqual([
      "No receipts named.",
      "No receipt needed: the DM is the question itself.",
      "No receipt. Tried: Datadog refused the share link.",
    ]);
  });

  it("asks what it sends and as whom, and leaves who and where to the head and the subject", () => {
    const card = postCard({ post: parked });
    expect(card.question).toBe("Post this as you?");
    expect(card.subject).toBe("to Ari in #iso-27001");
    expect(card.head).toEqual({
      act: undefined,
      row: undefined,
      context: "in #iso-27001",
      people: [{ id: "U0SYN000003", label: "Ari" }],
      peopleVerb: "To",
    });
  });

  it("says silence sends nothing, which is the whole property the register exists for", () => {
    const card = postCard({ post: parked });
    expect(card.ifSilent).toBe("Nothing is sent. The draft stays parked and the channel hears nothing from you.");
  });

  it("says the judgement line its caller computed straight after its receipts, ahead of the rest", () => {
    const judgementLine = "NOT SENT (no-fleet-slot): every session slot is busy until the review lands";
    const card = postCard({ post: { ...parked, judgementLine } });
    const plain = postCard({ post: parked });
    expect(card.what!.whole).toBe(
      plain.what!.whole.replace("Receipts: 1 link. ", `Receipts: 1 link. ${judgementLine} `),
    );
  });
});

describe("askCard over an OFFERED ask", () => {
  /** A row whose action the panel has already resolved into sends, which is the shape `queueRows` hands in. */
  const offered = {
    commands: [],
    lean: "Take A: #delivery is where a review actually gets picked up.",
    offered: [
      {
        command: "slopweaver slack post --as me --channel C01SDLC --shape top-level --body - <<'EOF'\nready?\nEOF",
        label: "Post it to #delivery",
        tradeoff: "the whole channel sees we are asking",
        where: "a new top-level message in C01SDLC",
      },
      {
        command: "slopweaver slack post --as me --channel D01ARI --shape top-level --body - <<'EOF'\nready?\nEOF",
        label: "DM Ari",
        tradeoff: "only Ari sees it, so nobody else can pick it up",
        where: "a DM to Ari",
      },
    ],
    options: [
      { letter: "A", option: "Post it to #delivery", tradeoff: "the whole channel sees we are asking" },
      { letter: "B", option: "DM Ari", tradeoff: "only Ari sees it, so nobody else can pick it up" },
      { letter: "C", option: "Hold it — send nothing for now", tradeoff: "the thread moves on without our answer" },
    ],
    priority: "p1",
    problem: "The E2E switch-over has sat unreviewed for four days.",
    question: "Do you want to post this into #delivery?",
    reason: "waiting on the owner",
    artifactPage: undefined,
    slug: "an-ask-offers-the-concrete-action",
    summary: undefined,
    threadUrl: undefined,
    risk: undefined,
    blastRadius: undefined,
    stillReal: undefined,
    stillRealIso: undefined,
    examples: [],
    exampleGap: undefined,
  };

  it("draws one option per destination, in order, with the leave-it option last", () => {
    const card = askCard({ row: offered });
    expect(card.options.map((option) => option.sentence)).toEqual([
      "Post it to #delivery",
      "DM Ari",
      "Leave it: the board keeps the row parked on you and no session picks it up.",
    ]);
    expect(card.options.map((option) => option.letter)).toEqual(["A", "B", "C"]);
  });

  it("carries each destination's own trade-off onto its option", () => {
    const card = askCard({ row: offered });
    expect(card.options[0].tradeoff).toBe("the whole channel sees we are asking");
    expect(card.options[1].tradeoff).toBe("only Ari sees it, so nobody else can pick it up");
  });

  it("prints the exact send command under each option, rather than a button that would send it", () => {
    const card = askCard({ row: offered });
    expect(card.options[0].how).toEqual({
      command: "slopweaver slack post --as me --channel C01SDLC --shape top-level --body - <<'EOF'\nready?\nEOF",
      kind: "elsewhere",
      where: "a new top-level message in C01SDLC",
    });
  });

  it("keeps the hold as real silence — nothing to press, and nothing sent", () => {
    const card = askCard({ row: offered });
    expect(card.options[2].how).toEqual({ kind: "silence" });
  });

  it("falls back to the recorded options, the verb's own hold included, when the panel resolved no sends", () => {
    const card = askCard({ row: { ...offered, offered: undefined } });
    expect(card.options.map((option) => option.sentence)).toEqual([
      "Post it to #delivery",
      "DM Ari",
      "Hold it — send nothing for now",
    ]);
  });

  it("falls back the same way on an empty send list, rather than drawing an ask with no choices", () => {
    const card = askCard({ row: { ...offered, offered: [] } });
    expect(card.options).toHaveLength(3);
  });
});

describe("an ask card's title — the Vanta reactivation card", () => {
  const vantaRow = ({ question }: { question: string }) =>
    askCard({
      row: {
        blastRadius: undefined,
        lean: undefined,
        commands: [],
        offered: undefined,
        options: [],
        priority: "p1",
        problem: undefined,
        question,
        reason: "declared ready",
        risk: undefined,
        artifactPage: undefined,
        slug: "acme-reactivate-cve-2026-47429",
        stillReal: undefined,
        stillRealIso: undefined,
        examples: [],
        exampleGap: undefined,
        summary: undefined,
        threadUrl: undefined,
      },
    });

  it("heads with the question the row asks, as written", () => {
    const card = vantaRow({
      question:
        "Should the fleet switch the Vanta finding for CVE-2026-47429 back on? It is a critical vitest " +
        "vulnerability that the bot switched off as a demo write.",
    });
    expect(card.question).toBe("Should the fleet switch the Vanta finding for CVE-2026-47429 back on?");
  });

  // A review counterexample: `v1.` is a legal page slug (`src/pages/url.ts`), and naming it "the v1. page"
  // BEFORE splitting made "Open the v1." the lead — a sentence break `handover register`'s gate never saw.
  it("picks the lead before naming a page, so a slug ending in '.' cannot make it a statement", () => {
    const card = vantaRow({
      question:
        "Open file:///Users/x/.slopweaver/pages/v1./index.html first. Should the fleet switch the finding back on?",
    });
    expect(card.question).toBe("Should the fleet switch the finding back on?");
  });

  it("never bolts a 'No question stated:' label onto an old row that asks nothing", () => {
    const card = vantaRow({
      question: "yes to the exact Vanta write that reactivates CVE-2026-47429. After it lands, the fix is a bump.",
    });
    expect(card.question).toBe("yes to the exact Vanta write that reactivates CVE-2026-47429.");
  });
});

describe("nameTheReviewerCard", () => {
  it("asks for the one word only the owner can give, naming the team and the wait", () => {
    const card = nameTheReviewerCard({
      row: {
        number: 17566,
        repoSlug: "acme/acme-admin",
        sentence: "Waiting on @acme/platform · requested 2026-09-19 23:43Z · no ask found · stale",
        title: "[QQQQ-170] feat(ci): post the local E2E result on every PR",
        who: ["@acme/platform"],
      },
    });
    expect(card.question).toBe(
      "Who on @acme/platform should review #17566 [QQQQ-170] feat(ci): post the local E2E result on every PR?",
    );
    expect(card.options.map((option) => option.sentence)).toStrictEqual([
      "Name the person on @acme/platform who should review it.",
      "Read it on GitHub first.",
    ]);
    expect(card.what!.whole).toBe("Waiting on @acme/platform · requested 2026-09-19 23:43Z · no ask found · stale.");
    expect(card.lean).toBe(
      "github landing says name the reviewer: Waiting on @acme/platform · requested 2026-09-19 23:43Z · no ask found · stale",
    );
  });

  it("draws no what and no lean when the wait gives no sentence", () => {
    const card = nameTheReviewerCard({
      row: {
        number: 1,
        repoSlug: "acme/acme-admin",
        sentence: "  ",
        title: "a title",
        who: ["@acme/platform"],
      },
    });
    expect([card.what, card.lean]).toEqual([undefined, undefined]);
  });
});
