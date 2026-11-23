/**
 * The review ask an approved reviewer pick parks for the owner's yes: one message as the owner, in a DM to the
 * person they picked, and the one-line why its queue card reads.
 *
 * An approve used to record the pick and stop, so the next act — the ask itself — was written by hand in a
 * session every time, and every first ask in the draft register came out the same shape: a DM to the person,
 * the pull request as one link, a one-line "could I grab a review". This is that shape, composed once. A
 * session addresses its DM by the `D…` conversation id about as often as by the member id, so the check for
 * an ask already held reads both.
 * `github reviewer pick` parks it through `slack draft record`'s own path, so every voice gate still runs and
 * nothing is sent (`skills/github/reference/reviewers.md`).
 *
 * Pure. No network, no clock, no filesystem.
 */
import { safeJsonStringify } from "#lib/safeJson.js";

import { LINK_LABEL_MAX } from "../outbound/artifact/runSchema.js";
import type { ReceiptsDeclaration } from "../outbound/slack/draftReceipts.js";
import type { SlackDraftItem } from "../outbound/slack/draftRegister.js";
import { formReceiptLinks } from "../outbound/slack/formReceipts.js";

/**
 * The link's label: the pull request's title and number, the title shortened with an ellipsis when the two would pass
 * {@link LINK_LABEL_MAX}. A GitHub title runs to 256 characters, and a label over the cap fails the form's parse, so
 * the ask would be refused for a long title rather than parked.
 *
 * @param title the pull request's own title
 * @returns the label, never longer than the cap
 */
function askLabelOf({ title: raw, number }: { title: string; number: number }): string {
  // A label is one line and the drip parse refuses a break in one; a title is one line on GitHub, but the reading
  // admits any string, so any run of whitespace becomes one space.
  const title = raw.replace(WHITESPACE_RUN, " ").trim();
  const suffix = ` #${String(number)}`;
  const room = LINK_LABEL_MAX - suffix.length;
  if (title.length <= room) {
    return `${title}${suffix}`;
  }
  // The cap counts UTF-16 code units, so a cut may land inside an emoji; a dangling high surrogate goes with it.
  const cut = title.slice(0, room - 1).replace(LONE_HIGH_SURROGATE, "");
  return `${cut.trimEnd()}…${suffix}`;
}

/** A high surrogate ending a string, its low half cut away. */
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF]$/u;

/** Any run of whitespace, a line break included. */
const WHITESPACE_RUN = /\s+/gu;

/**
 * The as-me form for the ask: a drip of exactly ONE message, the only shape a parked draft takes.
 *
 * @param title the pull request's own title, which the link carries as its label
 * @param url the pull request's GitHub address
 * @returns the form JSON `slack draft record --form` takes
 */
export function reviewAskFormOf({ title, url, number }: { title: string; url: string; number: number }): string {
  const form = {
    kind: "drip",
    messages: [
      {
        runs: [
          { text: "hey, could I grab a review on ", type: "text" },
          { label: askLabelOf({ number, title }), type: "link", url },
          { text: " when you get a sec? no rush", type: "text" },
        ],
      },
    ],
  };
  return safeJsonStringify({ label: "a review ask form", value: form });
}

/**
 * What the ask declares about its receipts: nothing when `slack draft record` derives a link off its form, so the
 * recorder reads the pull request's link off the message; and what was tried when it would derive none, which the
 * recorder would otherwise refuse as no receipt at all. Judged by {@link formReceiptLinks}, the recorder's own parse
 * and derivation, because the reading's address is any string and a prefix match on it was wrong.
 *
 * @param form the ask's form, from {@link reviewAskFormOf}
 * @param url the pull request's address as the reviewer reading holds it, which a `tried` names
 * @returns the declaration the ask records with
 */
export function reviewAskReceiptsOf({ form, url }: { form: string; url: string }): ReceiptsDeclaration {
  const links = formReceiptLinks({ form });
  if (links === undefined) {
    return { kind: "tried", tried: `linking the pull request at ${url}, but the ask's form does not parse` };
  }
  if (links.length > 0) {
    return { kind: "undeclared" };
  }
  return {
    kind: "tried",
    // The form carries the address as a link either way; only the recorder's derivation says it is no receipt.
    tried: `linking the pull request, but the reading's address ${url} does not count as a receipt link`,
  };
}

/**
 * The draft's `--why`: which pull request, to whom, and that it came from the owner's approve.
 *
 * @param prKey the pull request as the reviewer register keys it
 * @param who the picked person's name when the reading knows it, else their Slack id
 * @returns the one line the queue card reads
 */
export function reviewAskWhyOf({ prKey, who }: { prKey: string; who: string }): string {
  return `first review ask for ${prKey} to ${who}, your approved pick from the suggested reviewer`;
}

/**
 * The ask already waiting on the owner's yes for this person and pull request, so a second approve — or an
 * approve after a session parked one by hand — reuses it rather than parking a duplicate the owner would have
 * to drop.
 *
 * Only a HELD draft counts: a released one was sent, and a dropped one the owner turned down. A DM to the person —
 * addressed by their member id, or by a `D…` id `dmUsers` resolves to them — counts when it links the pull
 * request anywhere, and a DM to anyone else never counts, whoever it tags. In a channel or group DM the link
 * must follow their tag on the same line before any other tag, so a batch reading "@A #1, @B #2" is an ask to A
 * about #1 and never about #2. A link counts to the address or a page under it (`/files`). Two misses are
 * accepted, since each can only park a duplicate the owner drops, never take someone else's ask: a group DM that never
 * tags them, and tags on one line with the links on the next.
 *
 * @param items the folded draft register
 * @param reviewer the picked person's Slack member id
 * @param url the pull request's address, which the ask links
 * @param dmUsers each `D…` id of {@link heldDmChannelsFor} Slack could resolve, to the member on the other end
 * @returns the held draft's id, or nothing when none matches
 */
export function heldAskFor({
  items,
  reviewer,
  url,
  dmUsers,
}: {
  items: readonly SlackDraftItem[];
  reviewer: string;
  url: string;
  dmUsers: ReadonlyMap<string, string>;
}): string | undefined {
  const tags = [`<@${reviewer}>`, `<@${reviewer}|`];
  const held = items.find((item) => {
    if (item.state !== "held") {
      return false;
    }
    const { channel, payload } = item.draft;
    if (MEMBER_ID.test(channel) || DM_CONVERSATION.test(channel)) {
      // A 1:1 DM reaches its one member and nobody it tags, so a DM to anyone else is never this ask.
      const member = MEMBER_ID.test(channel) ? channel : dmUsers.get(channel);
      return member === reviewer && linksPullRequest({ text: payload.text, url });
    }
    // Each tag — a person, a user group, `<!here>` — owns the text up to the next one, so "@A #1, @B #2" or
    // "@A #1, @platform #2" on one line never gives #2 to A.
    return payload.text
      .split("\n")
      .flatMap((line) => line.split(TAG_OPENER))
      .some((segment) => tags.some((tag) => segment.startsWith(tag)) && linksPullRequest({ text: segment, url }));
  });
  if (held === undefined) {
    return undefined;
  }
  return held.id;
}

/**
 * The `D…` conversations a held draft linking this pull request is addressed to — the only ones whose other
 * member {@link heldAskFor} needs, so the shell asks Slack about these and nothing else.
 *
 * @param items the folded draft register
 * @param url the pull request's address
 * @returns each such conversation id once
 */
export function heldDmChannelsFor({
  items,
  url,
}: {
  items: readonly SlackDraftItem[];
  url: string;
}): readonly string[] {
  const channels = items
    .filter((item) => item.state === "held" && DM_CONVERSATION.test(item.draft.channel))
    .filter((item) => linksPullRequest({ text: item.draft.payload.text, url }))
    .map((item) => item.draft.channel);
  return [...new Set(channels)];
}

/** Just before any Slack tag — `<@U…>` a person, `<!subteam^…>` a group, `<!here>` — kept on the segment it opens. */
const TAG_OPENER = /(?=<[@!])/;

/** A 1:1 DM addressed by the member id, the way `slack draft record --channel U…` takes it. */
const MEMBER_ID = /^[UW][A-Z0-9]+$/;

/** A 1:1 DM addressed by its conversation id rather than the member id. */
const DM_CONVERSATION = /^D[A-Z0-9]+$/;

/**
 * Whether mrkdwn text links the pull request or a page under it. Each opening ends at `|`, `>` or `/`, so
 * a short number never answers for a longer one it prefixes.
 *
 * @returns true when the text carries such a link
 */
function linksPullRequest({ text, url }: { text: string; url: string }): boolean {
  return [`<${url}|`, `<${url}>`, `<${url}/`].some((link) => text.includes(link));
}
