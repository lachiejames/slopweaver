/**
 * What one `cmux reseat` relaunch came to, the line the verb prints for it, and the pass's exit — the result half
 * of `./reseat.ts`'s planning, pure.
 */
import type { ReseatPlan, ReseatPrior } from "./reseat.js";
import type { ReseatError } from "./reseatErrors.js";

/** One workspace's result. */
export type ReseatOutcome =
  /** Relaunched, and a live session carries the id again; `seat` is `claude seat`'s line for it. */
  | { readonly kind: "reseated"; readonly plan: ReseatPlan; readonly seat: string }
  /**
   * Relaunched FRESH, because the session had no transcript to resume (planned so) or its resume printed `No
   * conversation found` (retried once so): a live Claude composer stands in the tab under `freshSessionId`, holding
   * no conversation and no pickup. Never `reseated`: nothing it was doing came back.
   */
  | {
      readonly kind: "fresh-seated";
      readonly plan: ReseatPlan;
      readonly freshSessionId: string;
      readonly why: "no-transcript" | "missing-conversation";
      readonly seat: string;
    }
  /** `--dry-run`: what would be sent. */
  | { readonly kind: "would-reseat"; readonly plan: ReseatPlan; readonly line: string }
  /** Not reseated, and why. */
  | { readonly kind: "refused"; readonly workspaceRef: string; readonly error: ReseatError };

/** What a relaunch does before it types: stop the live pid, or nothing, the tab being a bare shell. */
function priorStep({ prior }: { prior: ReseatPrior }): string {
  if (prior.kind === "live") {
    return `stop pid ${String(prior.pid)}`;
  }
  return "nothing to stop (a bare shell)";
}

/** Why a relaunch went fresh, in words. */
function freshWhy({ why }: { why: "no-transcript" | "missing-conversation" }): string {
  if (why === "no-transcript") {
    return "it never took a prompt, so no transcript stands to resume";
  }
  return "its resume printed No conversation found, so it was relaunched fresh once";
}

/**
 * One outcome as the line the verb prints.
 *
 * @param outcome the workspace's result
 * @returns a tab-separated line: what happened, the workspace, the detail
 */
export function renderReseatOutcome({ outcome }: { outcome: ReseatOutcome }): string {
  switch (outcome.kind) {
    case "reseated":
      return `reseated\t${outcome.plan.workspace.workspaceRef}\t${outcome.plan.sessionId} on --model ${outcome.plan.model} (${outcome.plan.modelSource}) — ${outcome.seat}`;
    case "fresh-seated":
      return `fresh-seated\t${outcome.plan.workspace.workspaceRef}\t${outcome.plan.sessionId} was NOT resumed (${freshWhy({ why: outcome.why })}) — a fresh ${outcome.freshSessionId} on --model ${outcome.plan.model} stands at an empty composer with no conversation and no pickup — ${outcome.seat}`;
    case "would-reseat":
      return `would-reseat\t${outcome.plan.workspace.workspaceRef}\t${priorStep({ prior: outcome.plan.prior })}, then send: ${outcome.line}`;
    case "refused":
      return `refused\t${outcome.workspaceRef}\t${outcome.error.code}: ${outcome.error.message}`;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/**
 * The pass's exit: anything refused is an error, otherwise clean. There is no not-yet: a reseat replaces one
 * process with one, in place, so the machine's capacity HOLD never holds it (`../cli/commands/cmux/reseatPass.ts`).
 *
 * @param outcomes every workspace's result
 * @returns `error` or `ok`
 */
export function reseatPassVerdict({ outcomes }: { outcomes: readonly ReseatOutcome[] }): "error" | "ok" {
  if (outcomes.some((outcome) => outcome.kind === "refused")) {
    return "error";
  }
  return "ok";
}
