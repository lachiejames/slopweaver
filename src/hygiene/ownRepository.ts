/**
 * The one address a scan may forgive although its owner is a forbidden identifier: a repository's OWN `owner/repo`.
 * Two callers, two policies, one budget mechanism.
 *
 * - **A pull request's metadata** (`../prformat/checkCore.ts`'s `scanPrMetadataLeaks`, through
 *   {@link identifierHitsBesideOwnRepository}) forgives the pull request's own repository, passed in by the caller from
 *   the CI event or the write door's target and never committed, with STRICT edges: a body names its repository
 *   in prose and links, so anything else that merely contains the address is not it.
 * - **Repository content** (`./identifierScanRun.ts` over the working tree, `./referenceTree.ts` over the archive the
 *   zero-references proof extracts, through {@link repositoryContentIdentifierScanner}) forgives
 *   {@link SOURCE_REPOSITORY} — this source tree's own public address, which `AGENTS.md` names as the repository's
 *   identity rather than any installation's — with the edges source text actually spells it in (a route path, an
 *   SSH remote, a comma-separated list), and the one code-owner row GitHub needs as a literal account. A committed
 *   constant, not the checkout's remote: a remote varies by environment, and the verdict must not.
 *
 * The fresh-cut verify (`../freshCut/core.ts`) reads the same two facts as SPANS rather than a budget — the
 * exact-case {@link SOURCE_REPOSITORY} occurrences through {@link ownAddressRanges} with the repository-content edges,
 * and the owner reference through {@link ownerReferenceRange} — because a private-term match carries its offsets.
 *
 * Two rules: the pull-request half does not refuse this repository's own address, and for the repository-content
 * half the codebase stops naming its owner while its address stays.
 *
 * The text is scanned AS WRITTEN, never altered first: blanking the owner before the scan was tried and hid every
 * identifier that merely touched it — a multi-word name ending in the owner, a location in the repository name. So
 * each line instead gives up, per own-address occurrence on it, exactly the hits the bare owner produces when scanned
 * alone — counted by kind, so an owner such as `foo-bar` whose two halves each hit gives up both — and nothing else.
 * The residue, stated: a hit of the SAME kind elsewhere on that line that the owner-in-address did not itself produce
 * could be the one removed — the scanner reports no span to tell them apart, and the owner's own delimiters make its
 * in-address hits those it produces alone.
 *
 * ## The one owner reference
 *
 * One exception names the owner, and it is the owner's own ruling: {@link OWNER_REFERENCE_PATH}, the README, may
 * carry ONE markdown link to the owner's profile in its "Is it safe?" fold, where readers check who built it. It is
 * pinned by the SHA-256 of the link's exact text, as the rules are, so this file never spells what it forgives. A
 * different label or target hashes differently, a second copy is not forgiven, the same text where GFM would not
 * render a link (code, HTML, an image, an escape, another link) is not it, and the same link in any other file is refused as before. It gives up only the hits the link produces scanned alone, on its own line, with the residue
 * above.
 */

import { parse, postprocess, preprocess } from "micromark";
import { gfm } from "micromark-extension-gfm";
import {
  type ForbiddenIdentifierRules,
  type IdentifierHit,
  type IdentifierScanner,
  identifierDigest,
  identifierScanner,
} from "./identifierScan.js";

/** This source tree's own public `owner/repo` — the repository's identity, which stays in what it commits. */
export const SOURCE_REPOSITORY = "lachiejames/slopweaver";

/** The tree-relative path of the one file whose account rows GitHub reads as literal accounts. */
export const CODE_OWNERS_PATH = ".github/CODEOWNERS";

/** The tree-relative path of the one file that may name its owner, once: see "The one owner reference" above. */
export const OWNER_REFERENCE_PATH = "README.md";

/** The SHA-256 of the one owner reference's exact text, a markdown link from the owner's name to their profile. */
export const OWNER_REFERENCE_DIGEST = "cac118f4c2a2bea5e3a65a6e46aaa913ac6dbca9e2c5e8682a20e500cfd39a86";

/** A markdown link on one line: each one is a candidate for the owner reference, which its digest then decides. */
const MARKDOWN_LINK = /\[[^\]\n]+\]\([^)\s]+\)/g;

/** A GitHub `owner/repo` slug: the only shape an own-repository exemption will accept. */
const REPOSITORY_SLUG = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** Which edges an address occurrence must have to be the repository rather than a text merely containing it. */
export type AddressEdges = "pull-request" | "repository-content";

/**
 * Every forbidden-identifier hit in `content` except those its OWN repository slug's owner accounts for, with the
 * pull-request edges. Pure.
 *
 * @param content the title or body text
 * @param path the identity to report a hit under
 * @param rules the forbidden-identifier rules
 * @param ownRepository the pull request's own `owner/repo`, or undefined where none is known
 * @param wholeAddress forgive what the WHOLE `owner/repo` produces per occurrence, the repository name's own hits
 *   included, rather than the owner's alone. Only the write door asks for it, and only on an installation's own
 *   repository (`./installationIdentifiers.ts`), where that name is the installation's own; CI never does
 * @returns the hits the identifier half counts; every hit when there is no well-formed slug
 */
export function identifierHitsBesideOwnRepository({
  content,
  path,
  rules,
  ownRepository,
  wholeAddress = false,
}: {
  content: string;
  path: string;
  rules: ForbiddenIdentifierRules;
  ownRepository: string | undefined;
  wholeAddress?: boolean;
}): readonly IdentifierHit[] {
  return identifierScannerBesideOwnRepository({ edges: "pull-request", ownRepository, rules, wholeAddress }).scan({
    content,
    path,
  });
}

/**
 * Where `ownRepository` occurs in `content` with the chosen edges and EXACTLY its canonical case: the occurrences
 * whose every hit the whole-address forgiveness grants, because their written text is the slug itself. A recased
 * occurrence is left out, since it grants only the kinds both spellings share. Pure.
 *
 * @param content the title or body text, or a committed file's text
 * @param ownRepository the pull request's own `owner/repo`, or undefined where none is known
 * @param edges the pull-request edges by default; the repository-content edges for committed text, where a trailing
 *   `.git` is part of the occurrence (`../freshCut/core.ts` asks for these over {@link SOURCE_REPOSITORY})
 * @param anyCase keep a recased occurrence too, as the repository-content scanner forgives one; a caller taking it
 *   must still grant only what the canonical spelling would, as `../freshCut/core.ts` does per match
 * @returns each occurrence's start and end offsets, in order, the slug's own characters only; none when there is no
 *   well-formed slug
 */
export function ownAddressRanges({
  content,
  ownRepository,
  edges = "pull-request",
  anyCase = false,
}: {
  content: string;
  ownRepository: string | undefined;
  edges?: AddressEdges;
  anyCase?: boolean;
}): readonly { readonly start: number; readonly end: number }[] {
  if (ownRepository === undefined || !REPOSITORY_SLUG.test(ownRepository)) {
    return [];
  }
  return [...content.matchAll(ownAddressPattern({ edges, ownRepository }))]
    .filter((match) => anyCase || match[0].slice(0, ownRepository.length) === ownRepository)
    .map((match) => ({ end: match.index + ownRepository.length, start: match.index }));
}

/**
 * Where {@link SOURCE_REPOSITORY}'s owner appears as an `@account` token on a code-owner rule row of
 * {@link CODE_OWNERS_PATH} — exactly the tokens the repository-content scanner forgives there. Any other path has
 * none. Pure.
 *
 * @param content the file's text
 * @param path the file's tree-relative path
 * @returns each token's start and end offsets, in order
 */
export function codeOwnerAccountRanges({
  content,
  path,
}: {
  content: string;
  path: string;
}): readonly { readonly start: number; readonly end: number }[] {
  if (path !== CODE_OWNERS_PATH) {
    return [];
  }
  return codeOwnerAccountSpans({ content, owner: SOURCE_REPOSITORY.slice(0, SOURCE_REPOSITORY.indexOf("/")) });
}

/**
 * Where the one owner reference sits in a file: the first markdown link in {@link OWNER_REFERENCE_PATH} whose exact
 * text hashes to {@link OWNER_REFERENCE_DIGEST} and that GFM renders as a link. Any other path has none. Pure.
 *
 * @param content the file's text
 * @param path the file's tree-relative path
 * @returns the link's start and end offsets, or undefined when the file carries no rendered owner reference
 */
export function ownerReferenceRange({
  content,
  path,
}: {
  content: string;
  path: string;
}): { readonly start: number; readonly end: number } | undefined {
  if (path !== OWNER_REFERENCE_PATH) {
    return undefined;
  }
  const reference = [...content.matchAll(MARKDOWN_LINK)].find(
    (match) =>
      identifierDigest({ text: match[0] }) === OWNER_REFERENCE_DIGEST &&
      rendersAsLink({ content, length: match[0].length, offset: match.index }),
  );
  if (reference === undefined) {
    return undefined;
  }
  return { end: reference.index + reference[0].length, start: reference.index };
}

/**
 * A scanner over committed repository content: every forbidden-identifier hit except those {@link SOURCE_REPOSITORY}'s
 * owner accounts for inside an occurrence of that address, the owner's account token on a code-owner row of
 * {@link CODE_OWNERS_PATH}, and the one owner reference in {@link OWNER_REFERENCE_PATH}. Keep one per run: its
 * candidate caches are the underlying scanner's.
 *
 * @param rules the forbidden-identifier rules
 * @returns the scanner
 */
export function repositoryContentIdentifierScanner({ rules }: { rules: ForbiddenIdentifierRules }): IdentifierScanner {
  return identifierScannerBesideOwnRepository({ edges: "repository-content", ownRepository: SOURCE_REPOSITORY, rules });
}

/**
 * Bind one scanner that forgives an own repository's owner, compiling the rules and the owner's own hit kinds once.
 * The forgiveness is the gate's `scan` only: `spans` is the base scanner's, unforgiven, because a span is what a
 * redaction masks and an own address is no exception there.
 *
 * @param edges which occurrence edges count as the address, and whether the code-owner row is forgiven
 * @param ownRepository the `owner/repo` to forgive, or undefined to forgive nothing
 * @param rules the forbidden-identifier rules
 * @param wholeAddress whether an occurrence gives up the whole address's own hits rather than the owner's alone
 * @returns the scanner
 */
function identifierScannerBesideOwnRepository({
  edges,
  ownRepository,
  rules,
  wholeAddress = false,
}: {
  edges: AddressEdges;
  ownRepository: string | undefined;
  rules: ForbiddenIdentifierRules;
  wholeAddress?: boolean;
}): IdentifierScanner {
  const base = identifierScanner({ rules });
  if (ownRepository === undefined || !REPOSITORY_SLUG.test(ownRepository)) {
    return base;
  }
  const owner = ownRepository.slice(0, ownRepository.indexOf("/"));
  const accountKinds = base.scan({ content: `@${owner}`, path: "" }).map(({ kind }) => kind);
  const address = ownAddressPattern({ edges, ownRepository });
  const forgivenOf = ({ text }: { text: string }): string => (wholeAddress ? text : text.slice(0, text.indexOf("/")));
  const canonicalKinds = base.scan({ content: forgivenOf({ text: ownRepository }), path: "" }).map(({ kind }) => kind);
  const occurrenceKinds = new Map<string, readonly string[]>();
  // The address matches case-insensitively, so an occurrence grants only the kinds BOTH its text as written and the
  // canonical slug produce: the written text alone would forgive a case-sensitive name the slug never carries, and
  // the slug alone would spend an allowance the occurrence never used on a name outside it.
  const kindsOf = ({ written }: { written: string }): readonly string[] => {
    const forgiven = forgivenOf({ text: written });
    const known = occurrenceKinds.get(forgiven);
    if (known !== undefined) {
      return known;
    }
    const kinds = commonKinds({
      left: canonicalKinds,
      right: base.scan({ content: forgiven, path: "" }).map(({ kind }) => kind),
    });
    occurrenceKinds.set(forgiven, kinds);
    return kinds;
  };
  return {
    scan: ({ content, path }) => {
      const hits = base.scan({ content, path });
      if (hits.length === 0) {
        return hits;
      }
      const budget = new Map<string, number>();
      for (const match of content.matchAll(address)) {
        const line = lineOf({ content, offset: match.index });
        grant({ budget, kinds: kindsOf({ written: match[0] }), line });
      }
      if (edges === "repository-content") {
        grantPathRows({ accountKinds, base, budget, content, owner, path });
      }
      return spend({ budget, hits });
    },
    spans: base.spans,
  };
}

/**
 * Grant what one repository-content path forgives by name: the owner's account on a code-owner rule row, and the
 * one owner reference in the README. Any other path grants nothing here.
 *
 * @param accountKinds the kinds the owner's `@account` produces on its own
 * @param base the unforgiving scanner the reference's own kinds are read from
 * @param budget the per-`line:kind` allowance, mutated
 * @param content the scanned file's text
 * @param owner the source repository's owner
 * @param path the scanned file's repository-relative path
 */
function grantPathRows({
  accountKinds,
  base,
  budget,
  content,
  owner,
  path,
}: {
  accountKinds: readonly string[];
  base: IdentifierScanner;
  budget: Map<string, number>;
  content: string;
  owner: string;
  path: string;
}): void {
  if (path === CODE_OWNERS_PATH) {
    for (const line of codeOwnerAccountLines({ content, owner })) {
      grant({ budget, kinds: accountKinds, line });
    }
  }
  if (path === OWNER_REFERENCE_PATH) {
    grantOwnerReference({ base, budget, content });
  }
}

/**
 * The kinds two scans share, a kind repeated as often as the scan with fewer of it repeats it.
 *
 * @param left one scan's kinds, a kind repeated once per hit
 * @param right the other scan's kinds
 * @returns the multiset intersection, in `left`'s order
 */
function commonKinds({ left, right }: { left: readonly string[]; right: readonly string[] }): readonly string[] {
  const remaining = new Map<string, number>();
  for (const kind of right) {
    const held = remaining.get(kind);
    remaining.set(kind, held === undefined ? 1 : held + 1);
  }
  return left.filter((kind) => {
    const held = remaining.get(kind);
    if (held === undefined || held === 0) {
      return false;
    }
    remaining.set(kind, held - 1);
    return true;
  });
}

/**
 * Add one forgiven hit per kind to a line's budget.
 *
 * @param budget the per-`line:kind` allowance, mutated
 * @param kinds the kinds one occurrence produces, a kind repeated once per hit
 * @param line the 1-based line the occurrence is on
 */
function grant({ budget, kinds, line }: { budget: Map<string, number>; kinds: readonly string[]; line: number }): void {
  for (const kind of kinds) {
    const key = `${String(line)}:${kind}`;
    const held = budget.get(key);
    budget.set(key, held === undefined ? 1 : held + 1);
  }
}

/**
 * The hits a budget does not forgive, in order.
 *
 * @param budget the per-`line:kind` allowance, consumed
 * @param hits every hit the scanner found
 * @returns the hits left counting
 */
function spend({
  budget,
  hits,
}: {
  budget: Map<string, number>;
  hits: readonly IdentifierHit[];
}): readonly IdentifierHit[] {
  return hits.filter(({ kind, line }) => {
    const key = `${String(line)}:${kind}`;
    const left = budget.get(key);
    if (left === undefined || left === 0) {
      return true;
    }
    budget.set(key, left - 1);
    return false;
  });
}

/**
 * The pattern matching every whole occurrence of `ownRepository`, global and case-insensitive.
 *
 * Pull-request edges are ALLOW-lists: on the left a line start, a space, an opening bracket or quote, or a
 * `github.com/` host that itself follows one (with an optional `https://` and `www.`); on the right the text's end,
 * a space, a closing bracket or quote, or `/ # @ , ; : ? !`. So `other/owner/repo`, `x.github.com/owner/repo` and
 * `owner/repo.v2` are not this address, and a sentence ending on it (`owner/repo.`) is not either.
 *
 * Repository-content edges are a DENY-list, because source spells its own address inside a route
 * (`/pull-requests/owner/repo/1`), an SSH remote (`git@github.com:owner/repo.git`) and a list (`a/b,owner/repo`): on
 * the left anything but a name character (`A-Z a-z 0-9 _ . -`), on the right anything but a name character, an
 * optional `.git` excepted, and a `.` that ends a sentence. So `xowner/repo`, `owner/repo-extra` and `owner/repo.v2`
 * still are not it.
 *
 * @param edges which edge policy applies
 * @param ownRepository a well-formed `owner/repo`
 * @returns the pattern
 */
function ownAddressPattern({ edges, ownRepository }: { edges: AddressEdges; ownRepository: string }): RegExp {
  const escaped = ownRepository.replace(/[.\\/-]/g, "\\$&");
  if (edges === "pull-request") {
    const tokenStart = String.raw`(?:^|[\s(<\["'\x60])`;
    const githubHost = String.raw`(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?`;
    const tokenEnd = String.raw`(?=$|[\s)>\]"'\x60/#@,;:?!])`;
    return new RegExp(`(?<=${tokenStart}${githubHost})${escaped}${tokenEnd}`, "gim");
  }
  const nameChar = String.raw`[A-Za-z0-9_.-]`;
  const nameCharNoDot = String.raw`[A-Za-z0-9_-]`;
  return new RegExp(`(?<!${nameChar})${escaped}(?:\\.git)?(?!${nameCharNoDot}|\\.${nameCharNoDot})`, "gi");
}

/**
 * The 1-based line of every `@<owner>` account token on a code-owner rule row: a line that is not a comment, the
 * token a whole whitespace-separated field after the path pattern and before any inline comment. A mention in a
 * comment, a longer handle and the owner without its `@` are not one.
 *
 * @param content the code-owner file's text
 * @param owner the repository's owner account
 * @returns the lines, one entry per account token
 */
function codeOwnerAccountLines({ content, owner }: { content: string; owner: string }): readonly number[] {
  return codeOwnerAccountSpans({ content, owner }).map(({ start }) => lineOf({ content, offset: start }));
}

/**
 * The offsets of every `@<owner>` account token on a code-owner rule row, by the same reading as
 * {@link codeOwnerAccountLines}: not a comment line, a whole field after the path pattern, before any inline comment,
 * compared case-insensitively.
 *
 * @param content the code-owner file's text
 * @param owner the repository's owner account
 * @returns each token's start and end offsets, in order
 */
function codeOwnerAccountSpans({
  content,
  owner,
}: {
  content: string;
  owner: string;
}): readonly { readonly start: number; readonly end: number }[] {
  const account = `@${owner}`.toLowerCase();
  const spans: { start: number; end: number }[] = [];
  let lineStart = 0;
  for (const raw of content.split("\n")) {
    const rule = raw.split(/\s#/)[0]!;
    if (rule.trim() !== "" && !rule.trim().startsWith("#")) {
      const fields = [...rule.matchAll(/\S+/g)].slice(1);
      for (const field of fields.filter((each) => each[0].toLowerCase() === account)) {
        spans.push({ end: lineStart + field.index + field[0].length, start: lineStart + field.index });
      }
    }
    lineStart += raw.length + 1;
  }
  return spans;
}

/**
 * The 1-based line holding a character offset.
 *
 * @param content the text
 * @param offset an offset into it
 * @returns the line number
 */
function lineOf({ content, offset }: { content: string; offset: number }): number {
  return content.slice(0, offset).split("\n").length;
}

/**
 * Add the hits the first rendered owner reference produces on its own to its line's budget; nothing when the file has
 * none. Only the first: a second copy is not forgiven.
 *
 * @param base the unforgiving scanner, which says what the reference alone produces
 * @param budget the per-`line:kind` allowance, mutated
 * @param content the whole README
 */
function grantOwnerReference({
  base,
  budget,
  content,
}: {
  base: IdentifierScanner;
  budget: Map<string, number>;
  content: string;
}): void {
  const reference = ownerReferenceRange({ content, path: OWNER_REFERENCE_PATH });
  if (reference === undefined) {
    return;
  }
  const kinds = base.scan({ content: content.slice(reference.start, reference.end), path: "" }).map(({ kind }) => kind);
  grant({ budget, kinds, line: lineOf({ content, offset: reference.start }) });
}

/** A line that opens or closes a fenced code block. */
const CODE_FENCE = /^ {0,3}(?:```|~~~)/;

/**
 * Whether the markdown link at `offset` renders as a link. Two conjuncts, so the second can only ever refuse more:
 * the line-local reading (no `!` or `\` before it, an even backtick count before it on its line, an even count of
 * fence lines before it), AND a GFM parse placing a `link` token on exactly that source range with no `image`
 * around it. The parse is what closes a double-backtick span, a span opened on an earlier line, indented code, a raw
 * HTML block or comment, an attribute value, a fence a shorter or different run cannot close, and a link nested in an
 * image's description or in another link. The residue: GitHub's `$` math, which GFM does not model.
 *
 * @param content the whole file
 * @param offset where the link's opening bracket is
 * @param length the link text's length, so the token must cover exactly it
 * @returns false wherever markdown would show the text rather than a link
 */
function rendersAsLink({ content, length, offset }: { content: string; length: number; offset: number }): boolean {
  const lineStart = content.lastIndexOf("\n", offset - 1) + 1;
  const before = content.slice(lineStart, offset);
  const backticks = before.split("`").length - 1;
  const fences = content
    .slice(0, lineStart)
    .split("\n")
    .filter((line) => CODE_FENCE.test(line)).length;
  const lineLocal = !before.endsWith("!") && !before.endsWith("\\") && backticks % 2 === 0 && fences % 2 === 0;
  return lineLocal && parsedAsLink({ content, end: offset + length, start: offset });
}

/**
 * Whether a GFM parse of `content` enters a `link` token spanning exactly `start` to `end`, with no `image` token
 * enclosing that range: a link in an image's description renders as alt text, not an anchor.
 *
 * @param content the whole file
 * @param start the range's first offset
 * @param end the offset just past the range
 * @returns true only for a rendered link on exactly that range
 */
function parsedAsLink({ content, end, start }: { content: string; end: number; start: number }): boolean {
  const events = postprocess(
    parse({ extensions: [gfm()] })
      .document()
      .write(preprocess()(content, undefined, true)),
  );
  const entered = events.filter(([kind]) => kind === "enter").map(([, token]) => token);
  const exact = entered.some(
    (token) => token.type === "link" && token.start.offset === start && token.end.offset === end,
  );
  const inImage = entered.some(
    (token) => token.type === "image" && token.start.offset <= start && token.end.offset >= end,
  );
  return exact && !inImage;
}
