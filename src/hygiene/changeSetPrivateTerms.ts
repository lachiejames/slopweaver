/**
 * The private-terms verdict over a LANDING's change set: the files a merge would add or change, read as the exact
 * bytes of the tree it would produce, judged by the installation's private terms in the build running the landing
 * verb — never by the branch's own pre-push hook, which a branch cut before that hook learned the terms never ran.
 *
 * Pure: the git read is `../outbound/github/privateTermsSweep.ts`, the acknowledgement is the landing verb's. The
 * matching, the fresh-cut exemptions and the reviewed-residue binding are the repository scan's own
 * (`./repositoryPrivateTerms.ts`), so a line the pre-push scan accepts is accepted here and nothing else is.
 *
 * Three outcomes, and which is which is the design:
 *
 * - **hold** — a term stands on a changed line, or the terms file will not read or parse. Nothing acknowledges it.
 * - **unchecked** — the terms file is absent, or the change set could not be read whole. Never `clean`: the landing
 *   verb refuses it unless the caller names it, because a checkout with no terms file is the normal state of
 *   somebody else's fork and a hold there would stop every landing on a machine with nothing to scan for.
 * - **clean** — the terms loaded and no unaccepted match stands.
 *
 * Every line rendered here passes {@link printableReportLines} under the loaded terms, and a finding prints its
 * locus, line and class — never the matched text, and never a path a term matches or that carries a control
 * character, which prints as its place in the change set instead.
 */

import type { ReviewedResidueEntry } from "../freshCut/reviewedResidue.js";
import {
  type PrivateTerm,
  type PrivateTermClass,
  type PrivateTermsLoad,
  printableUnderTerms,
  privateTermsRefusal,
  privateTermsStatusLine,
} from "./privateTerms.js";
import {
  printableReportLines,
  privateTermHitsInFile,
  type RepositoryPrivateTermHit,
  unacceptedPrivateTermHits,
} from "./repositoryPrivateTerms.js";

/** One file the landing would add or change, as the exact bytes of the tree it would produce. */
export interface ChangeSetFile {
  readonly path: string;
  readonly bytes: Buffer;
}

/** One private-term finding that stands: where, which line and which class — never the matched text. */
interface ChangeSetPrivateTermHit {
  /** The path, or `(changed file N)` when the path itself is unprintable. */
  readonly locus: string;
  readonly line: number;
  readonly className: PrivateTermClass;
}

/**
 * The base a landing sweeps against: the commit it just fetched, or why it has none. An unfetched base still has
 * its terms loaded, so an unreadable terms file stays a hold and every line printed is judged against them.
 */
export type LandingBase =
  { readonly kind: "fetched"; readonly sha: string } | { readonly kind: "unfetched"; readonly detail: string };

/** The reviewed-residue list as the landing read it: its entries, or that it would not read (accepts nothing). */
export type ChangeSetResidue =
  { readonly kind: "read"; readonly entries: readonly ReviewedResidueEntry[] } | { readonly kind: "unreadable" };

/** What the private terms concluded about one change set. `terms` is what every printed line is judged against. */
export type ChangeSetPrivateTermsVerdict =
  | {
      readonly kind: "clean";
      readonly terms: readonly PrivateTerm[];
      readonly textFiles: number;
      readonly binaryFiles: number;
      readonly accepted: number;
    }
  | { readonly kind: "unchecked"; readonly terms: readonly PrivateTerm[]; readonly detail: string }
  | {
      readonly kind: "hold";
      readonly terms: readonly PrivateTerm[];
      readonly reasons: readonly string[];
      readonly hits: readonly ChangeSetPrivateTermHit[];
    };

/** Whether `path` holds a C0 control character or DEL: one could split or rewrite a printed line, so it never prints. */
function hasControlCharacter({ path }: { path: string }): boolean {
  // By UTF-16 code unit: every C0 character and DEL is one unit, and no unit of a surrogate pair falls in that range.
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Pure: the locus a finding in `path` prints under — the path, or its 1-based place in the change set when a private
 * term matches the path or it carries a control character.
 *
 * @param path the repository-relative path
 * @param paths every changed path, in the order the change set listed them
 * @param terms the loaded private terms
 * @returns the path, or `(changed file N)`
 */
export function changeSetLocus({
  path,
  paths,
  terms,
}: {
  path: string;
  paths: readonly string[];
  terms: readonly PrivateTerm[];
}): string {
  if (!hasControlCharacter({ path }) && printableUnderTerms({ line: path, terms }) === path) {
    return path;
  }
  return `(changed file ${String(paths.indexOf(path) + 1)})`;
}

/**
 * Pure: the verdict for a change set whose terms could not be judged at all — the tree was unreadable, the base was
 * never measured. Carries the loaded terms when there are any, so its lines are still judged against them.
 *
 * @param load the private-terms load outcome, when one was taken
 * @param detail what could not be read, in one clause
 * @returns the unchecked verdict
 */
export function uncheckedChangeSet({
  load,
  detail,
}: {
  load: PrivateTermsLoad | undefined;
  detail: string;
}): Extract<ChangeSetPrivateTermsVerdict, { kind: "unchecked" }> {
  return { detail, kind: "unchecked", terms: load?.kind === "loaded" ? load.terms : [] };
}

/** Every term hit in the change set's text files, the bytes of each file that has one, and how many were binary. */
function scanChangedFiles({ files, terms }: { files: readonly ChangeSetFile[]; terms: readonly PrivateTerm[] }): {
  binaryFiles: number;
  bytesByPath: Map<string, Buffer>;
  hits: RepositoryPrivateTermHit[];
} {
  const hits: RepositoryPrivateTermHit[] = [];
  const bytesByPath = new Map<string, Buffer>();
  let binaryFiles = 0;
  for (const file of files) {
    const content = file.bytes.toString("utf8");
    // The repository scan's own binary test (`./repoScan.ts`), so the two judge the same files.
    if (content.includes("\u0000")) {
      binaryFiles += 1;
      continue;
    }
    const inFile = privateTermHitsInFile({ content, path: file.path, terms });
    if (inFile.length > 0) {
      bytesByPath.set(file.path, file.bytes);
      hits.push(...inFile);
    }
  }
  return { binaryFiles, bytesByPath, hits };
}

/**
 * Pure: judge one change set against the private terms.
 *
 * @param load the private-terms load outcome, taken in the build running the landing verb
 * @param files every file the landing would add or change, deletions excluded, with the merged tree's bytes
 * @param residue the reviewed-residue list, or that it would not read
 * @returns `hold`, `unchecked` or `clean`
 */
export function judgeChangeSetPrivateTerms({
  load,
  files,
  residue,
}: {
  load: PrivateTermsLoad;
  files: readonly ChangeSetFile[];
  residue: ChangeSetResidue;
}): ChangeSetPrivateTermsVerdict {
  if (load.kind === "absent") {
    return uncheckedChangeSet({
      detail: `the private terms file is not present at ${load.path}, so no file this landing changes was checked for them`,
      load,
    });
  }
  if (load.kind !== "loaded") {
    return {
      hits: [],
      kind: "hold",
      reasons: [privateTermsStatusLine({ load }), privateTermsRefusal({ load })],
      terms: [],
    };
  }
  const { terms } = load;
  const { binaryFiles, bytesByPath, hits } = scanChangedFiles({ files, terms });
  const entries = residue.kind === "read" ? residue.entries : [];
  const { accepted, standing } = unacceptedPrivateTermHits({ bytesByPath, entries, hits });
  if (standing.length === 0) {
    return { accepted, binaryFiles, kind: "clean", terms, textFiles: files.length - binaryFiles };
  }
  const paths = files.map((file) => file.path);
  const residueNote =
    residue.kind === "unreadable"
      ? ["the reviewed-residue list could not be read, so no accepted line was set aside and every finding stands"]
      : [];
  return {
    hits: standing.map((hit) => ({
      className: hit.className,
      line: hit.line,
      locus: changeSetLocus({ path: hit.path, paths, terms }),
    })),
    kind: "hold",
    reasons: [
      `${String(standing.length)} private-term finding(s) stand on lines this landing would merge`,
      ...residueNote,
    ],
    terms,
  };
}

/**
 * Pure: the lines a landing verb prints for one verdict, before its own acknowledgement decision — each judged
 * against the loaded terms.
 *
 * @param verdict the change set's verdict
 * @returns the lines, without trailing newlines
 */
export function changeSetPrivateTermsLines({ verdict }: { verdict: ChangeSetPrivateTermsVerdict }): readonly string[] {
  const lines = linesOf({ verdict });
  return printableReportLines({ lines, terms: verdict.terms });
}

/** {@link changeSetPrivateTermsLines} before the terms judge them. */
function linesOf({ verdict }: { verdict: ChangeSetPrivateTermsVerdict }): readonly string[] {
  if (verdict.kind === "clean") {
    return [
      `private terms: applied to the ${String(verdict.textFiles)} changed text file(s) this landing would merge ` +
        `(${String(verdict.binaryFiles)} binary skipped, ${String(verdict.accepted)} accepted line(s) set aside) — ` +
        "none stands",
    ];
  }
  if (verdict.kind === "unchecked") {
    return [`private terms: NOT CHECKED — ${verdict.detail}`];
  }
  return [
    "private terms: HOLD — this landing is refused",
    ...verdict.reasons.map((reason) => `  ${reason}`),
    ...verdict.hits.map((hit) => `  ${hit.locus}:${String(hit.line)}: [private-term] ${hit.className}`),
    "private terms have no acknowledgement and no escape hatch: --acknowledge and --acknowledge-all do not reach " +
      "this hold. Reword each line named above (or repair the terms file), push, and land again; if a term is not " +
      "private, ask the chair to narrow that terms row.",
  ];
}
