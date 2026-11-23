/**
 * Finding and opening a Queue card: the card tools after `action_items`, every link read before the first sentence,
 * a lookup that ends in one sentence when nothing matches, and the card the call turns to put in front of the owner.
 */
import { describe, expect, it } from "vitest";

import { CARD_TOOLS } from "../../../../talk/cardToolSchemas.js";
import { CARD_TURN_BACKEND_LINES } from "../../../../talk/cardTurnLines.js";
import { DELIVERABLE_FIND_BACKEND_LINES, DELIVERABLE_FIND_VOICE_LINES } from "../../../../talk/deliverableFindLines.js";
import { DRAFT_EDIT_BACKEND_LINES } from "../../../../talk/draftToolSchemas.js";
import { FIND_CARD_BACKEND_LINES } from "../../../../talk/findCardPromptLines.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../../talk/sessionConfig.js";
import { TALK_TOOLS } from "../../../../talk/talkToolSchemas.js";

describe("TALK_TOOLS", () => {
  it("carries the card tools directly after action_items, read_card first", () => {
    const names = TALK_TOOLS.map((tool) => tool.name);
    const after = names.indexOf("action_items") + 1;
    expect(names.slice(after, after + CARD_TOOLS.length)).toEqual(["read_card", "open_card"]);
  });

  // `action_items` once crossed the page's tool cap, and the voice could then open no card the owner named.
  it("points the model at the key-and-subject index and the cut line action_items fits inside the cap with", () => {
    const actionItems = TALK_TOOLS.find((tool) => tool.name === "action_items")!;
    expect(actionItems.parameters).toEqual({
      additionalProperties: false,
      properties: {},
      required: [],
      type: "object",
    });
    expect(actionItems.description).toContain(
      "find a card the owner names THERE, then open_card its key before you speak about it (read_card when read_page says it is the one open)",
    );
    expect(actionItems.description).not.toContain("then read_card its key");
    expect(actionItems.description).toContain("named in `recentlyLeftNames`");
    expect(actionItems.description).toContain("`cut`, when present, says what was shortened to fit");
    expect(CARD_TOOLS[0]!.description).toContain("from action_items (its itemNames or recentlyLeftNames)");
  });

  // The model once read a card's row and pull request but not the linked mockup, when the owner expected everything the
  // card links to read already. A briefing that failed to open was once reported as unreadable, and a long briefing
  // is read in as many windows as it takes.
  it("speaks from the briefings the card's answer already read, reads a cut one on, and says a failed one's sentence", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Its `briefings` arrive read: speak from each, paging a 'partial' one on per read_card.\n" +
        "  A `say` is said only as read_card says; never agree with or describe what you were not handed.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("a local page by file_read with the page's");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      [...DRAFT_EDIT_BACKEND_LINES, ...CARD_TURN_BACKEND_LINES, ...DELIVERABLE_FIND_BACKEND_LINES].join("\n"),
    );
  });

  it("reads a named Queue card and every direct link before the first sentence, and the next item's in a walk", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("read every other page, screenshot, pull request and row");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  a pull request or issue by verb github read <url>, a row by board_row",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("but not the links inside those.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("never 'I'll take a look' or 'let me check'.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "then say which and why in a few words, never that the whole card was read.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("has also read the NEXT card and its links");
    // Codex review r3: a card whose only link refuses (a bare GitHub attachment) has no linked detail to open with.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "When none would open, the first sentence says so and why, and the card's own words carry the rest.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain("if\nno link would open, it says that instead, and which.");
    expect(TALK_VOICE_INSTRUCTIONS).toContain("a word or two ('one sec') at most, never a\npromise to look");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "Your first sentence about the card\ncarries the detail from a linked page",
    );
  });

  // A voice that told the owner a card was not found once kept digging for three minutes afterwards.
  it("ends a lookup for a card it cannot find in one sentence, never a dig through files, history or verbs", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  action_items, then read_card a key it lists only when its subject is about the owner's words, to check it is the\n" +
        "  one (say nothing about it yet: a wrong guess never opens), then the one find-card call below; the card\n" +
        "  that is it goes on screen as above before you speak about it.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  names is about the owner's words is it not found. If none has it,\n" +
        "  say so in one sentence naming what you checked, and END the turn there: never search files, history or\n" +
        "  other verbs for a CARD, and never keep working after saying you could not find it.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS.indexOf("If none has it")).toBeGreaterThan(
      TALK_BACKEND_INSTRUCTIONS.indexOf("it goes on screen BEFORE ANY answer"),
    );
  });

  // Asked for a Linear draft on the owner's Queue, the voice once read_card'd the stale key a closed row's summary
  // named, got an unrelated card, and said the draft pointed to it.
  it("never answers a lookup with the open card or a key in a row's prose, and opens a held draft find-card names", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "The card open on the screen is never the\n" +
        "  answer for being open: one about something else is no guess at all, never proof the sought card is\n" +
        "  missing, and never named in its place. A post: key written inside a row's summary or body is where that row\n" +
        "  once pointed, never the card: open only a key action_items or find-card lists, and when one a row named\n" +
        "  reads as about something else, that row's pointer is stale, never the sought card 'pointing elsewhere'. A\n" +
        "  held draft find-card names is on the Queue: open_card its post: key.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "It ranks every held draft on the Queue,\n  named first by its post: key",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(FIND_CARD_BACKEND_LINES.join("\n"));
  });

  // The voice once said a briefing was ready before any read, then said the plan was there but not the full briefing,
  // about the plan file that WAS the briefing, named in its card's words.
  it("reads all four places a deliverable ends in, places and reads a found one, and never calls it missing or ready", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      [...DELIVERABLE_FIND_BACKEND_LINES, ...FIND_CARD_BACKEND_LINES].join("\n"),
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "no published page\n  is a missing publication, never a missing deliverable",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("never 'that isn't the briefing', 'not the full briefing yet'");
    expect(TALK_VOICE_INSTRUCTIONS).toContain(["", ...DELIVERABLE_FIND_VOICE_LINES, ""].join("\n"));
  });

  it("scopes find-card's stop-and-end to finding a card, so it never ends a search for a briefing", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "This\n  stop is for finding a card: a briefing, plan or draft the owner asked for is the four places above",
    );
  });

  // Asked to open a project's implementation briefing, `page find` once ranked that day's working-group notes first;
  // the voice searched again in words that dropped them, opened the older briefing, and never named the newer page.
  it("names a newer page on the same topic as it opens the one the owner asked for, and never searches it away", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "When page find lists a page on the same topic dated\n" +
        "  after the one you open (a meeting's 'what it changed'), name it and its date as you open the one asked for, and never\n" +
        "  search again in words that drop it: a newer page can make that one stale.",
    );
  });

  // The owner asked whether a card for giving the voice more capability existed, and the voice said it could not find
  // one while a run was open on exactly that.
  it("answers 'is there already a card' with one find-card call carrying paraphrases, naming the card and its state", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "- 'Is there already a card for X', 'did I already ask for X', 'have we got one for that': ONE call of verb\n" +
        "  talk find-card, its words the topic plus two or three other ways a card might say it",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("what it is about and where it stands");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "never its slug. If no draft and no row is about it, say there is no card for that\n  yet",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Never call it twice for one question, and never read_card a\n  board slug",
    );
  });

  // find-card once named a row the owner had already ruled on, the voice called open_card on it, and the console
  // refused it in front of the owner.
  it("never opens a row find-card says is not on the Queue", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "board_row reads one. A row it says is not on the Queue, or not known to be, has no\n" +
        "  card to open: say where it stands, and never open_card it.",
    );
  });

  // The owner wants the card on screen whenever the call is about a Queue card, not only the next one in a walk, so
  // the open-it-unasked rule covers every card the call turns to. The earlier ask-only rule stays retired.
  it("opens the card the call turns to before a word on it, and never reopens the one the owner already has open", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "you raise one while none is open, or the owner rules the open one, asks for next or is done: it goes on screen BEFORE ANY answer about\n" +
        "  it or any question for a steer. read_page (once a turn): when the card open on it is that one,\n" +
        "  read_card it — never reopen an open card. Otherwise open_card with its key, then speak.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "read_card,\n  which opens nothing, is also for a card read ahead in a walk until the walk reaches it, one the owner said not\n" +
        "  to open, and one that left the Queue. A card only named in passing or a list is not\n" +
        "  turned to.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Call it UNASKED, as above, and whenever\n  the owner asks to see one ('open it', 'show me that one', 'pull it up'); never offer to.",
    );
    // The app is never brought forward; the card goes to the one static tab that never closes.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "- open_card moves the one pinned Queue tab to the card and shows it, without bringing the app forward;\n" +
        "  its page opens as a new tab in front in the desktop app, never Chrome, and its Slack thread in the Slack app.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "'Don't open the cards', 'stop opening cards':\n  set_stage_setting openCards off. 'Don't open that one' skips just that card. openCards gates open_card,",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "With the openCards switch off it opens nothing; never browser_open its links then. When it answers\n" +
        "  that the card did not open, say so and why in a few words before anything else about it.",
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "the thinking model opens it\n(unless already open) and reads it and its links before you speak about it, so the card is up as you\n" +
        "start on it. A card only named, in passing or a list, does not",
    );
    // "Don't open that one" leaves a card the owner cannot see that the voice may still talk about.
    expect(TALK_VOICE_INSTRUCTIONS).not.toMatch(/never talk about one (?:he|they|the owner) (?:cannot|can['’]t) see/iu);
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "'Don't open the cards' turns that off; 'don't open that one' skips\njust that card.",
    );
    // A complaint about browser reads once turned card opening off, and it stayed off.
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "A tabs complaint: hand it over (the thinking model knows which call opened them), and\n" +
        "never ask to turn card opening off for it. Turning it back on opens nothing by itself: never say the\n" +
        "card, its page or its thread opened until the thinking model says it did.",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Then, until the owner says the tabs stop (below), read every other page,",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "When the owner says the browser or tabs keep opening\n" +
        "  while you read ('stop that, I've already got it') and you have been reading the card's links by browser,\n" +
        "  those are the tabs: stop reading that card's links, say which you did not read, and never flip\n" +
        "  openCards for it. Only when the tabs meant are the card's own page and thread is it open_card.",
    );
    // The switch once went on and the voice said the PR should be open, with nothing opened.
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "  never a browser read. Turning it on opens nothing: put the card the call is on through the rules above\n" +
        "  at once, and never say anything opened before open_card answers that it did.",
    );
    // The next-card-only rule and its while-reading exception are gone from both prompts and the schema.
    const prompts = [TALK_VOICE_INSTRUCTIONS, TALK_BACKEND_INSTRUCTIONS].join("\n");
    // "Stop opening things" read as the card switch for a complaint about browser reads, so neither prompt says it.
    expect(prompts).not.toContain("stop opening things");
    expect(prompts).not.toMatch(/once (?:he|they|the owner) (?:has|have) settled one card/iu);
    expect(prompts).not.toMatch(/while (?:he|they|the owner) (?:is|are) reading something else/iu);
    expect(prompts).not.toContain("read_card with its key FIRST");
    // The ask-only rule stays gone.
    expect(prompts).not.toMatch(/open_card ONLY when (?:he|they|the owner) explicitly asks?/iu);
    expect(prompts).not.toContain("never open one on your own initiative");
    const read = TALK_TOOLS.find((tool) => tool.name === "read_card")!;
    const open = TALK_TOOLS.find((tool) => tool.name === "open_card")!;
    expect(read.description).toContain(
      "for the card read_page says they already have open, a card you read ahead in a walk until the walk reaches it, " +
        "one they said not to open, " +
        "and one that left the owner's Queue; any other card the call turns to is open_card.",
    );
    expect(open.description).toContain(
      "Call it UNASKED whenever the call turns to one card the owner does not already have open (read_page says which they " +
        "have) — they ask about one, you raise one while none is open, or their word on the open one (they ruled it, asked for the next, " +
        "or are done with it) moves a walk on — BEFORE you say anything about it",
    );
    expect(open.description).toContain(
      "Never for the card they already have open, a card only named in passing or a list, a card you read ahead in a walk " +
        "until the walk reaches it, or a card that left the owner's Queue (those are read_card)",
    );
    expect(open.description).not.toMatch(/once (?:he|they|the owner) (?:has|have) settled one card/iu);
    expect(open.description).not.toMatch(/ONLY when (?:he|they|the owner) explicitly asks?/iu);
    // Reads, never writers: relay_steer stays the one writer.
    expect([read.kind, open.kind]).toEqual(["read", "read"]);
    const keyOnly = {
      additionalProperties: false,
      properties: { key: { type: "string" } },
      required: ["key"],
      type: "object",
    };
    // Moving on takes the card off; the voice marks only "come back to it".
    const comeBack = {
      description: "true only when the owner said to come back to the card they had open; it is put aside, not removed",
      type: "boolean",
    };
    const keyAndComeBack = { ...keyOnly, properties: { come_back_to_previous: comeBack, key: { type: "string" } } };
    expect([read.parameters, open.parameters]).toEqual([keyOnly, keyAndComeBack]);
    expect(open.description).toContain("'Skip it' alone is moving on.");
  });
});
