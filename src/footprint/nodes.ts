/**
 * What a footprint node IS, and the provenance discriminated union that decides what a row may say about it.
 *
 * ## Provenance is a union, not a label
 *
 * A Slack row cites the MESSAGE, a supervisor row quotes the owner's own words back with the day and time. The
 * reason for the second: a link to a supervisor chat on disk is something the owner will probably never open,
 * while a quote of what they said is usually remembered. So the two sources do not share a citation shape, and flattening them into
 * one row type would force one of them to lie.
 *
 * The stronger reason is epistemic rather than cosmetic. A Slack thread is witnessed organisational
 * activity with participants and an audience; a supervisor turn is private intent with no counterparty at
 * all. A supervisor-derived node therefore cannot support a claim that anybody owes anything, and it may
 * not contribute a word to text written for an audience beyond the owner — see
 * {@link isTeamVisible}, which is what an exporter filters on.
 *
 * ## The status rule, and why it is deliberately weak
 *
 * The owner speaking last in a thread proves message ORDER and nothing else. MEASURED in this repository
 * when the detector was built in the opposite direction (`../sessionStart/slackLeg.ts`): of 26 threads
 * whose last word was somebody else's, only four carried any signal that the person wanted something, and
 * three of those were closers such as a bare thanks. The symmetric mistake is to read the owner's own last word
 * as evidence that somebody is blocked on them — it is equally consistent with a decision taken in a meeting,
 * an FYI, a rhetorical question, or the owner simply finishing.
 *
 * So {@link statusOf} returns `awaiting-decision` only with three independent facts present, and
 * `status-check` otherwise. A status-check row is worth the owner's eye and is not evidence anyone owes them
 * anything, which is the difference between a queue and an accusation.
 *
 * Pure: no clock beyond the instant it is handed, no filesystem, no network.
 */

import type { EntityKey } from "./entities.js";

/** Where a node came from, and how it must be cited. */
type Provenance =
  | {
      readonly kind: "slack";
      /** The conversation id. */
      readonly channel: string;
      /** The thread ROOT timestamp. */
      readonly threadTs: string;
      /**
       * The permalink of the OWNER'S OWN message that opened this piece of work — not the thread root. A thread
       * the owner joined rather than started has a root that is somebody else's, so the provenance points at
       * the owner's own thread reply.
       */
      readonly citeUrl: string;
      /** The channel's display name where the record carried one, so a row can read `#some-channel`. */
      readonly channelName: string | undefined;
    }
  | {
      readonly kind: "supervisor";
      /** The owner's exact words, verbatim and never summarised — this IS the citation. */
      readonly quote: string;
      /** The instant the owner said it, which is the rest of the citation. */
      readonly saidAtIso: string;
    }
  | {
      readonly kind: "board";
      /** The row's slug, which is checkable on the board. */
      readonly slug: string;
    }
  | {
      readonly kind: "github";
      /** `owner/repo`. */
      readonly repo: string;
      /** The pull request or issue number. */
      readonly number: number;
      readonly url: string;
    }
  | {
      readonly kind: "linear";
      /** The issue identifier, e.g. `JJJJ-1552`. */
      readonly identifier: string;
      readonly url: string;
    }
  | {
      readonly kind: "notion";
      readonly pageId: string;
      readonly url: string;
    };

/** One thing the owner is involved in, addressed so an assignment can point back at it. */
export interface FootprintNode {
  /** Stable identity: the provenance kind and its own native key, never a rank or a label. */
  readonly id: string;
  readonly provenance: Provenance;
  /** A short human label — what a reader recognises the node by. */
  readonly label: string;
  /** The instant anything last happened on it. */
  readonly lastMovedIso: string;
  /** Whether the owner's own message is the last word. */
  readonly ownerSpokeLast: boolean;
  /** Whether the node's text carries an explicit request for a decision or input. */
  readonly asksForSomething: boolean;
  /** Whether a next step is stated as contingent on that request. */
  readonly hasDependentStep: boolean;
  /** Whether anything later resolves it — a reply, a settlement, a merged pull request. */
  readonly hasResolution: boolean;
  /** The canonical entities this node is ABOUT, already subject-scoped by its reader. */
  readonly entities: ReadonlySet<EntityKey>;
}

/**
 * What a row is allowed to claim about a node.
 *
 * `awaiting-decision` is the strong claim and needs all three facts. `status-check` is the honest default:
 * something the owner put down that has not visibly moved.
 */
export type FootprintStatus = "awaiting-decision" | "status-check" | "moving" | "resolved";

/**
 * Whether a node's evidence may be used in text written for anyone but the owner.
 *
 * Audience is a property of the OUTPUT, not of whoever ran the command: a local invocation legitimately
 * sees every source, so a manager-facing composition that filtered on the caller would see private intent
 * and use it. A supervisor turn has no audience beyond the owner and never becomes exportable by being grouped
 * alongside something that does.
 *
 * @param node the node whose evidence is being considered
 * @returns whether the node may contribute to text with an audience beyond the owner
 */
export function isTeamVisible({ node }: { node: FootprintNode }): boolean {
  return node.provenance.kind !== "supervisor";
}

/**
 * The status a node has earned.
 *
 * @param node the node to judge
 * @param nowIso the instant the clock is read at, supplied rather than read
 * @param quietHours how long with no movement before a node stops counting as moving
 * @returns the status the evidence supports, never the strongest one the shape allows
 */
export function statusOf({
  node,
  nowIso,
  quietHours,
}: {
  node: FootprintNode;
  nowIso: string;
  quietHours: number;
}): FootprintStatus {
  if (node.hasResolution) {
    return "resolved";
  }
  const moved = Date.parse(node.lastMovedIso);
  const now = Date.parse(nowIso);
  const readable = !Number.isNaN(moved) && !Number.isNaN(now);
  // An instant nobody can read must never buy a node the healthiest verdict on the list: "moving" is a
  // positive claim that something happened recently, and an unparseable timestamp is evidence of nothing.
  if (readable && (now - moved) / 3_600_000 < quietHours) {
    return "moving";
  }
  if (node.ownerSpokeLast && node.asksForSomething && node.hasDependentStep) {
    return "awaiting-decision";
  }
  return "status-check";
}

/**
 * How long a node has been quiet, in whole hours.
 *
 * @param node the node to measure
 * @param nowIso the instant the clock is read at
 * @returns whole hours since anything last happened, or 0 when either instant is unreadable
 */
export function quietHoursOf({ node, nowIso }: { node: FootprintNode; nowIso: string }): number {
  const moved = Date.parse(node.lastMovedIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(moved) || Number.isNaN(now)) {
    return 0;
  }
  return Math.max(0, Math.floor((now - moved) / 3_600_000));
}
