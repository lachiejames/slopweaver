/**
 * Building and merging one {@link VoiceUnit}, and deciding which units a batch carries — the pure half of
 * the voice source.
 *
 * No filesystem, no clock, no network: every instant is passed in, exactly like `../row.ts`, so the
 * dedup, the ordering and the batching are all testable without touching their real home.
 */
import { createHash } from "node:crypto";

import { isRecord } from "../../lib/parsers.js";

import {
  type AnsweredProposal,
  BELIEF_MARKS,
  type BeliefMark,
  type BeliefProposal,
  type ProposedBelief,
  type VoiceSourceKind,
  type VoiceUnit,
} from "./types.js";

/** How many hex characters of a digest an id keeps. Matches `../row.ts`'s `lessonId`. */
const ID_LENGTH = 16;

/**
 * The stable id for one thing they said: the digest of the EXACT bytes.
 *
 * Deliberately not `../row.ts`'s `normaliseClaim`. See `./types.ts`'s {@link VoiceUnit} — merging two
 * recordings that differ by a character would silently pick one of their wordings to keep, and nothing here
 * is allowed to choose between two things they actually said.
 *
 * @param text the recording, exactly as the source held it
 * @returns a `u-` prefixed short hex id
 */
export function voiceUnitId({ text }: { text: string }): string {
  return `u-${createHash("sha256").update(text).digest("hex").slice(0, ID_LENGTH)}`;
}

/**
 * The stable id for one proposal: the unit it was read from, and the normalised claim.
 *
 * Normalised HERE where the lesson id normalises, and for the lesson id's reason: two sessions proposing
 * the same belief off the same words in different casing have proposed one belief. The unit is part of the
 * key because the same claim read out of two different things they said is two pieces of evidence, and
 * collapsing them would lose one.
 *
 * The separator is a NUL because it is the one byte the normalised claim cannot contain — whitespace is
 * collapsed to a single space, so a space would let one unit-and-claim pair spell another's bytes. It is
 * written as the ESCAPE rather than as a literal control character: a raw NUL makes the whole file binary
 * to git, prettier and every diff reader, which is how it stood when this function first landed.
 *
 * @param unitId the unit the claim was read from
 * @param claim the claim as written; lowercased and whitespace-collapsed before hashing
 * @returns a `p-` prefixed short hex id
 */
export function proposalId({ unitId, claim }: { unitId: string; claim: string }): string {
  const normalised = claim.toLowerCase().replaceAll(/\s+/gu, " ").trim();
  const digest = createHash("sha256").update(`${unitId}\u0000${normalised}`).digest("hex").slice(0, ID_LENGTH);
  return `p-${digest}`;
}

/**
 * One recording as a scan encountered it, before anything has been deduplicated.
 *
 * @internal — the shape `./scan.ts` hands {@link foldRecordings}; nothing outside this module names it.
 */
export interface VoiceRecording {
  readonly text: string;
  readonly source: VoiceSourceKind;
  readonly locator: string;
  readonly instantIso?: string | undefined;
}

/**
 * Fold every recording into the distinct units they carry, counting the repeats.
 *
 * ## What the FIRST recording means, and why it is the one kept
 *
 * A unit's `source`, `locator` and `instantIso` come from the first recording of those exact bytes the scan
 * met, and `./scan.ts` reads the families in `VOICE_SOURCE_KINDS` order so that "first" is deterministic
 * rather than a property of directory iteration. That order puts the tick ledger first on purpose: it is
 * the only family carrying a real instant and a `turnUuid`, so a unit that appears in all three is
 * attributed to the source that can say the most about it.
 *
 * A later recording never overwrites those fields, and never contributes an instant to a unit that had
 * none — a scratch copy of a turn is not evidence about when they said it, and the copy's own file mtime is
 * not either.
 *
 * @param recordings every recording read, in scan order
 * @returns one unit per distinct text, in first-seen order
 */
export function foldRecordings({ recordings }: { recordings: readonly VoiceRecording[] }): readonly VoiceUnit[] {
  const byId = new Map<string, { unit: VoiceUnit; count: number }>();
  for (const recording of recordings) {
    const text = recording.text.trim();
    if (text.length === 0) {
      continue;
    }
    const id = voiceUnitId({ text });
    const existing = byId.get(id);
    if (existing !== undefined) {
      existing.count += 1;
      continue;
    }
    byId.set(id, {
      count: 1,
      unit: {
        id,
        locator: recording.locator,
        occurrences: 1,
        source: recording.source,
        text,
        words: countWords({ text }),
        wrapped: recording.source !== "tick-ledger",
        ...(recording.instantIso === undefined ? {} : { instantIso: recording.instantIso }),
      },
    });
  }
  return [...byId.values()].map((entry) => ({ ...entry.unit, occurrences: entry.count }));
}

/**
 * How many words a unit runs to.
 *
 * @param text the unit's text
 * @returns the count of whitespace-separated runs
 */
export function countWords({ text }: { text: string }): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length;
}

/**
 * Every unit id the queue has already answered, whether with a claim or with an explicit nothing.
 *
 * Both outcomes count, which is what lets the queue finish — see `./types.ts`'s {@link BeliefProposal}.
 *
 * @param proposals every row the queue holds
 * @returns the answered unit ids
 */
export function reviewedUnitIds({ proposals }: { proposals: readonly BeliefProposal[] }): ReadonlySet<string> {
  return new Set(proposals.map((row) => row.unitId));
}

/**
 * The next batch to hand a session: the units nobody has answered yet, most-repeated first, bounded.
 *
 * ## Why most-repeated first
 *
 * A unit's `occurrences` is how many places carried those exact bytes, and the scratch directories are
 * copied forward per handoff — so a heavily repeated unit is one that survived many handoffs rather than
 * one they said many times. That is a proxy for how load-bearing the turn was, and it is the only ordering
 * signal available that is not the clock: most units carry no instant at all, because a turn file's name
 * is not one.
 *
 * Ties break on the id so the batch is deterministic. A batch that reordered between two runs would make
 * the resume check untestable.
 *
 * @param units every unit the scan found
 * @param reviewed the unit ids the queue has already answered
 * @param size the most units to return
 * @returns the batch, in the order a session should read it
 */
export function nextBatch({
  units,
  reviewed,
  size,
}: {
  units: readonly VoiceUnit[];
  reviewed: ReadonlySet<string>;
  size: number;
}): readonly VoiceUnit[] {
  return units
    .filter((unit) => !reviewed.has(unit.id))
    .toSorted((a, b) => b.occurrences - a.occurrences || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, size));
}

/**
 * Decode one stored queue line back into a row, checking both shapes.
 *
 * Re-validated on the way IN rather than trusted, exactly as `../row.ts` does it and for the same reason:
 * the queue is a plain append-only file a human can read and will eventually be tempted to edit.
 *
 * @param line one line of the queue
 * @returns the row, or undefined when the line does not decode
 */
export function parseProposalLine({ line }: { line: string }): BeliefProposal | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(decoded)) {
    return undefined;
  }
  const { kind, unitId, reviewedAtIso, run } = decoded;
  const sharedOk = typeof unitId === "string" && typeof reviewedAtIso === "string" && typeof run === "string";
  if (!sharedOk) {
    return undefined;
  }
  if (kind === "none") {
    const { why } = decoded;
    return typeof why === "string" ? { kind: "none", reviewedAtIso, run, unitId, why } : undefined;
  }
  if (kind === "answered") {
    return decodeAnswered({ decoded, reviewedAtIso, run, unitId });
  }
  if (kind !== "proposed") {
    return undefined;
  }
  const { proposalId: id, domain, claim, quote, held } = decoded;
  const proposedOk =
    typeof id === "string" &&
    typeof domain === "string" &&
    typeof claim === "string" &&
    typeof quote === "string" &&
    (held === "stated-uncertain" || held === "stated-confident");
  if (!proposedOk) {
    return undefined;
  }
  return { claim, domain, held, kind: "proposed", proposalId: id, quote, reviewedAtIso, run, unitId };
}

/**
 * Whether an unknown value is one of their three marks — a narrowing guard, so nothing here needs a cast.
 *
 * Positional by the compiler's own decision: TS1230 forbids a destructured parameter in a type predicate.
 */
function isBeliefMark(value: unknown): value is BeliefMark {
  return BELIEF_MARKS.some((entry) => entry === value);
}

/** One `answered` line, or undefined when a required field is missing or outside its vocabulary. */
function decodeAnswered({
  decoded,
  unitId,
  reviewedAtIso,
  run,
}: {
  decoded: Record<string, unknown>;
  unitId: string;
  reviewedAtIso: string;
  run: string;
}): AnsweredProposal | undefined {
  const { proposalId: id, mark, why, correction } = decoded;
  if (typeof id !== "string" || typeof why !== "string" || !isBeliefMark(mark)) {
    return undefined;
  }
  return {
    kind: "answered",
    mark,
    proposalId: id,
    reviewedAtIso,
    run,
    unitId,
    why,
    ...(typeof correction === "string" ? { correction } : {}),
  };
}

/**
 * The proposals they have not answered yet — what the briefing's correction block shows them.
 *
 * Derived from the queue's own rows rather than from a flag on the proposal, for the reason the review set
 * is: the queue is append-only, so a status field would be a second place the same fact lives and the two
 * would eventually disagree.
 *
 * @param proposals every row the queue holds
 * @returns the proposed rows carrying no answer, oldest first
 */
export function openProposals({ proposals }: { proposals: readonly BeliefProposal[] }): readonly ProposedBelief[] {
  const answered = new Set(proposals.flatMap((row) => (row.kind === "answered" ? [row.proposalId] : [])));
  const open = new Map<string, ProposedBelief>();
  for (const row of proposals) {
    if (row.kind !== "proposed" || answered.has(row.proposalId)) {
      continue;
    }
    // Two sessions proposing the same claim off the same unit wrote the same id twice, and the block they
    // reads must offer it ONCE. The FIRST append wins rather than the last: the id is a digest of the unit
    // and the normalised claim, so the two rows agree on everything they see, and keeping the earliest keeps
    // the block's order stable as the queue grows.
    if (!open.has(row.proposalId)) {
      open.set(row.proposalId, row);
    }
  }
  return [...open.values()];
}

/**
 * Their latest word on one proposal, or undefined when they have not answered it.
 *
 * LATEST rather than first, because the queue is append-only and they may correct a correction — the last
 * thing they said about a claim is what they currently thinks, exactly as the register's own repeated ids work.
 *
 * @param proposals every row the queue holds
 * @param proposalId the proposal to look up
 * @returns their most recent answer, or undefined
 */
export function answerFor({
  proposals,
  proposalId: id,
}: {
  proposals: readonly BeliefProposal[];
  proposalId: string;
}): AnsweredProposal | undefined {
  return proposals.findLast((row): row is AnsweredProposal => row.kind === "answered" && row.proposalId === id);
}
