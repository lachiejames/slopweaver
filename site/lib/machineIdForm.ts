/**
 * The form a queue card must pass before a panel may draw it: no text it draws carries a raw machine id.
 *
 * The owner does not read IDs: they are machine-friendly, not human-friendly. The source line names the session by
 * the run it held, its id behind the hover (`./sourceBlock.ts`). This is the schema half of `AGENTS.md` rule 7 for the same
 * defect anywhere else on a card: a card whose drawn text carries a session, call, talk, turn or run id
 * (`./machineIds.ts`) is REFUSED, never drawn with the id in it — so a session that writes one into a field it
 * records learns at once, rather than the owner reading it.
 *
 * What it reads is the prose a session WRITES: a briefing card's question, what, problem, why you, stakes, options,
 * lean, if silent, examples and head context; a step card's question, what, checklist, rows and decision; and the source block's
 * line, why line and unread-steer lines. Never an address — a step's go-to, open, where and cites rows, or a URL
 * inside prose — because the panel draws one as a link and an id behind a link is allowed. Never the owner's quoted words — the
 * record's, verbatim, and rewriting them is the one thing a card must never do — and never a subject, a command or a
 * copy block, which are the thing the owner pastes or the key a card is found by. The refusal names the FIELD and never quotes the id, because it is drawn to the owner too.
 *
 * Pure: a card and its source in, a form out.
 */
import type { QueueCardForm } from "./briefingCardForm";
import { carriesMachineId, withoutMachineIds } from "./machineIds";
import type { BriefingCard, CardStakes, QueueCard, StepCard, StepRowLabel } from "./queueCard";
import type { CardSource, UnsteeredOrigin } from "./queueCardSource";
import type { QueueRow } from "./queueRows";
import { withLeadsMapped } from "./quotedReason";
import { sourceBlockCopy } from "./sourceBlock";

/** One drawn field: what the refusal calls it, and its text. */
interface DrawnField {
  readonly field: string;
  readonly text: string | undefined;
}

/**
 * A stakes row's three lines, whichever register stated them.
 *
 * @returns the lines, empty when the card states none
 */
function stakesTexts({ stakes }: { stakes: CardStakes | undefined }): readonly string[] {
  if (stakes === undefined) {
    return [];
  }
  if (stakes.kind === "stated") {
    return [stakes.risk, stakes.blastRadius, stakes.stillReal];
  }
  return [stakes.risk, stakes.blastRadius, stakes.status];
}

/**
 * Every field a briefing card draws in prose a session wrote.
 *
 * @returns the fields, in the order the card draws them
 */
function briefingFields({ card }: { card: BriefingCard }): readonly DrawnField[] {
  let scenes: readonly string[] = [];
  if (card.examples?.kind === "scenes") {
    scenes = card.examples.scenes;
  }
  if (card.examples?.kind === "gap") {
    scenes = [card.examples.line];
  }
  return [
    { field: "context line", text: card.head?.context },
    { field: "question", text: card.question },
    ...scenes.map((text) => ({ field: "example", text })),
    { field: "what", text: card.what?.whole },
    { field: "problem", text: card.problem },
    { field: "why you", text: card.whyYou },
    ...stakesTexts({ stakes: card.stakes }).map((text) => ({ field: "stakes", text })),
    ...card.options.flatMap((option) => [
      { field: `option ${option.letter}`, text: option.sentence },
      { field: `option ${option.letter}`, text: option.tradeoff },
    ]),
    { field: "lean", text: card.lean },
    { field: "if silent", text: card.ifSilent },
  ];
}

/**
 * Every field a step card draws in prose its step or its ask recorded.
 *
 * @returns the fields, in the order the card draws them
 */
function stepFields({ card }: { card: StepCard }): readonly DrawnField[] {
  const decision = card.decision;
  let decided: readonly DrawnField[] = [];
  if (decision !== undefined) {
    decided = [
      { field: "summary", text: decision.summary },
      { field: "problem", text: decision.problem },
      ...stakesTexts({ stakes: decision.stakes }).map((text) => ({ field: "stakes", text })),
      ...decision.options.flatMap((option) => [
        { field: `option ${option.letter}`, text: option.sentence },
        { field: `option ${option.letter}`, text: option.tradeoff },
      ]),
      { field: "lean", text: decision.lean },
    ];
  }
  let checklist: readonly DrawnField[] = [];
  if (card.checklist !== undefined) {
    checklist = card.checklist.flatMap((line) => {
      let find: readonly string[] = [];
      if (line.find !== undefined) {
        find = line.find;
      }
      return [line.action, ...find].map((text) => ({ field: "checklist", text }));
    });
  }
  return [
    { field: "question", text: card.question },
    { field: "what", text: card.what.whole },
    ...checklist,
    ...card.rows
      .filter((row) => !ADDRESS_ROWS.has(row.label))
      .map((row) => ({ field: `"${row.label}" row`, text: row.value })),
    ...decided,
  ];
}

/** The step rows that hold an address the panel draws as a link — an id inside one is behind that link. */
const ADDRESS_ROWS: ReadonlySet<StepRowLabel> = new Set<StepRowLabel>(["cites", "go to", "open", "where"]);

/**
 * Every line the source block draws that is not the owner's words.
 *
 * @returns the fields, in the order the block draws them
 */
function sourceFields({ source }: { source: CardSource }): readonly DrawnField[] {
  const copy = sourceBlockCopy({ source });
  let steerLines: readonly string[] = [];
  if (copy.steers !== undefined) {
    // An unread steer's own reason, where one is apart from its line, is the fold's and never scanned (steer 7).
    steerLines = [...copy.steers.placed.map((steer) => steer.line), ...copy.steers.unplaced.map((steer) => steer.line)];
  }
  return [
    { field: "source line", text: copy.line },
    ...steerLines.map((text) => ({ field: "source line", text })),
    { field: "why-this-is-in-front-of-you line", text: copy.bearsOn },
  ];
}

/**
 * Whether a card may be drawn: refused, naming the first field whose text carries a raw machine id.
 *
 * @param card the built card
 * @param source where it came from, whose block the expanded card leads with
 * @returns `drawn`, or the refusal
 */
export function machineIdForm({ card, source }: { card: QueueCard; source: CardSource }): QueueCardForm {
  let fields: readonly DrawnField[];
  if (card.kind === "briefing") {
    fields = briefingFields({ card });
  } else {
    fields = stepFields({ card });
  }
  const carrying = [...fields, ...sourceFields({ source })].find(
    ({ text }) => text !== undefined && carriesMachineId({ text }),
  );
  if (carrying === undefined) {
    return { kind: "drawn" };
  }
  return {
    kind: "refused",
    why:
      `This card's ${carrying.field} names a session, call, talk, turn or run by its machine id, so it is refused ` +
      "rather than drawn. A card names it by what it was doing, with the id behind a link or a hover at most.",
  };
}

/**
 * A card refused by {@link machineIdForm}, with each id hidden in the text that still names it — its question (the
 * title the held note and the chair's report print, `./queueWithholding.ts`), its head's context line and its source
 * block's own sentences, which an act on the Alignment page still draws. Hiding the id there keeps the refusal from
 * showing what it refused. The owner's quoted words are never touched.
 *
 * @param card the built card
 * @param source where it came from
 * @returns the card and source, each id in those fields replaced by `[id hidden]`
 */
export function machineIdsHidden({ card, source }: { card: QueueCard; source: CardSource }): {
  readonly card: QueueCard;
  readonly source: CardSource;
} {
  let hiddenCard: QueueCard = { ...card, question: withoutMachineIds({ text: card.question }) };
  if (hiddenCard.kind === "briefing" && hiddenCard.head?.context !== undefined) {
    hiddenCard = {
      ...hiddenCard,
      head: { ...hiddenCard.head, context: withoutMachineIds({ text: hiddenCard.head.context }) },
    };
  }
  let hiddenSource = source;
  if (source.kind === "words" && source.bearsOn !== undefined) {
    hiddenSource = { ...source, bearsOn: withoutMachineIds({ text: source.bearsOn }) };
  }
  if (source.kind === "none" || source.kind === "unrecorded") {
    hiddenSource = { ...source, origin: withoutMachineIds({ text: source.origin }) };
  }
  if (source.kind === "standing" || source.kind === "standing-pending") {
    hiddenSource = { ...source, immediate: unsteeredHidden({ origin: source.immediate }) };
  }
  if (source.kind === "standing-missing") {
    hiddenSource = {
      ...source,
      immediate: unsteeredHidden({ origin: source.immediate }),
      // Only the console's words: a quoted read's own reason is folded under "Full message", never rewritten.
      why: withLeadsMapped({ lead: (words) => withoutMachineIds({ text: words }), reason: source.why }),
    };
  }
  return { card: hiddenCard, source: hiddenSource };
}

/** Where an unsteered card came from, each id in its origin text hidden. */
function unsteeredHidden({ origin }: { origin: UnsteeredOrigin }): UnsteeredOrigin {
  if (origin.kind === "registered") {
    return origin;
  }
  return { ...origin, origin: withoutMachineIds({ text: origin.origin }) };
}

/**
 * A row whose drawn text names a session, call, talk, turn or run by its machine id, refused rather than drawn —
 * the last form every queue row passes (`./queueRows.ts` `rowsOf`, `./queueActRow.ts` `withLookedUpPull`), so no
 * builder can forget it. A row already refused keeps its own refusal, which outranks this one. Either way, the text
 * a refused card still draws has its ids hidden ({@link machineIdsHidden}).
 *
 * @param row the built row
 * @returns the row, its form refused when its card or source line carries a machine id
 */
export function withMachineIdForm({ row }: { row: QueueRow }): QueueRow {
  let form = row.record.form;
  if (form.kind === "drawn") {
    form = machineIdForm({ card: row.card, source: row.source });
  }
  if (form.kind === "drawn") {
    return row;
  }
  const { card, source } = machineIdsHidden({ card: row.card, source: row.source });
  return { ...row, card, record: { ...row.record, form }, source };
}
