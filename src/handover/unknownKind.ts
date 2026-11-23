/**
 * Telling a NEWER build's ordinary write apart from a corrupt file — and deriving, from that, the lines over
 * which a run's writer genuinely cannot be proven.
 *
 * ## Why this is its own module
 *
 * `slopweaver` resolves to the checkout you are standing in, and every one of them writes into the one
 * `$SLOPWEAVER_HOME`. So `runs/*.jsonl` is a single shared, forward-evolving format read by as many vintages
 * of {@link ./ledger}'s decoder as there are worktrees. Before this existed, `byKind` returning `undefined`
 * for a word it had no case for put such a line in the same bucket as truncated JSON, and an unreadable line
 * makes ownership ambiguous, and ambiguous ownership refuses every write. The measurement, the nine kinds and
 * the owner's ruling are in {@link ./ledger}'s header § "A word this build has never heard is not a corrupt
 * file"; this file is the mechanism that header describes.
 *
 * It is a SEPARATE file rather than more of `ledger.ts` because that file sits six code lines under the
 * module cap on `main` — this concern would not fit, and "the word this build cannot name" is a real seam
 * rather than a place the knife happened to fall.
 *
 * Pure: no filesystem, no clock, no environment.
 */

import { isRecord } from "#lib/parsers.js";
import type { RunEvent } from "./ledger.js";

/** One line this build has no case for — a newer vintage's ordinary write, read by an older decoder. */
export interface UnknownKindLine {
  /** The 1-indexed line number, the same number it carries in `ParsedLedger.unreadable`. */
  readonly line: number;
  /** The word the line declared, so a refusal can name it rather than say "something". */
  readonly kind: string;
  /**
   * Whether the line mentions a SESSION anywhere in its payload — the whole ownership test, asked of the
   * payload rather than of the kind, so it stays correct for kinds that do not exist yet.
   *
   * Presence, never usability: a future identity kind carrying a malformed session id must still make
   * ownership ambiguous, and asking whether the field is USABLE would decide a newer build's field rules on
   * this build's behalf. Searched at any depth and over-inclusively — see {@link mentionsSession} for the
   * counterexample that forced that, and for why the two error directions are not symmetrical.
   */
  readonly namesWriter: boolean;
}

/**
 * Every kind this build can name, bound to {@link RunEvent} by the COMPILER.
 *
 * `satisfies Record<RunEvent["kind"], true>` is the anti-drift mechanism, and it is the point of the shape:
 * the next kind cannot be added to the union without this map failing to compile, which is the exact
 * forgetting that produced nine retroactive breakages. A lint rule matching `case "…":` out of source text
 * was the weaker alternative considered; this is the same class of mechanism as the exhaustive-switch
 * `never` binding `error-handling.md` mandates.
 *
 * It has already fired once for real: a rebase onto a `main` carrying `question-posted` and
 * `question-corrected` failed to typecheck here rather than silently re-creating the class this change
 * removes.
 *
 * It answers "does this build have a CASE for this word", never "did this line decode" — see
 * {@link UnknownKindLine} for why those are different questions.
 */
const KNOWN_KINDS = {
  abandoned: true,
  amended: true,
  answered: true,
  artifact: true,
  claimed: true,
  closed: true,
  delivered: true,
  dispatched: true,
  "drive-ended": true,
  finished: true,
  gated: true,
  launched: true,
  lessons: true,
  orphaned: true,
  parked: true,
  "park-cleared": true,
  "park-wake-suspended": true,
  probed: true,
  question: true,
  "question-corrected": true,
  "question-examples": true,
  "question-offered": true,
  "question-reconfirmed": true,
  "question-shaped": true,
  "question-shot": true,
  "question-posted": true,
  "question-withdrawn": true,
  released: true,
  resumed: true,
  ruling: true,
  said: true,
  "signed-off": true,
  started: true,
  "steer-risk": true,
  tagged: true,
} as const satisfies Record<RunEvent["kind"], true>;

/**
 * Classify one line that did not decode: a newer vintage's word, or genuine damage.
 *
 * The three tests are deliberately the SAME three `ledger.ts`'s `decodeEvent` applies before it ever reaches
 * `byKind` — parses as JSON, is a record, carries a string `kind` and a string `atIso`. So corrupt JSON can
 * never be mistaken for a future kind: it fails at the first of them.
 *
 * @param line the raw journal line, exactly as it sits on disk
 * @param lineNumber its 1-indexed position in the file
 * @returns the classification, or `undefined` when the line is damage rather than a vintage gap
 */
export function unknownKindOf({ line, lineNumber }: { line: string; lineNumber: number }): UnknownKindLine | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(payload) || typeof payload["kind"] !== "string" || typeof payload["atIso"] !== "string") {
    return undefined;
  }
  const kind = payload["kind"];
  if (Object.hasOwn(KNOWN_KINDS, kind)) {
    // This build HAS a case for the word and refused the line anyway — its own field rules working, which is
    // a fact about this line rather than about this checkout's age. It stays unreadable and nothing more.
    return undefined;
  }
  return { kind, line: lineNumber, namesWriter: mentionsSession({ value: payload }) };
}

/**
 * Whether a payload mentions a session ANYWHERE in its structure, at any depth.
 *
 * A top-level `Object.hasOwn(payload, "sessionId")` was the first spelling and it is not enough. Every writer
 * kind this repository writes today spells the field at the top level, so the shallow test is correct for
 * every line on disk — and the whole point of this classifier is lines written by a build that does not exist
 * yet. A future kind nesting its writer (`{"writer":{"sessionId":"…"}}`) would read as naming nobody, be
 * forgiven, and leave a stale checkout folding the PREVIOUS writer as current: a session that had itself
 * launched the run would read `mine` over a claim it cannot see, and write into a run somebody else holds.
 * Found reviewing this change's own diff, before it landed.
 *
 * Deliberately over-inclusive — a `why` string containing the word counts. The two errors are not
 * symmetrical: a false positive costs one refusal that names its kind and offers a hatch, and a false
 * negative is a cross-session write.
 */
function mentionsSession({ value }: { value: unknown }): boolean {
  if (Array.isArray(value)) {
    return value.some((item: unknown) => mentionsSession({ value: item }));
  }
  if (isRecord(value)) {
    return Object.entries(value).some(
      ([key, nested]) => key.toLowerCase().includes("session") || mentionsSession({ value: nested }),
    );
  }
  return typeof value === "string" && value.toLowerCase().includes("session");
}

/**
 * The lines that genuinely make OWNERSHIP a guess — everything unreadable except a well-formed word this
 * build has never heard that names no writer.
 *
 * This is the set `handover ask`, `answer`, `abandon`, `finish`, `amend`, `claim` and `release` refuse on.
 * Phase-sensitive and correctness gates keep reading `ParsedLedger.unreadable` whole; `ledger.ts`'s header
 * says why the two halves part company here.
 *
 * Takes the two fields structurally rather than a whole `ParsedLedger`, so this module never has to import
 * that type back out of `ledger.ts` — that edge would close a cycle, if only a type-only one `no-cycle` ignores.
 *
 * @param journal the parsed journal, or anything carrying its two line registers
 * @returns the 1-indexed lines over which ownership cannot be proven, in file order
 */
export function ownershipAmbiguousLines({
  journal,
}: {
  journal: { readonly unreadable: readonly number[]; readonly unknownKind: readonly UnknownKindLine[] };
}): readonly number[] {
  const forgiven = new Set(journal.unknownKind.filter((entry) => !entry.namesWriter).map((entry) => entry.line));
  return journal.unreadable.filter((line) => !forgiven.has(line));
}
