/**
 * The autonomy ledger's own renderer — every act the fleet took without asking, each with why and its witness.
 *
 * Split out of `./render.ts` for the reason `./quizRender.ts` and `./handStepsRender.ts` were: that file sits
 * at the code-line cap `file-size-ratchet` enforces, and this section is a real seam in it — a heading, a
 * contract line and one row per act, reading one projected section and nothing else on the page.
 *
 * Both renderer-owned strings moved with it. The heading and the contract line are only ever read here, and
 * leaving them behind would have split one section's own words across two files.
 */

import { classifyAutonomySubject } from "../../autonomy/subject.js";
import { type BareRefContext, contextAnchoredToUrls } from "../linkify/bareRefs.js";
import { escapeAttribute, escapeText } from "./escape.js";
import { linkifyText } from "./linkify.js";
import { stampMelbourne } from "./stamp.js";
import { AUTONOMY_ID, type BriefingAutonomy, type BriefingAutonomyRow } from "./types.js";

/**
 * The autonomy ledger's heading and the contract line under it, both of which the RENDERER owns.
 *
 * Owned here rather than composed, the same call the react-now groupings' contract lines make: the line says
 * what the section is FOR — that the owner may disagree with any of it after the fact — and a composer free to
 * reword it could quietly turn a steering surface into a log of things already settled. The owner's ruling is
 * what it states, so the page the owner reads carries the contract rather than only this comment.
 */
const AUTONOMY_HEADING = `<h2 id="${AUTONOMY_ID}">done for you, without asking</h2>`;
const AUTONOMY_CONTRACT =
  '<p class="sub">Each of these was obvious enough to do rather than ask about. Open one to see why, and ' +
  "tell me if you would have wanted it differently — I will record your word against it.</p>";

/**
 * One act: the line the owner reads, and the fold carrying everything that justifies it.
 *
 * The headline is a SIBLING of the fold rather than the fold's own `<summary>`, and that is mechanical:
 * `../../briefing/text.ts`'s above-fold reader removes a whole `<details>` element, summary included, so a
 * headline written as a summary would be a line the owner meets that no budget can see. The two halves of the gate
 * would then disagree about how long this page is.
 *
 * A URL subject is a LINK, never the bare URL and never a bare `#` number —`../../briefing/bareRef.ts` refuses
 * the second and `../../autonomy/label.ts` never produces the third. The witness is `<code>`, because it is
 * usually a command and the line it printed.
 *
 * @param row one projected act
 * @returns the row's HTML: its visible line, then its fold
 */
function renderAutonomyRow({ row }: { row: BriefingAutonomyRow }): string {
  const subject = renderAutonomySubject({ row });
  const when = escapeText({ text: stampMelbourne({ iso: row.doneIso }) });
  const session = escapeText({ text: row.sessionLabel });
  const kind = escapeText({ text: row.kindLabel });
  const steered = row.steer === undefined ? "" : ' <span class="steered">you have steered this</span>';
  const head = `<p class="q">${kind} — ${subject} <span class="bg">${when} · ${session}</span>${steered}</p>`;
  return `  <div class="act">${head}${renderAutonomyDetail({ row })}</div>`;
}

/**
 * The subject on the visible line: a link when it is a URL, escaped `<code>` when it is not.
 *
 * Only a URL arm may become an anchor. A board row slug or a `state:` path in an `href` renders a link that
 * scrolls nowhere — which is worse on this page than plain text, because a link reads as something to
 * follow, and one that goes nowhere teaches the owner to distrust the rest of the section. The full reference is
 * inside the fold either way, so nothing is hidden by declining to link it.
 */
function renderAutonomySubject({ row }: { row: BriefingAutonomyRow }): string {
  const classified = classifyAutonomySubject({ subject: row.subject });
  if (classified?.kind === "url") {
    return `<a href="${escapeAttribute({ text: row.subject })}">${escapeText({ text: row.subjectLabel })}</a>`;
  }
  return `<code>${escapeText({ text: row.subjectLabel })}</code>`;
}

/**
 * One act's fold: what was done in plain words, why it was obvious, what witnesses it, who did it, and the
 * owner's word when one has been given.
 *
 * The plain-words line comes FIRST and carries no label, because it is the only run in here addressed to the
 * owner — everything under it is the fleet writing for the next session. The other order read as
 * unparsable on the console's queue card; the register now refuses a `--said` naming a rule number, a board
 * slug or a session id, which is what makes putting it first worth anything.
 *
 * The said, the why and the owner's steer are PROSE, so they linkify like every other prose run on this page:
 * a why quoting the owner's words verbatim carries whatever URL they typed (a pull-request address, say),
 * and escaping it alone left a bare URL `briefing check` refuses. The subject and witness stay `<code>` —
 * literals shown as recorded.
 *
 * A bare `#` number in that prose resolves against the repository the ACT'S OWN subject names, never a
 * page-wide guess: the page links two repositories, so a page-scoped context holds no single repo, and
 * `briefing check` refused a real render over exactly one such reference, in an act on a
 * slopweaver pull request. Text naming a repository itself wins over the subject, as it does everywhere else.
 */
function renderAutonomyDetail({ row }: { row: BriefingAutonomyRow }): string {
  const prose = ({ text }: { text: string }): string =>
    linkifyText({ context: actRefContext({ subject: row.subject, text }), text });
  const lines = [
    ...(row.said === undefined ? [] : [`<p class="said">${prose({ text: row.said })}</p>`]),
    `<p><strong>Why:</strong> ${prose({ text: row.why })}</p>`,
    `<p><strong>On:</strong> <code>${escapeText({ text: row.subject })}</code></p>`,
    `<p><strong>Witness:</strong> <code>${escapeText({ text: row.witness })}</code></p>`,
    `<p class="bg">${escapeText({ text: `${row.bySession} · act ${row.actionId}` })}${renderAutonomyRun({ row })}</p>`,
    ...(row.steer === undefined ? [] : [`<p><strong>Your steer:</strong> ${prose({ text: row.steer })}</p>`]),
  ].join("");
  return `<details><summary>what happened, and what witnesses it</summary><div>${lines}</div></details>`;
}

/**
 * The repository one act's prose is about: the one its subject's GitHub URL names, replaced by any the prose
 * names itself.
 *
 * @param subject the act's recorded subject
 * @param text the prose being rendered
 * @returns the context a bare reference in that prose resolves against
 */
function actRefContext({ subject, text }: { subject: string; text: string }): BareRefContext {
  const own = contextAnchoredToUrls({ context: { repos: [] }, urls: [subject] });
  return contextAnchoredToUrls({ context: own, urls: [text] });
}

/** The board row an act was taken on, when it names one. */
function renderAutonomyRun({ row }: { row: BriefingAutonomyRow }): string {
  return row.run === undefined ? "" : escapeText({ text: ` · run ${row.run}` });
}

/**
 * The autonomy ledger section: what the fleet did for the owner, newest first, or nothing at all.
 *
 * Omitted entirely when the register gave it no acts, for the same reason an empty grouping is omitted: a
 * heading with nothing under it reads as a section the owner might be expected to work through, and on an install
 * where nothing has been done autonomously there is nothing to steer. A ledger that could not be read never
 * reaches here: the render refuses rather than drawing an empty section that would read as "nothing was done".
 *
 * @internal — one block of {@link renderBriefing}'s page; no caller outside this module names it.
 *
 * @param autonomy the projected section
 * @returns the section's HTML lines, empty when it carries no acts
 */
export function renderAutonomy({ autonomy }: { autonomy: BriefingAutonomy }): readonly string[] {
  if (autonomy.rows.length === 0) {
    return [];
  }
  const notShown =
    autonomy.notShown === 0
      ? []
      : [
          `  <p class="sub">${escapeText({ text: `${String(autonomy.notShown)} earlier act(s) not shown — \`slopweaver autonomy list\` has all of them` })}</p>`,
        ];
  return [
    `  ${AUTONOMY_HEADING}`,
    `  ${AUTONOMY_CONTRACT}`,
    ...autonomy.rows.map((row) => renderAutonomyRow({ row })),
    ...notShown,
  ];
}
