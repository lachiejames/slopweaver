/**
 * The command text the call-state tripwire (`./callStateGuard.ts`) judges: heredoc bodies, comments and line
 * continuations taken out, and a `>|` clobber read as the `>` it truncates like. Pure, no I/O.
 */
import { commandSegments } from "./shellSegments.js";
import { opensComment } from "./shellSpans.js";

/**
 * The command with every heredoc body taken out. A body is data its command reads, never a command line of its own
 * (`cat <call file> <<'EOF'` whose body holds an `rm` line runs no `rm`).
 */
function withoutHeredocBodies({ command }: { command: string }): string {
  return commandSegments({ command })
    .map((segment) =>
      segment.separatorAfter === undefined ? segment.command : `${segment.command}${segment.separatorAfter}`,
    )
    .join("");
}

/**
 * The command as it is judged: every heredoc body and every comment removed — an unquoted `#` starting a word, to the end of its line — so
 * commented-out text is never a segment (`true # ; rm <call file>` runs nothing), and every unquoted `>|`
 * clobber read as the `>` it truncates like, so the segment splitter cannot cut it at its pipe. Quote
 * tracking is the plain single, double and backslash kind; a `#` it misreads inside a `$'…'` only drops text.
 *
 * @param command the command as the seat wrote it
 * @returns the text the tripwire reads
 */
export function judgedText({ command: raw }: { command: string }): string {
  const command = withoutHeredocBodies({ command: raw });
  let out = "";
  let quote: string | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const step = judgedStep({ command, index, quote });
    out += step.text;
    index = step.last;
    quote = step.quote;
  }
  return out;
}

/** What one step of {@link judgedText} keeps, the last index it consumed, and the quote open after it. */
interface JudgedStep {
  readonly text: string;
  readonly last: number;
  readonly quote: string | undefined;
}

/** A comment dropped to its line's end, or a `>|` read as `>`, at an unquoted index; `undefined` for anything else. */
function unquotedStep({ command, index }: { command: string; index: number }): JudgedStep | undefined {
  if (opensComment({ command, index })) {
    const end = command.indexOf("\n", index);
    // A comment with no newline after it runs to the end of the command.
    const last = end === -1 ? command.length : end - 1;
    return { last, quote: undefined, text: "" };
  }
  if (command[index] === ">" && command[index + 1] === "|") {
    return { last: index + 1, quote: undefined, text: "> " };
  }
  return undefined;
}

/** One character kept, a backslash keeping the next with it outside single quotes, and the quote it opens or closes. */
function quotedStep({
  command,
  index,
  quote,
}: {
  command: string;
  index: number;
  quote: string | undefined;
}): JudgedStep {
  const ch = command[index]!;
  if (ch === "\\" && quote !== "'" && index + 1 < command.length) {
    // A backslash-newline is a line continuation bash removes before it reads a word (`cd <dir> \⏎&& rm x`).
    return { last: index + 1, quote, text: command[index + 1] === "\n" ? "" : `${ch}${command[index + 1]!}` };
  }
  if (quote === undefined && (ch === "'" || ch === '"')) {
    return { last: index, quote: ch, text: ch };
  }
  if (ch === quote) {
    return { last: index, quote: undefined, text: ch };
  }
  return { last: index, quote, text: ch };
}

/** One step of {@link judgedText}: a comment or clobber outside quotes, else one kept character. */
function judgedStep({
  command,
  index,
  quote,
}: {
  command: string;
  index: number;
  quote: string | undefined;
}): JudgedStep {
  if (quote === undefined) {
    const step = unquotedStep({ command, index });
    if (step !== undefined) {
      return step;
    }
  }
  return quotedStep({ command, index, quote });
}
