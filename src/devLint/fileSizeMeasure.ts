/**
 * The MEASURING half of `file-size-ratchet` (`./fileSizeRatchet.ts`): the cap, the markers a file can declare
 * about its own size, and one file's measured size. Pure throughout — the gate owns the baseline, the tradeoff
 * register, the scan and the verdict, and this module answers only "how big is this text, and what does it say
 * about itself".
 *
 * Split from the gate along that seam, because the gate does not exclude itself from its own cap.
 *
 * **What a marker is worth** (oversized files are always split): the GENERATED header still excuses a file the cap on its own, because its generator's source is what a
 * reader reviews. The inline exemption marker excuses NOTHING on its own — only together with a signed row in the
 * tradeoff register (`./fileSizeTradeoffs.ts`), which is why {@link fileSizeOf} takes the approved paths. The
 * register marker is retired: it is still READ, so the gate can refuse it by name, and it excuses nothing.
 */

import { codeLinesOf } from "./duplicateWindows.js";
import { isTestFilePath } from "./scanScope.js";

/** The cap, in code lines. The target number itself, not a step toward one. */
export const MAX_FILE_LINES = 300;

/**
 * The cap for a TEST file (`*.test.ts`, `*.test.tsx`), in code lines. A helper or
 * fake under `__tests__/` is not a test file and stays at {@link MAX_FILE_LINES}.
 */
export const MAX_TEST_FILE_LINES = 500;

/**
 * The cap a path is held to: {@link MAX_TEST_FILE_LINES} for a test file, {@link MAX_FILE_LINES} for every
 * other. Pure — one rule, two numbers, and the mechanism is the same either side: grow past it, split.
 *
 * @param path a repo-relative path
 * @returns the code-line cap that applies to it
 */
export function capFor({ path }: { path: string }): number {
  if (isTestFilePath({ path })) {
    return MAX_TEST_FILE_LINES;
  }
  return MAX_FILE_LINES;
}

/**
 * The inline exemption marker, declared anywhere in a file and followed by a non-empty reason. It exempts the
 * file only when the tradeoff register holds a signed row for the same path.
 */
export const FILE_LINES_EXEMPT_MARKER = "max-file-lines-exempt";

/**
 * One marker's pattern: the marker itself, not a longer name ENDING in it, and everything left on its own line.
 *
 * Two halves, and each is a criterion rather than a convenience.
 *
 * **A marker is a DECLARATION, so it opens its own line.** Nothing but a comment prefix may precede it:
 * spaces, tabs, `*` and `/`, which is every way a marker is legitimately written and nothing else. Three
 * Codex passes are why the criterion is this and not something narrower, and each walked past the previous
 * shape rather than repeating it. An unanchored `${marker}:(.*)` matched inside
 * `not-max-file-lines-register:`, so a file could deny being a register in the very comment that made it
 * one. `(?<![\\w-])` closed that and r2 walked past it with `not\\u2011max-file-lines-register:`, U+2011
 * being a non-breaking hyphen that is neither a word character nor an ASCII one. A lookbehind naming the
 * comment characters instead closed THAT, and r3 walked past it with `// Do not add max-file-lines-register: this file is not a register`,
 * where the whitespace before the marker is entirely legitimate and the sentence around it is not.
 *
 * Enumerating hyphens, then enumerating prose, was always going to buy a fourth pass. What ends the family
 * is asking what a declaration LOOKS like instead of what a bypass looks like — and it is strictly tighter
 * than the rule the exemption marker shipped with, so a file merely discussing either marker in prose is
 * now measured like any other file, which is what that rule always claimed.
 *
 * Two further passes sharpened the same criterion rather than replacing it, and both were the same
 * mistake — a shape loose enough to be satisfied by ordinary JavaScript. A character CLASS of comment
 * characters accepts a single slash, so `/max-file-lines-register: reason/;` is a REGEX LITERAL that
 * declares nothing; making the opener OPTIONAL then accepted a bare `max-file-lines-register: 0;` inside a
 * ternary, which parses as arithmetic over four locals and declares nothing either. So a real comment
 * OPENER is now REQUIRED — two or more slashes, a slash with stars, or the continuation stars of a block
 * comment. **A marker is a comment, and that is the whole rule**, which is both tighter than every spelling
 * the passes walked and simpler to state than any of them.
 *
 * `.` without the `s` flag is the second half, and it is also a criterion rather than a convenience: it
 * matches every code point EXCEPT the four JavaScript LineTerminators, which is exactly the set that ends
 * the `//` comment a marker is usually written in. Three earlier r3 passes walked that set one member at a
 * time, `\\s` matching `\\n` outright, then `[^\\n]` swallowing a lone `\\r`, then `[^\\r\\n]` swallowing
 * U+2028, and each time a blank reason borrowed the NEXT line's code and exempted the file.
 *
 * **Its blind spot is named rather than closed: a line that LOOKS like a comment line and is not one.** A
 * line matcher cannot tell the two apart — that is a parser's job — so a declaration-shaped line inside a
 * template literal reads as a declaration, and so does one whose leading `*` is a multiplication operator
 * broken across lines. Three passes found three members and the class has no last member, which is the
 * point: closing it means a JavaScript lexer inside a lint gate, whose own escape, nesting and
 * regex-literal bugs are likelier than the case it would prevent. The continuation `*` in particular
 * cannot be dropped — all three standing markers in this tree are written that way, inside a JSDoc block —
 * so the alternative to naming this is unmarking every file that legitimately carries a marker today.
 *
 * The marker is not an adversarial boundary in the first place: anyone who can add that template can add
 * the comment. What it buys is a DECLARATION visible in a committed diff, and in every one of those
 * counterexamples both the marker line and the raised baseline row are still in the diff.
 *
 * Two things a later reader needs, so neither has to be rediscovered. The hole is IDENTICAL for all THREE
 * markers — the exemption, the register and GENERATED — so it is not a register-shaped bug and there is
 * nothing register-specific to go looking for. And its observer is the REVIEWER reading the baseline diff,
 * which is where a ceiling that moved always shows up; a blind spot with nobody named to notice it is one
 * nobody is watching.
 *
 * Global, because a file may carry several markers and one real reason is enough.
 *
 * @param marker the marker's literal text, without its colon
 * @returns a global pattern whose first group is everything the marker left on its own line
 */
function markerPattern({ marker }: { marker: string }): RegExp {
  return new RegExp(`^[ \\t]*(?://+|/\\*+|\\*+)[ \\t]*${marker}:(.*)`, "gmu");
}

const EXEMPT_MARKER_LINE = markerPattern({ marker: FILE_LINES_EXEMPT_MARKER });

/**
 * The RETIRED register marker — once a claim that a file's length IS its content and that `--rebaseline` may
 * raise its ceiling, now refused wherever a file declares it (`file-size-ratchet-retired-marker`).
 *
 * MEASURED, the defect that minted it: the lint-gate declaration table was frozen at 689 code lines
 * while `gate-registration` refuses a registered gate carrying no row in it, so no lint gate could be added at
 * all. That table was then cut along its gate families into leaf files, and that cut is
 * the only correction: a register is split by category into files composed in a
 * small parent, like any other file. So the marker raises and exempts nothing, and is read only to be refused —
 * measured silently, an under-cap file would pass and an over-cap one would fail without ever saying the
 * mechanism is gone. Reproduce: `yarn lint --only file-size-ratchet`.
 */
export const FILE_LINES_REGISTER_MARKER = "max-file-lines-register";

/** {@link EXEMPT_MARKER_LINE}'s shape, for the retired register marker — the same declaration grammar. */
const REGISTER_MARKER_LINE = markerPattern({ marker: FILE_LINES_REGISTER_MARKER });

/**
 * Whether any exemption marker in the file carries a reason a reader could act on.
 *
 * A block comment's own terminator is not a reason, and the r3 review is why that is spelled out here rather
 * than left to a character class: `/* ${FILE_LINES_EXEMPT_MARKER}: *\/` exempted a file outright, because
 * the `*` of the closing delimiter is a non-space character. Everything from the first `*\/` onward is
 * dropped before the remainder is trimmed, so the terminator can never stand in for the reason.
 */
function hasMarkerReason({ content, pattern }: { content: string; pattern: RegExp }): boolean {
  for (const match of content.matchAll(pattern)) {
    // Group 1 always participates when the pattern matched at all, so there is nothing absent to name here.
    const reason = match[1]!.replace(/\*\/[\s\S]*$/, "").trim();
    if (reason.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * The existing generated-file convention (`src/atlas/slackApi/*.ts`) — never hand-split, never counted.
 *
 * Read from the file's LEADING comment only — the header above its first line of code — never as a bare
 * substring. MEASURED when `tools/` came into scope: generators carry this phrase inside the
 * template literal they EMIT, so a substring test exempted the hand-written generator as if it were its own
 * output, and a line shape cannot tell an emitted ` * GENERATED` from a real one. A generated file says so at
 * its top; a generator says it three hundred lines down.
 */
const GENERATED_MARKER = "GENERATED — do not hand-edit";

/**
 * The text of a file's leading comment run: every blank or comment line before its first line of code, a
 * shebang skipped. Pure.
 *
 * @param content the file's text
 * @returns the header's lines joined, empty when the file opens on code
 */
export function leadingCommentOf({ content }: { content: string }): string {
  const header: string[] = [];
  let inBlock = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const isComment = inBlock || trimmed.startsWith("//") || trimmed.startsWith("/*");
    if (!isComment && trimmed.length > 0 && !trimmed.startsWith("#!")) {
      break;
    }
    header.push(line);
    if (trimmed.startsWith("/*") || inBlock) {
      inBlock = !trimmed.includes("*/");
    }
  }
  return header.join("\n");
}

/**
 * Count newlines the way `wc -l` does, so a refusal's raw count is verifiable with one shell command. Pure.
 *
 * @param content the file's text
 * @returns the number of `\n` characters in `content`
 */
export function rawLineCountOf({ content }: { content: string }): number {
  let count = 0;
  for (const ch of content) {
    if (ch === "\n") {
      count += 1;
    }
  }
  return count;
}

/**
 * Whether a file DECLARES itself generated: the generated-file marker inside its leading comment, never as a bare
 * substring. Pure — the one marker that excuses a file the cap on its own.
 *
 * @param content the file's text
 * @returns true when the header above the file's first line of code carries the marker
 */
export function isGeneratedContent({ content }: { content: string }): boolean {
  return leadingCommentOf({ content }).includes(GENERATED_MARKER);
}

/**
 * Whether a file declares the exemption marker with a reason. Pure — the bare marker name is NOT enough, so a
 * file merely discussing it declares nothing. Declaring it exempts nothing by itself: see {@link fileSizeOf}.
 *
 * @param content the file's text
 * @returns true when at least one {@link FILE_LINES_EXEMPT_MARKER} declaration carries a non-blank reason
 */
export function hasExemptMarker({ content }: { content: string }): boolean {
  return hasMarkerReason({ content, pattern: EXEMPT_MARKER_LINE });
}

/**
 * Whether a file still declares the retired register marker, whatever follows its colon. Pure — its presence IS
 * the defect, so a blank reason or a bare block terminator is found too; prose naming it mid-sentence, a regex
 * literal and ordinary JavaScript declare nothing, by the same grammar the exemption marker uses.
 *
 * @param content the file's text
 * @returns true when a declaration-shaped {@link FILE_LINES_REGISTER_MARKER} is present
 */
export function hasRetiredRegisterMarker({ content }: { content: string }): boolean {
  return content.match(REGISTER_MARKER_LINE) !== null;
}

/** One file's measured size, whether it is excused the cap, and the size markers it declares. */
export interface FileSize {
  readonly path: string;
  readonly rawLines: number;
  readonly codeLines: number;
  /** Excused the cap, never the ratchet: generated, or the exemption marker with a signed tradeoff row. */
  readonly exempt: boolean;
  /** Declares {@link FILE_LINES_EXEMPT_MARKER} with a reason — effective only with a tradeoff row. */
  readonly exemptMarker: boolean;
  /** Declares the retired {@link FILE_LINES_REGISTER_MARKER}, which the gate refuses. */
  readonly registerMarker: boolean;
}

/**
 * A file's measured size. Pure — an exempt file is measured exactly like any other and carries a flag, so
 * that it can be frozen at its own ceiling rather than dropping out of the gate's subject.
 *
 * The approved paths are REQUIRED rather than defaulted, so no caller can measure a marker as effective by
 * forgetting the register: a declared exemption marker exempts a file only when its path is in that set.
 *
 * @param path the file's repo-relative path
 * @param content the file's text
 * @param approvedTradeoffPaths every path the committed tradeoff register holds a signed row for
 * @returns the measured size
 */
export function fileSizeOf({
  path,
  content,
  approvedTradeoffPaths,
}: {
  path: string;
  content: string;
  approvedTradeoffPaths: ReadonlySet<string>;
}): FileSize {
  // A test file is never exempt, whatever it carries or the register holds: an oversized test is split, and a
  // marker would be a way round the rule that oversized files are always split, never marked. Its markers are
  // still READ, so the gate refuses them rather than letting one sit there meaning nothing.
  const test = isTestFilePath({ path });
  const exemptMarker = hasExemptMarker({ content });
  const signed = exemptMarker && approvedTradeoffPaths.has(path);
  return {
    codeLines: codeLinesOf({ content }).length,
    exempt: !test && (isGeneratedContent({ content }) || signed),
    exemptMarker,
    path,
    rawLines: rawLineCountOf({ content }),
    registerMarker: hasRetiredRegisterMarker({ content }),
  };
}

/**
 * Every measured file over its own cap ({@link capFor}), exempt or not, sorted by path. Pure — the exempt
 * ones are held to their recorded ceiling rather than to the cap, and both halves are read off this one list
 * by {@link FileSize.exempt}.
 *
 * @param sizes every measured file
 * @returns the files over their cap, in path order
 */
export function offendersOf({ sizes }: { sizes: readonly FileSize[] }): readonly FileSize[] {
  return sizes
    .filter((size) => size.codeLines > capFor({ path: size.path }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
}
