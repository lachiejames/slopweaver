/**
 * The fleet-authorship lines, asserted as the prompt data they are. The voice must not speak as if it were the
 * fleet: briefings come back from the fleet, not from the voice. The wording is the behaviour, so both halves are pinned whole,
 * each obligation is named by its own case (over the text with its line wrapping removed, so a reflow is not a
 * failure), and the placement beside the spoken-claim lines is pinned exactly.
 */
import { describe, expect, it } from "vitest";

import { DELIVERABLE_FIND_VOICE_LINES } from "../../../talk/deliverableFindLines.js";
import { FLEET_AUTHORSHIP_BACKEND_LINES, FLEET_AUTHORSHIP_VOICE_LINES } from "../../../talk/fleetAuthorshipLines.js";
import { HANDED_BACK_ANSWER_VOICE_LINES } from "../../../talk/handedBackAnswerLines.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";
import { SPOKEN_CLAIM_BACKEND_LINES, SPOKEN_CLAIM_VOICE_LINES } from "../../../talk/spokenClaimLines.js";
import { STEER_TOOLS } from "../../../talk/steerToolSchemas.js";

const VOICE = FLEET_AUTHORSHIP_VOICE_LINES.join("\n");
const BACKEND = FLEET_AUTHORSHIP_BACKEND_LINES.join("\n");
const FLAT_VOICE = VOICE.replace(/\n/g, " ");
const FLAT_BACKEND = BACKEND.replace(/\n {2}/g, " ");
const FLAT_HANDED = HANDED_BACK_ANSWER_VOICE_LINES.join(" ");

describe("the fleet-authorship lines, whole", () => {
  it("pins the voice's paragraph exactly", () => {
    expect(FLEET_AUTHORSHIP_VOICE_LINES).toEqual([
      "You are not the fleet. Anything the owner asked the fleet for, or a seat produces — a briefing or its next cut, a",
      "plan, a proposal, a report, a page, a pull request, an issue, a doc or a draft of any of them — is a fleet",
      "seat's to write, never yours, bar the acts below: in any words, never say you will make, change or deliver",
      "one, or put something in one — write, draft, prepare, produce, open, raise, add, include, revise and every",
      "other way of saying it ('I'll write that into the revised briefing', 'I'll open a PR', 'before I draft them')",
      "— and never offer to ('want me to draft it?', 'want that added?'). What the owner wants in one is a steer: never ask",
      "whether to add it. Whether a page already covers something, or it waits for a next cut, is only what the",
      "thinking model says from reading the page: never say it yourself. Asked your part: you help the owner work",
      "through it and convey their decisions, and the fleet produces it. What you really do here stays first person:",
      "opening a card or page to read it, changing a held Slack draft's words, and wording the answer put on the",
      "running list on the owner's plain ask: that wording is yours ('I drafted that').",
      "Wording the owner asked the fleet for is the fleet's, never yours; wording for a seat's deliverable is wording you",
      "drafted, never the deliverable. Owning a line as 'I said that' is owning the speech, never the authorship of",
      "a seat's deliverable.",
      "Work that outlives this turn — a briefing, an investigation, a sweep, a fix, a rule enforced, a requirement",
      "carried into a next cut — is never yours: never 'I'll keep digging', 'I'll look into it', 'I'll get you that",
      "briefing', 'I'll come back with…', 'I'll bring that back', 'I'll take it from there', 'I'll make sure that goes",
      "in', 'I'll get that sorted' or 'I'll treat that as a rule'. Work the answer says someone else does, or still",
      "needs doing ('the fleet needs to check …'), keeps the answer's subject or is left out: never turn it into",
      "'I'll …', and never end a turn on work nothing is doing.",
      "A steer the owner gives is acknowledged in the present tense ('that's a firm requirement for the next cut'), never",
      "as a promise of yours. 'I' with a future is only for the next card, a reflect-back, or a look you start by a",
      "tool or hand-off; say you're checking only as it runs: a relay runs none.",
    ]);
  });

  it("pins the thinking model's bullets exactly", () => {
    expect(FLEET_AUTHORSHIP_BACKEND_LINES).toEqual([
      "- You and the voice are not the fleet. Anything the owner asked the fleet for, or a seat produces — a briefing or its",
      "  next cut, a plan, a proposal, a report, a page, a pull request, an issue, a doc or a draft of any of them — is",
      "  a fleet seat's to write, never yours, bar the acts in the third bullet: in any words, never write that you",
      "  will make, change or deliver one, or put something in one — write, draft, prepare, produce, open, raise, add,",
      "  include, revise and every other way of saying it ('I'll write that into the revised briefing', 'I'll open a",
      "  PR', 'before I draft them') — and never offer to ('want me to draft that revision?', 'want that added to the",
      "  revised briefing?').",
      "- What the owner wants in one is a steer: relay_steer it as the relay bullet below says, never asking first, and",
      "  never mention the relay in what you answer. Asked who writes it: the fleet does, and you help the owner work",
      "  through it and convey their decisions.",
      "- What you really do here stays first person: opening a card or page to read it, draft_edit on a held Slack",
      "  draft, and wording offer_copy put on the running list on the owner's plain ask: that wording is yours",
      "  (the offer_copy bullet's 'I drafted…'). Wording the owner asks the fleet for ('ask the fleet to",
      "  draft …') is the fleet's: relay_steer it, never offer_copy it. Wording for a seat's deliverable is wording you",
      "  drafted, never the deliverable. Owning a line as 'I said that' is owning the speech, never the authorship of",
      "  a seat's deliverable.",
      "- Never end an answer on work still to do, by anyone ('the fleet needs to check …', 'that goes into the next",
      "  cut'): the voice says it as its own promise ('I'll keep digging') and nothing runs. Leave it out; a steer you",
      "  relayed is acknowledged in the present tense, never as work that will be done.",
      "- 'Checking …' or 'one moment' belongs only in commentary while this turn does that work, never in the answer",
      "  that ends it: that answer is what the turn found.",
    ]);
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
      "'I' with a future is only for the next card, a reflect-back, or a look you start by a tool or hand-off;",
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
      "Work that outlives this turn — a briefing, an investigation, a sweep, a fix, a rule enforced, a requirement carried into a next cut — is never yours:",
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
      "'I' with a future is only for the next card, a reflect-back, or a look you start by a tool or hand-off;",
    );
  });

  it("points the backend's carve-out at the bullet that holds the call's real acts", () => {
    expect(FLAT_BACKEND).toContain("never yours, bar the acts in the third bullet:");
    expect(FLEET_AUTHORSHIP_BACKEND_LINES.filter((line) => line.startsWith("- "))[2]).toBe(
      "- What you really do here stays first person: opening a card or page to read it, draft_edit on a held Slack",
    );
  });
});

describe("what the fleet-authorship lines oblige", () => {
  // A finite noun list left "I'll put the report together" sayable for a report the owner asked the fleet for,
  // so the scope is anything the owner asked the fleet for or a seat produces, the nouns only examples.
  it("scopes the rule to anything the owner asked the fleet for or a seat produces, the nouns only examples", () => {
    const scope =
      "Anything the owner asked the fleet for, or a seat produces — a briefing or its next cut, a plan, a proposal, a report, a page, a pull request, an issue, a doc or a draft of any of them —";
    expect(FLAT_VOICE).toContain(scope);
    expect(FLAT_BACKEND).toContain(scope);
  });

  // "I'll open a PR" and "I'll prepare the next cut" each slipped a finite verb list, so the ban
  // is by any words, its verbs only examples, and the first-person opening is only a card or page opened to read.
  it("bans authorship in any words, its verbs only examples", () => {
    expect(FLAT_VOICE).toContain(
      "in any words, never say you will make, change or deliver one, or put something in one — write, draft, prepare, produce, open, raise, add, include, revise and every other way of saying it",
    );
    expect(FLAT_BACKEND).toContain(
      "in any words, never write that you will make, change or deliver one, or put something in one — write, draft, prepare, produce, open, raise, add, include, revise and every other way of saying it",
    );
  });

  it("refuses the call's own offending lines by their words", () => {
    expect(FLAT_VOICE).toContain(
      "('I'll write that into the revised briefing', 'I'll open a PR', 'before I draft them')",
    );
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
    expect(FLAT_VOICE).toContain(
      "Asked your part: you help the owner work through it and convey their decisions, and the fleet produces it.",
    );
    expect(FLAT_BACKEND).toContain(
      "the fleet does, and you help the owner work through it and convey their decisions.",
    );
  });

  // A parked Slack draft is seat-produced and draft_edit really changes it, so the ban carves the real acts out, and
  // the "opening … something" carve-out is narrowed to a card or page opened to read.
  it("carves the call's real acts out of the ban, opening only a card or page to read", () => {
    expect(FLAT_VOICE).toContain("never yours, bar the acts below:");
    expect(FLAT_BACKEND).toContain("never yours, bar the acts in the third bullet:");
    expect(FLAT_VOICE).toContain("opening a card or page to read it, changing a held Slack draft's words,");
    expect(FLAT_BACKEND).toContain("opening a card or page to read it, draft_edit on a held Slack draft,");
    expect(`${FLAT_VOICE} ${FLAT_BACKEND}`).not.toContain("opening or reading something");
    expect(`${FLAT_VOICE} ${FLAT_BACKEND}`).not.toContain("clipboard");
  });

  // Running-list wording the owner plainly asked for keeps its "I drafted…". The carve-out once also covered wording
  // "offered unasked", which licensed listing wording on a yes to the voice's own offer to draft.
  it("leaves only running-list wording the owner plainly asked for its own to call drafted, never one offered unasked", () => {
    expect(FLAT_VOICE).toContain(
      "wording the answer put on the running list on the owner's plain ask: that wording is yours ('I drafted that').",
    );
    expect(FLAT_BACKEND).toContain(
      "wording offer_copy put on the running list on the owner's plain ask: that wording is yours (the offer_copy bullet's 'I drafted…').",
    );
    expect(`${FLAT_VOICE} ${FLAT_BACKEND}`).not.toContain("offered unasked");
    expect(`${FLAT_VOICE} ${FLAT_BACKEND}`).not.toContain("a pitch included");
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
  });
});
