/**
 * The `named-object-params` decision stream: every decision the rule makes over one subject tree, written as
 * JSON Lines to a file, so two implementations of the rule can be compared byte for byte.
 *
 * ## What it is for
 *
 * Moving this rule onto another compiler must change no decision. The acceptance is two streams over ONE fixed
 * subject — a detached checkout with its own `yarn install --immutable`, outside the repository — written by the
 * old rule and by the new one (`./namedObjectParamsRun.ts` § subject mode), then `cmp -s` on the two files and
 * `diff -u` to name a difference. Because both runs read the same sources and the same installed declarations,
 * a differing line is a differing compiler decision and nothing else.
 *
 * ## What makes a row stable
 *
 * One row per examined signature and one per redundant marker (`NamedObjectParamsDecisionRow`,
 * `./namedObjectParams.ts`): its path relative to the subject root with `/` separators, a 1-based line and
 * column, the display name, the whitespace-collapsed parameter list, and WHICH branch decided it
 * (`./namedObjectParamsDecide.ts`). Files are walked in byte order of that relative path, signatures in walk
 * order within a file, then that file's marker rows. Nothing absolute, timed or host-specific reaches a row.
 *
 * The stream is written through one `writeFileAtomicStream`, one `JSON.stringify` per row: a whole-repository
 * stream is data-sized, a row for every function in the tree, and is never held as one string.
 *
 * A subject that breaks the rule still streams in full, and the run exits 1 after it: its violation rows are
 * decisions like any other, and the very ones a compiler move must not change. A run that never finishes its
 * scan leaves no file at the path (`./namedObjectParamsProgram.ts#readSubject` clears an earlier one first),
 * and neither does one whose violating files then fail to compile ({@link discardDecisionStream}).
 */

import { realpathSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type * as ts from "#lib/tsCompiler.js";
import { writeFileAtomicStream } from "#lib/writeAtomic.js";

import {
  type NamedObjectParamsDecisionRow,
  type NamedObjectParamsViolation,
  scanNamedObjectParams,
} from "./namedObjectParams.js";

/** Rows held before one write, so a whole-repository stream is not one system call per signature. */
const ROWS_PER_WRITE = 1024;

/** A path relative to the subject root, `/`-separated whatever the host's separator. */
function subjectPath({ path, root }: { path: string; root: string }): string {
  return relative(root, path).split(sep).join("/");
}

/**
 * UTF-8 byte-order comparison: locale-independent, so two hosts sort one subject identically. Not `a < b`,
 * which compares UTF-16 code units and puts a path past U+FFFF (a surrogate pair, `D800`…) before one in
 * U+E000–U+FFFF, the reverse of byte order.
 */
function byteOrder({ a, b }: { a: string; b: string }): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * A path with every symlink in its longest EXISTING prefix resolved, so a stream path that does not exist yet
 * compares against a root git printed in its real form — `/var/…` and `/private/var/…` are one directory.
 */
function realPrefix({ path }: { path: string }): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) {
      return absolute;
    }
    return join(realPrefix({ path: parent }), basename(absolute));
  }
}

/**
 * Whether `path` is the subject root or anywhere under it — where a stream must never be written, since the
 * next run over that subject would find a file git does not report and refuse its coverage. Both sides are
 * compared with their symlinks resolved, so a link cannot smuggle the stream inside.
 *
 * @param path the stream path, absolute or relative to the working directory
 * @param root the subject root
 * @returns true when the stream would land inside the subject
 */
export function isInsideSubject({ path, root }: { path: string; root: string }): boolean {
  const fromRoot = relative(realPrefix({ path: root }), realPrefix({ path }));
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

/**
 * One row as its stream line: the row with its path made subject-relative, its keys in a fixed order, and a
 * trailing newline.
 *
 * @param row the decision as the scan produced it
 * @param root the subject root the path is made relative to
 * @returns the JSON line, newline included
 */
function decisionStreamLine({ row, root }: { row: NamedObjectParamsDecisionRow; root: string }): string {
  const canonical: NamedObjectParamsDecisionRow = {
    column: row.column,
    decision: row.decision,
    kind: row.kind,
    line: row.line,
    name: row.name,
    path: subjectPath({ path: row.path, root }),
    signature: row.signature,
  };
  return `${JSON.stringify(canonical)}\n`;
}

/**
 * Scan the subject's sources exactly as the gate does and write every decision to `decisionStreamPath`, the
 * file replaced atomically so a failed run never leaves half a stream to compare. Throws what the write threw;
 * the caller has already refused a stream path inside the subject (`isInsideSubject`).
 *
 * @param checker the subject Program's type checker
 * @param decisionStreamPath where the JSON Lines go, outside the subject
 * @param root the subject root every row's path is made relative to
 * @param sourceFiles the subject's in-scope sources, in any order — they are walked in byte order of path
 * @returns the violations the scan found
 */
function streamDecisions({
  checker,
  decisionStreamPath,
  root,
  sourceFiles,
}: {
  checker: ts.Checker;
  decisionStreamPath: string;
  root: string;
  sourceFiles: readonly ts.SourceFile[];
}): readonly NamedObjectParamsViolation[] {
  const ordered = sourceFiles.toSorted((a, b) =>
    byteOrder({ a: subjectPath({ path: a.fileName, root }), b: subjectPath({ path: b.fileName, root }) }),
  );
  let violations: readonly NamedObjectParamsViolation[] = [];
  writeFileAtomicStream({
    path: resolve(decisionStreamPath),
    // The stream file's own sink, named apart from the gate's stderr `write` — these are rows, never a summary.
    produce: ({ write: appendRows }) => {
      let pending: string[] = [];
      violations = scanNamedObjectParams({
        checker,
        onDecision: (row) => {
          pending.push(decisionStreamLine({ root, row }));
          if (pending.length >= ROWS_PER_WRITE) {
            appendRows({ text: pending.join("") });
            pending = [];
          }
        },
        sourceFiles: ordered,
      });
      appendRows({ text: pending.join("") });
    },
  });
  return violations;
}

/**
 * The rule as a run applies it: plainly in the gate run, or writing the decision stream as it goes when a
 * stream path is named. The gate run reaches exactly the scan it always did, with no sink and no row.
 *
 * @param checker the Program's type checker
 * @param decisionStreamPath where the decision stream goes; absent in the gate run
 * @param root the root the sources are relative to
 * @param sourceFiles the in-scope sources
 * @param write the gate's stderr sink, for a stream that could not be written
 * @returns the violations, or `undefined` when the stream could not be written
 */
export function scanForRun({
  checker,
  decisionStreamPath,
  root,
  sourceFiles,
  write,
}: {
  checker: ts.Checker;
  decisionStreamPath?: string | undefined;
  root: string;
  sourceFiles: readonly ts.SourceFile[];
  write: (text: string) => void;
}): readonly NamedObjectParamsViolation[] | undefined {
  if (decisionStreamPath === undefined) {
    return scanNamedObjectParams({ checker, sourceFiles });
  }
  let violations: readonly NamedObjectParamsViolation[];
  try {
    violations = streamDecisions({ checker, decisionStreamPath, root, sourceFiles });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    // devlint: not-a-refusal -- the decision stream could not be written, so the run has no output to compare
    write(`named-object-params: could not write the decision stream ${decisionStreamPath}: ${reason}\n`);
    return undefined;
  }
  process.stdout.write(`named-object-params: decision stream written to ${decisionStreamPath}\n`);
  return violations;
}

/**
 * Remove a stream the scan already wrote once the run learns the types under it do not compile: on the
 * violation path the semantic pass runs AFTER the scan, and decisions over broken types are not a stream
 * anything should compare.
 *
 * @param decisionStreamPath the stream to remove; absent in the gate run, which wrote none
 */
export function discardDecisionStream({ decisionStreamPath }: { decisionStreamPath?: string | undefined }): void {
  if (decisionStreamPath !== undefined) {
    rmSync(decisionStreamPath, { force: true });
    process.stdout.write(`named-object-params: decision stream ${decisionStreamPath} discarded\n`);
  }
}
