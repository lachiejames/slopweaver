/**
 * CHECK 4 — every memory or knowledge row naming a file, flag, verb or skill gets its referent checked against
 * the tree.
 *
 * Pure over ONE injected seam: {@link ReferentResolver} answers whether a referent is still there, and the
 * effectful shell supplies the real one. So every branch here is testable with a plain fake function, which
 * `.claude/rules/testing.md` explicitly distinguishes from a mock.
 *
 * ## This is the check that cannot be run by reading the memories
 *
 * It needs the tree in front of it, and that is what makes it worth a scheduled pass rather than a periodic
 * human read. A manual pass caught `ask-has-always-been-bm25-only` and
 * `branch-only-deps-get-unlinked` with exactly this question — both memories whose CLAIM had gone stale while
 * reading perfectly well.
 *
 * ## Only a referent inside a markdown code span counts, and that is the whole false-positive guard
 *
 * `` `src/lib/paging.ts` ``, `` `--stale-after` ``, `` `slopweaver memory sweep` ``, `` `skills/memory` ``. Prose is
 * never scanned.
 *
 * This is deliberately narrow. A memory whose prose mentions "the paging module" names something real and
 * unresolvable, and a checker that guessed at it would report a defect in the writing rather than in the
 * tree. The house style already backticks every identifier — measured on this corpus, every path in
 * `MEMORY.md` is spanned — so the narrow criterion loses nothing and cannot manufacture a finding out of a
 * sentence.
 *
 * ## Gone and MOVED are different proposals
 *
 * A referent that vanished may mean the memory is now false. One that moved means the memory needs a new
 * path and its claim may be entirely true. Reporting the second as a deletion would lose a true fact, which
 * is exactly what both of those catches were.
 */
import type { MemoryLeaf } from "../types.js";

/**
 * What kind of thing a memory named. Each has its own resolver in the effectful shell.
 *
 * @internal
 */
export type ReferentKind = "path" | "flag" | "verb" | "skill";

/** One thing a memory claims exists. */
export interface Referent {
  readonly kind: ReferentKind;
  /** Exactly as it was written inside the code span, so a reader can find it in the file. */
  readonly text: string;
  readonly line: number;
}

/**
 * Whether a referent is still there.
 *
 * `moved` is only ever answered for a `path`: a flag, a verb and a skill have no location to have moved from, so
 * a resolver answering it for any of them would be inventing a verdict. See `./refute.ts` for what each becomes.
 */
export type ReferentVerdict = "resolves" | "moved" | "gone";

/** The one seam. Pure code calls it; the shell implements it against the real tree. */
export type ReferentResolver = (args: { referent: Referent }) => ReferentVerdict;

/**
 * One memory's referent the tree could NOT account for.
 *
 * `verdict` excludes `resolves` by construction: this shape is only ever minted for a referent that failed, so
 * a caller branching on it never has to handle the case {@link findStaleReferents} already filtered out — which
 * is what lets `./refute.ts` take a two-case verdict and stay exhaustive.
 */
export interface ResolvedReferent {
  readonly file: string;
  readonly referent: Referent;
  readonly verdict: Exclude<ReferentVerdict, "resolves">;
}

/** Contents of every markdown code span in a text, with the 1-based line each opened on. */
interface CodeSpan {
  readonly text: string;
  readonly line: number;
}

/** File extensions a path-shaped referent may carry. A token with none is prose, however many slashes it has. */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".md", ".json", ".yml", ".yaml", ".sql", ".sh"] as const;

/** Characters that make a path a PATTERN rather than a file. A pattern names no single thing to resolve. */
const GLOB_CHARACTERS = ["*", "?", "[", "{"] as const;

/** A flag: two dashes, then lowercase words and hyphens. Nothing else is a flag this repo would accept. */
const FLAG_PATTERN = /^--[a-z][a-z0-9-]*$/;

/** A verb invocation: the binary, a noun, a verb. A bare noun is not a claim about a verb. */
const VERB_PATTERN = /^slopweaver\s+([a-z][a-z0-9-]*)\s+([a-z][a-z0-9-]*)/;

/**
 * A skill, named by its directory or by its slash command. Both spellings name ONE thing, `skills/<name>`.
 *
 * A directory has no extension, so it never reached {@link isPath} — which is how a knowledge row naming
 * `skills/recipe-scheduler` stood unflagged after that skill was gone (a hygiene pass caught it).
 */
const SKILL_PATTERNS = [/^skills\/([a-z0-9][a-z0-9-]*)\/?$/, /^\/slopweaver:([a-z0-9][a-z0-9-]*)$/] as const;

/**
 * Every single-backtick code span in a text.
 *
 * Fenced blocks are skipped wholesale: a fenced example is illustrative code, and its every identifier would
 * be read as a claim the memory is making. A single span is the house spelling for "this exact thing".
 */
function codeSpans({ text }: { text: string }): readonly CodeSpan[] {
  const spans: CodeSpan[] = [];
  let fenced = false;
  for (const [position, line] of text.split("\n").entries()) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      // Safe: the pattern's one capture group is present on every match.
      spans.push({ line: position + 1, text: match[1]! });
    }
  }
  return spans;
}

/** Whether a span's contents look like a path this repository could hold. */
function isPath({ text }: { text: string }): boolean {
  if (!text.includes("/")) {
    return false;
  }
  if (GLOB_CHARACTERS.some((character) => text.includes(character))) {
    return false;
  }
  return SOURCE_EXTENSIONS.some((extension) => text.endsWith(extension));
}

/**
 * The referent one code span makes, or `null` when it makes none.
 *
 * Order matters only in that the four shapes are mutually exclusive by construction: a path carries a slash
 * and an extension, a skill carries neither an extension nor a second slash past its name, a flag opens with
 * two dashes, a verb opens with the binary's name.
 */
function referentOf({ span }: { span: CodeSpan }): Referent | null {
  const text = span.text.trim();
  if (isPath({ text })) {
    return { kind: "path", line: span.line, text };
  }
  for (const pattern of SKILL_PATTERNS) {
    const skill = pattern.exec(text);
    if (skill !== null) {
      // Safe: each pattern's one capture group is present on every match.
      return { kind: "skill", line: span.line, text: `skills/${skill[1]!}` };
    }
  }
  if (FLAG_PATTERN.test(text)) {
    return { kind: "flag", line: span.line, text };
  }
  const verb = VERB_PATTERN.exec(text);
  if (verb !== null) {
    // The captured noun and verb, not the whole span: a span may carry flags after them.
    return { kind: "verb", line: span.line, text: `${verb[1]!} ${verb[2]!}` };
  }
  return null;
}

/**
 * Every referent one leaf's text makes, deduped within that leaf.
 *
 * Deduped because a memory naming the same path three times is making one claim, and three identical
 * proposals for it would spend the card's whole above-the-fold budget on one file.
 *
 * @param text the leaf's full text, frontmatter included — a `description` naming a dead path is as stale as a body naming one
 * @returns each distinct referent, in the order first written
 */
export function extractReferents({ text }: { text: string }): readonly Referent[] {
  return distinctReferents({
    referents: codeSpans({ text }).flatMap((span) => {
      const referent = referentOf({ span });
      return referent === null ? [] : [referent];
    }),
  });
}

/**
 * Each referent once, keyed by kind and text, keeping the first — the order it was written.
 *
 * @param referents every referent found, possibly repeated
 * @returns each distinct one, in the order first seen
 */
export function distinctReferents({ referents }: { referents: readonly Referent[] }): readonly Referent[] {
  const seen = new Set<string>();
  return referents.filter((referent) => {
    const key = `${referent.kind} ${referent.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * One run of path characters in prose. It breaks on whitespace and on every character a relative repo path
 * cannot hold — a backtick, a bracket, a quote, `#`, `:`, `*`, `$`, `~`, `<` — the same unit
 * `../../canon/staleReferences.ts` chops a line into.
 */
const PROSE_PATH_RUN = /[\w./-]+/g;

/** A skill's slash command in prose. Not inside a longer path or word: `a/slopweaver:x` names no skill. */
const PROSE_SLASH_COMMAND = /(?<![\w/])\/slopweaver:([a-z0-9][a-z0-9-]*)/g;

/**
 * The referent one prose run makes, or `null` when it names nothing in a repository.
 *
 * **The first segment must be a top-level directory of a checkout, and that is the whole guard.** MEASURED on the
 * live memories table: 218 of 1515 recordings name a `src/<file>.ts` path and not one is code-spanned,
 * so the leaf arm's span-only criterion reads nothing there. The same table names `~/.slopweaver/…`,
 * `$SLOPWEAVER_HOME/…`, `<main>/src/…` and paths relative to some subdirectory (`kit/store.ts`); each of those
 * either opens with `/` once the run is cut, or opens with a name no checkout has at its root, so none is ever
 * read as a repo path and reported gone. Repro: `slopweaver knowledge export --out <file>`, then
 * `grep -c -E 'src/[A-Za-z0-9_/-]+\.ts' <file>` against `` grep -c -E '`src/' <file> ``.
 */
function prosePathOf({ run, line, roots }: { run: string; line: number; roots: ReadonlySet<string> }): Referent | null {
  // A leading `./` names the same file; trailing dots are the sentence the path ended, never the path.
  const text = run.replace(/^\.\//, "").replace(/\.+$/, "");
  const [first] = text.split("/");
  if (text.startsWith("/") || first === undefined || !roots.has(first)) {
    return null;
  }
  const referent = referentOf({ span: { line, text } });
  if (referent === null || (referent.kind !== "path" && referent.kind !== "skill")) {
    return null;
  }
  return referent;
}

/**
 * Every path and skill a PROSE text names — for a knowledge row, whose house style never spans a path.
 *
 * @param text the text to read, every line of it
 * @param roots the top-level directory names of every checkout; a path whose first segment is none of them is not read
 * @returns each distinct path or skill, in the order first written
 */
export function extractProseReferents({
  text,
  roots,
}: {
  text: string;
  roots: ReadonlySet<string>;
}): readonly Referent[] {
  const found: Referent[] = [];
  for (const [position, content] of text.split("\n").entries()) {
    const line = position + 1;
    for (const match of content.matchAll(PROSE_PATH_RUN)) {
      const referent = prosePathOf({ line, roots, run: match[0] });
      if (referent !== null) {
        found.push(referent);
      }
    }
    for (const match of content.matchAll(PROSE_SLASH_COMMAND)) {
      // Safe: the pattern's one capture group is present on every match.
      found.push({ kind: "skill", line, text: `skills/${match[1]!}` });
    }
  }
  return distinctReferents({ referents: found });
}

/** What separates two commands on one line: a chain, a pipe, a statement end. */
const COMMAND_SEPARATOR = /&&|\|\||[|;\n]/;

/**
 * Every `slopweaver` verb a COMMAND text runs — a knowledge row's `repro`, which is a command by construction.
 *
 * Only a segment that OPENS with the binary is read. Prose is never read for a verb: "slopweaver memory is
 * fine" would name a verb `memory is`, and the table is full of sentences like it.
 *
 * @param text one command line, possibly chained
 * @param line the line the command sits on in its document
 * @returns each verb, in the order run
 */
export function extractCommandReferents({ text, line }: { text: string; line: number }): readonly Referent[] {
  return distinctReferents({
    referents: text.split(COMMAND_SEPARATOR).flatMap((segment): readonly Referent[] => {
      const verb = VERB_PATTERN.exec(segment.trim());
      // Safe: the pattern's two capture groups are present on every match.
      return verb === null ? [] : [{ kind: "verb", line, text: `${verb[1]!} ${verb[2]!}` }];
    }),
  });
}

/**
 * One source the arm reads, under the name a proposal will carry — a leaf basename, or `knowledge:<id>` for a
 * knowledge row (`./knowledgeRows.ts`) — with the referents already extracted, because the two stores are
 * written in different house styles and each is read by its own criterion.
 */
export interface ReferentDocument {
  readonly file: string;
  readonly referents: readonly Referent[];
}

/**
 * Resolve every referent in every document, keeping only the ones the tree cannot account for.
 *
 * @param documents what to read, in the order proposals should follow
 * @param resolve the injected resolver
 * @returns one entry per unresolved referent, in document order then line order
 */
export function findStaleReferentsIn({
  documents,
  resolve,
}: {
  documents: readonly ReferentDocument[];
  resolve: ReferentResolver;
}): readonly ResolvedReferent[] {
  const stale: ResolvedReferent[] = [];
  for (const document of documents) {
    for (const referent of document.referents) {
      const verdict = resolve({ referent });
      if (verdict !== "resolves") {
        stale.push({ file: document.file, referent, verdict });
      }
    }
  }
  return stale;
}

/**
 * Resolve every referent in every leaf, keeping only the ones the tree cannot account for.
 *
 * @param leaves the corpus's leaves
 * @param texts each leaf's full text, keyed by basename — the parser keeps wikilinks, not prose, so the raw text is passed alongside
 * @param resolve the injected resolver
 * @returns one entry per unresolved referent, in leaf order then line order
 */
export function findStaleReferents({
  leaves,
  texts,
  resolve,
}: {
  leaves: readonly MemoryLeaf[];
  texts: ReadonlyMap<string, string>;
  resolve: ReferentResolver;
}): readonly ResolvedReferent[] {
  const documents = leaves.flatMap((leaf): readonly ReferentDocument[] => {
    const text = texts.get(leaf.file);
    return text === undefined ? [] : [{ file: leaf.file, referents: extractReferents({ text }) }];
  });
  return findStaleReferentsIn({ documents, resolve });
}
