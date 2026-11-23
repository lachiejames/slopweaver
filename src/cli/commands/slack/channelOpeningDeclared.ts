/**
 * `slack draft record` requires the `opening` declaration (`../../../outbound/artifact/channelOpening.ts`) on a
 * composed form bound for the TOP LEVEL OF A CHANNEL, as-me and `--as bot` alike: that is where a reader arrives
 * without the frame, which is what a reader could not find on the two posts that opened a pilot channel. The form schemas already refuse a declared opening their top omits; this is the half that refuses no
 * declaration at all, and it is here rather than in the schemas because only the recording knows where it goes.
 *
 * Owed by the composed kinds `./problemDeclared.ts` names — the as-me `drip`, `one-card` and `one-list`, and the bot
 * `update` and `no-fold` — and by nothing a DM (`D…`, `U…`, `W…`) or a thread reply carries. A bot `finding` leads
 * with its own claim and blast radius, and a derived card or a raw `plain` body has no authored top: the stated
 * residue. It never runs at release, so bytes the owner approved before it existed never stall.
 *
 * MEASURED while planning: 127 of the 132 parked top-level `C…`/`G…` rows in the register carry one of
 * those five kinds and none declares an opening (as me: 84 one-card, 15 one-list, 8 drip; as bot: 14 no-fold,
 * 6 update), so every one would have refused. Re-measure:
 * `jq -s 'map(select(.kind=="parked" and .draft.threadTs==null and (.draft.channel|test("^[CG]")) and ((.draft.form|fromjson?|.kind) as $k | ["drip","one-card","one-list","update","no-fold"]|index($k)) and ((.draft.form|fromjson?|.opening)==null)))|length' "$SLOPWEAVER_HOME/queue/slack-drafts.jsonl"`
 */
import { err, ok, type Result } from "#lib/result.js";
import { OPENING_UNDECLARED } from "../../../outbound/artifact/channelOpening.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import { landsTopLevelInChannel } from "../../../outbound/slack/conversationId.js";
import { NOTHING_PARKED } from "./draftMedia.js";

/** The form kinds that owe an opening on a top-level channel post. */
const OPENING_FORM_KINDS: ReadonlySet<string> = new Set(["drip", "one-card", "one-list", "update", "no-fold"]);

/**
 * Why a recording may not park for want of an `opening` declaration, or nothing when it made one, its form kind owes
 * none, or it does not land at the top level of a channel.
 *
 * @param formKind the form kind that produced the artifact — `finding` for a finding card, though it renders as an
 *   update
 * @param artifact the admitted artifact, whose `opening` field is read
 * @param channel where the recording is aimed
 * @param threadTs the root it replies under, absent for a top-level post
 * @returns the refusal lines, empty when the row may park
 */
export function openingUndeclaredRefusals({
  artifact,
  channel,
  formKind,
  threadTs,
}: {
  artifact: object;
  channel: string;
  formKind: string;
  threadTs: string | undefined;
}): readonly string[] {
  const declared = "opening" in artifact && artifact.opening !== undefined;
  if (declared || !OPENING_FORM_KINDS.has(formKind) || !landsTopLevelInChannel({ channel, threadTs })) {
    return [];
  }
  return [OPENING_UNDECLARED, NOTHING_PARKED];
}

/**
 * An as-me recording's message, passed on when its form declared what {@link openingUndeclaredRefusals} asks of it —
 * the as-me form kind is the artifact's own.
 *
 * @param message the parkable message, whose prepared plan carries the artifact
 * @param channel where the recording is aimed
 * @param threadTs the root it replies under, absent for a top-level post
 * @returns the same message, or the refusal lines
 */
export function openingDeclaredMessage<
  T extends { readonly prepared: { readonly plan: { readonly artifact: AsMeArtifact } } },
>({ channel, message, threadTs }: { channel: string; message: T; threadTs: string | undefined }): Result<T> {
  const { artifact } = message.prepared.plan;
  const refusals = openingUndeclaredRefusals({ artifact, channel, formKind: artifact.kind, threadTs });
  return refusals.length > 0 ? err(refusals) : ok(message);
}
