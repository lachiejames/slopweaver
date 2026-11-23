/**
 * Read the owner's rulings out of a supervisor state document's `### RULINGS` sections, for `ruling seed`.
 *
 * Pure: a document's text in, candidates, skips and blockers out. Nothing here reads a file, and nothing here
 * rewords a row: a candidate's `words` are the row's own characters from the first `: ` after its locator to the end
 * of its last indented continuation line, line breaks and indentation kept.
 *
 * ## The row shapes it reads
 *
 * A section opens on a line that is exactly `### RULINGS` and runs until a heading or a line of prose. A bullet in it is
 *
 * ```text
 * - [RULED ]<YYYY-MM-DD>, the owner[, <locator>]: <words>
 * ```
 *
 * where the locator is an anchor (`talk:…`, `talk-call:…`, `call:…`, `transcript:…`, or `transcript <hex>[ turn
 * <hex>]`) optionally followed by what the row said about the occasion — `(with turn_…)`, `, on page …, call two` —
 * kept as `context`, or `same anchor` / `same transcript`, which takes the anchor of the bullet immediately before it.
 *
 * `STEER` and `ASKED` bullets, and a `None new` filler bullet, are SKIPPED by name: they are not rulings. Any other
 * bullet, a locator this does not recognise, or a `same …` with no anchored bullet just before it is a BLOCKER —
 * the seed refuses to apply while one stands, because guessing at a row is how the owner's words get misfiled.
 *
 * The one normalisation: a `\r` before a line's `\n` is a line ending, not part of the words.
 */

/** A ruling read from a source document. */
export interface RulingSeedCandidate {
  readonly file: string;
  /** The 1-based line its bullet opens on. */
  readonly line: number;
  readonly decidedOn: string;
  readonly anchor?: string;
  readonly context?: string;
  readonly words: string;
}

/** A bullet left out on purpose, and which kind it was. */
interface RulingSeedSkip {
  readonly file: string;
  readonly line: number;
  readonly reason: "steer" | "asked" | "filler";
}

/** A bullet this could not read with certainty. */
interface RulingSeedBlocker {
  readonly file: string;
  readonly line: number;
  readonly why: string;
}

/** Everything one document's RULINGS sections held. */
export interface RulingSeedScan {
  readonly file: string;
  readonly sections: number;
  readonly candidates: readonly RulingSeedCandidate[];
  readonly skipped: readonly RulingSeedSkip[];
  readonly blockers: readonly RulingSeedBlocker[];
}

const SECTION_HEADING = "### RULINGS";
const RULING_BULLET = /^- (?:RULED )?(\d{4}-\d{2}-\d{2}), the owner(.*)$/u;
const SKIPPED_BULLET = /^- (STEER|ASKED) /u;
const FILLER_BULLET = /^- None new\b/u;
/** An indented Markdown list item (`-`, `*`, `+` or `1.`), which a continuation line must never silently absorb. */
const NESTED_LIST_ITEM = /^\s+(?:[-*+]|\d+[.)])\s/u;
const POINTER_ANCHOR = /^(?:talk|talk-call|call|transcript):[^\s,]+/u;
const SPOKEN_TRANSCRIPT_ANCHOR = /^transcript [0-9a-f]+(?: turn [0-9a-f]+)?/u;
const INHERITED_ANCHOR = /^same (?:anchor|transcript)\b/u;

/** One bullet's own lines, before it is read. */
interface Bullet {
  readonly line: number;
  readonly first: string;
  readonly continuation: readonly string[];
  /** An indented paragraph follows the row after a blank line, so where its words end is not certain. */
  readonly detachedParagraph: boolean;
}

/** Why a ruling row's continuation lines cannot be read with certainty, or nothing when they can. */
function continuationDoubt({ bullet }: { bullet: Bullet }): string | undefined {
  if (bullet.continuation.some((line) => NESTED_LIST_ITEM.test(line))) {
    return "an indented list item inside the row, which may be a ruling of its own";
  }
  if (bullet.detachedParagraph) {
    return "an indented paragraph after a blank line follows the row, which may be part of its words";
  }
  return undefined;
}

/** How one bullet read. */
type BulletReading =
  | { readonly kind: "candidate"; readonly candidate: RulingSeedCandidate }
  | { readonly kind: "skip"; readonly skip: RulingSeedSkip }
  | { readonly kind: "blocker"; readonly blocker: RulingSeedBlocker };

/** What a locator said: the anchor it names (or that it inherits one), and the occasion text after it. */
type Locator =
  | { readonly kind: "anchor"; readonly anchor: string; readonly context: string | undefined }
  | { readonly kind: "inherit"; readonly context: string | undefined }
  | { readonly kind: "unrecognised" };

/** The occasion text after an anchor, with the separator before it dropped; `undefined` when there is none. */
function contextAfter({ rest }: { rest: string }): string | undefined {
  const stripped = rest.replace(/^(?:, | )/u, "");
  if (stripped.length === 0) {
    return undefined;
  }
  return stripped;
}

/** Read a locator — the text between `the owner, ` and the first `: `. */
function readLocator({ locator }: { locator: string }): Locator {
  const inherited = INHERITED_ANCHOR.exec(locator);
  if (inherited !== null) {
    return { context: contextAfter({ rest: locator.slice(inherited[0].length) }), kind: "inherit" };
  }
  for (const shape of [POINTER_ANCHOR, SPOKEN_TRANSCRIPT_ANCHOR]) {
    const pointer = shape.exec(locator);
    if (pointer !== null) {
      return { anchor: pointer[0], context: contextAfter({ rest: locator.slice(pointer[0].length) }), kind: "anchor" };
    }
  }
  return { kind: "unrecognised" };
}

/** The words: the first line's text after its delimiter, then every continuation line verbatim. */
function wordsOf({ first, continuation }: { first: string; continuation: readonly string[] }): string {
  return [first, ...continuation].join("\n");
}

/** The skip a STEER, ASKED or filler bullet earns, or nothing for any other bullet. */
function skipOf({ bullet, at }: { bullet: Bullet; at: { file: string; line: number } }): BulletReading | undefined {
  const skipped = SKIPPED_BULLET.exec(bullet.first);
  if (skipped !== null) {
    return { kind: "skip", skip: { ...at, reason: skipped[1] === "STEER" ? "steer" : "asked" } };
  }
  if (FILLER_BULLET.test(bullet.first)) {
    return { kind: "skip", skip: { ...at, reason: "filler" } };
  }
  return undefined;
}

/** Read one bullet, given the anchor of the bullet just before it when that one was a ruling. */
function readBullet({
  bullet,
  file,
  previousAnchor,
}: {
  bullet: Bullet;
  file: string;
  previousAnchor: string | undefined;
}): BulletReading {
  const at = { file, line: bullet.line };
  const skip = skipOf({ at, bullet });
  if (skip !== undefined) {
    return skip;
  }
  const ruled = RULING_BULLET.exec(bullet.first);
  if (ruled === null) {
    return { blocker: { ...at, why: "a bullet in a RULINGS section that is not a dated ruling row" }, kind: "blocker" };
  }
  const doubt = continuationDoubt({ bullet });
  if (doubt !== undefined) {
    return { blocker: { ...at, why: doubt }, kind: "blocker" };
  }
  const decidedOn = ruled[1]!;
  const tail = ruled[2]!;
  if (tail.startsWith(": ")) {
    return {
      candidate: { ...at, decidedOn, words: wordsOf({ continuation: bullet.continuation, first: tail.slice(2) }) },
      kind: "candidate",
    };
  }
  const delimiter = tail.indexOf(": ");
  if (!tail.startsWith(", ") || delimiter === -1) {
    return { blocker: { ...at, why: "no `: ` ends the row's locator" }, kind: "blocker" };
  }
  const locator = readLocator({ locator: tail.slice(2, delimiter) });
  if (locator.kind === "unrecognised") {
    return { blocker: { ...at, why: "the locator names no anchor this reads" }, kind: "blocker" };
  }
  if (locator.kind === "inherit" && previousAnchor === undefined) {
    return { blocker: { ...at, why: "`same …` with no anchored ruling just before it" }, kind: "blocker" };
  }
  const anchor = locator.kind === "anchor" ? locator.anchor : previousAnchor!;
  const words = wordsOf({ continuation: bullet.continuation, first: tail.slice(delimiter + 2) });
  return {
    candidate: {
      ...at,
      anchor,
      ...(locator.context === undefined ? {} : { context: locator.context }),
      decidedOn,
      words,
    },
    kind: "candidate",
  };
}

/** Group the lines after one heading into bullets, stopping at a heading or a line of prose. */
function bulletsFrom({ lines, start }: { lines: readonly string[]; start: number }): {
  bullets: readonly Bullet[];
  end: number;
} {
  const bullets: { line: number; first: string; continuation: string[]; detachedParagraph: boolean }[] = [];
  let open = false;
  let index = start;
  for (; index < lines.length; index += 1) {
    const text = lines[index]!;
    const last = bullets.at(-1);
    if (text.startsWith("- ")) {
      bullets.push({ continuation: [], detachedParagraph: false, first: text, line: index + 1 });
      open = true;
    } else if (text.trim().length === 0) {
      open = false;
    } else if (/^\s/u.test(text) && last !== undefined) {
      // An indented line after a blank one still belongs to the row above, so it is never silently dropped.
      if (open) {
        last.continuation.push(text);
      } else {
        last.detachedParagraph = true;
      }
    } else {
      break;
    }
  }
  return { bullets, end: index };
}

/**
 * Read every `### RULINGS` section in one document.
 *
 * @param text the document's text
 * @param file its path, carried on every row read from it
 * @returns its candidates, skips and blockers, in document order
 */
export function scanRulingSource({ text, file }: { text: string; file: string }): RulingSeedScan {
  const lines = text.split("\n").map((line) => line.replace(/\r$/u, ""));
  const candidates: RulingSeedCandidate[] = [];
  const skipped: RulingSeedSkip[] = [];
  const blockers: RulingSeedBlocker[] = [];
  let sections = 0;
  let index = 0;
  while (index < lines.length) {
    if (lines[index] !== SECTION_HEADING) {
      index += 1;
      continue;
    }
    sections += 1;
    const { bullets, end } = bulletsFrom({ lines, start: index + 1 });
    let previousAnchor: string | undefined;
    for (const bullet of bullets) {
      const reading = readBullet({ bullet, file, previousAnchor });
      previousAnchor = undefined;
      if (reading.kind === "candidate") {
        candidates.push(reading.candidate);
        previousAnchor = reading.candidate.anchor;
      } else if (reading.kind === "skip") {
        skipped.push(reading.skip);
      } else {
        blockers.push(reading.blocker);
      }
    }
    index = end;
  }
  return { blockers, candidates, file, sections, skipped };
}
