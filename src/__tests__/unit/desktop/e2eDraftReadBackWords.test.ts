/**
 * Unit: `draft-read-back` passes only on one exchange whose voice quotes a draft carrying both asked words.
 *
 * A call that heard the prompt only from "And, and, yeah, there's no rush" on wrote no draft, and a leg must not pass
 * on "Quick check, which draft are we editing?" merely because a voice row followed a turn carrying "draft". The two
 * words alone must not pass a clarification naming them, nor words gathered across two exchanges.
 */
import { describe, expect, it } from "vitest";

import { DRAFT_READ_BACK_PROMPT } from "../../../desktop/e2eCallPlan.js";
import type { E2eRow } from "../../../desktop/e2eCallRows.js";
import {
  DRAFT_READ_BACK_WORDS,
  draftTurnAndAnswer,
  MIN_DRAFT_WORDS,
  OWNER_SPEAKER,
  quotedDraftBodies,
  readsBackTheDraft,
} from "../../../desktop/e2eDraftReadBackRows.js";

/** The owner's turn exactly as a real call heard it, the prompt's opening lost. */
const HEARD_FROM_THE_MIDDLE =
  "And, and, yeah, there's no rush on their review. Keep it concise and in my voice, then read the draft back to me";

/** The voice's read-back of a draft it wrote itself: the shape that must pass. */
const SELF_DRAFTED_READ_BACK =
  "Sure, here's a tight two-liner: \"Hey, I ran the end-to-end test on the desktop app. No rush at all, just " +
  'whenever you get a chance to take a look."';

/**
 * Characters built from their code points, never typed, so no editor can normalise or hide one: U+037E is a
 * canonical equivalent of the ASCII semicolon.
 */
const ARABIC_QUESTION = String.fromCodePoint(0x061f);
const FULL_WIDTH_QUESTION = String.fromCodePoint(0xff1f);
const GREEK_QUESTION = String.fromCodePoint(0x037e);
const REVERSED_QUESTION = String.fromCodePoint(0x2e2e);
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);
const COMBINING_ACUTE = String.fromCodePoint(0x0301);

/**
 * An owner row.
 *
 * @param text the words the owner said
 * @returns the row
 */
function owner({ text }: { text: string }): E2eRow {
  return { text, who: OWNER_SPEAKER };
}

/**
 * A voice row.
 *
 * @param text the words the voice said
 * @returns the row
 */
function voiceRow({ text }: { text: string }): E2eRow {
  return { text, who: "voice" };
}

/**
 * The read-back verdict on the owner's full prompt then the voice's rows.
 *
 * @param voice each voice row's words, in order
 * @returns whether the voice read the draft back
 */
function readBack({ voice }: { voice: readonly string[] }): boolean {
  const rows = [owner({ text: DRAFT_READ_BACK_PROMPT }), ...voice.map((text) => voiceRow({ text }))];
  return draftTurnAndAnswer({ baseline: [], rows }).voiceAnswer;
}

describe("draftTurnAndAnswer's read-back", () => {
  it("fails the rows of a call that heard the prompt from the middle: a voice answer asking which draft quotes none", () => {
    const rows = [
      owner({ text: HEARD_FROM_THE_MIDDLE }),
      voiceRow({ text: "Yep, I'll match your voice." }),
      voiceRow({ text: "Quick check, which draft are we editing? I don't see it here." }),
    ];
    expect(draftTurnAndAnswer({ baseline: [], rows })).toEqual({ ownerTurn: true, voiceAnswer: false });
  });

  it("passes a read-back of a draft the voice wrote and quoted itself", () => {
    expect(readBack({ voice: [SELF_DRAFTED_READ_BACK] })).toBe(true);
  });

  it("passes the read-back of a real call this final judge passed", () => {
    expect(
      readBack({
        voice: [
          "Sure, I'll draft it now.",
          'Here\'s a draft: "Hey, quick test ran the end-to-end on the desktop app. No rush on your review." Want it tweaked?',
        ],
      }),
    ).toBe(true);
  });

  it("passes the thinking model's frame, 'The draft says: … That's the draft.', with no quote marks", () => {
    expect(readBack({ voice: ["The draft says: The test ran, no rush on the review. That's the draft."] })).toBe(true);
  });

  // A clarification or a summary of the ask naming both words quotes no draft.
  it("fails a clarification and a summary of the ask that name both words but quote no draft", () => {
    expect([
      readBack({ voice: ["I understand this is a test. Before I draft it, is there any rush?"] }),
      readBack({ voice: ["You want a message saying the test ran and there's no rush; which colleague is it for?"] }),
      // A clarification inside quotes is still a question, never a draft.
      readBack({
        voice: ['Before I draft anything, please clarify: "Do you want the test mentioned, and is there no rush?"'],
      }),
      readBack({ voice: ["The draft says: is the test done, and is there no rush?"] }),
      // A question mark of any script.
      readBack({
        voice: [ARABIC_QUESTION, FULL_WIDTH_QUESTION, GREEK_QUESTION, REVERSED_QUESTION].map(
          (mark) => `"test rush${mark}"`,
        ),
      }),
    ]).toEqual([false, false, false, false, false]);
  });

  it("builds the Greek question mark as U+037E itself, never the ASCII semicolon it normalises to", () => {
    expect([GREEK_QUESTION.codePointAt(0), GREEK_QUESTION === ";"]).toEqual([0x037e, false]);
  });

  // An intervening owner turn starts a new exchange, so words never gather across two.
  it("fails words gathered across two exchanges, and a later owner turn that is not the dictated one", () => {
    const rows = [
      owner({ text: DRAFT_READ_BACK_PROMPT }),
      voiceRow({ text: '"Is this a test?"' }),
      owner({ text: "Draft it for the team channel" }),
      voiceRow({ text: '"And there\'s no rush, correct?"' }),
    ];
    const answeredThenMoved = [
      owner({ text: DRAFT_READ_BACK_PROMPT }),
      voiceRow({ text: SELF_DRAFTED_READ_BACK }),
      owner({ text: "Thanks, anything else?" }),
      voiceRow({ text: "Nope." }),
    ];
    expect([
      draftTurnAndAnswer({ baseline: [], rows }),
      draftTurnAndAnswer({ baseline: [], rows: answeredThenMoved }),
    ]).toEqual([
      { ownerTurn: true, voiceAnswer: false },
      { ownerTurn: true, voiceAnswer: false },
    ]);
  });

  it("fails a quoted draft carrying only one asked word, either one, and whole words only", () => {
    expect([
      readBack({ voice: ['Here it is: "No rush on your review."'] }),
      readBack({ voice: ['Here it is: "The end to end test ran."'] }),
      readBack({ voice: ['Here it is: "The app was tested, nothing rushed."'] }),
      // An invisible joiner or a combining mark continues a word.
      readBack({ voice: [`Here it is: "The app is test${ZERO_WIDTH_JOINER}ing and rush${ZERO_WIDTH_JOINER}ed."`] }),
      readBack({ voice: [`Here it is: "The test${COMBINING_ACUTE} ran, no rush${COMBINING_ACUTE}."`] }),
    ]).toEqual([false, false, false, false, false]);
  });

  // Two quoted words are two bodies, and neither one is a draft carrying both.
  it("fails the two words quoted apart, each its own body, and an unquoted mention beside a quote", () => {
    expect([
      readBack({ voice: ['The keywords are "test" and "rush".'] }),
      readBack({ voice: ['It says "the test ran", and there is no rush.'] }),
      // The frame must not join two quoted words into one body.
      readBack({ voice: ['The draft says: "test" and "rush"'] }),
    ]).toEqual([false, false, false]);
  });

  // The ask's own phrase quoted back is no draft, a quoted word elsewhere never hides
  // a framed draft, and a draft ending on a question fails rather than passes (the stated residue).
  it("fails the ask's phrase quoted back, passes a frame beside a quote, and fails a draft ending on a question", () => {
    expect([
      readBack({
        voice: ['Before I draft it, you want the phrase "test and no rush" included, which colleague is it for?'],
      }),
      readBack({
        voice: ["The draft says: The test ran, no rush on your review. That's the draft. Want “concise” changed?"],
      }),
      readBack({
        voice: ["“The desktop app test ran successfully. No rush, could you review it when you have a chance?”"],
      }),
    ]).toEqual([false, true, false]);
  });

  // A question with a sentence after it is still a question; and the two genuine
  // read-backs it found failing are the stated residue, red rather than green.
  it("fails a quoted question with a sentence after it, and the stated residue of short or self-quoting drafts", () => {
    expect([
      readBack({
        voice: ['Before I draft, please confirm: "Should the desktop app test mention no rush? Let me know."'],
      }),
      readBack({ voice: ['Here\'s the draft: "Desktop app test ran. No rush reviewing."'] }),
      readBack({
        voice: ['The draft says: The desktop app "test" ran end to end. No rush on review. That\'s the draft.'],
      }),
    ]).toEqual([false, false, false]);
  });

  // The words of the frame inside ordinary grammar open no frame.
  it("fails 'what the draft says' in a clarification, and a frame with no close", () => {
    expect([
      readBack({
        voice: [
          "I haven't written it yet. Tell me what the draft says, and I'll make sure the test message makes clear " +
            "there is no rush.",
        ],
      }),
      readBack({ voice: ["The draft says: The test ran, no rush on the review whenever you can."] }),
      // The close ends its own sentence, never the start of a possessive.
      readBack({
        voice: [
          "I have not written the message yet. The draft says: the test should be mentioned and there should be no " +
            "rush. That's the draft's requirement, not a completed message.",
        ],
      }),
    ]).toEqual([false, false, false]);
  });

  // A quote inside a question is that question's, wherever the question mark sits.
  it("fails the ask quoted back inside a question, and keeps a draft closing its own sentence before one", () => {
    expect([
      readBack({
        voice: [
          "Before I start, you asked me to “draft a two line Slack message with the words test and no rush in it”; " +
            "is that right?",
        ],
      }),
      readBack({ voice: ['Here it is: "The end to end test ran, no rush on your review." Want it tweaked?'] }),
      // A question mark straight after the quote closes the same sentence.
      readBack({ voice: ["Did you mean, “The test is complete and there is no rush on review.”?"] }),
      // "That's the draft request" is no close.
      readBack({
        voice: [
          "The draft says: You asked for a two line Slack message with test and no rush. That's the draft request, right?",
        ],
      }),
      // A lowercase continuation means the quote's full stop ended no sentence.
      readBack({
        voice: [
          'Before I draft it, do you want me to say "The test completed successfully and there is no rush." in the ' +
            "message?",
        ],
      }),
      // An abbreviation's full stop breaks no sentence.
      readBack({
        voice: [
          "Before I write it, you want “a two line Slack message saying the test ran and there is no rush”; e.g. is " +
            "that right?",
        ],
      }),
    ]).toEqual([false, true, false, false, false, false]);
  });

  it("passes a body of exactly MIN_DRAFT_WORDS words and fails one a word short", () => {
    expect(MIN_DRAFT_WORDS).toBe(8);
    expect([
      readsBackTheDraft({ body: "The test ran, there's no rush on review." }),
      readsBackTheDraft({ body: "The test ran, there's no rush here." }),
    ]).toEqual([true, false]);
  });

  it("passes a quoted draft split across voice rows of one exchange, in any case and curly quotes", () => {
    expect(readBack({ voice: ["Here's the draft. “Hey, the end to end Test ran.", "No RUSH on your review.”"] })).toBe(
      true,
    );
  });
});

describe("quotedDraftBodies", () => {
  it("takes every double-quoted span and what follows the draft-says frame, and nothing from unquoted words", () => {
    expect([
      quotedDraftBodies({ text: 'A "one" and “two”.' }),
      quotedDraftBodies({ text: "The draft says: hi there. That's the draft. Want changes?" }),
      quotedDraftBodies({ text: "Is there any rush on the test?" }),
      quotedDraftBodies({ text: 'Asked "which one?" then quoted "this one."' }),
      // The frame is whole words, never the tail of another word.
      quotedDraftBodies({ text: "Bathe draft says test rush" }),
      quotedDraftBodies({ text: "The draft sayso test rush" }),
      // The close is whole words too, so it never hides the body's question mark.
      quotedDraftBodies({ text: "The draft says: The test is complete, no rush. That's the drafter's question?" }),
      // A frame inside a quoted question is that question, never a body of its own.
      quotedDraftBodies({ text: "The voice asks: “The draft says: test rush. That's the draft?”" }),
      // The frame is read outside the quotes, so a quote elsewhere keeps it; that quote, inside a question, is no
      // body itself.
      quotedDraftBodies({ text: "The draft says: hi there. That's the draft. Want “brief” kept?" }),
      // Cutting a quote never spells the frame's own spaces.
      quotedDraftBodies({ text: 'The"junk"draft says: The test ran and there is no rush today. That\'s the draft.' }),
      // Only the protocol's own opening, starting a sentence with its colon, opens one.
      quotedDraftBodies({ text: "Tell me what the draft says: the test ran, no rush. That's the draft." }),
    ]).toEqual([["one", "two"], ["hi there."], [], ["this one."], [], [], [], [], ["hi there."], ["junk"], []]);
  });
});

describe("DRAFT_READ_BACK_PROMPT", () => {
  it("asks for both words by name, and says 'test' only in its opening, which a call hearing it from the middle loses", () => {
    const half = DRAFT_READ_BACK_PROMPT.indexOf(", and, yeah,");
    expect(DRAFT_READ_BACK_WORDS).toEqual(["test", "rush"]);
    expect([
      DRAFT_READ_BACK_PROMPT.includes("with the words test and no rush in it"),
      DRAFT_READ_BACK_PROMPT.slice(half).includes("test"),
      HEARD_FROM_THE_MIDDLE.includes("test"),
    ]).toEqual([true, false, false]);
  });
});
