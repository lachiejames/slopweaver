/**
 * The FORM a golden proposal is filled into — schema-enforced STRUCTURE, never content.
 *
 * ## What the schema refuses, and why each refusal is structural
 *
 * The five sections are FIELDS. A proposal that reorders them, drops one, or invents a sixth is
 * unrepresentable rather than caught by a check, which is the difference between a shape that holds and a
 * shape that is merely documented. What is left for the schema to refuse is markdown that would escape the
 * field holding it:
 *
 *  - a `##` heading marker in any prose field, which could only ever break out of its own section;
 *  - a `|` in a table cell, which would silently split the cell into two and shift every column after it;
 *  - a `<details>` or `</details>` line, which would close a toggle the renderer opened.
 *
 * ## What it deliberately does NOT refuse
 *
 * Anything about the WORDS. No banned terms, no em-dash rule, no AU-English check. Slopweaver supplies the
 * shape; the session filling this form supplies the content, and `proposal lint` is where prose is judged —
 * separately, against the operator's PRIVATE rule list rather than a public constant. `../artifact/schema.ts`
 * records the scar behind that split.
 *
 * The one length rule is {@link TLDR_MAX_WORDS}, and it is rule 7 rather than taste: the TL;DR is the part
 * that appears above the fold, and an unexpanded wall is a message that does not get read.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";
import type { ProposalForm } from "./types.js";

/**
 * How many words the TL;DR may carry.
 *
 * The TL;DR is the whole above-the-fold surface of a proposal, so this is rule 7's "concise by default, with
 * everything else collapsed" expressed as a number. Measured against the owner's own published proposals
 * rather than chosen: the shortest TL;DR runs to 61 words and the longest to 118, so 150 admits every real
 * one the owner has written while still refusing a section that has quietly become the document.
 */
export const TLDR_MAX_WORDS = 150;

/**
 * How many words the Slack teaser may carry.
 *
 * The owner's number, about the owner's own worked example: that post was too verbose, and about 100 words
 * in Slack would be better.
 */
export const TEASER_MAX_WORDS = 100;

/** How many rows the evidence and scope tables may each carry, so a table stays a table rather than a dump. */
const TABLE_MAX_ROWS = 12;

/** Counts user-perceived characters, so a multi-code-point emoji is one thing rather than several. */
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/** A markdown link, so its URL is not counted as prose when a word cap is applied. */
const MARKDOWN_LINK = /\[(?:[^\]\\]|\\.)*\]\((?:[^()]|\([^()]*\))*\)/g;

/**
 * Count the words a section renders, ignoring link URLs.
 *
 * A link's visible LABEL is words a reader reads, so it counts; its URL is not, so it does not. Counting the
 * URL would make a well-cited paragraph fail a cap a sloppier one passes, which inverts the rule.
 *
 * @param text the section's prose
 * @returns how many words a reader sees
 */
export function countWords({ text }: { text: string }): number {
  const visible = text.replaceAll(MARKDOWN_LINK, (link) => link.slice(1, link.indexOf("](")));
  // The whitespace-separated runs, counted: the empty pieces a leading or trailing gap splits off are not words.
  return visible.split(/\s+/).filter((word) => word.length > 0).length;
}

/** A prose field that cannot escape the section holding it. */
function prose({ label }: { label: string }): z.ZodString {
  return z
    .string()
    .min(1, `${label} cannot be empty`)
    .refine((text) => !/^\s*#{1,6}\s/m.test(text), `${label} cannot contain a heading; the sections are fields`)
    .refine(
      (text) => !/^\s*<\/?details\b/im.test(text),
      `${label} cannot open or close a <details> toggle; the renderer owns those`,
    );
}

/** A table cell, which additionally cannot contain the pipe that separates cells. */
function cell({ label }: { label: string }): z.ZodString {
  return prose({ label }).refine(
    (text) => !text.includes("|"),
    `${label} cannot contain "|"; it would split the cell and shift every column after it`,
  );
}

/** A citation's URL. Always http(s): a source a reader cannot open is not a citation. */
const httpUrl = z
  .string()
  .refine(
    (value) => /^https?:\/\//i.test(value),
    "must be an http(s) URL; a citation has to be openable by the reader",
  );

/**
 * A hero image's source: an http(s) URL, or a `file:` path slopweaver uploads when the page is published.
 *
 * The `file:` spelling is the upload opt-in owned by `../notion/mediaPlaceholder.ts`, and it is the reason
 * this field cannot simply reuse {@link httpUrl}. A citation must be openable by the reader, so it stays
 * http(s); a hero is an IMAGE, and the commonest hero — a cropped screenshot of the thing being proved —
 * has no public URL and never will. Before `file:` existed there was nowhere to put one, so a proposal
 * carrying figures could not satisfy the hero rule at all without hosting the shot somewhere else first.
 *
 * The path may contain neither whitespace nor `)`. That is not tidiness: `mediaPlaceholder.ts` recognises a
 * placeholder with a line-anchored `\(file:([^)\s]+)\)` pattern, so a path carrying either would not match,
 * would never be rewritten into a marker, and would reach Notion as a bare local path. Notion ACCEPTS that
 * and silently builds a BROKEN external-image block from it, which is a publish that reports success and
 * produces a page with a dead image on it. Refusing here makes that unrepresentable rather than merely
 * unlikely.
 */
const heroImageUrl = z
  .string()
  .refine(
    (value) => /^https?:\/\//i.test(value) || /^file:[^)\s]+$/.test(value),
    "must be an http(s) URL, or a `file:` path such as `file:./shots/hero.png` for slopweaver to upload " +
      "when it publishes. A `file:` path takes no whitespace and no `)`",
  );

const evidenceRowSchema = strictForm({
  point: cell({ label: "an evidence row's point" }),
  shows: cell({ label: "an evidence row's finding" }),
  sourceText: cell({ label: "an evidence row's source text" }),
  sourceUrl: httpUrl,
});

const heroSchema = strictForm({
  caption: prose({ label: "the hero caption" }),
  sourceText: prose({ label: "the hero source text" }),
  sourceUrl: httpUrl,
  url: heroImageUrl,
});

const optionSchema = strictForm({
  cons: cell({ label: "an option's cons" }),
  option: cell({ label: "an option" }),
  pros: cell({ label: "an option's pros" }),
  recommended: z.boolean(),
});

const diagramSchema = strictForm({
  code: z.string().min(1, "a diagram cannot be empty"),
  language: z
    .string()
    .min(1)
    .refine((value) => !value.includes("`"), "a fence language cannot contain a backtick"),
});

const scopeRowSchema = strictForm({
  notYet: cell({ label: "a scope row's out-of-scope entry" }),
  solves: cell({ label: "a scope row's in-scope entry" }),
  whatItWouldTake: cell({ label: "a scope row's cost-to-cover entry" }),
});

const questionSchema = strictForm({
  key: prose({ label: "a question's key" }).refine(
    (value) => !value.includes("*"),
    "a question key is rendered in bold, so it cannot contain '*'",
  ),
  question: prose({ label: "a question" }),
});

/**
 * The whole golden-proposal form.
 *
 * `optionsConsidered` may be empty: a proposal whose fix had no real alternative should say so by carrying
 * none, rather than by inventing two straw options to fill a table. When it is non-empty, EXACTLY ONE option
 * must be the recommendation — zero leaves the reader guessing what is being asked for, and two is not a
 * recommendation.
 */
export const proposalFormSchema = strictForm({
  appendix: prose({ label: "the appendix" }).optional(),
  data: strictForm({
    hero: heroSchema.optional(),
    intro: prose({ label: "the evidence intro" }).optional(),
    rows: z
      .array(evidenceRowSchema)
      .min(1, "the evidence table needs at least one row; a proposal without linked evidence is an opinion")
      .max(TABLE_MAX_ROWS, `the evidence table takes at most ${String(TABLE_MAX_ROWS)} rows`),
  }),
  emoji: z
    .string()
    .min(1, "the page needs an emoji icon")
    // Segmented into GRAPHEMES rather than spread into code points. A single emoji is routinely several code
    // points (a skin tone, a zero-width joiner, a variation selector), so spreading counts one emoji as five
    // and refuses it.
    .refine((value) => [...GRAPHEMES.segment(value)].length <= 2, "the icon is one emoji, not a phrase"),
  fix: strictForm({
    body: prose({ label: "the fix" }),
    diagram: diagramSchema.optional(),
    optionsConsidered: z
      .array(optionSchema)
      .max(TABLE_MAX_ROWS, `at most ${String(TABLE_MAX_ROWS)} options`)
      .refine(
        (options) => options.length === 0 || options.filter((option) => option.recommended).length === 1,
        "exactly one option must be marked recommended; zero leaves the ask unstated and two is not a recommendation",
      ),
  }),
  questions: strictForm({
    addressedTo: prose({ label: "the stakeholder the questions are addressed to" }),
    items: z.array(questionSchema).min(1, "a proposal carries at least one open question for its stakeholder"),
  }),
  scope: strictForm({
    rows: z
      .array(scopeRowSchema)
      .min(1, "the scope table needs at least one row; scope honesty is not optional")
      .max(TABLE_MAX_ROWS, `the scope table takes at most ${String(TABLE_MAX_ROWS)} rows`),
    weakestPart: prose({ label: "the weakest part of the argument" }),
  }),
  slackTeaser: prose({ label: "the Slack teaser" }).refine(
    (text) => countWords({ text }) <= TEASER_MAX_WORDS,
    `the Slack teaser is at most ${String(TEASER_MAX_WORDS)} words; the doc is the long version`,
  ),
  title: prose({ label: "the title" }).refine(
    (value) => !value.includes("\n"),
    "the title is one line; it becomes a Notion page property",
  ),
  tldr: prose({ label: "the TL;DR" }).refine(
    (text) => countWords({ text }) <= TLDR_MAX_WORDS,
    `the TL;DR is at most ${String(TLDR_MAX_WORDS)} words; it is the whole above-the-fold surface`,
  ),
}) satisfies z.ZodType<ProposalForm>;
