/**
 * What a session judged of the owner's words on a parked draft (`slack draft approve` / `hold`), as the line a post card leads
 * with. Its own module because `./queueCard.ts` imports nothing, so the caller computes the line and hands it in.
 *
 * A yes the owner gave that is not being sent must say why the moment it is recorded, never sit silent until the
 * owner notices. So the card LEADS with a hold's reason, and a row whose meaning
 * changed since the owner's yes says that it waits on their word again.
 */
import type { DraftJudgement } from "../components/live/draftJudgement";

/**
 * The line a post card leads with when a session judged the owner's words on it: why it is not sent, a change of meaning that
 * set the owner's yes down, or the yes it carries.
 *
 * @param judgement what `slack draft list --json` printed of it, absent on a row nobody judged
 * @returns the line, or `undefined` when there is nothing to lead with
 */
export function postJudgementLine({ judgement }: { judgement: DraftJudgement | undefined }): string | undefined {
  if (judgement === undefined) {
    return undefined;
  }
  if (judgement.hold !== undefined) {
    return [`NOT SENT (${judgement.hold.reason}): ${judgement.hold.why}`, ...earlierReasons({ judgement })].join(" ");
  }
  if (judgement.meaningChanged !== undefined) {
    return `Its meaning changed since your yes, so it waits on your word again: ${judgement.meaningChanged}`;
  }
  if (judgement.approval !== undefined) {
    return `You approved it: "${judgement.approval.heard.trim()}". A session owes the send.`;
  }
  return undefined;
}

/**
 * Why the owner's yes stopped standing, when a later hold replaced the one that said so: a change of meaning the current hold
 * is not about, and a yes or change an earlier not-a-yes hold (the reason `DRAFT_HOLD_REASONS` lists first, `src/outbound/slack/draftHoldReasons.ts`) set down. The card leads with the newest hold, so
 * without these a `no-fleet-slot` over a `meaning-changed` hid why the owner's yes no longer stands.
 */
function earlierReasons({ judgement }: { judgement: DraftJudgement }): readonly string[] {
  const { hold, meaningChanged } = judgement;
  const lines: string[] = [];
  if (hold !== undefined && hold.reason !== "meaning-changed" && meaningChanged !== undefined) {
    lines.push(`Its meaning changed since your yes, so it waits on your word again: ${meaningChanged}`);
  }
  const setDown = hold === undefined ? undefined : hold.setDown;
  if (hold === undefined || hold.reason === "not-owner-yes" || setDown === undefined) {
    return lines;
  }
  if (setDown.heard !== undefined) {
    lines.push(`Your yes "${setDown.heard.trim()}" was set down earlier: ${setDown.why}`);
  }
  if (setDown.change !== undefined) {
    lines.push(`A change of meaning waiting on your word was set down earlier (${setDown.change}): ${setDown.why}`);
  }
  return lines;
}

/**
 * Whether a post's judgement says why a yes is not going out — a hold, or a change of meaning that set it down — so
 * the card must stay on the owner's Queue past their landing or a waiting steer, the pass it is recorded.
 *
 * @param judgement what `slack draft list --json` printed of it, absent on a row nobody judged
 * @returns true when the card carries a hold or a change of meaning
 */
export function saysWhyNotSent({ judgement }: { judgement: DraftJudgement | undefined }): boolean {
  return judgement !== undefined && (judgement.hold !== undefined || judgement.meaningChanged !== undefined);
}

/**
 * The instant before which the owner's landed words no longer keep a held post off their Queue: a hold, or a change of meaning,
 * recorded SINCE the owner spoke is news their words have not seen, so the card comes back to say why their yes is not sent. A
 * not-a-yes hold is no such news: it is a session reading the owner's steer as "not yet", and the
 * card waits on the session's recut, not on the owner — but a dated change of meaning beside it still is news. The floor is
 * the NEWEST such instant. MEASURED: 21 held posts were drawn past the owner's steer because any hold drew
 * them past every landing whatever its age (the audit: `slopweaver handover row --slug
 * queue-audit-22-stale-cards-14-oct`).
 *
 * @param judgement what `slack draft list --json` printed of it, absent on a row nobody judged
 * @returns `{ landingFloorIso }` when the judgement is news against a landing, else nothing to spread
 */
export function postLandingFloor({ judgement }: { judgement: DraftJudgement | undefined }): {
  readonly landingFloorIso?: string;
} {
  if (judgement === undefined) {
    return {};
  }
  const { hold, judgedIso, meaningChanged } = judgement;
  const news: string[] = [];
  if (hold !== undefined && hold.reason !== "not-owner-yes") {
    news.push(hold.atIso);
  }
  // The register stamps `judgedIso` on every judgement that records a change of meaning, so a change with none is a
  // row this reading cannot date — and an undated change is never news against the owner's words. A change a
  // not-a-yes hold SET DOWN still waits on the owner's word: it is dated by the judgement, else by the hold carrying it.
  const setDownAtIso = hold?.setDown?.change === undefined ? undefined : hold.atIso;
  if ((meaningChanged !== undefined || setDownAtIso !== undefined) && judgedIso !== undefined) {
    news.push(judgedIso);
  } else if (setDownAtIso !== undefined) {
    news.push(setDownAtIso);
  }
  const newest = news.toSorted((a, b) => Date.parse(b) - Date.parse(a)).at(0);
  if (newest === undefined) {
    return {};
  }
  return { landingFloorIso: newest };
}

/**
 * What a held post's row carries from its judgement: the never-fold mark ({@link saysWhyNotSent}) and the floor below
 * which the owner's words no longer hold it ({@link postLandingFloor}), each only when it applies.
 *
 * @param judgement what `slack draft list --json` printed of it, absent on a row nobody judged
 * @returns the fields to spread onto the row
 */
export function postLandingMarks({ judgement }: { judgement: DraftJudgement | undefined }): {
  readonly saysWhyNotSent?: true;
  readonly landingFloorIso?: string;
} {
  return {
    ...(saysWhyNotSent({ judgement }) ? { saysWhyNotSent: true as const } : {}),
    ...postLandingFloor({ judgement }),
  };
}
