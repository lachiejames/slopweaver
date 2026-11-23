/**
 * Every summary a call file holds beside its source, read for kept claims: the call-level half of `slopweaver talk
 * fidelity`'s claim reading (`./claimFidelity.ts` reads one pair).
 *
 * There is a lot of summarisation on the voice and the messenger, and it is only trustworthy if faithful to what was
 * said. The summaries a call file can pair with their source:
 *
 * - **source to answer**, both surfaces: each message the thinking model completed (a `wrote` line; on a typed call
 *   written before typed `wrote` lines existed, the `typed-<item>` reply the owner read) against what its turn read — the
 *   tool answers kept on the call (`answer`) and the owner's words — while anything earlier
 *   on the call still counts as "on record" for an unsourced detail.
 * - **answer to voice**, voice calls only: each message against what the voice said for it, paired by time exactly as
 *   `./voiceFidelity.ts` pairs it.
 *
 * Which tool answers a turn read: the ones whose line names its turn (`turnId`); on an older line, the
 * ones that landed between the turn's `codex … turn <id> started` note and the message, else since the message before.
 * Two turns running at once share that window, so such a message is named `ambiguous-turn`, never silently assigned
 * (`./callFidelityTurns.ts`). What it cannot see it names: no tool answer on record (a call from before answers were
 * kept, or a read by shell, web or sub-agent), and every gap `./voiceFidelity.ts` names.
 */
import { type Completed, turnStartMs, turnToolsOf } from "./callFidelityTurns.js";
import type { CallRecord } from "./callRecord.js";
import { answerToVoiceFindings, sourceToAnswerFindings } from "./claimFidelity.js";
import { type ClaimFinding, type ClaimFindingKind, claimSourcesOf, textsOf } from "./claimMatch.js";
import type { TalkSurface } from "./talkSurface.js";
import { voiceFidelityReport } from "./voiceFidelity.js";

/** The two hops a call file records both sides of. */
type SummaryHop = "source-to-answer" | "answer-to-voice";

/** One summary read against its source. */
export interface FidelityClaimPair {
  readonly callId: string;
  readonly surface: TalkSurface;
  readonly hop: SummaryHop;
  /** `talk-call:<call>#<segment>` where the owner heard or read it, else `#<item>` for a message nothing voiced. */
  readonly anchor: string;
  readonly atIso: string;
  readonly summary: string;
  /** How many tool answers the turn read on record; 0 on the answer-to-voice hop. */
  readonly toolAnswers: number;
  readonly findings: readonly ClaimFinding[];
}

/** One hop on one surface, counted. */
interface FidelityClaimTally {
  readonly surface: TalkSurface;
  readonly hop: SummaryHop;
  readonly pairs: number;
  readonly pairsWithFindings: number;
  readonly byKind: Readonly<Partial<Record<ClaimFindingKind, number>>>;
}

/** The whole claim reading. */
export interface FidelityClaimReport {
  readonly calls: number;
  readonly pairs: readonly FidelityClaimPair[];
  readonly tallies: readonly FidelityClaimTally[];
  /** Source-to-answer messages whose turn read no tool answer on record, so a clean read there is unproven. */
  readonly unsourced: number;
  /** Source-to-answer messages whose turn window another running turn shared. */
  readonly ambiguous: number;
  /** What `./voiceFidelity.ts` could not read whole, carried through. */
  readonly gaps: readonly string[];
}

/** What the thinking model completed on a call, oldest first: its `wrote` lines, and typed replies with none. */
function completedOf({ call }: { call: CallRecord }): readonly Completed[] {
  const written = new Set(call.written.map((one) => one.itemId));
  const wrote: Completed[] = call.written.map((one) => ({
    anchor: undefined,
    atIso: one.atIso,
    id: one.itemId,
    surface: call.surface,
    text: one.text,
    turnId: one.turnId,
  }));
  const typed: Completed[] = call.segments
    .filter(
      (segment) => segment.who === "voice" && segment.id.startsWith("typed-") && !written.has(segment.id.slice(6)),
    )
    .map((segment) => ({
      anchor: `talk-call:${call.callId}#${segment.id}`,
      // Its last snapshot, the instant it completed, as a wrote line's stamp is.
      atIso: segment.atIso,
      id: segment.id.slice(6),
      surface: "typed",
      text: segment.text,
      turnId: undefined,
    }));
  return [...wrote, ...typed].toSorted((left, right) => Date.parse(left.atIso) - Date.parse(right.atIso));
}

/** Where a message was heard or read: a typed reply's own segment, else its voice pair's, else its item. */
function anchorOf({
  one,
  anchors,
  callId,
}: {
  one: Completed;
  anchors: ReadonlyMap<string, string>;
  callId: string;
}): string {
  if (one.anchor !== undefined) {
    return one.anchor;
  }
  const voiced = anchors.get(one.id);
  if (voiced !== undefined) {
    return voiced;
  }
  return `talk-call:${callId}#${one.id}`;
}

/** One call's source-to-answer pairs. */
function sourcePairs({
  call,
  anchors,
  sinceMs,
  untilMs,
}: {
  call: CallRecord;
  anchors: ReadonlyMap<string, string>;
  sinceMs: number;
  untilMs: number;
}): { readonly pairs: readonly FidelityClaimPair[]; readonly ambiguous: number } {
  const completed = completedOf({ call });
  const claimed = new Set(completed.flatMap((one) => (one.turnId === undefined ? [] : [one.turnId])));
  const pairs: FidelityClaimPair[] = [];
  let ambiguous = 0;
  completed.forEach((one, index) => {
    const toMs = Date.parse(one.atIso);
    if (toMs < sinceMs || toMs >= untilMs) {
      return;
    }
    const fromMs = turnStartMs({ call, earlier: completed.slice(0, index), one });
    const tools = call.notes.flatMap((note) => (note.kind === "tool" && note.answer !== undefined ? [note] : []));
    const { ambiguous: unclear, turnTools } = turnToolsOf({ call, claimed, fromMs, one, toMs, tools });
    const recordTools = tools.filter((note) => Date.parse(note.atIso) <= toMs);
    const ownerSegments = call.segments.filter(
      (segment) => segment.who === "owner" && Date.parse(segment.beganIso) < toMs,
    );
    const turnOwnerSegments = ownerSegments.filter((segment) => Date.parse(segment.beganIso) >= fromMs);
    const earlier = completed.slice(0, index).map((other) => other.text);
    if (unclear) {
      ambiguous += 1;
    }
    const answers = ({ notes }: { notes: readonly (typeof tools)[number][] }): readonly string[] =>
      notes.flatMap((note) => textsOf({ text: note.answer! }));
    const turn = claimSourcesOf({
      texts: [...answers({ notes: turnTools }), ...turnOwnerSegments.map((segment) => segment.text)],
    });
    const record = claimSourcesOf({
      texts: [...answers({ notes: recordTools }), ...ownerSegments.map((segment) => segment.text), ...earlier],
    });
    pairs.push({
      anchor: anchorOf({ anchors, callId: call.callId, one }),
      atIso: one.atIso,
      callId: call.callId,
      findings: sourceToAnswerFindings({ answer: one.text, record, turn }),
      hop: "source-to-answer",
      summary: one.text,
      surface: one.surface,
      toolAnswers: turnTools.length,
    });
  });
  return { ambiguous, pairs };
}

/** The tallies, one per hop and surface that had a pair. */
function talliesOf({ pairs }: { pairs: readonly FidelityClaimPair[] }): readonly FidelityClaimTally[] {
  const keys = [
    { hop: "source-to-answer", surface: "voice" },
    { hop: "source-to-answer", surface: "typed" },
    { hop: "answer-to-voice", surface: "voice" },
  ] as const;
  return keys.flatMap(({ hop, surface }) => {
    const mine = pairs.filter((pair) => pair.hop === hop && pair.surface === surface);
    if (mine.length === 0) {
      return [];
    }
    const byKind: Partial<Record<ClaimFindingKind, number>> = {};
    for (const finding of mine.flatMap((pair) => pair.findings)) {
      const held = byKind[finding.kind];
      byKind[finding.kind] = held === undefined ? 1 : held + 1;
    }
    const pairsWithFindings = mine.filter((pair) => pair.findings.length > 0).length;
    return [{ byKind, hop, pairs: mine.length, pairsWithFindings, surface }];
  });
}

/**
 * The claim reading over some calls: every summary completed inside the window, on both hops a call file records.
 *
 * @param calls the calls read
 * @param sinceIso count only summaries completed at or after this instant
 * @param untilIso count only summaries completed before this instant
 * @returns every pair oldest first, the tallies per hop and surface, and what could not be seen
 */
export function callFidelityReport({
  calls,
  sinceIso,
  untilIso,
}: {
  calls: readonly CallRecord[];
  sinceIso: string;
  untilIso: string;
}): FidelityClaimReport {
  const sinceMs = Date.parse(sinceIso);
  const untilMs = Date.parse(untilIso);
  const read = calls.filter((call) => call.sessionId !== undefined);
  const voice = voiceFidelityReport({ calls: read, sinceIso, untilIso });
  const anchors = new Map(voice.pairs.map((pair) => [pair.itemId, pair.anchor]));
  const pairs: FidelityClaimPair[] = [];
  let ambiguous = 0;
  for (const call of read) {
    const one = sourcePairs({ anchors, call, sinceMs, untilMs });
    pairs.push(...one.pairs);
    ambiguous += one.ambiguous;
  }
  for (const pair of voice.pairs) {
    pairs.push({
      anchor: pair.anchor,
      atIso: pair.writtenIso,
      callId: pair.callId,
      findings: answerToVoiceFindings({ handed: pair.handed, spoken: pair.spoken }),
      hop: "answer-to-voice",
      summary: pair.spoken,
      surface: "voice",
      toolAnswers: 0,
    });
  }
  const sorted = pairs.toSorted((left, right) => Date.parse(left.atIso) - Date.parse(right.atIso));
  return {
    ambiguous,
    calls: read.length,
    gaps: voice.gaps.map((gap) => `${gap.callId} ${gap.kind}: ${gap.detail}`),
    pairs: sorted,
    tallies: talliesOf({ pairs: sorted }),
    unsourced: sorted.filter((pair) => pair.hop === "source-to-answer" && pair.toolAnswers === 0).length,
  };
}
