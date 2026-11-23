/**
 * The SOP's ONE renderer: a validated form in, the markdown that gets published out.
 *
 * Pure code, deterministically, exactly like the proposal, PR-description and Slack-card renderers. No model
 * runs here; the session composes the FORM and this file decides what the document looks like, which is what
 * makes the house shape a property of the schema rather than a thing a reviewer chases.
 *
 * ## One render path
 *
 * These bytes are what `sop lint` reads, what `--dry-run` prints, and what `notion page` sends. A second
 * renderer aimed at Notion blocks would mean the reviewed artefact and the wire artefact came from sibling
 * code paths, and "the dry run shows what would be sent" would quietly stop being true.
 *
 * ## The body opens with the table of contents, and the metadata sits under a heading
 *
 * `../notion/aboveFold.ts` treats everything before the FIRST heading as the page lead and puts it through
 * the operator's packing rules — no colon-introduced list, no semicolon-joined clauses. The org's own SOPs
 * open with `Owner: … Last updated: …`, which is a colon-introduced list by construction and would be
 * REFUSED at the door. So the metadata lives in a table under `## At a glance` instead, one fact per row,
 * where it reads better anyway and is the first thing under the contents block regardless.
 *
 * ## The title is NOT in the body
 *
 * A Notion page title is a property, so an H1 here would render as a second heading under the real one. The
 * emoji is the page icon for the same reason. `sopTitle` and `sopEmoji` hand them to the publish verb.
 */
import type { SopException, SopForm, SopLink, SopStep } from "./types.js";

/**
 * The unreviewed-draft blockquote, verbatim.
 *
 * A literal rather than a form field, because the one thing every reader of a machine-drafted procedure has
 * to know is the same sentence every time: a person has not checked it yet. It sits above the fold, in a
 * blockquote — `authoredProseOf` strips quoted lines, so it passes the door's lead gate as written.
 */
export const UNREVIEWED =
  "> *Drafted by slopweaver from the source at the foot of this page. The named owner has not reviewed it " +
  "yet, so check it against what actually happens before you rely on it.*";

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

/** The metadata table: who owns it, when it was last true, and when it is next checked. */
function atAGlance({ form }: { form: SopForm }): readonly string[] {
  return [
    "## At a glance",
    "",
    table({
      headers: ["", ""],
      rows: [
        ["**Owner**", `${form.owner.role} (${form.owner.person})`],
        ["**Contact**", form.owner.contact],
        ["**Last updated**", form.lastUpdated],
        ["**Review**", form.reviewCadence],
      ],
    }),
    "",
  ];
}

/**
 * One column's cell at a row index, or an empty cell where that column has already run out.
 *
 * An empty cell is the honest CONTENT of a row past the end of one list, not a fallback standing in for a
 * value that should have been there — which is why this is a length test rather than a coalesce.
 */
function cellAt({ items, index }: { items: readonly string[]; index: number }): string {
  return index < items.length ? items[index]! : "";
}

/** The two-column scope table: what this covers, and what it deliberately does not. */
function scopeTable({ form }: { form: SopForm }): string {
  const { covers, doesNotCover } = form.scope;
  // Rows run to the LONGER column, because a markdown table is rectangular and the two lists are not.
  const depth = Math.max(covers.length, doesNotCover.length);
  return table({
    headers: ["Covers", "Does not cover"],
    rows: Array.from({ length: depth }, (_unused, index) => [
      cellAt({ index, items: covers }),
      cellAt({ index, items: doesNotCover }),
    ]),
  });
}

/** "Before you start": the access, approvals and information a reader needs before step one. */
function beforeSection({ form }: { form: SopForm }): readonly string[] {
  if (form.beforeYouStart.length === 0) {
    return [];
  }
  return ["## Before you start", "", ...form.beforeYouStart.map((item) => `- ${item}`), ""];
}

/** One step: a numbered heading, the actor on its own line, then the detail. */
function stepBlock({ step, index }: { step: SopStep; index: number }): readonly string[] {
  return [
    `### ${String(index + 1)}. ${step.action}`,
    "",
    `**Who:** ${step.who}`,
    "",
    ...(step.detail === undefined ? [] : [step.detail, ""]),
  ];
}

/** "Steps": the procedure itself, every step naming who performs it. */
function stepsSection({ form }: { form: SopForm }): readonly string[] {
  return ["## Steps", "", ...form.steps.flatMap((step, index) => stepBlock({ index, step }))];
}

/** "Exceptions": the cases the happy path does not cover. */
function exceptionsSection({ exceptions }: { exceptions: readonly SopException[] }): readonly string[] {
  if (exceptions.length === 0) {
    return [];
  }
  return [
    "## Exceptions",
    "",
    table({
      headers: ["If", "Then"],
      rows: exceptions.map((exception) => [exception.situation, exception.whatToDo]),
    }),
    "",
  ];
}

/** "Related": neighbouring SOPs, policies and references. */
function relatedSection({ related }: { related: readonly SopLink[] }): readonly string[] {
  if (related.length === 0) {
    return [];
  }
  return ["## Related", "", ...related.map((link) => `- [${link.text}](${link.url})`), ""];
}

/**
 * Render a validated form into the SOP markdown.
 *
 * @param form the validated form
 * @returns the document body, without its title or emoji — both are Notion page properties
 */
export function renderSop({ form }: { form: SopForm }): string {
  const lines: readonly string[] = [
    UNREVIEWED,
    "",
    TOC,
    "",
    ...atAGlance({ form }),
    "## Purpose",
    "",
    form.purpose,
    "",
    "## When this applies",
    "",
    form.whenThisApplies,
    "",
    "## Scope",
    "",
    scopeTable({ form }),
    "",
    ...beforeSection({ form }),
    ...stepsSection({ form }),
    ...exceptionsSection({ exceptions: form.exceptions }),
    "## Escalation",
    "",
    `${form.escalation.when} Escalate to ${form.escalation.to}.`,
    "",
    ...relatedSection({ related: form.related }),
    "## Where this came from",
    "",
    `Distilled from [${form.source.text}](${form.source.url}). ` +
      `Owned by ${form.owner.person} (${form.owner.role}), reviewed ${form.reviewCadence}.`,
    "",
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * The page title, which is a Notion property rather than a body heading.
 *
 * @param form the validated form
 * @returns the title text
 */
export function sopTitle({ form }: { form: SopForm }): string {
  return form.title;
}

/**
 * The page icon, which is a Notion property rather than a character in the title.
 *
 * @param form the validated form
 * @returns the emoji
 */
export function sopEmoji({ form }: { form: SopForm }): string {
  return form.emoji;
}
