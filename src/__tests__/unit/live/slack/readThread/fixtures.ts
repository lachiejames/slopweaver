/*
 * The pure Slack read seams every `readSlackThread` test file builds on: the linked thread's address, the
 * canonical workspace, the three seams that THROW when a case reaches one it should not, and `apiServing`,
 * a read seam over fixed pages. Nothing here touches a disk; the effectful half lives in `./harness.ts`.
 */
import type { SlackApi } from "../../../../../corpus/slack/fetch.js";

export const LINK = "https://example.slack.com/archives/C123/p1785114398557099";
export const THREAD = "1785114398.557099";

/** The seam `readSlackThread` consumes: thread pages plus the `files.info` lookup for Block Kit refs. */
export type ReadApi = Pick<SlackApi, "replies" | "history" | "filesInfo" | "grantedScopes" | "workspaceUrl">;

/** The canonical workspace `LINK` already carries — most fakes need only echo it. */
export const CANONICAL_WORKSPACE = "https://example.slack.com";

/**
 * A `files.info` that THROWS. Most cases here have no Block Kit file reference at all, so any call is a
 * defect — and a throw turns "the lookup was not needed" into an assertion instead of an assumption.
 */
export const refusingFilesInfo: SlackApi["filesInfo"] = async ({ fileId }) => {
  throw new Error(`no files.info lookup should have been attempted, but one was for ${fileId}`);
};

/** Channel history is opt-in; any unrequested call is a defect in the ordinary thread cases. */
export const refusingHistory: SlackApi["history"] = async () => {
  throw new Error("no channel history should have been requested");
};

/** A permalink refused before parsing must never reach `auth.test` either. */
export const refusingWorkspaceUrl: SlackApi["workspaceUrl"] = async () => {
  throw new Error("no workspace resolution should have been attempted");
};

/**
 * A read seam over fixed pages. The scope set defaults to a token that demonstrably holds `files:read` — the
 * ordinary case — so a case about a scope gap has to say so explicitly rather than inherit it.
 *
 * @param messages the one page `conversations.replies` answers with, whatever ts is asked for
 * @param scopes the granted token scopes `grantedScopes` reports
 * @returns a seam serving those pages that refuses history and `files.info`, and echoes the canonical workspace
 */
export function apiServing({
  messages,
  scopes = ["files:read", "channels:history"],
}: {
  messages: readonly unknown[];
  scopes?: readonly string[];
}): ReadApi {
  return {
    filesInfo: refusingFilesInfo,
    grantedScopes: async () => scopes,
    history: refusingHistory,
    replies: async () => ({ messages }),
    workspaceUrl: async () => CANONICAL_WORKSPACE,
  };
}
