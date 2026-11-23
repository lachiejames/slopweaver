/**
 * Which memories and always-on canon sections a memory being WRITTEN overlaps — the nomination half of the
 * write gate's contradiction check. Pure: the written leaf, its siblings and the canon sections in; the
 * nominations out.
 *
 * ## It nominates; the writer decides
 *
 * Three memories once named reviewers, contradicted each other and contradicted canon, and nothing asked the
 * question when any of them was written. Whether two texts CONTRADICT is a reading task no token count can
 * settle — _"similarity can nominate, never conclude"_ (`hygiene/enforcement.ts`). So this module only ever
 * says "these share a subject", and the writer answers each one in the leaf's own frontmatter:
 *
 * ```yaml
 * metadata:
 *   slopweaver:
 *     overlaps:
 *       other-memory: supersedes
 *       "AGENTS.md § Operating doctrine": compatible
 * ```
 *
 * `supersedes` is available for a memory and never for canon: a memory that contradicts always-on canon is
 * wrong about where the rule lives, and the change belongs in the canon, in place. A false positive costs one
 * `compatible` line, which is why the gate can afford to REFUSE until it is answered.
 *
 * ## Subject text only, never the body
 *
 * Both sides are read through `hygiene/subjectText.ts` — stem, name, description — for the reason
 * `hygiene/duplicates.ts` measured: bodies are where shared verbatim quotations live, so reading them
 * manufactures overlaps out of correct cross-referencing, and here every false overlap is a refusal. The
 * description is the field retrieval matches on, so two memories on one subject share it. The residue, stated
 * rather than discovered: a contradiction buried in two bodies under unrelated descriptions is not nominated.
 */
import { type CoverageSource, distinctiveTokens, indexSources, MAX_DOCUMENT_FREQUENCY } from "#lib/rareTokens.js";
import { duplicateMaxFrequency } from "./hygiene/duplicates.js";
import { memorySubjectText } from "./hygiene/subjectText.js";
import type { MemoryLeaf, MemoryOverlap } from "./types.js";

/** One section of an always-on canon document: `<path> § <heading>`, or the bare path for the preamble. */
export interface CanonSection {
  readonly id: string;
  readonly text: string;
}

/** One thing a written memory overlaps, and the evidence a writer checks it against. */
export interface OverlapNomination {
  readonly kind: "memory" | "canon";
  /** What the writer answers under — a memory's `name` (its stem when it declares none), or a section id. */
  readonly id: string;
  /** Every other spelling that answers it: a memory is also addressable by its filename stem. */
  readonly aliases: readonly string[];
  /** The rare tokens both carry, sorted. */
  readonly sharedTokens: readonly string[];
}

/**
 * How many rare subject tokens a memory must share with another memory, or with a canon section, before it is
 * nominated.
 *
 * A count rather than the duplicate scan's 0.42 Jaccard, because the question is different: that one asks "is
 * this the same fact written twice", this one "are these about the same thing", and two memories that
 * contradict each other are by construction not the same fact.
 *
 * MEASURED over the two live corpora on this machine (27 leaves), each leaf re-written as if new:
 * at `#lib/rareTokens.js`'s own bar of TWO, 24 memory nominations across 23 leaves, most of them noise
 * (`slopweaver`+`voice`, `chair`+`every`, `governs`+`slack`) — a refusal on nearly every write. At THREE, 8
 * — four pairs, each a real shared subject (the data-source allowlist and the write door share
 * `github`,`slack`,`vanta`,`write`). Re-measure with
 * `slopweaver memory overlaps --dir ~/.claude/projects/<project>/memory --repo "$PWD"`, once per corpus.
 *
 * @internal
 */
export const OVERLAP_TOKEN_MATCHES = 3;

/**
 * How much of a memory's distinctive vocabulary one canon section must carry before it is nominated — on top of
 * {@link OVERLAP_TOKEN_MATCHES}.
 *
 * A SHARE, for the reason `hygiene/enforcement.ts` measured: a canon section is hundreds of words, so a count
 * alone pairs a memory with whichever section is longest. Lower than enforcement's 0.6 on purpose: that asks
 * whether canon already SAYS everything the memory does, this asks whether the two are about the same thing.
 *
 * MEASURED with the same run as {@link OVERLAP_TOKEN_MATCHES}: 0.4 kept 2 canon nominations and dropped a
 * memory about silent defaults that restates `typescript-patterns.md` § Other rules' no-silent-fallback rule,
 * exactly the overlap this exists to raise; 0.3 keeps it, for 8 canon nominations across 27 leaves.
 *
 * @internal
 */
export const CANON_OVERLAP_SHARE = 0.3;

/**
 * The document-frequency share to index canon sections at: `#lib/rareTokens.js`'s tenth, floored so a token
 * in exactly ONE section always counts.
 *
 * Without the floor a repository with fewer than ten always-on sections could never be nominated against at
 * all — `indexSources` rules a token out when it appears in MORE than `count × share` sources, and below ten
 * sections that product is under one, so every token is "too common". A token only one section carries is
 * the rarest evidence there is; `hygiene/duplicates.ts` floors its own share for the same reason.
 *
 * @param count how many sections are being indexed
 * @returns the share to pass to `indexSources`
 */
export function canonMaxFrequency({ count }: { count: number }): number {
  if (count === 0) {
    return MAX_DOCUMENT_FREQUENCY;
  }
  return Math.max(MAX_DOCUMENT_FREQUENCY, 1 / count);
}

/** A fence opener or closer: three or more backticks or tildes. */
const FENCE = /^\s{0,3}(?:`{3,}|~{3,})/;

/** A level-two heading, the unit canon is split at. */
const SECTION_HEADING = /^## (.+)$/;

/**
 * Split one always-on document into its `##` sections, each carrying its own heading.
 *
 * A heading inside a fenced block is an example, not a section. The text above the first heading is a section
 * of its own, named by the bare path. A `###` stays inside its parent: sections are what a writer names in an
 * answer, and a finer split would nominate one rule several times over.
 *
 * @param path the document's repo-relative path, which prefixes every id
 * @param content the document's full text
 * @returns each non-empty section, in document order
 */
export function canonSections({ path, content }: { path: string; content: string }): readonly CanonSection[] {
  const sections: CanonSection[] = [];
  let id = path;
  let lines: string[] = [];
  let inFence = false;
  const flush = (): void => {
    const text = lines.join("\n");
    if (text.trim() !== "") {
      sections.push({ id, text });
    }
  };
  for (const line of content.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
    }
    const heading = inFence ? null : SECTION_HEADING.exec(line);
    if (heading !== null) {
      flush();
      id = `${path} § ${heading[1]!.trim()}`;
      lines = [];
    }
    lines.push(line);
  }
  flush();
  return sections;
}

/** The written memory's rare tokens against one index, sorted into the shape a nomination prints. */
function sharedWith({
  subject,
  theirs,
}: {
  subject: readonly string[];
  theirs: ReadonlySet<string>;
}): readonly string[] {
  return subject.filter((token) => theirs.has(token)).toSorted();
}

/** Every sibling memory sharing {@link OVERLAP_TOKEN_MATCHES} rare subject tokens with the written one. */
function memoryNominations({
  leaf,
  siblings,
}: {
  leaf: MemoryLeaf;
  siblings: readonly MemoryLeaf[];
}): readonly OverlapNomination[] {
  const sources: readonly CoverageSource[] = [leaf, ...siblings].map((each) => ({
    id: each.file,
    text: memorySubjectText({ leaf: each }),
  }));
  const index = indexSources({ maxFrequency: duplicateMaxFrequency({ count: sources.length }), sources });
  const subject = [...index.tokens[0]!].filter((token) => !index.tooCommon.has(token));
  return siblings.flatMap((sibling, position): readonly OverlapNomination[] => {
    // Safe: `indexSources` returns one set per source, and the siblings start at index 1.
    const shared = sharedWith({ subject, theirs: index.tokens[position + 1]! });
    if (shared.length < OVERLAP_TOKEN_MATCHES) {
      return [];
    }
    // A memory declaring no `name` is addressed by its stem alone — `memory check` resolves wikilinks the same way.
    if (sibling.declaredName === null) {
      return [{ aliases: [], id: sibling.stem, kind: "memory", sharedTokens: shared }];
    }
    return [{ aliases: [sibling.stem], id: sibling.declaredName, kind: "memory", sharedTokens: shared }];
  });
}

/** Every canon section carrying {@link CANON_OVERLAP_SHARE} of the written memory's rare subject tokens. */
function canonNominations({
  leaf,
  sections,
}: {
  leaf: MemoryLeaf;
  sections: readonly CanonSection[];
}): readonly OverlapNomination[] {
  const index = indexSources({ maxFrequency: canonMaxFrequency({ count: sections.length }), sources: sections });
  const subject = [...distinctiveTokens({ text: memorySubjectText({ leaf }) })].filter(
    (token) => !index.tooCommon.has(token),
  );
  return sections.flatMap((section, position): readonly OverlapNomination[] => {
    // Safe: `indexSources` returns one set per section, index-aligned.
    const shared = sharedWith({ subject, theirs: index.tokens[position]! });
    if (shared.length < OVERLAP_TOKEN_MATCHES || shared.length / subject.length < CANON_OVERLAP_SHARE) {
      return [];
    }
    return [{ aliases: [], id: section.id, kind: "canon", sharedTokens: shared }];
  });
}

/**
 * Everything the written memory overlaps, answered or not.
 *
 * @param leaf the memory as the write would leave it
 * @param siblings every OTHER memory in its corpus — the written file itself excluded by the caller
 * @param sections every section of the always-on canon that loads beside it
 * @returns the memory nominations in sibling order, then the canon ones in section order
 */
export function nominateOverlaps({
  leaf,
  siblings,
  sections,
}: {
  leaf: MemoryLeaf;
  siblings: readonly MemoryLeaf[];
  sections: readonly CanonSection[];
}): readonly OverlapNomination[] {
  return [...memoryNominations({ leaf, siblings }), ...canonNominations({ leaf, sections })];
}

/**
 * Whether one declared answer answers one nomination. Canon takes `compatible` only — see the module header.
 *
 * @param nomination what was nominated
 * @param overlap one entry the writer declared
 * @returns true when that entry settles the nomination
 */
export function answers({ nomination, overlap }: { nomination: OverlapNomination; overlap: MemoryOverlap }): boolean {
  const named = overlap.target === nomination.id || nomination.aliases.includes(overlap.target);
  if (!named) {
    return false;
  }
  return nomination.kind === "memory" || overlap.answer === "compatible";
}

/**
 * The nominations the memory's own `overlaps` has not answered.
 *
 * @param leaf the memory as the write would leave it, whose `overlaps` carries the answers
 * @param nominations what {@link nominateOverlaps} returned for it
 * @returns the unanswered ones, order kept
 */
export function unansweredOverlaps({
  leaf,
  nominations,
}: {
  leaf: MemoryLeaf;
  nominations: readonly OverlapNomination[];
}): readonly OverlapNomination[] {
  return nominations.filter((nomination) => !leaf.overlaps.some((overlap) => answers({ nomination, overlap })));
}

/** One leaf's standing unanswered overlaps, as `memory overlaps` reports them. */
export interface LeafOverlaps {
  readonly file: string;
  readonly unanswered: readonly OverlapNomination[];
}

/**
 * What the write gate would ask of every leaf in a corpus if each were written anew, now.
 *
 * The same two functions the gate calls, per leaf, so the report and the refusal cannot disagree about what
 * overlaps what — which is what makes this the measurement behind {@link OVERLAP_TOKEN_MATCHES}.
 *
 * @param leaves every leaf of one corpus
 * @param sections the always-on canon beside it
 * @returns one entry per leaf with at least one unanswered overlap, in leaf order
 */
export function corpusOverlaps({
  leaves,
  sections,
}: {
  leaves: readonly MemoryLeaf[];
  sections: readonly CanonSection[];
}): readonly LeafOverlaps[] {
  return leaves.flatMap((leaf): readonly LeafOverlaps[] => {
    const siblings = leaves.filter((other) => other.file !== leaf.file);
    const unanswered = unansweredOverlaps({ leaf, nominations: nominateOverlaps({ leaf, sections, siblings }) });
    return unanswered.length === 0 ? [] : [{ file: leaf.file, unanswered }];
  });
}

/**
 * The sentence a refusal prints for one unanswered nomination — the evidence, and the exact line that answers it.
 *
 * @param nomination the unanswered nomination
 * @returns one sentence
 */
export function overlapDefect({ nomination }: { nomination: OverlapNomination }): string {
  const evidence = `shares ${nomination.sharedTokens.map((token) => `\`${token}\``).join(", ")}`;
  const key = JSON.stringify(nomination.id);
  if (nomination.kind === "memory") {
    return (
      `overlaps the memory \`${nomination.id}\` (${evidence}) — read it, then answer under ` +
      `\`metadata.slopweaver.overlaps\`: \`${key}: supersedes\` if this one replaces it (and delete it), or ` +
      `\`${key}: compatible\` if both stand`
    );
  }
  return (
    `overlaps always-on canon \`${nomination.id}\` (${evidence}) — read it: if this memory contradicts it, change ` +
    `the canon instead of writing this; if it does not, answer \`${key}: compatible\` under ` +
    `\`metadata.slopweaver.overlaps\``
  );
}
