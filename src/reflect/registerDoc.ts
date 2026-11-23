/**
 * The ONE parser for `docs/recurring-failure-register.md` — its class inventory, and the `## Bindings` table
 * that says what binds each live class to a lane.
 *
 * ## Why this module exists rather than a second reader
 *
 * The register had exactly one machine reader before this: `./crossRef.ts`'s `readRegisterCoverage`, whose
 * own JSDoc says *"Only the REFUTED section is read."* The live half — Survivors, Gated, the owner-ruled
 * additions — was read by nobody, so it drifted: three rows sat in the build-candidate tables with the work
 * already shipped, and the Survivors heading counted 22 classes over 23. MEASURED across two
 * independent lenses: of the live class names, ZERO appeared anywhere under `src/__tests__/`, and of the 13
 * replay fixture slugs, ZERO appeared in the register. The two registers were wholly disjoint by name, in
 * both directions, while one of them existed to say which failures were worth a test.
 *
 * Both consumers now sit above this one parse — `crossRef.ts` at runtime through its `SubstrateReader` seam,
 * and `../devLint/registerBindings.ts` as a gate through `readFileSync`. That direction is deliberate: the
 * runtime miner genuinely needs the register (`./brief.ts`), and a parser living under `src/devLint/` could
 * never be reached from here, so the tree would keep two of them forever. Four independent `tsToIso` copies
 * is the class that argument comes from, and it is recorded in the very document this file reads.
 *
 * ## One page at a time
 *
 * The register is a parent page and the child pages under `docs/recurring-failure-register/`, listed in
 * `./registerPages.ts`, which reads them all and merges what this parses from each. Which section a line sits
 * in is `./registerSections.ts`'s heading walk.
 *
 * ## Pure by construction
 *
 * Text in, data out. No `node:fs`, no import from `src/devLint/`. A caller supplies the bytes.
 */

import { join } from "node:path";

import { afterHeading, type RegisterSection, WALK_START, type WalkState } from "./registerSections.js";

/**
 * Where the committed register sits, relative to the repository root.
 *
 * Declared HERE rather than in `./brief.ts` (which held it) so the devLint gate can name the same file
 * without pulling the miner's whole substrate — a third spelling of this path would be the same
 * scattered-copies class the register itself records.
 */
export const REGISTER_RELATIVE_PATH = join("docs", "recurring-failure-register.md");

/** The `binds` cell's honest null — a class nothing binds today says so rather than leaving a blank. */
const NO_BINDING_TOKEN = "none";

/** The sections whose classes are live — the ones that owe a bindings row. */
const LIVE_SECTIONS: ReadonlySet<RegisterSection> = new Set(["survivors", "gated", "ownerRuled"]);

/** What kind of thing a binding target names. */
type BindingKind = "gate" | "test" | "fixture";

/**
 * How strongly a row claims its targets hold the class down.
 *
 * `closes` is the claim the register's own closing rule acts on — *"move a class out of Survivors when its
 * gate lands"* — so it is the one the gate refuses inside Survivors. `narrows` is the honest partial, which
 * is what most real closures are.
 */
type BindingStrength = "closes" | "narrows" | "witnesses" | "none";

/** Every legal {@link BindingStrength}, for a parser that has to reject anything else. */
const STRENGTHS = ["closes", "narrows", "witnesses", "none"] as const satisfies readonly BindingStrength[];

/**
 * Whether a cell's text is one of the four strengths.
 *
 * A predicate rather than a cast, so a fifth strength added to the type fails to compile here instead of
 * being silently admitted by an assertion.
 *
 * @param cell the trimmed strength cell
 * @returns true when the cell is a legal strength
 */
function isStrength(cell: string): cell is BindingStrength {
  return STRENGTHS.some((one) => one === cell);
}

/** One `<kind>:<value>` target out of a `binds` cell. */
export interface BindingTarget {
  readonly kind: BindingKind;
  /** The gate id, repo-relative test path or fixture slug, exactly as written. */
  readonly value: string;
}

/** One class name, and where in the document it was declared. */
export interface RegisterClass {
  readonly name: string;
  readonly section: RegisterSection;
  /** The repo-relative page it sits on. */
  readonly path: string;
  /** 1-indexed line, so a finding can point a reader at it. */
  readonly line: number;
  /**
   * The cell after the class name, for a table row that has one — the refutation reason in `## Refuted`.
   * Empty for a bullet, which carries its prose on the same line as its name.
   */
  readonly reason: string;
}

/** One row of the `## Bindings` table. */
export interface BindingRow {
  readonly className: string;
  readonly targets: readonly BindingTarget[];
  readonly strength: BindingStrength;
  /** The repo-relative page it sits on. */
  readonly path: string;
  /** 1-indexed line. */
  readonly line: number;
}

/** One thing this parser could not read, on the page it sits on. */
export interface RegisterProblem {
  readonly path: string;
  /** Already worded as a finding. */
  readonly message: string;
}

/** The whole register, parsed. */
export interface RegisterDoc {
  readonly classes: readonly RegisterClass[];
  readonly bindings: readonly BindingRow[];
  /** Rows this parser could not read. Never silently dropped. */
  readonly problems: readonly RegisterProblem[];
}

/**
 * A register class name: strictly kebab-case, at least one hyphen.
 *
 * The hyphen is what makes this criterion do real work rather than match any backticked token. It excludes
 * the two decoy sections by SHAPE rather than by an allowlist — `## Two latent gaps` opens its bullets with
 * a backticked FUNCTION name (`docProblemsRefuse`, `runSeed`) and `## Two seed candidates` opens with bold
 * prose — so neither can mint a class that does not exist. It also excludes every `seam` cell in the
 * Survivors tables, which are paths carrying `/`, `.` or `:`.
 */
const CLASS_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

/**
 * A line that LOOKS like it declares a class — used only to report one this parser could not read.
 */
const CLASS_SHAPED_LINE = /`\*{0,2}[a-z][a-z0-9]*(?:-[a-z0-9]+)+\*{0,2}`|\*\*`?[a-z][a-z0-9]*(?:-[a-z0-9]+)+`?\*\*/;

/** Indentation and blockquote markers, which carry no meaning for whether a line declares a class. */
const LEADING_FURNITURE = /^[\s>]+/;

/** A `<details>` or `<summary>` wrapper a bullet is sometimes folded into. */
const DISCLOSURE_TAG = /^<\/?(?:details|summary)(?:\s[^>]*)?>\s*/i;

/** A list marker: a bullet of any of the three characters, or a numbered item. */
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/;

/** Emphasis markers wrapping a name, stripped before the name is read. */
const LEADING_EMPHASIS = /^[*_]+/;

/**
 * The content of a line that opens a list item, with its markdown furniture removed.
 *
 * Indentation, blockquote markers, a `<details>`/`<summary>` wrapper and the list marker itself are all
 * removed, because none of them changes whether a human reading the line would say it declares a class.
 *
 * TWO adversarial reviews broke this parser on exactly that point, one authoring variation apart. The first
 * hid a class behind a colon instead of an em dash. The second, after the separator was dropped, hid one
 * behind a two-space indent — and behind a numbered list, a tab, a blockquote and a `<details>` block, every
 * one of which `yarn prettier --check` calls correctly formatted, so `pre-commit` would never normalise them
 * away. Each time the class owed a bindings row, had none, and the gate reported `clean` at the old count.
 *
 * Normalising the furniture closed every remaining shape that is STILL a list item, and that is the exact
 * limit of what it bought. A THIRD review then hid a class in three shapes that are not list items at all —
 * a `###` subheading, a bolded paragraph, an HTML `<li>` — so the answer stopped being another normalisation
 * here and became a shape-independent question one layer up, in {@link opensWithClassName}.
 *
 * @param raw the whole line
 * @returns the list item's content, or `undefined` when the line does not open one
 */
function listItemBody({ raw }: { raw: string }): string | undefined {
  const bare = withoutDisclosure({ text: raw.replace(LEADING_FURNITURE, "") });
  const marker = LIST_MARKER.exec(bare);
  if (marker === null) {
    return undefined;
  }
  return bare.slice(marker[0].length);
}

/**
 * Strip every leading disclosure tag, not just one.
 *
 * `<details><summary>` is two of them, which the first version of this missed — so a bullet folded into a
 * disclosure block was still invisible after the fix that was meant to end exactly that family.
 *
 * @param text the line, already de-indented
 * @returns the line with its leading `<details>` and `<summary>` tags removed
 */
function withoutDisclosure({ text }: { text: string }): string {
  let rest = text;
  while (DISCLOSURE_TAG.test(rest)) {
    rest = rest.replace(DISCLOSURE_TAG, "");
  }
  return rest;
}

/**
 * The class name a list item opens with, whatever emphasis wraps it.
 *
 * Requires the name to be delimited — backticked, or bolded — so ordinary prose opening with a hyphenated
 * word (`re-running the gate does not …`) is never read as a class declaration.
 *
 * @param body the list item's content, furniture already removed
 * @returns the name, or `undefined` when the item does not open with a delimited one
 */
function leadingClassName({ body }: { body: string }): string | undefined {
  const stripped = body.replace(LEADING_EMPHASIS, "");
  const backticked = /^`([a-z][a-z0-9-]+)`/.exec(stripped);
  if (backticked !== null) {
    return backticked[1];
  }
  const bolded = /^([a-z][a-z0-9-]+)(?=[*_]{2})/.exec(stripped);
  if (bolded !== null) {
    return bolded[1];
  }
  return undefined;
}

/**
 * The furniture a BLOCK can open with before its first word: an ATX heading marker, or HTML tags.
 *
 * Deliberately not a list of the block kinds a class might be hidden in. It strips whatever sits before the
 * first word so {@link opensWithClassName} can ask the one question that matters — does this line START with
 * a delimited class name — of a heading, a paragraph, an HTML list item and a list item alike.
 */
const BLOCK_OPENER = /^(?:#{1,6}\s+|<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>)+/i;

/** A markdown table separator cell, after trimming. */
const SEPARATOR_CELL = /^-{3,}$/;

/**
 * Split one markdown table row into trimmed cells, collapsing a separator cell to a fixed token.
 *
 * Parsed cells rather than raw bytes, because Prettier repads every table on `yarn format` and a comparison
 * against raw text would drift on whitespace the formatter itself chose.
 *
 * @param line one raw line, expected to begin and end with a pipe
 * @returns the inner cells, trimmed
 */
export function tableCells({ line }: { line: string }): readonly string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim())
    .map((cell) => {
      if (SEPARATOR_CELL.test(cell)) {
        return "---";
      }
      return cell;
    });
}

/**
 * Strip one wrapping pair of bold markers, then one of backticks, in either nesting order.
 *
 * Bold is stripped because a table cell written `**`a-class`**` is an ordinary authoring choice that an
 * adversarial review used to make a live class invisible: the cell failed {@link CLASS_NAME}, the row yielded
 * no class, and the class silently owed no bindings row.
 *
 * @param cell a trimmed table cell
 * @returns the unwrapped text, or the cell unchanged when it was not wrapped
 */
function unbacktick({ cell }: { cell: string }): string {
  const unbolded = stripWrapper({ text: cell, wrapper: "**" });
  const inner = stripWrapper({ text: unbolded, wrapper: "`" });
  return stripWrapper({ text: inner, wrapper: "**" });
}

/**
 * Remove one wrapping pair of a marker, when the text both opens and closes with it.
 *
 * @param text the trimmed text
 * @param wrapper the marker to strip
 * @returns the text without that one pair
 */
function stripWrapper({ text, wrapper }: { text: string; wrapper: string }): string {
  const wrapped = text.startsWith(wrapper) && text.endsWith(wrapper) && text.length > wrapper.length * 2 - 1;
  if (wrapped) {
    return text.slice(wrapper.length, -wrapper.length);
  }
  return text;
}

/**
 * The old single-pair backtick strip, kept for the binds cell, which is only ever one code span.
 *
 * @param cell a trimmed table cell
 * @returns the unwrapped text, or the cell unchanged when it was not wrapped
 */
function unbacktickOnly({ cell }: { cell: string }): string {
  if (cell.startsWith("`") && cell.endsWith("`") && cell.length > 1) {
    return cell.slice(1, -1);
  }
  return cell;
}

/**
 * The class name a table row declares, with the cell that follows it.
 *
 * Takes the FIRST cell that is a whole backticked class name, which is what lets one reader handle both
 * table shapes: `## Refuted` puts the class in cell 0 and `## Survivors` puts an instance count there.
 *
 * @param cells the row's trimmed cells
 * @returns the name and the following cell, or `undefined` when no cell is a class name
 */
function classInRow({ cells }: { cells: readonly string[] }): { name: string; reason: string } | undefined {
  const index = cells.findIndex((cell) => CLASS_NAME.test(unbacktick({ cell })));
  if (index === -1) {
    return undefined;
  }
  const next = cells[index + 1];
  if (next === undefined) {
    return { name: unbacktick({ cell: cells[index]! }), reason: "" };
  }
  return { name: unbacktick({ cell: cells[index]! }), reason: next };
}

/**
 * Parse one `binds` cell into targets.
 *
 * The cell is written as one backticked code span in the document, because `src/__tests__/…` renders as bold
 * in GitHub-flavored markdown otherwise — the `__` pairs are a valid emphasis run when they sit between a
 * slash and a letter. So one wrapping pair of backticks is stripped before splitting.
 *
 * @param cell the cell's trimmed text — either {@link NO_BINDING_TOKEN} alone, or space-separated
 *   `<kind>:<value>` tokens
 * @returns the targets, plus a worded problem per token this could not read
 */
export function parseBindingCell({ cell }: { cell: string }): {
  targets: readonly BindingTarget[];
  problems: readonly string[];
} {
  const tokens = unbacktickOnly({ cell })
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return { targets: [], problems: ["empty binds cell — write `none` rather than leaving it blank"] };
  }
  const hasNone = tokens.includes(NO_BINDING_TOKEN);
  if (hasNone && tokens.length > 1) {
    return { targets: [], problems: [`\`${NO_BINDING_TOKEN}\` listed beside a real target`] };
  }
  if (hasNone) {
    return { targets: [], problems: [] };
  }
  const parsed = tokens.map((token) => oneTarget({ token }));
  return {
    targets: parsed.flatMap((one) => (one.target === undefined ? [] : [one.target])),
    problems: parsed.flatMap((one) => (one.problem === undefined ? [] : [one.problem])),
  };
}

/**
 * Read one `<kind>:<value>` token.
 *
 * @param token one whitespace-delimited token from a `binds` cell
 * @returns the target, or the problem naming why it could not be read
 */
function oneTarget({ token }: { token: string }): { target?: BindingTarget; problem?: string } {
  const colon = token.indexOf(":");
  if (colon === -1) {
    return { problem: `\`${token}\` names no kind — write gate:, test: or fixture:` };
  }
  const kind = token.slice(0, colon);
  const value = token.slice(colon + 1);
  if (value.length === 0) {
    return { problem: `\`${token}\` names a kind with no value` };
  }
  if (kind === "gate" || kind === "test" || kind === "fixture") {
    return { target: { kind, value } };
  }
  return { problem: `\`${token}\` names an unknown kind \`${kind}\` — only gate, test and fixture exist` };
}

/**
 * Read one `## Bindings` row.
 *
 * @param cells the row's trimmed cells
 * @param line the 1-indexed line the row sits on
 * @returns the row, plus every problem found in it
 */
function bindingRow({ cells, line, path }: { cells: readonly string[]; line: number; path: string }): {
  row?: BindingRow;
  problems: readonly string[];
} {
  const [nameCell, bindsCell, strengthCell] = cells;
  if (nameCell === undefined || bindsCell === undefined || strengthCell === undefined) {
    return { problems: [`bindings row at line ${String(line)} has fewer than three cells`] };
  }
  const className = unbacktick({ cell: nameCell });
  if (!CLASS_NAME.test(className)) {
    return { problems: [`bindings row at line ${String(line)} names no class in its first cell`] };
  }
  const parsed = parseBindingCell({ cell: bindsCell });
  const scoped = parsed.problems.map((problem) => `${className} (line ${String(line)}): ${problem}`);
  if (!isStrength(strengthCell)) {
    return {
      problems: [
        ...scoped,
        `${className} (line ${String(line)}): \`${strengthCell}\` is not a strength — use ${STRENGTHS.join(", ")}`,
      ],
    };
  }
  const strength = strengthCell;
  const mismatch = strength === "none" && parsed.targets.length > 0;
  const empty = strength !== "none" && parsed.targets.length === 0;
  const paired = [
    ...scoped,
    ...(mismatch ? [`${className} (line ${String(line)}): strength \`none\` beside a real target`] : []),
    ...(empty ? [`${className} (line ${String(line)}): strength \`${strength}\` while binding nothing`] : []),
  ];
  return { row: { className, line, path, strength, targets: parsed.targets }, problems: paired };
}

/**
 * Parse the whole register.
 *
 * A section this reader does not classify contributes nothing, and a register that has drifted out of shape
 * yields FEWER classes rather than wrong ones — the same missing-is-safe direction `./crossRef.ts` already
 * takes. A caller that needs to know the document was seen at all checks {@link RegisterDoc.classes} for
 * emptiness; this function never guesses.
 *
 * @param text one page of the register
 * @param path the repo-relative page it came from, carried onto everything read off it
 * @returns every class, every bindings row, and every row that could not be read
 */
export function parseRegisterDoc({
  text,
  path = REGISTER_RELATIVE_PATH,
}: {
  text: string;
  path?: string;
}): RegisterDoc {
  const classes: RegisterClass[] = [];
  const bindings: BindingRow[] = [];
  const problems: RegisterProblem[] = [];
  let state: WalkState = WALK_START;
  text.split("\n").forEach((raw, index) => {
    const line = index + 1;
    const moved = afterHeading({ raw, state });
    if (moved !== undefined) {
      state = moved;
      return;
    }
    const section = state.section;
    if (section === undefined) {
      return;
    }
    const bare = raw.trimStart();
    if (section === "bindings") {
      if (!bare.startsWith("|")) {
        return;
      }
      const cells = tableCells({ line: bare });
      if (cells.includes("---") || cells[0] === "class") {
        return;
      }
      const read = bindingRow({ cells, line, path });
      problems.push(...read.problems.map((message) => ({ message, path })));
      if (read.row !== undefined) {
        bindings.push(read.row);
      }
      return;
    }
    const found = classOnLine({ raw });
    if (found !== undefined) {
      classes.push({ line, name: found.name, path, reason: found.reason, section });
      return;
    }
    if (unreadClassLine({ raw, section })) {
      problems.push({
        message:
          `line ${String(line)} in the ${section} section looks like it declares a class and this parser could ` +
          `not read one from it — put the class name in its own backticked cell, or open the bullet with it`,
        path,
      });
    }
  });
  return { bindings, classes, problems };
}

/**
 * The class one line declares, whether it is a list item or a table row.
 *
 * Split out of {@link parseRegisterDoc}'s loop so that loop stays under the cognitive-complexity ceiling,
 * and so the two shapes a class can be written in are read in one place rather than two arms of a walk.
 *
 * @param raw the whole line
 * @returns the class name and the cell following it, or `undefined` when the line declares none
 */
function classOnLine({ raw }: { raw: string }): { name: string; reason: string } | undefined {
  const body = listItemBody({ raw });
  if (body !== undefined) {
    const named = leadingClassName({ body });
    if (named !== undefined && CLASS_NAME.test(named)) {
      return { name: named, reason: "" };
    }
    return undefined;
  }
  if (!raw.trimStart().startsWith("|")) {
    return undefined;
  }
  return classInRow({ cells: tableCells({ line: raw.trimStart() }) });
}

/**
 * Whether a line in a LIVE section looks like it declares a class that {@link parseRegisterDoc} did not read.
 *
 * Defence in depth, and it exists because of a measured break rather than a hunch. Two adversarial reviews
 * hid a live class from the parser, one authoring variation apart, and each time the gate above stayed GREEN
 * at the old count, telling the author nothing at all.
 *
 * **Its own first version was the SECOND of those.** It tested `raw.startsWith("- ")`, which is the same
 * mistake one layer up: a two-space indent, a numbered item, a tab, a blockquote and a `<details>` fold all
 * declare a class to a reader and matched neither the parse nor this guard, and `yarn prettier --check`
 * calls every one of them correctly formatted, so nothing would normalise them away. It now asks
 * {@link listItemBody} the same question the parse asks, so the two cannot disagree about what a list item is.
 *
 * **Its THIRD version stopped enumerating shapes**, because a third adversarial review found three more of
 * them in one pass: a class declared as its own `###` subheading (the register already uses `###` inside
 * `## Survivors`), a class opening an ordinary bolded PARAGRAPH, and a class inside an HTML `<li>`. None is
 * a markdown list item or a table row, so the second version reported `clean` at the unchanged count for
 * every one. Enumerating a fourth shape would have been a fourth hole, so this asks a shape-independent
 * question instead — see {@link opensWithClassName}.
 *
 * Scoped to the live sections, and to lines that open a table row, a list item or a BLOCK, so the ordinary
 * prose that QUOTES a class name mid-paragraph — which the register does constantly — is not a finding.
 *
 * @param raw the whole line
 * @param section the section it sits in
 * @returns true when the line should have yielded a class and did not
 */
function unreadClassLine({ raw, section }: { raw: string; section: RegisterSection }): boolean {
  if (!LIVE_SECTIONS.has(section)) {
    return false;
  }
  const line = withBacktickedCode({ raw });
  if (!CLASS_SHAPED_LINE.test(line)) {
    return false;
  }
  const bare = line.trimStart();
  const folded = DISCLOSURE_TAG.test(bare);
  const listOrTable = bare.startsWith("|") || folded || listItemBody({ raw: line }) !== undefined;
  return listOrTable || opensWithClassName({ raw: line });
}

/**
 * Rewrite HTML `<code>` spans as backticks, so one delimiter test reads both spellings.
 *
 * The third adversarial review hid a class in an HTML `<li>` with an HTML `<code>` span, which
 * {@link CLASS_SHAPED_LINE} rejected before any shape question was asked — the name was delimited, just not
 * with the character the test knows. Normalising once is what keeps that from being a delimiter-by-delimiter
 * list the way the block kinds were becoming a block-kind-by-block-kind list.
 *
 * @param raw the whole line
 * @returns the line with `<code>`/`</code>` replaced by backticks
 */
function withBacktickedCode({ raw }: { raw: string }): string {
  return raw.replaceAll("<code>", "`").replaceAll("</code>", "`");
}

/**
 * Whether an UNINDENTED line opens with a delimited class name — whatever kind of block it opens.
 *
 * The criterion is indentation rather than block kind, and that is the whole point: a heading, a paragraph,
 * an HTML `<li>` and a bullet are indistinguishable to a reader deciding whether a line declares a class, so
 * a guard that names them one at a time grows a hole per authoring variation. Asking "does a block start
 * here, and does it start with a class name" covers every one of them at once, and every future one.
 *
 * ## Why indentation is the right line, measured
 *
 * The register wraps its prose, and a wrapped continuation line routinely begins with a backticked
 * kebab-case token that is a gate name, a flag or a hook rather than a class. MEASURED on the
 * committed register: EIGHT such lines (`reverts-main` at 79, `base-unresolved` at 96,
 * `voice-rule-below-fold` at 200, `foreign-cli` at 250, `register-bindings` at 309,
 * `agent-doc-size-cap-acme-admin` at 436, `pr-16400-questions-and-walk-residue` at 470, `pre-push` at 497),
 * and every one is INDENTED, because that is what makes it a continuation. Dropping the indentation test
 * turns all eight into false refusals. Reproduce by deleting the first line of this function and running
 * `yarn tsx src/devLint/registerBindings.entry.ts`.
 *
 * **The residue, stated rather than discovered.** An INDENTED line opening with a class name is not a
 * finding here, and cannot be: it is byte-for-byte the shape of those eight legitimate continuations. An
 * indented LIST item is still caught, by {@link listItemBody} one branch up, which is where the second
 * review's counterexample lives — what remains uncovered is an indented non-list line, which markdown
 * renders as part of the paragraph above it rather than as a declaration of its own.
 *
 * @param raw the whole line, with its code spans already backticked
 * @returns true when the line is unindented and its first word is a delimited class name
 */
function opensWithClassName({ raw }: { raw: string }): boolean {
  const indented = raw.length === 0 || raw.startsWith(" ") || raw.startsWith("\t") || raw.startsWith(">");
  if (indented) {
    return false;
  }
  const named = leadingClassName({ body: raw.replace(BLOCK_OPENER, "") });
  return named !== undefined && CLASS_NAME.test(named);
}

/**
 * Every class in the live half of the register — the ones that owe a bindings row.
 *
 * @param doc a parsed register
 * @returns the live classes, in document order
 */
export function liveClasses({ doc }: { doc: RegisterDoc }): readonly RegisterClass[] {
  return doc.classes.filter((one) => LIVE_SECTIONS.has(one.section));
}
