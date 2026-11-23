/**
 * The gate `hand post` puts in front of a step asking the owner to react to a message drafted as them: the step must
 * CARRY that message, so the console can draw it on the card.
 *
 * ## Why this exists
 *
 * A card asking the owner to read drafted replies has to show those replies. A card that said "Read the two
 * replies drafted as you" with no draft on it left the owner nowhere to click to find them. The reply WAS parked,
 * on the ask the step opened, and the card never drew it. `../handover/namedDraftGate.ts` only checks a draft the text names by id; a step that talks
 * about a draft and names none passed every gate there was.
 *
 * ## The criterion
 *
 * A step's `what` or `where` NAMES A DRAFT AS THE OWNER when it says a message was drafted, written, worded or composed
 * "as you". "Your draft reply" and "drafted under your name" are left out on
 * purpose: Codex found "your draft message retention policy" and "a contract drafted under your name" read the same,
 * and no pattern separates a message from a document there. It is a prose heuristic, so a phrasing outside it passes unseen — widen the corpus when one turns up. Such a step
 * must carry the draft one of two ways the card can draw:
 *
 * - it names a parked Slack draft by id (`sd-…`), which `namedDraftGate` then checks is held; or
 * - it opens an ask (`--open ask:<slug>`) that is waiting on the owner and offers a message (`handover offer`).
 *
 * ## A POLICY refusal, with a hatch
 *
 * The step would record fine; the owner's standing rule says no. So it is the four-line shape
 * `.claude/rules/error-handling.md` requires. The fix is nearly always to park the message
 * (`slopweaver slack draft record`) and name its id, or to open the ask that offers it.
 *
 * Pure: no filesystem, no clock. The caller supplies the texts, what the opened ask offers and the environment.
 * `site/lib/draftAsOwner.ts` restates the criterion, because the console cannot import `src/`.
 */

import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";

/**
 * The environment variable that records a step naming a draft as the owner that it does not carry.
 *
 * A LITERAL rather than `hatchEnvVar({ suffix })`: `escape-hatch` in `yarn lint` checks that a row's named
 * reader mentions its own key, and a name assembled at runtime is one no static scan can see.
 */
export const UNDRAWN_DRAFT_HATCH = "SLOPWEAVER_ALLOW_UNDRAWN_DRAFT";

/**
 * "drafted as you", "written as you", "worded as you", "composed as you". "as you" must end the
 * text or meet punctuation, a preposition, or an "and" naming the message's send state — "written as you speak" and
 * "written as you and Seth discussed" name no author (Codex), while "drafted as you and UNSENT" was an ask recorded
 * with no draft on its card. The state is a closed list: any other word after "and" may be a person,
 * and a comma opening a list of people ("as you, Seth, and I discussed") ends nothing either.
 */
const DRAFTED_AS_YOU =
  /\b(?:drafted|written|worded|composed)\s+(?:as\s+you(?=\s*$|\s*,(?!\s*[^\s,]+,?\s+and\s)|\s*[.;:!?)\u2013\u2014-]|\s+(?:on|in|to|for|at|about|from)\b|\s+and\s+(?:un(?:sent|posted)|not\s+(?:yet\s+)?(?:sent|posted)|waiting|ready|parked|held)\b))/iu;

/**
 * The first phrase in the texts that names a message drafted as the owner, or `undefined` when none does.
 *
 * @param texts the step's `what` and `where`; an absent one is skipped
 * @returns the phrase as the text spells it, so a refusal can quote it
 */
export function draftAsOwnerPhrase({ texts }: { texts: readonly (string | undefined)[] }): string | undefined {
  for (const text of texts) {
    if (text === undefined) {
      continue;
    }
    const found = DRAFTED_AS_YOU.exec(text);
    if (found !== null) {
      return found[0];
    }
  }
  return undefined;
}

/**
 * What the ask a step opens offers, as far as the gate cares: no ask opened, an ask with no message to draw, or
 * an ask that offers one.
 */
export type OpenedAskOffer = "no-ask" | "offers-none" | "offers-message";

/** What `hand post` should do with the step it was handed. */
export type UndrawnDraftVerdict =
  | { readonly kind: "ok" }
  /** Recordable past the hatch, but not silently. `lines` says the card will show its draft missing. */
  | { readonly kind: "hatched"; readonly lines: readonly string[] }
  /** Not recordable. `lines` is whole — the caller prints it and adds nothing. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * The verdict on a step about to be recorded, with the hatch applied.
 *
 * @param texts the step's `what` and `where`
 * @param draftIds the parked-draft ids the step names, as `draftIdsNamed` found them
 * @param opened what the ask the step opens offers
 * @param command the door being refused, as the owner would type it
 * @param env the process environment, for the hatch
 * @returns `ok`, `hatched` with the line saying the card will show the draft missing, or the whole refusal to print
 */
export function undrawnDraftVerdict({
  texts,
  draftIds,
  opened,
  command,
  env,
}: {
  texts: readonly (string | undefined)[];
  draftIds: readonly string[];
  opened: OpenedAskOffer;
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): UndrawnDraftVerdict {
  const phrase = draftAsOwnerPhrase({ texts });
  if (phrase === undefined || draftIds.length > 0 || opened === "offers-message") {
    return { kind: "ok" };
  }
  if (env[UNDRAWN_DRAFT_HATCH] === "1") {
    return {
      kind: "hatched",
      lines: [
        `recorded past ${UNDRAWN_DRAFT_HATCH}=1: it says "${phrase}" and carries no draft, so its card will say the ` +
          "draft is missing",
      ],
    };
  }
  let carried = "it names no parked draft and opens no ask";
  if (opened === "offers-none") {
    carried = "it names no parked draft, and the ask it opens offers no message";
  }
  const hatch = { ...hatchFor({ id: "undrawn-draft" }), command };
  return {
    kind: "refused",
    lines: [
      hatchRefusal({ detail: `it says "${phrase}", and ${carried}`, hatch }),
      "NOTHING was recorded: park the message with `slopweaver slack draft record` and name its sd- id in --what, in " +
        "parentheses after the words saying what the message is, " +
        "or --open the ask that offers it (`slopweaver handover offer`), and run the same command again.",
    ],
  };
}
