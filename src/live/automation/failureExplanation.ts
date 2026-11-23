/**
 * THE FAILURE EXPLANATIONS REGISTER — one plain sentence per failed firing, written by the visible session that saw
 * it fail, saying what went wrong and what would fix it.
 *
 * A run that exits with an error records why, in something human readable: a bare "it's broken" is not an
 * explanation. A firing's own record is the verb's stderr tail (`./verbFailureWhy.ts`), which is evidence, not
 * an explanation. No console-side model may turn one into the other (AGENTS.md rule 2), so the explanation comes from
 * the session that already ran the row in front of the owner, through `slopweaver automation explain`, which appends
 * here. A firing no session watched — one the supervisor tick ran in-process — is explained by the next visible
 * session to pick its card up, which `automation repair` prompts with the exact command.
 *
 * **Keyed by the exact firing, never by the row**: a recipe id, a slot and the attempt number, because a retry
 * overwrites its slot's ledger row, and a sentence about attempt 1 must not describe attempt 2. Append-only and
 * beside the slot ledger rather than inside it, so the exactly-once rows are never rewritten after they settle. The
 * line appended last for one firing wins, so a session correcting itself just writes again.
 *
 * **An unreadable register reads as no explanations**, said in the report's issues: the row then leads with its
 * generic sentence, which is true, rather than with nothing. **Only a failed or dead firing takes one**: the append
 * checks the slot ledger itself, so no caller can file a sentence for a firing that succeeded, deferred or is open.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";
import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { readJsonlLines } from "../../corpus/corpusStore.js";
import { stateHomePaths } from "../../stateHome.js";
import { type RecipeError, RecipeErrors } from "./errors.js";
import type { RecipeExplanationWordsUnfitError } from "./explanationErrors.js";
import { readSlotAttempt } from "./slotLedger.js";

/** Owner-only, like every register beside it. */
const DIR_MODE = 0o700;

/**
 * The longest explanation the register takes. One short sentence above the fold is the whole contract (AGENTS.md rule
 * 7: shape is enforced by the schema, and a violation is refused, never truncated); 200 characters is two lines of the
 * card's subtitle at its widest.
 */
const FAILURE_EXPLANATION_MAX_CHARS = 200;

/** One session's plain sentence about one failed firing. */
export interface FailureExplanation {
  readonly recipeId: string;
  /** The firing's scheduled time, as the slot ledger keys it. */
  readonly slotIso: string;
  /** Which attempt at that slot failed — a retry overwrites the slot's row, so the slot alone is not the firing. */
  readonly attempt: number;
  /** What went wrong and what would fix it, in one sentence the owner can read. */
  readonly why: string;
  /** When the sentence was written. */
  readonly recordedIso: string;
}

/**
 * The marks that close a sentence: the ASCII three, and the full stops, question and exclamation marks of the scripts
 * that write their own (CJK `。！？`, Arabic `؟`, Devanagari `।`), so a plain sentence in another script fits.
 */
const STOPS = ".!?。！？؟।";

/** The marks that pause inside one: the ASCII comma and its CJK and Arabic counterparts. */
const COMMAS = ",、，،";

/**
 * THE SHAPE, as an allowlist: the only characters a sentence here may hold — a letter or mark in any script, a digit,
 * a space, an apostrophe, a hyphen, a comma, the stops, and a colon only between two digits (a clock, `9:30`), so the
 * first character outside it is what the refusal names. A denylist of runtime grammars kept
 * meeting one it did not name (Go's `panic: runtime error: index out of range [5]`, Rust's `thread 'main' panicked at
 * src/main.rs:2:5`, Java's `at acme.Foo.bar(Foo.java:12)`, Ruby's `from /app/x.rb:12:in 'foo'`), each one more
 * branch. Every one of those carries a colon, a slash, a bracket, a quote or an underscore, and so does a JSON body, a
 * path, a frame, a snake_case code and an HTML page, so the register refuses the CLASS by naming what a plain sentence
 * is made of rather than what a raw record looks like. The cost is a quote, a bracket, a path or a host name said in
 * words, which the register already asked for of a dotted name.
 */
const OUTSIDE_SHAPE = new RegExp(String.raw`[^\p{L}\p{M}\p{Nd} '’${COMMAS}${STOPS}:-]|(?<!\p{Nd}):|:(?!\p{Nd})`, "u");

/** A word: letters in any script, joined only by an apostrophe or hyphen (`isn't`, `end-to-end`). */
const WORD = String.raw`\p{L}[\p{L}\p{M}]*(?:['’-]\p{L}[\p{L}\p{M}]*)*`;

/** A number: digits, joined only by a full stop or colon between digits (a version `2.4`, a clock `9:30`). */
const NUMBER = String.raw`\p{Nd}+(?:[.:]\p{Nd}+)*`;

/** One token of the shape: a word or a number. */
const TOKEN = `(?:${WORD}|${NUMBER})`;

/**
 * A letter of a script written without spaces between words: Chinese, Japanese, Thai, Lao, Khmer and Burmese, by
 * script extension so the Japanese prolonged sound mark counts.
 */
const UNSPACED_LETTER = String.raw`[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}]`;

/**
 * The empty join between a number and a letter of an unspaced script, either way round, so `バージョン２.４が停止しました。`
 * is a sentence. A Latin letter never joins a digit like this, so `E2BIG` and `usr1` stay outside the shape.
 */
const UNSPACED_JOIN = String.raw`(?:(?<=${UNSPACED_LETTER}\p{M}*)(?=\p{Nd})|(?<=\p{Nd})(?=${UNSPACED_LETTER}))`;

/**
 * The words-and-numbers grammar inside that charset: tokens apart by one space, or by one comma and at most one space
 * (a CJK comma takes none), the last closed by one stop. A word never mixes letters and digits, so `E2BIG`,
 * `HTTP2Error` and `usr1` are outside it. A script written without spaces is one long token, which is still words,
 * and there a number meets its word with no space between ({@link UNSPACED_JOIN}).
 */
const SHAPE = new RegExp(`^${TOKEN}(?:(?:[${COMMAS}] ?| |${UNSPACED_JOIN})${TOKEN})*[${STOPS}]$`, "u");
/** A run of the separators the shape allows between two tokens, read as one space when the residue is matched. */
const SEPARATOR_RUN = new RegExp(`[ ${COMMAS}]+`, "gu");
/** Every combining mark, dropped from the decomposed sentence before the residue is matched. */
const COMBINING_MARK = /\p{M}/gu;

/** A character of a word or number in any script, the unit the residue's boundaries are drawn around. */
const WORD_CHARACTER = String.raw`[\p{L}\p{M}\p{Nd}]`;

/**
 * A residue pattern with every `\b` drawn around {@link WORD_CHARACTER} rather than JavaScript's ASCII word characters,
 * which even under the `u` flag put no boundary between `Δ` and `Warning`.
 *
 * @param source the pattern written with `\b`
 * @returns the same pattern with each `\b` a boundary between a word character in any script and anything else
 */
function unicodeBoundaries({ source }: { source: string }): string {
  const boundary = `(?:(?<=${WORD_CHARACTER})(?!${WORD_CHARACTER})|(?<!${WORD_CHARACTER})(?=${WORD_CHARACTER}))`;
  return source.replaceAll(String.raw`\b`, boundary);
}

/**
 * THE RESIDUE: the raw records that fit inside the shape, because they are made of words and numbers alone. This is
 * the whole of what is still named one by one, and it is bounded by the shape: nothing here can carry punctuation, so
 * a new runtime's grammar reaches it only as words. An exception class written as one word (`TypeError`,
 * `NullPointerException`, a bare capitalised `Error`, one with more CamelCase after it like `ExceptionGroup`, a warning
 * class like `DeprecationWarning` or Python's bare capitalised `Warning`, and every remaining Python built-in named otherwise, `KeyboardInterrupt`,
 * `SystemExit`, `StopIteration`, `StopAsyncIteration` and `GeneratorExit`, plus Java's `Throwable`); a POSIX
 * errno or signal in any casing (`ENOENT`, `sigterm`), named from its closed set in `RAW_CODE`;
 * a status written as a status, answered with or named as an error (`HTTP 401`, `returned 401`, `a 503 error`); an exit
 * status; a JavaScript runtime's or JSON parser's message with its class dropped; a sentence with no letter at all.
 *
 * **What it does not claim.** A runtime message made only of plain words (`Module not found.`) fits the shape and is
 * named nowhere here, and no list of words could close that class: it is English. Refusing every CamelCase word would
 * catch the rest of the class names and also `GitHub` and `OAuth`, which a plain sentence here names all the time. A
 * residue word spelled with a lookalike letter from another script (a Cyrillic `Е` in `Еrror`) is not named either: a
 * session writing one is evading the register, not pasting a record into it, and that is not what this guards. So
 * the guarantee is the shape's — no punctuation-bearing record — plus this residue, and the session writing the
 * sentence is what makes it plain.
 */
const RAW_RECORD = new RegExp(
  unicodeBoundaries({
    // Matched over the sentence with its combining marks dropped, so these name base letters alone. A class word may run
    // on past its Error or Exception in any letters whose first is not lowercase, titlecase and caseless scripts
    // included, while `Errors` stays a plural.
    source: String.raw`\b\p{L}*(?:Error|Exception)(?:(?!\p{Ll})\p{L}+)?\b|\b\p{L}*Warning\b|\b(?:KeyboardInterrupt|SystemExit|StopIteration|StopAsyncIteration|GeneratorExit|Throwable)\b|^[^\p{L}]*$`,
  }),
  "u",
);

/**
 * Every residue shape in ANY casing (`http 401`, `RETURNED 401`, `etimedout`, `sigterm`). An errno
 * and a signal are named here from a closed set rather than by their capitals, so "every" and "sign" stay words.
 */
const RAW_CODE = new RegExp(
  unicodeBoundaries({
    source: [
      // A status word with the number up to three words on, so `a status of 401` is the class rather than one more
      // phrasing of it.
      String.raw`\b(?:http|status(?:code)?|code)(?:[ ,]+[\p{L}\p{M}'’-]+){0,3}[ ,]+\p{Nd}{3}\b`,
      String.raw`\b\p{Nd}{3} (?:error|response|status|bad request|unauthorized|forbidden|not found|too many requests|internal server error|bad gateway|service unavailable|gateway timeout)\b`,
      String.raw`\b(?:returned|responded|answered|got|gave|threw|code) (?:(?:an?|the) )?(?:status(?: code)? )?\p{Nd}{3}\b`,
      String.raw`\bexit(?:ed)?(?: with)?(?: an?)? (?:code|status) \p{Nd}+\b`,
      String.raw`\bexited \p{Nd}+\b|\bexit \p{Nd}+\b`,
      // Every POSIX errno.h name bar `E2BIG` (a word mixing letters and digits is outside the shape already), plus
      // Node's `ENOTFOUND`. A closed set rather than "capitals after an E", which refused `EVERY`.
      String.raw`\be(?:acces|addrinuse|addrnotavail|afnosupport|again|already|badf|badmsg|busy|canceled|child|connaborted|connrefused|connreset|deadlk|destaddrreq|dom|dquot|exist|fault|fbig|hostunreach|idrm|ilseq|inprogress|intr|inval|io|isconn|isdir|loop|mfile|mlink|msgsize|multihop|nametoolong|netdown|netreset|netunreach|nfile|nobufs|nodata|nodev|noent|noexec|nolck|nolink|nomem|nomsg|noprotoopt|nospc|nosr|nostr|nosys|notconn|notdir|notempty|notfound|notrecoverable|notsock|notsup|nottty|nxio|opnotsupp|overflow|ownerdead|perm|pipe|proto|protonosupport|prototype|range|rofs|spipe|srch|stale|time|timedout|txtbsy|wouldblock|xdev)\b`,
      // Every POSIX signal name, said whole; `SIGUSR1` mixes letters and digits, so the shape refuses it already.
      String.raw`\bsig(?:abrt|alrm|bus|chld|cont|fpe|hup|ill|int|kill|pipe|poll|prof|quit|segv|stop|sys|term|trap|tstp|ttin|ttou|urg|vtalrm|xcpu|xfsz)\b`,
      String.raw`\btraceback most recent call last\b`,
      String.raw`\bcannot (?:read|set) propert(?:y|ies) of\b|\bis not (?:a function|a constructor|defined|iterable|valid json)\b`,
      String.raw`\bunexpected (?:token|end of json input|non-whitespace character)\b|\bmaximum call stack size exceeded\b`,
    ].join("|"),
  }),
  "iu",
);

/** A sentence's own close: its full stop, question or exclamation mark, in any script, at the end. */
const SENTENCE_END = new RegExp(`[${STOPS}]$`, "u");

/**
 * A stop before the sentence's own close: any question or exclamation mark, or a full stop that is not between two
 * digits. `It broke.reconnect it.` cannot be told from a host or file name by its shape, so the
 * register takes neither: a host name, a file name or an abbreviation such as `e.g.` costs a rewrite in words ("the
 * mail service"), never a page leading with two sentences. A version such as `2.4` keeps its full stop.
 */
const INNER_STOP = new RegExp(String.raw`[${STOPS.replace(".", "")}]|(?<!\p{Nd})\.|\.(?!\p{Nd})`, "u");

/**
 * Whether text is exactly one sentence: it ends in its own close, and nothing before that close stops a sentence.
 *
 * @returns true when it is one closed sentence
 */
function isOneSentence({ text }: { text: string }): boolean {
  const end = SENTENCE_END.exec(text);
  if (end === null) {
    return false;
  }
  return !INNER_STOP.test(text.slice(0, end.index));
}

/**
 * Whether a sentence is fit to lead a broken row: one line, not empty, short, made only of the shape's words and
 * numbers, none of them the residue's raw records, and one sentence — a stack frame or a JSON body is the very thing
 * this register exists to keep off the page, and the shape refuses either without having to name it.
 *
 * @param why the sentence a session offered
 * @returns the sentence trimmed, or which check it failed
 */
export function checkExplanationWords({ why }: { why: string }): Result<string, RecipeExplanationWordsUnfitError> {
  const trimmed = why.trim();
  if (trimmed.length === 0) {
    return err(RecipeErrors.explanationWordsEmpty());
  }
  if (/[\r\n]/u.test(trimmed)) {
    return err(RecipeErrors.explanationWordsMultiLine());
  }
  // Counted in code points, never UTF-16 units, so a letter outside the Basic Multilingual Plane costs one,
  // and never graphemes, so a letter stacked with a thousand combining marks cannot pass the cap as one.
  const characters = Array.from(trimmed).length;
  if (characters > FAILURE_EXPLANATION_MAX_CHARS) {
    return err(RecipeErrors.explanationWordsTooLong({ cap: FAILURE_EXPLANATION_MAX_CHARS, length: characters }));
  }
  const outside = OUTSIDE_SHAPE.exec(trimmed);
  if (outside !== null) {
    return err(RecipeErrors.explanationWordsOutsideShape({ found: outside[0] }));
  }
  // The residue is matched as spoken: every run of commas and spaces reads as one space, so a comma the shape allows
  // cannot part a verb from its status (`returned, 401`), and every combining mark is dropped from its decomposed
  // letter, so an accent anywhere in a class word cannot part it either (`Erroŕ Group` written as one word).
  const spoken = trimmed.normalize("NFD").replace(COMBINING_MARK, "").replace(SEPARATOR_RUN, " ");
  if (RAW_RECORD.test(spoken) || RAW_CODE.test(spoken)) {
    return err(RecipeErrors.explanationWordsRawRecord());
  }
  if (!isOneSentence({ text: trimmed })) {
    return err(RecipeErrors.explanationWordsNotOneSentence());
  }
  if (!SHAPE.test(trimmed)) {
    return err(RecipeErrors.explanationWordsOutsideShape({ found: undefined }));
  }
  return ok(trimmed);
}

/**
 * The key one firing's explanation is filed under.
 *
 * @returns the key
 */
export function explanationKey({ slotIso, attempt }: { slotIso: string; attempt: number }): string {
  return `${slotIso}#${String(attempt)}`;
}

/** Whether a field is a non-empty string. */
function isFilled(field: unknown): field is string {
  return typeof field === "string" && field.length > 0;
}

/**
 * Read one register line's value as an explanation, or nothing when it is not one. The sentence is held to the same
 * words check the append makes, so a line written past the verb — a stack frame, a JSON body, two lines — never
 * reaches the page as the plain explanation.
 *
 * @param value one decoded JSONL line
 * @returns the explanation, or `undefined` when a field is missing, the wrong shape, or not one plain sentence
 */
function parseFailureExplanation({ value }: { value: unknown }): FailureExplanation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { recipeId, slotIso, attempt, why, recordedIso } = value;
  if (!isFilled(recipeId) || !isFilled(slotIso) || !isFilled(why) || !isFilled(recordedIso)) {
    return undefined;
  }
  if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 1) {
    return undefined;
  }
  // A recording time that is not one instant cannot be ordered, and under `Date.parse` it would outrank a valid line
  // for the same firing; refused, the line counts as unparsed and the register stands down. A slot
  // that is not one instant keys no firing, so a correction filed under it would leave an older sentence leading: it
  // is refused the same way.
  if (
    parseStrictIsoInstantMs({ text: recordedIso }) === undefined ||
    parseStrictIsoInstantMs({ text: slotIso }) === undefined
  ) {
    return undefined;
  }
  const words = checkExplanationWords({ why });
  if (words.isErr()) {
    return undefined;
  }
  return { attempt, recipeId, recordedIso, slotIso, why: words.value };
}

/**
 * What the slot ledger holds for the exact firing an explanation names, said as a word, or `null` when it holds that
 * firing as failed or dead — the only firings a plain sentence may describe.
 */
function notAFailure({ home, explanation }: { home: string; explanation: FailureExplanation }): string | null {
  const row = readSlotAttempt({ home, recipeId: explanation.recipeId, slotIso: explanation.slotIso });
  if (row.isErr()) {
    return "unreadable in the slot ledger";
  }
  if (row.value === null) {
    return "not recorded";
  }
  if (row.value.attempt !== explanation.attempt) {
    return `not the slot's recorded attempt (${String(row.value.attempt)})`;
  }
  const outcome = row.value.outcome;
  if (outcome === null) {
    return "still open";
  }
  if (outcome.kind === "failed" || outcome.kind === "dead") {
    return null;
  }
  return outcome.kind;
}

/**
 * Append one explanation, once its words are one plain sentence and the slot ledger holds the exact firing it names as
 * failed or dead: a raw record would lead the row in the sentence's place, and a sentence about a failure that did not
 * happen would read as one that did, so the register itself refuses both, whoever the caller.
 *
 * @param home the Slopweaver home the register and the slot ledger live under
 * @param explanation the explanation to write; its sentence is filed trimmed
 * @returns ok, or why it was refused or the append failed
 */
export function appendFailureExplanation({
  home,
  explanation: offered,
}: {
  home: string;
  explanation: FailureExplanation;
}): Result<void, RecipeError> {
  const words = checkExplanationWords({ why: offered.why });
  if (words.isErr()) {
    return err(RecipeErrors.explanationWordsRefused({ recipeId: offered.recipeId, why: words.error.message }));
  }
  if (parseStrictIsoInstantMs({ text: offered.recordedIso }) === undefined) {
    return err(
      RecipeErrors.explanationInstantUnreadable({ recipeId: offered.recipeId, recordedIso: offered.recordedIso }),
    );
  }
  const explanation: FailureExplanation = { ...offered, why: words.value };
  const found = notAFailure({ explanation, home });
  if (found !== null) {
    return err(RecipeErrors.explanationNotAFailure({ ...explanation, found }));
  }
  const path = stateHomePaths({ home }).live.recipe.failureExplanationsJsonl;
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({
      path,
      text: `${safeJsonStringify({ label: "a failure explanation", value: explanation })}\n`,
    });
  } catch (error: unknown) {
    return err(RecipeErrors.explanationsFileUnwritable({ detail: String(error), path }));
  }
  return ok(undefined);
}

/**
 * Every explanation in the register, oldest first, and the 1-based numbers of the lines that did not read as one.
 * A path with nothing on it is an empty register, a dangling link an unreadable one; a torn line is counted rather than failing the read.
 *
 * @param home the Slopweaver home the register lives under
 * @returns the explanations and the unparsed line numbers, or why the file could not be read at all
 */
export function readFailureExplanations({ home }: { home: string }): Result<
  {
    readonly explanations: readonly FailureExplanation[];
    readonly unparsed: readonly number[];
  },
  RecipeError
> {
  const path = stateHomePaths({ home }).live.recipe.failureExplanationsJsonl;
  const explanations: FailureExplanation[] = [];
  const unparsed: number[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim().length === 0) {
          return;
        }
        let value: unknown;
        try {
          value = safeJsonParse({ label: "a failure explanation", text: line });
        } catch {
          unparsed.push(index + 1);
          return;
        }
        const explanation = parseFailureExplanation({ value });
        if (explanation === undefined) {
          unparsed.push(index + 1);
          return;
        }
        explanations.push(explanation);
      },
      path,
      // A line holding a byte that is not UTF-8 arrives as one lone U+FFFD and counts as unparsed, never as its
      // silently repaired text, so a corrupt register never speaks.
      strictUtf8: true,
    });
  } catch (error: unknown) {
    // Only a path with nothing on it is an empty register. A dangling link answers ENOENT too, and reading that as
    // absent named every failure unexplained over a register no read reached.
    if (isAbsentError({ error, path })) {
      return ok({ explanations: [], unparsed: [] });
    }
    return err(RecipeErrors.explanationsFileUnreadable({ detail: String(error), path }));
  }
  return ok({ explanations, unparsed });
}

/**
 * Each recipe's explanations, keyed by firing ({@link explanationKey}) — the line appended LAST per firing winning,
 * by register order alone. Never by `recordedIso`: a wall clock stepped back would let a correction lose to the words
 * it corrects, and append order is the order the session wrote them in.
 *
 * @param explanations every explanation, in register order
 * @returns recipe id → firing key → the sentence
 */
export function explanationsByRecipe({
  explanations,
}: {
  explanations: readonly FailureExplanation[];
}): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const newest = new Map<string, Map<string, FailureExplanation>>();
  for (const explanation of explanations) {
    let firings = newest.get(explanation.recipeId);
    if (firings === undefined) {
      firings = new Map();
      newest.set(explanation.recipeId, firings);
    }
    firings.set(explanationKey(explanation), explanation);
  }
  return new Map(
    [...newest].map(([recipeId, firings]) => [
      recipeId,
      new Map([...firings].map(([key, explanation]) => [key, explanation.why])),
    ]),
  );
}
