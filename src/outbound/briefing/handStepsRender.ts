/**
 * The hand-steps section's own renderer — every step waiting on the owner's hands, each with its command to copy.
 *
 * Split out of `./render.ts` for the reason `./quizRender.ts` was: that file sits at the code-line cap
 * `file-size-ratchet` enforces, and this section is a real seam in it — a heading, a contract line and one
 * row per open step, reading one projected section and nothing else on the page.
 *
 * ## The command goes through the PASTE block, never a `code` run
 *
 * `./types.ts`'s `BriefingPasteBlock` already carries the measurement: a `code` run is `white-space: nowrap`
 * in this page's chrome, so a command long enough to matter scrolls the whole page sideways and offers
 * nothing to copy. That is the same complaint the owner made about this feature's own surface: a command
 * visible and not takeable. So the row renders the `.paste` element the chrome's
 * one delegated copy listener already knows how to serve, and this renderer composes no button of its own.
 *
 * ## A row with no command still renders
 *
 * Some steps are a click in a console rather than a line in a shell. `../../briefing/handSteps.ts` leaves
 * those rows without a `literal`, and the fold then carries the place and the URL instead. Substituting the
 * settling verb would be handing over the command that CLOSES the step at the moment the owner is looking
 * for the one that DOES it.
 */
import { escapeAttribute, escapeText } from "./escape.js";
import { stampMelbourne } from "./stamp.js";
import { type BriefingHandStepRow, type BriefingHandSteps, HAND_STEPS_ID } from "./types.js";

/**
 * The section's heading and the contract line the RENDERER owns.
 *
 * Owned here rather than composed, the same call every other contract line on this page makes. It states
 * the one thing a reader has to know to use the section: these are the steps the fleet cannot take, and
 * each one's own fold has the exact bytes plus the verb that tells the fleet it is done.
 */
const HAND_STEPS_HEADING = `<h2 id="${HAND_STEPS_ID}">waiting on your hands</h2>`;
const HAND_STEPS_CONTRACT =
  '<p class="sub">Each of these is one step nothing here can take for you. Open a row for the exact command ' +
  "— there is a copy button on it — and the line that tells the fleet it is done.</p>";

/**
 * The paste block for a row's command, or nothing when the step carries none.
 *
 * Hand-built rather than routed through `./render.ts`'s `renderPaste`: that function takes a
 * `BriefingPasteBlock`, which is a member of the composed block vocabulary, and a projected section may not
 * reach into the vocabulary a composer writes with. The `.paste` element's SHAPE is the contract the
 * chrome's copy listener reads, and `unit/briefing/handStepsRender.test.ts` asserts the two renderers still
 * emit the same one.
 */
function renderStepCommand({ row }: { row: BriefingHandStepRow }): string {
  if (row.literal === undefined) {
    return "";
  }
  return renderPasteBlock({ command: row.literal, label: `the command for ${row.id}` });
}

/** One `.paste` element: a label, the copy button the chrome's listener serves, and the bytes. */
function renderPasteBlock({ command, label }: { command: string; label: string }): string {
  return (
    `<div class="paste"><div class="paste-head"><span class="paste-label">${escapeText({ text: label })}</span>` +
    `<button class="paste-copy" type="button">copy</button></div>` +
    `<pre>${escapeText({ text: command })}</pre></div>`
  );
}

/**
 * The step's script, one numbered line each: the sentence, where its value sits on the page, the page, and its
 * one command as a paste block of its own — so two `secrets set` lines are two copy buttons, never one block.
 */
function renderStepChecklist({ row }: { row: BriefingHandStepRow }): string {
  if (row.checklist === undefined) {
    return "";
  }
  const lines = row.checklist.map((item, index) => {
    const find =
      item.find === undefined
        ? ""
        : ` <span class="bg">Find it under: ${escapeText({ text: item.find.join(" › ") })}</span>`;
    const link =
      item.url === undefined
        ? ""
        : ` <a href="${escapeAttribute({ text: item.url })}">${escapeText({ text: item.url })}</a>`;
    const paste =
      item.command === undefined
        ? ""
        : renderPasteBlock({ command: item.command, label: `step ${String(index + 1)} of ${row.id}` });
    return `<li>${escapeText({ text: item.action })}${find}${link}${paste}</li>`;
  });
  return `<ol>${lines.join("")}</ol>`;
}

/**
 * Where the owner does the step: the place the register named, and a link when it named one.
 *
 * Both are optional on the register's own row, so an empty line is a real state rather than a missing
 * field, and nothing is rendered for it.
 */
function renderStepWhere({ row }: { row: BriefingHandStepRow }): string {
  const place = row.where === undefined ? [] : [escapeText({ text: row.where })];
  const link =
    row.url === undefined
      ? []
      : [`<a href="${escapeAttribute({ text: row.url })}">${escapeText({ text: row.url })}</a>`];
  const parts = [...place, ...link];
  if (parts.length === 0) {
    return "";
  }
  return `<p><strong>Where:</strong> ${parts.join(" · ")}</p>`;
}

/**
 * One step's fold: what is waiting on it, where it happens, the command, and how it gets settled.
 *
 * The witness is `code` rather than a second paste block on purpose. It is a line the FLEET runs once the owner
 * says the step is done — two copy buttons on one row would make the wrong one a click away from the right
 * one, on a surface whose whole complaint was that the right thing was hard to take.
 */
function renderStepDetail({ row }: { row: BriefingHandStepRow }): string {
  const lines = [
    `<p><strong>Unblocks:</strong> ${escapeText({ text: row.unblocks })}</p>`,
    renderStepWhere({ row }),
    renderStepCommand({ row }),
    renderStepChecklist({ row }),
    `<p><strong>Settles with:</strong> <code>${escapeText({ text: row.witness })}</code></p>`,
    `<p class="bg">${escapeText({ text: `posted ${stampMelbourne({ iso: row.postedIso })}` })}</p>`,
  ].join("");
  return `<details><summary>the command, and what it unblocks</summary><div>${lines}</div></details>`;
}

/**
 * One step: the line the owner scans, and the fold carrying everything needed to do it.
 *
 * The `what` is a SIBLING of the fold rather than its `<summary>`, the same mechanical reason
 * `./quizRender.ts` gives: `../../briefing/text.ts`'s above-fold reader removes a whole `<details>`
 * element, summary included, so a line written as a summary is one the owner meets that no budget can see.
 */
function renderStepRow({ row }: { row: BriefingHandStepRow }): string {
  // A check-in says so beside its id: it is ranked last (`../../waiting/rank.ts`) and must not read as a
  // step stopping work.
  const checkIn = row.tier === "check-in" ? ` <span class="bg">check-in</span>` : "";
  const head =
    `<p class="q">${escapeText({ text: row.what })} ` +
    `<span class="bg"><code>${escapeText({ text: row.id })}</code></span>${checkIn}</p>`;
  return `  <div class="step">${head}${renderStepDetail({ row })}</div>`;
}

/**
 * The hand-steps section.
 *
 * Omitted entirely when nothing is waiting on the owner — which is the state this feature is TRYING to reach, so
 * a heading standing over an empty section would read as a thing the owner has to work through on exactly the days
 * there is nothing to do. An `unreadable` count is the one thing that renders the section with no rows at
 * all: "no row here, and one line of the register went unread" is a different claim from "nothing is waiting
 * on you", and the second read of the first is the whole defect this feature landed to fix.
 *
 * @param handSteps the projected section
 * @returns the section's HTML lines, empty when no step is open
 */
export function renderHandSteps({ handSteps }: { handSteps: BriefingHandSteps }): readonly string[] {
  if (handSteps.rows.length === 0 && handSteps.unreadable === 0) {
    return [];
  }
  const notShown =
    handSteps.notShown === 0
      ? []
      : [
          `  <p class="sub">${escapeText({ text: `${String(handSteps.notShown)} more step(s) not shown — \`slopweaver hand list\` has all of them` })}</p>`,
        ];
  const unreadable =
    handSteps.unreadable === 0
      ? []
      : [
          `  <p class="sub">${escapeText({ text: `${String(handSteps.unreadable)} register line(s) could not be read, so a step may be open that is not here — \`slopweaver hand list\` names every one of them` })}</p>`,
        ];
  return [
    `  ${HAND_STEPS_HEADING}`,
    `  ${HAND_STEPS_CONTRACT}`,
    ...handSteps.rows.map((row) => renderStepRow({ row })),
    ...notShown,
    ...unreadable,
  ];
}
