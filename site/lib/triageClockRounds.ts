/**
 * Which arming of the card clock is still live. Clearing a timer handle stops a callback that has not fired; it
 * cannot reach one already posting the due line, whose 409 would otherwise arm a retry and say "time is up" over a
 * card the owner opened after it. Every arm and every stop starts a new round, and a callback acts only while
 * the round it was armed in is still the live one.
 */
export class TriageClockRounds {
  private live = 0;

  /**
   * Start a round for a clock being armed, ending every earlier one.
   *
   * @returns the round the new clock's callbacks carry
   */
  arm(): number {
    this.live += 1;
    return this.live;
  }

  /** End every round, so no callback armed before this acts again. */
  stop(): void {
    this.live += 1;
  }

  /**
   * Whether a callback armed in `round` may still act.
   *
   * @param round the round its clock was armed in
   * @returns true only when nothing has armed or stopped the clock since
   */
  holds({ round }: { round: number }): boolean {
    return round === this.live;
  }
}
