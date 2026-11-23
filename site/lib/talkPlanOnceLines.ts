/**
 * The plan call's once-only lines — a held or failed send's outcome and a triage card's time up — each handed to
 * the voice as a developer message after its herald, once per id across the call, and never both at once, since they
 * share one busy flag (the floor's `announcing`). A triage line owes the thinking model's suggestion turn, which the
 * console starts itself the moment the line is taken (`./talkPlanOwedTurn.ts`): with
 * no turn armed, the voice answers the line itself, over the owner's own words.
 *
 * Its own file so `./talkPlanCall.ts` stays under the line cap; the call hands in its floor, its herald and its two
 * ways of handing a developer message.
 */
import type { PlanSendOutcomeNotice } from "./planCallContract";
import type { Herald } from "./talkPlanAnnounce";
import { floorRefusal, leadRefusal, type PlanFloor } from "./talkPlanFloor";
import type { VoiceAnnouncement } from "./talkVoiceProvenance";

/** One developer message handed over: `undefined` once the session took it, else its fate in words. */
type Hand = (input: { text: string; why: string }) => Promise<string | undefined>;

/** The once-only lines of one plan call. */
export class OnceLines {
  private sending = false;
  /**
   * Every send outcome the voice was handed, by its notice id, and every triage card visit whose time-up it was,
   * by the visit's id — two id shapes that never meet — so none is said twice.
   */
  private readonly said = new Set<string>();
  private readonly floor: () => PlanFloor;
  private readonly ring: Herald;
  private readonly hand: Hand;
  private readonly owe: (input: { text: string }) => Promise<string | undefined>;

  /**
   * @param floor the call's floor at the moment it is read
   * @param ring the call's herald, rung before each line
   * @param hand hands a developer message the voice answers in its own words
   * @param owe hands the triage line and arms the suggestion turn the console starts itself
   */
  constructor({
    floor,
    ring,
    hand,
    owe,
  }: {
    floor: () => PlanFloor;
    ring: Herald;
    hand: Hand;
    owe: (input: { text: string }) => Promise<string | undefined>;
  }) {
    this.floor = floor;
    this.ring = ring;
    this.hand = hand;
    this.owe = owe;
  }

  /**
   * Whether a once-only line's request is unanswered: the floor's `announcing`.
   *
   * @returns true while one is being handed
   */
  get busy(): boolean {
    return this.sending;
  }

  /**
   * One line, once per id: already said, then the floor — `busy` naming the other line in flight, and the owner's utterance
   * still open holding it too — then claimed before the write, since one that timed out may still have landed and none
   * is ever said twice. The owner's words starting during the herald's lead hand the claim back unwritten.
   *
   * @param id the send's notice id or the triage card visit's id
   * @param busy the floor's words while another once-only line is in flight
   * @param line the developer message, its herald and its provenance
   * @param turn whether the line owes a turn the console starts itself
   * @returns whether the voice was handed it, had been already, or why not
   */
  async say({
    id,
    busy,
    line,
    turn,
  }: {
    id: string;
    busy: string;
    line: VoiceAnnouncement;
    turn: "none" | "triage";
  }): Promise<PlanSendOutcomeNotice> {
    if (this.said.has(id)) {
      return { kind: "already" };
    }
    const refusal = floorRefusal({
      floor: this.floor(),
      openUtterance: "hold",
      own: [[this.sending, busy]],
      runningTurn: "hold",
    });
    if (refusal !== undefined) {
      return { kind: "refused", reason: refusal };
    }
    this.said.add(id);
    const { herald, text, what, why } = line;
    this.sending = true;
    try {
      await this.ring({ cue: herald });
      // The owner may have started talking during the lead. Nothing is written yet, so the line is unclaimed and owed again.
      const late = leadRefusal({ floor: this.floor() });
      if (late !== undefined) {
        this.said.delete(id);
        return { kind: "refused", reason: late };
      }
      // A triage line that timed out may still have landed, so its suggestion turn starts all the same, exactly as a
      // resume's owed turn does: the voice may already have said a suggestion is coming.
      const fate = turn === "triage" ? await this.owe({ text }) : await this.hand({ text, why });
      return fate === undefined
        ? { kind: "said" }
        : { kind: "failed", reason: `the voice was not handed ${what}: ${fate}` };
    } finally {
      this.sending = false;
    }
  }
}
