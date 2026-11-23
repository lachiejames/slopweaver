/**
 * Whether one path component written as a shell glob — `*`, `?`, a bracket class, a comma brace, nested or not, and a
 * sequence brace (`{a..z}`), read as any text —
 * matches one literal component. The half of the call-state tripwire (`./callStateGuard.ts`) that reads glob syntax.
 *
 * ## Bounded by construction, because the guard runs on every Bash command
 *
 * A hook that takes its own timeout to judge a command blocks the seat; a fail-open guard has to answer promptly
 * or not at all. So nothing here backtracks, and nothing rescans. One pass pairs every brace and finds every class's
 * close; parsing then visits each character once; matching carries the SET of reachable positions in the name through
 * the pattern, so it costs at most the pattern's length times the name's. The regex this replaces measured
 * quadratic on `rm /` and 60,000 `{` (a `braceClose` scan from every `{`), and a run of `*` against a name of repeats
 * would have backtracked combinatorially. Repro: `yarn vitest run --config config/vitest/unit.ts
 * src/__tests__/unit/admit/globComponent.test.ts`.
 *
 * A pattern this cannot read — a reversed class range, `[z-a]` — matches nothing, so the guard fails open on it.
 */

/** One parsed piece of a component pattern. */
type GlobNode =
  | { readonly kind: "char"; readonly ch: string }
  | { readonly kind: "one" }
  | { readonly kind: "run" }
  | { readonly kind: "class"; readonly negated: boolean; readonly ranges: readonly (readonly [string, string])[] }
  | { readonly kind: "either"; readonly parts: readonly (readonly GlobNode[])[] };

/** What one linear pass over a pattern knows: where each brace closes and where the next `]` is. */
interface Pairing {
  readonly text: string;
  /** The index of the `}` closing the `{` at each index, absent when it never closes. */
  readonly braceEnd: ReadonlyMap<number, number>;
  /** The first `]` at or after each index, or -1. */
  readonly nextBracket: readonly number[];
  /** The first `[:`, `[=` or `[.` starting at or after each index, or -1. */
  readonly nextPosixOpen: readonly number[];
  /** Per delimiter (`:`, `=`, `.`), the first index at or after each one where it is followed by `]`, or -1. */
  readonly nextPosixEnd: Readonly<Record<string, readonly number[]>>;
}

/** For each index, the first index at or after it where `test` holds, or -1: one backward pass. */
function nextWhere({ text, test }: { text: string; test: (index: number) => boolean }): number[] {
  const next: number[] = Array.from({ length: text.length + 1 }, () => -1);
  for (let index = text.length - 1; index >= 0; index -= 1) {
    next[index] = test(index) ? index : next[index + 1]!;
  }
  return next;
}

/** Every brace paired and every next `]` found, in one pass each, backslashes stepping over the next character. */
function pair({ text }: { text: string }): Pairing {
  const braceEnd = new Map<number, number>();
  const open: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    if (ch === "\\") {
      index += 1;
    } else if (ch === "{") {
      open.push(index);
    } else if (ch === "}" && open.length > 0) {
      braceEnd.set(open.pop()!, index);
    }
  }
  const nextPosixEnd = Object.fromEntries(
    [":", "=", "."].map((delimiter) => [
      delimiter,
      nextWhere({ test: (index) => text[index] === delimiter && text[index + 1] === "]", text }),
    ]),
  );
  return {
    braceEnd,
    nextBracket: nextWhere({ test: (index) => text[index] === "]", text }),
    nextPosixEnd,
    nextPosixOpen: nextWhere({ test: (index) => text[index] === "[" && /[:=.]/u.test(text.charAt(index + 1)), text }),
    text,
  };
}

/** A bracket class's body as ranges, or `undefined` when one is reversed and the pattern cannot be read. */
function classNode({ inner }: { inner: string }): GlobNode | undefined {
  const negated = inner.startsWith("!") || inner.startsWith("^");
  const body = negated ? inner.slice(1) : inner;
  const ranges: (readonly [string, string])[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const from = body[index]!;
    if (body[index + 1] === "-" && index + 2 < body.length) {
      const to = body[index + 2]!;
      if (from > to) {
        return undefined;
      }
      ranges.push([from, to]);
      index += 2;
    } else {
      ranges.push([from, from]);
    }
  }
  return { kind: "class", negated, ranges };
}

/** The top-level comma-separated parts of the brace body `[start, end)`, nested braces skipped whole. */
function braceSpans({ pairing, start, end }: { pairing: Pairing; start: number; end: number }): readonly number[][] {
  const spans: number[][] = [];
  let from = start;
  for (let index = start; index < end; index += 1) {
    const ch = pairing.text[index]!;
    if (ch === "\\") {
      index += 1;
    } else if (ch === "{" && pairing.braceEnd.has(index)) {
      index = pairing.braceEnd.get(index)!;
    } else if (ch === ",") {
      spans.push([from, index]);
      from = index + 1;
    }
  }
  return [...spans, [from, end]];
}

/** One node read at an index, with the last index it consumed, or `"unreadable"` when a class in it is reversed. */
type ParseStep = { readonly node: GlobNode; readonly last: number } | "unreadable";

/** How many POSIX classes one bracket class may hold before it is unreadable, so each class costs O(1) jumps. */
const MAX_POSIX_CLASSES = 32;

/**
 * The `]` closing the bracket class opening at `index`, stepping past each POSIX class, equivalence class or
 * collating symbol whole (`[[:lower:]]alls`), or -1. The first character, after a `!` or `^`, is a literal
 * `]` and never closes it (`[!]]alls`). A `[:` with no `:]` after it is literal, as in the shell. Every step is a jump
 * through {@link pair}'s tables, so a class costs at most {@link MAX_POSIX_CLASSES} of them.
 */
function classClose({ pairing, index }: { pairing: Pairing; index: number }): number {
  const { text, nextBracket, nextPosixOpen, nextPosixEnd } = pairing;
  const start = /[!^]/u.test(text.charAt(index + 1)) ? index + 2 : index + 1;
  let at = text[start] === "]" ? start + 1 : start;
  for (let hops = 0; hops <= MAX_POSIX_CLASSES && at <= text.length; hops += 1) {
    const bracket = nextBracket[at]!;
    const open = nextPosixOpen[at]!;
    if (bracket === -1 || open === -1 || open > bracket) {
      return bracket;
    }
    const posixEnd = nextPosixEnd[text[open + 1]!]![Math.min(open + 2, text.length)]!;
    if (posixEnd === -1) {
      return bracket;
    }
    at = posixEnd + 2;
  }
  return -1;
}

/** The bracket class opening at `index` inside `[…, end)`, or `undefined` when no class opens there. */
function classStep({ pairing, index, end }: { pairing: Pairing; index: number; end: number }): ParseStep | undefined {
  if (pairing.text[index] !== "[" || index + 2 > end) {
    return undefined;
  }
  const close = classClose({ index, pairing });
  if (close === -1 || close >= end) {
    return undefined;
  }
  const inner = pairing.text.slice(index + 1, close);
  // A POSIX class names a set this does not tabulate, so the class is judged as any one character: over-refusing only.
  if (/\[[:=.]/u.test(inner)) {
    return { last: close, node: { kind: "one" } };
  }
  const node = classNode({ inner });
  if (node === undefined) {
    return "unreadable";
  }
  return { last: close, node };
}

/** A brace body bash expands as a sequence: two integers or two letters, then an optional integer step. */
const SEQUENCE_BRACE = /^(?:[+-]?\d+\.\.[+-]?\d+|[A-Za-z]\.\.[A-Za-z])(?:\.\.[+-]?\d+)?$/u;

/**
 * The comma or sequence brace opening at `index` inside `[…, end)`, or `undefined` when neither opens there.
 */
function braceStep({ pairing, index, end }: { pairing: Pairing; index: number; end: number }): ParseStep | undefined {
  const close = pairing.braceEnd.get(index);
  if (pairing.text[index] !== "{" || close === undefined || close >= end) {
    return undefined;
  }
  const spans = braceSpans({ end: close, pairing, start: index + 1 });
  if (spans.length < 2) {
    // A sequence brace names a run of values (`rm -rf tal{k..l}` is `talk tall`), judged as any text:
    // over-refusing only.
    const sequence = SEQUENCE_BRACE.test(pairing.text.slice(index + 1, close));
    return sequence ? { last: close, node: { kind: "run" } } : undefined;
  }
  const parts: GlobNode[][] = [];
  for (const [from, to] of spans) {
    const part = parse({ end: to!, pairing, start: from! });
    if (part === undefined) {
      return "unreadable";
    }
    parts.push(part);
  }
  return { last: close, node: { kind: "either", parts } };
}

/** The one node starting at `index` inside `[…, end)`. */
function parseStep({ pairing, index, end }: { pairing: Pairing; index: number; end: number }): ParseStep {
  const ch = pairing.text[index]!;
  if (ch === "\\" && index + 1 < end) {
    return { last: index + 1, node: { ch: pairing.text[index + 1]!, kind: "char" } };
  }
  if (ch === "*") {
    return { last: index, node: { kind: "run" } };
  }
  if (ch === "?") {
    return { last: index, node: { kind: "one" } };
  }
  const bracketed = classStep({ end, index, pairing });
  if (bracketed !== undefined) {
    return bracketed;
  }
  const braced = braceStep({ end, index, pairing });
  if (braced !== undefined) {
    return braced;
  }
  return { last: index, node: { ch, kind: "char" } };
}

/** The nodes of the pattern span `[start, end)`, or `undefined` when a class in it cannot be read. */
function parse({ pairing, start, end }: { pairing: Pairing; start: number; end: number }): GlobNode[] | undefined {
  const nodes: GlobNode[] = [];
  for (let index = start; index < end; index += 1) {
    const step = parseStep({ end, index, pairing });
    if (step === "unreadable") {
      return undefined;
    }
    nodes.push(step.node);
    index = step.last;
  }
  return nodes;
}

/** Whether a class admits one character. */
function classAdmits({ node, ch }: { node: Extract<GlobNode, { kind: "class" }>; ch: string }): boolean {
  const inRange = node.ranges.some(([from, to]) => ch >= from && ch <= to);
  return inRange !== node.negated;
}

/** Whether a node that consumes exactly one character admits this one. */
function admits({ node, ch }: { node: Exclude<GlobNode, { kind: "run" | "either" }>; ch: string }): boolean {
  if (node.kind === "one") {
    return true;
  }
  if (node.kind === "char") {
    return node.ch === ch;
  }
  return classAdmits({ ch, node });
}

/** The positions in `name` reachable after one node, from the reachable set `current`. */
function advanceOne({ node, name, current }: { node: GlobNode; name: string; current: readonly boolean[] }): boolean[] {
  const next: boolean[] = Array.from({ length: name.length + 1 }, () => false);
  if (node.kind === "run") {
    // A run reaches every position from the earliest one already reached; -1 reaches none.
    const first = current.indexOf(true);
    next.fill(first !== -1, Math.max(first, 0));
    return next;
  }
  if (node.kind === "either") {
    for (const part of node.parts) {
      advance({ at: current, name, nodes: part }).forEach((reached, position) => {
        next[position] = next[position] === true || reached;
      });
    }
    return next;
  }
  for (let position = 0; position < name.length; position += 1) {
    next[position + 1] = current[position] === true && admits({ ch: name[position]!, node });
  }
  return next;
}

/** The positions in `name` reachable after `nodes`, from the reachable set `at`. */
function advance({ nodes, name, at }: { nodes: readonly GlobNode[]; name: string; at: readonly boolean[] }): boolean[] {
  let current = [...at];
  for (const node of nodes) {
    current = advanceOne({ current, name, node });
  }
  return current;
}

/**
 * Whether a glob component is one this can read at all — `false` for a reversed class range or overflowing nesting.
 *
 * @param pattern the component as a shell would read it, glob characters left unescaped
 * @returns whether {@link globComponentMatches} would judge it rather than fail open on it
 */
export function globComponentReadable({ pattern }: { pattern: string }): boolean {
  try {
    return parse({ end: pattern.length, pairing: pair({ text: pattern }), start: 0 }) !== undefined;
  } catch {
    return false;
  }
}

/**
 * A path pattern cut back to the directory above its first brace whose body holds a `/`, since the shell expands
 * `{talk/calls,other}` into paths of different depths and no one component can stand for it (for example
 * `cd <home> && rm -rf {talk/calls,other}`). Judging that directory only ever over-refuses. Linear: one pairing pass and
 * one running count of slashes.
 *
 * @param pattern a path pattern, glob characters a shell would read left unescaped
 * @returns the pattern unchanged when no brace holds a `/`, else the directory before the brace (`.` when relative and
 *   none is written, `/` at the root)
 */
export function beforeSlashBrace({ pattern }: { pattern: string }): string {
  const { braceEnd } = pair({ text: pattern });
  const slashesBefore: number[] = [0];
  for (let index = 0; index < pattern.length; index += 1) {
    slashesBefore.push(slashesBefore[index]! + (pattern[index] === "/" ? 1 : 0));
  }
  let first = pattern.length;
  for (const [open, close] of braceEnd) {
    if (open < first && slashesBefore[close]! > slashesBefore[open]!) {
      first = open;
    }
  }
  if (first === pattern.length) {
    return pattern;
  }
  const cut = pattern.lastIndexOf("/", first);
  if (cut === -1) {
    return ".";
  }
  return cut === 0 ? "/" : pattern.slice(0, cut);
}

/**
 * Whether a glob component matches a literal one, in time bounded by the product of their lengths.
 *
 * @param pattern the component as a shell would read it, glob characters left unescaped
 * @param name a literal path component, never holding a `/`
 * @returns whether the glob names it; `false` when the pattern cannot be read, so a guard built on it fails open
 */
export function globComponentMatches({ pattern, name }: { pattern: string; name: string }): boolean {
  try {
    const nodes = parse({ end: pattern.length, pairing: pair({ text: pattern }), start: 0 });
    if (nodes === undefined) {
      return false;
    }
    const start = Array.from({ length: name.length + 1 }, (_, position) => position === 0);
    return advance({ at: start, name, nodes }).at(-1) === true;
  } catch {
    // Nesting deep enough to overflow the stack is a pattern this cannot read: unjudged, so it fails open.
    return false;
  }
}
