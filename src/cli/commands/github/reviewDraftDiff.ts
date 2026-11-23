/**
 * What a review draft's comments mean against a pull request's live diff: whether each one can be anchored
 * there, and the hunk excerpt GitHub itself would draw above it. Pure.
 */
import type { HunkLine } from "../../../outbound/github/reviewDraft.js";
import { type SelfReviewDiffFile, selfReviewDiffLineSet } from "./selfReviewCore.js";

/** How many lines above a comment's first line the card shows — GitHub's own review-comment preview. */
const LINES_ABOVE = 3;

/** One comment's anchor: a head-side line, or a range ending on it. */
export interface ReviewAnchor {
  readonly path: string;
  readonly line: number;
  readonly startLine?: number | undefined;
}

/** Where a comment points, in the words a refusal prints. */
function locus({ anchor }: { anchor: ReviewAnchor }): string {
  const lines =
    anchor.startLine === undefined ? String(anchor.line) : `${String(anchor.startLine)}-${String(anchor.line)}`;
  return `${anchor.path}:${lines}`;
}

/**
 * Every comment GitHub would refuse, before anything is parked or sent — one refused anchor 422s the whole
 * review.
 *
 * A range is valid only if every line of it is addressable on the head side. Git merges two hunks whose context
 * would touch, so a contiguous run of addressable lines never spans two hunks, and GitHub requires a multi-line
 * comment to sit inside one.
 *
 * @param anchors every comment's anchor, in form order
 * @param files every changed file's patch at the reviewed head
 * @returns one sentence per refused anchor, in form order, or empty when every one lands
 */
export function reviewAnchorRefusals({
  anchors,
  files,
}: {
  anchors: readonly ReviewAnchor[];
  files: readonly SelfReviewDiffFile[];
}): readonly string[] {
  const byPath = new Map(files.map((file) => [file.path, file.patch]));
  const refusals: string[] = [];
  for (const anchor of anchors) {
    if (!byPath.has(anchor.path)) {
      refusals.push(`${locus({ anchor })}: the pull request does not change ${anchor.path}`);
      continue;
    }
    const patch = byPath.get(anchor.path);
    if (patch === undefined) {
      refusals.push(
        `${locus({ anchor })}: GitHub shows no diff for ${anchor.path} (binary or too large to comment on)`,
      );
      continue;
    }
    if (anchor.startLine !== undefined && anchor.startLine >= anchor.line) {
      refusals.push(`${locus({ anchor })}: a range's startLine must be less than its line`);
      continue;
    }
    const addressable = selfReviewDiffLineSet({ patch });
    const outside = rangeOf({ first: firstLineOf({ anchor }), last: anchor.line }).filter(
      (line) => !addressable.has(line),
    );
    if (outside.length > 0) {
      refusals.push(
        `${locus({ anchor })}: line ${String(outside[0])} is not in the diff's head side, so GitHub cannot anchor it`,
      );
    }
  }
  return refusals;
}

/** A comment's first head-side line: its range's start, or the one line a single-line comment sits on. */
function firstLineOf({ anchor }: { anchor: ReviewAnchor }): number {
  if (anchor.startLine === undefined) {
    return anchor.line;
  }
  return anchor.startLine;
}

/** Every integer from `first` to `last`, inclusive. */
function rangeOf({ first, last }: { first: number; last: number }): readonly number[] {
  return Array.from({ length: last - first + 1 }, (_unused, offset) => first + offset);
}

/** One patch line with the hunk it belongs to. */
interface NumberedLine extends HunkLine {
  readonly hunk: number;
}

/** Number every line of a unified patch, the way GitHub numbers its two gutters. */
function numberedLines({ patch }: { patch: string }): readonly NumberedLine[] {
  const out: NumberedLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let hunk = -1;
  for (const raw of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header !== null) {
      hunk += 1;
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      out.push({ hunk, kind: "header", text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ hunk, kind: "add", newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith("-")) {
      out.push({ hunk, kind: "del", oldLine, text: raw.slice(1) });
      oldLine += 1;
    } else if (raw.startsWith(" ")) {
      out.push({ hunk, kind: "context", newLine, oldLine, text: raw.slice(1) });
      oldLine += 1;
      newLine += 1;
    }
    // "\ No newline at end of file" is a marker, not a line of either side.
  }
  return out;
}

/**
 * The lines GitHub shows above a review comment: the hunk header, up to {@link LINES_ABOVE} lines before the
 * comment's first line, then every line through its last — removed lines included, as GitHub draws them.
 *
 * @param patch the file's patch at the reviewed head
 * @param anchor the comment's anchor, already known to land
 * @returns the excerpt, or empty when the anchor is not in the patch
 */
export function hunkExcerpt({ patch, anchor }: { patch: string; anchor: ReviewAnchor }): readonly HunkLine[] {
  const lines = numberedLines({ patch });
  const first = firstLineOf({ anchor });
  const startIndex = lines.findIndex((line) => line.kind !== "del" && line.newLine === first);
  const endIndex = lines.findIndex((line) => line.kind !== "del" && line.newLine === anchor.line);
  const start = lines[startIndex];
  if (start === undefined || endIndex === -1) {
    return [];
  }
  const headerIndex = lines.findIndex((line) => line.kind === "header" && line.hunk === start.hunk);
  const header = lines[headerIndex];
  if (header === undefined) {
    return [];
  }
  const from = Math.max(headerIndex + 1, startIndex - LINES_ABOVE);
  return [header, ...lines.slice(from, endIndex + 1)].map(({ hunk: _hunk, ...line }) => line);
}
