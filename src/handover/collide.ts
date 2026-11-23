/**
 * Warning when two live docs claim the same repository files. Pure, heuristic, and honest about it.
 *
 * ## Deliberately imperfect, by instruction
 *
 * The owner's words, when this was raised as unsolvable: chasing a version that could never fail is an
 * impossible task and would be setting up to fail. So this builds the useful version, labels its uncertainty,
 * and stops there.
 *
 * The signal is weak for a reason no amount of work removes: prose cites a path for CONTEXT (`follow the shape
 * of `check.ts``) exactly as often as it cites one for OWNERSHIP (`rewrite `check.ts``), and nothing in the
 * text distinguishes them. So the false-positive rate is a FEATURE OF THE OUTPUT rather than a defect to
 * engineer away — the report says what overlapped and why it thinks so, and the reader judges.
 *
 * What is not acceptable is a warning that hides its own uncertainty, because that is the overclaim this whole
 * feature exists to remove. Hence: it **warns, and never refuses**. The one refusal in this design is
 * `handover start` on a slug whose run is already open, which is an exact fact about the ledger rather than an
 * inference about files.
 *
 * The file tokens come from the same grammar `handover check` already uses, so this costs no new parsing and
 * cannot disagree with what `check` reports.
 */

import { fileTokensOf } from "./check.js";
import type { HandoverDoc } from "./doc.js";

/** Two docs that mention at least one file in common. */
export interface Collision {
  /** The two doc slugs, in board order. */
  readonly slugs: readonly [string, string];
  /** Every file both mention, sorted, so the reader can judge whether the overlap is real. */
  readonly files: readonly string[];
}

/** One doc's claim on the tree: its slug and the files its body names. */
export interface DocClaim {
  readonly slug: string;
  readonly files: ReadonlySet<string>;
}

/**
 * The files one doc's body names.
 *
 * @param doc the doc, for its slug
 * @param text the doc's full text
 * @returns the claim, whose file set may be empty
 */
export function claimOf({ doc, text }: { doc: HandoverDoc; text: string }): DocClaim {
  return { files: new Set(fileTokensOf({ text })), slug: doc.slug };
}

/**
 * Every pair of claims sharing a file.
 *
 * Only the caller decides which docs are "live" — this compares whatever it is given. That keeps the rule out
 * of here: a `done` doc's overlap with a running one is noise, and which docs count as done is the board's
 * question rather than this function's.
 *
 * @param claims the claims to compare, already filtered to the docs worth comparing
 * @returns one entry per overlapping pair, each listing the shared files
 */
export function collisionsAmong({ claims }: { claims: readonly DocClaim[] }): readonly Collision[] {
  const found: Collision[] = [];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const left = claims[i]!;
      const right = claims[j]!;
      const shared = [...left.files].filter((file) => right.files.has(file)).toSorted();
      if (shared.length > 0) {
        found.push({ files: shared, slugs: [left.slug, right.slug] });
      }
    }
  }
  return found;
}

/**
 * The warning lines for a set of collisions, uncertainty included.
 *
 * The caveat is printed WITH the finding rather than once at the top, because a caveat separated from the claim
 * it qualifies is a caveat nobody applies.
 *
 * @param collisions the overlaps to report
 * @returns the lines to print, empty when nothing overlapped
 */
export function renderCollisions({ collisions }: { collisions: readonly Collision[] }): readonly string[] {
  if (collisions.length === 0) {
    return [];
  }
  const lines = [`⚠ ${String(collisions.length)} pair(s) of live docs name the same file(s):`];
  for (const collision of collisions) {
    lines.push(`  ${collision.slugs[0]} ↔ ${collision.slugs[1]}: ${collision.files.join(", ")}`);
  }
  lines.push(
    "  This is a HEURISTIC over file mentions in prose — a doc cites a path for context as often as",
    "  for ownership, so judge it yourself. It is a warning, never a refusal.",
  );
  return lines;
}
