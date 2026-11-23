/**
 * The FILES a command's redirections name — the protected-path tripwire's reading of a redirection
 * (`./protectedPathBash.ts`, `./protectedPathWrites.ts`). Pure, no I/O. The word lexing it reads is `./shellLexing.ts`,
 * whose narrower `truncatingTargets` is the call-state guard's reading.
 */
import { redirectionOf, type ShellWord, slicedWord } from "./shellLexing.js";

/** The operators whose operand is text or a delimiter, never a file: a heredoc and a here-string. */
const TEXT_OPERAND: ReadonlySet<string> = new Set(["<<<", "<<-", "<<"]);

/** The operators that open their target for writing, truncating, appending or neither (`<>`). */
const WRITING_OUTPUT: ReadonlySet<string> = new Set([">", ">|", "&>", ">>", "&>>", "<>"]);

/**
 * The redirection one word opens and the FILE word it names — none for a non-redirection, a heredoc or here-string,
 * a missing operand, or a `<&`/`>&` onto a descriptor number or `-`.
 */
function fileRedirection({
  index,
  word,
  words,
}: {
  index: number;
  word: ShellWord;
  words: readonly ShellWord[];
}): { operator: RegExpExecArray; target: ShellWord } | undefined {
  const operator = redirectionOf({ word });
  if (operator === undefined || TEXT_OPERAND.has(operator[2]!)) return undefined;
  const attached = word.text.length > operator[0].length;
  const target = attached ? slicedWord({ end: word.text.length, start: operator[0].length, word }) : words[index + 1];
  if (target === undefined) return undefined;
  const duplicatesDescriptor = operator[2]!.endsWith("&") && /^(?:\d+|-)$/u.test(target.text);
  if (duplicatesDescriptor) return undefined;
  return { operator, target };
}

/** Whether a redirection opens its file for writing: a writing operator, or a descriptor-less `>&`. */
function opensForWriting({ operator }: { operator: RegExpExecArray }): boolean {
  return WRITING_OUTPUT.has(operator[2]!) || (operator[2] === ">&" && operator[1] === "");
}

/**
 * The FILE words a command's redirections name — every operator but a heredoc's or here-string's, and a `<&`/`>&`
 * onto a descriptor number or `-`, whose operand is no file — or, with `writing`, only those opening the file for
 * writing: `>`, `>|`, `&>`, `>>`, `&>>`, `<>`, and a bare `>&` onto a file name.
 *
 * @param words the command's words, redirections still on them (after `splitOperators`)
 * @param writing whether to keep only the redirections that write their target
 * @returns each target word, quoting facts kept, in order
 */
export function redirectionTargets({
  words,
  writing,
}: {
  words: readonly ShellWord[];
  writing: boolean;
}): readonly ShellWord[] {
  const found: ShellWord[] = [];
  for (const [index, word] of words.entries()) {
    const redirection = fileRedirection({ index, word, words });
    if (redirection === undefined) continue;
    if (!writing || opensForWriting({ operator: redirection.operator })) {
      found.push(redirection.target);
    }
  }
  return found;
}
