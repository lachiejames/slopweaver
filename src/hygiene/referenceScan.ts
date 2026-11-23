/**
 * The zero-references scan — pure. Given one file of an exported tree, it names every place an installation's
 * own organisation is referenced, directly or indirectly, by CLASS, and never returns the matched text.
 *
 * Three sources feed one hit shape, so a reader sees a single count per class rather than three reports, and
 * each class is qualified by its source so a map class can never collide with a committed label:
 *
 * - `map:` — the reference MAP: the installation's own names as regular expressions, each row carrying its class
 *   (`people`, `hosts`, `self-reference`, `owner`, …). It is read from `$SLOPWEAVER_HOME`, never git, because a
 *   list of the names a scan looks for is itself a list of those names. Parsed by `./referenceMap.ts`.
 * - `gate:` — the hygiene gate's hashed rules (`./identifierScan.ts`), one class per kind.
 * - `leak:` — the gate's leak classes (`./scan.ts`): a workspace id the gate cannot tell from a real one, an
 *   id-labelled query value, a credential shape, a denylist word. Two labels are not references: a synthetic
 *   workspace id is the synthetic organisation's own, and an absolute home path is a placeholder
 *   (`/Users/someone`) far more often than a person — MEASURED, every one of the 25 commonest on
 *   main a placeholder (`git grep -h -o -P "/(?:Users|home)/[A-Za-z0-9._-]+" main | sort | uniq -c | sort -rn`),
 *   and a real home directory names its owner, which the map's `owner` rows already count.
 *
 * A file's PATH is scanned as well as its content, at line 0: in a zip handed to an outsider, a name in a file
 * name is as much a reference as one inside it. Every byte of every file is scanned, a binary one included —
 * an image's metadata can carry a name as well as a text file can.
 */
import { IDENTIFIER_KINDS, type IdentifierKind, type IdentifierScanner } from "./identifierScan.js";
import type { ReferenceMapRow } from "./referenceMap.js";
import { LEAK_LABELS, SYNTHETIC_WORKSPACE_ID_LABEL, scanContent } from "./scan.js";

/** The leak labels that are not a reference to anybody: see this module's header. */
const NOT_A_REFERENCE: ReadonlySet<string> = new Set([SYNTHETIC_WORKSPACE_ID_LABEL, "absolute-home-path"]);

/** Where a hit came from: the off-repo map, the gate's hashed rules, or a leak class. */
type ReferenceSource = "map" | "gate" | "leak";

/** One reference: a file, a line (0 for the path itself) and a qualified class. Deliberately no excerpt. */
export interface ReferenceHit {
  readonly path: string;
  readonly line: number;
  readonly className: string;
  readonly source: ReferenceSource;
}

/** One class a run can report, so a clean run still lists it at zero. */
export interface ReferenceClass {
  readonly className: string;
  readonly source: ReferenceSource;
}

/** Whether a file counts toward code or docs, the two halves the acceptance reads. */
export type ReferenceArea = "code" | "docs";

const DOC_EXTENSIONS = [".md", ".mdx", ".mmd", ".txt"];

/**
 * Pure: whether a path is documentation or code. Everything that is not prose is code, so the two halves
 * between them cover every file.
 *
 * @param path a tree-relative path
 * @returns its area
 */
export function referenceArea({ path }: { path: string }): ReferenceArea {
  const lower = path.toLowerCase();
  if (lower.startsWith("docs/") || DOC_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return "docs";
  }
  return "code";
}

/**
 * Pure: the class a gate kind reports under.
 *
 * @param kind the hashed-rule kind
 * @returns the qualified class
 */
function gateClass({ kind }: { kind: IdentifierKind }): string {
  return `gate:${kind.replace(/^forbidden-/, "")}`;
}

/**
 * Pure: every class a run over this map can report, in a fixed order — the map's classes as the map lists them,
 * then the gate's kinds, then the leak labels.
 *
 * @param map the reference map's rows
 * @returns the class universe
 */
export function referenceClasses({ map }: { map: readonly ReferenceMapRow[] }): readonly ReferenceClass[] {
  const mapClasses = [...new Set(map.map((row) => row.className))].map((name) => ({
    className: `map:${name}`,
    source: "map" as const,
  }));
  return [
    ...mapClasses,
    ...IDENTIFIER_KINDS.map((kind) => ({ className: gateClass({ kind }), source: "gate" as const })),
    ...LEAK_LABELS.filter((label) => !NOT_A_REFERENCE.has(label)).map((label) => ({
      className: `leak:${label}`,
      source: "leak" as const,
    })),
  ];
}

/**
 * Pure: every line start in a text, for offset-to-line lookups.
 *
 * @param text the text
 * @returns each line's starting offset, ascending, beginning with 0
 */
function lineStarts({ text }: { text: string }): readonly number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
    starts.push(at + 1);
  }
  return starts;
}

/**
 * Pure: the 1-based line holding an offset.
 *
 * @param offset a character offset into the text
 * @param starts every line's starting offset, ascending, beginning with 0
 * @returns the line number
 */
function lineAt({ offset, starts }: { offset: number; starts: readonly number[] }): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low + 1;
}

/**
 * Pure: every map hit in one text. The expressions run over the WHOLE text, so a row spanning a newline is
 * matched as written; `matchAll` copies the expression, so no `lastIndex` leaks between texts.
 *
 * @param text the content, or the path when `pathOnly` is set
 * @param map the compiled rows
 * @param pathOnly report every hit at line 0, because the text is the file's path
 * @returns the (line, class) pairs found
 */
function mapHits({
  text,
  map,
  pathOnly,
}: {
  text: string;
  map: readonly ReferenceMapRow[];
  pathOnly: boolean;
}): readonly { readonly line: number; readonly className: string }[] {
  const starts = pathOnly ? [0] : lineStarts({ text });
  const found: { line: number; className: string }[] = [];
  for (const row of map) {
    for (const match of text.matchAll(row.re)) {
      found.push({ className: `map:${row.className}`, line: pathOnly ? 0 : lineAt({ offset: match.index, starts }) });
    }
  }
  return found;
}

/**
 * Pure: every reference in one exported file — its path at line 0, and its content.
 *
 * @param path the tree-relative path
 * @param content the file's bytes decoded as UTF-8, or a link's target
 * @param map the off-repo reference map
 * @param scanner the hygiene gate's hashed-rule scanner
 * @param denylist the private denylist words
 * @returns each (line, class) reference once, in the order found
 */
export function scanReferences({
  path,
  content,
  map,
  scanner,
  denylist,
}: {
  path: string;
  content: string;
  map: readonly ReferenceMapRow[];
  scanner: IdentifierScanner;
  denylist: readonly string[];
}): readonly ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  const seen = new Set<string>();
  const add = ({ line, className, source }: { line: number; className: string; source: ReferenceSource }): void => {
    const key = `${String(line)}\u0000${className}`;
    if (!seen.has(key)) {
      seen.add(key);
      hits.push({ className, line, path, source });
    }
  };
  for (const hit of mapHits({ map, pathOnly: true, text: path })) {
    add({ ...hit, source: "map" });
  }
  for (const hit of scanner.scan({ content: path, path })) {
    add({ className: gateClass({ kind: hit.kind }), line: 0, source: "gate" });
  }
  for (const hit of scanContent({ content: path, denylist, path })) {
    if (!NOT_A_REFERENCE.has(hit.label)) {
      add({ className: `leak:${hit.label}`, line: 0, source: "leak" });
    }
  }
  for (const hit of mapHits({ map, pathOnly: false, text: content })) {
    add({ ...hit, source: "map" });
  }
  for (const hit of scanner.scan({ content, path })) {
    add({ className: gateClass({ kind: hit.kind }), line: hit.line, source: "gate" });
  }
  for (const hit of scanContent({ content, denylist, path })) {
    if (!NOT_A_REFERENCE.has(hit.label)) {
      add({ className: `leak:${hit.label}`, line: hit.line, source: "leak" });
    }
  }
  return hits;
}

/**
 * Pure: every reference in one BINARY file (its bytes hold a NUL). A binary has no lines worth counting, and a
 * name in it need not be UTF-8: a UTF-16 string decodes as UTF-8 to a letter, a NUL, a letter, and no rule
 * matches that. So the bytes are scanned as UTF-8, with every NUL dropped (an ASCII name at any alignment), and
 * as UTF-16 in both byte orders at both alignments (any name), and each class counts once for the file, at
 * line 1. A deliberately obfuscated encoding (compressed, base64, EBCDIC) is out of reach and not claimed.
 *
 * @param path the tree-relative path
 * @param bytes the file's raw bytes
 * @param map the off-repo reference map
 * @param scanner the hygiene gate's hashed-rule scanner
 * @param denylist the private denylist words
 * @returns the path's references at line 0, and one hit per class the content carries, at line 1
 */
export function scanBinaryReferences({
  path,
  bytes,
  map,
  scanner,
  denylist,
}: {
  path: string;
  bytes: Uint8Array;
  map: readonly ReferenceMapRow[];
  scanner: IdentifierScanner;
  denylist: readonly string[];
}): readonly ReferenceHit[] {
  const views = [
    Buffer.from(bytes).toString("utf8"),
    Buffer.from(bytes.filter((byte) => byte !== 0)).toString("latin1"),
    ...[0, 1].flatMap((offset) => utf16Views({ bytes: bytes.subarray(offset) })),
  ];
  const hits: ReferenceHit[] = [];
  const seen = new Set<string>();
  for (const content of views) {
    for (const hit of scanReferences({ content, denylist, map, path, scanner })) {
      const line = hit.line === 0 ? 0 : 1;
      const key = `${String(line)}\u0000${hit.className}`;
      if (!seen.has(key)) {
        seen.add(key);
        hits.push({ ...hit, line });
      }
    }
  }
  return hits;
}

/**
 * Pure: every reference in one regular file. A text file (no NUL) is counted line by line from its UTF-8; a
 * UTF-16 name need not hold a NUL either (`中文` is four non-zero bytes), so its bytes are also read every way
 * {@link scanBinaryReferences} reads a binary, and a class only those readings find counts once, at line 1. A
 * binary is counted by {@link scanBinaryReferences} alone.
 *
 * @param path the tree-relative path
 * @param bytes the file's raw bytes
 * @param map the off-repo reference map
 * @param scanner the hygiene gate's hashed-rule scanner
 * @param denylist the private denylist words
 * @returns the file's references, and whether it is binary
 */
export function scanFileReferences({
  path,
  bytes,
  map,
  scanner,
  denylist,
}: {
  path: string;
  bytes: Uint8Array;
  map: readonly ReferenceMapRow[];
  scanner: IdentifierScanner;
  denylist: readonly string[];
}): { readonly hits: readonly ReferenceHit[]; readonly binary: boolean } {
  const decoded = scanBinaryReferences({ bytes, denylist, map, path, scanner });
  if (bytes.includes(0)) {
    return { binary: true, hits: decoded };
  }
  const text = scanReferences({ content: Buffer.from(bytes).toString("utf8"), denylist, map, path, scanner });
  const found = new Set(text.map((hit) => hit.className));
  return { binary: false, hits: [...text, ...decoded.filter((hit) => !found.has(hit.className))] };
}

/**
 * Pure: a path as a refusal message may print it — itself, unless the path carries a reference, when only the
 * fact is printed, so a refusal never names what the scan exists to find.
 *
 * @param path the tree-relative path
 * @param map the off-repo reference map
 * @param scanner the hygiene gate's hashed-rule scanner
 * @param denylist the private denylist words
 * @returns the path, or a stand-in that names nothing
 */
export function printablePath({
  path,
  map,
  scanner,
  denylist,
}: {
  path: string;
  map: readonly ReferenceMapRow[];
  scanner: IdentifierScanner;
  denylist: readonly string[];
}): string {
  if (scanReferences({ content: "", denylist, map, path, scanner }).length === 0) {
    return path;
  }
  return "(a file whose own path carries a reference)";
}

/**
 * Pure: a refusal as the run may print it — itself, unless its text carries a reference (a git error quoting
 * an argument, say), when only its code is printed.
 *
 * @param code the refusal's code, which names nothing
 * @param message the refusal's text
 * @param map the off-repo reference map
 * @param scanner the hygiene gate's hashed-rule scanner
 * @param denylist the private denylist words
 * @returns the message, or a stand-in carrying the code alone
 */
export function printableRefusal({
  code,
  message,
  map,
  scanner,
  denylist,
}: {
  code: string;
  message: string;
  map: readonly ReferenceMapRow[];
  scanner: IdentifierScanner;
  denylist: readonly string[];
}): string {
  if (scanReferences({ content: message, denylist, map, path: "", scanner }).length === 0) {
    return message;
  }
  return `${code} (its text is withheld: it carries a reference itself)`;
}

/**
 * Pure: a binary's bytes read as UTF-16 in both byte orders, an odd trailing byte dropped.
 *
 * @param bytes the bytes, already shifted to the alignment being tried
 * @returns the little-endian and the big-endian reading
 */
function utf16Views({ bytes }: { bytes: Uint8Array }): readonly string[] {
  const even = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2)));
  const swapped = Buffer.from(even).swap16();
  return [even.toString("utf16le"), swapped.toString("utf16le")];
}
