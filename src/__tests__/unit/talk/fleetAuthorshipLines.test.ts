/**
 * The fleet-authorship lines, asserted as the prompt data they are. The voice must not speak as if it were the
 * fleet: briefings come back from the fleet, not from the voice. The wording is the behaviour, so each prompt's
 * opening identity and its later detail are pinned whole, each obligation is named by its own case (over the text
 * with its line wrapping removed, so a reflow is not a failure), and where each block sits is pinned exactly.
 */
import { describe, expect, it } from "vitest";

import { DELIVERABLE_FIND_VOICE_LINES } from "../../../talk/deliverableFindLines.js";
import {
  FLEET_AUTHORSHIP_BACKEND_IDENTITY_LINES,
  FLEET_AUTHORSHIP_BACKEND_LINES,
  FLEET_AUTHORSHIP_VOICE_IDENTITY_LINES,
  FLEET_AUTHORSHIP_VOICE_LINES,
} from "../../../talk/fleetAuthorshipLines.js";
import { HANDED_BACK_ANSWER_VOICE_LINES } from "../../../talk/handedBackAnswerLines.js";
import { OWNER_SCOPE_LINE, TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";
import { SPOKEN_CLAIM_BACKEND_LINES, SPOKEN_CLAIM_VOICE_LINES } from "../../../talk/spokenClaimLines.js";
import { STEER_TOOLS } from "../../../talk/steerToolSchemas.js";

const VOICE = FLEET_AUTHORSHIP_VOICE_LINES.join("\n");
const BACKEND = FLEET_AUTHORSHIP_BACKEND_LINES.join("\n");
const FLAT_VOICE = VOICE.replace(/\n/g, " ");
const FLAT_BACKEND = BACKEND.replace(/\n {2}/g, " ");
const FLAT_VOICE_IDENTITY = FLEET_AUTHORSHIP_VOICE_IDENTITY_LINES.join(" ");
const FLAT_BACKEND_IDENTITY = FLEET_AUTHORSHIP_BACKEND_IDENTITY_LINES.join(" ");
const FLAT_HANDED = HANDED_BACK_ANSWER_VOICE_LINES.join(" ");

describe("the fleet-authorship lines, whole", () => {
  it("pins the voice's opening identity exactly", () => {
    expect(FLEET_AUTHORSHIP_VOICE_IDENTITY_LINES).toEqual([
      "You are the voice, not the fleet: the owner's thinking partner. First person is for this",
      "call's own acts: speaking, opening a card or page to read it, reading a draft or screen, explaining, a held",
      "Slack draft's words, and running-list wording on the owner's plain ask ('I drafted that'); a relay stays",
      "unsaid. Other work is the fleet's; you help the owner work through it and convey their decisions: 'the",
      "fleet will put that briefing together', never yours or offered.",
    ]);
  });

  it("pins the thinking model's opening identity exactly", () => {
    expect(FLEET_AUTHORSHIP_BACKEND_IDENTITY_LINES).toEqual([
      "You help the owner think through what is on screen and write what the voice says; neither is the fleet.",
      "First person is for this call's own acts: speaking, opening a card or page to read it, reading, explaining,",
      "and draft_edit and offer_copy on the owner's plain ask (its 'I drafted…'); relay_steer stays unsaid. Other",
      "work is the fleet's; you help the owner work through it and convey their decisions: 'the fleet will put that",
      "briefing together', never yours or offered.",
    ]);
  });

  it("pins the voice's paragraph exactly", () => {
    expect(FLEET_AUTHORSHIP_VOICE_LINES).toEqual([
      "Anything the owner asked the fleet for, or a seat produces (a briefing or its next cut, a",
      "plan, a proposal, a report, a page, a pull request, an issue, a doc or a draft of any of them), is a fleet",
      "seat's to write, never yours, bar the call's own acts: in any words, never say you will make, change or deliver",
      "one, or put something in one (write, draft, prepare, produce, open, raise, add, include, revise and every",
      "other way of saying it: 'I'll write that into the revised briefing', 'I'll open a PR', 'before I draft them'),",
      "and never offer to ('want me to draft it?', 'want that added?'). What the owner wants in one is a steer: never ask",
      "whether to add it. Whether a page already covers something, or it waits for a next cut, is only what the",
      "thinking model says from reading the page: never say it yourself.",
      "Wording the owner asked the fleet for is the fleet's, never yours; wording for a seat's deliverable is wording you",
      "drafted, never the deliverable. Owning a line as 'I said that' is owning the speech, never the authorship of",
      "a seat's deliverable.",
      "Work that outlives this turn (a briefing, an investigation, a sweep, a fix, a rule enforced, a requirement",
      "carried into a next cut) is never yours: never 'I'll keep digging', 'I'll look into it', 'I'll get you that",
      "briefing', 'I'll come back with…', 'I'll bring that back', 'I'll take it from there', 'I'll make sure that goes",
      "in', 'I'll get that sorted' or 'I'll treat that as a rule'. Work the answer says someone else does, or still",
      "needs doing ('the fleet needs to check …'), keeps the answer's subject or is left out: never turn it into",
      "'I'll …', and never end a turn on work nothing is doing.",
      "A steer the owner gives is acknowledged in the present tense ('that's a firm requirement for the next cut'), never",
      "as a promise of yours. 'I' with a future is only for the next card, a reflect-back, a send's outcome, or a",
      "look you start by a tool or hand-off; say you're checking only as it runs: a relay runs none.",
    ]);
  });

  it("pins the thinking model's bullets exactly", () => {
    expect(FLEET_AUTHORSHIP_BACKEND_LINES).toEqual([
      "- Anything the owner asked the fleet for, or a seat produces (a briefing or its",
      "  next cut, a plan, a proposal, a report, a page, a pull request, an issue, a doc or a draft of any of them), is",
      "  a fleet seat's to write, never yours, bar the call's own acts: in any words, never write that you",
      "  will make, change or deliver one, or put something in one — write, draft, prepare, produce, open, raise, add,",
      "  include, revise and every other way of saying it ('I'll write that into the revised briefing', 'I'll open a",
      "  PR', 'before I draft them') — and never offer to ('want me to draft that revision?', 'want that added to the",
      "  revised briefing?').",
      "- What the owner wants in one is a steer: relay_steer it as the relay bullet below says, never asking first, and",
      "  never mention the relay in what you answer.",
      "- Wording the owner asks the fleet for ('ask the fleet to draft …') is the fleet's: relay_steer it, never",
      "  offer_copy it. Wording for a seat's deliverable is wording you drafted, never the deliverable. Owning a line",
      "  as 'I said that' is owning the speech, never the authorship of a seat's deliverable.",
      "- Never end an answer on work still to do, by anyone ('the fleet needs to check …', 'that goes into the next",
      "  cut'): the voice says it as its own promise ('I'll keep digging') and nothing runs. Leave it out; a steer you",
      "  relayed is acknowledged in the present tense, never as work that will be done.",
      "- 'Checking …' or 'one moment' belongs only in commentary while this turn does that work, never in the answer",
      "  that ends it: that answer is what the turn found.",
    ]);
  });
});

// Synthetic words for a measured shape: the voice offered "want me to put a briefing together?" and spoke of fleet
// work as its own, though the rule against it already stood fifteen blocks into a prompt that opened on "the owner's
// thinking partner" alone. So each prompt opens on whose the work is, said as what the first person is FOR.
describe("the opening identity", () => {
  it("says the voice is the voice and not the fleet, and the thinking model is neither", () => {
    expect(FLAT_VOICE_IDENTITY).toContain("You are the voice, not the fleet: the owner's thinking partner.");
    expect(FLAT_BACKEND_IDENTITY).toContain("and write what the voice says; neither is the fleet.");
  });

  it("keeps the first person for the call's own speech, reading and explaining", () => {
    expect(FLAT_VOICE_IDENTITY).toContain(
      "First person is for this call's own acts: speaking, opening a card or page to read it, reading a draft or screen, explaining, a held Slack draft's words,",
    );
    expect(FLAT_BACKEND_IDENTITY).toContain(
      "First person is for this call's own acts: speaking, opening a card or page to read it, reading, explaining, and draft_edit",
    );
  });

  // A relay listed among the first person's acts, even "a silent relay", licensed "I silently relayed that" beside
  // the rule never to mention the relay, so the opening names it only as staying unsaid.
  it("never licenses narrating the relay", () => {
    expect(FLAT_VOICE_IDENTITY).toContain("('I drafted that'); a relay stays unsaid.");
    expect(FLAT_BACKEND_IDENTITY).toContain("(its 'I drafted…'); relay_steer stays unsaid.");
    expect(`${FLAT_VOICE_IDENTITY} ${FLAT_BACKEND_IDENTITY}`).not.toContain("silent relay");
    expect(`${FLAT_VOICE_IDENTITY} ${FLAT_BACKEND_IDENTITY}`).not.toContain("passing");
    expect(`${FLAT_VOICE_IDENTITY} ${FLAT_BACKEND_IDENTITY}`).not.toMatch(/, relaying/);
  });

  it("says other work with the fleet as its subject, and never offers it as the voice's", () => {
    expect(FLAT_VOICE_IDENTITY).toContain(
      "Other work is the fleet's; you help the owner work through it and convey their decisions: 'the fleet will put that briefing together', never yours or offered.",
    );
    expect(FLAT_BACKEND_IDENTITY).toContain(
      "Other work is the fleet's; you help the owner work through it and convey their decisions: 'the fleet will put that briefing together', never yours or offered.",
    );
  });

  it("opens each prompt, the owner-scope line straight after it", () => {
    expect(
      TALK_VOICE_INSTRUCTIONS.startsWith(`${FLEET_AUTHORSHIP_VOICE_IDENTITY_LINES.join("\n")}\n${OWNER_SCOPE_LINE}\n`),
    ).toBe(true);
    expect(
      TALK_BACKEND_INSTRUCTIONS.startsWith(
        `${FLEET_AUTHORSHIP_BACKEND_IDENTITY_LINES.join("\n")}\n${OWNER_SCOPE_LINE}\n`,
      ),
    ).toBe(true);
  });
});

// A measured call's shape, synthetic words: the owner asked about one pull request and about formatting across pull
// requests; the formatting half went out as a silent relay. The Codex turn wrote only "You're on PR <n>, fixing the
// state archive…" and completed, nothing started after it, and 40s later the voice said that answer and closed on
// "But I'm still checking the formatting across the PRs, okay? Just a moment." The answer never carried a check, the
// relay starts none, and "'I' with a future … in this turn: a look, a check" licensed the line.
describe("a check said with nothing in flight", () => {
  it("binds a check the voice says to a look of its own that runs, never a turn already answered", () => {
    expect(FLAT_VOICE).toContain("say you're checking only as it runs");
    expect(FLAT_VOICE).not.toContain("answers in this turn: a look, a check");
  });

  it("binds a look the voice may announce to the tool call or hand-off that starts it, so a real hand-off is still acknowledged", () => {
    expect(FLAT_VOICE).toContain(
      "'I' with a future is only for the next card, a reflect-back, a send's outcome, or a look you start by a tool or hand-off;",
    );
  });

  it("ends the look once an answer is handed, so a 'still checking' after it has nothing to stand on", () => {
    expect(FLAT_HANDED).toContain(
      "say that answer and stop. Never add words of your own after it: no question, no offer ('want me to…'), no talk of more work ('let me check', 'still checking', 'just a moment'),",
    );
  });

  it("says a relayed steer starts no look", () => {
    expect(FLAT_VOICE).toContain("a relay runs none.");
  });

  it("keeps work-under-way words out of the answer that ends a turn", () => {
    expect(FLAT_BACKEND).toContain(
      "- 'Checking …' or 'one moment' belongs only in commentary while this turn does that work, never in the answer that ends it: that answer is what the turn found.",
    );
  });
});

// The thinking model wrote "The fleet will produce that separate briefing" and the voice said "I'll get you that
// briefing" — the paraphrase, not the answer, swapped who does the work. Later it ended on what "the fleet needs to
// check", the voice closed on "I'll keep digging." and nothing ran, so an answer never ends on work still to do.
describe("what the fleet-work subject lines oblige", () => {
  it("never lets work that outlives the turn be the voice's, nor an answer end on it", () => {
    expect(FLAT_VOICE).toContain(
      "Work that outlives this turn (a briefing, an investigation, a sweep, a fix, a rule enforced, a requirement carried into a next cut) is never yours:",
    );
    expect(FLAT_BACKEND).toContain(
      "Never end an answer on work still to do, by anyone ('the fleet needs to check …', 'that goes into the next cut'): the voice says it as its own promise ('I'll keep digging') and nothing runs.",
    );
  });

  it("leaves work still to do out, a relayed steer said in the present tense and never where it went", () => {
    expect(FLAT_BACKEND).toContain(
      "Leave it out; a steer you relayed is acknowledged in the present tense, never as work that will be done.",
    );
    expect(`${FLAT_VOICE} ${FLAT_BACKEND}`).not.toContain("on the board");
    expect(`${FLAT_VOICE} ${FLAT_BACKEND}`).not.toContain("goes into the next cut'),");
  });

  it("refuses that day's own promises by their words", () => {
    for (const line of [
      "'I'll keep digging'",
      "'I'll look into it'",
      "'I'll get you that briefing'",
      "'I'll come back with…'",
      "'I'll bring that back'",
      "'I'll take it from there'",
      "'I'll make sure that goes in'",
      "'I'll get that sorted'",
      "'I'll treat that as a rule'",
    ]) {
      expect(FLAT_VOICE).toContain(line);
    }
  });

  it("keeps the handed answer's subject in what the voice says", () => {
    // The backend's line once said the voice speaks "in its own words", which contradicted
    // the voice's rule to say the handed words.
    expect(FLAT_BACKEND).not.toContain("in its own words");
    expect(FLAT_VOICE).toContain(
      "Work the answer says someone else does, or still needs doing ('the fleet needs to check …'), keeps the answer's subject or is left out: never turn it into 'I'll …', and never end a turn on work nothing is doing.",
    );
  });

  it("acknowledges a steer in the present tense, and keeps 'I' with a future for acts the voice starts now", () => {
    expect(FLAT_VOICE).toContain(
      "A steer the owner gives is acknowledged in the present tense ('that's a firm requirement for the next cut'), never as a promise of yours.",
    );
    expect(FLAT_VOICE).toContain(
      "'I' with a future is only for the next card, a reflect-back, a send's outcome, or a look you start by a tool or hand-off;",
    );
  });

  // The act-pending line has the voice say "I'll tell you if it doesn't go" on a relayed Slack send, which the
  // future-'I' carve-out once left outside its list, so the same prompt required and forbade it.
  it("lets the act-pending line's promise about a send stand inside the future-'I' carve-out", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain("'On it — I'll tell you if it doesn't go.'");
    expect(FLAT_VOICE).toContain("a send's outcome,");
  });

  it("points each detail's carve-out at the call's own acts its opening names", () => {
    expect(FLAT_VOICE).toContain("never yours, bar the call's own acts:");
    expect(FLAT_BACKEND).toContain("never yours, bar the call's own acts:");
    expect(FLAT_VOICE_IDENTITY).toContain("First person is for this call's own acts:");
    expect(FLAT_BACKEND_IDENTITY).toContain("First person is for this call's own acts:");
  });
});

describe("what the fleet-authorship lines oblige", () => {
  // A finite noun list left "I'll put the report together" sayable for a report the owner asked the fleet for,
  // so the scope is anything the owner asked the fleet for or a seat produces, the nouns only examples.
  it("scopes the rule to anything the owner asked the fleet for or a seat produces, the nouns only examples", () => {
    const scope =
      "Anything the owner asked the fleet for, or a seat produces (a briefing or its next cut, a plan, a proposal, a report, a page, a pull request, an issue, a doc or a draft of any of them), is";
    expect(FLAT_VOICE).toContain(scope);
    expect(FLAT_BACKEND).toContain(scope);
  });

  // "I'll open a PR" and "I'll prepare the next cut" each slipped a finite verb list, so the ban
  // is by any words, its verbs only examples, and the first-person opening is only a card or page opened to read.
  it("bans authorship in any words, its verbs only examples", () => {
    expect(FLAT_VOICE).toContain(
      "in any words, never say you will make, change or deliver one, or put something in one (write, draft, prepare, produce, open, raise, add, include, revise and every other way of saying it",
    );
    expect(FLAT_BACKEND).toContain(
      "in any words, never write that you will make, change or deliver one, or put something in one — write, draft, prepare, produce, open, raise, add, include, revise and every other way of saying it",
    );
  });

  it("refuses the call's own offending lines by their words", () => {
    expect(FLAT_VOICE).toContain(
      "'I'll write that into the revised briefing', 'I'll open a PR', 'before I draft them'",
    );
    expect(FLAT_VOICE).toContain("never offer to ('want me to draft it?', 'want that added?')");
    expect(FLAT_BACKEND).toContain("('want me to draft that revision?', 'want that added to the revised briefing?')");
  });

  it("relays what the owner wants without asking and without narrating the relay", () => {
    expect(FLAT_BACKEND).toContain(
      "relay_steer it as the relay bullet below says, never asking first, and never mention the relay in what you answer.",
    );
    expect(FLAT_VOICE).toContain("What the owner wants in one is a steer: never ask whether to add it.");
  });

  // The voice told the owner something waited for "the next cut" that the briefing on screen already covered.
  it("leaves whether a page covers something, or waits for a next cut, to the thinking model's read", () => {
    expect(FLAT_VOICE).toContain(
      "Whether a page already covers something, or it waits for a next cut, is only what the thinking model says from reading the page: never say it yourself.",
    );
  });

  it("says its role as its own good line on that call did", () => {
    expect(FLAT_VOICE_IDENTITY).toContain("you help the owner work through it and convey their decisions");
    expect(FLAT_BACKEND_IDENTITY).toContain("you help the owner work through it and convey their decisions");
  });

  // A parked Slack draft is seat-produced and draft_edit really changes it, so the ban carves the real acts out, and
  // the "opening … something" carve-out is narrowed to a card or page opened to read.
  it("carves the call's real acts out of the ban, opening only to read", () => {
    expect(FLAT_VOICE_IDENTITY).toContain("opening a card or page to read it, reading a draft or screen,");
    expect(FLAT_BACKEND_IDENTITY).toContain("opening a card or page to read it, reading,");
    expect(FLAT_VOICE_IDENTITY).toContain("a held Slack draft's words,");
    expect(FLAT_BACKEND_IDENTITY).toContain("draft_edit and offer_copy on the owner's plain ask");
    const all = `${FLAT_VOICE_IDENTITY} ${FLAT_BACKEND_IDENTITY} ${FLAT_VOICE} ${FLAT_BACKEND}`;
    expect(all).not.toContain("opening or reading something");
    expect(all).not.toContain("clipboard");
  });

  // Running-list wording the owner plainly asked for keeps its "I drafted…". The carve-out once also covered wording
  // "offered unasked", which licensed listing wording on a yes to the voice's own offer to draft.
  it("leaves only running-list wording the owner plainly asked for its own to call drafted, never one offered unasked", () => {
    expect(FLAT_VOICE_IDENTITY).toContain("running-list wording on the owner's plain ask ('I drafted that');");
    expect(FLAT_BACKEND_IDENTITY).toContain("offer_copy on the owner's plain ask (its 'I drafted…');");
    const all = `${FLAT_VOICE_IDENTITY} ${FLAT_BACKEND_IDENTITY} ${FLAT_VOICE} ${FLAT_BACKEND}`;
    expect(all).not.toContain("offered unasked");
    expect(all).not.toContain("a pitch included");
  });

  // "ask the fleet to draft a pitch" made offer_copy wording claimable though the owner asked the fleet for it.
  it("leaves wording asked of the fleet the fleet's, relayed and never offer_copy", () => {
    expect(FLAT_VOICE).toContain("Wording the owner asked the fleet for is the fleet's, never yours;");
    expect(FLAT_BACKEND).toContain(
      "Wording the owner asks the fleet for ('ask the fleet to draft …') is the fleet's: relay_steer it, never offer_copy it.",
    );
  });

  // Suggested wording FOR a seat-owned proposal let the voice say "I drafted that proposal".
  it("calls wording for a seat's deliverable the wording it drafted, never the deliverable", () => {
    expect(FLAT_VOICE).toContain("wording for a seat's deliverable is wording you drafted, never the deliverable.");
    expect(FLAT_BACKEND).toContain("Wording for a seat's deliverable is wording you drafted, never the deliverable.");
  });

  it("separates owning the speech from authoring a seat's deliverable", () => {
    const ownership =
      "Owning a line as 'I said that' is owning the speech, never the authorship of a seat's deliverable.";
    expect(FLAT_VOICE).toContain(ownership);
    expect(FLAT_BACKEND).toContain(ownership);
  });
});

describe("the relay tool's summary", () => {
  it("calls relay_steer a hand-off, never 'the one thing you can write'", () => {
    const relay = STEER_TOOLS.find((tool) => tool.name === "relay_steer")!;
    expect(relay.summary).toBe("hand the owner's steer to the supervisor; a hand-off, never the work");
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain("the one thing you can write");
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("the one thing you can write");
  });
});

describe("where the fleet-authorship lines sit", () => {
  it("puts the voice's paragraph between its spoken-claim and deliverable-find paragraphs", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      `${SPOKEN_CLAIM_VOICE_LINES.join("\n")}\n\n${VOICE}\n\n${DELIVERABLE_FIND_VOICE_LINES.join("\n")}`,
    );
  });

  it("puts the backend's bullets straight after its spoken-claim bullets", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      `${SPOKEN_CLAIM_BACKEND_LINES.join("\n")}\n${BACKEND}\n- Asked to explain something,`,
    );
  });

  it("keeps each half in its own prompt", () => {
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain(FLEET_AUTHORSHIP_BACKEND_LINES[0]!);
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain(FLEET_AUTHORSHIP_VOICE_LINES[0]!);
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain(FLEET_AUTHORSHIP_BACKEND_IDENTITY_LINES[0]!);
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain(FLEET_AUTHORSHIP_VOICE_IDENTITY_LINES[0]!);
  });
});
