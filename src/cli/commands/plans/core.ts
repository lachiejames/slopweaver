/**
 * The `plans` noun's typed option parsers — one register, one request type per verb.
 *
 * The flag SPECS and the usage lines derived from them live in `plansUsage.js`, a leaf the manifest can reach
 * without importing this module (`.claude/rules/area-cli.md` § "Metadata is eager, the run function is lazy").
 *
 * ## `--plan <alias>` is the selector on every verb, including `add`
 *
 * The routing plan named `--alias` on `add` and `--plan` on the three row verbs while it was being designed.
 * One name across all of them is what shipped: a caller who has just read `plans list` is holding an alias,
 * and having to remember which verb spells it which way is precisely the "plan number they must hold" this
 * noun exists to delete.
 *
 * ## What is NOT validated here
 *
 * An alias's shape, a duplicate store directory, the pin-at-most-one rule and the paused-pin rule all belong
 * to `src/plans/register.ts` and `src/claude/config.ts`, which the write path runs on the rows it is about to
 * publish. There is no count rule anywhere: one Claude plan is a whole fleet. Re-checking any of them here
 * would be a second copy that drifts — this module refuses
 * only what a caller can get wrong about the COMMAND LINE.
 *
 * Pure: no filesystem, no clock. A pause's `sinceIso` is stamped by the run function, which is where the
 * clock lives.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import type { ThresholdMutation } from "../../../plans/thresholds.js";
import type { PlanProvider, RegisteredPlan } from "../../../plans/types.js";
import {
  NO_USAGE_LIMIT,
  PLAN_ALLOWANCE_KINDS,
  type PlanAllowance,
  USAGE_LIMIT_PERCENTS,
  type UsageLimitPercent,
  WEEKLY_WINDOW,
} from "../../../plans/usageLimit.js";
import { parseFlags } from "../../parseFlags.js";

import { type PlansArgsError, PlansArgsErrors } from "./argsErrors.js";
import { PLANS_SPECS } from "./plansUsage.js";
import { thresholdChange } from "./thresholdArgs.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, plans, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/** Both providers, as `--provider` accepts them — the register's own closed union, not a second list. */
const PROVIDERS: readonly PlanProvider[] = ["claude", "codex"];

/** Which row a verb addresses, as {@link addressed} reads it off the command line. */
interface RowAddress {
  readonly provider: PlanProvider;
  readonly alias: string;
}

/** What one invocation asked the register to do, with every command-line refusal already spent. */
export type PlansRequest =
  | { readonly verb: "adopt" }
  | { readonly verb: "list"; readonly provider: PlanProvider | undefined }
  | { readonly verb: "validate"; readonly repairProjection: boolean }
  | { readonly verb: "add"; readonly row: RegisteredPlan }
  | { readonly verb: "pause"; readonly provider: PlanProvider; readonly alias: string; readonly reason: string }
  | { readonly verb: "resume"; readonly provider: PlanProvider; readonly alias: string }
  | { readonly verb: "pin"; readonly provider: PlanProvider; readonly alias: string }
  | { readonly verb: "remove"; readonly provider: PlanProvider; readonly alias: string }
  | { readonly verb: "unpin"; readonly provider: PlanProvider; readonly alias: string }
  | { readonly verb: "clear-lapse"; readonly provider: PlanProvider; readonly alias: string }
  | { readonly verb: "set-email"; readonly provider: PlanProvider; readonly alias: string; readonly email: string }
  | ({ readonly verb: "set-store-dir"; readonly storeDir: string } & RowAddress)
  | {
      readonly verb: "set-usage-limit";
      readonly provider: PlanProvider;
      readonly alias: string;
      readonly allowance: PlanAllowance;
      readonly usageLimitPercent: UsageLimitPercent;
      /** `--from`: the limit the row must still carry for the change to apply; absent when not given. */
      readonly fromUsageLimitPercent?: UsageLimitPercent;
    }
  | { readonly verb: "lapse"; readonly provider: PlanProvider; readonly alias: string; readonly lapsesAtIso: string }
  | { readonly verb: "set-thresholds"; readonly change: ThresholdMutation }
  | { readonly verb: "sync-accounts" };

/** One parsed invocation: what to do, where, and how to print it. */
export interface PlansInvocation {
  readonly request: PlansRequest;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** One flag's string value, or undefined when it was not supplied. */
function text({
  name,
  values,
}: {
  name: string;
  values: Readonly<Record<string, string | boolean>>;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Read a required string flag.
 *
 * @param name the flag's name without its dashes
 * @param values the parsed flags
 * @returns the value, or why it could not be read
 */
function required({
  name,
  values,
}: {
  name: string;
  values: Readonly<Record<string, string | boolean>>;
}): Result<string, PlansArgsError> {
  const given = text({ name, values });
  if (given === undefined) {
    return err(PlansArgsErrors.flagMissing({ flag: name }));
  }
  return ok(given);
}

/**
 * Read `--provider`, which is required wherever it appears.
 *
 * Its ABSENCE goes through {@link required} rather than being spelled here, so the noun has one
 * missing-flag sentence rather than a per-flag family of them — the shape `error-shape-threshold` counts.
 *
 * @param values the parsed flags
 * @returns the provider, or why it could not be read
 */
function provider({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<PlanProvider, PlansArgsError> {
  return oneOf({ choices: PROVIDERS, name: "provider", values });
}

/**
 * Read a required flag that must be one of a closed list, spelled exactly as the list prints it.
 *
 * One function for every closed-list flag, so the noun has one "must be one of" sentence rather than a
 * per-flag family — the shape `error-shape-threshold` counts.
 *
 * @param choices every accepted value, in the order the refusal names them
 * @param name the flag's name without its dashes
 * @param values the parsed flags
 * @returns the matching choice, or why the flag could not be read
 */
function oneOf<T extends string | number>({
  choices,
  name,
  values,
}: {
  choices: readonly T[];
  name: string;
  values: Readonly<Record<string, string | boolean>>;
}): Result<T, PlansArgsError> {
  const given = required({ name, values });
  if (given.isErr()) {
    return err(given.error);
  }
  const matched = choices.find((candidate) => String(candidate) === given.value);
  if (matched === undefined) {
    return err(PlansArgsErrors.flagChoiceUnknown({ choices, flag: name, given: given.value }));
  }
  return ok(matched);
}

/**
 * Read what `plans set-usage-limit` records: the addressed row, the share it may take, of what, and — when `--from`
 * is given — the limit the row must still carry for the change to apply.
 *
 * @param values the parsed flags
 * @returns the request, or every reason the command line could not be read
 */
function usageLimitRequest({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<PlansRequest, PlansArgsError> {
  const where = addressed({ values });
  const percent = oneOf({ choices: USAGE_LIMIT_PERCENTS, name: "percent", values });
  const kind = oneOf({ choices: PLAN_ALLOWANCE_KINDS, name: "allowance", values });
  // `--from` is optional: read only when given, through the same closed list as `--percent`.
  let from: Result<UsageLimitPercent | undefined, PlansArgsError> = ok(undefined);
  if (text({ name: "from", values }) !== undefined) {
    from = oneOf({ choices: USAGE_LIMIT_PERCENTS, name: "from", values });
  }
  if (where.isErr() || percent.isErr() || kind.isErr() || from.isErr()) {
    const problems = [where, percent, kind, from].flatMap((each) => (each.isErr() ? [each.error.message] : []));
    return err(PlansArgsErrors.usageLimitUnreadable({ problems }));
  }
  let fromField: { readonly fromUsageLimitPercent?: UsageLimitPercent } = {};
  if (from.value !== undefined) {
    fromField = { fromUsageLimitPercent: from.value };
  }
  return ok({
    ...where.value,
    ...fromField,
    allowance: { kind: kind.value },
    usageLimitPercent: percent.value,
    verb: "set-usage-limit",
  });
}

/**
 * Which row a verb addresses: a provider plus an alias, both required.
 *
 * @param values the parsed flags
 * @returns the addressed row, or why it could not be read
 */
function addressed({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<RowAddress, PlansArgsError> {
  const which = provider({ values });
  if (which.isErr()) {
    return err(which.error);
  }
  const alias = required({ name: "plan", values });
  if (alias.isErr()) {
    return err(alias.error);
  }
  return ok({ alias: alias.value, provider: which.value });
}

/**
 * Build the row `plans add` was asked to register.
 *
 * The store directory must be ABSOLUTE: a provider CLI resolves it against its own working directory, and
 * Claude hashes the string to find its keychain service, so a relative path addresses a different, empty
 * credential depending on where the verb happened to run.
 *
 * @param values the parsed flags
 * @returns the row, or why it could not be built
 */
function addedRow({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<RegisteredPlan, PlansArgsError> {
  const where = addressed({ values });
  if (where.isErr()) {
    return err(where.error);
  }
  const storeDir = requiredStoreDir({ values });
  if (storeDir.isErr()) {
    return err(storeDir.error);
  }
  const email = text({ name: "email", values });
  // `--percent` binds the user's usage limit from the instant the row enters the fleet, so no window exists in
  // which a plan they capped at onboarding is routable at its whole allowance. Absent,
  // the row is the whole plan of a subscription until `plans set-usage-limit` says otherwise.
  let usageLimitPercent: UsageLimitPercent = NO_USAGE_LIMIT;
  if (text({ name: "percent", values }) !== undefined) {
    const percent = oneOf({ choices: USAGE_LIMIT_PERCENTS, name: "percent", values });
    if (percent.isErr()) {
      return err(percent.error);
    }
    usageLimitPercent = percent.value;
  }
  return ok({
    alias: where.value.alias,
    allowance: WEEKLY_WINDOW,
    provider: where.value.provider,
    storeDir: storeDir.value,
    usageLimitPercent,
    ...(email === undefined ? {} : { email }),
    ...(values["pinned"] === true ? { pinned: true } : {}),
  });
}

/**
 * Read `--store-dir`, which must be ABSOLUTE for the reason {@link addedRow} gives: `add` and `set-store-dir` share
 * this one rule and its one refusal.
 *
 * @param values the parsed flags
 * @returns the path as given, or why it was refused
 */
function requiredStoreDir({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<string, PlansArgsError> {
  return required({ name: "store-dir", values }).andThen((storeDir) =>
    storeDir.startsWith("/") ? ok(storeDir) : err(PlansArgsErrors.storeDirRelative({ storeDir })),
  );
}

/**
 * Read `--on`, the instant a plan's paid subscription lapses, refusing anything that is not a strict ISO-8601
 * instant before a write is attempted — the register would refuse it too, but only after a store round trip.
 *
 * @param values the parsed flags
 * @returns the instant as given, or why it could not be read
 */
function lapseInstant({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<string, PlansArgsError> {
  const given = required({ name: "on", values });
  if (given.isErr()) {
    return err(given.error);
  }
  if (parseStrictIsoInstantMs({ text: given.value }) === undefined) {
    return err(PlansArgsErrors.lapseInstantMalformed({ given: given.value }));
  }
  return ok(given.value);
}

/**
 * Read the optional `--provider` filter `plans list` accepts.
 *
 * @param values the parsed flags
 * @returns the filter, or why an unreadable one was refused
 */
function listFilter({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<PlanProvider | undefined, PlansArgsError> {
  if (text({ name: "provider", values }) === undefined) {
    return ok(undefined);
  }
  return provider({ values });
}

/**
 * The request one verb's flags describe, verb by verb.
 *
 * @param rest the argv tail, which a repeatable flag's list is read off
 * @param values the parsed flags
 * @param verb which verb was dispatched
 * @returns the request, or why the command line could not be read
 */
function requestFor({
  rest,
  values,
  verb,
}: {
  rest: readonly string[];
  values: Readonly<Record<string, string | boolean>>;
  verb: string;
}): Result<PlansRequest, PlansArgsError> {
  if (verb === "set-thresholds") {
    return provider({ values }).andThen((which) =>
      thresholdChange({ provider: which, rest, values }).map((change): PlansRequest => ({
        change,
        verb: "set-thresholds",
      })),
    );
  }
  if (verb === "adopt") {
    return ok({ verb: "adopt" });
  }
  if (verb === "sync-accounts") {
    return ok({ verb: "sync-accounts" });
  }
  if (verb === "validate") {
    return ok({ repairProjection: values["repair-projection"] === true, verb: "validate" });
  }
  if (verb === "list") {
    return listFilter({ values }).map((filter): PlansRequest => ({ provider: filter, verb: "list" }));
  }
  if (verb === "add") {
    return addedRow({ values }).map((row): PlansRequest => ({ row, verb: "add" }));
  }
  if (verb === "set-usage-limit") {
    return usageLimitRequest({ values });
  }
  return rowRequest({ values, verb });
}

/**
 * The request for a verb that addresses one row, and the one value beyond the address it needs, if any. `pin` is
 * the fall-through, as it is in {@link requestFor}: the dispatcher only routes verbs its spec table names.
 *
 * @param values the parsed flags
 * @param verb which verb was dispatched
 * @returns the request, or why the command line could not be read
 */
function rowRequest({
  values,
  verb,
}: {
  values: Readonly<Record<string, string | boolean>>;
  verb: string;
}): Result<PlansRequest, PlansArgsError> {
  const where = addressed({ values });
  if (where.isErr()) {
    return err(where.error);
  }
  const at = where.value;
  switch (verb) {
    case "pause":
      return required({ name: "reason", values }).map((reason): PlansRequest => ({ ...at, reason, verb: "pause" }));
    case "set-email":
      return required({ name: "email", values }).map((email): PlansRequest => ({ ...at, email, verb: "set-email" }));
    case "set-store-dir":
      return requiredStoreDir({ values }).map((storeDir): PlansRequest => ({ ...at, storeDir, verb }));
    case "lapse":
      return lapseInstant({ values }).map((lapsesAtIso): PlansRequest => ({ ...at, lapsesAtIso, verb: "lapse" }));
    case "resume":
    case "remove":
    case "unpin":
    case "clear-lapse":
      return ok({ ...at, verb });
    default:
      return ok({ ...at, verb: "pin" });
  }
}

/**
 * Parse one `plans` verb's arguments into a request the run function can act on without re-reading a flag.
 *
 * @param rest the argv tail after `plans <verb>`
 * @param verb which verb was dispatched
 * @returns the invocation, or the typed refusal to print above its usage line
 */
export function parsePlansArgs({
  rest,
  verb,
}: {
  rest: readonly string[];
  verb: string;
}): Result<PlansInvocation, PlansArgsError> {
  const spec = PLANS_SPECS[verb];
  if (spec === undefined) {
    return err(PlansArgsErrors.verbUnknown({ verb }));
  }
  const parsed = parseFlags({ args: rest, spec });
  if (parsed.isErr()) {
    return err(PlansArgsErrors.flagsUnparsed({ problems: parsed.error }));
  }
  const { values } = parsed.value;
  return requestFor({ rest, values, verb }).map((request): PlansInvocation => ({
    home: text({ name: "home", values }),
    json: values["json"] === true,
    request,
  }));
}
