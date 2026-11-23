/**
 * The check that stops a 48th gate from writing its own refusal.
 *
 * ## The criterion, and why it is shaped this way
 *
 * A gate's own diagnostics are INDENTED — `  path:line: message` — and a gate's SUMMARY is not. That one
 * property separates the two without a vocabulary: a top-level stderr write from a `src/devLint` module is
 * either a fact report, or a policy summary that belongs to `./render.ts`. Matching on words instead —
 * `violation(s)`, `finding(s)` — is what a differently-worded gate evades by accident on its first day.
 *
 * So: a stderr write in `src/devLint` whose first literal chunk is NOT indented, and which is not produced
 * by `lintGateRefusal`, must declare what it is instead by carrying {@link NOT_A_REFUSAL_MARKER}.
 *
 * ## The marker is the honest part, and its limit is stated
 *
 * A gate author can mislabel a policy result as a fact, and nothing here can tell. That is the same residue
 * the hatch register carries about its own exception prose — no machine can check that a stated reason is
 * true. What the marker buys is that the claim is WRITTEN DOWN in the diff, where a reviewer sees it, rather
 * than being the silent default it is today. It is not a path allowlist: it sits on the line, it names the
 * reason, and it cannot be applied to a whole file.
 *
 * Deliberately text-and-line based rather than checker-backed, matching `../escapeHatch.ts`: every part of
 * this criterion is about a literal an author writes.
 *
 * ## The blind spot, stated rather than discovered
 *
 * A module can define its own forwarding alias and call THAT with hand-written text:
 *
 * ```text
 * const emit: (text: string) => void = (text) => { process.stderr.write(text); };
 * emit("Passing dev lint is blocked because …");
 * ```
 *
 * The forwarder is exempt because forwarding is what a sink legitimately does, and `emit(…)` is not a name
 * this criterion knows. Closing it needs dataflow — following a value to the stream it reaches — which no
 * text rule has. Six review passes found six evasions of the *spelling* kind and each is closed; this one
 * is a different animal, and it is written here because a blind spot a reader can see is worth more than
 * one they discover. `../../__tests__/unit/devLint/refusal.test.ts` pins the shape, so a future change that
 * does close it fails loudly instead of leaving this paragraph a lie.
 *
 * What it costs is bounded: an author reaching for a private alias for stderr is routing around a gate they
 * can see, which is the case the `not-a-refusal` marker was already only ever an honesty check against.
 */

/**
 * The marker a write that is NOT a policy refusal carries, with a reason after it.
 *
 * Two shapes legitimately wear it, and the reason says which. A FACT report — the gate could not obtain or
 * trust its inputs, so it has no verdict to refuse with. A CORRECTION body — the gate is printing the thing
 * the operator is meant to paste. Or a per-finding DIAGNOSTIC built by a helper, where the indentation the
 * scanner reads for is inside that helper rather than at the call.
 *
 * @internal — this module's own criterion; the gates carry the marker rather than importing it.
 */
export const NOT_A_REFUSAL_MARKER = /\/\/\s*devlint:\s*not-a-refusal\s*--\s*\S/;

/**
 * ANY write to a stderr sink, with the first stretch of its argument captured.
 *
 * `process.stdout.write` stays outside it: stdout is where a gate reports that it is CLEAN, and a clean
 * report is not a refusal.
 *
 * Deliberately a catch-all rather than a list of argument shapes. Five of the six evasions found in review
 * were "the scanner does not know THAT spelling" — a wrapped call, an identifier, `console.error`, a
 * `Buffer.from(…)` — and enumerating argument forms loses that race by construction. So every sink call is
 * a finding until something POSITIVELY exempts it: an indented diagnostic literal, the renderer's own
 * output, a sink forwarding its arrow parameter, or a marker saying what it is instead.
 *
 * The argument is captured in a LOOKAHEAD so the match stays zero-width past the opening bracket. Consuming
 * it advanced `lastIndex` over whatever followed, and a long argument then swallowed the next call entirely
 * — a scanner that misses a write because the previous one was verbose.
 */
const SINK_WRITE =
  /(?<call>process\.stderr\.write|console\.error|console\.warn|writeErr|write)\(\s{0,40}(?=(?<arg>[\s\S]{0,80}))/g;

/**
 * The call spellings that are unambiguously a stderr write wherever they appear.
 *
 * `console.error` and `console.warn` join `process.stderr.write` here because all three name their own
 * destination — there is no other `console.error` to confuse them with. The bare `write`/`writeErr` forms
 * are injected sinks and need the position check, since those words also occur in prose. `console.error`
 * was the fifth evasion the r3 review pass found: its own planning pass had named it and the first
 * implementation dropped it.
 */
const DIRECT_SINKS: ReadonlySet<string> = new Set(["process.stderr.write", "console.error", "console.warn"]);

/** One hand-written lint summary: where it is, and what it opened with. */
export interface LintRefusalShapeHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
  /** Which of the escape-hatch gate's criteria produced it, so the right declaration is rendered. */
  readonly criterion: "lint-shape";
}

/**
 * Whether an identifier written to stderr is a parameter of an arrow that opens just above it.
 *
 * That shape — `write: (text) => { process.stderr.write(text); }` — is a sink FORWARDING what a caller
 * handed it, and this directory has 34 of them around `reportScanIntegrity`. A refusal parked in a
 * variable does not look like that: its identifier is bound by a `const`, not by the arrow it sits inside.
 * Three lines of lookback covers every real forwarder here and reaches no further than one.
 *
 * @param arg the identifier being written
 * @param index the zero-based line of the write
 * @param lines every line of the file
 * @returns true when the identifier is the enclosing arrow's own parameter
 */
function forwardsAnArrowParameter({
  arg,
  index,
  lines,
}: {
  arg: string;
  index: number;
  lines: readonly string[];
}): boolean {
  const opener = new RegExp(`\\(\\s{0,4}\\{?\\s{0,4}${arg}\\s{0,4}[,)}][^=]{0,20}=>`);
  for (let at = index; at >= Math.max(0, index - 3); at -= 1) {
    if (opener.test(lines[at]!)) {
      return true;
    }
  }
  return false;
}

/**
 * Which zero-based line an offset into the file falls on.
 *
 * The scan is content-wide rather than line-by-line because a call and its first string literal are
 * routinely on DIFFERENT physical lines — prettier wraps them that way, and every converted gate in this
 * directory is wrapped. A line-based scan silently missed all of them, found with a probe against the production scanner.
 *
 * @param content the whole file
 * @param offset an offset into it
 * @returns the zero-based line index
 */
function lineIndexOf({ content, offset }: { content: string; offset: number }): number {
  let line = 0;
  for (let at = 0; at < offset; at += 1) {
    if (content[at] === "\n") {
      line += 1;
    }
  }
  return line;
}

/**
 * Whether the contiguous comment block directly above a line carries the marker.
 *
 * The whole block rather than one line, because a reason worth writing sometimes needs two — and a rule
 * that silently ignored the second line would teach authors to write shorter reasons, which is the opposite
 * of the point.
 *
 * @param index the zero-based index of the write's own line
 * @param lines every line of the file
 * @returns true when a comment line immediately above it carries the marker
 */
function markedAbove({ index, lines }: { index: number; lines: readonly string[] }): boolean {
  for (let at = index - 1; at >= 0; at -= 1) {
    const above = lines[at]!;
    if (!above.trimStart().startsWith("//")) {
      return false;
    }
    if (NOT_A_REFUSAL_MARKER.test(above)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a captured literal head is an indented diagnostic rather than a summary.
 *
 * TWO spaces, not one. Every real per-finding line in this directory opens with two — `  path:line: …` —
 * and a single space is not a shape anything here writes. Accepting one was a live evasion: a hand-written
 * policy refusal prefixed with one space classified as a diagnostic and needed no marker at all. Found by
 * building the probe rather than reasoning about it.
 */
function isIndentedDiagnostic({ head }: { head: string }): boolean {
  return head.startsWith("  ") || head.startsWith("\\n  ");
}

/**
 * Whether one matched write is exempt: a diagnostic, the renderer's own output, a forwarding sink, or a
 * write whose comment block declares it is not a refusal.
 *
 * Split out of {@link scanLintRefusalWrites} so the four exemptions read as one list rather than a chain of
 * early returns — each is a separate reason, and the caller should not have to hold their order.
 *
 * @param match the regex match for one write
 * @param content the whole file, for the qualifier check before a bare sink
 * @param index the zero-based line the write is on
 * @param lines every line of the file
 * @returns true when the write needs no refusal shape
 */
function isExempt({
  match,
  content,
  index,
  lines,
}: {
  match: RegExpExecArray;
  content: string;
  index: number;
  lines: readonly string[];
}): boolean {
  const call = match.groups!["call"]!;
  // The bare `write(`/`writeErr(` form is a sink only where a sink can be CALLED: at the start of a
  // statement, or straight after an arrow. Anywhere else it is prose — this gate's own declaration says
  // "direct stdout write(s) on the verb surface", and that is not a call.
  const before = content.slice(0, match.index);
  if (!DIRECT_SINKS.has(call) && !/(?:^|\n)\s{0,80}$|=>\s{0,4}$/.test(before)) {
    return true;
  }
  const arg = match.groups!["arg"]!;
  const literal = /^\{?\s{0,40}(?:text:\s{0,40})?["'`](?<head>[\s\S]{0,20})/.exec(arg);
  const head = literal?.groups?.["head"];
  if (head !== undefined && (isIndentedDiagnostic({ head }) || head.startsWith("${lintGateRefusal"))) {
    return true;
  }
  const identifier = /^\{?\s{0,40}(?:text:\s{0,40})?(?<name>[A-Za-z_$][\w$.]{0,60})\s{0,40}\}?\s{0,40}\)/.exec(arg);
  const name = identifier?.groups?.["name"];
  if (name !== undefined && forwardsAnArrowParameter({ arg: name, index, lines })) {
    return true;
  }
  return NOT_A_REFUSAL_MARKER.test(lines[index]!) || markedAbove({ index, lines });
}

/**
 * Every hand-written policy summary in one devLint module.
 *
 * @param content the file's source
 * @param path the repo-relative path
 * @returns the hits, in line order
 */
export function scanLintRefusalWrites({
  content,
  path,
}: {
  content: string;
  path: string;
}): readonly LintRefusalShapeHit[] {
  const lines = content.split("\n");
  const matches = [...content.matchAll(SINK_WRITE)];
  return matches.flatMap((match) => {
    const index = lineIndexOf({ content, offset: match.index });
    const trimmed = lines[index]!.trimStart();
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
      return [];
    }
    if (isExempt({ content, index, lines, match })) {
      return [];
    }
    return [
      {
        line: index + 1,
        criterion: "lint-shape" as const,
        message: `a lint summary written by hand or passed through a variable — render it with lintGateRefusal (src/devLint/refusal/render.ts), or mark the line above it \`devlint: not-a-refusal -- <why: a fact the gate could not get past, or a correction body>\``,
        path,
      },
    ];
  });
}
