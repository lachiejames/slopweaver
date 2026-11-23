/**
 * The `slopweaver slack unread` document — the owner's unread DMs first, then their activity, one line each — the pure half.
 *
 * The gist the owner wants is unread DMs and then unread activity, DMs first. Each thread row carries the shape:
 * which channel it is in, which people, a one-line quote and how many replies — the first probe — with the whole
 * thread fetched only when the owner names one.
 *
 * ## Two halves, and "unread" means a different, stated thing in each
 *
 * - **A DM row is Slack's own read marker.** `conversations.info` on the owner's user token answers `last_read`
 *   and the sidebar count (`./readMarker.ts`), so a DM row is unread in exactly the sense the owner's sidebar
 *   bolds it.
 * - **An activity row is a person's word since the owner's.** No public method answers a thread's read state, so
 *   a thread the owner spoke in — or was tagged in — is listed when a PERSON has spoken there since the owner's
 *   last word. Whether the owner has seen it is not known, and {@link UNREAD_MEANING} says so on every document.
 *
 * One row from one read is `./unreadRows.ts`. Pure: no clock, no network. The reads are
 * `src/cli/commands/slack/unreadRead.ts` and `unreadDms.ts` beside it.
 */
import type { SlackNameMaps } from "../../corpus/slack/visibleProse.js";
import {
  dmRowOf,
  type PersonOf,
  threadRowOf,
  type UnreadAppDm,
  type UnreadDmRead,
  type UnreadDmRow,
  type UnreadThreadRead,
  type UnreadThreadRow,
} from "./unreadRows.js";

/** What "unread" means on this document, said on every one so the voice never claims more. */
export const UNREAD_MEANING =
  "A DM is unread by Slack's own read marker, as your sidebar shows it. An activity row is a thread you spoke or " +
  "were tagged in where a person has spoken since your last word there; Slack does not say whether you have seen " +
  "it, so never say you have not.";

/** The most DM rows listed; the rest are counted. */
export const UNREAD_DM_ROWS = 10;

/** The most activity rows listed; the rest are counted. */
const UNREAD_ACTIVITY_ROWS = 12;

/** The whole document. */
export interface SlackUnreadDocument {
  readonly producer: "slack unread";
  readonly readAtIso: string;
  /** `unavailable` reads nothing; `incomplete` lists what was read, and the residue names what was not. */
  readonly status: "complete" | "incomplete" | "unavailable";
  readonly meaning: string;
  readonly dms: {
    readonly sinceIso: string;
    /** How many DMs' read markers were told, so "none unread" says how many it is true of. */
    readonly checked: number;
    readonly rows: readonly UnreadDmRow[];
    /** Unread human DMs past {@link UNREAD_DM_ROWS}. */
    readonly more: number;
    readonly apps: readonly UnreadAppDm[];
  };
  readonly activity: {
    readonly sinceIso: string;
    readonly rows: readonly UnreadThreadRow[];
    /** Threads past {@link UNREAD_ACTIVITY_ROWS}. */
    readonly more: number;
    /** Posts tagging the owner that named no author, an app's, so listed nowhere; absent when there were none. */
    readonly appTagsNotListed?: number;
  };
  /** What this read could not see, in words the voice can repeat. */
  readonly residue: readonly string[];
}

/** What both reads hand the document. */
export interface SlackUnreadInput {
  readonly ownerId: string;
  readonly readAtIso: string;
  readonly dmSinceIso: string;
  readonly activitySinceIso: string;
  readonly dms: readonly UnreadDmRead[];
  /** How many DMs' read markers were told, unread or not. */
  readonly dmsChecked: number;
  readonly threads: readonly UnreadThreadRead[];
  readonly person: PersonOf;
  readonly maps: SlackNameMaps;
  /** Whether either read stopped short of what it set out to read. */
  readonly incomplete: boolean;
  readonly residue: readonly string[];
  /** Posts tagging the owner that named no author: a real omission, which never fails the status (`slackUnreadAnswers`). */
  readonly appTagsNotListed: number;
}

/**
 * Build the document both reads produced: DMs first, then activity, newest first in each, capped.
 *
 * @param input the reads and what they could not see
 * @returns the document
 */
export function slackUnreadDocument({ input }: { input: SlackUnreadInput }): SlackUnreadDocument {
  const { ownerId, person, maps } = input;
  const dmRows: UnreadDmRow[] = [];
  const apps: UnreadAppDm[] = [];
  let unsaid = 0;
  for (const read of input.dms) {
    const built = dmRowOf({ maps, ownerId, person, read });
    if (built === undefined) {
      unsaid += 1;
    } else if ("row" in built) {
      dmRows.push(built.row);
    } else {
      apps.push(built.app);
    }
  }
  const threadRows = input.threads
    .map((read) => threadRowOf({ maps, ownerId, person, read }))
    .filter((row): row is UnreadThreadRow => row !== undefined);
  const dms = dmRows.toSorted((a, b) => newestFirst({ a: a.atIso, b: b.atIso }));
  const activity = threadRows.toSorted((a, b) => newestFirst({ a: a.atIso, b: b.atIso }));
  const dmMore = Math.max(dms.length - UNREAD_DM_ROWS, 0);
  const activityMore = Math.max(activity.length - UNREAD_ACTIVITY_ROWS, 0);
  // A row past a cap is counted, never listed with its link, so it is a short read like any other — said, and
  // never under a `complete` status.
  const unlisted = [
    ...(unsaid > 0
      ? [`${String(unsaid)} DM(s) Slack counts unread could not have their messages read, so they are not listed`]
      : []),
    ...(dmMore > 0 ? [`${String(dmMore)} older unread DM(s) are counted, not listed`] : []),
    ...(activityMore > 0 ? [`${String(activityMore)} older thread(s) are counted, not listed`] : []),
  ];
  return {
    activity: {
      more: activityMore,
      rows: activity.slice(0, UNREAD_ACTIVITY_ROWS),
      sinceIso: input.activitySinceIso,
      ...(input.appTagsNotListed > 0 ? { appTagsNotListed: input.appTagsNotListed } : {}),
    },
    dms: {
      apps,
      checked: input.dmsChecked,
      more: dmMore,
      rows: dms.slice(0, UNREAD_DM_ROWS),
      sinceIso: input.dmSinceIso,
    },
    meaning: UNREAD_MEANING,
    producer: "slack unread",
    readAtIso: input.readAtIso,
    residue: [...input.residue, ...unlisted],
    status: input.incomplete || unlisted.length > 0 ? "incomplete" : "complete",
  };
}

/**
 * The document a read that could not run at all produces: no rows, and the reason first.
 *
 * @param reason why nothing was read
 * @param readAtIso when it was attempted
 * @param dmSinceIso the DM window's start
 * @param activitySinceIso the activity window's start
 * @returns the unavailable document
 */
export function unavailableUnreadDocument({
  reason,
  readAtIso,
  dmSinceIso,
  activitySinceIso,
}: {
  reason: string;
  readAtIso: string;
  dmSinceIso: string;
  activitySinceIso: string;
}): SlackUnreadDocument {
  return {
    activity: { more: 0, rows: [], sinceIso: activitySinceIso },
    dms: { apps: [], checked: 0, more: 0, rows: [], sinceIso: dmSinceIso },
    meaning: UNREAD_MEANING,
    producer: "slack unread",
    readAtIso,
    residue: [reason],
    status: "unavailable",
  };
}

/**
 * Whether the document is safe to hand on as an answer. A short read that still LISTS something is: its rows are
 * real and its status and residue say what was missed, while the console's voice runner discards a failed verb's
 * stdout whole (`site/lib/spawnVerb.ts`), so failing it would hide every row it did read. A short read that lists
 * nothing is not, because it would read as an all-clear.
 *
 * @param document the document built
 * @returns true when the verb exits 0
 */
export function slackUnreadAnswers({ document }: { document: SlackUnreadDocument }): boolean {
  if (document.status === "complete") {
    return true;
  }
  const listed = document.dms.rows.length + document.dms.apps.length + document.activity.rows.length;
  return document.status === "incomplete" && listed > 0;
}

/**
 * What a read that does not answer says on stderr. The voice's runner throws a failed verb's stdout away and keeps
 * only stderr, so the reason nothing could be listed must be there too, or the voice hears a bare exit code.
 *
 * @param document the document the read produced
 * @returns nothing for a document that answers; otherwise the status and every residue line
 */
export function slackUnreadFailureLines({ document }: { document: SlackUnreadDocument }): readonly string[] {
  if (slackUnreadAnswers({ document })) {
    return [];
  }
  return [
    `slack unread: ${document.status.toUpperCase()} — nothing could be listed, so this is not an all-clear`,
    ...document.residue.map((line) => `  - ${line}`),
  ];
}

/**
 * The lines a person reads: the status, DMs, then activity, one line per row, then the residue.
 *
 * @param document the document to render
 * @returns the lines, in order
 */
export function renderSlackUnreadText({ document }: { document: SlackUnreadDocument }): readonly string[] {
  if (document.status === "unavailable") {
    return [
      "slack unread: UNAVAILABLE — nothing was read, so this is NOT an all-clear",
      ...document.residue.map((line) => `  - ${line}`),
    ];
  }
  const head =
    document.status === "incomplete"
      ? "slack unread: INCOMPLETE — what was read is listed; the residue names what was not"
      : "slack unread: read live";
  const { dms, activity } = document;
  const lines = [
    head,
    `DMs (${String(dms.rows.length + dms.more)} unread of ${String(dms.checked)} checked, since ${dms.sinceIso}):`,
  ];
  for (const row of dms.rows) {
    const asks = row.asks ? " · asks" : "";
    lines.push(`  ${row.with} · ${String(row.unread)} unread${asks} · ${row.lastFrom}: ${row.line}`, `    ${row.url}`);
  }
  if (dms.apps.length > 0) {
    lines.push(`  apps: ${dms.apps.map((app) => `${app.name} (${String(app.unread)})`).join(", ")}`);
  }
  lines.push(`Activity (${String(activity.rows.length + activity.more)} threads, since ${activity.sinceIso}):`);
  for (const row of activity.rows) {
    lines.push(
      `  ${row.where} · ${row.forYou} · ${String(row.newReplies)} new of ${String(row.replies)} · ${row.people.join(", ")} · ${row.topic}`,
      `    ${row.lastFrom}: ${row.line}`,
      `    ${row.url}`,
    );
  }
  lines.push(`meaning: ${document.meaning}`, "residue:", ...document.residue.map((line) => `  - ${line}`));
  return lines;
}

/** Newest ISO instant first. */
function newestFirst({ a, b }: { a: string; b: string }): number {
  if (a === b) {
    return 0;
  }
  return a > b ? -1 : 1;
}
