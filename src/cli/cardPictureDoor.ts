/**
 * The PICTURE question, at the bot-card POST door, on a card a session composed.
 *
 * `../outbound/assistant/citedAndShown.ts` holds the rule: a message naming three or more distinct things with
 * no picture is held once with "which of these would a picture show better than text?", and the session
 * attaches one or says why none adds value. `turn answer` asks it through its form; this is
 * the same question on `slack post|reply --as bot`, answered with `--no-picture-because "<why>"`, whose reason
 * rides the send's door-ledger row as an `unshown-items` acknowledgement.
 *
 * ## Composed cards only, MEASURED
 *
 * A card derived by a scheduled job is never asked. Run against the real Knock digest form (four
 * items, tickets `SUP-9145`/`CCCC-1909`/`KK-1770`/`JJJJ-1316`) built through `digestToUpdate`: the derived card
 * names FOUR distinct references and carries `media: []`, because `../live/automation/digestShots.ts` attaches a
 * picture only for a FIRING item. Asking it would stop an unattended daily post on a quiet day, with no
 * session there to answer. So only the `update` form kind — the one where the caller wrote the layout — is
 * composed, and a send carrying `--idempotency-key` is a scheduled firing whatever its form, so it is never
 * asked either. Reproduce by building that digest form and calling `pictureJudgement` on the derived card.
 *
 * ## The POST door only, and why the edit lane is not asked
 *
 * `slack edit` and `slack progress finish` re-render a card from a form, and the pictures a card carries were
 * uploaded at POST time through `--media`, which the edit form cannot see. Asking there would hold every edit
 * of a card that already shows its picture. The question is asked once, where the message is first sent.
 */

import type { DoorAcknowledgement } from "../admit/types.js";
import { err, ok, type Result } from "../lib/result.js";
import type { UpdateArtifact } from "../outbound/artifact/types.js";
import { pictureJudgement } from "../outbound/assistant/citedAndShown.js";
import type { BareRefContext } from "../outbound/linkify/bareRefs.js";

/** The one form kind whose layout a session wrote rather than a derivation (`../outbound/artifact/botFormKinds.ts`). */
const COMPOSED_FORM_KIND = "update";

/** How a card composer answers the question, as the refusal spells it. */
const CARD_REMEDY = '`--no-picture-because "<why>"`';

/**
 * Ask one card the picture question, and say what the send's ledger row should record.
 *
 * @param artifact the linkified card about to be posted
 * @param formKind which `BOT_FORM_KINDS` entry parsed the form
 * @param scheduled whether the send carries a scheduled firing's delivery key
 * @param mediaCount how many pictures `--media` attaches alongside the form's own `media`
 * @param noPictureBecause the session's answer, when it gave one
 * @param context the same context the bare-reference pass used
 * @returns the acknowledgements to put on the door request (empty when nothing was asked), or the refusal
 */
export function cardPictureAcknowledgements({
  artifact,
  formKind,
  scheduled,
  mediaCount,
  noPictureBecause,
  context,
}: {
  artifact: UpdateArtifact;
  formKind: string;
  scheduled: boolean;
  mediaCount: number;
  noPictureBecause: string | undefined;
  context: BareRefContext;
}): Result<readonly DoorAcknowledgement[]> {
  if (formKind !== COMPOSED_FORM_KIND || scheduled) {
    if (noPictureBecause === undefined) {
      return ok([]);
    }
    return err([
      `${CARD_REMEDY} answers a question this card is never asked — it is a derived or scheduled card, which ` +
        "has no session behind it to ask. Remove it.",
    ]);
  }
  const judgement = pictureJudgement({
    body: artifact.detail,
    context,
    index: artifact.index,
    pictureCount: artifact.media.length + mediaCount,
    reason: noPictureBecause,
    remedy: CARD_REMEDY,
  });
  if (judgement.kind === "held" || judgement.kind === "unasked") {
    return err([judgement.message]);
  }
  if (judgement.kind === "answered") {
    return ok([{ reason: judgement.reason, subject: "unshown-items" }]);
  }
  return ok([]);
}
