/**
 * Whether one usage-LIMITED account can hold one more pass — the half of `./passReservation.ts` that reads the
 * account's week and says, in words, why it cannot. Pure.
 *
 * Every refusal here names its own ground and only a live reading may claim usage: a store fault, an account no
 * provider identity proves, a week nothing read, and a week only the rollout log read each get their own sentence,
 * and the reservation sentence (`./routingCapacity.ts`'s `usageLimitReason`) is built off a LIVE percentage alone.
 */
import type { UsageLimitPercent } from "../plans/usageLimit.js";
import type { CodexAccountGroup } from "./accountIdentity.js";
import type { CodexPlanObservation } from "./fleetTypes.js";
import { believableGauge, mostSpentWeekly, usageLimitReason } from "./routingCapacity.js";

/** What one ranked destination's account allows this pass. */
export type PassAccountGate =
  | { readonly kind: "unlimited" }
  | {
      readonly kind: "reserve";
      readonly accountKey: string;
      readonly limit: UsageLimitPercent;
      readonly usedPercent: number;
      readonly reserved: number;
    }
  | { readonly kind: "held"; readonly reason: string };

/** The account's week as its stores read it: live, only from the rollout log, or not at all. */
export type AccountWeeklyUse =
  | { readonly kind: "live"; readonly usedPercent: number; readonly resetAtIso: string | undefined }
  | { readonly kind: "rollout-only"; readonly usedPercent: number }
  | { readonly kind: "unread" };

/**
 * The highest believable weekly reading across an account's stores, and whether any of it was live.
 *
 * A LIVE reading whose weekly slot cannot be believed makes the whole account unread: that slot could be the one at
 * the limit. A rollout reading joins the maximum — stale evidence of spending never reads as headroom — but never
 * makes the account live on its own.
 *
 * @param group the account
 * @param nowIso the instant the readings are judged against
 * @param observations every registered row's evidence, indexed as the group's members are
 * @returns the account's week
 */
function accountWeeklyUse({
  group,
  nowIso,
  observations,
}: {
  group: CodexAccountGroup;
  nowIso: string;
  observations: readonly CodexPlanObservation[];
}): AccountWeeklyUse {
  let most: { readonly usedPercent: number; readonly resetAtIso: string | undefined } | undefined;
  let live = false;
  for (const index of group.members) {
    const observation = observations[index]!;
    const believed = believableGauge({ gauge: observation.gauge, nowIso });
    if (believed === undefined) {
      continue;
    }
    const spent = mostSpentWeekly({ gauge: believed });
    if (spent === undefined && observation.gaugeSource === "live") {
      return { kind: "unread" };
    }
    if (spent === undefined) {
      continue;
    }
    live = live || observation.gaugeSource === "live";
    if (most === undefined || spent.usedPercent > most.usedPercent) {
      most = { resetAtIso: spent.window.resetAtIso, usedPercent: spent.usedPercent };
    }
  }
  if (most === undefined) {
    return { kind: "unread" };
  }
  if (!live) {
    return { kind: "rollout-only", usedPercent: most.usedPercent };
  }
  return { kind: "live", resetAtIso: most.resetAtIso, usedPercent: most.usedPercent };
}

/**
 * Judge a limited account: reserve when `live used + reserved + requested <= limit`, else say why not.
 *
 * @param group the account, whose proven identities match reservations
 * @param limit the lowest sub-100 usage limit any of its rows carries
 * @param nowIso the instant the readings are judged against
 * @param observations every registered row's evidence
 * @param requested the points this pass would reserve
 * @param reserved the points standing reservations already hold on the account
 * @param store whether the reservation document could be read at all
 * @returns reserve with the numbers, or held with the sentence
 */
export function limitedAccountGate({
  group,
  limit,
  nowIso,
  observations,
  requested,
  reserved,
  store,
}: {
  group: CodexAccountGroup;
  limit: UsageLimitPercent;
  nowIso: string;
  observations: readonly CodexPlanObservation[];
  requested: 1;
  reserved: number;
  store: { readonly kind: "healthy" } | { readonly kind: "unavailable"; readonly reason: string };
}): PassAccountGate {
  if (store.kind === "unavailable") {
    return {
      kind: "held",
      reason: `held to the owner's ${String(limit)}% usage limit and the pass reservation store is unavailable (${store.reason}), so no reservation can hold its share`,
    };
  }
  if (group.accountKey === undefined) {
    return {
      kind: "held",
      reason: `held to the owner's ${String(limit)}% usage limit and no account id or address on its live read proves which provider account it is, so no reservation can be held against it`,
    };
  }
  const use = accountWeeklyUse({ group, nowIso, observations });
  return judgeWeek({ accountKey: group.accountKey, limit, requested, reserved, use });
}

/**
 * Judge an identified account's week against its limit: an unread or rollout-only week is held on its own sentence,
 * a live one reserves when `used + reserved + requested <= limit`.
 *
 * @param accountKey the proven account digest a reservation would be taken against
 * @param use the account's week as its stores read it
 * @returns reserve with the numbers, or held with the sentence
 */
export function judgeWeek({
  accountKey,
  limit,
  requested,
  reserved,
  use,
}: {
  accountKey: string;
  limit: UsageLimitPercent;
  requested: 1;
  reserved: number;
  use: AccountWeeklyUse;
}): PassAccountGate {
  if (use.kind === "unread") {
    const reached = {
      evidence: "unread",
      resetAtIso: undefined,
      usageLimitPercent: limit,
      usedPercent: undefined,
    } as const;
    return { kind: "held", reason: usageLimitReason({ reached }) };
  }
  if (use.kind === "rollout-only") {
    const reached = {
      evidence: "rollout-only",
      resetAtIso: undefined,
      usageLimitPercent: limit,
      usedPercent: use.usedPercent,
    } as const;
    return { kind: "held", reason: usageLimitReason({ reached }) };
  }
  if (use.usedPercent + reserved + requested <= limit) {
    return { accountKey, kind: "reserve", limit, reserved, usedPercent: use.usedPercent };
  }
  const reached = {
    evidence: "reservation",
    requestedPercent: requested,
    reservedPercent: reserved,
    resetAtIso: use.resetAtIso,
    usageLimitPercent: limit,
    usedPercent: use.usedPercent,
  } as const;
  return { kind: "held", reason: usageLimitReason({ reached }) };
}
