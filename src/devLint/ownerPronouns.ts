/**
 * The owner-pronoun class of the transient-references gate (`transientReferences.ts`): the repository speaks of
 * whoever runs it as "the owner", then they, and never by the third-person masculine pronouns.
 *
 * ## Why this is a class
 *
 * Slopweaver is generic to any checkout (`AGENTS.md` § Non-negotiable), so its prose cannot assume who the owner is.
 * The vocabulary is fixed: "the owner" on first mention in agent instructions and docs, then they/them/their; "you"
 * on a surface that speaks to the owner directly; never "the user", which already means a Slack, provider or Claude
 * Code user here. The text grew from one installation, so the four words stood tens of thousands of times, almost
 * every one about the owner; the gate's debt list is what stops new text adding one behind the rewrite.
 *
 * ## The criterion, not a count
 *
 * A whole-word, case-insensitive third-person masculine pronoun (subject, object, possessive or reflexive)
 * anywhere in a file the gate scans, tests included: a test's name and the string it pins move with the code
 * they pin, and a stored value spelled as the object pronoun is the product gendering its owner. In TypeScript and TSX, a match inside a regular-expression literal node, or inside the
 * pattern argument of a `RegExp` constructor, is outside it, read off the AST: a pattern that recognises how people
 * speak (the question form in `src/briefing/sectionQuality.ts`) is about any speaker, never the owner, and it
 * gains the feminine and plural forms beside it rather than losing the masculine one.
 *
 * What it is, said plainly: four masculine tokens. It cannot tell the owner from anybody else, nor see "the user"
 * or a wrong audience; the vocabulary above is the composer's, and this class only stops the old words.
 *
 * An identifier is outside it by construction, since the boundary sees none inside `hisWords`. Those names are
 * renamed with the stored values they read, behind readers that accept both spellings.
 *
 * ## Blind spots, stated rather than discovered
 *
 * - A word that refers to somebody other than the owner (a named founder in a corpus doc) is counted the same. Its
 *   rewrite names the person, which is clearer anyway.
 * - A recogniser written as a plain string (a word-list `Set`, a phrase array matching old board text) is debt
 *   until it is rewritten as a regular expression. Collections are deliberately NOT exempt, since product prose could
 *   hide in one.
 * - One word swapped for another in the same file keeps its count, so that change passes. Review sees it; the
 *   ratchet does not.
 * - A pronoun built at runtime, or arriving as data, is invisible.
 */

import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { lineAt, lineTable } from "./transientReferenceLines.js";

/** The four third-person masculine pronouns the criterion reads, lowercased. */
type OwnerPronoun = "he" | "him" | "his" | "himself";

/** One counted word: where it is, which word, and the line it sits on. */
export interface OwnerPronounHit {
  readonly path: string;
  readonly line: number;
  /** The match's start offset, so two words on one line stay two findings. */
  readonly offset: number;
  readonly word: OwnerPronoun;
  readonly preview: string;
}

/** A half-open span of a file's text the criterion does not read. */
interface TextRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The four words, whole, any case. Whole against any letter, mark, digit or underscore, not `\b`'s ASCII word set, so
 * `éhe` is no pronoun and `hisWords` none either. Case is spelled as ASCII classes rather than the `i` flag, because
 * `iu` folds Unicode too and would admit a long-s spelling of the possessive. A fresh instance per scan, since a global regex
 * carries `lastIndex`.
 */
const pronounPattern = (): RegExp =>
  /(?<![\p{L}\p{M}\p{N}_])[hH](?:[eE]|[iI][mM](?:[sS][eE][lL][fF])?|[iI][sS])(?![\p{L}\p{M}\p{N}_])/gu;

/** Each lowercased match back to its word; the pattern admits nothing else, so a lookup always lands. */
const WORDS: ReadonlyMap<string, OwnerPronoun> = new Map(
  (["he", "him", "his", "himself"] as const).map((word) => [word, word]),
);

/** The extensions the AST reads for regular-expression literals. */
const TYPESCRIPT_EXTENSIONS: readonly string[] = [".ts", ".tsx"];

/**
 * The pattern argument of `RegExp(...)` or `new RegExp(...)`, the first one only, so the flags and anything else
 * passed stay counted. The callee may be parenthesised, `(RegExp)`, or reached as a property, `globalThis.RegExp`.
 * `undefined` for any other node.
 */
function regExpPatternArgument({ node }: { node: ts.Node }): ts.Expression | undefined {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) {
    return undefined;
  }
  let callee: ts.Expression = node.expression;
  while (ts.isParenthesizedExpression(callee)) {
    callee = callee.expression;
  }
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  if (!ts.isIdentifier(name) || name.text !== "RegExp") {
    return undefined;
  }
  return node.arguments?.[0];
}

/** Every regular-expression literal's span, and every `RegExp` constructor's pattern, in a TypeScript file. Pure. */
function regexLiteralRanges({ path, content }: { path: string; content: string }): readonly TextRange[] {
  const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return withSourceFile({
    fileName: path,
    scriptKind,
    text: content,
    use: (sf): readonly TextRange[] => {
      const ranges: TextRange[] = [];
      const visit: NodeVisitor = (node) => {
        if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
          ranges.push({ end: node.getEnd(), start: node.getStart(sf) });
          return undefined;
        }
        const pattern = regExpPatternArgument({ node });
        if (pattern !== undefined) {
          ranges.push({ end: pattern.getEnd(), start: pattern.getStart(sf) });
        }
        forEachChild({ node, visit });
        return undefined;
      };
      visit(sf);
      return ranges;
    },
  });
}

/**
 * Every counted word in one file, in source order. Pure: a TypeScript or TSX file is parsed in memory, and only when
 * it carries a candidate word at all, so the regular-expression literals can be left out.
 *
 * @param path the file's repo-relative path, carried onto each hit and deciding whether the AST is read
 * @param content the file's text
 * @returns each counted word
 */
export function scanOwnerPronouns({ path, content }: { path: string; content: string }): readonly OwnerPronounHit[] {
  if (!pronounPattern().test(content)) {
    return [];
  }
  const excluded = TYPESCRIPT_EXTENSIONS.some((ext) => path.endsWith(ext)) ? regexLiteralRanges({ content, path }) : [];
  const table = lineTable({ content });
  const hits: OwnerPronounHit[] = [];
  for (const match of content.matchAll(pronounPattern())) {
    const offset = match.index;
    if (!excluded.some((range) => offset >= range.start && offset < range.end)) {
      hits.push({ ...lineAt({ offset, table }), offset, path, word: WORDS.get(match[0].toLowerCase())! });
    }
  }
  return hits;
}
