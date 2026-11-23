/**
 * Which triage card was in front of the owner as each of the model's answers began, so a ruling binds to the card their words
 * were about (`triageVisitFor`, `./triageWalk.ts`). The page hears each Codex turn of its plan call begin
 * (`codex-turn`, `started`) and notes the card then current. Two answers can run side by side, and a ruling from the
 * older one can arrive after the newer one's `triage_next` put a fresh card up; their ids are opaque, so only what was
 * in front of the owner when each began can say which card the ruling meant.
 *
 * Kept for the page's life, never trimmed: an answer it forgot could not be told from one it never heard, so a ruling
 * from it would take the unheard fallback, and a replayed start of it would note a card put up since. One entry is an answer id and a visit id.
 */
import type { TriageFront, TriageWalk } from "./triageWalkTypes";

/** The card in front of the owner as each answer began. */
export class TriageTurnFronts {
  private readonly fronts = new Map<string, string | undefined>();

  /**
   * Note an answer beginning. A second start of the same answer keeps what the first saw: a replayed `turn/started`
   * says nothing about when the owner's words came. A card still opening is not yet in front of them, so an answer that began
   * then notes none, and a ruling from it binds to no card even once the open finishes.
   *
   * @param turnId the answer, the Codex turn's id
   * @param walk the pass now, `undefined` when none is held
   */
  started({ turnId, walk }: { turnId: string; walk: TriageWalk | undefined }): void {
    if (this.fronts.has(turnId)) {
      return;
    }
    const now = walk?.current;
    this.fronts.set(turnId, now?.opened === true ? now.visitId : undefined);
  }

  /**
   * The card in front of the owner as an answer began.
   *
   * @param answerId the answer a ruling came in, `undefined` when the call named none
   * @returns that visit, or `seen: false` when the page never heard the answer begin
   */
  frontOf({ answerId }: { answerId: string | undefined }): TriageFront {
    if (answerId === undefined || !this.fronts.has(answerId)) {
      return { seen: false };
    }
    return { seen: true, visitId: this.fronts.get(answerId) };
  }
}
