/**
 * The drift-nudge lines both Talk prompts carry (`./sessionConfig.ts`): how the voice takes what the owner says they
 * will do, and how it takes their wave-off of the line that follows a drift. The tools are `./focusToolSchemas.ts`; the
 * line is the server's own sentence (`site/lib/talkPlanWords.ts` `driftSpeech`), so neither prompt ever writes it.
 *
 * The owner may wave a nudge off, but being notified of a drift is still useful.
 */

/** The voice's paragraph: hand a stated plan and a wave-off to the thinking model, and never nag. */
export const FOCUS_VOICE_LINES: readonly string[] = [
  "When the owner says what they will do for a stretch ('ISO first', 'next hour is the access review'), hand it",
  "to the thinking model, which holds it so you are told of a drift. You may say, once, that you will nudge the",
  "owner on a drift. A nudge is one fixed line you say for the page: never repeat it, never add to it, never argue it.",
  "If the owner waves it off ('shut up', 'I know', 'I'll do what I want'), hand that to the thinking model at once and",
  "answer with a word or two. 'Stop watching' or a new plan goes the same way.",
];

/** The thinking model's bullets: when each focus tool fires. */
export const FOCUS_BACKEND_LINES: readonly string[] = [
  "- The owner's stated plan ('I'll do X first', 'next hour is Y'): focus_set with a few-word plan in their terms",
  "  and the apps and title keywords that mean it is under way, only when THEIR words commit to it. Never a browser",
  "  as an app. A new plan replaces the old one; 'done with that' or 'stop watching' is focus_end.",
  "- A drift nudge the owner waves off ('shut up', 'I know', 'I'll do what I want'): focus_quiet at once, then a word",
  "  or two. Never argue for the plan, and never raise it again yourself: the page decides when to nudge.",
];
