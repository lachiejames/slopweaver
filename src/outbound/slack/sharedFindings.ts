/**
 * The team-facing findings the owner SHARED, read off the draft register, and the one follow-up card each may earn.
 *
 * A finding the owner shared that meets silence comes back to them, and they decide whether to bump. A finding is shared exactly
 * when a parked row declared `kind: "finding"` was RELEASED — the register is the only door a finding leaves by
 * (`skills/automation/reference/finding-card.md`), so no bot post or prose is read as one. A held or dropped finding
 * was never shared; a release that sent a thanks in its place shared nothing; and a release whose message `slack delete`
 * later removed (a `deleted` event at the same coordinate, `./draftDeletion.ts`) is shared no longer.
 *
 * ## One card per finding, and what spends it
 *
 * The follow-up is a `--act bump` draft naming its finding with `--followup-of <sd-id>`. ANY such row spends the
 * finding's one card — held, released or dropped — because a dropped card is one the owner saw and decided. The one exception
 * is a row a later cut re-cut (`--supersedes`) that names the SAME finding, so the card is still one card; a re-cut
 * that dropped `--followup-of` leaves the card spent.
 *
 * Pure: no clock, no filesystem.
 */

import { slackTsToIso } from "../../lib/slackTs.js";
import type { SkippedSlackDraftLine } from "./draftLog.js";
import type { ParkedSlackDraft, SlackDraftEvent, SlackDraftItem } from "./draftRegister.js";

/** One finding that left the machine, at the coordinates its release landed on. */
export interface SharedFinding {
  /** The released row's own id — what `--followup-of` names. */
  readonly draftId: string;
  readonly channelId: string;
  readonly channelName?: string | undefined;
  /** The landed message's own `ts`. */
  readonly messageTs: string;
  /** The thread a reply lands under: the row's own thread, or the finding itself when it went top-level. */
  readonly threadTs: string;
  /** When the message landed, read off its Slack `ts` rather than the register's append instant. */
  readonly postedAtIso: string;
  /** The link to the landed message; absent on a row released before the register recorded one. */
  readonly permalink?: string | undefined;
  /** The board row that raised the finding, when it named one. */
  readonly row?: string | undefined;
  /** The row's one-line purpose, so a worklist row is readable without opening the draft. */
  readonly why: string;
}

/** What reading the register for shared findings found: the findings, and the releases it could not place. */
export interface SharedFindingsRead {
  readonly findings: readonly SharedFinding[];
  /** Released finding rows whose landed `ts` names no instant — listed so a shortfall is never silent. */
  readonly undated: readonly string[];
}

/**
 * Every finding the owner shared, oldest landing first.
 *
 * @param events the register's events, in append order
 * @returns the findings, and the ids of any released finding whose landed `ts` reads as no instant
 */
export function sharedFindingsOf({ events }: { events: readonly SlackDraftEvent[] }): SharedFindingsRead {
  const parked = new Map<string, ParkedSlackDraft>();
  const findings: SharedFinding[] = [];
  const undated: string[] = [];
  // A deletion is appended AFTER its release, so it is collected up front: a release whose own coordinate was later
  // deleted is a message nobody can see, and no follow-up is owed on it. A repost is its own row and stays shared.
  const deleted = new Set(events.flatMap((event) => (event.kind === "deleted" ? [deletedKey({ ...event })] : [])));
  for (const event of events) {
    if (event.kind === "parked") {
      parked.set(event.id, event.draft);
      continue;
    }
    if (event.kind !== "released" || event.thanksInstead !== undefined || deleted.has(deletedKey({ ...event }))) {
      continue;
    }
    const draft = parked.get(event.id);
    if (draft?.kind !== "finding") {
      continue;
    }
    const finding = findingOfRelease({ draft, release: event });
    if (finding === undefined) {
      undated.push(event.id);
    } else {
      findings.push(finding);
    }
  }
  return { findings: findings.toSorted((a, b) => (a.postedAtIso < b.postedAtIso ? -1 : 1)), undated };
}

/** The `(id, channel, ts)` tuple a deletion and the release it names share. */
function deletedKey({ id, channel, ts }: { id: string; channel: string; ts: string }): string {
  return `${id}\u0000${channel}\u0000${ts}`;
}

/** A finding's release event. */
type FindingRelease = Extract<SlackDraftEvent, { kind: "released" }>;

/**
 * The finding one release shared, at the coordinates it landed on.
 *
 * @param draft the parked finding row the release sent
 * @param release the release event, carrying where and when it landed
 * @returns the finding, or undefined when its landed `ts` names no instant
 */
function findingOfRelease({
  draft,
  release,
}: {
  draft: ParkedSlackDraft;
  release: FindingRelease;
}): SharedFinding | undefined {
  const postedAtIso = slackTsToIso({ ts: release.ts });
  if (postedAtIso === undefined) {
    return undefined;
  }
  // A top-level finding is its own thread: a reply lands under the message itself.
  let threadTs = release.ts;
  if (release.threadTs !== undefined) {
    threadTs = release.threadTs;
  }
  return {
    channelId: release.channel,
    draftId: release.id,
    messageTs: release.ts,
    postedAtIso,
    threadTs,
    why: draft.why,
    ...(draft.channelName === undefined ? {} : { channelName: draft.channelName }),
    ...(release.permalink === undefined ? {} : { permalink: release.permalink }),
    ...(draft.row === undefined ? {} : { row: draft.row }),
  };
}

/**
 * The rows that spend a finding's one follow-up card: every row ever PARKED naming it, whatever became of it, bar one a
 * later cut naming the same finding re-cut.
 *
 * @param findingId the shared finding's draft id
 * @param events the register's events, in append order
 * @param supersedes the rows a recording IN PROGRESS that names this same finding re-cuts, which hand their card on
 * @returns the spending rows' ids
 */
export function followupsSpending({
  findingId,
  events,
  supersedes,
}: {
  findingId: string;
  events: readonly SlackDraftEvent[];
  supersedes: readonly string[];
}): readonly string[] {
  // Read off the park events, never the fold: the fold drops a row a skipped line names, which would free its card
  // Only a re-cut naming the SAME finding hands its card on: one that dropped `--followup-of` leaves the
  // card spent, or a second identity could cut a fresh card past it.
  const naming = events.flatMap((event) =>
    event.kind === "parked" && event.draft.followupOf === findingId ? [event] : [],
  );
  // A recorded re-cut hands a card on only once that card's drop landed: the park is appended before the drop, so a
  // failed drop leaves both cards held, and both must count.
  const dropped = new Set(events.flatMap((event) => (event.kind === "dropped" ? [event.id] : [])));
  const recut = new Set(supersedes);
  for (const { draft } of naming) {
    if (draft.recuts !== undefined) {
      draft.recuts.filter((id) => dropped.has(id)).forEach((id) => recut.add(id));
    }
  }
  return [...new Set(naming.map((event) => event.id))].filter((id) => !recut.has(id));
}

/**
 * Another follow-up card, SENT or still HELD, for the finding this held row follows up — the send-side half of one card
 * per finding. A re-cut parks before it drops the cut it replaces, so a failed drop leaves two cards held,
 * and two cards whose words differ are not one message the release's own spend can tell apart. A sent rival refuses the
 * second send whatever the words; a held one refuses BOTH releases until one is dropped, so two releases racing past
 * each other's read each see the other held and neither sends — no lock is needed, because the state
 * they refuse on was written before either began.
 *
 * @param row the held row about to be released
 * @param items every folded row
 * @returns the rival card naming the same finding, or `undefined` when this row is that finding's only live card
 */
export function rivalFollowupOf({
  row,
  items,
}: {
  row: SlackDraftItem;
  items: readonly SlackDraftItem[];
}): SlackDraftItem | undefined {
  const findingId = row.draft.followupOf;
  if (findingId === undefined) {
    return undefined;
  }
  return items.find((item) => item.id !== row.id && item.state !== "dropped" && item.draft.followupOf === findingId);
}

/**
 * Why a row declaring `--followup-of` may not park: the finding it names was never shared, the row would land
 * anywhere but that finding's own thread, it is not a bump, or the finding's one card is already spent.
 *
 * @param draft the row being recorded, carrying its `followupOf`
 * @param events the register's events, read under the lock
 * @param skipped the register lines this version could not read, any of which may be a park that spent the card,
 *   whatever kind it declares
 * @param supersedes the rows this recording re-cuts
 * @returns the refusal lines, empty when the row may park or names no finding
 */
export function followupOfRefusals({
  draft,
  events,
  skipped,
  supersedes,
}: {
  draft: Pick<ParkedSlackDraft, "act" | "channel" | "followupOf" | "threadTs">;
  events: readonly SlackDraftEvent[];
  skipped: readonly SkippedSlackDraftLine[];
  supersedes: readonly string[];
}): readonly string[] {
  const findingId = draft.followupOf;
  if (findingId === undefined) {
    return [];
  }
  const flag = `slack draft record --followup-of ${findingId}`;
  const finding = sharedFindingsOf({ events }).findings.find((shared) => shared.draftId === findingId);
  if (finding === undefined) {
    return [`${flag}: no released finding carries that id — only a shared finding earns a follow-up card`];
  }
  const problems: string[] = [];
  if (draft.act !== "bump") {
    problems.push(`${flag}: a follow-up card is a bump, so it needs --act bump`);
  }
  if (draft.channel !== finding.channelId || draft.threadTs !== finding.threadTs) {
    problems.push(
      `${flag}: the follow-up lands in the finding's own thread — --channel ${finding.channelId} --thread-ts ${finding.threadTs}`,
    );
  }
  // A line this version cannot read carries a `followupOf` nobody can see, so it may be this finding's card: refuse
  // rather than mint a second one past it. Whatever kind it declares, since a later version's park may
  // name a kind this one has never heard of.
  if (skipped.length > 0) {
    problems.push(
      `${flag}: ${String(skipped.length)} draft register line(s) (${skipped.map((line) => `line ${String(line.line)}`).join(", ")}) ` +
        "did not read and may be this finding's follow-up card — nothing parks until they read",
    );
  }
  const spent = followupsSpending({ events, findingId, supersedes });
  if (spent.length > 0) {
    problems.push(
      `${flag}: that finding's one follow-up card is already spent by ${spent.join(", ")} — held, sent or dropped, ` +
        "it was the owner's to decide once; re-cut it with --supersedes while it is held",
    );
  }
  return problems;
}
