/**
 * Which model a dispatched worker — or the reviewer it spawns — is booted onto.
 *
 * The pin-the-model rule (`skills/supervisor/SKILL.md` § 0, the owner's own ruling): a spawned session's model
 * is chosen ONCE, at boot, by the `--model` flag on its boot line, and never switched mid-run. Omitting the
 * flag does not mean "no choice" — it means the launching user's saved default, which drifts from week to
 * week, so two workers spawned for the same kind of ask can silently land on different tiers. An ask worker
 * is therefore always pinned explicitly: to the tier the judging session named on its decision, or to the
 * default here when it named none.
 *
 * Why the default is Opus rather than Sonnet: doctrine rule 5 puts Opus on supervision and judgement and
 * Sonnet on scoped leaves. A worker owns one Slack ask end to end — it reads the thread, decides what to
 * investigate, composes the answer and takes it through the door — which is the judgement end of that split,
 * not a leaf. The judging session right-sizes DOWN by naming `sonnet` on the decision for an ask it can see
 * is narrow. Pure: no I/O.
 */
import type { RespondDecision } from "./tier.js";

/** The tier an ask worker boots onto when the decision named none. See this module's header for why Opus. */
export const DEFAULT_WORKER_MODEL = "opus";

/**
 * The reviewer's tier. The reviewer reads a small, code-built packet and classifies claims — the owner's own
 * framing is that the small context "is what lets the reviewer run on a good model", so it is never
 * right-sized below the worker it checks.
 */
export const DEFAULT_REVIEWER_MODEL = "opus";

/**
 * The model a `fresh-visible-session` worker is pinned to for one decision.
 *
 * @param decision the judging session's own `respond` decision, which may name a model
 * @returns the decision's model when it named one, else {@link DEFAULT_WORKER_MODEL} — never `undefined`
 */
export function pinnedWorkerModel({ decision }: { decision: RespondDecision }): string {
  const { model } = decision;
  if (model == null) {
    return DEFAULT_WORKER_MODEL;
  }
  return model;
}
