/**
 * The effectful half of the owner-reply check: the token, the owner's id and the deadline around
 * `readOwnerReply` (`src/live/slack/ownerReply.ts`). `slack replied` prints what it returns; `handover currency`
 * calls it in-process for each ask whose done-check is that verb, so the reply's own link survives into the reading
 * rather than being discarded with a probe's stdout.
 */
import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken } from "../../../corpus/slack/fetch.js";
import { slopweaverHome } from "../../../homeDir.js";
import { withTimeout } from "../../../lib/resilience.js";
import { type OwnerReply, readOwnerReply } from "../../../live/slack/ownerReply.js";
import { ownerUserIdFromProfile } from "../../../profileStore.js";

/**
 * How long one check may take. A thread of many pages or a Slack 429 can run long; a check past this reads
 * could-not-check rather than holding a tick's reading (`src/supervisor/scratch/tickCapture.ts`, 120 s) hostage.
 */
export const OWNER_REPLY_DEADLINE_MS = 14_000;

/**
 * Check one link live with the operator's Slack token and their own Slack user id.
 *
 * @param permalink the Slack message link to count from
 * @param home the state home, or `undefined` for the resolved one
 * @returns replied, not yet, or could not check — never a throw
 */
export async function checkOwnerReply({
  permalink,
  home,
}: {
  permalink: string;
  home: string | undefined;
}): Promise<OwnerReply> {
  const resolvedHome = typeof home === "string" ? home : slopweaverHome();
  const homeArgs = { home: resolvedHome };
  const chosen = resolveSlackReadToken({ botToken: slackBotToken(homeArgs), userToken: slackUserToken(homeArgs) });
  if (chosen.token === undefined) {
    return { kind: "could-not-check", why: "no Slack token is configured — run `slopweaver connect slack`" };
  }
  const api = makeSlackApi({ token: chosen.token });
  try {
    return await withTimeout({
      task: () =>
        readOwnerReply({
          deps: { api, nowMs: () => Date.now() },
          ownerUserId: ownerUserIdFromProfile({ home: resolvedHome }),
          permalink,
        }),
      timeoutMs: OWNER_REPLY_DEADLINE_MS,
    });
  } catch {
    return {
      kind: "could-not-check",
      why: `Slack did not answer within ${String(OWNER_REPLY_DEADLINE_MS / 1000)} s — a very long thread or a rate limit`,
    };
  }
}
