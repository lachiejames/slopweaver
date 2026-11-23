/**
 * The order things arrive on one voice call — the owner's utterances beginning and finishing, Codex turns starting, the
 * thinking model's messages completing — numbered by arrival, never by the wall clock, which can step backwards.
 * `HeldAnswers` (`./talkPlanHeldAnswers.ts`) reads it to judge whether a held message is overtaken
 * (`./talkPlanHeldRelease.ts`) or the same answer again (`./talkPlanRepeatAnswer.ts`). Split from that file, to keep it
 * under its 300-line cap.
 */

/** What a completed message is stamped with as it arrives. */
export interface ArrivalStamp {
  /** Its own arrival number. */
  readonly completedSeq: number;
  /** The arrival number the owner's newest finished utterance with words in it began at, `undefined` before one. */
  readonly heardBeganSeq: number | undefined;
}

/** One call's arrivals. */
export class CallArrivals {
  /** The call's last arrival number. */
  private last = 0;
  /** The arrival number the owner's open utterance began at, `undefined` while none is open. */
  private utteranceBegan: number | undefined;
  /** The arrival number the owner's newest finished utterance with words in it began at. */
  private heardBegan: number | undefined;
  /** The arrival number of the owner's newest `done` with words in it. */
  private heardDone: number | undefined;
  /**
   * Each turn whose start this call has seen, by the arrival number of its first start: a message another turn's start
   * arrived after is overtaken, and a replayed start draws no second boundary.
   */
  private readonly starts = new Map<string, number>();
  /** The turns a message has arrived from, so a start delivered after one is known to be late. */
  private readonly wrote = new Set<string>();

  /**
   * One transcript notification of the owner's, read: the start of an utterance and a `done` with words in it are each the
   * call's next arrival. The start is what says whether a turn could already have had those words; a `done` with no
   * delta before it began where it finished. The transcript's own `wasOpen` is the truth about an open utterance: one
   * it closed with no `done` — a taken resume, or the lost-`done` ceiling — has its start forgotten here, so a later
   * `done` is never stamped with a start from before a turn already answered.
   *
   * @param wasOpen whether an utterance of the owner's was open before the notification
   * @param nowOpen whether one is open after it
   * @param worded whether it was a `done` with words in it
   */
  heard({ wasOpen, nowOpen, worded }: { wasOpen: boolean; nowOpen: boolean; worded: boolean }): void {
    if (!wasOpen) {
      this.utteranceBegan = undefined;
    }
    if (!wasOpen && nowOpen) {
      this.last += 1;
      this.utteranceBegan = this.last;
    }
    if (worded) {
      this.last += 1;
      this.heardDone = this.last;
      this.heardBegan = this.last;
      if (this.utteranceBegan !== undefined) {
        this.heardBegan = this.utteranceBegan;
      }
    }
    if (!nowOpen) {
      this.utteranceBegan = undefined;
    }
  }

  /**
   * The voice is being handed a release: an utterance still open — a nudge speaks over it, or its `done` was lost — is
   * renumbered as beginning now. Without an item id two utterances cannot be told apart, so words finished after the
   * voice spoke count as new rather than inheriting a start from before a turn already answered. At the
   * hand-off, not on the write's result: a `done` in the same input chunk as that result is read before the awaited
   * result is. It only ever raises a start, so a refused write, or the same question, fails open.
   */
  voiceHanded(): void {
    if (this.utteranceBegan === undefined) {
      return;
    }
    this.last += 1;
    this.utteranceBegan = this.last;
  }

  /**
   * A Codex turn started. A replayed start of a turn already seen draws no new boundary, and nor does one arriving after
   * that turn's own message: when it really began is unknown, so it is numbered 0 and overtakes nothing rather than
   * dropping an answer still owed.
   *
   * @param turnId the turn that started
   */
  turnStarted({ turnId }: { turnId: string }): void {
    if (this.starts.has(turnId)) {
      return;
    }
    if (this.wrote.has(turnId)) {
      this.starts.set(turnId, 0);
      return;
    }
    this.last += 1;
    this.starts.set(turnId, this.last);
  }

  /**
   * A message of the turn's completed: the call's next arrival.
   *
   * @param turnId the turn that wrote it
   * @returns its stamp
   */
  wroteMessage({ turnId }: { turnId: string }): ArrivalStamp {
    this.last += 1;
    this.wrote.add(turnId);
    return { completedSeq: this.last, heardBeganSeq: this.heardBegan };
  }

  /**
   * The arrival number of the owner's newest `done` with words in it.
   *
   * @returns it, `undefined` before the owner has finished one
   */
  latestHeardDoneSeq(): number | undefined {
    return this.heardDone;
  }

  /**
   * Each turn whose start the call has seen, by the arrival number of its first start — the live map, so a caller
   * judging again after an await sees a start that arrived meanwhile.
   *
   * @returns the map
   */
  turnStarts(): ReadonlyMap<string, number> {
    return this.starts;
  }
}
