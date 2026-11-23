/**
 * The outbound size caps, stated as instructions to whoever is about to COMPOSE an answer.
 *
 * ## Why this module exists
 *
 * Every number here was already enforced — and told to nobody. Measured on the real-world
 * tagging dogfood, TWO of the first THREE real questions produced an answer over a cap, each refused at
 * `turn resume --answer` validate time, each taking the whole turn down in a public channel. Neither the
 * routing brief nor `turn resume`'s numbered steps mentioned a single one of these constants, so a worker
 * composed blind against a budget nobody had given it. The tag-2 worker recovered only by opening
 * `./answerForm.ts` and grepping `INDEX_MAX_ITEMS` out of the source, mid-turn, in front of the team.
 *
 * So the caps are a BRIEFING INPUT, not just a gate. `../artifact/truncate.ts` closed the other half — a
 * refusal now names what it measured against which limit — but a correction that arrives after the answer is
 * written still costs a whole compose cycle, and this is what makes it unnecessary.
 *
 * ## What is in here, and what deliberately is not
 *
 * Only caps the `answer` arm ACTUALLY enforces, each read from the one constant that enforces it, so a line
 * here cannot drift from the check it describes. Nothing is restated as a literal.
 *
 * `STRUCTURE_REQUIRED_VISIBLE_THRESHOLD` is absent on purpose: `checkDetailWhole` applies it to
 * `updateArtifactSchema`'s operator card, never to the `answer` arm, and briefing a worker on a rule that
 * will not be applied to its answer is the same information defect in the other direction.
 */
import { ABOVE_FOLD_VISIBLE_MAX, INDEX_ITEM_VISIBLE_MAX, INDEX_MAX_ITEMS } from "../artifact/schema.js";
import {
  ANSWER_DOCUMENTS_MAX,
  BODY_MAX_BLOCKS,
  BULLET_ITEM_VISIBLE_MAX,
  BULLETS_MAX_ITEMS,
  CITATIONS_MAX,
  DETAIL_PROSE_VISIBLE_MAX,
  PARAGRAPH_VISIBLE_MAX,
  TABLE_CELL_VISIBLE_MAX,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  TLDR_VISIBLE_MAX,
} from "./contentLimits.js";

/** `value`, rendered for a guidance line. */
function n({ value }: { value: number }): string {
  return String(value);
}

/**
 * The exact lines a composing session is given about what its answer form may hold — printed by the routing
 * brief and by `turn resume`'s LOAD mode, so the budget arrives BEFORE the answer is written rather than as
 * a refusal after it.
 *
 * Pure and zero-argument: every figure comes from the constant that enforces it, so this can never state a
 * number the door does not actually check.
 *
 * @returns the lines, in order, ready to print
 */
export function answerFormCapLines(): readonly string[] {
  return [
    "OUTBOUND SIZE CAPS — compose to these; `turn resume --answer` REFUSES the whole form past any of them,",
    "and refusing is the point: it never silently trims. The constant's name is given so you can read the",
    "measurement behind a number (`src/outbound/assistant/contentLimits.ts`) instead of guessing at it.",
    `  lead        ≤ ${n({ value: TLDR_VISIBLE_MAX })} visible chars (TLDR_VISIBLE_MAX) — the entire preview; never truncated, always refused`,
    `  index       ≤ ${n({ value: INDEX_MAX_ITEMS })} lines (INDEX_MAX_ITEMS), each ≤ ${n({ value: INDEX_ITEM_VISIBLE_MAX })} visible chars (INDEX_ITEM_VISIBLE_MAX),`,
    `              and lead + index ≤ ${n({ value: ABOVE_FOLD_VISIBLE_MAX })} visible chars all together (ABOVE_FOLD_VISIBLE_MAX)`,
    `  body        ≤ ${n({ value: BODY_MAX_BLOCKS })} sub-blocks (BODY_MAX_BLOCKS), and ≤ ${n({ value: DETAIL_PROSE_VISIBLE_MAX })} visible chars of PROSE`,
    "              (DETAIL_PROSE_VISIBLE_MAX — paragraphs and bullets only; table cells cost nothing here)",
    `  paragraph   ≤ ${n({ value: PARAGRAPH_VISIBLE_MAX })} visible chars each (PARAGRAPH_VISIBLE_MAX)`,
    `  bullets     ≤ ${n({ value: BULLETS_MAX_ITEMS })} items per block (BULLETS_MAX_ITEMS), each ≤ ${n({ value: BULLET_ITEM_VISIBLE_MAX })} visible chars (BULLET_ITEM_VISIBLE_MAX)`,
    `  table       ≤ ${n({ value: TABLE_MAX_COLUMNS })} columns x ${n({ value: TABLE_MAX_ROWS })} rows (TABLE_MAX_COLUMNS/TABLE_MAX_ROWS), each cell ≤ ${n({ value: TABLE_CELL_VISIBLE_MAX })} visible chars`,
    "              (TABLE_CELL_VISIBLE_MAX)",
    `  citations   ≤ the LARGER of ${n({ value: CITATIONS_MAX })} (CITATIONS_MAX) and this answer's own item count — one item is one`,
    "              paragraph, one bullet, one TABLE ROW or one index line. So a sixteen-row ranked table may",
    "              ground all sixteen rows, and a one-paragraph answer still gets twelve. Every citation must",
    "              be referenced by a [n] chip and every chip must resolve.",
    "              A COMPLIANCE CONTROL named in an item owes a citation in that SAME item, so the two rules",
    "              still collide where the naming is DENSE — a dozen-plus controls inside one paragraph is one",
    "              item and earns only the floor. Give each its own row and each earns a citation; if the list",
    '              genuinely cannot be split, `slopweaver hatch open uncited-controls --reason "<why>"` is a',
    "              journalled 30-minute grant.",
    "  images      no count cap — as many as the evidence earns: a picture where it carries what text cannot,",
    "              none that repeats the text (VISUAL EVIDENCE below)",
    `  documents   ≤ ${n({ value: ANSWER_DOCUMENTS_MAX })} (ANSWER_DOCUMENTS_MAX), each .md/.markdown/.html/.htm — the DELIVERABLE lane.`,
    "              A file on this machine is not a deliverable to anybody else, so attach it here rather than",
    "              naming its path; markdown first, the rendered html second.",
    "  A link's LABEL counts toward every width it sits in. Tables are the cheap way to carry a long list:",
    "  they cost body blocks and rows, never prose. A three-part question fits by putting the outcome above",
    "  the fold and the evidence in fewer, denser blocks below it — not by writing less.",
  ];
}
