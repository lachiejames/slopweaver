/**
 * Walking the owner through items: candidates and check-ins, the next one read unasked, what fills a wait, a handed-back
 * answer said and stopped, a card the owner reads for themselves left to them, and no walk ever ended on a promise.
 */
import { describe, expect, it } from "vitest";

import { HANDED_BACK_ANSWER_VOICE_LINES } from "../../../../talk/handedBackAnswerLines.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../../talk/sessionConfig.js";
import { SPOKEN_DELIVERY_VOICE_LINES } from "../../../../talk/spokenLengthLines.js";
import { TALK_TOOLS } from "../../../../talk/talkToolSchemas.js";
import { VOICE_TURN_TAKING_LINES } from "../../../../talk/voiceTurnTaking.js";
import { ownerNeutral } from "../ownerNeutral.js";

describe("TALK_TOOLS", () => {
  // The voice did not know which candidates the owner had already ruled on, so the owner had to
  // repeat themselves. The walk offers only the unruled list, names a ruling from the ruled one, and relays their word.
  it("walks only the unruled candidates, names a ruling when asked, and relays the owner's word onto the candidate", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("verb workstreams candidates");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "--unruled lists only those not yet ruled on, and it is the only list you offer",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("verb workstreams candidates --ruled names their word, the day");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("relay_steer with candidate set to its id and reaction to their word");
  });

  // The voice walks the owner's check-ins unasked, and asks whether the
  // reason the fleet gave held in this case — never whether the routine act is right in general.
  it("walks the owner's check-ins: the reason and evidence, one question, a verdict relayed and the next read unasked", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("then ONE question: was that reason sound in this case?");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("relay_steer with check_in set to that check-in's act: key and covers");
    // A verdict the owner limited to this card has no rule count to say, matching the covers="this" relay note;
    // and a verdict that also steers puts its first alignment question BEFORE any count, as the whole answer.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "A verdict that also steers what the feature should become, leaving a choice open, takes its\n  alignment questions first (the walk above): the first is the whole answer, and a count it owes (below)\n  follows the owner's last answer. Otherwise, in the SAME answer, say how many cards its rule covers\n  (unless they limited it to this one) and read the next one.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      // Questions a tangent owed never skip the item the owner left unanswered.
      "ends them for this thing, and the walk goes on: the card count a check-in verdict on its rule held back, then the\n  current item again if it is still unanswered, else the next item.",
    );
    // An answer that settles the questions still to come ends them, so the count never forces a re-ask.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "The last answer, or an answer that already settles every one\n  still to come, ends them for this thing,",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("verb talk check-ins re-reads them fresh");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "once the verdict is passed along, how many cards its rule covers is owed, unless limited to\nthis card. When it also steered what it should become and left a choice open, its first alignment question\n(above) is your whole turn and any owed count follows the owner's last answer; otherwise say any owed\ncount, then go on.",
    );
    expect([TALK_VOICE_INSTRUCTIONS, TALK_BACKEND_INSTRUCTIONS].join("\n")).not.toContain("how many cleared");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Stop on the owner's word, or say 'that's the last one' when none are left.",
    );
  });

  // The owner finds the word "checking" grating and wants the voice to vary its filler, and wants a subtle sound
  // effect in place of spoken progress words, at the same frequency.
  it("never fills a wait with periodic progress words, since the console plays a sound, and varies what it does say", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "Working aloud: never fill a wait with periodic progress words ('still on it', 'still working on it',\n'this is taking longer than expected'). While work runs on, the console plays a quiet sound every so\noften instead, so a silence between those sounds is fine.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "never the same filler twice in a\nrow and never leaning on one word: 'checking' grates fast.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).not.toMatch(
      ownerNeutral({ phrase: "tell them so without being asked, well before a minute of quiet" }),
    );
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain(
      "naming what you are doing and that it is taking longer than expected",
    );
  });

  // The voice closed an answer on "Let me check how callers are actually choosing
  // modules." with nothing checking.
  it("says a handed-back answer and stops, adding nothing of its own, right after the turn-taking lines", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      `${VOICE_TURN_TAKING_LINES.join("\n")}\n${HANDED_BACK_ANSWER_VOICE_LINES.join("\n")}\n${SPOKEN_DELIVERY_VOICE_LINES.join("\n")}\n\n`,
    );
    expect(HANDED_BACK_ANSWER_VOICE_LINES.join("\n")).toBe(
      "When the thinking model hands you its answer, say that answer and stop. Never add words of your own after it:\n" +
        // A voice said a handed answer and closed on "I'm still checking …, okay? Just a moment." with no turn running.
        "no question, no offer ('want me to…'), no talk of more work ('let me check', 'still checking', 'just a moment'),\n" +
        "no claim that something is done, drafted or on the running list, and no 'on it' of your own. This is only about\n" +
        "words you add: still say a question the thinking model wrote, which is part of its answer, and the 'on it' the\n" +
        "console hands you to say as a hand-off starts. An empty answer tells you nothing happened: never fill it with an\n" +
        "outcome. Keep three things apart: a PROPOSAL ('want me to send it?') is a question, an ATTEMPT ('sending it now')\n" +
        "is unfinished, and only a CONFIRMED result — the console's send outcome, or the answer saying it went — is said\n" +
        "as done ('sent', 'posted', 'merged', 'approved'). Never turn one into the next.\n" +
        // The options the owner had waved off, asked again after an answer that asked nothing.
        "A question already put to the owner is settled once they answer — even with 'none of the above' or a question back.\n" +
        "Never ask it again yourself. If the thinking model's new answer asks it, say it because it is part of that answer.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain(HANDED_BACK_ANSWER_VOICE_LINES[0]!);
  });

  // Walking the workstream candidates, the owner had to wait on the voice to give them the next thing, because it did not
  // know they were ready for it. They said "next" six times because only check-ins carried a walk; every other list
  // fell under "If there is more, say there is and wait".
  it("carries ANY walk through items: the next one unasked, 'next' skips, a question re-asks, rapid fire, the last one", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "a register, a card set, their queue,\ncheck-ins, a run of questions you ask (an interview), or things to react to when asked to keep them coming",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain("silence in an open walk is never the default");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("every turn ends by putting something to the owner.");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("after that beat, read the next item in the same turn, unasked");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("never trim it off to keep the");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("'Next'\nfrom the owner skips the current item.");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "is answered, then\nthe item's question put again in one line (after any alignment question the tangent itself owes),",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "'Rapid fire' means each item is only its title, one line of evidence\nand the question.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain("'that's the last one' rather than going quiet.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("you carry the walk, the owner never pulls it.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Once a walk is open, EVERY answer ends by putting something to the owner",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("leaves the owner waiting for a reply that is not\n  coming");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("then the NEXT item, in the SAME answer, unasked:");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("'Next' skips the current item.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      // A tangent that is itself a steer takes its alignment questions before the item comes back.
      "A question or tangent leaving the item undecided: answer it, then put the\n  item's question again in one line, once any alignment questions the tangent itself owes (above) are\n  answered.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "'Rapid fire': each item is only its title, one line of evidence and the question.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("When none are left say 'that's the last one'.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Answer what they said, and in a walk (an open card is never\n  one, above) read the next item, or the next alignment question while one is owed (above), in the SAME answer; an unclear annoyance's one\n  question, when owed, is the whole answer instead.",
    );
  });

  // Asked for a candidate the owner had not steered yet, the voice read one the owner's steer
  // on the bug-reporting workstream had already settled — "didn't that supersede that, make this not a workstream?"
  it("walks only the items the owner has not ruled: checks every ruling on record, names a ruled one and skips it", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("- A walk reads only items the owner has NOT ruled.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("verb workstreams candidates for the workstream candidates");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("A steer on one item can settle another");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "is named with that ruling in one clause ('filed under the bug-reporting workstream on the third') and\n  skipped, never re-asked.",
    );
    // The count of what remains is a figure the owner did not ask for, so it waits for the owner's asking.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Asked for one not yet steered, read the first unruled one; how many remain is\n  only for when the owner asks.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("say how many remain");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Never read an item already ruled, here or on an earlier call");
  });

  // While the owner read a card aloud, section by section, the model re-introduced the card they had open and jumped
  // to "The next rule proposes…", though they were still in the middle of reacting to it. Saying they are
  // reading is reading too. What each review added on top is in sessionConfigCardHold.test.ts.
  it("never carries a card the owner is reading, aloud or saying so: answers their reaction and stops, both prompts", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain("The owner reads a card: any card or page open on screen is theirs");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("they set the pace and it is not a walk.");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A reaction is not their word on the card: never introduce it again, offer to send it back,\npark it or move past it",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("it is not a walk: no walk rule anywhere applies to it.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("and it ENDS there, a relay_steer included.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("A reaction is not their word on the card: never introduce it again");
    // The later relay lines said "the next thing" unconditionally, so each carries the exception too.
    // An unrelated steer with a card open and unruled is no word on that card, so it goes back to it.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "a steer that asks for no act gets a word or two and the next thing (back to an open card,\n  never past it; one the owner reads ends on their words)",
    );
    expect(TALK_TOOLS.find((tool) => tool.name === "relay_steer")!.description).toContain(
      "While a card is open on the owner's screen, none of that order applies: answer what the owner said and stop, never its next " +
        "section, rule or question or another card until, since it opened, the owner rules it, asks what is next or is done with it.",
    );
  });

  // A replay of a walk through the first version: after the owner's reaction the model asked "What's one
  // correction you find yourself repeating most often?" or "Ready for the next item?", and they said "Next".
  it("closes an item on the owner's reaction: no further question about it, never 'are you ready for the next'", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "A pick or a verdict closes the item: never follow it with a further question about it, and\n  never ask if the owner is ready for the next one — read it.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "and never ask\nwhether the owner is ready for it or a further question about the settled item — bar the alignment\nquestions above",
    );
  });

  // Minutes passed with nothing happening after the voice said the next one was coming up. Repeatedly it answered the
  // owner's reaction itself, promised the next item, and ended its turn with nothing handed off, so no Codex turn
  // followed until they spoke again.
  it("tells the voice it never holds the next item, so it hands every walk reaction off and never ends on a promise", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain("You never hold the next item: the thinking model does.");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "hand it every reaction in that same\nresponse, even one you could answer yourself",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "Never end a turn on a promise\nof what comes next ('next one coming up', 'I'll ask the next one in a sec', 'I'll put the next one')",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "once\nyour turn ends nothing follows it, and silence lasts until the owner speaks.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A word while it works ('one sec') is fine only once you have handed it off.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "the voice cannot fetch or schedule it once your answer ends, so an answer without it is silence until the\n  owner speaks.",
    );
  });
});
