/**
 * The operator's exact voice rules, stated as instructions to whoever is about to COMPOSE `--as me` prose.
 *
 * ## Why this module exists
 *
 * `exactRules.ts`'s gate already prints a rule's value the moment authored prose matches it — but only
 * AFTER the composer has written the offending text and tried to send it. Measured over one
 * friction review: the literal em-dash rule alone
 * tripped 4 times in one window, 7 times across five days, each one a full compose-refuse-rewrite cycle. The
 * rules were enforced and told to nobody until the moment it was too late to matter.
 *
 * So the rules are a BRIEFING INPUT now, not just a gate — the same fix `capGuidance.ts` made for the
 * outbound size caps. `slopweaver slack voice-rules` prints this block BEFORE a single word is
 * drafted, so a rule most needs never turns into a refusal.
 *
 * ## Two kinds of guidance, labelled as such
 *
 * What this block prints is NOT all one thing, and an earlier version of this header wrongly implied it was.
 * The exact rules and the paragraph-spacing rule are ENFORCED: the `--as me` send refuses prose matching
 * them, before any network call. The response SHAPE (`./shapeMemory.ts`) is ADVISORY: the Slack send refuses
 * nothing on it, it is the operator's own guidance on how a reply should read. A PARKED draft is the exception:
 * `slack draft record --as me` refuses one past the shape the owner trims every draft to, and that block is labelled
 * ENFORCED and printed between the two (`../slack/draftEarnsItsPlace.ts`). The quote-back condition is
 * gated at a different door, whatever the shape says, where the message being answered is known —
 * `gmail draft --reply-to` refuses a reply opening on a quote of the whole parent, where it can read the
 * parent's text; the residue is in `./redundantOpeningQuote.ts`'s header. Printing the two under one heading
 * is what makes a composer treat a ban as a suggestion, or stall over advice as though it were a gate, so each
 * carries its own label and says which it is.
 *
 * ## What stays private
 *
 * This module is pure rendering: it takes whatever rules and shape text the CALLER already loaded and
 * formats them. It contains no rule and no word of the operator's own voice — the public repository owns the
 * SHAPE (`{kind, value}`, and a pointer to a memory file), never a vocabulary. See
 * `../proposal/lint/voice.ts`'s header for the fuller statement of that split.
 */
import { FIGURES_MAX, PARAGRAPHS_MAX, QUESTIONS_MAX, WORDS_MAX } from "../slack/draftEarnsItsPlace.js";
import { type ExactVoiceRule, VOICE_RULES_ESCAPE, voiceRuleSubject } from "./exactRules.js";

/**
 * The shape rule, briefed in the same breath as the vocabulary because it refuses at the same door.
 *
 * Printed only when the operator has configured it — this module still states no preference of its own, it
 * reports the one the caller loaded.
 *
 * It names every form that spaces itself, `one-list` included, because this brief is the FIRST surface a
 * composing session reads and the omission had a measured cost: a ten-PR review ask went out under
 * the voice-rules override by a session that knew only the card form, whose line
 * bound a roster cannot meet. A form a brief does not name is a form that does not exist.
 */
const SPACING_LINES: readonly string[] = [
  "PARAGRAPH SPACING (ENFORCED) — a SINGLE `--as me` message (a `one-card` post, a `one-list` roster, or any",
  "one-message send) puts a BLANK line between its paragraphs, one idea per paragraph, an `E.g.` line on its",
  "own. A `one-card` form spaces its `lines` for you and a `one-list` spaces its `lead` from its `bullets`;",
  "a `--body` needs the empty line typed. Runs of list items, `>` quoted lines and fenced code are one",
  "paragraph and are exempt. Same override, same refuse-never-rewrite contract.",
  "A roster or batch ask that will not fit a card's line bound is a `one-list`, never a `--body` and never",
  "the override: `lead`, `bullets`, `trailing` — see skills/slack/reference/the-list-form.md.",
];

/**
 * The parked-draft shape, briefed BEFORE a word is drafted because `slack draft record --as me` refuses a draft past
 * it (`../slack/draftEarnsItsPlace.ts`). Printed whatever the profile configures: the gate is
 * this repository's, not the operator's private content, and its numbers are read off the gate's own constants.
 */
export const DRAFT_SHAPE_LINES: readonly string[] = [
  "PARKED DRAFT SHAPE (ENFORCED at `slack draft record --as me`, never at release) — every word earns its place:",
  `at most ${String(PARAGRAPHS_MAX)} paragraphs and ${String(WORDS_MAX)} words (a link's label counts), ` +
    `${String(FIGURES_MAX)} figure in the prose with every other number drawn on the attached image, ` +
    `${String(QUESTIONS_MAX)} clear question to the person tagged,`,
  'and no freeform close ("keen to hear what you reckon") or attachment announced in words ("chart attached").',
  'A paragraph that asks the reader something ends on that ask: nothing restating it after, bar "no rush".',
  "Open on the one-sentence finding and its number; a ticket is one plain sentence. A roster's bullets are exempt.",
  'Hatch: `slopweaver hatch open earns-its-place --reason "<why>"`. See skills/slack/reference/earns-its-place.md.',
];

/** One rule, rendered for a composing session — the kind labelled, the value shown exactly as configured. */
function ruleLine({ rule }: { rule: ExactVoiceRule }): string {
  const label = rule.kind === "literal" ? "literal (case-sensitive)" : `${rule.kind} (case-insensitive)`;
  return `  - ${label}: ${voiceRuleSubject({ rule })}`;
}

/** The header the advisory shape block opens with, so a reader can never mistake it for a gate. */
const SHAPE_HEADER: readonly string[] = [
  "RESPONSE SHAPE (ADVISORY, the operator's own guidance) — how a reply should READ. The Slack send refuses",
  "none of it. Separately, `gmail draft --reply-to` refuses a reply OPENING on a quote of the whole parent it",
  "can read. It is here because the enforced rules below are a vocabulary, this the shape.",
  "Verbatim from the operator's own response-shape memory (`slackMe.voice.shapeMemoryFile`):",
];

/** The line printed in place of the shape block when this installation has configured none. */
const NO_SHAPE_LINE =
  "RESPONSE SHAPE — none configured for this installation (`slackMe.voice.shapeMemoryFile` is unset), so the" +
  " rules below are the whole of what is configured. They are a vocabulary, not a shape.";

/**
 * The lines a composing session is given about the operator's current voice — printed by `slopweaver slack
 * voice-rules` before any `--as me` draft is written, so what a rule most needs reaches the composer before a
 * refusal would.
 *
 * The ADVISORY shape comes first and the ENFORCED rules after it, because the shape is what a composer needs
 * before writing a word while the bans are what it needs before sending one, and each block says which it is.
 *
 * Pure: every value comes from what the caller loaded, so this can never state a rule the gate does not
 * actually enforce, never invents one, and never holds a word of the operator's own voice itself.
 *
 * @param rules the operator's exact voice rules, already loaded from `profile.json` (`slackMe.voice.exact`)
 * @param paragraphSpacing whether the spacing rule is configured too (`slackMe.voice.paragraphSpacing`)
 * @param shape the operator's response-shape prose, or `null` when this installation configured none
 * @returns the lines, in order, ready to print before composing
 */
export function voiceRuleBriefLines({
  rules,
  paragraphSpacing,
  shape,
}: {
  rules: readonly ExactVoiceRule[];
  paragraphSpacing: boolean;
  shape: string | null;
}): readonly string[] {
  const shapeLines = shape === null ? [NO_SHAPE_LINE] : [...SHAPE_HEADER, ...shape.split("\n")];
  const spacing = paragraphSpacing ? SPACING_LINES : [];
  if (rules.length === 0) {
    return [
      ...shapeLines,
      "",
      ...DRAFT_SHAPE_LINES,
      "",
      "VOICE RULES — no vocabulary rules configured for this installation. Nothing here refuses on words.",
      ...spacing,
    ];
  }
  return [
    ...shapeLines,
    "",
    ...DRAFT_SHAPE_LINES,
    "",
    "VOICE RULES (ENFORCED) — compose to these; the `--as me` send REFUSES authored prose matching any of",
    "them, before any network call. A literal match is case-sensitive text; a word/phrase match is",
    "case-insensitive with lexical boundaries. Typed links, code, mentions, broadcasts, quoted lines and",
    "technical identifiers are exempt — see `src/outbound/voice/exactRules.ts`'s `authoredProseOf`.",
    ...rules.map((rule) => ruleLine({ rule })),
    `For one deliberate exception, run ${VOICE_RULES_ESCAPE} — the rule stays in force`,
    "otherwise, and this refuses rather than rewrites.",
    ...spacing,
  ];
}
