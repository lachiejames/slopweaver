import { describe, expect, it } from "vitest";

import { COPY_PARAGRAPH_WORDS_MAX, copyVoiceVerdict } from "../../../../outbound/voice/copyVerdict.js";
import type { ExactVoiceRule } from "../../../../outbound/voice/exactRules.js";
import { ARI_CUT, ARI_OFFERED, MONITORS_CUT, MONITORS_OFFERED } from "./draftsOwnerCut7Oct.js";

const EM_DASH: ExactVoiceRule = { kind: "literal", value: "—" };

describe("copyVoiceVerdict", () => {
  // The measured case: a review comment carrying an em dash was offered, and the owner cut it by hand.
  it("refuses an em dash, naming the rule and what to do, never the message", () => {
    const text = "could we use plain text for this — i can't read the regex";

    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: false, text })).toEqual({
      kind: "refused",
      reasons: [
        'text matches the configured literal voice rule "—". Rewrite the message in the configured voice and call offer_copy again.',
      ],
    });
  });

  it("accepts a message that keeps every rule, and accepts anything when no rule is configured", () => {
    expect(
      copyVoiceVerdict({
        rules: [EM_DASH],
        slackDraft: false,
        text: "could we use plain text for this? i can't read it",
      }),
    ).toEqual({
      kind: "accepted",
    });
    expect(copyVoiceVerdict({ rules: [], slackDraft: false, text: "a — b" })).toEqual({ kind: "accepted" });
  });

  // A talk opening the owner will SAY goes to the tray, and the check judges its words alone.
  it("judges a spoken script by its wording like any message, accepting one that keeps every rule", () => {
    const opening =
      "Hi all, quick one. Here is how the Acme team uses AI day to day.\n\nThink of it as power steering: the engineer still drives.";
    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: false, text: opening })).toEqual({ kind: "accepted" });
  });

  it("names the line of a multi-line message, one reason per rule broken", () => {
    const verdict = copyVoiceVerdict({
      rules: [EM_DASH, { kind: "word", value: "delve" }],
      slackDraft: false,
      text: "first line is fine\nlet's delve — properly",
    });

    expect(verdict).toEqual({
      kind: "refused",
      reasons: [
        'text.line[1] matches the configured literal voice rule "—". Rewrite the message in the configured voice and call offer_copy again.',
        'text.line[1] matches the configured word voice rule "delve". Rewrite the message in the configured voice and call offer_copy again.',
      ],
    });
  });

  it("applies the rules binding the owner's own lane and none bound to the bot alone", () => {
    const rules: readonly ExactVoiceRule[] = [
      { actors: ["bot"], kind: "literal", value: "§" },
      { actors: ["me"], kind: "literal", value: "¶" },
    ];

    expect(copyVoiceVerdict({ rules, slackDraft: false, text: "§ only" })).toEqual({ kind: "accepted" });
    expect(copyVoiceVerdict({ rules, slackDraft: false, text: "¶ here" })).toEqual({
      kind: "refused",
      reasons: [
        'text matches the configured literal voice rule "¶". Rewrite the message in the configured voice and call offer_copy again.',
      ],
    });
  });

  it("skips what is not the owner's prose: a quoted line, inline code, a fenced block and a URL", () => {
    const text = ["> they said — this", "run `a—b` now", "```", "x — y", "```", "see https://example.com/a—b"].join(
      "\n",
    );

    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: false, text })).toEqual({ kind: "accepted" });
  });
});

/** A short Slack draft asking a colleague to approve a connector trial, as one paragraph of three ideas. */
const TRIAL_CRAMPED =
  "hey sadie, tried the local-only option we talked about. it's the provider's connector in the editor on my laptop, " +
  "not something we built. it signed in and read my account. the key stays in the laptop's keychain, so nothing is " +
  "reachable from another machine as far as i know. reads go through the provider's server into the chat, and it " +
  "sits on the same laptop as my setup, so it isn't isolated from it. it asks for write access. are you okay with " +
  "this?";

/** The same words with a blank line between its three ideas. */
const TRIAL_SPACED =
  "hey sadie, tried the local-only option we talked about. it's the provider's connector in the editor on my laptop, " +
  "not something we built. it signed in and read my account.\n\nthe key stays in the laptop's keychain, so nothing is " +
  "reachable from another machine as far as i know. reads go through the provider's server into the chat, and it " +
  "sits on the same laptop as my setup, so it isn't isolated from it.\n\nit asks for write access. are you okay with " +
  "this?";

/**
 * The reason one dense paragraph earns, exactly.
 *
 * @returns the reason the verdict carries
 */
function denseReason({ paragraph, words: count }: { paragraph: number; words: number }): string {
  return (
    `shape paragraph-words: paragraph ${String(paragraph)} has ${String(count)} words, past 70: break it into short ` +
    "paragraphs, one idea each, a blank line between them. Cut it to that shape and call offer_copy again."
  );
}

/**
 * A run of plain words.
 *
 * @returns that many words, one space apart
 */
function words({ count }: { count: number }): string {
  return Array.from({ length: count }, () => "word").join(" ");
}

/** A hundred words split fifty and fifty, so only the whole-message cap of 100 is under test, never a paragraph's. */
const HUNDRED_IN_TWO_PARAGRAPHS = `${words({ count: 50 })}\n\n${words({ count: 50 })}`;

/** The trailing reason the reminder draft earns, exactly. */
const REMINDER_TRAILING =
  "shape trailing: paragraph 1 runs 1 sentence past its ask: end that paragraph on the ask and cut what follows it " +
  "there, since the reader stops reading at the ask; context a reader needs goes in its own paragraph. Cut it to that shape " +
  "and call offer_copy again.";

describe("copyVoiceVerdict for a Slack message as the owner", () => {
  // The owner stops a message on its ask.
  it("refuses the reminder draft as the voice wrote it, on the sentence after its ask, and lands the cut", () => {
    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: true, text: ARI_OFFERED })).toEqual({
      kind: "refused",
      reasons: [REMINDER_TRAILING],
    });
    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: true, text: ARI_CUT })).toEqual({ kind: "accepted" });
  });

  // The last fifth of the draft is cut.
  it("refuses the monitors reply as the voice wrote it on its words, and lands the cut the owner took", () => {
    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: true, text: MONITORS_OFFERED })).toEqual({
      kind: "refused",
      reasons: [
        "shape words: 104 words, past 100 (a link's label counts, since it is on the screen): peel details back " +
          "until each word earns its place, and give a pull request a short label. Cut it to that shape and call " +
          "offer_copy again.",
        denseReason({ paragraph: 1, words: 104 }),
      ],
    });
    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: true, text: MONITORS_CUT })).toEqual({ kind: "accepted" });
  });

  // A channel link with an empty label is still a word on the screen.
  it("counts a channel link with an empty label as the word the tray shows", () => {
    const hundred = HUNDRED_IN_TWO_PARAGRAPHS;
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: hundred })).toEqual({ kind: "accepted" });
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: `${hundred} <#C01|>` })).toEqual({
      kind: "refused",
      reasons: [
        "shape words: 101 words, past 100 (a link's label counts, since it is on the screen): peel details back " +
          "until each word earns its place, and give a pull request a short label. Cut it to that shape and call " +
          "offer_copy again.",
      ],
    });
  });

  // Slack draws `&amp;` as `&`, so an escaped label adds no word.
  it("counts an escaped link label as the character Slack draws, never as a word", () => {
    const hundred = HUNDRED_IN_TWO_PARAGRAPHS;
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: `${hundred} <https://example.com|&amp;>` })).toEqual({
      kind: "accepted",
    });
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: `${hundred} &amp; &lt;&gt;` })).toEqual({
      kind: "accepted",
    });
  });

  // Prose wrapped as `<@…>` is no mention, so every word in it counts.
  it("counts the words of prose wrapped to look like a mention", () => {
    const hundredAndOne = Array.from({ length: 101 }, () => "word").join(" ");
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: `<@${hundredAndOne}>` })).toEqual({
      kind: "refused",
      reasons: [
        "shape words: 101 words, past 100 (a link's label counts, since it is on the screen): peel details back " +
          "until each word earns its place, and give a pull request a short label. Cut it to that shape and call " +
          "offer_copy again.",
        denseReason({ paragraph: 1, words: 101 }),
      ],
    });
  });

  // A bold run straight on from the question, lower case, its markers dropped.
  it("refuses a sentence glued in bold to the ask it follows", () => {
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: "Can you review this?*i added context.*" })).toEqual({
      kind: "refused",
      reasons: [REMINDER_TRAILING],
    });
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: "Can you review this?*2 issues remain.*" })).toEqual({
      kind: "refused",
      reasons: [REMINDER_TRAILING],
    });
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: "Can you review this?🙏 I added context." })).toEqual({
      kind: "refused",
      reasons: [REMINDER_TRAILING],
    });
  });

  // Emphasis inside a freeform close hid it from the filler rule.
  it("refuses a freeform close with a word in bold, as it refuses it plain", () => {
    const refused = {
      kind: "refused",
      reasons: [
        "shape filler: a freeform close or an attachment announced in words does not earn its space: end on the one " +
          "question, or say plainly that it is an FYI, and let an attachment speak for itself. Cut it to that shape " +
          "and call offer_copy again.",
      ],
    };
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: "keen to hear what you reckon" })).toEqual(refused);
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: "keen to *hear* what you reckon" })).toEqual(refused);
  });

  it("holds neither draft to the shape when it is not a Slack message", () => {
    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: false, text: ARI_OFFERED })).toEqual({
      kind: "accepted",
    });
    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: false, text: MONITORS_OFFERED })).toEqual({
      kind: "accepted",
    });
  });

  it("puts the exact-rule reasons first, then the shape, and quotes no word of the draft in either", () => {
    const text = ARI_OFFERED.replace("Was thinking", "Was thinking — honestly —");
    const verdict = copyVoiceVerdict({ rules: [EM_DASH], slackDraft: true, text });
    expect(verdict).toEqual({
      kind: "refused",
      reasons: [
        'text matches the configured literal voice rule "—". Rewrite the message in the configured voice and call offer_copy again.',
        REMINDER_TRAILING,
      ],
    });
    expect(text).toContain("chasing any of these");
    expect(JSON.stringify(verdict)).not.toContain("chasing any of these");
  });

  // A code span on the line hid the prose beside it from the shape check.
  it("judges the prose beside a code span on the same line", () => {
    expect(
      copyVoiceVerdict({ rules: [], slackDraft: true, text: "Can you review this? I added context. ```x```" }),
    ).toEqual({
      kind: "refused",
      reasons: [
        "shape trailing: paragraph 1 runs 2 sentences past its ask: end that paragraph on the ask and cut what " +
          "follows it there, since the reader stops reading at the ask; context a reader needs goes in its own paragraph. " +
          "Cut it to that shape and call offer_copy again.",
      ],
    });
  });

  it("names the figures it counts without quoting one", () => {
    const text = "spend went from $12k to $40k, about 230% up";
    const verdict = copyVoiceVerdict({ rules: [], slackDraft: true, text });
    expect(verdict).toEqual({
      kind: "refused",
      reasons: [
        "shape figures: 3 figures, past 1: keep the ONE that sells the finding in the prose and draw the rest as " +
          "annotations on the attached image. Cut it to that shape and call offer_copy again.",
      ],
    });
    expect(text).toContain("$40k");
    expect(JSON.stringify(verdict)).not.toContain("$40k");
  });

  // This draft needed more vertical white space.
  it("refuses the cramped connector-trial draft as one dense paragraph, and lands the same words spaced", () => {
    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: true, text: TRIAL_CRAMPED })).toEqual({
      kind: "refused",
      reasons: [denseReason({ paragraph: 1, words: 84 })],
    });
    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: true, text: TRIAL_SPACED })).toEqual({
      kind: "accepted",
    });
    expect(copyVoiceVerdict({ rules: [EM_DASH], slackDraft: false, text: TRIAL_CRAMPED })).toEqual({
      kind: "accepted",
    });
  });

  it("lands a paragraph of exactly the cap and refuses one word more, naming which paragraph", () => {
    const atCap = words({ count: COPY_PARAGRAPH_WORDS_MAX });
    const pastCap = words({ count: COPY_PARAGRAPH_WORDS_MAX + 1 });
    expect(COPY_PARAGRAPH_WORDS_MAX).toBe(70);
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: atCap })).toEqual({ kind: "accepted" });
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: `yo\n\n${pastCap}` })).toEqual({
      kind: "refused",
      reasons: [denseReason({ paragraph: 2, words: 71 })],
    });
  });

  it("counts none of a quote, a fence or a list as the owner's paragraph, and counts the answer under a quote", () => {
    // Each alone, since the whole-message cap of 100 counts a quote and code as words on the screen.
    const long = words({ count: 80 });
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: `> ${long}` })).toEqual({ kind: "accepted" });
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: `\`\`\`\n${long}\n\`\`\`` })).toEqual({
      kind: "accepted",
    });
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: `• ${long}` })).toEqual({ kind: "accepted" });
    // Numbered items are a list, as the paragraph-spacing rule reads them.
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: `1. ${long}` })).toEqual({ kind: "accepted" });
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: `2) ${long}` })).toEqual({ kind: "accepted" });
    // And like a `•` item, a numbered one ends the paragraph before it, so prose either side is two.
    const paragraphsReason =
      "shape paragraphs: 4 paragraphs, past 3: open on the one-sentence finding and its number, ask the one " +
      "question, and cut every paragraph that is detail a colleague can pull for. Cut it to that shape and call " +
      "offer_copy again.";
    for (const marker of ["•", "1."]) {
      expect(
        copyVoiceVerdict({ rules: [], slackDraft: true, text: `alpha\n${marker} item\nbeta\n\ngamma\n\ndelta` }),
      ).toEqual({ kind: "refused", reasons: [paragraphsReason] });
    }
    // A quote standing alone is no words of the owner's, but it is still the block the number counts past.
    expect(
      copyVoiceVerdict({ rules: [], slackDraft: true, text: `> quoted words\n\n${words({ count: 71 })}` }),
    ).toEqual({ kind: "refused", reasons: [denseReason({ paragraph: 2, words: 71 })] });
    // A list takes no number, as the parked-draft shape's own paragraph count leaves it out.
    expect(
      copyVoiceVerdict({ rules: [], slackDraft: true, text: `intro\n\n• item\n\n${words({ count: 71 })}` }),
    ).toEqual({ kind: "refused", reasons: [denseReason({ paragraph: 2, words: 71 })] });
    // Slack's >>> quotes every line after it, so none of those words is the owner's.
    expect(
      copyVoiceVerdict({ rules: [], slackDraft: true, text: `>>> quoted block\n${words({ count: 71 })}` }),
    ).toEqual({ kind: "accepted" });
    const answered = `> ${words({ count: 20 })}\n${words({ count: COPY_PARAGRAPH_WORDS_MAX + 1 })}`;
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: answered })).toEqual({
      kind: "refused",
      reasons: [denseReason({ paragraph: 1, words: 71 })],
    });
  });

  it("counts a link's label as the words on the screen, never its address", () => {
    const sixtyEight = words({ count: 68 });
    const longUrl = `https://example.com/${words({ count: 10 }).replaceAll(" ", "/")}`;
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: `${sixtyEight} <${longUrl}|two words>` })).toEqual({
      kind: "accepted",
    });
    expect(
      copyVoiceVerdict({ rules: [], slackDraft: true, text: `${sixtyEight} <${longUrl}|three more words>` }),
    ).toEqual({ kind: "refused", reasons: [denseReason({ paragraph: 1, words: 71 })] });
  });

  it("lands the one-paragraph reply the owner took as written, which a cap of fifty would refuse", () => {
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: MONITORS_CUT })).toEqual({ kind: "accepted" });
    expect(MONITORS_CUT).not.toContain("\n");
  });

  it("lands a talk opening of three paragraphs when it is not for Slack, and refuses four for Slack", () => {
    const four = "one\n\ntwo\n\nthree\n\nfour";
    expect(copyVoiceVerdict({ rules: [], slackDraft: false, text: four })).toEqual({ kind: "accepted" });
    expect(copyVoiceVerdict({ rules: [], slackDraft: true, text: four })).toEqual({
      kind: "refused",
      reasons: [
        "shape paragraphs: 4 paragraphs, past 3: open on the one-sentence finding and its number, ask the one " +
          "question, and cut every paragraph that is detail a colleague can pull for. Cut it to that shape and call " +
          "offer_copy again.",
      ],
    });
  });
});
