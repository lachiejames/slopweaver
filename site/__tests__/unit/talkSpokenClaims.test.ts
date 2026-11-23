/*
 * The voice's done claims and PR numbers, held to what the call said. The two replays are written synthetic projected
 * calls in the shape of real ones — each FINAL sentence of the voice's and of the owner's, and each completed message
 * of the thinking model's, in the order the page sees them. Their timestamps, kinds, order and punctuation follow
 * those calls; every word the fold does not read is an invented word of the same length, every id is synthetic, and
 * the one PR number is a synthetic one, so the fold makes the same decision on every line and the whole call is still
 * the false-positive measurement, not a handful of picks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { maskQuotes } from "../../lib/spokenQuotes";
import { countClaimsOf } from "../../lib/talkCountGrounding";
import {
  claimGroundingEntry,
  claimGroundingOf,
  doneWordsOf,
  foldSpokenClaims,
  NO_SPOKEN_CLAIMS,
  type SentenceClaim,
  type SpokenClaimsInput,
  type SpokenGroundingNote,
  scriptedCompletionRiskOf,
  spokenClaimsOf,
  spokenGroundingDetail,
} from "../../lib/talkSpokenClaims";
import { MAX_GROUNDING_KEY_CHARS } from "../../lib/talkVoiceRecord";

/** One line of a projected call. */
type Line =
  | { kind: "said"; id: string; text: string; at: string }
  | { kind: "heard"; text: string; at: string }
  | { kind: "wrote"; text: string; at: string };

/**
 * A projected call's lines, in the order the page saw them.
 *
 * @returns the lines
 */
function call({ file }: { file: string }): readonly Line[] {
  return readFileSync(join(__dirname, "fixtures", file), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Line);
}

/** An input as a test writes it: the owner's words or a completed message may leave out the id, and take their place's. */
type Fed = SpokenClaimsInput | { readonly kind: "heard" | "wrote"; readonly text: string };

/**
 * Feed the fold in order, as the page does.
 *
 * @returns every claim it owed a grounding, with the index of the input that owed it
 */
function fold({ inputs }: { inputs: readonly Fed[] }): readonly { at: number; claim: SentenceClaim }[] {
  let state = NO_SPOKEN_CLAIMS;
  const owed: { at: number; claim: SentenceClaim }[] = [];
  inputs.forEach((fed, at) => {
    const carriesNoId = fed.kind === "confirmed" || fed.kind === "offer-landed" || fed.kind === "owner-began";
    const input: SpokenClaimsInput = carriesNoId || "id" in fed ? fed : { ...fed, id: `${fed.kind}-${at}` };
    const step = foldSpokenClaims({ input, state });
    state = step.state;
    owed.push(...step.owed.map((claim) => ({ at, claim })));
  });
  return owed;
}

/**
 * Replay a call through the fold, with no send outcome (neither call had one).
 *
 * @returns every claim the fold owed a grounding, with the sentence's time
 */
function replay({ lines }: { lines: readonly Line[] }): readonly { at: string; claim: SentenceClaim }[] {
  const inputs = lines.map((line): Fed =>
    line.kind === "said" ? { id: line.id, kind: line.kind, text: line.text } : { kind: line.kind, text: line.text },
  );
  return fold({ inputs }).map(({ at, claim }) => ({ at: lines[at].at.slice(11, 19), claim }));
}

/**
 * The acts a run of inputs leaves owed, by act or number.
 *
 * @returns each owed claim's act or PR number
 */
function owedAfter({ inputs }: { inputs: readonly Fed[] }): readonly (string | number)[] {
  return fold({ inputs }).map(({ claim }) => {
    if (claim.kind === "outcome") {
      return claim.act;
    }
    return claim.kind === "pr-number" ? claim.claimed : claim.kind;
  });
}

const LONG_CALL = call({ file: "spokenGroundingLongCall.jsonl" });
const SHORT_CALL = call({ file: "spokenGroundingShortCall.jsonl" });

/**
 * One of the call's sentences, by its exact words.
 *
 * @returns the line's text
 */
function said({ lines, text }: { lines: readonly Line[]; text: string }): string {
  return lines.find((line) => line.kind === "said" && line.text.trim() === text)!.text;
}

describe("the draft-sent call, replayed whole", () => {
  it("has 91 sentences of the voice's, 68 of the owner's and 50 completed messages to measure over", () => {
    const kinds = ["said", "heard", "wrote"].map((kind) => LONG_CALL.filter((line) => line.kind === kind).length);
    expect(kinds).toEqual([91, 68, 50]);
  });

  it("owes exactly one grounding: 'Draft sent.' after a proposal and an empty answer", () => {
    expect(replay({ lines: LONG_CALL })).toEqual([
      { at: "00:44:10", claim: { act: "sent", kind: "outcome", start: 7, words: "Draft sent." } },
    ]);
  });

  it("is owed despite the owner's 'I've just sent that', which the proposal after it cleared", () => {
    const heard = LONG_CALL.find((line) => line.kind === "heard" && line.text.includes("I've just sent that"))!;
    expect(heard.at.slice(11, 19)).toBe("00:43:35");
    const inputs: readonly Fed[] = [
      { kind: "heard", text: heard.text },
      { kind: "wrote", text: "Send that bump, park it, or drop it?" },
      { id: "s1", kind: "said", text: "Draft sent." },
    ];
    expect([owedAfter({ inputs }), owedAfter({ inputs: [inputs[0], inputs[2]] })]).toEqual([["sent"], []]);
  });

  it("reads the owner's acts, a proposal, a refusal and a quotation as no done claim of the console's", () => {
    const notClaims = [
      "You sent Quinn the original",
      "You posted the release notes on Monday, and bumped Rowan on Thursday in the docs channel, but no one's replied.",
      "On it — I'll tell you when it's sent, or what stopped it.",
      "On it. I'll tell you if it doesn't go.",
      "You didn't authorize a send. I issued no instruction, and there's no new Slack message. Triage is still paused.",
      "Those extra comments never went out.",
      'The false "draft sent',
      `You're weighing your trust in a voice that says things like "draft sent" when you didn't ask it to act, and "PR 123" with no source.`,
      "We paused triage on a draft to Rowan about the build cache and an open question. Send that, park it, or drop it?",
    ];
    expect(notClaims.map((text) => spokenClaimsOf({ text }))).toEqual(notClaims.map(() => []));
  });

  it("is no count for 'that's the one it asks for', which read as Everything ninety-three", () => {
    const text = said({ lines: LONG_CALL, text: "Yes — that's the 'Read' box ticked; that's the one it asks for." });
    expect(countClaimsOf({ text })).toEqual([]);
  });
});

describe("the PR-number call, replayed whole", () => {
  it("owes exactly one grounding: PR one two three, which the answer never named", () => {
    const owed = replay({ lines: SHORT_CALL });
    expect(owed.map(({ at, claim }) => [at, claim.kind, claim.kind === "pr-number" && claim.claimed])).toEqual([
      ["23:06:43", "pr-number", 123],
    ]);
  });

  it("grounds the real number the next answer spelled out, said without its 'and'", () => {
    const text = "It's PR forty-five thousand six hundred seventy-eight from the link.";
    const wrote = "The link on your screen is PR forty-five thousand six hundred and seventy-eight, in the thread.";
    expect(spokenClaimsOf({ text })).toEqual([{ claimed: 45678, kind: "pr-number", start: 5, words: text }]);
    expect(
      owedAfter({
        inputs: [
          { kind: "wrote", text: wrote },
          { id: "s1", kind: "said", text },
        ],
      }),
    ).toEqual([]);
  });
});

describe("spokenClaimsOf", () => {
  it("reads each of the five acts said as done", () => {
    const texts = ["Draft sent.", "It's posted.", "PR merged.", "Approved it.", "Released to staging."];
    expect(texts.map((text) => spokenClaimsOf({ text }).map((claim) => claim.kind === "outcome" && claim.act))).toEqual(
      [["sent"], ["posted"], ["merged"], ["approved"], ["released"]],
    );
  });

  it("reads Tuesday's sentence as a done claim that it posted", () => {
    const text = "Your steered vuln fix top up for Acme admin posted and missed the deadline.";
    expect(owedAfter({ inputs: [{ id: "s1", kind: "said", text }] })).toEqual(["posted"]);
  });

  it("reads landed and went up as done only about an artifact, never a plane, a place or a count", () => {
    const claims = ["The PR landed.", "Your fix has landed.", "The post went up.", "The bump went up."];
    const notClaims = [
      "The plane landed.",
      "It landed on B.",
      "The count went up.",
      "It went up.",
      "The PR is landing once CI is green.",
      "Has the post gone up?",
      "The PR hasn't landed.",
    ];
    expect(
      claims.map((text) => spokenClaimsOf({ text }).map((claim) => claim.kind === "outcome" && claim.act)),
    ).toEqual([["landed"], ["landed"], ["went up"], ["went up"]]);
    expect(notClaims.map((text) => spokenClaimsOf({ text }))).toEqual(notClaims.map(() => []));
  });

  // Each is shaped on a true restatement from a call, names swapped for placeholders, and a
  // claim owed is now corrected aloud.
  it("reads no done claim in an act read off a record, placed in history, somebody else's, or sent back", () => {
    const texts = [
      `GitHub just now says Theo's fix merged yesterday, after your screenshot, and the monitor now shows "passing."`,
      "They expire next week, and the card says Sadie approved them last year.",
      "You're in your DM with Sadie and Seth, posted two hours ago about a flaky login test, no replies yet.",
      "So, one review request at a time, noting who already approved.",
      "Superseded and needs update, sent back.",
      "The message was sent on Monday.",
      "It was previously merged in September.",
    ];
    expect(texts.map((text) => spokenClaimsOf({ text }))).toEqual(texts.map(() => []));
  });

  it("reads the history or the record in the act's own clause only, so a claim in another clause still counts", () => {
    const texts = [
      "Yesterday it was still pending, but the message was sent just now.",
      "The card says pending, but the message was sent.",
      "The message was sent, but it failed yesterday.",
      "The card says the queue is empty and the message was sent.",
      "The message was sent and the card was approved yesterday.",
      "The card says the queue is empty, and draft two was sent.",
    ];
    expect(texts.map((text) => owedAfter({ inputs: [{ id: "s1", kind: "said", text }] }))).toEqual(
      texts.map(() => ["sent"]),
    );
  });

  it("grounds a 'sent' on a 'posted' the thinking model wrote, past the voice's recap of the owner's wish", () => {
    const wrote = "Both messages are posted. What we haven't done is review the overnight build plan.";
    const voice = {
      id: "s1",
      kind: "said",
      text: "You wanted to post the ISO reply. Both messages are sent.",
    } as const;
    expect([owedAfter({ inputs: [{ kind: "wrote", text: wrote }, voice] }), owedAfter({ inputs: [voice] })]).toEqual([
      [],
      ["sent"],
    ]);
  });

  it("never clears a 'posted' on a card sent back to the Queue, which no send is", () => {
    const wrote = "Your message is posted, tagging Jasper. Back to Jared's reply: which one, or send it back?";
    const voice = { id: "s1", kind: "said", text: "Your message is posted, tagging Jasper." } as const;
    const proposal = "Your message is posted, tagging Jasper. Want me to post another?";
    expect([
      owedAfter({ inputs: [{ kind: "wrote", text: wrote }, voice] }),
      owedAfter({ inputs: [{ kind: "wrote", text: proposal }, voice] }),
    ]).toEqual([[], ["posted"]]);
  });

  it("reads no done claim in a question, a negation, a wait, a proposal, an infinitive, an adjective or the owner's act", () => {
    const texts = [
      "Sent?",
      "It hasn't been sent.",
      "Nothing was posted.",
      "It'll be merged once CI is green.",
      "Want it sent?",
      "Ready to be posted.",
      "It's waiting to be approved.",
      "That goes in your sent folder.",
      "It gets sent when you say.",
      "You've already approved it.",
      "You've definitely sent it.",
      "You really just merged it.",
    ];
    expect(texts.map((text) => spokenClaimsOf({ text }))).toEqual(texts.map(() => []));
  });

  it("reads a PR number as digits, a hash, digit by digit, or a cardinal, after PR, PR number or pull request", () => {
    const texts = [
      "PR 18181 is green.",
      "Look at PR #18181.",
      "PR one two three.",
      "Pull request number two thousand four hundred and forty-nine.",
      "PR eighteen thousand one hundred and eighty-one.",
    ];
    expect(
      texts.map((text) => spokenClaimsOf({ text }).map((claim) => claim.kind === "pr-number" && claim.claimed)),
    ).toEqual([[18181], [18181], [123], [2449], [18181]]);
  });

  it("reads no PR number where the words after PR are no whole number, a lone small one, or half of one", () => {
    const texts = [
      "The PR one of them opened.",
      "PR eighteen one.",
      "PR, twenty minutes ago.",
      "The PR is green.",
      // Measured: read as PR eighteen thousand before the comma counted.
      "This one's clearer: the session for PR eighteen thousand, four hundred and seventeen is done.",
    ];
    expect(texts.map((text) => spokenClaimsOf({ text }))).toEqual(texts.map(() => []));
  });
});

describe("scriptedCompletionRiskOf", () => {
  it("finds Tuesday's slug, vulnfix-top-up-for-acme-admin-posted-in, which the voice read as 'posted'", () => {
    const text =
      "Your steered vulnfix-top-up-for-acme-admin-posted-in is at risk. said by 09:00Z, nothing posted yet, " +
      "and the run is still going.";
    expect(scriptedCompletionRiskOf({ text: "Your steered vulnfix-top-up-for-acme-admin-posted-in is at risk." })).toBe(
      "posted",
    );
    expect(scriptedCompletionRiskOf({ text })).toBe("posted");
  });

  it("finds a done word in a quoted slug with repeated, dotted or slashed separators", () => {
    expect(
      [
        'Your steered "foo--posted--bar" is at risk.',
        "Your steered fix/merged.today is at risk.",
        "Your steered foo__sent is at risk.",
        'Your steered row "café-posted" is at risk.',
        'Your steered row "foo‐posted" is at risk.',
        'Your steered row "café-posted" is at risk.',
        "Your steered row foo—merged is at risk.",
      ].map((text) => scriptedCompletionRiskOf({ text })),
    ).toEqual(["posted", "merged", "sent", "posted", "posted", "posted", "merged"]);
  });

  it("finds a done claim in prose and a two-word act in a slug, and nothing in plain negated prose", () => {
    expect(
      [
        "The fix landed.",
        "Your steered digest-went-up-by-nine is at risk.",
        "Your steered sup-4293 is at risk. Nothing was posted yet.",
        "Your steered weekly digest is at risk.",
      ].map((text) => scriptedCompletionRiskOf({ text })),
    ).toEqual(["landed", "went up", undefined, undefined]);
  });
});

describe("doneWordsOf", () => {
  it("says an act as done, went up as it is", () => {
    expect([doneWordsOf({ act: "posted" }), doneWordsOf({ act: "went up" })]).toEqual(["was posted", "went up"]);
  });
});

describe("maskQuotes", () => {
  it("blanks double and single quotations, keeps apostrophes, and blanks an unclosed one to the end", () => {
    expect(maskQuotes({ text: `that's 'Read' and "sent" here` })).toBe("that's        and        here");
    expect(maskQuotes({ text: 'The false "draft sent' })).toBe("The false            ");
  });

  it("keeps every offset when a quotation holds a character outside the basic plane", () => {
    const text = `"👍 sent" then merged`;
    const masked = maskQuotes({ text });
    expect(masked.length).toBe(text.length);
    expect(masked.indexOf("merged")).toBe(text.indexOf("merged"));
  });
});

describe("foldSpokenClaims, grounding a done claim", () => {
  const sent: SpokenClaimsInput = { id: "s1", kind: "said", text: "Draft sent. It's posted." };

  it("grounds one on a send outcome the console handed the voice", () => {
    expect(owedAfter({ inputs: [{ acts: ["sent", "posted"], kind: "confirmed" }, sent] })).toEqual([]);
  });

  it("grounds one on the owner's own words, as 'And sent.' after 'well I sent it like this'", () => {
    const heard = "Let's have a go Alright, well I sent it like this, but, good job.";
    const voice = { id: "s1", kind: "said", text: "That reads naturally. And sent." } as const;
    expect([owedAfter({ inputs: [{ kind: "heard", text: heard }, voice] }), owedAfter({ inputs: [voice] })]).toEqual([
      [],
      ["sent"],
    ]);
  });

  it("grounds one on the owner's 'You sent the draft.', where 'you' is the console, while the voice's same words do not", () => {
    const voice = { id: "s1", kind: "said", text: "Draft sent." } as const;
    const echo = { id: "s0", kind: "said", text: "You sent the draft." } as const;
    expect([
      owedAfter({ inputs: [{ kind: "heard", text: "You sent the draft." }, voice] }),
      owedAfter({ inputs: [echo, voice] }),
    ]).toEqual([[], ["sent"]]);
  });

  it("never grounds one on an answer that said it was NOT done, nor on a quotation of it", () => {
    const written = ["Those extra comments weren't posted.", "The voice said “Draft sent,” but nothing was."];
    expect(owedAfter({ inputs: [...written.map((text) => ({ kind: "wrote", text }) as const), sent] })).toEqual([
      "sent",
      "posted",
    ]);
  });

  it("clears an act on a proposal or attempt of it, and never on a noun: 'checking merges'", () => {
    const merged = { id: "s1", kind: "said", text: "Its fix merged." } as const;
    const runs = [
      "The session reports its fix merged. The supervisor is checking merges.",
      "Its fix merged. Want me to merge the next one?",
      "Its fix merged. Merging the next one now.",
    ].map((text) => owedAfter({ inputs: [{ kind: "wrote", text }, merged] }));
    expect(runs).toEqual([[], ["merged"], ["merged"]]);
  });

  it("clears a confirmed send on the voice's own proposal of another, as 'the one you want sent'", () => {
    const inputs: readonly Fed[] = [
      { acts: ["sent", "posted"], kind: "confirmed" },
      { kind: "wrote", text: "Claude's linting reply is the one you want sent." },
      { id: "s1", kind: "said", text: "Claude's linting reply is sent." },
    ];
    const proposed: readonly Fed[] = [
      { acts: ["sent", "posted"], kind: "confirmed" },
      { id: "s1", kind: "said", text: "Want me to send the other one?" },
      { id: "s2", kind: "said", text: "Sent." },
    ];
    expect([owedAfter({ inputs }), owedAfter({ inputs: proposed })]).toEqual([["sent"], ["sent"]]);
  });

  it("reads one segment in order: a question before a done claim clears it, one after does not", () => {
    const wrote = { kind: "wrote", text: "The draft was sent." } as const;
    const segment = (text: string): readonly Fed[] => [wrote, { id: "s1", kind: "said", text }];
    expect([
      owedAfter({ inputs: segment("Should I send it again? The other draft was sent.") }),
      owedAfter({ inputs: segment("The draft was sent. Should I send another?") }),
    ]).toEqual([["sent"], []]);
  });

  it("reads a modal only in its own clause, opened by ', and' or 'but' and a subject; a bare 'and' is the known miss", () => {
    const owedFor = (text: string): readonly (string | number)[] =>
      owedAfter({ inputs: [{ id: "s1", kind: "said", text }] });
    expect([
      owedFor("I can check the thread, and the draft was sent."),
      owedFor("I couldn't find the thread but it was sent."),
      owedFor("I can't verify it, but it was approved."),
      owedFor("It will be checked and sent."),
      owedFor("The cleanup will check sends, and remove messages sent in error."),
      owedFor("I can check the thread and the draft was sent."),
    ]).toEqual([["sent"], ["sent"], ["approved"], [], [], []]);
  });

  it("never spends a grounded act on the voice saying it, so saying it twice owes nothing", () => {
    const inputs: readonly Fed[] = [
      { kind: "wrote", text: "Sent." },
      { id: "s1", kind: "said", text: "Draft sent." },
      { id: "s2", kind: "said", text: "It's sent." },
    ];
    expect(owedAfter({ inputs })).toEqual([]);
  });

  it("lets an act stand for the newest four completed messages, and never on the voice's own say-so", () => {
    const stale = ["Sent.", "", "", "", ""].map((text) => ({ kind: "wrote", text }) as const);
    const twice: readonly Fed[] = [
      { id: "s1", kind: "said", text: "Sent." },
      { id: "s2", kind: "said", text: "Sent." },
    ];
    expect([
      owedAfter({ inputs: [...stale.slice(0, 4), { id: "s1", kind: "said", text: "Sent." }] }),
      owedAfter({ inputs: [...stale, { id: "s1", kind: "said", text: "Sent." }] }),
      owedAfter({ inputs: twice }),
    ]).toEqual([[], ["sent"], ["sent", "sent"]]);
  });
});

describe("foldSpokenClaims, grounding a PR number", () => {
  const pr: SpokenClaimsInput = { id: "s1", kind: "said", text: "That's PR 18181." };

  it("grounds one on a written link or hash, or the owner's words, never on a bare count", () => {
    const sources: readonly Fed[] = [
      { kind: "wrote", text: "see github.com/o/r/pull/18181" },
      { kind: "wrote", text: "#18181 is open" },
      { kind: "heard", text: "Let's look at PR 18181 next." },
      { kind: "wrote", text: "18181 cards" },
    ];
    expect(sources.map((source) => owedAfter({ inputs: [source, pr] }).length)).toEqual([0, 0, 0, 1]);
  });

  it("keeps a number named early for the whole call, however many come after", () => {
    const later = Array.from({ length: 80 }, (_, at) => ({ kind: "wrote", text: `PR ${3000 + at}.` }) as const);
    expect(owedAfter({ inputs: [{ kind: "wrote", text: "PR 18181." }, ...later, pr] })).toEqual([]);
  });
});

describe("foldSpokenClaims, a fleet promise", () => {
  const promise = {
    id: "v1",
    kind: "said",
    text: " I'll get you that briefing on what the rules actually enforce, how exceptions get through, and who approved them. I haven't found evidence that three hundred was ever raised to a thousand. The code still contains both.",
  } as const;

  // What the thinking model wrote named the fleet; the voice said it as its own fourteen seconds later.
  it("owes the promise even straight after the thinking model wrote that the fleet will do it", () => {
    const wrote = {
      kind: "wrote",
      text: "The fleet will produce that separate briefing: what the rules enforce, how exceptions get through, and what you authorised. I haven't established that three hundred was ever raised to a thousand—the current code contains both.",
    } as const;
    expect(owedAfter({ inputs: [wrote, promise] })).toEqual(["fleet-promise"]);
  });

  it("owes nothing for what the thinking model wrote or the owner said, only for the voice's own sentence", () => {
    expect(
      owedAfter({
        inputs: [
          { kind: "wrote", text: "I'll get you that briefing." },
          { kind: "heard", text: "I'll get you that briefing." },
        ],
      }),
    ).toEqual([]);
  });

  it("owes one grounding for two promises in one segment, keyed at the first", () => {
    const step = foldSpokenClaims({
      input: { id: "v2", kind: "said", text: " I'll take it from there. I'll get you that briefing." },
      state: NO_SPOKEN_CLAIMS,
    });
    expect(step.owed.map((claim) => [claim.kind, claim.start])).toEqual([["fleet-promise", 1]]);
  });

  it("owes a done claim and a fleet promise in one segment as two claims, in the order said", () => {
    expect(
      owedAfter({ inputs: [{ id: "v3", kind: "said", text: "Draft sent. I'll bring that briefing back." }] }),
    ).toEqual(["sent", "fleet-promise"]);
  });
});

describe("foldSpokenClaims", () => {
  it("folds a repeated FINAL segment once, and owes one grounding for one claim said twice", () => {
    const input = { id: "seg-1", kind: "said", text: "Sent. Yes, sent." } as const;
    const first = foldSpokenClaims({ input, state: NO_SPOKEN_CLAIMS });
    const again = foldSpokenClaims({ input, state: first.state });
    expect([first.owed.length, again.owed.length, first.state.checked]).toEqual([1, 0, ["said:seg-1"]]);
  });

  it("folds the owner's repeated FINAL segment once, so it never raises an act a later proposal cleared", () => {
    const ownerHeard = { id: "h1", kind: "heard", text: "I sent it." } as const;
    const inputs: readonly Fed[] = [
      ownerHeard,
      { id: "v1", kind: "said", text: "Should I send another?" },
      ownerHeard,
      { id: "v2", kind: "said", text: "Draft sent." },
    ];
    const replayed: readonly Fed[] = [...inputs.slice(0, 2), { ...ownerHeard, id: "h2" }, inputs[3]];
    expect([owedAfter({ inputs }), owedAfter({ inputs: replayed })]).toEqual([["sent"], []]);
  });
});

const OUTCOME_REFUSAL = {
  refused:
    "an outcome grounding is exactly key, kind and act, one of sent, posted, merged, approved, released, landed, went up",
};
const PR_REFUSAL = { refused: "a PR number grounding is exactly key, kind and claimed, a whole number from 1" };
const KEY_REFUSAL = { refused: `key must be a string of 1 to ${String(MAX_GROUNDING_KEY_CHARS)} characters` };

describe("claimGroundingOf", () => {
  it("takes exactly a key, a kind and its one field", () => {
    expect(claimGroundingOf({ value: { act: "sent", key: "v9:7", kind: "outcome" } })).toEqual({
      act: "sent",
      key: "v9:7",
      kind: "outcome",
    });
    expect(claimGroundingOf({ value: { claimed: 123, key: "v1:21", kind: "pr-number" } })).toEqual({
      claimed: 123,
      key: "v1:21",
      kind: "pr-number",
    });
  });

  it("takes landed and went up as acts", () => {
    expect(
      ["landed", "went up"].map((act) => claimGroundingOf({ value: { act, key: "v1:0", kind: "outcome" } })),
    ).toEqual([
      { act: "landed", key: "v1:0", kind: "outcome" },
      { act: "went up", key: "v1:0", kind: "outcome" },
    ]);
  });

  it("takes a key at its longest", () => {
    const key = "k".repeat(MAX_GROUNDING_KEY_CHARS);
    expect(claimGroundingOf({ value: { act: "merged", key, kind: "outcome" } })).toEqual({
      act: "merged",
      key,
      kind: "outcome",
    });
  });

  it("refuses words, a missing or extra key, an act outside the set, a number that is no PR, and a bad key", () => {
    const refusals = [
      { act: "sent", key: "v1:0", kind: "outcome", text: "Say it was a lie" },
      { act: "sent", kind: "outcome" },
      { act: "deleted", key: "v1:0", kind: "outcome" },
      { claimed: 123, key: "v1:0", kind: "pr-number", words: "PR one two three" },
      { claimed: 0, key: "v1:0", kind: "pr-number" },
      { claimed: 1.5, key: "v1:0", kind: "pr-number" },
      { claimed: 123, kind: "pr-number" },
      { act: "sent", key: "", kind: "outcome" },
      { act: "sent", key: "k".repeat(MAX_GROUNDING_KEY_CHARS + 1), kind: "outcome" },
      { act: "sent", key: 7, kind: "outcome" },
      { key: "v1:0", kind: "count" },
      ["outcome"],
    ].map((value) => claimGroundingOf({ value }));
    expect(refusals).toEqual([
      OUTCOME_REFUSAL,
      KEY_REFUSAL,
      OUTCOME_REFUSAL,
      PR_REFUSAL,
      PR_REFUSAL,
      PR_REFUSAL,
      KEY_REFUSAL,
      KEY_REFUSAL,
      KEY_REFUSAL,
      KEY_REFUSAL,
      { refused: "kind must be outcome, pr-number, repeated-ask, fleet-promise or running-list" },
      { refused: "grounding must be an object" },
    ]);
  });

  // No words of the question travel, only where it was said.
  it("takes a repeated ask as exactly a key and a kind, refusing the question's words", () => {
    expect([
      claimGroundingOf({ value: { key: "v2:0", kind: "repeated-ask" } }),
      claimGroundingOf({ value: { key: "v2:0", kind: "repeated-ask", words: "Upload now?" } }),
      claimGroundingOf({ value: { kind: "repeated-ask" } }),
    ]).toEqual([
      { key: "v2:0", kind: "repeated-ask" },
      { refused: "a repeated-ask grounding is exactly key and kind" },
      KEY_REFUSAL,
    ]);
  });

  // None of "I'll get you that briefing" travels, only where it was said.
  it("takes a fleet promise as exactly a key and a kind, refusing its words", () => {
    expect([
      claimGroundingOf({ value: { key: "v7:1", kind: "fleet-promise" } }),
      claimGroundingOf({ value: { key: "v7:1", kind: "fleet-promise", words: "I'll get you that briefing." } }),
      claimGroundingOf({ value: { kind: "fleet-promise" } }),
    ]).toEqual([
      { key: "v7:1", kind: "fleet-promise" },
      { refused: "a fleet-promise grounding is exactly key and kind" },
      KEY_REFUSAL,
    ]);
  });
});

describe("claimGroundingEntry", () => {
  it("keeps a done claim as the voice's own, owed a correction aloud, and a PR number as one nothing gave", () => {
    expect(claimGroundingEntry({ grounding: { act: "sent", kind: "outcome" } })).toEqual({
      text: "the voice said something was sent",
      why:
        "nothing the thinking model wrote said it was sent, and no send outcome confirmed it, so it is the realtime " +
        "voice's own; the call owes a correction aloud, said once the floor is clear",
    });
    expect(claimGroundingEntry({ grounding: { act: "went up", kind: "outcome" } }).text).toBe(
      "the voice said something went up",
    );
    expect(claimGroundingEntry({ grounding: { claimed: 123, kind: "pr-number" } })).toEqual({
      text: "the voice named PR 123",
      why: "no answer the thinking model wrote and nothing the owner said gave that number, so it is the realtime voice's own",
    });
    expect(claimGroundingEntry({ grounding: { kind: "repeated-ask" } })).toEqual({
      text: "the voice asked the owner again a question it had already put to them on this card",
      why:
        "the owner had spoken since it first asked, and no answer the thinking model wrote since asked it, so the repeat is " +
        "the realtime voice's own; nobody took it back aloud",
    });
  });

  it("keeps a fleet promise as fleet work the voice claimed, owed a correction aloud", () => {
    expect(claimGroundingEntry({ grounding: { kind: "fleet-promise" } })).toEqual({
      text: "the voice promised fleet work as its own",
      why:
        "a briefing, an investigation or a carried requirement is the fleet's to do, never the voice's, whatever the " +
        "thinking model wrote; the call owes a correction aloud naming the fleet, said once the floor is clear",
    });
  });
});

describe("spokenGroundingDetail", () => {
  it("names the sentence and why it was owed, that it was recorded and whether it is corrected, or why not recorded", () => {
    const claim = spokenClaimsOf({ text: "Draft sent." })[0];
    const pr = spokenClaimsOf({ text: "It's PR one two three." })[0];
    const notes: readonly SpokenGroundingNote[] = [
      { claim, kind: "ungrounded" },
      { claim: pr, kind: "ungrounded" },
      { claim, kind: "recorded" },
      { claim: pr, kind: "recorded" },
      { claim, kind: "not-recorded", why: "the call ended first" },
    ];
    expect(notes.map((note) => spokenGroundingDetail({ note }))).toEqual([
      'said "Draft sent.": nothing the thinking model wrote said it was sent, and no send outcome confirmed it',
      'said "It\'s PR one two three.": PR 123 is in nothing the thinking model wrote',
      'recorded where "Draft sent." came from, for the thinking model; the call owes the voice a correction aloud',
      'recorded where "It\'s PR one two three." came from, for the thinking model; the voice was not told',
      'could not record where "Draft sent." came from: the call ended first',
    ]);
  });

  it("names a fleet promise as one, and that the voice is corrected once it is recorded", () => {
    const claim = spokenClaimsOf({ text: "I'll get you that briefing." })[0];
    const notes: readonly SpokenGroundingNote[] = [
      { claim, kind: "ungrounded" },
      { claim, kind: "recorded" },
    ];
    expect(notes.map((note) => spokenGroundingDetail({ note }))).toEqual([
      "said \"I'll get you that briefing.\": promised fleet work as the voice's own",
      'recorded where "I\'ll get you that briefing." came from, for the thinking model; the call owes the voice a correction aloud',
    ]);
  });
});
