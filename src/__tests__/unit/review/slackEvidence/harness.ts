/*
 * What the Slack review-evidence test files share: the pull request under test, the owner's identity, a Slack
 * corpus record builder and a message linking a pull request. They moved here when `slackEvidence.test.ts` was
 * split by behaviour.
 */
import type { CorpusRecord } from "../../../../corpus/types.js";

export const REF = { number: 16349, owner: "owner", repo: "repo" };

/** Who the owner is, as the review-state run reads it from `profile.json`. */
export const IDENTITY = { ownerSlackUserId: "U1", selfUserIds: ["UBOT"] };

/**
 * A Slack corpus record carrying a raw payload, as the projection writes one.
 *
 * @returns the Slack corpus record carrying the requested source identity and text
 */
export const slackRecord = ({
  sourceId,
  text,
  edited = false,
  kind = "message",
}: {
  sourceId: string;
  text: string;
  edited?: boolean;
  kind?: CorpusRecord["kind"];
}): CorpusRecord => ({
  container: "slack/C1",
  kind,
  raw: edited ? { edited: { ts: "[number].000000" }, text } : { text },
  refs: [],
  source: "slack",
  sourceId,
  text,
  tsIso: "2026-09-01T00:00:00.000Z",
  url: "https://x.slack.com/archives/C1/p1",
});

export const LINKING = "<@U9> pls review <https://github.com/o/r/pull/1>";
