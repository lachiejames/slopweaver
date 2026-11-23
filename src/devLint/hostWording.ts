/**
 * The host-wording gate: an ADDED line in source or docs that calls the machine Slopweaver runs on by its make.
 *
 * ## The rule, and why it is a diff gate
 *
 * Slopweaver is macOS only, so macOS, Keychain, Spotlight and APFS are product names and stay. What the owner's
 * attribution rule retired is the phrase that names the HOST by its make — the spelling is "this machine". The
 * publication scan (`../outbound/publicationScan.ts`) refuses it in everything a pull request publishes; this gate
 * keeps it out of new code and docs, where an error message or a skill would otherwise carry it straight back
 * into published text.
 *
 * It judges only lines this branch ADDS against `SLOPWEAVER_COVERAGE_BASE_SHA`, the base commit CI exports and
 * fetches for `lint` and `github lap` exports for its own (`gitAtCommit.ts`), so the lines already on the base
 * need no debt list and no baseline: rewording one is ordinary work, never a precondition for landing something
 * else. Run with no base it fails and prints the command that supplies one, because it compared nothing.
 *
 * ## The criterion, stated rather than counted
 *
 * > A line added against the base commit, in a tracked file outside every `__tests__` tree, holding the two
 * > words "this" and "mac" as whole words separated by whitespace, case-insensitive, that is not wrapped EXACTLY
 * > in a matching pair of quotes or backticks.
 *
 * The wrapped case is the phrase named as itself — the doc that states the rule, a refusal quoting what it
 * refused — and it is outside the criterion rather than exempted by a marker. A `__tests__` tree is outside it
 * because its fixtures feed the publication scan the very phrase that scan refuses. There is no allowlist and no
 * marker.
 *
 * The diff is TWO-dot for the reason `testEnshittification.ts` records: CI's `--depth=1` fetch grafts a
 * parentless base, so a three-dot diff has no merge-base to compute. `-M` follows a rename, so moving a file is
 * not read as adding every line in it. `core.quotePath=false` keeps a non-ASCII path whole.
 */

import { gitLines, runAgainstFloorBase } from "./gitAtCommit.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * One added line, where it now sits.
 * @internal — the shape this gate's own steps pass between them.
 */
export interface AddedLine {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/** The phrase, as whole words separated by whitespace. */
const HOST_PHRASE = /(?<![\p{L}\p{N}_])this\s+mac(?![\p{L}\p{N}_])/giu;

/** The closer each wrapping opener pairs with. */
const WRAPPERS: Readonly<Record<string, string>> = { '"': '"', "'": "'", "`": "`", "“": "”" };

/** A hunk header's new-side start line. */
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

/**
 * Every added line in a `git diff -U0` stream. Pure.
 *
 * @param diff the diff's lines, as git printed them
 * @returns each added line with its path and new-side line number
 * @internal — exported for its unit test; {@link runHostWording} is its one caller.
 */
export function addedLinesOf({ diff }: { diff: readonly string[] }): readonly AddedLine[] {
  const added: AddedLine[] = [];
  let path: string | undefined;
  let next = 0;
  for (const raw of diff) {
    if (raw.startsWith("+++ ")) {
      path = raw.startsWith("+++ b/") ? raw.slice("+++ b/".length) : undefined;
      continue;
    }
    const hunk = HUNK.exec(raw);
    if (hunk !== null) {
      next = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+") && path !== undefined) {
      added.push({ line: next, path, text: raw.slice(1) });
      next += 1;
    }
  }
  return added;
}

/**
 * Whether the gate reads a path at all: every tracked file outside a `__tests__` tree.
 *
 * @param path the repo-relative path
 * @returns true when an added line in it is judged
 * @internal — exported for its unit test; {@link hostWordingHits} is its one caller.
 */
export function isHostWordingScope({ path }: { path: string }): boolean {
  return !path.split("/").includes("__tests__");
}

/**
 * Whether a line carries the phrase outside an exact quote of itself. Pure.
 *
 * @param text the added line's text
 * @returns true when the line names the host by its make
 * @internal — exported for its unit test; {@link hostWordingHits} is its one caller.
 */
export function namesHostByMake({ text }: { text: string }): boolean {
  return [...text.matchAll(HOST_PHRASE)].some((match) => {
    const before = match.index === 0 ? "" : text[match.index - 1]!;
    const end = match.index + match[0].length;
    const after = end < text.length ? text[end]! : "";
    const closer = WRAPPERS[before];
    return closer === undefined || closer !== after;
  });
}

/**
 * Every added line the gate refuses. Pure.
 *
 * @param added the added lines
 * @returns the lines in scope that name the host by its make
 * @internal — exported for its unit test; {@link runHostWording} is its one caller.
 */
export function hostWordingHits({ added }: { added: readonly AddedLine[] }): readonly AddedLine[] {
  return added.filter((line) => isHostWordingScope({ path: line.path }) && namesHostByMake({ text: line.text }));
}

/**
 * Print a FACT about what the gate could or could not see. Every caller is a state the gate could not get past,
 * so this channel never carries a verdict about anyone's code.
 */
function fact({ line }: { line: string }): void {
  // devlint: not-a-refusal -- this is the FACT channel itself; a rule catching something goes through lintGateRefusal
  process.stderr.write(`host-wording: ${line}\n`);
}

/**
 * Run the gate.
 *
 * @returns the process exit code — 0 when no added line names the host by its make, or a brand-new ref has no
 *   previous commit; 1 on a finding, or no usable base
 */
export function runHostWording(): number {
  return runAgainstFloorBase({ gate: "host-wording", judge });
}

/** The half that has a base commit, present in this checkout, in hand. */
function judge({ root, sha }: { root: string; sha: string }): number {
  const diff = gitLines({
    args: ["-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-ext-diff", "-M", sha, "HEAD"],
    root,
  });
  if (diff === undefined) {
    // devlint: not-a-refusal -- git would not report the diff, so there is no input to judge
    fact({ line: `git diff against ${sha} failed — no comparison made` });
    return 1;
  }
  const added = addedLinesOf({ diff });
  const hits = hostWordingHits({ added });
  if (hits.length === 0) {
    process.stdout.write(`host-wording: clean (${String(added.length)} added line(s) vs ${sha.slice(0, 9)})\n`);
    return 0;
  }
  for (const hit of hits) {
    // devlint: not-a-refusal -- a per-finding diagnostic; the summary below it is the rendered refusal
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: names the host by its make — write "this machine"\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "host-wording" }),
      detail: `${String(hits.length)} added line(s) against ${sha.slice(0, 9)}`,
    })}\n`,
  );
  return 1;
}
