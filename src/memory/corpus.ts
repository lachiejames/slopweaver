/**
 * Turning raw markdown files into a classified corpus. Pure — the effectful reader supplies the text, and
 * tests supply it directly, so every rule downstream is testable without a filesystem.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { extractPointers, extractWikilinks, parseFrontmatter } from "./parse.js";
import {
  type MemoryCorpus,
  type MemoryIndex,
  type MemoryLeaf,
  type MemorySourceFile,
  ROOT_INDEX_FILE,
  TOPIC_INDEX_PREFIX,
} from "./types.js";

/**
 * Which of the three roles a corpus filename plays. Pure so the reader, the compiler and the hook's write
 * classifier all agree on what counts as an index — three separate opinions would be a real defect.
 *
 * @param file the filename, with extension
 * @returns the file's role
 */
export function classifyMemoryFile({ file }: { file: string }): "root" | "topic-index" | "leaf" {
  if (file === ROOT_INDEX_FILE) {
    return "root";
  }
  return file.startsWith(TOPIC_INDEX_PREFIX) ? "topic-index" : "leaf";
}

/**
 * Parse one leaf. Exported because the hook's single-file path parses exactly one.
 *
 * @param source the leaf's filename, its raw markdown, and the mtime of the file behind it when there is one
 * @returns the parsed leaf
 */
export function parseMemoryLeaf(source: {
  /** The leaf's filename, extension included — the extension is part of the classification. */
  file: string;
  /** The raw markdown, whose frontmatter and wiki-links are classified. */
  text: string;
  /**
   * The file's filesystem mtime, omitted when there is no file behind the text (tests, the hook's single-file
   * path) — `null` on the leaf then says so rather than a fabricated zero saying 1970.
   */
  mtimeMs?: number | undefined;
}): MemoryLeaf {
  const { file, text } = source;
  // Text handed in with no file behind it (a test, the hook's single-file path) has no mtime to carry.
  const mtimeMs = unsetFieldAsNull({ key: "mtimeMs", record: source });
  const {
    amendsCanon,
    declaredName,
    declaredType,
    declaredModified,
    description,
    findings,
    ownerDirective,
    correctionSubject,
    overlaps,
  } = parseFrontmatter({ file, text });
  return {
    amendsCanon,
    correctionSubject,
    declaredModified,
    declaredName,
    declaredType,
    description,
    file,
    mtimeMs,
    overlaps,
    ownerDirective,
    schemaFindings: findings,
    stem: file.replace(/\.md$/, ""),
    text,
    wikilinks: extractWikilinks({ text }),
  };
}

function parseMemoryIndex({
  file,
  text,
  resolvesOutside,
}: {
  file: string;
  text: string;
  resolvesOutside: (args: { target: string }) => boolean;
}): MemoryIndex {
  return { file, pointers: extractPointers({ resolvesOutside, text }) };
}

/**
 * Compile raw files into a classified corpus.
 *
 * @param files every markdown file directly in the corpus directory
 * @param resolvesOutside answers "does this path exist?" for a pointer leaving the corpus directory. Defaults to
 *   assuming it does, so a pure caller that does not care about outside links cannot accidentally fail them
 * @returns the corpus, with `root` null when there is no `MEMORY.md`
 */
export function buildMemoryCorpus({
  files,
  resolvesOutside = () => true,
}: {
  files: readonly MemorySourceFile[];
  resolvesOutside?: (args: { target: string }) => boolean;
}): MemoryCorpus {
  let root: MemoryIndex | null = null;
  const topicIndexes: MemoryIndex[] = [];
  const leaves: MemoryLeaf[] = [];
  for (const { file, text, mtimeMs } of [...files].toSorted((a, b) => a.file.localeCompare(b.file))) {
    const role = classifyMemoryFile({ file });
    if (role === "root") {
      root = parseMemoryIndex({ file, resolvesOutside, text });
    } else if (role === "topic-index") {
      topicIndexes.push(parseMemoryIndex({ file, resolvesOutside, text }));
    } else {
      leaves.push(parseMemoryLeaf({ file, mtimeMs, text }));
    }
  }
  return { leaves, root, topicIndexes };
}

/**
 * Every index in the corpus, root first, so a defect is attributed to the standing index before a topic one.
 *
 * @param corpus the parsed corpus
 * @returns the indexes with the root first — the order is load-bearing, since the first match wins when a
 *   defect could belong to more than one index
 */
export function corpusIndexes({ corpus }: { corpus: MemoryCorpus }): readonly MemoryIndex[] {
  return corpus.root === null ? corpus.topicIndexes : [corpus.root, ...corpus.topicIndexes];
}
