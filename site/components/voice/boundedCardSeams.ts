/**
 * What `read_card`, `open_card` and `triage_next` wait on after the record and the screen — a card's linked
 * briefings, an act's pull-request lookup, the console's move to a card, and a verb's round trip (`open_card`'s page
 * and thread through `browser_open`) — each held inside what is left of THIS
 * Queue tool call's own deadline (`./talkToolRunTypes.ts` `QueueCall`). Unbounded, they began up to twenty seconds
 * into the tool, after the record read, and carried its answer past the tool's twenty; read off a deadline the latest call had set, an overlapping later call lent an
 * earlier one its own time. Out of time, a briefing is one that could not be read, a lookup one
 * not measured, and a move one the console did not confirm, each said as such, never waited on.
 */
import type { ActPullState } from "../../lib/actPullVerb";
import type { BriefingRead } from "../../lib/briefingRead";
import type { ConsolePresentation } from "./openCardRun";
import type { runVerbTool } from "./talkToolCalls";
import type { QueueCall } from "./talkToolRunTypes";

/** What a time-up read says of itself. */
const TIME_UP = "the Queue tool's time ran out before this was read";

/** What a time-up move says: it was asked for, so it may still land, and the answer never says it did. */
const MOVE_TIME_UP = "the Queue tool's time ran out before the console said it moved, so it may still move";

/** What a time-up verb says: `browser_open` was asked for, so a page or thread may still open. */
const VERB_TIME_UP = "the Queue tool's time ran out before this verb answered, so what it opens may still open";

/** The seams this bounds. */
interface CardWaits {
  readonly readBriefing: (input: { readonly slug: string }) => Promise<BriefingRead>;
  readonly actLookup: (input: { readonly branch: string }) => Promise<ActPullState>;
  readonly presentConsole: (input: { readonly path: string }) => Promise<ConsolePresentation>;
  readonly verb: typeof runVerbTool;
}

/**
 * The seams, bounded by one call's deadline.
 *
 * @param seams the briefing read, the act lookup, the console move and a verb round trip (`open_card`'s page and
 *   thread), unbounded
 * @param within the call's own deadline race
 * @returns the same seams, each inside the deadline
 */
export function boundedCardSeams({ seams, within }: { seams: CardWaits; within: QueueCall["within"] }): CardWaits {
  return {
    verb: ({ name, args }) =>
      within({
        ask: () => seams.verb({ args, name }),
        late: { answer: { refused: VERB_TIME_UP }, detail: VERB_TIME_UP, refused: true },
      }),
    actLookup: ({ branch }) =>
      within({ ask: () => seams.actLookup({ branch }), late: { branch, phase: "not-measured", why: TIME_UP } }),
    presentConsole: ({ path }) =>
      within({ ask: () => seams.presentConsole({ path }), late: { kind: "refused", why: MOVE_TIME_UP } }),
    readBriefing: ({ slug }) => within({ ask: () => seams.readBriefing({ slug }), late: { ok: false, why: TIME_UP } }),
  };
}
