/**
 * What a step card's paste and checklist draw (`./handCard.ts` builds the card): whether the paste fields replace the
 * step's literal, the checklist the card draws, and every text a step card draws or reads out.
 */
import type { StepCard, StepChecklistLine } from "./queueCard";

/** Where one runnable line of a literal ends and the next begins, as the shell reads a pasted block. */
const LITERAL_SEGMENT = /\n|;|&&/u;

/**
 * The verb's binary, bare or by a path — `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver"` included. Path characters and a
 * plain `${NAME}` only, so `"$(other)/bin/slopweaver"`, which runs `other` first, is not the verb and its literal
 * keeps the copy block.
 */
const VERB_BINARY = /^(?:(?:[\w./~-]|\$\{\w+\})+\/bin\/)?slopweaver$/u;

/**
 * Whether the paste fields replace the step's literal outright: every line it runs is `slopweaver secrets set <name>`
 * for a name the card draws a field for.
 *
 * The owner never has to touch the terminal. A card drawing both the field and the
 * command it runs is two ways to do one thing, and the copy block is the one that sends the owner to a terminal. A literal
 * doing anything else as well keeps its copy block whole, since the field covers only the secrets in it. The native
 * note still carries the literal — it has no field — so the terminal remains the fallback, never the path.
 *
 * @param literal the step's paste
 * @param secrets the names the card draws a field for
 * @returns true when the fields cover every line of the literal
 */
export function pasteFieldsCoverLiteral({
  literal,
  secrets,
}: {
  literal: string;
  secrets: readonly string[];
}): boolean {
  const segments = literal
    .split(LITERAL_SEGMENT)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return (
    segments.length > 0 &&
    segments.every((segment) => {
      const words = segment.split(/\s+/u);
      // `.at` is `string | undefined` whether or not a tsconfig sets `noUncheckedIndexedAccess`.
      const first = words.at(0);
      const name = words.at(3);
      if (words.length !== 4 || first === undefined || name === undefined) {
        return false;
      }
      const isVerb = VERB_BINARY.test(first.replace(/^["']|["']$/gu, ""));
      return isVerb && words.at(1) === "secrets" && words.at(2) === "set" && secrets.includes(name);
    })
  );
}

/**
 * The step's checklist as the card draws it. A line whose command is a `secrets set` its paste field covers keeps its
 * sentence and where its value sits, and loses the copy block: the field is how the owner stores it, and a card drawing both
 * is two ways to do one thing ({@link pasteFieldsCoverLiteral}).
 *
 * @param checklist the step's lines, when it has any
 * @param secrets the names the card draws a field for
 * @returns the lines to draw
 */
export function cardChecklist({
  checklist,
  secrets,
}: {
  checklist: readonly StepChecklistLine[] | undefined;
  secrets: readonly string[] | undefined;
}): readonly StepChecklistLine[] | undefined {
  if (checklist === undefined || secrets === undefined) {
    return checklist;
  }
  return checklist.map((line) => {
    if (line.command !== undefined && pasteFieldsCoverLiteral({ literal: line.command, secrets })) {
      return { ...line, command: undefined };
    }
    return line;
  });
}

/**
 * Every text one checklist line draws: its sentence, its command, each label of where its value sits, and its page.
 * The `›` between labels and the line's number are the drawer's layout, the way a row's label is.
 *
 * @param line one checklist line
 * @returns each drawn text, as written
 */
export function checklistLineTexts({ line }: { line: StepChecklistLine }): readonly string[] {
  const texts = [line.action];
  if (line.command !== undefined) {
    texts.push(line.command);
  }
  if (line.find !== undefined) {
    texts.push(...line.find);
  }
  if (line.url !== undefined) {
    texts.push(line.url);
  }
  return texts;
}

/**
 * Every text a step card draws or reads out: its heading, its whole sentence, its rows, what the owner pastes, each
 * checklist line, and the ask's own fields.
 *
 * @returns each drawn text, as written
 */
export function stepCardTexts({ card }: { card: StepCard }): readonly string[] {
  const texts = [card.question, card.what.whole, ...card.rows.map((row) => row.value)];
  if (card.copy !== undefined) {
    texts.push(card.copy);
  }
  if (card.checklist !== undefined) {
    texts.push(...card.checklist.flatMap((line) => checklistLineTexts({ line })));
  }
  const decision = card.decision;
  if (decision === undefined) {
    return texts;
  }
  if (decision.summary !== undefined) {
    texts.push(decision.summary);
  }
  texts.push(decision.problem, decision.lean);
  for (const option of decision.options) {
    texts.push(option.sentence, option.tradeoff);
  }
  if (decision.stakes !== undefined) {
    texts.push(decision.stakes.risk, decision.stakes.blastRadius, decision.stakes.stillReal);
  }
  return texts;
}
