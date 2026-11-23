/**
 * The lexical half of the `named-object-params` exemption marker — which physical lines carry one, and which
 * of those the signature below can lean on. Pure and line-based: it reads text, never a `ts.Program`, so the
 * whole-repo build stays in `./namedObjectParamsRun.ts` and this is testable against a handful of strings.
 *
 * A marker is a COMMENT line naming {@link EXEMPT_MARKER} followed by a non-empty reason. The line must be a
 * comment, which is what stops the marker's own text — quoted in a string literal, in this gate's tests, or in
 * the rule documentation — from exempting whatever happens to follow it.
 */

import { forEachChild, type NodeVisitor, ts } from "#lib/tsSyntax.js";

/** The inline marker that exempts the signature on the line below it. A reason after it is mandatory. */
export const EXEMPT_MARKER = "named-object-params-exempt";

/** Every character JavaScript treats as a line terminator. */
const LINE_TERMINATORS: readonly string[] = ["\n", "\r", String.fromCharCode(0x2028), String.fromCharCode(0x2029)];

/** A line break as the TypeScript scanner counts one: CRLF as ONE break, then each lone terminator. */
const LINE_BREAK = new RegExp(`\r\n|[${LINE_TERMINATORS.join("")}]`, "u");

/**
 * A source file's physical lines, numbered as the TypeScript scanner numbers them, so index `n` is the line
 * `getLineAndCharacterOfPosition` calls `n`. Splitting on LF alone merged a CR-only file into one line, so a
 * marker there was neither leaned on nor reported redundant.
 *
 * @param text the file's full text
 * @returns each line without its terminator, in order
 */
export function physicalLines({ text }: { text: string }): readonly string[] {
  return text.split(LINE_BREAK);
}

/** The text of a comment line after its opener, or `undefined` when the line is not a comment line at all. */
function commentBody({ line }: { line: string }): string | undefined {
  const trimmed = line.trim();
  const opener = /^(?:\/\/+|\/\*+|\*+)/u.exec(trimmed)?.[0];
  if (opener === undefined) {
    return undefined;
  }
  const rest = trimmed.slice(opener.length).trimStart();
  // A body spanning an interior line terminator is not one comment line (the old whole-line pattern's `.` stopped there).
  return LINE_TERMINATORS.some((terminator) => rest.includes(terminator)) ? undefined : rest;
}

/**
 * Whether a physical line is a marker a signature directly below it may lean on: a comment line carrying
 * `named-object-params-exempt:` and a non-empty reason after it.
 *
 * @param line one physical source line
 * @returns true when the line is an effective marker
 */
export function isMarkerLine({ line }: { line: string }): boolean {
  const body = commentBody({ line });
  if (body === undefined) {
    return false;
  }
  const at = body.indexOf(`${EXEMPT_MARKER}:`);
  return at >= 0 && body.slice(at + EXEMPT_MARKER.length + 1).trim().length > 0;
}

/**
 * The 0-based line indexes that are markers the author WROTE as markers: the comment's own text opens with the
 * token. A comment that merely mentions the token mid-sentence still exempts the line below it (see
 * {@link isMarkerLine}) but is never reported as redundant, because it is prose before it is an exemption.
 *
 * @param lines every physical line of one source file
 * @returns the index of each deliberate marker, in order
 */
export function deliberateMarkerLines({ lines }: { lines: readonly string[] }): readonly number[] {
  return lines.flatMap((line, index) => {
    const body = commentBody({ line });
    return body !== undefined && body.startsWith(`${EXEMPT_MARKER}:`) && isMarkerLine({ line }) ? [index] : [];
  });
}

/**
 * The 0-based lines that fall inside a template literal or a backslash-continued string literal after its first
 * line. Text there is data, not a comment, so a marker-shaped line in it (a gate's own fixture) is never a marker.
 *
 * @param sf the parsed source file
 * @returns a fresh set the caller may add to
 */
export function literalInteriorLines({ sf }: { sf: ts.SourceFile }): Set<number> {
  const inside = new Set<number>();
  const visit: NodeVisitor = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const first = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      const last = sf.getLineAndCharacterOfPosition(node.end).line;
      for (let line = first + 1; line <= last; line += 1) {
        inside.add(line);
      }
    }
    forEachChild({ node, visit });
  };
  visit(sf);
  return inside;
}

/**
 * The deliberate markers no signature needed. A marker is the author's override, so one that overrides nothing
 * is a claim the next reader has to disprove — and it rots into a cargo-culted reason ("TS1230 forbids
 * destructuring") that the compiler, not the author, already decided.
 *
 * @param accountedFor lines already explained: a marker a needy signature leans on, or literal text
 * @param lines every physical line of the file
 * @returns each stranded marker's 1-based line and its trimmed comment text
 */
export function unusedMarkers({
  accountedFor,
  lines,
}: {
  accountedFor: ReadonlySet<number>;
  lines: readonly string[];
}): readonly { readonly line: number; readonly text: string }[] {
  return deliberateMarkerLines({ lines })
    .filter((index) => !accountedFor.has(index))
    .map((index) => ({ line: index + 1, text: lines[index]!.trim() }));
}
