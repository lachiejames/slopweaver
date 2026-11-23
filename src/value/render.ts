/**
 * The weekly value sample as the owner sees it: one Queue card asking whether each drawn ask was used, and the page
 * it links to, one section per ask with what it cost and what it produced. Pure.
 *
 * The card asks one thing and leans one way: answer each ask, one word apiece. The owner answers on the Queue; a
 * session records each answer with `value answer`, and the card is withdrawn once every ask carries one
 * (`../cli/commands/value/answer.ts`). Every string the page carries is data, so every one is escaped.
 */
import { escapeHtml } from "../atlas/kit/pageTable.js";
import { type AskRowFields, askRegisterArgv } from "../handover/askRegisterArgv.js";
import type { PrOutcome, SampledAsk } from "./sample.js";
import type { ValueSample } from "./store.js";

/**
 * The card and page slug for a week: `value-sample-<week>`, lowercased.
 *
 * @param week the ISO week, `YYYY-Www`
 * @returns the slug
 */
export function valueSampleSlug({ week }: { week: string }): string {
  return `value-sample-${week.toLowerCase()}`;
}

/** "1 ask" or "3 asks". */
function asksPhrase({ count }: { count: number }): string {
  return count === 1 ? "1 ask" : `${String(count)} asks`;
}

/**
 * The week's card. Pure.
 *
 * @param sample the week's sample
 * @param day the local day it was drawn, which the still-real check names
 * @returns the card's fields
 */
export function valueSampleAsk({ day, sample }: { day: string; sample: ValueSample }): AskRowFields {
  const drawn = asksPhrase({ count: sample.asks.length });
  return {
    ask: `Did you use the ${drawn} drawn from last week? Answer each on the page: used, not used, or not yet.`,
    blastRadius: "The value-sample ledger on this machine, nothing else",
    example: `You open the Queue and see ${drawn} that ended last week, each with what it cost and what it produced. Did you use each one?`,
    lean: "answer each",
    options: [
      "answer each :: one word per ask, used, not used or not yet, which a session records with value answer",
      "skip this week :: the sample stays unanswered, and next Monday draws a new one",
    ],
    problem: `Only your answer says whether finished asks get used; these ${drawn} were drawn at random from the ${String(sample.eligible)} that ended this week.`,
    risk: "None to the fleet: an unanswered week only leaves the value measure without that week's evidence",
    slug: valueSampleSlug({ week: sample.week }),
    stillReal: `value sample drew these on ${day}`,
  };
}

/**
 * The argv `handover register` parses for the card. Pure.
 *
 * @param ask the card's fields
 * @param home the Slopweaver home the row is written under
 * @returns the full process argv
 */
export function valueSampleAskArgv({ ask, home }: { ask: AskRowFields; home: string }): readonly string[] {
  return askRegisterArgv({ ask, because: "the fleet's own value measure on this machine", home });
}

/** A whole number with thousands separators, independent of the machine's locale. */
function grouped({ value }: { value: number }): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

/** A link whose text and target are both data. */
function link({ href, text }: { href: string; text: string }): string {
  return `<a href="${escapeHtml({ value: href })}">${escapeHtml({ value: text })}</a>`;
}

/** What the ask cost, or why that is not measured. */
function costLine({ ask }: { ask: SampledAsk }): string {
  if (!ask.cost.known) {
    return `cost: not measured, ${escapeHtml({ value: ask.cost.why })}`;
  }
  const { coveredTurns, totalTurns, transcripts, units } = ask.cost.value;
  const over = transcripts === 1 ? "1 transcript" : `${String(transcripts)} transcripts`;
  return `cost: ${grouped({ value: units })} model-weighted units over ${over}, ${String(coveredTurns)} of ${String(totalTurns)} turns priced`;
}

/** How the ask ended, with its witness. */
function settlementLine({ ask }: { ask: SampledAsk }): string {
  if (ask.witness === undefined) {
    return `ended ${ask.settlement}`;
  }
  if (ask.settlement === "answered" && /^https?:\/\//u.test(ask.witness)) {
    return `ended answered, ${link({ href: ask.witness, text: "the answer" })}`;
  }
  return `ended ${ask.settlement}, as <code>${escapeHtml({ value: ask.witness })}</code>`;
}

/** How one pull request ended, in words. */
function prState({ pr }: { pr: PrOutcome }): string {
  if (pr.state === "UNREAD") {
    return "state could not be read";
  }
  return pr.state.toLowerCase();
}

/** The answer recorded for the ask, or that none is yet. */
function answerLine({ ask, sample }: { ask: SampledAsk; sample: ValueSample }): string {
  const recorded = sample.answers[ask.slug];
  if (recorded === undefined) {
    return "your answer: not yet given";
  }
  return `your answer: <strong>${escapeHtml({ value: recorded.answer })}</strong>`;
}

/** One ask's section. */
function askSection({ ask, sample }: { ask: SampledAsk; sample: ValueSample }): string {
  const lines = [
    answerLine({ ask, sample }),
    `<code>${escapeHtml({ value: ask.slug })}</code>, ${settlementLine({ ask })} at ${escapeHtml({ value: ask.settledIso })}`,
    costLine({ ask }),
    ...ask.prs.map((pr) => `${link({ href: pr.url, text: pr.url })}, ${prState({ pr })}`),
  ];
  if (ask.artifact !== undefined) {
    lines.push(`published at ${link({ href: ask.artifact, text: ask.artifact })}`);
  }
  const items = lines.map((line) => `<li>${line}</li>`).join("");
  return `<section><h2>${escapeHtml({ value: ask.summary })}</h2><ul>${items}</ul></section>`;
}

/**
 * The page fragment `page publish` wraps in its document shell. Pure.
 *
 * @param sample the week's sample
 * @returns the fragment
 */
export function valueSampleFragment({ sample }: { sample: ValueSample }): string {
  const drawn = asksPhrase({ count: sample.asks.length });
  const lede =
    `${drawn} of the ${String(sample.eligible)} that ended in the seven days before ${sample.drawnIso}, drawn at random. ` +
    "For each, say used, not used or not yet.";
  return [
    `<h1>Value sample, ${escapeHtml({ value: sample.week })}</h1>`,
    `<p class="lede">${escapeHtml({ value: lede })}</p>`,
    ...sample.asks.map((ask) => askSection({ ask, sample })),
  ].join("\n");
}
