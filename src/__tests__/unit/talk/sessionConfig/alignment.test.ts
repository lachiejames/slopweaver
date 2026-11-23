/**
 * How a walk and its alignment questions move on: a triage pass ended on the owner's stop, an unnamed take-back asked about,
 * an undecided item re-asked, a few alignment questions after a steer, later words winning, and every relay rule
 * waiting for an owed alignment question.
 */
import { describe, expect, it } from "vitest";

import { ALIGNMENT_QUESTION_BACKEND_LINES } from "../../../../talk/alignmentQuestionLines.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../../talk/sessionConfig.js";
import { STEER_TOOLS } from "../../../../talk/steerToolSchemas.js";
import { ownerNeutral } from "../ownerNeutral.js";

describe("the two prompts", () => {
  it("ends a triage pass on a stop without a recap nobody asked for", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain("the pass ends in a few words, and what got through\nonly when asked.");
    expect(TALK_VOICE_INSTRUCTIONS).not.toMatch(
      ownerNeutral({ phrase: "the pass ends and you say what they got through" }),
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "triage_end, then say in a few words that the pass\n  ended. What it says — how many were seen of how many, what was ruled, what is still out being rewritten —\n  is only for when the owner asks how it went.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("then two short sentences of what it");
  });

  // A triage card can open moments after the owner's ruling on the card before,
  // so an unnamed take-back is about either card until they say which.
  it("asks which card when a take-back naming no card lands on the card just opened, and relays only the owner's answer", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A take-back once the next card is up ('wait, no',\n'not that one', 'scratch that') that names no card: ask 'which card?', and treat neither card as ruled\nuntil the owner says.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Never relay it as it stands: ask 'which card?' first, then relay_steer\n  the answer with triage_card set to the card named. Until the owner says, neither card is ruled.",
    );
  });

  // "Yes, the reason was sound. Why did CodeRabbit flag it?" is a verdict AND a question, and an unscoped
  // tangent rule re-asked the check-in the owner had just answered.
  it("re-asks an item after a question or tangent only when it left the item undecided", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A question or tangent leaving the item undecided is answered, then\nthe item's question put again",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "question or tangent that leaves it without a\n  verdict: answer it, then put the same check-in again.",
    );
  });

  // The owner wants a few alignment questions after a steer, before they start reacting to a different thing.
  // The thinking model writes them; the voice says one only when an answer carries it.
  it("has the thinking model ask a few concrete alignment questions after a steer on what something should become", () => {
    // "A, but make its sidebar collapsible" is a pick and a steer at once.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("(a pick that also says what it should become counts as a steer)");
    // A fully specified steer leaves nothing to ask, so the count is a ceiling, never a quota.
    // "Fewer when fewer are open" was tried and dropped: the replay asked only one on a page steer, 5 of 8.
    // "Exactly one open: one question" was tried too and dropped: the page steer got "one quick one", 3 of 4.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("(none only when the steer left no choice open)");
    // Review kept finding one-utterance mixes (a verdict that steers, said with an unclear annoyance) where two
    // rules each named what comes next. One order now wins over all of them, stated once per prompt.
    // A what-to-do, a fleet-state question or a frustration naming its cause heads the order.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "this order wins over every rule that names what\n  comes next or calls one thing the whole answer (a count of cards, the next item, a check-in, the same item again after a tangent): a\n  card's draft the owner asked only to hear goes as the open-card draft rule says, the rest in the first later answer not asking for a draft; else a\n  what-to-do question, a frustration whose cause the owner named, or asking for the supervisor directly, gets the\n  options (below), a fleet-state question in the same answer said before the options (after any relay) and its offer, when it has one, among them,\n  ending on the owner's pick; else a fleet-state question gets the measurement (below) first, then ends on its offer when\n  nobody is on the work and no annoyance question is owed, else as the rest of this order says; else an\n  unclear annoyance's one question is the whole answer (the rest of it, after a measurement); else an\n  alignment question still owed; else what that rule names.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("in a walk, before the\n  next item");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "relay_steer each answer, then ask the next one in the SAME answer\n  until the count is reached: an answer to one is neither a pick that closes the item nor a new steer that\n  earns questions of its own, so never more than that count on one thing (a steer in it on a different thing\n  starts its own, owed before the walk goes on).",
    );
    // The count is settled before the first question and kept, but never said: "Two quick ones on that first." was
    // a figure the owner never asked for, and the voice repeated it several times in one call.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Settle how many before the first and keep to that count, but never say it, nor how\n  many are left: a figure not asked for is a line out of nowhere.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("Two quick ones on that first");
    // A replay of the owner's answer to the first question, mid-walk, read the next walk item every time: the answer is a
    // pick between two options, and "a pick closes the item" fired on it.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "A steer on what the item should become\n  holds the NEXT item back until two or three alignment questions on it are answered (above): the answer to\n  the first gets the second, never the next item.",
    );
  });

  // A voice session re-asked settled choices, ignored a briefing, did not hold "stop asking", and
  // capped a run they had asked for. Prompt policy, so its exact words are the property.
  it("lets later words win, never asks a settled choice, holds 'stop asking' for the call, and uncaps a run the owner asked for", () => {
    const backend = ALIGNMENT_QUESTION_BACKEND_LINES.join("\n");
    expect(backend).toContain(
      "The owner's later words on this call override earlier ones, and a choice any steer on this\n  call already settled is never asked. None at all when the owner said the decision comes through a briefing\n  or from how they react later.",
    );
    expect(backend).toContain(
      "- The owner asks for alignment questions directly: the count of two or three does not bind and you say no total you\n  do not know. Ask one at a time, relay_steer each answer, until no choice they left open remains or they stop\n  them.",
    );
    expect(backend).toContain(
      "- 'Stop asking', 'just do it', 'move on', 'that's enough' or the like ends alignment questions at once and for\n  the rest of the call, on this thing and every later one, until the owner asks for them again.",
    );
    // The old fixed cap fought a run the owner asked for, and "move on" ended only the current run.
    expect(backend).not.toContain("never a fourth");
    expect(backend).not.toContain("'Move on', 'that's enough', the last answer");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(backend);
  });

  // An alignment answer is itself relayed, and both prompts' relay rules said to read the next walk item
  // at once, which would skip the questions still owed. Each relay rule now names the exception.
  // The voice's relay rule still sent it to "the next alignment question while one is owed
  // (above)" once the block it pointed at had left the voice prompt, so it could ask one of its own.
  it("lets every relay rule that moves a walk on wait for an owed alignment question", () => {
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "in a walk go straight on to the next item, or to the next\nalignment question the thinking model's answer carries, never one of your own; an unclear annoyance's one question, when owed, is the whole answer instead.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).not.toContain("alignment question while one is owed");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "one, above) read the next item, or the next alignment question while one is owed (above), in the SAME answer; an unclear annoyance's one\n  question, when owed, is the whole answer instead.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "its question again in one line, or an alignment question still owed (above).",
    );
    expect(TALK_VOICE_INSTRUCTIONS).not.toMatch(
      ownerNeutral({ phrase: "in a walk go straight on to the next item. Only when they ask" }),
    );
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("in a walk read the next item in\n  the SAME answer. Only when");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "While alignment questions are\n  still owed on the item (above), an answer to one is not yet a reaction to the item: ask the next one.",
    );
    // Again: relay_steer's own description, projected into the thinking model's tools, still said "or go on
    // to the next item".
    const relaySteer = STEER_TOOLS.find((tool) => tool.name === "relay_steer")!;
    // It defers to the prompt's order rather than restating half of it: "Pick A. Also, that last answer annoyed me."
    // met a description that said to go on to the next item before the annoyance question was answered.
    expect(relaySteer.description).toContain(
      "If the owner also said an answer annoyed them and you cannot tell why, its one question is your whole answer. Otherwise answer what the owner said, then put to them an alignment question still owed, else the current item again if it is still unanswered, else the next item.",
    );
    expect(relaySteer.description).not.toContain("or go on to the next item");
    // A verdict limited to one card has no rule count to say, here as in both prompts and its relay note.
    expect(relaySteer.description).toContain(
      "with covers: rule, say how many cards its rule covers, from what you read them.",
    );
    // A third time: an answer that is both an alignment answer and a correction ("grey it out, and it's
    // pull requests, not PRs") met a correction rule that carried a walk straight on.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "in\n  a walk, the next item, or the next alignment question while one is owed (below), unless the owner also said an answer annoyed them, cause unclear: then its one question is the whole answer (below).",
    );
    // And a fourth: "Pick A. Also, that last answer annoyed me." met both "a pick reads the next item" and "an
    // unclear annoyance gets one question and nothing else". The question goes first, by design, and says so.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "current question until the owner answers it. A pick, verdict or answer they gave with it is relayed, and whatever\n  it left owed (the next item, or an alignment question below) follows the answer to the question.",
    );
  });
});
