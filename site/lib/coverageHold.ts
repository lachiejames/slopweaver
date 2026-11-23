/**
 * What a plan call holds back from the voice: an answer claiming a whole read or a total (`./coverageClaims.ts`) while
 * a read made since the ask it answers began still stands cut (`./readCoverage.ts`). The answer never reaches the voice;
 * the thinking model is told which reads stand cut and how to read on, and answers again. Pure state, no I/O: the call
 * writes the turn and the event (`./talkPlanCallNotifications.ts`).
 *
 * Keep fetching until it is all read, and block an unsupported claim of completeness or a total before it is spoken.
 * The owner also wants reading context- and token-efficient,
 * never a walk top to bottom through verbose folds, so the hold never makes the model read everything: it may read on
 * as far as its claim needs, or answer again without the claim, saying which part it read.
 *
 * **What counts as read on.** A gap with a continuation closes only for a read of the same source (its path or
 * pointer) that STARTS at or before where the gap stopped, so a read that skipped ahead never certifies the part it
 * skipped. Such a read that is itself cut leaves its own gap in place of the old one; a read
 * that started past the gap leaves the old gap standing, the earliest part still unread. A gap no tool can continue
 * (a capped Queue list, a search that stopped short, a verb cut with no spill) stands until the next ask's turn starts
 * ({@link CoverageHold.turnStarted}), and only the claim can go.
 *
 * **Bounded.** {@link MAX_REPAIRS} sends back per ask; past them the voice is handed {@link CANDID_ANSWER} in
 * place of the claim, so a model that will not drop it never leaves the owner in silence.
 *
 * **The residue, stated.** The voice speaks through `thread/realtime/appendSpeech`, which it may paraphrase, and there
 * is no verbatim channel (`docs/console/voice-reads-on-past-a-cut.md`). So this stops the THINKING model's claim
 * before the hand-off, and cannot stop the voice adding one of its own; the after-speech checks still run for that.
 */
import { coverageClaimsOf } from "./coverageClaims";
import type { ReadCoverage, ReadGap } from "./readCoverage";

/** How many times one ask of the owner's may send an answer back to read on. */
export const MAX_REPAIRS = 2;

/** What the voice is handed in place of a claim the model kept past {@link MAX_REPAIRS} sends back. */
export const CANDID_ANSWER = "I've only read part of that so far, so I can't tell you I've read all of it.";

/** What to do with one completed answer. */
export type CoverageVerdict =
  | { readonly kind: "hand" }
  | { readonly kind: "repair"; readonly claims: readonly string[]; readonly turnText: string }
  | { readonly kind: "candid"; readonly claims: readonly string[] };

/**
 * One cut read's line in a send-back: what was cut, and the call that reads on from it, if any does.
 *
 * @param gap the read that stands cut
 * @returns the line
 */
function gapLine({ gap }: { gap: ReadGap }): string {
  if (gap.continuation === undefined) {
    return `- ${gap.what}: no tool reads the rest`;
  }
  return `- ${gap.what}: read on with ${gap.continuation.tool} ${JSON.stringify(gap.continuation.arguments)}`;
}

/**
 * The developer text that sends a held answer back to read on.
 *
 * @param claims the sentences that were held
 * @param gaps the reads that stand cut
 * @returns the text
 */
export function repairTurnText({ claims, gaps }: { claims: readonly string[]; gaps: readonly ReadGap[] }): string {
  const cut = gaps.map((gap) => gapLine({ gap }));
  const quoted = claims.map((claim) => `"${claim}"`).join(" ");
  return [
    `The console held your last answer back from the voice: it says ${quoted} while these reads stand cut:`,
    ...cut,
    "Read on with the call named for the part your answer rests on, as far as it needs and no further, then answer " +
      "again. Where no tool reads the rest, answer again saying plainly which part you read. Do not repeat the held " +
      "answer.",
  ].join("\n");
}

/**
 * Whether a read closes a gap: one of the read's named sources is the gap's, and it started at or before where the
 * gap stopped. A gap no tool continues is never closed by a read. A gap cut from one exact reading (a page's, by its
 * `reading` id) closes only for a read naming that same reading: a fresh read of a redrawn page, at the same path, read
 * other text, so the cut text stays unread.
 */
function closes({
  gap,
  named,
  start,
  reading,
}: {
  gap: ReadGap;
  named: readonly string[];
  start: number;
  reading: unknown;
}): boolean {
  if (gap.continuation === undefined || !named.includes(gap.source)) {
    return false;
  }
  // `unknown`: a cut from before a page's windows were tied to their reading carries no `reading` at all.
  const cutFrom: unknown = gap.continuation.arguments["reading"];
  if (cutFrom !== undefined && cutFrom !== reading) {
    return false;
  }
  const stoppedAt = gap.continuation.arguments["from"];
  return typeof stoppedAt !== "number" || start <= stoppedAt;
}

/** One call's cut reads since the ask now being answered began, and what each completed answer becomes. */
export class CoverageHold {
  /**
   * Each standing cut, with the turn whose read left it (`undefined` when the tool call named none) and every ask it
   * stands in. A new ask never deletes a cut, it only moves {@link CoverageHold.ask} on: an answer is judged against
   * the cuts of every ask its own turn belonged to, so no order of start notices can part an answer from its own ask's
   * reads, another turn's included.
   */
  private open: { readonly asks: readonly number[]; readonly gap: ReadGap; readonly turnId: string | undefined }[] = [];
  /** The ask now being answered, counted from the call's first. */
  private ask = 0;
  /** Every ask each turn was seen in, by a start or a tool call, so a late answer is judged in its own. */
  private readonly turnAsks = new Map<string, number[]>();
  private repairs = 0;
  /** Every turn already seen starting, so a replayed start is the same turn. */
  private readonly started = new Set<string>();
  /** Every turn seen ending: only an ended turn's cuts stay behind in its ask when a new one begins. */
  private readonly ended = new Set<string>();
  /**
   * Send-backs whose `turn/start` has not answered yet. While one is out, no start resets: any start may be its turn, and
   * nothing but its answer says which. The call waits for that answer
   * for the call's whole life, so only the answer or the call ending settles it.
   */
  private unanswered = 0;
  /**
   * Whether a send-back answered without naming its turn, an error included: an error can still start the turn
   * (the Codex app server may do so), and no later start can be told apart from it, so none resets for the rest of the
   * call. That holds claims over stale cuts; it can never pass one.
   */
  private unbound = false;
  /** Send-back turns whose `turn/start` answered before the turn was seen starting. */
  private readonly sendBackTurns = new Set<string>();

  /**
   * A tool answered: the gaps it closes go, and its own gaps stand open unless an earlier gap on the same source still
   * does.
   *
   * @param args its arguments as the model wrote them: `path` or `pointer` names the source, `from` where it started
   * @param coverage what the answer carried of its source
   * @param succeeded whether the tool ran: a failed one can leave a cut, since its content still reaches the model, but
   * never closes one, having read nothing on
   * @param turnId the turn that made the call, so that turn's own late start never wipes the cut it left
   */
  answered({
    args,
    coverage,
    succeeded,
    turnId,
  }: {
    args: Readonly<Record<string, unknown>>;
    coverage: ReadCoverage;
    succeeded: boolean;
    turnId: string | undefined;
  }): void {
    if (turnId !== undefined) {
      this.joined({ ask: this.ask, turnId });
    }
    // A failed call or a refusal read nothing, so it closes no gap; the refusal itself stands as one.
    if (succeeded && coverage.kind !== "refused") {
      const named = [args["path"], args["pointer"]].filter((value): value is string => typeof value === "string");
      const from = args["from"];
      const start = typeof from === "number" ? from : 0;
      const reading = args["reading"];
      this.open = this.open.filter((entry) => !closes({ gap: entry.gap, named, reading, start }));
    }
    if (coverage.kind === "whole") {
      return;
    }
    for (const gap of coverage.gaps) {
      // A cut of another reading at the same path is its own cut: one standing never stands for it.
      const reading = gap.continuation?.arguments["reading"];
      const standing = this.open.some(
        (entry) =>
          // The same turn's only: one turn's cut never stands in for another's, which may outlive it.
          entry.turnId === turnId &&
          entry.asks.includes(this.ask) &&
          entry.gap.source === gap.source &&
          entry.gap.continuation?.arguments["reading"] === reading &&
          // Only like for like: a cut no tool reads on never folds into one a read can close.
          ((entry.gap.continuation !== undefined && gap.continuation !== undefined) || entry.gap.what === gap.what),
      );
      if (!standing) {
        this.open.push({ asks: [this.ask], gap, turnId });
      }
    }
  }

  /** Records that a turn was seen in an ask. */
  private joined({ ask, turnId }: { ask: number; turnId: string }): void {
    const asks = this.turnAsks.get(turnId);
    if (asks === undefined) {
      this.turnAsks.set(turnId, [ask]);
      return;
    }
    if (!asks.includes(ask)) {
      asks.push(ask);
    }
  }

  /**
   * A Codex turn started. One that starts with no other running, and that is not a send-back of this hold's, answers a
   * new ask, so the next ask starts afresh. This is the boundary rather than the owner's closing transcript, because
   * that `done` often lands after the turn it started has already read, and would wipe that turn's own cuts. A turn starting while another runs, or while a send-back is unanswered, resets nothing.
   *
   * @param turnId its id, so a replayed start of the same one resets nothing
   * @param othersRunning how many other turns were running as it started
   */
  turnStarted({ turnId, othersRunning }: { turnId: string; othersRunning: number }): void {
    if (this.started.has(turnId)) {
      return;
    }
    this.started.add(turnId);
    this.boundary({ othersRunning, turnId });
    // Whatever the start meant, the turn answers the ask now current: a reset's new one, or the one it joined.
    this.joined({ ask: this.ask, turnId });
  }

  /**
   * A Codex turn ended. Its cuts then stay behind in the asks it was seen in when a new ask begins; a turn still running,
   * or one whose end has not been seen, carries its cuts into every new ask.
   *
   * @param turnId the turn that ended
   */
  turnEnded({ turnId }: { turnId: string }): void {
    this.ended.add(turnId);
  }

  /** Whether a first start of a turn begins a new ask, and if so, begins it. */
  private boundary({ turnId, othersRunning }: { turnId: string; othersRunning: number }): void {
    if (this.sendBackTurns.delete(turnId)) {
      return;
    }
    // A different start before a named send-back's own: the named one may never start under that id
    // (the Codex app server may not honour it), so no later start is safe to read as a new ask.
    if (this.sendBackTurns.size > 0) {
      this.unbound = true;
      return;
    }
    if (this.unanswered > 0 || this.unbound) {
      return;
    }
    if (othersRunning === 0) {
      // A start notice can land after its own turn has read, and a sibling's before the reading turn's own, so the start
      // cannot say which ask a running turn's cut belongs to: every cut left by a turn not yet seen ending stands in
      // this ask too. So does one whose
      // call named no turn, kept to fail closed. Each still stands in the ask it was left in, for a late answer of that
      // ask.
      this.ask += 1;
      const ask = this.ask;
      this.open = this.open.map((entry) =>
        entry.turnId === undefined || !this.ended.has(entry.turnId) ? { ...entry, asks: [...entry.asks, ask] } : entry,
      );
      this.repairs = 0;
    }
  }

  /**
   * A send-back's `turn/start` answered that it started: the turn it names is a read-on of the same ask, never a new one.
   * One already seen starting (it began while this was unanswered, or the send-back joined it) needs nothing more; one
   * not yet seen holds every reset off until it starts, and any other start first leaves the hold unbound.
   *
   * @param turnId the turn the answer named
   */
  sendBackStarted({ turnId }: { turnId: string }): void {
    this.unanswered = Math.max(0, this.unanswered - 1);
    if (!this.started.has(turnId)) {
      this.sendBackTurns.add(turnId);
    }
  }

  /** A send-back's `turn/start` answered without naming a turn, an error included: it may still have started one. */
  sendBackUnbound(): void {
    this.unanswered = Math.max(0, this.unanswered - 1);
    this.unbound = true;
  }

  /** A send-back that was never written, the call having no thread or having ended: it starts no turn. */
  sendBackRefused(): void {
    this.unanswered = Math.max(0, this.unanswered - 1);
  }

  /**
   * The reads standing cut in the ask now being answered.
   *
   * @returns the gaps, in the order first opened
   */
  gaps(): readonly ReadGap[] {
    return this.open.filter((entry) => entry.asks.includes(this.ask)).map((entry) => entry.gap);
  }

  /**
   * What one completed answer becomes: handed as written, sent back to read on, or, past {@link MAX_REPAIRS}, the
   * candid line in its place. A send back is counted here.
   *
   * @param text the answer the thinking model wrote
   * @param turnId the turn that wrote it: the cuts of every ask it was seen in count against it, whichever ask is
   * current, and every standing cut does for a turn never seen, which no ask can be placed
   * @returns the verdict
   */
  judge({ text, turnId }: { text: string; turnId: string }): CoverageVerdict {
    const asks = this.turnAsks.get(turnId);
    const counted =
      asks === undefined
        ? this.open
        : this.open.filter((entry) => entry.asks.includes(this.ask) || entry.asks.some((ask) => asks.includes(ask)));
    // The same cut left again in a later ask stands once in the send-back's list. The same cut is the same line of it:
    // two readings of one shape at one path share a `what` and differ only in the reading their read on names, so each
    // keeps its own line.
    const gaps = counted
      .filter((entry, at) => counted.findIndex((first) => gapLine(first) === gapLine(entry)) === at)
      .map((entry) => entry.gap);
    const claims = gaps.length === 0 ? [] : coverageClaimsOf({ text });
    if (claims.length === 0) {
      return { kind: "hand" };
    }
    if (this.repairs >= MAX_REPAIRS) {
      return { claims, kind: "candid" };
    }
    this.repairs += 1;
    this.unanswered += 1;
    return { claims, kind: "repair", turnText: repairTurnText({ claims, gaps }) };
  }
}
