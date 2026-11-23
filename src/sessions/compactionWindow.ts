/**
 * What a DIFFERENT auto-compact window would have cost, replayed over the week that already happened.
 *
 * ## The question this answers
 *
 * How would we ever know whether 300k or 400k or 600k performs best per dollar and per hour? You do not A/B a fleet against itself; you price each candidate retrospectively, because every
 * call's own context size is already in the transcripts. A tighter window would have stopped the context
 * growing past it, so every cache-read token a call drew ABOVE the candidate is a token that window avoids
 * paying for — and each crossing is one more compaction it would have fired.
 *
 * ## A LOOSER window than the one that ran cannot be priced from this data, and saying so is the point
 *
 * A trace records the context a session actually accumulated. Under a 300k window it never accumulates
 * 400k, so replaying 400k over it reports almost no compactions and almost no saving — not because 400k
 * would be free, but because the week being replayed never contained a 400k context to price. The first
 * live run of `session compaction` reported exactly that shape (6 simulated compactions against 212 real
 * ones at 300k), and a table that printed it without comment would be an argument for 600k built out of
 * its own blind spot.
 *
 * So {@link replayWindows} marks every candidate above the corpus's own observed context ceiling as NOT
 * priceable, and the way to price a looser window is the one this verb's signal already implements: move
 * the window, take a reading a week later, compare the two. Retrospective pricing works DOWNWARD only.
 *
 * ## Three assumptions, all stated on every document this produces
 *
 * **The compaction COUNT is a floor.** Auto-compact fires BELOW the configured window: a live boundary was
 * measured at `preTokens` 267,547 against a 300,000 window (`./compactionRecord.ts`, Claude Code 2.1.278).
 * A replay that fires only on strictly crossing the window therefore under-counts, and the direction is
 * known rather than unknown.
 *
 * **The post-compaction drop is modelled.** A simulated compaction drops the simulated context to a
 * caller-supplied figure — the measured median `postTokens`, 13,976 over seven days
 * (`slopweaver session compaction --days 7`).
 * {@link WindowReplay.avoidedCacheReadTokens} does NOT depend on it; {@link WindowReplay.compactions} does.
 *
 * **A real boundary resets the simulation.** The trace already took that drop; a simulation that kept
 * subtracting its own would drive the simulated context negative and never fire again.
 *
 * ## The one number the decision turns on
 *
 * Between two adjacent PRICEABLE candidates, {@link windowTrade} answers "how many tokens does each extra
 * compaction buy". Measured over seven days — `slopweaver session compaction --days 7`,
 * 746 transcripts, 377 real boundaries, a corpus compacting at 267k — the band it can price runs:
 *
 * | step         | fewer compactions | extra tokens | bought per extra compaction |
 * | ------------ | ----------------- | ------------ | --------------------------- |
 * | 100k → 150k  | 1132              | 5.45B        | 4.81M                       |
 * | 150k → 200k  | 317               | 4.06B        | 12.8M                       |
 * | 200k → 250k  | 179               | 2.67B        | 14.9M                       |
 *
 * The ratio is what transfers upward, not the magnitude: each step out buys steadily MORE per compaction it
 * saves, which is the shape of the argument for a looser window even though 300k and above cannot be priced
 * from a week that already ran 300k. Once a compaction's real cost in seconds and lost context is known,
 * that comparison settles the window without anybody judging by feel.
 *
 * Pure: folded transcripts in, numbers out.
 */
import { type Measured, measured, unmeasurable } from "../measurement/status.js";
import type { CallContext, TranscriptCompaction } from "./compactionFold.js";

/** What one candidate window would have done to the week it is replayed over. */
export interface WindowReplay {
  /** The candidate, in tokens. */
  readonly windowTokens: number;
  /** How many compactions it would have fired. A FLOOR — see this module's header. */
  readonly compactions: number;
  /** Cache-read tokens it would never have been billed for. Independent of the drop model. */
  readonly avoidedCacheReadTokens: number;
  /**
   * How many transcripts ever carried a context this big — the base every figure on the row rests on.
   *
   * Printed always, because the ceiling alone is a weak test: ONE session left on the old 967k default
   * makes a 600k row look priceable off the whole corpus when it is priced off that single session.
   */
  readonly transcriptsReaching: number;
}

/** What moving from a tighter window to a looser one buys, and what it costs. */
export interface WindowTrade {
  readonly tighterTokens: number;
  readonly looserTokens: number;
  /** Compactions the tighter window fires that the looser one does not. */
  readonly extraCompactions: number;
  /** Cache-read tokens the tighter window avoids that the looser one does not. */
  readonly extraTokensAvoided: number;
  /** The decision number: tokens bought per extra compaction. */
  readonly tokensPerExtraCompaction: number;
}

/**
 * Replay one candidate window over every folded transcript.
 *
 * The simulation walks a session's calls in order carrying a running `dropped` total: the context a call
 * WOULD have had under this window is its real context less everything earlier compactions had already
 * shed. A call past the window fires one and sheds down to {@link postTokens}; a call under it contributes
 * the cache-read tokens sitting above the window, capped at what it actually drew.
 *
 * @param transcripts every transcript folded by `./compactionFold.ts`
 * @param windowTokens the candidate window
 * @param postTokens what a compaction is modelled as dropping the context to
 * @returns what that window would have cost and saved
 */
export function replayWindow({
  transcripts,
  windowTokens,
  postTokens,
}: {
  transcripts: readonly TranscriptCompaction[];
  windowTokens: number;
  postTokens: number;
}): WindowReplay {
  let avoidedCacheReadTokens = 0;
  let compactions = 0;
  let transcriptsReaching = 0;
  for (const transcript of transcripts) {
    const walked = replayTranscript({ calls: transcript.calls, postTokens, windowTokens });
    avoidedCacheReadTokens += walked.avoided;
    compactions += walked.compactions;
    transcriptsReaching += walked.reached ? 1 : 0;
  }
  return { avoidedCacheReadTokens, compactions, transcriptsReaching, windowTokens };
}

/**
 * Walk ONE session's calls under a candidate window.
 *
 * Split out of {@link replayWindow} so the simulation's own state — the running shed total, and whether
 * this session ever reached the window at all — stays inside the one loop that owns it.
 */
function replayTranscript({
  calls,
  windowTokens,
  postTokens,
}: {
  calls: readonly CallContext[];
  windowTokens: number;
  postTokens: number;
}): { readonly avoided: number; readonly compactions: number; readonly reached: boolean } {
  let avoided = 0;
  let compactions = 0;
  let dropped = 0;
  let reached = false;
  for (const call of calls) {
    if (call.contextTokens >= windowTokens) {
      reached = true;
    }
    if (call.afterRealBoundary) {
      dropped = 0;
    }
    const simulated = call.contextTokens - dropped;
    if (simulated > windowTokens) {
      compactions += 1;
      dropped += simulated - postTokens;
      // The call that CROSSES credits nothing. It is the one paying for the compaction, not one the
      // window saved anything on; avoidance accrues on the later calls, whose real context is above the
      // window while the shed total keeps their simulated context under it.
      continue;
    }
    avoided += avoidedBy({ call, windowTokens });
  }
  return { avoided, compactions, reached };
}

/** The cache-read tokens one call drew ABOVE the candidate window — never more than it drew at all. */
function avoidedBy({ call, windowTokens }: { call: CallContext; windowTokens: number }): number {
  return Math.max(0, Math.min(call.cacheReadTokens, call.contextTokens - windowTokens));
}

/**
 * What the step between two candidate windows buys, per extra compaction.
 *
 * @param tighter the smaller window's replay
 * @param looser the larger window's replay
 * @returns the trade, or the reason there is none — two windows that fire the same number of compactions
 *   have no per-compaction price, and reporting an infinity there would read as an unbeatable saving
 */
export function windowTrade({
  tighter,
  looser,
}: {
  tighter: WindowReplay;
  looser: WindowReplay;
}): Measured<WindowTrade> {
  const extraCompactions = tighter.compactions - looser.compactions;
  if (extraCompactions <= 0) {
    return unmeasurable({
      why: `${String(tighter.windowTokens)} fires no more compactions than ${String(looser.windowTokens)}, so there is no per-compaction price to pay`,
    });
  }
  const extraTokensAvoided = tighter.avoidedCacheReadTokens - looser.avoidedCacheReadTokens;
  return measured({
    value: {
      extraCompactions,
      extraTokensAvoided,
      looserTokens: looser.windowTokens,
      tighterTokens: tighter.windowTokens,
      tokensPerExtraCompaction: extraTokensAvoided / extraCompactions,
    },
  });
}

/**
 * The candidate windows a run prices when the caller names none.
 *
 * The owner's three (300k/400k/600k) and the 300k that shipped are all AT or ABOVE the point the fleet actually
 * compacts at, so on a corpus that already runs 300k every one of them comes back NOT PRICEABLE — a true
 * table that answers nothing. The band below it is the half this data can price, and the trade between two
 * priceable neighbours is the number that transfers: tokens bought per extra compaction does not stop being
 * the decision ratio just because it was measured a step tighter. So the default carries both — what can be
 * measured, and the refusal on what cannot.
 */
export const DEFAULT_CANDIDATE_WINDOWS: readonly number[] = [
  100_000, 150_000, 200_000, 250_000, 300_000, 400_000, 600_000,
];

/**
 * The largest context any counted call actually carried. The ceiling this data can price up to.
 *
 * @param transcripts every transcript folded by `./compactionFold.ts`
 * @returns the observed maximum, or 0 when nothing was counted
 */
export function observedContextCeiling({ transcripts }: { transcripts: readonly TranscriptCompaction[] }): number {
  let ceiling = 0;
  for (const transcript of transcripts) {
    for (const call of transcript.calls) {
      ceiling = Math.max(ceiling, call.contextTokens);
    }
  }
  return ceiling;
}

/** One candidate, priced, with the step out to the next and whether this corpus can price it at all. */
export interface WindowRow {
  readonly replay: WindowReplay;
  readonly tradeVsNext: Measured<WindowTrade>;
  /**
   * `known: true` when the corpus actually reached this window; otherwise the reason it cannot be priced.
   *
   * Never a quiet zero: a window the week never reached reports no compactions and no saving, which reads
   * as "free" and is the exact argument this field exists to refuse. See the module header.
   */
  readonly priceable: Measured<true>;
}

/**
 * Replay every candidate, tightest first, each paired with the trade against the next one out.
 *
 * @param transcripts every transcript folded by `./compactionFold.ts`
 * @param windows the candidate windows to price
 * @param postTokens what a compaction is modelled as dropping the context to
 * @returns one row per candidate, each carrying the trade against its looser neighbour
 */
export function replayWindows({
  transcripts,
  windows,
  postTokens,
  ranAtTokens,
}: {
  transcripts: readonly TranscriptCompaction[];
  windows: readonly number[];
  postTokens: number;
  /** The window that ACTUALLY ran over this corpus — the median real `preTokens`. Nothing above it is priceable. */
  ranAtTokens: number;
}): readonly WindowRow[] {
  const replays = windows
    .toSorted((left, right) => left - right)
    .map((windowTokens) => replayWindow({ postTokens, transcripts, windowTokens }));
  return replays.map((replay, index) => ({
    priceable: priceabilityOf({ ranAtTokens, replay, transcripts: transcripts.length }),
    replay,
    tradeVsNext: tradeAt({ index, ranAtTokens, replays }),
  }));
}

/**
 * Whether this corpus can speak for a candidate window at all.
 *
 * The test is the window that ACTUALLY ran, not the largest context anyone reached. A corpus compacting at
 * 300k contains almost no context above 300k, so every looser candidate reports a near-zero cost — and a
 * table printing that without comment is an argument for 600k built out of its own blind spot. The few
 * sessions that do exceed it are the ones left on another setting, and one of them is not a week.
 */
function priceabilityOf({
  ranAtTokens,
  replay,
  transcripts,
}: {
  ranAtTokens: number;
  replay: WindowReplay;
  transcripts: number;
}): Measured<true> {
  if (replay.transcriptsReaching === 0) {
    return unmeasurable({
      why: `no transcript in this corpus ever carried a context of ${String(replay.windowTokens)} tokens, so there is nothing here that window would have changed`,
    });
  }
  if (replay.windowTokens <= ranAtTokens) {
    return measured({ value: true });
  }
  return unmeasurable({
    why: `this corpus compacted at about ${String(ranAtTokens)} tokens, so it holds no week in which a context reached ${String(replay.windowTokens)} — only ${String(replay.transcriptsReaching)} of ${String(transcripts)} transcript(s) ever got that big. Move the window and compare two readings instead`,
  });
}

/**
 * The step out to the next looser candidate, or why there is none.
 *
 * A trade against a neighbour the same table calls NOT PRICEABLE is the blind-spot number itself wearing a
 * ratio: the looser side reports a near-zero cost only because the week never contained a context that big,
 * so the step looks free. Both ends have to be priceable or there is no trade.
 */
function tradeAt({
  index,
  ranAtTokens,
  replays,
}: {
  index: number;
  ranAtTokens: number;
  replays: readonly WindowReplay[];
}): Measured<WindowTrade> {
  const tighter = replays[index];
  const looser = replays[index + 1];
  if (tighter === undefined || looser === undefined) {
    return unmeasurable({ why: "this is the loosest window priced, so there is nothing to step out to" });
  }
  if (looser.windowTokens > ranAtTokens || looser.transcriptsReaching === 0) {
    return unmeasurable({
      why: `the next window out (${String(looser.windowTokens)}) is not priceable from this corpus, so the step cannot be priced from either end`,
    });
  }
  return windowTrade({ looser, tighter });
}
