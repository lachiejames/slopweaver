/**
 * The REPOSITORY gate's runner — `yarn hygiene`, `slopweaver hygiene`, the `dev-gate` job and the pre-push lane's
 * `hygiene` gate: walk the working tree, scan each text file with `./scan.ts`'s {@link scanContent} and with the
 * installation's private terms (`./privateTerms.ts`), split the hits into the arms that fail and the arm that is
 * reported, print them and decide the exit code.
 *
 * Apart from `./scan.ts` because that module is the shared VERDICT — the patterns, the denylist and
 * {@link isRefusedHit} — which a dozen other consumers import without ever walking a tree; this is the one
 * consumer that walks it. The private terms stay out of that shared verdict on purpose: adding them to its labels
 * would change what the corpus scan, the cassette tripwire, turn freeze and the pull-request metadata scan refuse.
 * How the terms are loaded, matched, set aside and printed is `./repositoryPrivateTerms.ts`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slopweaverHome } from "../config.js";
import { appendAll } from "../lib/arrays.js";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import type { PrivateTerm, PrivateTermsLoad } from "./privateTerms.js";
import {
  loadRepositoryPrivateTerms,
  printableReportLines,
  privateTermHitsInFile,
  privateTermReportSection,
  type RepositoryPrivateTermHit,
  repositoryPrivateTermsStatusLine,
  settleRepositoryPrivateTermHits,
  termsOf,
  unreadableDenylistLines,
} from "./repositoryPrivateTerms.js";
import {
  denylistStatusLine,
  type Hit,
  isRefusedHit,
  isSecretHit,
  type LineListLoad,
  loadDenylistResult,
  scanContent,
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
 * IO: read every working-tree file once and scan each text file for the leak classes, the denylist and the private
 * terms, keeping the exact bytes of every file a term matched so an accepted line can be bound by them.
 *
 * @param root the repository root the paths are relative to
 * @param files every file the scan enumerated
 * @param denylist the private denylist's words, none when it is absent
 * @param terms the loaded private terms, none when the file is absent
 * @returns the leak-class hits, the private-term findings, their files' bytes and the files that would not read
 */
function readWorkingTree({
  root,
  files,
  denylist,
  terms,
}: {
  root: string;
  files: readonly string[];
  denylist: readonly string[];
  terms: readonly PrivateTerm[];
}): {
  readonly hits: readonly Hit[];
  readonly termHits: readonly RepositoryPrivateTermHit[];
  readonly bytesByPath: ReadonlyMap<string, Buffer>;
  readonly unreadable: readonly string[];
} {
  const hits: Hit[] = [];
  const termHits: RepositoryPrivateTermHit[] = [];
  const bytesByPath = new Map<string, Buffer>();
  const unreadable: string[] = [];
  for (const path of files) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(root, path));
    } catch {
      // A file this gate could not read is a file it did not check, and printing `clean` over it is
      // the exact silent failure the gate exists to prevent.
      unreadable.push(path);
      continue;
    }
    const content = bytes.toString("utf8");
    if (looksBinary({ content })) {
      continue;
    }
    appendAll({ from: scanContent({ content, denylist, path }), into: hits });
    const inFile = privateTermHitsInFile({ content, path, terms });
    if (inFile.length > 0) {
      bytesByPath.set(path, bytes);
      appendAll({ from: inFile, into: termHits });
    }
  }
  return { bytesByPath, hits, termHits, unreadable };
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
  // The terms load FIRST, so every line printed after it — an unreadable denylist's path included — can be judged
  // against them. A terms file that will not load has no terms to judge its own refusal by, as for every write.
  const home = slopweaverHome();
  const termsLoad = loadRepositoryPrivateTerms({ home });
  if (termsLoad.kind === "refused") {
    process.stderr.write(`${termsLoad.lines.join("\n")}\n`);
    return 1;
  }
  const terms = termsOf({ load: termsLoad });
  const load = loadDenylistResult();
  if (load.kind === "unreadable") {
    process.stderr.write(`${unreadableDenylistLines({ load, terms }).join("\n")}\n`);
    return 1;
  }
  const denylist = load.kind === "absent" ? [] : load.lines;
  const { bytesByPath, hits, termHits, unreadable } = readWorkingTree({ denylist, files, root, terms });
  const { accepted, standing } = settleRepositoryPrivateTermHits({ bytesByPath, files, hits: termHits, home, terms });
  return reportScan({ accepted, files, hits, load, privateTermHits: standing, termsLoad, unreadable });
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
 * @param accepted how many private-term findings the reviewed-residue list set aside
 * @param files every file the scan enumerated
 * @param hits the leak-class + denylist hits found
 * @param load which denylist outcome this run had — printed on EVERY run, clean ones included
 * @param privateTermHits the private-term findings still standing, each at its printable locus
 * @param termsLoad which private-terms outcome this run had, also printed on every run
 * @param unreadable files that could not be read, so were never checked
 * @returns 0 when no refused hit and no unreadable file; a reported hit is printed and does not fail
 */
function reportScan({
  accepted,
  files,
  hits,
  load,
  privateTermHits,
  termsLoad,
  unreadable,
}: {
  accepted: number;
  files: readonly string[];
  hits: readonly Hit[];
  load: LineListLoad;
  privateTermHits: readonly RepositoryPrivateTermHit[];
  termsLoad: PrivateTermsLoad;
  unreadable: readonly string[];
}): number {
  const { refusedIdentifiers, reportedIdentifiers, secrets } = partitionHits({ hits });
  const failing =
    secrets.length > 0 || refusedIdentifiers.length > 0 || privateTermHits.length > 0 || unreadable.length > 0;
  const lines = scanReportLines({
    accepted,
    failing,
    files,
    load,
    privateTermHits,
    refusedIdentifiers,
    reportedIdentifiers,
    secrets,
    termsLoad,
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
 * Pure: one leak-class section of the report — its heading, then each hit as path, line, label and excerpt — or
 * nothing when it has no hit.
 *
 * @param heading the section's first line, its count already in it
 * @param hits the section's hits, in scan order
 * @returns the lines, empty when there is no hit
 */
function hitSection({ heading, hits }: { heading: string; hits: readonly Hit[] }): readonly string[] {
  if (hits.length === 0) {
    return [];
  }
  return [heading, ...hits.map((hit) => `  ${hit.path}:${String(hit.line)}: [${hit.label}] ${hit.excerpt}`)];
}

/**
 * Pure: every line the report prints, in order — a refused identifier under its own IDENTIFIER heading, never
 * under the SECRET one, and a private term under its own PRIVATE TERM heading as its locus, line and class. With the
 * terms loaded, every line is passed through {@link printableReportLines}, so none can echo a term.
 *
 * @internal — exported only so a test can assert the headings without capturing a stream.
 * @param accepted how many private-term findings the reviewed-residue list set aside
 * @param failing whether a refused hit or an unreadable file decided the exit code
 * @param files every file the scan enumerated
 * @param load which denylist outcome this run had
 * @param privateTermHits the private-term findings that fail, each at its printable locus
 * @param refusedIdentifiers the identifiers that fail
 * @param reportedIdentifiers the identifiers printed and passed
 * @param secrets the credential and denylist hits, which fail always
 * @param termsLoad which private-terms outcome this run had
 * @param unreadable files that were never checked
 * @returns the lines, without trailing newlines
 */
export function scanReportLines({
  accepted,
  failing,
  files,
  load,
  privateTermHits,
  refusedIdentifiers,
  reportedIdentifiers,
  secrets,
  termsLoad,
  unreadable,
}: {
  accepted: number;
  failing: boolean;
  files: readonly string[];
  load: LineListLoad;
  privateTermHits: readonly RepositoryPrivateTermHit[];
  refusedIdentifiers: readonly Hit[];
  reportedIdentifiers: readonly Hit[];
  secrets: readonly Hit[];
  termsLoad: PrivateTermsLoad;
  unreadable: readonly string[];
}): readonly string[] {
  // "clean" only when NOTHING matched. With identifier hits listed above it, a `clean` verdict reads as a
  // contradiction and invites the next reader to treat the list as noise; naming what actually passed says the
  // gate looked and decided.
  const verdict =
    reportedIdentifiers.length === 0 ? "clean" : "no refused hits (identifier hits above are informational)";
  const lines = [
    denylistStatusLine({ load }),
    repositoryPrivateTermsStatusLine({ accepted, load: termsLoad }),
    ...hitSection({ heading: `hygiene: ${String(secrets.length)} SECRET hit(s) — these fail:`, hits: secrets }),
    ...hitSection({
      heading:
        `hygiene: ${String(refusedIdentifiers.length)} IDENTIFIER hit(s) — these fail ` +
        `(replace each with a synthetic stand-in, see AGENTS.md § "no organisation names in what you commit"):`,
      hits: refusedIdentifiers,
    }),
    ...privateTermReportSection({ hits: privateTermHits }),
    ...hitSection({
      heading:
        `hygiene: ${String(reportedIdentifiers.length)} identifier hit(s) — reported, NOT a failure ` +
        `(state belongs under $SLOPWEAVER_HOME, see AGENTS.md § "no secrets, ever"):`,
      hits: reportedIdentifiers,
    }),
    ...unreadable.map((path) => `  ${path}  (unreadable — NOT checked)`),
    ...(failing ? [] : [`hygiene: ${verdict} (${String(files.length)} files scanned)`]),
  ];
  if (termsLoad.kind !== "loaded") {
    return lines;
  }
  return printableReportLines({ lines, terms: termsLoad.terms });
}
