/**
 * The voice gate every door-routed Slack write shares — a card, a poll, a canvas, a channel's purpose, a
 * status — read through the lane's own rules seam, so a profile that cannot be trusted stops the write once,
 * here, instead of being read as "no rules" by five copies of the same few lines.
 */
import type { PainPointLane } from "../../../admit/painPoint.js";
import { type VoiceGateInput, voiceInputFor } from "../../../admit/voiceProfileGate.js";
import { hatchOpen } from "../../../hatch/open.js";
import type { Result } from "../../../lib/result.js";
import type { SlackActor } from "../../../outbound/slack/types.js";
import type { AuthoredProse, ExactVoiceRule, ExactVoiceRuleFinding } from "../../../outbound/voice/exactRules.js";
import type { ProfileReadError } from "../../../profileStore.js";

/**
 * Judge one write's authored prose against the operator's voice rules, read through the lane's own seam.
 *
 * A profile that cannot be trusted is the failure, never an empty rule list: read as none, every word got
 * through. A rule match is recorded as a pain point whatever the door then decides, because it describes how
 * the composer writes rather than whether this write goes out.
 *
 * @param actor the lane this write runs on, which picks both the half of the rule list and the pain-point lane
 * @param env the environment the named `voice-rules` hatch is read from
 * @param nowIso the instant the journalled hatch's expiry is judged against
 * @param record whether to write rule matches down; a dry run passes `false` and writes nothing
 * @param recordVoicePainPoints the ledger seam a match is written through
 * @param voiceRules the lane's seam onto the operator's rules
 * @returns the door's voice-gate input, or why the profile holding the rules cannot be trusted
 */
export function slackVoiceGateInput({
  actor,
  env,
  home,
  nowIso,
  prose,
  record,
  recordVoicePainPoints,
  voiceRules,
}: {
  actor: SlackActor;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  nowIso: string;
  prose: readonly AuthoredProse[];
  record: boolean;
  recordVoicePainPoints: (args: {
    home: string;
    findings: readonly ExactVoiceRuleFinding[];
    lane: PainPointLane;
  }) => void;
  voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
}): Result<VoiceGateInput, ProfileReadError> {
  return voiceRules({ home }).map((rules) => {
    const voice = voiceInputFor({
      actor,
      allowVoiceRules: hatchOpen({ env, home, id: "voice-rules", nowIso }),
      prose,
      rules,
    });
    if (record && voice.findings.length > 0) {
      recordVoicePainPoints({ findings: voice.findings, home, lane: actor === "me" ? "as-me" : "as-bot" });
    }
    return voice.gate;
  });
}
