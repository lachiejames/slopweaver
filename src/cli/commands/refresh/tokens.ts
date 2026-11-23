/**
 * The production token reads for `slopweaver refresh`, in one place.
 *
 * Two callers need them and they must agree: the missing-token gate (which refuses a requested source before
 * any network call) and the hydration lanes (which need the same token bag a moment later). Slack is the reason
 * this is a module rather than two literals — its READ token has a precedence rule (user token wins, bot token
 * is a narrower fallback), and a second copy of that rule is a second chance to get the visibility wrong.
 */

import { linearToken, notionToken, slackBotToken, slackUserToken } from "../../../config.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import type { TokenedSource } from "./core.js";

/**
 * The Slack READ token: a user token wins; a bot token is the fallback with a limited-visibility warning.
 *
 * @returns the token to read Slack with, if any, plus the warning to surface when it is the narrower one
 */
export function slackReadToken(): { token?: string; warning?: string } {
  return resolveSlackReadToken({ botToken: slackBotToken(), userToken: slackUserToken() });
}

/**
 * Resolve each tokened source's token (Slack read-token vs Linear/Notion env), for the missing-token gate.
 *
 * @returns the per-source token bag, with `undefined` for a source that has none
 */
export function resolveTokens(): Readonly<Partial<Record<TokenedSource, string | undefined>>> {
  // Total over the derived union, so a manifest newly declaring `upfrontTokenGate` fails to compile here.
  return { linear: linearToken(), notion: notionToken(), slack: slackReadToken().token } satisfies Record<
    TokenedSource,
    string | undefined
  >;
}
