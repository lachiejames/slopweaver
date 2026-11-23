/**
 * What one parsed `plans` request asks the register to change, and the words a successful change reports it by.
 * Pure: the verb shell in `./run.ts` reads and writes the register; this decides only what it asks for.
 */
import type { PlanMutation } from "../../../plans/types.js";
import type { UsageLimitPercent } from "../../../plans/usageLimit.js";

import type { PlansRequest } from "./core.js";
import { thresholdFlagFor } from "./thresholdArgs.js";

type UsageLimitRequest = Extract<PlansRequest, { readonly verb: "set-usage-limit" }>;
type ThresholdsRequest = Extract<PlansRequest, { readonly verb: "set-thresholds" }>;
type UnpinRequest = Extract<PlansRequest, { readonly verb: "unpin" }>;
type StoreDirRequest = Extract<PlansRequest, { readonly verb: "set-store-dir" }>;

/**
 * The usage-limit mutation, carrying the prior percentage only when the command line named one.
 *
 * @param request the parsed `set-usage-limit` request
 * @returns the mutation it asks for
 */
function usageLimitMutation({ request }: { request: UsageLimitRequest }): PlanMutation {
  let from: { readonly fromUsageLimitPercent?: UsageLimitPercent } = {};
  if (request.fromUsageLimitPercent !== undefined) {
    from = { fromUsageLimitPercent: request.fromUsageLimitPercent };
  }
  return {
    ...from,
    alias: request.alias,
    allowance: request.allowance,
    kind: "set-usage-limit",
    provider: request.provider,
    usageLimitPercent: request.usageLimitPercent,
  };
}

/**
 * The change one request asks for, or undefined when the verb only reads.
 *
 * @param nowIso the instant a pause or a removal records
 * @param request what the command line asked for
 * @returns the mutation, or undefined for a read-only verb
 */
export function mutationFor({ nowIso, request }: { nowIso: string; request: PlansRequest }): PlanMutation | undefined {
  switch (request.verb) {
    case "adopt":
      return { kind: "adopt" };
    case "add":
      return { kind: "add", row: request.row };
    case "pause":
      return {
        alias: request.alias,
        kind: "pause",
        paused: { reason: request.reason, sinceIso: nowIso },
        provider: request.provider,
      };
    case "resume":
    case "pin":
    case "unpin":
    case "clear-lapse":
      return { alias: request.alias, kind: request.verb, provider: request.provider };
    case "remove":
      return { alias: request.alias, kind: "remove", provider: request.provider, removedAtIso: nowIso };
    case "set-email":
      return { alias: request.alias, email: request.email, kind: "set-email", provider: request.provider };
    case "set-store-dir":
      return { alias: request.alias, kind: "set-store-dir", provider: request.provider, storeDir: request.storeDir };
    case "set-usage-limit":
      return usageLimitMutation({ request });
    case "lapse":
      return { alias: request.alias, kind: "set-lapse", lapsesAtIso: request.lapsesAtIso, provider: request.provider };
    case "set-thresholds":
      return { change: request.change, kind: "set-thresholds" };
    case "validate":
      return request.repairProjection ? { kind: "repair-projection" } : undefined;
    case "list":
    case "sync-accounts":
      return undefined;
    default: {
      const unhandled: never = request;
      return unhandled;
    }
  }
}

/**
 * What a `set-thresholds` change says it did: each flag it set and each it reset to the default.
 *
 * @param request the parsed `set-thresholds` request
 * @returns the past-tense phrase
 */
function thresholdsWord({ request }: { request: ThresholdsRequest }): string {
  const { change } = request;
  const set = Object.entries(change.set).map(
    ([field, value]) => `${thresholdFlagFor({ field, provider: change.provider })} to ${String(value)}`,
  );
  const reset = change.reset.map((field) => thresholdFlagFor({ field, provider: change.provider }));
  const parts = [
    ...(set.length === 0 ? [] : [`set ${set.join(", ")}`]),
    ...(reset.length === 0 ? [] : [`reset ${reset.join(", ")} to the default`]),
  ];
  return `${parts.join(" and ")} for ${change.provider}`;
}

/**
 * What an unpin says it did. Only Claude is structurally limited to one pinned row, so only there does taking
 * one pin off prove none is left; a Codex register may carry several, and claiming otherwise would be false.
 *
 * @param request the parsed `unpin` request
 * @returns the past-tense phrase
 */
function unpinWord({ request }: { request: UnpinRequest }): string {
  const tookOff = `took the pin off ${request.provider}/${request.alias}`;
  if (request.provider === "claude") {
    return `${tookOff}; no claude plan is pinned now`;
  }
  return tookOff;
}

/**
 * What a re-home says it did, and the one step it leaves: a sign-in never follows a path. Claude finds its keychain
 * service from the store path, so the new one is signed out; a Codex row's address was cleared with the old path,
 * and `sync-accounts` records it again once that store is signed in.
 *
 * @param request the parsed `set-store-dir` request
 * @returns the past-tense phrase, with the next step
 */
function storeDirWord({ request }: { request: StoreDirRequest }): string {
  const moved = `moved ${request.provider}/${request.alias} to ${request.storeDir}, keeping its alias`;
  if (request.provider === "claude") {
    return `${moved}; sign in again there, since the store path picks the sign-in`;
  }
  return (
    `${moved} and clearing its recorded address; sign in again there, then run ` +
    "`slopweaver plans sync-accounts` to record it"
  );
}

/**
 * What a successful change says it did, in the words the register's own vocabulary uses.
 *
 * @param request what the command line asked for
 * @returns the past-tense phrase
 */
export function didWord({ request }: { request: PlansRequest }): string {
  switch (request.verb) {
    case "adopt":
      return "adopted the derived picture as this install's register";
    case "add":
      return `registered ${request.row.provider}/${request.row.alias} at ${request.row.storeDir}`;
    case "validate":
      return request.repairProjection
        ? "regenerated the Claude projection from the register"
        : "validated the register";
    case "list":
      return "read the register";
    case "sync-accounts":
      return "synced each Codex row's address from its own store";
    case "set-usage-limit":
      return (
        `set the usage limit for ${request.provider}/${request.alias} to ` +
        `${String(request.usageLimitPercent)}% of its ${request.allowance.kind} allowance`
      );
    case "set-thresholds":
      return thresholdsWord({ request });
    case "remove":
      return (
        `removed ${request.provider}/${request.alias} from the register; its store and sign-in stay on disk, and a ` +
        "seat already running on it keeps running"
      );
    case "unpin":
      return unpinWord({ request });
    case "clear-lapse":
      return `cleared the lapse recorded on ${request.provider}/${request.alias}`;
    case "set-email":
      return `recorded that ${request.provider}/${request.alias} is called ${request.email}`;
    case "set-store-dir":
      return storeDirWord({ request });
    case "lapse":
      return `recorded that ${request.provider}/${request.alias}'s paid subscription lapses at ${request.lapsesAtIso}`;
    case "pause":
    case "resume":
      return `${request.verb}d ${request.provider}/${request.alias}`;
    case "pin":
      return `pinned ${request.provider}/${request.alias}`;
    default: {
      const unhandled: never = request;
      return unhandled;
    }
  }
}
