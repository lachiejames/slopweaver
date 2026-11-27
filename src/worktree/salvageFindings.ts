/**
 * What a salvage scan FOUND in the texts it read, and the decline line that names it — split out of `./salvageScan`
 * (which reads what the push would send from git) along the seam between reading bytes and judging them. Every
 * function here is pure: it takes texts and scanners and answers hits or a line.
 *
 * A secret or identifier refusal names the class and the path, never the matched text, and withholds a path that
 * itself matches either scanner; an identifier scanner that threw is a refusal to LOOK, never a pass. A decline line
 * is printed to a terminal and a slot log, and quoting the secret or the organisation's name there would be the leak
 * this exists to stop.
 */
import type { IdentifierScanner } from "../hygiene/identifierScan.js";
import { type Hit, isRefusedHit, isSecretHit, scanContent } from "../hygiene/scan.js";

/** One text the scan reads: a blob's or a commit's bytes, a path list or the branch name, and where it came from. */
export interface SalvageText {
  readonly path: string;
  readonly content: string;
  readonly commit: boolean;
}

/** One forbidden-identifier hit a salvage refuses: the class it fired under and where, never the text. */
export interface SalvageIdentifierHit {
  readonly label: string;
  readonly path: string;
}

/**
 * Every SECRET in a set of blobs, attributed to the path each was found under.
 *
 * Pure. A BINARY blob is scanned too, its NUL bytes read as line breaks — stricter than the repository gate,
 * which skips a binary file, because a push publishes every byte and a token inside an image is still a token.
 * A false hit there costs a kept tree, never a leak. The bytes are read as UTF-8, as the gate
 * reads every file, so a secret stored compressed, encoded or as UTF-16 is the scanner's residue. An identifier hit
 * is {@link blobIdentifierHits}'s.
 *
 * @param blobs each blob's report path and text
 * @param denylist the private secret strings, loaded from the uncommitted home file
 * @returns the secret hits, in blob order
 */
export function blobSecretHits({
  blobs,
  denylist,
}: {
  blobs: readonly { readonly path: string; readonly content: string }[];
  denylist: readonly string[];
}): readonly Hit[] {
  return blobs
    .flatMap((blob) => scanContent({ content: blob.content.replaceAll("\u0000", "\n"), denylist, path: blob.path }))
    .filter((hit) => isSecretHit({ label: hit.label }));
}

/**
 * Every forbidden-identifier hit the repository gate would refuse, wherever `IDENTIFIER_VERDICT` reads `refuse`,
 * in what a salvage would push. Its destination is the public repository, so an uncommitted file naming an
 * organisation is exactly what that gate exists to stop.
 *
 * Pure. Scanned with the repository-content scanner the gate uses, binary blobs included as for secrets, and read
 * as UTF-8 the same way, so an identifier stored as UTF-16 is the scanner's residue too. A
 * COMMIT's message is scanned and its headers are not: the author and committer lines name a person on every
 * commit the public repository already carries, and the repository gate reads no commit either.
 *
 * @param texts each text and where it came from
 * @param identifiers the repository-content identifier scanner, one per run
 * @returns the refused hits, class and place only
 */
function blobIdentifierHits({
  texts,
  identifiers,
}: {
  texts: readonly SalvageText[];
  identifiers: IdentifierScanner;
}): readonly SalvageIdentifierHit[] {
  return texts.flatMap((text) => {
    const content = (text.commit ? commitMessage({ raw: text.content }) : text.content).replaceAll("\u0000", "\n");
    const labels = [
      ...scanContent({ content, denylist: [], path: text.path }).map((hit) => hit.label),
      ...identifiers.scan({ content, path: text.path }).map((hit) => hit.kind),
    ];
    return labels
      .filter((label) => !isSecretHit({ label }) && isRefusedHit({ label }))
      .map((label) => ({ label, path: text.path }));
  });
}

/**
 * A raw commit object's message: everything after the blank line that ends its headers, or nothing when it has none.
 *
 * @param raw the commit object's bytes as text
 * @returns the message
 */
function commitMessage({ raw }: { raw: string }): string {
  const end = raw.indexOf("\n\n");
  return end < 0 ? "" : raw.slice(end + 2);
}

/**
 * Every refused identifier hit in some texts, by {@link blobIdentifierHits}, or the decline for a scanner that threw:
 * a scan that did not happen is a decline, never a pass, as for every other read the salvage could not make.
 *
 * @param texts each text and where it came from
 * @param identifiers the repository-content identifier scanner
 * @returns the refused hits, or the decline reason
 */
export function identifierHitsOrDecline({
  texts,
  identifiers,
}: {
  texts: readonly SalvageText[];
  identifiers: IdentifierScanner;
}): readonly SalvageIdentifierHit[] | string {
  try {
    return blobIdentifierHits({ identifiers, texts });
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : "the scanner threw";
    return `what it would push could not be scanned for identifiers — ${why}; nothing was pushed`;
  }
}

/**
 * How a decline prints a path. A path is content too: a file NAMED like a token, or filed under a directory naming
 * the organisation, would otherwise print that name to the terminal and the slot log. A path the identifier scanner
 * could not judge is withheld as well, so a failed scan never prints what it could not check.
 *
 * @param path the path a hit was attributed to
 * @param denylist the private secret strings
 * @param identifiers the repository-content identifier scanner
 * @returns the path, or the words standing in for it
 */
function shownPath({
  path,
  denylist,
  identifiers,
}: {
  path: string;
  denylist: readonly string[];
  identifiers: IdentifierScanner;
}): string {
  if (scanContent({ content: path, denylist, path: "" }).some((hit) => isSecretHit({ label: hit.label }))) {
    return "a path that itself matches a secret pattern";
  }
  const named = identifierHitsOrDecline({ identifiers, texts: [{ commit: false, content: path, path: "" }] });
  if (typeof named === "string") {
    return "a path that could not be scanned for identifiers";
  }
  return named.length > 0 ? "a path that itself carries a forbidden identifier" : path;
}

/**
 * One decline line for a set of forbidden-identifier hits: each class and each place, and never the matched text.
 *
 * @param hits the refused hits, at least one
 * @param denylist the private secret strings, applied to each path before it is printed
 * @param identifiers the repository-content identifier scanner, applied to each path before it is printed
 * @returns the reason the salvage keeps the tree
 */
export function identifierDecline({
  hits,
  denylist,
  identifiers,
}: {
  hits: readonly SalvageIdentifierHit[];
  denylist: readonly string[];
  identifiers: IdentifierScanner;
}): string {
  const labels = [...new Set(hits.map((hit) => hit.label))].join(", ");
  const paths = [...new Set(hits.map((hit) => shownPath({ denylist, identifiers, path: hit.path })))].join(", ");
  return `the work it would push carries ${String(hits.length)} forbidden-identifier hit(s) (${labels}) in ${paths}, and the destination is public — nothing was pushed`;
}

/**
 * One decline line for a set of secret hits: each class and each file, and never the matched text.
 *
 * @param hits the secret hits, at least one
 * @param denylist the private secret strings, applied to each path before it is printed
 * @param identifiers the repository-content identifier scanner, applied to each path before it is printed
 * @returns the reason the salvage keeps the tree
 */
export function secretDecline({
  hits,
  denylist,
  identifiers,
}: {
  hits: readonly Hit[];
  denylist: readonly string[];
  identifiers: IdentifierScanner;
}): string {
  const labels = [...new Set(hits.map((hit) => hit.label))].join(", ");
  const paths = [...new Set(hits.map((hit) => shownPath({ denylist, identifiers, path: hit.path })))].join(", ");
  return `the work it would push carries ${String(hits.length)} secret-class line(s) (${labels}) in ${paths} — nothing was pushed`;
}
