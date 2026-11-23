/**
 * The commands a recorded question carries as paragraphs of their own, lifted out of its prose so the ask card
 * draws each as a copy block — never as a line of paragraph text.
 *
 * A command the owner needs to run is drawn as a copy block, one click to copy with "copied", never as a `sudo` line
 * of prose. The recording verbs separate such a command by a
 * blank line already; this reads that shape back. The mirror of `src/handover/commandParagraphs.ts`, which the
 * recording verbs' gate (`src/handover/cardAlignment.ts`) runs on the same text; the site cannot import `src/`, so
 * `src/__tests__/unit/handover/askCommandsMirror.test.ts` holds the two to one answer.
 *
 * Imports nothing, so the card module can.
 */

/**
 * Every program one of the owner's commands runs — `src/hand/runnableLiteral.ts`'s `OWNER_PROGRAMS`, mirrored; a paragraph
 * whose every line opens on one of these is a command the owner pastes.
 */
export const ASK_COMMAND_PROGRAMS: readonly string[] = ["sudo", "op", "slopweaver", "gcloud", "codex", "gh", "claude"];

/** A blank line between two paragraphs. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/u;

/** A line that ends a sentence, which a command line never does. */
const SENTENCE_END = /[.?!]$/u;

/**
 * Whether one paragraph is commands only: every line opens on one of the owner's programs, and none ends a sentence.
 *
 * @param paragraph one paragraph of the question, as recorded
 * @returns true when each of its lines is a command the owner pastes
 */
function isCommandParagraph({ paragraph }: { paragraph: string }): boolean {
  const lines = paragraph
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return false;
  }
  return lines.every((line) => {
    const [first] = line.split(/\s+/u);
    return ASK_COMMAND_PROGRAMS.some((program) => program === first) && !SENTENCE_END.test(line);
  });
}

/**
 * A recorded question split into its prose and the commands it carries as paragraphs of their own, each line one
 * command. The LEAD paragraph never lifts: it is the question the owner answers, never something they paste.
 *
 * @param text the question as recorded, before anything collapses its whitespace
 * @returns the prose with every command paragraph removed, and each command in order
 */
export function askCommands({ text }: { text: string }): {
  readonly prose: string;
  readonly commands: readonly string[];
} {
  const paragraphs = text.split(PARAGRAPH_BREAK);
  const prose: string[] = [];
  const commands: string[] = [];
  for (const [index, paragraph] of paragraphs.entries()) {
    if (index > 0 && isCommandParagraph({ paragraph })) {
      commands.push(
        ...paragraph
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );
    } else {
      prose.push(paragraph);
    }
  }
  return { commands, prose: prose.join("\n\n") };
}

/**
 * The two fields an ask card is built from, lifted from the question AS RECORDED — before anything collapses its blank
 * lines — so a command the owner pastes is drawn as a copy block of its own and never as a line of the card's prose.
 *
 * @param question the recorded question
 * @returns the card's `question` (the prose) and `commands`
 */
export function liftedAsk({ question }: { question: string }): {
  readonly question: string;
  readonly commands: readonly string[];
} {
  const { commands, prose } = askCommands({ text: question });
  return { commands, question: prose };
}
