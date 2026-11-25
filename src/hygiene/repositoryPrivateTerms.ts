/**
 * The private-terms half of the repository gate (`./repoScan.ts`): load the terms once, find every working-tree line
 * one matches, set aside the lines an owner-address reviewed-residue entry accepted, and render what is left as path,
 * line and class — never the matched text.
 *
 * - **Absent** (CI, a fresh checkout) applies nothing and says so: the outbound check refuses every write without the
 *   file, but this gate cannot, or every CI run would fail.
 * - **Unreadable or malformed** refuses before the tree is read, naming the file and, where there is one, the line and
 *   class, never a pattern.
 * - **Loaded**: every match counts except one the fresh cut forgives in the same file (`cutExemptionOf`,
 *   `../freshCut/core.ts`) and a line a reviewed-residue entry accepted, owner-anchored ones included, bound by its
 *   path and exact bytes (`matchReviewedResidueInWorkingTree`), so only a new line fails.
 *
 * A path a term matches prints as its place in the working-tree file list, and every report line is passed through
 * {@link printableUnderTerms}, so no wording the report builds can echo a term either.
 */
import { cutExemptionOf, type FreshCutFinding } from "../freshCut/core.js";
import type { ReviewedResidueEntry } from "../freshCut/reviewedResidue.js";
import { matchReviewedResidueInWorkingTree } from "../freshCut/reviewedResidueMatching.js";
import { readReviewedResidue } from "../freshCut/reviewedResidueStore.js";
import { privateTermHitsBeside } from "./privateTermMatches.js";
import {
  loadPrivateTerms,
  type PrivateTerm,
  type PrivateTermClass,
  type PrivateTermsLoad,
  printableUnderTerms,
  privateTermsRefusal,
  privateTermsStatusLine,
} from "./privateTerms.js";
import { denylistStatusLine, type LineListLoad, unreadableDenylistMessage } from "./scan.js";

/** One private-term finding in the working tree: where it is and what class matched, never the matched text. */
export interface RepositoryPrivateTermHit {
  readonly path: string;
  readonly line: number;
  readonly className: PrivateTermClass;
}

/** The terms a scan may apply: absent (applies none) or loaded. An unreadable or malformed file never gets here. */
export type ApplicablePrivateTerms = Extract<PrivateTermsLoad, { kind: "absent" | "loaded" }>;

/** The label a private-term finding prints under. Not a leak-class label: it carries a class, never an excerpt. */
const PRIVATE_TERM_LABEL = "private-term";

/**
 * Load the private terms for one repository scan. The terms load before anything else is printed, so every later
 * line — an unreadable denylist's path included — can be judged against them.
 *
 * @param home the state home the terms file lives under
 * @returns the applicable terms, or the lines that refuse the scan when the file will not load
 */
export function loadRepositoryPrivateTerms({
  home,
}: {
  home: string;
}): { readonly kind: "refused"; readonly lines: readonly string[] } | ApplicablePrivateTerms {
  const load = loadPrivateTerms({ home });
  if (load.kind === "unreadable" || load.kind === "invalid") {
    return {
      kind: "refused",
      lines: [repositoryPrivateTermsStatusLine({ accepted: 0, load }), privateTermsRefusal({ load })],
    };
  }
  return load;
}

/**
 * Pure: the terms an applicable load carries, none when the file is absent.
 *
 * @param load the applicable load
 * @returns the terms
 */
export function termsOf({ load }: { load: ApplicablePrivateTerms }): readonly PrivateTerm[] {
  return load.kind === "loaded" ? load.terms : [];
}

/**
 * Pure: every line of one working-tree file a private term matches, once per line and class, after the fresh cut's
 * own per-match exemptions for that file.
 *
 * @param content the file's text
 * @param path its repository-relative path, which decides the code-owner and owner-reference exemptions
 * @param terms the loaded private terms
 * @returns each finding in line order, carrying the path, line and class only
 */
export function privateTermHitsInFile({
  content,
  path,
  terms,
}: {
  content: string;
  path: string;
  terms: readonly PrivateTerm[];
}): readonly RepositoryPrivateTermHit[] {
  // No term, no match: skip computing the file's exemption spans, which CI and every absent-file run would pay per file.
  if (terms.length === 0) {
    return [];
  }
  const { hits } = privateTermHitsBeside({ exemptionOf: cutExemptionOf({ content, path }), terms, text: content });
  return hits.map(({ className, line }) => ({ className, line, path }));
}

/**
 * Pure: the private-term findings no entry of the reviewed-residue list accounts for, and how many it did, each entry
 * bound by its path and exact bytes ({@link matchReviewedResidueInWorkingTree}).
 *
 * @param hits every private-term finding, in report order
 * @param entries the reviewed-residue list, whole
 * @param bytesByPath each file a finding names, with the exact bytes the scan read
 * @returns the findings still standing, in report order, and the count set aside
 */
export function unacceptedPrivateTermHits({
  hits,
  entries,
  bytesByPath,
}: {
  hits: readonly RepositoryPrivateTermHit[];
  entries: readonly ReviewedResidueEntry[];
  bytesByPath: ReadonlyMap<string, Buffer>;
}): { readonly standing: readonly RepositoryPrivateTermHit[]; readonly accepted: number } {
  const findings = hits.map((hit): FreshCutFinding => ({ kind: "private-term", ...hit }));
  const files = [...bytesByPath].map(([path, bytes]) => ({ bytes, path }));
  const { matched } = matchReviewedResidueInWorkingTree({ entries, files, findings });
  return { accepted: matched.size, standing: hits.filter((_, index) => !matched.has(index)) };
}

/**
 * Read the reviewed-residue list and settle the scan's private-term findings against it: what the list accepted is
 * set aside, and every finding left is moved to its printable locus. A list that will not read sets nothing aside and
 * says so on stderr, judged against the terms.
 *
 * @param home the state home the list lives under
 * @param hits every private-term finding, in report order
 * @param bytesByPath each file a finding names, with the exact bytes the scan read
 * @param files every file the scan enumerated, in order
 * @param terms the loaded private terms
 * @returns the findings that fail, each at its printable locus, and the count set aside
 */
export function settleRepositoryPrivateTermHits({
  home,
  hits,
  bytesByPath,
  files,
  terms,
}: {
  home: string;
  hits: readonly RepositoryPrivateTermHit[];
  bytesByPath: ReadonlyMap<string, Buffer>;
  files: readonly string[];
  terms: readonly PrivateTerm[];
}): { readonly standing: readonly RepositoryPrivateTermHit[]; readonly accepted: number } {
  if (hits.length === 0) {
    return { accepted: 0, standing: [] };
  }
  const residue = readReviewedResidue({ home });
  if (residue.isErr()) {
    const line =
      `hygiene: the reviewed-residue list could not be read (${residue.error.message}) — no accepted line was set ` +
      "aside, so every private-term finding stands";
    process.stderr.write(`${printableUnderTerms({ line, terms })}\n`);
  }
  const entries = residue.isOk() ? residue.value.entries : [];
  const { accepted, standing } = unacceptedPrivateTermHits({ bytesByPath, entries, hits });
  return {
    accepted,
    standing: standing.map((hit) => ({ ...hit, path: privateTermLocus({ files, path: hit.path, terms }) })),
  };
}

/**
 * Pure: the locus a finding in `path` prints under — the path itself, or, when a private term matches the path, its
 * 1-based place in the working-tree file list, so the report names which file without spelling its name.
 *
 * @param path the repository-relative path
 * @param files every file the scan enumerated, in order
 * @param terms the loaded private terms
 * @returns the path, or `(working-tree file N)`
 */
export function privateTermLocus({
  path,
  files,
  terms,
}: {
  path: string;
  files: readonly string[];
  terms: readonly PrivateTerm[];
}): string {
  if (printableUnderTerms({ line: path, terms }) === path) {
    return path;
  }
  return `(working-tree file ${String(files.indexOf(path) + 1)})`;
}

/**
 * Pure: the one status line saying whether the private terms applied to THIS scan. Only the absent case differs from
 * {@link privateTermsStatusLine}: an outbound write refuses without the file, while this gate passes and says so.
 *
 * @param load the private-terms load outcome
 * @param accepted how many findings the reviewed-residue list set aside
 * @returns the line, without a trailing newline
 */
export function repositoryPrivateTermsStatusLine({
  load,
  accepted,
}: {
  load: PrivateTermsLoad;
  accepted: number;
}): string {
  if (load.kind === "absent") {
    return `hygiene: private terms NOT PRESENT at ${load.path} — not applied to this repository scan`;
  }
  if (load.kind !== "loaded" || load.terms.length === 0) {
    return privateTermsStatusLine({ load });
  }
  return `${privateTermsStatusLine({ load })}, ${String(accepted)} accepted line(s) set aside`;
}

/**
 * Pure: the report's PRIVATE TERM section — its heading, then each finding as locus, line and class — or nothing.
 *
 * @param hits the private-term findings that fail, each at its printable locus
 * @returns the lines, empty when there is no finding
 */
export function privateTermReportSection({ hits }: { hits: readonly RepositoryPrivateTermHit[] }): readonly string[] {
  if (hits.length === 0) {
    return [];
  }
  return [
    `hygiene: ${String(hits.length)} PRIVATE TERM hit(s) — these fail (reword the line, or ask the chair whether ` +
      "the terms row is too wide; the matched text is never printed):",
    ...hits.map((hit) => `  ${hit.path}:${String(hit.line)}: [${PRIVATE_TERM_LABEL}] ${hit.className}`),
  ];
}

/**
 * Pure: report lines as they may be printed — each one a loaded term matches is the withheld stand-in.
 *
 * @param lines the report, in order
 * @param terms the loaded private terms, none when the file is absent
 * @returns the lines, the same count
 */
export function printableReportLines({
  lines,
  terms,
}: {
  lines: readonly string[];
  terms: readonly PrivateTerm[];
}): readonly string[] {
  return lines.map((line) => printableUnderTerms({ line, terms }));
}

/**
 * Pure: what an unreadable denylist prints before the scan stops, each line judged against the loaded terms, so a
 * state-home path a term matches prints as the withheld stand-in.
 *
 * @param load the unreadable denylist outcome, which names its path
 * @param terms the private terms already loaded, empty when the file is absent
 * @returns the status line and the refusal, each printable
 */
export function unreadableDenylistLines({
  load,
  terms,
}: {
  load: Extract<LineListLoad, { kind: "unreadable" }>;
  terms: readonly PrivateTerm[];
}): readonly string[] {
  return printableReportLines({ lines: [denylistStatusLine({ load }), unreadableDenylistMessage({ load })], terms });
}
