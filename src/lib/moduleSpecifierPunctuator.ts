/**
 * How long the punctuator at a position is, by context-free maximal munch: the longest punctuator the characters
 * spell, `>` runs (`>=`, `>>`, `>>>=`) included. It is NOT always the token TypeScript's parser ends up with: the
 * parser re-scans by context, joining `>=` from a lone `>` (`reScanGreaterToken`) and splitting `<<` inside type
 * arguments (`A<<B>() => void>`, `reScanLessThanToken`). The lexer's operand judgements
 * ({@link ./moduleSpecifierLexState.ts}) are made on these maximal-munch tokens, and `moduleSpecifiers.test.ts`
 * holds the reader's answers against the syntax tree's. Pure character measurement, apart from the lexer that keeps
 * state:
 * {@link ./moduleSpecifierLexer.ts} asks this how many characters to take, then decides what the punctuator means for
 * its paren, brace and JSX tracking.
 */
import { isDigit } from "./moduleSpecifierLexState.js";

/** The length of an operator whose characters double or take `=`: `+ ++ +=`, `& && &= &&=`, `< << <= <<=`. */
function operatorLength({ code, next, third }: { code: number; next: number; third: number }): number {
  if (code === 43 || code === 45) {
    return next === code || next === 61 ? 2 : 1;
  }
  if (next === code && code !== 47 && code !== 37 && code !== 94) {
    return third === 61 ? 3 : 2;
  }
  return next === 61 ? 2 : 1;
}

/** The character codes at a punctuator's start and the three after it. */
interface PunctuatorChars {
  readonly code: number;
  readonly next: number;
  readonly third: number;
  readonly fourth: number;
}

/** `?`, `?.` (but `?.5` is `?` then a number), `??` and `??=`. */
function questionLength({ chars }: { chars: PunctuatorChars }): number {
  if (chars.next === 46) {
    return isDigit({ code: chars.third }) ? 1 : 2;
  }
  return chars.next === 63 ? operatorLength(chars) : 1;
}

/** `>`, `>>`, `>>>`, their assignments and `>=`. */
function greaterLength({ chars }: { chars: PunctuatorChars }): number {
  if (chars.next === 62 && chars.third === 62) {
    return chars.fourth === 61 ? 4 : 3;
  }
  return operatorLength(chars);
}

/** The punctuators whose first character needs its own rule, by that character's code. */
const SPECIAL_PUNCTUATOR_LENGTH: ReadonlyMap<number, (chars: PunctuatorChars) => number> = new Map<
  number,
  (chars: PunctuatorChars) => number
>([
  [46, ({ next, third }) => (next === 46 && third === 46 ? 3 : 1)],
  [63, (chars) => questionLength({ chars })],
  [61, (chars) => (chars.next === 62 ? 2 : operatorLength(chars))],
  [33, ({ next, third }) => (next === 61 ? operatorLength({ code: 61, next, third }) : 1)],
  [62, (chars) => greaterLength({ chars })],
]);

/**
 * The length of the punctuator at `pos` by maximal munch.
 *
 * @param text the file's contents
 * @param pos the index the punctuator would start at
 * @returns how many characters it spans, or 0 when no punctuator starts there
 */
export function punctuatorLength({ text, pos }: { text: string; pos: number }): number {
  const char = text.charAt(pos);
  if ("{}()[];,~:@".includes(char)) {
    return 1;
  }
  const chars = {
    code: text.charCodeAt(pos),
    fourth: text.charCodeAt(pos + 3),
    next: text.charCodeAt(pos + 1),
    third: text.charCodeAt(pos + 2),
  };
  const special = SPECIAL_PUNCTUATOR_LENGTH.get(chars.code);
  if (special !== undefined) {
    return special(chars);
  }
  return "+-*/%^&|<".includes(char) ? operatorLength(chars) : 0;
}
