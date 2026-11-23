/**
 * The tick's side of owner turn 291-8x: asking `live/automation/postTarget.ts` where a row's card may land, and
 * turning its refusal into the one line every kind prints.
 *
 * Its own module rather than four blocks inside `./rowRunners.ts` because the rail is one sentence the owner asked
 * to be impossible to get wrong, and four copies of a seventeen-line resolve-then-refuse block is how a
 * wording drifts apart between kinds. The pure judgement lives in `live/automation/postTarget.ts`; this is the
 * shape a row runner needs it in.
 */
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { resolveScheduledPostTarget, type ScheduledPostTargetError } from "../../../live/automation/postTarget.js";

/**
 * Either the conversation a scheduled card may land in, or the line saying why it may not.
 *
 * Two arms rather than a `Result` because the caller's failure arm is a printed ROW OUTCOME, not an error
 * it forwards — `.claude/rules/error-handling.md` keeps a typed union for a failure a caller branches on,
 * and every caller here does the same thing with it.
 */
export type AdmittedPostTarget = { readonly channel: string } | { readonly refusal: string };

/**
 * The refusal line one unadmitted destination prints, so every kind says the same thing about it.
 *
 * @param error what `live/automation/postTarget.ts` refused, carrying its own no-hatch text
 * @param recipeId the row being run
 * @returns the line to print
 */
export function postTargetRefusedLine({
  error,
  recipeId,
}: {
  error: ScheduledPostTargetError;
  recipeId: string;
}): string {
  return `recipe ${recipeId} · REFUSED · ${error.message} · nothing was posted`;
}

/**
 * Resolve where this row's card goes, before a single provider read is spent on it.
 *
 * @param definition the due row, whose `channelApprovals` are the one thing that admits a channel
 * @param dmChannel the owner's configured private conversation, absent on an install that has set none
 * @param requested what the row asked for, absent when it named nowhere
 * @param where the field that named it, so a refusal points at the line to edit
 * @returns the admitted conversation, or the refusal line to print instead
 */
export function admitScheduledPostTarget({
  definition,
  dmChannel,
  requested,
  where,
}: {
  definition: RecipeDefinition;
  dmChannel: string | undefined;
  requested: string | undefined;
  where: string;
}): AdmittedPostTarget {
  const resolved = resolveScheduledPostTarget({
    approvals: definition.channelApprovals,
    dmChannel,
    recipeId: definition.recipeId,
    requested,
    where,
  });
  if (resolved.isErr()) {
    return { refusal: postTargetRefusedLine({ error: resolved.error, recipeId: definition.recipeId }) };
  }
  return { channel: resolved.value };
}
