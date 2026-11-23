/*
 * What the react-now card checker's test files share: the checker bound to a fixed instant with the voice and
 * framing passes on, the renderer's own age line, one well-shaped card with every field overridable, and the two
 * page shapes a card sits in. Every helper builds a string or calls the pure checker; nothing here touches disk.
 * It moved here when `reactNowCard.test.ts` was split by behaviour.
 */
import { checkReactNowCards, type ReactNowCheck } from "../../../../briefing/reactNowCard.js";

/** The checker with the voice pass on and no private operator rules, so a test names only what it breaks. */
export const NOW_ISO = "2026-09-12T00:00:00Z";

/**
 * The checker over one page, with the voice and framing passes on, at the fixed instant and no operator rules.
 *
 * @returns the checker's report on that page: cards checked, defects and parse problems
 */
export function check({ html }: { html: string }): ReactNowCheck {
  return checkReactNowCards({ applyFraming: true, applyVoice: true, html, nowIso: NOW_ISO, rules: [] });
}

/** The renderer's own age line, which every card carries. */
export const AGE_LINE =
  '<div class="age" data-premise-kind="composed" data-premise-iso="2026-09-11T21:18:59Z">premise 2 hours old</div>';

/**
 * One well-shaped react-now card's HTML, with every field overridable so a test names only what it breaks.
 *
 * @returns the card's `div.need` fragment, its question, age line and five-field grid
 */
export function card({
  question = "1. Ship the thing: are you happy with the draft?",
  what = "The draft PR adds a template and a doc. It also adds an advisory CI check that only reports.",
  whyYou = "It is a post to the team under your name.",
  options = "A: send it as written. B: send it with edits (say what).",
  lean = "A, on Monday morning.",
  ifSilent = "the draft stays unsent.",
}: {
  question?: string;
  what?: string;
  whyYou?: string;
  options?: string;
  lean?: string;
  ifSilent?: string;
} = {}): string {
  return (
    `<div class="need"><div class="q">${question}</div>${AGE_LINE}` +
    `<dl class="f"><dt>what</dt><dd>${what}</dd>` +
    `<dt>why you</dt><dd>${whyYou}</dd>` +
    `<dt>options</dt><dd>${options}</dd>` +
    `<dt>lean</dt><dd>${lean}</dd>` +
    `<dt>if silent</dt><dd>${ifSilent}</dd></dl></div>`
  );
}

/**
 * Wraps one or more card fragments in the react-now heading + a following heading, as the real artifact does.
 *
 * @returns the page's HTML, the cards between the react-now heading and the done heading
 */
export function artifact({ cards }: { cards: readonly string[] }): string {
  return `<h1>Fleet Briefing</h1><h2>react now</h2>${cards.join("")}<h2>done since you last looked</h2><div>ignored</div>`;
}

/**
 * The same page with a me-facing grouping under the team-facing cards, as the renderer lays one out.
 *
 * @returns the page's HTML, the team-facing cards under their heading and then the me-facing ones
 */
export function groupedArtifact({ team, mine }: { team: readonly string[]; mine: readonly string[] }): string {
  return (
    `<h1>Fleet Briefing</h1><h2>react now</h2>` +
    `<h3 id="react-now-team">team-facing</h3>${team.join("")}` +
    `<h3 id="react-now-me">yours</h3>${mine.join("")}` +
    `<h2>done since you last looked</h2><div>ignored</div>`
  );
}
