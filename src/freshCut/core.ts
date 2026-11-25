/**
 * The pure half of a fresh cut: the fixed commit message, the shapes git answers in, the record a cut leaves, and
 * the scan of every file in it. No I/O here; `./produce.ts` and `./verify.ts` are the shells that run git.
 *
 * A fresh cut is ONE parentless commit over exactly the tree of a named `main` commit, written into a new local
 * repository so the repository can later be published with no history. What this module decides is what the cut
 * must look like and what a scan of it found; it never decides where anything is pushed, because nothing is.
 */
import { z } from "zod";
import {
  codeOwnerAccountRanges,
  ownAddressRanges,
  ownerReferenceRange,
  SOURCE_REPOSITORY,
} from "../hygiene/ownRepository.js";
import { privateTermHitsBeside } from "../hygiene/privateTermMatches.js";
import type { PrivateTerm, PrivateTermClass } from "../hygiene/privateTerms.js";
import { isRefusedHit, scanContent } from "../hygiene/scan.js";
import { err, ok, type Result } from "../lib/result.js";
import { type AcceptedOnAnchor, OWNER_ANCHORED_CLASSES } from "./anchoredAcceptance.js";

/** The one commit message every cut carries. Owner-agnostic on purpose: it names no person, place or date. */
export const FRESH_CUT_MESSAGE = "Initial commit";

/** The pseudo-path a finding in the LIST of file paths is reported under, since a path name is published too. */
export const PATH_LIST_LOCUS = "(file paths)";

/** A full or abbreviated hexadecimal object id: the only `--commit` a cut accepts, so no branch name resolves. */
const HEX_OBJECT_ID = /^[0-9a-f]{7,64}$/;

/** A full object id, SHA-1 or SHA-256. */
const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Pure: whether a `--commit` value is a hexadecimal object id rather than a ref name.
 *
 * @param given what the caller passed
 * @returns true for 7 to 64 lowercase hex characters
 */
export function isHexObjectId({ given }: { given: string }): boolean {
  return HEX_OBJECT_ID.test(given);
}

/** One entry of a recursive `git ls-tree -z` listing. */
export interface TreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
  readonly path: string;
}

/**
 * Pure: parse `git ls-tree -r -z --full-tree` output. NUL-terminated, so a path with a space or a newline in it
 * survives intact.
 *
 * @param output the command's stdout, exactly as git wrote it
 * @returns every entry in listing order, or the first record that does not parse
 */
export function parseTreeListing({ output }: { output: Buffer }): Result<readonly TreeEntry[], string> {
  const entries: TreeEntry[] = [];
  for (const record of output.toString("utf8").split("\u0000")) {
    if (record.length === 0) {
      continue;
    }
    const match = /^(\d{6}) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
    if (match === null) {
      return err(`unparseable ls-tree record ${JSON.stringify(record.slice(0, 80))}`);
    }
    entries.push({ mode: match[1]!, path: match[4]!, sha: match[3]!, type: match[2]! });
  }
  return ok(entries);
}

/**
 * Pure: the first submodule (gitlink) in a listing. Its files are in another repository, so a scan of this one
 * cannot cover them and the cut refuses rather than publishing a pointer to something unchecked.
 *
 * @param entries the tree listing
 * @returns the gitlink's path, or undefined when there is none
 */
export function firstGitlinkPath({ entries }: { entries: readonly TreeEntry[] }): string | undefined {
  return entries.find((entry) => entry.mode === "160000" || entry.type === "commit")?.path;
}

/**
 * Pure: a commit's committer date in git's internal `<epoch-seconds> <offset>` form, which `GIT_AUTHOR_DATE` and
 * `GIT_COMMITTER_DATE` accept verbatim. Reusing the source's own date is what makes a cut's root SHA reproducible.
 *
 * @param text `git show -s --date=raw --format=%cd` output, trailing newline allowed
 * @returns the date, or why the text is not one
 */
export function parseCommitDate({ text }: { text: string }): Result<string, string> {
  const trimmed = text.trim();
  return /^\d+ [+-]\d{4}$/.test(trimmed) ? ok(trimmed) : err(`unparseable committer date ${JSON.stringify(trimmed)}`);
}

/** What one produced cut is recorded as, under the state home. Carries the login only, never an address. */
export const freshCutRecordSchema = z
  .object({
    destination: z.string().startsWith("/"),
    login: z.string().min(1),
    producedAtIso: z.iso.datetime(),
    recordId: z.uuid(),
    rootSha: z.string().regex(FULL_OBJECT_ID),
    schemaVersion: z.literal(1),
    source: z.string().startsWith("/"),
    sourceCommitterDate: z.string().regex(/^\d+ [+-]\d{4}$/),
    sourceSha: z.string().regex(FULL_OBJECT_ID),
    treeSha: z.string().regex(FULL_OBJECT_ID),
  })
  .strict();

/** One produced cut's record. */
export type FreshCutRecord = z.infer<typeof freshCutRecordSchema>;

/** One thing a scan of the cut found. Never the matched text: the path, the line and what kind of match it was. */
export type FreshCutFinding =
  | { readonly kind: "hygiene"; readonly path: string; readonly line: number; readonly label: string }
  | {
      readonly kind: "private-term";
      readonly path: string;
      readonly line: number;
      readonly className: PrivateTermClass;
    };

/** One file of the cut, as the scan reads it. */
export interface CutFile {
  readonly path: string;
  readonly bytes: Buffer;
}

/**
 * Why one private-term match in the cut is not a finding. Closed, and decided per MATCH by its offsets, never by
 * narrowing a terms row: the row still refuses the same words anywhere else.
 *
 * - `own-address`: the match lies wholly inside an occurrence of {@link SOURCE_REPOSITORY}, this repository's own
 *   public address, with the repository-content edges the hygiene gate forgives it under, in any case; a recased one
 *   only for a row that matches the canonical spelling at the same span, the gate's own both-spellings grant.
 * - `code-owner`: the match lies wholly inside an `@owner` account field on a rule row of the code-owner file
 *   ({@link codeOwnerAccountRanges}), the one row the hygiene gate forgives there, under the same canonical test.
 * - `owner-reference`: the match lies wholly inside the README's one digest-pinned owner link
 *   ({@link ownerReferenceRange}), the owner's own ruling.
 * - `documentation-address`: the match is an IPv4 address in an RFC 5737 TEST-NET block or the placeholder
 *   `1.2.3.4`, judged on the whole run of digits and dots it sits in, so a real address a row's boundary cut short is
 *   never read as a documentation one.
 */
const CUT_EXEMPTION_REASONS = ["own-address", "code-owner", "owner-reference", "documentation-address"] as const;

/** One reason from {@link CUT_EXEMPTION_REASONS}. */
type CutExemptionReason = (typeof CUT_EXEMPTION_REASONS)[number];

/** How many private-term matches each reason exempted: every reason present, zero included. */
export type CutExemptionCounts = Readonly<Record<CutExemptionReason, number>>;

/** The RFC 5737 TEST-NET blocks, each a `/24`, by its first three octets. */
const DOCUMENTATION_NETWORKS = ["192.0.2.", "198.51.100.", "203.0.113."] as const;

/** The placeholder address documentation and tests write where any address would do. */
const PLACEHOLDER_ADDRESS = "1.2.3.4";

/** One decimal octet as written: no sign, no leading zero, at most three digits. */
const OCTET = /^(?:0|[1-9]\d{0,2})$/;

/** One character of a dotted-quad run. */
const QUAD_CHARACTER = /[0-9.]/;

/**
 * Pure: whether a dotted quad is a documentation address — inside a TEST-NET block, or exactly the placeholder.
 *
 * @param address the whole run of digits and dots, as written
 * @returns true only for four well-formed octets in one of those blocks, or the placeholder itself
 */
export function isDocumentationAddress({ address }: { address: string }): boolean {
  const octets = address.split(".");
  const wellFormed = octets.length === 4 && octets.every((octet) => OCTET.test(octet) && Number(octet) <= 255);
  if (!wellFormed) {
    return false;
  }
  return address === PLACEHOLDER_ADDRESS || DOCUMENTATION_NETWORKS.some((block) => address.startsWith(block));
}

/**
 * Pure: whether the match at `start`..`end` is a documentation address. Its digits and dots must be ONE run with
 * nothing alphanumeric beside them inside the match, and that run is then widened over the surrounding text, so a
 * row matching `1.2.3.4` inside `11.2.3.45` is judged on `11.2.3.45`. One trailing dot ends a sentence, not the
 * address.
 *
 * @param content the scanned text
 * @param start the match's first offset
 * @param end the offset just past the match
 * @returns true only when the widened run is a documentation address
 */
function isDocumentationAddressAt({ content, start, end }: { content: string; start: number; end: number }): boolean {
  const matched = content.slice(start, end);
  const run = /[0-9.]+/.exec(matched);
  if (run === null) {
    return false;
  }
  const outside = matched.slice(0, run.index) + matched.slice(run.index + run[0].length);
  if (/[A-Za-z0-9]/.test(outside)) {
    return false;
  }
  let from = start + run.index;
  let to = from + run[0].length;
  while (from > 0 && QUAD_CHARACTER.test(content[from - 1]!)) {
    from -= 1;
  }
  while (to < content.length && QUAD_CHARACTER.test(content[to]!)) {
    to += 1;
  }
  const widened = content.slice(from, to);
  return isDocumentationAddress({ address: widened.endsWith(".") ? widened.slice(0, -1) : widened });
}

/**
 * Pure: whether the row whose match is `start`..`end` would match the very same span with `span` respelled as
 * `canonical`. An exact-case occurrence is its own canonical spelling; a recased one is set aside only for a row that
 * also matches the canonical spelling, as the repository-content scanner grants only the kinds both spellings
 * produce, so a row written to catch the recased spelling alone still hits.
 *
 * @param content the scanned text
 * @param start the match's first offset
 * @param end the offset just past the match
 * @param re the row's pattern
 * @param span the occurrence the match lies wholly inside
 * @param canonical the canonical spelling of that occurrence, the same length
 * @returns true only when the row matches the respelled text at `start` and ends at `end`
 */
function matchesCanonical({
  content,
  start,
  end,
  re,
  span,
  canonical,
}: {
  content: string;
  start: number;
  end: number;
  re: RegExp;
  span: { readonly start: number; readonly end: number };
  canonical: string;
}): boolean {
  const respelled = content.slice(0, span.start) + canonical + content.slice(span.end);
  const sticky = new RegExp(re.source, `${re.flags.replace(/[gy]/g, "")}y`);
  sticky.lastIndex = start;
  const match = sticky.exec(respelled);
  return match !== null && match.index + match[0].length === end;
}

/**
 * Pure: the per-match exemption for one scanned text. The repository gate (`../hygiene/repoScan.ts`) asks this same
 * function of every working-tree file, so a line the cut publishes and the line the repository carries are forgiven
 * alike.
 *
 * @param content the scanned text
 * @param path the tree-relative path it was read from, or the path-list locus
 * @returns the reason a match at those offsets is exempt, or undefined when it counts
 */
export function cutExemptionOf({
  content,
  path,
}: {
  content: string;
  path: string;
}): (match: { readonly start: number; readonly end: number; readonly re: RegExp }) => CutExemptionReason | undefined {
  // The hygiene gate forgives a span of a file's CONTENT, never of its path, so the path list exempts nothing.
  if (path === PATH_LIST_LOCUS) {
    return () => undefined;
  }
  const addresses = ownAddressRanges({
    anyCase: true,
    content,
    edges: "repository-content",
    ownRepository: SOURCE_REPOSITORY,
  });
  const accounts = codeOwnerAccountRanges({ content, path });
  const owner = SOURCE_REPOSITORY.slice(0, SOURCE_REPOSITORY.indexOf("/"));
  const reference = ownerReferenceRange({ content, path });
  return ({ start, end, re }) => {
    const inside = ({ range }: { range: { readonly start: number; readonly end: number } }): boolean =>
      range.start <= start && end <= range.end;
    const address = addresses.find((range) => inside({ range }));
    if (
      address !== undefined &&
      matchesCanonical({ canonical: SOURCE_REPOSITORY, content, end, re, span: address, start })
    ) {
      return "own-address";
    }
    const account = accounts.find((range) => inside({ range }));
    if (account !== undefined && matchesCanonical({ canonical: `@${owner}`, content, end, re, span: account, start })) {
      return "code-owner";
    }
    if (reference !== undefined && reference.start <= start && end <= reference.end) {
      return "owner-reference";
    }
    if (isDocumentationAddressAt({ content, end, start })) {
      return "documentation-address";
    }
    return undefined;
  };
}

/**
 * Pure: every refused hygiene hit and every private-term hit in the cut, the list of file paths included, and how
 * many private-term matches each sanctioned exemption ({@link CUT_EXEMPTION_REASONS}) set aside.
 *
 * Every blob is read, a binary one too, its NUL bytes as line breaks: the repository gate skips a binary file, but a
 * publication carries every byte and a term inside an image is still published. Every private-term class applies,
 * `owner-address` included, with no destination forgiveness, because this text is about to stop being private; the
 * exemptions are per match and read file content only, never the path list, so the same words anywhere else, a path
 * included, still hit. A hygiene hit the gate only REPORTS (an
 * identifier it passes) is not a finding here either.
 *
 * @param files every file of the cut, with its bytes
 * @param denylist the private secret strings
 * @param privateTerms the installation's private terms, every class
 * @returns each finding, the path list's first, then path order and line order — never an excerpt, and never a path
 * that itself matches, which is named by its line in the path list instead — and the exemption counts
 */
export function scanCutFiles({
  files,
  denylist,
  privateTerms,
}: {
  files: readonly CutFile[];
  denylist: readonly string[];
  privateTerms: readonly PrivateTerm[];
}): { readonly findings: readonly FreshCutFinding[]; readonly exemptions: CutExemptionCounts } {
  const exemptions: Record<CutExemptionReason, number> = {
    "code-owner": 0,
    "documentation-address": 0,
    "own-address": 0,
    "owner-reference": 0,
  };
  const scan = ({ path, locus, text }: { path: string; locus: string; text: string }): readonly FreshCutFinding[] => {
    const terms = privateTermHitsBeside({
      exemptionOf: cutExemptionOf({ content: text, path }),
      terms: privateTerms,
      text,
    });
    for (const { reason } of terms.exempted) {
      exemptions[reason] += 1;
    }
    return [
      ...scanContent({ content: text, denylist, path })
        .filter((hit) => isRefusedHit({ label: hit.label }))
        .map((hit): FreshCutFinding => ({ kind: "hygiene", label: hit.label, line: hit.line, path: locus })),
      ...terms.hits.map((hit): FreshCutFinding => ({
        className: hit.className,
        kind: "private-term",
        line: hit.line,
        path: locus,
      })),
    ];
  };
  const pathList = files.map((file) => file.path).join("\n");
  const pathFindings = scan({ locus: PATH_LIST_LOCUS, path: PATH_LIST_LOCUS, text: pathList });
  // A path that is itself a match is never written out: its content findings name its line in the path list instead.
  // A git path may hold a newline, so a file spans one or more path-list lines and its first line is not its index.
  const withheldLines = new Set(pathFindings.map((finding) => finding.line));
  const firstLines: number[] = [];
  let nextLine = 1;
  for (const file of files) {
    firstLines.push(nextLine);
    nextLine += file.path.split("\n").length;
  }
  const contentFindings = files.flatMap((file, index) => {
    const first = firstLines[index]!;
    const spanned = Array.from({ length: file.path.split("\n").length }, (_, offset) => first + offset);
    const withheld = spanned.some((line) => withheldLines.has(line));
    return scan({
      locus: withheld ? `${PATH_LIST_LOCUS} line ${String(first)}` : file.path,
      path: file.path,
      text: file.bytes.toString("utf8").replaceAll("\u0000", "\n"),
    });
  });
  return { exemptions, findings: [...pathFindings, ...contentFindings] };
}

/**
 * A finished verification, as it is written to the state home. `findings` is what is left once the reviewed-residue
 * list took out `reviewedAccepted` of them; `reviewedResidueSha256` is the digest of the exact list bytes it used, so
 * the freeze audit can bind this report to the list it re-reads. `acceptedOnAnchor` is the share of
 * `reviewedAccepted` taken out on an owner anchor, by class, so a clear that rests on the owner's ruling reads as
 * that rather than as a cut with nothing in it.
 */
export interface FreshCutVerification {
  readonly schemaVersion: 3;
  readonly recordId: string;
  readonly verifiedAtIso: string;
  readonly status: "clear" | "refused";
  readonly sourceTreeSha: string;
  readonly destinationTreeSha: string;
  readonly filesScanned: number;
  readonly findings: readonly FreshCutFinding[];
  readonly exemptions: CutExemptionCounts;
  readonly reviewedAccepted: number;
  readonly acceptedOnAnchor: AcceptedOnAnchor;
  readonly reviewedResidueSha256: string;
}

/**
 * Pure: the lines a verification prints. Counts and the report's path only: the findings themselves stay in the
 * report under the state home, because a terminal is a transcript and a finding's path can itself be private.
 *
 * @param verification the finished verification
 * @param reportPath where its report was written
 * @param reviewedUnmatched the reviewed-residue entries that applied and took nothing out, which the report does not store
 * @returns the lines, without trailing newlines
 */
export function verificationLines({
  verification,
  reportPath,
  reviewedUnmatched,
}: {
  verification: FreshCutVerification;
  reportPath: string;
  reviewedUnmatched: number;
}): readonly string[] {
  const hygiene = verification.findings.filter((finding) => finding.kind === "hygiene").length;
  const privateTerm = verification.findings.length - hygiene;
  const exempted = CUT_EXEMPTION_REASONS.map((reason) => `${reason} ${String(verification.exemptions[reason])}`);
  const anchored = OWNER_ANCHORED_CLASSES.map(
    (className) => `${className} ${String(verification.acceptedOnAnchor[className])}`,
  );
  return [
    `fresh-cut verify: tree ${verification.sourceTreeSha} matches the record and the cut's root`,
    `fresh-cut verify: ${String(verification.filesScanned)} files scanned — ${String(hygiene)} hygiene finding(s), ${String(privateTerm)} private-term finding(s)`,
    `fresh-cut verify: private-term matches exempted — ${exempted.join(", ")}`,
    `fresh-cut verify: reviewed, accepted: ${String(verification.reviewedAccepted)}`,
    `fresh-cut verify: of those, accepted on an owner anchor — ${anchored.join(", ")}`,
    `fresh-cut verify: reviewed, unmatched: ${String(reviewedUnmatched)}`,
    `fresh-cut verify: ${verification.status.toUpperCase()} — report ${reportPath}`,
  ];
}
