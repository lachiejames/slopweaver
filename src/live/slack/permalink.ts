/**
 * Pure Slack permalink → thread identity. The load-bearing parser for `slack read-thread`: everything
 * downstream trusts the channel and thread timestamp this produces, so a wrong answer here reads the
 * wrong conversation rather than failing.
 *
 * ## The two shapes, and why the query string wins
 *
 * Slack's "Copy link" produces `/archives/<CONVERSATION>/p<ts-without-dot>`. On a **reply** it appends
 * `?thread_ts=<parent>&cid=<CONVERSATION>` — so the path timestamp names the REPLY and only the query
 * names the thread root. Reading the path alone therefore resolves a reply link to a thread that does not
 * exist (`conversations.replies` wants the parent `ts`). When `thread_ts` is present it is authoritative
 * for the thread, and the path timestamp is retained as `addressedTs` so a caller can still say which
 * message was actually linked.
 *
 * ## Conversation ids are not just `C`
 *
 * The read seam crawls every conversation class — channels, DMs and group DMs — across the two lanes in
 * `corpus/slack/lanes.ts`, so a `D…` DM is in scope alongside a `C…`. A `C`-only parser would refuse links
 * to exactly the private conversations this verb is most useful for.
 *
 * **A group DM's id is NOT necessarily `G…`, and assuming it was is how one whole conversation class went
 * missing for weeks.** Measured on this workspace, every `is_mpim: true` conversation is `C`-prefixed
 * (`C0SYN000026`), so counting `G` containers to decide whether group DMs are being read measures nothing at
 * all. `is_mpim` is the only signal; the prefix has never been one.
 *
 * ## The timestamp
 *
 * `p1785114398557099` → `1785114398.557099`: the dot goes back before the LAST SIX digits. Slack's
 * fractional part is always six digits, so anything that is not `p` + >=7 digits is malformed rather than
 * something to guess at.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { AskIdentity } from "../ask/identity.js";
import { type SlackPermalinkError, SlackPermalinkErrors } from "./errors.js";

/** A parsed Slack thread reference: what to fetch, and which message the link actually pointed at. */
export interface SlackThreadTarget {
  /** The normalised HTTPS workspace origin, e.g. `https://example.slack.com`. */
  readonly workspace: string;
  /** The conversation id — `C…` (channel), `G…` (group DM) or `D…` (DM). */
  readonly channel: string;
  /** The THREAD ROOT timestamp, which is what `conversations.replies` must be called with. */
  readonly threadTs: string;
  /**
   * The timestamp the link actually addressed. Equals `threadTs` for a parent link; for a reply link it
   * is the reply's own ts, so the reader can point at the message the user pasted.
   */
  readonly addressedTs: string;
  /** True when the link addressed a reply rather than the thread root. */
  readonly addressedReply: boolean;
}

/** `p` + at least 7 digits — seconds plus Slack's six fractional digits. */
const PATH_TS = /^p(\d{7,})$/;

/** A Slack conversation id: channel, group DM or DM. */
const CONVERSATION_ID = /^[CGD][A-Z0-9]+$/;

/** A raw `ts` as Slack returns it: seconds `.` six fractional digits. */
const RAW_TS = /^\d{1,}\.\d{6}$/;

/**
 * Reinsert the dot Slack strips from a permalink timestamp: the last six digits are the fraction.
 *
 * @param token the `p`-prefixed path segment
 * @returns the Slack `ts`, or `undefined` when the segment is not a permalink timestamp
 */
function tsFromPathSegment({ token }: { token: string }): string | undefined {
  const digits = PATH_TS.exec(token)?.[1];
  if (digits === undefined) {
    return undefined;
  }
  const cut = digits.length - 6;
  return `${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

/**
 * Parse a Slack thread permalink into the identity `conversations.replies` needs.
 *
 * @param permalink the pasted Slack URL
 * @returns the resolved thread target, or `err` naming why the link was refused
 */
export function parseSlackThreadPermalink({
  permalink,
}: {
  permalink: string;
}): Result<SlackThreadTarget, SlackPermalinkError> {
  const trimmed = permalink.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return err(SlackPermalinkErrors.notAUrl({ text: trimmed }));
  }
  if (url.protocol !== "https:") {
    return err(SlackPermalinkErrors.notHttps({ protocol: url.protocol }));
  }
  if (!url.hostname.endsWith(".slack.com")) {
    return err(SlackPermalinkErrors.notSlackHost({ hostname: url.hostname }));
  }
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const [archives, channel, tsSegment] = segments;
  if (archives !== "archives" || channel === undefined || tsSegment === undefined) {
    return err(SlackPermalinkErrors.malformed({ pathname: url.pathname }));
  }
  if (!CONVERSATION_ID.test(channel)) {
    return err(SlackPermalinkErrors.invalidConversationId({ channel }));
  }
  const addressedTs = tsFromPathSegment({ token: tsSegment });
  if (addressedTs === undefined) {
    return err(SlackPermalinkErrors.invalidPermalinkTimestamp({ segment: tsSegment }));
  }
  return threadTargetFrom({ addressedTs, channel, params: url.searchParams, workspace: url.origin });
}

/**
 * Build the canonical permalink for one ask — the inverse of {@link parseSlackThreadPermalink}. A fresh
 * visible session gets this durable pointer rather than a pre-fetched thread; it reads the live conversation
 * itself via `slack read-thread <permalink>` when it starts investigating.
 *
 * `workspaceUrl` comes straight off `auth.test`, whose `url` field is returned WITH a trailing slash — the
 * base is normalised to exactly one, the same guard `corpus/slack/fetch.ts`'s `permalinkFor` and
 * `corpus/slack/curated.ts`'s `slackPermalink` already apply, so this builder cannot emit the double-slash
 * defect those two fixed once each already.
 *
 * @param workspaceUrl the workspace's base URL, resolved once per dispatch
 * @param askIdentity the exact ask to link to
 * @returns the canonical `https://…/archives/<channel>/p<ts>` permalink, with `thread_ts`/`cid` appended for
 *   a reply so the link still names its thread root
 */
export function slackAskPermalink({
  workspaceUrl,
  askIdentity,
}: {
  workspaceUrl: string;
  askIdentity: AskIdentity;
}): string {
  const base = workspaceUrl.endsWith("/") ? workspaceUrl : `${workspaceUrl}/`;
  const path = `${base}archives/${askIdentity.channel}/p${askIdentity.messageTs.replace(".", "")}`;
  if (askIdentity.messageTs === askIdentity.threadTs) {
    return path;
  }
  return `${path}?thread_ts=${askIdentity.threadTs}&cid=${askIdentity.channel}`;
}

/**
 * Resolve the thread root from the query string, refusing a link whose `cid` disagrees with its path.
 *
 * @param workspace the normalised origin
 * @param channel the conversation id from the path
 * @param addressedTs the timestamp the link addressed
 * @param params the parsed query string
 * @returns the thread target, or `err` when the link contradicts itself
 */
function threadTargetFrom({
  workspace,
  channel,
  addressedTs,
  params,
}: {
  workspace: string;
  channel: string;
  addressedTs: string;
  params: URLSearchParams;
}): Result<SlackThreadTarget, SlackPermalinkError> {
  // A `cid` that disagrees with the path is a corrupted or hand-edited link; coercing one of the two
  // would silently read a different conversation, so refuse instead.
  const cid = params.get("cid");
  if (cid !== null && cid !== channel) {
    return err(SlackPermalinkErrors.selfContradicts({ channel, cid }));
  }
  const threadParam = params.get("thread_ts");
  if (threadParam === null) {
    return ok({ addressedReply: false, addressedTs, channel, threadTs: addressedTs, workspace });
  }
  if (!RAW_TS.test(threadParam)) {
    return err(SlackPermalinkErrors.invalidThreadTs({ threadParam }));
  }
  return ok({
    addressedReply: threadParam !== addressedTs,
    addressedTs,
    channel,
    threadTs: threadParam,
    workspace,
  });
}
