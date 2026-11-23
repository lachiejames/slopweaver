/**
 * The gate every verb that records a Queue card puts in front of a card saying a message was drafted as the owner: the
 * card must CARRY that message — a parked draft named by id, or an `--action` on the ask — so the console can draw it.
 *
 * ## Why this exists
 *
 * A Queue card asking the owner to react to a Slack draft must show the Slack draft, for every existing card and
 * every future one. `./namedDraftGate.ts` checks a draft a
 * card names by id; a card that names none passed it unread. MEASURED over `$SLOPWEAVER_HOME/runs`: two
 * recorded asks said a post was "drafted as you" in a DM thread or on a page, named no `sd-` id and offered no
 * action, so their cards drew nothing — repro `grep -rliE '(drafted|written|worded|composed) as you'
 * "$SLOPWEAVER_HOME/runs"`.
 *
 * ## The criterion
 *
 * The one hand steps already answer to (`../hand/draftAsOwner.ts`'s `draftAsOwnerPhrase`), never a second prose
 * heuristic: a text saying a message was drafted, written, worded or composed "as you". Read over what the card asks
 * — the question, its shape, its still-real line — and NOT over the row's slug or summary, so a row ABOUT drafts
 * does not refuse itself. Such a card is carried when it names a parked draft by id (which `./namedDraftGate.ts`
 * then checks is held) or its ask offers a message. A phrasing outside the criterion passes unseen; widen the
 * corpus in `../hand/draftAsOwner.ts` when one turns up.
 *
 * ## A POLICY refusal, with a hatch
 *
 * The card would record fine; the owner's standing rule says no. So it is the four-line shape
 * `.claude/rules/error-handling.md` requires, with its own row rather than hand post's, because a question's
 * exceptions are not a step's.
 *
 * Pure: no filesystem, no clock. The caller supplies the texts, the ids, what the ask offers and the environment.
 */

import { draftAsOwnerPhrase } from "../hand/draftAsOwner.js";
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";

/**
 * The environment variable that records a card saying a message was drafted as the owner that carries no draft.
 *
 * A LITERAL rather than `hatchEnvVar({ suffix })`: `escape-hatch` in `yarn lint` checks that a row's named
 * reader mentions its own key, and a name assembled at runtime is one no static scan can see.
 */
export const UNDRAWN_ASK_DRAFT_HATCH = "SLOPWEAVER_ALLOW_UNDRAWN_ASK_DRAFT";

/** What a card-recording verb should do with the card it was handed. */
export type UndrawnAskDraftVerdict =
  | { readonly kind: "ok" }
  /** Recordable past the hatch, but not silently. `lines` says the card carries no draft to draw. */
  | { readonly kind: "hatched"; readonly lines: readonly string[] }
  /** Not recordable. `lines` is whole — the caller prints it and adds nothing. */
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/**
 * The verdict on a card about to be recorded, with the hatch applied.
 *
 * @param texts what the card asks — the phrase is read here only, never in the row's slug or summary
 * @param draftIds the parked-draft ids anything on the card names, as `draftIdsNamed` found them
 * @param offersMessage the ask carries an `--action` the card draws, on this call or already on the run
 * @param command the door being refused, as the owner would type it
 * @param env the process environment, for the hatch
 * @returns `ok`, `hatched` with the line saying the card carries no draft, or the whole refusal to print
 */
export function undrawnAskDraftVerdict({
  texts,
  draftIds,
  offersMessage,
  command,
  env,
}: {
  texts: readonly (string | undefined)[];
  draftIds: readonly string[];
  offersMessage: boolean;
  command: string;
  env: Readonly<Record<string, string | undefined>>;
}): UndrawnAskDraftVerdict {
  const phrase = draftAsOwnerPhrase({ texts });
  if (phrase === undefined || draftIds.length > 0 || offersMessage) {
    return { kind: "ok" };
  }
  if (env[UNDRAWN_ASK_DRAFT_HATCH] === "1") {
    return {
      kind: "hatched",
      lines: [
        `${command}: recorded past ${UNDRAWN_ASK_DRAFT_HATCH}=1 — it says "${phrase}" and carries no draft, so its ` +
          "card has none to draw",
      ],
    };
  }
  const hatch = { ...hatchFor({ id: "undrawn-ask-draft" }), command };
  return {
    kind: "refused",
    lines: [
      hatchRefusal({ detail: `it says "${phrase}", names no parked draft and offers no message`, hatch }),
      "NOTHING was recorded: park the message with `slopweaver slack draft record` and name its sd- id beside the " +
        "words saying what it is, or carry it as an --action (`handover ask --action`, or `handover offer` on a " +
        "question already waiting), and run the same command again.",
    ],
  };
}
