/**
 * Canonical entity keys, and the SUBJECT scoping that decides which of them a node actually contributes.
 *
 * ## Why a key is qualified rather than a bare number
 *
 * A pull request number is not a global identifier — `#N` repeats across repositories, which is why the
 * corpus keys records on `(source, container, sourceId)` (`../corpus/latestRecords.ts`). An entity key here
 * carries the same discipline: a pull request is host-free but owner- and repository-qualified, a Slack
 * thread is conversation-qualified and always names its ROOT, and a Linear issue is its own identifier.
 * Joining on a bare number merges two unrelated pieces of work and nothing downstream can tell.
 *
 * ## The Slack root, which is the trap
 *
 * A permalink to a REPLY carries the reply's timestamp in the path and the thread's in `thread_ts`. Keying
 * on the path number therefore points at a message rather than a thread, and a genuine same-thread edge is
 * silently missed. MEASURED on two of the owner's threads: the path key
 * `1788480284.406219` and the thread key `1788428234.892229` are different values for the same
 * conversation, so the one hard edge joining those workstreams did not fire. {@link parseSlackThreadPermalink}
 * already resolves this correctly and is reused here rather than reimplemented — `../lib/slackTs.ts`
 * deliberately returns the PATH timestamp, which is right for identity and wrong for grouping.
 *
 * ## Subject scoping
 *
 * An entity a node merely MENTIONS is not an entity the node is about. MEASURED over the owner's
 * fourteen days: joining on every mention welded three unrelated board rows together because each cited
 * `JJJJ-1552` in passing, and scoping to the subject removed that group while keeping every true one. This
 * is the same failure the board's own file-mention cross-reference already warns about, pointed at a
 * different field.
 *
 * Pure: no clock, no filesystem, no network.
 */

import { parseSlackThreadPermalink } from "../live/slack/permalink.js";

/** A canonical, qualified reference to something two nodes can genuinely share. */
export type EntityKey = string;

/** `owner/repo#number` — a pull request, qualified so a number cannot collide across repositories. */
const PULL_REQUEST = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;

/** A Linear issue identifier: a team key, a hyphen, and the issue's number. */
const LINEAR_ISSUE = /\b([A-Z][A-Z0-9]{1,4}-\d{1,6})\b/g;

/** Any Slack archive permalink, matched loosely so {@link parseSlackThreadPermalink} can do the real parsing. */
const SLACK_LINK = /https?:\/\/[\w.-]*slack\.com\/archives\/\S+/g;

/**
 * The canonical key for one pull request.
 *
 * @param owner the repository's owner
 * @param repo the repository's name
 * @param number the pull request number
 * @returns the qualified key
 */
export function pullRequestKey({ owner, repo, number }: { owner: string; repo: string; number: string }): EntityKey {
  return `pr:${owner}/${repo}#${number}`;
}

/**
 * The canonical key for one Slack thread, always naming its ROOT rather than an addressed reply.
 *
 * @param channel the conversation id
 * @param threadTs the thread ROOT timestamp
 * @returns the qualified key
 */
export function slackThreadKey({ channel, threadTs }: { channel: string; threadTs: string }): EntityKey {
  return `thread:${channel}:${threadTs}`;
}

/**
 * The canonical key for one Linear issue.
 *
 * @param identifier the issue identifier, e.g. `JJJJ-1552`
 * @returns the qualified key
 */
export function linearIssueKey({ identifier }: { identifier: string }): EntityKey {
  return `linear:${identifier}`;
}

/**
 * Every canonical entity one piece of text names.
 *
 * A Slack link that will not parse contributes nothing rather than a guessed key — a wrong thread key joins
 * two unrelated conversations, which is worse than missing an edge.
 *
 * @param text the text to read
 * @returns the keys, deduplicated, in no particular order
 */
export function entitiesIn({ text }: { text: string }): ReadonlySet<EntityKey> {
  const found = new Set<EntityKey>();
  for (const match of text.matchAll(PULL_REQUEST)) {
    const [, owner, repo, number] = match;
    if (owner !== undefined && repo !== undefined && number !== undefined) {
      found.add(pullRequestKey({ number, owner, repo }));
    }
  }
  for (const match of text.matchAll(LINEAR_ISSUE)) {
    const [, identifier] = match;
    if (identifier !== undefined) {
      found.add(linearIssueKey({ identifier }));
    }
  }
  for (const match of text.matchAll(SLACK_LINK)) {
    const [link] = match;
    const parsed = parseSlackThreadPermalink({ permalink: link.replace(/[).,]+$/, "") });
    if (parsed.isOk()) {
      found.add(slackThreadKey({ channel: parsed.value.channel, threadTs: parsed.value.threadTs }));
    }
  }
  return found;
}
