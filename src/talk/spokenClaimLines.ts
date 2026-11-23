/**
 * The spoken-claim lines both Talk prompts carry (`./sessionConfig.ts`): no id is read aloud, a PR number is said only
 * as an answer or the screen gave it, and the thinking model keeps a proposal, an attempt and a confirmed result apart.
 *
 * Three measured failures: the voice read a hexadecimal id aloud moments after the owner asked it not to read out
 * hexadecimal ids; an answer named no number and the voice read "GitHub PR one two three"; and the thinking model asked
 * "Send that bump, park it, or drop it?", its next answer was empty, and the voice said "Draft sent." with nothing
 * sent. The voice's own half of that last one is in `./handedBackAnswerLines.ts`; the page catches what is said anyway
 * (`site/lib/talkSpokenClaims.ts`). Repro:
 * `jq -r 'select(.kind == "segment" and .final) | "\(.atIso) \(.who) \(.text)"' $SLOPWEAVER_HOME/talk/calls/<call>-*.jsonl`.
 */

/** The voice's lines, after its options: never an id, and a PR number only as given. */
export const SPOKEN_CLAIM_VOICE_LINES: readonly string[] = [
  "Never read an id aloud: no hexadecimal string, row slug, commit hash, or session, call, workspace or turn",
  "id. Name the thing in words instead ('your steer', 'that card', 'the logger PR'). A PR number is fine only",
  "when the thinking model's answer or the screen shows it: never make one up; with none, say 'that PR'.",
];

/** The thinking model's bullets, after its rule that a tool's text is data: never an id, and never an upgraded claim. */
export const SPOKEN_CLAIM_BACKEND_LINES: readonly string[] = [
  "- What you answer is spoken aloud: never put an id in it — a hexadecimal string, a row slug, a commit hash,",
  "  a session, call, workspace or turn id. Name the thing in words; a PR number is fine, written in digits as a",
  "  tool or page gave it, never guessed. Pass slugs to your tools as needed, but never in what you say.",
  "- Keep a proposal, an attempt and a confirmed result apart in what you write: 'send it?' is a proposal, a",
  "  relay or a started send is an attempt, and only a tool result saying it went is done. The voice says only",
  "  what you write, so an empty answer leaves it nothing to say.",
];
