/**
 * The REPOSITORY gate's runner — `yarn hygiene`, `slopweaver hygiene` and the `dev-gate` job: walk the working
 * tree, scan each text file with `./scan.ts`'s {@link scanContent}, split the hits into the arms that fail and
 * the arm that is reported, print them and decide the exit code.
 *
 * Apart from `./scan.ts` because that module is the shared VERDICT — the patterns, the denylist and
 * {@link isRefusedHit} — which a dozen other consumers import without ever walking a tree; this is the one
 * consumer that walks it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendAll } from "../lib/arrays.js";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import {
  denylistStatusLine,
  type Hit,
  isRefusedHit,
  isSecretHit,
  type LineListLoad,
  loadDenylistResult,
  scanContent,
  unreadableDenylistMessage,
} from "./scan.js";

/**
 * Repo root, anchored on THIS module's own location (not cwd) — so the gate always scans the repo the
 * scanner belongs to, whether it's run from CI, the script, `slopweaver hygiene`, a subdir, or another repo.
 */
function repoRoot(): string {
  return repoRootOf({ importMetaUrl: import.meta.url });
}

/** List working-tree files (repo-relative), anchored at `root`. Throws if run outside a git checkout. */
function scanFiles({ root }: { root: string }): readonly string[] {
  return workingTreeFilesOf({ root });
}

/** A NUL byte is the cheap, reliable "this is binary, skip it" signal. */
function looksBinary({ content }: { content: string }): boolean {
  return content.includes("\u0000");
}

/**
 * IO edge: scan every file, print each hit, return 0 (clean) or 1 (any hit / hard error).
 *
 * @returns the process exit code (0 clean, 1 a hit was found or the scan could not complete)
 */
export function runScan(): number {
  let root: string;
  let files: readonly string[];
  try {
    root = repoRoot();
    files = scanFiles({ root });
  } catch {
    process.stderr.write("hygiene: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const load = loadDenylistResult();
  if (load.kind === "unreadable") {
    process.stderr.write(`${denylistStatusLine({ load })}\n`);
    process.stderr.write(`${unreadableDenylistMessage({ load })}\n`);
    return 1;
  }
  const denylist = load.kind === "absent" ? [] : load.lines;
  const hits: Hit[] = [];
  const unreadable: string[] = [];
  for (const path of files) {
    let content: string;
    try {
      content = readFileSync(join(root, path), "utf8");
    } catch {
      // A file this gate could not read is a file it did not check, and printing `clean` over it is
      // the exact silent failure the gate exists to prevent.
      unreadable.push(path);
      continue;
    }
    if (looksBinary({ content })) {
      continue;
    }
    appendAll({ from: scanContent({ content, denylist, path }), into: hits });
  }
  return reportScan({ files, hits, load, unreadable });
}

/**
 * Pure: split hits into three disjoint arms — the SECRETS that fail always, the IDENTIFIERS that fail because
 * {@link isRefusedHit} refuses them, and the identifiers that are merely reported.
 *
 * Separated from the printing so the verdict is unit-testable without capturing a stream — the whole verdict
 * lives in this one function, and a test can state which arm each label lands in. Three arms rather than two
 * because a refused identifier is not a secret: folded into one failing arm, a real workspace id printed under
 * the SECRET heading, and the reader acting on it went looking for a credential that was never there.
 *
 * @param hits every hit the scan produced
 * @returns `secrets` (a credential shape or denylist word, {@link isSecretHit}), `refusedIdentifiers` (any other
 *   hit {@link isRefusedHit} refuses) and `reportedIdentifiers` (the rest), each in scan order
 */
export function partitionHits({ hits }: { hits: readonly Hit[] }): {
  readonly secrets: readonly Hit[];
  readonly refusedIdentifiers: readonly Hit[];
  readonly reportedIdentifiers: readonly Hit[];
} {
  const secrets: Hit[] = [];
  const refusedIdentifiers: Hit[] = [];
  const reportedIdentifiers: Hit[] = [];
  for (const hit of hits) {
    if (isSecretHit({ label: hit.label })) {
      secrets.push(hit);
    } else if (isRefusedHit({ label: hit.label })) {
      refusedIdentifiers.push(hit);
    } else {
      reportedIdentifiers.push(hit);
    }
  }
  return { refusedIdentifiers, reportedIdentifiers, secrets };
}

/**
 * Print the scan outcome and decide the exit code.
 *
 * @param files every file the scan enumerated
 * @param hits the leak-class + denylist hits found
 * @param load which denylist outcome this run had — printed on EVERY run, clean ones included
 * @param unreadable files that could not be read, so were never checked
 * @returns 0 when no refused hit and no unreadable file; a reported hit is printed and does not fail
 */
function reportScan({
  files,
  hits,
  load,
  unreadable,
}: {
  files: readonly string[];
  hits: readonly Hit[];
  load: LineListLoad;
  unreadable: readonly string[];
}): number {
  const { refusedIdentifiers, reportedIdentifiers, secrets } = partitionHits({ hits });
  const failing = secrets.length > 0 || refusedIdentifiers.length > 0 || unreadable.length > 0;
  const lines = scanReportLines({
    failing,
    files,
    load,
    refusedIdentifiers,
    reportedIdentifiers,
    secrets,
    unreadable,
  });
  // A non-failing run's lines all go to stdout so a piped clean run stays self-describing: the verdict alone
  // was what let CI read `clean` from a run that had applied no local word at all. See
  // {@link denylistStatusLine}. A failing run puts everything on stderr, identifier notes included, so the
  // whole picture is in one place for whoever has to act on it.
  const stream = failing ? process.stderr : process.stdout;
  stream.write(`${lines.join("\n")}\n`);
  return failing ? 1 : 0;
}

/**
 * Pure: every line the report prints, in order — a refused identifier under its own IDENTIFIER heading, never
 * under the SECRET one.
 *
 * @internal — exported only so a test can assert the headings without capturing a stream.
 * @param failing whether a refused hit or an unreadable file decided the exit code
 * @param files every file the scan enumerated
 * @param load which denylist outcome this run had
 * @param refusedIdentifiers the identifiers that fail
 * @param reportedIdentifiers the identifiers printed and passed
 * @param secrets the credential and denylist hits, which fail always
 * @param unreadable files that were never checked
 * @returns the lines, without trailing newlines
 */
export function scanReportLines({
  failing,
  files,
  load,
  refusedIdentifiers,
  reportedIdentifiers,
  secrets,
  unreadable,
}: {
  failing: boolean;
  files: readonly string[];
  load: LineListLoad;
  refusedIdentifiers: readonly Hit[];
  reportedIdentifiers: readonly Hit[];
  secrets: readonly Hit[];
  unreadable: readonly string[];
}): readonly string[] {
  const located = (hit: Hit): string => `  ${hit.path}:${String(hit.line)}: [${hit.label}] ${hit.excerpt}`;
  // "clean" only when NOTHING matched. With identifier hits listed above it, a `clean` verdict reads as a
  // contradiction and invites the next reader to treat the list as noise; naming what actually passed says the
  // gate looked and decided.
  const verdict =
    reportedIdentifiers.length === 0 ? "clean" : "no refused hits (identifier hits above are informational)";
  return [
    denylistStatusLine({ load }),
    ...(secrets.length === 0
      ? []
      : [`hygiene: ${String(secrets.length)} SECRET hit(s) — these fail:`, ...secrets.map(located)]),
    ...(refusedIdentifiers.length === 0
      ? []
      : [
          `hygiene: ${String(refusedIdentifiers.length)} IDENTIFIER hit(s) — these fail ` +
            `(replace each with a synthetic stand-in, see AGENTS.md § "no organisation names in what you commit"):`,
          ...refusedIdentifiers.map(located),
        ]),
    ...(reportedIdentifiers.length === 0
      ? []
      : [
          `hygiene: ${String(reportedIdentifiers.length)} identifier hit(s) — reported, NOT a failure ` +
            `(state belongs under $SLOPWEAVER_HOME, see AGENTS.md § "no secrets, ever"):`,
          ...reportedIdentifiers.map(located),
        ]),
    ...unreadable.map((path) => `  ${path}  (unreadable — NOT checked)`),
    ...(failing ? [] : [`hygiene: ${verdict} (${String(files.length)} files scanned)`]),
  ];
}
