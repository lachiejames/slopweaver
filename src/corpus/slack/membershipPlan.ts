/**
 * The Slack STRUCTURE lane's membership budget: which conversations get a `conversations.members` call, per
 * {@link SlackStructureLane}. Pure; `./structures.ts` is what spends the plan.
 */
import { isRecord } from "../../lib/parsers.js";
import { type SlackStructureLane, slackStructureLaneLabel } from "./lanes.js";
import { optStr as slStr } from "./shape.js";

/** The channel id + whether membership should be fetched for it. */
interface ChannelPlanEntry {
  readonly raw: unknown;
  readonly id: string;
  readonly fetchMembership: boolean;
}

/** The membership plan: which channels get a `conversations.members` call + the skip warning. */
export interface ChannelMembershipPlan {
  readonly entries: readonly ChannelPlanEntry[];
  readonly warnings: readonly string[];
}

/**
 * Plan channel membership: archived channels never get a membership call, and — when a cap is given — only
 * the first `cap` ACTIVE channels do. Every skipped active channel is logged, never silently dropped. Pure.
 *
 * **There is no default cap.** A default of 50 meant, on the
 * owner's workspace, about six hundred channels discovered, membership resolved for exactly 50, and some four hundred active
 * channels never asked about at all — while ZERO of the 50 that were asked came back with no members. So
 * every empty membership list in silver was an unasked question wearing the same shape as an answer.
 *
 * The trade, stated rather than buried: uncapped costs one `conversations.members` call per active channel,
 * several hundred today against 50, paced by the client's own rate-limit handling (`./api`). That is the whole cost —
 * the structures lane is a background refresh, and it is the only lane that calls `conversations.members`.
 * A caller who wants the old behaviour passes `--slack-membership-cap`, and a capped run still says so both
 * in this warning and, per channel, in `membershipResolved`.
 *
 * `cap` is OPTIONAL rather than a large sentinel: `Number.POSITIVE_INFINITY` compares correctly here but
 * serialises to `null`, so a plan that ever reached a `--json` report would claim a cap it does not have.
 *
 * **The cap is ONE LANE'S budget, and `lane` is required so it can never quietly become a shared one.** The
 * caller plans each {@link SlackStructureLane} separately: with hundreds of channels discovered ahead of
 * dozens of group DMs, a single budget spent in discovery order means any cap below the channel count resolves membership for exactly zero
 * group DMs — and a group DM's member list is the audience answer that lane was added to get. That is the
 * same starvation the read lane's per-lane `maxItems` prevents in `./discovery.ts`, reproduced one module
 * over, so the warning names the class too rather than reporting one undifferentiated count.
 *
 * @param channels the raw discovered conversations for this lane, in discovery order
 * @param lane which structural class these rows came from, named in the skip warning
 * @param cap the max active conversations IN THIS LANE to resolve membership for; omit for every one of them
 * @returns the per-channel plan + the skip warning
 */
export function planChannelMembership({
  channels,
  lane,
  cap,
}: {
  channels: readonly unknown[];
  lane: SlackStructureLane;
  cap?: number;
}): ChannelMembershipPlan {
  let activeFetched = 0;
  const entries: ChannelPlanEntry[] = [];
  let skipped = 0;
  for (const raw of channels) {
    const id = isRecord(raw) ? slStr({ value: raw["id"] }) : undefined;
    if (id === undefined) {
      continue;
    }
    const archived = isRecord(raw) && raw["is_archived"] === true;
    const withinCap = cap === undefined || activeFetched < cap;
    const canFetch = !archived && withinCap;
    if (canFetch) {
      activeFetched += 1;
    } else if (!archived) {
      skipped += 1;
    }
    entries.push({ fetchMembership: canFetch, id, raw });
  }
  // `cap` is necessarily defined here: with none, `withinCap` is always true and nothing active is skipped.
  const label = slackStructureLaneLabel({ lane });
  const warnings =
    skipped > 0
      ? [
          `slack: channel-membership cap ${String(cap)} applied to the ${label} lane — ${String(skipped)} active ${label}(s) not resolved`,
        ]
      : [];
  return { entries, warnings };
}
