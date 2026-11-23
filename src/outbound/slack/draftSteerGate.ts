/**
 * The release gate a channel steer arms: a held row whose re-cut lineage carries the owner's words naming another
 * channel for it is refused while it still targets a channel they did not name — pure.
 *
 * MEASURED: the owner steered a held draft from a programme channel to the security channel on a call; the chair
 * re-cut it "same channel", and a seat released that into the programme channel on the owner's pre-approval, a
 * public mistake. The steer is now a `steered` event on the draft (`./draftChannelSteer.ts` reads it out of the
 * owner's words), and this is what a release asks of it.
 *
 * ## The lineage, and why the LATEST steer wins
 *
 * A re-cut is a new row with its own digest, so a steer on the row it supersedes must follow it — that is the incident
 * exactly. The gate walks the row and every ancestor `./draftSpent.ts`'s {@link draftAncestorIds} reads, and takes the
 * newest steer across all of them: if the owner moves a draft to #dev-alerts and later says "actually, #proj-launch-room",
 * the later word stands. Two steers at one instant favour the row being released. Every steer read here is one the
 * fold kept: a VOID one, whole words naming its channel only inside a URL (`./draftChannelSteer.ts`'s `channelSteerIsVoid`,
 * a pasted permalink), never reaches a row, while a cut one still does.
 *
 * ## What passes
 *
 * The row targets one of the latest steer's channels — a re-cut INTO the steered channel, which is the fix — or the
 * journalled `channel-steered-draft` grant is open for this session. The refusal prints the re-cut command per allowed
 * channel. No new hold reason: an approved row left unsent with no hold is already owed at every chair tick
 * (`../../supervisor/approvedDraftGate.ts`), so the refusal reaches the chair on its next release attempt, and a row
 * held for another reason stays where that hold put it.
 *
 * ## Residue, stated
 *
 * A steer appended after a release's LAST register read and before Slack takes the message is not seen by that
 * release; the release re-reads the register after its live gates to narrow that window, and the send call itself is
 * the window left (`../../cli/commands/slack/releaseRow.ts`'s `rowMovedBeforeSend`).
 */
import { hatchFor } from "../../hatch/lookup.js";
import { hatchRefusalLines } from "../../hatch/render.js";
import { parseStrictIsoInstantMs } from "../../lib/date.js";
import type { DraftChannelSteer, SlackDraftItem } from "./draftRegister.js";
import { draftAncestorIds } from "./draftSpent.js";

/**
 * The newest channel steer across a row and its re-cut ancestors, or `undefined` when none carries one.
 *
 * @param item the row a release would send
 * @param items every folded row, for the lineage
 * @returns the steer that decides where the row may go
 */
export function latestChannelSteer({
  item,
  items,
}: {
  item: SlackDraftItem;
  items: readonly SlackDraftItem[];
}): DraftChannelSteer | undefined {
  const ancestors = new Set(draftAncestorIds({ item, items }));
  // Nearest first is the walk's order; the register's own order is enough here, since only the newest instant counts
  // and the row itself is read first so it wins a tie.
  const lineage = [item, ...items.filter((one) => ancestors.has(one.id))];
  // Compared as instants, never as strings: the log admits an offset, so a later-looking offset
  // time can be half an hour earlier. The parse cannot fail, because `draftLog.ts` admitted the same text.
  let latest: { at: number; steer: DraftChannelSteer } | undefined;
  for (const row of lineage) {
    if (row.steer === undefined) {
      continue;
    }
    const at = parseStrictIsoInstantMs({ text: row.steer.tsIso })!;
    if (latest === undefined || at > latest.at) {
      latest = { at, steer: row.steer };
    }
  }
  return latest?.steer;
}

/**
 * The steer a row does not honour: the latest one across its lineage, when the row's channel is none it names.
 *
 * @param item the row a release would send
 * @param items every folded row
 * @returns the unmet steer, or `undefined` when there is none or the row already goes where the owner said
 */
export function unmetChannelSteer({
  item,
  items,
}: {
  item: SlackDraftItem;
  items: readonly SlackDraftItem[];
}): DraftChannelSteer | undefined {
  const steer = latestChannelSteer({ item, items });
  if (steer === undefined || steer.channels.some((channel) => channel.id === item.draft.channel)) {
    return undefined;
  }
  return steer;
}

/**
 * The refusal a release of this row owes, or none.
 *
 * @param item the row a release would send
 * @param items every folded row
 * @param hatchOpen whether the journalled `channel-steered-draft` grant is open for this session
 * @returns the four-line refusal plus one re-cut command per channel the owner named; empty when the release may go
 */
export function channelSteerRefusal({
  hatchOpen,
  item,
  items,
}: {
  hatchOpen: boolean;
  item: SlackDraftItem;
  items: readonly SlackDraftItem[];
}): readonly string[] {
  const steer = unmetChannelSteer({ item, items });
  if (steer === undefined || hatchOpen) {
    return [];
  }
  return [
    ...hatchRefusalLines({
      detail: channelSteerDetail({ item, steer }),
      hatch: hatchFor({ id: "channel-steered-draft" }),
    }),
    ...steer.channels.map(
      (channel) =>
        `Re-cut it into #${channel.name}: slopweaver slack draft record <the same flags> --channel ${channel.id} --supersedes ${item.id}`,
    ),
  ];
}

/**
 * One sentence naming the steer for the reader of a refusal or a chair line.
 *
 * @param item the row the steer is unmet on
 * @param steer the latest unmet one across the row's lineage
 * @returns where the row goes, where the owner said, when, and the anchor to hear it
 */
function channelSteerDetail({ item, steer }: { item: SlackDraftItem; steer: DraftChannelSteer }): string {
  const allowed = steer.channels.map((channel) => `#${channel.name}`).join(" or ");
  const where = item.draft.channelName === undefined ? item.draft.channel : `#${item.draft.channelName}`;
  return `${item.id} goes to ${where}, but at ${steer.tsIso} the owner named ${allowed} for it (${steer.anchor}: "${steer.heard}")`;
}
