/**
 * One opening's step of the Queue walk (`../../lib/cardWalk.ts`), shared by `open_card` and `triage_next` so moving on
 * means the same thing in a triage pass as outside one. Saying "next card" means the current card goes back, so
 * `triage_next` steps the walk when it opens the next card through `runOpenCard`, and a card the owner moved past in a
 * pass does not stay on their Queue. A park given
 * in the pass still keeps its card: a park landing outranks a move (`../../lib/cardLandings.ts` `landingVerdict`).
 */
import { type WalkBegan, walkOpened } from "../../lib/cardWalk";
import type { OpenCardRan } from "./openCardRun";
import type { CardWalkSeam } from "./talkToolRunTypes";

/** What the walk read before the opening ran, so the step is judged against the card open as it began. */
export interface WalkBefore {
  /** The card open on the page as the call began, `undefined` when none was. */
  readonly from: string | undefined;
  /** The walk's front card and last opening's token as the call began. */
  readonly began: WalkBegan;
  /** The walk's call-and-press stamp as the call began. */
  readonly stamp: string;
}

/**
 * Read what the step needs BEFORE the console moves anything.
 *
 * @param walk the page's Queue walk
 * @returns the open card, the walk's front card and last opening's token, and the stamp, as they stand now
 */
export function walkBefore({ walk }: { walk: CardWalkSeam }): WalkBefore {
  const { front, lastPut } = walk.read();
  return { began: { front, lastPut }, from: walk.openKeyNow(), stamp: walk.stamp() };
}

/**
 * Step the walk on one opening that finished, and write the move it made. A fresh call — pressed, typed or rolled over
 * — while the opening was in flight steps nothing: the opening belongs to neither the new walk nor the new call.
 *
 * @param walk the page's Queue walk
 * @param before what {@link walkBefore} read as the call began
 * @param ran what the opening came to; its `walk` names the card it resolved and whether it went in front of the owner
 * @param comeBack the model's `come_back_to_previous`, `undefined` for a call that carries none
 * @param requestId the tool call's own token, which names the move
 * @param nowIso when it ran
 */
export function stepCardWalk({
  walk,
  before,
  ran,
  comeBack,
  requestId,
  nowIso,
}: {
  walk: CardWalkSeam;
  before: WalkBefore;
  ran: Pick<OpenCardRan, "walk">;
  comeBack: unknown;
  requestId: string;
  nowIso: string;
}): void {
  if (walk.stamp() !== before.stamp) {
    return;
  }
  const stepped = walkOpened({
    began: before.began,
    comeBack,
    from: before.from,
    nowIso,
    opened: ran.walk?.opened === true,
    requestId,
    to: ran.walk?.cardKey,
    walk: walk.read(),
  });
  walk.write({ walk: stepped.walk });
  if (stepped.move !== undefined) {
    walk.record({ move: stepped.move });
  }
}
