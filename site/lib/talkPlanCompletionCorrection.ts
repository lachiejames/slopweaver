/**
 * The correction a call has the voice say, aloud and at once, when one of its sentences claimed an act done that
 * nothing on the call grounds, promised fleet work as its own, or said a draft was on the owner's running list with no offer
 * landed. Split from `./talkPlanCall.ts`, to keep it under its 300-line cap; the call
 * owns the floor and the write, this owns only when the correction goes.
 *
 * The first shape: the voice finishes "Your steered vuln fix top up for Acme admin posted and missed the deadline."
 * The page's check (`./talkSpokenClaims.ts`) finds, two milliseconds later, that nothing said it was posted and keeps
 * that for the thinking thread — and if the voice is never told, the false "posted" stands until the owner points it
 * out. The voice checks "posted" against the record, not seventeen seconds after with nobody told. Audio and
 * transcript stream together, so a sentence the realtime model composes cannot be checked before it is heard; its
 * correction is the soonest the call can act. The second shape: the thinking model writes "The fleet will produce
 * that separate briefing" and the voice says "I'll get you that briefing", when the fleet produces briefings and the
 * voice does not (`./talkFleetPromises.ts`). The third: "I've put a revision on your running list" with no offer run
 * (`./talkRunningListClaims.ts`).
 *
 * Narrow on purpose, because a correction is a line the owner did not ask for: only a
 * done claim, a fleet promise or a running-list claim, never a count, a PR number or a repeated ask; FIXED words
 * (`claimCorrectionSpeech`), never a
 * developer message the voice words itself, which is how a correction becomes a second invention; said once per claim,
 * the claims one sentence made coalesced into one; and dropped rather than said late — past
 * {@link CORRECTION_STALE_MS} it would arrive out of nowhere, and the thread already holds the kept grounding.
 */
import { PLAN_CALL_LIMITS } from "./planCallContract";
import { completionCorrectionRefusal, type PlanFloor } from "./talkPlanFloor";
import type { CallClock } from "./talkPlanStart";
import { claimCorrectionSpeech } from "./talkPlanWords";
import type { CorrectableClaimShape } from "./talkSpokenClaims";

/** How long after a claim was owed its correction may still be said; past it, it is dropped unsaid. */
export const CORRECTION_STALE_MS = 15_000;

/**
 * How long after a correction is handed over a new claim is not corrected again: the voice paraphrases what it is
 * handed, so a correction reworded into a claim would otherwise correct itself.
 */
export const CORRECTION_ECHO_MS = 10_000;

/** What the correction reads off its call. */
export interface CompletionCorrectionCall {
  readonly ended: () => boolean;
  readonly floor: () => PlanFloor;
  /** A running-list notice's request is unanswered, a line of the server's the floor does not carry. */
  readonly noticing: () => boolean;
  /** Has the voice speak one fixed sentence; resolves once the session answered, however it answered. */
  readonly speak: (input: { text: string; why: string }) => Promise<unknown>;
}

/** One claim owed a correction: its grounding key, its closed shape, and when it was owed. */
interface OwedClaim {
  readonly key: string;
  readonly claim: CorrectableClaimShape;
  readonly owedMs: number;
}

/**
 * One call's completion corrections. A claim is owed by its grounding key, so the page's retried post owes nothing
 * more; the first try waits {@link PLAN_CALL_LIMITS.rolloverPollMs}, so the claims of one sentence go as one, and
 * another goes every poll the floor still holds it. A correction handed over is never handed again, whatever the
 * session answered: one that timed out may still have been said, and a correction said twice is worse than one lost.
 * It goes through the call's own fixed-speech write, so like any line of the server's it spaces the next one by
 * {@link PLAN_CALL_LIMITS.lookGapMs} after it, on purpose (that spacing is the floor working, not a change).
 */
export class CompletionCorrection {
  /** The claims owed, oldest first. */
  private owed: OwedClaim[] = [];
  /** Every key ever owed this call, so a repeat owes nothing. */
  private readonly seen = new Set<string>();
  /** A correction's request is unanswered. */
  private sending = false;
  /** When a correction was last handed over. */
  private lastHandedMs: number | undefined;
  /** A try is armed. */
  private armed = false;
  private readonly call: CompletionCorrectionCall;
  private readonly clock: CallClock;

  /**
   * The corrections of one call.
   *
   * @param call whether it ended, its floor, and the fixed-speech write
   * @param clock the call's clock, which each try is armed on
   */
  constructor({ call, clock }: { call: CompletionCorrectionCall; clock: CallClock }) {
    this.call = call;
    this.clock = clock;
  }

  /**
   * Whether a correction's request is unanswered, which holds the call's other own writes.
   *
   * @returns true while one is being handed over
   */
  get busy(): boolean {
    return this.sending;
  }

  /**
   * Whether a correction is owed and not yet stale, which a Codex turn's outcome line waits behind: a slow outcome
   * write would otherwise hold the correction past {@link CORRECTION_STALE_MS}.
   *
   * @returns true while one is owed
   */
  get owes(): boolean {
    const nowMs = this.clock.nowMs();
    return this.owed.some((claim) => nowMs - claim.owedMs < CORRECTION_STALE_MS);
  }

  /**
   * Owe a correction for one ungrounded done claim, fleet promise or running-list claim, once per key.
   *
   * @param key the claim's grounding key, as the page posted it
   * @param claim the closed shape it was posted as: the act claimed done, a fleet promise or a running-list claim
   * @returns `undefined` once owed, else why it is not
   */
  owe({ key, claim }: { key: string; claim: CorrectableClaimShape }): string | undefined {
    if (this.call.ended()) {
      return "the call has ended";
    }
    if (this.seen.has(key)) {
      return "that claim is already owed a correction";
    }
    this.seen.add(key);
    const nowMs = this.clock.nowMs();
    if (this.lastHandedMs !== undefined && nowMs - this.lastHandedMs < CORRECTION_ECHO_MS) {
      return "a correction was handed over moments ago, so this claim is kept and not corrected again";
    }
    this.owed.push({ claim, key, owedMs: nowMs });
    this.arm();
    return undefined;
  }

  /**
   * Try what is owed shortly, once: one try is armed at a time, and none after the call ends — nor does one armed
   * before it say anything, since every try reads the call's end first.
   */
  private arm(): void {
    if (this.call.ended() || this.armed) {
      return;
    }
    this.armed = true;
    this.clock.after({
      ms: PLAN_CALL_LIMITS.rolloverPollMs,
      run: () => {
        this.armed = false;
        void this.attempt();
      },
    });
  }

  /** Hand over one correction for every claim still owed and not stale, or wait another poll for the floor. */
  private async attempt(): Promise<void> {
    const nowMs = this.clock.nowMs();
    this.owed = this.owed.filter((claim) => nowMs - claim.owedMs < CORRECTION_STALE_MS);
    if (this.call.ended() || this.owed.length === 0) {
      return;
    }
    const [first, ...rest] = this.owed;
    if (
      this.sending ||
      this.call.noticing() ||
      completionCorrectionRefusal({ floor: this.call.floor() }) !== undefined
    ) {
      this.arm();
      return;
    }
    this.owed = [];
    this.sending = true;
    this.lastHandedMs = nowMs;
    const claims: [CorrectableClaimShape, ...CorrectableClaimShape[]] = [
      first.claim,
      ...rest.map((each) => each.claim),
    ];
    try {
      await this.call.speak({
        text: claimCorrectionSpeech({ claims }),
        why:
          "the voice just claimed something done that nothing on the call said was done, promised fleet work as its " +
          "own, or said a draft was on the owner's running list with no offer landed, so it corrects itself",
      });
    } finally {
      this.sending = false;
      if (this.owed.length > 0) {
        this.arm();
      }
    }
  }
}
