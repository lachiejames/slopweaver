/**
 * A Queue answer's `unread` list inside a fixed byte budget, by construction.
 *
 * The list is attached AFTER the answer it rides on was fitted: `action_items` is fitted to
 * `./actionItemsFit.ts`'s 20 KiB and the screen's difference added after (`./voiceRecordQueue.ts`
 * `recordQueueAnswer`), and a card's answer is fitted under its cap before the tool knows every source its reads
 * missed (`withCardsUnread`). Unbounded, a screen differing from the record by many cards, or a long reason, would
 * carry the composed answer past the page's 24 KiB tool cap, and the page would refuse it WHOLE — the record, the
 * unread sources and the reason all lost, and for `open_card` after the console had already moved. So the list carries at most {@link UNREAD_MAX_BYTES}, and the card's cap reserves exactly that
 * (`../components/voice/openCardAnswer.ts` `cardAnswerCap`).
 *
 * Every source is still named while any can be: the reasons are shortened first, visibly, and only past the
 * shortest reason are trailing sources folded into one entry saying they were not named. Never a silent drop.
 */
import { fitJsonString } from "./actionItemsFit";
import type { UnreadSource } from "./talkActionItems";

/**
 * The most an answer's `unread` field weighs, in UTF-8 bytes of `{"unread":[…]}` — which covers the `,"unread":` it
 * adds to an answer object. Sixteen sources, the most the record names, come to about 2 KiB at a 60-byte reason, and a
 * reason is mostly shorter ("still loading", "the verb exited 1"). Kept small because a card's cap gives up exactly
 * this much briefing to it.
 */
export const UNREAD_MAX_BYTES = 2 * 1024;

/** The reason budgets tried in turn, in JSON-escaped UTF-8 bytes, longest first. */
const WHY_STEPS = [600, 300, 150, 60] as const;

/** The most a source's own name carries, JSON-escaped. */
const SOURCE_MAX_BYTES = 120;

/** The entry standing for every source past the budget. */
const PAST_BUDGET: UnreadSource = {
  source: "further sources",
  why: "past the answer's size, so not named here",
};

/** The list's weight as the answer carries it. */
function unreadBytes({ unread }: { unread: readonly UnreadSource[] }): number {
  return new TextEncoder().encode(JSON.stringify({ unread })).length;
}

/** Every entry with its name and reason fitted to a reason budget. */
function shortened({ unread, whyBytes }: { unread: readonly UnreadSource[]; whyBytes: number }): UnreadSource[] {
  return unread.map((one) => ({
    source: fitJsonString({ maxBytes: SOURCE_MAX_BYTES, text: one.source }).text,
    why: fitJsonString({ maxBytes: whyBytes, text: one.why }).text,
  }));
}

/**
 * The list within its budget, {@link UNREAD_MAX_BYTES} unless the answer it rides on leaves less: whole when it fits,
 * else every reason shortened in steps until it does, else the leading sources at the shortest reason and one entry
 * saying the rest were not named. A budget too small even for that one entry is answered with it, over the budget,
 * and the caller that set the budget checks the whole answer (`./voiceRecordQueue.ts` `withRecordUnread`).
 *
 * @param unread every source the answer could not read, in the order it names them
 * @param maxBytes the room the list may take, in the UTF-8 bytes of `{"unread":[…]}`
 * @returns the list the answer carries, over the budget only as that one entry
 */
export function fitUnread({
  unread,
  maxBytes = UNREAD_MAX_BYTES,
}: {
  unread: readonly UnreadSource[];
  maxBytes?: number;
}): readonly UnreadSource[] {
  if (unreadBytes({ unread }) <= maxBytes) {
    return unread;
  }
  let fitted: UnreadSource[] = [];
  for (const whyBytes of WHY_STEPS) {
    fitted = shortened({ unread, whyBytes });
    if (unreadBytes({ unread: fitted }) <= maxBytes) {
      return fitted;
    }
  }
  const kept: UnreadSource[] = [];
  for (const one of fitted) {
    if (unreadBytes({ unread: [...kept, one, PAST_BUDGET] }) > maxBytes) {
      break;
    }
    kept.push(one);
  }
  return [...kept, PAST_BUDGET];
}

/**
 * The unread sources as the clause a refusal speaks, "source (why), ...", held to the same budget as the list: a
 * failed verb's reason is its stderr, of any length, and a refusal worded from it is no more bounded than the list.
 *
 * @param unread every source the refusal names, in order
 * @returns the clause, never over {@link UNREAD_MAX_BYTES}
 */
export function unreadClause({ unread }: { unread: readonly UnreadSource[] }): string {
  return fitUnread({ unread })
    .map((one) => `${one.source} (${one.why})`)
    .join(", ");
}
