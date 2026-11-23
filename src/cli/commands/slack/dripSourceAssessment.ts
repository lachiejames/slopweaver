/**
 * Whether an as-me source is a valid send, and which exact voice rules its authored prose matched.
 *
 * Split out of `./dripCore.ts` under the file-size ratchet, along the seam the two halves already had: this
 * module judges a source against the operator's bounds (`./asMeForm.ts` says which form it is), and `dripCore`
 * plans and reports the drip it becomes. Everything here is pure and knows nothing about sending.
 */
import { z } from "zod";

import { err, ok } from "../../../lib/result.js";
import { plainArtifactSchema } from "../../../outbound/artifact/asMeSchema.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import { type SlackDelivery, SlackDeliveryErrors } from "../../../outbound/slack/deliveryErrors.js";
import { SLACK_MESSAGE_TEXT_MAX } from "../../../outbound/slack/dripRender.js";
import {
  type ExactVoiceRule,
  type ExactVoiceRuleFinding,
  exactVoiceRuleFindings,
  rulesForActor,
  VOICE_RULES_ESCAPE,
  voiceRuleLabel,
} from "../../../outbound/voice/exactRules.js";
import { type AsMeFormBounds, formSchemaFor, voiceProseOf } from "./asMeForm.js";
import type { DripSource } from "./coreTypes.js";

/** A validated source together with the exact private voice-rule matches observed while validating it. */
export interface SlackDripSourceAssessment {
  /** The schema-valid artifact, or every SCHEMA refusal. A voice finding is not one — see below. */
  readonly parsed: SlackDelivery<AsMeArtifact>;
  /** Exact private rules that matched authored prose, including when the invocation overrides them. */
  readonly voiceRuleFindings: readonly ExactVoiceRuleFinding[];
  /**
   * The same findings rendered as readable lines, for a `--dry-run` preview to print.
   *
   * ADVISORY here and nowhere else: the door is what refuses the send. Empty when the named hatch is open,
   * because a caller that already said "send it anyway" does not need the list read back at them.
   */
  readonly advisory: readonly string[];
}

/**
 * Validate an as-me source and retain its exact-rule findings for the pain-point ledger and the door.
 *
 * A malformed artifact has no trustworthy authored-prose regions, so it yields no findings. A valid
 * artifact always reports its findings, even when the named override admits it; that makes the ledger a
 * record of composition friction rather than only refused sends.
 *
 * ## A voice finding no longer fails the PARSE — it is the door's to judge
 *
 * This used to fold every finding into `parsed` as an `err`, so the shell exited `EXIT_USAGE` before
 * `throughDoor` was ever called. That is why `admitDoor` had never once seen a voice finding, on the one
 * lane where the em-dash leak was measured. **Owner rule**: no hard blocks for voice —
 * every voice rule uses the door's fail-loudly-then-escape-hatch shape. So the findings are still computed
 * here, exactly as before, and `../../../admit/voiceProfileGate.ts` is what decides the send. The refusal
 * text is unchanged in substance: the send still does not go, and the finding is still named.
 *
 * `allowVoiceRules` is kept because `--dry-run` still reports the findings as advisory lines and a caller
 * that has already opened the named hatch should not be told about them twice.
 *
 * @param source where the words came from
 * @param config the operator's drip bounds and exact rules, from `profile.json`
 * @param allowVoiceRules whether the named one-invocation override is active
 * @returns the validated artifact together with every exact-rule finding
 */
export function assessSlackDripSource({
  source,
  config,
  allowVoiceRules,
}: {
  source: DripSource;
  config: AsMeFormBounds & { readonly exactVoiceRules: readonly ExactVoiceRule[] };
  allowVoiceRules: boolean;
}): SlackDripSourceAssessment {
  let artifact: SlackDelivery<AsMeArtifact>;
  if (source.kind === "body") {
    artifact = validate({
      schema: plainArtifactSchema({ maxChars: SLACK_MESSAGE_TEXT_MAX }),
      value: { kind: "plain", text: source.text },
    });
  } else {
    let raw: unknown;
    try {
      raw = JSON.parse(source.json);
    } catch (error) {
      const parsed = err(SlackDeliveryErrors.formNotJson({ reason: String(error) }));
      return { advisory: [], parsed, voiceRuleFindings: [] };
    }
    artifact = validate({ schema: formSchemaFor({ config, raw }), value: raw });
  }
  if (artifact.isErr() || config.exactVoiceRules.length === 0) {
    return { advisory: [], parsed: artifact, voiceRuleFindings: [] };
  }
  // Every caller of this function is an `--as me` lane, so the actor is settled here rather than threaded
  // through: a rule scoped to the bot is not this lane's to enforce. `../../../admit/voiceProfileGate.ts`
  // applies the same split off the door request's own `actor` field, so the two cannot disagree.
  const voiceRuleFindings = exactVoiceRuleFindings({
    prose: voiceProseOf({ artifact: artifact.value }),
    rules: rulesForActor({ actor: "me", rules: config.exactVoiceRules }),
  });
  // `allowVoiceRules` is read so the advisory dry-run lines stay silent under the named hatch; the SEND
  // decision moved to the door and is not made here any more.
  return {
    advisory: allowVoiceRules ? [] : voiceRuleFindings.map(voiceRuleRefusal),
    parsed: artifact,
    voiceRuleFindings,
  };
}

/**
 * Parse and validate an as-me source into an artifact, reporting every violation in one pass.
 *
 * @param source where the words came from
 * @param config the operator's drip bounds and exact rules, from `profile.json`
 * @param allowVoiceRules whether the named one-invocation override is active
 * @returns the validated artifact, or every violation
 */
export function parseSlackDripSource({
  source,
  config,
  allowVoiceRules,
}: {
  source: DripSource;
  config: AsMeFormBounds & { readonly exactVoiceRules: readonly ExactVoiceRule[] };
  allowVoiceRules: boolean;
}): SlackDelivery<AsMeArtifact> {
  return assessSlackDripSource({ allowVoiceRules, config, source }).parsed;
}

/** One actionable refusal, including the exact invocation that bypasses it deliberately. */
function voiceRuleRefusal({ path, rule }: { path: string; rule: ExactVoiceRule }): string {
  return (
    `${path} ${voiceRuleLabel({ rule })}. Rewrite the authored ` +
    `prose, or for one deliberate exception run ${VOICE_RULES_ESCAPE}; the grant sends the ` +
    "original content unchanged."
  );
}

/** Run a schema and flatten its complaint into the repo's error-list shape. */
function validate<T>({ schema, value }: { schema: z.ZodType<T>; value: unknown }): SlackDelivery<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const reasons = z.prettifyError(parsed.error).split("\n");
    return err(SlackDeliveryErrors.formInvalid({ reasons: reasons.filter((line) => line.length > 0) }));
  }
  return ok(parsed.data);
}
