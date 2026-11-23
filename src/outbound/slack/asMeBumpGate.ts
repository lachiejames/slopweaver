/**
 * The bump gate — a chase names the person, or the door refuses it.
 *
 * The rule: bumping a PR to someone in Slack also tags them, because a tagged person is more likely to see it.
 * Without the tag, a chase that names the person in prose only carries no `<@U…>` mention and lands in
 * nobody's activity feed — a human has to notice and add the mention by hand. Per rule 7 ("no walls of text… shape
 * is enforced by the SCHEMA, never by review"), the fix is a gate on the as-me door, not a habit to
 * remember.
 *
 * Deliberately operates on the FINAL RENDERED `payload.text`, not the artifact's structural runs. That is
 * what makes it uniform across both as-me shapes: a `form` message's mentions are already substituted to
 * `<@U…>` by the time this runs (`renderDrip`), and the `--body` escape hatch's raw bytes carry a `<@U…>`
 * verbatim if the operator typed one themselves. Testing the rendered text catches both without the gate
 * having to know which lane produced it.
 *
 * **What this gate cannot see, and what covers it.** A `<@U…>` token is SYNTAX. An id nobody holds matches
 * {@link MENTION_TOKEN} exactly as a real one does, so a chase carrying a fabricated id passes here and
 * still lands in nobody's activity feed — the identical outcome this gate was written to stop. Deciding
 * whether an id names anybody needs the roster, which is not a thing a pure text gate holds, so it is
 * settled upstream: `../../cli/commands/slack/dripMentions.ts`'s `resolveDripMentions` resolves every raw
 * `<@U…>` in a `--body` through the same mention index the typed lane uses and refuses an id nothing
 * knows. This gate stays a text gate, and neither check is sufficient alone.
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchRefusalLines } from "../../hatch/render.js";

/**
 * Chase phrasing this repo has actually seen or the owner named: "bump"/"bumping", "nudge", "reminder",
 * "pls review"/"please review", "still waiting", and a direct review request. Deliberately a fixed list,
 * not a fuzzy classifier — a false negative here just means an untagged chase slips through unflagged
 * (the status quo), while a false positive only costs an operator one refusal on a message that was never
 * a chase, which is cheap to override by adding a mention.
 */
const CHASE_PATTERNS: readonly RegExp[] = [
  /\bbump(?:ing|ed)?\b/i,
  /\bnudg(?:e|ing|ed)\b/i,
  /\breminder\b/i,
  /\bpls\s+review\b/i,
  /\bplease\s+review\b/i,
  /\bstill\s+waiting\b/i,
  /\breview\s+request\b/i,
  /\brequesting\s+(?:a\s+)?review\b/i,
];

/** A resolved Slack mention token as it appears in rendered text — `<@U…>`, never a display name. */
const MENTION_TOKEN = /<@[A-Z][A-Z0-9]+>/;

/**
 * Whether a message's rendered text reads as a chase — the classifier this gate is built on. Pure.
 *
 * @param text the rendered message text (a card's, or an as-me payload's)
 * @returns true when the text matches any recognised chase phrasing
 */
export function isBumpShaped({ text }: { text: string }): boolean {
  return CHASE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Whether rendered text already carries a resolved Slack mention. Pure.
 *
 * @param text the rendered message text
 * @returns true when at least one `<@U…>` token is present
 */
export function hasResolvedMention({ text }: { text: string }): boolean {
  return MENTION_TOKEN.test(text);
}

/** Leading capitalised words that are chase vocabulary or common sentence-openers, never a person's name. */
const LEADING_WORD_STOPLIST = new Set([
  "bump",
  "bumping",
  "bumped",
  "nudge",
  "nudging",
  "nudged",
  "reminder",
  "please",
  "pls",
  "just",
  "still",
  "hey",
  "hi",
  "hello",
  "any",
  "this",
]);

/**
 * A best-effort guess at who a chase names in prose, for the refusal message only — never for addressing.
 * Identity resolution stays exact-match-only (the confirmed roster / mention index); this never resolves a
 * Slack id, it only makes the refusal legible by echoing the name back. Pure.
 *
 * @param text the rendered message text
 * @returns the guessed name, or undefined when nothing plausible is found
 */
function chasedNameHint({ text }: { text: string }): string | undefined {
  const trimmed = text.trimStart();
  const greetingName = /^(?:hey|hi|hello)[,]?\s+([A-Z][A-Za-z'-]{1,30})\b/i.exec(trimmed)?.[1];
  if (greetingName !== undefined) {
    return greetingName;
  }
  const leadingName = /^([A-Z][A-Za-z'-]{1,30})\s*[,–-]/.exec(trimmed)?.[1];
  if (leadingName !== undefined && !LEADING_WORD_STOPLIST.has(leadingName.toLowerCase())) {
    return leadingName;
  }
  return undefined;
}

/**
 * The bump gate's verdict: refuse a chase-shaped message with no resolved mention. Pure.
 *
 * @param text the rendered message text a caller is about to send
 * @param allowUntagged whether the `untagged-bump` hatch is open for this invocation
 * @returns the refusal in the house four-line shape, naming the person it thinks is being chased when it
 *   can tell, or empty when the text is not a chase, already carries a real mention, or the hatch is open
 */
export function bumpRefusalFor({
  text,
  allowUntagged = false,
}: {
  text: string;
  allowUntagged?: boolean;
}): readonly string[] {
  if (allowUntagged || !isBumpShaped({ text }) || hasResolvedMention({ text })) {
    return [];
  }
  // The hatch's own `caught` clause carries the rule; this detail carries only what THIS message showed,
  // which is who it reads as chasing. Repeating the rule here would print it twice in one refusal.
  const hint = chasedNameHint({ text });
  const hatch = hatchFor({ id: "untagged-bump" });
  if (hint === undefined) {
    return hatchRefusalLines({ hatch });
  }
  return hatchRefusalLines({ detail: `it reads as chasing ${hint}`, hatch });
}
