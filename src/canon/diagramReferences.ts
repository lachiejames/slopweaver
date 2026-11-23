/**
 * The diagram-label sweep — what keeps a picture true as the code moves under it.
 *
 * ## The defect this exists for
 *
 * A diagram is the most confident thing in a repository and the least checked. `docs/diagrams/*.mmd` earn
 * their place by naming, in every box, either a real module (`src/live/turn/brief.ts`) or a real verb
 * (`slopweaver turn brief`) — so a reader can jump from the picture to the code. The moment a module moves
 * or a verb is renamed, every box naming the old shape becomes a lie drawn in a box, which reads as more
 * authoritative than the same lie in prose. Nothing else in the toolchain looks inside a `.mmd` file.
 *
 * ## It resolves nothing itself, deliberately
 *
 * `./staleReferences.ts` already owns every resolution rule this needs — a `slopweaver …` fragment against
 * the live CLI manifest (noun, then verb, then each `--flag` against that verb's own advertised usage), and
 * a repo path against the filesystem. Reimplementing those here would be two checkers with one job and a
 * first disagreement nobody could adjudicate. So this module does the ONE thing that file cannot: pull the
 * references out of Mermaid, where they are bare label text rather than the backticked spans and fenced
 * `bash` lines a canon `.md` uses. It then hands each one to {@link scanCanonFile} in the syntax that
 * scanner already reads.
 *
 * ## Why the extraction is narrow
 *
 * A Mermaid label is free text, so anything looser would flag ordinary English. Two shapes are extracted and
 * no others:
 *
 *  - a token rooted at one of this repository's own top-level directories, up to the first character no path
 *    may hold — which is what stops `src/admit/door.ts<br/>` yielding the `<br/>` and stops a label's
 *    trailing full stop becoming part of a filename;
 *  - `slopweaver` followed by one or two literal lowercase words, which is exactly the noun-then-verb address
 *    the manifest can resolve. A third word is prose, and `slopweaver` alone names no address, so both are
 *    left alone.
 *
 * Everything downstream of that — including "is this flag advertised" — is the existing scanner's answer,
 * not this file's.
 *
 * Pure: no filesystem, no manifest import. Both are caller-supplied seams, so this is unit-tested on inline
 * fixtures exactly like the sweep it delegates to.
 */

import { type StaleOffender, scanCanonFile, type VerbAddress } from "./staleReferences.js";

/**
 * A path token rooted at one of this repository's own top-level directories. The character class is the
 * same one `staleReferences.ts` accepts as path-like, so a token this extracts is always one that file can
 * resolve; the boundary stops it at a `<` (Mermaid's own `<br/>`), a quote, or whitespace.
 */
const DIAGRAM_PATH = /(?:src|docs|hooks|scripts|skills|eval|bin|stubs|templates)\/[A-Za-z0-9_./-]*[A-Za-z0-9_/-]/g;

/** `slopweaver` plus the one or two literal lowercase words that make up a noun-then-verb address. */
const DIAGRAM_INVOCATION = /slopweaver(?: [a-z][a-z0-9-]*){1,2}/g;

/**
 * Every checkable reference a diagram's labels make, deduplicated and in a stable order — the paths first,
 * then the invocations.
 *
 * @param content the raw Mermaid source
 * @returns each reference exactly as written, ready to resolve
 */
export function diagramReferences({ content }: { content: string }): readonly string[] {
  // `matchAll` answers a label with no reference as no matches, never as an absent result.
  const paths = [...new Set(Array.from(content.matchAll(DIAGRAM_PATH), (match) => match[0]))].toSorted();
  const invocations = [...new Set(Array.from(content.matchAll(DIAGRAM_INVOCATION), (match) => match[0]))].toSorted();
  return [...paths, ...invocations];
}

/**
 * Every reference in one diagram that does not resolve against the live repository, reported in exactly the
 * shape `staleReferences.ts` reports a canon file's — because it IS that scanner, fed the diagram's labels
 * re-spelled as the backticked spans it already reads.
 *
 * @param path the diagram's repo-relative path, for reporting
 * @param content the raw Mermaid source
 * @param addresses the live CLI address list to resolve invocations against
 * @param pathExists resolves whether a repo-relative path exists
 * @returns every offending reference
 */
export function scanDiagramFile({
  path,
  content,
  addresses,
  pathExists,
}: {
  path: string;
  content: string;
  addresses: readonly VerbAddress[];
  pathExists: (args: { path: string }) => boolean;
}): readonly StaleOffender[] {
  const spans = diagramReferences({ content })
    .map((reference) => `\`${reference}\``)
    .join("\n");
  return scanCanonFile({ addresses, content: spans, path, pathExists });
}
