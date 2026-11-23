/**
 * Review asks to ONE person inside one day fold into one batch DM, never N boilerplate singles.
 *
 * A fourth "hey, could I grab a review on <pr> when you get a sec? no rush" DM to one person in a day reads as
 * less human than folding them into "actually can you just review all these lol <dotpoints>" in the next DM, and
 * five separate boilerplate singles do not look right. Each single is parked by an approving `github reviewer pick`.
 *
 * So `slack draft record --act review-ask`, top-level in a 1:1 DM as the owner, refuses two shapes:
 *
 * - **A second card for the same person.** A review ask to them already HELD on the owner's queue, of any age, and
 *   not named by `--supersedes`: compose one batch covering both and re-cut, exactly as one thread's replies merge
 *   (`./draftSameThread.ts`).
 * - **A second single the same day.** A review ask to them already RELEASED on the owner's local day (Melbourne,
 *   `../../briefing/localDay.ts`, keyed on when it went out), and this one links fewer than two pull requests. A
 *   batch passes, and may relist pull requests already asked, since "all these" is every one still waiting.
 *
 * The person is the DM's member: a `U…` id as typed, a `D…` conversation through the member Slack resolved for it.
 * A `D…` row Slack could not resolve is left out rather than guessed, and the shell says so.
 *
 * ## No hatch, and the refusal says so
 *
 * The batch is always composable, and an override would only put the boilerplate single back. A pull request that
 * is honestly the only one left waiting on them goes in the next day's ask, or into the thread of the one sent.
 *
 * Pure: rows, the member map and the clock's instant in.
 */
import { localDayKey } from "../../briefing/localDay.js";
import type { SlackDraftItem } from "./draftRegister.js";

/** A 1:1 DM addressed by the member id, the way `slack draft record --channel U…` takes it. */
const MEMBER_ID = /^[UW][A-Z0-9]+$/;

/** A 1:1 DM addressed by its conversation id rather than the member id. */
const DM_CONVERSATION = /^D[A-Z0-9]+$/;

/** A GitHub pull request's own address, owner, repository and number captured. */
const PULL_REQUEST_URL = /https:\/\/github\.com\/([^/"|>\s]+)\/([^/"|>\s]+)\/pull\/(\d+)/g;

/**
 * The distinct pull requests a message links, read off its whole payload so a link run, a bare reference the
 * preparation linkified and the plain fallback all count once.
 *
 * @param payload the exact message the draft would post
 * @returns each pull request once, as `owner/repo#N`
 */
export function pullRequestsLinked({ payload }: { payload: unknown }): readonly string[] {
  const text = JSON.stringify(payload);
  const keys = [...text.matchAll(PULL_REQUEST_URL)].map(([, owner, repo, number]) => `${owner}/${repo}#${number}`);
  return [...new Set(keys)];
}

/**
 * Whether a row is a top-level review ask as the owner in a 1:1 DM — the only rows this rule weighs.
 *
 * @returns true for such a row
 */
function isDmReviewAsk({ item }: { item: SlackDraftItem }): boolean {
  const { act, actor, channel, shape } = item.draft;
  return (
    act === "review-ask" &&
    actor !== "bot" &&
    shape === "top-level" &&
    (MEMBER_ID.test(channel) || DM_CONVERSATION.test(channel))
  );
}

/**
 * Whether a row is one this rule weighs on the local day of `nowIso`: held of any age, or released that day.
 *
 * @returns true for such a row
 */
function weighedToday({ item, today }: { item: SlackDraftItem; today: string }): boolean {
  if (item.state === "held") {
    return true;
  }
  return (
    item.state === "released" && item.resolvedIso !== undefined && localDayKey({ iso: item.resolvedIso }) === today
  );
}

/**
 * The `D…` conversations a review ask this rule weighs today is addressed to — the only ones whose member it needs,
 * so the shell asks Slack about these and nothing else, never the register's whole history.
 *
 * @param items every folded row
 * @param nowIso the recording's own instant
 * @returns each such conversation id once
 */
export function reviewAskDmChannels({
  items,
  nowIso,
}: {
  items: readonly SlackDraftItem[];
  nowIso: string;
}): readonly string[] {
  const today = localDayKey({ iso: nowIso });
  const channels = items
    .filter(
      (item) => isDmReviewAsk({ item }) && DM_CONVERSATION.test(item.draft.channel) && weighedToday({ item, today }),
    )
    .map((item) => item.draft.channel);
  return [...new Set(channels)];
}

/**
 * Every review ask to one person a new one would sit beside: held of any age, or released on the local day of
 * `nowIso`, oldest first.
 *
 * @param member the person the new ask goes to
 * @param dmUsers each `D…` id Slack resolved, to its member
 * @param nowIso the recording's own instant
 * @returns the held rows and the released ones
 */
export function reviewAsksToPerson({
  dmUsers,
  items,
  member,
  nowIso,
}: {
  dmUsers: ReadonlyMap<string, string>;
  items: readonly SlackDraftItem[];
  member: string;
  nowIso: string;
}): { readonly held: readonly SlackDraftItem[]; readonly sentToday: readonly SlackDraftItem[] } {
  const today = localDayKey({ iso: nowIso });
  const theirs = items
    .filter((item) => isDmReviewAsk({ item }))
    .filter((item) => {
      const { channel } = item.draft;
      const to = MEMBER_ID.test(channel) ? channel : dmUsers.get(channel);
      return to === member;
    })
    .toSorted((left, right) => left.draft.tsIso.localeCompare(right.draft.tsIso));
  return {
    held: theirs.filter((item) => item.state === "held"),
    sentToday: theirs.filter((item) => item.state === "released" && weighedToday({ item, today })),
  };
}

/**
 * Refuse a review ask to a person who already has one held, or a single to a person already asked today, naming
 * the batch that takes its place. Returns an EMPTY list when the ask may park, so a caller asks unconditionally.
 *
 * @param member the person the new ask goes to
 * @param pullRequests the distinct pull requests the new ask links
 * @param supersedes the held rows the recording re-cuts
 * @param dmUsers each `D…` id Slack resolved, to its member
 * @param nowIso the recording's own instant
 * @returns the hold's lines, or nothing when the ask may park
 */
export function samePersonDayRefusal({
  dmUsers,
  items,
  member,
  nowIso,
  pullRequests,
  supersedes,
}: {
  dmUsers: ReadonlyMap<string, string>;
  items: readonly SlackDraftItem[];
  member: string;
  nowIso: string;
  pullRequests: readonly string[];
  supersedes: readonly string[];
}): readonly string[] {
  const { held, sentToday } = reviewAsksToPerson({ dmUsers, items, member, nowIso });
  const unnamed = held.filter((item) => !supersedes.includes(item.id));
  if (unnamed.length > 0) {
    const all = held.map((item) => item.id);
    return [
      `slack draft record: REFUSING to park another review ask to ${member} — ${unnamed.map((item) => item.id).join(", ")} ` +
        `${unnamed.length === 1 ? "is" : "are"} already held for them, and asks to one person are ONE batch DM ` +
        '(fold them into "actually can you just review all these lol <dotpoints>").',
      `Compose ONE batch in the owner's voice, two lines then a dot point per pull request (a {"kind":"one-list"} form), ` +
        `covering ${all.length === 1 ? "that draft" : "every one of them"} and this one, then record it with ` +
        `--supersedes ${all.join(",")}, which drops ${all.length === 1 ? "it" : "them"} the moment the batch parks.`,
      "There is deliberately NO escape hatch: the batch is always composable, and a second card for one person is " +
        "the thing the owner's word removes.",
    ];
  }
  if (sentToday.length === 0 || pullRequests.length >= 2) {
    return [];
  }
  return [
    `slack draft record: REFUSING a single review ask to ${member} — ${sentToday.map((item) => item.id).join(", ")} ` +
      "already went to them today, and a second boilerplate single in one day reads as less human.",
    'Compose ONE batch DM instead, opening self-aware ("actually can you just review all these lol"), with a dot ' +
      'point linking EVERY pull request still waiting on them, the ones already asked included (a {"kind":"one-list"} ' +
      "form, no rush once). A pull request that is honestly the only one left goes in tomorrow's ask, or as a reply " +
      "in the thread of the one sent.",
    "There is deliberately NO escape hatch: the batch is always composable, and the single is the thing the owner's " +
      "word removes.",
  ];
}
