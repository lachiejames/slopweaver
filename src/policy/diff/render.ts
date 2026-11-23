/**
 * The owner's review page for a diff record. The team's page and post, built from the same record, are `./team.ts`.
 *
 * The page reads like a good pull request: material changes first, in document order, each group
 * under the reason it was made; formatting folded away and grouped by the one convention each kind applied; marks
 * drawn as colour with the detail on hover, never a text badge; every identifier a link; and tabs, so two long
 * documents are not one long scroll.
 *
 * A hover explains the line — what it says and what the owner is asked about it — and never the page's own revision
 * record, such as "Before: … under a run-in heading". What the before side said sits in a fold under the change's
 * reason, one click the owner chooses to take.
 *
 * Pure.
 */
import { escapeText } from "../../outbound/briefing/escape.js";
import type { AnnotatedRow } from "./annotate.js";
import { type ImageSources, wordDiffHtml } from "./inline.js";
import type { DocDiffModel, DocumentDiff } from "./model.js";
import { note, pageHead, plainUnit, postHtml, prose, slotLine, tabs, unitHtml } from "./pageParts.js";
import type { DocDiffChange, DocDiffMark, FormattingKind } from "./record.js";

/** What each formatting kind is called, and the reason given for it when the record gives none. */
const FORMATTING_DEFAULTS: Readonly<Record<FormattingKind, { readonly label: string; readonly why: string }>> = {
  case: { label: "Sentence case", why: "Titles and headings follow the sentence-case naming convention." },
  code: { label: "Set as code", why: "Paths, commands and identifiers are set as code, so they read as names." },
  emphasis: { label: "Labels in bold", why: "Field labels are bold so the eye finds each one." },
  links: { label: "Made a link", why: "A reference became a link to what it names." },
  punctuation: { label: "Punctuation", why: "Punctuation only. No word changed." },
  structure: {
    label: "Split into a list",
    why: "A long sentence or paragraph laid out as a list, or a list re-nested. The words are the same.",
  },
};

/**
 * What a document tab says about its two columns: a reader of a red line with screenshots under it asks whether
 * the red goes into a document that has always been black on white, and whether the screenshots do.
 */
const PAGE_ONLY =
  "The right column is the document as Vanta will hold it, screenshots included. The colours and hover notes are only on this page.";

/** The order formatting groups appear in, and the kind a row with several is filed under. */
const FORMATTING_ORDER: readonly FormattingKind[] = ["structure", "case", "emphasis", "code", "links", "punctuation"];

/** The two sides of a row as HTML. */
function sidesHtml({ row, images }: { row: AnnotatedRow; images: ImageSources }): { before: string; after: string } {
  if (row.kind === "changed" && row.before.length === 1 && row.after.length === 1 && row.before[0]!.kind !== "image") {
    const b = row.before[0]!;
    const a = row.after[0]!;
    const diffed = wordDiffHtml({ after: a.raw, before: b.raw, images });
    return { after: unitHtml({ inner: diffed.after, unit: a }), before: unitHtml({ inner: diffed.before, unit: b }) };
  }
  return {
    after: row.after.map((unit) => plainUnit({ images, unit })).join(""),
    before: row.before.map((unit) => plainUnit({ images, unit })).join(""),
  };
}

/** The lines of a hover note for a mark. */
function markLines({ marks, images }: { marks: readonly DocDiffMark[]; images: ImageSources }): readonly string[] {
  return marks.map(
    (mark) =>
      `<span class="k tone-${mark.tone}"><b>${escapeText({ text: mark.label })}</b>${prose({ images, text: mark.note })}</span>`,
  );
}

/** The reason a formatting row's note gives. */
function formattingWhy({ kind, model }: { kind: FormattingKind; model: DocDiffModel }): string {
  const own = model.record.formatting[kind];
  if (own === undefined) {
    return FORMATTING_DEFAULTS[kind].why;
  }
  return own;
}

/** The hover lines a row carries: what the line says, then every mark on it. Never what it replaced. */
function rowNoteLines({ row, model }: { row: AnnotatedRow; model: DocDiffModel }): readonly string[] {
  const images = model.images;
  const lines: string[] = [];
  if (row.change !== null) {
    lines.push(`<span class="k">${prose({ images, text: row.change.why })}</span>`);
  }
  if (row.kind === "formatting") {
    const kind = primaryKind({ row });
    lines.push(`<span class="k">${escapeText({ text: formattingWhy({ kind, model }) })}</span>`);
  }
  return [...lines, ...markLines({ images, marks: row.marks })];
}

/** What the before side said, folded under a change's reason. */
function wasFold({ change, diff, model }: { change: DocDiffChange; diff: DocumentDiff; model: DocDiffModel }): string {
  const since = escapeText({ text: diff.document.before.label });
  return `<details class="was"><summary>What changed since ${since}</summary>${prose({ images: model.images, text: change.was })}</details>`;
}

/** The class list of one cell. */
function cellClass({
  row,
  side,
  hostsNote,
}: {
  row: AnnotatedRow;
  side: "after" | "before";
  hostsNote: boolean;
}): string {
  const classes = ["cell", side];
  if (row[side].length === 0) {
    classes.push("empty");
  } else if (row.kind === "changed" || row.kind === "added" || row.kind === "removed") {
    classes.push(row.kind);
  }
  if (hostsNote) {
    classes.push("has-note");
    const tone = row.marks.at(-1);
    if (tone !== undefined) {
      classes.push(`tone-${tone.tone}`);
    }
  }
  return classes.join(" ");
}

/** One row as two grid cells; the after side hosts the hover note, or the before side when nothing is after. */
function rowCells({ row, model }: { row: AnnotatedRow; model: DocDiffModel }): string {
  const sides = sidesHtml({ images: model.images, row });
  const lines = rowNoteLines({ model, row });
  const host: "after" | "before" = row.after.length === 0 ? "before" : "after";
  const cell = ({ side }: { side: "after" | "before" }): string => {
    const hostsNote = side === host && lines.length > 0;
    const focus = hostsNote ? ' tabindex="0"' : "";
    const body = hostsNote ? `${sides[side]}${note({ lines })}` : sides[side];
    return `<div class="${cellClass({ hostsNote, row, side })}"${focus}>${body}</div>`;
  };
  return `${cell({ side: "before" })}${cell({ side: "after" })}`;
}

/** A grid's two column heads. */
function colheads({ diff }: { diff: DocumentDiff }): string {
  return (
    `<div class="colhead">Before · ${escapeText({ text: diff.document.before.label })}</div>` +
    `<div class="colhead">After · ${escapeText({ text: diff.document.after.label })}</div>`
  );
}

/** The kind a formatting row is filed under. */
function primaryKind({ row }: { row: AnnotatedRow }): FormattingKind {
  const kind = FORMATTING_ORDER.find((candidate) => row.formatting.includes(candidate));
  if (kind === undefined) {
    return "punctuation";
  }
  return kind;
}

/** The material rows in document order, each run of one change under a header saying why. */
function materialGrid({ diff, model }: { diff: DocumentDiff; model: DocDiffModel }): string {
  const rows = diff.rows.filter((row) => row.change !== null);
  if (rows.length === 0) {
    return `<p class="meta">No material change: every difference is formatting.</p>`;
  }
  let previous: string | null = null;
  const body = rows
    .map((row) => {
      const change = row.change!;
      let header = "";
      if (change.id !== previous) {
        const crumb = row.section === "" ? "" : `<span class="crumb">${escapeText({ text: row.section })}</span>`;
        header = `<div class="why">${crumb}${prose({ images: model.images, text: change.why })}${wasFold({ change, diff, model })}</div>`;
      }
      previous = change.id;
      return `${header}${rowCells({ model, row })}`;
    })
    .join("\n");
  return `<div class="grid">${colheads({ diff })}\n${body}\n</div>`;
}

/** The formatting rows, folded, grouped by the convention each applied. */
function formattingFold({ diff, model }: { diff: DocumentDiff; model: DocDiffModel }): string {
  const rows = diff.rows.filter((row) => row.kind === "formatting");
  if (rows.length === 0) {
    return "";
  }
  const groups = FORMATTING_ORDER.map((kind) => ({ kind, rows: rows.filter((row) => primaryKind({ row }) === kind) }))
    .filter((group) => group.rows.length > 0)
    .map((group) => {
      const label = FORMATTING_DEFAULTS[group.kind].label;
      const why = formattingWhy({ kind: group.kind, model });
      const cells = group.rows.map((row) => rowCells({ model, row })).join("\n");
      return (
        `<p class="kind">${escapeText({ text: label })} · ${String(group.rows.length)}<span class="meta">${escapeText({ text: why })}</span></p>` +
        `<div class="grid">${colheads({ diff })}\n${cells}\n</div>`
      );
    })
    .join("\n");
  return `<details><summary>Formatting only<span class="meta">${String(rows.length)} lines · the words are unchanged, nothing to decide</span></summary>\n${groups}\n</details>`;
}

/** The unchanged rows, folded. */
function unchangedFold({ diff, model }: { diff: DocumentDiff; model: DocDiffModel }): string {
  const rows = diff.rows.filter((row) => row.kind === "same");
  if (rows.length === 0) {
    return "";
  }
  const cells = rows.map((row) => rowCells({ model, row })).join("\n");
  return `<details><summary>Unchanged<span class="meta">${String(rows.length)} lines</span></summary>\n<div class="grid">${colheads({ diff })}\n${cells}\n</div>\n</details>`;
}

/** One document's tab on the owner page. */
function documentPanel({ diff, model }: { diff: DocumentDiff; model: DocDiffModel }): string {
  return [
    `<h2>${escapeText({ text: diff.document.name })}</h2>`,
    `<p class="meta">${slotLine({ diff })}. ${PAGE_ONLY}</p>`,
    `<h3>What changed, and why · ${String(diff.counts.material)}</h3>`,
    materialGrid({ diff, model }),
    formattingFold({ diff, model }),
    unchangedFold({ diff, model }),
  ]
    .filter((part) => part !== "")
    .join("\n");
}

/** Every distinct mark across the documents, by label, for the legend. */
function legendMarks({ model }: { model: DocDiffModel }): readonly DocDiffMark[] {
  const seen = new Map<string, DocDiffMark>();
  for (const diff of model.documents) {
    for (const mark of diff.document.marks) {
      if (!seen.has(mark.label)) {
        seen.set(mark.label, mark);
      }
    }
  }
  return [...seen.values()];
}

/** The owner page's overview tab. */
function overviewPanel({ model }: { model: DocDiffModel }): string {
  const images = model.images;
  const keys = model.record.keyChanges.map((key) => `<li>${prose({ images, text: key })}</li>`).join("");
  const rows = model.documents
    .map(
      (diff) =>
        `<tr><td>${escapeText({ text: diff.document.name })}</td><td>${slotLine({ diff })}</td>` +
        `<td>${String(diff.counts.material)}</td><td>${String(diff.counts.formatting)}</td></tr>`,
    )
    .join("");
  const legend = legendMarks({ model })
    .map(
      (mark) =>
        `<span class="swatch has-note tone-${mark.tone}" tabindex="0">${escapeText({ text: mark.label })}${note({ lines: [`<span class="k">${prose({ images, text: mark.note })}</span>`] })}</span>`,
    )
    .join("");
  const legendBlock =
    legend === ""
      ? ""
      : `<h3>Colours down the side</h3>\n<p class="meta">Hover a colour for what it means. The colours are only on this page; the document in Vanta stays plain.</p>\n<p>${legend}</p>`;
  return [
    `<h2>The three changes that matter</h2>`,
    `<ol>${keys}</ol>`,
    `<table><thead><tr><th>Document</th><th>Where it lands</th><th>Material</th><th>Formatting only</th></tr></thead><tbody>${rows}</tbody></table>`,
    legendBlock,
  ]
    .filter((part) => part !== "")
    .join("\n");
}

/** The owner page's tab showing what the team will get. */
function teamPanel({ model }: { model: DocDiffModel }): string {
  const pending = model.record.uploaded
    ? ""
    : `<div class="callout warn"><p>Nothing is in Vanta yet, so this goes out only after the upload: it says the documents were pushed.</p></div>`;
  return [
    `<h2>What the team gets</h2>`,
    pending,
    `<p class="meta">The post, then a page of each document as Vanta will hold it, every explained line carrying its reason on hover. Both come from the same record as this page.</p>`,
    postHtml({ model }),
  ]
    .filter((part) => part !== "")
    .join("\n");
}

/** The headline count the lede leads with. */
function headline({ model }: { model: DocDiffModel }): string {
  const material = model.documents.reduce((sum, diff) => sum + diff.counts.material, 0);
  const formatting = model.documents.reduce((sum, diff) => sum + diff.counts.formatting, 0);
  return `${String(material)} material changes across ${String(model.documents.length)} documents, each with its reason; ${String(formatting)} formatting-only lines folded away.`;
}

/**
 * The owner's review page, as a fragment for `slopweaver page publish`.
 *
 * @param model the built diff
 * @returns the fragment
 */
export function renderOwnerPage({ model }: { model: DocDiffModel }): string {
  const group = "dd-tab";
  const entries = [
    { body: overviewPanel({ model }), count: "", label: "Overview" },
    ...model.documents.map((diff) => ({
      body: documentPanel({ diff, model }),
      count: String(diff.counts.material),
      label: diff.document.name,
    })),
    { body: teamPanel({ model }), count: "", label: "For the team" },
  ];
  return [
    pageHead({ count: entries.length, group, title: model.record.title }),
    `<p class="eyebrow">Evidence diff · for your review</p>`,
    `<h1>${escapeText({ text: model.record.title })}</h1>`,
    `<p class="lede">${prose({ images: model.images, text: model.record.lede })}</p>`,
    `<p class="meta">${escapeText({ text: headline({ model }) })}</p>`,
    tabs({ entries, group }),
  ].join("\n");
}
