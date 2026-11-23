/**
 * `index-line-drift` — a `MEMORY.md` line naming a fact the memory it routes does not carry.
 *
 * The index line is what loads every session; the leaf is what a session reads when it follows the line. When
 * the two disagree, the version that loads is the stale one. A hygiene pass found index lines still
 * stating rules their leaves had dropped.
 *
 * ## Why only IDENTIFIERS are compared
 *
 * Measured: plain word overlap does not separate drift from paraphrase, because an index line is a
 * compression written in other words. What it cannot legitimately do is name an IDENTIFIER the leaf lacks — a
 * date, an owner turn id, a pull request, a proper name — since none of those has another spelling.
 *
 * Numbers and code spans were compared too, and measured out. Across twelve corpora on disk (every backup from
 * a fortnight, a pre-pass stash, both live corpora) they fired 40 times with no true positive:
 * `3` against "three", `1200` against "1,200", `4`/`9` against "four of the nine", `turn answer
 * --print-digest` against the full command, a clock time against its rounded form. A count is spelled out and a command
 * abbreviated as a matter of course, so neither is read. Code spans are still blanked first, so a name inside
 * one is not read either.
 *
 * Stated residue: this is a tripwire nothing in those corpora has yet tripped. A paraphrase that REVERSES meaning
 * without changing an identifier — an index line saying "buy a plan on sight" over a leaf
 * that says never buy one — is a reading task; `types.ts` records that a vocabulary proxy for meaning was tried
 * and produced false positives. Only the root index is judged: topic indexes do not load at boot.
 */
import { DAY_MONTH_SOURCE } from "./addendum.js";
import { corpusIndexes } from "./corpus.js";
import { type MemoryCorpus, type MemoryFinding, ROOT_INDEX_FILE } from "./types.js";

/** Which rule compares a token against the leaf. */
type HookTokenKind = "date" | "iso-date" | "turn" | "pull" | "name";

/** One identifier an index line states. */
export interface HookToken {
  readonly kind: HookTokenKind;
  /** The token as written in the hook, for the message. */
  readonly text: string;
}

/** One extraction pass: its first capture group is the token, `kind` how the leaf is searched for it. */
interface TokenPass {
  readonly kind: HookTokenKind;
  readonly pattern: RegExp;
}

/** A code span: blanked before any pass, and never itself a token. */
const CODE_SPAN = /`[^`\n]+`/g;

/**
 * The passes, in order. Each blanks what it takes so a later pass cannot re-read it: an ISO date runs before a
 * turn id, or `YYYY-MM-DD` would also yield the turn id `MM-DD`.
 */
const PASSES: readonly TokenPass[] = [
  { kind: "iso-date", pattern: /\b(\d{4}-\d{2}-\d{2})\b/g },
  { kind: "date", pattern: new RegExp(DAY_MONTH_SOURCE, "g") },
  // Three digits first: every owner turn id carries one, and a two-digit prefix is a range (`10-15 rows`).
  { kind: "turn", pattern: /(?<![\w-])(\d{3}-\d{1,3}[a-z]?)(?![\w-])/g },
  { kind: "pull", pattern: /(?<![\w&])(#\d+)\b/g },
  // Not after `:` or `;`, which open a clause as often as a sentence stop does.
  { kind: "name", pattern: /(?<=[\w,()'"]\s+)([A-Z][a-z]+(?:[A-Z][a-z]+)*)\b/g },
];

/** A capitalised calendar word — a weekday or a month, whole or abbreviated — which names a time, never an identifier. */
const CALENDAR_WORD =
  /^(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)days?|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)$/;

/** The same text with every match of `pattern` replaced by spaces, so offsets and lengths are unchanged. */
function blanked({ text, pattern }: { text: string; pattern: RegExp }): string {
  return text.replaceAll(pattern, (match) => " ".repeat(match.length));
}

/**
 * The identifiers an index hook states, deduplicated, in pass order.
 *
 * @param hook the text an index line says after its link
 * @returns the identifiers to look for in the leaf
 */
export function hookTokens({ hook }: { hook: string }): readonly HookToken[] {
  const tokens: HookToken[] = [];
  const seen = new Set<string>();
  let rest = blanked({ pattern: CODE_SPAN, text: hook });
  for (const pass of PASSES) {
    for (const match of rest.matchAll(pass.pattern)) {
      const text = match[1]!;
      const key = `${pass.kind}\u0000${text.toLowerCase()}`;
      const calendar = pass.kind === "name" && CALENDAR_WORD.test(text);
      if (!calendar && !seen.has(key)) {
        seen.add(key);
        tokens.push({ kind: pass.kind, text });
      }
    }
    rest = blanked({ pattern: pass.pattern, text: rest });
  }
  return tokens;
}

/** A token's text as a literal pattern fragment — the token is data, never a pattern of its own. */
function escaped({ text }: { text: string }): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a leaf's text carries one identifier, compared the way that identifier's kind is written.
 *
 * @param text the leaf file, frontmatter included — an identifier in its `description` counts
 * @param token the identifier the index line states
 * @returns whether the leaf says it too
 */
export function leafCarriesToken({ text, token }: { text: string; token: HookToken }): boolean {
  const wanted = escaped({ text: token.text });
  switch (token.kind) {
    case "pull":
      // `#N` in the index, "PR N" or a URL ending `/N` in the memory: the number is the identifier.
      return new RegExp(`(?<!\\d)${escaped({ text: token.text.slice(1) })}(?!\\d)`).test(text);
    case "iso-date":
    case "turn":
      return new RegExp(`(?<![\\w-])${wanted}(?![\\w-])`).test(text);
    case "date":
    case "name":
      // Left-bounded only: an abbreviated month is carried by its full name, and a name by its possessive.
      return new RegExp(`(?<![\\w-])${wanted}`, "i").test(text);
    default: {
      const unhandled: never = token.kind;
      return unhandled;
    }
  }
}

/**
 * `index-line-drift`: every leaf whose root-index line names a fact the leaf does not carry. Attributed to the
 * LEAF, with no line number in the message, so the weekly hygiene row carries it and the gate's accepted-debt
 * key survives an index edit that shifts lines.
 *
 * ONE finding per missing identifier, never one per leaf listing them: the message is the gate's accepted-debt
 * key, so a list would turn a partial repair into a "new" defect, and two root lines for one leaf would
 * overwrite each other in whichever order the index happened to hold them.
 *
 * @param corpus the classified corpus
 * @returns one finding per identifier a root line names and its memory lacks, deduplicated per memory
 */
export function indexLineDriftFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  const root = corpusIndexes({ corpus }).find((index) => index.file === ROOT_INDEX_FILE);
  if (root === undefined) {
    return [];
  }
  const leaves = new Map(corpus.leaves.map((leaf) => [leaf.stem, leaf]));
  const findings = new Map<string, MemoryFinding>();
  for (const pointer of root.pointers.filter((p) => !p.outside)) {
    const leaf = leaves.get(pointer.target);
    if (leaf === undefined) {
      continue;
    }
    for (const token of hookTokens({ hook: pointer.hook })) {
      if (!leafCarriesToken({ text: leaf.text, token })) {
        const message = `the ${ROOT_INDEX_FILE} line routing this memory says \`${token.text}\`, and nothing in the memory carries that — the line that loads every session and the memory it points at disagree`;
        findings.set(`${leaf.file}\u0000${message}`, {
          check: "index-line-drift",
          file: leaf.file,
          line: null,
          message,
        });
      }
    }
  }
  return [...findings.values()];
}
