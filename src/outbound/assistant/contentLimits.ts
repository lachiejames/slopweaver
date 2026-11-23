/**
 * Measured content caps shared by the outbound artifact form and the assistant's answer form.
 *
 * `../artifact/schema.ts` used to declare every one of these directly. It still does for the caps only IT
 * needs (the above-the-fold index caps) — but the lead/paragraph/bullet/table caps are needed by BOTH the
 * artifact card and `./answerForm.ts`'s `answer` arm, and two independently-drifting copies of the same
 * measurement ("125 / 166 / 170 visible characters") is exactly the kind of duplication that goes stale
 * silently: one copy gets tightened after a new reference message and the other quietly keeps the old ceiling.
 * So this is the one place either of those "125 / 166 / 170" caps is a literal, and `../artifact/schema.ts`
 * now imports and re-exports them so nothing that already imports them from there has to change.
 *
 * Every number here is a MEASUREMENT, cited inline, never an invented round figure — see each constant's own
 * comment for what was measured and against what.
 */

/**
 * The lead/TL;DR is the ONLY content block above the fold on an artifact card, so its length is the entire
 * preview. The three real reference TL;DRs measured 125 / 166 / 170 visible characters; 180 keeps that
 * ceiling with a little room and rejects a 280-character lead outright.
 *
 * **This number is a REUSE of that card measurement, not a measurement of where Slack's own message-length
 * fold fires.** Nobody has measured that boundary — the two are different things that happen to share a
 * ceiling today, and this cap must not be read as evidence for the other.
 */
export const TLDR_VISIBLE_MAX = 180;

/**
 * One paragraph. The reference message the owner judged well formatted has a longest run of ~559 characters;
 * the one they judged an unreadable wall of text is a single 1091-character run. 650 admits the former with room and rejects the latter decisively.
 */
export const PARAGRAPH_VISIBLE_MAX = 650;

/**
 * Total detail prose. A per-paragraph cap alone does not encode the diagnosis — four 590-character
 * paragraphs is 2360 characters of unbroken prose and would pass every individual check.
 *
 * ## What this actually counts, MEASURED
 *
 * "Prose" is narrower than it sounds, and the difference was costing people time: someone whose authored text
 * added up to well under the cap could not see where the overage came from. Counted by
 * {@link "../artifact/visibleLength.js".visibleLengthOfDetail}:
 *
 * - **Counted** — the visible text of every `paragraph` and `bullets` sub-block. That includes each link's
 *   LABEL (a 40-character ticket id costs 40) and each mention, plus any separator text a derivation joined
 *   them with. Measured: three items at 600 characters of prose is exactly 1800, and adding three 40-character
 *   ticket links took it to 1923.
 * - **NOT counted** — `table` sub-blocks, entirely. A table is bounded by rows x columns and per-cell width
 *   instead, because borders and padding would make a perfectly readable ten-row table look verbose. Measured:
 *   ten maximum-width titles and ten maximum-width state cells contribute ZERO here.
 *
 * ## This is the cap that shapes what actually ships, and moving it is the owner's call
 *
 * Measured over the same 25 surviving posted answers {@link BODY_MAX_BLOCKS} names — enumerate
 * them with the `jq` command there, then measure each `body` with `../artifact/visibleLength.js`'s
 * `visibleLengthOfDetail`. FOURTEEN of the 25 land between 1700 and 1800, and the largest is 1793, seven
 * characters of headroom. Answers are being written up to this number and stopping, which the block counts
 * over there do not show at all.
 *
 * That is a finding, NOT a licence to raise it. Every figure in this file is anchored to a message the owner
 * judged by eye — 559 characters well formatted, 1091 an unreadable wall — and nothing measured anywhere says a longer below-the-fold body still reads well to the owner. Doctrine
 * rule 7 cuts both ways: the fold exists so the detail below it CAN be long, and it also says an unexpanded
 * wall is a message the owner will not read. Whoever moves this number brings the owner's ruling with it.
 */
export const DETAIL_PROSE_VISIBLE_MAX = 1800;

/** Bullets: the reference cards carried 7 and 4 items. */
export const BULLETS_MAX_ITEMS = 8;

/** One bullet item stays scannable. */
export const BULLET_ITEM_VISIBLE_MAX = 200;

/** Tables: about three columns and ten rows stay readable; Slack natively allows far more. */
export const TABLE_MAX_COLUMNS = 4;

/** See {@link TABLE_MAX_COLUMNS}. */
export const TABLE_MAX_ROWS = 10;

/** A cell holds a value, not a paragraph. */
export const TABLE_CELL_VISIBLE_MAX = 120;

/**
 * The most DOCUMENTS an `answer` may attach — the deliverable lane, separate from the picture lane.
 *
 * Two, because two is exactly what one deliverable costs under the lane's own markdown-first rule: the
 * markdown a reader can quote from and edit, and the rendered html beside it. A third file is a second
 * deliverable, and a reply carrying two deliverables has stopped being an answer to one question.
 *
 * The picture lane has no count cap, and the difference is the point (there should be no hard size
 * limit: sometimes more pictures make sense and sometimes fewer).
 * A picture is evidence, and how many one claim needs is the composer's judgement; this bounds deliverables
 * per question, which is a shape.
 */
export const ANSWER_DOCUMENTS_MAX = 2;

/**
 * The most sub-blocks an `answer`'s `body` may hold.
 *
 * `DETAIL_PROSE_VISIBLE_MAX` bounds cumulative PROSE across paragraphs and bullets, but excludes tables
 * entirely (they are bounded by rows x columns instead) — so a body of nothing but tables would pass that
 * check while still being unrenderable as a reply. This bounds the block COUNT independently, sized well
 * above any reference answer card built against this schema family (a lead, a couple of paragraphs, one
 * table, a bullet list is 4-5 blocks).
 *
 * **Re-measured after the tagging dogfood filed it as the suspect, and left where it is.**
 * Across the 25 posted answers whose files survive, the block counts are
 * `1 2 2 2 3 3 3 4 4 4 5 5 5 5 5 5 5 6 6 6 6 7 7 7 9` — a median of 5, a maximum of 9, three clear of this
 * ceiling. Reproduce with `jq -r '.answerPath // empty' ~/.slopweaver/live/slack/reviews/[*]/record.json |
 * while read -r p; do [ -f "$p" ] && jq -r 'select(.kind=="answer") | (.body|length)' "$p"; done | sort -n`
 * (that `[*]` is a literal `*`, written this way so the line is not a glob inside a comment).
 *
 * **Read what that sample can and cannot settle.** Those are the answers that SHIPPED, so they are survivors:
 * they prove this cap does not constrain what gets posted, and they say nothing about what a REFUSED draft
 * held. `src/__tests__/subprocess/replay/validateRefusalFinalised.test.ts` is the other half and it points
 * the opposite way — the second tagging draft is frozen there as 13 blocks, one over. Both readings are true
 * at once, and together they name the real shape of the problem rather than a number to raise: an
 * enumerating question ("which of these ten, and who owns each") drafts as one block per item, and 12 is
 * genuinely tight for that.
 *
 * The escape is a TABLE, not a bigger cap — ten rows is ONE block and costs
 * {@link DETAIL_PROSE_VISIBLE_MAX} nothing, which is why `./capGuidance.ts` tells a composer so before it
 * drafts. Raising this number instead would buy a longer wall of paragraphs, which is the thing doctrine
 * rule 7 exists to prevent.
 */
export const BODY_MAX_BLOCKS = 12;

/**
 * A short, scannable evidence line or provenance value — a source's label, a model id, a capability id.
 * Reuses the same ceiling `../artifact/schema.ts` already uses twice for the same kind of line
 * (`INDEX_ITEM_VISIBLE_MAX`, `TABLE_CELL_VISIBLE_MAX`), rather than inventing a third number for the same
 * shape of content.
 */
export const EVIDENCE_LABEL_VISIBLE_MAX = 120;

/**
 * The most skills, verbs, or command-argv tokens a single turn's provenance may list.
 *
 * Measured against `slopweaver catalog`'s own verb count (66 today): no honest single turn loads more than
 * a handful of skills or verbs, so this guards against a degenerate dump rather than constraining real use.
 */
export const EXECUTION_LIST_MAX = 20;

/**
 * The FLOOR under an `answer`'s citation budget — not its ceiling.
 *
 * ## What this number is for, and what it stopped being
 *
 * The argument behind the 12 is about DENSITY: a reply grounded in more than this many distinct sources is
 * not a scannable reply — `BULLETS_MAX_ITEMS` already caps the evidence trail's own "what I read" list at
 * the same order of magnitude, and a citation count far past it would mean the body has more `[n]` chips
 * than a reader can hold at once. That reasoning is about how many chips sit in front of a reader AT ONCE,
 * which is a property of a SHORT answer, and it is still exactly right there.
 *
 * It was wrong as a flat ceiling, and the way it was wrong is the reason this comment exists. The citation rule made the
 * owner's ruling structural: an item naming a compliance control must carry a citation for THAT
 * control in the SAME item (`./citedAndShown.ts`). A ranked answer of sixteen rows therefore OWES sixteen
 * citations — so a flat 12 closed the compliant path to precisely the answers that most need per-row
 * grounding, and `$SLOPWEAVER_HOME/capability-profile.json`'s `github-vulnerability-evidence` row named this
 * constant, by name, as its reason for composing a card by hand instead of going through `turn answer`.
 *
 * So the real budget is `./citedAndShown.ts`'s `citationsCeiling`, which takes the LARGER of this floor and
 * the answer's own checkable-item count — derived from the same `answerItems` walk the per-item rule is
 * checked at, so the obligation and the budget cannot disagree. A flat higher number would have been the
 * same defect one notch along: pick 24 and a 25-row answer hits the identical wall.
 *
 * Unlike every other number in this file, 12 is not a measurement of a message the owner judged by eye — it
 * was reasoned by analogy to `BULLETS_MAX_ITEMS`. That is why it keeps the job that argument supports (a
 * short answer's chip density) and loses the one it was never measured for.
 */
export const CITATIONS_MAX = 12;
