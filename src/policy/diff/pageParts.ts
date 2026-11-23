/**
 * The pieces both diff pages are built from: the stylesheet, the tab strip, a unit and a line of record prose as
 * HTML, a hover note, a document's line of Vanta links, and the team post as the team will read it.
 *
 * The pages bring their OWN stylesheet. `../../pages/shell.ts` recognises a published page by its exact shell bytes,
 * so adding a diff grid or tabs to the house design would orphan every page already published under it; a dense
 * comparison grid is the case `skills/page/reference/house-style.md` names for a page's own sheet.
 *
 * Pure.
 */
import { escapeAttribute, escapeText } from "../../outbound/briefing/escape.js";
import { type ImageSources, renderInline } from "./inline.js";
import type { DocDiffModel, DocumentDiff } from "./model.js";
import type { DocUnit } from "./units.js";

/** The page's stylesheet, before the per-tab rules. */
const STYLESHEET = `:root{color-scheme:light;--ground:#faf9f5;--panel:#fff;--soft:#f3f0e8;--rule:#e6e1d6;--ink:#1f1e1b;--ink2:#46443e;--muted:#6b6962;--accent:#d97757;--link:#2a5db0;--add:#eaf5ec;--add-ink:#c4e6cd;--del:#fbeceb;--del-ink:#f4c6c0;--chg:#fdf7e6;--blue:#2b5cc4;--violet:#8a3ffc;--amber:#b35c00;--red:#c6362b}
body{margin:0;padding:clamp(2rem,5vw,4rem) max(6%,1.25rem,calc((100% - 140ch)/2)) 6rem;background:var(--ground);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
h1{font:600 clamp(1.9rem,1.2rem + 2.2vw,2.8rem)/1.12 "Iowan Old Style",Charter,Georgia,serif;letter-spacing:-.015em;margin:0 0 .8rem}
h2{font:600 1.5rem/1.25 "Iowan Old Style",Charter,Georgia,serif;margin:1.6rem 0 .5rem}
h3{font-size:1.05rem;margin:1.6rem 0 .4rem}
a{color:var(--link);text-underline-offset:3px;text-decoration-color:rgb(42 93 176/40%)}
code{font:.84em ui-monospace,"SF Mono",Menlo,monospace;background:var(--soft);border:1px solid var(--rule);border-radius:5px;padding:0 .3em;overflow-wrap:anywhere}
pre{font:.82rem/1.55 ui-monospace,"SF Mono",Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);border:1px solid var(--rule);border-radius:10px;padding:.8rem 1rem}
.eyebrow{font:650 .76rem/1.3 -apple-system,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#a64d2c;margin:0 0 .8rem}
.lede{font-size:1.16rem;line-height:1.55;color:var(--ink2);max-width:48em;margin:0 0 1rem}
.meta{color:var(--muted);font-size:.9rem}
.callout{background:var(--panel);border:1px solid var(--rule);border-left:4px solid var(--accent);border-radius:12px;padding:.8rem 1.1rem;margin:1rem 0}
.callout.warn{background:#f8eedb;border-left-color:#9a5b0c}
.callout>:first-child{margin-top:0}.callout>:last-child{margin-bottom:0}
table{width:100%;border-collapse:separate;border-spacing:0;background:var(--panel);border:1px solid var(--rule);border-radius:12px;font-size:.93rem;margin:1rem 0}
th,td{padding:.6rem .9rem;text-align:left;vertical-align:top}
thead th{background:var(--soft);color:var(--muted);font:650 .72rem/1.3 -apple-system,sans-serif;letter-spacing:.06em;text-transform:uppercase}
tbody tr+tr>*{border-top:1px solid var(--rule)}
.tabs{margin-top:1.4rem}
.tabs>input{position:absolute;opacity:0;pointer-events:none}
.tabs>label{display:inline-block;padding:.5rem 1rem;margin:0 .3rem .6rem 0;border:1px solid var(--rule);border-radius:999px;background:var(--panel);cursor:pointer;font-weight:600;font-size:.94rem}
.tabs>label .n{color:var(--muted);font-weight:500}
.tabs>input:focus-visible+label{outline:2px solid var(--link);outline-offset:2px}
.tabs>input:checked+label{background:var(--ink);border-color:var(--ink);color:#fff}
.tabs>input:checked+label .n{color:#d8d4ca}
.panel{display:none;border-top:1px solid var(--rule);padding-top:.6rem}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);background:var(--panel);border:1px solid var(--rule);border-radius:12px;margin:.8rem 0 1.4rem}
.colhead{position:sticky;top:0;z-index:3;background:var(--ink);color:#fff;font:600 .78rem/1.3 -apple-system,sans-serif;padding:.5rem .8rem}
.colhead:first-child{border-top-left-radius:11px}.colhead:nth-child(2){border-top-right-radius:11px}
.why{grid-column:1/-1;padding:.65rem .9rem;background:var(--soft);border-top:1px solid var(--rule);font-size:.95rem;font-weight:550}
.why .crumb{display:block;color:var(--muted);font-size:.78rem;font-weight:500;letter-spacing:.02em}
.why details.was{background:none;border:0;border-radius:0;margin:.2rem 0 0;padding:0;font-weight:400;color:var(--ink2);font-size:.88rem}
.why details.was summary{padding:.1rem 0;font-weight:500;color:var(--muted)}
.cell{position:relative;padding:.4rem .8rem;border-top:1px solid #efebe2;min-width:0;font-size:.93rem;overflow-wrap:anywhere}
.cell.empty{background:repeating-linear-gradient(45deg,#fbfaf6,#fbfaf6 6px,#f3f0e8 6px,#f3f0e8 12px)}
.cell.added{background:var(--add)}.cell.removed{background:var(--del)}.cell.changed{background:var(--chg)}
ins{background:var(--add-ink);text-decoration:none;border-radius:3px;padding:0 1px}
del{background:var(--del-ink);border-radius:3px;padding:0 1px}
.u{margin:.1rem 0}.u.h1,.u.h2{font-weight:700;font-size:1.02rem}.u.h3,.u.h4{font-weight:650}
.u.li::before{content:"• ";color:var(--muted)}
.d1{padding-left:1.4rem}.d2{padding-left:2.6rem}.d3{padding-left:3.8rem}
.u img{max-width:100%;display:block;border:1px solid var(--rule);border-radius:8px;margin:.3rem 0}
.u figcaption{font-size:.8rem;color:var(--muted)}
.has-note{cursor:help}
.has-note:focus{outline:2px solid var(--link);outline-offset:-2px}
.note{display:none;position:absolute;left:.5rem;right:.5rem;top:calc(100% - .25rem);z-index:20;background:var(--ink);color:#f3f1ec;padding:.65rem .85rem;border-radius:10px;font-size:.87rem;font-weight:400;line-height:1.5;box-shadow:0 14px 34px -12px rgb(0 0 0/45%);cursor:auto}
.note a{color:#a9c6ff}.note code{background:#38362f;border-color:#4a473f;color:#f3f1ec}
.note .k{display:block;margin-top:.3rem}.note .k:first-child{margin-top:0}
.note .k b{color:#f2b9a2;font-weight:650;margin-right:.35rem}
.has-note:hover>.note,.has-note:focus-within>.note{display:block}
.tone-blue{box-shadow:inset 4px 0 var(--blue)}.tone-violet{box-shadow:inset 4px 0 var(--violet)}
.tone-amber{box-shadow:inset 4px 0 var(--amber)}.tone-red{box-shadow:inset 4px 0 var(--red),inset 0 0 0 999px rgb(198 54 43/5%)}
.note .tone-blue,.note .tone-violet,.note .tone-amber,.note .tone-red{padding-left:.6rem}
.swatch{position:relative;display:inline-block;padding:.2rem .75rem .2rem 1rem;margin:.2rem .4rem .2rem 0;border:1px solid var(--rule);border-radius:8px;background:var(--panel);font-size:.9rem;cursor:help}
.swatch .note{min-width:18rem}
details{background:var(--panel);border:1px solid var(--rule);border-radius:12px;margin:1rem 0;padding:0 1rem}
summary{cursor:pointer;padding:.75rem 0;font-weight:600}
summary .meta{font-weight:400;margin-left:.4rem}
details>.grid{margin:.2rem 0 1rem}
.kind{margin:.9rem 0 .2rem;font-weight:650}
.kind .meta{display:block;font-weight:400}
.post{background:var(--panel);border:1px solid var(--rule);border-radius:12px;padding:.9rem 1.2rem;margin:.8rem 0}
.post ul{margin:.3rem 0;padding-left:1.3rem}
.doc{background:var(--panel);border:1px solid var(--rule);border-radius:12px;padding:.6rem 0;margin:.8rem 0}
.doc>.cell{border-top:0}
.doc>.cell.explained{background:var(--add)}
@media (max-width:52rem){.grid{grid-template-columns:minmax(0,1fr)}.colhead{display:none}.cell.empty{display:none}}`;

/** The per-tab rules that show the checked tab's panel. */
function tabRules({ group, count }: { group: string; count: number }): string {
  return Array.from(
    { length: count },
    (_, index) => `#${group}-${String(index)}:checked~.panel:nth-of-type(${String(index + 1)}){display:block}`,
  ).join("");
}

/** One tab: its label, the count beside it (empty for none), and its panel's HTML. */
interface TabEntry {
  readonly label: string;
  readonly count: string;
  readonly body: string;
}

/**
 * A page's head: its title, and its stylesheet with the rules that show each tab's panel.
 *
 * @param group the tab strip's radio group, which every rule names
 * @param count how many tabs the strip has
 * @returns the `<title>` and `<style>` elements
 */
export function pageHead({ title, group, count }: { title: string; group: string; count: number }): string {
  return `<title>${escapeText({ text: title })}</title>\n<style>${STYLESHEET}\n${tabRules({ count, group })}</style>`;
}

/**
 * A tab strip and its panels, CSS only: a radio input and label per tab, the first checked, then one `.panel`
 * section per tab.
 *
 * @param group the radio group the inputs share, unique on the page
 * @returns the strip's HTML
 */
export function tabs({ group, entries }: { group: string; entries: readonly TabEntry[] }): string {
  const heads = entries
    .map((entry, index) => {
      const id = `${group}-${String(index)}`;
      const checked = index === 0 ? " checked" : "";
      const count = entry.count === "" ? "" : ` <span class="n">${escapeText({ text: entry.count })}</span>`;
      return `<input type="radio" name="${group}" id="${id}"${checked}><label for="${id}">${escapeText({ text: entry.label })}${count}</label>`;
    })
    .join("\n");
  const panels = entries.map((entry) => `<section class="panel">\n${entry.body}\n</section>`).join("\n");
  return `<div class="tabs">\n${heads}\n${panels}\n</div>`;
}

/**
 * Inline markdown from the record, as HTML.
 *
 * @param text a sentence of the record, already linked
 * @returns its HTML
 */
export function prose({ text, images }: { text: string; images: ImageSources }): string {
  return renderInline({ images, markdown: text });
}

/**
 * One unit as HTML, its inner HTML supplied (already diffed or plainly rendered).
 *
 * @param inner the unit's content as HTML; a fence or the front matter is printed from its own text instead
 * @returns the unit's element
 */
export function unitHtml({ unit, inner }: { unit: DocUnit; inner: string }): string {
  if (unit.kind === "heading") {
    return `<div class="u h${String(unit.level)}">${inner}</div>`;
  }
  if (unit.kind === "image") {
    return `<figure class="u">${inner}</figure>`;
  }
  if (unit.kind === "fence") {
    return `<pre class="u">${escapeText({ text: unit.raw })}</pre>`;
  }
  if (unit.kind === "front") {
    return `<pre class="u" title="The file header">${escapeText({ text: unit.raw })}</pre>`;
  }
  const list = unit.kind === "item" ? " li" : "";
  return `<div class="u${list} d${String(Math.min(unit.depth, 3))}">${inner}</div>`;
}

/**
 * One unit rendered plainly, an image with its caption under it.
 *
 * @returns the unit's element
 */
export function plainUnit({ unit, images }: { unit: DocUnit; images: ImageSources }): string {
  if (unit.kind === "image") {
    const alt = /^!\[([^\]]*)\]/.exec(unit.raw);
    const caption = alt === null ? "" : `<figcaption>${escapeText({ text: alt[1]! })}</figcaption>`;
    return unitHtml({ inner: `${renderInline({ images, markdown: unit.raw })}${caption}`, unit });
  }
  return unitHtml({ inner: renderInline({ images, markdown: unit.raw }), unit });
}

/**
 * A hover note from its lines, or nothing when there are none.
 *
 * @param lines each line's HTML
 * @returns the note's element, or the empty string
 */
export function note({ lines }: { lines: readonly string[] }): string {
  if (lines.length === 0) {
    return "";
  }
  return `<span class="note" role="note">${lines.join("")}</span>`;
}

/**
 * A document's Vanta slot and the controls it sits on, as one line of links.
 *
 * @returns the line's HTML
 */
export function slotLine({ diff }: { diff: DocumentDiff }): string {
  const controls = diff.controls.map(
    (control) => `<a href="${escapeAttribute({ text: control.url })}">${escapeText({ text: control.id })}</a>`,
  );
  return `<a href="${escapeAttribute({ text: diff.slotUrl })}">${escapeText({ text: diff.document.name })} in Vanta</a> · on ${controls.join(", ")}`;
}

/**
 * The team post as HTML, the way the team will read it.
 *
 * @returns the post's element
 */
export function postHtml({ model }: { model: DocDiffModel }): string {
  const images = model.images;
  const documents = model.documents
    .map(
      (diff) => `<a href="${escapeAttribute({ text: diff.slotUrl })}">${escapeText({ text: diff.document.name })}</a>`,
    )
    .join(" and ");
  const keys = model.record.keyChanges.map((key) => `<li>${prose({ images, text: key })}</li>`).join("");
  return (
    `<div class="post"><p>${prose({ images, text: model.record.team.opener })} ${documents}</p>` +
    `<p>key changes:</p><ul>${keys}</ul><p>${prose({ images, text: model.record.team.ask })}</p></div>`
  );
}
