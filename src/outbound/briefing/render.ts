/**
 * The PURE renderer: a {@link BriefingForm} in, the exact bytes of the fleet-briefing page out.
 *
 * The document it emits is the live artifact's own shape, which
 * `skills/supervisor/reference/fleet-briefing-shape.md` states as contract and
 * `../../briefing/reactNowCard.ts` parses. Five parts of it are load-bearing rather than cosmetic, and a
 * change to any of them is a change to the gate:
 *
 * - `<h2>react now</h2>` opens the card block, is the FIRST `<h2>` on the page, and the NEXT `<h2>` closes
 *   it — so the section below the cards is a heading rather than a styled div, and nothing renders above
 *   the cards but the eyebrow, the title and the lede;
 * - the two groupings are `<h3>` inside that block, team-facing first, each with the renderer's own
 *   contract line under it;
 * - the eyebrow carries BOTH instants in `./stamp.ts`'s format, which is what a reader asking whether the
 *   page is current reads;
 * - a card is `div.need` holding `div.q` and `dl.f`, with the five labels spelled exactly `what`,
 *   `why you`, `options`, `lean`, `if silent`;
 * - a fold is a `<details>` element, which is what "above the fold" MEANS to every cap.
 *
 * ## Nothing a caller supplies can become markup
 *
 * Every text run is escaped, and there is no raw-HTML run in the vocabulary. That is not only an injection
 * argument: a caller who could emit a `</details>` could move their own words above the fold, which is the
 * one thing every cap here depends on being impossible.
 *
 * ## The numbering is the renderer's
 *
 * A card's `question` is stored unnumbered and rendered as `1.`, `2.` and so on. The composer cannot get
 * the sequence wrong by hand, and the gate strips exactly that prefix before it counts the question's
 * words — so the number is never charged against the 30-word cap.
 */
import { landedAgeLine, premiseAgeLine, premiseInstant } from "../../briefing/cardPremise.js";
import { renderAutonomy } from "./autonomyRender.js";
import { BRIEFING_CHROME } from "./chrome.js";
import { escapeAttribute, escapeText } from "./escape.js";
import { renderEyebrow } from "./eyebrow.js";
import { renderHandSteps } from "./handStepsRender.js";
import { linkifyText } from "./linkify.js";
import { renderQuiz } from "./quizRender.js";
import { stampMelbourne } from "./stamp.js";
import type {
  BriefingArtifactValidity,
  BriefingBlock,
  BriefingCard,
  BriefingCardReadiness,
  BriefingCardSubject,
  BriefingContent,
  BriefingDraftSurface,
  BriefingFold,
  BriefingForm,
  BriefingHeader,
  BriefingInline,
  BriefingNote,
  BriefingOpenArtifact,
  BriefingOwnerBeliefs,
  BriefingOwnerBeliefsRow,
  BriefingPasteBlock,
  BriefingSection,
  BriefingYourList,
  BriefingYourRow,
} from "./types.js";
import {
  ALIGNMENT_ID,
  INTAKE_SUMMARY,
  LEDE_CLASS,
  ME_FACING_ID,
  OPEN_ARTIFACTS_ID,
  OWNER_BELIEFS_ID,
  QUOTED_NOTE_ID,
  REACT_NOW_ID,
  RECENT_ID,
  TEAM_FACING_ID,
  WAITING_ID,
  YOUR_LIST_ID,
} from "./types.js";
import { yourListSummary } from "./yourListSummary.js";
import { renderUnderHeadline } from "./yourRowUnder.js";

/**
 * The heading that opens the card block. `../../briefing/reactNowCard.ts` finds the region by it.
 *
 * The `id` is what an anchor run jumps to. Every reader that finds a region by heading matches the attribute
 * list rather than a bare `<h2>`, which is the one change adding ids made to the gate.
 */
const REACT_NOW_HEADING = `<h2 id="${REACT_NOW_ID}">react now</h2>`;

/** The heading that closes it. Any `<h2>` would; this is the one the live page uses. */
const RECENT_HEADING = `<h2 id="${RECENT_ID}">done since you last looked</h2>`;

/**
 * The two grouping headings, and the contract line under each.
 *
 * `<h3>` rather than `<h2>` for a mechanical reason as well as a visual one: `../../briefing/reactNowCard.ts`
 * reads the react-now region as everything up to the NEXT `<h2>`, so a grouping heading at that level would
 * close the block after the first grouping and hide every me-facing card from the gate.
 *
 * **The contract line is the renderer's, never the composer's**, and it states the grouping's AUDIENCE and
 * nothing more. It used to state an autonomy rule — "approve the approach first", "Nothing starts until you
 * answer" — which is retired: team-facing no longer means held pending the owner's
 * word. Whether a card needs an answer is `readiness` and the card's own text, per card, never something a
 * reader may infer from which grouping it landed in (`AGENTS.md` rule 10). A composer who could write these
 * lines could soften them, so they stay here.
 */
const TEAM_FACING_HEADING = `<h3 id="${TEAM_FACING_ID}">team-facing — this reaches a colleague</h3>`;
const TEAM_FACING_CONTRACT = '<p class="sub">The next step here is seen by someone other than you.</p>';
const ME_FACING_HEADING = `<h3 id="${ME_FACING_ID}">yours — nobody else sees it</h3>`;
const ME_FACING_CONTRACT = '<p class="sub">Your own tooling and pages; nobody else reviews these.</p>';

/** The heading that opens the owner's list — first on the page, because it is the queue they are answering. */
const YOUR_LIST_HEADING = `<h2 id="${YOUR_LIST_ID}">your list</h2>`;

/**
 * The heading that opens the ranked open-artifact index, and the line under it.
 *
 * `<h3>` for the same mechanical reason the grouping headings are: `../../briefing/reactNowCard.ts` reads
 * the react-now region as everything up to the next `<h2>`, and this index is INSIDE that region — an `<h2>`
 * here would close the block and hide every card below it from the gate.
 *
 * The line under it is the renderer's, never the composer's, exactly as the grouping contracts are. It says
 * what the marks mean, which is the half that has to be on the page rather than only in
 * the type: a mark the owner cannot read is a mark they have to ask about.
 */
const OPEN_ARTIFACTS_HEADING = `<h3 id="${OPEN_ARTIFACTS_ID}">every open page, best first</h3>`;
const OPEN_ARTIFACTS_CONTRACT =
  '<p class="sub">Ranked by whether your own later steer already settled it. ' +
  "Marks come from what you ruled, not from a guess.</p>";

/**
 * The waiting grouping's heading and the line under it, for the cards that are not the owner's to answer yet.
 *
 * `<h3>` for the same mechanical reason every other heading inside this block is: an `<h2>` here would close
 * the react-now region and hide these cards from `../../briefing/reactNowCard.ts`.
 *
 * The line under it is the renderer's, never the composer's, exactly as the two grouping contracts are. It
 * is what turns the ordering into something the owner can act on rather than notice: without it they
 * squint to tell the two kinds apart, and a heading that does not say what the section IS leaves
 * them squinting at a shorter list.
 */
const WAITING_HEADING = `<h3 id="${WAITING_ID}">waiting on a session — nothing to answer yet</h3>`;
const WAITING_CONTRACT =
  '<p class="sub">Each names the session it waits on and what has to happen. Skip these unless you want to step in.</p>';

/**
 * The heading that opens the alignment line, and — being an `<h2>` — the one that CLOSES the react-now block
 * when the page carries no cards. That is deliberate: `../../briefing/reactNowCard.ts` reads the react-now
 * region as everything up to the next `<h2>`, so this heading has to sit immediately after the cards rather
 * than anywhere else, or the alignment line would be parsed as part of a card.
 *
 * The heading names its object ("what the fleet is working on"): a heading missing its object costs the owner trust in the whole
 * section under it rather than only in the heading. `../../briefing/alignment.ts` accepts both spellings, so
 * a page rendered before this still reads as carrying an alignment block.
 */
const ALIGNMENT_HEADING = `<h2 id="${ALIGNMENT_ID}">what the fleet is working on</h2>`;

/**
 * The correction block's heading, the contract line under it, and the three marks — all renderer-owned.
 *
 * Owned here rather than composed, the same call the react-now groupings' contract lines make. The contract
 * has to say two things a composer must not be free to soften. First, what a mark MEANS: it is whether the
 * fleet read the owner correctly, not whether the claim is true, and those come apart — the owner can be right that they
 * believed something and the belief still be false, which is the most interesting row the register can
 * hold. Second, where the answer GOES: the page is published HTML and cannot call back, so the honest
 * affordance is the one every other answer on this page uses, a word to the supervisor naming the id.
 *
 * The owner marks a belief right, wrong or partly in a single click. The letters are as close to
 * one click as a page that cannot submit anything can honestly get; nothing here may render a control that
 * looks like it recorded something.
 */
const OWNER_BELIEFS_HEADING = `<h2 id="${OWNER_BELIEFS_ID}">what I think you believe</h2>`;
const OWNER_BELIEFS_CONTRACT =
  '<p class="sub">Each of these was read out of something you actually said. Tell me the id and <strong>A ' +
  "right</strong>, <strong>B wrong</strong> or <strong>C partly</strong> — that is whether I read you " +
  "correctly, not whether the claim is true. Add your own wording if I got it close but not right.</p>";

/** The three marks, in the order the block offers them. Letters are STRUCTURE; the words are the owner's three. */
const OWNER_BELIEF_MARKS =
  '<span class="ol">A</span> right · <span class="ol">B</span> wrong · <span class="ol">C</span> partly';

/** What the react-now block says when nothing is open. A real state, per the shape reference. */
const NOTHING_OPEN = '<p class="sub">nothing open above the line right now</p>';

/** The accent a below-the-line block carries: landed rather than needing a word. */
const LANDED = ' style="border-left-color:var(--ok)"';

/** The label a draft's own frame carries, one per surface — never the draft's own words. */
const DRAFT_SURFACE_LABEL: Readonly<Record<BriefingDraftSurface, string>> = {
  "slack-as-me": "Draft — Slack, sent as you",
};

export { escapeAttribute, escapeText } from "./escape.js";

/**
 * One inline run. Every branch escapes, so a caller supplies text and a kind and never markup.
 *
 * The two PROSE branches linkify as well as escape; `code` does not, because a URL inside a code span is
 * being shown as a literal, and `link`/`anchor` do not, because an anchor nested inside an anchor is invalid
 * HTML and the run already carries the destination the composer chose.
 */
function renderInline({ run }: { run: BriefingInline }): string {
  const text = escapeText({ text: run.text });
  switch (run.kind) {
    case "text":
      return linkifyText({ text: run.text });
    case "strong":
      return `<strong>${linkifyText({ text: run.text })}</strong>`;
    case "code":
      return `<code>${text}</code>`;
    case "link":
      return `<a href="${escapeAttribute({ text: run.url })}">${text}</a>`;
    case "anchor":
      return `<a href="#${escapeAttribute({ text: run.target })}">${text}</a>`;
  }
}

/**
 * One cell's runs, concatenated.
 *
 * No separator, so a composer owns their own spacing — `[{ text: "see " }, { kind: "link", … }]` renders as
 * one phrase rather than acquiring a space nobody wrote. `./schema.ts` counts the identical concatenation,
 * which is what makes the form admit exactly what the gate over the rendered page passes.
 *
 * @internal — every other renderer here builds on it; no caller outside this file names it.
 * @param content the cell's ordered runs
 * @returns the cell's HTML
 */
export function renderContent({ content }: { content: BriefingContent }): string {
  return content.map((run) => renderInline({ run })).join("");
}

/**
 * A drafted message's own body: `\n\n` reads as the paragraph gap it is on the wire it was drafted for
 * (`../slack/render.ts`'s `PARAGRAPH_GAP`), a single `\n` as a line break within one — the same two rules
 * every other Slack renderer in this repository applies, so this frame shows what would actually post.
 */
function renderDraftBody({ text }: { text: string }): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeText({ text: paragraph }).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

/**
 * One paste block: what it hands the owner, a button that copies it, and the bytes themselves.
 *
 * Three things here are the fix rather than the styling, and `./chrome.ts` carries the other half of each:
 *
 * - the text sits in a `<pre>`, which is the only element that keeps the bytes the owner pastes intact — a `<code>`
 *   run inside a paragraph is re-spaced by the browser and, in this page's own chrome, is `white-space:
 *   nowrap`, which is what made a 1,661-byte scope line scroll the whole page sideways;
 * - the button carries NO id and no inline handler. The chrome's one delegated listener finds the `<pre>`
 *   inside the same `.paste` element, so this renderer stays pure and position-independent — a card that
 *   moves up the page does not have to be re-rendered to keep its own copy button working;
 * - the button's own words (`copy`, and `copied` after a click) are the renderer's, exactly as a grouping's
 *   contract line and a draft's surface label are. A composer supplies what the block IS, never its control.
 */
function renderPaste({ block }: { block: BriefingPasteBlock }): string {
  const label = escapeText({ text: block.label });
  return (
    `<div class="paste"><div class="paste-head"><span class="paste-label">${label}</span>` +
    `<button class="paste-copy" type="button">copy</button></div>` +
    `<pre>${escapeText({ text: block.text })}</pre></div>`
  );
}

/**
 * One block inside a fold: a paragraph, a real list with one item per `<li>`, an image, a draft, or a paste
 * block.
 *
 * The image `src` carries an already-resolved `data:` URI — `../../briefing/images.ts` turned any composer
 * `path` into one before the form ever reached the schema, so this function never touches the filesystem and
 * stays as pure as every other renderer in this file. A draft's `text` is the surface's own words, framed but
 * never rewritten — the same discipline the image branch already carries for a screenshot's pixels, and the
 * one {@link renderPaste} carries for bytes the owner is going to paste somewhere else.
 */
function renderBlock({ block }: { block: BriefingBlock }): string {
  switch (block.kind) {
    case "para":
      return `<p>${renderContent({ content: block.content })}</p>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items.map((item) => `<li>${renderContent({ content: item })}</li>`).join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "image": {
      const caption =
        block.caption === undefined ? "" : `<figcaption>${escapeText({ text: block.caption })}</figcaption>`;
      const src = escapeAttribute({ text: block.data });
      const alt = escapeAttribute({ text: block.alt });
      return `<figure><img src="${src}" alt="${alt}">${caption}</figure>`;
    }
    case "draft": {
      const label = escapeText({ text: DRAFT_SURFACE_LABEL[block.surface] });
      return (
        `<div class="draft draft-${block.surface}"><div class="draft-label">${label}</div>` +
        `<div class="draft-body">${renderDraftBody({ text: block.text })}</div></div>`
      );
    }
    case "paste":
      return renderPaste({ block });
    case "fold":
      return renderFold({ fold: block.fold });
  }
}

/**
 * A collapsed region, and nothing at all when there is no fold to render.
 *
 * This element IS the fold every cap in `../../briefing/caps.ts` is measured against. The ABSENT case lives
 * here rather than in a second wrapper because every caller has one — a card, a note, a row and the
 * alignment line all carry an optional detail — so the guard belongs beside the render rather than in a
 * function whose only job is to ask the question.
 *
 * `marker` is the `data-section` role a quoted note stamps on its own fold, which is how every reader of the
 * rendered bytes tells whose words a fold holds (`./types.ts`'s `QUOTED_NOTE_ID`).
 */
function renderFold({ fold, marker = "" }: { fold: BriefingFold; marker?: string | undefined }): string {
  const blocks = fold.blocks.map((block) => renderBlock({ block })).join("");
  return `<details${marker}><summary>${escapeText({ text: fold.summary })}</summary><div>${blocks}</div></details>`;
}

/**
 * A fold when there is one, and nothing at all when there is not — with the space that separates it.
 *
 * SEPARATE from {@link renderFold} rather than merged into it, and the space is why: a NESTED fold is
 * emitted by {@link renderBlock} with no separator, while a card, a note, a row and the alignment line each
 * append theirs to prose. Merging the two put a leading space inside every nested `<details>`.
 */
function renderOptionalFold({ fold, marker }: { fold: BriefingFold | undefined; marker?: string | undefined }): string {
  return fold === undefined ? "" : ` ${renderFold({ fold, marker })}`;
}

/** One `dt`/`dd` pair of a card's field grid. */
function renderField({ label, body }: { label: string; body: string }): string {
  return `      <dt>${label}</dt><dd>${body}</dd>`;
}

/**
 * The options cell: one `<li>` per option, the letter structural and the body prose.
 *
 * Options render as a real list, because lettered choices joined into one run-on sentence are very difficult
 * to read. They are a typed list in the form, so this renderer must not join them with a space and
 * deliver three separate choices as one paragraph. It is the same rule the fold blocks carry (a numbered
 * set of items is a real list), applied to the one field that could otherwise be exempt from it by accident.
 *
 * **The plain text is unchanged, deliberately.** `../../briefing/reactNowCard.ts` splits this cell back into
 * options on its `OPTION_MARKER` pattern, which needs whitespace before each letter, and
 * `../../briefing/text.ts`'s `stripTags` replaces every tag with a space — so
 * `<li><span class="ol">A:</span> …</li>` reads back as ` A: … ` and the gate parses exactly what it parsed
 * before. A list that changed the text would have been a change to the gate.
 */
function renderOptions({ card }: { card: BriefingCard }): string {
  const items = card.options
    .map(
      (option) =>
        `<li><span class="ol">${escapeText({ text: option.letter })}:</span> ${linkifyText({ text: option.text })}</li>`,
    )
    .join("");
  return `<ul class="opts">${items}</ul>`;
}

/**
 * What a card's declared readiness adds to its markup: the machine-readable mark, and the line the owner reads.
 *
 * The mark is a `data-` ATTRIBUTE rather than a second class, and that is a compatibility decision rather
 * than a style one. `../../briefing/reactNowCard.ts` and `../../briefing/pageBudget.ts` both find a card by
 * the literal `<div class="need"` — a `class="need waiting"` would have made every waiting card invisible to
 * both readers, which is the opposite of what this field is for.
 *
 * A ready card gets neither, so the page it renders is byte-for-byte what it rendered before this field
 * existed. That is what keeps the corrections diff (`./corrections.ts`) from marking every card on the first
 * page published after this landed.
 *
 * @param readiness the card's declared readiness
 * @returns the attributes to put on the card's own div, and the wait line to put under its question
 */
function renderWaitLine({ readiness }: { readiness: BriefingCardReadiness }): {
  attributes: string;
  line: string;
} {
  if (readiness.state === "ready") {
    return { attributes: "", line: "" };
  }
  const session = escapeText({ text: readiness.session });
  const event = escapeText({ text: readiness.event });
  return {
    attributes: ` data-readiness="waiting" style="border-left-color:var(--muted)"`,
    line: `<div class="wait">waiting on ${session} · ${event}</div>`,
  };
}

/**
 * A card's subject line: the subject's own title, linked when it has a page and plain when it does not.
 *
 * @param subject the card's subject, absent when the card carries none
 * @returns the subject line's HTML, or the empty string when there is no subject
 */
function renderSubject({ subject }: { subject: BriefingCardSubject | undefined }): string {
  if (subject === undefined) {
    return "";
  }
  const label = escapeText({ text: subject.text });
  if (subject.url === undefined) {
    return `<div class="bg">${label}</div>`;
  }
  return `<div class="bg"><a href="${escapeAttribute({ text: subject.url })}">${label}</a></div>`;
}

/**
 * One react-now card, numbered from its position in the block.
 *
 * @param card the card to render
 * @param position the card's 1-based place in the react-now block
 * @returns the card's HTML
 */
export function renderCard({
  card,
  position,
  nowIso,
}: {
  card: BriefingCard;
  position: number;
  nowIso: string;
}): string {
  const question = `${String(position)}. ${escapeText({ text: card.question })}`;
  const what = `${renderContent({ content: card.what })}${renderOptionalFold({ fold: card.detail })}`;
  const waiting = renderWaitLine({ readiness: card.readiness });
  // A `div.bg`, exactly as a row of the owner's list carries its own title, and for the same two reasons: the voice
  // pass reads `dl.f` cells and this is the subject's words rather than the composer's, and the anchor is
  // what keeps a title carrying its own parenthesised reference off the page as a bare reference.
  // A url-less subject renders as its words alone, deliberately with no anchor of any kind: a `no page`
  // subject exists to say there is nothing to open, and a link on it would say the opposite.
  const subject = renderSubject({ subject: card.subject });
  // THE AGE, above the question, in the words the owner reads it in. A card whose
  // premise was 23 hours old told them nothing about that, and they had to date it by opening the page it was
  // about. The instant travels as an attribute beside the words for the same reason every other stamp on
  // this page does — a reader that can only see prose cannot re-check the claim.
  const age =
    `<div class="age" data-premise-kind="${escapeAttribute({ text: card.premise.kind })}" ` +
    `data-premise-iso="${escapeAttribute({ text: premiseInstant({ premise: card.premise }) })}">` +
    `${escapeText({ text: premiseAgeLine({ nowIso, premise: card.premise }) })}</div>`;
  return [
    `<div class="need"${waiting.attributes}><div class="q">${question}</div>${subject}${age}${waiting.line}`,
    '    <dl class="f">',
    renderField({ body: what, label: "what" }),
    renderField({ body: renderContent({ content: card.whyYou }), label: "why you" }),
    renderField({ body: renderOptions({ card }), label: "options" }),
    renderField({ body: renderContent({ content: card.lean }), label: "lean" }),
    renderField({ body: renderContent({ content: card.ifSilent }), label: "if silent" }),
    "    </dl></div>",
  ].join("\n");
}

/**
 * One below-the-line note: a headline a reader meets, and its fold.
 *
 * The fold sits INSIDE the `div.q` rather than after it, which is what the live page does and what keeps
 * the page's unfolded-block count honest — a `details` sibling would leave the block itself unfolded.
 *
 * The two lanes render the SAME structure, and that is deliberate: a note quoting the owner's own words is not a
 * different kind of block on the page, it is the same one holding words nobody here wrote. The only mark a
 * quoted note carries is `data-section="quoted"` on its own fold, which is what lets
 * `../../briefing/sectionQualityHtml.ts` skip its contents the way it already skips the owner's list.
 *
 * @param note the note to render
 * @returns the note's HTML
 */
export function renderNote({ note }: { note: BriefingNote }): string {
  const marker = note.lane === "quoted" ? ` data-section="${QUOTED_NOTE_ID}"` : "";
  const body = `${renderContent({ content: note.headline })}${renderOptionalFold({ fold: note.detail, marker })}`;
  return `<div class="need"${LANDED}><div class="q">${body}</div></div>`;
}

/** One collapsed section below the line, holding its notes and, when it has one, the id an anchor names. */
function renderSection({ section }: { section: BriefingSection }): string {
  const notes = section.notes.map((note) => renderNote({ note })).join("\n");
  const id = section.id === undefined ? "" : ` id="${escapeAttribute({ text: section.id })}"`;
  return `<details${id}><summary>${escapeText({ text: section.summary })}</summary><div>\n${notes}\n</div></details>`;
}

/**
 * One row of the owner's list: the rank, the row's own short question, and everything else folded.
 *
 * A `div.mine` rather than a `div.need`, and that is a budget decision rather than a style one. The page
 * budget counts every unfolded `.need` block outside the react-now section against `PAGE_UNFOLDED_BLOCKS_MAX`
 * — five — so rendering ten of the owner's rows as `.need` would refuse the page for carrying the owner's own queue. That list
 * has its OWN budget (`YOUR_LIST_MAX_ROWS`, `YOUR_LIST_ABOVE_FOLD_MAX_WORDS`), which is the shape the
 * one-index page needs: a new section brings its own cap rather than eating another section's. The rank is
 * the RENDERER's, exactly as a card's number is, so a projection cannot number itself wrongly.
 *
 * @param row the ranked row, as the session-start verb produced it
 * @returns the row's HTML
 */
export function renderYourRow({ row }: { row: BriefingYourRow }): string {
  const lead = escapeText({ text: `${String(row.rank)}. ${row.closing ? "CLOSE — " : ""}` });
  const headline = renderContent({ content: row.headline });
  const fold = renderOptionalFold({ fold: row.detail });
  return `<div class="mine"><div class="q">${lead}${headline}</div>${renderUnderHeadline({ row })}${fold}</div>`;
}

/**
 * The owner's list: the rows, and an honest line about the ones this page is not showing.
 *
 * The count is never dressed as a cut. `../../sessionStart/render.ts` shortens a headline at a word boundary
 * and this page states the remainder as a number, so nothing on it ends in an ellipsis that drops the rest —
 * the rule the whole form already enforces on every other run.
 *
 * @param list the projected list
 * @returns the block's HTML lines, in order
 */
export function renderYourList({
  list,
  header,
}: {
  list: BriefingYourList;
  header: BriefingHeader;
}): readonly string[] {
  const more =
    list.notShown === 0
      ? []
      : [
          `  <p class="sub">${escapeText({ text: `${String(list.notShown)} more ranked rows are not shown here.` })}</p>`,
        ];
  const summary = yourListSummary({ list, readyIso: header.readyIso });
  return [
    YOUR_LIST_HEADING,
    `  <details data-section="${YOUR_LIST_ID}"><summary>${escapeText({ text: summary })}</summary><div>`,
    `  <p class="sub">${escapeText({ text: list.source })}</p>`,
    ...list.rows.map((row) => renderYourRow({ row })),
    ...more,
    "  </div></details>",
  ];
}

/**
 * The alignment block: one generated sentence, the owner-intake sentence folded behind it, and the
 * composer's own fold behind that.
 *
 * Rendered as a `p.align` rather than a `div.need`, so it never counts against the page's unfolded-block
 * budget — it is not one of the things accumulating sweep over sweep, it is the same single line replaced
 * every tick. The HEADLINE's words DO count against the page's above-the-fold word budget, which is right:
 * a reader meets them.
 *
 * ## Why `intake` gets a fold the renderer owns rather than a place in the line
 *
 * It rode inside the headline once and the two halves of this gate then refused each other —
 * `../../briefing/caps.ts`'s `ALIGNMENT_MAX_WORDS` carries the 94-words-against-55 measurement. A fold is
 * what makes it free: `../../briefing/text.ts`'s `unfolded` strips every `<details>` before a word or a
 * sentence is counted, so the required intake sentence can be as long as the read it reports needs to be.
 *
 * It is a SECOND fold rather than a block prepended to `detail`, because `detail` is optional and is the
 * composer's own — prepending would hide a required disclosure behind a summary a composer wrote, which is
 * the one thing {@link INTAKE_SUMMARY} exists to prevent.
 *
 * @internal — one block of {@link renderBriefing}'s page; no caller outside this module names it.
 *
 * @param form the whole form
 * @returns the block's HTML
 */
export function renderAlignment({ form }: { form: BriefingForm }): string {
  const body = renderContent({ content: form.alignment.headline });
  const intake = renderFold({
    fold: {
      blocks: [{ content: form.alignment.intake, kind: "para" }],
      summary: INTAKE_SUMMARY,
    },
  });
  return `<p class="align">${body} ${intake}${renderOptionalFold({ fold: form.alignment.detail })}</p>`;
}

/**
 * One validity mark, as words the owner reads rather than a token they have to decode.
 *
 * A superseded page names its replacement and LINKS it when the ruling recorded an address, because the
 * whole ask was to stop the owner guessing where to look next — telling them a tab is dead without saying which
 * one replaced it moves the guess rather than removing it.
 *
 * @param validity the derived mark
 * @returns the mark's own HTML span
 */
function renderValidity({ validity }: { validity: BriefingArtifactValidity }): string {
  if (validity.mark === "valid") {
    return '<span class="bg">still valid</span>';
  }
  if (validity.mark === "partly-ruled") {
    const text = `partly ruled ${validity.ruledIso.slice(0, 10)} (${validity.outcome})`;
    return `<span class="bg">${escapeText({ text })}</span>`;
  }
  const name = escapeText({ text: validity.by });
  const named =
    validity.byUrl === undefined ? name : `<a href="${escapeAttribute({ text: validity.byUrl })}">${name}</a>`;
  return `<span class="bg">superseded by ${named}</span>`;
}

/**
 * One line of the ranked index: its rank, the link, the session's ask, when it landed, and its mark.
 *
 * Rendered as `p.ranked`, its OWN class rather than the standing band's `p.await`, and that is mechanical
 * rather than cosmetic: `../../briefing/oneIndex.ts` counts `p.await` to enforce `AWAITING_MAX_ITEMS`, so an
 * index sharing the class would be refused at its fourth line by the very cap the ranked index was taken out
 * from under. Two bands, two classes, two counts, and the two halves of the gate still agree.
 *
 * @param artifact one ranked open page
 * @returns the line's HTML
 */
function renderOpenArtifact({ artifact, nowIso }: { artifact: BriefingOpenArtifact; nowIso: string }): string {
  const label = `<a href="${escapeAttribute({ text: artifact.url })}">${escapeText({ text: artifact.label })}</a>`;
  // THE AGE, in the words the owner reads it in, exactly as a card carries one. The landing STAMP alone is a
  // clock reading the owner has to subtract from the eyebrow's own to learn the only thing they want: how long this
  // page has been sitting there. The instant travels in the attribute for the same reason a card's does.
  const age =
    `<span class="age" data-landed-iso="${escapeAttribute({ text: artifact.landedIso })}">` +
    `${escapeText({ text: landedAgeLine({ landedIso: artifact.landedIso, nowIso }) })}</span>`;
  const landed = escapeText({ text: stampMelbourne({ iso: artifact.landedIso }) });
  const rank = escapeText({ text: `${String(artifact.rank)}. ` });
  const ask = renderContent({ content: artifact.ask });
  return (
    `<p class="ranked">${rank}${label} — <span class="ask">${ask}</span> ${age} ` +
    `<span class="bg">${landed}</span> ${renderValidity({ validity: artifact.validity })}</p>`
  );
}

/**
 * The ranked index of every open page awaiting the owner's reaction, inside the react-now block.
 *
 * Omitted entirely when nothing is open, for the same reason an empty grouping is: a heading with nothing
 * under it reads as a section the owner might be expected to work through.
 *
 * @param artifacts the ranked index, already numbered from 1
 * @returns the index's HTML lines, empty when nothing is open
 */
export function renderOpenArtifacts({
  artifacts,
  nowIso,
}: {
  artifacts: readonly BriefingOpenArtifact[];
  nowIso: string;
}): readonly string[] {
  if (artifacts.length === 0) {
    return [];
  }
  return [
    `  ${OPEN_ARTIFACTS_HEADING}`,
    `  ${OPEN_ARTIFACTS_CONTRACT}`,
    ...artifacts.map((artifact) => `  ${renderOpenArtifact({ artifact, nowIso })}`),
  ];
}

/**
 * One proposed belief: the line the owner reads, and the fold carrying the words it was read out of.
 *
 * The claim is a SIBLING of the fold rather than the fold's own `<summary>`, and that is mechanical:
 * `../../briefing/text.ts`'s above-fold reader removes a whole `<details>` element, summary included, so a
 * claim written as a summary would be a line the owner meets that no budget can see. The two halves of the gate
 * would then disagree about how long this page is.
 *
 * The proposal id is `<code>` on the visible line rather than folded away, because it is what the owner says back.
 * A block offering three rows and hiding their names would make "the second one, wrong" the only available
 * answer, and that breaks the moment the block re-renders in a different order.
 *
 * @param row one projected proposal
 * @returns the row's HTML: its visible line, the marks, then its fold
 */
function renderOwnerBeliefRow({ row }: { row: BriefingOwnerBeliefsRow }): string {
  const claim = escapeText({ text: row.claim });
  const domain = escapeText({ text: row.domain });
  const id = escapeText({ text: row.proposalId });
  const head = `<p class="q">${claim} <span class="bg">${domain} · <code>${id}</code></span></p>`;
  const marks = `<p class="marks">${OWNER_BELIEF_MARKS}</p>`;
  return `  <div class="belief">${head}${marks}${renderOwnerBeliefDetail({ row })}</div>`;
}

/**
 * One proposal's fold: the owner's own words, how firmly they showed the belief was held, and where they came from.
 *
 * `wrapped` is stated rather than implied. A turn FILE is something a supervisor wrote around the owner's words, so
 * the quote is a span that occurs in the unit and not a sentence the owner is proven to have said — and asking them
 * to correct a belief on that basis without saying so would be asking them to ratify the fleet's own prose.
 */
function renderOwnerBeliefDetail({ row }: { row: BriefingOwnerBeliefsRow }): string {
  const provenance = row.wrapped
    ? "read out of a turn file a supervisor wrote around your words, so the quote is in the record rather than proven to be yours"
    : "read straight out of the tick ledger's own record of what you said";
  const lines = [
    `<p><strong>Your words:</strong> ${linkifyText({ text: row.quote })}</p>`,
    `<p><strong>Held:</strong> ${escapeText({ text: row.held === "stated-confident" ? "confidently" : "loosely, as something to check" })}</p>`,
    `<p class="bg">${escapeText({ text: provenance })}</p>`,
    `<p class="bg">${escapeText({ text: `unit ${row.unitId} · read ${stampMelbourne({ iso: row.reviewedAtIso })}` })}</p>`,
  ].join("");
  return `<details><summary>the words this came from</summary><div>${lines}</div></details>`;
}

/**
 * The correction block: the beliefs waiting on the owner's mark, or nothing at all.
 *
 * Omitted entirely when the queue gave it no open proposals, for the same reason an empty grouping is
 * omitted: a heading with nothing under it reads as a section the owner might be expected to work through, and a
 * queue with nothing open is the state this block is trying to reach.
 *
 * @internal — one block of {@link renderBriefing}'s page; no caller outside this module names it.
 *
 * @param ownerBeliefs the projected block
 * @returns the block's HTML lines, empty when it carries no proposals
 */
export function renderOwnerBeliefs({ ownerBeliefs }: { ownerBeliefs: BriefingOwnerBeliefs }): readonly string[] {
  if (ownerBeliefs.rows.length === 0) {
    return [];
  }
  const notShown =
    ownerBeliefs.notShown === 0
      ? []
      : [
          `  <p class="sub">${escapeText({ text: `${String(ownerBeliefs.notShown)} more waiting — \`slopweaver knowledge propose\` fed them, and answering these brings the next up` })}</p>`,
        ];
  return [
    `  ${OWNER_BELIEFS_HEADING}`,
    `  ${OWNER_BELIEFS_CONTRACT}`,
    ...ownerBeliefs.rows.map((row) => renderOwnerBeliefRow({ row })),
    ...notShown,
  ];
}

/**
 * The react-now block: every card, every directive to another artifact, or the honest empty state.
 *
 * The empty state is now conditional on BOTH being empty, which is the mechanism rather than a nicety. A page
 * that said "nothing open above the line right now" while another artifact held a decision of the owner's would be
 * the exact drift the one-index ruling is about — the briefing claiming to be the index while an artifact it
 * knows about waits unmentioned.
 */
function renderReactNow({ form }: { form: BriefingForm }): readonly string[] {
  const { teamFacing, meFacing, openArtifacts } = form.reactNow;
  // This render's own instant, never a fresh clock read and never a snapshot's: a card's age is how long ago
  // its world was read as the owner opens the page, and `briefing render`'s gate judges the same premise against
  // the same instant. Aged from a day-old list's run, a card read an hour ago sat "in the future" of it.
  const nowIso = form.header.readyIso;
  if (teamFacing.length === 0 && meFacing.length === 0 && openArtifacts.length === 0) {
    return [NOTHING_OPEN];
  }
  const readyTeam = teamFacing.filter(isReady);
  const readyMine = meFacing.filter(isReady);
  // Team-then-me inside the waiting section too, so a card keeps the relative place it would have had.
  // The grouping is audience, not order of importance, and readiness outranks it: a card the owner cannot answer
  // has no first-ness to claim.
  const waiting = [...teamFacing.filter((card) => !isReady(card)), ...meFacing.filter((card) => !isReady(card))];
  const team = renderGrouping({
    cards: readyTeam,
    contract: TEAM_FACING_CONTRACT,
    from: 1,
    heading: TEAM_FACING_HEADING,
    nowIso,
  });
  const mine = renderGrouping({
    cards: readyMine,
    contract: ME_FACING_CONTRACT,
    from: readyTeam.length + 1,
    heading: ME_FACING_HEADING,
    nowIso,
  });
  const held = renderGrouping({
    cards: waiting,
    contract: WAITING_CONTRACT,
    from: readyTeam.length + readyMine.length + 1,
    heading: WAITING_HEADING,
    nowIso,
  });
  // The ranked band is dated from the same render instant as the cards: the open-pages document is read when
  // this page is BUILT, so a page that landed after any earlier instant is still dated against a world that
  // has seen it.
  return [...team, ...mine, ...held, ...renderOpenArtifacts({ artifacts: openArtifacts, nowIso })];
}

/**
 * Whether one card is the owner's to answer now.
 *
 * A named function rather than an inline predicate because it is used four times in one block, and a
 * partition whose two halves are written out separately is a partition that can stop being one.
 *
 * @param card the card to judge
 * @returns true when the card declares itself ready
 */
function isReady(card: BriefingCard): boolean {
  return card.readiness.state === "ready";
}

/**
 * One grouping: its heading, the contract line the renderer owns, and its cards — or nothing at all when the
 * grouping is empty.
 *
 * Omitted rather than rendered empty, for the same reason the retired ranked-list page omitted an empty
 * retrospective: a heading with nothing under it still reads as a section the owner might be expected to work
 * through, and the block's whole job is to be a list of things the owner actually has to react to.
 *
 * @param cards the grouping's cards, in page order
 * @param heading the grouping's own `<h3>`
 * @param contract the audience line under it
 * @param from the 1-based number the first card in this grouping takes, so numbering runs across the block
 * @returns the grouping's HTML lines, empty when it carries no cards
 */
function renderGrouping({
  cards,
  heading,
  contract,
  from,
  nowIso,
}: {
  cards: readonly BriefingCard[];
  heading: string;
  contract: string;
  from: number;
  nowIso: string;
}): readonly string[] {
  if (cards.length === 0) {
    return [];
  }
  return [
    `  ${heading}`,
    `  ${contract}`,
    ...cards.map((card, index) => renderCard({ card, nowIso, position: from + index })),
  ];
}

/**
 * What landed since the owner last looked, folded behind a summary that counts it.
 *
 * The owner keeps this section to know what has actually landed over time, and the formatting
 * was the problem, so it is folded rather than dropped. Folding it is also what makes
 * the react-now cards the only unfolded blocks on the page, which is the arrangement the owner wants: the
 * react-now section is the one they mainly read, so everything else sits below folds.
 *
 * @internal — one block of {@link renderBriefing}'s page; no caller outside this module names it.
 * @param recent the blocks that landed this sweep
 * @returns the section's HTML lines, empty when nothing landed
 */
function renderRecent({ recent }: { recent: readonly BriefingNote[] }): readonly string[] {
  if (recent.length === 0) {
    return [];
  }
  const summary = `${String(recent.length)} landing(s) since you last looked`;
  return [
    `  <details data-section="${RECENT_ID}"><summary>${escapeText({ text: summary })}</summary><div>`,
    ...recent.map((note) => renderNote({ note })),
    "  </div></details>",
  ];
}

/**
 * Render the whole fleet-briefing page.
 *
 * @param form the validated form
 * @returns the exact bytes of the page, chrome included
 */
export function renderBriefing({ form }: { form: BriefingForm }): string {
  // The two projected sections sit below the recent blocks and above the archive: each is a live reading
  // rather than a note about today, so neither may sit inside anything `briefing archive` eventually moves out
  // of the page. Nothing stale first — what the owner owns — then the freshness gauge, then earlier today.
  const below = [form.nothingStale, form.freshness, form.earlierToday].flatMap((section) =>
    section === undefined ? [] : [renderSection({ section })],
  );
  const yourList = form.yourList === undefined ? [] : renderYourList({ header: form.header, list: form.yourList });
  return [
    BRIEFING_CHROME,
    "",
    "<main>",
    `  ${renderEyebrow({ form })}`,
    "  <h1>Fleet Briefing</h1>",
    `  <p class="sub ${LEDE_CLASS}">${renderContent({ content: form.header.lede })}</p>`,
    "",
    // react-now FIRST, and the owner's list below it:
    // what the owner is meant to react to comes first, and nothing sits above it. `../../briefing/shape.ts` reads
    // that back off these bytes, so moving this line is changing the gate.
    `  ${REACT_NOW_HEADING}`,
    ...renderReactNow({ form }),
    // The correction block sits DIRECTLY below react-now, above
    // the owner's own list, because a mark is one word and a row of that list is a piece of work. Nothing goes
    // above react-now itself; `../../briefing/shape.ts` reads that back off these bytes.
    ...renderOwnerBeliefs({ ownerBeliefs: form.ownerBeliefs }),
    // The quiz sits directly under the correction block, because the two are one idea read from opposite
    // ends: what I think YOU believe, then what I believe and do you agree. One question per sweep, so it
    // costs the owner a line rather than a section.
    ...renderQuiz({ quiz: form.quiz }),
    // The hand steps sit directly under the quiz and ABOVE the owner's own list, because they are the one thing on
    // this page nothing here can take for them: every row of that list is work a session could pick up, and
    // every one of these is work that stops until the owner moves. A floating note was once the only surface
    // carrying them, and it sat on screen unclosable for hours.
    ...renderHandSteps({ handSteps: form.handSteps }),
    ...yourList,
    `  ${ALIGNMENT_HEADING}`,
    `  ${renderAlignment({ form })}`,
    // The autonomy ledger sits between what the fleet is doing NOW and what it has already landed, because
    // that is what it is: work already done that the owner may still steer. Below the cards and their list, because
    // nothing outranks what they have to answer; above `done since you last looked`, because unlike that
    // section it is not folded and the owner is meant to read it.
    ...renderAutonomy({ autonomy: form.autonomy }),
    RECENT_HEADING,
    ...renderRecent({ recent: form.recent }),
    ...below,
    ...form.history.map((section) => renderSection({ section })),
    "</main>",
    "",
  ].join("\n");
}
