/**
 * A negative pin on a retired prompt rule. A rule names the owner in more than one way — "the owner", "they", a
 * pronoun — and a pin on one spelling passes once the same rule returns in another, so a pin's phrase writes the
 * owner as they, them, their or themselves and each of those matches any spelling of the owner.
 * A retired rule returning as "the owner has settled" keeps its meaning while changing its verb, so the verb after
 * a subject word matches either number.
 * "they're", "can't" and "may've" each keep a rule while changing its spelling, so any word fuses with a
 * following auxiliary or "not", anywhere.
 */

/** Every way a prompt line names the owner, as whole words; a regex literal, so the transient-references gate reads it as a pattern. */
const OWNER_WORD =
  /(?<![\p{L}'’])(?:the owner['’]s|the owner|themselves|their|them|they|himself|his|him|he)(?![\p{L}])/u;

/** A word in a pin's phrase that stands for the owner, as a whole token. */
const OWNER_SLOT = /^(?:themselves|their|them|they)$/iu;

/** The subject word for the owner, the one a following verb agrees with. */
const OWNER_SUBJECT = /^they$/iu;

/** A phrase split into words (apostrophes kept inside one) and the runs between them. */
const TOKEN = /[\p{L}'’]+|[^\p{L}'’]+/gu;

/** How many words after the subject word may carry its verb ("have", "then say"). */
const AGREEMENT_REACH = 2;

/** The verbs whose plural is not their singular less an s, keyed by either number, as every form either takes. */
const IRREGULAR: Readonly<Record<string, readonly string[]>> = {
  are: ["is", "are"],
  do: ["does", "do"],
  does: ["does", "do"],
  has: ["has", "have"],
  have: ["has", "have"],
  is: ["is", "are"],
  was: ["was", "were"],
  were: ["was", "were"],
};

/** A word that fuses onto the word before it, and the ending it leaves: "they've", "may've", "the owner's". */
const FUSED_ENDING: Readonly<Record<string, string>> = {
  am: "m",
  are: "re",
  had: "d",
  has: "s",
  have: "ve",
  is: "s",
  will: "ll",
  would: "d",
};

/** The auxiliaries a following "not" may fuse with ("doesn't", "haven't"). */
const AUXILIARY: ReadonlySet<string> = new Set([
  "are",
  "can",
  "could",
  "did",
  "do",
  "does",
  "had",
  "has",
  "have",
  "is",
  "must",
  "need",
  "should",
  "was",
  "were",
  "will",
  "would",
]);

/** The auxiliaries whose fused negative is not the word plus "n't". */
const NEGATED_IRREGULAR: Readonly<Record<string, string>> = {
  can: "can['’]t",
  will: "won['’]t",
};

/** "cannot" in every spelling a rule could return in. */
const CANNOT = "(?:cannot|can not|can['’]t)";

/**
 * Escape one run of a phrase so the pattern matches it literally.
 *
 * @returns the run with every regex metacharacter backslashed
 */
function literal({ text }: { text: string }): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Every form a word takes: both numbers when it follows the subject word, else the word alone. A phrase writes the
 * owner as they, so a verb arrives plural and its singular adds an s or an es; a singular one still drops its own.
 *
 * @param agrees whether the word sits within the subject word's reach
 * @returns the lowercased forms
 */
function formsOf({ agrees, word }: { agrees: boolean; word: string }): readonly string[] {
  const lower = word.toLowerCase();
  const irregular = IRREGULAR[lower];
  if (!agrees) return [lower];
  if (irregular !== undefined) return irregular;
  if (/[^s]es$/iu.test(word)) return [lower, lower.slice(0, -2), lower.slice(0, -1)];
  if (/[^s]s$/iu.test(word)) return [lower, lower.slice(0, -1)];
  return [lower, `${lower}s`, `${lower}es`];
}

/**
 * Whether the run is whitespace only, the gap between two words.
 *
 * @returns true for a run of spaces or a line break
 */
function isGap({ run }: { run: string | undefined }): boolean {
  return run !== undefined && /^\s+$/u.test(run);
}

/**
 * The pattern for a phrase from one token on, every spelling of it included: each retired pronoun as any owner
 * word, a verb in reach of a subject one in either number, and any word fused with a following auxiliary or "not".
 *
 * @param tokens the phrase's words and the runs between them
 * @param index the first token the pattern covers
 * @param reach how many more words still agree with a subject pronoun
 * @param memo patterns already built, keyed by index and reach, so a phrase with many fusions stays linear
 * @returns the pattern source
 */
function patternFrom({
  index,
  memo,
  reach,
  tokens,
}: {
  index: number;
  memo: Map<string, string>;
  reach: number;
  tokens: readonly string[];
}): string {
  const key = `${index}:${reach}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  const built = buildFrom({ index, memo, reach, tokens });
  memo.set(key, built);
  return built;
}

/**
 * Build the pattern patternFrom memoises.
 *
 * @param tokens the phrase's words and the runs between them
 * @param index the first token the pattern covers
 * @param reach how many more words still agree with a subject pronoun
 * @param memo patterns already built, passed on to the tokens after this one
 * @returns the pattern source
 */
function buildFrom({
  index,
  memo,
  reach,
  tokens,
}: {
  index: number;
  memo: Map<string, string>;
  reach: number;
  tokens: readonly string[];
}): string {
  const token = tokens[index];
  if (token === undefined) return "";
  if (!/\p{L}/u.test(token))
    return `${literal({ text: token })}${patternFrom({ index: index + 1, memo, reach, tokens })}`;
  const lower = token.toLowerCase();
  const pronoun = OWNER_SLOT.test(token);
  const agrees = !pronoun && reach > 0;
  let after = 0;
  if (pronoun && OWNER_SUBJECT.test(token)) after = AGREEMENT_REACH;
  if (agrees) after = reach - 1;
  const forms = formsOf({ agrees, word: token });
  let self = `(?:${forms.map((form) => literal({ text: form })).join("|")})`;
  if (pronoun) self = OWNER_WORD.source;
  if (lower === "cannot") self = CANNOT;
  const alternatives = [
    `${self}${patternFrom({ index: index + 1, memo, reach: after, tokens })}`,
    ...fusedAlternatives({ after, forms, index, memo, self, tokens }),
  ];
  return alternatives.length === 1 ? alternatives[0]! : `(?:${alternatives.join("|")})`;
}

/**
 * The alternatives where the word at index fuses with the word after it: an auxiliary ("they've") or "not"
 * ("doesn't"). None when the next token is not a word one gap away.
 *
 * @param after how many words after this one still agree with a subject pronoun
 * @param forms every form the word at index takes
 * @param self the pattern the word at index already matches as
 * @param memo patterns already built, passed on to the tokens after the fused pair
 * @returns the fused alternatives' pattern sources
 */
function fusedAlternatives({
  after,
  forms,
  index,
  memo,
  self,
  tokens,
}: {
  after: number;
  forms: readonly string[];
  index: number;
  memo: Map<string, string>;
  self: string;
  tokens: readonly string[];
}): readonly string[] {
  const next = tokens[index + 2];
  if (!isGap({ run: tokens[index + 1] }) || next === undefined || !/\p{L}/u.test(next)) return [];
  const nextAgrees = after > 0;
  const rest = patternFrom({ index: index + 3, memo, reach: nextAgrees ? after - 1 : 0, tokens });
  const fused: string[] = [];
  const endings = formsOf({ agrees: nextAgrees, word: next }).flatMap((form) => {
    const ending = FUSED_ENDING[form];
    return ending === undefined ? [] : [ending];
  });
  if (endings.length > 0) fused.push(`${self}['’](?:${endings.join("|")})${rest}`);
  const negated = negatedAuxiliaries({ forms });
  if (next.toLowerCase() === "not" && negated.length > 0) fused.push(`(?:${negated.join("|")})${rest}`);
  return fused;
}

/**
 * Each auxiliary form fused with "not": "doesn't", and the irregular "can't" and "won't".
 *
 * @param forms every form the word takes; only the auxiliaries among them fuse
 * @returns the fused negatives' pattern sources
 */
function negatedAuxiliaries({ forms }: { forms: readonly string[] }): readonly string[] {
  return forms
    .filter((form) => AUXILIARY.has(form))
    .map((form) => {
      const irregular = NEGATED_IRREGULAR[form];
      if (irregular !== undefined) return irregular;
      return `${literal({ text: form })}n['’]t`;
    });
}

/**
 * Turn a retired prompt phrase into a pattern that matches it under any spelling of the owner.
 *
 * @param phrase the retired wording, the owner written as they, them, their or themselves
 * @returns a case-insensitive pattern where each owner word in the phrase matches any owner word, the verb after
 *   the subject one matches either number, and any word matches fused with a following auxiliary or "not"
 */
export function ownerNeutral({ phrase }: { phrase: string }): RegExp {
  const tokens = Array.from(phrase.matchAll(TOKEN), ([token]) => token);
  return new RegExp(patternFrom({ index: 0, memo: new Map(), reach: 0, tokens }), "iu");
}
