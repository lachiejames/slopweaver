/**
 * The `talk` noun's manifest rows in `cli/manifests/talk.ts` quote their usage from a leaf module rather than from the
 * command module they describe, so enumerating the surface never loads a command. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant the
 * command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import {
  TALK_ASSESSMENT_DUE_USAGE,
  TALK_ASSESSMENT_RECORD_USAGE,
} from "../../../../cli/commands/talk/assessmentUsage.js";
import { TALK_CALL_TOOLS_USAGE } from "../../../../cli/commands/talk/callToolsUsage.js";
import {
  TALK_CAPABILITIES_USAGE,
  TALK_FIND_CARD_USAGE,
  TALK_GLOSSARY_USAGE,
  TALK_HISTORY_USAGE,
  TALK_KNOWLEDGE_USAGE,
  TALK_MEETING_DUE_USAGE,
  TALK_ORIGIN_USAGE,
  TALK_SLACK_AFTER_USAGE,
  TALK_SLACK_CHANNEL_USAGE,
  TALK_SLACK_OPEN_USAGE,
  TALK_SLACK_SEND_OUTCOME_USAGE,
} from "../../../../cli/commands/talk/knowUsage.js";
import {
  TALK_ATTACH_USAGE,
  TALK_CALLS_USAGE,
  TALK_CODE_USAGE,
  TALK_LOG_USAGE,
  TALK_OFFER_USAGE,
  TALK_PACK_USAGE,
  TALK_RELAY_USAGE,
  TALK_ROW_USAGE,
  TALK_SUPERVISOR_USAGE,
} from "../../../../cli/commands/talk/usage.js";
import { talkManifest } from "../../../../cli/manifests/talk.js";
import { talkKnowManifest } from "../../../../cli/manifests/talkKnow.js";

describe("talkManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(talkManifest["assessment-due"]!.meta.usage).toBe(TALK_ASSESSMENT_DUE_USAGE);
    expect(talkManifest["assessment-record"]!.meta.usage).toBe(TALK_ASSESSMENT_RECORD_USAGE);
    expect(talkManifest["attach"]!.meta.usage).toBe(TALK_ATTACH_USAGE);
    expect(talkManifest["attach"]!.meta.effect).toBe("local-state");
    expect(talkManifest["call-tools"]!.meta.usage).toBe(TALK_CALL_TOOLS_USAGE);
    expect(talkManifest["calls"]!.meta.usage).toBe(TALK_CALLS_USAGE);
    expect(talkManifest["capabilities"]!.meta.usage).toBe(TALK_CAPABILITIES_USAGE);
    expect(talkManifest["code"]!.meta.usage).toBe(TALK_CODE_USAGE);
    expect(talkManifest["find-card"]!.meta.usage).toBe(TALK_FIND_CARD_USAGE);
    expect(talkManifest["glossary"]!.meta.usage).toBe(TALK_GLOSSARY_USAGE);
    expect(talkManifest["history"]!.meta.usage).toBe(TALK_HISTORY_USAGE);
    expect(talkManifest["knowledge"]!.meta.usage).toBe(TALK_KNOWLEDGE_USAGE);
    expect(talkManifest["log"]!.meta.usage).toBe(TALK_LOG_USAGE);
    expect(talkManifest["meeting-due"]!.meta.usage).toBe(TALK_MEETING_DUE_USAGE);
    expect(talkManifest["offer"]!.meta.usage).toBe(TALK_OFFER_USAGE);
    expect(talkManifest["origin"]!.meta.usage).toBe(TALK_ORIGIN_USAGE);
    expect(talkManifest["pack"]!.meta.usage).toBe(TALK_PACK_USAGE);
    expect(talkManifest["relay"]!.meta.usage).toBe(TALK_RELAY_USAGE);
    expect(talkManifest["row"]!.meta.usage).toBe(TALK_ROW_USAGE);
    expect(talkManifest["slack-after"]!.meta.usage).toBe(TALK_SLACK_AFTER_USAGE);
    expect(talkManifest["slack-channel"]!.meta.usage).toBe(TALK_SLACK_CHANNEL_USAGE);
    expect(talkManifest["slack-open"]!.meta.usage).toBe(TALK_SLACK_OPEN_USAGE);
    expect(talkManifest["slack-send-outcome"]!.meta.usage).toBe(TALK_SLACK_SEND_OUTCOME_USAGE);
    expect(talkManifest["supervisor"]!.meta.usage).toBe(TALK_SUPERVISOR_USAGE);
  });

  it("carries every verb `talkKnow.ts` declares, as the very same entry", () => {
    expect(Object.keys(talkKnowManifest)).toEqual([
      "capabilities",
      "find-card",
      "glossary",
      "history",
      "knowledge",
      "meeting-due",
      "origin",
      "recall",
      "recent",
      "slack-after",
      "slack-channel",
      "slack-open",
      "slack-send-outcome",
      "steer-risk",
    ]);
    expect(Object.keys(talkKnowManifest).filter((verb) => talkManifest[verb] !== talkKnowManifest[verb])).toEqual([]);
  });
});
