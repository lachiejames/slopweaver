/**
 * WHAT CHANGED IN AN ANSWER between two review rounds — the second half of what a reviewer needs before it
 * may carry a previous round's finding instead of re-deriving it.
 *
 * ## The measured failure this exists for
 *
 * Measured over one week of real bot turns: across all 70 re-review rounds in that
 * window the packet carried 1.0 unresolved claim forward and the fresh reviewer classified 14.1 — so 93% of
 * every re-review round was re-verification of ground the previous round already covered. The whole-home
 * version of the same pair, which is what to re-run rather than the window:
 *
 * ```
 * cd "$SLOPWEAVER_HOME/live/slack/reviews"
 * V=$(find . -name 'verdict*.json')
 * jq -s '[.[]|.claims|length]|add/length' $V                                                  # classified
 * jq -s '[.[]|[.claims[]|select(.impact=="high" and .support!="supported")]|length]|add/length' $V
 * ```
 *
 * Reading 13.75 and 0.70 — a reviewer is handed under one claim and derives fourteen.
 *
 * ## What this module is NOT allowed to prove
 *
 * An unchanged answer is not an unchanged world. `answerDigestOf` hashes the parsed answer and nothing else,
 * so a byte-identical answer says nothing about live provider state, a Slack message edited since, a citation
 * URL now serving something else, or an image overwritten at the same path. The concrete failure: round 1
 * verifies production is healthy and rejects the answer for a missing link, the worker adds only the link,
 * production degrades before round 2, and a reviewer reading "healthy" under a one-line diff returns clean
 * over a false present-state claim, with every test in the suite still green.
 *
 * That failure is closed OUTSIDE this module, by `../../admit/reviewVerdict.ts`'s `restsOn` — the reviewer
 * declares which of its own claims rest on the answer's bytes, and only those are ever carried. This module
 * therefore answers exactly one question, about claims already known to rest on the answer: did the bytes
 * they rest on move? It must never be read as evidence about anything else, and the packet says so.
 *
 * ## Why the diff is generic rather than a list of the fields that matter
 *
 * A hand-written summary knows today's fields. Add a renderable field to the answer form in six months and
 * both the formatter and its example tests stay green while the new field becomes invisible to re-review — a
 * silent hole in the bar, arriving through an unrelated change. So {@link structuralChanges} walks whatever
 * the two parsed values actually contain and names every path that differs, and knows nothing about `lead`,
 * `index` or any other key by name.
 *
 * Arrays are conservative for the same reason: a body block and a table row have no stable identity, so an
 * insertion at the head genuinely cannot be told from an edit of everything after it. A length change marks
 * the whole collection changed as well as each element, and the packet tells the reviewer that a diff
 * touching everything means a full review rather than a summarised one.
 */

/** One path in the answer that differs between the round that was reviewed and this one. */
export interface AnswerChange {
  /** A JSON-pointer-like path into the parsed answer: `/lead`, `/index/2`, `/body/0/rows/1`. */
  readonly path: string;
  readonly kind: "added" | "removed" | "changed";
}

/** Whether a value is a plain object worth walking rather than a leaf to compare. */
function isWalkable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Compare two leaves by their canonical JSON, so key order never reads as a change. */
function sameLeaf({ before, after }: { before: unknown; after: unknown }): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

/**
 * Every path at which two parsed values differ, walked generically so a field added to the form later is
 * covered without this function being edited.
 *
 * @param before the value the previous round reviewed
 * @param after the value this round will review
 * @param path the pointer prefix for this level — callers pass nothing
 * @returns one entry per differing path, parents before children
 */
export function structuralChanges({
  before,
  after,
  path = "",
}: {
  before: unknown;
  after: unknown;
  path?: string;
}): readonly AnswerChange[] {
  if (sameLeaf({ after, before })) {
    return [];
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    return arrayChanges({ after, before, path });
  }
  if (isWalkable(before) && isWalkable(after)) {
    return objectChanges({ after, before, path });
  }
  return [{ kind: "changed", path: path === "" ? "/" : path }];
}

/** Two arrays, compared index-wise, with a length change marking the collection itself as well. */
function arrayChanges({
  before,
  after,
  path,
}: {
  before: readonly unknown[];
  after: readonly unknown[];
  path: string;
}): readonly AnswerChange[] {
  const changes: AnswerChange[] = before.length === after.length ? [] : [{ kind: "changed", path }];
  const longest = Math.max(before.length, after.length);
  for (let at = 0; at < longest; at += 1) {
    const element = `${path}/${String(at)}`;
    if (at >= before.length) {
      changes.push({ kind: "added", path: element });
      continue;
    }
    if (at >= after.length) {
      changes.push({ kind: "removed", path: element });
      continue;
    }
    changes.push(...structuralChanges({ after: after[at], before: before[at], path: element }));
  }
  return changes;
}

/** Two objects, compared key-wise over the union of their keys. */
function objectChanges({
  before,
  after,
  path,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  path: string;
}): readonly AnswerChange[] {
  const changes: AnswerChange[] = [];
  for (const key of Object.keys(after)) {
    const at = `${path}/${key}`;
    if (!(key in before)) {
      changes.push({ kind: "added", path: at });
      continue;
    }
    changes.push(...structuralChanges({ after: after[key], before: before[key], path: at }));
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      changes.push({ kind: "removed", path: `${path}/${key}` });
    }
  }
  return changes;
}

/**
 * The packet's account of what moved, composed by code from the two answers rather than from their author's
 * description of what it did.
 *
 * A round with no comparable previous answer says so rather than claiming nothing moved: "nothing changed"
 * and "I cannot tell what changed" are different facts, and a reviewer that read the second as the first
 * would carry a finding over an answer it has never been compared with.
 *
 * @param changes what {@link structuralChanges} found, or `undefined` when there is no answer to compare to
 * @returns the block's lines, in order
 */
export function answerChangeLines({ changes }: { changes: readonly AnswerChange[] | undefined }): readonly string[] {
  if (changes === undefined) {
    return [
      "**What changed since that round: NOT KNOWN.** The answer the previous round reviewed could not be",
      "read back, so nothing below may be affirmed by reference. Verify every carried claim yourself.",
      "",
    ];
  }
  if (changes.length === 0) {
    return [
      "**What changed since that round: NOTHING.** Every field of the answer is identical to the one the",
      "previous round read.",
      "",
    ];
  }
  return [
    "**What changed since that round**, computed from the two answers rather than reported by their author.",
    "These paths moved; every other path is identical:",
    "",
    ...changes.map((change) => `- \`${change.path}\` — ${change.kind}`),
    "",
  ];
}
