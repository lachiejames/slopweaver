/**
 * The production effects live-incident detection runs through ({@link IncidentDetectDeps}): the seen ledger, the
 * readability probe on the token `slack read-thread` resolves, the declared checkout, the board registration and the
 * row doc it leaves.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { resolveSlackReadToken, type SlackApi } from "../../../corpus/slack/fetch.js";
import {
  claimedIncidentChannelIds,
  claimIncidentChannel,
  reclaimStaleIncidentClaim,
  releaseIncidentClaim,
} from "../../../incident/claim.js";
import type { IncidentDetectDeps, IncidentReadProbe, IncidentRowDoc } from "../../../incident/register.js";
import { incidentRowSlug } from "../../../incident/row.js";
import { appendSeenRow, readSeenChannelIds } from "../../../incident/seen.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";
import { readOrganisation } from "../../../organisation/read.js";
import { stateHomePaths } from "../../../stateHome.js";
import { registerAskRow } from "../handover/askRowRun.js";
import { registeredReceiptLine } from "../handover/registerReceipt.js";

/**
 * Read one message of a channel's history with the token `slack read-thread` would resolve.
 *
 * @param home the state home whose secrets hold the tokens
 * @param channelId the channel to probe
 * @param nowMs the probe's instant, epoch milliseconds — the history window's upper edge
 * @returns readable by a named principal on a named workspace, or why not
 */
async function probeIncidentChannel({
  home,
  channelId,
  nowMs,
}: {
  home: string;
  channelId: string;
  nowMs: number;
}): Promise<IncidentReadProbe> {
  const chosen = resolveSlackReadToken({ botToken: slackBotToken({ home }), userToken: slackUserToken({ home }) });
  if (chosen.token === undefined) {
    return { readable: false, why: "no Slack token configured — `slopweaver secrets status` names the missing one" };
  }
  const principal = chosen.warning === undefined ? "user" : "bot";
  return probeChannelWith({ api: makeSlackApi({ token: chosen.token }), channelId, nowMs, principal });
}

/**
 * The probe's two calls on one resolved token: the channel's history FIRST — the readability question itself — and
 * only then `auth.test`'s workspace URL, which the row's link needs. So a channel the token can read is never called
 * unreadable for a reason that is not about reading it.
 *
 * @param api the Slack seam the resolved token built
 * @param principal which token it is, for the report
 * @param channelId the channel to probe
 * @param nowMs the probe's instant, epoch milliseconds — the history window's upper edge
 * @returns readable by the principal on a named workspace, or why not
 */
export async function probeChannelWith({
  api,
  principal,
  channelId,
  nowMs,
}: {
  api: Pick<SlackApi, "history" | "workspaceUrl">;
  principal: "user" | "bot";
  channelId: string;
  nowMs: number;
}): Promise<IncidentReadProbe> {
  try {
    await api.history({ channel: channelId, latest: String(Math.floor(nowMs / 1000)), oldest: "0", pageSize: 1 });
  } catch (error: unknown) {
    return { readable: false, why: `not readable by the ${principal} token: ${errorMessage({ error })}` };
  }
  try {
    const workspaceUrl = await api.workspaceUrl();
    if (workspaceUrl === undefined) {
      return {
        readable: false,
        why: `readable by the ${principal} token, but auth.test named no workspace URL to link the row from`,
      };
    }
    return { principal, readable: true, workspaceUrl };
  } catch (error: unknown) {
    return {
      readable: false,
      why: `readable by the ${principal} token, but auth.test failed so the row has no link: ${errorMessage({ error })}`,
    };
  }
}

/**
 * The channel's incident row doc, live and archived — at most one of each, since the slug is the channel id alone
 * (`incidentRowSlug`), so a rename cannot hide one.
 *
 * An absent doc is no doc. Any OTHER failure to read one refuses, because reading it as "no row" is exactly what
 * would register a second row for a channel that already has one.
 *
 * @param home the state home
 * @param channelId the channel whose slug the docs are named by
 * @returns the docs, or why they would not all read
 */
export function incidentRowDocs({
  home,
  channelId,
}: {
  home: string;
  channelId: string;
}): Result<readonly IncidentRowDoc[]> {
  const paths = stateHomePaths({ home });
  const slug = incidentRowSlug({ channel: { id: channelId } });
  const docs: IncidentRowDoc[] = [];
  for (const dir of [paths.handovers, paths.handoverArchive]) {
    const path = join(dir, `${slug}.md`);
    try {
      docs.push({ slug, text: readFileSync(path, "utf8") });
    } catch (error: unknown) {
      if (!(isRecord(error) && error["code"] === "ENOENT")) {
        return err([`${path} would not read: ${errorMessage({ error })}`]);
      }
    }
  }
  return ok(docs);
}

/**
 * Every production effect, bound to one state home and one clock.
 *
 * @param home the state home rows, the ledger and the tokens live in
 * @param nowMs the sweep's instant, epoch milliseconds
 * @returns the deps
 */
export function productionIncidentDetectDeps({ home, nowMs }: { home: string; nowMs: number }): IncidentDetectDeps {
  const startedWallMs = Date.now();
  // Minted once per sweep: every claim it writes carries it, so its release can never take another sweep's.
  const holder = randomUUID();
  return {
    checkout: () => checkoutForRunningRepo({ home, verb: "incident detect" }),
    claimed: () => claimedIncidentChannelIds({ home }),
    claim: ({ channelId }) => claimIncidentChannel({ atIso: new Date(nowMs).toISOString(), channelId, holder, home }),
    probe: ({ channelId }) => probeIncidentChannel({ channelId, home, nowMs }),
    organisation: async () => (await readOrganisation({ home })).mapErr((error): readonly string[] => [error.message]),
    record: ({ row }) => appendSeenRow({ home, row }),
    register: async ({ argv, slug }) => {
      const lines: string[] = [];
      const code = await registerAskRow({ argv, origin: "automation", out: ({ line }) => lines.push(line) });
      return { code, created: lines.includes(registeredReceiptLine({ slug })) };
    },
    reclaim: ({ path }) => reclaimStaleIncidentClaim({ holder, nowMs, path }),
    // Only a claim this sweep's own `claim` stamped, still young after the time the sweep has really spent, is ever
    // removed: a probe can take long enough for another sweep to call the claim stale, and one it may be taking over
    // stays. The age is the sweep's instant plus real elapsed time, so a replay's past `--now` still judges it.
    release: ({ path }) =>
      releaseIncidentClaim({
        atIso: new Date(nowMs).toISOString(),
        holder,
        nowMs: nowMs + (Date.now() - startedWallMs),
        path,
      }),
    rowDocs: ({ channelId }) => incidentRowDocs({ channelId, home }),
    seen: () => readSeenChannelIds({ home }),
  };
}
