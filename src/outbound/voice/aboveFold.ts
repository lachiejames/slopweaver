/**
 * The structural half of "human readable above the fold" — the rules a machine can decide.
 *
 * Rule 7 says an outbound message is concise above the fold with everything else collapsed, and that shape
 * is enforced by the SCHEMA rather than by review. The word caps already did the length half. This module
 * does the PACKING half, which is what the voice exercise measured as the thing that actually
 * moved: both damaged cells crammed three separate facts into one sentence, joined by a colon-introduced
 * list. Length was not the defect — one rewrite came out a word LONGER and read far better.
 *
 * ## What this owns, and what it deliberately does not
 *
 * Owned: colon-introduced lists, semicolon-joined clauses, a second parenthetical aside, an over-long
 * sentence. Every one of those is a SHAPE, decidable from the text, and each has a rewrite that is strictly
 * better prose rather than a shorter version of the same prose.
 *
 * Not owned: which fact leads. "Lead with the fact that changes the reader's verdict" is the move with the
 * biggest yield in that exercise, and no gate can compute it — for one pull request the surprise was "we did
 * this to ourselves" and for another it was "nothing of ours calls the vulnerable code". That stays a
 * composer instruction in `skills/github/reference/pull-requests.md`, stated as judgement, never faked here.
 *
 * The operator's own banned characters and words are not here either: they live in private `profile.json`
 * configuration and are matched by `./exactRules.ts`. This module is the part the public repository can own.
 *
 * ## Everything is measured over AUTHORED PROSE, not raw text
 *
 * `authoredProseOf` removes fenced code, quoted third-party lines, URLs, inline code and technical
 * identifiers, and it is the same extractor the exact rules use. So a version number is not a word here and
 * a colon inside a timestamp is not a colon. That extractor had to be fixed before any of this could
 * measure anything true: it used to eat an identifier's TRAILING punctuation with the identifier, which
 * welded `5.2.0. Four open …` into one sentence and deleted the very colon this module looks for.
 */
import {
  authoredProseOf,
  type ExactVoiceRule,
  exactVoiceRuleFindings,
  voiceRuleLabel,
  voiceRuleSubject,
} from "./exactRules.js";

/**
 * The longest sentence an above-the-fold cell may carry, in authored-prose words.
 *
 * The backstop rather than the front line, and the exercise says exactly why: it fires on one of the two
 * damaged cells and misses the other, whose worst sentence is exactly 30 words. Packing is what a colon and
 * a semicolon catch; this catches the sentence that is simply too long to hold in one breath.
 */
export const ABOVE_FOLD_SENTENCE_MAX_WORDS = 30;

/**
 * How many parenthetical asides one above-the-fold cell may carry.
 *
 * ONE, not zero. The owner named "the removal of the formatting and brackets" as part of what made the
 * rewrites read better, and both rewritten Problem cells carry none — but so do two of the four current
 * cells, and a flat ban would refuse a cell nobody thought was damaged. Measured over the exercise's eight
 * cells: every current cell carries at most one aside and every rewrite carries none, so a cap of one
 * changes no verdict on its own and a cap of zero would refuse three cells the owner did not complain
 * about. The cap earns its place as a ceiling on stacking asides, which is the shape that packs a cell.
 */
export const ABOVE_FOLD_MAX_PARENTHETICALS = 1;

/** One above-the-fold region, named by the form field a caller can actually go and fix. */
export interface AboveFoldCell {
  readonly path: string;
  readonly text: string;
}

/** Which fold rule one finding broke. Reachable from outside as `AboveFoldFinding["code"]`. */
type AboveFoldRuleCode =
  "colon-list" | "semicolon-clauses" | "parentheticals" | "long-sentence" | "voice-rule" | "voice-rule-below-fold";

/**
 * One refusal, carrying the field, the rule and the correction.
 *
 * A list of same-shaped problems rather than a discriminated error union, and deliberately so: the whole
 * point of one pass is to report every violation at once, which a single typed error would lose. See
 * `.claude/rules/error-handling.md` on when NOT to introduce a union.
 */
export interface AboveFoldFinding {
  readonly code: AboveFoldRuleCode;
  readonly path: string;
  readonly message: string;
}

/** A colon that is followed by more prose in the same sentence — the shape that introduces a list. */
const COLON_INTRODUCER = /:\s*\S/u;

/** Sentence-final punctuation followed by whitespace. */
const SENTENCE_BREAK = /(?<=[.!?])\s+/u;

/** One authored-prose word: anything carrying a letter or a digit. */
const PROSE_WORD = /[\p{L}\p{N}]/u;

/** An opening parenthesis that does not directly follow a word character, so an aside rather than a call. */
const PARENTHETICAL = /(?<![\p{L}\p{N}_])\(/gu;

/** The words of one authored-prose run, counted the way the sentence cap counts them. */
function proseWordsOf({ text }: { text: string }): readonly string[] {
  return text.split(/\s+/u).filter((word) => PROSE_WORD.test(word));
}

/** Every sentence in one authored-prose run, with the empty tail of a trailing full stop dropped. */
function sentencesOf({ text }: { text: string }): readonly string[] {
  return text
    .split(SENTENCE_BREAK)
    .map((sentence) => sentence.trim())
    .filter((sentence) => PROSE_WORD.test(sentence));
}

/** Whether one sentence introduces a list after a colon: a colon, then a comma or a joining word. */
function hasColonList({ sentence }: { sentence: string }): boolean {
  const colon = sentence.indexOf(":");
  if (colon === -1 || !COLON_INTRODUCER.test(sentence.slice(colon))) {
    return false;
  }
  const after = sentence.slice(colon + 1);
  return after.includes(",") || /\b(?:and|or)\b/iu.test(after);
}

/** Every finding in ONE sentence: a colon-introduced list, joined clauses, or simply too long. */
function sentenceFindings({ sentence, path }: { sentence: string; path: string }): readonly AboveFoldFinding[] {
  const findings: AboveFoldFinding[] = [];
  if (hasColonList({ sentence })) {
    findings.push({
      code: "colon-list",
      message:
        "a colon introducing a list packs several facts into one sentence. Split it into one sentence per " +
        "fact, and move the taxonomy below the fold where it is already named in full.",
      path,
    });
  }
  if (sentence.includes(";")) {
    findings.push({
      code: "semicolon-clauses",
      message:
        "a semicolon joins two clauses that are two facts. Make them two sentences; nothing above the fold " +
        "needs a reader to hold both halves at once.",
      path,
    });
  }
  const words = proseWordsOf({ text: sentence }).length;
  if (words > ABOVE_FOLD_SENTENCE_MAX_WORDS) {
    findings.push({
      code: "long-sentence",
      message:
        `one sentence is ${String(words)} authored-prose words (max ${String(ABOVE_FOLD_SENTENCE_MAX_WORDS)}). ` +
        "Split it. Technical identifiers are not counted, so this is longer than it looks.",
      path,
    });
  }
  return findings;
}

/** Every aside past the cap in one prose region, as at most one finding. */
function asideFindings({ region, path }: { region: string; path: string }): readonly AboveFoldFinding[] {
  const asides = region.match(PARENTHETICAL)?.length;
  if (asides === undefined || asides <= ABOVE_FOLD_MAX_PARENTHETICALS) {
    return [];
  }
  return [
    {
      code: "parentheticals",
      message:
        `${String(asides)} parenthetical asides (max ${String(ABOVE_FOLD_MAX_PARENTHETICALS)}). An aside above ` +
        "the fold is a fact the sentence did not want. Promote it to its own sentence or move it below.",
      path,
    },
  ];
}

/** Every sentence-shape finding in one cell's authored prose. */
function structureFindings({ cell }: { cell: AboveFoldCell }): readonly AboveFoldFinding[] {
  return authoredProseOf({ path: cell.path, text: cell.text }).flatMap((region) => [
    ...sentencesOf({ text: region.text }).flatMap((sentence) => sentenceFindings({ path: region.path, sentence })),
    ...asideFindings({ path: region.path, region: region.text }),
  ]);
}

/**
 * Every above-the-fold violation in one set of cells: the operator's exact voice rules, and the structural
 * packing rules this module owns.
 *
 * One pass over every cell, reporting everything at once, because a caller filling a form wants the whole
 * correction rather than the first half of it.
 *
 * @param cells the above-the-fold regions, each named by the field a caller can fix
 * @param rules the operator's private exact rules, empty when none are configured
 * @returns one finding per violation, in cell order then rule order
 */
export function aboveFoldFindings({
  cells,
  rules,
}: {
  cells: readonly AboveFoldCell[];
  rules: readonly ExactVoiceRule[];
}): readonly AboveFoldFinding[] {
  return cells.flatMap((cell) => [
    ...exactVoiceRuleFindings({
      prose: authoredProseOf({ path: cell.path, text: cell.text }),
      rules,
    }).map((finding): AboveFoldFinding => ({
      code: "voice-rule",
      message: `${voiceRuleLabel({ rule: finding.rule })}. Rewrite the authored prose.`,
      path: finding.path,
    })),
    ...structureFindings({ cell }),
  ]);
}

/**
 * Every BELOW-the-fold voice-rule violation, one finding per RULE rather than one per match.
 *
 * ## Why the vocabulary rules only, and never the structural family
 *
 * The packing rules above are about what a reader can hold in one breath BEFORE deciding to expand. Below
 * the fold a reader has already chosen to read, so a colon-introduced list is a table of contents rather
 * than a cram and a forty-word sentence is prose. Applying them there would refuse the very shape that
 * makes the fold work. What survives the move is the operator's own vocabulary: an em dash, a banned word
 * or an AI trope reads exactly as wrong in an expanded detail block as it does in a TL;DR, and that is the
 * half the 26 anchored instances of `voice-rules-run-late-and-only-on-one-lane` are actually about.
 *
 * ## Why one finding per rule, and why it can never refuse
 *
 * Measured, and the reason this is not one finding per region: run over this repository's own
 * recurring-failure register, every page joined, the em-dash literal alone matches 169 separate prose regions.
 * `authoredProseOf` splits multi-line text one region per line, so a raw line count lands
 * close: `grep -h '—' docs/recurring-failure-register.md docs/recurring-failure-register/*.md | wc -l`
 * reports 172. `belowFold.test.ts` pins the aggregation over the same pages. A hundred and sixty-nine
 * warning lines carrying one rule is the wall of text rule 7 bans, printed by the gate that exists to
 * enforce rule 7. So each rule reports ONCE, carrying how wide it fired and where to start.
 *
 * The count is REGIONS, never occurrences, because `exactVoiceRuleFindings` answers "does this rule match
 * this region" rather than "how often". Two em dashes on one line count once, which is the honest number to
 * report from the data actually in hand.
 *
 * A warning rather than a refusal is the rule: NO hard blocks for voice. The word rules
 * are ordinary English at the length a fold runs to, so `leverage the cache` in a changelog line and
 * `this smells like a race` in an incident note both match, and a refusal would make this repository's own
 * recurring-failure register unwritable.
 *
 * @param cells the below-the-fold regions, each named by the field a caller can fix
 * @param rules the operator's private exact rules, empty when none are configured
 * @returns at most one finding per rule that matched, in the order the rules first fired
 */
export function belowFoldFindings({
  cells,
  rules,
}: {
  cells: readonly AboveFoldCell[];
  rules: readonly ExactVoiceRule[];
}): readonly AboveFoldFinding[] {
  const byRule = new Map<string, { rule: ExactVoiceRule; path: string; matches: number }>();
  for (const cell of cells) {
    const prose = authoredProseOf({ path: cell.path, text: cell.text });
    for (const finding of exactVoiceRuleFindings({ prose, rules })) {
      const key = `${finding.rule.kind} ${voiceRuleSubject({ rule: finding.rule })}`;
      const seen = byRule.get(key);
      // A rule's first match opens its entry at this field; every later one only adds to the count.
      if (seen === undefined) {
        byRule.set(key, { matches: 1, path: finding.path, rule: finding.rule });
        continue;
      }
      byRule.set(key, { matches: seen.matches + 1, path: seen.path, rule: finding.rule });
    }
  }
  return [...byRule.values()].map((entry) => ({
    code: "voice-rule-below-fold" as const,
    message:
      `${voiceRuleLabel({ rule: entry.rule })} in ` +
      `${String(entry.matches)} below-the-fold region(s), first at this field. Below the fold this WARNS ` +
      "and never refuses: rewrite what is yours, ignore what is a quotation.",
    path: entry.path,
  }));
}
