/**
 * The two things every `TurnPoster` flavour in this directory needs before it can render a frame: the
 * resolved owner tag a notice may carry, and the one renderer that turns a checklist into a Slack payload.
 */

import { renderTurnMessage } from "../../outbound/assistant/turnMessage.js";
import { NO_MENTIONS, type ResolvedMentions } from "../../outbound/slack/render.js";
import type { SlackTurnPayload, TurnChrome } from "../../outbound/slack/types.js";
import { ownerUserIdFromProfile } from "../../profileStore.js";
import { OWNER_MENTION_KEY } from "./answer.js";
import { type CardNames, frameTagIds, namedFrame } from "./cardNames.js";
import type { TurnProvenance } from "./envelope.js";
import type { TurnPoster } from "./run.js";

/*
 * `NO_MENTIONS` is re-exported rather than declared here — a harmless placeholder for a poster built only to
 * post the capture-time checklist (`postWorking`), which renders no mention. It lives beside the type it
 * satisfies now that a resolution carries people AND groups; three hand-built empty copies stood in this
 * tree when the group half landed, and each would have had to grow the second map independently.
 *
 * NOT what a notice renders with any more: a failure notice tags the owner, so `postNotice` resolves
 * `ownerTag`'s `mentions` instead. See `OWNER_MENTION_KEY` for why that is the only key it ever needs.
 */
export { NO_MENTIONS };

/**
 * The owner tag a notice may carry, decided ONCE — the key a card is allowed to write, and the map that
 * resolves it, from a single read of `profile.json`.
 *
 * One read rather than two is the whole reason this returns a pair. `resolveMention` THROWS on a person no
 * map resolves, so a card that writes the tag while the render resolves nothing is not a degraded card — it
 * is no message at all, in a thread where somebody asked a question. Two separate reads make that reachable:
 * the poster is built when the turn starts and the notice renders when it ends, and a `profile.json` edited
 * in between would leave the two disagreeing. `../../outbound/artifact/digestParts.ts`'s `decideOwners` exists
 * for the same measured reason.
 *
 * The key is FIXED (see {@link OWNER_MENTION_KEY}) rather than looked up in the derived roster, because the
 * owner is the one person the bot must be able to reach when it has nothing to say — and a roster lookup
 * would make that ping depend on the freshness of a file the failure being reported may itself be about.
 *
 * @param home the resolved state home holding `profile.json`
 * @returns the key a card may tag under (`undefined` when the profile declares no owner), and the map that
 *   resolves exactly that key
 */
export function ownerTag({ home }: { home: string }): {
  readonly key: string | undefined;
  readonly mentions: ResolvedMentions;
} {
  const owner = ownerUserIdFromProfile({ home });
  return owner === null
    ? { key: undefined, mentions: NO_MENTIONS }
    : { key: OWNER_MENTION_KEY, mentions: { groups: new Map(), people: new Map([[OWNER_MENTION_KEY, owner]]) } };
}

/**
 * One rendered frame of the working message.
 *
 * The SAME renderer for the post and for every edit, which is what keeps an advance byte-identical to the
 * post apart from the steps — a second call site with its own argument list is how a checklist ends up
 * changing its chrome halfway through a turn.
 *
 * Every person the frame tags is NAMED here, and only here — see `./cardNames.ts` for why the one renderer is
 * the one place sure to reach every frame.
 *
 * @param names who each tagged id is — `./cardNames.ts`'s `cardNameLookup` live, a plain function in a test
 * @param now the frame clock, injected for exact tests
 * @param provenance the session link and model id stamped on the frame
 * @param steps the checklist steps to render
 * @param task the bracketed task label on the author row
 * @param turnChrome the bot chrome and metadata event type stamped on the frame
 * @param turnId the id correlating this frame with its turn
 * @returns the exact `chat.postMessage`/`chat.update` payload for this frame
 */
export function turnFrame({
  names,
  now,
  provenance,
  steps,
  task,
  turnChrome,
  turnId,
}: {
  names: (args: { ids: readonly string[] }) => CardNames;
  now: () => number;
  provenance: TurnProvenance;
  steps: Parameters<TurnPoster["postWorking"]>[0]["steps"];
  task: string;
  turnChrome: TurnChrome;
  turnId: string;
}): SlackTurnPayload {
  const named = namedFrame({ names: names({ ids: frameTagIds({ steps, task }) }), steps, task });
  return renderTurnMessage({
    asOfEpochSeconds: Math.floor(now() / 1000),
    asOfFallback: "just now",
    chrome: turnChrome,
    modelId: provenance.modelId,
    steps: named.steps,
    task: named.task,
    turnId,
  });
}
