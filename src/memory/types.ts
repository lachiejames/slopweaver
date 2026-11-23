/**
 * Contracts for checking a Claude Code auto-memory corpus, and the finding registry every other module in
 * `src/memory` is measured against. Pure data — no behaviour, no I/O.
 *
 * ## What a corpus is
 *
 * One flat directory of markdown. `MEMORY.md` is the index Claude Code loads into every session;
 * `INDEX-<topic>.md` files are topic sub-indexes; everything else is a leaf holding one fact behind YAML
 * frontmatter. Indexes point at leaves with same-directory markdown links, and leaves cross-reference each
 * other with `[[wikilink]]`s.
 *
 * `INDEX-*` is the CORPUS OWNER's convention, not a Claude Code primitive — the documented model is
 * `MEMORY.md` plus flat topic files. Three of the checks below ({@link MEMORY_CHECK_IDS} `double-routed`,
 * `unreachable`, and index-to-index `dead-pointer`s) exist only because of that extra tier. Worth knowing
 * before treating them as universal.
 */

/**
 * Every check this module can report, in the order findings are presented. The array is the registry: a test
 * asserts each id has both a firing case and a clean control, so a check cannot be silently dropped or added
 * without a proof that it fires.
 *
 * `name-format` and `dated-addendum` sit directly after `schema` because all three are true of a file in
 * ISOLATION — a reader sees what is wrong with the file itself before what is wrong with its place in the
 * graph, and the reporter after a write can decide all three from one file without reading the corpus at all.
 *
 * The last three are the PLACEMENT rules of `skills/knowledge/reference/placement.md`, and each needs more than
 * the file: `why-always-loaded-missing` and `index-line-drift` need the root index's routing, and
 * `amends-canon-without-row` needs the board row the memory names. So they run over a whole corpus and never
 * refuse a write.
 *
 * Two checks from the original design are deliberately ABSENT, and re-adding either is a regression:
 *
 * - an index load-limit check — Claude Code enforces the 200-line / 25KB budget on `MEMORY.md` itself
 *   (reminding near the limit, erroring over it), so a second implementation HERE would only duplicate the
 *   tool. `hygiene/indexBudget.ts` measures the same budget and is not that duplication: the loader's reminder
 *   reaches whoever is sitting in the session it fires in, and the whole point of the scheduled hygiene pass is
 *   that nobody is. It reports which pointers fall past the cut, which the loader never says.
 * - a description-vs-body staleness check — it needs a vocabulary of "correction banner" words, which is a
 *   proxy for meaning rather than a structural fact. Tried against a real corpus, a neutral vocabulary
 *   produced five false positives. Judging whether a description still matches its body is a reading task,
 *   not a linting one.
 */
export const MEMORY_CHECK_IDS = [
  "schema",
  "name-format",
  "dated-addendum",
  "missing-root-index",
  "orphan",
  "dead-pointer",
  "double-routed",
  "collision",
  "unreachable",
  "dangling-wikilink",
  "superseded-still-present",
  "why-always-loaded-missing",
  "index-line-drift",
  "amends-canon-without-row",
] as const;

/** One check's stable machine id. */
type MemoryCheckId = (typeof MEMORY_CHECK_IDS)[number];

/** The frontmatter `metadata.type` values Claude Code writes. */
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;

/** One declared `metadata.type`. */
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** The always-loaded index's filename. */
export const ROOT_INDEX_FILE = "MEMORY.md";

/** The prefix marking a topic sub-index. */
export const TOPIC_INDEX_PREFIX = "INDEX-";

/**
 * One defect, phrased so the owner can act on it. `file` is always a direct-child basename, never an absolute
 * path — findings are rendered into a Claude Code hook payload and into a public repo's test fixtures, so a
 * private directory must not be able to reach either. `line` is `null` for a finding about a file as a whole
 * rather than about one line in it.
 */
export interface MemoryFinding {
  readonly check: MemoryCheckId;
  readonly file: string;
  readonly line: number | null;
  readonly message: string;
}

/**
 * A markdown pointer found in an index — `[title](target.md)`.
 *
 * `outside` means the destination is not a plain same-directory filename, so it addresses something this corpus
 * does not contain. Such a pointer is NOT a route to a leaf and must be excluded from routing and reachability
 * — but it is still a link that can rot, so `resolves` records whether the thing it names is actually there.
 * An early version reported every outside pointer as a defect; measured against a real corpus that flagged two
 * working links forever, which is the nagging this checker exists to avoid. Only a pointer that resolves to
 * nothing is a finding.
 */
export interface MemoryPointer {
  /** The destination with `./` and any `#fragment` removed; a bare stem when the pointer is same-directory. */
  readonly target: string;
  /** The destination exactly as written, for the finding message. */
  readonly raw: string;
  readonly line: number;
  readonly outside: boolean;
  /** Whether the destination exists. Only consulted for `outside` pointers; inside ones use the corpus itself. */
  readonly resolves: boolean;
  /**
   * What the index says about the destination: the text after this link up to the next `[` or the end of the
   * line, with the leading ` — ` separator stripped, or `""` when nothing follows. `index-line-drift` judges it.
   */
  readonly hook: string;
}

/** A `[[wikilink]]` occurrence in a leaf body. */
export interface MemoryWikilink {
  readonly target: string;
  readonly line: number;
}

/** The exact corpus record a correcting memory names. See {@link MemoryLeaf.correctionSubject}. */
export interface MemoryCorrectionSubject {
  readonly source: string;
  readonly container: string;
  readonly sourceId: string;
  readonly url?: string | undefined;
}

/**
 * The two answers a writer may give to an overlap the write gate nominated (`./overlapNomination.ts`).
 * `supersedes` retires the other memory — which must then go, and `superseded-still-present` says so until it
 * has; `compatible` says the two stand together. There is deliberately no third, "ignore": an overlap is
 * either a conflict one side wins or not a conflict at all.
 */
export const MEMORY_OVERLAP_ANSWERS = ["supersedes", "compatible"] as const;

/** One `metadata.slopweaver.overlaps` entry: what the nominated thing is, and what the writer said about it. */
export interface MemoryOverlap {
  /** A memory's `name`, or an always-on canon section's `<path> § <heading>` id, exactly as nominated. */
  readonly target: string;
  readonly answer: (typeof MEMORY_OVERLAP_ANSWERS)[number];
}

/**
 * What the board says about the row an amending memory names.
 *
 * Declared here rather than reusing the board's own `DocStatus`, for the layering reason
 * {@link MemoryCorrectionSubject} gives: the memory layer sits below the board and never imports it. `unresolved`
 * is a corpus nobody asked the board about — a pure caller, or a test — and judges nothing.
 */
export type AmendsRowState =
  | { readonly kind: "unresolved" }
  | { readonly kind: "live"; readonly status: string }
  | { readonly kind: "landed" }
  | { readonly kind: "closed-unlanded"; readonly status: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * A memory's declaration that it amends canon ahead of the change landing — `metadata.slopweaver.amendsCanon`.
 * placement.md's rule is that such a memory names the board row landing the change and is deleted when that
 * row settles; this is the shape that makes the rule checkable.
 */
export interface MemoryAmendsCanon {
  /** The canon file the memory amends, as written. */
  readonly target: string;
  /** The board slug landing the change, or `null` when the declaration names none — itself a finding. */
  readonly row: string | null;
  readonly rowState: AmendsRowState;
}

/**
 * A parsed leaf. `schemaFindings` rides on the leaf rather than being recomputed, so the same parse serves the
 * whole-corpus run and the single-file hook path — two code paths that disagreed about a file's validity would
 * be the worst defect available here.
 */
export interface MemoryLeaf {
  readonly file: string;
  readonly stem: string;
  /** The frontmatter `name`, or `null` when absent or unusable. Wikilinks resolve against this OR the stem. */
  readonly declaredName: string | null;
  /** The frontmatter `description` — the field retrieval matches on — or `null` when absent or unusable. */
  readonly description: string | null;
  /** The frontmatter `metadata.type`, or `null` when absent or not one of {@link MEMORY_TYPES}. */
  readonly declaredType: MemoryType | null;
  /**
   * The frontmatter `metadata.modified` EXACTLY as written, or `null` when absent.
   *
   * Kept as the raw string rather than parsed here: it is only stamped by Claude Code from v2.1.214, and only
   * when it rewrites a file that already had frontmatter, so a corpus carries a mixture. Whether it is a
   * legible timestamp is the sweep's problem to report, not the parser's to silently decide.
   */
  readonly declaredModified: string | null;
  /** Explicit opt-in (`true`) or revocation (`false`); `null` when this memory says nothing about directives. */
  readonly ownerDirective: boolean | null;
  /**
   * The exact corpus record this memory corrects, when it names one — `metadata.slopweaver.correctionSubject`.
   *
   * Its presence is what turns an owner-directive opt-in into a CORRECTION rather than standing guidance:
   * a directive binds every turn, a correction binds only when this record is in front of the answer.
   *
   * The shape is declared here rather than imported from `judgement/ownerDirective.ts`, deliberately: the
   * memory layer is BELOW judgement (judgement reads `MemoryLeaf`, never the other way round), and importing
   * upward to save one small structural type would invert that. The two are structurally identical, so a
   * value crosses the seam with no conversion — the same call `admit/withhold.ts` makes for `ReplySurface`,
   * and for the same reason.
   */
  readonly correctionSubject: MemoryCorrectionSubject | null;
  /**
   * The writer's answers to the overlaps the write gate nominated — `metadata.slopweaver.overlaps`, in
   * declaration order, malformed entries withheld (and reported as `schema` findings). Empty when it declares none.
   */
  readonly overlaps: readonly MemoryOverlap[];
  /** The canon amendment this memory declares, or `null` when it declares none or the declaration is malformed. */
  readonly amendsCanon: MemoryAmendsCanon | null;
  /**
   * The file exactly as read, frontmatter included. Carried so every body rule reads the one text the parse
   * read, rather than a second reader re-opening the file and disagreeing with it.
   */
  readonly text: string;
  readonly wikilinks: readonly MemoryWikilink[];
  readonly schemaFindings: readonly MemoryFinding[];
  /** Filesystem mtime in epoch milliseconds, or `null` when the caller supplied text without a file behind it. */
  readonly mtimeMs: number | null;
}

/** A parsed index — root or topic. */
export interface MemoryIndex {
  readonly file: string;
  readonly pointers: readonly MemoryPointer[];
}

/**
 * A whole corpus, already classified. `root` is `null` when the directory has no `MEMORY.md`, which is a
 * finding rather than a crash: pointing the checker at a directory that is not a memory corpus must say so
 * loudly, not report clean.
 */
export interface MemoryCorpus {
  readonly root: MemoryIndex | null;
  readonly topicIndexes: readonly MemoryIndex[];
  readonly leaves: readonly MemoryLeaf[];
}

/** A raw file handed to the pure corpus compiler. The effectful reader produces these; tests write them. */
export interface MemorySourceFile {
  readonly file: string;
  readonly text: string;
  /**
   * Filesystem mtime in epoch milliseconds. Optional because the pure compiler is also fed by tests and by the
   * hook's single-file path, neither of which has an inode to speak for — and a fabricated zero would be a
   * timestamp that looks real.
   */
  readonly mtimeMs?: number;
}

/**
 * Where a row's age came from. Never collapsed into an unlabelled number, because the two sources mean
 * genuinely different things: `declared` is when Claude Code last rewrote the memory, `mtime` is when the bytes
 * last changed — which a `git checkout` or a file copy will have disturbed without the memory changing at all.
 * `none` is a leaf that can say neither, which is information rather than a gap to fill with a guess.
 */
export type MemoryAgeSource = "declared" | "mtime" | "none";

/**
 * One leaf, laid out for triage. Everything the owner needs to decide keep/adjust/drop without opening the file.
 *
 * There is deliberately no verdict field. The sweep presents; the judgement is the owner's, because a marker
 * heuristic for "is this still true" was tried against a real corpus and produced false positives.
 */
export interface MemorySweepRow {
  readonly file: string;
  /** The identity a wikilink addresses: the declared `name`, falling back to the filename stem. */
  readonly name: string;
  readonly description: string | null;
  readonly declaredType: MemoryType | null;
  /** Which index files route this leaf, sorted. Empty means nothing routes it — `memory check`'s `orphan`. */
  readonly routedBy: readonly string[];
  /** How many OTHER leaves wikilink to it, counted once per linking file. A hub and a dead end triage differently. */
  readonly inboundLinks: number;
  /** `metadata.modified` exactly as written, or `null`. Always reported next to {@link fileModifiedIso}, never merged. */
  readonly declaredModifiedIso: string | null;
  /** The filesystem mtime as an ISO string, or `null`. */
  readonly fileModifiedIso: string | null;
  /** Whole days since {@link ageSource}'s timestamp, or `null` when the source is `none`. */
  readonly ageDays: number | null;
  readonly ageSource: MemoryAgeSource;
  /** Whether {@link ageDays} exceeds `--stale-after`. Always `false` when the flag is absent or the age is unknown. */
  readonly stale: boolean;
  /** This leaf's `memory check` findings, so one row says everything both verbs know about it. */
  readonly findings: readonly MemoryFinding[];
}

/**
 * A whole sweep. `rootIndexMissing` is not a detail: with no `MEMORY.md` the directory is not a memory corpus,
 * and listing whatever markdown it happens to contain as "memories" is exactly the confident wrong answer that
 * requiring `--dir` exists to prevent — so the rows are empty and the reason is said out loud.
 */
export interface MemorySweep {
  readonly rows: readonly MemorySweepRow[];
  readonly rootIndexMissing: boolean;
  /** The `--stale-after` threshold in days, or `null` when the caller did not set one. */
  readonly staleAfterDays: number | null;
}
