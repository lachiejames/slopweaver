/**
 * What an intake mark's WITNESS is worth: whether a reader can follow it, whether one string is being spread across
 * many of the owner's turns, and — when a turn carries several marks — which one stands.
 *
 * ## The defect, measured
 *
 * In about six minutes one supervisor ran `supervisor intake-mark` 183 times,
 * about two seconds apart, with ONE witness: "loop report from live-bot-loop-21sep-c-a4, acted on at the tick
 * it arrived and carried on the fleet page". The turns were the owner's own steers, not loop reports. Each happened to carry
 * an earlier, specific mark ("keep it freeform: relayed to workspace:86 …"), but the read was last-mark-wins,
 * so the bulk text masked every real carrier — and the same move on a turn with no earlier mark would have cleared a
 * genuinely unhandled steer in silence. Reproduce the spread with
 * `jq -r .witness ~/.slopweaver/sessions/intake-marks.jsonl | sort | uniq -c | sort -rn | head`.
 *
 * ## The two halves
 *
 * The WRITE half ({@link witnessReuse}) refuses a free-text witness that already names
 * {@link INTAKE_WITNESS_SHARE_LIMIT} other turns. The READ half ({@link preferredMark}) ranks a turn's marks —
 * checkable, then specific free text, then SHARED free text — and lets a later mark replace an earlier one only at
 * the same rank or higher, so a correction still lands while a bulk string can never mask a specific carrier. A
 * turn whose only mark is shared text is still witnessed: the read is a preference, never a retroactive filter.
 *
 * ## Checkable means the WHOLE witness is one reference
 *
 * A board slug, an http(s) URL, a pull request by number, or a turn/relay/call pointer — the witness, its surrounding
 * punctuation aside, must BE that reference. Prose that merely MENTIONS one is free text: the incident's own string
 * named `live-bot-loop-21sep-c-a4`, one suffix away from the real row `live-bot-loop-21sep-c`, and an
 * any-token exemption would have let that exact burst through had the suffix been dropped.
 *
 * Pure: marks and a slug lookup in, a verdict out.
 */

import { parseCodexRolloutPointer } from "../codex/rolloutOwnerTurnPointer.js";
import { NAMED_NUMBER } from "../handover/namedNumber.js";
import { isSafeSlug } from "../handover/runStore.js";
import { parseRelayAnchor } from "../talk/relayDraft.js";
import { parseCallPointer } from "../talk/unreadWords.js";
import { parseTurnPointer } from "../transcripts/pointer.js";
import type { IntakeMark } from "./intake.js";

/**
 * How many OTHER turns one free-text witness may already name before `intake-mark` refuses the next.
 *
 * Three, read off the ledger's distribution of exact witnesses by distinct pointer: 4,761 name one
 * turn, 154 two, 43 three, 25 four — then a tail of operational templates at 14, 20, 29, 30 and the incident's 183.
 * Three is the boundary between coincidental repetition and a template; it is a policy choice, not a derivation.
 * Reproduce with `jq -r '[.witness, .pointer] | @tsv' ~/.slopweaver/sessions/intake-marks.jsonl | sort -u | cut -f1 | sort | uniq -c | sort -rn`.
 */
export const INTAKE_WITNESS_SHARE_LIMIT = 3;

/** Whether a slug names a row — a `Set` of the board's slugs, or a single-file lookup where a scan is too slow. */
export type SlugLookup = Pick<ReadonlySet<string>, "has">;

/** What a refused reuse names, so the refusal can say exactly which turns already carry the string. */
export interface IntakeWitnessReuse {
  readonly witness: string;
  /** The distinct turns already carrying this witness, other than the one being marked, in ledger order. */
  readonly otherPointers: readonly string[];
  readonly limit: number;
}

/** Punctuation prose opens a reference with. */
const LEADING_WRAP = /^[\s"'`([{<]*/u;
/** Punctuation prose closes a reference with. */
const TRAILING_WRAP = /[\s"'`)\]}>.,;:!?]*$/u;

/**
 * Whether a witness, its wrapping punctuation aside, IS one reference a reader can follow.
 *
 * @param witness the mark's witness text
 * @param slugs which slugs name a row
 * @returns true for a row slug, an http(s) URL, a pull request by number, or a turn/relay/call pointer
 */
export function isCheckableWitness({ witness, slugs }: { witness: string; slugs: SlugLookup }): boolean {
  return referenceUnwrappings({ text: witness }).some(
    (reference) => reference.length > 0 && isOneReference({ reference, slugs }),
  );
}

/**
 * Every way to peel wrapping punctuation off a witness, from none to all at each end.
 *
 * A reference may legally END in what prose wraps with — a slug in a dot, a call segment in a `!` — so stripping
 * the whole run turns `(v2.)` into `v2` and misses the row `v2.`. Every split of each
 * run is tried instead; both runs are a few characters, so the product stays tiny. `./intakeRoute.ts` peels each
 * prose token with the same grammar, so the two readings of a slug cannot drift.
 *
 * @param text a witness, or one token of one
 * @returns each candidate, the unpeeled text first and the most-peeled last
 */
export function referenceUnwrappings({ text }: { text: string }): readonly string[] {
  const lead = LEADING_WRAP.exec(text)![0].length;
  const body = text.slice(lead);
  const trail = TRAILING_WRAP.exec(body)![0].length;
  const candidates = new Set<string>();
  for (let start = 0; start <= lead; start += 1) {
    for (let cut = 0; cut <= trail; cut += 1) {
      candidates.add(text.slice(start, text.length - cut));
    }
  }
  return [...candidates];
}

/** Whether `reference`, exactly as given, is one row slug, URL, pull request or turn/relay/call pointer. */
function isOneReference({ reference, slugs }: { reference: string; slugs: SlugLookup }): boolean {
  // A slug `isSafeSlug` refuses has no journal and no verb will act on it, so it is no row a reader can follow.
  if (isSafeSlug({ slug: reference }) && slugs.has(reference)) {
    return true;
  }
  if (isHttpUrl({ text: reference })) {
    return true;
  }
  const named = reference.match(NAMED_NUMBER);
  if (named?.length === 1 && named[0] === reference) {
    return true;
  }
  return (
    parseTurnPointer({ text: reference }) !== undefined ||
    parseCodexRolloutPointer({ text: reference }) !== undefined ||
    parseRelayAnchor({ text: reference }) !== undefined ||
    parseCallPointer({ text: reference }) !== undefined
  );
}

/** Whether a string with no whitespace is an absolute http(s) URL with a host. */
function isHttpUrl({ text }: { text: string }): boolean {
  if (/\s/u.test(text) || !/^https?:\/\//iu.test(text)) {
    return false;
  }
  try {
    return new URL(text).hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * How many distinct turns each exact witness names across the whole ledger.
 *
 * All history rather than a window: a window would let the same string clear turns slowly, and `--now` is the
 * caller's to set, so a timestamp is no input to a rule like this one. A turn re-marked twice counts once.
 *
 * @param marks the intake ledger
 * @returns witness → distinct pointer count
 */
export function witnessShares({ marks }: { marks: readonly IntakeMark[] }): ReadonlyMap<string, number> {
  const pointers = new Map<string, Set<string>>();
  for (const mark of marks) {
    const seen = pointers.get(mark.witness);
    if (seen === undefined) {
      pointers.set(mark.witness, new Set([mark.pointer]));
    } else {
      seen.add(mark.pointer);
    }
  }
  return new Map([...pointers].map(([witness, seen]) => [witness, seen.size]));
}

/**
 * Whether writing `witness` against `pointer` would spread one free-text string past the limit.
 *
 * A turn that already carries this exact witness is never refused: re-marking it spreads the string to no new
 * turn, even where older marks (written under the override, or before this gate) already sit past the limit.
 * The slug lookup is consulted only once the string is already over the limit, so the common case — a witness
 * written once — costs no board read at all.
 *
 * @param marks the intake ledger as it stands
 * @param pointer the normalised turn about to be marked
 * @param witness the trimmed witness about to be written
 * @param slugs which slugs name a row
 * @returns the reuse to refuse, or `undefined` when the mark may be written
 */
export function witnessReuse({
  marks,
  pointer,
  witness,
  slugs,
}: {
  marks: readonly IntakeMark[];
  pointer: string;
  witness: string;
  slugs: SlugLookup;
}): IntakeWitnessReuse | undefined {
  const carriers = new Set(marks.filter((mark) => mark.witness === witness).map((mark) => mark.pointer));
  if (carriers.has(pointer)) {
    return undefined;
  }
  const others = [...carriers];
  if (others.length < INTAKE_WITNESS_SHARE_LIMIT || isCheckableWitness({ slugs, witness })) {
    return undefined;
  }
  return { limit: INTAKE_WITNESS_SHARE_LIMIT, otherPointers: others, witness };
}

/** A checkable witness outranks specific free text, which outranks free text shared past the limit. */
function rankOf({
  mark,
  shares,
  slugs,
}: {
  mark: IntakeMark;
  shares: ReadonlyMap<string, number>;
  slugs: SlugLookup;
}): number {
  if (isCheckableWitness({ slugs, witness: mark.witness })) {
    return 2;
  }
  const share = shares.get(mark.witness);
  return share !== undefined && share > INTAKE_WITNESS_SHARE_LIMIT ? 0 : 1;
}

/**
 * The mark that stands for ONE turn, out of every mark written against it.
 *
 * Later replaces earlier at the same rank or higher — a correction is the only reason to write two — but never
 * from below: shared free text cannot mask a specific carrier, and free text cannot mask a reference.
 *
 * @param candidates the marks on one turn, oldest first
 * @param shares {@link witnessShares} over the whole ledger
 * @param slugs which slugs name a row
 * @returns the standing mark, or `undefined` when there are none
 */
export function preferredMark({
  candidates,
  shares,
  slugs,
}: {
  candidates: readonly IntakeMark[];
  shares: ReadonlyMap<string, number>;
  slugs: SlugLookup;
}): IntakeMark | undefined {
  if (candidates.length <= 1) {
    return candidates[0];
  }
  let held: { mark: IntakeMark; rank: number } | undefined;
  for (const mark of candidates) {
    const rank = rankOf({ mark, shares, slugs });
    if (held === undefined || rank >= held.rank) {
      held = { mark, rank };
    }
  }
  return held?.mark;
}

/**
 * The standing mark for every turn the ledger names, by {@link preferredMark}.
 *
 * @param marks the intake ledger, in file order
 * @param slugs which slugs name a row
 * @returns pointer → its standing mark
 */
export function preferredMarks({
  marks,
  slugs,
}: {
  marks: readonly IntakeMark[];
  slugs: SlugLookup;
}): ReadonlyMap<string, IntakeMark> {
  const byPointer = new Map<string, IntakeMark[]>();
  for (const mark of marks) {
    const list = byPointer.get(mark.pointer);
    if (list === undefined) {
      byPointer.set(mark.pointer, [mark]);
    } else {
      list.push(mark);
    }
  }
  const shares = witnessShares({ marks });
  const standing = new Map<string, IntakeMark>();
  for (const [pointer, candidates] of byPointer) {
    const mark = preferredMark({ candidates, shares, slugs });
    if (mark !== undefined) {
      standing.set(pointer, mark);
    }
  }
  return standing;
}
