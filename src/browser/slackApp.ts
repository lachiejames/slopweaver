/**
 * `browser present`'s Slack-app route: which addresses are Slack message permalinks, and the `slack://` deep link
 * that opens one straight in the owner's Slack desktop app, built from the read token's workspace. The browser handoff it
 * replaces, and the answer the voice is handed either way, stay in `present.ts`.
 */
import { isRecord } from "#lib/parsers.js";
import type { ForegroundCommand } from "./foreground.js";

/** A Slack workspace's own host, `<workspace>.slack.com` — never `slack.com` itself, nor a lookalike ending in it. */
const SLACK_WORKSPACE_HOST = /^[a-z0-9][a-z0-9-]*\.slack\.com$/u;

/**
 * A Slack message permalink's path: `/archives/<channel>/p<16 digits>`, one trailing slash allowed. The digits are
 * the message `ts` with its dot taken out after the tenth, so the two groups put it back.
 */
const SLACK_MESSAGE_PATH = /^\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})\/?$/u;

/** A Slack message `ts` as a permalink's `thread_ts` query writes it: ten digits, a dot, six. */
const SLACK_TS = /^\d{10}\.\d{6}$/u;

/** A Slack workspace id as `auth.test` names it: `T…`, or `E…` for an Enterprise Grid org. */
const SLACK_TEAM_ID = /^[TE][A-Z0-9]+$/u;

/**
 * Whether an address is one Slack message's permalink on a workspace's own host: https, `<workspace>.slack.com`,
 * `/archives/<channel>/p<16 digits>`. A reply's `thread_ts` query and a fragment are allowed; a channel page, plain
 * http, `slack.com` itself and a lookalike host are not. The port is not read here, because the browser handoff
 * shares this test; `slackAppCommand` holds the desktop route to the token's own origin.
 *
 * @param url the address asked for
 * @returns true only for a Slack message permalink
 */
export function slackMessageLink({ url }: { url: string }): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  const parsed = new URL(url);
  return (
    parsed.protocol === "https:" &&
    SLACK_WORKSPACE_HOST.test(parsed.hostname) &&
    SLACK_MESSAGE_PATH.test(parsed.pathname)
  );
}

/**
 * The command that opens a Slack message permalink straight in the owner's Slack desktop app, at the message: Slack's own
 * `slack://channel?team=<team>&id=<channel>&message=<ts>` deep link, handed to `open`. `undefined` when the address
 * is not a message permalink, the team id is not one, or the permalink is on another workspace than the token's — a
 * deep link names its workspace by id, so a permalink elsewhere would land in the wrong one.
 *
 * Why not the owner's Chrome: a present opens in the foreground, Slack's permalink page hands the message to the desktop app,
 * and closing the handoff tab afterwards raises Chrome once more — so ONE open reached the owner as Chrome, Slack, Chrome,
 * Slack: a loop of the browser coming to the foreground, opening Slack, and coming forward again at the same
 * thread, from a single `open_card` thread opening.
 *
 * Why not the https permalink: MEASURED on the owner's Mac, `open -b com.tinyspeck.slackmacgap
 * https://acme.slack.com/archives/C0SYN000001/p1792585836729489` exited 0 and brought Slack forward on a
 * channel and thread it already had open; `open "slack://channel?team=T0SYN000001&id=C0SYN000001&message=1792585836.729489"`
 * moved Slack to that channel scrolled to that message, each read off a screenshot. Repro: either command, then look.
 *
 * @param url the address asked for
 * @param teamId the read token's workspace id, off `auth.test`
 * @param workspaceUrl the read token's workspace base, off `auth.test` (`https://<workspace>.slack.com/`)
 * @returns `open <deep link>`, as argv, or `undefined` when no deep link can be built
 */
export function slackAppCommand({
  url,
  teamId,
  workspaceUrl,
}: {
  url: string;
  teamId: string;
  workspaceUrl: string;
}): ForegroundCommand | undefined {
  if (!slackMessageLink({ url }) || !SLACK_TEAM_ID.test(teamId) || !URL.canParse(workspaceUrl)) {
    return undefined;
  }
  const permalink = new URL(url);
  if (new URL(workspaceUrl).origin !== permalink.origin) {
    return undefined;
  }
  const [, channel, seconds, micros] = SLACK_MESSAGE_PATH.exec(permalink.pathname)!;
  const messageTs = `${seconds!}.${micros!}`;
  const threadTs = permalink.searchParams.get("thread_ts");
  // A reply goes to its thread's root: a reply is not in the channel's timeline, and a root `ts` is the landing that
  // was measured. Whether `message=<a reply's ts>` opens the thread pane is unmeasured. Only a
  // `thread_ts` EARLIER than the message is a root, since a root precedes every reply; two fixed-width `ts` strings
  // compare in time order.
  const landingTs = threadTs !== null && SLACK_TS.test(threadTs) && threadTs < messageTs ? threadTs : messageTs;
  const deepLink = new URL("slack://channel");
  deepLink.searchParams.set("team", teamId);
  deepLink.searchParams.set("id", channel!);
  deepLink.searchParams.set("message", landingTs);
  return { args: [deepLink.href], file: "open" };
}

/** The two facts `slackAppCommand` needs about the read token's workspace, off `auth.test`. */
export interface SlackWorkspace {
  readonly teamId: string;
  readonly workspaceUrl: string;
}

/**
 * The workspace a raw `auth.test` body names: its `team_id` and `url`. `undefined` when either is missing or not a
 * non-empty string, so the present takes the browser instead of building a deep link from half an answer.
 *
 * @param body Slack's raw `auth.test` response
 * @returns the workspace, or `undefined` when the body does not name one
 */
export function slackWorkspaceOf({ body }: { body: unknown }): SlackWorkspace | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  const { team_id: teamId, url: workspaceUrl } = body;
  if (typeof teamId !== "string" || teamId === "" || typeof workspaceUrl !== "string" || workspaceUrl === "") {
    return undefined;
  }
  return { teamId, workspaceUrl };
}
