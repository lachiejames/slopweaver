/**
 * Pure: whether a provider-location rule's `marker` is a literal EVERY match of its pattern must contain — the
 * proof `./identifierScan.ts` needs before it may skip the pattern on a text that lacks the marker.
 *
 * The proof reads the pattern's TOP level only. A group, a character class, a letter escape (`\b`, `\d`), a
 * wildcard, an anchor and any quantified atom all become a gap, because each can match text the marker is not
 * contiguous in; a top-level `|` refuses outright, because another alternative may match without it. What is
 * left is the literal text every match spells in order, and the marker must sit inside one unbroken run of it.
 * A non-ASCII marker and a Unicode-mode pattern (`u` or `v`) are never proven, because there regex case folding
 * and `toLowerCase` disagree.
 * It errs one way only: a marker it cannot prove is simply not used, which costs speed and never a hit.
 */

/** One top-level atom: a literal character, or a gap that is not provably one. */
type Atom = { readonly literal: string } | { readonly gap: true };

const GAP: Atom = { gap: true };
const QUANTIFIER_BRACE = /^\{\d+(?:,\d*)?\}/;

/**
 * Pure: whether every match of `re` contains `marker`, compared case-blind as the scanner compares it.
 *
 * @param marker the lowercase literal the rule claims every match carries
 * @param re the rule's pattern
 * @returns true only when the pattern's top level spells the marker unbroken and has no alternation
 */
export function markerIsRequired({ marker, re }: { marker: string; re: RegExp }): boolean {
  // Regex case folding and `toLowerCase` agree only on ASCII outside Unicode mode: `/s/iu` matches `ſ`, and
  // `/Σ/i` matches `ς` though `"ς"` never lowercases to `"σ"`. Without `u`/`v` an ASCII literal matches its own two
  // cases and nothing else, and a lowercased text spells both the same, so only that pairing is proven.
  const unicodeFolding = re.flags.includes("u") || re.flags.includes("v");
  const asciiMarker = /^[\x20-\x7e]+$/.test(marker);
  const atoms = topLevelAtoms({ source: re.source });
  if (unicodeFolding || !asciiMarker || atoms === undefined) {
    return false;
  }
  // A non-ASCII literal is a gap too: `"K".toLowerCase()` is `"k"`, yet `/K/i` never matches a `k`.
  const spelled = atoms
    .map((atom) => ("literal" in atom && /^[\x20-\x7e]$/.test(atom.literal) ? atom.literal.toLowerCase() : "\u0000"))
    .join("");
  return spelled.includes(marker);
}

/**
 * Pure: the top-level atoms of a pattern source, or `undefined` when it alternates at the top level.
 *
 * @param source a regular expression's `source`
 * @returns the atoms in order, each quantified atom already a gap
 */
function topLevelAtoms({ source }: { source: string }): readonly Atom[] | undefined {
  const atoms: Atom[] = [];
  let at = 0;
  while (at < source.length) {
    const char = source.charAt(at);
    if (char === "|") {
      return undefined;
    }
    if (char === "?" || char === "*" || char === "+" || (char === "{" && QUANTIFIER_BRACE.test(source.slice(at)))) {
      atoms.splice(-1, 1, GAP);
      at += char === "{" ? QUANTIFIER_BRACE.exec(source.slice(at))![0].length : 1;
      continue;
    }
    const { atom, next } = readAtom({ at, source });
    atoms.push(atom);
    at = next;
  }
  return atoms;
}

/**
 * Pure: the one atom starting at an offset, and the offset after it.
 *
 * @param source the pattern source
 * @param at where the atom starts
 * @returns the atom and where the next one starts
 */
function readAtom({ at, source }: { at: number; source: string }): { atom: Atom; next: number } {
  const char = source.charAt(at);
  if (char === "\\") {
    const escaped = source.charAt(at + 1);
    if (!/[A-Za-z0-9]/.test(escaped)) {
      return { atom: { literal: escaped }, next: at + 2 };
    }
    // A letter or digit escape may carry an operand (`\x41`, `\u{61}`, `\p{L}`, `\k<n>`, `\12`); swallowing every
    // hex digit and bracketed operand after it into the gap can only ever lose a literal, never invent one.
    const operand = /^[0-9A-Fa-f]*(?:\{[^}]*\}|<[^>]*>)?/.exec(source.slice(at + 2))![0];
    return { atom: GAP, next: at + 2 + operand.length };
  }
  if (char === "[") {
    return { atom: GAP, next: closingOf({ at, close: "]", source }) };
  }
  if (char === "(") {
    return { atom: GAP, next: closingOf({ at, close: ")", source }) };
  }
  if (char === "." || char === "^" || char === "$") {
    return { atom: GAP, next: at + 1 };
  }
  return { atom: { literal: char }, next: at + 1 };
}

/**
 * Pure: the offset just past the bracket that closes the one opened at `at`, skipping escapes, nested groups
 * and character classes (inside which a `)` or `(` is literal).
 *
 * @param source the pattern source
 * @param at the offset of the opening `[` or `(`
 * @param close the closing bracket to find
 * @returns the offset after the closing bracket, or the source's length when it never closes
 */
function closingOf({ at, close, source }: { at: number; close: "]" | ")"; source: string }): number {
  const scan = { depth: 0, inClass: close === "]" };
  for (let index = at + 1; index < source.length; index++) {
    const char = source.charAt(index);
    if (char === "\\") {
      index++;
    } else if (closes({ char, close, scan })) {
      return index + 1;
    }
  }
  return source.length;
}

/**
 * Advance a bracket scan by one unescaped character.
 *
 * @param char the character
 * @param close the bracket the scan is looking for
 * @param scan the group depth and whether a character class is open, updated in place
 * @returns whether this character is the closing bracket
 */
function closes({
  char,
  close,
  scan,
}: {
  char: string;
  close: "]" | ")";
  scan: { depth: number; inClass: boolean };
}): boolean {
  if (scan.inClass) {
    if (char === "]") {
      scan.inClass = false;
      return close === "]";
    }
    return false;
  }
  if (char === "[") {
    scan.inClass = true;
  } else if (char === "(") {
    scan.depth++;
  } else if (char === ")") {
    if (scan.depth === 0) {
      return true;
    }
    scan.depth--;
  }
  return false;
}
