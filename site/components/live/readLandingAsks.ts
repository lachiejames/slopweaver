/**
 * A landing row's Slack side — its ask trail, its channel share and the verdict on whether to chase — and the
 * readers for each. A sibling of `./readLanding.ts`, under every rule its module doc states.
 */

import { type Bag, bags, bool, num, str, strings, sub } from "../../lib/bag";

/** One certified review ask on one pull request, as the verb's `askTrail` carried it. */
export interface LandingAsk {
  readonly messageKey: string;
  readonly atIso: string;
  readonly permalink: string;
  /** Where it was posted: `#dev-team`, or the direct message's own name. */
  readonly channel: string;
  readonly isDirectMessage: boolean;
  readonly leg: string;
  /** Who this message asked about THIS pull request — Slack ids, the first being the one a chase judges. */
  readonly recipients: readonly string[];
}

/**
 * Posted to a channel by the owner with nobody named, and where its business-day clock stands — the verb's
 * `channelShare`, carried as it printed it. The tone is the verb's, read at the reading's own instant.
 */
export interface LandingShare {
  readonly tone: "green" | "yellow" | "red" | "unknown";
  readonly badge: string;
  /** The one line under the badge. */
  readonly why: string;
  readonly channel: string;
  readonly permalink: string;
  readonly postedAtIso: string;
  readonly replies: number;
  /** The instant the verb read the clock at — the earlier of its two horizons when that is behind now. */
  readonly asOfIso: string;
  /** Each horizon in words — where asks and where replies are seen through, or why one is unproven. */
  readonly seen: string;
}

/** The verb's verdict on whether to chase the newest ask — its four arms, carried as it printed them. */
export type LandingBump =
  | { readonly kind: "due"; readonly silentSinceIso: string; readonly eligibleSinceIso: string }
  | { readonly kind: "replied"; readonly why: string }
  | { readonly kind: "too-soon"; readonly eligibleAtIso: string; readonly why: string }
  | { readonly kind: "unknown"; readonly why: string };

/**
 * The row's `askTrail`. Absent is an older document; present, every entry must carry every field and name
 * at least one recipient, because an ask line naming nobody — or the wrong somebody — is the row to refuse.
 *
 * @returns the trail, `undefined` when the document predates the field, or `null` when it is malformed
 */
export function askTrailOf({ row }: { row: Bag }): readonly LandingAsk[] | undefined | null {
  if (row["askTrail"] === undefined) {
    return undefined;
  }
  const held = bags({ bag: row, key: "askTrail" });
  if (held === undefined) {
    return null;
  }
  const out: LandingAsk[] = [];
  for (const ask of held) {
    const messageKey = str({ bag: ask, key: "messageKey" });
    const atIso = str({ bag: ask, key: "atIso" });
    const permalink = str({ bag: ask, key: "permalink" });
    const channel = str({ bag: ask, key: "channel" });
    const isDirectMessage = bool({ bag: ask, key: "isDirectMessage" });
    const leg = str({ bag: ask, key: "leg" });
    const recipients = strings({ bag: ask, key: "recipients" });
    if (
      messageKey === undefined ||
      atIso === undefined ||
      permalink === undefined ||
      channel === undefined ||
      isDirectMessage === undefined ||
      leg === undefined ||
      recipients === undefined ||
      recipients.length === 0
    ) {
      return null;
    }
    out.push({ atIso, channel, isDirectMessage, leg, messageKey, permalink, recipients });
  }
  return out;
}

/** The four tones the verb's channel-share clock can print. */
const SHARE_TONES: ReadonlySet<string> = new Set(["green", "yellow", "red", "unknown"]);

/**
 * Whether a string is one of the channel-share clock's tones.
 *
 * @returns true for a tone the page can draw
 */
function isShareTone(tone: string | undefined): tone is LandingShare["tone"] {
  return tone !== undefined && SHARE_TONES.has(tone);
}

/**
 * The row's `channelShare`. Absent is a row it does not apply to, or an older document — both draw the ask
 * line as before; present, every field must be there, because a badge with no post to cite is the row to refuse.
 *
 * @returns the share, `undefined` when absent, or `null` when it is malformed
 */
export function channelShareOf({ row }: { row: Bag }): LandingShare | undefined | null {
  if (row["channelShare"] === undefined) {
    return undefined;
  }
  const share = sub({ bag: row, key: "channelShare" });
  if (share === undefined) {
    return null;
  }
  const tone = str({ bag: share, key: "tone" });
  const badge = str({ bag: share, key: "badge" });
  const why = str({ bag: share, key: "why" });
  const channel = str({ bag: share, key: "channel" });
  const permalink = str({ bag: share, key: "permalink" });
  const postedAtIso = str({ bag: share, key: "postedAtIso" });
  const replies = num({ bag: share, key: "replies" });
  const asOfIso = str({ bag: share, key: "asOfIso" });
  const seen = str({ bag: share, key: "seen" });
  if (
    !isShareTone(tone) ||
    badge === undefined ||
    why === undefined ||
    channel === undefined ||
    permalink === undefined ||
    postedAtIso === undefined ||
    replies === undefined ||
    asOfIso === undefined ||
    seen === undefined
  ) {
    return null;
  }
  return { asOfIso, badge, channel, permalink, postedAtIso, replies, seen, tone, why };
}

/**
 * The row's `bump` verdict, read arm by arm.
 *
 * @returns the verdict, `undefined` when the document predates it, or `null` when it is malformed
 */
export function bumpOf({ row }: { row: Bag }): LandingBump | undefined | null {
  if (row["bump"] === undefined) {
    return undefined;
  }
  const bump = sub({ bag: row, key: "bump" });
  if (bump === undefined) {
    return null;
  }
  const kind = str({ bag: bump, key: "kind" });
  const why = str({ bag: bump, key: "why" });
  if (kind === "due") {
    const silentSinceIso = str({ bag: bump, key: "silentSinceIso" });
    const eligibleSinceIso = str({ bag: bump, key: "eligibleSinceIso" });
    if (silentSinceIso === undefined || eligibleSinceIso === undefined) {
      return null;
    }
    return { eligibleSinceIso, kind, silentSinceIso };
  }
  if (why === undefined) {
    return null;
  }
  if (kind === "too-soon") {
    const eligibleAtIso = str({ bag: bump, key: "eligibleAtIso" });
    if (eligibleAtIso === undefined) {
      return null;
    }
    return { eligibleAtIso, kind, why };
  }
  if (kind === "replied" || kind === "unknown") {
    return { kind, why };
  }
  return null;
}
