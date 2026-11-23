/**
 * The judgement-mining SELECTION CONTRACT — which files of a source tree reach the bounded sample a mining
 * brief shows, decided by a pure function of the tree's own content.
 *
 * It replaces a walk that sorted entries by name and spent the budget on whatever sorted first, slicing the
 * last file mid-text. MEASURED on a live install: a voice-call tree reached the brief as ONE
 * file of its whole history, because the first UUID-named call alone was larger than the budget, while a
 * correction-shaped memory tree went in whole — so the sample's mix was decided by file names and sizes, not
 * by anything the owner said. Repro: `slopweaver route profile-brief --sources <manifest> --home <scratch>
 * --json` and read each manifest entry's `coverage`.
 *
 * Rules, each one a property a test pins:
 *
 * - **Order is a content hash, never a name.** Each file is ranked by `sha256(relativePath \0 contentHash)`,
 *   a stable permutation of the tree that a dated or alphabetised naming scheme cannot bias. Ties and strata
 *   order compare by UTF-16 code unit, never `localeCompare`, so the order does not move with the locale.
 * - **Strata take turns.** Files are grouped by their top-level directory (`.` for a file at the root) and
 *   drawn round-robin, strata ordered by the hash of their name, so one large subtree cannot spend the budget
 *   before a small one is seen.
 * - **No file monopolises the budget, and no excerpt is a prefix.** A file longer than the per-file ceiling
 *   (1/8 of the budget) contributes a head, middle and tail excerpt joined by omission markers, at most the
 *   ceiling long, and is counted as truncated.
 * - **The budget is exact.** The `\n\n` between two shown files counts against it; a file that no longer
 *   fits is skipped and counted, never sliced, and later smaller files may still fit.
 *
 * "Chars" are JavaScript UTF-16 code units throughout, which is what `String.length` and `slice` count. The
 * contract is deterministic, not random: it prevents a filename or size monopoly, and it does not promise
 * the sample is semantically representative.
 */
import { sha256Text } from "../lib/hash.js";

/** The selection contract's id. Changed whenever the rules above change, and pinned by the manifest hash. */
export const JUDGEMENT_SELECTION_CONTRACT = "hash-spread-v1";

/** The bounded per-source sample size shown in a mining prompt, in UTF-16 code units. */
export const JUDGEMENT_SOURCE_MAX_CHARS = 500_000;

/** One file may contribute at most this share of the budget (1/8), so at least eight files always fit. */
const FILE_SHARE_DIVISOR = 8;

/** The most one file may contribute to a default-budget sample. */
export const JUDGEMENT_FILE_MAX_CHARS = JUDGEMENT_SOURCE_MAX_CHARS / FILE_SHARE_DIVISOR;

/** What joins two shown files, counted against the budget. */
const JUDGEMENT_FILE_SEPARATOR = "\n\n";

/** What stands where an excerpt left text out. */
const OMISSION_MARKER = "\n[…]\n";

/** The stratum a file directly under the source root belongs to. */
const ROOT_STRATUM = ".";

/** One admissible file of a source tree, already cleaned, before selection. */
export interface JudgementCandidateFile {
  /** Path relative to the source root, `/`-separated. */
  readonly relativePath: string;
  /** The file's cleaned text, whole. */
  readonly text: string;
}

/** One file that reached the sample — the receipt the manifest hash pins. */
export interface JudgementSelectedFile {
  readonly relativePath: string;
  /** `sha256:<hex>` over the file's whole cleaned text, not the excerpt. */
  readonly contentHash: string;
  readonly candidateChars: number;
  readonly selectedChars: number;
  readonly truncated: boolean;
}

/** How one top-level stratum of the tree fared under selection. */
interface JudgementStratumCoverage {
  readonly stratum: string;
  readonly candidateFiles: number;
  readonly selectedFiles: number;
}

/** What reached the sample against what the tree held — the measurement a skewed sample is read from. */
export interface JudgementSampleCoverage {
  readonly contract: string;
  readonly candidateFiles: number;
  readonly candidateChars: number;
  readonly selectedFiles: number;
  /**
   * The chars of file content shown, excerpt markers included and separators excluded — comparable with
   * `candidateChars`, which a separator-inclusive length can exceed when a whole tree fits. The rendered text is
   * this plus one separator between each pair of files, and that sum is what the budget bounds.
   */
  readonly selectedChars: number;
  /** Selected files shown as an excerpt because they exceeded the per-file ceiling. */
  readonly truncatedFiles: number;
  /** Candidate files left out because their (possibly excerpted) text no longer fit the remaining budget. */
  readonly budgetSkippedFiles: number;
  readonly strata: readonly JudgementStratumCoverage[];
}

/** The rendered sample, the receipt for every file in it, and the coverage measurement. */
interface JudgementSelection {
  readonly text: string;
  readonly selected: readonly JudgementSelectedFile[];
  readonly coverage: JudgementSampleCoverage;
}

/** One candidate with its hashes and stratum computed once. */
interface RankedCandidate {
  readonly relativePath: string;
  readonly stratum: string;
  readonly contentHash: string;
  readonly rank: string;
  readonly text: string;
}

/** Compare two strings by UTF-16 code unit — locale-independent, unlike `localeCompare`. */
function byCodeUnit({ left, right }: { left: string; right: string }): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** The top-level directory a relative path sits under, or the root stratum for a file at the root. */
function stratumOf({ relativePath }: { relativePath: string }): string {
  const slash = relativePath.indexOf("/");
  return slash === -1 ? ROOT_STRATUM : relativePath.slice(0, slash);
}

/**
 * Each candidate with its content hash, its contract rank and its stratum. Each field is read ONCE, so the
 * hash a receipt carries is always the hash of the very text that was rendered.
 */
function rankCandidates({ candidates }: { candidates: readonly JudgementCandidateFile[] }): readonly RankedCandidate[] {
  return candidates.map(({ relativePath, text }) => {
    const contentHash = sha256Text({ text });
    return {
      contentHash,
      rank: sha256Text({ text: `${relativePath}\0${contentHash}` }),
      relativePath,
      stratum: stratumOf({ relativePath }),
      text,
    };
  });
}

/**
 * Group ranked candidates by stratum, each in rank order, strata ordered by the hash of their name. Every
 * sort ends on the raw strings, because a hash is not injective over UTF-16: UTF-8 encoding replaces every
 * lone surrogate with U+FFFD, so `"a\ud800"` and `"a\udc00"` hash alike — and a tie a stable sort leaves to
 * input order would make the sample depend on the order the tree was listed in.
 */
function strataInOrder({ ranked }: { ranked: readonly RankedCandidate[] }): readonly (readonly RankedCandidate[])[] {
  const byStratum = new Map<string, RankedCandidate[]>();
  for (const candidate of ranked) {
    const bucket = byStratum.get(candidate.stratum);
    if (bucket === undefined) {
      byStratum.set(candidate.stratum, [candidate]);
    } else {
      bucket.push(candidate);
    }
  }
  return [...byStratum.entries()]
    .map(([stratum, bucket]) => ({ bucket, key: sha256Text({ text: stratum }), stratum }))
    .toSorted(
      (left, right) =>
        byCodeUnit({ left: left.key, right: right.key }) || byCodeUnit({ left: left.stratum, right: right.stratum }),
    )
    .map(({ bucket }) =>
      bucket.toSorted(
        (left, right) =>
          byCodeUnit({ left: left.rank, right: right.rank }) ||
          byCodeUnit({ left: left.relativePath, right: right.relativePath }) ||
          byCodeUnit({ left: left.text, right: right.text }),
      ),
    );
}

/** Interleave strata round-robin: the first of each, then the second of each, and so on. */
function roundRobin({ strata }: { strata: readonly (readonly RankedCandidate[])[] }): readonly RankedCandidate[] {
  const longest = Math.max(0, ...strata.map((bucket) => bucket.length));
  const drawn: RankedCandidate[] = [];
  for (let index = 0; index < longest; index += 1) {
    for (const bucket of strata) {
      const candidate = bucket[index];
      if (candidate !== undefined) {
        drawn.push(candidate);
      }
    }
  }
  return drawn;
}

/**
 * A head, middle and tail excerpt of `text`, joined by omission markers, exactly `ceiling` long. Pure.
 *
 * @param text the whole text, longer than `ceiling`
 * @param ceiling the excerpt's exact length
 * @returns the excerpt
 */
export function spreadExcerpt({ text, ceiling }: { text: string; ceiling: number }): string {
  const room = ceiling - OMISSION_MARKER.length * 2;
  if (room < 3) {
    return text.slice(0, ceiling);
  }
  const head = Math.ceil(room / 3);
  const tail = Math.floor(room / 3);
  const middle = room - head - tail;
  const middleStart = Math.floor((text.length - middle) / 2);
  return [text.slice(0, head), text.slice(middleStart, middleStart + middle), text.slice(text.length - tail)].join(
    OMISSION_MARKER,
  );
}

/**
 * Select the bounded sample of one source tree under {@link JUDGEMENT_SELECTION_CONTRACT}. Pure: the same
 * candidates, in any order, always yield the same selection.
 *
 * @param candidates every admissible file of the tree, cleaned
 * @param budgetChars the sample's budget in UTF-16 code units, separators included — a non-negative safe
 *   integer, since every comparison against `NaN` is false and would let the whole tree through
 * @returns the rendered sample, a receipt per shown file, and what reached the sample against what the tree held
 */
export function selectJudgementSample({
  candidates,
  budgetChars = JUDGEMENT_SOURCE_MAX_CHARS,
}: {
  candidates: readonly JudgementCandidateFile[];
  budgetChars?: number;
}): JudgementSelection {
  if (!Number.isSafeInteger(budgetChars) || budgetChars < 0) {
    throw new RangeError(`a sample budget is a non-negative safe integer, not ${String(budgetChars)}`);
  }
  const fileCeiling = Math.floor(budgetChars / FILE_SHARE_DIVISOR);
  // The one read of the caller's candidates: everything below works from this snapshot.
  const ranked = rankCandidates({ candidates });
  const strata = strataInOrder({ ranked });
  const selectedPerStratum = new Map<string, number>(strata.map((bucket) => [bucket[0]!.stratum, 0]));
  const pieces: string[] = [];
  const selected: JudgementSelectedFile[] = [];
  let used = 0;
  let budgetSkippedFiles = 0;
  for (const candidate of roundRobin({ strata })) {
    const truncated = candidate.text.length > fileCeiling;
    const piece = truncated ? spreadExcerpt({ ceiling: fileCeiling, text: candidate.text }) : candidate.text;
    const cost = piece.length + (pieces.length === 0 ? 0 : JUDGEMENT_FILE_SEPARATOR.length);
    if (used + cost > budgetChars) {
      budgetSkippedFiles += 1;
      continue;
    }
    pieces.push(piece);
    used += cost;
    selected.push({
      candidateChars: candidate.text.length,
      contentHash: candidate.contentHash,
      relativePath: candidate.relativePath,
      selectedChars: piece.length,
      truncated,
    });
    selectedPerStratum.set(candidate.stratum, selectedPerStratum.get(candidate.stratum)! + 1);
  }
  const text = pieces.join(JUDGEMENT_FILE_SEPARATOR);
  return {
    coverage: {
      budgetSkippedFiles,
      candidateChars: ranked.reduce((total, candidate) => total + candidate.text.length, 0),
      candidateFiles: ranked.length,
      contract: JUDGEMENT_SELECTION_CONTRACT,
      selectedChars: selected.reduce((total, file) => total + file.selectedChars, 0),
      selectedFiles: selected.length,
      strata: strata.map((bucket) => {
        const stratum = bucket[0]!.stratum;
        return { candidateFiles: bucket.length, selectedFiles: selectedPerStratum.get(stratum)!, stratum };
      }),
      truncatedFiles: selected.filter((file) => file.truncated).length,
    },
    selected,
    text,
  };
}
