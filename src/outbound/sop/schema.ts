/**
 * The FORM an SOP is filled into — schema-enforced STRUCTURE, never content.
 *
 * ## What the schema refuses, and why each refusal is structural
 *
 * The twelve sections are FIELDS (`./types.ts` records where they came from), so section order and presence
 * are properties of the type. What is left for the schema to refuse is everything that would let a page
 * LOOK like a procedure while failing the reader:
 *
 *  - **an unfilled placeholder anywhere.** The class: a triage reaches the SOP section it needs and
 *    finds a placeholder, so the request cannot be checked against it. The page exists, is found, is
 *    read, and cannot answer the one question asked of it. {@link PLACEHOLDER} makes that unpublishable.
 *  - **a step with no actor.** `SopStep.who` is required, because "who does this" is the question that sends
 *    a request round three teams before anyone starts.
 *  - **an empty `doesNotCover`.** The thread this form was built from asked whether a rule covered external
 *    contractors; the SOP it was looking for could not have answered without saying what it excludes.
 *  - **markdown that escapes its own field** — a `##` heading in prose, a `|` in a table cell, a `<details>`
 *    line — exactly as the proposal form refuses them, and for the same reason.
 *
 * ## What it deliberately does NOT refuse
 *
 * Anything about the WORDS. The operator's private voice rules gate the page LEAD once, inside
 * `notion page` (`../notion/aboveFold.ts`), which every publish already goes through; restating them here
 * would be a second copy of a private list in public source. And nothing here judges whether the procedure
 * is CORRECT — that is what the named owner is for, and why the rendered page says so above the fold.
 *
 * The word caps are rule 7 expressed as numbers, each measured against the org's own SOPs rather than chosen.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";
import type { SopForm } from "./types.js";

/**
 * How many words the Purpose may carry.
 *
 * MEASURED over the ten SOPs in the local corpus carrying an explicit `Purpose` section: the shortest runs
 * to 16 words and the longest to 42. Reproduce with
 * `grep -h '"title":"SOP' $SLOPWEAVER_HOME/corpus/bronze/notion/*.jsonl`, splitting each page's text at its
 * `Purpose` heading. 80 admits every real one with headroom while still refusing a Purpose that has quietly
 * become the document.
 */
export const PURPOSE_MAX_WORDS = 80;

/**
 * How many words the trigger — "When this applies" — may carry.
 *
 * MEASURED over the seventeen SOPs in the same corpus carrying a `When this applies` / `When to use this` /
 * `Scope` section: 2 words at the shortest, 60 at the longest. 100 admits every real one and refuses a
 * trigger that has turned into the procedure.
 *
 * @internal
 */
export const TRIGGER_MAX_WORDS = 100;

/**
 * How many steps one procedure may carry.
 *
 * MEASURED over the same 52 pages, counting top-level numbered lines: the longest real PROCEDURE runs to 17
 * steps. The single page above that — 42 — is the SOP index, a directory of links rather than a procedure,
 * which is why the cap is not set from it. 30 leaves real headroom; a procedure past it is two procedures.
 */
export const STEP_MAX = 30;

/**
 * How many rows the scope, prerequisite, exception and related lists may each carry.
 *
 * @internal
 */
export const LIST_MAX_ROWS = 12;

/** Counts user-perceived characters, so a multi-code-point emoji is one thing rather than several. */
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/** A markdown link, so its URL is not counted as prose when a word cap is applied. */
const MARKDOWN_LINK = /\[(?:[^\]\\]|\\.)*\]\((?:[^()]|\([^()]*\))*\)/g;

/**
 * An unfilled placeholder.
 *
 * Four literals and a triple question mark, deliberately narrow. A wider pattern would refuse real content:
 * the Zendesk KB SOP publishes the URL template `.../members/{USER_ID}#product-roles`, so brace placeholders
 * are legitimate here and are not matched. `TBC` is included because it is how this organisation writes "to
 * be confirmed", which is the same defect wearing Australian spelling.
 */
const PLACEHOLDER = /\b(?:TODO|TBD|TBC|FIXME)\b|\?{3}/i;

/** A `YYYY-MM-DD` calendar date. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Count the words a section renders, ignoring link URLs.
 *
 * A link's visible LABEL is words a reader reads, so it counts; its URL is not, so it does not. Counting the
 * URL would make a well-linked step fail a cap a vaguer one passes, which inverts the rule.
 *
 * @param text the section's prose
 * @returns how many words a reader sees
 */
export function countWords({ text }: { text: string }): number {
  const visible = text.replaceAll(MARKDOWN_LINK, (link) => link.slice(1, link.indexOf("](")));
  // The whitespace-separated runs, counted: the empty pieces a leading or trailing gap splits off are not words.
  return visible.split(/\s+/).filter((word) => word.length > 0).length;
}

/** A prose field that cannot escape the section holding it, and cannot ship unfilled. */
function prose({ label }: { label: string }): z.ZodString {
  return z
    .string()
    .min(1, `${label} cannot be empty`)
    .refine((text) => !/^\s*#{1,6}\s/m.test(text), `${label} cannot contain a heading; the sections are fields`)
    .refine(
      (text) => !/^\s*<\/?details\b/im.test(text),
      `${label} cannot open or close a <details> toggle; the renderer owns those`,
    )
    .refine(
      (text) => !PLACEHOLDER.test(text),
      `${label} still carries a placeholder (TODO / TBD / TBC / FIXME / ???). An SOP published with an ` +
        "unfilled section is the one a reader finds, reads, and still cannot act on",
    );
}

/** A table cell, which additionally cannot contain the pipe that separates cells. */
function cell({ label }: { label: string }): z.ZodString {
  return prose({ label }).refine(
    (text) => !text.includes("|"),
    `${label} cannot contain "|"; it would split the cell and shift every column after it`,
  );
}

/** A one-line field: a cell that additionally cannot break across lines. */
function line({ label }: { label: string }): z.ZodString {
  return cell({ label }).refine((text) => !text.includes("\n"), `${label} is one line`);
}

/** A reference's URL. Always http(s): a source a reader cannot open is not a source. */
const httpUrl = z
  .string()
  .refine(
    (value) => /^https?:\/\//i.test(value),
    "must be an http(s) URL; a reference has to be openable by the reader",
  );

const linkSchema = strictForm({
  text: cell({ label: "a link's text" }),
  url: httpUrl,
});

const ownerSchema = strictForm({
  contact: line({ label: "the owner's contact" }),
  person: line({ label: "the owner's name" }),
  role: line({ label: "the owning function" }),
});

const stepSchema = strictForm({
  action: line({ label: "a step's action" }),
  detail: prose({ label: "a step's detail" }).optional(),
  who: line({ label: "a step's actor" }),
});

const exceptionSchema = strictForm({
  situation: cell({ label: "an exception's situation" }),
  whatToDo: cell({ label: "an exception's remedy" }),
});

const escalationSchema = strictForm({
  to: prose({ label: "who an escalation goes to" }),
  when: prose({ label: "when to escalate" }),
});

const scopeSchema = strictForm({
  covers: z
    .array(cell({ label: "a scope entry" }))
    .min(1, "say what this SOP covers; at least one entry")
    .max(LIST_MAX_ROWS, `at most ${String(LIST_MAX_ROWS)} scope entries`),
  doesNotCover: z
    .array(cell({ label: "an out-of-scope entry" }))
    .min(
      1,
      "say what this SOP does NOT cover; at least one entry. A reader asking whether a rule reaches their " +
        "case cannot answer it from an SOP that only says what it includes",
    )
    .max(LIST_MAX_ROWS, `at most ${String(LIST_MAX_ROWS)} out-of-scope entries`),
});

/**
 * The whole SOP form.
 *
 * `beforeYouStart`, `exceptions` and `related` may each be empty: a procedure that genuinely needs no
 * access, has no known exception, or stands alone should say so by carrying none, rather than by inventing
 * a row to fill a section. `steps` and both halves of `scope` may not.
 */
export const sopFormSchema = strictForm({
  beforeYouStart: z
    .array(cell({ label: "a prerequisite" }))
    .max(LIST_MAX_ROWS, `at most ${String(LIST_MAX_ROWS)} prerequisites`),
  emoji: z
    .string()
    .min(1, "the page needs an emoji icon")
    // Segmented into GRAPHEMES rather than spread into code points: a single emoji is routinely several code
    // points (a skin tone, a zero-width joiner, a variation selector), so spreading counts one as five.
    .refine((value) => [...GRAPHEMES.segment(value)].length <= 2, "the icon is one emoji, not a phrase"),
  escalation: escalationSchema,
  exceptions: z.array(exceptionSchema).max(LIST_MAX_ROWS, `at most ${String(LIST_MAX_ROWS)} exceptions`),
  lastUpdated: z.string().refine((value) => ISO_DATE.test(value), "lastUpdated is a calendar date, as YYYY-MM-DD"),
  owner: ownerSchema,
  purpose: prose({ label: "the purpose" }).refine(
    (text) => countWords({ text }) <= PURPOSE_MAX_WORDS,
    `the purpose is at most ${String(PURPOSE_MAX_WORDS)} words; the procedure is below it`,
  ),
  related: z.array(linkSchema).max(LIST_MAX_ROWS, `at most ${String(LIST_MAX_ROWS)} related links`),
  reviewCadence: line({ label: "the review cadence" }),
  scope: scopeSchema,
  source: linkSchema,
  steps: z
    .array(stepSchema)
    .min(1, "a procedure needs at least one step")
    .max(STEP_MAX, `at most ${String(STEP_MAX)} steps; past that it is two procedures`),
  title: line({ label: "the title" }),
  whenThisApplies: prose({ label: "the trigger" }).refine(
    (text) => countWords({ text }) <= TRIGGER_MAX_WORDS,
    `the trigger is at most ${String(TRIGGER_MAX_WORDS)} words; it says when to be here, not what to do`,
  ),
}) satisfies z.ZodType<SopForm>;
