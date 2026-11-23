/**
 * The letters a drawn text could be read as spelling, and whether they could name Problem, for a caller that must
 * never MISS a Problem label a reader sees and may over-read one: `./leadRows.ts` asks it which rows to judge
 * (fallback reviews r19–r23). A spelling keeps a text's shape: a space where the text had one, {@link SPELLED_BREAK}
 * where a tag breaks the line, and every other character reduced to a letter `a`-`z` or a wildcard.
 */

/**
 * Characters that are not letters but that a reader takes for a letter of `problem` — a digit, a bar, an empty set,
 * a registered or sound-recording mark (`PRO8LEM`, `Probl3m`, `Pr∅blem`, fallback review r21) — and `i`, which a
 * capital I spelling `ProbIem` lower-cases to where a reader saw an `l`. Each is spelled as its letter in UPPER case, so a
 * reader of the spelling can still tell a look-alike from a letter: `10.` is a list number, not a word (r24). The one
 * exception is `i`, spelled a LOWER-case `l`: it is a real letter, so it counts as one (`℗®08I3₥`).
 */
const LOOKS_LIKE = new Map([
  ["0", "O"],
  ["1", "L"],
  ["3", "E"],
  ["6", "B"],
  ["8", "B"],
  ["|", "L"],
  ["∣", "L"],
  ["∅", "O"],
  ["®", "R"],
  ["℗", "P"],
  ["€", "E"],
  ["i", "l"],
]);

/** A letter outside `a`-`z` or a pictograph (`🅾️`, a boxed `🅿`): a reader may take it for any letter. */
export const ANY_LETTER = "?";

/**
 * A digit, a sign or a mark outside {@link LOOKS_LIKE} (`₽`, `〇`, `₿`, `∈`, `׀`, fallback review r22): a reader may take
 * it for a letter too, but it is WEAK, since a date or a version number is made of nothing else. A dash or a connector
 * is never one: {@link spelling} writes it as a space.
 */
export const ANY_MARK = "*";

/** What {@link spelling} writes where a tag breaks the line: `**Problem**<br>text` opens a line with its label. */
export const SPELLED_BREAK = "\n";

/**
 * The vertical presentation forms of a dash and a low line (`︱`, `︲`, `︳`, `︴`): each is drawn as a bar, the `|` a reader
 * takes for `l`, but NFKD folds it to a horizontal dash or `_`, which {@link spelling} writes as a space. So each is read
 * as the bar it draws before the fold (fallback review r1, `Prob︱em`).
 */
const VERTICAL_DASH = /[\u{FE31}-\u{FE34}]/gu;

/**
 * The oblique hyphen `⹝`, drawn as the slanted stroke of a `/` and read as one: a weak mark, never a space (fallback
 * review r2).
 */
const OBLIQUE_DASH = /\u{2E5D}/gu;

/** One character of a folded text, spelled: see {@link spelling}. */
function spelledChar({ char }: { char: string }): string {
  const letter = LOOKS_LIKE.get(char);
  if (letter !== undefined) {
    return letter;
  }
  if (/[a-z]/u.test(char)) {
    return char;
  }
  if (/[\n\r\u{2028}\u{2029}]/u.test(char)) {
    return SPELLED_BREAK;
  }
  if (/[\s\p{Pd}\p{Pc}]/u.test(char)) {
    return " ";
  }
  if (/[\p{L}\p{So}]/u.test(char)) {
    return ANY_LETTER;
  }
  return /[\p{N}\p{S}\p{P}]/u.test(char) ? ANY_MARK : "";
}

/**
 * The letters a text could be read as spelling: NFKD-folded with its marks dropped, lower-cased, a default-ignorable
 * character dropped, a {@link LOOKS_LIKE} character taken for its letter, any other letter or pictograph written
 * {@link ANY_LETTER}, any other digit, sign or mark {@link ANY_MARK}, a newline {@link SPELLED_BREAK} (a `<pre>` draws
 * one), a run of other space, dashes or connectors (`-`, `–`, `_`) one space, and anything else dropped. It is
 * deliberately GENEROUS: any list of look-alikes is incomplete — a Greek capital Beta, a small capital, an Armenian `օ`
 * each passed one (fallback reviews r19, r20) — so a character is a wildcard rather than nothing. A dash or a connector
 * is the one exception: it joins or parts words and no reader takes it for a letter, while as a wildcard it made
 * `Re-import` and `organize-imports` anagrams of Problem, the hyphen standing in for its `b`. A dash DRAWN as a bar or a
 * slash is read as that ({@link VERTICAL_DASH}, {@link OBLIQUE_DASH}).
 *
 * @param text one text node's value, or any drawn text
 * @returns its letters, wildcards, line breaks and single spaces
 */
export function spelling({ text }: { text: string }): string {
  const folded = text
    .replace(VERTICAL_DASH, "|")
    .replace(OBLIQUE_DASH, "/")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\p{M}\p{Default_Ignorable_Code_Point}]/gu, "");
  return collapsed({ spelled: folded.replace(/[^a-hj-z]/gsu, (char) => spelledChar({ char })) });
}

/**
 * A spelling with each run of space and breaks made one: a break if the run holds one, else a space. Applied again after
 * every join, before any cap, so a run of newlines a reader sees as one space never pushes a label out of the letters a
 * cap keeps (`**` + `&#10;` × 300 + `Problem**`, fallback review r24). One pass, so a run of 65,536 spaces stays
 * linear: a pattern anchored on the break scanned the run once per position (r25, 1.8 s).
 *
 * @param spelled a spelling, or several spellings joined
 * @returns the same spelling with every run of space and breaks one character long
 */
export function collapsed({ spelled }: { spelled: string }): string {
  return spelled.replace(/[ \n]{2,}/g, (run) => (run.includes(SPELLED_BREAK) ? SPELLED_BREAK : " "));
}

/** The letters of Problem, as {@link couldSpellProblem} spends them. */
const PROBLEM_LETTERS = "problem";

/**
 * How many of a stretch's characters must be letters, {@link LOOKS_LIKE} stand-ins or {@link ANY_LETTER}s, anything
 * but a weak {@link ANY_MARK}, so a `YYYY-MM-DD` date never spells Problem.
 */
const LETTERS_SEEN = 4;

/**
 * Whether a stretch of spelled letters could be Problem in SOME order, a wildcard standing for any letter it lacks:
 * order is not trusted, because a `<bdo>` or a bidi control can draw any part of a word reversed
 * (`Prob<bdo dir="rtl">mel</bdo>`, fallback review r20).
 *
 * A stretch must also hold one letter that is not a {@link LOOKS_LIKE} stand-in: one spelled only of digits, signs and
 * look-alikes is a number. `7.0.138` spells `**O*LEB`, four look-alikes, and read as Problem it made Renovate's update
 * table owe Risk and Blast radius rows on a dependency bump (`ai` 7.0.138 → 7.0.139), a body no session may rewrite. A label disguised with look-alikes still carries a letter of its own (`PRO8L3M`, `PR〇BLEM`, `℗®08I3₥`). The
 * residue, stated: a label spelled ENTIRELY of signs and look-alikes (`℗®08|3₥`) is no longer read as Problem.
 */
function couldSpellProblem({ stretch }: { stretch: string }): boolean {
  const left = PROBLEM_LETTERS.split("");
  const fits = stretch
    .toLowerCase()
    .split("")
    .every((char) => {
      if (char === ANY_LETTER || char === ANY_MARK) {
        return true;
      }
      const at = left.indexOf(char);
      return at !== -1 && left.splice(at, 1).length === 1;
    });
  const seen = stretch.split("").filter((char) => char !== ANY_MARK).length;
  const hasGenuineLetter = stretch.split("").some((char) => char === ANY_LETTER || /[a-z]/u.test(char));
  return stretch.length === PROBLEM_LETTERS.length && fits && seen >= LETTERS_SEEN && hasGenuineLetter;
}

/**
 * Whether any stretch of a spelling could spell Problem, its spaces and breaks ignored so `P r o b l e m`
 * and `Pro blem` both do: generous, as {@link spelling} is.
 *
 * @param spelled one spelling, or several joined by a character outside a spelling (a tab)
 * @returns true when some seven consecutive letters could be Problem
 */
export function carriesProblem({ spelled }: { spelled: string }): boolean {
  const { length } = PROBLEM_LETTERS;
  return spelled.split("\t").some((variant) => {
    const run = variant.replace(/[ \n]/g, "");
    return Array.from({ length: Math.max(run.length - length + 1, 0) }, (_, at) => run.slice(at, at + length)).some(
      (stretch) => couldSpellProblem({ stretch }),
    );
  });
}

/** How far past a word's end a run reads, to take in a label spaced out, `P r o b l e m`, rather than a sentence. */
const LABEL_KEPT = PROBLEM_LETTERS.length + 3;

/**
 * Whether a spelling NAMES Problem anywhere a reader could take it for a label: in any one word, whatever is glued to it
 * or sits before it (`JJJJ-1642 **Problem:**`, `10. **Problem:**`, `**Problem**—the page`), or across a short run
 * of words spaced out. Three rounds narrowed where a label may sit in a line and each was one prefix short (fallback reviews
 * r23–r25), so the position is not asked at all: `the problem in the retry path` names Problem too, and that
 * refusal is the price.
 *
 * @param spelled one spelling, or several joined by a tab
 * @returns true when some word, or some short run of words, could be Problem
 */
export function namesProblem({ spelled }: { spelled: string }): boolean {
  return spelled.split("\t").some((variant) => {
    const words = variant.split(/[ \n]/).filter((word) => word !== "");
    const letters = lettersOf({ words });
    return [...words, ...letters, ...shortRuns({ words: letters })].some((run) => carriesProblem({ spelled: run }));
  });
}

/**
 * Each word's letters, its digits, signs and marks ({@link ANY_MARK}) dropped, a word of one mark kept as it (`P r 〇 b l e m`,
 * fallback review r29) and a word of none dropped. A word read without its marks is `P..R..O..B..L..E..M` (r29), and a run read
 * ACROSS words reads only letters: a label spaced out is its own letters, even disguised (`P r о b l е m` in
 * Cyrillic, fallback review r28) or punctuated (`P. R. O. B. L. E. M.`), while `under <p95 latency` read with its
 * marks spells `er*p**l` (r27).
 */
function lettersOf({ words }: { words: readonly string[] }): readonly string[] {
  return words.map((word) => (word === ANY_MARK ? word : word.replaceAll(ANY_MARK, ""))).filter((word) => word !== "");
}

/**
 * Every run across consecutive words from each word's last six letters, {@link LABEL_KEPT} letters past them: a label spaced
 * out on a line that goes on (`**P r o b l e m:** the page`, fallback review r26), even glued to the word before or
 * after it (`JJJJ-1642:P r o b l e m—users`, r27), or a letter to a line (`P<br>r<br>o…`, r28). Each run stops within a
 * few words, so a text is read in linear time.
 */
function shortRuns({ words }: { words: readonly string[] }): readonly string[] {
  return words.map((_, from) => {
    let run = words[from]!.slice(1 - PROBLEM_LETTERS.length);
    const kept = run.length + LABEL_KEPT;
    for (let at = from + 1; at < words.length && run.length < kept; at += 1) {
      run += words[at]!.slice(0, kept - run.length);
    }
    return run;
  });
}

/** Whether a spelling could carry Problem (`carries`, {@link carriesProblem}) and could name it (`names`, {@link namesProblem}). */
export interface ProblemSigns {
  readonly carries: boolean;
  readonly names: boolean;
}

/** A node's {@link ProblemSigns}, read on its WHOLE spelling, and the edges of that spelling a parent joins on. */
export interface SpelledRun extends ProblemSigns {
  readonly edges: string;
}

/** What {@link spelledRun} writes between the two edges it keeps: a tab, which both readers treat as an end. */
const SPELLED_CUT = "\t";

/**
 * How many characters of each end a {@link SpelledRun} keeps. A reading spans at most {@link LABEL_KEPT} letters and
 * their single spaces, so a word that crosses into a node's neighbour lies within this much of its edge.
 */
const EDGE_KEPT = 64;

/**
 * A node's spelling read ONCE, whole, and carried up as its signs and its edges, rather than as a capped string: a
 * cap cut a label written after 256 characters of context (`**Context:** …<br><br>**Problem:** …`, fallback review
 * r26), while an uncapped string is copied once per enclosing node, which nesting makes quadratic.
 *
 * @param spelled the node's spelling, its children's edges joined
 * @param within the children's runs, whose signs it keeps
 * @returns the node's signs and edges
 */
export function spelledRun({ spelled, within }: { spelled: string; within: readonly ProblemSigns[] }): SpelledRun {
  const cut = spelled.length > 2 * EDGE_KEPT;
  return {
    carries: within.some((run) => run.carries) || carriesProblem({ spelled }),
    edges: cut ? `${spelled.slice(0, EDGE_KEPT)}${SPELLED_CUT}${spelled.slice(-EDGE_KEPT)}` : spelled,
    names: within.some((run) => run.names) || namesProblem({ spelled }),
  };
}
