/**
 * The commands a recorded question carries as paragraphs of their own — what the console's ask card lifts out of
 * the prose into copy blocks (`site/lib/askCommands.ts`, the mirror), and what the recording verbs' gate
 * (`./cardAlignment.ts`) lifts BEFORE it scans the rest for a command buried in a sentence.
 *
 * Commands the owner has to run belong in copy blocks, one click to copy. A command paragraph is the one shape a
 * card can draw as a copy block, so the rule is: a command of the owner's sits on lines of its own, separated by
 * a blank line, never inside a sentence.
 *
 * The criterion, stated rather than discovered: never the lead paragraph (that is the question the owner answers);
 * every non-blank line opens on one of the owner's programs ({@link OWNER_PROGRAMS}) and none ends a sentence. Each line is one
 * command. `src/__tests__/unit/handover/askCommandsMirror.test.ts` holds the site's copy to the same answer.
 *
 * Pure.
 */
import { OWNER_PROGRAMS } from "../hand/runnableLiteral.js";

/** A blank line between two paragraphs. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/u;

/** A line that ends a sentence, which a command line never does. */
const SENTENCE_END = /[.?!]$/u;

/**
 * One paragraph's non-blank lines, trimmed.
 *
 * @param paragraph one paragraph
 * @returns its lines
 */
function linesOf({ paragraph }: { paragraph: string }): readonly string[] {
  return paragraph
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Whether one paragraph is commands only.
 *
 * @param paragraph one paragraph of the question, as recorded
 * @returns true when each of its lines opens on one of the owner's programs and ends no sentence
 */
function isCommandParagraph({ paragraph }: { paragraph: string }): boolean {
  const lines = linesOf({ paragraph });
  return (
    lines.length > 0 &&
    lines.every((line) => {
      const [first] = line.split(/\s+/u);
      return first !== undefined && OWNER_PROGRAMS.includes(first) && !SENTENCE_END.test(line);
    })
  );
}

/**
 * A recorded question split into its prose and the commands it carries as paragraphs of their own.
 *
 * @param text the question as recorded
 * @returns the prose with every command paragraph removed, and each command line in order
 */
export function commandParagraphs({ text }: { text: string }): {
  readonly prose: string;
  readonly commands: readonly string[];
} {
  const prose: string[] = [];
  const commands: string[] = [];
  for (const [index, paragraph] of text.split(PARAGRAPH_BREAK).entries()) {
    if (index > 0 && isCommandParagraph({ paragraph })) {
      commands.push(...linesOf({ paragraph }));
    } else {
      prose.push(paragraph);
    }
  }
  return { commands, prose: prose.join("\n\n") };
}
