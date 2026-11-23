/*
 * One Codex destination's ceiling, graded by the Codex ranker's own exclusion. Split from `./ceilings.ts` along the
 * provider seam: nothing here reads a Claude plan, and `./ceilings.ts` § Units is the contract both halves draw on.
 */
import { CODEX_MONTHLY_SPEND_NOT_MEASURED, type UsageLimitPercent } from "../plans/usageLimit.js";
import type { Ceiling, CeilingWindow } from "./ceilings.js";
import { usedOf, windowsHeadroom } from "./windowArithmetic.js";

/** One Codex window as the fleet read reported it, `usedPercent` on Codex's own 0..100 scale. */
interface CodexWindowInput {
  readonly label: string;
  readonly usedPercent: number;
  readonly resetAtIso: string | null;
}

/** One registered Codex destination. */
export interface CodexPlanInput {
  readonly alias: string;
  /** The account cell, `codexAccountCell`'s rendering of the fleet row. */
  readonly account: string;
  /** The free resets its live read reported unused, or `null` when it reported none. */
  readonly freeResets: number | null;
  /** `null` when neither the live read nor the rollout log carried a reading. */
  readonly windows: readonly CodexWindowInput[] | null;
  /** The register row's usage limit, which lowers the `weekly` window's `available` (§ Units). */
  readonly usageLimitPercent: UsageLimitPercent;
  /** The ranker's exclusion, or `null` when it ranked the destination. */
  readonly exclusion: { readonly kind: string; readonly reason: string } | null;
}

/** A Codex exclusion's status: a pause and the owner's usage limit are each their own, anything else `refusing`. */
function codexExcludedStatus({ kind }: { kind: string }): "paused" | "at-usage-limit" | "refusing" {
  if (kind === "paused") {
    return "paused";
  }
  if (kind === "usage-limit") {
    return "at-usage-limit";
  }
  return "refusing";
}

/**
 * One Codex destination's ceiling, graded by the ranker's own exclusion.
 *
 * @returns the ceiling — a monthly-spend destination nothing measures is unreadable, never measured exhaustion
 */
export function codexCeiling({ plan }: { plan: CodexPlanInput }): Ceiling {
  const id = `codex:${plan.alias}`;
  let read: readonly CodexWindowInput[] = [];
  if (plan.windows !== null) {
    read = plan.windows;
  }
  const windows = read.map((window): CeilingWindow => {
    // Codex's usage limit lowers its `weekly` window alone (`../codex/routingCapacity.ts`), as Claude's does (§ Units).
    const available = window.label === "weekly" ? plan.usageLimitPercent : 100;
    return {
      available,
      resetAtIso: window.resetAtIso,
      used: usedOf({ available, raw: window.usedPercent }),
      window: window.label,
    };
  });
  const owned = { account: plan.account, freeResets: plan.freeResets };
  if (plan.exclusion !== null) {
    const { kind, reason } = plan.exclusion;
    if (kind === "not-measured") {
      // No claim at all, never measured exhaustion: whatever its windows say, they are not its allowance.
      return {
        ...owned,
        headroom: null,
        id,
        kind: "codex",
        reason: CODEX_MONTHLY_SPEND_NOT_MEASURED,
        status: "unreadable",
        windows,
      };
    }
    const status = codexExcludedStatus({ kind });
    return { ...owned, headroom: 0, id, kind: "codex", reason, status, windows };
  }
  if (plan.windows === null || windows.length === 0) {
    const reason = "no budget reading in its live read or its rollout log";
    return { ...owned, headroom: null, id, kind: "codex", reason, status: "unreadable", windows };
  }
  const headroom = windowsHeadroom({ windows });
  return { ...owned, headroom, id, kind: "codex", reason: null, status: "open", windows };
}
