/**
 * The AUTOMATION PROMPT form — the bot's own instructions, declared as a shape rather than smuggled
 * through a generic one.
 *
 * ## The incident this exists because of
 *
 * A daily scheduled row fired and posted its own internal
 * prompt — "FIRST run the verb with `--json` … AFTER it lands, rerun it with the posted ts" — into a TEAM
 * channel, embarrassing the owner in public. The message was deleted and the row parked.
 *
 * The mechanism was `live/automation/investigate.ts` composing a bare `no-fold` artifact and posting it to the
 * row's one and only channel. Nothing in the payload said what that message WAS, so no door could tell an
 * instruction addressed to the bot from a message addressed to a room. The fix: the outbound door
 * refuses an automation prompt aimed at a channel that is not the owner's DM — **schema, not review**.
 *
 * So the payload declares itself. `kind: "automation-prompt"` reaches the door as data, and
 * `cli/commands/slack/runAdmit.ts` refuses it anywhere but the one configured private conversation
 * (`slackBot.promptChannel`). An argv flag was considered and rejected: a flag is a convention the one
 * caller happens to pass, and a caller that omits it disarms the check silently — which is the shape
 * `./botFormKinds.ts`'s own header argues against.
 *
 * ## Two channels, and why the second one is a field rather than prose
 *
 * The leaked row said "Post one bot card here", where "here" meant the prompt's own channel — so the
 * destination of the ANSWER was carried by prose the row author had to remember to write. {@link postTo}
 * makes it a field, named the same as `live/automation/alertSummary.ts`'s, with the same defaulting rule:
 * absent means the card lands in the conversation the prompt was asked in. When it is set, the derived
 * message SAYS so, so the answering session reads its destination off the message rather than off a
 * sentence somebody kept correct by hand.
 *
 * ## Still a no-fold message
 *
 * A question is the one thing a reader must never have to expand to see, and the owner reads this DM too.
 * The whole-message width bound is therefore `NO_FOLD_VISIBLE_MAX`, and the destination line is spent out
 * of the same budget as the prompt — which is stated here because it is the one interaction a caller
 * cannot see from the field caps alone.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { strictForm } from "../strictForm.js";
import { NO_FOLD_VISIBLE_MAX, noFoldArtifactSchema } from "./noFoldSchema.js";
import type { NoFoldArtifact } from "./types.js";

/** The `kind` discriminant an automation prompt payload carries, and the door reads. */
export const AUTOMATION_PROMPT_KIND = "automation-prompt";

/**
 * The prompt's own width cap.
 *
 * Deliberately BELOW {@link NO_FOLD_VISIBLE_MAX} rather than equal to it, and the gap is arithmetic rather
 * than taste: the trailing runs are spent out of the same whole-message budget, so the three caps here are
 * sized together and none of them means anything on its own.
 *
 * ```text
 * 500 prompt + (37 destination sentence + 32 postTo) + (13 run marker + 64 recipeId) = 646 ≤ 650
 * ```
 *
 * That is the WIDEST message this form can derive, and it is inside {@link NO_FOLD_VISIBLE_MAX} by one
 * character. `automationPrompt.test.ts` pins the worst case rather than trusting the sum here, because a
 * sum in prose is exactly what drifts: a sibling derived form once let a long slug derive a TL;DR one
 * character over its cap.
 */
export const AUTOMATION_PROMPT_VISIBLE_MAX = 500;

/**
 * How wide a recipe id may be on this message. The run marker carries it, so it costs the message width.
 *
 * The longest recipe id standing in this install's own definitions directory is 49 characters
 * (a `team-alerts-actioned-<channel>` row over a long alerts channel's name), so this is headroom rather than a squeeze.
 * Reproduce: `ls $SLOPWEAVER_HOME/live/recipe/definitions | awk '{ print length($0) - 5, $0 }' | sort -rn | head -1`.
 */
export const AUTOMATION_RECIPE_ID_MAX = 64;

/**
 * How wide the card's destination may be.
 *
 * A Slack conversation id is 9 to 11 characters, so 32 is three times what any real one costs. It is capped
 * at all — rather than left as an unbounded string — because it is spent out of the same whole-message
 * budget as the prompt, and an uncapped field there makes the sum above unprovable.
 */
export const AUTOMATION_POST_TO_MAX = 32;

/**
 * The prompt form's input: what the bot is being told to do, which row told it, and where the answer goes.
 */
const automationPromptFormFields = strictForm({
  kind: z.literal(AUTOMATION_PROMPT_KIND),
  /**
   * The conversation the FINISHED card lands in, when that is not the conversation the prompt was asked
   * in. Absent means the answer stays where the question was asked.
   */
  postTo: z.string().min(1).max(AUTOMATION_POST_TO_MAX).optional(),
  /** The standing instruction, verbatim — what the bot is being asked, every firing. */
  prompt: z.string().min(1).max(AUTOMATION_PROMPT_VISIBLE_MAX),
  /** The row that asked it, so a reader who did not register the recipe can still tell why this appeared. */
  recipeId: z.string().min(1).max(AUTOMATION_RECIPE_ID_MAX),
});

/**
 * The prompt form, with the derived MESSAGE checked as well as the input.
 *
 * The same two-pass shape every domain form here uses: the fields bound the INPUT, and this bounds what
 * they COMBINE into.
 *
 * UNREACHABLE today, and kept correct anyway — exactly as `./botFormKinds.ts`'s per-form remedies are. The
 * three caps above are sized so that the widest message this form can derive is inside
 * {@link NO_FOLD_VISIBLE_MAX}, so nothing that passes the field caps can fail here. It stays because that
 * arithmetic is a claim about three numbers a later edit could change independently, and a net that reddens
 * a test is better than one that posts a refused message at a scheduled hour.
 */
const automationPromptFormSchema = automationPromptFormFields.superRefine((form, ctx) => {
  const derived = noFoldArtifactSchema.safeParse(automationPromptToNoFold({ form }));
  if (derived.success) {
    return;
  }
  ctx.addIssue({
    code: "custom",
    message:
      `the prompt and the recipe id each sit inside their own limits, but the message they derive is over ` +
      `the ${String(NO_FOLD_VISIBLE_MAX)}-char no-fold bound. What COMBINES is the prompt, the run marker ` +
      `carrying the recipe id, and the destination line when the row names a \`postTo\`. Shorten the ` +
      `prompt. What the layout refused: ${z.prettifyError(derived.error)}`,
    path: ["prompt"],
  });
});

/** An automation prompt, validated. */
export type AutomationPromptForm = z.infer<typeof automationPromptFormSchema>;

/**
 * The sentence that tells the answering session where its finished card goes.
 *
 * Exported because `live/automation/investigate.ts` spends it out of the same width budget when it pre-checks a
 * row, and a second spelling of the line would drift from the one actually rendered.
 *
 * The destination is written as a bare conversation id rather than a `<#…>` channel link on purpose: the
 * no-fold run vocabulary carries text, links and person mentions only, so a raw channel reference would be
 * refused as untypeable markup by `./typedRuns.ts` rather than rendered.
 *
 * @param postTo the conversation the finished card lands in
 * @returns the single line, ready to become a trailing run
 */
export function automationDestinationLine({ postTo }: { postTo: string }): string {
  return `The finished card goes in ${postTo}, not here.`;
}

/**
 * The run marker every automation prompt carries.
 *
 * @param recipeId the row that asked the question
 * @returns the marker text
 */
export function automationRunMarker({ recipeId }: { recipeId: string }): string {
  return `automation · ${recipeId}`;
}

/**
 * Derive the message an automation prompt sends.
 *
 * Shaped rather than validated: the caller runs it through `noFoldArtifactSchema`, which is what the door
 * applies at the wire. Kept separate from the schema so the schema's own `superRefine` can call it without
 * recursing.
 *
 * @param form the validated prompt form
 * @returns the no-fold artifact, ready to validate and serialise
 */
export function automationPromptToNoFold({
  form,
}: {
  form: Omit<AutomationPromptForm, "kind">;
}): Readonly<Record<string, unknown>> {
  const destination: readonly (readonly Readonly<Record<string, unknown>>[])[] =
    form.postTo === undefined ? [] : [[{ text: automationDestinationLine({ postTo: form.postTo }), type: "text" }]];
  return {
    kind: "no-fold",
    lead: [{ text: form.prompt, type: "text" }],
    trailing: [
      ...destination,
      [{ italic: true, text: automationRunMarker({ recipeId: form.recipeId }), type: "text" }],
    ],
  };
}

/**
 * Parse one automation prompt payload into the message it sends.
 *
 * @param raw the payload, already JSON-parsed
 * @returns the no-fold artifact, or every violation
 */
export function parseAutomationPrompt({ raw }: { raw: unknown }): Result<NoFoldArtifact> {
  const form = automationPromptFormSchema.safeParse(raw);
  if (!form.success) {
    return err(
      z
        .prettifyError(form.error)
        .split("\n")
        .filter((line) => line.length > 0),
    );
  }
  const artifact = noFoldArtifactSchema.safeParse(automationPromptToNoFold({ form: form.data }));
  if (!artifact.success) {
    return err(
      z
        .prettifyError(artifact.error)
        .split("\n")
        .filter((line) => line.length > 0),
    );
  }
  return ok(artifact.data);
}

/**
 * Check one automation prompt payload exactly as {@link parseAutomationPrompt} does, naming each issue by
 * its field path rather than in Zod's prettified layout.
 *
 * `live/automation/investigate.ts` pre-checks a recipe row through this rather than a restatement of the form:
 * checking only the derived message once admitted a 542-char question this door then refused at every firing
 * (`datadog-regression-hunt-daily`), because the prompt's own cap binds first.
 *
 * @param raw the payload, as the row would send it
 * @returns the no-fold artifact, or every violation as a `path: message` line
 */
export function checkAutomationPrompt({ raw }: { raw: unknown }): Result<NoFoldArtifact> {
  const form = automationPromptFormSchema.safeParse(raw);
  if (!form.success) {
    return err(issueLines({ issues: form.error.issues }));
  }
  const artifact = noFoldArtifactSchema.safeParse(automationPromptToNoFold({ form: form.data }));
  if (!artifact.success) {
    return err(issueLines({ issues: artifact.error.issues }));
  }
  return ok(artifact.data);
}

/** Each Zod issue as `path: message`, naming the whole form when the path is empty. */
function issueLines({ issues }: { issues: readonly z.core.$ZodIssue[] }): readonly string[] {
  return issues.map((issue) => {
    const path = issue.path.join(".");
    if (path.length === 0) {
      return `form: ${issue.message}`;
    }
    return `${path}: ${issue.message}`;
  });
}
