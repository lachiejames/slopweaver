/**
 * The two answer-shape rules a bot message that SHOWS SEVERAL THINGS meets: every compliance control it
 * names carries a citation naming THAT control, and a composed message naming several things is asked which
 * of them a picture would show better than text.
 *
 * ## The ruling, and why neither of these is a review note
 *
 * A bot answer in the owner's own DM listed five ISO "easiest wins" across nine control ids. It should have
 * cited which control each item referred to, and it should have carried screenshots for five different quick
 * wins; it was not ready to post without both, and the same applies to any message. The rule is to make a
 * repeat **structurally impossible**, which under doctrine rule 7 means the SCHEMA refuses it and never a
 * reviewer.
 *
 * The rejected answer is the exact fixture both rules are calibrated against, and it is worth stating
 * what it did wrong, because both failures read as fine at a glance. It defined ONE citation — the controls
 * INDEX — and referenced it from its opening paragraph only, while a five-row table beneath named nine
 * different controls and cited nothing at all. Every claim in the table was uncited, and the one citation
 * present made the answer LOOK grounded. It carried no image either.
 *
 * ## Rule one: an item that names a control cites that control
 *
 * Checked per ITEM, not per answer — a paragraph, one bullet, one table ROW, one index line. Row
 * granularity is the whole point for a table: a citation chip in the row's last cell grounds that row, and
 * the failure being closed is precisely a table whose rows collapse onto one reference in a different block.
 *
 * A citation NAMES a control two ways, both machine-checkable and neither a guess:
 *
 *  - `sourceRef: { source: …, id: "HRS-52" }` — the explicit route, and what `sourceRef` has always been
 *    for. Available even where nothing knows the control's URL.
 *  - its `url` equals the URL the caller's own control table gives for that id. This is the natural route:
 *    a composer citing the control's own page satisfies the rule without thinking about it.
 *
 * A control the caller's table does not hold is not checked at all, for the same reason
 * `../linkify/bareRefs.ts` cannot refuse one: it was never recognised as a control.
 *
 * ## Rule two: several things asks one question, and the session answers it
 *
 * "Several" is the count of DISTINCT references the message names — controls, Linear keys, GitHub numbers
 * alike — because those are the "different things" a reader is being shown, and a rule counting table rows would
 * fire on a two-column comparison that shows nothing. {@link SHOWN_ITEMS_MIN_REFS} is three: not necessarily
 * five screenshots but at least a few, so three named things is where the question is owed.
 *
 * **It is a QUESTION, not a gate.** What deserves a screenshot cannot be predicted ahead of time, so judgement
 * under graduated autonomy beats a hard gate. {@link
 * pictureJudgement} holds such a message ONCE with {@link UNSHOWN_ITEMS_QUESTION}. The session attaches the
 * picture that shows something text cannot, or states why none does, and that reason is recorded on the
 * send's door-ledger row. What the rejected answer did wrong survives the change: it never asked. How MANY
 * pictures is the same judgement and has no cap.
 *
 * It runs on a message a SESSION composed — the answer form, and a card posted from an `update` form — and
 * never on a card a scheduled job derived, which has no session to answer it. `../../cli/citedControlsDoor.ts`
 * carries that measurement.
 */
import type { Citation, DetailBlock, InlineRun } from "../artifact/types.js";
import { type BareRefContext, type BareRefIssue, scanBareRefs } from "../linkify/bareRefs.js";
import { CITATIONS_MAX } from "./contentLimits.js";

/** The journalled hatch for rule one: send an answer whose controls are named but not cited, unchanged. */
export const CONTROL_CITATION_HATCH = "uncited-controls";

/**
 * How many distinct references make a message one that SHOWS several things, and therefore asks
 * {@link UNSHOWN_ITEMS_QUESTION}. Three, from "at least a few" — see this file's rule-two section.
 *
 * @internal
 */
export const SHOWN_ITEMS_MIN_REFS = 3;

/**
 * The longest reason a session may give for attaching no picture. A reason is one or two sentences read back
 * off a ledger row; anything longer is an essay arguing with the question rather than answering it.
 */
export const NO_PICTURE_REASON_MAX = 280;

/**
 * One checkable unit of an answer: the runs a reader takes in together, and where to point a refusal.
 *
 * @internal — exported so `./measuredFigures.ts` checks its own obligation over the SAME units this file does.
 */
export interface AnswerItem {
  readonly runs: readonly InlineRun[];
  readonly path: readonly (string | number)[];
}

/** The runs of one block, grouped the way a READER groups them — a table by row, never by cell. */
function itemsOfBlock({ block, index }: { block: DetailBlock; index: number }): readonly AnswerItem[] {
  if (block.type === "paragraph") {
    return [{ path: ["body", index], runs: block.runs }];
  }
  if (block.type === "bullets" || block.type === "list") {
    return block.items.map((runs, item) => ({ path: ["body", index, item], runs }));
  }
  return block.rows.map((row, rowIndex) => ({ path: ["body", index, "rows", rowIndex], runs: row.flat() }));
}

/**
 * Every checkable item of an answer, body then index, each with the path a refusal points at.
 *
 * THE definition of an item, and the reason it is exported: {@link citationsCeiling} reads this walk so the
 * citation budget and the per-item obligation cannot disagree, and `./measuredFigures.ts` reads it for the same
 * reason. A second walk somewhere else is the drift this file's own comments exist to prevent.
 *
 * @param body the answer's detail blocks
 * @param index the answer's above-the-fold lines
 * @returns one item per paragraph, bullet, table row and index line, in reading order
 */
export function answerItems({
  body,
  index,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
}): readonly AnswerItem[] {
  return [
    ...body.flatMap((block, blockIndex) => itemsOfBlock({ block, index: blockIndex })),
    ...index.map((runs, line) => ({ path: ["index", line] as readonly (string | number)[], runs })),
  ];
}

/**
 * The most citations one answer may define — the LARGER of the flat floor and its own item count.
 *
 * ## Why this is derived rather than a number
 *
 * {@link uncitedControlIssues} below demands a citation PER ITEM. A flat ceiling therefore cannot be raised
 * high enough to be right: whatever number it holds, an answer with one more item than that owes one more
 * citation than it is allowed, and the compliant path closes on exactly the ranked, per-row-grounded answers
 * the rule exists to produce. The measured consequence was a written bypass — `capability-profile.json`'s
 * `github-vulnerability-evidence` row composed a card by hand rather than go through `turn answer`, naming
 * `CITATIONS_MAX` as its reason (a ranked list of alerts, one row each, outgrew the cap of 12).
 *
 * So the budget reads from the SAME {@link answerItems} walk the obligation is checked at. The two cannot
 * drift apart, because there is one definition of "item" and both call it.
 *
 * ## Why the floor stays, and why this is still bounded
 *
 * `CITATIONS_MAX` keeps the density argument its own comment makes: a one-paragraph answer grounded in five
 * sources is one item and five citations, which is fine and which a bare item count would newly refuse. It
 * is a floor on a SHORT answer, not a ceiling on a ranked one.
 *
 * Nothing new bounds the top, because nothing needs to. Every term is an existing measured cap:
 * `BODY_MAX_BLOCKS` blocks, each at most `TABLE_MAX_ROWS` rows, plus `INDEX_MAX_ITEMS` index lines. And
 * `./answerBodyChecks.ts`'s `checkCitations` already refuses a citation no run cites, so a citation that
 * exists must be chipped inside an item that exists.
 *
 * @param body the answer's detail blocks
 * @param index the answer's above-the-fold lines
 * @returns the most citations the answer may define
 */
export function citationsCeiling({
  body,
  index,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
}): number {
  // The paths are discarded here — only the COUNT matters — but the walk is shared on purpose, so the budget
  // and `uncitedControlIssues`' obligation can never disagree about what one item is.
  return Math.max(CITATIONS_MAX, answerItems({ body, index }).length);
}

/**
 * The visible text of one run sequence, link labels included.
 *
 * A link's LABEL matters as much as a bare text run here: once `../linkify/bareRefs.ts` has done its pass,
 * `HRS-52` is a `link` run, and a rule that read only `text` runs would stop seeing exactly the controls a
 * well-formed answer names.
 */
function visibleTextOf({ runs }: { runs: readonly InlineRun[] }): string {
  return runs
    .map((run) => {
      if (run.type === "text") {
        return run.text;
      }
      return run.type === "link" ? run.label : "";
    })
    .join(" ");
}

/** Every control id named in one run sequence, in first-appearance order, without repeats. */
function controlsNamedIn({
  runs,
  context,
}: {
  runs: readonly InlineRun[];
  context: BareRefContext;
}): readonly string[] {
  const named: string[] = [];
  for (const span of scanBareRefs({ context, text: visibleTextOf({ runs }) })) {
    if (span.kind === "controlId" && !named.includes(span.id)) {
      named.push(span.id);
    }
  }
  return named;
}

/** Whether one citation names one control — by explicit `sourceRef`, or by being that control's own page. */
function citationNamesControl({
  citation,
  controlId,
  context,
}: {
  citation: Citation;
  controlId: string;
  context: BareRefContext;
}): boolean {
  if (citation.sourceRef?.id === controlId) {
    return true;
  }
  // No control table in the context (an install with no compliance atlas), no entry for this id, or an entry
  // whose provider gave no page (`url: null`, Vanta's normal case): no URL a citation could match.
  const { complianceControls } = context;
  if (complianceControls === undefined) {
    return false;
  }
  const url = complianceControls.find((entry) => entry.id === controlId)?.url;
  if (url == null) {
    return false;
  }
  return citation.url === url;
}

/** One control named in one item with nothing in that item saying which control it is. */
interface UncitedControlMention {
  readonly controlId: string;
  readonly path: readonly (string | number)[];
}

/**
 * Every uncited control MENTION, which is the reduction both public rule-one functions are built from.
 *
 * One control can be uncited in several items, so this is deliberately not a set: {@link
 * uncitedControlIssues} owes one refusal per ITEM (that is where a composer has to put the chip), while
 * {@link citationBudgetCollision} owes a count of DISTINCT controls (that is what costs citation slots).
 * Computing both from one scan is what keeps them from disagreeing about what is uncited.
 */
function uncitedControlMentions({
  body,
  index,
  citations,
  context,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  citations: readonly Citation[];
  context: BareRefContext;
}): readonly UncitedControlMention[] {
  const mentions: UncitedControlMention[] = [];
  for (const item of answerItems({ body, index })) {
    const cited = item.runs
      .filter((run) => run.type === "citation")
      .map((run) => citations.find((citation) => citation.id === run.citationId))
      .filter((citation) => citation !== undefined);
    for (const controlId of controlsNamedIn({ context, runs: item.runs })) {
      if (cited.some((citation) => citationNamesControl({ citation, context, controlId }))) {
        continue;
      }
      mentions.push({ controlId, path: item.path });
    }
  }
  return mentions;
}

/**
 * Every control an answer names without citing it in the same item.
 *
 * @param body the answer's detail blocks, already linkified
 * @param index the answer's above-the-fold lines, already linkified
 * @param citations the answer's citation definitions
 * @param context the same context the bare-reference pass used, so both agree on what a control even is
 * @returns one issue per uncited control mention, in reading order
 */
export function uncitedControlIssues({
  body,
  index,
  citations,
  context,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  citations: readonly Citation[];
  context: BareRefContext;
}): readonly BareRefIssue[] {
  return uncitedControlMentions({ body, citations, context, index }).map((mention) => ({
    message:
      `${JSON.stringify(mention.controlId)} is named here with no citation saying which control it is — add a ` +
      `[n] chip in this same item pointing at a citation whose url is ${mention.controlId}'s own page, or whose ` +
      `sourceRef.id is ${JSON.stringify(mention.controlId)}. A citation elsewhere in the message does not ground ` +
      "this claim.",
    path: mention.path,
  }));
}

/**
 * Why rule one and this answer's citation BUDGET cannot BOTH be satisfied, or undefined when they can.
 *
 * ## The failure this closes, MEASURED
 *
 * Rule one demands a citation per distinct control and the budget caps how many citations may be defined —
 * so past that many controls the two rules are mutually exclusive, and a composer was told neither that nor
 * which way out. Driven through the real `parseAnswerArm` with thirteen controls the Vanta
 * atlas holds: thirteen citations answers `citations: Too big: expected array to have <=12 items`, twelve
 * answers `"DCH-47" is named here with no citation…`, and NEITHER message mentions that the other exists.
 *
 * ## What {@link citationsCeiling} did and did not change about it
 *
 * That measurement was taken against a FLAT budget of {@link CITATIONS_MAX}, and the budget is now the
 * larger of that floor and the answer's own item count — so the shape above no longer collides: thirteen
 * controls spread over thirteen rows is thirteen items, which earns thirteen citations.
 *
 * What survives is the DENSE case, and it survives because the budget counts items rather than mentions.
 * Thirteen controls named inside ONE paragraph is one item, so it still earns only the floor's twelve and
 * the two rules still cannot both be met. That is the residue rather than the whole class, and it is why
 * this function reads the derived ceiling instead of the constant: hard-coding 12 here would claim a wall
 * that a ranked answer no longer has.
 *
 * Reproduce by parsing an `answer` form naming N controls with N chips INSIDE ONE paragraph, for N of 12
 * and 13.
 *
 * The way through is the JOURNALLED hatch rather than a bigger floor: `hatch open uncited-controls` records
 * a grant naming the session and expiring in 30 minutes, which is a trace the ambient variable does not
 * leave. Naming it here is the rule applied — a refusal that does not say why is not useful to an
 * agent.
 *
 * @param body the answer's detail blocks, already linkified
 * @param index the answer's above-the-fold lines, already linkified
 * @param citations the answer's citation definitions
 * @param context the same context the bare-reference pass used
 * @returns the sentence naming the collision and the journalled way through, or undefined
 */
export function citationBudgetCollision({
  body,
  index,
  citations,
  context,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  citations: readonly Citation[];
  context: BareRefContext;
}): string | undefined {
  const distinct = [
    ...new Set(uncitedControlMentions({ body, citations, context, index }).map((mention) => mention.controlId)),
  ];
  const ceiling = citationsCeiling({ body, index });
  const needed = citations.length + distinct.length;
  if (distinct.length === 0 || needed <= ceiling) {
    return undefined;
  }
  return (
    `these two rules cannot both be satisfied by this answer: citing each of the ${String(distinct.length)} ` +
    `uncited control(s) above needs ${String(needed)} citations in total, and this answer earns ` +
    `${String(ceiling)} — the budget is the larger of ${String(CITATIONS_MAX)} (CITATIONS_MAX, ` +
    "src/outbound/assistant/contentLimits.ts) and the answer's own paragraph/bullet/table-row/index-line " +
    "count, so naming these controls in separate ROWS rather than in one item buys a citation each. Or say " +
    "less in one " +
    "message — split the ranked list, or name fewer controls — or take the journalled way through with " +
    '`slopweaver hatch open uncited-controls --reason "<why this list cannot be shorter>"`, which records a ' +
    "grant naming this session and expires in 30 minutes."
  );
}

/** Every distinct reference an answer names, of any kind, in first-appearance order. */
function referencesNamedIn({
  body,
  index,
  context,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  context: BareRefContext;
}): readonly string[] {
  const named: string[] = [];
  for (const item of answerItems({ body, index })) {
    for (const span of scanBareRefs({ context, text: visibleTextOf({ runs: item.runs }) })) {
      if (!named.includes(span.raw)) {
        named.push(span.raw);
      }
    }
  }
  return named;
}

/** The one question a composed message naming several things with no picture is held on. */
export const UNSHOWN_ITEMS_QUESTION = "which of these would a picture show better than text?";

/**
 * What rule two decided about one composed message.
 *
 * - `clear` — nothing owed: fewer than {@link SHOWN_ITEMS_MIN_REFS} distinct things, or a picture attached.
 * - `held` — owed and unanswered: the session is asked {@link UNSHOWN_ITEMS_QUESTION} once.
 * - `answered` — owed, and the session said why no picture adds value; the door records `reason` on the
 *   send's ledger row as an `unshown-items` acknowledgement.
 * - `unasked` — a reason was given where nothing was owed, so there is no decision to record.
 */
export type PictureJudgement =
  | { readonly kind: "clear" }
  | { readonly kind: "held"; readonly message: string }
  | { readonly kind: "answered"; readonly reason: string }
  | { readonly kind: "unasked"; readonly message: string };

/**
 * Judge one composed message against rule two, which is a QUESTION a session answers rather than a gate.
 *
 * What deserves a picture cannot be predicted before a free-form investigation, so a rule
 * fixed in advance picks low-value pictures, and a session using judgement need not meet a strict gate. So
 * three or more distinct things with no picture is held ONCE with {@link UNSHOWN_ITEMS_QUESTION}, and the
 * session either attaches the picture its answer names or says why none adds value. Both are fine outcomes;
 * the only defect is not having asked. The reason goes on the send's ledger row, so a session that always
 * answers "none" is findable afterwards rather than hidden behind an ambient hatch.
 *
 * A reason on a message that owes nothing is refused rather than dropped: the door would otherwise record a
 * waiver for a rule that never fired, which reads in the ledger exactly like a real one
 * (`../../admit/types.ts`'s `AcknowledgeableSubject` names that caller invariant).
 *
 * @param body the message's detail blocks, already linkified
 * @param index the message's above-the-fold lines, already linkified
 * @param pictureCount how many pictures the send attaches, from every lane it can attach through
 * @param reason the session's answer to the question, when it gave one
 * @param remedy how THIS door spells giving that answer — a form field or a CLI flag
 * @param context the same context the bare-reference pass used
 * @returns the judgement
 */
export function pictureJudgement({
  body,
  index,
  pictureCount,
  reason,
  remedy,
  context,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  pictureCount: number;
  reason: string | undefined;
  remedy: string;
  context: BareRefContext;
}): PictureJudgement {
  const named = referencesNamedIn({ body, context, index });
  const owed = pictureCount === 0 && named.length >= SHOWN_ITEMS_MIN_REFS;
  if (!owed) {
    if (reason === undefined) {
      return { kind: "clear" };
    }
    const why =
      pictureCount > 0
        ? "it already attaches a picture"
        : `it names ${String(named.length)} distinct thing(s), under the ${String(SHOWN_ITEMS_MIN_REFS)} that ask it`;
    return {
      kind: "unasked",
      message: `${remedy} answers a question this message was not asked — ${why} — so there is nothing to record. Remove it.`,
    };
  }
  if (reason !== undefined) {
    return { kind: "answered", reason };
  }
  return {
    kind: "held",
    message:
      `this message names ${String(named.length)} different things (${named.join(", ")}) and attaches no ` +
      `picture: ${UNSHOWN_ITEMS_QUESTION} Attach that one — \`slopweaver browser shot\` takes it — or, if ` +
      `none would show a reader anything the text does not, say why with ${remedy}; the reason is recorded ` +
      "on this send's door-ledger row. This is a judgement you make once per message, not a count.",
  };
}
