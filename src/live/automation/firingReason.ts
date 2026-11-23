/**
 * A slot ledger detail cut to its reason — the one parser of the shape `../../cli/commands/automation/rowRunners.ts`
 * § ranVerbOutcome composes, shared by the fleet-health monitor and the Automations page so the two never read the
 * same failure two ways.
 */

/**
 * A ledger detail cut to its reason: without the `recipe <id> · ` it opens with, which a reader already has, and for
 * a verb row without the `ran · slopweaver <argv> · ` it carries too — the exit code and the verb's own `why:` are
 * the reason, the command line is not.
 *
 * @param detail the firing's stored detail
 * @param recipeId the row it belongs to, whose own prefix is cut
 * @returns the reason, e.g. `exit 1: refresh: every selected source is already being refreshed`
 */
export function firingReason({ detail, recipeId }: { detail: string; recipeId: string }): string {
  const prefix = `recipe ${recipeId} · `;
  const reason = detail.startsWith(prefix) ? detail.slice(prefix.length) : detail;
  if (!reason.startsWith("ran · slopweaver ")) {
    return reason;
  }
  const whyAt = reason.indexOf(" · why: ");
  const head = whyAt === -1 ? reason : reason.slice(0, whyAt);
  const exit = head.slice(head.lastIndexOf(" · ") + " · ".length);
  if (whyAt === -1) {
    return exit;
  }
  return `${exit}: ${reason.slice(whyAt + " · why: ".length)}`;
}
