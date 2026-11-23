/**
 * The golden proposal's ONE renderer: a validated form in, the markdown that gets published out.
 *
 * Pure code, deterministically, exactly like the PR-description and Slack-card renderers. No model runs
 * here; the session composes the FORM and this file decides what the document looks like, which is what
 * makes the house shape a property of the schema rather than a thing a reviewer chases.
 *
 * ## One render path, and why that matters more than it looks
 *
 * These bytes are what `proposal lint` reads, what `--dry-run` prints, and what `notion page` sends. A
 * second renderer aimed at Notion blocks would mean the reviewed artefact and the wire artefact came from
 * sibling code paths, and "the dry run shows what would be sent" would quietly stop being true. Notion's own
 * enhanced-Markdown endpoint converts these bytes, so there is only ever one.
 *
 * ## The title is NOT in the body
 *
 * A Notion page title is a property, so an H1 here would render as a second heading under the real one. The
 * emoji is the page icon for the same reason. `proposalTitle` and `proposalEmoji` hand them to the publish
 * verb separately.
 */
import type { ConsideredOption, EvidenceRow, ProposalForm, ScopeRow } from "./types.js";

/**
 * The strawman blockquote, verbatim.
 *
 * A literal rather than a form field, because it is the one line whose exact wording is the convention: it
 * tells a reader this is a discussion-opener, that the short version is in Slack, and that the doc is the
 * deeper layer for agents rather than required reading. A proposal that reworded it would read as a
 * different kind of document.
 */
export const STRAWMAN =
  "> *Rough, still iterating. The short version is in Slack; this doc is the deeper verifiable layer for " +
  "agents, not required reading. Putting it up to get it shot at, so tell me where I have it wrong.*";

/** The real Notion table-of-contents block, which the enhanced-Markdown endpoint recognises verbatim. */
export const TOC = '<table_of_contents color="gray"/>';

/** One markdown table, header row included. */
function table({ headers, rows }: { headers: readonly string[]; rows: readonly (readonly string[])[] }): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

/** A `<details>` toggle, with its content separated by blank lines so Notion reads the inner markdown. */
function toggle({ summary, body }: { summary: string; body: string }): string {
  return ["<details>", `<summary>${summary}</summary>`, "", body, "", "</details>"].join("\n");
}

/** The hero shot, its italic caption, and the frozen-source link beneath it. */
function heroBlock({ form }: { form: ProposalForm }): readonly string[] {
  const { hero } = form.data;
  if (hero === undefined) {
    return [];
  }
  return [`![${hero.caption}](${hero.url})`, "", `*Above: ${hero.caption}*`, `[${hero.sourceText}](${hero.sourceUrl})`];
}

/** The linked evidence table. Every row names a real thing and links it, so a reader clicks through in one hop. */
function evidenceTable({ rows }: { rows: readonly EvidenceRow[] }): string {
  return table({
    headers: ["Data point", "What it shows", "Source"],
    rows: rows.map((row) => [row.point, row.shows, `[${row.sourceText}](${row.sourceUrl})`]),
  });
}

/** The options table, with the recommendation marked in place rather than in a separate column. */
function optionsTable({ options }: { options: readonly ConsideredOption[] }): string {
  return table({
    headers: ["#", "Option", "Pros", "Cons"],
    rows: options.map((option, index) => [
      String(index + 1),
      option.recommended ? `${option.option} (recommended)` : option.option,
      option.pros,
      option.cons,
    ]),
  });
}

/** The scope table: what this solves, what it does not, and what covering the rest would cost. */
function scopeTable({ rows }: { rows: readonly ScopeRow[] }): string {
  return table({
    headers: ["Solves", "Doesn't yet", "What it'd take to cover"],
    rows: rows.map((row) => [row.solves, row.notYet, row.whatItWouldTake]),
  });
}

/** "What the data shows": the hero, the optional intro, and the linked evidence table. */
function dataSection({ form }: { form: ProposalForm }): readonly string[] {
  return [
    "## What the data shows",
    "",
    ...heroBlock({ form }),
    ...(form.data.hero === undefined ? [] : [""]),
    ...(form.data.intro === undefined ? [] : [form.data.intro, ""]),
    evidenceTable({ rows: form.data.rows }),
    "",
  ];
}

/** "The fix": the plain-terms body, an optional diagram, and the options folded into a toggle. */
function fixSection({ form }: { form: ProposalForm }): readonly string[] {
  const { diagram, optionsConsidered } = form.fix;
  return [
    "## The fix",
    "",
    form.fix.body,
    "",
    ...(diagram === undefined ? [] : ["```" + diagram.language, diagram.code, "```", ""]),
    ...(optionsConsidered.length === 0
      ? []
      : [toggle({ body: optionsTable({ options: optionsConsidered }), summary: "Options considered" }), ""]),
  ];
}

/** "Open questions": addressed to a named stakeholder, one bullet each. */
function questionsSection({ form }: { form: ProposalForm }): readonly string[] {
  return [
    "## Open questions",
    "",
    `For ${form.questions.addressedTo}:`,
    "",
    ...form.questions.items.map((item) => `- **${item.key}**: ${item.question}`),
    "",
  ];
}

/**
 * Render a validated form into the golden proposal markdown.
 *
 * @param form the validated form
 * @returns the document body, without its title or emoji — both are Notion page properties
 */
export function renderProposal({ form }: { form: ProposalForm }): string {
  const lines: readonly string[] = [
    STRAWMAN,
    "",
    TOC,
    "",
    "## TL;DR",
    "",
    form.tldr,
    "",
    ...dataSection({ form }),
    ...fixSection({ form }),
    "## Scope and trade-offs",
    "",
    scopeTable({ rows: form.scope.rows }),
    "",
    `Weakest part of the argument, named before you find it: ${form.scope.weakestPart}`,
    "",
    ...questionsSection({ form }),
    ...(form.appendix === undefined
      ? []
      : [toggle({ body: form.appendix, summary: "Appendix, verifiable detail for agents" }), ""]),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * The page title, which is a Notion property rather than a body heading.
 *
 * @param form the validated form
 * @returns the title text
 */
export function proposalTitle({ form }: { form: ProposalForm }): string {
  return form.title;
}

/**
 * The page icon, which is a Notion property rather than a character in the title.
 *
 * @param form the validated form
 * @returns the emoji
 */
export function proposalEmoji({ form }: { form: ProposalForm }): string {
  return form.emoji;
}
