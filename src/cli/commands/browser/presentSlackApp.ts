/**
 * `browser present`'s Slack desktop route: a Slack message permalink opens straight in the owner's Slack desktop app at the
 * message, so the owner's Chrome is never touched. Split from `presentRun.ts` along the route seam — the Chrome route, the
 * desktop-app page route and this one each decide one destination.
 */
import { type ForegroundRun, realForegroundRun } from "../../../browser/foreground.js";
import { SLACK_WORKSPACE_LOOKUP_TIMEOUT_MS } from "../../../browser/lookBudget.js";
import { type PresentTarget, type SlackDesktopAnswer, slackAppAnswer } from "../../../browser/present.js";
import { type SlackWorkspace, slackAppCommand, slackMessageLink, slackWorkspaceOf } from "../../../browser/slackApp.js";
import { slackBotToken, slackUserToken } from "../../../config.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { slackWorkspaceLookupOnce } from "../../../corpus/slack/workspaceLookupOnce.js";
import { withTimeout } from "../../../lib/resilience.js";

/** How far inside `SLACK_WORKSPACE_LOOKUP_TIMEOUT_MS` the `auth.test` request aborts itself, so it is gone first. */
const LOOKUP_ABORT_LEAD_MS = 500;

/** How `present` reaches the owner's Slack desktop app: the command seam, and the read token's workspace off `auth.test`. */
export interface SlackAppSeam {
  readonly run: ForegroundRun;
  readonly workspace: () => Promise<SlackWorkspace | undefined>;
}

/**
 * The live seam: `open` through `realForegroundRun`, and ONE `auth.test` on the read token (`slackWorkspaceLookupOnce`,
 * no retry, the request aborted inside `SLACK_WORKSPACE_LOOKUP_TIMEOUT_MS`) — `undefined` with no Slack token, when the call fails
 * or times out, or when its answer names no workspace, so the present takes the browser instead.
 *
 * @param home the state home the Slack tokens resolve from
 * @returns the seam `runPresent` takes
 */
export function realSlackAppSeam({ home }: { home: string }): SlackAppSeam {
  return {
    run: realForegroundRun,
    workspace: async () => {
      const { token } = resolveSlackReadToken({
        botToken: slackBotToken({ home }),
        userToken: slackUserToken({ home }),
      });
      if (token === undefined) {
        return undefined;
      }
      // The client's own `timeout` aborts the request, and it fires LOOKUP_ABORT_LEAD_MS inside the race, so a
      // stalled call is already aborted when the race gives up; the race is the backstop for anything the request
      // timeout does not cover. Nothing outlives the verb either way: `runCliProcess` exits once it returns.
      try {
        const body = await withTimeout({
          task: async () =>
            slackWorkspaceLookupOnce({ timeoutMs: SLACK_WORKSPACE_LOOKUP_TIMEOUT_MS - LOOKUP_ABORT_LEAD_MS, token }),
          timeoutMs: SLACK_WORKSPACE_LOOKUP_TIMEOUT_MS,
        });
        return body.isOk() ? slackWorkspaceOf({ body: body.value }) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * A Slack message permalink opened straight in the owner's Slack desktop app at the message (`slackAppCommand` holds why and
 * the measurement), so the owner's Chrome is never touched; `undefined` for anything else, or when that could not run — no
 * Slack token, a permalink on another workspace, no Slack app, not macOS — and the caller takes the browser route,
 * where Slack's own handoff page is still read as opened.
 *
 * @param target the resolved page
 * @param slackApp the command seam and the workspace read
 * @returns the answer, or `undefined` to open in the browser instead
 */
export async function slackAppOpening({
  target,
  slackApp,
}: {
  target: PresentTarget;
  slackApp: SlackAppSeam;
}): Promise<SlackDesktopAnswer | undefined> {
  if (target.requestedAs !== "url" || !slackMessageLink({ url: target.url })) {
    return undefined;
  }
  // A seam that throws (an unreadable token file, say) is a lookup that failed: the browser route, never a crash.
  const workspace = await slackApp.workspace().catch(() => undefined);
  if (workspace === undefined) {
    return undefined;
  }
  const command = slackAppCommand({ teamId: workspace.teamId, url: target.url, workspaceUrl: workspace.workspaceUrl });
  if (command === undefined) {
    return undefined;
  }
  try {
    slackApp.run(command);
  } catch {
    return undefined;
  }
  return slackAppAnswer({ requestedUrl: target.url });
}
