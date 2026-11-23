/**
 * The `slack` noun's manifest rows in `cli/manifests/slack.ts` quote their usage from a leaf module rather than from
 * the command module they describe, so enumerating the surface never loads a command. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant the
 * command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import {
  DELETE_USAGE,
  EDIT_USAGE,
  POLL_USAGE,
  POST_USAGE,
  REPLY_USAGE,
  SLACK_DRAFT_USAGE,
} from "../../../../cli/commands/slack/slackUsage.js";
import { SLACK_TAGGED_USAGE } from "../../../../cli/commands/slack/taggedUsage.js";
import { SLACK_UNREAD_USAGE } from "../../../../cli/commands/slack/unreadUsage.js";
import {
  SLACK_ALERT_SUMMARY_USAGE,
  SLACK_CANVAS_USAGE,
  SLACK_CHANNEL_USAGE,
  SLACK_DM_USAGE,
  SLACK_OWED_USAGE,
  SLACK_PROBE_USAGE,
  SLACK_READ_FILE_USAGE,
  SLACK_READ_THREAD_USAGE,
  SLACK_SAVED_USAGE,
  SLACK_SHOT_USAGE,
  SLACK_VOICE_RULES_USAGE,
  SLACK_WHEN_USAGE,
} from "../../../../cli/commands/slack/verbUsage.js";
import { slackManifest } from "../../../../cli/manifests/slack.js";

describe("slackManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(slackManifest["alert-summary"]!.meta.usage).toBe(SLACK_ALERT_SUMMARY_USAGE);
    expect(slackManifest["canvas"]!.meta.usage).toBe(SLACK_CANVAS_USAGE);
    expect(slackManifest["channel"]!.meta.usage).toBe(SLACK_CHANNEL_USAGE);
    expect(slackManifest["delete"]!.meta.usage).toBe(DELETE_USAGE);
    expect(slackManifest["dm"]!.meta.usage).toBe(SLACK_DM_USAGE);
    expect(slackManifest["edit"]!.meta.usage).toBe(EDIT_USAGE);
    expect(slackManifest["owed"]!.meta.usage).toBe(SLACK_OWED_USAGE);
    expect(slackManifest["poll"]!.meta.usage).toBe(POLL_USAGE);
    expect(slackManifest["probe"]!.meta.usage).toBe(SLACK_PROBE_USAGE);
    expect(slackManifest["draft"]!.meta.usage).toBe(SLACK_DRAFT_USAGE);
    expect(slackManifest["post"]!.meta.usage).toBe(POST_USAGE);
    expect(slackManifest["read-file"]!.meta.usage).toBe(SLACK_READ_FILE_USAGE);
    expect(SLACK_READ_FILE_USAGE).toContain("docs/security/slack-huddles.md");
    expect(slackManifest["read-thread"]!.meta.usage).toBe(SLACK_READ_THREAD_USAGE);
    expect(slackManifest["shot"]!.meta.usage).toBe(SLACK_SHOT_USAGE);
    expect(slackManifest["saved"]!.meta.usage).toBe(SLACK_SAVED_USAGE);
    expect(slackManifest["reply"]!.meta.usage).toBe(REPLY_USAGE);
    expect(slackManifest["tagged"]!.meta.usage).toBe(SLACK_TAGGED_USAGE);
    expect(slackManifest["unread"]!.meta.usage).toBe(SLACK_UNREAD_USAGE);
    expect(slackManifest["voice-rules"]!.meta.usage).toBe(SLACK_VOICE_RULES_USAGE);
    expect(slackManifest["when"]!.meta.usage).toBe(SLACK_WHEN_USAGE);
  });

  it("classifies `saved` as an external read that files nothing and is safe to dry-parse", () => {
    const meta = slackManifest["saved"]!.meta;
    expect([
      meta.effect,
      meta.doorRouted,
      meta.createsWorkItem,
      meta.diagnostic,
      meta.dryParseSafe,
      meta.parseRejectIsIoFree,
    ]).toEqual(["external-read", false, false, false, true, true]);
  });
});
