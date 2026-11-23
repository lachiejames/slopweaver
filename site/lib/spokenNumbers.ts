/**
 * A number as the voice says it — "eight", "twenty-one", "one hundred and five", "one two three" — read back to its
 * value. Shared by the PR-number check (`./talkSpokenClaims.ts`) and the repeated-ask check (`./talkRepeatedAsk.ts`);
 * a run that says no single number is `undefined`, never a guess.
 */

/** One word of a spoken number, by the part it plays. */
interface NumberPiece {
  readonly kind: "unit" | "teen" | "ten" | "hundred" | "thousand" | "and";
  readonly value: number;
}

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Which piece may follow which in a cardinal: "eighteen thousand one hundred and eighty-one". */
const FOLLOWS: Readonly<Record<NumberPiece["kind"], readonly NumberPiece["kind"][]>> = {
  and: ["unit", "teen", "ten"],
  hundred: ["and", "unit", "teen", "ten", "thousand"],
  teen: ["hundred", "thousand"],
  ten: ["unit", "hundred", "thousand"],
  thousand: ["and", "unit", "teen", "ten"],
  unit: ["hundred", "thousand"],
};

/**
 * One word as a piece of a spoken number.
 *
 * @returns the piece, or `undefined` for a word no number is said with
 */
function pieceOf({ word }: { word: string }): NumberPiece | undefined {
  if (word === "and" || word === "hundred" || word === "thousand") {
    return { kind: word, value: { and: 0, hundred: 100, thousand: 1000 }[word] };
  }
  const parts = word.split("-");
  const [head, tail, ...rest] = parts;
  if (parts.length > 1) {
    const tens = TENS.indexOf(head);
    const unit = UNITS.indexOf(tail);
    return rest.length === 0 && tens >= 2 && unit >= 1 ? { kind: "ten", value: tens * 10 + unit } : undefined;
  }
  if (UNITS.includes(word)) {
    return { kind: "unit", value: UNITS.indexOf(word) };
  }
  if (TEENS.includes(word)) {
    return { kind: "teen", value: 10 + TEENS.indexOf(word) };
  }
  if (TENS.indexOf(word) >= 2) {
    return { kind: "ten", value: TENS.indexOf(word) * 10 };
  }
  return undefined;
}

/**
 * A spoken number's value: digit by digit ("one two three" is 123) or a cardinal up to the thousands ("eighteen
 * thousand one hundred eighty-one"). A run that is neither — "eighteen one" — is no number at all, never a guess.
 *
 * @param pieces the run of number words, a trailing "and" already dropped
 * @returns the value, or `undefined`
 */
function spokenValue({ pieces }: { pieces: readonly NumberPiece[] }): number | undefined {
  if (pieces.length >= 2 && pieces.every((piece) => piece.kind === "unit")) {
    return Number(pieces.map((piece) => String(piece.value)).join(""));
  }
  let [total, current, hundreds] = [0, 0, 0];
  let previous: NumberPiece | undefined;
  for (const piece of pieces) {
    const allowed = previous === undefined ? ["unit", "teen", "ten"] : FOLLOWS[previous.kind];
    const afterCompoundTen = previous?.kind === "ten" && previous.value % 10 !== 0 && piece.kind === "unit";
    if (!allowed.includes(piece.kind) || afterCompoundTen) {
      return undefined;
    }
    if (piece.kind === "hundred") {
      hundreds += 1;
      current *= 100;
    } else if (piece.kind === "thousand") {
      if (total > 0) {
        return undefined;
      }
      [total, current, hundreds] = [current * 1000, 0, 0];
    } else {
      current += piece.value;
    }
    if (hundreds > 1) {
      return undefined;
    }
    previous = piece;
  }
  return total + current;
}

/**
 * Whether a word is one a spoken number is said with, "and" included.
 *
 * @returns true for "eight", "twenty", "hundred", "and"; false for "8" and every other word
 */
export function isNumberWord({ word }: { word: string }): boolean {
  return pieceOf({ word }) !== undefined;
}

/**
 * A run of words as the one number they say, read the way a PR number is: "eight", "twenty-one" split as two words,
 * "one hundred and five".
 *
 * @param words the run, lowercased
 * @returns the value, or `undefined` when a word is not a number word or the run says no single number
 */
export function spokenNumberOf({ words }: { words: readonly string[] }): number | undefined {
  const pieces: NumberPiece[] = [];
  for (const word of words) {
    const piece = pieceOf({ word });
    if (piece === undefined) {
      return undefined;
    }
    pieces.push(piece);
  }
  return pieces.length === 0 ? undefined : spokenValue({ pieces });
}
